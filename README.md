# Türkçe Altyazı+ (Stremio Addon) 🎬 ⛩️

Stremio için **Film**, **Dizi** ve özellikle **Animeler** için geliştirilmiş çok kaynaklı Türkçe altyazı eklentisi.

Bu eklenti, Stremio'daki en büyük eksikliklerden biri olan **Anime Kitsu kimliklerini (`kitsu:1234:1`)** otomatik olarak çözümler ve hem **TurkceAltyazi.org** hem de **OpenSubtitles.com** üzerinden yüksek kaliteli Türkçe altyazıları getirir.

---

## 🌟 Özellikler

- ⛩️ **Tam Anime & Kitsu Desteği**: Stremio'da Anime Kitsu eklentisi kullanıldığında gelen `kitsu:id:episode` isteklerini ARM (Anime Relations Mapping) ve Kitsu API ile anında çözerek Türkçe altyazıları bulur.
- 🎬 **Çift Kaynaklı Havuz**: TurkceAltyazi.org (insan çevirmenler) ve OpenSubtitles v3 kütüphanelerini aynı anda tarar.
- ✨ **Akıllı Türkçe Karakter Onarımı**: `Windows-1254` ve `ISO-8859-9` ile kodlanmış dosyalardaki bozuk Türkçe karakterleri (`ş, ğ, ı, ç, ö, ü`) otomatik olarak tespit eder ve temiz `UTF-8 WebVTT` formatına çevirir.
- 🎭 **ASS/SSA Anime Format Dönüşümü**: Animelerde yaygın olan `.ass` ve `.ssa` formatındaki altyazıları stil etiketlerini temizleyerek Stremio'nun oynatabileceği standart `WebVTT`'ye dönüştürür.
- ⚡ **Yüksek Hız & Akıllı Önbellek**: Bellek içi (In-Memory) TTL önbellek ve SingleFlight ile sunucu ve sağlayıcı yükünü minimize eder, anında yanıt verir.
- 💸 **%100 Sıfır Maliyet**: Hugging Face Spaces veya Dokku/Beamup ile 1 kuruş harcamadan 7/24 çalıştırılabilir.

---

## 🚀 0 Maliyetle Yayına Alma (Hosting Seçenekleri)

Stremio istemcileri (Android TV, PC, Telefon) sunucudan sadece birkaç KB boyutunda JSON ve VTT metni çektiği için devasa sunuculara gerek yoktur.

### Seçenek 1: Hugging Face Spaces (En Kolay & En Güçlü - %100 Ücretsiz)
1. [huggingface.co](https://huggingface.co) üzerinde ücretsiz bir hesap açın.
2. Sağ üstten **New Space** butonuna tıklayın.
3. Space SDK olarak **Docker -> Blank** seçin. Space'i **Public** yapın.
4. Bu depodaki tüm dosyaları oraya `git push` ile yükleyin veya web arayüzünden yükleyin.
5. Hugging Face size otomatik olarak `https://kullaniciadi-space-adi.hf.space` şeklinde bir HTTPS adresi verir.
6. Stremio'ya eklenecek Manifest Linkiniz:
   ```
   https://kullaniciadi-space-adi.hf.space/manifest.json
   ```

### Seçenek 2: Stremio Beamup (Resmi Ücretsiz Dokku Hosting)
Stremio topluluğunun eklenti geliştiricilerine sunduğu ücretsiz platform:
```bash
npm install -g beamup
beamup login
beamup init
beamup push
```
Size anında `https://<addon-adi>.baby-beamup.club/manifest.json` bağlantısını verecektir.

### Seçenek 3: Yerel (Local) Çalıştırma
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

1. Eklenti web sayfasına gidin (örn: `https://your-domain.hf.space` veya `http://127.0.0.1:7000`).
2. **"Stremio'ya Yükle"** butonuna basın (Stremio uygulamanız otomatik açılır).
3. Veya bağlantıyı kopyalayın:
   - Stremio'yu açın -> **Eklentiler (Addons)** sekmesine gidin.
   - Arama çubuğuna manifest linkini yapıştırın:
     `https://your-domain.hf.space/manifest.json`
   - **Yükle (Install)** butonuna tıklayın.

Android TV, Google TV, FireStick, PC, Mac ve iOS (Web) dahil tüm cihazlarda anında çalışır!

---

## 🧪 Test Edilen Başlıklar

| İçerik | Tür | ID Formatı | Test Sonucu |
| :--- | :--- | :--- | :--- |
| **Attack on Titan (S01E01)** | Anime | `kitsu:7442:1` | ✅ 10 Türkçe altyazı bulundu & VTT'ye çevrildi |
| **Death Note (S01E01)** | Anime | `kitsu:1376:1` | ✅ 8 Türkçe altyazı bulundu |
| **Inception** | Film | `tt1375666` | ✅ 12 Türkçe altyazı bulundu |
| **Breaking Bad (S01E01)** | Dizi | `tt0903747:1:1` | ✅ 7 Türkçe altyazı bulundu |

---

## ⚙️ Çevre Değişkenleri (.env - İsteğe Bağlı)

```env
PORT=7000
PUBLIC_URL=https://your-domain.hf.space
OPENSUBTITLES_API_KEY=your_optional_api_key
```

---

## 📄 Lisans
MIT License - İstediğiniz gibi kullanabilir, değiştirebilir ve dağıtabilirsiniz.
