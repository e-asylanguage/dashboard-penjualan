-- Shopee › Penghasilan: dari file Excel "Income.sudah dilepas…" (sheet Penghasilan, baris "Order").
-- Biaya dikelompokkan mengikuti judul kelompok Shopee (baris ke-2 sheet): Platform, Gratis Ongkir XTRA, Layanan, Promosi, Lainnya, Pajak.
-- Semua angka bertanda seperti di file: biaya negatif, pemasukan positif. Data pembeli tidak disimpan.
CREATE TABLE IF NOT EXISTS shopee_penghasilan (
  no_pesanan      TEXT PRIMARY KEY,
  toko_id         INTEGER NOT NULL REFERENCES shopee_toko(id) ON DELETE CASCADE,
  dibuat          TEXT,                      -- tanggal pesanan dibuat (YYYY-MM-DD)
  dilepas         TEXT NOT NULL,             -- tanggal dana dilepaskan (YYYY-MM-DD)
  metode_pelepasan TEXT,
  tipe_pesanan    TEXT,
  harga_produk    INTEGER NOT NULL DEFAULT 0,
  refund          INTEGER NOT NULL DEFAULT 0, -- pengembalian dana ke pembeli
  ongkir          INTEGER NOT NULL DEFAULT 0, -- Σ kelompok ongkos kirim (biasanya impas = 0)
  voucher         INTEGER NOT NULL DEFAULT 0, -- Σ voucher & potongan harga ditanggung penjual
  biaya_platform  INTEGER NOT NULL DEFAULT 0,
  biaya_gox       INTEGER NOT NULL DEFAULT 0, -- Gratis Ongkir XTRA
  biaya_layanan   INTEGER NOT NULL DEFAULT 0,
  biaya_promosi   INTEGER NOT NULL DEFAULT 0, -- komisi AMS, kampanye (tanpa isi saldo iklan)
  biaya_lainnya   INTEGER NOT NULL DEFAULT 0,
  pajak           INTEGER NOT NULL DEFAULT 0,
  isi_saldo_iklan INTEGER NOT NULL DEFAULT 0, -- top up saldo iklan otomatis dari penghasilan (bukan biaya Shopee)
  total           INTEGER NOT NULL DEFAULT 0, -- Total Penghasilan (dana yang dilepas)
  dibayar_pembeli INTEGER NOT NULL DEFAULT 0,
  metode_bayar    TEXT,
  kurir           TEXT,
  produk          TEXT,                      -- JSON [{id, nama}] dari baris "Sku"
  rincian         TEXT,                      -- JSON {"kelompok|nama kolom": angka} semua kolom uang
  upload_id       INTEGER,
  created_at      TEXT,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopee_penghasilan_dilepas ON shopee_penghasilan(dilepas);
CREATE INDEX IF NOT EXISTS idx_shopee_penghasilan_toko ON shopee_penghasilan(toko_id, dilepas);
