const assert = require('node:assert');
const iconv = require('iconv-lite');
const {
  decodeSubtitle,
  srtToVtt,
  assToVtt,
  matchesEpisode,
} = require('../src/lib/archive');
const { resolveKitsuAnime, parseMediaIdentifier } = require('../src/lib/animeResolver');
const turkceAltyazi = require('../src/lib/turkcealtyazi');
const { encodeToken, decodeToken } = require('../src/lib/token');

async function runTests() {
  console.log('🧪 Testler Başlatılıyor...\n');

  // Test 1: Token encode / decode
  console.log('1️⃣ Token encode / decode testi:');
  const sampleTokenData = {
    source: 'turkcealtyazi',
    altid: '12345',
    season: 1,
    episode: 5,
  };
  const token = encodeToken(sampleTokenData);
  const decoded = decodeToken(token);
  assert.deepStrictEqual(decoded, sampleTokenData, 'Token verisi eşit olmalıdır');
  console.log('   ✅ Token testi başarılı.');

  // Test 2: Windows-1254 Türkçe karakter çözme
  console.log('2️⃣ Windows-1254 Türkçe karakter çözme testi:');
  const turkishText = 'Şiirde Türkçe karakterler: ç, ğ, ı, ö, ş, ü, İ, Ğ, Ü, Ş, Ö, Ç';
  const win1254Buffer = iconv.encode(turkishText, 'windows-1254');
  const decodedText = decodeSubtitle(win1254Buffer);
  assert.strictEqual(decodedText, turkishText, 'Windows-1254 doğru çözümlenmelidir');
  console.log('   ✅ Türkçe karakter çözme testi başarılı.');

  // Test 3: SRT -> WebVTT dönüştürme
  console.log('3️⃣ SRT -> WebVTT dönüştürme testi:');
  const srtSample = `1
00:01:20,500 --> 00:01:23,800
Merhaba dünya!

2
00:01:25,100 --> 00:01:28,400
Bu bir Türkçe altyazıdır.`;

  const vttSample = srtToVtt(srtSample);
  assert(vttSample.startsWith('WEBVTT'), 'WebVTT başlığı içermelidir');
  assert(vttSample.includes('00:01:20.500 --> 00:01:23.800'), 'Zaman damgası virgül yerine nokta olmalıdır');
  console.log('   ✅ SRT to VTT testi başarılı.');

  // Test 4: ASS -> WebVTT dönüştürme
  console.log('4️⃣ ASS -> WebVTT anime altyazı dönüştürme testi:');
  const assSample = `[Script Info]
Title: Sample Anime
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:23.80,Default,,0,0,0,,{\\pos(192,200)}Shingeki no Kyojin!\\Nİkinci Satır`;

  const assVtt = assToVtt(assSample);
  assert(assVtt.startsWith('WEBVTT'), 'ASS to VTT başlığı olmalı');
  assert(assVtt.includes('Shingeki no Kyojin!\nİkinci Satır'), 'ASS etiketleri temizlenmiş ve satır ayrılmış olmalı');
  console.log('   ✅ ASS to VTT testi başarılı.');

  // Test 5: Anime ve Dizi Bölüm Eşleştirme (matchesEpisode)
  console.log('5️⃣ Bölüm numarası eşleştirme testi:');
  assert(matchesEpisode('Game.of.Thrones.S01E05.1080p.mkv', 1, 5), 'S01E05 eşleşmeli');
  assert(matchesEpisode('GoT.1x05.HDTV.srt', 1, 5), '1x05 eşleşmeli');
  assert(matchesEpisode('[SubsPlease] Frieren - 05 [1080p].ass', null, 5), 'Anime [Group] - 05 eşleşmeli');
  assert(matchesEpisode('Death_Note_05.srt', null, 5), 'Anime _05 eşleşmeli');
  assert(matchesEpisode('Attack_on_Titan_Bolum_5.srt', null, 5), 'Bolum 5 eşleşmeli');
  assert(!matchesEpisode('[SubsPlease] Frieren - 06 [1080p].ass', null, 5), '06, 5 ile eşleşmemeli');
  console.log('   ✅ Bölüm eşleştirme testi başarılı.');

  // Test 6: Kitsu Anime Çözümleyici (Canlı API)
  console.log('6️⃣ Kitsu Anime Çözümleme (Canlı Kitsu API):');
  try {
    const kitsuAoT = await resolveKitsuAnime('7442');
    assert(kitsuAoT, 'Kitsu anime verisi gelmeli');
    console.log(`   ✅ Kitsu Başlık: "${kitsuAoT.canonicalTitle}", Alt Tür: ${kitsuAoT.subtype}`);

    const mediaParsed = await parseMediaIdentifier('anime', 'kitsu:7442:3');
    assert(mediaParsed.isKitsu, 'isKitsu true olmalı');
    assert.strictEqual(mediaParsed.episode, 3, 'Bölüm 3 olmalı');
    console.log('   ✅ Kitsu Stremio ID çözümleme başarılı.');
  } catch (err) {
    console.warn('   ⚠️ Kitsu API bağlantısı atlandı:', err.message);
  }

  // Test 7: TurkceAltyazi Film Arama (Canlı)
  console.log('7️⃣ TurkceAltyazi Arama Testi (Canlı):');
  try {
    const pages = await turkceAltyazi.findTitlePages('1375666'); // Inception
    assert(pages.length > 0, 'Inception bulunmalı');
    console.log(`   ✅ TurkceAltyazi Sonuç: "${pages[0].title}" (IMDb: ${pages[0].imdbId})`);
  } catch (err) {
    console.warn('   ⚠️ TurkceAltyazi arama atlandı:', err.message);
  }

  // Test 8: One Pace Altyazı Entegrasyonu
  console.log('8️⃣ One Pace Altyazı Entegrasyonu:');
  const { normalizeOnePaceId, getOnePaceSubtitles } = require('../src/lib/onepace');
  const normalizedId = normalizeOnePaceId('RO_1');
  assert.strictEqual(normalizedId, 'RO_1', 'RO_1 tanınmalı');
  const onePaceSubs = getOnePaceSubtitles('RO_1', 'http://localhost:7000');
  assert(onePaceSubs.length >= 2, 'En az WebVTT ve ASS altyazı bulunmalı');
  console.log(`   ✅ One Pace Romance Dawn 1 altyazıları hazır (${onePaceSubs.length} adet)`);

  console.log('\n🎉 TÜM TESTLER BAŞARIYLA TAMAMLANDI!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Başarısız Oldu:', err);
  process.exit(1);
});
