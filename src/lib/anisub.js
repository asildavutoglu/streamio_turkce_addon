const axios = require('axios');
const cheerio = require('cheerio');
const { TtlCache } = require('./cache');
const { encodeToken } = require('./token');

const cache = new TtlCache({ maxEntries: 500 });
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const client = axios.create({
  baseURL: 'https://anisub.co',
  timeout: 10000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/html',
  },
});

/**
 * Searches anisub.co for an anime by title
 */
async function searchAnisub(title) {
  if (!title) return [];
  const clean = title.replace(/[^\w\s]/gi, ' ').trim();
  const cacheKey = `search:${clean.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await client.get('/api/search', {
      params: { q: clean },
    });

    const cleanLower = clean.toLowerCase();
    const results = (res.data?.anime || []).map((item) => ({
      name: item.name,
      slug: item.url,
      details: item.details,
    })).sort((a, b) => {
      const aMatch = a.name.toLowerCase().includes(cleanLower);
      const bMatch = b.name.toLowerCase().includes(cleanLower);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    cache.set(cacheKey, results, 60 * 60 * 1000);
    return results;
  } catch (err) {
    console.error('[AniSub] Search error:', err.message);
    return [];
  }
}

/**
 * Gets subtitle packages from an anime's page on anisub.co
 */
async function getAnimeSubtitles(slug) {
  const cacheKey = `anime:${slug}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await client.get(`/anime/${slug}`);
    const $ = cheerio.load(res.data);
    let subtitles = [];

    $('script').each((_, el) => {
      const text = $(el).text();
      if (text.includes('subtitles') && text.includes('props')) {
        try {
          const parsed = JSON.parse(text);
          const rawSubs = parsed.props?.subtitles || parsed.props?.media?.subtitles || [];
          if (Array.isArray(rawSubs) && rawSubs.length > 0) {
            subtitles = rawSubs.map((s) => ({
              id: s.id || s.subtitle_id,
              name: s.subtitle_file || s.description || 'Anime Altyazı',
              url: s.external_url || s.storage_path,
              format: s.format || 'zip',
              episodes: s.episode_description,
              fps: s.fps,
            })).filter((s) => s.url && s.url.endsWith('.zip'));
          }
        } catch {
          // ignore json parse error
        }
      }
    });

    cache.set(cacheKey, subtitles, 2 * 60 * 60 * 1000);
    return subtitles;
  } catch (err) {
    console.error(`[AniSub] Failed to load anime ${slug}:`, err.message);
    return [];
  }
}

/**
 * Re-orders anime list based on requested season number
 */
function filterAnimeBySeason(animeList, season = 1) {
  if (!animeList || animeList.length === 0) return [];
  const seasonNum = Number(season) || 1;

  if (seasonNum === 1) {
    // For Season 1, prioritize entries without season 2, 3, 4, 2nd, 3rd, final, etc.
    return [...animeList].sort((a, b) => {
      const aIsLater = /(2nd|3rd|4th|\b[2-9](nd|rd|th)?\s*season|season\s*[2-9]|\bii\b|\biii\b|\biv\b)/i.test(a.slug);
      const bIsLater = /(2nd|3rd|4th|\b[2-9](nd|rd|th)?\s*season|season\s*[2-9]|\bii\b|\biii\b|\biv\b)/i.test(b.slug);
      if (!aIsLater && bIsLater) return -1;
      if (aIsLater && !bIsLater) return 1;
      return 0;
    });
  }

  // For Season > 1:
  const ordinals = { 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
  const ord = ordinals[seasonNum] || `${seasonNum}th`;
  const roman = { 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v' }[seasonNum] || '';

  const seasonPatterns = [
    new RegExp(`${ord}-season`, 'i'),
    new RegExp(`season-${seasonNum}`, 'i'),
    new RegExp(`season\\s*${seasonNum}`, 'i'),
    new RegExp(`${ord}\\s*season`, 'i'),
  ];
  if (roman) {
    seasonPatterns.push(new RegExp(`-${roman}$|\\b${roman}\\b`, 'i'));
  }
  if (seasonNum === 4) {
    seasonPatterns.push(/final-season|the-final-season/i);
  }

  return [...animeList].sort((a, b) => {
    const aMatch = seasonPatterns.some((p) => p.test(a.slug) || p.test(a.name));
    const bMatch = seasonPatterns.some((p) => p.test(b.slug) || p.test(b.name));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
}

/**
 * Searches AniSub for subtitles matching anime title and episode
 */
async function findAnimeSubtitles({ titles = [], season = 1, episode = 1 }, baseUrl) {
  const allSubtitles = [];
  const seenUrls = new Set();

  for (const title of titles) {
    if (!title) continue;
    const animeList = await searchAnisub(title);
    const sortedList = filterAnimeBySeason(animeList, season);

    for (const anime of sortedList.slice(0, 3)) {
      const subs = await getAnimeSubtitles(anime.slug);

      for (const sub of subs) {
        if (!sub.url || seenUrls.has(sub.url)) continue;
        seenUrls.add(sub.url);

        const tokenData = {
          source: 'anisub',
          zipUrl: sub.url,
          season: season || 1,
          episode: episode || 1,
          name: sub.name,
        };

        const token = encodeToken(tokenData);
        allSubtitles.push({
          id: `anisub-${encodeURIComponent(sub.name || anime.slug)}-${episode || 1}`,
          url: `${baseUrl}/subtitles/download/${token}.vtt`,
          lang: 'tur',
          format: 'vtt',
          title: `Türkçe [AniSub] ${anime.name} (${sub.episodes ? 'Bölüm ' + sub.episodes : 'Paket'})`,
        });
      }

      if (allSubtitles.length > 0) break;
    }

    if (allSubtitles.length > 0) break;
  }

  return allSubtitles;
}

/**
 * Downloads zip from AniSub CDN and extracts the matching episode
 */
async function resolveAnisubVtt(token) {
  const { extractSubtitleFromArchive } = require('./archive');
  const res = await axios.get(token.zipUrl, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
  });

  const archiveBuffer = Buffer.from(res.data);
  const extracted = await extractSubtitleFromArchive(archiveBuffer, {
    season: token.season,
    episode: token.episode,
    requireEpisodeMatch: false,
  });

  return extracted.body;
}

module.exports = {
  searchAnisub,
  getAnimeSubtitles,
  findAnimeSubtitles,
  resolveAnisubVtt,
};
