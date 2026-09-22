-- Skema awal dashboard marketing. Nominal dalam rupiah, tanggal = YYYY-MM-DD (Asia/Jakarta).

CREATE TABLE IF NOT EXISTS business_managers (
  id            TEXT PRIMARY KEY,          -- slug: unika | tomojoyo | steva
  name          TEXT NOT NULL,
  app_id        TEXT,
  token_secret  TEXT NOT NULL,             -- nama secret di Worker, mis. META_TOKEN_UNIKA
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id            TEXT PRIMARY KEY,          -- act_123...
  bm_id         TEXT NOT NULL REFERENCES business_managers(id),
  name          TEXT NOT NULL,
  currency      TEXT,
  status        INTEGER,
  is_selected   INTEGER NOT NULL DEFAULT 0, -- dicentang di halaman Pengaturan
  store_id      INTEGER,                    -- store Scalev yang dipasangkan
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id            INTEGER PRIMARY KEY,        -- store_id Scalev
  name          TEXT NOT NULL,
  is_selected   INTEGER NOT NULL DEFAULT 0,
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT,
  objective     TEXT,
  product_group TEXT,                       -- NULL = belum dipetakan
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS adsets (
  id            TEXT PRIMARY KEY,
  campaign_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT
);

CREATE TABLE IF NOT EXISTS ads (
  id            TEXT PRIMARY KEY,
  adset_id      TEXT NOT NULL,
  campaign_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT
);

-- Insight harian per ad (Meta, level=ad, time_increment=1)
CREATE TABLE IF NOT EXISTS ad_insights_daily (
  date          TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  campaign_id   TEXT NOT NULL,
  adset_id      TEXT NOT NULL,
  ad_id         TEXT NOT NULL,
  spend         REAL NOT NULL DEFAULT 0,
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  reach         INTEGER NOT NULL DEFAULT 0,
  link_clicks   INTEGER NOT NULL DEFAULT 0,
  pixel_purchases INTEGER NOT NULL DEFAULT 0,
  pixel_purchase_value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (date, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_insights_date_campaign ON ad_insights_daily(date, campaign_id);

-- Order Scalev (satu baris per order, diperbarui saat status berubah)
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,         -- uuid Scalev
  order_id        TEXT NOT NULL,
  store_id        INTEGER,
  store_name      TEXT,
  status          TEXT NOT NULL,
  payment_status  TEXT,
  payment_method  TEXT,
  is_cod          INTEGER NOT NULL DEFAULT 0,
  gross_revenue   REAL NOT NULL DEFAULT 0,
  net_revenue     REAL NOT NULL DEFAULT 0,
  shipping_cost   REAL NOT NULL DEFAULT 0,
  product_discount REAL NOT NULL DEFAULT 0,
  draft_date      TEXT NOT NULL,            -- tanggal acuan (WIB)
  draft_time      TEXT,
  confirmed_time  TEXT,
  shipped_time    TEXT,
  completed_time  TEXT,
  rts_time        TEXT,
  canceled_time   TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,                     -- = campaign.id Meta
  utm_term        TEXT,                     -- = adset.id Meta
  utm_content     TEXT,                     -- = ad.id Meta
  product_names   TEXT,                     -- JSON array nama produk
  city            TEXT,
  province        TEXT,
  is_spam         INTEGER NOT NULL DEFAULT 0,
  raw_json        TEXT,
  last_updated_at TEXT,
  synced_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_draft_date ON orders(draft_date);
CREATE INDEX IF NOT EXISTS idx_orders_utm_content ON orders(utm_content);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, draft_date);

CREATE TABLE IF NOT EXISTS product_groups (
  id            TEXT PRIMARY KEY,           -- slug
  name          TEXT NOT NULL,
  store_id      INTEGER,
  match_prefix  TEXT                        -- auto-map campaign yang namanya diawali ini, mis. "UNIKA-SPRAY"
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,                -- meta:unika | scalev:orders | summary
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,
  rows        INTEGER DEFAULT 0,
  message     TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO business_managers (id, name, app_id, token_secret) VALUES
  ('unika',    'Unika Store Soscom',  '1598094575200630', 'META_TOKEN_UNIKA'),
  ('tomojoyo', 'Tomojoyo Soscom',     '1059685247069139', 'META_TOKEN_TOMOJOYO'),
  ('steva',    'Steva Pusat Soscom',  '1101963602413882', 'META_TOKEN_STEVA');
