import { Hono } from "hono";
import { Env, daysAgo, todayReport } from "../env";
import { ItemKatalog, Kategori, kategoriOtomatis, cocokkan } from "../lib/katalog";
import { KOLOM_BIAYA, OrderBiaya, IsiPcs, siapkanBiaya, siapkanIsiPcs, siapkanPcs } from "../lib/biaya";
import { COOKIE_SESI, bacaCookie, cekSesi, userDashboard } from "../lib/sesi";

export const report = new Hono<{ Bindings: Env }>();

function range(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from") ?? daysAgo(29);
  const to = c.req.query("to") ?? todayReport();
  return { from, to };
}

/**
 * Status yang dihitung sebagai "sudah dikonfirmasi CS".
 *
 * Sengaja memakai status, bukan `confirmed_time`: Scalev tidak mengisi stempel waktu
 * konfirmasi dengan andal — order kerap melompat langsung ke status akhir. Pada data
 * produksi 12 Jun–23 Sep 2026, dari 1.982 order `completed` hanya 21 yang punya
 * `confirmed_time`. Memakai stempel waktu membuat confirm rate turun dari 71,5% ke 5,2%.
 */
const CONFIRMED = (p = "") => `${p}status IN ('confirmed','in_process','ready','shipped','shipped_rts','completed','rts')`;

const NO_CANCEL_REASON = "(tanpa keterangan)";

/**
 * Varian ejaan tag Scalev yang sebenarnya alasan yang sama.
 * Kunci ditulis huruf kecil karena dicocokkan setelah normalisasi.
 * Perlu ditambah bila tim membuat tag baru — perbaikan sebenarnya ada di Scalev,
 * yaitu merapikan daftar tag supaya satu alasan cukup satu tag.
 */
const CANCEL_TAG_ALIAS: Record<string, string> = {
  "tidak bisa fu": "Tidak bisa FU",
  "tidak bisa di fu": "Tidak bisa FU",
  "dobel lead": "Dobel Lead",
  "double lead": "Dobel Lead",
  "dobel cs fuadi": "Dobel Lead",
};

/**
 * Ubah satu tag Scalev menjadi alasan pembatalan yang bisa dibaca.
 * Emoji/simbol di ujung dibuang dan spasi dirapikan; tag yang isinya hanya emoji
 * (penanda warna di Scalev, mis. "❌") tidak menjelaskan apa pun sehingga
 * diperlakukan sama dengan order tanpa tag.
 */
function cancelReason(tag: string | null): string {
  if (!tag) return NO_CANCEL_REASON;
  const text = tag.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "").replace(/\s+/g, " ").trim();
  if (!text) return NO_CANCEL_REASON;
  return CANCEL_TAG_ALIAS[text.toLowerCase()] ?? text;
}

/** Metrik order per kunci (ad_id / campaign / store / tanggal) dalam satu query. */
const ORDER_AGG = `
  COUNT(*)                                                               AS orders,
  SUM(is_cod)                                                            AS orders_cod,
  SUM(CASE WHEN ${CONFIRMED()} THEN 1 ELSE 0 END) AS confirmed,
  SUM(CASE WHEN status IN ('shipped','shipped_rts','completed','rts') THEN 1 ELSE 0 END)   AS shipped,
  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)                    AS completed,
  SUM(CASE WHEN status IN ('rts','shipped_rts','canceled') THEN 1 ELSE 0 END) AS lost,
  SUM(gross_revenue)                                                     AS gross_all,
  SUM(CASE WHEN ${CONFIRMED()} THEN gross_revenue ELSE 0 END) AS gross_confirmed,
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

/**
 * Spending iklan semua platform untuk rentang: Meta (insight, akun dicentang; omzet = order closing Scalev lewat UTM campaign),
 * Shopee (laporan iklan yang seluruh periodenya di dalam rentang; omzet = GMV iklan), TikTok Shop (laporan iklan; omzet = penghasilan bruto).
 * Spend Meta belum termasuk pajak / admin (sama dengan halaman Iklan Meta).
 */
report.get("/iklan-semua", async c => {
  const { from, to } = range(c);
  const db = c.env.DB;
  // Meta: hanya campaign yang pernah menghasilkan order di Scalev (sama dengan Ringkasan & Laba Rugi); sisanya dilaporkan terpisah
  const SCALEV = "i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0)";
  const [meta, metaOmzet, shopee, shopeePotong, tiktok, metaLuar] = await db.batch([
    db.prepare(`SELECT i.date AS tgl, a.bm_id AS akun_id, b.name AS akun, SUM(i.spend) AS biaya, SUM(i.impressions) AS dilihat, SUM(i.link_clicks) AS klik
      FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id JOIN business_managers b ON b.id=a.bm_id
      WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? AND ${SCALEV} GROUP BY 1, 2`).bind(from, to),
    db.prepare(`SELECT o.draft_date AS tgl, a.bm_id AS akun_id, SUM(${CONFIRMED("o.")}) AS pesanan, SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS omzet
      FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign JOIN ad_accounts a ON a.id=cp.account_id
      WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND a.is_selected=1 GROUP BY 1, 2`).bind(from, to),
    db.prepare(`SELECT l.toko_id AS akun_id, t.nama AS akun, l.dari, l.sampai, SUM(i.biaya) AS biaya, SUM(i.omzet) AS omzet, SUM(i.konversi) AS pesanan,
        SUM(i.dilihat) AS dilihat, SUM(i.klik) AS klik
      FROM shopee_iklan_laporan l JOIN shopee_toko t ON t.id=l.toko_id JOIN shopee_iklan i ON i.laporan_id=l.id
      WHERE l.dari>=? AND l.sampai<=? GROUP BY l.id`).bind(from, to),
    db.prepare(`SELECT COUNT(*) AS n FROM shopee_iklan_laporan WHERE dari<=?2 AND sampai>=?1 AND (dari<?1 OR sampai>?2)`).bind(from, to),
    db.prepare(`SELECT i.tgl, i.toko_id AS akun_id, t.nama AS akun, SUM(i.biaya) AS biaya, SUM(i.omzet) AS omzet, SUM(i.pesanan) AS pesanan
      FROM tiktok_iklan i JOIN tiktok_toko t ON t.id=i.toko_id WHERE i.tgl BETWEEN ? AND ? GROUP BY 1, 2`).bind(from, to),
    db.prepare(`SELECT ROUND(SUM(i.spend)) AS biaya, COUNT(DISTINCT i.campaign_id) AS campaign FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
      WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? AND i.spend>0 AND NOT ${SCALEV}`).bind(from, to),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from, to, meta: meta.results, meta_omzet: metaOmzet.results, shopee: shopee.results, shopee_terpotong: shopeePotong.results[0]?.n ?? 0,
    tiktok: tiktok.results, meta_luar: metaLuar.results[0] ?? {} });
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

/**
 * Halaman Iklan Meta: pohon BM → campaign → ad set → ad untuk akun yang dicentang di Pengaturan.
 * Spend dari insight Meta; order dari Scalev lewat utm_campaign / utm_term / utm_content (= id Meta),
 * dihitung menurut tanggal order masuk. Order yang UTM-nya hanya sampai campaign (atau adset) masuk ke
 * baris "(… tidak terlacak)" supaya jumlah anak selalu sama dengan induknya.
 * Revenue cair = order dengan payment_status paid/settled (sama dengan halaman lain).
 * Revenue (revenue_closing) = nilai gross order closing (definisi CONFIRMED), dasar ROAS & ROI halaman ini.
 */
report.get("/iklan", async c => {
  const { from, to } = range(c);
  const [spend, orders, produk] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.bm_id, b.name AS bm_name, i.account_id, a.name AS account_name, i.campaign_id, cp.name AS campaign_name, cp.status AS campaign_status,
         i.adset_id, s.name AS adset_name, i.ad_id, ad.name AS ad_name,
         SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, SUM(i.link_clicks) AS link_clicks, SUM(i.pixel_purchases) AS pixel_purchases
       FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id JOIN business_managers b ON b.id=a.bm_id
         LEFT JOIN campaigns cp ON cp.id=i.campaign_id LEFT JOIN adsets s ON s.id=i.adset_id LEFT JOIN ads ad ON ad.id=i.ad_id
       WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? GROUP BY i.ad_id`).bind(from, to)
      .all<{ bm_id: string; bm_name: string; account_id: string; account_name: string; campaign_id: string; campaign_name: string | null; campaign_status: string | null;
        adset_id: string; adset_name: string | null; ad_id: string; ad_name: string | null; spend: number; impressions: number; link_clicks: number; pixel_purchases: number }>(),
    // Order ke campaign milik akun yang dicentang, termasuk campaign tanpa spend pada rentang ini.
    c.env.DB.prepare(
      `SELECT a.bm_id, b.name AS bm_name, cp.account_id, a.name AS account_name, o.utm_campaign AS campaign_id, cp.name AS campaign_name, cp.status AS campaign_status,
         CASE WHEN s.id IS NOT NULL THEN s.id END AS adset_id, s.name AS adset_name,
         CASE WHEN ad.id IS NOT NULL THEN ad.id END AS ad_id, ad.name AS ad_name,
         COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed, SUM(o.status='pending') AS pending, SUM(o.status='canceled') AS canceled,
         SUM(o.status='completed') AS completed, SUM(o.status IN ('rts','shipped_rts')) AS rts,
         SUM(CASE WHEN o.payment_status IN ('paid','settled') THEN o.gross_revenue ELSE 0 END) AS revenue,
         SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS revenue_closing
       FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign JOIN ad_accounts a ON a.id=cp.account_id JOIN business_managers b ON b.id=a.bm_id
         LEFT JOIN adsets s ON s.id=o.utm_term AND s.campaign_id=cp.id LEFT JOIN ads ad ON ad.id=o.utm_content AND ad.adset_id=s.id
       WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND a.is_selected=1
       GROUP BY o.utm_campaign, 8, 10`).bind(from, to)
      .all<{ bm_id: string; bm_name: string; account_id: string; account_name: string; campaign_id: string; campaign_name: string | null; campaign_status: string | null;
        adset_id: string | null; adset_name: string | null; ad_id: string | null; ad_name: string | null;
        orders: number; confirmed: number; pending: number; canceled: number; completed: number; rts: number; revenue: number; revenue_closing: number }>(),
    // Produk yang paling banyak dipesan lewat tiap campaign
    c.env.DB.prepare(
      `SELECT o.utm_campaign AS campaign_id, je.value AS product, COUNT(*) AS n
       FROM orders o JOIN json_each(o.product_names) je ON 1=1 JOIN campaigns cp ON cp.id=o.utm_campaign
       WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? GROUP BY 1, 2`).bind(from, to)
      .all<{ campaign_id: string; product: string; n: number }>(),
  ]);

  // Metrik yang dijumlahkan per node. Biaya (hpp … cod_fee) hanya dari order closing; *_kurang / tanpa_paket /
  // ongkir_estimasi = jumlah order yang angkanya belum lengkap, untuk catatan di halaman.
  const METRIK = ["spend", "impressions", "link_clicks", "pixel_purchases", "orders", "confirmed", "pending", "canceled", "completed", "rts",
    "revenue", "revenue_closing", "hpp", "scalev_fee", "ongkir", "cod_fee", "hpp_kurang", "tanpa_paket", "ongkir_estimasi"] as const;
  type Metrik = Record<(typeof METRIK)[number], number>;
  const nol = (): Metrik => Object.fromEntries(METRIK.map(k => [k, 0])) as Metrik;
  type Node = Metrik & { level: 1 | 2 | 3 | 4; id: string; parent: string | null; name: string; status?: string | null; account?: string; product?: string | null; untracked?: boolean };
  const nodes = new Map<string, Node>();
  const node = (key: string, init: () => Omit<Node, keyof Metrik>) => {
    let n = nodes.get(key);
    if (!n) { n = { ...init(), ...nol() }; nodes.set(key, n); }
    return n;
  };
  type Base = { bm_id: string; bm_name: string; account_name: string; campaign_id: string; campaign_name: string | null; campaign_status: string | null;
    adset_id: string | null; adset_name: string | null; ad_id: string | null; ad_name: string | null };
  // Rantai node untuk satu baris; adset/ad kosong → baris "(tidak terlacak)" di bawah induknya.
  const rantai = (r: Base) => {
    const bm = node(`bm:${r.bm_id}`, () => ({ level: 1, id: `bm:${r.bm_id}`, parent: null, name: r.bm_name }));
    const cpKey = `c:${r.campaign_id}`;
    const cp = node(cpKey, () => ({ level: 2, id: cpKey, parent: bm.id, name: r.campaign_name ?? r.campaign_id, status: r.campaign_status, account: r.account_name }));
    const asKey = r.adset_id ? `s:${r.adset_id}` : `s:${r.campaign_id}:x`;
    const as = node(asKey, () => ({ level: 3, id: asKey, parent: cpKey, name: r.adset_id ? (r.adset_name ?? r.adset_id) : "(ad set tidak terlacak)", untracked: !r.adset_id }));
    const adKey = r.ad_id ? `a:${r.ad_id}` : `a:${asKey}:x`;
    const ad = node(adKey, () => ({ level: 4, id: adKey, parent: asKey, name: r.ad_id ? (r.ad_name ?? r.ad_id) : "(ad tidak terlacak)", untracked: !r.ad_id }));
    return [bm, cp, as, ad];
  };
  for (const r of spend.results)
    for (const n of rantai(r)) { n.spend += r.spend; n.impressions += r.impressions; n.link_clicks += r.link_clicks; n.pixel_purchases += r.pixel_purchases; }
  for (const r of orders.results)
    for (const n of rantai(r)) { n.orders += r.orders; n.confirmed += r.confirmed; n.pending += r.pending; n.canceled += r.canceled; n.completed += r.completed; n.rts += r.rts; n.revenue += r.revenue; n.revenue_closing += r.revenue_closing; }

  const top = new Map<string, { product: string; n: number }>();
  for (const p of produk.results) { const t = top.get(p.campaign_id); if (!t || p.n > t.n) top.set(p.campaign_id, { product: p.product, n: p.n }); }
  for (const n of nodes.values()) if (n.level === 2) n.product = top.get(n.id.slice(2))?.product ?? null;

  const last = await c.env.DB.prepare("SELECT MAX(finished_at) AS t FROM sync_log WHERE source LIKE 'meta:insights:%' AND ok=1").first<{ t: string | null }>();
  // Nama gabungan produk (Data Produk) = kode di nama campaign; frontend hanya menampilkan campaign yang cocok.
  const gab = await c.env.DB.prepare("SELECT id, name, items FROM produk_gabungan ORDER BY name").all<{ id: number; name: string; items: string }>();

  // Order berisi produk gabungan yang TIDAK terlacak ke campaign mana pun di akun yang dicentang
  // (utm_campaign berupa teks manual, kosong, atau id campaign lain). Dipasangkan ke gabungan lewat
  // produknya — pencocokan nama order → item katalog sama dengan halaman Data Produk.
  type ItemHpp = ItemKatalog & { cogs: number | null };
  const [katalog, lepas] = await Promise.all([
    c.env.DB.prepare("SELECT key, kind, product_id, product_name, name, option_tail, sku, price, cogs, status FROM catalog_items").all<ItemHpp>(),
    c.env.DB.prepare(
      `SELECT o.id, je.value AS name,
         CASE WHEN json_array_length(o.product_names)=1 THEN json_extract(o.raw_json,'$.follow_up_chats[0].product_id') END AS product_id,
         ${CONFIRMED("o.")} AS confirmed, o.status='pending' AS pending, o.status='canceled' AS canceled, o.status='completed' AS completed, o.status IN ('rts','shipped_rts') AS rts,
         CASE WHEN o.payment_status IN ('paid','settled') THEN o.gross_revenue ELSE 0 END AS revenue,
         CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END AS revenue_closing
       FROM orders o JOIN json_each(o.product_names) je ON 1=1
       WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM campaigns cp JOIN ad_accounts a ON a.id=cp.account_id WHERE cp.id=o.utm_campaign AND a.is_selected=1)`)
      .bind(from, to).all<{ id: string; name: string; product_id: number | null; confirmed: number; pending: number; canceled: number; completed: number; rts: number; revenue: number; revenue_closing: number }>(),
  ]);
  const perNama = new Map<string, ItemHpp[]>(), perProduk = new Map<number, ItemHpp[]>();
  for (const it of katalog.results) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const gabPerKey = new Map<string, string[]>();
  for (const g of gab.results)
    for (const it of JSON.parse(g.items) as { key: string }[]) gabPerKey.set(it.key, [...(gabPerKey.get(it.key) ?? []), g.name]);
  // Satu order dihitung sekali per gabungan walau berisi beberapa produk gabungan yang sama.
  const perOrder = new Map<string, { gab: Set<string>; r: (typeof lepas.results)[number] }>();
  for (const r of lepas.results) {
    const it = cocokkan(r.name, r.product_id == null ? null : Number(r.product_id), perNama, perProduk);
    const g = gabPerKey.get(it?.key ?? `n:${r.name}`);
    if (!g) continue;
    const o = perOrder.get(r.id) ?? { gab: new Set<string>(), r };
    g.forEach(x => o.gab.add(x));
    perOrder.set(r.id, o);
  }
  const tanpaId = new Map<string, Metrik>();
  for (const { gab: gs, r } of perOrder.values())
    for (const g of gs) {
      const t = tanpaId.get(g) ?? nol();
      t.orders++; t.confirmed += r.confirmed; t.pending += r.pending; t.canceled += r.canceled; t.completed += r.completed; t.rts += r.rts; t.revenue += r.revenue; t.revenue_closing += r.revenue_closing;
      tanpaId.set(g, t);
    }

  // Biaya per order closing (HPP, Scalev fee, ongkir, COD fee) — lihat lib/biaya.ts
  const [closing, hitung] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, ${KOLOM_BIAYA},
         a.bm_id, b.name AS bm_name, a.name AS account_name, cp.id AS campaign_id, cp.name AS campaign_name, cp.status AS campaign_status,
         s.id AS adset_id, s.name AS adset_name, ad.id AS ad_id, ad.name AS ad_name
       FROM orders o LEFT JOIN campaigns cp ON cp.id=o.utm_campaign LEFT JOIN ad_accounts a ON a.id=cp.account_id AND a.is_selected=1
         LEFT JOIN business_managers b ON b.id=a.bm_id
         LEFT JOIN adsets s ON s.id=o.utm_term AND s.campaign_id=cp.id LEFT JOIN ads ad ON ad.id=o.utm_content AND ad.adset_id=s.id
       WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND ${CONFIRMED("o.")}`).bind(from, to)
      .all<Base & OrderBiaya & { id: string; bm_id: string | null }>(),
    siapkanBiaya(c.env.DB, from),
  ]);
  for (const o of closing.results) {
    const b = hitung(o);
    const tambah = (t: Metrik) => { t.hpp += b.hpp; t.scalev_fee += b.scalev_fee; t.ongkir += b.ongkir; t.cod_fee += b.cod_fee;
      t.hpp_kurang += b.hpp_kurang; t.tanpa_paket += b.tanpa_paket; t.ongkir_estimasi += b.ongkir_estimasi; };
    if (o.bm_id) rantai(o as Base).forEach(tambah);
    else for (const g of perOrder.get(o.id)?.gab ?? []) tambah(tanpaId.get(g)!);
  }

  const bulat = <T extends Metrik>(m: T): T => ({ ...m, spend: Math.round(m.spend), revenue: Math.round(m.revenue), revenue_closing: Math.round(m.revenue_closing),
    hpp: Math.round(m.hpp), scalev_fee: Math.round(m.scalev_fee), ongkir: Math.round(m.ongkir), cod_fee: Math.round(m.cod_fee) });
  const rows = [...nodes.values()].map(bulat);
  return c.json({ from, to, rows, last_sync: last?.t ?? null,
    gabungan: gab.results.map(g => ({ id: g.id, name: g.name, tanpa_id: tanpaId.has(g.name) ? bulat(tanpaId.get(g.name)!) : null })) });
});

/**
 * Halaman Iklan Meta › Konten: performa per ad (frontend yang menggabungkan per nama iklan bila dipilih).
 * Spend & metrik video dari insight Meta akun yang dicentang; lead/closing/omzet dari Scalev lewat utm_content = id ad,
 * menurut tanggal order masuk (sama dengan halaman Iklan Meta). Ad tanpa spend di rentang ini tetap tampil bila punya order.
 * Hanya campaign yang pernah menghasilkan order di Scalev (utm_campaign = id campaign), sama dengan halaman Ringkasan —
 * iklan yang ordernya tidak pernah masuk ke Scalev (mis. iklan aplikasi / toko lain) tidak ditampilkan.
 * video_belum = baris insight berspend yang ditarik sebelum kolom video ada (angka video-nya belum lengkap).
 * Omzet Meta / pembelian = pixel purchase (atribusi 7d click / 1d view). Kelompok (gabungan produk) dan editor
 * (kode di nama iklan) dicocokkan di frontend dari daftar `gabungan` dan `editors`.
 */
report.get("/konten", async c => {
  const { from, to } = range(c);
  const db = c.env.DB;
  const [ins, ord, last, gab, editors] = await Promise.all([
    db.prepare(
      `SELECT i.ad_id, i.account_id, SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, SUM(i.link_clicks) AS link_clicks,
         SUM(i.pixel_purchases) AS purchases, SUM(i.pixel_purchase_value) AS purchase_value,
         SUM(i.video_3s) AS video_3s, SUM(i.video_thruplay) AS thruplay, SUM(i.video_p100) AS p100,
         SUM(i.video_synced=0 AND i.spend>0) AS video_belum
       FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
       WHERE a.is_selected=1 AND i.date BETWEEN ? AND ?
         AND i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0)
       GROUP BY i.ad_id`).bind(from, to)
      .all<{ ad_id: string; account_id: string; spend: number; impressions: number; link_clicks: number; purchases: number; purchase_value: number;
        video_3s: number; thruplay: number; p100: number; video_belum: number }>(),
    db.prepare(
      `SELECT o.utm_content AS ad_id, COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS closing,
         SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS omzet
       FROM orders o JOIN ads ad ON ad.id=o.utm_content JOIN campaigns cp ON cp.id=ad.campaign_id JOIN ad_accounts a ON a.id=cp.account_id
       WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND a.is_selected=1 GROUP BY o.utm_content`).bind(from, to)
      .all<{ ad_id: string; orders: number; closing: number; omzet: number }>(),
    db.prepare("SELECT MAX(finished_at) AS t FROM sync_log WHERE source LIKE 'meta:insights:%' AND ok=1").first<{ t: string | null }>(),
    db.prepare("SELECT name FROM produk_gabungan ORDER BY name").all<{ name: string }>(),
    db.prepare("SELECT id, name, codes FROM editor_konten ORDER BY name").all<{ id: number; name: string; codes: string }>(),
  ]);
  const ids = [...new Set([...ins.results.map(r => r.ad_id), ...ord.results.map(r => r.ad_id)])];
  const info = await db.prepare(
    `SELECT ad.id, ad.name, ad.status, ad.object_type, ad.thumbnail_url, ad.image_url, ad.video_id, ad.creative_id,
       cp.name AS campaign_name, s.name AS adset_name, b.name AS bm_name, a.id AS account_id, a.name AS account_name
     FROM ads ad LEFT JOIN campaigns cp ON cp.id=ad.campaign_id LEFT JOIN adsets s ON s.id=ad.adset_id
       LEFT JOIN ad_accounts a ON a.id=cp.account_id LEFT JOIN business_managers b ON b.id=a.bm_id
     WHERE ad.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids))
    .all<{ id: string; name: string; status: string | null; object_type: string | null; thumbnail_url: string | null; image_url: string | null;
      video_id: string | null; creative_id: string | null; campaign_name: string | null; adset_name: string | null; bm_name: string | null;
      account_id: string | null; account_name: string | null }>();
  const perIns = new Map(ins.results.map(r => [r.ad_id, r])), perOrd = new Map(ord.results.map(r => [r.ad_id, r]));
  const ads = info.results.map(a => {
    const i = perIns.get(a.id), o = perOrd.get(a.id);
    return { ...a, spend: Math.round(i?.spend ?? 0), impressions: i?.impressions ?? 0, link_clicks: i?.link_clicks ?? 0,
      purchases: i?.purchases ?? 0, purchase_value: Math.round(i?.purchase_value ?? 0),
      video_3s: i?.video_3s ?? 0, thruplay: i?.thruplay ?? 0, p100: i?.p100 ?? 0,
      orders: o?.orders ?? 0, closing: o?.closing ?? 0, omzet: Math.round(o?.omzet ?? 0) };
  });
  const video_belum = ins.results.reduce((s, r) => s + r.video_belum, 0);
  return c.json({ from, to, ads, video_belum, last_sync: last?.t ?? null, gabungan: gab.results.map(g => g.name),
    editors: editors.results.map(e => ({ id: e.id, name: e.name, codes: JSON.parse(e.codes) as string[] })) });
});

