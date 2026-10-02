require('dotenv').config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 7000,
  publicUrl: process.env.PUBLIC_URL || null,
  trustProxy: process.env.TRUST_PROXY === 'true' || true,

  // Cache settings
  cache: {
    searchTtlMs: 15 * 60 * 1000,       // 15 minutes for subtitle list searches
    negativeSearchTtlMs: 3 * 60 * 1000, // 3 minutes for empty search results
    subtitleTtlMs: 24 * 60 * 60 * 1000, // 24 hours for parsed VTT subtitles
    archiveTtlMs: 6 * 60 * 60 * 1000,   // 6 hours for raw archives
  },

  // TurkceAltyazi settings
  turkceAltyazi: {
    baseUrl: process.env.TURKCEALTYAZI_BASE_URL || 'https://turkcealtyazi.org',
    timeoutMs: Number(process.env.TURKCEALTYAZI_TIMEOUT_MS) || 12000,
  },

  // OpenSubtitles API settings (v3)
  openSubtitles: {
    baseUrl: 'https://api.opensubtitles.com/api/v1',
    apiKey: process.env.OPENSUBTITLES_API_KEY || '', // Optional: can be provided in env or user config
    userAgent: 'StremioTurkceAltyaziPlus v1.0.0',
    timeoutMs: 10000,
  },

  // Kitsu API settings
  kitsu: {
    baseUrl: 'https://kitsu.io/api/edge',
    timeoutMs: 8000,
  },
};
