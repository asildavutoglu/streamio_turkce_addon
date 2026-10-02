const axios = require('axios');
const config = require('../config');
const { TtlCache } = require('./cache');

const kitsuCache = new TtlCache({ maxEntries: 2000 });
const KITSU_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const client = axios.create({
  baseURL: config.kitsu.baseUrl,
  timeout: config.kitsu.timeoutMs,
  headers: {
    Accept: 'application/vnd.api+json',
    'User-Agent': 'StremioTurkceAltyaziPlus/1.0',
  },
});

/**
 * Resolves a Kitsu anime ID to titles, type, and mappings
 * @param {string|number} kitsuId
 * @returns {Promise<{
 *   kitsuId: string,
 *   canonicalTitle: string,
 *   titles: { en?: string, en_jp?: string, ja_jp?: string },
 *   subtype: string,
 *   episodeCount: number|null,
 *   mappings: { tvdb?: string, anilist?: string, mal?: string }
 * }>}
 */
async function resolveKitsuAnime(kitsuId) {
  const cacheKey = `kitsu:${kitsuId}`;
  const cached = kitsuCache.get(cacheKey);
  if (cached) return cached;

  try {
    const [animeRes, mappingsRes] = await Promise.all([
      client.get(`/anime/${kitsuId}`).catch(() => null),
      client.get(`/anime/${kitsuId}/mappings`).catch(() => null),
    ]);

    if (!animeRes || !animeRes.data || !animeRes.data.data) {
      return null;
    }

    const attrs = animeRes.data.data.attributes || {};
    const canonicalTitle = attrs.canonicalTitle || '';
    const titles = attrs.titles || {};
    const subtype = (attrs.subtype || 'tv').toLowerCase();
    const episodeCount = attrs.episodeCount || null;

    const mappings = {};
    if (mappingsRes && mappingsRes.data && Array.isArray(mappingsRes.data.data)) {
      for (const item of mappingsRes.data.data) {
        const site = item.attributes?.externalSite;
        const extId = item.attributes?.externalId;
        if (!site || !extId) continue;

        if (site === 'thetvdb/series' || site === 'thetvdb') mappings.tvdb = extId;
        if (site === 'anilist/anime' || site === 'anilist') mappings.anilist = extId;
        if (site === 'myanimelist/anime') mappings.mal = extId;
      }
    }

    // Query ARM API (Anime Relations Mapping) for exact IMDb & Season ID
    let armData = null;
    try {
      const armRes = await axios.get(`https://arm.haglund.dev/api/v2/ids?source=kitsu&id=${kitsuId}`, {
        timeout: 4000,
        headers: { Accept: 'application/json' },
      });
      if (armRes.data && armRes.data.imdb) {
        armData = armRes.data;
      }
    } catch {
      // ARM fallback
    }

    const result = {
      kitsuId: String(kitsuId),
      canonicalTitle,
      titles: {
        en: titles.en,
        en_jp: titles.en_jp,
        ja_jp: titles.ja_jp,
      },
      subtype,
      episodeCount,
      mappings,
      imdbId: armData?.imdb || null,
      season: armData?.['thetvdb-season'] || 1,
    };

    kitsuCache.set(cacheKey, result, KITSU_TTL_MS);
    return result;
  } catch (err) {
    console.error(`[AnimeResolver] Failed to resolve kitsu:${kitsuId}`, err.message);
    return null;
  }
}

const cinemetaCache = new TtlCache({ maxEntries: 2000 });
const CINEMETA_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves Cinemeta metadata for IMDb items (movie or series)
 */
async function resolveCinemeta(type, imdbId) {
  const cacheKey = `cinemeta:${type}:${imdbId}`;
  const cached = cinemetaCache.get(cacheKey);
  if (cached) return cached;

  try {
    const metaType = type === 'movie' ? 'movie' : 'series';
    const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${metaType}/${imdbId}.json`, {
      timeout: 5000,
    });
    const meta = res.data?.meta;
    if (!meta) return null;

    const name = meta.name || '';
    const genres = Array.isArray(meta.genres) ? meta.genres : [];
    const isAnime = genres.includes('Animation') || type === 'anime';

    // If this is an animation title, query Kitsu to find canonical and Japanese/Romaji titles
    const alternativeTitles = [];
    if (isAnime && name) {
      try {
        const kitsuRes = await axios.get('https://kitsu.io/api/edge/anime', {
          params: { 'filter[text]': name, 'page[limit]': 1 },
          timeout: 3500,
        });
        const first = kitsuRes.data?.data?.[0]?.attributes;
        if (first) {
          if (first.canonicalTitle) alternativeTitles.push(first.canonicalTitle);
          if (first.titles?.en_jp) alternativeTitles.push(first.titles.en_jp);
          if (first.titles?.en) alternativeTitles.push(first.titles.en);
        }
      } catch {
        // Fallback silently if Kitsu query fails
      }
    }

    const searchTitles = Array.from(new Set([name, ...alternativeTitles])).filter(Boolean);

    const result = {
      name,
      genres,
      isAnime,
      searchTitles,
    };

    cinemetaCache.set(cacheKey, result, CINEMETA_TTL_MS);
    return result;
  } catch (err) {
    return null;
  }
}

/**
 * Parses Stremio media identifier (IMDb or Kitsu)
 * Formats:
 *  - Movie: tt1234567 or kitsu:1234
 *  - Series: tt1234567:1:5 (imdb:season:episode)
 *  - Anime: kitsu:7442:5 (kitsu:kitsuId:episode)
 */
async function parseMediaIdentifier(type, rawId) {
  const parts = String(rawId).split(':');

  if (rawId.startsWith('kitsu:')) {
    // Kitsu anime
    const kitsuId = parts[1];
    const episode = parts[2] ? Number(parts[2]) : null;
    const animeInfo = await resolveKitsuAnime(kitsuId);

    return {
      isKitsu: true,
      isAnime: true,
      kitsuId,
      imdbId: animeInfo?.imdbId || null,
      season: animeInfo?.season || 1, // TVDB/Kitsu season mapping
      episode,
      type: type === 'movie' ? 'movie' : (animeInfo?.subtype === 'movie' ? 'movie' : 'series'),
      animeInfo,
      searchTitles: animeInfo ? [
        animeInfo.canonicalTitle,
        animeInfo.titles.en,
        animeInfo.titles.en_jp,
      ].filter(Boolean) : [],
    };
  }

  // Standard IMDb id: tt1234567 or tt1234567:1:5
  const imdbId = parts[0];
  const season = parts[1] ? Number(parts[1]) : null;
  const episode = parts[2] ? Number(parts[2]) : null;

  const cinemeta = await resolveCinemeta(type, imdbId);

  return {
    isKitsu: false,
    isAnime: Boolean(cinemeta?.isAnime || type === 'anime'),
    imdbId,
    season,
    episode,
    type: type === 'movie' ? 'movie' : (season !== null && episode !== null ? 'series' : type),
    title: cinemeta?.name || null,
    searchTitles: cinemeta?.searchTitles || [],
  };
}

module.exports = {
  resolveKitsuAnime,
  resolveCinemeta,
  parseMediaIdentifier,
};

