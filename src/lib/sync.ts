import { Env, metaToken, toReportDate, daysAgo, todayReport } from "../env";
import { syncTiktok } from "../routes/tiktok";
import { syncShopee } from "./shopee-sync";
import { MetaClient, actionValue } from "./meta";
import { ScalevClient, ScalevOrder, extractUtm } from "./scalev";
import { MengantarClient, MengantarOrder, MengantarInvoice, simpleStatus, summarizeHistory } from "./mengantar";

type Hasil = number | { rows: number; message?: string };

async function log(env: Env, source: string, fn: () => Promise<Hasil>): Promise<{ ok: boolean; rows: number; message?: string }> {
  const started = new Date().toISOString();
  try {
    const out = await fn();
    const { rows, message } = typeof out === "number" ? { rows: out, message: undefined } : out;
    await env.DB.prepare("INSERT INTO sync_log (source, started_at, finished_at, ok, rows, message) VALUES (?,?,?,1,?,?)")
      .bind(source, started, new Date().toISOString(), rows, message ?? null).run();
    return { ok: true, rows, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("INSERT INTO sync_log (source, started_at, finished_at, ok, rows, message) VALUES (?,?,?,0,0,?)")
      .bind(source, started, new Date().toISOString(), message.slice(0, 500)).run();
    return { ok: false, rows: 0, message };
  }
}

/**
 * Jalankan statement per 100 (batas batch D1) dan hitung yang benar-benar menulis.
 * Semua upsert sinkron memakai `ON CONFLICT ... DO UPDATE ... WHERE <ada perubahan>`,
 * jadi baris yang sama persis dengan isi D1 dilewati dan tidak ditagih sebagai
 * "rows written" — termasuk tulisan ke indeksnya.
 */
async function tulis(env: Env, stmts: D1PreparedStatement[]) {
  let changes = 0, rowsWritten = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    for (const r of await env.DB.batch(stmts.slice(i, i + 100))) {
      changes += r.meta?.changes ?? 0;
      rowsWritten += r.meta?.rows_written ?? 0;
    }
  }
  return { changes, rowsWritten };
}

const ringkas = (diambil: number, t: { changes: number; rowsWritten: number }) =>
  `diambil ${diambil}, berubah ${t.changes}, rows_written ${t.rowsWritten}`;

type BmRow = { id: string; token: string | null; token_secret: string | null };

/**
 * Tarik daftar ad account satu BM (halaman Pengaturan › Sinkronisasi Meta Ads). Tidak mengubah centang.
 * Satu ad account bisa diakses beberapa BM; akun tetap milik BM yang pertama menemukannya
 * (token BM itu yang dipakai menarik insight), jumlah yang sudah dimiliki BM lain dilaporkan di pesan.
 */
export async function discoverBm(env: Env, bmId: string) {
  const bm = await env.DB.prepare("SELECT id, token, token_secret FROM business_managers WHERE id=?").bind(bmId).first<BmRow>();
  if (!bm) return { ok: false, rows: 0, message: "BM tidak ditemukan" };
  return log(env, `meta:accounts:${bm.id}`, async () => {
    const meta = new MetaClient(metaToken(env, bm), env.META_API_VERSION);
    const now = new Date().toISOString();
    let accounts;
    try { accounts = await meta.adAccounts(); }
    catch (e) {
      await env.DB.prepare("UPDATE business_managers SET token_error=?, token_checked_at=? WHERE id=?")
        .bind(e instanceof Error ? e.message : String(e), now, bm.id).run();
      throw e;
    }
    const stmts = accounts.map(a => env.DB.prepare(
      `INSERT INTO ad_accounts (id, bm_id, name, currency, status, last_seen_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, currency=excluded.currency, status=excluded.status, last_seen_at=excluded.last_seen_at`)
      .bind(a.id, bm.id, a.name, a.currency, a.account_status, now));
    stmts.push(env.DB.prepare("UPDATE business_managers SET token_error=NULL, token_checked_at=? WHERE id=?").bind(now, bm.id));
    await tulis(env, stmts);
    const ids = JSON.stringify(accounts.map(a => a.id));
    const lain = (await env.DB.prepare("SELECT COUNT(*) AS n FROM ad_accounts WHERE bm_id<>? AND id IN (SELECT value FROM json_each(?))")
      .bind(bm.id, ids).first<{ n: number }>())?.n ?? 0;
    return { rows: accounts.length, message: `${accounts.length} akun${lain ? `, ${lain} sudah terdaftar di BM lain` : ""}` };
  });
}

