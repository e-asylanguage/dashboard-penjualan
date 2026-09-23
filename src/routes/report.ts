import { Hono } from "hono";
import { Env, daysAgo, todayReport } from "../env";

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
       ROUND(AVG(gross_revenue)) AS aov,
       ROUND(AVG(CASE WHEN is_cod=1 THEN gross_revenue END)) AS aov_cod,
       ROUND(AVG(CASE WHEN is_cod=0 THEN gross_revenue END)) AS aov_transfer
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

  return c.json({ from, to, by_payment: byPay.results, by_store: byStore.results, speed, statuses: statuses.results, recent: recent.results });
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
    SUM(o.status='canceled') AS canceled,
    SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value`;

  const perWilayah = await c.env.DB.prepare(
    `SELECT ${PROV} AS province, ${metrik} FROM orders o WHERE ${w}
     GROUP BY ${PROV} ORDER BY orders DESC LIMIT 40`).bind(...args).all();
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
    `SELECT cp.product_group AS group_id, ${ORDER_AGG} FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign
     WHERE o.is_spam=0 AND o.draft_date BETWEEN ? AND ? AND cp.product_group IS NOT NULL GROUP BY cp.product_group`).bind(from, to).all();
  const unmapped = await c.env.DB.prepare(
    `SELECT cp.id, cp.name, cp.account_id, ROUND(SUM(i.spend)) AS spend FROM campaigns cp
     LEFT JOIN ad_insights_daily i ON i.campaign_id=cp.id AND i.date BETWEEN ? AND ? WHERE cp.product_group IS NULL GROUP BY cp.id ORDER BY spend DESC`).bind(from, to).all();
  return c.json({ from, to, groups: groups.results, orders_by_group: ordersByGroup.results, unmapped: unmapped.results });
});

/**
 * Perjalanan paket (Mengantar) digabung ke order Scalev lewat resi.
 * - per kurir: total, terkirim, RTS, masih jalan, gagal antar ≥1x, rata-rata hari kirim→terima
 * - paket bermasalah: tidak ada update > 48 jam, gagal antar, over SLA
 * - COD: nilai yang sudah diterima kurir vs masih di jalan
 */
report.get("/shipments", async c => {
  const { from, to } = range(c);
  const byCourier = await c.env.DB.prepare(
    `SELECT s.courier,
       COUNT(*) AS total,
       SUM(s.status_simple='DELIVERED') AS delivered,
       SUM(s.status_simple='RTS') AS rts,
       SUM(s.status_simple='ON_GOING') AS on_going,
       SUM(s.undelivered_count>0) AS had_undelivered,
       ROUND(AVG(CASE WHEN s.delivered_at IS NOT NULL THEN julianday(s.delivered_at)-julianday(s.created_at) END),1) AS avg_days_to_deliver,
       SUM(s.is_cod) AS cod_count,
       SUM(CASE WHEN s.status_simple='DELIVERED' THEN s.cod_amount ELSE 0 END) AS cod_delivered_value,
       SUM(CASE WHEN s.status_simple='ON_GOING' THEN s.cod_amount ELSE 0 END) AS cod_in_transit_value,
       SUM(s.price) AS shipping_fee, SUM(s.cod_fee) AS cod_fee
     FROM shipments s LEFT JOIN orders o ON o.shipment_receipt=s.receipt
     WHERE date(s.created_at) BETWEEN ? AND ? AND (o.id IS NULL OR o.is_spam=0)
     GROUP BY s.courier ORDER BY total DESC`).bind(from, to).all();

  const problems = await c.env.DB.prepare(
    `SELECT s.receipt, s.courier, s.status, s.status_category, s.last_event_at, s.last_event_note, s.undelivered_count, s.cod_amount, s.receiver_city,
       o.order_id, o.store_name, o.product_names, o.utm_content,
       ROUND((julianday('now')-julianday(COALESCE(s.last_event_at, s.updated_at, s.created_at)))*24) AS hours_since_update,
       ROUND(julianday('now')-julianday(s.created_at),1) AS days_in_transit
     FROM shipments s LEFT JOIN orders o ON o.shipment_receipt=s.receipt
     WHERE s.status_simple='ON_GOING' AND (
       (julianday('now')-julianday(COALESCE(s.last_event_at, s.updated_at, s.created_at)))*24 > 48
       OR s.undelivered_count>0 OR s.status_category IN ('over_sla','delivery_problem','need_attention','undelivered'))
     ORDER BY hours_since_update DESC LIMIT 100`).all();

  const daily = await c.env.DB.prepare(
    `SELECT date(created_at) AS date, COUNT(*) AS created, SUM(status_simple='DELIVERED') AS delivered, SUM(status_simple='RTS') AS rts
     FROM shipments WHERE date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY date`).bind(from, to).all();

  const unmatched = await c.env.DB.prepare(
    `SELECT COUNT(*) AS shipments_without_order FROM shipments s LEFT JOIN orders o ON o.shipment_receipt=s.receipt WHERE o.id IS NULL AND date(s.created_at) BETWEEN ? AND ?`
  ).bind(from, to).first();

  // RTS per kelompok produk / ad — untuk tahu iklan mana yang menghasilkan order bermasalah
  const rtsByAd = await c.env.DB.prepare(
    `SELECT o.utm_content AS ad_id, ad.name AS ad_name, cp.product_group, COUNT(*) AS shipped, SUM(s.status_simple='RTS') AS rts,
       ROUND(100.0*SUM(s.status_simple='RTS')/COUNT(*),1) AS rts_rate
     FROM shipments s JOIN orders o ON o.shipment_receipt=s.receipt
     LEFT JOIN ads ad ON ad.id=o.utm_content LEFT JOIN campaigns cp ON cp.id=o.utm_campaign
     WHERE date(s.created_at) BETWEEN ? AND ? AND o.utm_content IS NOT NULL
     GROUP BY o.utm_content HAVING shipped>=10 ORDER BY rts_rate DESC LIMIT 30`).bind(from, to).all();

  return c.json({ from, to, by_courier: byCourier.results, problems: problems.results, daily: daily.results, unmatched, rts_by_ad: rtsByAd.results });
});

/** Performa CS: per handler Scalev — order masuk, confirm rate, kecepatan konfirmasi, batal, RTS (via Mengantar). */
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
       SUM(o.status='canceled') AS canceled,
       SUM(CASE WHEN ${CONFIRMED("o.")} THEN o.gross_revenue ELSE 0 END) AS confirmed_value,
       SUM(s.status_simple='RTS') AS rts,
       SUM(s.status_simple IN ('RTS','DELIVERED')) AS with_final_status,
       ROUND(100.0*SUM(s.status_simple='RTS')/NULLIF(SUM(s.status_simple IN ('RTS','DELIVERED')),0),1) AS rts_rate,
       SUM(o.follow_up_count) AS follow_ups
     FROM orders o LEFT JOIN shipments s ON s.receipt=o.shipment_receipt
     WHERE ${w} GROUP BY COALESCE(o.handler_id,0) ORDER BY orders DESC`).bind(...args).all();
  const team = await c.env.DB.prepare(
    `SELECT COUNT(*) AS orders, SUM(${CONFIRMED("o.")}) AS confirmed,
       SUM(o.confirmed_time IS NOT NULL) AS confirm_timed,
       SUM(o.status IN ('draft','pending') AND o.canceled_time IS NULL) AS unhandled,
       SUM(o.status IN ('draft','pending') AND o.canceled_time IS NULL AND (julianday('now')-julianday(o.draft_time))*24>6) AS unhandled_over_6h
     FROM orders o WHERE ${w}`).bind(...args).first();
  // median waktu konfirmasi (SQLite tidak punya MEDIAN; ambil lewat OFFSET)
  const cnt = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${w} AND o.confirmed_time IS NOT NULL`).bind(...args).first<{ n: number }>())?.n ?? 0;
  const median = cnt ? await c.env.DB.prepare(
    `SELECT ROUND((julianday(o.confirmed_time)-julianday(o.draft_time))*24*60) AS minutes FROM orders o WHERE ${w} AND o.confirmed_time IS NOT NULL
     ORDER BY minutes LIMIT 1 OFFSET ?`).bind(...args, Math.floor(cnt / 2)).first<{ minutes: number }>() : null;
  const hourly = await c.env.DB.prepare(
    `SELECT CAST(strftime('%H', datetime(o.draft_time, '+7 hours')) AS INTEGER) AS hour, COUNT(*) AS orders,
       SUM(o.confirmed_time IS NOT NULL) AS confirmed FROM orders o WHERE ${w} GROUP BY hour ORDER BY hour`).bind(...args).all();
  // Alasan batal diambil dari tag Scalev; order tanpa tag tetap ikut lewat LEFT JOIN.
  // Satu order bisa punya lebih dari satu tag, jadi ia dihitung pada tiap alasannya.
  const cancelTags = await c.env.DB.prepare(
    `SELECT je.value AS tag, COUNT(*) AS orders FROM orders o LEFT JOIN json_each(COALESCE(o.tags,'[]')) je
     WHERE ${w} AND o.status='canceled' GROUP BY je.value`).bind(...args).all<{ tag: string | null; orders: number }>();
  const merged = new Map<string, number>();
  for (const r of cancelTags.results) {
    const reason = cancelReason(r.tag);
    merged.set(reason, (merged.get(reason) ?? 0) + r.orders);
  }
  const cancel_reasons = [...merged].map(([reason, orders]) => ({ reason, orders }))
    .sort((a, b) => b.orders - a.orders).slice(0, 10);
  return c.json({ from, to, team: { ...team, median_confirm_minutes: median?.minutes ?? null }, per_cs: perCs.results, hourly: hourly.results, cancel_reasons });
});
