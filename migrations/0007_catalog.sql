-- Katalog produk Scalev untuk halaman Data Produk: dikelompokkan menjadi
-- Produk Satuan (PU) / Bundling (PB) / Bonus (BO) / Belum ber-SKU.

-- Satu baris per produk Scalev; last_updated_at dibandingkan dengan list supaya
-- detail (yang memuat SKU & harga varian) hanya diambil ulang bila produk berubah.
CREATE TABLE IF NOT EXISTS catalog_products (
  id               INTEGER PRIMARY KEY,     -- product id Scalev
  name             TEXT NOT NULL,
  status           TEXT,                    -- active | … | deleted (hilang dari list Scalev)
  stores           TEXT,                    -- JSON array nama store
  last_updated_at  TEXT,                    -- dari list Scalev
  detail_synced_at TEXT                     -- NULL = detail belum diambil
);

-- Satu baris per item yang bisa dijual: varian produk ('v:<id>') atau bundle Scalev ('b:<id>').
CREATE TABLE IF NOT EXISTS catalog_items (
  key          TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,               -- variant | bundle
  product_id   INTEGER,                     -- NULL untuk bundle
  product_name TEXT,
  name         TEXT NOT NULL,               -- nama lengkap varian, sama dengan kunci final_variants order
  option_tail  TEXT,                        -- "Opsi1 - Opsi2" untuk mencocokkan nama order lama
  sku          TEXT,
  price        REAL,
  cogs         REAL,
  status       TEXT,
  synced_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_items_product ON catalog_items(product_id);

-- Kategori yang dipilih manual di halaman Data Produk; menimpa tebakan otomatis.
-- item_key = key catalog_items, atau 'n:<nama>' untuk nama produk di order yang tidak ada di katalog.
CREATE TABLE IF NOT EXISTS product_categories (
  item_key   TEXT PRIMARY KEY,
  category   TEXT NOT NULL,                 -- PU | PB | BO | NONE
  updated_at TEXT
);