/**
 * Halaman Ringkasan: pipeline iklan → order → konfirmasi → kirim → cair, KPI harian, grafik, dan per BM.
 * Filter: rentang (tanggal order masuk), bm (BM iklan), store (store Scalev).
 *  - Spend: akun iklan yang dicentang, hanya campaign yang pernah menghasilkan order di Scalev; filter BM / store
 *    (store = pasangan store pada ad account). Spend campaign lain dilaporkan terpisah sebagai spend_luar.
 *  - Order: semua order non-spam; filter store lewat store_id, filter BM lewat utm_campaign → campaign milik BM itu
 *    (order tanpa UTM campaign ikut hilang saat filter BM dipakai).
 * Net profit memakai rumus yang sama dengan halaman Iklan Meta (lib/biaya.ts).
 */
report.get("/ringkasan", async c => {
  const { from, to } = range(c);
  // store disisipkan langsung ke SQL, jadi wajib bilangan bulat
  const bm = c.req.query("bm") || null, sq = Number(c.req.query("store")), store = c.req.query("store") && Number.isInteger(sq) ? sq : null;
  const db = c.env.DB;
  // Filter bersama. p = prefix alias tabel orders (o.) / ad_accounts (a.)
  const wOrder = (p = "o.") => `${p}is_spam=0${store != null ? ` AND ${p}store_id=${store}` : ""}` +
    (bm ? ` AND ${p}utm_campaign IN (SELECT cp.id FROM campaigns cp JOIN ad_accounts ax ON ax.id=cp.account_id WHERE ax.bm_id=?)` : "");
  const wSpend = `a.is_selected=1${bm ? " AND a.bm_id=?" : ""}${store != null ? ` AND a.store_id=${store}` : ""}`;
  const argBm = bm ? [bm] : [];
  // Hanya campaign yang pernah menghasilkan order di Scalev (utm_campaign = id campaign); iklan yang ordernya
  // tidak pernah masuk ke Scalev (mis. iklan aplikasi / toko lain) tidak dihitung — spend-nya dilaporkan terpisah.
  const SCALEV = "i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0)";
  const today = todayReport();
  const hariLalu = (n: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

  const [luar, spend, ord, closing, harian, bmSpend, bmOrder, bmTop, kpiSpend, kpiOrder, kpiStore, rtsHari, rtsKurir, bms, stores] = await Promise.all([
    db.prepare(`SELECT ROUND(SUM(i.spend)) AS spend, COUNT(DISTINCT CASE WHEN i.spend>0 THEN i.campaign_id END) AS campaigns
      FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE ${wSpend} AND NOT ${SCALEV} AND i.date BETWEEN ? AND ?`)
      .bind(...argBm, from, to).first<{ spend: number | null; campaigns: number }>(),
    db.prepare(`SELECT ROUND(SUM(i.spend)) AS spend, SUM(i.impressions) AS impressions, SUM(i.link_clicks) AS link_clicks,
        COUNT(DISTINCT CASE WHEN i.spend>0 THEN i.campaign_id END) AS campaigns, COUNT(DISTINCT CASE WHEN i.spend>0 THEN a.bm_id END) AS bms
      FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE ${wSpend} AND ${SCALEV} AND i.date BETWEEN ? AND ?`)
      .bind(...argBm, from, to).first<{ spend: number | null; impressions: number | null; link_clicks: number | null; campaigns: number; bms: number }>(),
    db.prepare(`SELECT COUNT(*) AS orders, SUM(o.gross_revenue) AS nilai, SUM(o.is_cod) AS cod, SUM(o.is_cod=0) AS transfer,
        SUM(${CONFIRMED("o.")}) AS confirmed, SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value,
        SUM(${CONFIRMED("o.")} AND o.is_cod=0 AND o.payment_status IN ('paid','settled')) AS tf_paid,
        SUM(o.status IN ('shipped','completed','rts','shipped_rts')) AS shipped,
        SUM(CASE WHEN o.status IN ('shipped','completed','rts','shipped_rts') THEN o.gross_revenue ELSE 0 END) AS shipped_value,
        SUM(o.status IN ('confirmed','in_process','ready')) AS antre,
        SUM(o.status='shipped') AS perjalanan, SUM(CASE WHEN o.status='shipped' THEN o.gross_revenue ELSE 0 END) AS perjalanan_value,
        SUM(o.status='completed' AND o.is_cod=1) AS cair_cod,
        SUM(CASE WHEN o.payment_status IN ('paid','settled') THEN o.gross_revenue ELSE 0 END) AS revenue_paid,
        SUM(o.status='completed') AS completed, SUM(o.status IN ('rts','shipped_rts')) AS rts,
        SUM(o.status IN ('rts','shipped_rts','canceled')) AS hilang,
        SUM(CASE WHEN o.status IN ('rts','shipped_rts','canceled') THEN o.gross_revenue ELSE 0 END) AS hilang_value,
        SUM(o.status='canceled') AS batal, SUM(CASE WHEN o.status='canceled' THEN o.gross_revenue ELSE 0 END) AS batal_value
      FROM orders o WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ?`).bind(...argBm, from, to).first<Record<string, number | null>>(),
    db.prepare(`SELECT ${KOLOM_BIAYA} FROM orders o WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ? AND ${CONFIRMED("o.")}`)
      .bind(...argBm, from, to).all<OrderBiaya>(),
    // Deret harian: revenue cair = order masuk hari itu yang sudah dibayar / COD cair
    db.prepare(`WITH d AS (SELECT i.date, SUM(i.spend) AS spend FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
          WHERE ${wSpend} AND ${SCALEV} AND i.date BETWEEN ? AND ? GROUP BY i.date),
        o AS (SELECT o.draft_date AS date, COUNT(*) AS orders, SUM(CASE WHEN o.payment_status IN ('paid','settled') THEN o.gross_revenue ELSE 0 END) AS revenue_paid
          FROM orders o WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ? GROUP BY o.draft_date)
      SELECT d.date, ROUND(d.spend) AS spend, COALESCE(o.orders,0) AS orders, COALESCE(o.revenue_paid,0) AS revenue_paid FROM d LEFT JOIN o ON o.date=d.date
      UNION SELECT o.date, 0, o.orders, o.revenue_paid FROM o WHERE o.date NOT IN (SELECT date FROM d) ORDER BY 1`)
      .bind(...argBm, from, to, ...argBm, from, to).all<{ date: string; spend: number; orders: number; revenue_paid: number }>(),
    // Per BM: spend, akun, lalu order lewat UTM campaign
    db.prepare(`SELECT b.id, b.name, ROUND(SUM(i.spend)) AS spend, COUNT(DISTINCT a.id) AS akun
      FROM business_managers b JOIN ad_accounts a ON a.bm_id=b.id LEFT JOIN ad_insights_daily i ON i.account_id=a.id AND i.date BETWEEN ? AND ? AND ${SCALEV}
      WHERE ${wSpend} GROUP BY b.id`).bind(from, to, ...argBm).all<{ id: string; name: string; spend: number | null; akun: number }>(),
    db.prepare(`SELECT ax.bm_id AS id, COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
        SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS omzet,
        SUM(CASE WHEN o.payment_status IN ('paid','settled') THEN o.gross_revenue ELSE 0 END) AS revenue_paid
      FROM orders o LEFT JOIN campaigns cp ON cp.id=o.utm_campaign LEFT JOIN ad_accounts ax ON ax.id=cp.account_id AND ax.is_selected=1
      WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ? GROUP BY ax.bm_id`)
      .bind(...argBm, from, to).all<{ id: string | null; orders: number; confirmed: number; omzet: number; revenue_paid: number }>(),
    // Campaign dengan spend terbesar per BM (untuk catatan)
    db.prepare(`SELECT a.bm_id, cp.name, SUM(i.spend) AS spend FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
      LEFT JOIN campaigns cp ON cp.id=i.campaign_id WHERE ${wSpend} AND ${SCALEV} AND i.date BETWEEN ? AND ? GROUP BY a.bm_id, i.campaign_id`)
      .bind(...argBm, from, to).all<{ bm_id: string; name: string | null; spend: number }>(),
    // KPI harian (tidak ikut rentang): 14 hari terakhir
    db.prepare(`SELECT i.date, SUM(i.spend) AS spend FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
      WHERE ${wSpend} AND ${SCALEV} AND i.date BETWEEN ? AND ? GROUP BY i.date`).bind(...argBm, hariLalu(13), today).all<{ date: string; spend: number }>(),
    db.prepare(`SELECT o.draft_date AS date, COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed
      FROM orders o WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ? GROUP BY o.draft_date`).bind(...argBm, hariLalu(13), today)
      .all<{ date: string; orders: number; confirmed: number }>(),
    db.prepare(`SELECT o.store_name, COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed
      FROM orders o WHERE ${wOrder()} AND o.draft_date BETWEEN ? AND ? GROUP BY o.store_id HAVING COUNT(*)>=10`)
      .bind(...argBm, hariLalu(6), today).all<{ store_name: string; orders: number; confirmed: number }>(),
    // RTS dari paket Mengantar (tanggal paket dibuat, WIB), 66 hari terakhir untuk rolling 30 hari + pembanding
    db.prepare(`SELECT date(created_at,'+7 hours') AS date, SUM(status_simple='DELIVERED') AS delivered, SUM(status_simple='RTS') AS rts
      FROM shipments WHERE date(created_at,'+7 hours') >= ? GROUP BY 1`).bind(hariLalu(65)).all<{ date: string; delivered: number; rts: number }>(),
    db.prepare(`SELECT courier, SUM(status_simple='DELIVERED') AS delivered, SUM(status_simple='RTS') AS rts
      FROM shipments WHERE date(created_at,'+7 hours') >= ? GROUP BY courier HAVING SUM(status_simple IN ('DELIVERED','RTS'))>=20`)
      .bind(hariLalu(29)).all<{ courier: string; delivered: number; rts: number }>(),
    db.prepare("SELECT id, name FROM business_managers ORDER BY rowid").all<{ id: string; name: string }>(),
    db.prepare("SELECT id, name FROM stores ORDER BY name").all<{ id: number; name: string }>(),
  ]);

  // RTS dari paket Mengantar yang dibuat pada rentang ini (WIB) — status RTS di Scalev jarang diperbarui.
  // Tidak bisa ikut filter BM / store: resi di Scalev kebanyakan kosong, jadi paket tidak bisa dipasangkan ke order.
  const rtsMg = await db.prepare(
    `SELECT COUNT(*) AS paket, SUM(status_simple='DELIVERED') AS delivered, SUM(status_simple='RTS') AS rts,
       SUM(CASE WHEN status_simple='RTS' THEN cod_amount ELSE 0 END) AS rts_value
     FROM shipments WHERE date(created_at,'+7 hours') BETWEEN ? AND ?`).bind(from, to)
    .first<{ paket: number; delivered: number | null; rts: number | null; rts_value: number | null }>();

  // Biaya closing → net profit
  const hitung = await siapkanBiaya(db, from);
  const biaya = { hpp: 0, scalev_fee: 0, ongkir: 0, cod_fee: 0, hpp_kurang: 0, tanpa_paket: 0, ongkir_estimasi: 0 };
  for (const o of closing.results) { const b = hitung(o); for (const k of Object.keys(biaya) as (keyof typeof biaya)[]) biaya[k] += b[k]; }

  // Per BM: gabung spend & order; order tanpa BM (UTM kosong / bukan campaign akun terpilih) jadi baris sendiri
  const perOrderBm = new Map(bmOrder.results.map(r => [r.id, r]));
  const topCp = new Map<string, { name: string | null; spend: number }>();
  for (const r of bmTop.results) { const t = topCp.get(r.bm_id); if (!t || r.spend > t.spend) topCp.set(r.bm_id, { name: r.name, spend: r.spend }); }
  const perBm = bmSpend.results.map(b => {
    const o = perOrderBm.get(b.id);
    return { id: b.id, name: b.name, akun: b.akun, spend: b.spend ?? 0, orders: o?.orders ?? 0, confirmed: o?.confirmed ?? 0, omzet: o?.omzet ?? 0,
      revenue_paid: o?.revenue_paid ?? 0, top_campaign: topCp.get(b.id) ?? null };
  }).sort((a, b) => b.spend - a.spend);
  const tanpaBm = perOrderBm.get(null) ?? null;

  const iso = (n: number) => hariLalu(n);
  return c.json({
    from, to, today, spend, spend_luar: luar, orders: ord, biaya, rts_mengantar: rtsMg, harian: harian.results, per_bm: perBm, tanpa_bm: bm ? null : tanpaBm,
    marketplace: await ringkasanMarketplace(db, from, to),
    kpi: {
      spend: Array.from({ length: 14 }, (_, i) => ({ date: iso(13 - i), spend: Math.round(kpiSpend.results.find(r => r.date === iso(13 - i))?.spend ?? 0) })),
      orders: Array.from({ length: 14 }, (_, i) => { const r = kpiOrder.results.find(x => x.date === iso(13 - i)); return { date: iso(13 - i), orders: r?.orders ?? 0, confirmed: r?.confirmed ?? 0 }; }),
      store_7d: kpiStore.results,
      rts_hari: rtsHari.results, rts_kurir: rtsKurir.results,
    },
    pilihan: { bms: bms.results, stores: stores.results },
  });
});

/**
 * Shopee & TikTok Shop untuk Ringkasan, menurut tanggal pesanan dibuat (sama dengan halaman Pesanan masing-masing):
 *  - pesanan = semua pesanan masuk; omzet = subtotal pesanan selain batal & belum bayar; terkirim = terkirim / diterima / selesai.
 *  - spend = laporan iklan menurut tanggal tayang (laporan Shopee lebih dari satu hari dibagi rata); omzet iklan = GMV / penghasilan bruto iklan.
 * Tidak ikut filter BM / store (khusus Scalev).
 */
async function ringkasanMarketplace(db: D1Database, from: string, to: string) {
  const PESANAN = (t: string, terkirim: string) => `SELECT substr(p.dibuat,1,10) AS tgl, COUNT(*) AS pesanan,
      SUM(p.status NOT IN ('batal','belum_bayar')) AS laku, SUM(CASE WHEN p.status NOT IN ('batal','belum_bayar') THEN p.subtotal ELSE 0 END) AS omzet,
      SUM(p.status IN (${terkirim})) AS terkirim, SUM(CASE WHEN p.status IN (${terkirim}) THEN p.subtotal ELSE 0 END) AS terkirim_nilai,
      SUM(p.status IN ('perlu_dikirim','dikirim')) AS proses, SUM(p.status='batal') AS batal, SUM(p.status='retur') AS retur
    FROM ${t} p WHERE substr(p.dibuat,1,10) BETWEEN ? AND ? GROUP BY 1`;
  const [shp, tt, shpIklan, ttIklan] = await db.batch([
    db.prepare(PESANAN("shopee_pesanan", "'terkirim','diterima','selesai'")).bind(from, to),
    db.prepare(PESANAN("tiktok_pesanan", "'terkirim','selesai'")).bind(from, to),
    db.prepare(`SELECT l.dari, l.sampai, SUM(i.biaya) AS biaya, SUM(i.omzet) AS omzet FROM shopee_iklan_laporan l JOIN shopee_iklan i ON i.laporan_id=l.id
      WHERE l.dari<=? AND l.sampai>=? GROUP BY l.id`).bind(to, from),
    db.prepare("SELECT tgl, SUM(biaya) AS biaya, SUM(omzet) AS omzet FROM tiktok_iklan WHERE tgl BETWEEN ? AND ? GROUP BY 1").bind(from, to),
  ]) as D1Result<Record<string, any>>[];
  type Hari = { tgl: string; pesanan: number; laku: number; omzet: number; terkirim: number; terkirim_nilai: number; proses: number; batal: number; retur: number; spend: number; omzet_iklan: number };
  const olah = (pesanan: Record<string, any>[], iklan: { tgl: string; biaya: number; omzet: number }[]) => {
    const per = new Map<string, Hari>();
    const ambil = (tgl: string) => { let h = per.get(tgl); if (!h) { h = { tgl, pesanan: 0, laku: 0, omzet: 0, terkirim: 0, terkirim_nilai: 0, proses: 0, batal: 0, retur: 0, spend: 0, omzet_iklan: 0 }; per.set(tgl, h); } return h; };
    for (const r of pesanan) { const h = ambil(r.tgl); for (const k of ["pesanan", "laku", "omzet", "terkirim", "terkirim_nilai", "proses", "batal", "retur"] as const) h[k] += Number(r[k]) || 0; }
    for (const r of iklan) { const h = ambil(r.tgl); h.spend += r.biaya; h.omzet_iklan += r.omzet; }
    const harian = [...per.values()].sort((a, b) => a.tgl.localeCompare(b.tgl)).map(h => ({ ...h, spend: Math.round(h.spend), omzet_iklan: Math.round(h.omzet_iklan) }));
    const total = harian.reduce((t, h) => { for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += h[k]; return t; },
      { pesanan: 0, laku: 0, omzet: 0, terkirim: 0, terkirim_nilai: 0, proses: 0, batal: 0, retur: 0, spend: 0, omzet_iklan: 0 });
    return { total, harian };
  };
  // Laporan iklan Shopee > 1 hari: biaya & GMV dibagi rata ke hari-harinya, hanya hari di dalam rentang
  const shpHari: { tgl: string; biaya: number; omzet: number }[] = [];
  for (const l of shpIklan.results) {
    const hari: string[] = [];
    for (let d = new Date(`${l.dari}T00:00:00Z`); d.toISOString().slice(0, 10) <= l.sampai; d.setUTCDate(d.getUTCDate() + 1)) hari.push(d.toISOString().slice(0, 10));
    for (const h of hari) if (h >= from && h <= to) shpHari.push({ tgl: h, biaya: (Number(l.biaya) || 0) / hari.length, omzet: (Number(l.omzet) || 0) / hari.length });
  }
  return {
    shopee: olah(shp.results, shpHari),
    tiktok: olah(tt.results, ttIklan.results.map(r => ({ tgl: r.tgl, biaya: Number(r.biaya) || 0, omzet: Number(r.omzet) || 0 }))),
  };
}

/** Order per store, pipeline COD vs TF, kecepatan proses, dan daftar order terbaru. */
report.get("/orders", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const status = c.req.query("status");          // status order Scalev, kosong = semua
  const payment = c.req.query("payment");        // cod | transfer, kosong = semua

  // Filter dasar dipakai semua agregat; filter status & pembayaran hanya untuk daftar order
  // supaya dua kartu pipeline tetap bisa membandingkan COD dengan transfer.
  const baseWhere = (p = "") => `${p}is_spam=0 AND ${p}draft_date BETWEEN ? AND ?${store ? ` AND ${p}store_id=?` : ""}`;
  const base = baseWhere();
  const baseArgs = store ? [from, to, store] : [from, to];

  const byPay = await c.env.DB.prepare(
    `SELECT is_cod, ${ORDER_AGG} FROM orders WHERE ${base} GROUP BY is_cod`).bind(...baseArgs).all();
  const byStore = await c.env.DB.prepare(
    `SELECT store_id, store_name, ${ORDER_AGG} FROM orders WHERE ${base} GROUP BY store_id ORDER BY orders DESC`).bind(...baseArgs).all();

  // Kecepatan proses sengaja diukur dari draft_time dan shipped_time, bukan confirmed_time:
  // lihat catatan pada CONFIRMED di atas — stempel waktu konfirmasi Scalev tidak andal.
  // Sebagian order punya stempel waktu tidak masuk akal — mis. 15 order bertanggal
  // completed_time "0026-08-26T18:25:00Z" (tahun 0026) dari satu operasi massal di Scalev
  // pada 26 Agu 2026. Satu baris saja cukup menggeser rata-rata ribuan jam, jadi rata-rata
  // hanya dihitung dari selisih yang urut dan masih di bawah 90 hari.
  const wajarKirim = `shipped_time > draft_time AND julianday(shipped_time)-julianday(draft_time) < 90`;
  const wajarSelesai = `completed_time > shipped_time AND julianday(completed_time)-julianday(shipped_time) < 90`;
  const speed = await c.env.DB.prepare(
    `SELECT ROUND(AVG(CASE WHEN shipped_time IS NOT NULL AND draft_time IS NOT NULL AND ${wajarKirim}
             THEN julianday(shipped_time)-julianday(draft_time) END),2) AS days_to_ship,
       SUM(shipped_time IS NOT NULL AND draft_time IS NOT NULL AND ${wajarKirim}) AS n_shipped,
       ROUND(AVG(CASE WHEN is_cod=1 AND completed_time IS NOT NULL AND shipped_time IS NOT NULL AND ${wajarSelesai}
             THEN julianday(completed_time)-julianday(shipped_time) END),2) AS days_ship_to_done_cod,
       SUM(is_cod=1 AND completed_time IS NOT NULL AND shipped_time IS NOT NULL AND ${wajarSelesai}) AS n_done_cod,
       SUM((completed_time IS NOT NULL AND completed_time < '1900')
           OR (shipped_time IS NOT NULL AND shipped_time < '1900')
           OR (draft_time IS NOT NULL AND draft_time < '1900')) AS bad_timestamps,
       SUM(status IN ('confirmed','in_process','ready')) AS waiting_ship,
       -- Nilai order rata-rata hanya dari lead closing (definisi CONFIRMED), bukan semua lead
       ROUND(AVG(CASE WHEN ${CONFIRMED()} THEN gross_revenue END)) AS aov,
       ROUND(AVG(CASE WHEN ${CONFIRMED()} AND is_cod=1 THEN gross_revenue END)) AS aov_cod,
       ROUND(AVG(CASE WHEN ${CONFIRMED()} AND is_cod=0 THEN gross_revenue END)) AS aov_transfer,
       SUM(${CONFIRMED()}) AS n_closing
     FROM orders WHERE ${base}`).bind(...baseArgs).first();

  const recentWhere = [baseWhere("o.")];
  const recentArgs = [...baseArgs];
  if (status) { recentWhere.push("o.status=?"); recentArgs.push(status); }
  if (payment === "cod") recentWhere.push("o.is_cod=1");
  else if (payment === "transfer") recentWhere.push("o.is_cod=0");
  const recent = await c.env.DB.prepare(
    `SELECT o.order_id, o.draft_time, o.store_name, o.product_names, o.payment_method, o.status, o.payment_status,
       o.gross_revenue, o.utm_content, o.tags, ad.name AS ad_name
     FROM orders o LEFT JOIN ads ad ON ad.id=o.utm_content
     WHERE ${recentWhere.join(" AND ")} ORDER BY o.draft_time DESC LIMIT 50`).bind(...recentArgs).all();

  const statuses = await c.env.DB.prepare(
    `SELECT status, COUNT(*) AS orders FROM orders WHERE ${base} GROUP BY status ORDER BY orders DESC`).bind(...baseArgs).all();

  // Potensi omzet = nilai gross order per kelompok status; Complete memakai definisi CONFIRMED
  // (sama dengan halaman Performa CS & Performa Lead). Status lain (mis. draft) hanya masuk total.
  const omzet = await c.env.DB.prepare(
    `SELECT COUNT(*) AS orders, SUM(gross_revenue) AS total,
       SUM(${CONFIRMED()}) AS confirmed, SUM(CASE WHEN ${CONFIRMED()} THEN gross_revenue ELSE 0 END) AS confirmed_value,
       SUM(status='pending') AS pending, SUM(CASE WHEN status='pending' THEN gross_revenue ELSE 0 END) AS pending_value,
       SUM(status='canceled') AS canceled, SUM(CASE WHEN status='canceled' THEN gross_revenue ELSE 0 END) AS canceled_value
     FROM orders WHERE ${base}`).bind(...baseArgs).first();

  // Grafik COD vs Non-COD: per tanggal order masuk, plus nilai tiap tahap untuk mode Omzet
  const harian = await c.env.DB.prepare(
    `SELECT draft_date AS date, is_cod, COUNT(*) AS orders, SUM(${CONFIRMED()}) AS confirmed,
       SUM(gross_revenue) AS gross_all, SUM(CASE WHEN ${CONFIRMED()} THEN gross_revenue ELSE 0 END) AS gross_confirmed
     FROM orders WHERE ${base} GROUP BY draft_date, is_cod ORDER BY draft_date`).bind(...baseArgs).all();
  const nilaiTahap = await c.env.DB.prepare(
    `SELECT is_cod, SUM(CASE WHEN status IN ('shipped','shipped_rts','completed','rts') THEN gross_revenue ELSE 0 END) AS shipped_value,
       SUM(CASE WHEN status='completed' THEN gross_revenue ELSE 0 END) AS completed_value
     FROM orders WHERE ${base} GROUP BY is_cod`).bind(...baseArgs).all();

  return c.json({ from, to, by_payment: byPay.results, by_store: byStore.results, speed, statuses: statuses.results, recent: recent.results, omzet,
    harian: harian.results, nilai_tahap: nilaiTahap.results });
});

