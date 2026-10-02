const config = require('../config');
const { TtlCache, SingleFlight } = require('./cache');
const { encodeToken, decodeToken } = require('./token');
const { extractSubtitleFromArchive } = require('./archive');
const turkceAltyazi = require('./turkcealtyazi');
const openSubtitles = require('./opensubtitles');

const searchCache = new TtlCache({ maxEntries: 2000 });
const archiveCache = new TtlCache({ maxEntries: 300 });
const vttCache = new TtlCache({ maxEntries: 2000 });

const searchFlight = new SingleFlight();
const downloadFlight = new SingleFlight();

/**
 * Searches and aggregates Turkish subtitles from TurkceAltyazi and OpenSubtitles
 */
async function aggregateSubtitles(media, baseUrl) {
  const cacheKey = `search:${media.type}:${media.imdbId || media.kitsuId}:${media.season || 0}:${media.episode || 0}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  return searchFlight.run(cacheKey, async () => {
    const secondCheck = searchCache.get(cacheKey);
    if (secondCheck) return secondCheck;

    const subtitleList = [];

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

            subtitleList.push({
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
      });

      for (const osItem of osResults) {
        const tokenData = {
          source: 'opensubtitles',
          fileId: osItem.fileId,
          subFormat: osItem.subFormat,
        };

        const token = encodeToken(tokenData);
        subtitleList.push({
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

    const ttl = subtitleList.length > 0 ? config.cache.searchTtlMs : config.cache.negativeSearchTtlMs;
    searchCache.set(cacheKey, subtitleList, ttl);
    return subtitleList;
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
      const vttContent = await openSubtitles.downloadOpenSubtitle(token.fileId);
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