/** Tarik daftar ad account semua BM aktif. */
export async function discoverAdAccounts(env: Env) {
  const bms = await env.DB.prepare("SELECT id FROM business_managers WHERE is_active=1").all<{ id: string }>();
  const results: Record<string, { ok: boolean; rows: number; message?: string }> = {};
  for (const bm of bms.results) results[bm.id] = await discoverBm(env, bm.id);
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
    `SELECT a.id, a.bm_id, b.token, b.token_secret FROM ad_accounts a JOIN business_managers b ON b.id=a.bm_id WHERE a.is_selected=1 AND b.is_active=1`
  ).all<{ id: string; bm_id: string; token: string | null; token_secret: string | null }>();

  const results: Record<string, { ok: boolean; rows: number; message?: string }> = {};
  for (const acc of accounts.results) {
    results[acc.id] = await log(env, `meta:insights:${acc.id}`, async () => {
      const meta = new MetaClient(metaToken(env, acc), env.META_API_VERSION);
      const rows = await meta.insightsDaily(acc.id, since, until);

      const insStmt = env.DB.prepare(
        `INSERT INTO ad_insights_daily (date, account_id, campaign_id, adset_id, ad_id, spend, impressions, clicks, reach, link_clicks, pixel_purchases, pixel_purchase_value,
           video_3s, video_thruplay, video_p100, video_synced)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON CONFLICT(date, ad_id) DO UPDATE SET spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, reach=excluded.reach,
           link_clicks=excluded.link_clicks, pixel_purchases=excluded.pixel_purchases, pixel_purchase_value=excluded.pixel_purchase_value,
           video_3s=excluded.video_3s, video_thruplay=excluded.video_thruplay, video_p100=excluded.video_p100, video_synced=1
         WHERE spend IS NOT excluded.spend OR impressions IS NOT excluded.impressions OR clicks IS NOT excluded.clicks OR reach IS NOT excluded.reach
           OR link_clicks IS NOT excluded.link_clicks OR pixel_purchases IS NOT excluded.pixel_purchases OR pixel_purchase_value IS NOT excluded.pixel_purchase_value
           OR video_3s IS NOT excluded.video_3s OR video_thruplay IS NOT excluded.video_thruplay OR video_p100 IS NOT excluded.video_p100 OR video_synced=0`);
      const cStmt = env.DB.prepare(`INSERT INTO campaigns (id, account_id, name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE name IS NOT excluded.name`);
      const asStmt = env.DB.prepare(`INSERT INTO adsets (id, campaign_id, name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE name IS NOT excluded.name`);
      const adStmt = env.DB.prepare(`INSERT INTO ads (id, adset_id, campaign_id, name) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE name IS NOT excluded.name`);

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
          actionValue(r.actions, "video_view"), actionValue(r.video_thruplay_watched_actions, "video_view"), actionValue(r.video_p100_watched_actions, "video_view"),
        ));
      }
      const t1 = await tulis(env, batch);

      // status campaign
      const camps = await meta.campaigns(acc.id);
      const upd = env.DB.prepare(`UPDATE campaigns SET status=?1, objective=?2, updated_at=?3
        WHERE id=?4 AND (status IS NOT ?1 OR objective IS NOT ?2 OR updated_at IS NOT ?3)`);
      const t2 = await tulis(env, camps.map(c => upd.bind(c.status, c.objective ?? null, c.updated_time ?? null, c.id)));

      await autoMapCampaigns(env);
      // Creative (thumbnail) untuk halaman Konten — gagal di sini tidak menggagalkan insight
      let cr = "";
      try { cr = await syncCreatives(env, meta, [...seenAd]); } catch (e) { cr = `, creative gagal: ${e instanceof Error ? e.message : String(e)}`; }
      const t = { changes: t1.changes + t2.changes, rowsWritten: t1.rowsWritten + t2.rowsWritten };
      return { rows: t.changes, message: ringkas(rows.length, t) + cr };
    });
  }
  return results;
}

