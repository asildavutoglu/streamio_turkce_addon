const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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

function convertToVtt(filename, buffer) {
  const extension = path.extname(filename).toLowerCase();
  const decoded = decodeSubtitle(buffer);
  if (extension === '.vtt') return normalizeVtt(decoded);
  if (extension === '.srt') return srtToVtt(decoded);
  if (extension === '.ass' || extension === '.ssa') return assToVtt(decoded);
  throw new Error(`Unsupported subtitle format: ${extension}`);
}

/**
 * Extracts episode number from filename
 */
function extractEpisodeNumber(filename) {
  const base = path.basename(filename).toLowerCase();
  const seMatch = base.match(/s\d+e(\d+)/i) || base.match(/\d+x(\d+)/i);
  if (seMatch) return Number.parseInt(seMatch[1], 10);

  const epMatch =
    base.match(/(?:b[oö]l[uü]m|ep|episode|e)[\s._-]*(\d+)/i) ||
    base.match(/[\s_\\-\\[](\d{2,3})(?:[\]._\-\\s]|$)/i) ||
    base.match(/^(\d+)\./i);

  if (epMatch) return Number.parseInt(epMatch[1], 10);
  return null;
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
 * Extracts and converts matching subtitle from in-memory ZIP archive
 */
async function extractSubtitleFromArchive(archiveBuffer, { season = null, episode = null, requireEpisodeMatch = false } = {}) {
  const { entries, cleanup } = await getArchiveEntries(archiveBuffer);

  try {
    if (entries.length === 0) {
      throw new Error('Subtitle archive contains no supported subtitle files (.srt, .vtt, .ass)');
    }

    let ranked = entries
      .map((entry) => ({
        entry,
        episodeMatch: matchesEpisode(entry.path, season, episode),
        priority: EXTENSION_PRIORITY.get(path.extname(entry.path).toLowerCase()) ?? 99,
      }))
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
        ranked = [{
          entry: matchedEntry,
          episodeMatch: true,
          priority: 0,
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
  } finally {
    cleanup();
  }
}

module.exports = {
  decodeSubtitle,
  convertToVtt,
  srtToVtt,
  assToVtt,
  matchesEpisode,
  extractSubtitleFromArchive,
};
