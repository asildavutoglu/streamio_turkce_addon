# Türkçe Altyazı+ (Stremio Addon) 🎬 ⛩️

Stremio için **Film**, **Dizi** ve özellikle **Animeler** için geliştirilmiş çok kaynaklı Türkçe altyazı eklentisi.

Bu eklenti, Stremio'daki en büyük eksikliklerden biri olan **Anime Kitsu kimliklerini (`kitsu:1234:1`)** otomatik olarak çözümler ve hem **TurkceAltyazi.org** hem de **OpenSubtitles.com** üzerinden yüksek kaliteli Türkçe altyazıları getirir.

---

## 🌟 Özellikler

- 🏴‍☠️ **One Pace Türkçe Altyazı Desteği**: `asildavutoglu/one-pace-tr-addon` deposundaki 442 bölümün (Romance Dawn'dan Wano ve Egghead'e kadar 37 Arc) tamamını içerir. Hem WebVTT hem de Styled ASS formatında anında sunar.
- ⛩️ **Tam Anime & Kitsu Desteği**: Stremio'da Anime Kitsu eklentisi kullanıldığında gelen `kitsu:id:episode` isteklerini ARM (Anime Relations Mapping) ve Kitsu API ile anında çözerek Türkçe altyazıları bulur.
- 🎬 **Çift Kaynaklı Havuz**: TurkceAltyazi.org (insan çevirmenler) ve OpenSubtitles v3 kütüphanelerini aynı anda tarar.
- ✨ **Akıllı Türkçe Karakter Onarımı**: `Windows-1254` ve `ISO-8859-9` ile kodlanmış dosyalardaki bozuk Türkçe karakterleri (`ş, ğ, ı, ç, ö, ü`) otomatik olarak tespit eder ve temiz `UTF-8 WebVTT` formatına çevirir.
- 🎭 **ASS/SSA Anime Format Dönüşümü**: Animelerde yaygın olan `.ass` ve `.ssa` formatındaki altyazıları stil etiketlerini temizleyerek Stremio'nun oynatabileceği standart `WebVTT`'ye dönüştürür.
- ⚡ **Yüksek Hız & Akıllı Önbellek**: Bellek içi (In-Memory) TTL önbellek ve SingleFlight ile sunucu ve sağlayıcı yükünü minimize eder, anında yanıt verir.
- 💸 **%100 Sıfır Maliyet**: Vercel, Koyeb veya Dokku/Beamup ile 1 kuruş harcamadan ve kredi kartı vermeden 7/24 çalıştırılabilir.

---

## 🚀 0 Maliyetle Yayına Alma (Hosting Seçenekleri)

Stremio istemcileri (Android TV, PC, Telefon) sunucudan sadece birkaç KB boyutunda JSON ve VTT metni çektiği için devasa sunuculara gerek yoktur.

### Seçenek 1: Vercel (En Hızlı & En Kolay - Kredi Kartsız, %100 Ücretsiz)
1. Bu projeyi kendi GitHub hesabınıza bir depo (repository) olarak yükleyin.
2. [vercel.com](https://vercel.com) adresine gidin ve **"Continue with GitHub"** diyerek ücretsiz giriş yapın (Kredi kartı gerekmez).
3. **"Add New Project"** butonuna basıp GitHub'daki bu depoyu seçin ve **"Deploy"** butonuna tıklayın.
4. Proje içindeki `vercel.json` sayesinde Vercel eklentinizi otomatik olarak serverless olarak derleyip yayına alacaktır.
5. Vercel size anında `https://proje-adiniz.vercel.app` şeklinde kalıcı bir HTTPS adresi verir.
6. Stremio'ya eklenecek Manifest Linkiniz:
   ```text
   https://proje-adiniz.vercel.app/manifest.json
   ```

### Seçenek 2: Koyeb (Always-On Container - Kredi Kartsız, %100 Ücretsiz)
1. [koyeb.com](https://www.koyeb.com) adresinde ücretsiz bir hesap açın.
2. **"Create Service"** -> **"GitHub"** seçin ve deponuzu bağlayın.
3. Koyeb Dockerfile'ı algılayıp servisi 7/24 ücretsiz olarak çalıştıracaktır.
4. Size `https://<app-adi>.koyeb.app/manifest.json` bağlantısını verecektir.

### Seçenek 3: Stremio Beamup (Resmi Ücretsiz Dokku Hosting)
Stremio topluluğunun eklenti geliştiricilerine sunduğu ücretsiz platform:
```bash
npm install -g beamup
beamup login
beamup init
beamup push
```
Size anında `https://<addon-adi>.baby-beamup.club/manifest.json` bağlantısını verecektir.

### Seçenek 4: Yerel (Local) Çalıştırma
Kendi bilgisayarınızda çalıştırmak için:
```bash
# Bağımlılıkları yükleyin
npm install

# Testleri çalıştırın
npm test

# Eklentiyi başlatın
npm start
```
Tarayıcınızda `http://127.0.0.1:7000` adresini açarak tek tıkla Stremio'ya ekleyebilirsiniz.

---

## 📺 Stremio'ya Nasıl Kurulur?

1. Eklenti web sayfasına gidin (örn: `https://proje-adiniz.vercel.app` veya `http://127.0.0.1:7000`).
2. İsteğe bağlı olarak kendi OpenSubtitles anahtarınızı veya sağlayıcı önceliğinizi seçebilirsiniz.
3. **"Stremio'ya Yükle"** butonuna basın (Stremio uygulamanız otomatik açılır).
4. Veya bağlantıyı kopyalayın:
   - Stremio'yu açın -> **Eklentiler (Addons)** sekmesine gidin.
   - Arama çubuğuna manifest linkini yapıştırın:
     `https://proje-adiniz.vercel.app/manifest.json`
   - **Yükle (Install)** butonuna tıklayın.

Android TV, Google TV, FireStick, PC, Mac ve iOS (Web) dahil tüm cihazlarda anında çalışır!

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