/**
 * Creative per ad untuk halaman Konten: hanya ad yang belum punya creative atau datanya lebih dari 20 jam
 * (URL thumbnail CDN Meta kedaluwarsa), paling banyak CREATIVE_PER_SINKRON ad per akun per sinkron.
 */
const CREATIVE_PER_SINKRON = 250;
async function syncCreatives(env: Env, meta: MetaClient, adIds: string[]): Promise<string> {
  if (!adIds.length) return "";
  const batas = new Date(Date.now() - 20 * 3600e3).toISOString();
  const perlu = await env.DB.prepare(
    `SELECT id FROM ads WHERE id IN (SELECT value FROM json_each(?)) AND (creative_synced_at IS NULL OR creative_synced_at < ?)
     ORDER BY creative_synced_at IS NOT NULL, creative_synced_at LIMIT ?`).bind(JSON.stringify(adIds), batas, CREATIVE_PER_SINKRON).all<{ id: string }>();
  if (!perlu.results.length) return "";
  const ids = perlu.results.map(r => r.id);
  const cr = await meta.adCreatives(ids);
  const now = new Date().toISOString();
  const upd = env.DB.prepare(`UPDATE ads SET creative_id=?, object_type=?, thumbnail_url=?, image_url=?, video_id=?, creative_synced_at=? WHERE id=?`);
  await tulis(env, ids.map(id => { const c = cr.get(id);
    return upd.bind(c?.id ?? null, c?.object_type ?? null, c?.thumbnail_url ?? null, c?.image_url ?? null, c?.video_id ?? null, now, id); }));
  return `, creative ${cr.size}/${ids.length}`;
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
  tags=COALESCE(excluded.tags, orders.tags), synced_at=excluded.synced_at
  -- Semua kolom lain diturunkan dari raw_json, jadi raw_json sama = order tidak berubah di Scalev.
  WHERE orders.raw_json IS NOT excluded.raw_json`;

/** Upsert order; yang isinya sama persis dengan D1 dilewati (lihat WHERE di UPSERT_ORDER). */
export async function upsertOrders(env: Env, orders: ScalevOrder[]) {
  const stmt = env.DB.prepare(UPSERT_ORDER);
  const now = new Date().toISOString();
  return tulis(env, orders.map(o => { const r = orderToRow(o, env.TZ_REPORT); return stmt.bind(...Object.values(r), now); }));
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
    const t = await upsertOrders(env, [...collected.values()]);
    await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('scalev_last_sync', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(new Date().toISOString()).run();
    return { rows: t.changes, message: ringkas(collected.size, t) };
  });
}

/**
 * Backfill order yang masuk (draft_time) pada rentang tanggal WIB `from`..`to`.
 * Dipakai untuk menarik data lama per bulan: backfill N hari sekaligus berhenti di
 * batas 400 halaman bila order-nya lebih dari 10.000.
 */
/**
 * Antrean backfill yang dijalankan cron: kv 'backfill_antre' = JSON [[from, to], …]. Satu rentang per putaran
 * cron supaya tetap di bawah batas waktu Worker. Dipakai saat kolom order baru ditambahkan (mis. pending_time)
 * dan order lama perlu diambil ulang tanpa memanggil endpoint yang butuh login.
 */
export async function jalankanAntreanBackfill(env: Env) {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key='backfill_antre'").first<{ value: string }>();
  if (!row) return null;
  let antre: [string, string][] = [];
  try { antre = JSON.parse(row.value); } catch { /* rusak → dihapus di bawah */ }
  const berikut = antre.shift();
  // Simpan sisa antrean dulu, supaya rentang yang gagal tidak diulang terus-menerus
  if (antre.length) await env.DB.prepare("UPDATE kv SET value=? WHERE key='backfill_antre'").bind(JSON.stringify(antre)).run();
  else await env.DB.prepare("DELETE FROM kv WHERE key='backfill_antre'").run();
  return berikut ? backfillScalevRange(env, berikut[0], berikut[1]) : null;
}

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
    const t = await upsertOrders(env, [...collected.values()]);
    return { rows: t.changes, message: ringkas(collected.size, t) };
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
  -- API list tidak membawa riwayat; jangan timpa riwayat hasil lacak per resi dengan array kosong
  history_json=CASE WHEN excluded.history_json='[]' THEN shipments.history_json ELSE excluded.history_json END,
  raw_json=excluded.raw_json, synced_at=excluded.synced_at
  WHERE shipments.raw_json IS NOT excluded.raw_json`;

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
    const t = { changes: 0, rowsWritten: 0 };
    const kirim = async () => { const r = await tulis(env, batch); t.changes += r.changes; t.rowsWritten += r.rowsWritten; batch = []; };
    const ada = new Set<string>();
    for await (const o of mg.list(start, end)) {
      batch.push(stmt.bind(...shipmentRow(o))); n++; ada.add(o._id);
      if (batch.length >= 100) await kirim();
    }
    if (batch.length) await kirim();
    // Paket belum beresi di jendela list yang tidak ikut terambil lagi = sudah dihapus/dibatalkan di Mengantar
    // (mis. order ganda yang dibuat ulang). Hapus supaya tidak muncul sebagai paket "Tidak bergerak" tanpa resi.
    // Hanya setelah list selesai tanpa error, dan hanya yang tanpa resi (belum pernah dikirim).
    // (synced_at tidak bisa dipakai: upsert hanya menulis bila datanya berubah.)
    let hapus = 0;
    if (n) {
      // Lewati 1 hari di tepi awal jendela (batas tanggal versi Mengantar bisa beda zona waktu)
      const lokal = await env.DB.prepare(`SELECT id FROM shipments WHERE (receipt IS NULL OR receipt='') AND created_at >= ?`)
        .bind(new Date(Date.parse(start) + 86400000).toISOString()).all<{ id: string }>();
      const hilang = lokal.results.filter(r => !ada.has(r.id));
      // Pengaman: kalau yang "hilang" banyak sekali, kemungkinan list-nya tidak lengkap — jangan hapus apa pun
      if (hilang.length && hilang.length <= 30) hapus = (await tulis(env, hilang.map(r => env.DB.prepare(`DELETE FROM shipments WHERE id=?`).bind(r.id)))).changes;
    }
    // Paket lebih tua dari jendela list yang belum final (masih di jalan, retur belum sampai ke pengirim
    // [SHIPMENT RETURN → RTS], atau COD terkirim tapi belum direkonsiliasi) disegarkan satu per satu
    // lewat resi — yang paling lama tidak disinkron lebih dulu.
    const basi = await env.DB.prepare(
      `SELECT receipt FROM shipments WHERE created_at < ? AND receipt IS NOT NULL AND receipt<>''
         AND (status_simple='ON_GOING' OR (status_simple='RTS' AND status<>'RTS')
           OR (status_simple='DELIVERED' AND is_cod=1 AND COALESCE(json_extract(raw_json,'$.isReconciliated'),0)<>1))
       ORDER BY synced_at LIMIT 25`).bind(start).all<{ receipt: string }>();
    for (const { receipt } of basi.results) {
      const o = await mg.byReceipt(receipt).catch(() => null);
      if (o) { batch.push(stmt.bind(...shipmentRow(o))); n++; }
    }
    if (batch.length) await kirim();
    return { rows: t.changes, message: ringkas(n, t) + (basi.results.length ? `, ${basi.results.length} paket lama dicek ulang` : "")
      + (hapus ? `, ${hapus} paket tanpa resi dihapus (sudah tidak ada di Mengantar)` : "") };
  });
}

