# Türkçe Altyazı+ (Stremio Addon) 🎬 ⛩️

[![Stremio'ya Yükle](https://img.shields.io/badge/Stremio'ya-Y%C3%BCkle-7B5BF5?style=for-the-badge&logo=stremio&logoColor=white)](stremio://streamio-turkce-addon.vercel.app/manifest.json)
[![Yapılandır](https://img.shields.io/badge/Web_Yap%C4%B1land%C4%B1rma-A%C3%A7-0070F3?style=for-the-badge&logo=vercel&logoColor=white)](https://streamio-turkce-addon.vercel.app/)

Stremio için **Film**, **Dizi**, **Animeler** ve **One Pace** için geliştirilmiş çok kaynaklı Türkçe altyazı eklentisi.

Bu eklenti, Stremio'daki en büyük eksikliklerden biri olan **Anime Kitsu kimliklerini (`kitsu:1234:1`)** ve Cinemeta Anime kataloglarını otomatik olarak çözümler; **AniSub.co**, **One Pace Türkçe Arşivi**, **TurkceAltyazi.org** ve **OpenSubtitles.com** üzerinden yüksek kaliteli Türkçe altyazıları sunar.

---

## 🌟 Özellikler

- ⛩️ **Eksiksiz Anime Entegrasyonu (AniSub & Kitsu)**: *Jujutsu Kaisen*, *Attack on Titan*, *Demon Slayer* gibi tüm popüler animeleri hem Cinemeta hem de Kitsu kataloğundan otomatik tanır, AniSub CDN üzerinden Türkçe altyazıları anında getirir.
- 🏴‍☠️ **One Pace Türkçe Altyazı Desteği (442 Bölüm)**: `asildavutoglu/one-pace-tr-addon` deposundaki 442 bölümün (Romance Dawn'dan Wano ve Egghead'e kadar 37 Arc) tamamını içerir. Hem WebVTT hem de Styled ASS formatında anında sunar.
- 🎬 **Çok Kaynaklı Havuz**: AniSub, TurkceAltyazi.org ve OpenSubtitles kütüphanelerini aynı anda tarar.
- ✨ **Akıllı Türkçe Karakter Onarımı**: `Windows-1254` ve `ISO-8859-9` ile kodlanmış dosyalardaki bozuk Türkçe karakterleri (`ş, ğ, ı, ç, ö, ü`) otomatik olarak tespit eder ve temiz `UTF-8 WebVTT` formatına çevirir.
- 🎭 **ASS/SSA Anime Format Dönüşümü**: Animelerde yaygın olan `.ass` ve `.ssa` formatındaki altyazıları stil etiketlerini temizleyerek Stremio'nun oynatabileceği standart `WebVTT`'ye dönüştürür.
- ⚡ **Yüksek Hız & Akıllı Önbellek**: Bellek içi (In-Memory) TTL önbellek ve SingleFlight ile sunucu ve sağlayıcı yükünü minimize eder, anında yanıt verir.
- ☁️ **7/24 Kesintisiz Bulut Altyapısı**: Vercel üzerinde 7/24 barındırılır; harici sunucu veya bilgisayar açık tutmaya gerek kalmadan doğrudan kullanılabilir.

---

## 🚀 Hızlı Kurulum (Tek Tıkla)

### Yöntem 1: Doğrudan Kurulum (PC & Mobil)
Aşağıdaki bağlantıya tıklayarak Stremio uygulamanızda tek tıkla kurulum yapabilirsiniz:

👉 **[Stremio'ya Ekle (Tek Tıkla Kur)](stremio://streamio-turkce-addon.vercel.app/manifest.json)**

*(İsteğe bağlı olarak ayarları özelleştirmek için [Yapılandırma Sayfası](https://streamio-turkce-addon.vercel.app/) üzerinden de kurulum yapabilirsiniz.)*

---

### Yöntem 2: Manuel Kurulum (Android TV, Google TV, FireStick & Web)
1. Aşağıdaki manifest bağlantısını kopyalayın:
   ```text
   https://streamio-turkce-addon.vercel.app/manifest.json
   ```
2. Stremio'yu açın -> **Eklentiler (Addons)** sekmesine gidin.
3. Arama çubuğuna linki yapıştırın ve **Yükle (Install)** butonuna tıklayın.

> [!NOTE]  
> Android TV, Google TV, FireStick, Windows, macOS, Linux ve iOS (Stremio Web) dahil tüm cihazlarda anında çalışır.

---

## 🛠️ Geliştiriciler İçin (Yerel Çalıştırma)
Projeye katkı sağlamak veya kendi makinenizde çalıştırmak isterseniz:
```bash
# Bağımlılıkları yükleyin
npm install

# Testleri çalıştırın
npm test

# Eklentiyi başlatın
npm start
```
Tarayıcınızda `http://127.0.0.1:7000` adresini açarak yerel arayüze erişebilirsiniz.

---

## 🧪 Test Edilen Başlıklar

| İçerik | Tür | ID Formatı | Test Sonucu |
| :--- | :--- | :--- | :--- |
| **One Pace (Romance Dawn 1)** | One Pace | `RO_1` | ✅ WebVTT, Styled ASS & SRT (3 format) |
| **One Pace (Wano 1)** | One Pace | `WA_1` | ✅ WebVTT, Styled ASS & SRT (3 format) |
| **Attack on Titan (S01E01)** | Anime | `kitsu:7442:1` | ✅ 10 Türkçe altyazı bulundu & VTT'ye çevrildi |
| **Death Note (S01E01)** | Anime | `kitsu:1376:1` | ✅ 8 Türkçe altyazı bulundu |
| **Inception** | Film | `tt1375666` | ✅ 12 Türkçe altyazı bulundu |
| **Breaking Bad (S01E01)** | Dizi | `tt0903747:1:1` | ✅ 7 Türkçe altyazı bulundu |

---

## 📄 Lisans
MIT License - İstediğiniz gibi kullanabilir, değiştirebilir ve dağıtabilirsiniz.
