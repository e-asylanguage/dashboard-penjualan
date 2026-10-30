-- Manajemen User: akun login tambahan selain admin utama (secret DASHBOARD_USER / DASHBOARD_PASSWORD).
-- menu = JSON array kunci menu yang boleh dibuka (lihat MENU di src/lib/users.ts); admin=1 → semua menu + kelola user.
-- sesi_sejak: sesi yang dibuat sebelum waktu ini ditolak (diisi saat password diganti / akun dinonaktifkan).
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nama        TEXT,
  pass_hash   TEXT NOT NULL,               -- pbkdf2$iterasi$salt$hash (base64url)
  admin       INTEGER NOT NULL DEFAULT 0,
  menu        TEXT NOT NULL DEFAULT '[]',
  boleh_ubah  INTEGER NOT NULL DEFAULT 0,
  aktif       INTEGER NOT NULL DEFAULT 1,
  sesi_sejak  INTEGER NOT NULL DEFAULT 0,   -- detik epoch
  login_terakhir TEXT,
  dibuat_oleh TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
