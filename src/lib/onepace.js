const path = require('node:path');
const axios = require('axios');
const mapping = require('../data/onepace-mapping.json');
const { srtToVtt, assToVtt } = require('./archive');
const { TtlCache } = require('./cache');

const vttCache = new TtlCache({ maxEntries: 1000 });
const ONE_PACE_CDN_BASE = 'https://media.githubusercontent.com/media/asildavutoglu/one-pace-tr-addon/master/subs';

const ONE_PACE_PREFIXES = [
  'RO_', 'OR_', 'SY_', 'GA_', 'BA_', 'AR_', 'LO_', 'AL_', 'RE_', 'WH_',
  'KO_', 'LG_', 'DR_', 'DI_', 'LI_', 'JA_', 'SK_', 'SA_', 'AM_', 'IM_',
  'MA_', 'PW_', 'FI_', 'ZO_', 'WC_', 'REV_', 'WA_', 'TB_', 'SAB_', 'RTS_',
  'PH_', 'EN_', 'PEN_', 'WS_', 'LR_', 'COVER_KOBYMEPPO_', 'COVER_SHSS_', 'EH_',
  'CSA_', 'EL_'
];

/**
 * Checks if a given ID matches One Pace formats
 * @param {string} rawId
 * @returns {string|null} - Normalized One Pace videoID if matched
 */
function normalizeOnePaceId(rawId) {
  if (!rawId) return null;
  const cleanId = String(rawId).trim();

  // Direct match in mapping
  if (mapping[cleanId]) return cleanId;

  // Check prefix match
  for (const prefix of ONE_PACE_PREFIXES) {
    if (cleanId.startsWith(prefix)) {
      // Sometimes IDs come as RO_01 instead of RO_1 or vice versa
      const numPart = cleanId.slice(prefix.length);
      const parsedNum = Number.parseInt(numPart, 10);
      if (Number.isInteger(parsedNum)) {
        const alt1 = `${prefix}${parsedNum}`;
        if (mapping[alt1]) return alt1;
        const alt2 = `${prefix}${String(parsedNum).padStart(2, '0')}`;
        if (mapping[alt2]) return alt2;
      }
      return cleanId;
    }
  }

  return null;
}

/**
 * Returns One Pace subtitles for the requested ID
 * @param {string} rawId
 * @param {string} baseUrl
 * @returns {Array}
 */
function getOnePaceSubtitles(rawId, baseUrl) {
  const videoId = normalizeOnePaceId(rawId);
  if (!videoId || !mapping[videoId]) return [];

  const entry = mapping[videoId];
  const subtitles = [];

  // 1. Standard WebVTT (Universal support across PC, TV, Web, iOS, Android)
  subtitles.push({
    id: `onepace-vtt-${videoId}`,
    url: `${baseUrl}/subtitles/onepace/${videoId}.vtt`,
    lang: 'tur',
    format: 'vtt',
    title: 'Türkçe (One Pace - WebVTT)',
  });

  // 2. Styled ASS (For players with libass / MPV support)
  if (entry.ass) {
    subtitles.push({
      id: `onepace-ass-${videoId}`,
      url: `${ONE_PACE_CDN_BASE}/${entry.ass}`,
      lang: 'tur',
      format: 'ass',
      title: 'Türkçe (One Pace - Styled ASS)',
    });
  }

  // 3. Raw SRT
  if (entry.srt) {
    subtitles.push({
      id: `onepace-srt-${videoId}`,
      url: `${ONE_PACE_CDN_BASE}/${entry.srt}`,
      lang: 'tur',
      format: 'srt',
      title: 'Türkçe (One Pace - SRT)',
    });
  }

  return subtitles;
}

/**
 * Downloads and converts One Pace subtitle to WebVTT
 * @param {string} videoId
 * @returns {Promise<string>}
 */
async function getOnePaceVtt(videoId) {
  const cached = vttCache.get(videoId);
  if (cached) return cached;

  const entry = mapping[videoId];
  if (!entry) throw new Error(`One Pace episode ${videoId} not found in mapping`);

  // Download SRT (or fallback to ASS)
  const targetFile = entry.srt || entry.ass;
  const url = `${ONE_PACE_CDN_BASE}/${targetFile}`;

  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
  });

  const rawText = Buffer.from(res.data).toString('utf8');
  let vttBody;

  if (targetFile.endsWith('.ass')) {
    vttBody = assToVtt(rawText);
  } else {
    vttBody = srtToVtt(rawText);
  }

  vttCache.set(videoId, vttBody, 24 * 60 * 60 * 1000); // 24 hours
  return vttBody;
}

module.exports = {
  ONE_PACE_PREFIXES,
  normalizeOnePaceId,
  getOnePaceSubtitles,
  getOnePaceVtt,
};
