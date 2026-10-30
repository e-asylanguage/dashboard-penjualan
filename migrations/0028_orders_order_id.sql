-- Paket Mengantar dipasangkan ke order Scalev lewat remark1 = nomor order (Outbound, Stok, Inbound RTS, SKU Mengantar)
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
