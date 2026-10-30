-- Shopee › Iklan: laporan dari Ads API (satu laporan per toko × hari, sumber='api') atau upload file (sumber='file')
ALTER TABLE shopee_iklan_laporan ADD COLUMN sumber TEXT NOT NULL DEFAULT 'file';
