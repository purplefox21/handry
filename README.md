# 🤖 JEVIS — Jev AI Destekli macOS Kişisel Asistanı

> **"Bilgisayarını konuşarak kontrol et."**
> Sesli veya yazılı doğal dil komutlarıyla macOS'unu tam kontrol eden,
> TypeSafe Jev (Sistem 1 — anlık refleks) + Gemma 4 (yerel LLM — derin düşünme) hibrit yapay zeka asistanı.

---

## 🧠 Mimari: İki Beyinli Jarvis

```
Kullanıcı (Ses / Metin)
        │
        ▼
┌─────────────────────────────────┐
│  JEV (TypeSafe Sistem 1)       │  ⚡ 300-800ms refleks kararlar
│  "Bu komut basit mi karmaşık   │
│   mı? Ne yapılmalı?"           │
└───────┬─────────────┬──────────┘
        │             │
   BASİT             KARMAŞIK
   (refleks)         (akıl yürütme)
        │             │
        ▼             ▼
┌──────────────┐ ┌──────────────────────────┐
│ AppleScript  │ │ GEMMA 4 (Yerel LLM)      │
│ + System     │ │ Ekran görüntüsü analizi, │
│ Events       │ │ çok adımlı planlama,     │
│              │ │ AppleScript kodu üretme  │
│ Anında       │ │                          │
│ Uygulama     │ │ 2-5 saniye düşünme      │
└──────────────┘ └──────────────────────────┘
        │             │
        └──────┬──────┘
               ▼
        macOS İşletim Sistemi
   (Uygulamalar, Dosyalar, Tarayıcı,
    Fare, Klavye, Ses, Ekran...)
```

---

## ⚡ Şu An Yapabildiğimiz Şeyler (Jev Katmanı — Tamamlandı)

| Kategori | Örnek Komutlar | Nasıl Çalışıyor |
|---|---|---|
| **Uygulama Aç / Kapat** | "VS Code'u aç", "Hesap makinesini kapat" | `open -a` / `osascript quit` |
| **Tarayıcı & Arama** | "Safaride YouTube'a gir jev macOS yaz arat" | `open -a Safari <URL>` |
| **Apple Notes'a Yazdırma** | "Notlara 'Alışveriş' diye not aç içine 'süt, ekmek' yaz" | AppleScript Notes API |
| **Spotify Müzik Kontrol** | "Spotify'da Daft Punk aç", "Sonraki şarkıya geç" | Spotify URI + AppleScript |
| **Ses Seviyesi** | "Sesi yüzde 35 yap", "Sessize al" | `osascript set volume` |
| **Ekran Görüntüsü** | "Ekran görüntüsü al" | `screencapture` |
| **Tema Değiştirme** | "Karanlık modu değiştir" | System Events appearance |
| **Ekran Kilitleme** | "Ekranı kilitle" | `pmset displaysleepnow` |

---

## 🚀 Yapılacaklar (Gemma 4 Katmanı — Geliştirme Aşaması)

### Faz 1: Gemma 4 Yerel Kurulum
- [ ] Ollama veya llama.cpp ile Gemma 4 modelinin macOS'a yerel kurulumu
- [ ] Gemma 4 ile serbest AppleScript kodu üretme (kullanıcının tanımlamadığı aksiyonları da yapabilme)
- [ ] Jev → Gemma 4 yönlendirme (Router): Jev "bu karmaşık" dediğinde Gemma devreye girer

### Faz 2: Ekran Gözü (Vision)
- [ ] `screencapture` ile anlık ekran karesi alma
- [ ] Gemma 4 Vision ile ekrandaki butonları, metinleri ve konumları analiz etme
- [ ] "Şu butona tıkla", "Ekrandaki formu doldur" gibi görsel komutları çözme

### Faz 3: Tam Bilgisayar Kontrolü
- [ ] Fare kontrolü: Koordinata tıklama, sürükle-bırak (`cliclick` veya Swift helper)
- [ ] Klavye simülasyonu: Herhangi bir uygulamaya yazı yazdırma (`keystroke`)
- [ ] Sekme yönetimi: Safari/Chrome'da belirli sekmeyi kapatma, sekmeler arası geçiş
- [ ] YouTube video kontrolü: Açık videoda oynat/durdur (JavaScript enjeksiyonu)
- [ ] Dosya yönetimi: Dosya taşıma, kopyalama, silme, yeniden adlandırma
- [ ] Pano (Clipboard) yönetimi: Kopyala, yapıştır, pano geçmişi
- [ ] Takvim & Hatırlatıcılar: Etkinlik ekleme, hatırlatıcı oluşturma
- [ ] Mail: Taslak oluşturma, gönderme

