-- SKU memilih gudang dari List Gudang; biaya gudang (penanganan + lain, per paket) ditambahkan ke HPP.
-- hpp_dasar = HPP produk (manual, atau Σ qty × HPP List Produk); hpp = hpp_dasar + biaya gudang,
-- sehingga laporan laba yang membaca sku_produk.hpp sudah termasuk biaya gudang.
ALTER TABLE sku_produk ADD COLUMN gudang_id INTEGER REFERENCES gudang(id);
ALTER TABLE sku_produk ADD COLUMN hpp_dasar INTEGER;

UPDATE sku_produk SET hpp_dasar = hpp;
-- Isian gudang lama (teks) yang namanya sama dengan List Gudang langsung tersambung
UPDATE sku_produk SET gudang_id = (SELECT g.id FROM gudang g WHERE g.nama = TRIM(sku_produk.gudang) COLLATE NOCASE)
  WHERE gudang IS NOT NULL AND TRIM(gudang) <> '';
UPDATE sku_produk SET hpp = hpp_dasar + COALESCE((SELECT g.biaya_penanganan + g.biaya_lain FROM gudang g WHERE g.id = sku_produk.gudang_id), 0)
  WHERE gudang_id IS NOT NULL;
