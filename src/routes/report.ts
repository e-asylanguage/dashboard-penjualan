import { Hono } from "hono";
import { Env, daysAgo, todayReport } from "../env";

export const report = new Hono<{ Bindings: Env }>();

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from") ?? daysAgo(29);
  const to = c.req.query("to") ?? todayReport();
  return { from, to };
}

/** Metrik order per kunci (ad_id / campaign / store / tanggal) dalam satu query. */
const ORDER_AGG = `
  COUNT(*)                                                               AS orders,
  SUM(is_cod)                                                            AS orders_cod,
  SUM(CASE WHEN status IN ('confirmed','in_process','ready','shipped','shipped_rts','completed','rts') THEN 1 ELSE 0 END) AS confirmed,
  SUM(CASE WHEN status IN ('shipped','shipped_rts','completed','rts') THEN 1 ELSE 0 END)   AS shipped,
  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)                    AS completed,
  SUM(CASE WHEN status IN ('rts','shipped_rts','canceled') THEN 1 ELSE 0 END) AS lost,
  SUM(gross_revenue)                                                     AS gross_all,
  SUM(CASE WHEN status IN ('confirmed','in_process','ready','shipped','shipped_rts','completed','rts') THEN gross_revenue ELSE 0 END) AS gross_confirmed,
  SUM(CASE WHEN payment_status IN ('paid','settled') THEN gross_revenue ELSE 0 END) AS revenue_paid,
  SUM(CASE WHEN status IN ('rts','shipped_rts','canceled') THEN gross_revenue ELSE 0 END) AS revenue_lost,
  SUM(CASE WHEN payment_status IN ('paid','settled') THEN shipping_cost ELSE 0 END) AS shipping_paid`;

/** Ringkasan: pipeline + total spend. */
report.get("/summary", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const orders = await c.env.DB.prepare(
    `SELECT ${ORDER_AGG} FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? ${store ? "AND store_id=?" : ""}`)
    .bind(...(store ? [from, to, store] : [from, to])).first();
  const spend = await c.env.DB.prepare(
    `SELECT ROUND(SUM(i.spend)) AS spend, SUM(i.impressions) AS impressions, SUM(i.clicks) AS clicks, COUNT(DISTINCT i.campaign_id) AS campaigns
     FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
     WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? ${store ? "AND a.store_id=?" : ""}`)
    .bind(...(store ? [from, to, store] : [from, to])).first();
  return c.json({ from, to, orders, spend });
});

/** Deret harian: spend, order masuk, revenue cair (untuk grafik). */
report.get("/daily", async c => {
  const { from, to } = range(c);
  const rows = await c.env.DB.prepare(
    `WITH d AS (SELECT date, ROUND(SUM(spend)) AS spend FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE a.is_selected=1 AND date BETWEEN ? AND ? GROUP BY date),
          o AS (SELECT draft_date AS date, COUNT(*) AS orders, SUM(CASE WHEN payment_status IN ('paid','settled') THEN gross_revenue ELSE 0 END) AS revenue_paid
                FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? GROUP BY draft_date)
     SELECT COALESCE(d.date,o.date) AS date, COALESCE(d.spend,0) AS spend, COALESCE(o.orders,0) AS orders, COALESCE(o.revenue_paid,0) AS revenue_paid
     FROM d LEFT JOIN o ON o.date=d.date UNION SELECT o.date, 0, o.orders, o.revenue_paid FROM o WHERE o.date NOT IN (SELECT date FROM d) ORDER BY date`)
    .bind(from, to, from, to).all();
  return c.json(rows.results);
});