const UPSERT_INVOICE = `INSERT INTO mengantar_invoices (id, inv_number, type, status, amount, balance_after, receipt, order_id, description, bank, paid_at, created_at, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status, amount=excluded.amount, balance_after=excluded.balance_after,
  description=excluded.description, paid_at=excluded.paid_at, synced_at=excluded.synced_at
  WHERE mengantar_invoices.status IS NOT excluded.status OR mengantar_invoices.paid_at IS NOT excluded.paid_at
    OR mengantar_invoices.amount IS NOT excluded.amount`;
const UPSERT_INVOICE_ITEM = `INSERT INTO mengantar_invoice_items (invoice_id, receipt, amount, cod_amount, cod_fee) VALUES (?,?,?,?,?)
  ON CONFLICT(invoice_id, receipt) DO UPDATE SET amount=excluded.amount, cod_amount=excluded.cod_amount, cod_fee=excluded.cod_fee`;

function invoiceRow(o: MengantarInvoice) {
  const ps = o.paymentSettings;
  // Nomor rekening tidak disimpan utuh — cukup bank + 4 digit terakhir untuk mengenali tujuan pencairan
  const bank = o.type === "typeWithdraw" && ps?.bankName
    ? `${ps.bankName.toUpperCase()}${ps.bankAccountNumber ? " ••" + String(ps.bankAccountNumber).slice(-4) : ""}` : null;
  return [o._id, o.inv_number ?? null, o.type, o.status ?? null, Number(o.amount ?? 0),
    typeof o.balanceAmount === "number" ? o.balanceAmount : null, o.cnote_no || null, o.ORDER_ID ?? null,
    o.description ?? null, bank, o.paydAt ?? null, o.createdAt, new Date().toISOString()];
}

