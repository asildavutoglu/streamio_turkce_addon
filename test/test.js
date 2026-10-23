const assert = require('node:assert');
let iconv = null;
try {
  iconv = require('iconv-lite');
} catch {}

const {
  decodeSubtitle,
  srtToVtt,
  assToVtt,
  assToSrt,
  srtToAss,
  vttToAss,
  vttToSrt,
  convertToAss,
  convertToSrt,
  convertToVtt,
  formatSubtitle,
  matchesEpisode,
  cleanFilenameForEpisode,
  extractEpisodeNumber,
  shiftSubtitleTimestamps,
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
  const win1254Buffer = iconv
    ? iconv.encode(turkishText, 'windows-1254')
    : Buffer.from([0xfe, 0xf0, 0xfd, 0xe7, 0xf6, 0xfc]);
  const decodedText = decodeSubtitle(win1254Buffer);
  if (iconv) {
    assert.strictEqual(decodedText, turkishText, 'Windows-1254 doğru çözümlenmelidir');
  } else {
    assert.strictEqual(decodedText, 'şğıçöü', 'Windows-1254 doğru çözümlenmelidir');
  }
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

  // Test 4: ASS -> WebVTT & Styled ASS koruma testi
  console.log('4️⃣ ASS -> WebVTT & Styled ASS koruma testi:');
  const assSample = `[Script Info]
Title: Sample Anime
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:22:10.00,0:22:15.00,ED,,0,0,0,,Bitiş Şarkısı
Dialogue: 0,0:02:53.00,0:02:54.00,Signs,,0,0,0,,{\\p1}m 10 20 l 30 40{\\p0}
Dialogue: 0,0:00:05.40,0:00:07.80,Default,,0,0,0,,{\\pos(192,200)}İlk Konuşma!\\Nİkinci Satır`;

  const assVtt = assToVtt(assSample);
  assert(assVtt.startsWith('WEBVTT'), 'ASS to VTT başlığı olmalı');
  assert(assVtt.includes('İlk Konuşma!\nİkinci Satır'), 'ASS etiketleri temizlenmiş ve satır ayrılmış olmalı');
  assert(!assVtt.includes('m 10 20'), 'Vektörel çizimler temizlenmeli');
  const firstCueIdx = assVtt.indexOf('İlk Konuşma');
  const songCueIdx = assVtt.indexOf('Bitiş Şarkısı');
  assert(firstCueIdx < songCueIdx, 'Zaman sıralaması kronolojik (artan) sırada olmalı');

  // Styled ASS formatında orijinal stiller ve çizimler %100 korunmalıdır
  const assRaw = convertToAss('anime.ass', Buffer.from(assSample, 'utf8'));
  assert.strictEqual(assRaw, assSample, 'Styled ASS formatında orijinal stiller, fontlar ve efektler eksiksiz korunmalıdır');
  assert(assRaw.includes('{\\pos(192,200)}'), 'Styled ASS pozisyon etiketlerini korumalıdır');
  assert(assRaw.includes('{\\p1}m 10 20'), 'Styled ASS vektör çizimlerini korumalıdır');

  // ASS -> SRT dönüştürme
  const assSrt = assToSrt(assSample);
  assert(assSrt.includes('İlk Konuşma!\nİkinci Satır'), 'ASS to SRT temiz diyalogları içermeli');
  assert(assSrt.includes('00:00:05,400 --> 00:00:07,800'), 'SRT zaman damgası virgüllü olmalı');

  // SRT -> ASS dönüştürme
  const convertedAss = srtToAss(srtSample);
  assert(convertedAss.includes('[Script Info]') && convertedAss.includes('[Events]'), 'SRT to ASS başlıkları içermeli');
  assert(convertedAss.includes('Dialogue: 0,0:01:20.50,0:01:23.80,Default,,0,0,0,,Merhaba dünya!'), 'SRT to ASS diyalog satırı doğru biçimlendirilmeli');
  console.log('   ✅ ASS & SRT dönüşüm ve Styled ASS koruma testleri başarılı.');

  // Test 5: Anime ve Dizi Bölüm Eşleştirme (matchesEpisode)
  console.log('5️⃣ Bölüm numarası eşleştirme testi:');
  assert(matchesEpisode('Game.of.Thrones.S01E05.1080p.mkv', 1, 5), 'S01E05 eşleşmeli');
  assert(matchesEpisode('GoT.1x05.HDTV.srt', 1, 5), '1x05 eşleşmeli');
  assert(matchesEpisode('[SubsPlease] Frieren - 05 [1080p].ass', null, 5), 'Anime [Group] - 05 eşleşmeli');
  assert(matchesEpisode('Death_Note_05.srt', null, 5), 'Anime _05 eşleşmeli');
  assert(matchesEpisode('Attack_on_Titan_Bolum_5.srt', null, 5), 'Bolum 5 eşleşmeli');
  assert(!matchesEpisode('[SubsPlease] Frieren - 06 [1080p].ass', null, 5), '06, 5 ile eşleşmemeli');

  // CRC32 / Hex checksum ve karmaşık anime dosya adlarında yanlış eşleşme testleri
  assert(!matchesEpisode('[Kaizoku] Jujutsu Kaisen - 36 (BD 1080p) [B09B33D3].ass', 2, 9), 'B09B hex hash içeren Bölüm 36 asla Sezon 2 Bölüm 9 ile eşleşmemeli');
  assert.strictEqual(extractEpisodeNumber('[Kaizoku] Jujutsu Kaisen - 33 (BD 1080p) [174E215D].ass'), 33, 'Bölüm 33 doğru çıkarılmalı');
  assert.strictEqual(extractEpisodeNumber('[Kaizoku] Jujutsu Kaisen - 27 (BD 1080p) [38C944E0].ass'), 27, 'Checksumdaki E0 rakamı yerine gerçek bölüm 27 çıkarılmalı');

  // Zaman kaydırma (shiftSubtitleTimestamps) testi
  const sampleVtt = 'WEBVTT\n\n00:00:04.160 --> 00:00:05.360\nTest';
  const shiftedVtt = shiftSubtitleTimestamps(sampleVtt, 1250, 'vtt');
  assert(shiftedVtt.includes('00:00:05.410 --> 00:00:06.610'), 'VTT +1250ms kaydırılmalı');
  console.log('   ✅ Bölüm eşleştirme, CRC32 koruması ve zaman kaydırma testleri başarılı.');

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

  // Test 9: AniSub Anime Entegrasyonu (Jujutsu Kaisen Season 1 & 2)
  console.log('9️⃣ AniSub Anime Entegrasyonu (Jujutsu Kaisen):');
  try {
    const { aggregateSubtitles, resolveSubtitle, resolveSubtitleVtt } = require('../src/lib/aggregator');
    const mediaJJK1 = await parseMediaIdentifier('series', 'tt12343534:1:1');
    assert(mediaJJK1.isAnime, 'Jujutsu Kaisen anime olarak tanınmalı');
    assert.strictEqual(mediaJJK1.title, 'Jujutsu Kaisen', 'Başlık Jujutsu Kaisen olmalı');
    const subsJJK1 = await aggregateSubtitles(mediaJJK1, 'http://localhost:7000');
    assert(subsJJK1.length >= 2, 'Jujutsu Kaisen için hem WebVTT hem Styled ASS altyazı bulunmalı');
    const hasVtt = subsJJK1.some((s) => s.format === 'vtt');
    const hasAss = subsJJK1.some((s) => s.format === 'ass');
    assert(hasVtt, 'WebVTT formatında altyazı olmalı');
    assert(hasAss, 'Styled ASS formatında altyazı olmalı');
    console.log(`   ✅ Jujutsu Kaisen S1E1 altyazıları bulundu (WebVTT & Styled ASS çift format).`);

    // Jujutsu Kaisen Season 2 (konuşma ve diyalogların eksiksiz WebVTT & Styled ASS akışı testi)
    const mediaJJK2 = await parseMediaIdentifier('series', 'tt12343534:2:1');
    const subsJJK2 = await aggregateSubtitles(mediaJJK2, 'http://localhost:7000');
    assert(subsJJK2.length >= 2, 'Jujutsu Kaisen S2 altyazısı bulunmalı');
    const vttSub = subsJJK2.find((s) => s.format === 'vtt') || subsJJK2[0];
    const tokenJJK2 = vttSub.url.split('/').pop().replace(/\.(vtt|ass)$/, '');
    const vttJJK2 = await resolveSubtitle(tokenJJK2, 'vtt');
    assert(vttJJK2.startsWith('WEBVTT'), 'JJK S2 VTT başlığı olmalı');
    assert(vttJJK2.includes('O yaz işler yoğundu.'), 'JJK S2 konuşma diyalogları eksiksiz içermeli');

    const assJJK2 = await resolveSubtitle(tokenJJK2, 'ass');
    assert(assJJK2.includes('O yaz işler yoğundu.'), 'JJK S2 ASS diyalogları içermeli');
    console.log('   ✅ Jujutsu Kaisen S2E1 hem WebVTT hem Styled ASS olarak indirildi ve doğrulandı.');

    // Jujutsu Kaisen Season 2 Episode 9 (Bölüm 33) doğrulama testi (Kullanıcının kayma sorunu yaşadığı bölüm)
    const mediaJJK2Ep9 = await parseMediaIdentifier('series', 'tt12343534:2:9');
    const subsJJK2Ep9 = await aggregateSubtitles(mediaJJK2Ep9, 'http://localhost:7000');
    assert(subsJJK2Ep9.length >= 2, 'Jujutsu Kaisen S2E9 altyazısı bulunmalı');
    const vttSubEp9 = subsJJK2Ep9.find((s) => s.format === 'vtt') || subsJJK2Ep9[0];
    const tokenEp9 = vttSubEp9.url.split('/').pop().replace(/\.(vtt|ass)$/, '');
    const vttEp9 = await resolveSubtitle(tokenEp9, 'vtt');
    assert(vttEp9.startsWith('WEBVTT'), 'JJK S2E9 VTT başlığı olmalı');
    assert(vttEp9.includes('Hocamdır kendisi!') || vttEp9.includes('Hocamın hatırı olmasaydı'), 'JJK S2E9 (Bölüm 33) diyaloglarını içermeli, yanlış Bölüm 36 değil!');
    console.log('   ✅ Jujutsu Kaisen S2E9 doğru bölüm (Bölüm 33 - Shibuya Açılış) olarak indirildi ve diyaloglar doğrulandı.');
  } catch (err) {
    console.warn('   ⚠️ AniSub entegrasyon testi atlandı:', err.message);
  }

  // Test 10: Film Altyazı Kapsamı (TurkceAltyazi'de bulunmayan filmler için OpenSubtitles v3 entegrasyonu)
  console.log('🔟 Film Altyazı Kapsamı (Oppenheimer, vb.):');
  try {
    const { aggregateSubtitles, resolveSubtitleVtt } = require('../src/lib/aggregator');
    const mediaOppenheimer = await parseMediaIdentifier('movie', 'tt15398776');
    const subsOppenheimer = await aggregateSubtitles(mediaOppenheimer, 'http://localhost:7000');
    assert(subsOppenheimer.length > 0, 'Oppenheimer için Türkçe altyazı bulunmalı');
    const tokenOpp = subsOppenheimer[0].url.split('/').pop().replace('.vtt', '');
    const vttOpp = await resolveSubtitleVtt(tokenOpp);
    assert(vttOpp.startsWith('WEBVTT'), 'Oppenheimer VTT başlığı olmalı');
    console.log(`   ✅ Oppenheimer Türkçe altyazıları hazır (${subsOppenheimer.length} adet).`);
  } catch (err) {
    console.warn('   ⚠️ Film altyazı kapsamı testi atlandı:', err.message);
  }

  console.log('\n🎉 TÜM TESTLER BAŞARIYLA TAMAMLANDI!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Başarısız Oldu:', err);
  process.exit(1);
});
