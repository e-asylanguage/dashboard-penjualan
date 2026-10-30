-- Token Meta per BM bisa diisi dari halaman Pengaturan › Sinkronisasi Meta Ads, jadi disimpan di D1.
-- Bila kosong, token masih dibaca dari secret Worker yang namanya ada di token_secret (cara lama).
-- Token tidak pernah dikirim balik ke browser.
ALTER TABLE business_managers ADD COLUMN token TEXT;
ALTER TABLE business_managers ADD COLUMN token_owner TEXT;     -- nama user/system user pemilik token (dari /me)
ALTER TABLE business_managers ADD COLUMN token_checked_at TEXT;
ALTER TABLE business_managers ADD COLUMN token_error TEXT;     -- pesan error terakhir saat token dipakai; NULL = sehat
