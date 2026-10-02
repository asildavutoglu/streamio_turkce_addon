const axios = require('axios');
const config = require('../config');
const { srtToVtt, normalizeVtt } = require('./archive');

const BASE_URL = config.openSubtitles.baseUrl;

/**
 * Searches subtitles on OpenSubtitles.com API v3
 * @param {object} params
 * @param {string} [params.imdbId] - e.g. "tt1375666" or "1375666"
 * @param {string} [params.query] - Movie or anime title
 * @param {string} [params.type] - "movie" or "episode"
 * @param {number} [params.season]
 * @param {number} [params.episode]
 * @param {string} [params.apiKey]
 */
async function searchOpenSubtitles({ imdbId, query, type, season, episode, apiKey = config.openSubtitles.apiKey }) {
  if (!apiKey) {
    // OpenSubtitles v3 requires an API Consumer key
    return [];
  }

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
    const res = await axios.get(`${BASE_URL}/subtitles`, {
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
      console.error('[OpenSubtitles] Search failed:', err.message);
    }
    return [];
  }
}

/**
 * Downloads a subtitle from OpenSubtitles.com by file_id
 */
async function downloadOpenSubtitle(fileId, apiKey = config.openSubtitles.apiKey) {
  if (!apiKey) {
    throw new Error('OpenSubtitles API key is required to download subtitles');
  }

  const res = await axios.post(
    `${BASE_URL}/download`,
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

  // Fetch the subtitle file itself
  const subFileRes = await axios.get(downloadLink, {
    responseType: 'arraybuffer',
    timeout: 10000,
  });

  const rawBuffer = Buffer.from(subFileRes.data);
  const text = rawBuffer.toString('utf8');

  // Convert to WebVTT
  if (text.trim().startsWith('WEBVTT')) {
    return normalizeVtt(text);
  }
  return srtToVtt(text);
}

module.exports = {
  searchOpenSubtitles,
  downloadOpenSubtitle,
};
