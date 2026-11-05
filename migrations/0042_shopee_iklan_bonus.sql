-- Shopee › Iklan: bonus proteksi ROAS (kredit iklan dari Shopee saat ROAS GMV Max di bawah target), diisi manual.
-- API & file laporan iklan tidak memuat bonus ini. Dihitung menurut tanggal bonus diterima (tgl).
CREATE TABLE IF NOT EXISTS shopee_iklan_bonus (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  tgl         TEXT NOT NULL,                         -- YYYY-MM-DD bonus masuk ke saldo iklan
  nominal     INTEGER NOT NULL DEFAULT 0,
  dari        TEXT,                                  -- periode iklan yang dilindungi (opsional)
  sampai      TEXT,
  kampanye    TEXT,                                  -- nama iklan / grup iklan (opsional)
  ket         TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_iklan_bonus ON shopee_iklan_bonus(toko_id, tgl);
