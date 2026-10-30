-- Shopee › Live: rincian produk terjual dari live (ekspor "sc_live_product_list"), menempel ke laporan Live toko & periode yang sama.
-- HPP live dihitung dari produk ini: terjual × HPP per unit produk bernama sama di pesanan toko (lihat routes/shopee.ts).
ALTER TABLE shopee_live ADD COLUMN user_id TEXT;   -- User Id di file Live, untuk mengenali toko pada upload berikutnya

CREATE TABLE IF NOT EXISTS shopee_live_produk (
  live_id       INTEGER NOT NULL REFERENCES shopee_live(id) ON DELETE CASCADE,
  urut          INTEGER NOT NULL,              -- Ranking
  produk        TEXT NOT NULL,                 -- nama produk (sama dengan Nama Produk di file Pesanan)
  klik          INTEGER NOT NULL DEFAULT 0,
  keranjang     INTEGER NOT NULL DEFAULT 0,
  pesanan       INTEGER NOT NULL DEFAULT 0,    -- Pesanan (Pesanan Siap Dikirim)
  terjual       INTEGER NOT NULL DEFAULT 0,    -- Produk Terjual (Pesanan Siap Dikirim)
  omzet         INTEGER NOT NULL DEFAULT 0,    -- Penjualan (Pesanan Siap Dikirim)
  omzet_dibuat  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (live_id, urut)
);
CREATE INDEX IF NOT EXISTS idx_shopee_item_nama ON shopee_pesanan_item(nama);
