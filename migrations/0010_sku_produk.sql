-- Manajemen SKU (Data Produk › Manajemen SKU): master SKU internal dengan HPP, gudang, dan niche.
-- Diisi manual / impor CSV, terpisah dari katalog Scalev.
CREATE TABLE IF NOT EXISTS sku_produk (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sku        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  produk     TEXT NOT NULL,
  hpp        INTEGER NOT NULL DEFAULT 0,    -- rupiah
  kategori   TEXT,                          -- produk category
  gudang     TEXT,
  keterangan TEXT,
  niche      TEXT,
  created_at TEXT,
  updated_at TEXT
);
