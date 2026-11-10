-- Shopee › Iklan: iklan CPAS (Collaborative Ads Meta → Shopee), diisi manual dari laporan Meta Ads Manager.
-- Spend CPAS ditagih Meta, tapi penjualannya terjadi di Shopee, jadi dihitung sebagai biaya iklan Shopee.
-- Seperti laporan iklan Shopee: angka total satu periode (dari–sampai); periode > 1 hari dibagi rata per hari.
CREATE TABLE IF NOT EXISTS shopee_iklan_cpas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  dari        TEXT NOT NULL,                         -- YYYY-MM-DD
  sampai      TEXT NOT NULL,
  biaya       INTEGER NOT NULL DEFAULT 0,            -- spend Meta (Rp)
  omzet       INTEGER NOT NULL DEFAULT 0,            -- nilai pembelian (purchase conversion value) dari Meta, opsional
  konversi    INTEGER NOT NULL DEFAULT 0,            -- jumlah pembelian, opsional
  klik        INTEGER NOT NULL DEFAULT 0,            -- klik tautan, opsional
  kampanye    TEXT,
  ket         TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_iklan_cpas ON shopee_iklan_cpas(toko_id, dari, sampai);
