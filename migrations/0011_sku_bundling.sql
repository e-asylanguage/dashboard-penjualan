-- Produk Bundling (Data Produk › Produk Bundling): paket jual yang tersusun dari SKU dasar di sku_produk.
-- HPP otomatis = Σ qty × HPP komponen; hpp_manual (bila diisi) menimpanya.
CREATE TABLE IF NOT EXISTS sku_bundling (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kode       TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- TMB-00001 (otomatis, tidak pernah dipakai ulang) atau kode manual
  nama       TEXT NOT NULL,
  hpp_manual INTEGER,
  kategori   TEXT,
  gudang     TEXT,
  keterangan TEXT,
  niche      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sku_bundling_item (
  bundle_id INTEGER NOT NULL REFERENCES sku_bundling(id) ON DELETE CASCADE,
  sku_id    INTEGER NOT NULL REFERENCES sku_produk(id),
  qty       INTEGER NOT NULL CHECK (qty > 0),
  urut      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, sku_id)
);
