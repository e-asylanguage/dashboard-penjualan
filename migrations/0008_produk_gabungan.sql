-- Gabungan produk di halaman Data Produk: beberapa item katalog (varian / bundle / nama di order)
-- disatukan dengan satu nama supaya lead, closing, dan omzetnya terbaca bersama.
CREATE TABLE IF NOT EXISTS produk_gabungan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  items      TEXT NOT NULL,                 -- JSON [{key, name}]; name = nama saat dipilih, dipakai bila item hilang dari katalog
  created_at TEXT,
  updated_at TEXT
);
