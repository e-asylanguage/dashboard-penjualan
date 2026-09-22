-- Perjalanan paket dari Mengantar + kolom resi di orders untuk join.

ALTER TABLE orders ADD COLUMN shipment_receipt TEXT;        -- nomor resi (Scalev) = cnote_no (Mengantar)
ALTER TABLE orders ADD COLUMN courier_name TEXT;
ALTER TABLE orders ADD COLUMN scalev_shipment_status TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_receipt ON orders(shipment_receipt);

CREATE TABLE IF NOT EXISTS shipments (
  id                TEXT PRIMARY KEY,        -- _id Mengantar
  mengantar_order_id TEXT,                   -- ORDER_ID Mengantar
  receipt           TEXT,                    -- cnote_no (resi); null bila belum terbit
  courier           TEXT,
  service_code      TEXT,
  status            TEXT,                    -- status mentah dari Mengantar
  status_category   TEXT,                    -- statusCategory Mengantar
  status_simple     TEXT NOT NULL DEFAULT 'ON_GOING', -- DELIVERED | RTS | ON_GOING
  last_status_change TEXT,
  is_cod            INTEGER NOT NULL DEFAULT 0,
  cod_amount        REAL NOT NULL DEFAULT 0,
  cod_fee           REAL NOT NULL DEFAULT 0,
  price             REAL NOT NULL DEFAULT 0, -- ongkir yang dibayar ke Mengantar
  is_paid           INTEGER,
  receiver_city     TEXT,
  receiver_region   TEXT,
  receiver_phone_last4 TEXT,
  weight            REAL,
  created_at        TEXT,                    -- createdAt Mengantar (paket dibuat)
  updated_at        TEXT,
  delivered_at      TEXT,                    -- diturunkan dari history
  rts_at            TEXT,
  undelivered_count INTEGER NOT NULL DEFAULT 0,
  last_event_at     TEXT,
  last_event_note   TEXT,
  history_json      TEXT,                    -- history[] mentah
  raw_json          TEXT,
  synced_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_ship_receipt ON shipments(receipt);
CREATE INDEX IF NOT EXISTS idx_ship_status ON shipments(status_simple, courier);
CREATE INDEX IF NOT EXISTS idx_ship_created ON shipments(created_at);
