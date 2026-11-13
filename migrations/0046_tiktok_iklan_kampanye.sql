-- TikTok Shop › Iklan › tab "Per campaign": dari file "Product campaign data" (Ads / GMV Max), satu baris per kampanye per hari.
-- Tanggal yang ada di file menggantikan data kampanye toko itu pada tanggal tersebut (sama seperti tiktok_iklan).
-- Total per hari tetap di tiktok_iklan; tabel ini hanya rincian per kampanye.
CREATE TABLE IF NOT EXISTS tiktok_iklan_kampanye (
  toko_id     INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  tgl         TEXT NOT NULL,                 -- YYYY-MM-DD
  kampanye_id TEXT NOT NULL,                 -- ID Campaign
  nama        TEXT,                          -- Nama kampanye
  biaya       INTEGER NOT NULL DEFAULT 0,
  pesanan     INTEGER NOT NULL DEFAULT 0,    -- Pesanan SKU
  omzet       INTEGER NOT NULL DEFAULT 0,    -- Pendapatan kotor
  upload_id   INTEGER,
  updated_at  TEXT,
  PRIMARY KEY (toko_id, tgl, kampanye_id)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_iklan_kampanye_tgl ON tiktok_iklan_kampanye(tgl);
