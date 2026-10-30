-- Shopee › Iklan: dari file "Semua Laporan Iklan CPC" (Iklan Shopee → Laporan → Data Keseluruhan), satu file = satu toko × satu periode.
-- Angka di file adalah total selama periode itu (tidak per hari), jadi disimpan per laporan; upload periode yang sama / lebih panjang menggantikan
-- laporan lama yang ada di dalamnya.
CREATE TABLE IF NOT EXISTS shopee_iklan_laporan (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  dari        TEXT NOT NULL,                 -- YYYY-MM-DD
  sampai      TEXT NOT NULL,
  upload_id   INTEGER,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_iklan_laporan ON shopee_iklan_laporan(toko_id, dari, sampai);

CREATE TABLE IF NOT EXISTS shopee_iklan (
  laporan_id        INTEGER NOT NULL REFERENCES shopee_iklan_laporan(id) ON DELETE CASCADE,
  urut              INTEGER NOT NULL,
  nama              TEXT NOT NULL,           -- Nama Iklan
  status            TEXT,
  jenis             TEXT,                    -- Jenis Iklan (Iklan Produk, Iklan Toko, …)
  kode_produk       TEXT,
  mode_bidding      TEXT,                    -- GMV Max ROAS, Iklan Produk Otomatis, Manual, …
  penempatan        TEXT,
  mulai             TEXT,                    -- tanggal iklan dimulai (YYYY-MM-DD)
  dilihat           INTEGER NOT NULL DEFAULT 0,
  klik              INTEGER NOT NULL DEFAULT 0,
  keranjang         INTEGER NOT NULL DEFAULT 0,
  konversi          INTEGER NOT NULL DEFAULT 0,
  konversi_langsung INTEGER NOT NULL DEFAULT 0,
  terjual           INTEGER NOT NULL DEFAULT 0,
  terjual_langsung  INTEGER NOT NULL DEFAULT 0,
  omzet             INTEGER NOT NULL DEFAULT 0, -- Omzet Penjualan dari iklan
  omzet_langsung    INTEGER NOT NULL DEFAULT 0,
  biaya             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (laporan_id, urut)
);
