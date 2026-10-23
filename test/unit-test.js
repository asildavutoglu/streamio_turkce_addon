const assert = require('node:assert');
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
  getExtensionPriority,
} = require('../src/lib/archive');

console.log('🧪 Birim Testleri Başlatılıyor...\n');

// 1. Türkçe Karakter Çözme Testi (Windows-1254)
console.log('1️⃣ Türkçe Karakter Çözme Testi:');
const turkishWin1254Bytes = Buffer.from([0xfe, 0xf0, 0xfd, 0xe7, 0xf6, 0xfc]); // ş, ğ, ı, ç, ö, ü
const decodedTr = decodeSubtitle(turkishWin1254Bytes);
assert.strictEqual(decodedTr, 'şğıçöü', 'Windows-1254 Türkçe karakterler doğru çözülmeli');
console.log('   ✅ Türkçe karakter testi başarılı.');

// 2. SRT -> WebVTT Testi
console.log('2️⃣ SRT -> WebVTT Dönüştürme:');
const srtSample = `1
00:01:20,500 --> 00:01:23,800
Merhaba dünya!

2
00:01:25,100 --> 00:01:28,400
İkinci satır`;

const vttResult = srtToVtt(srtSample);
assert(vttResult.startsWith('WEBVTT'), 'WebVTT başlığı olmalı');
assert(vttResult.includes('00:01:20.500 --> 00:01:23.800'), 'Noktalı zaman damgası olmalı');
assert(vttResult.includes('Merhaba dünya!'), 'Metin korunmalı');
console.log('   ✅ SRT -> WebVTT başarılı.');

// 3. ASS -> WebVTT Testi (Stil ve Çizim Temizliği + Kronolojik Sıralama)
console.log('3️⃣ ASS -> WebVTT Dönüştürme (Temizleme & Sıralama):');
const assSample = `[Script Info]
Title: Sample Anime
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:20:00.00,0:20:05.00,ED,,0,0,0,,Bitiş Şarkısı
Dialogue: 0,0:01:00.00,0:01:02.00,Signs,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}
Dialogue: 0,0:00:10.50,0:00:13.20,Default,,0,0,0,,{\\pos(192,200)}{\\c&H00FFFF&}Konuşma Başladı!\\Nİkinci Satır`;

const cleanVtt = assToVtt(assSample);
assert(cleanVtt.startsWith('WEBVTT'), 'WebVTT başlığı olmalı');
assert(cleanVtt.includes('Konuşma Başladı!\nİkinci Satır'), 'Stil etiketleri temizlenmiş ve satır ayrılmış olmalı');
assert(!cleanVtt.includes('{\\pos') && !cleanVtt.includes('{\\c&H'), 'Tüm ASS stil etiketleri temizlenmiş olmalı');
assert(!cleanVtt.includes('m 0 0'), 'Vektörel çizim koordinatları temizlenmiş olmalı');
const firstIdx = cleanVtt.indexOf('Konuşma Başladı');
const secondIdx = cleanVtt.indexOf('Bitiş Şarkısı');
assert(firstIdx < secondIdx, 'Cuelar artan kronolojik sırada olmalı');
console.log('   ✅ ASS -> WebVTT başarılı.');

// 4. Styled ASS Koruma Testi (VLC / MPV İçin Orijinal Stillerin Saklanması)
console.log('4️⃣ Styled ASS Orijinal Format Koruma Testi:');
const assRawOutput = convertToAss('episode.ass', Buffer.from(assSample, 'utf8'));
assert.strictEqual(assRawOutput, assSample, 'Orijinal ASS dosyası VLC/MPV için %100 aynen korunmalı');
assert(assRawOutput.includes('{\\pos(192,200)}'), 'ASS konumlandırma etiketleri korunmalı');
assert(assRawOutput.includes('{\\c&H00FFFF&}'), 'ASS renk etiketleri korunmalı');
assert(assRawOutput.includes('{\\p1}m 0 0'), 'ASS vektörel çizim etiketleri korunmalı');
console.log('   ✅ Styled ASS format koruma başarılı.');

// 5. ASS -> SRT Dönüştürme Testi
console.log('5️⃣ ASS -> SRT Dönüştürme Testi:');
const srtFromAss = assToSrt(assSample);
assert(srtFromAss.includes('1\n'), 'SRT sıra numarası olmalı');
assert(srtFromAss.includes('00:00:10,500 --> 00:00:13,200'), 'SRT zaman damgası olmalı');
assert(srtFromAss.includes('Konuşma Başladı!\nİkinci Satır'), 'SRT metni temiz olmalı');
assert(!srtFromAss.includes('{\\pos'), 'SRT stil etiketleri içermemeli');
console.log('   ✅ ASS -> SRT başarılı.');

// 6. SRT -> ASS Dönüştürme Testi
console.log('6️⃣ SRT -> ASS Dönüştürme Testi:');
const assFromSrt = srtToAss(srtSample);
assert(assFromSrt.includes('[Script Info]'), 'Script Info başlığı olmalı');
assert(assFromSrt.includes('[V4+ Styles]'), 'V4+ Styles başlığı olmalı');
assert(assFromSrt.includes('[Events]'), 'Events başlığı olmalı');
assert(assFromSrt.includes('Dialogue: 0,0:01:20.50,0:01:23.80,Default,,0,0,0,,Merhaba dünya!'), 'Diyalog satırı doğru ASS biçiminde olmalı');
console.log('   ✅ SRT -> ASS başarılı.');

// 7. FormatSubtitle Seçimi
console.log('7️⃣ formatSubtitle Hedef Format Testi:');
const buf = Buffer.from(assSample, 'utf8');
const outVtt = formatSubtitle('sub.ass', buf, 'vtt');
assert(outVtt.startsWith('WEBVTT') && !outVtt.includes('{\\pos'), 'vtt seçildiğinde temiz WebVTT dönmeli');

const outAss = formatSubtitle('sub.ass', buf, 'ass');
assert(outAss.includes('{\\pos(192,200)}'), 'ass seçildiğinde orijinal stiller dönmeli');

const outSrt = formatSubtitle('sub.ass', buf, 'srt');
assert(outSrt.includes('00:00:10,500 --> 00:00:13,200'), 'srt seçildiğinde temiz SRT dönmeli');
console.log('   ✅ formatSubtitle başarılı.');

// 8. Uzantı Öncelik Sıralaması
console.log('8️⃣ getExtensionPriority Testi:');
assert(getExtensionPriority('.ass', 'ass') < getExtensionPriority('.srt', 'ass'), 'ass hedefinde .ass en öncelikli olmalı');
assert(getExtensionPriority('.vtt', 'vtt') < getExtensionPriority('.ass', 'vtt'), 'vtt hedefinde .vtt en öncelikli olmalı');
console.log('   ✅ getExtensionPriority başarılı.');

// 9. Bölüm Numarası Eşleştirme
console.log('9️⃣ matchesEpisode Bölüm Eşleştirme Testi:');
assert(matchesEpisode('[Erai-raws] Jujutsu Kaisen - 05 [1080p].ass', null, 5), 'Anime [Group] Title - 05 eşleşmeli');
assert(matchesEpisode('Attack_on_Titan_S01E05.ass', 1, 5), 'S01E05 ASS eşleşmeli');
assert(matchesEpisode('One_Pace_WA_01.ass', null, 1), 'One Pace WA_01 eşleşmeli');
console.log('   ✅ Bölüm eşleştirme başarılı.');

console.log('\n🎉 BİRİM TESTLERİNİN TÜMÜ EKSİKSİZ VE BAŞARIYLA TAMAMLANDI!\n');
