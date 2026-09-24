import { Env, metaToken, toReportDate, daysAgo, todayReport } from "../env";
import { MetaClient, actionValue } from "./meta";
import { ScalevClient, ScalevOrder, extractUtm } from "./scalev";
import { MengantarClient, MengantarOrder, simpleStatus, summarizeHistory } from "./mengantar";

async function log(env: Env, source: string, fn: () => Promise<number>): Promise<{ ok: boolean; rows: number; message?: string }> {
  const started = new Date().toISOString();
  try {
    const rows = await fn();
    await env.DB.prepare("INSERT INTO sync_log (source, started_at, finished_at, ok, rows) VALUES (?,?,?,1,?)")
      .bind(source, started, new Date().toISOString(), rows).run();
    return { ok: true, rows };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("INSERT INTO sync_log (source, started_at, finished_at, ok, rows, message) VALUES (?,?,?,0,0,?)")
      .bind(source, started, new Date().toISOString(), message.slice(0, 500)).run();
    return { ok: false, rows: 0, message };
  }
}

/** Tarik daftar ad account semua BM aktif (untuk halaman Pengaturan). Tidak mengubah pilihan centang. */
export async function discoverAdAccounts(env: Env) {
  const bms = await env.DB.prepare("SELECT id, token_secret FROM business_managers WHERE is_active=1").all<{ id: string; token_secret: string }>();
  const results: Record<string, { ok: boolean; rows: number; message?: string }> = {};
  for (const bm of bms.results) {
    results[bm.id] = await log(env, `meta:accounts:${bm.id}`, async () => {
      const meta = new MetaClient(metaToken(env, bm.token_secret), env.META_API_VERSION);
      const accounts = await meta.adAccounts();
      const now = new Date().toISOString();
      const stmt = env.DB.prepare(
        `INSERT INTO ad_accounts (id, bm_id, name, currency, status, last_seen_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, currency=excluded.currency, status=excluded.status, last_seen_at=excluded.last_seen_at`);
      await env.DB.batch(accounts.map(a => stmt.bind(a.id, bm.id, a.name, a.currency, a.account_status, now)));
      return accounts.length;
    });
  }
  return results;
}

/** Tarik daftar store Scalev (untuk halaman Pengaturan). */
export async function discoverStores(env: Env) {
  return log(env, "scalev:stores", async () => {
    const sc = new ScalevClient(env.SCALEV_API_KEY);
    const stores = await sc.stores();
    const now = new Date().toISOString();
    const stmt = env.DB.prepare(
      `INSERT INTO stores (id, name, last_seen_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, last_seen_at=excluded.last_seen_at`);
    await env.DB.batch(stores.map(s => stmt.bind(s.id, s.name, now)));
    return stores.length;
  });
}

