function renderLandingPage(manifest, manifestUrl) {
  const stremioUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name} - Stremio Addon</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0c10;
      --card-bg: rgba(22, 27, 34, 0.7);
      --border: rgba(255, 255, 255, 0.1);
      --primary: #7c3aed;
      --primary-hover: #6d28d9;
      --accent: #06b6d4;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background-image: 
        radial-gradient(circle at 20% 20%, rgba(124, 58, 237, 0.15) 0%, transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(6, 182, 212, 0.15) 0%, transparent 40%);
    }
    .container {
      width: 100%;
      max-width: 680px;
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(124, 58, 237, 0.2);
      border: 1px solid rgba(124, 58, 237, 0.4);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      color: #c4b5fd;
      margin-bottom: 20px;
      letter-spacing: 0.5px;
    }
    h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ffffff 0%, #9ca3af 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.desc {
      font-size: 16px;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 32px;
    }
    @media(min-width: 480px) {
      .btn-group {
        flex-direction: row;
        justify-content: center;
      }
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 14px 28px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 12px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s ease;
      border: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px 0 rgba(124, 58, 237, 0.4);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px 0 rgba(124, 58, 237, 0.6);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
    }
    .features {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      text-align: left;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    @media(min-width: 540px) {
      .features {
        grid-template-columns: 1fr 1fr;
      }
    }
    .feature-card {
      background: rgba(255, 255, 255, 0.03);
      padding: 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }
    .feature-title {
      font-size: 14px;
      font-weight: 700;
      color: #e5e7eb;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .feature-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .copy-toast {
      display: none;
      position: fixed;
      bottom: 24px;
      background: #10b981;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    }
    .manifest-box {
      background: rgba(0, 0, 0, 0.3);
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      font-family: monospace;
      font-size: 12px;
      color: #a78bfa;
      word-break: break-all;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">v${manifest.version} • HIZLI & EKSİKSİZ</div>
    <h1>${manifest.name}</h1>
    <p class="desc">${manifest.description}</p>

    <div class="manifest-box">${manifestUrl}</div>

    <div class="btn-group">
      <a href="${stremioUrl}" class="btn btn-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        Stremio'ya Yükle
      </a>
      <button onclick="copyManifest()" class="btn btn-secondary">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Linki Kopyala
      </button>
    </div>

    <div class="features">
      <div class="feature-card">
        <div class="feature-title">⛩️ Anime & Kitsu Desteği</div>
        <div class="feature-desc">Kitsu ID'lerini (kitsu:1234:1) otomatik çözer, animelerde bulunamayan altyazıları getirir.</div>
      </div>
      <div class="feature-card">
        <div class="feature-title">🎬 Çift Kaynaklı Havuz</div>
        <div class="feature-desc">TurkceAltyazi.org ve OpenSubtitles veritabanlarını aynı anda tarayıp en iyi sonucu sunar.</div>
      </div>
      <div class="feature-card">
        <div class="feature-title">✨ Akıllı UTF-8 Onarımı</div>
        <div class="feature-desc">Windows-1254 kodlamasındaki bozuk Türkçe karakterleri (ş, ğ, ı, ç) anında düzeltir.</div>
      </div>
      <div class="feature-card">
        <div class="feature-title">📺 TV & Mobil Uyumlu</div>
        <div class="feature-desc">Android TV, FireStick, PC, Mac ve Mobil cihazlarla %100 uyumludur.</div>
      </div>
    </div>
  </div>

  <div id="toast" class="copy-toast">Manifest URL panoya kopyalandı!</div>

  <script>
    function copyManifest() {
      const url = "${manifestUrl}";
      navigator.clipboard.writeText(url).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);
      });
    }
  </script>
</body>
</html>`;
}

module.exports = renderLandingPage;
