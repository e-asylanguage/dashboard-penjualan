-- Catatan follow up WhatsApp ke pembeli untuk paket bermasalah (halaman Mengantar › Tracking & Masalah).
-- Satu baris per resi; status = hasil follow up terakhir.
CREATE TABLE IF NOT EXISTS shipment_followups (
  receipt   TEXT PRIMARY KEY,
  status    TEXT NOT NULL DEFAULT 'dihubungi',  -- dihubungi | siap_terima | tidak_respon | menolak | selesai
  note      TEXT,
  wa_count  INTEGER NOT NULL DEFAULT 0,          -- berapa kali tombol WA dibuka
  first_at  TEXT,
  last_at   TEXT
);