/**
 * Silang CS × produk: melihat apakah seorang CS lemah di semua produk atau hanya
 * di produk tertentu — sesuatu yang tidak terlihat pada angka gabungan per CS.
 * Frontend yang memutar (pivot) datanya, supaya ganti metrik tidak perlu memanggil ulang.
 */
report.get("/cs-produk", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  const metrik = `COUNT(*) AS orders,
    SUM(${CONFIRMED("o.")}) AS confirmed,
    ROUND(100.0*SUM(${CONFIRMED("o.")})/COUNT(*),1) AS confirm_rate,
    SUM(o.status='pending') AS pending,
    SUM(o.status='canceled') AS canceled,
    SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value`;
  const pecah = `FROM orders o JOIN json_each(o.product_names) je ON 1=1 WHERE ${w}`;

  const cells = await c.env.DB.prepare(
    `SELECT COALESCE(o.handler_id,0) AS handler_id, COALESCE(o.handler_name,'Belum ada handler') AS handler_name,
       je.value AS product, ${metrik} ${pecah}
     GROUP BY COALESCE(o.handler_id,0), je.value ORDER BY orders DESC LIMIT 600`).bind(...args).all();
  // Total per CS dihitung dari seluruh produk, bukan hanya kolom yang ditampilkan.
  const perCs = await c.env.DB.prepare(
    `SELECT COALESCE(o.handler_id,0) AS handler_id, COALESCE(o.handler_name,'Belum ada handler') AS handler_name, ${metrik}
     FROM orders o WHERE ${w} GROUP BY COALESCE(o.handler_id,0) ORDER BY orders DESC`).bind(...args).all();
  // Per produk ikut membawa RTS lewat join ke shipments; `cells` sengaja tidak,
  // agar jumlah barisnya tidak terpengaruh bila satu resi punya lebih dari satu catatan.
  const perProduct = await c.env.DB.prepare(
    `SELECT je.value AS product, ${metrik},
       SUM(s.status_simple='RTS') AS rts,
       ROUND(100.0*SUM(s.status_simple='RTS')/NULLIF(SUM(s.status_simple IN ('RTS','DELIVERED')),0),1) AS rts_rate
     FROM orders o JOIN json_each(o.product_names) je ON 1=1
       LEFT JOIN shipments s ON s.receipt=o.shipment_receipt
     WHERE ${w} GROUP BY je.value ORDER BY orders DESC LIMIT 40`).bind(...args).all();

  return c.json({ from, to, cells: cells.results, per_cs: perCs.results, per_product: perProduct.results });
});

/**
 * Data Produk: katalog Scalev dikelompokkan menjadi Satuan (PU) / Bundling (PB) / Bonus (BO) /
 * Belum ber-SKU, lengkap dengan lead, closing, dan omzet closing pada rentang tanggal.
 * Nama produk di order yang tidak ketemu di katalog ikut tampil sebagai item sendiri
 * (kind 'order') supaya jumlah omzet semua kelompok sama dengan total omzet closing.
 * Order berisi beberapa produk dibagi rata nilainya ke tiap produk (tidak dihitung ganda).
 */
type Baris = ItemKatalog & { cogs: number | null; stores: string | null };

