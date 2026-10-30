-- Inventory › Outbound: barang keluar dari data paket Mengantar (data Mengantar sendiri tidak diubah).
-- Nama barang Mengantar (GOODS_DESC) dipasangkan ke satu SKU + qty SKU per paket,
-- mis. "Nokto Guard Beli 2 Gratis 1" → SKU Nokto Guard × 3.
CREATE TABLE IF NOT EXISTS barang_sku (
  goods      TEXT PRIMARY KEY COLLATE NOCASE,
  sku_id     INTEGER NOT NULL REFERENCES sku_produk(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_barang_sku_sku ON barang_sku(sku_id);

-- Kondisi barang paket yang kembali (RTS) / hilang: baik | rusak | hilang, plus catatan.
-- Tanpa baris di sini: RTS dianggap kembali baik, PARCEL LOST dianggap hilang.
CREATE TABLE IF NOT EXISTS outbound_kondisi (
  receipt    TEXT PRIMARY KEY,
  kondisi    TEXT NOT NULL,
  catatan    TEXT,
  updated_at TEXT
);
