const config = require('../config');
const axios = require('axios');
const { TtlCache, SingleFlight } = require('./cache');
const { encodeToken, decodeToken } = require('./token');
const { extractSubtitleFromArchive } = require('./archive');
const turkceAltyazi = require('./turkcealtyazi');
const openSubtitles = require('./opensubtitles');
const anisub = require('./anisub');

const searchCache = new TtlCache({ maxEntries: 2000 });
const archiveCache = new TtlCache({ maxEntries: 300 });
const vttCache = new TtlCache({ maxEntries: 2000 });

const searchFlight = new SingleFlight();
const downloadFlight = new SingleFlight();

/**
 * Searches and aggregates Turkish subtitles from AniSub, TurkceAltyazi, and OpenSubtitles
 */
async function aggregateSubtitles(media, baseUrl, userConfig = {}) {
  const osKey = userConfig.osApiKey || config.openSubtitles.apiKey;
  const priority = userConfig.priority || 'turkcealtyazi';

  const cacheKey = `search:${media.type}:${media.imdbId || media.kitsuId}:${media.season || 0}:${media.episode || 0}:${osKey ? 'custom' : 'default'}:${priority}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  return searchFlight.run(cacheKey, async () => {
    const secondCheck = searchCache.get(cacheKey);
    if (secondCheck) return secondCheck;

    const aniSubtitles = [];
    const taSubtitles = [];
    const osSubtitles = [];

    // --- 0. ANISUB SEARCH (For Anime / Animation / Kitsu) ---
    if (media.isAnime || media.isKitsu || media.type === 'anime' || (media.searchTitles && media.searchTitles.length > 0)) {
      try {
        const aniResults = await anisub.findAnimeSubtitles({
          titles: media.searchTitles,
          season: media.season || 1,
          episode: media.episode || 1,
        }, baseUrl);
        aniSubtitles.push(...aniResults);
      } catch (err) {
        console.error('[Aggregator] AniSub provider error:', err.message);
      }
    }

    // --- 1. TURKCEALTYAZI SEARCH ---
    try {
      let titlePages = [];

      if (media.imdbId) {
        titlePages = await turkceAltyazi.findTitlePages(media.imdbId);
      } else if (media.searchTitles && media.searchTitles.length > 0) {
        // For anime or titles without direct IMDb ID, try searching by title
        for (const title of media.searchTitles) {
          const results = await turkceAltyazi.findTitlePages(title);
          if (results.length > 0) {
            titlePages = results;
            break;
          }
        }
      }

      if (titlePages.length > 0) {
        // Use primary title page
        const primaryPage = titlePages[0];
        const candidates = await turkceAltyazi.listCandidates(primaryPage.pageUrl, {
          type: media.type,
          season: media.season,
          episode: media.episode,
        });

        // Limit detail lookups to avoid rate limiting
        const topCandidates = candidates.slice(0, 15);

        for (const candidate of topCandidates) {
          try {
            const dlInfo = await turkceAltyazi.getDownloadInfo(candidate.subPageUrl);
            const tokenData = {
              source: 'turkcealtyazi',
              idid: dlInfo.idid,
              altid: dlInfo.altid,
              sidid: dlInfo.sidid,
              referer: dlInfo.referer,
              season: media.season,
              episode: media.episode,
              isPackage: candidate.isPackage,
            };

            const token = encodeToken(tokenData);
            const displayTitle = candidate.translator
              ? `Türkçe - ${candidate.translator} (${candidate.rip || 'Web-DL'})`
              : `Türkçe (${candidate.rip || 'TurkceAltyazi'})`;

            taSubtitles.push({
              id: `ta-${dlInfo.altid}-${media.season || 0}-${media.episode || 0}`,
              url: `${baseUrl}/subtitles/download/${token}.vtt`,
              lang: 'tur',
              format: 'vtt',
              title: displayTitle,
            });
          } catch (candErr) {
            // Ignore individual failed candidate forms
          }
        }
      }
    } catch (err) {
      console.error('[Aggregator] TurkceAltyazi provider error:', err.message);
    }

    // --- 2. OPENSUBTITLES SEARCH ---
    try {
      const osResults = await openSubtitles.searchOpenSubtitles({
        imdbId: media.imdbId,
        query: media.searchTitles ? media.searchTitles[0] : null,
        type: media.type,
        season: media.season,
        episode: media.episode,
        apiKey: osKey,
      });

      for (const osItem of osResults) {
        const tokenData = {
          source: 'opensubtitles',
          fileId: osItem.fileId,
          subFormat: osItem.subFormat,
          apiKey: osKey || undefined,
        };

        const token = encodeToken(tokenData);
        osSubtitles.push({
          id: `os-${osItem.fileId}`,
          url: `${baseUrl}/subtitles/download/${token}.vtt`,
          lang: 'tur',
          format: 'vtt',
          title: `Türkçe [OpenSubtitles] ${osItem.description}`,
        });
      }
    } catch (err) {
      console.error('[Aggregator] OpenSubtitles provider error:', err.message);
    }

    // Merge based on user preference and relevance
    const generalSubtitles = priority === 'opensubtitles'
      ? [...osSubtitles, ...taSubtitles]
      : [...taSubtitles, ...osSubtitles];

    const finalSubtitles = [...aniSubtitles, ...generalSubtitles];

    const ttl = finalSubtitles.length > 0 ? config.cache.searchTtlMs : config.cache.negativeSearchTtlMs;
    searchCache.set(cacheKey, finalSubtitles, ttl);
    return finalSubtitles;
  });
}

/**
 * Downloads and converts the requested subtitle to WebVTT
 */
async function resolveSubtitleVtt(tokenStr) {
  const cached = vttCache.get(tokenStr);
  if (cached) return cached;

  return downloadFlight.run(tokenStr, async () => {
    const secondCheck = vttCache.get(tokenStr);
    if (secondCheck) return secondCheck;

    const token = decodeToken(tokenStr);

    if (token.source === 'anisub') {
      if (!token.zipUrl || typeof token.zipUrl !== 'string') {
        throw new Error('Invalid download URL parameter');
      }

      // SSRF Defense: strictly whitelist trusted subtitle archive CDNs
      try {
        const parsedUrl = new URL(token.zipUrl);
        const allowedHosts = ['cdn.anisub.co', 'anisub.co', 'media.githubusercontent.com', 'raw.githubusercontent.com'];
        const isAllowed = allowedHosts.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`));
        if (!isAllowed || parsedUrl.protocol !== 'https:') {
          throw new Error('Disallowed subtitle archive download host');
        }
      } catch (err) {
        throw new Error('Disallowed subtitle archive download host');
      }

      const archiveKey = `archive:${token.zipUrl}`;
      let archiveBuffer = archiveCache.get(archiveKey);

      if (!archiveBuffer) {
        const res = await axios.get(token.zipUrl, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15000,
        });
        archiveBuffer = Buffer.from(res.data);
        archiveCache.set(archiveKey, archiveBuffer, config.cache.archiveTtlMs);
      }

      const extracted = await extractSubtitleFromArchive(archiveBuffer, {
        season: token.season,
        episode: token.episode,
        requireEpisodeMatch: false,
      });

      vttCache.set(tokenStr, extracted.body, config.cache.subtitleTtlMs);
      return extracted.body;
    }

    if (token.source === 'turkcealtyazi') {
      const archiveKey = `archive:${token.altid}`;
      let archiveBuffer = archiveCache.get(archiveKey);

      if (!archiveBuffer) {
        archiveBuffer = await turkceAltyazi.downloadArchive(token);
        archiveCache.set(archiveKey, archiveBuffer, config.cache.archiveTtlMs);
      }

      const extracted = await extractSubtitleFromArchive(archiveBuffer, {
        season: token.season,
        episode: token.episode,
        requireEpisodeMatch: token.isPackage,
      });

      vttCache.set(tokenStr, extracted.body, config.cache.subtitleTtlMs);
      return extracted.body;
    }

    if (token.source === 'opensubtitles') {
      const vttContent = await openSubtitles.downloadOpenSubtitle(token.fileId, token.apiKey);
      vttCache.set(tokenStr, vttContent, config.cache.subtitleTtlMs);
      return vttContent;
    }

    throw new Error('Unsupported subtitle provider source');
  });
}

module.exports = {
  aggregateSubtitles,
  resolveSubtitleVtt,
};