report.get("/katalog", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  const [items, manual, agg, sync, gabungan] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ci.key, ci.kind, ci.product_id, COALESCE(ci.product_name, '') AS product_name, ci.name, ci.option_tail, ci.sku,
         ci.price, ci.cogs, ci.status, cp.stores
       FROM catalog_items ci LEFT JOIN catalog_products cp ON cp.id=ci.product_id`).all<Baris>(),
    c.env.DB.prepare("SELECT item_key, category FROM product_categories").all<{ item_key: string; category: Kategori }>(),
    c.env.DB.prepare(
      `SELECT je.value AS name,
         CASE WHEN json_array_length(o.product_names)=1 THEN json_extract(o.raw_json,'$.follow_up_chats[0].product_id') END AS product_id,
         COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS closing,
         SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue*1.0/json_array_length(o.product_names) ELSE 0 END) AS omzet
       FROM orders o JOIN json_each(o.product_names) je ON 1=1 WHERE ${w} GROUP BY 1, 2`).bind(...args)
      .all<{ name: string; product_id: number | null; orders: number; closing: number; omzet: number }>(),
    c.env.DB.prepare("SELECT finished_at, ok, message FROM sync_log WHERE source='scalev:catalog' ORDER BY id DESC LIMIT 1").first(),
    c.env.DB.prepare("SELECT id, name, items FROM produk_gabungan ORDER BY id").all<{ id: number; name: string; items: string }>(),
  ]);

  const perNama = new Map<string, Baris[]>(), perProduk = new Map<number, Baris[]>();
  for (const it of items.results) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const namaProduk = new Map(items.results.filter(i => i.product_id != null).map(i => [i.product_id!, i.product_name]));

  type Angka = { orders: number; closing: number; omzet: number };
  const angka = new Map<string, Angka>();
  const lepas = new Map<string, Baris>();   // nama order tanpa pasangan di katalog
  for (const r of agg.results) {
    const pid = r.product_id == null ? null : Number(r.product_id);
    let it: Baris | null = cocokkan(r.name, pid, perNama, perProduk);
    if (!it) {
      const key = `n:${r.name}`;
      it = lepas.get(key) ?? { key, kind: "order", product_id: pid, product_name: pid != null ? namaProduk.get(pid) ?? null : null,
        name: r.name, option_tail: null, sku: null, price: null, cogs: null, status: null, stores: null };
      lepas.set(key, it);
    }
    const a = angka.get(it.key) ?? { orders: 0, closing: 0, omzet: 0 };
    a.orders += r.orders; a.closing += r.closing; a.omzet += r.omzet;
    angka.set(it.key, a);
  }

  const pilihan = new Map(manual.results.map(m => [m.item_key, m.category]));
  const semua = [...items.results, ...lepas.values()]
    // Item yang sudah dihapus di Scalev hanya ditampilkan bila masih punya order pada rentang ini.
    .filter(it => it.status !== "deleted" || angka.has(it.key))
    .map(it => {
      const auto = kategoriOtomatis(it), a = angka.get(it.key) ?? { orders: 0, closing: 0, omzet: 0 };
      return {
        key: it.key, kind: it.kind, product_name: it.product_name, name: it.name, sku: it.sku, price: it.price,
        cogs: it.cogs, status: it.status, stores: it.stores ? JSON.parse(it.stores) as string[] : [],
        category: pilihan.get(it.key) ?? auto, category_auto: auto, manual: pilihan.has(it.key),
        orders: a.orders, closing: a.closing, omzet: Math.round(a.omzet),
      };
    })
    .sort((x, y) => y.omzet - x.omzet || y.orders - x.orders || x.name.localeCompare(y.name));

  // Angka gabungan dihitung di frontend dari `items`, jadi ikut filter tanggal & store yang sama.
  const gab = gabungan.results.map(g => ({ id: g.id, name: g.name, items: JSON.parse(g.items) as { key: string; name: string }[] }));
  return c.json({ from, to, katalog_kosong: items.results.length === 0, last_sync: sync, items: semua, gabungan: gab });
});

/**
 * Persebaran per provinsi: disilangkan dengan CS dan dengan produk, plus sebaran
 * alasan pembatalan. Provinsi dipakai sebagai satuan wilayah karena kota ada 377 —
 * terlalu banyak untuk dibaca sebagai baris matriks.
 */
report.get("/wilayah", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  // Order yang batal sebelum alamat terisi tetap dihitung, dikelompokkan tersendiri.
  const PROV = `COALESCE(NULLIF(TRIM(o.province),''),'(tanpa wilayah)')`;
  const metrik = `COUNT(*) AS orders,
    SUM(${CONFIRMED("o.")}) AS confirmed,
    ROUND(100.0*SUM(${CONFIRMED("o.")})/COUNT(*),1) AS confirm_rate,
    SUM(o.status='pending') AS pending,
    SUM(o.status='canceled') AS canceled,
    SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value`;

  const perWilayah = await c.env.DB.prepare(
    `SELECT ${PROV} AS province, ${metrik} FROM orders o WHERE ${w}
     GROUP BY ${PROV} ORDER BY orders DESC LIMIT 60`).bind(...args).all();
  const perCs = await c.env.DB.prepare(
    `SELECT COALESCE(o.handler_id,0) AS handler_id, COALESCE(o.handler_name,'Belum ada handler') AS handler_name, ${metrik}
     FROM orders o WHERE ${w} GROUP BY COALESCE(o.handler_id,0) ORDER BY orders DESC`).bind(...args).all();
  const perProduct = await c.env.DB.prepare(
    `SELECT je.value AS product, ${metrik} FROM orders o JOIN json_each(o.product_names) je ON 1=1
     WHERE ${w} GROUP BY je.value ORDER BY orders DESC LIMIT 12`).bind(...args).all();

  const csCells = await c.env.DB.prepare(
    `SELECT ${PROV} AS province, COALESCE(o.handler_id,0) AS handler_id, ${metrik}
     FROM orders o WHERE ${w} GROUP BY ${PROV}, COALESCE(o.handler_id,0) ORDER BY orders DESC LIMIT 600`).bind(...args).all();
  // Dibatasi ke 12 produk yang sama dengan kolom matriks. Tanpa batasan ini,
  // kombinasi (wilayah, produk) bisa terpotong oleh LIMIT dan selnya keliru tampil kosong.
  const w2 = w.replace(/\bo\./g, "o2.");
  const produkCells = await c.env.DB.prepare(
    `SELECT ${PROV} AS province, je.value AS product, ${metrik}
     FROM orders o JOIN json_each(o.product_names) je ON 1=1
     WHERE ${w} AND je.value IN (
       SELECT je2.value FROM orders o2 JOIN json_each(o2.product_names) je2 ON 1=1
       WHERE ${w2} GROUP BY je2.value ORDER BY COUNT(*) DESC LIMIT 12)
     GROUP BY ${PROV}, je.value`).bind(...args, ...args).all();

  // Alasan batal per wilayah, memakai normalisasi tag yang sama dengan laporan CS.
  const batal = await c.env.DB.prepare(
    `SELECT ${PROV} AS province, je.value AS tag, COUNT(*) AS orders
     FROM orders o LEFT JOIN json_each(COALESCE(o.tags,'[]')) je
     WHERE ${w} AND o.status='canceled' GROUP BY ${PROV}, je.value`).bind(...args).all<{ province: string; tag: string | null; orders: number }>();
  const gabung = new Map<string, number>();
  const totalAlasan = new Map<string, number>();
  for (const r of batal.results) {
    const reason = cancelReason(r.tag);
    gabung.set(`${r.province}|${reason}`, (gabung.get(`${r.province}|${reason}`) ?? 0) + r.orders);
    totalAlasan.set(reason, (totalAlasan.get(reason) ?? 0) + r.orders);
  }
  const alasan = [...totalAlasan].map(([reason, orders]) => ({ reason, orders }))
    .sort((a, b) => b.orders - a.orders).slice(0, 8);
  const batalCells = [...gabung].map(([k, orders]) => {
    const i = k.lastIndexOf("|");
    return { province: k.slice(0, i), reason: k.slice(i + 1), orders };
  });

  return c.json({
    from, to,
    per_wilayah: perWilayah.results, per_cs: perCs.results, per_product: perProduct.results,
    cs_cells: csCells.results, produk_cells: produkCells.results,
    alasan, batal_cells: batalCells,
  });
});

/**
 * Lead/closing/pending/cancel per kabupaten/kota dan per kecamatan — titik di peta wilayah.
 * Kecamatan tidak punya kolom sendiri, jadi dibaca dari raw_json order.
 * Koordinat dicocokkan di frontend (public/geo/titik-wilayah.json).
 */
report.get("/wilayah-daftar", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND TRIM(COALESCE(o.province,''))<>'' AND TRIM(COALESCE(o.city,''))<>'' ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  const KEC = `TRIM(json_extract(o.raw_json,'$.destination_address.subdistrict'))`;
  const metrik = `COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
    SUM(o.status='pending') AS pending, SUM(o.status='canceled') AS canceled`;
  const kab = await c.env.DB.prepare(
    `SELECT o.province, o.city, ${metrik} FROM orders o WHERE ${w} GROUP BY o.province, o.city`).bind(...args).all();
  const kec = await c.env.DB.prepare(
    `SELECT o.province, o.city, ${KEC} AS kecamatan, ${metrik} FROM orders o
     WHERE ${w} AND COALESCE(${KEC},'')<>'' GROUP BY o.province, o.city, ${KEC}`).bind(...args).all();
  return c.json({ from, to, kab: kab.results, kec: kec.results });
});


/**
 * Detail satu order untuk panel di halaman Scalev Order.
 *
 * Sebagian isian diambil dari raw_json karena Scalev mengirim `customer`,
 * `destination_address`, dan rincian biaya walau tidak diminta lewat `columns`,
 * jadi tidak perlu kolom tersendiri di tabel.
 *
 * Catatan: respons memuat data pribadi pembeli (nama, telepon, email, alamat).
 * Endpoint ini hanya dilindungi middleware DASHBOARD_PASSWORD di src/index.ts —
 * bila secret itu kosong, seluruh isinya terbuka untuk siapa pun yang tahu URL-nya.
 */
report.get("/order/:id", async c => {
  const row = await c.env.DB.prepare(
    `SELECT o.order_id, o.store_name, o.status, o.payment_status, o.payment_method, o.draft_time, o.confirmed_time,
       o.shipped_time, o.completed_time, o.canceled_time, o.gross_revenue, o.net_revenue, o.shipping_cost,
       o.product_discount, o.handler_name, o.tags, o.product_names, o.shipment_receipt, o.courier_name,
       o.scalev_shipment_status, o.utm_content, o.raw_json,
       s.status_simple, s.last_event_note, s.last_event_at, s.delivered_at, s.rts_at, s.undelivered_count
     FROM orders o LEFT JOIN shipments s ON s.receipt=o.shipment_receipt
     WHERE o.order_id=? ORDER BY o.draft_time DESC LIMIT 1`).bind(c.req.param("id")).first<Record<string, unknown>>();
  if (!row) return c.json({ error: "Order tidak ditemukan" }, 404);

  let raw: Record<string, any> = {};
  try { raw = JSON.parse(String(row.raw_json ?? "{}")); } catch { /* raw_json rusak — sisanya tetap berguna */ }
  const cust = raw.customer ?? {};
  const addr = raw.destination_address ?? {};
  const num = (v: unknown) => (v == null ? null : Number(v));

  return c.json({
    order_id: row.order_id,
    store_name: row.store_name,
    status: row.status,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    handler_name: row.handler_name,
    utm_content: row.utm_content,
    tags: row.tags,
    product_names: row.product_names,
    public_order_url: raw.public_order_url ?? null,
    waktu: {
      draft: row.draft_time, confirmed: row.confirmed_time, shipped: row.shipped_time,
      completed: row.completed_time, canceled: row.canceled_time,
    },
    pembeli: {
      nama: cust.name ?? addr.name ?? null,
      telepon: cust.phone ?? addr.phone ?? null,
      email: cust.email ?? null,
      penerima: addr.name ?? null,
      telepon_penerima: addr.phone ?? null,
      alamat: addr.address ?? null,
      kecamatan: addr.subdistrict ?? null,
      kota: addr.city ?? null,
      provinsi: addr.province ?? null,
      kode_pos: addr.postal_code ?? null,
    },
    pengiriman: {
      resi: row.shipment_receipt,
      kurir: row.courier_name,
      layanan: raw.courier_service?.name ?? null,
      status_scalev: row.scalev_shipment_status,
      awb_status: raw.awb_status ?? null,
      // Dari Mengantar; null selama MENGANTAR_API_KEY belum dipasang.
      status_mengantar: row.status_simple ?? null,
      catatan_terakhir: row.last_event_note ?? null,
      waktu_terakhir: row.last_event_at ?? null,
      terkirim_at: row.delivered_at ?? null,
      rts_at: row.rts_at ?? null,
      gagal_antar: row.undelivered_count ?? null,
    },
    pembayaran: {
      gross_revenue: num(row.gross_revenue),
      product_discount: num(row.product_discount),
      unique_code_discount: num(raw.unique_code_discount),
      discount_code_discount: num(raw.discount_code_discount),
      discount_code_code: raw.discount_code_code ?? null,
      shipping_cost: num(row.shipping_cost),
      shipping_discount: num(raw.shipping_discount),
      other_income: num(raw.other_income),
      other_income_name: raw.other_income_name ?? null,
      payment_fee: num(raw.payment_fee),
      scalev_fee: num(raw.scalev_fee),
      service_fee: num(raw.service_fee),
      net_revenue: num(row.net_revenue),
      net_payment_revenue: num(raw.net_payment_revenue),
    },
  });
});

/** Kelompok produk: spend + order per kelompok, plus campaign yang belum dipetakan. */
report.get("/products", async c => {
  const { from, to } = range(c);
  const groups = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.store_id, ROUND(SUM(i.spend)) AS spend, GROUP_CONCAT(DISTINCT cp.name) AS campaign_names
     FROM product_groups g LEFT JOIN campaigns cp ON cp.product_group=g.id
     LEFT JOIN ad_insights_daily i ON i.campaign_id=cp.id AND i.date BETWEEN ? AND ? GROUP BY g.id ORDER BY g.name`).bind(from, to).all();
  const ordersByGroup = await c.env.DB.prepare(
    `SELECT group_id, ${ORDER_AGG} FROM (SELECT o.*, cp.product_group AS group_id FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign
     WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND cp.product_group IS NOT NULL) GROUP BY group_id`).bind(from, to).all();
  const unmapped = await c.env.DB.prepare(
    `SELECT cp.id, cp.name, cp.account_id, ROUND(SUM(i.spend)) AS spend FROM campaigns cp
     LEFT JOIN ad_insights_daily i ON i.campaign_id=cp.id AND i.date BETWEEN ? AND ? WHERE cp.product_group IS NULL GROUP BY cp.id ORDER BY spend DESC`).bind(from, to).all();
  return c.json({ from, to, groups: groups.results, orders_by_group: ordersByGroup.results, unmapped: unmapped.results });
});

/**
 * Halaman Mengantar — seluruhnya dari data Mengantar (tabel shipments), tanpa join ke Scalev:
 * resi di Scalev kebanyakan kosong, jadi join akan membuang sebagian besar paket.
 * Tiga submenu: Ringkasan (/shipments), Tracking & Masalah (/shipments/problems), Saldo COD (/shipments/saldo).
 *
 * API list Mengantar tidak menyertakan riwayat perjalanan, sehingga waktu terkirim/RTS
 * diambil dari `last_status_change` saat status akhirnya sudah DELIVERED/RTS; kejadian
 * terakhir (alasan gagal antar dsb.) ada di `lastHistory` pada raw_json.
 * PARCEL LOST dipisahkan (LOST) untuk daftar masalah, tetapi di ringkasan ikut "dalam
 * perjalanan" — sama dengan penyederhanaan status resmi Mengantar — supaya
 * terkirim + dalam perjalanan + RTS = total.
 * Tanggal acuan = tanggal paket dibuat, dalam WIB.
 */
export const SHIP_STATUS = `CASE WHEN UPPER(s.status) LIKE '%LOST%' THEN 'LOST'
  WHEN s.status_simple IN ('DELIVERED','RTS') THEN s.status_simple ELSE 'ON_GOING' END`;
// lastStatusChange dari Mengantar berisi jam WIB tetapi berlabel UTC ("…15:24:00.000Z" untuk kejadian 15:24 WIB),
// jadi dikurangi 7 jam supaya menjadi UTC yang benar.
const SHIP_UBAH = `strftime('%Y-%m-%dT%H:%M:%SZ', s.last_status_change, '-7 hours')`;
export const SHIP_SELESAI = `COALESCE(s.delivered_at, s.rts_at, ${SHIP_UBAH})`;
const SHIP_JAM_DIAM = `(julianday('now')-julianday(COALESCE(${SHIP_UBAH}, s.updated_at, s.created_at)))*24`;
const SHIP_TIKET = `json_extract(s.raw_json,'$.ticketStatus')`;
const SHIP_KODE = `json_extract(s.raw_json,'$.lastHistory.code')`;
export const SHIP_GUDANG = `REPLACE(COALESCE(json_extract(s.raw_json,'$.SHIPPER_NAME'),'(tanpa nama)'),'&#039;','''')`;
// Paket dibuat tetapi belum dijemput kurir: belum dihitung barang keluar (Outbound, Stok)
export const SHIP_BELUM_JEMPUT = `(s.status='active' OR UPPER(s.status)='PENDING PICKUP')`;
export const SHIP_BARANG = `TRIM(REPLACE(COALESCE(json_extract(s.raw_json,'$.GOODS_DESC'),'(tanpa keterangan)'),'&#039;',''''))`;
// SLA = estimasi hari kirim dari Mengantar ("3 Days" → 3). Umur dihitung dari paket dibuat,
// jadi waktu menunggu pickup ikut terhitung.
const SHIP_SLA = `CAST(json_extract(s.raw_json,'$.estimate_delivery') AS INTEGER)`;
const SHIP_UMUR = `(julianday(CASE WHEN s.status_simple IN ('DELIVERED','RTS') THEN ${SHIP_SELESAI} ELSE 'now' END)-julianday(s.created_at))`;
const SHIP_LEWAT_SLA = `COALESCE(${SHIP_SLA} > 0 AND ${SHIP_UMUR} > ${SHIP_SLA}, 0)`;
const SHIP_GAGAL = `(${SHIP_KODE} LIKE 'U%' OR ${SHIP_KODE} LIKE 'D%' OR UPPER(s.status) IN ('UNDELIVERED','DELIVERY PROBLEM'))`;
const SHIP_RETUR = `(${SHIP_KODE} LIKE 'CR%' OR UPPER(s.status)='SHIPMENT RETURN')`;
// Masih di jalan tapi butuh tindakan: gagal antar/bermasalah, proses retur, tiket komplain terbuka,
// lewat SLA, atau tanpa update >48 jam
const SHIP_PERHATIAN = `(${SHIP_STATUS}='ON_GOING' AND (${SHIP_JAM_DIAM}>48 OR ${SHIP_GAGAL} OR ${SHIP_RETUR}
  OR ${SHIP_TIKET} IN ('Open','Replied') OR ${SHIP_LEWAT_SLA}))`;
