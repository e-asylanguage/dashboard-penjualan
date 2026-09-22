import { Hono } from "hono";
import { Env } from "../env";
import { discoverAdAccounts, discoverStores, autoMapCampaigns } from "../lib/sync";

export const settings = new Hono<{ Bindings: Env }>();

/** Daftar BM, ad account (dengan centang), dan store Scalev. */
settings.get("/", async c => {
  const bms = await c.env.DB.prepare("SELECT id, name, app_id, is_active FROM business_managers ORDER BY name").all();
  const accounts = await c.env.DB.prepare(
    `SELECT a.*, (SELECT ROUND(SUM(spend)) FROM ad_insights_daily i WHERE i.account_id=a.id AND i.date >= date('now','-30 days')) AS spend_30d
     FROM ad_accounts a ORDER BY a.bm_id, a.name`).all();
  const stores = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM orders o WHERE o.store_id=s.id AND o.draft_date >= date('now','-30 days')) AS orders_30d FROM stores s ORDER BY s.name`).all();
  const groups = await c.env.DB.prepare("SELECT * FROM product_groups ORDER BY name").all();
  const log = await c.env.DB.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 20").all();
  const tokens: Record<string, boolean> = {};
  for (const b of bms.results as { id: string }[]) {
    const row = await c.env.DB.prepare("SELECT token_secret FROM business_managers WHERE id=?").bind(b.id).first<{ token_secret: string }>();
    tokens[b.id] = typeof c.env[row!.token_secret] === "string" && !!c.env[row!.token_secret];
  }
  return c.json({ business_managers: bms.results, tokens, ad_accounts: accounts.results, stores: stores.results, product_groups: groups.results, sync_log: log.results });
});

/** Tarik ulang daftar ad account & store dari Meta/Scalev. */
settings.post("/discover", async c => {
  const [accounts, stores] = await Promise.all([discoverAdAccounts(c.env), discoverStores(c.env)]);
  return c.json({ accounts, stores });
});

/** Simpan centang: { ad_accounts: [{id, is_selected, store_id}], stores: [{id, is_selected}] } */
settings.put("/", async c => {
  const body = await c.req.json<{ ad_accounts?: { id: string; is_selected: boolean; store_id?: number | null }[]; stores?: { id: number; is_selected: boolean }[] }>();
  const batch: D1PreparedStatement[] = [];
  for (const a of body.ad_accounts ?? [])
    batch.push(c.env.DB.prepare("UPDATE ad_accounts SET is_selected=?, store_id=? WHERE id=?").bind(a.is_selected ? 1 : 0, a.store_id ?? null, a.id));
  for (const s of body.stores ?? [])
    batch.push(c.env.DB.prepare("UPDATE stores SET is_selected=? WHERE id=?").bind(s.is_selected ? 1 : 0, s.id));
  if (batch.length) await c.env.DB.batch(batch);
  return c.json({ ok: true, updated: batch.length });
});

/** Kelompok produk: buat/ubah. { id, name, store_id?, match_prefix? } */
settings.put("/product-groups", async c => {
  const g = await c.req.json<{ id: string; name: string; store_id?: number; match_prefix?: string }>();
  await c.env.DB.prepare(
    `INSERT INTO product_groups (id, name, store_id, match_prefix) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, store_id=excluded.store_id, match_prefix=excluded.match_prefix`)
    .bind(g.id, g.name, g.store_id ?? null, g.match_prefix ?? null).run();
  await autoMapCampaigns(c.env);
  return c.json({ ok: true });
});

/** Petakan campaign ke kelompok produk. { campaign_id, product_group } (null = lepas) */
settings.put("/campaign-map", async c => {
  const b = await c.req.json<{ campaign_id: string; product_group: string | null }>();
  await c.env.DB.prepare("UPDATE campaigns SET product_group=? WHERE id=?").bind(b.product_group, b.campaign_id).run();
  return c.json({ ok: true });
});
