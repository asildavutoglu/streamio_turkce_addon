const { ONE_PACE_PREFIXES } = require('./lib/onepace');

module.exports = {
  id: 'org.stremio.turkcealtyazi.plus',
  version: '1.1.0',
  name: 'Türkçe Altyazı+ (Film, Dizi, Anime & One Pace)',
  description: 'Film, dizi, anime (Kitsu & IMDb) ve One Pace bölümleri için birleşik Türkçe altyazı eklentisi.',
  resources: ['subtitles'],
  types: ['movie', 'series', 'anime', 'other'],
  idPrefixes: ['tt', 'kitsu', ...ONE_PACE_PREFIXES],
  catalogs: [],
  background: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80',
  logo: 'https://i.imgur.com/8Q9eU0q.png',
  contactEmail: 'support@stremio-addon.local',
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};
