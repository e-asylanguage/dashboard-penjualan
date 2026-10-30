-- Data Produk › SKU Mengantar: nama barang Mengantar boleh dipasangkan langsung ke List Produk
-- (satu atau beberapa produk + qty per paket, mis. "Paket Hemat" → 2× Buku + 1× Steva), tanpa lewat SKU.
-- Satu nama barang dipasangkan ke SKU (barang_sku) ATAU langsung ke produk (barang_produk), tidak keduanya.
CREATE TABLE IF NOT EXISTS barang_produk (
  goods      TEXT NOT NULL COLLATE NOCASE,
  produk_id  INTEGER NOT NULL REFERENCES produk_list(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  urut       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (goods, produk_id)
);
CREATE INDEX IF NOT EXISTS idx_barang_produk_produk ON barang_produk(produk_id);
