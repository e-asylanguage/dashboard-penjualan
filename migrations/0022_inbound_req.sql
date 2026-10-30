-- Inventory › Inbound REQ: permintaan barang ke supplier → dikirim → diterima gudang (bisa bertahap) → selesai.
-- Qty diterima baik menambah stok gudang tujuan; HPP List Produk bisa diperbarui otomatis (rata-rata tertimbang).
CREATE TABLE IF NOT EXISTS inbound_req (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor       TEXT NOT NULL UNIQUE,          -- REQ-YYMM-NNN
  gudang_id   INTEGER NOT NULL REFERENCES gudang(id),
  supplier    TEXT NOT NULL,
  kontak      TEXT,
  tanggal     TEXT NOT NULL,                 -- tanggal request (YYYY-MM-DD, WIB)
  eta         TEXT,                          -- perkiraan tiba
  resi        TEXT,
  ongkir      INTEGER NOT NULL DEFAULT 0,    -- ongkir masuk, dibagi ke HPP barang
  tagihan     INTEGER,                       -- tagihan supplier; NULL = otomatis Σ harga × qty diterima (baik + rusak)
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | dikirim | sebagian | selesai | batal
  catatan     TEXT,
  oleh        TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_req_status ON inbound_req(status, gudang_id);

CREATE TABLE IF NOT EXISTS inbound_req_item (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id     INTEGER NOT NULL REFERENCES inbound_req(id) ON DELETE CASCADE,
  produk_id  INTEGER NOT NULL REFERENCES produk_list(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),  -- qty diminta
  harga      INTEGER NOT NULL DEFAULT 0,        -- harga beli per pcs
  urut       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inbound_req_item ON inbound_req_item(req_id);

-- Penerimaan: satu batch = satu kali barang datang (beberapa baris item)
CREATE TABLE IF NOT EXISTS inbound_req_terima (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id     INTEGER NOT NULL REFERENCES inbound_req(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES inbound_req_item(id) ON DELETE CASCADE,
  batch      TEXT NOT NULL,
  tanggal    TEXT NOT NULL,                 -- tanggal diterima (YYYY-MM-DD, WIB)
  qty_baik   INTEGER NOT NULL DEFAULT 0,
  qty_rusak  INTEGER NOT NULL DEFAULT 0,
  catatan    TEXT,
  oleh       TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_req_terima ON inbound_req_terima(req_id, batch);

CREATE TABLE IF NOT EXISTS inbound_req_bayar (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id     INTEGER NOT NULL REFERENCES inbound_req(id) ON DELETE CASCADE,
  tanggal    TEXT NOT NULL,
  jumlah     INTEGER NOT NULL,
  catatan    TEXT,
  oleh       TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_req_bayar ON inbound_req_bayar(req_id);

-- Riwayat HPP yang berasal dari penerimaan REQ ditandai supaya ikut terhapus bila penerimaannya dibatalkan
ALTER TABLE produk_hpp ADD COLUMN ref TEXT;