/**
 * Mutasi saldo Mengantar dalam `days` hari terakhir (default 10 — pencairan bisa baru ditandai
 * terkirim sehari kemudian). Saldo akun saat ini disimpan di kv `mengantar_balance`.
 */
export async function syncMengantarInvoices(env: Env, days = 10) {
  return log(env, "mengantar:invoices", async () => {
    if (!env.MENGANTAR_API_KEY) throw new Error("MENGANTAR_API_KEY belum di-set");
    const mg = new MengantarClient(env.MENGANTAR_API_KEY);
    const start = new Date(Date.now() - days * 86400000).toISOString(), end = new Date().toISOString();
    const inv = env.DB.prepare(UPSERT_INVOICE), item = env.DB.prepare(UPSERT_INVOICE_ITEM);
    let batch: D1PreparedStatement[] = [], n = 0, saldo: number | null = null;
    const t = { changes: 0, rowsWritten: 0 };
    const kirim = async () => { const r = await tulis(env, batch); t.changes += r.changes; t.rowsWritten += r.rowsWritten; batch = []; };
    for await (const o of mg.invoices(start, end, b => { saldo = b; })) {
      batch.push(inv.bind(...invoiceRow(o))); n++;
      for (const it of o.subItems ?? [])
        if (it.cnote_no) batch.push(item.bind(o._id, it.cnote_no, Number(it.amount ?? 0), it.COD_AMOUNT ?? null, it.COD_FEE ?? null));
      if (batch.length >= 100) await kirim();
    }
    if (batch.length) await kirim();
    if (saldo !== null)
      await env.DB.prepare(`INSERT INTO kv (key, value) VALUES ('mengantar_balance', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .bind(JSON.stringify({ balance: saldo, at: new Date().toISOString() })).run();
    return { rows: t.changes, message: ringkas(n, t) + (saldo !== null ? `, saldo Rp ${Math.round(saldo)}` : "") };
  });
}

/** Lacak satu resi langsung (dipakai tombol "Lacak" di UI). */
export async function trackReceipt(env: Env, receipt: string) {
  if (!env.MENGANTAR_API_KEY) throw new Error("MENGANTAR_API_KEY belum di-set");
  const o = await new MengantarClient(env.MENGANTAR_API_KEY).byReceipt(receipt);
  if (o) await env.DB.prepare(UPSERT_SHIPMENT).bind(...shipmentRow(o)).run();
  return o;
}

/**
 * Katalog produk & bundle Scalev (halaman Data Produk).
 * SKU dan harga varian hanya ada di detail produk, jadi detail diambil untuk produk yang
 * baru/berubah saja (last_updated_at berbeda), paling banyak `maxDetail` per panggilan —
 * sisanya menyusul di sinkron berikutnya. Produk yang hilang dari list ditandai 'deleted'
 * (tidak dihapus) supaya order lama tetap bisa dipetakan ke kategorinya.
 * Mengubah COGS varian di Scalev TIDAK mengubah last_updated_at produk (terlihat 29 Sep 2026), jadi
 * detail yang sudah >24 jam juga diambil ulang, dan `paksa` mengambil ulang semuanya.
 */
export async function syncScalevCatalog(env: Env, maxDetail = 30, paksa = false) {
  return log(env, "scalev:catalog", async () => {
    const sc = new ScalevClient(env.SCALEV_API_KEY);
    const now = new Date().toISOString();
    const list = await sc.products();
    const known = new Map((await env.DB.prepare("SELECT id, last_updated_at, detail_synced_at FROM catalog_products")
      .all<{ id: number; last_updated_at: string | null; detail_synced_at: string | null }>()).results.map(r => [r.id, r]));

    const upProduct = env.DB.prepare(
      `INSERT INTO catalog_products (id, name, status, last_updated_at) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, last_updated_at=excluded.last_updated_at
       WHERE name IS NOT excluded.name OR status IS NOT excluded.status OR last_updated_at IS NOT excluded.last_updated_at`);
    const stmts: D1PreparedStatement[] = list.map(p => upProduct.bind(p.id, p.name, p.status ?? null, p.last_updated_at ?? null));
    const ids = new Set(list.map(p => p.id));
    for (const id of known.keys()) if (!ids.has(id)) {
      stmts.push(env.DB.prepare("UPDATE catalog_products SET status='deleted' WHERE id=? AND status IS NOT 'deleted'").bind(id));
      stmts.push(env.DB.prepare("UPDATE catalog_items SET status='deleted' WHERE product_id=? AND status IS NOT 'deleted'").bind(id));
    }

    // List tidak memuat store produk — kolom stores diisi dari detail di bawah.
    // Detail: produk baru/berubah dulu, dari yang paling lama tidak diambil.
    const basi = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const perlu = list.filter(p => { const k = known.get(p.id);
        return paksa || !k || !k.detail_synced_at || k.detail_synced_at < basi || k.last_updated_at !== (p.last_updated_at ?? null); })
      .sort((a, b) => (known.get(a.id)?.detail_synced_at ?? "").localeCompare(known.get(b.id)?.detail_synced_at ?? ""));
    const upItem = env.DB.prepare(
      `INSERT INTO catalog_items (key, kind, product_id, product_name, name, option_tail, sku, price, cogs, status, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET product_id=excluded.product_id, product_name=excluded.product_name, name=excluded.name, option_tail=excluded.option_tail,
         sku=excluded.sku, price=excluded.price, cogs=excluded.cogs, status=excluded.status, synced_at=excluded.synced_at
       WHERE product_name IS NOT excluded.product_name OR name IS NOT excluded.name OR option_tail IS NOT excluded.option_tail OR sku IS NOT excluded.sku
         OR price IS NOT excluded.price OR cogs IS NOT excluded.cogs OR status IS NOT excluded.status`);
    const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
    let detail = 0, terhenti = "";
    for (const p of perlu.slice(0, maxDetail)) {
      // Kena rate limit di tengah jalan: simpan yang sudah didapat, sisanya menyusul di sinkron berikutnya.
      let d;
      try { d = await sc.product(p.id); } catch (e) { terhenti = e instanceof Error ? e.message : String(e); break; }
      detail++;
      const variants = d.variants ?? [];
      for (const v of variants) {
        const tail = [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" - ") || null;
        stmts.push(upItem.bind(`v:${v.id}`, "variant", p.id, d.name, v.fullname || v.name, tail,
          v.sku?.trim() || null, num(v.price), num(v.cogs), d.status ?? p.status ?? null, now));
      }
      // Varian yang sudah dihapus dari produk ini
      const vk = variants.map(v => `v:${v.id}`);
      stmts.push(env.DB.prepare(`UPDATE catalog_items SET status='deleted' WHERE product_id=? AND status IS NOT 'deleted'
        AND key NOT IN (SELECT value FROM json_each(?))`).bind(p.id, JSON.stringify(vk)));
      stmts.push(env.DB.prepare("UPDATE catalog_products SET detail_synced_at=?, stores=? WHERE id=?")
        .bind(now, d.stores ? JSON.stringify(d.stores.map(s => s.name)) : null, p.id));
    }

    // Saat terhenti, bundle dilewati: daftar kosong akan menandai semua bundle terhapus.
    const bundles = terhenti ? [] : await sc.bundles();
    for (const b of bundles)
      stmts.push(upItem.bind(`b:${b.id}`, "bundle", null, null, b.name, null, b.custom_id?.trim() || null,
        num(b.bundle_price_options?.[0]?.price), null, b.status ?? null, now));
    if (!terhenti) stmts.push(env.DB.prepare(`UPDATE catalog_items SET status='deleted' WHERE kind='bundle' AND status IS NOT 'deleted'
      AND key NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(bundles.map(b => `b:${b.id}`))));

    const t = await tulis(env, stmts);
    const sisa = Math.max(0, perlu.length - detail);
    return { rows: t.changes, message: `produk ${list.length}, detail diambil ${detail}${sisa ? ` (sisa ${sisa})` : ""}, bundle ${bundles.length}, berubah ${t.changes}${terhenti ? ` — terhenti: ${terhenti}` : ""}` };
  });
}

