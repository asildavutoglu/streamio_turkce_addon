module.exports = {
  id: 'org.stremio.turkcealtyazi.plus',
  version: '1.0.0',
  name: 'Türkçe Altyazı+ (Film, Dizi & Anime)',
  description: 'Film, dizi ve animeler (Kitsu & IMDb) için TurkceAltyazi.org ve OpenSubtitles destekli birleşik Türkçe altyazı eklentisi.',
  resources: ['subtitles'],
  types: ['movie', 'series', 'anime', 'other'],
  idPrefixes: ['tt', 'kitsu'],
  catalogs: [],
  background: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80',
  logo: 'https://i.imgur.com/8Q9eU0q.png',
  contactEmail: 'support@stremio-addon.local',
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};