/** Insight Meta untuk semua ad account yang dicentang. Default 3 hari terakhir (Meta merevisi data mundur). */
export async function syncMetaInsights(env: Env, since = daysAgo(3), until = todayReport()) {
  const accounts = await env.DB.prepare(
    `SELECT a.id, a.bm_id, b.token_secret FROM ad_accounts a JOIN business_managers b ON b.id=a.bm_id WHERE a.is_selected=1 AND b.is_active=1`
  ).all<{ id: string; bm_id: string; token_secret: string }>();

  const results: Record<string, { ok: boolean; rows: number; message?: string }> = {};
  for (const acc of accounts.results) {
    results[acc.id] = await log(env, `meta:insights:${acc.id}`, async () => {
      const meta = new MetaClient(metaToken(env, acc.token_secret), env.META_API_VERSION);
      const rows = await meta.insightsDaily(acc.id, since, until);

      const insStmt = env.DB.prepare(
        `INSERT INTO ad_insights_daily (date, account_id, campaign_id, adset_id, ad_id, spend, impressions, clicks, reach, link_clicks, pixel_purchases, pixel_purchase_value)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(date, ad_id) DO UPDATE SET spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, reach=excluded.reach,
           link_clicks=excluded.link_clicks, pixel_purchases=excluded.pixel_purchases, pixel_purchase_value=excluded.pixel_purchase_value`);
      const cStmt = env.DB.prepare(`INSERT INTO campaigns (id, account_id, name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
      const asStmt = env.DB.prepare(`INSERT INTO adsets (id, campaign_id, name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
      const adStmt = env.DB.prepare(`INSERT INTO ads (id, adset_id, campaign_id, name) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name`);

      const batch: D1PreparedStatement[] = [];
      const seenC = new Set<string>(), seenAs = new Set<string>(), seenAd = new Set<string>();
      for (const r of rows) {
        if (!seenC.has(r.campaign_id)) { seenC.add(r.campaign_id); batch.push(cStmt.bind(r.campaign_id, acc.id, r.campaign_name)); }
        if (!seenAs.has(r.adset_id)) { seenAs.add(r.adset_id); batch.push(asStmt.bind(r.adset_id, r.campaign_id, r.adset_name)); }
        if (!seenAd.has(r.ad_id)) { seenAd.add(r.ad_id); batch.push(adStmt.bind(r.ad_id, r.adset_id, r.campaign_id, r.ad_name)); }
        batch.push(insStmt.bind(
          r.date_start, acc.id, r.campaign_id, r.adset_id, r.ad_id,
          Number(r.spend ?? 0), Number(r.impressions ?? 0), Number(r.clicks ?? 0), Number(r.reach ?? 0),
          actionValue(r.actions, "link_click"), actionValue(r.actions, "purchase"), actionValue(r.action_values, "purchase"),
        ));
      }
      // D1 batch dibatasi; kirim per 100 statement
      for (let i = 0; i < batch.length; i += 100) await env.DB.batch(batch.slice(i, i + 100));

      // status campaign
      const camps = await meta.campaigns(acc.id);
      const upd = env.DB.prepare(`UPDATE campaigns SET status=?, objective=?, updated_at=? WHERE id=?`);
      for (let i = 0; i < camps.length; i += 100)
        await env.DB.batch(camps.slice(i, i + 100).map(c => upd.bind(c.status, c.objective ?? null, c.updated_time ?? null, c.id)));

      await autoMapCampaigns(env);
      return rows.length;
    });
  }
  return results;
}

/** Campaign yang namanya diawali match_prefix sebuah kelompok produk dipetakan otomatis. */
export async function autoMapCampaigns(env: Env) {
  const groups = await env.DB.prepare("SELECT id, match_prefix FROM product_groups WHERE match_prefix IS NOT NULL AND match_prefix<>''").all<{ id: string; match_prefix: string }>();
  for (const g of groups.results) {
    await env.DB.prepare("UPDATE campaigns SET product_group=? WHERE product_group IS NULL AND UPPER(name) LIKE UPPER(?) || '%'").bind(g.id, g.match_prefix).run();
  }
}

export function orderToRow(o: ScalevOrder, tz: string) {
  const utm = extractUtm(o);
  const products = Object.keys(o.final_variants ?? {});
  const isCod = o.payment_method === "cod" ? 1 : 0;
  return {
    id: o.id, order_id: o.order_id, store_id: o.store?.id ?? null, store_name: o.store?.name ?? null,
    status: o.status, payment_status: o.payment_status ?? null, payment_method: o.payment_method ?? null, is_cod: isCod,
    gross_revenue: Number(o.gross_revenue ?? 0), net_revenue: Number(o.net_revenue ?? 0),
    shipping_cost: Number(o.shipping_cost ?? 0), product_discount: Number(o.product_discount ?? 0),
    draft_date: toReportDate(o.draft_time, tz) ?? toReportDate(new Date().toISOString(), tz)!,
    draft_time: o.draft_time ?? null, confirmed_time: o.confirmed_time ?? null, shipped_time: o.shipped_time ?? null,
    completed_time: o.completed_time ?? null, rts_time: o.rts_time ?? null, canceled_time: o.canceled_time ?? null,
    utm_source: utm.source ?? null, utm_medium: utm.medium ?? null, utm_campaign: utm.campaign ?? null,
    utm_term: utm.term ?? null, utm_content: utm.content ?? null,
    product_names: JSON.stringify(products), city: o.destination_address?.city ?? null, province: o.destination_address?.province ?? null,
    is_spam: o.is_probably_spam ? 1 : 0, raw_json: JSON.stringify(o), last_updated_at: o.last_updated_at ?? null,
    shipment_receipt: o.shipment_receipt?.trim() || null,
    courier_name: o.courier_service?.courier?.name ?? o.courier_service?.name ?? null,
    scalev_shipment_status: o.shipment_status ?? null,
    handler_id: o.handler?.id ?? null,
    handler_name: o.handler?.fullname ?? o.handler?.email ?? null,
    cancel_reason: o.status === "canceled" ? (o.notes ?? null) : null,
    follow_up_count: Array.isArray(o.follow_up_chats) ? o.follow_up_chats.length : 0,
    tags: Array.isArray(o.tags) ? JSON.stringify(o.tags) : null,
  };
}

const UPSERT_ORDER = `INSERT INTO orders (id, order_id, store_id, store_name, status, payment_status, payment_method, is_cod, gross_revenue, net_revenue,
  shipping_cost, product_discount, draft_date, draft_time, confirmed_time, shipped_time, completed_time, rts_time, canceled_time,
  utm_source, utm_medium, utm_campaign, utm_term, utm_content, product_names, city, province, is_spam, raw_json, last_updated_at, shipment_receipt, courier_name, scalev_shipment_status, handler_id, handler_name, cancel_reason, follow_up_count, tags, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status, payment_status=excluded.payment_status, payment_method=excluded.payment_method, is_cod=excluded.is_cod,
  gross_revenue=excluded.gross_revenue, net_revenue=excluded.net_revenue, shipping_cost=excluded.shipping_cost, product_discount=excluded.product_discount,
  confirmed_time=excluded.confirmed_time, shipped_time=excluded.shipped_time, completed_time=excluded.completed_time, rts_time=excluded.rts_time,
  canceled_time=excluded.canceled_time, utm_source=COALESCE(excluded.utm_source, orders.utm_source), utm_medium=COALESCE(excluded.utm_medium, orders.utm_medium),
  utm_campaign=COALESCE(excluded.utm_campaign, orders.utm_campaign), utm_term=COALESCE(excluded.utm_term, orders.utm_term), utm_content=COALESCE(excluded.utm_content, orders.utm_content),
  product_names=excluded.product_names, city=excluded.city, province=excluded.province, is_spam=excluded.is_spam, raw_json=excluded.raw_json,
  last_updated_at=excluded.last_updated_at, shipment_receipt=COALESCE(excluded.shipment_receipt, orders.shipment_receipt),
  courier_name=COALESCE(excluded.courier_name, orders.courier_name), scalev_shipment_status=excluded.scalev_shipment_status,
  handler_id=COALESCE(excluded.handler_id, orders.handler_id), handler_name=COALESCE(excluded.handler_name, orders.handler_name),
  cancel_reason=COALESCE(excluded.cancel_reason, orders.cancel_reason), follow_up_count=MAX(excluded.follow_up_count, orders.follow_up_count),
  tags=COALESCE(excluded.tags, orders.tags), synced_at=excluded.synced_at`;

export async function upsertOrders(env: Env, orders: ScalevOrder[]) {
  const stmt = env.DB.prepare(UPSERT_ORDER);
  const now = new Date().toISOString();
  const batch = orders.map(o => { const r = orderToRow(o, env.TZ_REPORT); return stmt.bind(...Object.values(r), now); });
  for (let i = 0; i < batch.length; i += 100) await env.DB.batch(batch.slice(i, i + 100));
}

/**
 * Sinkron order Scalev. Strategi:
 *  1. Order baru: iterasi list (desc) sampai draft_time lebih tua dari `sinceIso`.
 *  2. Perubahan status: ambil order yang confirmed/shipped/completed sejak `sinceIso` (filter *_time_since).
 *  3. RTS/batal: ambil status rts & canceled, berhenti saat draft_time lebih tua dari 60 hari.
 * Webhook order.status_changed melengkapi ini secara realtime.
 */
export async function syncScalevOrders(env: Env, sinceIso?: string) {
  return log(env, "scalev:orders", async () => {
    const sc = new ScalevClient(env.SCALEV_API_KEY);
    const last = (await env.DB.prepare("SELECT value FROM kv WHERE key='scalev_last_sync'").first<{ value: string }>())?.value;
    const since = sinceIso ?? (last ? new Date(new Date(last).getTime() - 2 * 3600000).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString());
    const stores = await env.DB.prepare("SELECT id FROM stores WHERE is_selected=1").all<{ id: number }>();
    const storeIds = stores.results.map(s => String(s.id));
    const olderThan = (iso: string) => (o: ScalevOrder) => !!o.draft_time && o.draft_time < iso;

    const collected = new Map<string, ScalevOrder>();
    const runs: Record<string, string | undefined>[] = [
      {},                                                   // order baru (dibatasi stop draft_time < since)
      { confirmed_time_since: since },
      { shipped_time_since: since },
      { completed_time_since: since },
      { status: "rts" }, { status: "canceled" }, { status: "shipped_rts" },
      // Perpindahan ke status ini tidak punya stempel waktu, jadi hanya tertangkap lewat filter status
      { status: "pending" }, { status: "in_process" }, { status: "ready" },
    ];
    const cutoff60 = new Date(Date.now() - 60 * 86400000).toISOString();
    for (const storeId of storeIds.length ? storeIds : [undefined]) {
      for (const [i, p] of runs.entries()) {
        const stop = i === 0 ? olderThan(since) : i >= 4 ? olderThan(cutoff60) : undefined;
        for await (const o of sc.orders({ ...p, store_id: storeId }, stop)) collected.set(o.id, o);
      }
    }
    await upsertOrders(env, [...collected.values()]);
    await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('scalev_last_sync', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(new Date().toISOString()).run();
    return collected.size;
  });
}

/**
 * Backfill order yang masuk (draft_time) pada rentang tanggal WIB `from`..`to`.
 * Dipakai untuk menarik data lama per bulan: backfill N hari sekaligus berhenti di
 * batas 400 halaman bila order-nya lebih dari 10.000.
 */
export async function backfillScalevRange(env: Env, from: string, to: string) {
  return log(env, `scalev:backfill:${from}..${to}`, async () => {
    const sc = new ScalevClient(env.SCALEV_API_KEY);
    const since = new Date(`${from}T00:00:00+07:00`).toISOString();
    const until = new Date(`${to}T23:59:59+07:00`).toISOString();
    const collected = new Map<string, ScalevOrder>();
    // Stop berjaga-jaga bila Scalev mengabaikan filter; urutan list desc.
    const stop = (o: ScalevOrder) => !!o.draft_time && o.draft_time < since;
    for await (const o of sc.orders({ draft_time_since: since, draft_time_until: until }, stop)) {
      if (o.draft_time && o.draft_time <= until) collected.set(o.id, o);
    }
    await upsertOrders(env, [...collected.values()]);
    return collected.size;
  });
}

/** Backfill order N hari ke belakang (jalankan sekali di awal). */
export async function backfillScalev(env: Env, days = 90) {
  return syncScalevOrders(env, new Date(Date.now() - days * 86400000).toISOString());
}

export function shipmentRow(o: MengantarOrder) {
  const h = summarizeHistory(o.history);
  const isCod = o.COD_FLAG === true || String(o.COD_FLAG ?? "").toUpperCase() === "COD" || String(o.COD_FLAG ?? "").toUpperCase() === "Y" || Number(o.COD_AMOUNT ?? 0) > 0;
  const phone = String(o.RECEIVER_PHONE ?? "");
  return [
    o._id, o.ORDER_ID ?? null, o.cnote_no ?? null, o.courier ?? null, o.SERVICE_CODE ?? null,
    o.status ?? null, o.statusCategory ?? null, simpleStatus(o.status, o.statusCategory), o.lastStatusChange ?? null,
    isCod ? 1 : 0, Number(o.COD_AMOUNT ?? 0), Number(o.COD_FEE ?? 0), Number(o.price ?? 0), o.isPaid == null ? null : (o.isPaid ? 1 : 0),
    o.RECEIVER_CITY ?? null, o.RECEIVER_REGION ?? null, phone ? phone.slice(-4) : null, o.WEIGHT ?? null,
    o.createdAt ?? o.createdDate ?? null, o.updatedAt ?? null, h.delivered, h.rts, h.undelivered, h.lastAt, h.lastNote,
    JSON.stringify(o.history ?? []), JSON.stringify(o), new Date().toISOString(),
  ];
}

const UPSERT_SHIPMENT = `INSERT INTO shipments (id, mengantar_order_id, receipt, courier, service_code, status, status_category, status_simple, last_status_change,
  is_cod, cod_amount, cod_fee, price, is_paid, receiver_city, receiver_region, receiver_phone_last4, weight, created_at, updated_at,
  delivered_at, rts_at, undelivered_count, last_event_at, last_event_note, history_json, raw_json, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET receipt=COALESCE(excluded.receipt, shipments.receipt), status=excluded.status, status_category=excluded.status_category,
  status_simple=excluded.status_simple, last_status_change=excluded.last_status_change, is_paid=excluded.is_paid, updated_at=excluded.updated_at,
  delivered_at=COALESCE(excluded.delivered_at, shipments.delivered_at), rts_at=COALESCE(excluded.rts_at, shipments.rts_at),
  undelivered_count=excluded.undelivered_count, last_event_at=excluded.last_event_at, last_event_note=excluded.last_event_note,
  history_json=excluded.history_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at`;

/**
 * Perjalanan paket dari Mengantar. Tarik semua paket yang dibuat dalam `days` hari terakhir (default 45),
 * supaya paket yang masih jalan/RTS ikut diperbarui. Cocokkan ke orders lewat resi.
 */
export async function syncMengantar(env: Env, days = 45) {
  return log(env, "mengantar:shipments", async () => {
    if (!env.MENGANTAR_API_KEY) throw new Error("MENGANTAR_API_KEY belum di-set");
    const mg = new MengantarClient(env.MENGANTAR_API_KEY);
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const end = new Date().toISOString();
    const stmt = env.DB.prepare(UPSERT_SHIPMENT);
    let batch: D1PreparedStatement[] = [], n = 0;
    for await (const o of mg.list(start, end)) {
      batch.push(stmt.bind(...shipmentRow(o))); n++;
      if (batch.length >= 100) { await env.DB.batch(batch); batch = []; }
    }
    if (batch.length) await env.DB.batch(batch);
    return n;
  });
}

/** Lacak satu resi langsung (dipakai tombol "Lacak" di UI). */
export async function trackReceipt(env: Env, receipt: string) {
  if (!env.MENGANTAR_API_KEY) throw new Error("MENGANTAR_API_KEY belum di-set");
  const o = await new MengantarClient(env.MENGANTAR_API_KEY).byReceipt(receipt);
  if (o) await env.DB.prepare(UPSERT_SHIPMENT).bind(...shipmentRow(o)).run();
  return o;
}

export async function runAll(env: Env) {
  const meta = await syncMetaInsights(env);
  const scalev = await syncScalevOrders(env);
  const mengantar = env.MENGANTAR_API_KEY ? await syncMengantar(env) : { ok: false, rows: 0, message: "MENGANTAR_API_KEY belum di-set" };
  return { meta, scalev, mengantar };
}
