-- Laporan › Biaya Operasional: biaya bulanan di luar sistem (gaji, sewa, listrik, tools, …) yang dicatat manual.
-- Masuk ke Laba Rugi (menurut bulan `tanggal`) dan Arus Kas (uang keluar pada `tanggal`).
CREATE TABLE IF NOT EXISTS biaya_operasional (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal     TEXT NOT NULL,                 -- YYYY-MM-DD (WIB)
  kategori    TEXT NOT NULL,
  keterangan  TEXT,
  jumlah      INTEGER NOT NULL CHECK (jumlah >= 0),
  oleh        TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_biaya_operasional_tanggal ON biaya_operasional(tanggal);
