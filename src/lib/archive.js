const path = require('node:path');
const iconv = require('iconv-lite');
const unzipper = require('unzipper');

const SUPPORTED_EXTENSIONS = new Set(['.vtt', '.srt', '.ass', '.ssa']);
const EXTENSION_PRIORITY = new Map([
  ['.vtt', 0],
  ['.srt', 1],
  ['.ass', 2],
  ['.ssa', 3],
]);

/**
 * Robust Turkish & Unicode subtitle decoder
 */
function decodeSubtitle(buffer) {
  if (!buffer || buffer.length === 0) return '';

  // Check UTF-16 BOMs
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return iconv.decode(buffer.subarray(2), 'utf-16le');
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return iconv.decode(buffer.subarray(2), 'utf-16be');
    }
  }

  // Check UTF-8 BOM
  let contentBuffer = buffer;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    contentBuffer = buffer.subarray(3);
  }

  // Try decoding as UTF-8 first
  const utf8String = iconv.decode(contentBuffer, 'utf-8');

  // Check if UTF-8 decode produced replacement characters (indicates non-UTF-8 source like Windows-1254)
  if (utf8String.includes('\uFFFD')) {
    // Has invalid UTF-8 bytes -> definitely Windows-1254 or ISO-8859-9
    return iconv.decode(contentBuffer, 'windows-1254');
  }

  // Check for common Turkish mojibake in improperly read Windows-1254 (e.g. Ã§ for ç, Ä± for ı, Ã¼ for ü)
  // If UTF-8 looks clean and normal, return it
  return utf8String;
}

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

/**
 * Converts SubRip (SRT) format to WebVTT format
 */
function srtToVtt(value) {
  const normalized = normalizeNewlines(value);
  if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(normalized)) {
    // If cues are missing or malformed, try to salvage
    return `WEBVTT\n\n${normalized}\n`;
  }

  // Replace timestamps comma with period: 00:01:23,456 --> 00:01:25,789 => 00:01:23.456 --> 00:01:25.789
  const cues = normalized.replace(
    /(\d{1,2}:\d{2}:\d{2})[,.](\d{3})(\s+-->\s+\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g,
    '$1.$2$3.$4',
  );
  return `WEBVTT\n\n${cues}\n`;
}

/**
 * Normalizes existing WebVTT
 */
function normalizeVtt(value) {
  const normalized = normalizeNewlines(value);
  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n*/i, '');
  return `WEBVTT\n\n${withoutHeader}\n`;
}

function splitAssFields(value, fieldCount) {
  const fields = [];
  let remainder = value;
  for (let index = 0; index < fieldCount - 1; index += 1) {
    const comma = remainder.indexOf(',');
    if (comma === -1) return [];
    fields.push(remainder.slice(0, comma));
    remainder = remainder.slice(comma + 1);
  }
  fields.push(remainder);
  return fields;
}

