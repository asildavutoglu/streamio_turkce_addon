const axios = require('axios');
const config = require('../config');
const { srtToVtt, normalizeVtt, decodeSubtitle } = require('./archive');

const OFFICIAL_BASE_URL = config.openSubtitles.baseUrl;
const STREMIO_OS_BASE_URL = 'https://opensubtitles-v3.strem.io';

/**
 * Searches subtitles via Stremio's free OpenSubtitles v3 proxy (requires NO API key)
 */
async function searchStremioOpenSubtitles({ imdbId, type, season, episode }) {
  if (!imdbId) return [];
  const cleanId = String(imdbId).startsWith('tt') ? imdbId : `tt${imdbId}`;
  const isSeries = type === 'series' || season !== null || episode !== null;
  const stremioType = isSeries ? 'series' : 'movie';
  const stremioId = isSeries ? `${cleanId}:${season || 1}:${episode || 1}` : cleanId;

  try {
    const res = await axios.get(`${STREMIO_OS_BASE_URL}/subtitles/${stremioType}/${stremioId}.json`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      timeout: 7000,
    });

    const subtitles = res.data?.subtitles || [];
    return subtitles
      .filter((item) => item.lang === 'tur')
      .map((item) => {
        const release = item.subtitleFileName || item.movieReleaseName || 'Türkçe Altyazı';
        return {
          source: 'opensubtitles_v3',
          fileId: String(item.id),
          subUrl: item.url,
          subFormat: item.url.endsWith('.vtt') ? 'vtt' : 'srt',
          description: release,
          uploader: item.releaseGroup || '',
          downloadCount: 0,
          ratings: 0,
        };
      });
  } catch (err) {
    console.error('[OpenSubtitles-v3] Proxy search error:', err.message);
    return [];
  }
}

/**
 * Searches subtitles on OpenSubtitles.com official API v3
 */
async function searchOfficialOpenSubtitles({ imdbId, query, type, season, episode, apiKey }) {
  const queryParams = {
    languages: 'tr',
    order_by: 'download_count',
    order_direction: 'desc',
  };

  if (imdbId) {
    const cleanId = String(imdbId).replace(/^tt/, '');
    queryParams.imdb_id = cleanId;
  } else if (query) {
    queryParams.query = query;
  } else {
    return [];
  }

  if (type === 'series' || season !== null || episode !== null) {
    queryParams.type = 'episode';
    if (season !== null && season !== undefined) queryParams.season_number = Number(season);
    if (episode !== null && episode !== undefined) queryParams.episode_number = Number(episode);
  } else if (type === 'movie') {
    queryParams.type = 'movie';
  }

  try {
    const res = await axios.get(`${OFFICIAL_BASE_URL}/subtitles`, {
      params: queryParams,
      headers: {
        'Api-Key': apiKey,
        'User-Agent': config.openSubtitles.userAgent,
        Accept: 'application/json',
      },
      timeout: config.openSubtitles.timeoutMs,
    });

    if (!res.data || !Array.isArray(res.data.data)) {
      return [];
    }

    return res.data.data.map((item) => {
      const attrs = item.attributes || {};
      const file = attrs.files && attrs.files[0];
      if (!file) return null;

      const release = attrs.release || attrs.feature_details?.movie_name || 'Türkçe Altyazı';
      const hearingImpaired = attrs.hearing_impaired ? ' [HI]' : '';
      const fps = attrs.fps ? ` (${attrs.fps} FPS)` : '';

      return {
        source: 'opensubtitles',
        fileId: file.file_id,
        subFormat: attrs.format || 'srt',
        description: `${release}${fps}${hearingImpaired}`,
        uploader: attrs.uploader?.name || '',
        downloadCount: attrs.download_count || 0,
        ratings: attrs.ratings || 0,
      };
    }).filter(Boolean);
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      console.warn('[OpenSubtitles] Invalid or missing API key.');
    } else {
      console.error('[OpenSubtitles] Official API search failed:', err.message);
    }
    return [];
  }
}

/**
 * Main search function: checks official API first if key provided, and falls back to Stremio OpenSubtitles v3 proxy
 */
async function searchOpenSubtitles({ imdbId, query, type, season, episode, apiKey = config.openSubtitles.apiKey }) {
  if (apiKey) {
    const officialResults = await searchOfficialOpenSubtitles({ imdbId, query, type, season, episode, apiKey });
    if (officialResults.length > 0) return officialResults;
  }

  // Fallback to Stremio's free OpenSubtitles v3 service (works for all movies & series with no key required)
  return searchStremioOpenSubtitles({ imdbId, type, season, episode });
}

/**
 * Downloads a subtitle from OpenSubtitles.com by file_id
 */
async function downloadOpenSubtitle(fileId, apiKey = config.openSubtitles.apiKey) {
  if (!apiKey) {
    throw new Error('OpenSubtitles API key is required to download subtitles');
  }

  const res = await axios.post(
    `${OFFICIAL_BASE_URL}/download`,
    { file_id: Number(fileId) },
    {
      headers: {
        'Api-Key': apiKey,
        'User-Agent': config.openSubtitles.userAgent,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: config.openSubtitles.timeoutMs,
    },
  );

  const downloadLink = res.data?.link;
  if (!downloadLink) {
    throw new Error('OpenSubtitles did not return a download link');
  }

  const subFileRes = await axios.get(downloadLink, {
    responseType: 'arraybuffer',
    timeout: 10000,
  });

  const decoded = decodeSubtitle(Buffer.from(subFileRes.data));
  if (decoded.trim().startsWith('WEBVTT')) {
    return normalizeVtt(decoded);
  }
  return srtToVtt(decoded);
}

/**
 * Downloads and converts subtitle from Stremio OpenSubtitles CDN
 */
async function downloadStremioOpenSubtitle(subUrl) {
  const res = await axios.get(subUrl, {
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  });

  const decoded = decodeSubtitle(Buffer.from(res.data));
  if (decoded.trim().startsWith('WEBVTT')) {
    return normalizeVtt(decoded);
  }
  return srtToVtt(decoded);
}

module.exports = {
  searchOpenSubtitles,
  downloadOpenSubtitle,
  downloadStremioOpenSubtitle,
};
