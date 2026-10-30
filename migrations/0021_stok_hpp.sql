-- Riwayat HPP List Produk: setiap perubahan HPP dicatat dengan tanggal berlaku, supaya paket / order lama tetap
-- memakai HPP yang berlaku pada tanggalnya. produk_list.hpp tetap menyimpan HPP terbaru (yang berlaku hari ini).
CREATE TABLE IF NOT EXISTS produk_hpp (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  produk_id  INTEGER NOT NULL REFERENCES produk_list(id) ON DELETE CASCADE,
  berlaku    TEXT NOT NULL,                 -- YYYY-MM-DD (WIB), berlaku sejak tanggal ini
  hpp        INTEGER NOT NULL,              -- rupiah
  sumber     TEXT NOT NULL DEFAULT 'manual',-- awal | manual | req (nanti: barang REQ diterima)
  catatan    TEXT,
  created_at TEXT,
  UNIQUE (produk_id, berlaku)
);
-- HPP yang ada sekarang menjadi HPP awal yang berlaku untuk semua tanggal sebelumnya
INSERT OR IGNORE INTO produk_hpp (produk_id, berlaku, hpp, sumber, created_at)
  SELECT id, '2000-01-01', hpp, 'awal', datetime('now') FROM produk_list;

-- Mutasi stok yang dicatat manual per produk × gudang: stok awal, opname / penyesuaian (nanti juga REQ & transfer).
-- Barang keluar (Outbound) dan retur diterima baik (Inbound RTS) dihitung langsung dari data paket Mengantar.
CREATE TABLE IF NOT EXISTS stok_mutasi (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal    TEXT NOT NULL,                 -- YYYY-MM-DD (WIB)
  produk_id  INTEGER NOT NULL REFERENCES produk_list(id),
  gudang_id  INTEGER NOT NULL REFERENCES gudang(id),
  jenis      TEXT NOT NULL,                 -- awal | opname
  qty        INTEGER NOT NULL,              -- + masuk / − keluar (opname = selisih fisik − sistem)
  catatan    TEXT,
  oleh       TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stok_mutasi ON stok_mutasi(gudang_id, produk_id, tanggal);
-- Stok awal hanya satu per produk × gudang
CREATE UNIQUE INDEX IF NOT EXISTS idx_stok_awal ON stok_mutasi(produk_id, gudang_id) WHERE jenis='awal';

-- Tanggal stok awal: pergerakan barang sebelum tanggal ini tidak mengubah stok
INSERT OR IGNORE INTO kv (key, value) VALUES ('stok_mulai', '2026-09-01');
