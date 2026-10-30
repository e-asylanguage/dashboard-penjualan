-- TikTok Shop › Live: dari file "Live Performance Core Stats" (Seller Center → Analitik → LIVE), satu baris per hari per toko.
-- Upload ulang tanggal yang sama menggantikan data tanggal itu. File tidak memuat biaya → biaya live diisi manual per periode (tiktok_live_biaya).
CREATE TABLE IF NOT EXISTS tiktok_live (
  toko_id              INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  tgl                  TEXT NOT NULL,                -- YYYY-MM-DD
  omzet                INTEGER NOT NULL DEFAULT 0,   -- GMV dari LIVE (langsung + tidak langsung)
  omzet_langsung       INTEGER NOT NULL DEFAULT 0,   -- GMV LIVE
  omzet_tidak_langsung INTEGER NOT NULL DEFAULT 0,   -- GMV tidak langsung dari LIVE
  siaran               INTEGER NOT NULL DEFAULT 0,   -- Siaran LIVE
  terjual              INTEGER NOT NULL DEFAULT 0,   -- Produk yang terjual melalui LIVE
  pesanan              INTEGER NOT NULL DEFAULT 0,   -- Pesanan SKU teratribusi
  tayangan             INTEGER NOT NULL DEFAULT 0,   -- Tayangan LIVE
  upload_id            INTEGER,
  updated_at           TEXT,
  PRIMARY KEY (toko_id, tgl)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_live_tgl ON tiktok_live(tgl);

CREATE TABLE IF NOT EXISTS tiktok_live_biaya (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES tiktok_toko(id) ON DELETE CASCADE,
  dari        TEXT NOT NULL,                         -- biaya dibagi rata per hari dari s/d sampai
  sampai      TEXT NOT NULL,
  spending    INTEGER NOT NULL DEFAULT 0,            -- fee host, iklan live, dll.
  ket         TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tiktok_live_biaya ON tiktok_live_biaya(toko_id, dari, sampai);