// Paket sedang dibawa kurir ke penerima (status Mengantar DELIVERY COURIER, riwayat "WITH DELIVERY COURIER …") —
// bukan masalah, tetapi ikut ditampilkan di tabel follow up supaya pembeli bisa dihubungi sebelum kurir datang.
const SHIP_DIANTAR = `(${SHIP_STATUS}='ON_GOING' AND (UPPER(s.status)='DELIVERY COURIER' OR UPPER(json_extract(s.raw_json,'$.lastHistory.desc')) LIKE 'WITH DELIVERY COURIER%'))`;
// Satu kategori per paket, urut dari yang paling mendesak
const SHIP_KATEGORI = `CASE WHEN ${SHIP_STATUS}='LOST' THEN 'Paket hilang'
  WHEN ${SHIP_GAGAL} THEN 'Gagal antar' WHEN ${SHIP_RETUR} THEN 'Proses retur' WHEN ${SHIP_DIANTAR} THEN 'Sedang diantar'
  WHEN ${SHIP_TIKET} IN ('Open','Replied') THEN 'Tiket komplain'
  WHEN ${SHIP_LEWAT_SLA} THEN 'Lewat SLA' ELSE 'Tidak bergerak' END`;
const SHIP_METRIK = `COUNT(*) AS total,
  SUM(${SHIP_STATUS}='DELIVERED') AS delivered, SUM(${SHIP_STATUS}='RTS') AS rts,
  SUM(${SHIP_STATUS} IN ('ON_GOING','LOST')) AS on_going, SUM(${SHIP_STATUS}='LOST') AS lost,
  SUM(${SHIP_PERHATIAN}) AS perlu_perhatian,
  ROUND(AVG(CASE WHEN ${SHIP_STATUS}='DELIVERED' THEN julianday(${SHIP_SELESAI})-julianday(s.created_at) END),1) AS avg_days_to_deliver,
  SUM(s.is_cod) AS cod_count, SUM(s.cod_amount) AS cod_total,
  SUM(CASE WHEN ${SHIP_STATUS}='DELIVERED' THEN s.cod_amount ELSE 0 END) AS cod_delivered,
  SUM(CASE WHEN ${SHIP_STATUS} IN ('ON_GOING','LOST') THEN s.cod_amount ELSE 0 END) AS cod_in_transit,
  SUM(CASE WHEN ${SHIP_STATUS}='RTS' THEN s.cod_amount ELSE 0 END) AS cod_rts,
  SUM(s.price) AS shipping_fee, SUM(s.cod_fee) AS cod_fee`;

/** Filter bersama tiga submenu: rentang tanggal dibuat (WIB), kurir, COD/non-COD. */
function shipFilter(c: { req: { query: (k: string) => string | undefined } }) {
  const { from, to } = range(c);
  const courier = c.req.query("courier"), cod = c.req.query("cod");   // cod: cod | noncod
  const w = [`date(s.created_at,'+7 hours') BETWEEN ? AND ?`];
  const args: string[] = [from, to];
  if (courier) { w.push(`s.courier=?`); args.push(courier); }
  if (cod === "cod") w.push(`s.is_cod=1`); else if (cod === "noncod") w.push(`s.is_cod=0`);
  return { from, to, W: w.join(" AND "), args };
}

async function shipMeta(env: Env) {
  const couriers = await env.DB.prepare(`SELECT DISTINCT courier FROM shipments WHERE courier IS NOT NULL ORDER BY courier`).all<{ courier: string }>();
  const lastSync = await env.DB.prepare(
    `SELECT finished_at FROM sync_log WHERE source='mengantar:shipments' AND ok=1 ORDER BY id DESC LIMIT 1`).first<{ finished_at: string }>();
  return { couriers: couriers.results.map(r => r.courier), last_sync: lastSync?.finished_at ?? null };
}

/** Submenu Ringkasan: kartu status, grafik harian, tabel per kurir / gudang / barang. */
report.get("/shipments", async c => {
  const { from, to, W, args } = shipFilter(c);
  // `kali` = berapa kali ${W} muncul di query, supaya jumlah parameter pas
  const q = (sql: string, kali = 1) => c.env.DB.prepare(sql).bind(...Array.from({ length: kali }, () => args).flat());

  const summary = await q(`SELECT ${SHIP_METRIK} FROM shipments s WHERE ${W}`).first();
  const byCourier = await q(`SELECT s.courier, ${SHIP_METRIK} FROM shipments s WHERE ${W} GROUP BY s.courier ORDER BY total DESC`).all();
  const byShipper = await q(`SELECT ${SHIP_GUDANG} AS shipper, ${SHIP_METRIK} FROM shipments s WHERE ${W} GROUP BY shipper ORDER BY total DESC`).all();
  const byGoods = await q(`SELECT ${SHIP_BARANG} AS goods, ${SHIP_METRIK} FROM shipments s WHERE ${W} GROUP BY goods ORDER BY total DESC`).all();
  // Harian: dibuat per tanggal dibuat; terkirim & RTS per tanggal kejadiannya (semuanya dari paket dalam rentang)
  const daily = await q(
    `SELECT tgl AS date, SUM(k='c') AS created, SUM(k='d') AS delivered, SUM(k='r') AS rts FROM (
       SELECT date(s.created_at,'+7 hours') AS tgl, 'c' AS k FROM shipments s WHERE ${W}
       UNION ALL SELECT date(${SHIP_SELESAI},'+7 hours'), CASE ${SHIP_STATUS} WHEN 'DELIVERED' THEN 'd' ELSE 'r' END
         FROM shipments s WHERE ${W} AND ${SHIP_STATUS} IN ('DELIVERED','RTS'))
     GROUP BY tgl ORDER BY tgl`, 2).all();

  return c.json({
    from, to, summary, by_courier: byCourier.results, by_shipper: byShipper.results, by_goods: byGoods.results,
    daily: daily.results, ...(await shipMeta(c.env)),
  });
});

/**
 * Submenu Tracking & Masalah: paket bermasalah (+ kontak penerima untuk follow up WA
 * dan hasil follow up terakhir), SLA per kurir, dan sebaran lama pengiriman.
 * Nomor HP & nama penerima hanya dikirim di endpoint ini karena memang dipakai untuk menghubungi pembeli.
 */
report.get("/shipments/problems", async c => {
  const { from, to, W, args } = shipFilter(c);
  const q = (sql: string) => c.env.DB.prepare(sql).bind(...args);

  const problems = await q(
    `SELECT s.receipt, s.courier, s.status, ${SHIP_KATEGORI} AS kategori, ${SHIP_KODE} AS code,
       json_extract(s.raw_json,'$.lastHistory.desc') AS last_desc, json_extract(s.raw_json,'$.lastHistory.date') AS last_date,
       ${SHIP_GUDANG} AS shipper, ${SHIP_BARANG} AS goods, ${SHIP_TIKET} AS ticket,
       json_extract(s.raw_json,'$.customerService') AS cs,
       json_extract(s.raw_json,'$.RECEIVER_NAME') AS receiver_name, json_extract(s.raw_json,'$.RECEIVER_PHONE') AS receiver_phone,
       s.receiver_city, s.receiver_region, s.cod_amount, s.is_cod, s.created_at, ${SHIP_UBAH} AS last_status_change,
       ROUND(${SHIP_JAM_DIAM}) AS hours_since_update, ROUND(${SHIP_UMUR},1) AS days_in_transit, ${SHIP_SLA} AS sla_days,
       f.status AS fu_status, f.note AS fu_note, f.wa_count AS fu_count, f.last_at AS fu_at
     FROM shipments s LEFT JOIN shipment_followups f ON f.receipt=s.receipt
     WHERE ${W} AND (${SHIP_PERHATIAN} OR ${SHIP_STATUS}='LOST' OR ${SHIP_DIANTAR})
     ORDER BY CASE ${SHIP_KATEGORI} WHEN 'Gagal antar' THEN 0 WHEN 'Proses retur' THEN 1 WHEN 'Tiket komplain' THEN 2
       WHEN 'Lewat SLA' THEN 3 WHEN 'Tidak bergerak' THEN 4 WHEN 'Sedang diantar' THEN 6 ELSE 5 END, hours_since_update DESC LIMIT 500`).all();

  const sla = await q(
    `SELECT s.courier,
       SUM(${SHIP_STATUS}='DELIVERED') AS delivered,
       ROUND(AVG(CASE WHEN ${SHIP_STATUS}='DELIVERED' THEN ${SHIP_UMUR} END),1) AS avg_days,
       ROUND(AVG(CASE WHEN ${SHIP_STATUS}='DELIVERED' THEN ${SHIP_SLA} END),1) AS avg_sla,
       SUM(${SHIP_STATUS}='DELIVERED' AND ${SHIP_SLA}>0) AS with_sla,
       SUM(${SHIP_STATUS}='DELIVERED' AND ${SHIP_SLA}>0 AND NOT ${SHIP_LEWAT_SLA}) AS on_time,
       SUM(${SHIP_STATUS}='ON_GOING') AS on_going,
       SUM(${SHIP_STATUS}='ON_GOING' AND ${SHIP_LEWAT_SLA}) AS on_going_late,
       SUM(${SHIP_PERHATIAN} OR ${SHIP_STATUS}='LOST') AS problems
     FROM shipments s WHERE ${W} GROUP BY s.courier ORDER BY delivered DESC`).all();

  // Lama pengiriman paket terkirim, dibulatkan ke atas per hari (11 = lebih dari 10 hari)
  const hari = `MIN(11, MAX(1, CAST(${SHIP_UMUR} AS INTEGER) + (${SHIP_UMUR} > CAST(${SHIP_UMUR} AS INTEGER))))`;
  const durations = await q(
    `SELECT ${hari} AS days, SUM(NOT ${SHIP_LEWAT_SLA}) AS on_time, SUM(${SHIP_LEWAT_SLA}) AS late
     FROM shipments s WHERE ${W} AND ${SHIP_STATUS}='DELIVERED' GROUP BY days ORDER BY days`).all();

  // Rekap follow up per CS: semua paket dalam rentang yang pernah di-follow up (termasuk yang sudah tidak bermasalah),
  // jumlah per hasil follow up, lalu nasib paketnya sekarang menurut Mengantar.
  const rekap_cs = await q(
    `SELECT COALESCE(json_extract(s.raw_json,'$.customerService'),'') AS cs, COUNT(*) AS fu, SUM(f.wa_count) AS wa,
       SUM(f.status='dihubungi') AS dihubungi, SUM(f.status='siap_terima') AS siap_terima, SUM(f.status='tidak_respon') AS tidak_respon,
       SUM(f.status='menolak') AS menolak, SUM(f.status='selesai') AS selesai,
       SUM(${SHIP_STATUS}='DELIVERED') AS terkirim, SUM(${SHIP_STATUS}='RTS') AS rts, SUM(${SHIP_STATUS}='LOST') AS hilang,
       SUM(${SHIP_STATUS}='ON_GOING') AS jalan
     FROM shipments s JOIN shipment_followups f ON f.receipt=s.receipt WHERE ${W} AND f.status<>'' GROUP BY 1 ORDER BY fu DESC`).all();

  return c.json({ from, to, problems: problems.results, sla: sla.results, durations: durations.results, rekap_cs: rekap_cs.results, ...(await shipMeta(c.env)) });
});

/**
 * Submenu Saldo COD, per resi. Uang diterima = nilai COD − ongkir − fee COD.
 * - Dalam perjalanan: paket COD belum terkirim/RTS (termasuk hilang) — saldo yang masih diharapkan.
 * - Pending: sudah terkirim, `isReconciliated` belum true di Mengantar.
 * - Rekonsiliasi: sudah terkirim dan sudah direkonsiliasi Mengantar.
 * - RTS: tidak ada uang cair; ongkir retur yang dipotong dari saldo (mutasi "Payment for returned order")
 *   masuk sebagai uang diterima negatif.
 * Paket non-COD tidak masuk karena tidak ada uang yang ditagih Mengantar ke pembeli.
 */
const SALDO_STATUS = `CASE WHEN ${SHIP_STATUS}='RTS' THEN 'rts'
  WHEN ${SHIP_STATUS} IN ('ON_GOING','LOST') THEN 'jalan'
  WHEN json_extract(s.raw_json,'$.isReconciliated')=1 THEN 'rekon' ELSE 'pending' END`;

report.get("/shipments/saldo", async c => {
  const { from, to, W, args } = shipFilter(c);
  const rows = await c.env.DB.prepare(
    `SELECT s.receipt, s.mengantar_order_id AS order_id, s.created_at, s.courier, ${SHIP_GUDANG} AS shipper, s.status, ${SALDO_STATUS} AS saldo,
       CASE WHEN ${SHIP_STATUS} IN ('DELIVERED','RTS') THEN ${SHIP_SELESAI} END AS done_at,
       s.cod_amount, s.price, s.cod_fee, COALESCE(r.fee, 0) AS rts_fee,
       CASE WHEN ${SHIP_STATUS}='RTS' THEN -COALESCE(r.fee, 0) ELSE s.cod_amount - s.price - s.cod_fee END AS net,
       -- 1 = paket punya order Scalev (remark1 = nomor order, atau resi sama); 0 = order manual / di luar Scalev
       ${SHIP_SCALEV_ID} IS NOT NULL AS scalev
     FROM shipments s LEFT JOIN (SELECT receipt, SUM(amount) AS fee FROM mengantar_invoices
       WHERE type='typePayment' AND status='statusCleared' AND description LIKE 'Payment for returned order%' GROUP BY receipt) r ON r.receipt=s.receipt
     WHERE ${W} AND s.is_cod=1
     ORDER BY s.created_at DESC LIMIT 5000`).bind(...args).all();

  // Arus saldo akun Mengantar per tanggal transaksi (WIB) — tidak ikut filter kurir karena pencairan
  // dan potongan berlaku untuk satu akun. Refund bernilai negatif di Mengantar (= menambah saldo).
  const inv = `FROM mengantar_invoices WHERE status='statusCleared' AND date(created_at,'+7 hours') BETWEEN ? AND ?`;
  const arus = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN type='typeReconciliation' THEN amount ELSE 0 END) AS rekon,
       SUM(CASE WHEN type='typeReconciliation' THEN 1 ELSE 0 END) AS rekon_n,
       SUM(CASE WHEN type='typeRefund' THEN -amount ELSE 0 END) AS refund,
       SUM(CASE WHEN type='typeRefund' THEN 1 ELSE 0 END) AS refund_n,
       SUM(CASE WHEN type='typePayment' AND description LIKE 'Payment for returned order%' THEN amount ELSE 0 END) AS potong_rts,
       SUM(CASE WHEN type='typePayment' AND description LIKE 'Payment for Non-COD%' THEN amount ELSE 0 END) AS potong_noncod,
       SUM(CASE WHEN type='typePayment' AND description NOT LIKE 'Payment for returned order%' AND description NOT LIKE 'Payment for Non-COD%' THEN amount ELSE 0 END) AS potong_lain,
       SUM(CASE WHEN type='typeWithdraw' THEN amount ELSE 0 END) AS cair,
       SUM(CASE WHEN type='typeWithdraw' THEN 1 ELSE 0 END) AS cair_n,
       SUM(CASE WHEN type='typeAddBalance' THEN amount ELSE 0 END) AS topup
     ${inv}`).bind(from, to).first();
  // COD yang dikumpulkan kurir dari pembeli pada invoice rekonsiliasi; selisihnya dengan nilai
  // rekonsiliasi = ongkir + fee COD yang dipotong Mengantar
  const rekonCod = await c.env.DB.prepare(
    `SELECT SUM(i.cod_amount) AS cod, COUNT(*) AS n FROM mengantar_invoice_items i JOIN mengantar_invoices v ON v.id=i.invoice_id
     WHERE v.type='typeReconciliation' AND v.status='statusCleared' AND date(v.created_at,'+7 hours') BETWEEN ? AND ?`)
    .bind(from, to).first<{ cod: number | null; n: number }>();
  const klaim = await c.env.DB.prepare(
    `SELECT created_at, receipt, description, -amount AS amount, inv_number ${inv} AND type='typeRefund'
     ORDER BY created_at DESC LIMIT 1000`).bind(from, to).all();
  const pencairan = await c.env.DB.prepare(
    `SELECT created_at, paid_at, amount, bank, inv_number FROM mengantar_invoices
     WHERE type='typeWithdraw' AND date(created_at,'+7 hours') BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 120`).bind(from, to).all();
  // Nilai COD paket yang dibuat pada rentang (semua kurir, termasuk retur & masih di jalan) — sama dengan
  // "Total Pendapatan COD" di halaman Balance Mengantar. Hanya info, bukan uang yang diterima.
  const codKirim = await c.env.DB.prepare(
    `SELECT SUM(cod_amount) AS nilai, COUNT(*) AS n, SUM(status_simple='DELIVERED') AS terkirim, SUM(status_simple='RTS') AS rts,
       SUM(status_simple NOT IN ('DELIVERED','RTS')) AS jalan
     FROM shipments WHERE is_cod=1 AND date(created_at,'+7 hours') BETWEEN ? AND ?`).bind(from, to).first();
  const kv = await c.env.DB.prepare(`SELECT value FROM kv WHERE key='mengantar_balance'`).first<{ value: string }>();
  const mutasi = await c.env.DB.prepare(
    `SELECT MIN(created_at) AS sejak, (SELECT finished_at FROM sync_log WHERE source='mengantar:invoices' AND ok=1 ORDER BY id DESC LIMIT 1) AS sync
     FROM mengantar_invoices`).first<{ sejak: string | null; sync: string | null }>();

  return c.json({ from, to, rows: rows.results, arus, pencairan: pencairan.results, klaim: klaim.results,
    rekon_cod: rekonCod?.cod ?? 0, rekon_resi: rekonCod?.n ?? 0, cod_kirim: codKirim,
    saldo_akun: kv ? JSON.parse(kv.value) : null, mutasi_sejak: mutasi?.sejak ?? null, mutasi_sync: mutasi?.sync ?? null,
    ...(await shipMeta(c.env)) });
});

/**
 * Pop-up rincian penghasilan bersih Saldo COD, per tanggal transaksi mutasi (WIB):
 * - items: resi di invoice rekonsiliasi → nilai COD, fee COD, uang bersih (ongkir = COD − fee − bersih)
 * - mutasi: klaim/refund, potongan ongkir retur (RTS), dan potongan lain (non-COD, koreksi)
 * Total dihitung di SQL supaya tetap benar walau baris dibatasi.
 */
report.get("/shipments/saldo/detail", async c => {
  const { from, to } = range(c);
  const BATAS = 20000;
  const ship = (kol: string, resi: string) => `(SELECT ${kol} FROM shipments WHERE receipt=${resi} LIMIT 1)`;
  const rekon = `FROM mengantar_invoice_items i JOIN mengantar_invoices v ON v.id=i.invoice_id
    WHERE v.type='typeReconciliation' AND v.status='statusCleared' AND date(v.created_at,'+7 hours') BETWEEN ? AND ?`;
  const items = await c.env.DB.prepare(
    `SELECT v.created_at, i.receipt, ${ship("mengantar_order_id", "i.receipt")} AS order_id, ${ship("courier", "i.receipt")} AS courier,
       COALESCE(i.cod_amount,0) AS cod, COALESCE(i.cod_fee,0) AS fee, i.amount AS net
     ${rekon} ORDER BY v.created_at DESC LIMIT ${BATAS}`).bind(from, to).all();
  const tot = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, SUM(COALESCE(i.cod_amount,0)) AS cod, SUM(COALESCE(i.cod_fee,0)) AS fee,
       SUM(COALESCE(i.cod_amount,0)-COALESCE(i.cod_fee,0)-i.amount) AS ongkir ${rekon}`).bind(from, to).first();
  const mutasi = await c.env.DB.prepare(
    `SELECT created_at, receipt, COALESCE(order_id, ${ship("mengantar_order_id", "m.receipt")}) AS order_id, ${ship("courier", "m.receipt")} AS courier,
       description, inv_number,
       CASE WHEN type='typeRefund' THEN 'klaim' WHEN description LIKE 'Payment for returned order%' THEN 'rts' ELSE 'potong' END AS jenis,
       CASE WHEN type='typeRefund' THEN -amount ELSE amount END AS amount
     FROM mengantar_invoices m WHERE status='statusCleared' AND type IN ('typeRefund','typePayment')
       AND date(created_at,'+7 hours') BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ${BATAS}`).bind(from, to).all();
  return c.json({ from, to, items: items.results, mutasi: mutasi.results, total: tot, batas: BATAS });
});

