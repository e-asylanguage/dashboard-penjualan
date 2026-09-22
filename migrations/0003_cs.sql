-- Handler (CS) per order + follow-up, untuk halaman Performa CS.
ALTER TABLE orders ADD COLUMN handler_id INTEGER;
ALTER TABLE orders ADD COLUMN handler_name TEXT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;      -- dari notes/metadata bila ada
ALTER TABLE orders ADD COLUMN follow_up_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_handler ON orders(handler_id, draft_date);
