-- Log History upload Shopee: ringkasan isi file yang terbaca saat upload, dan status akhirnya.
-- status: proses (sedang / terputus) | terbaca | perlu_cek (terbaca tapi ada yang janggal) | gagal. NULL = upload lama (sebelum kolom ini ada).
ALTER TABLE shopee_upload ADD COLUMN ringkasan TEXT;
ALTER TABLE shopee_upload ADD COLUMN status TEXT;
ALTER TABLE shopee_upload ADD COLUMN catatan TEXT;
