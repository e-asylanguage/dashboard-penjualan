-- Inbound REQ: berkas pengiriman (foto / scan resi, surat jalan, invoice supplier). Isi disimpan base64 di D1
-- (foto dikecilkan di browser sebelum upload; batas ±1,4 MB per berkas karena batas baris D1 2 MB).
CREATE TABLE IF NOT EXISTS inbound_req_berkas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  req_id      INTEGER NOT NULL REFERENCES inbound_req(id) ON DELETE CASCADE,
  jenis       TEXT NOT NULL DEFAULT 'resi',   -- resi | surat_jalan | invoice | lain
  nama        TEXT NOT NULL,                  -- nama file asli
  tipe        TEXT NOT NULL,                  -- MIME (image/jpeg, application/pdf, …)
  ukuran      INTEGER NOT NULL,               -- byte setelah dikecilkan
  data        TEXT NOT NULL,                  -- base64
  resi        TEXT,                           -- nomor resi yang terbaca dari barcode (bila ada)
  oleh        TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_req_berkas ON inbound_req_berkas(req_id);
