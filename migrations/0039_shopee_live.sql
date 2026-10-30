-- Shopee › Live: dari file ekspor Shopee Live (Seller Centre → Live Streaming → Data, "overview"), satu file = satu toko × satu periode.
-- Angka di file adalah total selama periode itu (tidak per hari, tanpa No. Pesanan). Biaya live (host, iklan live) tidak ada di file → diisi manual.
CREATE TABLE IF NOT EXISTS shopee_live (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id         INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  dari            TEXT NOT NULL,                 -- YYYY-MM-DD
  sampai          TEXT NOT NULL,
  upload_id       INTEGER,
  omzet           INTEGER NOT NULL DEFAULT 0,    -- Penjualan (Pesanan Siap Dikirim)
  pesanan         INTEGER NOT NULL DEFAULT 0,    -- Pesanan (Pesanan Siap Dikirim)
  omzet_dibuat    INTEGER NOT NULL DEFAULT 0,    -- Penjualan (Pesanan Dibuat), termasuk yang batal
  pesanan_dibuat  INTEGER NOT NULL DEFAULT 0,
  produk_terjual  INTEGER NOT NULL DEFAULT 0,    -- Produk Terjual (Pesanan Siap Dikirim)
  omzet_baru      INTEGER NOT NULL DEFAULT 0,    -- Penjualan dari Pembeli Baru (Pesanan Siap Dikirim)
  sesi            INTEGER NOT NULL DEFAULT 0,    -- Jumlah Livestream
  durasi_detik    INTEGER NOT NULL DEFAULT 0,    -- Jumlah Durasi Livestream
  penonton        INTEGER NOT NULL DEFAULT 0,
  dilihat         INTEGER NOT NULL DEFAULT 0,
  klik_produk     INTEGER NOT NULL DEFAULT 0,
  keranjang       INTEGER NOT NULL DEFAULT 0,
  spending        INTEGER NOT NULL DEFAULT 0,    -- biaya live (fee host, iklan live, …) diisi manual
  spending_ket    TEXT,
  created_at      TEXT,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_live ON shopee_live(toko_id, dari, sampai);