export async function runAll(env: Env) {
  const meta = await syncMetaInsights(env);
  const scalev = await syncScalevOrders(env);
  const mengantar = env.MENGANTAR_API_KEY ? await syncMengantar(env) : { ok: false, rows: 0, message: "MENGANTAR_API_KEY belum di-set" };
  const mengantarSaldo = env.MENGANTAR_API_KEY ? await syncMengantarInvoices(env) : { ok: false, rows: 0, message: "MENGANTAR_API_KEY belum di-set" };
  const katalog = await syncScalevCatalog(env);
  // TikTok Shop: hanya bila kunci aplikasi di-set (toko tanpa izin API dilewati di dalamnya)
  const tiktokShop = env.TIKTOK_APP_KEY ? await log(env, "tiktok", async () => {
    const r = await syncTiktok(env);
    const ringkas = (r.hasil ?? []).map((x: Record<string, any>) => `${x.toko}: pesanan ${x.pesanan?.disimpan ?? x.pesanan?.gagal ?? "-"}, dana ${x.penghasilan?.disimpan ?? x.penghasilan?.gagal ?? "-"}`);
    return { rows: (r.hasil ?? []).reduce((a: number, x: Record<string, any>) => a + (x.pesanan?.disimpan ?? 0) + (x.penghasilan?.disimpan ?? 0), 0), message: ringkas.join("; ") || ("pesan" in r ? String(r.pesan) : "tidak ada toko") };
  }) : { ok: false, rows: 0, message: "TIKTOK_APP_KEY belum di-set" };
  // Shopee: toko bermode API yang sudah diizinkan dengan kunci Live
  const shopeeApi = env.SHOPEE_PARTNER_KEY ? await log(env, "shopee", async () => {
    const r = await syncShopee(env);
    const ringkas = (r.hasil ?? []).map((x: Record<string, any>) => `${x.toko}: pesanan ${x.pesanan?.disimpan ?? x.pesanan?.gagal ?? "-"}, dana ${x.penghasilan?.disimpan ?? x.penghasilan?.gagal ?? "-"}`);
    return { rows: (r.hasil ?? []).reduce((a: number, x: Record<string, any>) => a + (x.pesanan?.disimpan ?? 0) + (x.penghasilan?.disimpan ?? 0), 0), message: ringkas.join("; ") || ("pesan" in r && r.pesan ? String(r.pesan) : "tidak ada toko API") };
  }) : { ok: false, rows: 0, message: "SHOPEE_PARTNER_KEY belum di-set" };
  return { meta, scalev, mengantar, mengantar_saldo: mengantarSaldo, katalog, tiktok: tiktokShop, shopee: shopeeApi };
}