/** Catat follow up WA: { receipt, status?, note?, wa?: true (tombol WA dibuka → tambah hitungan) } */
report.post("/shipments/followup", async c => {
  const b = await c.req.json<{ receipt?: string; status?: string; note?: string; wa?: boolean }>();
  if (!b.receipt) return c.json({ error: "receipt wajib" }, 400);
  const STATUS = ["dihubungi", "siap_terima", "tidak_respon", "menolak", "selesai"];
  if (b.status && !STATUS.includes(b.status)) return c.json({ error: "status tidak dikenal" }, 400);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO shipment_followups (receipt, status, note, wa_count, first_at, last_at) VALUES (?1, COALESCE(?2,'dihubungi'), ?3, ?4, ?5, ?5)
     ON CONFLICT(receipt) DO UPDATE SET status=COALESCE(?2, status), note=COALESCE(?3, note),
       wa_count=wa_count+?4, last_at=?5`)
    .bind(b.receipt, b.status ?? null, b.note ?? null, b.wa ? 1 : 0, now).run();
  const row = await c.env.DB.prepare(`SELECT receipt, status AS fu_status, note AS fu_note, wa_count AS fu_count, last_at AS fu_at FROM shipment_followups WHERE receipt=?`)
    .bind(b.receipt).first();
  return c.json(row);
});

/** Template pesan WA follow up (satu untuk semua CS), disimpan di tabel kv. */
const WA_TPL_KEY = "wa_template_mengantar";
/** Template WA per kategori paket ({ "Gagal antar": "...", ... }); kategori yang tidak ada memakai template bawaan di UI */
async function bacaWaTemplate(db: D1Database): Promise<Record<string, string>> {
  const r = await db.prepare(`SELECT value FROM kv WHERE key=?`).bind(WA_TPL_KEY).first<{ value: string }>();
  if (!r?.value) return {};
  try { const o = JSON.parse(r.value); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* format lama: satu teks */ }
  return { "": r.value };
}
report.get("/shipments/wa-template", async c => c.json({ templates: await bacaWaTemplate(c.env.DB) }));
/** body {kategori, template}; template kosong = kembali ke bawaan untuk kategori itu */
report.put("/shipments/wa-template", async c => {
  const { kategori = "", template = "" } = await c.req.json<{ kategori?: string; template?: string }>();
  const db = c.env.DB, semua = await bacaWaTemplate(db), k = String(kategori).slice(0, 60);
  if (template.trim()) semua[k] = template.slice(0, 2000); else delete semua[k];
  await db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .bind(WA_TPL_KEY, JSON.stringify(semua)).run();
  return c.json({ ok: true, templates: semua });
});

/**
 * Performa Lead — pola jam order masuk (Menu Order › Performa Lead).
 * Dikelompokkan per hari dalam seminggu (dari draft_date, WIB) × jam masuk (draft_time + 7 jam).
 * Rata-rata per hari dihitung di UI: jumlah ÷ banyaknya hari kalender dalam rentang efektif
 * (rentang filter dipotong ke tanggal order pertama yang ada di database, supaya "Semua" tidak
 * membagi dengan hari-hari sebelum data ada). Status mengikuti halaman Performa CS.
 */
report.get("/lead-pattern", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id"), product = c.req.query("product");
  const w = [`o.is_spam=0`, `o.draft_date BETWEEN ? AND ?`];
  const args: (string | number)[] = [from, to];
  if (store) { w.push(`o.store_id=?`); args.push(Number(store)); }
  const W = w.join(" AND ");
  const WP = product ? `${W} AND EXISTS (SELECT 1 FROM json_each(o.product_names) p WHERE p.value=?)` : W;
  const argsP = product ? [...args, product] : args;

  const grid = await c.env.DB.prepare(
    `SELECT CAST(strftime('%w', o.draft_date) AS INTEGER) AS dow,
       CAST(strftime('%H', datetime(o.draft_time, '+7 hours')) AS INTEGER) AS hour,
       COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
       SUM(o.status='pending') AS pending, SUM(o.status='canceled') AS canceled
     FROM orders o WHERE ${WP} AND o.draft_time IS NOT NULL GROUP BY dow, hour`).bind(...argsP).all();
  const data = await c.env.DB.prepare(`SELECT MIN(draft_date) AS mn FROM orders`).first<{ mn: string | null }>();
  // Pilihan produk: 80 produk dengan lead terbanyak di rentang ini (tanpa filter produk)
  const products = await c.env.DB.prepare(
    `SELECT p.value AS product, COUNT(*) AS orders FROM orders o JOIN json_each(o.product_names) p
     WHERE ${W} GROUP BY p.value ORDER BY orders DESC LIMIT 80`).bind(...args).all();
  const stores = await c.env.DB.prepare(
    `SELECT store_id AS id, MAX(store_name) AS name FROM orders WHERE store_id IS NOT NULL GROUP BY store_id ORDER BY name`).all();

  return c.json({ from, to, data_from: data?.mn ?? null, grid: grid.results, products: products.results, stores: stores.results });
});


/** Performa CS: per handler Scalev — order masuk, confirm rate, kecepatan konfirmasi, batal, RTS (via Mengantar). */
/**
 * Rincian card Performa CS (Lead/Closing/Pending/Cancel) per produk, untuk pop-up.
 * Order berisi beberapa produk dihitung di tiap produknya, jadi total diambil
 * dari tingkat order (`total`), bukan dengan menjumlahkan baris produk.
 */
report.get("/cs-rincian", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  const metrik = `COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
    SUM(o.status='pending') AS pending, SUM(o.status='canceled') AS canceled,
    SUM(o.gross_revenue) AS gross_orders,
    SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS gross_confirmed,
    SUM(CASE WHEN o.status='pending' THEN o.gross_revenue ELSE 0 END) AS gross_pending,
    SUM(CASE WHEN o.status='canceled' THEN o.gross_revenue ELSE 0 END) AS gross_canceled`;
  const products = await c.env.DB.prepare(
    `SELECT je.value AS product, ${metrik} FROM orders o JOIN json_each(o.product_names) je ON 1=1
     WHERE ${w} GROUP BY je.value ORDER BY orders DESC`).bind(...args).all();
  const total = await c.env.DB.prepare(`SELECT ${metrik} FROM orders o WHERE ${w}`).bind(...args).first();
  return c.json({ from, to, total, products: products.results });
});

/**
 * Pcs terjual per produk List Produk dan per CS, semua channel (lib/biaya.ts siapkanIsiPcs, komponen bonus tidak dihitung):
 *  - Scalev: order Complete menurut tanggal order masuk (sama dengan Performa CS);
 *  - Shopee / TikTok: pesanan selain batal & belum bayar menurut tanggal pesanan dibuat, qty dikurangi qty retur.
 * Varian / SKU yang isinya belum diatur di Manajemen SKU dihitung 1 pcs per qty dan didaftar di `belum`.
 */
report.get("/pcs-terjual", async c => {
  const { from, to } = range(c);
  const db = c.env.DB;
  const [isi, scalev, mp, produk] = await Promise.all([
    siapkanIsiPcs(db),
    db.prepare(
      `SELECT COALESCE(o.handler_id, 0) AS handler_id, COALESCE(o.handler_name, 'Belum ada handler') AS handler_name,
         json_extract(o.raw_json,'$.final_variants') AS fv, o.product_names,
         CASE WHEN json_array_length(o.product_names)=1 THEN json_extract(o.raw_json,'$.follow_up_chats[0].product_id') END AS product_id
       FROM orders o WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND ${CONFIRMED("o.")}`).bind(from, to)
      .all<{ handler_id: number; handler_name: string; fv: string | null; product_names: string | null; product_id: number | null }>(),
    db.prepare(
      `SELECT 'shopee' AS ch, p.no_pesanan AS id, i.sku, COALESCE(NULLIF(TRIM(i.sku),''), i.nama) AS nama, i.qty-i.qty_retur AS qty
       FROM shopee_pesanan p JOIN shopee_pesanan_item i ON i.no_pesanan=p.no_pesanan
       WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.status NOT IN ('batal','belum_bayar')
       UNION ALL
       SELECT 'tiktok', p.order_id, i.sku, COALESCE(NULLIF(TRIM(i.sku),''), i.nama), i.qty-i.qty_retur
       FROM tiktok_pesanan p JOIN tiktok_pesanan_item i ON i.order_id=p.order_id
       WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.status NOT IN ('batal','belum_bayar')`).bind(from, to)
      .all<{ ch: "shopee" | "tiktok"; id: string; sku: string | null; nama: string | null; qty: number }>(),
    db.prepare("SELECT id, nama FROM produk_list").all<{ id: number; nama: string }>(),
  ]);
  type Ch = "scalev" | "shopee" | "tiktok";
  const namaProduk = new Map(produk.results.map(p => [p.id, p.nama]));
  const perProduk = new Map<number, Record<Ch, number>>();
  const belum = new Map<string, { channel: Ch; nama: string; pcs: number; order: Set<string> }>();
  const order = { scalev: new Set<string>(), shopee: new Set<string>(), tiktok: new Set<string>() };
  const pcs: Record<Ch, number> = { scalev: 0, shopee: 0, tiktok: 0 };
  const kurang: Record<Ch, Set<string>> = { scalev: new Set(), shopee: new Set(), tiktok: new Set() };
  const catat = (ch: Ch, id: string, h: IsiPcs) => {
    order[ch].add(id); pcs[ch] += h.pcs;
    for (const [p, n] of h.produk) {
      const t = perProduk.get(p) ?? { scalev: 0, shopee: 0, tiktok: 0 };
      t[ch] += n; perProduk.set(p, t);
    }
    for (const [nama, n] of h.tanpaIsi) {
      kurang[ch].add(id);
      const k = `${ch}\n${nama}`, b = belum.get(k) ?? { channel: ch, nama, pcs: 0, order: new Set<string>() };
      b.pcs += n; b.order.add(id); belum.set(k, b);
    }
  };

  const perCs = new Map<number, { handler_id: number; handler_name: string; order: number; pcs: number; kurang: number; produk: Record<number, number> }>();
  scalev.results.forEach((o, i) => {
    const h = isi.order(o), id = `s${i}`;
    catat("scalev", id, h);
    const t = perCs.get(o.handler_id) ?? { handler_id: o.handler_id, handler_name: o.handler_name, order: 0, pcs: 0, kurang: 0, produk: {} };
    t.order++; t.pcs += h.pcs; if (h.kurang) t.kurang++;
    for (const [p, n] of h.produk) t.produk[p] = (t.produk[p] ?? 0) + n;
    perCs.set(o.handler_id, t);
  });
  for (const r of mp.results) if (r.qty > 0) catat(r.ch, r.id, isi.sku(r.sku, r.nama || "(tanpa nama)", r.qty));

  return c.json({
    from, to,
    total: (["scalev", "shopee", "tiktok"] as Ch[]).map(ch => ({ channel: ch, order: order[ch].size, pcs: pcs[ch], order_kurang: kurang[ch].size })),
    produk: [...perProduk].map(([id, t]) => ({ produk_id: id, nama: namaProduk.get(id) ?? `#${id}`, ...t, total: t.scalev + t.shopee + t.tiktok }))
      .sort((a, b) => b.total - a.total),
    belum: [...belum.values()].map(b => ({ channel: b.channel, nama: b.nama, pcs: b.pcs, order: b.order.size })).sort((a, b) => b.pcs - a.pcs),
    per_cs: [...perCs.values()].sort((a, b) => b.pcs - a.pcs),
  });
});

/**
 * Bahan BCG Matrix marketplace: omzet per produk listing × SKU dari pesanan Shopee / TikTok (selain batal & belum bayar,
 * menurut tanggal pesanan dibuat), barang yang diretur dikurangi. ?platform=shopee|tiktok&from&to&toko
 *  - Shopee: omzet = harga setelah diskon × qty; TikTok: subtotal baris setelah diskon (dibagi per qty).
 */
