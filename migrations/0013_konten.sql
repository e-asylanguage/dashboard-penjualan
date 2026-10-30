-- Halaman Iklan Meta › Konten: metrik video per hari dan creative (thumbnail) per ad.
-- video_3s = tayangan video ≥3 detik (action "video_view"), dasar hook rate = video_3s ÷ impressions.
-- video_thruplay = ThruPlay (≥15 detik / selesai), dasar hold rate = video_thruplay ÷ video_3s.
-- video_synced = 1 bila baris ini ditarik setelah kolom video ada; 0 = angka video belum pernah ditarik.
ALTER TABLE ad_insights_daily ADD COLUMN video_3s INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_insights_daily ADD COLUMN video_thruplay INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_insights_daily ADD COLUMN video_p100 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_insights_daily ADD COLUMN video_synced INTEGER NOT NULL DEFAULT 0;

-- Creative per ad. URL thumbnail dari CDN Meta kedaluwarsa, jadi diperbarui ulang tiap ±20 jam.
ALTER TABLE ads ADD COLUMN creative_id TEXT;
ALTER TABLE ads ADD COLUMN object_type TEXT;
ALTER TABLE ads ADD COLUMN thumbnail_url TEXT;
ALTER TABLE ads ADD COLUMN image_url TEXT;
ALTER TABLE ads ADD COLUMN video_id TEXT;
ALTER TABLE ads ADD COLUMN creative_synced_at TEXT;
