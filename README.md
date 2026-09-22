# Dashboard Marketing — Iklan (Meta) & Pesanan (Scalev)

Web app laporan marketing produk fisik. Menarik spend dari Meta Ads (3 BM) dan order dari Scalev, menyimpannya di Cloudflare D1, lalu menampilkan pipeline Spend → Order → Confirm → Kirim → Selesai dengan breakdown BM → Campaign → Ad set → Ad dan kelompok produk.

Stack: Cloudflare Workers + Hono (API & cron) · D1 (SQLite) · frontend statis di `public/` (dilayani Worker yang sama).

## Struktur

```
marketing-dashboard/
├─ public/index.html        # Frontend (saat ini masih mockup data contoh; akan disambungkan ke /api)
├─ src/
│  ├─ index.ts              # Entry Worker: routing, proteksi password, cron
│  ├─ env.ts                # Tipe binding & helper tanggal (Asia/Jakarta)
│  ├─ lib/scalev.ts         # Klien Scalev API v3 (orders, stores, statistics, verifikasi webhook)
│  ├─ lib/meta.ts           # Klien Meta Marketing API (adaccounts, insights harian level ad)
│  ├─ lib/mengantar.ts      # Klien Mengantar (perjalanan paket, status kurir, COD) — join ke order via resi
│  ├─ lib/sync.ts           # Logika sinkron: discover akun, insight Meta, order Scalev, auto-map campaign
│  └─ routes/
│     ├─ settings.ts        # /api/settings  — BM, centang ad account & store, kelompok produk
│     ├─ report.ts          # /api/report/*  — summary, daily, ads, orders, products, shipments
│     └─ webhooks.ts        # /api/webhooks/scalev — realtime status order
├─ migrations/              # Skema D1 (0001 init, 0002 shipments)
├─ wrangler.jsonc           # Konfigurasi Cloudflare (assets, D1, cron)
├─ .dev.vars.example        # Contoh secret untuk lokal
└─ package.json
```

## Setup pertama kali

Prasyarat: Node.js 20+, Git, akun Cloudflare (empatribupaketdotcom@gmail.com), akun GitHub (easylanguage.pare@gmail.com).

```bash
npm install
cp .dev.vars.example .dev.vars        # Windows: copy .dev.vars.example .dev.vars
# isi .dev.vars dengan API key Scalev, 3 token Meta, dan password dashboard

npx wrangler login                    # login ke akun Cloudflare
npm run db:create                     # buat D1 → salin database_id ke wrangler.jsonc
npm run db:migrate:local              # skema untuk dev lokal
npm run dev                           # http://localhost:8787
```

Semua endpoint `/api/*` dilindungi `DASHBOARD_PASSWORD` (header `X-Dashboard-Key` atau cookie `dk`). Untuk produksi ganti dengan Cloudflare Access.

### Urutan pemakaian pertama

1. `POST /api/settings/test` — cek Scalev & tiap token Meta hidup.
2. `POST /api/settings/discover` — tarik daftar ad account (semua BM) dan store Scalev ke D1.
3. `GET /api/settings` — lihat daftarnya; lalu `PUT /api/settings` untuk mencentang akun yang ditarik dan memasangkan `store_id` Scalev ke tiap ad account. (Halaman Pengaturan di frontend akan melakukan ini lewat UI.)
4. `POST /api/sync/backfill?days=90` — isi order Scalev 90 hari ke belakang.
5. `POST /api/sync/meta?since=2026-07-01&until=2026-09-22` — isi insight Meta untuk rentang yang sama.
6. `POST /api/sync/mengantar?days=60` — tarik perjalanan paket dari Mengantar (dicocokkan ke order lewat resi).
7. Setelah itu cron tiap jam (`0 * * * *`) menjalankan `runAll`: insight Meta 3 hari terakhir + order Scalev yang berubah.

Contoh dengan curl:

```bash
curl -X POST -H "X-Dashboard-Key: PASSWORD" http://localhost:8787/api/settings/discover
curl -X PUT  -H "X-Dashboard-Key: PASSWORD" -H "Content-Type: application/json" \
  -d '{"ad_accounts":[{"id":"act_123","is_selected":true,"store_id":4412}],"stores":[{"id":4412,"is_selected":true}]}' \
  http://localhost:8787/api/settings
curl -X POST -H "X-Dashboard-Key: PASSWORD" "http://localhost:8787/api/sync/backfill?days=90"
```

## Deploy ke Cloudflare

```bash
npx wrangler secret put SCALEV_API_KEY
npx wrangler secret put META_TOKEN_UNIKA
npx wrangler secret put META_TOKEN_TOMOJOYO
npx wrangler secret put META_TOKEN_STEVA
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put MENGANTAR_API_KEY       # Dashboard Mengantar > API Key (yang juga dipasang di Scalev)
npx wrangler secret put SCALEV_WEBHOOK_SECRET   # opsional, dari Scalev > Developers > Webhooks
npm run db:migrate
npm run deploy
```

Atau sambungkan repo GitHub ke Cloudflare (Workers & Pages → Create → Import repository) supaya setiap push ke `main` otomatis deploy. Secret tetap diisi lewat dashboard Cloudflare → Worker → Settings → Variables.

Webhook Scalev: daftarkan `https://<nama-worker>.<subdomain>.workers.dev/api/webhooks/scalev` untuk event `order.created`, `order.updated`, `order.status_changed`, `order.payment_status_changed`.

## Perjalanan paket (Mengantar)

`GET /api/report/shipments?from=&to=` mengembalikan: performa per kurir (terkirim, RTS, masih jalan, gagal antar, rata-rata hari, nilai COD di jalan), daftar paket bermasalah (tanpa update >48 jam / gagal antar / over SLA), deret harian, dan RTS rate per iklan. `GET /api/track/<resi>` melacak satu resi langsung ke Mengantar dan menyimpannya.

Kunci join: `orders.shipment_receipt` (Scalev) = `shipments.receipt` / `cnote_no` (Mengantar). Order yang belum punya resi belum bisa dicocokkan.

Referensi API: https://app.mengantar.com/docs (mirror: github.com/ongkipro/mengantar-documentation). Key Mengantar berada di dalam URL request, jadi hanya boleh dipanggil dari Worker.

## UTM di iklan Meta

Pasang di kolom URL parameters (level campaign) agar order Scalev bisa dipetakan sampai level ad:

```
utm_source=meta&utm_medium={{placement}}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```

`utm_campaign` dicocokkan ke `campaigns.id`, `utm_term` ke `adsets.id`, `utm_content` ke `ads.id`.

## Catatan penting

- Token Meta yang dibuat lewat login user berumur ≤60 hari. Pakai System User token (Business Settings → System Users) agar tidak kedaluwarsa.
- Scalev list orders maksimum 25/halaman dan 10.000 request/jam per key — backfill 90 hari untuk puluhan ribu order bisa memakan beberapa menit; jalankan per store bila perlu.
- Field `utm_campaign/term/content` diduga ada di `metadata` order Scalev (`extractUtm` di `lib/scalev.ts`). Verifikasi pada sync pertama dengan melihat `raw_json` satu order; sesuaikan nama key bila berbeda.
- Tanggal acuan semua laporan = `draft_time` (order masuk) dalam WIB, sesuai keputusan awal.

## Roadmap

- [x] Skema D1, klien Scalev & Meta & Mengantar, sync, endpoint API
- [ ] Halaman Pengaturan tersambung ke `/api/settings` (centang akun & store)
- [ ] Ringkasan, Iklan, Pesanan, Produk membaca `/api/report/*`
- [ ] Login via Cloudflare Access
- [ ] Ekspor CSV
