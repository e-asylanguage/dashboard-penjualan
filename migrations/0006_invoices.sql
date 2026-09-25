-- Mutasi saldo akun Mengantar (endpoint /invoices): rekonsiliasi COD, potongan ongkir (RTS/non-COD),
-- refund/klaim, top up, dan pencairan ke rekening (typeWithdraw).
CREATE TABLE IF NOT EXISTS mengantar_invoices (
  id            TEXT PRIMARY KEY,      -- _id Mengantar
  inv_number    TEXT,
  type          TEXT NOT NULL,         -- typeReconciliation | typePayment | typeRefund | typeWithdraw | typeAddBalance | …
  status        TEXT,                  -- statusCleared | statusExpired | …
  amount        REAL NOT NULL DEFAULT 0, -- nilai mentah Mengantar; refund bernilai negatif (= menambah saldo)
  balance_after REAL,                  -- saldo setelah transaksi (tidak selalu diisi Mengantar)
  receipt       TEXT,                  -- cnote_no bila transaksi untuk satu resi
  order_id      TEXT,
  description   TEXT,
  bank          TEXT,                  -- pencairan: nama bank + 4 digit terakhir rekening
  paid_at       TEXT,                  -- pencairan: waktu dana dikirim ke rekening
  created_at    TEXT NOT NULL,
  synced_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_minv_type ON mengantar_invoices(type, created_at);
CREATE INDEX IF NOT EXISTS idx_minv_receipt ON mengantar_invoices(receipt);

-- Rincian per resi di dalam invoice rekonsiliasi (subItems)
CREATE TABLE IF NOT EXISTS mengantar_invoice_items (
  invoice_id  TEXT NOT NULL,
  receipt     TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0, -- uang bersih yang masuk saldo untuk resi ini
  cod_amount  REAL,
  cod_fee     REAL,
  PRIMARY KEY (invoice_id, receipt)
);
CREATE INDEX IF NOT EXISTS idx_minvi_receipt ON mengantar_invoice_items(receipt);
