-- Tag order Scalev (JSON array), dipakai sebagai alasan pembatalan di halaman Performa CS.
--
-- Kolom `notes` yang semula dipakai untuk cancel_reason ternyata hampir selalu kosong
-- (pada data 12 Jun-23 Sep 2026: 0 dari 263 order batal terisi), sedangkan tim memakai
-- tag untuk menandai alasan batal.
ALTER TABLE orders ADD COLUMN tags TEXT;

-- Isi dari data yang sudah ada: Scalev menyertakan `tags` di payload order walaupun
-- tidak diminta lewat parameter `columns`, jadi raw_json sudah memuatnya dan tidak
-- perlu menarik ulang dari API.
UPDATE orders SET tags = json_extract(raw_json, '$.tags') WHERE raw_json IS NOT NULL;
