const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch {}

let unzipper = null;
try {
  unzipper = require('unzipper');
} catch {}

const SUPPORTED_EXTENSIONS = new Set(['.vtt', '.srt', '.ass', '.ssa']);

function getExtensionPriority(ext, targetFormat = 'vtt') {
  const fmt = (targetFormat || 'vtt').toLowerCase();
  if (fmt === 'ass' || fmt === 'ssa') {
    if (ext === '.ass') return 0;
    if (ext === '.ssa') return 1;
    if (ext === '.srt') return 2;
    if (ext === '.vtt') return 3;
    return 99;
  }
  if (fmt === 'srt') {
    if (ext === '.srt') return 0;
    if (ext === '.vtt') return 1;
    if (ext === '.ass') return 2;
    if (ext === '.ssa') return 3;
    return 99;
  }
  // Default: vtt
  if (ext === '.vtt') return 0;
  if (ext === '.ass') return 1;
  if (ext === '.ssa') return 2;
  if (ext === '.srt') return 3;
  return 99;
}

/**
 * Robust Turkish & Unicode subtitle decoder
 */
function decodeSubtitle(buffer) {
  if (!buffer || buffer.length === 0) return '';

  // Check UTF-16 BOMs
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      if (iconv) return iconv.decode(buffer.subarray(2), 'utf-16le');
      return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      if (iconv) return iconv.decode(buffer.subarray(2), 'utf-16be');
      return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    }
  }

  // Check UTF-8 BOM
  let contentBuffer = buffer;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    contentBuffer = buffer.subarray(3);
  }

  // Try decoding as UTF-8 first
  const utf8String = iconv
    ? iconv.decode(contentBuffer, 'utf-8')
    : new TextDecoder('utf-8', { fatal: false }).decode(contentBuffer);

  // Check if UTF-8 decode produced replacement characters (indicates non-UTF-8 source like Windows-1254)
  if (utf8String.includes('\uFFFD')) {
    // Has invalid UTF-8 bytes -> definitely Windows-1254 or ISO-8859-9
    if (iconv) return iconv.decode(contentBuffer, 'windows-1254');
    try {
      return new TextDecoder('windows-1254').decode(contentBuffer);
    } catch {
      return utf8String;
    }
  }

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

function assTimestampToSeconds(value) {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{2,3})$/);
  if (!match) return null;
  const milliseconds = match[4].length === 2 ? Number(`${match[4]}0`) : Number(match[4]);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + milliseconds / 1000;
}

function secondsToVttTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function cleanAssText(value) {
  return value
    // Remove drawing commands: {\p1}...{\p0} or {\p1}...$
    .replace(/\{[^}]*\\p[1-9][^}]*\}.*?(?:\{[^}]*\\p0[^}]*\}|$)/gi, '')
    // Remove all remaining ASS style tags
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .replace(/\\n/gi, '\n')
    .replace(/\\h/gi, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * Converts ASS/SSA subtitles (very common in anime) to standard WebVTT
 * - Cleans vector drawing commands and style tags
 * - Filters out Aegisub section headers/comments
 * - Sorts all cues chronologically by start time (strictly required by WebVTT spec)
 * - Deduplicates redundant overlapping typesetting cues
 */
function assToVtt(value) {
  const lines = normalizeNewlines(value).split('\n');
  let inEvents = false;
  let format = [];
  const cueList = [];

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

    // Skip Comment lines
    if (!/^dialogue\s*:/i.test(trimmed) || format.length === 0) continue;

    const rawFields = splitAssFields(trimmed.replace(/^dialogue\s*:/i, '').trim(), format.length);
    if (rawFields.length < format.length) continue;

    const startIdx = format.indexOf('start');
    const endIdx = format.indexOf('end');
    const styleIdx = format.indexOf('style');
    const textIdx = format.indexOf('text');

    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

    const style = (rawFields[styleIdx] || '').toLowerCase();
    // Skip Aegisub organizational folder/section styles
    if (style.includes('folder')) continue;

    const startSec = assTimestampToSeconds(rawFields[startIdx] || '');
    const endSec = assTimestampToSeconds(rawFields[endIdx] || '');
    if (startSec === null || endSec === null || endSec <= startSec) continue;

    const rawText = rawFields[textIdx] || '';
    // Skip lines that consist entirely of drawing vector coordinates without tags
    if (/^m\s+-?\d+/i.test(rawText.trim())) continue;

    const cleanedText = cleanAssText(rawText);
    if (!cleanedText) continue;

    // Skip typical comment/folder labels in fansub scripts
    if (/^-\s*(warning|trash|intro cards|white news|fist of guidance|jujutsu tech|vending machine|episode titles)/i.test(cleanedText)) {
      continue;
    }

    cueList.push({
      startSec,
      endSec,
      text: cleanedText,
    });
  }

  // WebVTT specification strictly mandates cues must be sorted in ascending order of start time
  cueList.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  // Deduplicate consecutive identical cues created by shadow/blur layers
  const deduped = [];
  const seenSet = new Set();
  for (const cue of cueList) {
    const key = `${cue.startSec.toFixed(2)}_${cue.endSec.toFixed(2)}_${cue.text}`;
    if (!seenSet.has(key)) {
      seenSet.add(key);
      deduped.push(cue);
    }
  }

  if (deduped.length === 0) {
    throw new Error('The selected ASS file has no readable dialogue events');
  }

  const vttCues = deduped.map((c) => {
    return `${secondsToVttTimestamp(c.startSec)} --> ${secondsToVttTimestamp(c.endSec)}\n${c.text}`;
  });

  return `WEBVTT\n\n${vttCues.join('\n\n')}\n`;
}

function secondsToSrtTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function secondsToAssTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor(Math.round((sec - Math.floor(sec)) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function srtTimestampToSeconds(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

/**
 * Converts ASS/SSA subtitles to standard SubRip (SRT) format
 */
function assToSrt(value) {
  const lines = normalizeNewlines(value).split('\n');
  let inEvents = false;
  let format = [];
  const cueList = [];

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
    if (rawFields.length < format.length) continue;

    const startIdx = format.indexOf('start');
    const endIdx = format.indexOf('end');
    const styleIdx = format.indexOf('style');
    const textIdx = format.indexOf('text');

    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

    const style = (rawFields[styleIdx] || '').toLowerCase();
    if (style.includes('folder')) continue;

    const startSec = assTimestampToSeconds(rawFields[startIdx] || '');
    const endSec = assTimestampToSeconds(rawFields[endIdx] || '');
    if (startSec === null || endSec === null || endSec <= startSec) continue;

    const rawText = rawFields[textIdx] || '';
    if (/^m\s+-?\d+/i.test(rawText.trim())) continue;

    const cleanedText = cleanAssText(rawText);
    if (!cleanedText) continue;

    if (/^-\s*(warning|trash|intro cards|white news|fist of guidance|jujutsu tech|vending machine|episode titles)/i.test(cleanedText)) {
      continue;
    }

    cueList.push({ startSec, endSec, text: cleanedText });
  }

  cueList.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const deduped = [];
  const seenSet = new Set();
  for (const cue of cueList) {
    const key = `${cue.startSec.toFixed(2)}_${cue.endSec.toFixed(2)}_${cue.text}`;
    if (!seenSet.has(key)) {
      seenSet.add(key);
      deduped.push(cue);
    }
  }

  if (deduped.length === 0) {
    throw new Error('The selected ASS file has no readable dialogue events');
  }

  const srtCues = deduped.map((c, idx) => {
    return `${idx + 1}\n${secondsToSrtTimestamp(c.startSec)} --> ${secondsToSrtTimestamp(c.endSec)}\n${c.text}`;
  });

  return `${srtCues.join('\n\n')}\n`;
}

/**
 * Converts SubRip (SRT) format to standard ASS format
 */
function srtToAss(value) {
  const normalized = normalizeNewlines(value);
  const blocks = normalized.split(/\n\s*\n/);

  const header = `[Script Info]
Title: Converted Subtitle
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogueLines = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(lines[i])) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const timeMatch = lines[timeLineIdx].match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!timeMatch) continue;

    const startSec = srtTimestampToSeconds(timeMatch[1]);
    const endSec = srtTimestampToSeconds(timeMatch[2]);
    if (startSec === null || endSec === null || endSec <= startSec) continue;

    const textLines = lines.slice(timeLineIdx + 1).map((l) => l.trim()).filter(Boolean);
    if (textLines.length === 0) continue;

    const assText = textLines.join('\\N');
    dialogueLines.push(`Dialogue: 0,${secondsToAssTimestamp(startSec)},${secondsToAssTimestamp(endSec)},Default,,0,0,0,,${assText}`);
  }

  if (dialogueLines.length === 0) {
    return `${header}\n`;
  }

  return `${header}\n${dialogueLines.join('\n')}\n`;
}

function vttToAss(value) {
  const withoutHeader = normalizeNewlines(value).replace(/^WEBVTT[^\n]*\n*/i, '');
  return srtToAss(withoutHeader);
}

function vttToSrt(value) {
  const withoutHeader = normalizeNewlines(value).replace(/^WEBVTT[^\n]*\n*/i, '');
  const blocks = withoutHeader.split(/\n\s*\n/);
  const srtBlocks = [];
  let index = 1;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(lines[i])) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const convertedTime = lines[timeLineIdx].replace(
      /(\d{1,2}:\d{2}:\d{2})\.(\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2})\.(\d{3})/,
      '$1,$2 --> $3,$4'
    );
    const textLines = lines.slice(timeLineIdx + 1).join('\n');
    srtBlocks.push(`${index}\n${convertedTime}\n${textLines}`);
    index += 1;
  }

  return `${srtBlocks.join('\n\n')}\n`;
}

/**
 * Returns ASS subtitle representation
 * - If source is ASS/SSA: preserves 100% of original fansub styling, fonts, karaoke, and effects!
 * - If source is SRT/VTT: converts cleanly to valid ASS structure.
 */
function convertToAss(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  const decoded = decodeSubtitle(buffer);
  if (extension === '.ass' || extension === '.ssa') {
    return decoded;
  }
  if (extension === '.srt') return srtToAss(decoded);
  if (extension === '.vtt') return vttToAss(decoded);
  throw new Error(`Unsupported subtitle format for ASS: ${extension}`);
}

/**
 * Returns SRT subtitle representation
 */
function convertToSrt(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  const decoded = decodeSubtitle(buffer);
  if (extension === '.srt') return decoded;
  if (extension === '.vtt') return vttToSrt(decoded);
  if (extension === '.ass' || extension === '.ssa') return assToSrt(decoded);
  throw new Error(`Unsupported subtitle format for SRT: ${extension}`);
}

function formatSubtitle(filename, buffer, targetFormat = 'vtt') {
  const fmt = (targetFormat || 'vtt').toLowerCase();
  if (fmt === 'ass' || fmt === 'ssa') {
    return convertToAss(filename, buffer);
  }
  if (fmt === 'srt') {
    return convertToSrt(filename, buffer);
  }
  return convertToVtt(filename, buffer);
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
 * Strips metadata, resolutions, codecs, CRC32 checksums, and group tags to isolate episode text
 */
function cleanFilenameForEpisode(filename) {
  let name = path.basename(filename);
  name = name.replace(/\.[a-z0-9]+$/i, '');
  // Remove CRC32 / 8-char hex checksums: [174E215D], [B09B33D3], [2F8ED645], etc.
  name = name.replace(/[[({][0-9a-fA-F]{8}[\])}]/g, ' ');
  // Remove resolution & video specs
  name = name.replace(/\b(?:2160p|1080p|720p|480p|576p|4k)\b/gi, ' ');
  name = name.replace(/\b(?:x264|x265|h264|h265|hevc|avc|av1|10bit|8bit)\b/gi, ' ');
  name = name.replace(/\b(?:bluray|bd|web-?dl|webrip|dvdrip|hdtv|remux|tvrip)\b/gi, ' ');
  name = name.replace(/\b(?:aac|flac|ddp|ac3|dts|mp3|dual-audio)(?:[._-]?\d(?:\.\d)?)?\b/gi, ' ');
  // Remove group tags in brackets at start: [Kaizoku], [SubsPlease], etc.
  name = name.replace(/^\[[^\]]+\]\s*/i, ' ');
  name = name.replace(/[([{\]})]/g, ' ');
  return name.trim();
}

/**
 * Extracts episode number from filename
 */
function extractEpisodeNumber(filename) {
  const clean = cleanFilenameForEpisode(filename);

  // 1. S01E05 or 1x05
  const seMatch = clean.match(/s\d+[._\s-]*e(\d+)\b/i) || clean.match(/\b\d+x(\d+)\b/i);
  if (seMatch) return Number.parseInt(seMatch[1], 10);

  // 2. Explicit episode keywords: "ep 05", "episode 05", "bolum 05"
  const epWordMatch = clean.match(/\b(?:b[oö]l[uü]m|ep|episode)\b[\s._-]*(\d+)\b/i);
  if (epWordMatch) return Number.parseInt(epWordMatch[1], 10);

  // 3. Anime dash pattern: " - 33" or " - 05"
  const dashMatch = clean.match(/(?:^|\s)-\s*(\d+)\b/);
  if (dashMatch) return Number.parseInt(dashMatch[1], 10);

  // 4. Standalone number at start (e.g. "09" or "09 - Title")
  const startNumMatch = clean.match(/^(\d+)\b/);
  if (startNumMatch) return Number.parseInt(startNumMatch[1], 10);

  // 5. Standalone number separated by spaces or punctuation
  const standaloneMatch = clean.match(/(?:^|[\s._-])(\d{1,4})(?:[\s._-]|$)/);
  if (standaloneMatch) return Number.parseInt(standaloneMatch[1], 10);

  return null;
}

/**
 * Matches a filename against season and episode, supporting anime numbering
 */
function matchesEpisode(filename, season, episode) {
  if (episode === null || episode === undefined) return true; // Movie or no episode requested
  const clean = cleanFilenameForEpisode(filename);
  const ep = Number(episode);
  const s = season !== null && season !== undefined ? Number(season) : null;

  // 1. If season is explicitly present in filename (e.g. S02E09 or 2x09)
  const seMatch = clean.match(/s(\d+)[._\s-]*e(\d+)\b/i) || clean.match(/\b(\d+)x(\d+)\b/i);
  if (seMatch) {
    const fileSeason = Number.parseInt(seMatch[1], 10);
    const fileEpisode = Number.parseInt(seMatch[2], 10);
    if (s !== null) {
      return fileSeason === s && fileEpisode === ep;
    }
    return fileEpisode === ep;
  }

  // If filename has a DIFFERENT season marker (e.g. S01 when S02 was requested), reject it!
  if (s !== null) {
    const fileOnlySeasonMatch = clean.match(/\bs(\d+)\b/i);
    if (fileOnlySeasonMatch && Number.parseInt(fileOnlySeasonMatch[1], 10) !== s) {
      return false;
    }
  }

  // 2. Direct episode number match from clean filename
  const extractedEp = extractEpisodeNumber(filename);
  if (extractedEp !== null && extractedEp === ep) {
    return true;
  }

  return false;
}

/**
 * Shifts subtitle timestamps by offsetMs milliseconds for WebVTT, SRT, or ASS
 */
function shiftSubtitleTimestamps(content, offsetMs, format = 'vtt') {
  if (!offsetMs || offsetMs === 0 || !content) return content;
  const offsetSec = offsetMs / 1000;

  function toTimestampVtt(sec) {
    const clamped = Math.max(0, sec);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function toTimestampSrt(sec) {
    const clamped = Math.max(0, sec);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function toTimestampAss(sec) {
    const clamped = Math.max(0, sec);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const cs = Math.floor(Math.round((clamped - Math.floor(clamped)) * 100));
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  function parseVttSec(h, m, s, ms) {
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  }

  const fmt = (format || 'vtt').toLowerCase();

  if (fmt === 'ass' || fmt === 'ssa') {
    return content.replace(
      /^(Dialogue:\s*[^,]+,)(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2})(,.*)$/gm,
      (_, prefix, start, end, suffix) => {
        const parseAssSec = (t) => {
          const p = t.split(':');
          const sp = p[2].split('.');
          return Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(sp[0]) + Number(sp[1]) / 100;
        };
        const sSec = parseAssSec(start) + offsetSec;
        const eSec = parseAssSec(end) + offsetSec;
        return `${prefix}${toTimestampAss(sSec)},${toTimestampAss(eSec)}${suffix}`;
      }
    );
  }

  if (fmt === 'srt') {
    return content.replace(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/g,
      (_, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
        const sSec = parseVttSec(h1, m1, s1, ms1) + offsetSec;
        const eSec = parseVttSec(h2, m2, s2, ms2) + offsetSec;
        return `${toTimestampSrt(sSec)} --> ${toTimestampSrt(eSec)}`;
      }
    );
  }

  // Default WebVTT
  return content.replace(
    /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g,
    (_, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
      const sSec = parseVttSec(h1, m1, s1, ms1) + offsetSec;
      const eSec = parseVttSec(h2, m2, s2, ms2) + offsetSec;
      return `${toTimestampVtt(sSec)} --> ${toTimestampVtt(eSec)}`;
    }
  );
}

let path7za = null;
try {
  path7za = require('7zip-bin').path7za;
} catch {}

/**
 * Extracts archive using 7za, tar, or unzip as fallback
 * Supports ZIP with LZMA2/XZ Method 95, Deflate64, 7z, etc. on all platforms
 */
function extractWithExternal(archiveBuffer) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-ext-'));
  const zipPath = path.join(tmpDir, 'archive.zip');
  fs.writeFileSync(zipPath, archiveBuffer);
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  try {
    let extracted = false;

    // 1. Try 7za (ensure executable permissions on Unix/Linux)
    if (path7za && fs.existsSync(path7za)) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(path7za, 0o755);
        } catch {}
      }
      try {
        execFileSync(path7za, ['x', zipPath, `-o${extractDir}`, '-y'], {
          windowsHide: true,
          timeout: 15000,
          stdio: 'ignore',
        });
        extracted = true;
      } catch (e7) {
        // Fallback to other tools if 7za fails
      }
    }

    // 2. Fallback to system tar
    if (!extracted) {
      try {
        execFileSync('tar', ['-xf', zipPath, '-C', extractDir], {
          windowsHide: true,
          timeout: 15000,
          stdio: 'ignore',
        });
        extracted = true;
      } catch (etar) {}
    }

    // 3. Fallback to system unzip
    if (!extracted) {
      try {
        execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir], {
          windowsHide: true,
          timeout: 15000,
          stdio: 'ignore',
        });
        extracted = true;
      } catch (eunzip) {}
    }

    if (!extracted) {
      throw new Error('No external extraction tool (7za, tar, unzip) could decompress the archive');
    }

    const entries = [];
    function walk(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(full);
        } else if (item.isFile()) {
          const rel = path.relative(extractDir, full).replace(/\\/g, '/');
          entries.push({
            path: rel,
            buffer: () => Promise.resolve(fs.readFileSync(full)),
          });
        }
      }
    }
    walk(extractDir);
    return {
      entries,
      cleanup: () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      },
    };
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

/**
 * Reads archive entries using in-memory unzipper with automatic fallback to external extractor
 */
async function getArchiveEntries(archiveBuffer) {
  try {
    const directory = await unzipper.Open.buffer(archiveBuffer);
    const entries = directory.files.filter((entry) => {
      const ext = path.extname(entry.path).toLowerCase();
      return entry.type === 'File' && SUPPORTED_EXTENSIONS.has(ext) && !entry.path.includes('__MACOSX');
    });

    // Test decompressing first entry to verify compression algorithm is supported by zlib
    if (entries.length > 0) {
      await entries[0].buffer();
    }
    return { entries, cleanup: () => {} };
  } catch (err) {
    // If unzipper failed (e.g. Method 95 LZMA2 / XZ or corrupted stream), fallback to 7z / tar
    try {
      const { entries, cleanup } = extractWithExternal(archiveBuffer);
      const subEntries = entries.filter((e) => {
        const ext = path.extname(e.path).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext) && !e.path.includes('__MACOSX');
      });
      return { entries: subEntries, cleanup };
    } catch (extErr) {
      throw new Error(`Archive extraction failed: ${err.message}`);
    }
  }
}

/**
 * Extracts and formats matching subtitle from in-memory ZIP archive
 */
async function extractSubtitleFromArchive(
  archiveBuffer,
  { season = null, episode = null, requireEpisodeMatch = false, targetFormat = 'vtt', offsetMs = 0 } = {}
) {
  const { entries, cleanup } = await getArchiveEntries(archiveBuffer);

  try {
    if (entries.length === 0) {
      throw new Error('Subtitle archive contains no supported subtitle files (.srt, .vtt, .ass, .ssa)');
    }

    let ranked = entries
      .map((entry) => {
        const ext = path.extname(entry.path).toLowerCase();
        return {
          entry,
          ext,
          episodeMatch: matchesEpisode(entry.path, season, episode),
          priority: getExtensionPriority(ext, targetFormat),
        };
      })
      .filter((candidate) => !requireEpisodeMatch || candidate.episodeMatch);

    const hasMatch = ranked.some((candidate) => candidate.episodeMatch);

    // If no direct regex match was found in filenames, handle anime absolute numbering and index offsets
    if (!hasMatch && episode !== null && episode !== undefined && episode >= 1) {
      const sortedEntries = [...entries].sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })
      );

      // Check if files use absolute numbering (e.g. JJK S2 has files 25 to 47)
      const extractedNums = sortedEntries.map((e) => extractEpisodeNumber(e.path)).filter((n) => n !== null);
      const minEp = extractedNums.length > 0 ? Math.min(...extractedNums) : 1;

      let matchedEntry = null;

      if (minEp > 1) {
        // Absolute anime offset match: target = minEp + episode - 1
        const targetAbsolute = minEp + (episode - 1);
        matchedEntry = sortedEntries.find((e) => extractEpisodeNumber(e.path) === targetAbsolute);
      }

      // Fallback to sequential position (episode 1 -> index 0)
      if (!matchedEntry && episode <= sortedEntries.length) {
        matchedEntry = sortedEntries[episode - 1];
      }

      if (matchedEntry) {
        const matchedExt = path.extname(matchedEntry.path).toLowerCase();
        ranked = [{
          entry: matchedEntry,
          ext: matchedExt,
          episodeMatch: true,
          priority: getExtensionPriority(matchedExt, targetFormat),
        }];
      }
    }

    ranked.sort((a, b) => {
      if (a.episodeMatch !== b.episodeMatch) return Number(b.episodeMatch) - Number(a.episodeMatch);
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.entry.path.localeCompare(b.entry.path, undefined, { numeric: true });
    });

    if (ranked.length === 0) {
      throw new Error(`Requested S${season || 1}E${episode} was not found in the subtitle archive`);
    }

    let lastError = null;
    for (const item of ranked) {
      try {
        const buffer = await item.entry.buffer();
        let body = formatSubtitle(item.entry.path, buffer, targetFormat);
        if (offsetMs) {
          body = shiftSubtitleTimestamps(body, offsetMs, targetFormat);
        }
        return {
          body,
          format: targetFormat,
          sourceName: path.basename(item.entry.path),
          sourceExt: path.extname(item.entry.path).toLowerCase(),
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Failed to extract or convert subtitle to ${targetFormat.toUpperCase()}`);
  } finally {
    cleanup();
  }
}

module.exports = {
  decodeSubtitle,
  convertToVtt,
  convertToAss,
  convertToSrt,
  formatSubtitle,
  srtToVtt,
  assToVtt,
  assToSrt,
  srtToAss,
  vttToAss,
  vttToSrt,
  cleanFilenameForEpisode,
  extractEpisodeNumber,
  matchesEpisode,
  extractSubtitleFromArchive,
  shiftSubtitleTimestamps,
  getExtensionPriority,
};
