-- TikTok Shop (termasuk pesanan channel Tokopedia). Dua sumber data ke tabel yang sama, kunci = Order ID:
--   sumber 'api'  : sinkron TikTok Shop Open API (tiap jam)
--   sumber 'file' : upload file ekspor Seller Center (Pesanan → Ekspor CSV; Keuangan → Income .xlsx)
-- Data pembeli (username, nama, telepon, alamat detail) tidak disimpan — hanya kota & provinsi.

CREATE TABLE IF NOT EXISTS tiktok_toko (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id     TEXT UNIQUE,                  -- ID toko TikTok Shop (dari API)
  nama        TEXT NOT NULL,
  gudang_id   INTEGER REFERENCES gudang(id) ON DELETE SET NULL,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS tiktok_upload (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  jenis       TEXT NOT NULL,                -- pesanan | penghasilan
  sumber      TEXT NOT NULL DEFAULT 'file', -- file | api
  nama_file   TEXT,
  dari        TEXT,
  sampai      TEXT,
  baris       INTEGER NOT NULL DEFAULT 0,
  pesanan     INTEGER NOT NULL DEFAULT 0,
  baru        INTEGER NOT NULL DEFAULT 0,
  ringkasan   TEXT,
  status      TEXT,                         -- proses | terbaca | perlu_cek | gagal
  catatan     TEXT,
  oleh        TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tiktok_upload ON tiktok_upload(toko_id, jenis, created_at);

-- Pesanan: satu baris per Order ID. Waktu WIB "YYYY-MM-DD HH:MM:SS".
CREATE TABLE IF NOT EXISTS tiktok_pesanan (
  order_id       TEXT PRIMARY KEY,
  toko_id        INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  gudang_id      INTEGER,
  status         TEXT NOT NULL,             -- belum_bayar | perlu_dikirim | dikirim | terkirim | selesai | batal | retur | lain
  status_asli    TEXT,
  substatus      TEXT,
  tipe_batal     TEXT,                      -- Cancel | Return/Refund
  alasan_batal   TEXT,
  resi           TEXT,
  kurir          TEXT,
  opsi_kirim     TEXT,
  dibuat         TEXT NOT NULL,
  dibayar        TEXT,
  dikirim        TEXT,
  terkirim       TEXT,
  dibatalkan     TEXT,
  metode_bayar   TEXT,
  cod            INTEGER NOT NULL DEFAULT 0,
  subtotal_awal  INTEGER NOT NULL DEFAULT 0, -- Σ harga sebelum diskon
  diskon_penjual INTEGER NOT NULL DEFAULT 0,
  diskon_platform INTEGER NOT NULL DEFAULT 0,
  subtotal       INTEGER NOT NULL DEFAULT 0, -- Σ subtotal produk setelah diskon
  ongkir_pembeli INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0, -- Order Amount (dibayar pembeli)
  pcs            INTEGER NOT NULL DEFAULT 0,
  pcs_retur      INTEGER NOT NULL DEFAULT 0,
  kota           TEXT,
  provinsi       TEXT,
  channel        TEXT,                      -- TikTok | Tokopedia
  sumber         TEXT NOT NULL DEFAULT 'file',
  upload_id      INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tiktok_pesanan_dibuat ON tiktok_pesanan(dibuat);
CREATE INDEX IF NOT EXISTS idx_tiktok_pesanan_toko ON tiktok_pesanan(toko_id, dibuat);

CREATE TABLE IF NOT EXISTS tiktok_pesanan_item (
  order_id    TEXT NOT NULL REFERENCES tiktok_pesanan(order_id) ON DELETE CASCADE,
  urut        INTEGER NOT NULL,
  sku_id      TEXT,                         -- SKU ID TikTok
  sku         TEXT,                         -- Seller SKU (dicocokkan ke Manajemen SKU)
  nama        TEXT,
  variasi     TEXT,
  harga_awal  INTEGER NOT NULL DEFAULT 0,   -- harga satuan sebelum diskon
  subtotal    INTEGER NOT NULL DEFAULT 0,   -- subtotal baris setelah diskon
  qty         INTEGER NOT NULL DEFAULT 1,
  qty_retur   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, urut)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_item_sku ON tiktok_pesanan_item(sku);

-- Penghasilan (settlement): satu baris per ID pesanan / penyesuaian. Angka bertanda: biaya negatif.
-- total = pendapatan + biaya_total + penyesuaian; biaya_total = biaya_platform + biaya_ongkir + biaya_afiliasi + pajak.
CREATE TABLE IF NOT EXISTS tiktok_penghasilan (
  id              TEXT PRIMARY KEY,         -- ID Pesanan / ID penyesuaian
  toko_id         INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  jenis           TEXT,                     -- Pesanan | penyesuaian (Other adjustment, dll.)
  order_id        TEXT,                     -- ID pesanan terkait
  dibuat          TEXT,                     -- tanggal pesanan (YYYY-MM-DD)
  dilepas         TEXT NOT NULL,            -- tanggal dana dibayarkan ke saldo (YYYY-MM-DD)
  total           INTEGER NOT NULL DEFAULT 0, -- Jumlah penyelesaian pembayaran
  pendapatan      INTEGER NOT NULL DEFAULT 0,
  subtotal        INTEGER NOT NULL DEFAULT 0, -- setelah diskon penjual
  diskon_penjual  INTEGER NOT NULL DEFAULT 0,
  refund          INTEGER NOT NULL DEFAULT 0,
  biaya_total     INTEGER NOT NULL DEFAULT 0,
  biaya_platform  INTEGER NOT NULL DEFAULT 0, -- komisi, layanan Mall/Growth Xtra, pemrosesan, dll.
  biaya_ongkir    INTEGER NOT NULL DEFAULT 0,
  biaya_afiliasi  INTEGER NOT NULL DEFAULT 0,
  pajak           INTEGER NOT NULL DEFAULT 0,
  penyesuaian     INTEGER NOT NULL DEFAULT 0,
  dibayar_pembeli INTEGER NOT NULL DEFAULT 0,
  sumber          TEXT NOT NULL DEFAULT 'file',
  rincian         TEXT,                     -- JSON {nama kolom: angka} semua komponen ≠ 0
  upload_id       INTEGER,
  created_at      TEXT,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tiktok_hasil_dilepas ON tiktok_penghasilan(dilepas);
CREATE INDEX IF NOT EXISTS idx_tiktok_hasil_order ON tiktok_penghasilan(order_id);
