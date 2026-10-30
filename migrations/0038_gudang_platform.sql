-- Pesanan yang dikirim dari gudang platform: Pengiriman Kilat Shopee (shopee_pesanan.kilat) dan Fulfilled by TikTok
-- (tiktok_pesanan.fbt; NULL = belum diketahui). Stoknya dikurangi dari "gudang Kilat / FBT" toko (gudang_platform_id);
-- bila toko belum punya gudang Kilat / FBT, pesanan itu tidak mengurangi stok gudang mana pun.
ALTER TABLE tiktok_pesanan ADD COLUMN fbt INTEGER;
ALTER TABLE shopee_toko ADD COLUMN gudang_platform_id INTEGER REFERENCES gudang(id) ON DELETE SET NULL;
ALTER TABLE tiktok_toko ADD COLUMN gudang_platform_id INTEGER REFERENCES gudang(id) ON DELETE SET NULL;
