-- Iklan Meta › Konten: editor konten dikenali dari kode di nama iklan (mis. "ABR" di "ABR - Hook Debat v2").
-- codes = JSON array kode (huruf besar), satu editor boleh punya beberapa kode.
CREATE TABLE IF NOT EXISTS editor_konten (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  codes       TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT,
  updated_at  TEXT
);
