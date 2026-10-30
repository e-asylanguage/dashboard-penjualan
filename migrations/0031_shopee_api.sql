-- Toko Shopee yang terhubung lewat Open Platform API (izin pemilik toko). Satu baris per toko per host
-- (sandbox / live), supaya token toko uji tidak tercampur dengan toko asli. Tidak menyimpan data pembeli.
CREATE TABLE IF NOT EXISTS shopee_api_toko (
  shop_id           TEXT NOT NULL,
  host              TEXT NOT NULL,
  nama              TEXT,
  region            TEXT,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  expire_at         TEXT NOT NULL,   -- access_token (± 4 jam)
  refresh_expire_at TEXT NOT NULL,   -- refresh_token (30 hari)
  created_at        TEXT,
  updated_at        TEXT,
  PRIMARY KEY (shop_id, host)
);