### Faz 4: Paketleme & Dağıtım
- [ ] Electron veya Tauri ile macOS .app paketleme (kaynak kodu gizli, tek dosya uygulama)
- [ ] İlk açılışta Gemma 4 model dosyasını otomatik indirme
- [ ] Kullanıcının sadece TypeSafe API Key girmesini gerektiren onboarding ekranı
- [ ] App Store veya Gumroad üzerinden $1 fiyatla satışa sunma

---

## 🏗️ Proje Yapısı

```
jevis/
├── README.md                 # Bu dosya (Proje vizyonu ve yol haritası)
├── .env                      # API anahtarları (JEV_KEY=...)
├── package.json              # Node.js proje tanımı
├── server.js                 # HTTP sunucusu (Web UI + API proxy)
├── macos-controller.js       # macOS sistem çağrıları (AppleScript, open, screencapture)
├── jev-dispatcher.js         # Jev Sistem 1 karar motoru (doğal dil → aksiyon)
├── macos-cli.js              # Terminal komut satırı arayüzü
├── demo.js                   # Jev API kullanım demo betiği
├── public/                   # Web arayüzü (tarayıcıdan sesli kontrol)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── .agents/                  # AI agent becerileri
    └── skills/
        └── typesafe-ai/
            └── SKILL.md      # TypeSafe Jev entegrasyon rehberi
```

---

## 🔧 Gemma 4 Yerel Kurulum Rehberi (Yakında)

Gemma 4, Google DeepMind'ın ürettiği açık kaynaklı LLM modelidir.
Yerel bilgisayarında çalışır, internet gerekmez, API ücreti ödemezsin.

### Kurulum (Ollama ile):
```bash
# 1. Ollama'yı kur (macOS için):
brew install ollama

# 2. Ollama'yı başlat:
ollama serve

# 3. Gemma 4 modelini indir (ilk seferde ~5 GB indirir):
ollama pull gemma3           # Gemma 3 (şu an mevcut, Gemma 4 çıkınca güncellenecek)
# veya
ollama pull gemma3:27b       # Daha güçlü 27B parametre versiyonu (16+ GB RAM gerekli)

# 4. Test et:
ollama run gemma3 "macOS'ta Safari'de yeni sekme açan AppleScript kodu yaz"
```

### Jevis'e Entegrasyon:
Gemma 4, Ollama üzerinden `http://localhost:11434/api/generate` adresinde yerel bir API sunar.
Jevis bu API'ye bağlanarak karmaşık komutlar için AppleScript kodu ürettirecek.

---

## 💰 İş Modeli ve Dağıtım Stratejisi

### Gelir Modeli
- Kullanıcı Jevis uygulamasını indirir ($1 veya aylık abonelik)
- Kendi TypeSafe API Key'ini girer (kullanıcı kendi token ücretini öder)
- Gemma 4 modeli ilk açılışta kullanıcının bilgisayarına otomatik indirilir (ücretsiz, açık kaynak)
- Senin masrafın: Sadece dağıtım platformu komisyonu

### Kaynak Kodu Koruma
- **Electron** veya **Tauri** ile `.app` dosyasına paketlendiğinde:
  - Kullanıcı sadece çift tıklayıp çalıştırır
  - JavaScript kodu ASAR arşivine paketlenir (kolay okunmaz)
  - Tauri (Rust tabanlı) ile daha da sıkı koruma mümkün
- **Gemma 4 modeli** zaten açık kaynak olduğu için kullanıcının indirmesi sorun değil;
  senin katma değerin asistanın zekası, UX'i ve Jev entegrasyonudur

---

## 📋 Gereksinimler

- macOS 13+ (Ventura veya üzeri)
- Node.js 20+
- TypeSafe API Key ([console.typesafe.ai](https://console.typesafe.ai/keys))
- Ollama (Gemma 4 yerel çalıştırma için — Faz 2+)
- macOS Erişilebilirlik İzni (fare/klavye kontrolü için)
