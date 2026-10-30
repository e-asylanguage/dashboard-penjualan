-- TikTok Shop › Iklan: dari file "Campaign overview data" (Ads / GMV Max, per jam atau per hari) per toko.
-- jam = 0–23 untuk data per jam, -1 untuk data per hari. Upload ulang tanggal yang sama menggantikan data tanggal itu.
CREATE TABLE IF NOT EXISTS tiktok_iklan (
  toko_id     INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  tgl         TEXT NOT NULL,                 -- YYYY-MM-DD
  jam         INTEGER NOT NULL DEFAULT -1,
  biaya       INTEGER NOT NULL DEFAULT 0,
  pesanan     INTEGER NOT NULL DEFAULT 0,    -- Pesanan SKU (toko saat ini)
  omzet       INTEGER NOT NULL DEFAULT 0,    -- Penghasilan bruto (toko saat ini)
  sumber      TEXT NOT NULL DEFAULT 'file',
  upload_id   INTEGER,
  updated_at  TEXT,
  PRIMARY KEY (toko_id, tgl, jam)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_iklan_tgl ON tiktok_iklan(tgl);
