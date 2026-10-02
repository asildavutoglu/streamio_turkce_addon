const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const BASE_URL = config.turkceAltyazi.baseUrl;

const clientConfig = {
  baseURL: BASE_URL,
  timeout: config.turkceAltyazi.timeoutMs,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr,en-US;q=0.9,en;q=0.8',
  },
};

if (config.proxyUrl) {
  try {
    const url = new URL(config.proxyUrl);
    clientConfig.proxy = {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      auth: url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : undefined,
    };
  } catch (err) {
    console.warn('[TurkceAltyazi] Invalid PROXY_URL, ignoring proxy:', err.message);
  }
}

const client = axios.create(clientConfig);

function toAbsoluteUrl(relUrl) {
  if (!relUrl) return null;
  if (relUrl.startsWith('http://') || relUrl.startsWith('https://')) return relUrl;
  return new URL(relUrl, BASE_URL).toString();
}

/**
 * Searches TurkceAltyazi by IMDb ID or Title text
 * @param {string} term - IMDb ID (e.g. "tt0944947" or "0944947") or Title (e.g. "Game of Thrones", "Attack on Titan")
 */
async function findTitlePages(term) {
  if (!term) return [];
  const cleanTerm = term.startsWith('tt') ? term.slice(2) : term;

  try {
    const res = await client.get('/things_.php', {
      params: { t: 99, term: cleanTerm },
    });

    if (!Array.isArray(res.data)) return [];

    return res.data.map((item) => ({
      title: item.isim || item.label || '',
      aka: item.aka || '',
      turkishTitle: item.turkce || '',
      year: item.yil || item.year || '',
      imdbId: item.imdbid ? `tt${item.imdbid}` : null,
      pageUrl: toAbsoluteUrl(item.url),
    })).filter((item) => item.pageUrl);
  } catch (err) {
    console.error('[TurkceAltyazi] Error searching title page:', err.message);
    return [];
  }
}

/**
 * Parses series markers like season, episode, or pack
 */
function parseSeriesMarker(row, $) {
  const markerTexts = row
    .find('.alcd b')
    .map((_, el) => $(el).text().trim())
    .get();

  const season = Number.parseInt(markerTexts[0], 10);
  const isPackage = markerTexts.some((text) => text.toLocaleLowerCase('tr-TR') === 'paket');
  const episode = isPackage ? null : Number.parseInt(markerTexts.at(-1), 10);

  return {
    season: Number.isInteger(season) ? season : null,
    episode: Number.isInteger(episode) ? episode : null,
    isPackage,
  };
}

/**
 * Scrapes subtitle candidate rows from a movie/series page
 */
async function listCandidates(pageUrl, { type = 'movie', season = null, episode = null } = {}) {
  try {
    const res = await client.get(pageUrl);
    const $ = cheerio.load(res.data);
    const candidates = [];
    const seen = new Set();

    $('.altyazi-list-wrapper > div > div').each((_, element) => {
      const row = $(element);
      const subLink = row.find('.alisim .fl a[href^="/sub/"]').first().attr('href');
      const isTurkish = row.find('.aldil span.flagtr').length > 0;

      if (!subLink || !isTurkish) return;

      const subPageUrl = toAbsoluteUrl(subLink);
      if (seen.has(subPageUrl)) return;

      const rip = row.find('.rip-div-b').text().trim() || row.find('.alisim').text().trim();
      const translator = row.find('.alcevirmen a').text().trim() || '';

      let marker = { season: null, episode: null, isPackage: false };

      if (type === 'movie') {
        const discCount = Number.parseInt(row.find('.alcd').text().trim(), 10);
        if (discCount && discCount > 1) {
          // Multiple CD rip - skip or keep
        }
      } else {
        marker = parseSeriesMarker(row, $);

        // Filter by requested season
        if (season !== null && marker.season !== null && marker.season !== Number(season)) {
          return;
        }

        // Filter by requested episode (unless it's a season pack)
        if (
          episode !== null &&
          !marker.isPackage &&
          marker.episode !== null &&
          marker.episode !== Number(episode)
        ) {
          return;
        }
      }

      seen.add(subPageUrl);
      candidates.push({
        subPageUrl,
        rip,
        translator,
        season: marker.season,
        episode: marker.episode,
        isPackage: marker.isPackage,
      });
    });

    // Prioritize individual episode matches, then full packs
    return candidates.sort((a, b) => Number(a.isPackage) - Number(b.isPackage));
  } catch (err) {
    console.error(`[TurkceAltyazi] Error listing candidates from ${pageUrl}:`, err.message);
    return [];
  }
}

/**
 * Scrapes download form tokens from the subtitle detail page
 */
async function getDownloadInfo(subPageUrl) {
  const res = await client.get(subPageUrl);
  const $ = cheerio.load(res.data);
  const form = $('form[action="/ind"]').first();

  if (!form.length) {
    throw new Error('Subtitle download form was not found on page');
  }

  const idid = form.find('input[name="idid"]').val();
  const altid = form.find('input[name="altid"]').val();
  const sidid = form.find('input[name="sidid"]').val();

  if (!idid || !altid || !sidid) {
    throw new Error('Missing download token parameters in form');
  }

  return {
    idid,
    altid,
    sidid,
    referer: subPageUrl,
  };
}

/**
 * Downloads the ZIP archive from /ind
 */
async function downloadArchive({ idid, altid, sidid, referer }) {
  const form = new URLSearchParams({
    idid: String(idid),
    altid: String(altid),
    sidid: String(sidid),
  });

  const res = await client.post('/ind', form.toString(), {
    responseType: 'arraybuffer',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: referer,
      Accept: 'application/zip,application/octet-stream;q=0.9,*/*;q=0.8',
    },
  });

  const archive = Buffer.from(res.data);
  const isZip = archive.length >= 4 && archive[0] === 0x50 && archive[1] === 0x4b;
  if (!isZip) {
    throw new Error('Upstream did not return a valid ZIP archive');
  }

  return archive;
}

module.exports = {
  findTitlePages,
  listCandidates,
  getDownloadInfo,
  downloadArchive,
};
