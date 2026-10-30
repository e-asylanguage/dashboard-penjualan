-- Inventory › List Produk: produk buatan sendiri (nama mengikuti nama iklan) dengan HPP manual.
-- Satu SKU tersusun dari satu atau beberapa produk + qty (mis. Buku + Steva); bila komponennya ada,
-- sku_produk.hpp diisi otomatis = Σ qty × HPP produk sehingga laporan laba yang membaca HPP SKU ikut benar.
CREATE TABLE IF NOT EXISTS produk_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nama       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hpp        INTEGER NOT NULL DEFAULT 0,   -- rupiah, berlaku untuk semua gudang
  keterangan TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sku_produk_item (
  sku_id     INTEGER NOT NULL REFERENCES sku_produk(id) ON DELETE CASCADE,
  produk_id  INTEGER NOT NULL REFERENCES produk_list(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  urut       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sku_id, produk_id)
);
CREATE INDEX IF NOT EXISTS idx_sku_produk_item_produk ON sku_produk_item(produk_id);

-- Biaya dari gudang, dikenakan sekali per paket (di luar HPP produk)
ALTER TABLE gudang ADD COLUMN biaya_penanganan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gudang ADD COLUMN biaya_lain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gudang ADD COLUMN biaya_lain_ket TEXT;
