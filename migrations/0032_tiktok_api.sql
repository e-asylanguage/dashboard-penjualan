-- Penjual TikTok Shop yang memberi izin ke aplikasi (satu baris per open_id), beserta daftar tokonya
-- (shop id, nama, region, cipher). Tidak menyimpan data pembeli.
CREATE TABLE IF NOT EXISTS tiktok_api_akun (
  open_id           TEXT PRIMARY KEY,
  nama              TEXT,
  region            TEXT,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  expire_at         TEXT NOT NULL,
  refresh_expire_at TEXT NOT NULL,
  toko_json         TEXT,              -- [{id, name, region, cipher, code}]
  created_at        TEXT,
  updated_at        TEXT
);
