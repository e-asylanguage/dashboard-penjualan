-- Komponen SKU bertanda bonus (mis. parfum / buku kecil yang ikut gratis): tetap masuk HPP & stok,
-- tetapi tidak dihitung sebagai pcs terjual (Sold di Per CS, pcs di Margin Produk).
ALTER TABLE sku_produk_item ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0;

-- SKU yang sudah ada: komponen bonus pada paket buku
UPDATE sku_produk_item SET bonus=1
WHERE sku_id IN (SELECT id FROM sku_produk WHERE sku IN ('AQWBUKQUR001','AQWBUKQUR002','AQWBUKDEB001'))
  AND produk_id IN (SELECT id FROM produk_list WHERE nama IN ('Buku 3 Surah Pilihan','Parfum Syammail'));
