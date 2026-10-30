-- Shopee (sementara dari file ekspor Seller Centre; nanti bisa diganti API Shopee Open Platform tanpa mengubah struktur).
-- Data pembeli (username, nama, telepon, alamat) sengaja tidak disimpan — hanya kota & provinsi.

-- Toko Shopee; gudang ditentukan per toko (pesanan baru mencatat gudang toko saat di-upload)
CREATE TABLE IF NOT EXISTS shopee_toko (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama        TEXT NOT NULL,
  username    TEXT UNIQUE COLLATE NOCASE,    -- username Shopee (ada di file iklan)
  shop_id     TEXT,                          -- ID toko Shopee
  gudang_id   INTEGER REFERENCES gudang(id) ON DELETE SET NULL,
  created_at  TEXT,
  updated_at  TEXT
);

-- Riwayat upload file
CREATE TABLE IF NOT EXISTS shopee_upload (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  jenis       TEXT NOT NULL,                 -- pesanan | penghasilan | iklan
  nama_file   TEXT,
  dari        TEXT,                          -- rentang tanggal isi file (YYYY-MM-DD)
  sampai      TEXT,
  baris       INTEGER NOT NULL DEFAULT 0,
  pesanan     INTEGER NOT NULL DEFAULT 0,
  baru        INTEGER NOT NULL DEFAULT 0,
  oleh        TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_upload_toko ON shopee_upload(toko_id, jenis, created_at);

-- Pesanan: satu baris per No. Pesanan. Waktu disimpan apa adanya dari Shopee (WIB, "YYYY-MM-DD HH:MM").
CREATE TABLE IF NOT EXISTS shopee_pesanan (
  no_pesanan     TEXT PRIMARY KEY,
  toko_id        INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  gudang_id      INTEGER,                    -- gudang toko saat pesanan pertama kali di-upload
  status         TEXT NOT NULL,              -- belum_bayar | perlu_dikirim | dikirim | terkirim | diterima | selesai | batal | retur | lain
  status_asli    TEXT,
  alasan_batal   TEXT,
  status_retur   TEXT,
  resi           TEXT,
  kurir          TEXT,                       -- Opsi Pengiriman
  antar          TEXT,                       -- Antar ke counter / Pickup
  batas_kirim    TEXT,
  waktu_kirim    TEXT,                       -- Waktu Pengiriman Diatur
  dibuat         TEXT NOT NULL,
  dibayar        TEXT,
  selesai        TEXT,
  metode_bayar   TEXT,
  cod            INTEGER NOT NULL DEFAULT 0,
  subtotal       INTEGER NOT NULL DEFAULT 0, -- Σ subtotal produk (harga setelah diskon × qty)
  diskon_penjual INTEGER NOT NULL DEFAULT 0,
  voucher_penjual INTEGER NOT NULL DEFAULT 0,
  ongkir_pembeli INTEGER NOT NULL DEFAULT 0,
  total_bayar    INTEGER NOT NULL DEFAULT 0,
  perkiraan_ongkir INTEGER NOT NULL DEFAULT 0,
  pcs            INTEGER NOT NULL DEFAULT 0,
  pcs_retur      INTEGER NOT NULL DEFAULT 0,
  kota           TEXT,
  provinsi       TEXT,
  upload_id      INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_pesanan_dibuat ON shopee_pesanan(dibuat);
CREATE INDEX IF NOT EXISTS idx_shopee_pesanan_toko ON shopee_pesanan(toko_id, dibuat);
CREATE INDEX IF NOT EXISTS idx_shopee_pesanan_status ON shopee_pesanan(status, dibuat);

CREATE TABLE IF NOT EXISTS shopee_pesanan_item (
  no_pesanan  TEXT NOT NULL REFERENCES shopee_pesanan(no_pesanan) ON DELETE CASCADE,
  urut        INTEGER NOT NULL,
  sku         TEXT,                          -- Nomor Referensi SKU
  sku_induk   TEXT,
  nama        TEXT,
  variasi     TEXT,
  harga_awal  INTEGER NOT NULL DEFAULT 0,
  harga       INTEGER NOT NULL DEFAULT 0,    -- harga setelah diskon
  qty         INTEGER NOT NULL DEFAULT 1,
  qty_retur   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (no_pesanan, urut)
);
CREATE INDEX IF NOT EXISTS idx_shopee_item_sku ON shopee_pesanan_item(sku);
