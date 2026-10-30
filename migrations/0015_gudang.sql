-- Inventory › List Gudang: daftar gudang buatan sendiri beserta jenisnya, dan pasangan nama
-- gudang pengirim di Mengantar (SHIPPER_NAME) ke gudang tersebut. Data Mengantar tidak diubah.
CREATE TABLE IF NOT EXISTS gudang (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nama       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  jenis      TEXT NOT NULL DEFAULT 'sendiri',   -- sendiri | fulfillment | dropship
  kontak     TEXT,                              -- PIC / no HP supplier
  keterangan TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Satu nama pengirim Mengantar hanya dipasangkan ke satu gudang; satu gudang boleh punya beberapa nama.
CREATE TABLE IF NOT EXISTS gudang_pengirim (
  shipper    TEXT PRIMARY KEY COLLATE NOCASE,
  gudang_id  INTEGER NOT NULL REFERENCES gudang(id) ON DELETE CASCADE,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gudang_pengirim_gudang ON gudang_pengirim(gudang_id);
