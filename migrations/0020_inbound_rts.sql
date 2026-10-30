-- Inventory › Inbound RTS: paket retur Mengantar dikonfirmasi sudah diterima gudang.
-- Kondisi (baik / rusak / hilang) tetap di outbound_kondisi; diterima_at kosong = belum diterima.
-- Hanya yang diterima dalam kondisi baik nantinya menambah stok.
ALTER TABLE outbound_kondisi ADD COLUMN diterima_at TEXT;
ALTER TABLE outbound_kondisi ADD COLUMN diterima_oleh TEXT;

-- Retur dengan tanggal RTS sebelum tanggal ini dianggap sudah beres sebelum Inbound RTS dipakai,
-- supaya tidak menumpuk di daftar "menunggu diterima". Bisa diubah dari halaman Inbound RTS.
INSERT OR IGNORE INTO kv (key, value) VALUES ('inbound_rts_mulai', '2026-09-01');
