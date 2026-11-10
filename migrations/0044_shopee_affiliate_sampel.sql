-- Shopee › Iklan: sampel produk gratis untuk affiliate (marketing tambahan di luar komisi AMS), diisi manual.
-- Nilai = qty × HPP per unit (HPP List Produk yang berlaku pada tanggal kirim, atau diisi manual) + ongkir kirim sampel.
-- Dihitung menurut tanggal kirim sebagai spending kanal Affiliate (Penghasilan Shopee) dan biaya Shopee di Laba Rugi.
CREATE TABLE IF NOT EXISTS shopee_affiliate_sampel (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  toko_id     INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  tgl         TEXT NOT NULL,                         -- YYYY-MM-DD sampel dikirim
  affiliate   TEXT NOT NULL,                         -- nama / username affiliate
  produk_id   INTEGER REFERENCES produk_list(id) ON DELETE SET NULL,
  produk      TEXT NOT NULL,                         -- nama produk (salinan, tetap ada bila produk dihapus)
  qty         INTEGER NOT NULL DEFAULT 1,
  hpp         INTEGER NOT NULL DEFAULT 0,            -- HPP per unit saat dicatat
  ongkir      INTEGER NOT NULL DEFAULT 0,
  nilai       INTEGER NOT NULL DEFAULT 0,            -- qty × hpp + ongkir
  ket         TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_affiliate_sampel ON shopee_affiliate_sampel(toko_id, tgl);