/** Tabel Iklan: BM → campaign → adset → ad dengan spend + order via UTM. */
report.get("/ads", async c => {
  const { from, to } = range(c);
  const rows = await c.env.DB.prepare(
    `SELECT a.bm_id, b.name AS bm_name, i.account_id, i.campaign_id, cp.name AS campaign_name, cp.status AS campaign_status, cp.product_group,
            i.adset_id, s.name AS adset_name, i.ad_id, ad.name AS ad_name,
            ROUND(SUM(i.spend)) AS spend, SUM(i.impressions) AS impressions, SUM(i.clicks) AS clicks, SUM(i.pixel_purchases) AS pixel_purchases
     FROM ad_insights_daily i
     JOIN ad_accounts a ON a.id=i.account_id JOIN business_managers b ON b.id=a.bm_id
     LEFT JOIN campaigns cp ON cp.id=i.campaign_id LEFT JOIN adsets s ON s.id=i.adset_id LEFT JOIN ads ad ON ad.id=i.ad_id
     WHERE a.is_selected=1 AND i.date BETWEEN ? AND ?
     GROUP BY i.ad_id ORDER BY b.name, cp.name, s.name, ad.name`).bind(from, to).all();
  const orders = await c.env.DB.prepare(
    `SELECT utm_content AS ad_id, ${ORDER_AGG} FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? AND utm_content IS NOT NULL GROUP BY utm_content`)
    .bind(from, to).all();
  const byAd = new Map((orders.results as { ad_id: string }[]).map(o => [o.ad_id, o]));
  const out = (rows.results as Record<string, unknown>[]).map(r => ({ ...r, orders: byAd.get(String(r.ad_id)) ?? null }));
  const unattributed = await c.env.DB.prepare(
    `SELECT ${ORDER_AGG} FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? AND utm_content IS NULL`).bind(from, to).first();
  return c.json({ from, to, ads: out, unattributed });
});

/** Order per store & per hari pipeline COD vs TF. */
report.get("/orders", async c => {
  const { from, to } = range(c);
  const byPay = await c.env.DB.prepare(
    `SELECT is_cod, ${ORDER_AGG} FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? GROUP BY is_cod`).bind(from, to).all();
  const byStore = await c.env.DB.prepare(
    `SELECT store_id, store_name, ${ORDER_AGG} FROM orders WHERE is_spam=0 AND draft_date BETWEEN ? AND ? GROUP BY store_id ORDER BY orders DESC`).bind(from, to).all();
  const recent = await c.env.DB.prepare(
    `SELECT o.order_id, o.draft_time, o.store_name, o.product_names, o.payment_method, o.status, o.payment_status, o.gross_revenue, o.utm_content, ad.name AS ad_name
     FROM orders o LEFT JOIN ads ad ON ad.id=o.utm_content WHERE o.is_spam=0 ORDER BY o.draft_time DESC LIMIT 50`).all();
  return c.json({ from, to, by_payment: byPay.results, by_store: byStore.results, recent: recent.results });
});

/** Kelompok produk: spend + order per kelompok, plus campaign yang belum dipetakan. */
report.get("/products", async c => {
  const { from, to } = range(c);
  const groups = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.store_id, ROUND(SUM(i.spend)) AS spend, GROUP_CONCAT(DISTINCT cp.name) AS campaign_names
     FROM product_groups g LEFT JOIN campaigns cp ON cp.product_group=g.id
     LEFT JOIN ad_insights_daily i ON i.campaign_id=cp.id AND i.date BETWEEN ? AND ? GROUP BY g.id ORDER BY g.name`).bind(from, to).all();
  const ordersByGroup = await c.env.DB.prepare(
    `SELECT cp.product_group AS group_id, ${ORDER_AGG} FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign
     WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND cp.product_group IS NOT NULL GROUP BY cp.product_group`).bind(from, to).all();
  const unmapped = await c.env.DB.prepare(
    `SELECT cp.id, cp.name, cp.account_id, ROUND(SUM(i.spend)) AS spend FROM campaigns cp
     LEFT JOIN ad_insights_daily i ON i.campaign_id=cp.id AND i.date BETWEEN ? AND ? WHERE cp.product_group IS NULL GROUP BY cp.id ORDER BY spend DESC`).bind(from, to).all();
  return c.json({ from, to, groups: groups.results, orders_by_group: ordersByGroup.results, unmapped: unmapped.results });
});