function assTimestampToVtt(value) {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{2,3})$/);
  if (!match) return null;
  const milliseconds = match[4].length === 2 ? `${match[4]}0` : match[4];
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${milliseconds}`;
}

function cleanAssText(value) {
  return value
    .replace(/\{[^}]*\}/g, '')       // Strip ASS style overrides like {\an8}, {\pos(x,y)}, {\c&H...}
    .replace(/\\N/gi, '\n')          // Hard line break
    .replace(/\\n/gi, '\n')          // Soft line break
    .replace(/\\h/gi, ' ')           // Hard space
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * Converts ASS/SSA subtitles (very common in anime) to standard WebVTT
 */
function assToVtt(value) {
  const lines = normalizeNewlines(value).split('\n');
  let inEvents = false;
  let format = [];
  const cues = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[events\]$/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (inEvents && /^\[/.test(trimmed)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (/^format\s*:/i.test(trimmed)) {
      format = trimmed
        .replace(/^format\s*:/i, '')
        .split(',')
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(trimmed) || format.length === 0) continue;

    const rawFields = splitAssFields(trimmed.replace(/^dialogue\s*:/i, '').trim(), format.length);
    const startIdx = format.indexOf('start');
    const endIdx = format.indexOf('end');
    const textIdx = format.indexOf('text');

    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

    const start = assTimestampToVtt(rawFields[startIdx] || '');
    const end = assTimestampToVtt(rawFields[endIdx] || '');
    const text = cleanAssText(rawFields[textIdx] || '');

    if (start && end && text) {
      cues.push(`${start} --> ${end}\n${text}`);
    }
  }

  if (cues.length === 0) {
    throw new Error('The selected ASS file has no readable dialogue events');
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function convertToVtt(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  const decoded = decodeSubtitle(buffer);
  if (extension === '.vtt') return normalizeVtt(decoded);
  if (extension === '.srt') return srtToVtt(decoded);
  if (extension === '.ass' || extension === '.ssa') return assToVtt(decoded);
  throw new Error(`Unsupported subtitle format: ${extension}`);
}

/**
 * Matches a filename against season and episode, supporting anime numbering
 */
function matchesEpisode(filename, season, episode) {
  if (episode === null || episode === undefined) return true; // Movie or no episode requested
  const value = path.basename(filename).toLowerCase();
  const ep = Number(episode);
  const s = season !== null && season !== undefined ? Number(season) : null;

  const epStr = String(ep);
  const ep2Str = epStr.padStart(2, '0');
  const ep3Str = epStr.padStart(3, '0');

  // Standard season + episode patterns (e.g. S01E05, 1x05, Season 1 Episode 5)
  if (s !== null) {
    const sStr = String(s);
    const s2Str = sStr.padStart(2, '0');
    const standardPatterns = [
      new RegExp(`(?:^|[^a-z0-9])s0?${sStr}[^a-z0-9]*e0?${epStr}(?:[^0-9]|$)`, 'i'),
      new RegExp(`(?:^|[^0-9])0?${sStr}x0?${epStr}(?:[^0-9]|$)`, 'i'),
      new RegExp(`season[^0-9]*0?${sStr}[^a-z0-9]+episode[^0-9]*0?${epStr}(?:[^0-9]|$)`, 'i'),
      new RegExp(`s${s2Str}e${ep2Str}`, 'i'),
    ];
    if (standardPatterns.some((pattern) => pattern.test(value))) return true;
  }

  // Anime / Absolute episode patterns:
  // e.g. "Death Note - 05.srt", "Anime_05.ass", "[Group] Title - 05 [1080p].srt", "Bolum 5", "Episode 05"
  const animePatterns = [
    new RegExp(`(?:b[oö]l[uü]m|ep|episode|e)[^0-9a-z]*0?${epStr}(?:[^0-9a-z]|$)`, 'i'),
    new RegExp(`[\\s_\\-\\[]${ep2Str}(?:\\.[a-z0-9]+|[\\]_\\-\\s])`, 'i'),
    new RegExp(`[\\s_\\-\\[]${ep3Str}(?:\\.[a-z0-9]+|[\\]_\\-\\s])`, 'i'),
    new RegExp(`^0?${epStr}\\.[a-z0-9]+$`, 'i'),
    new RegExp(`(?:^|[^0-9])${ep2Str}(?:[^0-9]|$)`, 'i'),
  ];

  return animePatterns.some((pattern) => pattern.test(value));
}

/**
 * Extracts and converts matching subtitle from in-memory ZIP archive
 */
async function extractSubtitleFromArchive(archiveBuffer, { season = null, episode = null, requireEpisodeMatch = false } = {}) {
  const directory = await unzipper.Open.buffer(archiveBuffer);

  const entries = directory.files.filter((entry) => {
    const ext = path.extname(entry.path).toLowerCase();
    return entry.type === 'File' && SUPPORTED_EXTENSIONS.has(ext) && !entry.path.includes('__MACOSX');
  });

  if (entries.length === 0) {
    throw new Error('Subtitle archive contains no supported subtitle files (.srt, .vtt, .ass)');
  }

  const ranked = entries
    .map((entry) => ({
      entry,
      episodeMatch: matchesEpisode(entry.path, season, episode),
      priority: EXTENSION_PRIORITY.get(path.extname(entry.path).toLowerCase()) ?? 99,
    }))
    .filter((candidate) => !requireEpisodeMatch || candidate.episodeMatch)
    .sort((a, b) => {
      if (a.episodeMatch !== b.episodeMatch) return Number(b.episodeMatch) - Number(a.episodeMatch);
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.entry.path.localeCompare(b.entry.path);
    });

  if (ranked.length === 0) {
    throw new Error(`Requested S${season || 1}E${episode} was not found in the subtitle archive`);
  }

  let lastError = null;
  for (const item of ranked) {
    try {
      const buffer = await item.entry.buffer();
      const vttBody = convertToVtt(item.entry.path, buffer);
      return {
        body: vttBody,
        sourceName: path.basename(item.entry.path),
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to convert any subtitle in archive to WebVTT');
}

module.exports = {
  decodeSubtitle,
  convertToVtt,
  srtToVtt,
  assToVtt,
  matchesEpisode,
  extractSubtitleFromArchive,
};
