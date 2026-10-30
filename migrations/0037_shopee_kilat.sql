-- Pesanan Pengiriman Kilat (dikirim dari stok di gudang Shopee, fulfillment_flag = fulfilled_by_shopee):
-- tidak mengurangi stok gudang sendiri / mitra. NULL = belum diketahui (file ekspor, atau belum tersinkron ulang dari API).
ALTER TABLE shopee_pesanan ADD COLUMN kilat INTEGER;