report.get("/bcg-marketplace", async c => {
  const { from, to } = range(c);
  const platform = c.req.query("platform") === "tiktok" ? "tiktok" : "shopee", toko = Number(c.req.query("toko")) || null;
  const P = platform === "shopee"
    ? { pesanan: "shopee_pesanan", item: "shopee_pesanan_item", id: "no_pesanan", omzet: "(i.qty-i.qty_retur)*i.harga" }
    : { pesanan: "tiktok_pesanan", item: "tiktok_pesanan_item", id: "order_id", omzet: "i.subtotal*(i.qty-i.qty_retur)*1.0/MAX(i.qty,1)" };
  const [items, daftarToko] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COALESCE(NULLIF(TRIM(i.nama),''),'(tanpa nama)') AS nama, UPPER(TRIM(COALESCE(i.sku,''))) AS sku,
         (SELECT s.produk FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE) AS sku_produk,
         SUM(${P.omzet}) AS omzet, COUNT(DISTINCT p.${P.id}) AS pesanan, SUM(i.qty-i.qty_retur) AS pcs
       FROM ${P.pesanan} p JOIN ${P.item} i ON i.${P.id}=p.${P.id}
       WHERE substr(p.dibuat,1,10) BETWEEN ? AND ? AND p.status NOT IN ('batal','belum_bayar')${toko ? " AND p.toko_id=?" : ""}
       GROUP BY 1, 2`).bind(from, to, ...(toko ? [toko] : [])),
    c.env.DB.prepare(`SELECT id, nama FROM ${platform}_toko ORDER BY nama`),
  ]);
  return c.json({ from, to, platform, items: items.results, toko: daftarToko.results });
});

report.get("/cs", async c => {
  const { from, to } = range(c);
  const store = c.req.query("store_id");
  const w = `o.is_spam=0 AND o.draft_date BETWEEN ? AND ? ${store ? "AND o.store_id=?" : ""}`;
  const args = store ? [from, to, store] : [from, to];
  const perCs = await c.env.DB.prepare(
    `SELECT COALESCE(o.handler_id, 0) AS handler_id, COALESCE(o.handler_name, 'Belum ada handler') AS handler_name,
       COUNT(*) AS orders,
       SUM(${CONFIRMED("o.")}) AS confirmed,
       ROUND(100.0*SUM(${CONFIRMED("o.")})/COUNT(*),1) AS confirm_rate,
       ROUND(AVG(CASE WHEN o.confirmed_time IS NOT NULL THEN (julianday(o.confirmed_time)-julianday(o.draft_time))*24*60 END)) AS avg_confirm_minutes,
       -- berapa order yang benar-benar punya confirmed_time; avg_confirm_minutes hanya berlaku untuk ini
       SUM(o.confirmed_time IS NOT NULL) AS confirm_timed,
       SUM(o.status='pending') AS pending,
       SUM(o.status='canceled') AS canceled,
       SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value,
       SUM(s.status_simple='RTS') AS rts,
       SUM(s.status_simple IN ('RTS','DELIVERED')) AS with_final_status,
       ROUND(100.0*SUM(s.status_simple='RTS')/NULLIF(SUM(s.status_simple IN ('RTS','DELIVERED')),0),1) AS rts_rate,
       SUM(o.follow_up_count) AS follow_ups
     FROM orders o LEFT JOIN shipments s ON s.receipt=o.shipment_receipt
     WHERE ${w} GROUP BY COALESCE(o.handler_id,0) ORDER BY orders DESC`).bind(...args).all<Record<string, unknown> & { handler_id: number }>();
  // Sold = pcs terjual dari order Complete: qty varian × isi SKU di Manajemen SKU (lib/biaya.ts siapkanPcs)
  const [hitungPcs, jual] = await Promise.all([siapkanPcs(c.env.DB), c.env.DB.prepare(
    `SELECT COALESCE(o.handler_id, 0) AS handler_id, json_extract(o.raw_json,'$.final_variants') AS fv, o.product_names,
       CASE WHEN json_array_length(o.product_names)=1 THEN json_extract(o.raw_json,'$.follow_up_chats[0].product_id') END AS product_id
     FROM orders o WHERE ${w} AND ${CONFIRMED("o.")}`).bind(...args).all<{ handler_id: number; fv: string | null; product_names: string | null; product_id: number | null }>()]);
  const sold = new Map<number, { sold: number; sold_kurang: number }>();
  for (const o of jual.results) {
    const p = hitungPcs(o), t = sold.get(o.handler_id) ?? { sold: 0, sold_kurang: 0 };
    t.sold += p.pcs; if (p.kurang) t.sold_kurang++;
    sold.set(o.handler_id, t);
  }
  for (const r of perCs.results) Object.assign(r, sold.get(r.handler_id) ?? { sold: 0, sold_kurang: 0 });
  const team = await c.env.DB.prepare(
    `SELECT COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
       SUM(o.confirmed_time IS NOT NULL) AS confirm_timed,
       SUM(o.status='pending') AS pending,
       SUM(o.status='canceled') AS canceled,
       SUM(o.status IN ('draft','pending') AND o.canceled_time IS NULL) AS unhandled
     FROM orders o WHERE ${w}`).bind(...args).first();
  // Waktu konfirmasi (draft → confirmed) dan umur lead belum ditindak (draft → sekarang) hanya dihitung
  // di jam kerja CS, sama dengan waktu balas CS di bawah.
  const EPOCH = (x: string) => `(julianday(${x})-2440587.5)*86400`;
  const konfirmasi = await c.env.DB.prepare(
    `SELECT ${EPOCH("o.draft_time")} AS t0, ${EPOCH("o.confirmed_time")} AS t1 FROM orders o
     WHERE ${w} AND o.confirmed_time IS NOT NULL AND julianday(o.confirmed_time)>=julianday(o.draft_time)`)
    .bind(...args).all<{ t0: number; t1: number }>();
  const menitKonfirmasi = konfirmasi.results.map(r => menitJamKerja(r.t0, r.t1)).sort((a, b) => a - b);
  const median = menitKonfirmasi.length ? { minutes: Math.round(menitKonfirmasi[menitKonfirmasi.length >> 1]) } : null;
  const antre = await c.env.DB.prepare(
    `SELECT ${EPOCH("o.draft_time")} AS t0 FROM orders o
     WHERE ${w} AND o.status IN ('draft','pending') AND o.canceled_time IS NULL`).bind(...args).all<{ t0: number }>();
  const sekarang = Date.now() / 1000;
  const unhandled_over_6h = antre.results.filter(r => menitJamKerja(r.t0, sekarang) > 6 * 60).length;
  const hourly = await c.env.DB.prepare(
    `SELECT CAST(strftime('%H', datetime(o.draft_time, '+7 hours')) AS INTEGER) AS hour, COUNT(*) AS orders,
       SUM(o.confirmed_time IS NOT NULL) AS confirmed FROM orders o WHERE ${w} GROUP BY hour ORDER BY hour`).bind(...args).all();
  // Waktu balas CS per lead: created_at → pending_time (Scalev), hanya dihitung di jam kerja CS (JAM_KERJA_CS, WIB).
  // Lead yang masuk di luar jam kerja mulai dihitung saat jam kerja berikutnya dibuka. Lead tanpa pending_time =
  // belum/tidak melewati status pending (menit null). Selisih negatif atau > 7 hari dianggap data rusak dan diabaikan.
  // Median dihitung di frontend per jam masuk (WIB) atau per tanggal.
  const MASUK = "COALESCE(json_extract(o.raw_json,'$.created_at'), o.draft_time)", PENDING = "json_extract(o.raw_json,'$.pending_time')";
  const balas = await c.env.DB.prepare(
    `SELECT o.draft_date AS d, CAST(strftime('%H', datetime(${MASUK}, '+7 hours')) AS INTEGER) AS h,
       CASE WHEN ${PENDING} IS NOT NULL AND julianday(${PENDING})>=julianday(${MASUK}) AND julianday(${PENDING})-julianday(${MASUK})<=7
         THEN (julianday(${MASUK})-2440587.5)*86400 END AS t0,
       CASE WHEN ${PENDING} IS NOT NULL AND julianday(${PENDING})>=julianday(${MASUK}) AND julianday(${PENDING})-julianday(${MASUK})<=7
         THEN (julianday(${PENDING})-2440587.5)*86400 END AS t1,
       ${PENDING} IS NOT NULL AS ada_pending
     FROM orders o WHERE ${w}`).bind(...args).all<{ d: string; h: number; t0: number | null; t1: number | null; ada_pending: number }>();
  // Deret harian per tanggal order masuk — definisi sama dengan card Lead/Closing/Pending/Cancel.
  const daily = await c.env.DB.prepare(
    `SELECT o.draft_date AS date, COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
       SUM(o.status='pending') AS pending, SUM(o.status='canceled') AS canceled
     FROM orders o WHERE ${w} GROUP BY o.draft_date ORDER BY o.draft_date`).bind(...args).all();
  // Alasan batal diambil dari tag Scalev; order tanpa tag tetap ikut lewat LEFT JOIN.
  // Satu order bisa punya lebih dari satu tag, jadi ia dihitung pada tiap alasannya.
  // Order ID Scalev ikut dikirim per alasan untuk pop-up daftar order di laporan CS.
  const cancelTags = await c.env.DB.prepare(
    `SELECT je.value AS tag, o.order_id FROM orders o LEFT JOIN json_each(COALESCE(o.tags,'[]')) je
     WHERE ${w} AND o.status='canceled' ORDER BY o.draft_time DESC`).bind(...args).all<{ tag: string | null; order_id: string | null }>();
  const merged = new Map<string, { orders: number; ids: Set<string> }>();
  for (const r of cancelTags.results) {
    const reason = cancelReason(r.tag);
    const m = merged.get(reason) ?? { orders: 0, ids: new Set<string>() };
    m.orders++;
    if (r.order_id) m.ids.add(r.order_id);
    merged.set(reason, m);
  }
  const cancel_reasons = [...merged].map(([reason, m]) => ({ reason, orders: m.orders, order_ids: [...m.ids] }))
    .sort((a, b) => b.orders - a.orders).slice(0, 10);
  return c.json({ from, to, team: { ...team, unhandled_over_6h, median_confirm_minutes: median?.minutes ?? null }, per_cs: perCs.results, hourly: hourly.results, daily: daily.results, cancel_reasons,
    balas: balas.results.map(r => [r.d, r.h, r.t0 == null || r.t1 == null ? null : menitJamKerja(r.t0, r.t1), r.ada_pending]) });
});

// Jam kerja CS (WIB): waktu balas hanya dihitung di dalam rentang ini — ubah bila jadwal tim berubah.
const JAM_KERJA_CS = { mulai: 6, selesai: 21 };

/** Menit jam kerja CS (WIB) di antara dua epoch detik UTC, dibulatkan 1 desimal. */
function menitJamKerja(t0: number, t1: number): number {
  const WIB = 7 * 3600, HARI = 86400;
  const a = t0 + WIB, b = t1 + WIB;
  let detik = 0;
  for (let hari = Math.floor(a / HARI) * HARI; hari < b; hari += HARI) {
    const buka = hari + JAM_KERJA_CS.mulai * 3600, tutup = hari + JAM_KERJA_CS.selesai * 3600;
    detik += Math.max(0, Math.min(b, tutup) - Math.max(a, buka));
  }
  return Math.round(detik / 6) / 10;
}

/**
 * Inventory › Outbound: semua paket per tanggal dibuat; yang belum dijemput kurir (SHIP_BELUM_JEMPUT) hanya tampil di kartu Pending Pickup.
 * Per tanggal
 * paket dibuat (WIB). Isi paket dipecah ke produk di browser lewat pasangan nama barang → SKU (barang_sku)
 * (atau pasangan langsung nama barang → List Produk, barang_produk) dan isi SKU dari List Produk; biaya gudang sekali per paket.
 */
/**
 * Order Scalev pasangan paket Mengantar: remark1 = nomor order, atau resi sama (dua subquery berindeks, bukan EXISTS … OR …
 * yang terlalu berat untuk D1). Paket ber-order Scalev memakai isi order Scalev (varian → SKU katalog → Manajemen SKU);
 * pasangan manual di SKU Mengantar hanya untuk paket tanpa order Scalev.
 */
export const SHIP_SCALEV_ID = `COALESCE((SELECT o.id FROM orders o WHERE o.order_id=json_extract(s.raw_json,'$.remark1') AND o.is_spam=0 LIMIT 1),
  (SELECT o.id FROM orders o WHERE o.shipment_receipt=s.receipt AND o.is_spam=0 LIMIT 1))`;
const JOIN_SCALEV = `LEFT JOIN orders so ON so.id=${SHIP_SCALEV_ID}`;
const KOLOM_SCALEV = `so.order_id AS scalev_order, json_extract(so.raw_json,'$.final_variants') AS scalev_fv, so.product_names AS scalev_names,
  CASE WHEN json_array_length(so.product_names)=1 THEN json_extract(so.raw_json,'$.follow_up_chats[0].product_id') END AS scalev_pid`;
type IsiScalev = { nama: string; qty: number; sku: string | null; sku_id: number | null };

/**
 * Isi paket dari order Scalev: varian final_variants {nama: qty} (atau nama produk × 1) → item katalog (cocokkan, sama dengan
 * perhitungan HPP di lib/biaya.ts) → SKU varian di Scalev → id Manajemen SKU. Mengisi `scalev` (null = paket tanpa order Scalev)
 * dan membuang kolom mentahnya.
 */
async function pasangIsiScalev(db: D1Database, rows: Record<string, any>[]) {
  if (!rows.some(r => r.scalev_order)) { for (const r of rows) { r.scalev = null; delete r.scalev_fv; delete r.scalev_names; delete r.scalev_pid; } return; }
  const [kat, sku] = await db.batch([
    db.prepare("SELECT key, kind, product_id, product_name, name, option_tail, sku, price, status FROM catalog_items"),
    db.prepare("SELECT id, UPPER(TRIM(sku)) AS sku FROM sku_produk"),
  ]) as [D1Result<ItemKatalog>, D1Result<{ id: number; sku: string }>];
  const perNama = new Map<string, ItemKatalog[]>(), perProduk = new Map<number, ItemKatalog[]>();
  for (const it of kat.results) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const skuId = new Map(sku.results.map(s => [s.sku, s.id]));
  for (const r of rows) {
    if (r.scalev_order) {
      let varian: [string, number][] = [];
      try { varian = Object.entries(JSON.parse(r.scalev_fv ?? "null") ?? {}).map(([n, q]) => [n, Number(q) || 1]); } catch { /* lanjut */ }
      if (!varian.length) try { varian = (JSON.parse(r.scalev_names ?? "[]") as string[]).map(n => [n, 1]); } catch { /* kosong */ }
      r.scalev = varian.map(([nama, qty]): IsiScalev => {
        const it = cocokkan(nama, varian.length === 1 && r.scalev_pid != null ? Number(r.scalev_pid) : null, perNama, perProduk);
        const s = it?.sku ? it.sku.trim().toUpperCase() : null;
        return { nama, qty, sku: s, sku_id: s ? skuId.get(s) ?? null : null };
      });
    } else r.scalev = null;
    delete r.scalev_fv; delete r.scalev_names; delete r.scalev_pid;
  }
}

/**
 * Pesanan Shopee & TikTok sebagai "paket" untuk Outbound, Inbound RTS, dan Stok (kolom sama dengan baris paket Mengantar, plus
 * mp = shopee | tiktok, resi = nomor resi kurir (receipt tetap Order ID sebagai kunci kondisi retur) dan mp_isi = [{nama, sku, qty}] yang dipecah ke produk di browser lewat Manajemen SKU).
 *  - Gudang: gudang toko saat pesanan pertama masuk, atau gudang toko sekarang. Pengiriman Kilat Shopee / Fulfilled by TikTok
 *    (stok di gudang platform) → gudang Kilat / FBT toko (gudang_platform_id); belum diatur = tidak dihitung.
 *  - Tanggal (created_at) = waktu dikirim (belum dikirim: waktu dibuat, tampil sebagai Pending Pickup).
 *  - Status: selesai / terkirim → DELIVERED; retur, atau batal setelah dikirim → RTS (dikonfirmasi di Inbound RTS); lainnya → ON_GOING.
 *  - Tidak dihitung: belum bayar, batal sebelum dikirim, Kilat / FBT tanpa gudang Kilat / FBT,
 *    dan pesanan yang resinya sudah tercatat sebagai paket Mengantar (supaya tidak keluar dua kali).
 * `syarat` memakai kolom alias m.* (created_at ISO WIB, st, pending, kondisi, diterima_at).
 */
const ISO_WIB = (x: string) => `substr(${x},1,10)||'T'||substr(${x},12,5)||':00+07:00'`;
const sqlPaketMp = (syarat: string) => `SELECT * FROM (
  SELECT 'shopee' AS mp, p.no_pesanan AS receipt, p.resi AS resi, ${ISO_WIB("COALESCE(p.waktu_kirim,p.dibuat)")} AS created_at,
    'Shopee'||CASE WHEN p.kilat=1 THEN ' Kilat' ELSE '' END||' · '||COALESCE(p.kurir,'') AS courier, 'Toko Shopee '||t.nama AS shipper,
    (SELECT group_concat(COALESCE(i.nama,'?')||CASE WHEN i.qty>1 THEN ' ×'||i.qty ELSE '' END,' + ') FROM shopee_pesanan_item i WHERE i.no_pesanan=p.no_pesanan) AS goods,
    (SELECT json_group_array(json_object('nama',i.nama,'sku',UPPER(TRIM(COALESCE(i.sku,''))),'qty',i.qty)) FROM shopee_pesanan_item i WHERE i.no_pesanan=p.no_pesanan) AS mp_isi,
    CASE WHEN p.status IN ('retur','batal') THEN 'RTS' WHEN p.status IN ('selesai','terkirim','diterima') THEN 'DELIVERED' ELSE 'ON_GOING' END AS st,
    CASE WHEN p.status IN ('retur','batal') THEN 'RTS' ELSE p.status_asli END AS status, p.status_asli AS status_mg,
    p.status='perlu_dikirim' AS pending, p.cod AS is_cod, p.total_bayar AS cod_amount,
    CASE WHEN p.kilat=1 THEN t.gudang_platform_id ELSE COALESCE(p.gudang_id,t.gudang_id) END AS gudang_id,
    k.kondisi, k.catatan, k.diterima_at, k.diterima_oleh, p.updated_at AS rts_at
  FROM shopee_pesanan p JOIN shopee_toko t ON t.id=p.toko_id LEFT JOIN outbound_kondisi k ON k.receipt=p.no_pesanan
  WHERE p.status NOT IN ('belum_bayar','lain') AND NOT (p.status='batal' AND p.waktu_kirim IS NULL)
    AND NOT (p.kilat IS 1 AND t.gudang_platform_id IS NULL)
    AND (p.resi IS NULL OR NOT EXISTS (SELECT 1 FROM shipments s WHERE s.receipt=p.resi))
  UNION ALL
  SELECT 'tiktok', p.order_id, p.resi, ${ISO_WIB("COALESCE(p.dikirim,p.dibuat)")},
    COALESCE(p.channel,'TikTok')||CASE WHEN p.fbt=1 THEN ' FBT' ELSE '' END||' · '||COALESCE(p.kurir,''), 'Toko TikTok '||t.nama,
    (SELECT group_concat(COALESCE(i.nama,'?')||CASE WHEN i.qty>1 THEN ' ×'||i.qty ELSE '' END,' + ') FROM tiktok_pesanan_item i WHERE i.order_id=p.order_id),
    (SELECT json_group_array(json_object('nama',i.nama,'sku',UPPER(TRIM(COALESCE(i.sku,''))),'qty',i.qty)) FROM tiktok_pesanan_item i WHERE i.order_id=p.order_id),
    CASE WHEN p.status IN ('retur','batal') THEN 'RTS' WHEN p.status IN ('selesai','terkirim') THEN 'DELIVERED' ELSE 'ON_GOING' END,
    CASE WHEN p.status IN ('retur','batal') THEN 'RTS' ELSE p.status_asli END, p.status_asli,
    p.status='perlu_dikirim', p.cod, p.total, CASE WHEN p.fbt=1 THEN t.gudang_platform_id ELSE COALESCE(p.gudang_id,t.gudang_id) END,
    k.kondisi, k.catatan, k.diterima_at, k.diterima_oleh, COALESCE(${ISO_WIB("p.dibatalkan")}, p.updated_at)
  FROM tiktok_pesanan p JOIN tiktok_toko t ON t.id=p.toko_id LEFT JOIN outbound_kondisi k ON k.receipt=p.order_id
  WHERE p.status NOT IN ('belum_bayar','lain') AND NOT (p.status='batal' AND p.dikirim IS NULL)
    AND NOT (p.fbt IS 1 AND t.gudang_platform_id IS NULL)
    AND (p.resi IS NULL OR NOT EXISTS (SELECT 1 FROM shipments s WHERE s.receipt=p.resi))
) m WHERE ${syarat} ORDER BY m.created_at DESC LIMIT 20000`;
/** Baris paket marketplace → bentuk baris paket Mengantar (tanpa order Scalev / pasangan nama barang) */
const barisMp = (rows: Record<string, any>[]): Record<string, any>[] => rows.map(r => ({ ...r, scalev: null, sku_id: null, sku_qty: null }));

/** Data untuk memecah paket ke produk di browser (dipakai Outbound & Inbound RTS): gudang, SKU, isi SKU, List Produk, pasangan langsung. */
const masterIsiPaket = (db: D1Database) => [
  db.prepare("SELECT id, nama, jenis, biaya_penanganan, biaya_lain FROM gudang ORDER BY nama"),
  db.prepare("SELECT id, sku, produk, hpp, hpp_dasar FROM sku_produk"),
  db.prepare("SELECT sku_id, produk_id, qty FROM sku_produk_item ORDER BY sku_id, urut"),
  db.prepare("SELECT id, nama, hpp FROM produk_list ORDER BY nama"),
  db.prepare("SELECT goods, produk_id, qty FROM barang_produk ORDER BY goods, urut"),
  db.prepare("SELECT produk_id, berlaku, hpp FROM produk_hpp ORDER BY produk_id, berlaku"),
];
const jsonMaster = ([gudang, sku, isi, produk, langsung, riwayat]: D1Result[]) =>
  ({ gudang: gudang.results, sku: sku.results, isi: isi.results, produk: produk.results, barang_produk: langsung.results, hpp_riwayat: riwayat.results });

report.get("/outbound", async c => {
  const { from, to } = range(c);
  const db = c.env.DB;
  const [rows, mp, ...master] = await db.batch([
    db.prepare(
      `SELECT s.receipt, s.created_at, s.courier, ${SHIP_GUDANG} AS shipper, ${SHIP_BARANG} AS goods, ${SHIP_STATUS} AS st, s.status AS status_mg, ${SHIP_BELUM_JEMPUT} AS pending,
         s.is_cod, s.cod_amount, gp.gudang_id, bs.sku_id, bs.qty AS sku_qty, k.kondisi, k.catatan, ${KOLOM_SCALEV}
       FROM shipments s
         LEFT JOIN gudang_pengirim gp ON gp.shipper=${SHIP_GUDANG}
         LEFT JOIN barang_sku bs ON bs.goods=${SHIP_BARANG}
         LEFT JOIN outbound_kondisi k ON k.receipt=s.receipt
         ${JOIN_SCALEV}
       WHERE date(s.created_at,'+7 hours') BETWEEN ? AND ?
       ORDER BY s.created_at DESC LIMIT 20000`).bind(from, to),
    db.prepare(sqlPaketMp("substr(m.created_at,1,10) BETWEEN ?1 AND ?2")).bind(from, to),
    ...masterIsiPaket(db),
  ]);
  await pasangIsiScalev(db, rows.results as Record<string, any>[]);
  const semua = [...rows.results as Record<string, any>[], ...barisMp(mp.results as Record<string, any>[])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return c.json({ from, to, rows: semua, ...jsonMaster(master), ...(await shipMeta(c.env)) });
});

/** Tandai kondisi paket kembali: { receipt, kondisi: baik|rusak|hilang|null (null = kembali ke bawaan), catatan? } */
report.put("/outbound/kondisi", async c => {
  const b = await c.req.json<{ receipt?: string; kondisi?: string | null; catatan?: string }>();
  const receipt = String(b.receipt ?? "").trim();
  if (!receipt) return c.json({ error: "resi wajib diisi" }, 400);
  const db = c.env.DB;
  if (b.kondisi == null) {
    await db.prepare("DELETE FROM outbound_kondisi WHERE receipt=?").bind(receipt).run();
    return c.json({ ok: true });
  }
  if (!["baik", "rusak", "hilang"].includes(b.kondisi)) return c.json({ error: "kondisi harus baik, rusak, atau hilang" }, 400);
  const catatan = String(b.catatan ?? "").trim() || null;
  await db.prepare(
    `INSERT INTO outbound_kondisi (receipt, kondisi, catatan, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(receipt) DO UPDATE SET kondisi=excluded.kondisi, catatan=excluded.catatan, updated_at=excluded.updated_at,
       diterima_at=CASE WHEN excluded.kondisi='hilang' THEN NULL ELSE outbound_kondisi.diterima_at END`)
    .bind(receipt, b.kondisi, catatan, new Date().toISOString()).run();
  return c.json({ ok: true });
});

/**
 * Inventory › Inbound RTS: semua paket retur (status Mengantar RTS / SHIPMENT RETURN) dan PARCEL LOST.
 * Status Mengantar "RTS" = retur sudah sampai di pengirim; status RTS lain (mis. SHIPMENT RETURN) = retur masih di jalan.
 * Tanggal RTS = rts_at dari riwayat, atau perubahan status terakhir. Retur sebelum `mulai` dianggap sudah beres
 * sebelum Inbound RTS dipakai. Penggolongan (menunggu / di jalan / selesai) dilakukan di browser.
 * Kerugian per resi memakai saldo Mengantar: potongan ongkir yang benar-benar ditagih (tarif `price` hanya bila belum
 * ada potongan), dikurangi refund klaim ongkir; kompensasi barang dari Mengantar mengurangi kerugian HPP.
 */
report.get("/inbound-rts", async c => {
  const db = c.env.DB;
  const [rows, mp, ...master] = await db.batch([
    db.prepare(
      `SELECT s.receipt, s.created_at, s.courier, s.status, ${SHIP_STATUS} AS st, ${SHIP_GUDANG} AS shipper, ${SHIP_BARANG} AS goods,
         COALESCE(s.rts_at, ${SHIP_UBAH}, s.updated_at) AS rts_at, s.price, s.cod_amount, s.receiver_city,
         gp.gudang_id, bs.sku_id, bs.qty AS sku_qty, k.kondisi, k.catatan, k.diterima_at, k.diterima_oleh,
         inv.potong, inv.potong_n, inv.klaim, inv.kompensasi,
         f.status AS fu_status, f.note AS fu_note, f.last_at AS fu_at, json_extract(s.raw_json,'$.customerService') AS cs,
         json_extract(s.raw_json,'$.RECEIVER_NAME') AS receiver_name, s.is_cod, ${KOLOM_SCALEV}
       FROM shipments s
         LEFT JOIN gudang_pengirim gp ON gp.shipper=${SHIP_GUDANG}
         LEFT JOIN barang_sku bs ON bs.goods=${SHIP_BARANG}
         LEFT JOIN outbound_kondisi k ON k.receipt=s.receipt
         LEFT JOIN shipment_followups f ON f.receipt=s.receipt
         -- Saldo Mengantar per resi: potongan ongkir (retur), refund klaim ongkir, dan kompensasi barang
         LEFT JOIN (SELECT receipt,
             SUM(CASE WHEN type='typePayment' THEN amount ELSE 0 END) AS potong,
             SUM(type='typePayment') AS potong_n,
             SUM(CASE WHEN type='typeRefund' AND description LIKE 'Claim approved for returned order%' THEN -amount ELSE 0 END) AS klaim,
             SUM(CASE WHEN type='typeRefund' AND description NOT LIKE 'Claim approved for returned order%' THEN -amount ELSE 0 END) AS kompensasi
           FROM mengantar_invoices WHERE status='statusCleared' AND receipt IS NOT NULL GROUP BY receipt) inv ON inv.receipt=s.receipt
         ${JOIN_SCALEV}
       -- Calon RTS: masih di jalan tetapi hasil follow up WA di Tracking & Masalah = pembeli menolak
       WHERE ${SHIP_STATUS} IN ('RTS','LOST') OR (${SHIP_STATUS}='ON_GOING' AND f.status='menolak')
       ORDER BY rts_at DESC LIMIT 5000`),
    db.prepare(sqlPaketMp("m.st='RTS'")),
    ...masterIsiPaket(db),
  ]);
  await pasangIsiScalev(db, rows.results as Record<string, any>[]);
  const mulai = await db.prepare("SELECT value FROM kv WHERE key='inbound_rts_mulai'").first<{ value: string }>();
  const semua = [...rows.results as Record<string, any>[], ...barisMp(mp.results as Record<string, any>[])]
    .sort((a, b) => new Date(b.rts_at).getTime() - new Date(a.rts_at).getTime());
  return c.json({ rows: semua, ...jsonMaster(master), mulai: mulai?.value ?? null, ...(await shipMeta(c.env)) });
});

/**
 * Konfirmasi penerimaan retur di gudang, bisa banyak resi sekaligus.
 * { receipts: string[], aksi: baik | rusak (diterima) | hilang (tidak diterima) | batal (kembali menunggu), catatan? }
 */
report.put("/inbound-rts", async c => {
  const b = await c.req.json<{ receipts?: unknown; aksi?: string; catatan?: string }>();
  const resi = [...new Set((Array.isArray(b.receipts) ? b.receipts : []).map(r => String(r ?? "").trim()).filter(Boolean))];
  if (!resi.length) return c.json({ error: "resi wajib diisi" }, 400);
  if (!["baik", "rusak", "hilang", "batal"].includes(b.aksi ?? "")) return c.json({ error: "aksi harus baik, rusak, hilang, atau batal" }, 400);
  const db = c.env.DB, now = new Date().toISOString(), catatan = String(b.catatan ?? "").trim() || null;
  const oleh = await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env);
  const stmt = b.aksi === "batal"
    ? (r: string) => db.prepare("DELETE FROM outbound_kondisi WHERE receipt=?").bind(r)
    : (r: string) => db.prepare(
        `INSERT INTO outbound_kondisi (receipt, kondisi, catatan, updated_at, diterima_at, diterima_oleh) VALUES (?,?,?,?,?,?)
         ON CONFLICT(receipt) DO UPDATE SET kondisi=excluded.kondisi, catatan=COALESCE(excluded.catatan, outbound_kondisi.catatan),
           updated_at=excluded.updated_at, diterima_at=excluded.diterima_at, diterima_oleh=excluded.diterima_oleh`)
        .bind(r, b.aksi, catatan, now, b.aksi === "hilang" ? null : now, b.aksi === "hilang" ? null : oleh);
  for (let i = 0; i < resi.length; i += 100) await db.batch(resi.slice(i, i + 100).map(stmt));
  return c.json({ ok: true, saved: resi.length, diterima_at: b.aksi === "baik" || b.aksi === "rusak" ? now : null, oleh });
});

/** Ubah tanggal mulai pencatatan Inbound RTS. { mulai: "YYYY-MM-DD" } */
report.put("/inbound-rts/mulai", async c => {
  const { mulai } = await c.req.json<{ mulai?: string }>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mulai ?? ""))) return c.json({ error: "tanggal harus berformat YYYY-MM-DD" }, 400);
  await c.env.DB.prepare("INSERT INTO kv (key, value) VALUES ('inbound_rts_mulai', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(mulai).run();
  return c.json({ ok: true, mulai });
});

/**
 * Inventory › Stok: stok berjalan per produk × gudang sejak tanggal stok awal (kv stok_mulai).
 * Stok = stok awal + opname + barang masuk Inbound REQ − barang keluar (paket Mengantar dibuat sejak tanggal mulai, sudah dijemput kurir)
 *        + retur diterima baik di Inbound RTS (tanggal RTS sejak tanggal mulai — retur sebelumnya sudah masuk hitungan stok awal).
 * Paket dipecah ke produk di browser lewat pasangan SKU Mengantar, sama seperti Outbound.
 */
report.get("/stok", async c => {
  const db = c.env.DB;
  const mulai = (await db.prepare("SELECT value FROM kv WHERE key='stok_mulai'").first<{ value: string }>())?.value ?? todayReport();
  const [rows, mp, mutasi, masuk, ...master] = await db.batch([
    db.prepare(
      `SELECT s.receipt, s.created_at, ${SHIP_STATUS} AS st, ${SHIP_GUDANG} AS shipper, ${SHIP_BARANG} AS goods,
         gp.gudang_id, bs.sku_id, bs.qty AS sku_qty, k.kondisi, k.diterima_at, COALESCE(s.rts_at, ${SHIP_UBAH}, s.updated_at) AS rts_at, ${KOLOM_SCALEV}
       FROM shipments s
         LEFT JOIN gudang_pengirim gp ON gp.shipper=${SHIP_GUDANG}
         LEFT JOIN barang_sku bs ON bs.goods=${SHIP_BARANG}
         LEFT JOIN outbound_kondisi k ON k.receipt=s.receipt
         ${JOIN_SCALEV}
       WHERE NOT ${SHIP_BELUM_JEMPUT} AND (date(s.created_at,'+7 hours')>=?1
         OR (k.kondisi='baik' AND k.diterima_at IS NOT NULL AND date(k.diterima_at,'+7 hours')>=?1))
       LIMIT 50000`).bind(mulai),
    // Pesanan Shopee / TikTok yang sudah dikirim sejak tanggal mulai, atau returnya diterima baik sejak tanggal mulai
    db.prepare(sqlPaketMp(`NOT m.pending AND (substr(m.created_at,1,10)>=?1
      OR (m.kondisi='baik' AND m.diterima_at IS NOT NULL AND date(m.diterima_at,'+7 hours')>=?1))`)).bind(mulai),
    db.prepare("SELECT id, tanggal, produk_id, gudang_id, jenis, qty, catatan, oleh, created_at FROM stok_mutasi ORDER BY tanggal DESC, id DESC"),
    // Barang masuk dari Inbound REQ (qty diterima baik) ke gudang tujuan
    db.prepare(`SELECT t.tanggal, t.qty_baik AS qty, i.produk_id, r.gudang_id, r.nomor FROM inbound_req_terima t
      JOIN inbound_req_item i ON i.id=t.item_id JOIN inbound_req r ON r.id=t.req_id WHERE t.qty_baik>0`),
    ...masterIsiPaket(db),
  ]);
  await pasangIsiScalev(db, rows.results as Record<string, any>[]);
  return c.json({ mulai, hari_ini: todayReport(), rows: [...rows.results as Record<string, any>[], ...barisMp(mp.results as Record<string, any>[])], mutasi: mutasi.results, masuk: masuk.results, ...jsonMaster(master) });
});

/** Stok awal satu gudang per tanggal mulai. { gudang_id, rows: [{ produk_id, qty | null }] } — null = hapus stok awal produk itu. */
report.put("/stok/awal", async c => {
  const b = await c.req.json<{ gudang_id?: number; rows?: { produk_id?: number; qty?: unknown }[] }>();
  const db = c.env.DB, gudang = Number(b.gudang_id);
  if (!await db.prepare("SELECT id FROM gudang WHERE id=?").bind(gudang).first()) return c.json({ error: "gudang tidak ditemukan" }, 404);
  const mulai = (await db.prepare("SELECT value FROM kv WHERE key='stok_mulai'").first<{ value: string }>())?.value ?? todayReport();
  const oleh = await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env), now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const r of Array.isArray(b.rows) ? b.rows : []) {
    const produk = Number(r?.produk_id);
    if (!Number.isInteger(produk)) continue;
    // Ganti stok awal: hapus yang lama lalu tulis yang baru (kosong = hanya dihapus)
    stmts.push(db.prepare("DELETE FROM stok_mutasi WHERE jenis='awal' AND produk_id=? AND gudang_id=?").bind(produk, gudang));
    if (r.qty == null || r.qty === "") continue;
    const qty = Math.round(Number(r.qty));
    if (!Number.isFinite(qty) || qty < 0) return c.json({ error: "stok awal harus angka ≥ 0" }, 400);
    stmts.push(db.prepare("INSERT INTO stok_mutasi (tanggal, produk_id, gudang_id, jenis, qty, oleh, created_at) VALUES (?,?,?,'awal',?,?,?)")
      .bind(mulai, produk, gudang, qty, oleh, now));
  }
  if (stmts.length) await db.batch(stmts);   // satu batch = satu transaksi, hapus + tulis tidak terpisah
  return c.json({ ok: true });
});

/**
 * Opname / penyesuaian: { gudang_id, produk_id, qty (selisih: fisik − stok sistem), tanggal?, catatan? }.
 * Selisih dihitung di browser dari stok berjalan saat itu.
 */
report.post("/stok/opname", async c => {
  const b = await c.req.json<{ gudang_id?: number; produk_id?: number; qty?: unknown; tanggal?: string; catatan?: string }>();
  const db = c.env.DB, qty = Math.round(Number(b.qty)), hari = todayReport();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(b.tanggal ?? "")) ? String(b.tanggal) : hari;
  if (!Number.isFinite(qty) || !qty) return c.json({ error: "selisih opname tidak boleh 0" }, 400);
  if (tanggal > hari) return c.json({ error: "tanggal opname tidak boleh di masa depan" }, 400);
  const ada = await db.batch([db.prepare("SELECT id FROM gudang WHERE id=?").bind(b.gudang_id ?? null), db.prepare("SELECT id FROM produk_list WHERE id=?").bind(b.produk_id ?? null)]);
  if (!ada[0].results.length || !ada[1].results.length) return c.json({ error: "gudang / produk tidak ditemukan" }, 404);
  const oleh = await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env);
  const r = await db.prepare("INSERT INTO stok_mutasi (tanggal, produk_id, gudang_id, jenis, qty, catatan, oleh, created_at) VALUES (?,?,?,'opname',?,?,?,?)")
    .bind(tanggal, b.produk_id, b.gudang_id, qty, String(b.catatan ?? "").trim() || null, oleh, new Date().toISOString()).run();
  return c.json({ ok: true, id: r.meta.last_row_id, oleh });
});

/** Hapus satu catatan opname (stok awal diubah lewat form stok awal). */
report.delete("/stok/mutasi/:id", async c => {
  const r = await c.env.DB.prepare("DELETE FROM stok_mutasi WHERE id=? AND jenis='opname'").bind(Number(c.req.param("id"))).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "catatan opname tidak ditemukan" }, 404);
});
