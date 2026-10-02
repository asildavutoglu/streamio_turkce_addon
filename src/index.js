const crypto = require('node:crypto');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const manifest = require('./manifest');
const renderLandingPage = require('./landingTemplate');
const { parseMediaIdentifier } = require('./lib/animeResolver');
const { aggregateSubtitles, resolveSubtitleVtt } = require('./lib/aggregator');
const { getOnePaceSubtitles, getOnePaceVtt } = require('./lib/onepace');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(compression());

// Global CORS & Security Headers
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function getBaseUrl(req) {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  try {
    return `${req.protocol}://${req.get('host')}`;
  } catch {
    return `http://127.0.0.1:${config.port}`;
  }
}

function parseUserConfig(rawConfig) {
  if (!rawConfig) return {};
  try {
    const jsonStr = Buffer.from(rawConfig, 'base64url').toString('utf8');
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

// Landing & Configuration Page
app.get(['/', '/configure', '/:config/configure'], (req, res) => {
  const baseUrl = getBaseUrl(req);
  res.type('html').send(renderLandingPage(manifest, `${baseUrl}/manifest.json`));
});

// Stremio Addon Manifest (both unconfigured and configured)
app.get(['/manifest.json', '/:config/manifest.json'], (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(manifest);
});

// Stremio Subtitles Resource Handler
const subtitleRoutes = [
  '/subtitles/:type/:id.json',
  '/subtitles/:type/:id/:extra.json',
  '/:config/subtitles/:type/:id.json',
  '/:config/subtitles/:type/:id/:extra.json',
];

app.get(subtitleRoutes, async (req, res) => {
  const { type, id, config: rawConfig } = req.params;
  const baseUrl = getBaseUrl(req);
  const userConfig = parseUserConfig(rawConfig);

  // 1. Check if this is a One Pace episode request
  const videoID = (req.query && req.query.videoID) || id;
  const onePaceSubs = getOnePaceSubtitles(videoID, baseUrl);
  if (onePaceSubs.length > 0) {
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json({ subtitles: onePaceSubs });
  }

  // 2. Regular Movie, Series, or Anime request
  try {
    const media = await parseMediaIdentifier(type, id);
    const subtitles = await aggregateSubtitles(media, baseUrl, userConfig);

    // Stremio expects: { subtitles: [ { id, url, lang, format, title } ] }
    res.set('Cache-Control', subtitles.length > 0 ? 'public, max-age=1800' : 'public, max-age=180');
    return res.json({ subtitles });
  } catch (err) {
    console.error(`[Router] Failed to handle subtitles for ${type}/${id}:`, err.message);
    return res.status(200).json({ subtitles: [] });
  }
});

// One Pace Subtitle Delivery Endpoint (VTT Stream)
app.get('/subtitles/onepace/:videoId.vtt', async (req, res) => {
  const { videoId } = req.params;

  try {
    const vttBody = await getOnePaceVtt(videoId);
    const etag = `"${crypto.createHash('sha256').update(vttBody).digest('base64url')}"`;

    res.set({
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
      'ETag': etag,
    });

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.send(vttBody);
  } catch (err) {
    console.error('[Router] One Pace delivery error:', err.message);
    return res.status(404).type('text').send('One Pace altyazi bulunamadi.');
  }
});

// Subtitle Delivery Endpoint (VTT Stream)
app.get('/subtitles/download/:token.vtt', async (req, res) => {
  const { token } = req.params;

  try {
    const vttBody = await resolveSubtitleVtt(token);
    const etag = `"${crypto.createHash('sha256').update(vttBody).digest('base64url')}"`;

    res.set({
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
      'ETag': etag,
    });

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.send(vttBody);
  } catch (err) {
    console.error('[Router] Subtitle delivery error:', err.message);
    return res.status(404).type('text').send('Altyazi bulunamadi veya su anda indirilemiyor.');
  }
});

// Health check endpoint
app.get(['/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    version: manifest.version,
    uptime: process.uptime(),
  });
});

// 404 fallback
app.use((req, res) => {
  res.redirect('/');
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`\n🚀 Türkçe Altyazı+ Eklentisi Başlatıldı!`);
    console.log(`📡 Port: ${config.port}`);
    console.log(`🔗 Web Arayüzü: http://127.0.0.1:${config.port}`);
    console.log(`📦 Manifest URL: http://127.0.0.1:${config.port}/manifest.json`);
    console.log(`💡 Stremio Kurulum Linki: stremio://127.0.0.1:${config.port}/manifest.json\n`);
  });
}

module.exports = app;
