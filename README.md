# Tetik Aim

CS2 hissiyatında, Aim Lab tarzı aim antrenmanı. Hem tarayıcıda (web sitesi) hem de
masaüstü uygulaması olarak çalışır. Oyun HTML/CSS/JS (Three.js) ile yazıldı;
sunucu, masaüstü uygulaması ve skor doğrulama Rust ile.

## Özellikler

- **CS2 ile birebir hassasiyet**: `m_yaw 0.022`, CS2 hassasiyet değerini aynen gir.
  DPI'a göre eDPI ve cm/360 gösterilir. Ham girdi (fare ivmesi kapalı) desteklenir.
- **CS2 görüş alanı**: 4:3'te 90° yatay, geniş ekranda Hor+ (CS2 gibi). İstersen özel FOV.
- **Gerçek ölçekler**: göz yüksekliği 64u ≈ 1.64 m, rakip 1.83 m, kafa ≈ 25 cm çap.
- **Nişangah editörü**: klasik / nokta / T / daire, renk, uzunluk, kalınlık, boşluk,
  dış çizgi, vuruş işareti. **CS2 konsol ayarlarını yapıştırarak içe aktarma**
  (`sensitivity`, `cl_crosshairsize`, `cl_crosshairgap`, `cl_crosshaircolor_r/g/b` …).
- **Sentezlenmiş sesler** (dosya yok): silah sesi, kafa vuruşu "tink", vuruş sesleri.
- Mermi izleri, vuruş parçacıkları, 3 ortam teması (kum, gece, laboratuvar).
- Sonuç ekranı: skor, isabet, öldürme/sn, reaksiyon süresi, kafa oranı, seri,
  rekor karşılaştırması, son 20 oyunun grafiği ve ipucu.
- İstatistik sayfası ve **liderlik tablosu** (sunucuda çevrimiçi, uygulamada yerel).

## Modlar (12)

| Mod | Tür | Ne çalıştırır |
|-----|-----|---------------|
| Izgara | Flick | 5×5 ızgarada aynı anda 3 hedef |
| Hassas Altılı | Hassasiyet | 6 küçük hedef, her mermi önemli |
| Merkez Flick | Flick | merkez ↔ rastgele hedef, flick + geri dönüş |
| Mikro Flick | Hassasiyet | çok küçük, birbirine yakın hedefler |
| Hareketli Hedefler | Flick | kayan hedeflere flick |
| Küçülen Hedefler | Hız | küçülerek kaybolan hedefler, artan tempo |
| Hedef Seçimi | Karar | düşman (kırmızı küre) / dost (mavi küp) ayrımı |
| Pürüzsüz Takip | Takip | basılı tut, yön değiştiren küreyi takip et |
| Strafe Takip | Takip | ADAD strafe atan rakibi takip (kafa 1.5×) |
| Kafa Avı | CS | farklı mesafelerde beliren rakipler, kafa tek mermi |
| Köşe Tutma | CS | duvar arkasından peek atan rakipler, açı tutma |
| Reaksiyon | Reaksiyon | 10 tur, yeşile dönünce tıkla |

Kısayollar: **Sol tık** ateş · **Esc** duraklat · **R** yeniden başlat · **F11** tam ekran.

## Çalıştırma

### Web sitesi (Rust sunucu)

```sh
cargo run --release -p tetik-server
# http://localhost:8080
```

Ortam değişkenleri: `TETIK_ADDR` (varsayılan `0.0.0.0:8080`), `TETIK_WEB` (`web`),
`TETIK_DATA` (`data/scores.json`). Sunucu `web/` klasörünü sunar ve şu API'yi verir:

- `GET /api/health`, `GET /api/modes`
- `GET /api/leaderboard?mode=kafa&limit=20`
- `POST /api/scores` (skorlar Rust tarafında doğrulanır, IP başına 5 sn sınır)

`web/` klasörü tek başına statik olarak da (GitHub Pages, Netlify …) yayınlanabilir;
o zaman liderlik tablosu tarayıcıda yerel tutulur. Dosyayı doğrudan açmak (`file://`)
çalışmaz, çünkü tarayıcılar ES modüllerini bir sunucu olmadan yüklemez.

### Masaüstü uygulaması (Tauri)

Aynı oyun yerel bir pencerede; skorlar uygulama veri klasöründe saklanır.

```sh
cargo run --release -p tetik-desktop
```

Kurulum paketi (Windows `.msi`/`.exe`, Linux `.deb`/`.AppImage`) için:

```sh
cargo install tauri-cli --version "^2"
cd desktop && cargo tauri build
```

Gereksinimler: Windows'ta WebView2 (Windows 10/11'de hazır gelir). Linux'ta
`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`. macOS paketi için önce
`cargo tauri icon icons/icon.png` ile `.icns` üret.

## Yapı

```
core/      Rust: modlar, skor doğrulama, JSON liderlik deposu (birim testli)
server/    Rust: axum web sunucusu + API
desktop/   Rust: Tauri masaüstü uygulaması
web/       HTML/CSS/JS oyun (Three.js, vendor/ içinde)
  js/engine.js     sahne, CS2 fare hesabı, atış/ışın testi, oyun döngüsü
  js/modes.js      12 mod
  js/crosshair.js  nişangah çizimi
  js/audio.js      WebAudio sesleri
  js/settings.js   ayarlar, CS2 içe aktarma, FOV hesabı
  js/api.js        liderlik: Tauri / sunucu / yerel
  js/stats.js      geçmiş, rekorlar, grafik
```

Yeni mod eklerken `web/js/modes.js` ve `core/src/lib.rs` içindeki `MODES` listesine
aynı `id` ile ekle.

## Test

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Lisans

MIT. Three.js MIT lisanslıdır (`web/vendor/THREE-LICENSE`).
