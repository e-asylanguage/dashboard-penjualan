-- Insight Meta per akun & tanggal: dipakai sinkron (membaca insight tersimpan satu akun untuk 3–4 hari terakhir
-- sebelum menulis, supaya baris yang sama tidak dikirim lagi) dan halaman Pengaturan (spend 30 hari per akun).
-- Sebelumnya hanya ada indeks (date, campaign_id), jadi filter per akun membaca insight semua akun.
CREATE INDEX IF NOT EXISTS idx_insights_account_date ON ad_insights_daily(account_id, date);
