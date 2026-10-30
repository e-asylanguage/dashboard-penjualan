-- Sumber data per toko marketplace: 'api' (sinkron otomatis Open API) atau 'upload' (file ekspor Seller Center).
-- Setiap baris pesanan / penghasilan mencatat dari mana datanya ('api' | 'file'); upload file tidak menimpa baris dari API.
ALTER TABLE shopee_toko ADD COLUMN mode TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE shopee_pesanan ADD COLUMN sumber TEXT NOT NULL DEFAULT 'file';
ALTER TABLE shopee_penghasilan ADD COLUMN sumber TEXT NOT NULL DEFAULT 'file';
ALTER TABLE tiktok_toko ADD COLUMN mode TEXT NOT NULL DEFAULT 'api';
