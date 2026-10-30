import { Hono } from "hono";
import { Env } from "../env";
import { COOKIE_SESI, bacaCookie, cekSesi, userDashboard } from "../lib/sesi";
import { SHOPEE_SANDBOX } from "../lib/shopee-api";

/**
 * Shopee — sementara dari file ekspor Seller Centre (Pesanan Saya → Ekspor), di-parse di browser lalu dikirim per potongan.
 * Toko dipilih saat upload (file pesanan tidak memuat nama toko); gudang mengikuti toko.
 */
export const shopee = new Hono<{ Bindings: Env }>();

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const oleh = async (c: { env: Env; req: { header: (k: string) => string | undefined } }) =>
  (await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI))) ?? userDashboard(c.env);

/**
 * Status Shopee (kalimat dari kolom "Status Pesanan") → status ringkas.
 * "Telah Dikirim" = sudah sampai di pembeli tetapi belum dikonfirmasi; "Pesanan diterima, …" = sudah dikonfirmasi pembeli.
 */
export function statusPesanan(asli: string, retur: string, qtyRetur: number): string {
  const s = asli.trim().toLowerCase();
  if (s.startsWith("batal") || s.startsWith("dibatalkan")) return "batal";
  if (qtyRetur > 0 || /pengembalian|retur/.test(retur.toLowerCase())) return "retur";
  if (s.startsWith("belum bayar")) return "belum_bayar";
  if (s.startsWith("perlu dikirim") || s.startsWith("siap dikirim") || s.startsWith("perlu diproses")) return "perlu_dikirim";
  if (s.startsWith("sedang dikirim") || s === "dikirim") return "dikirim";
  if (s.startsWith("telah dikirim")) return "terkirim";
  if (s.startsWith("pesanan diterima")) return "diterima";
  if (s.startsWith("selesai")) return "selesai";
  if (s.includes("pengembalian")) return "retur";
  return "lain";
}

// Kelompok status untuk tampilan: terkirim = sudah sampai (dikonfirmasi pembeli atau belum)
const GRUP = `CASE WHEN p.status IN ('terkirim','diterima','selesai') THEN 'terkirim' ELSE p.status END`;
// "Reguler (Cashless)-SPX Standard" → "SPX Standard"
const KURIR = `CASE WHEN instr(p.kurir,'-')>0 THEN trim(substr(p.kurir, instr(p.kurir,'-')+1)) ELSE COALESCE(p.kurir,'(belum ada)') END`;

// ---- Toko
shopee.get("/toko", async c => {
  const db = c.env.DB;
  const [toko, gudang] = await db.batch([
    db.prepare(
      `SELECT t.id, t.nama, t.username, t.shop_id, t.gudang_id, g.nama AS gudang, t.mode,
         (SELECT a.updated_at FROM shopee_api_toko a WHERE a.shop_id=t.shop_id AND a.host<>'${SHOPEE_SANDBOX}' LIMIT 1) AS api_sejak,
         (SELECT COUNT(*) FROM shopee_pesanan p WHERE p.toko_id=t.id) AS pesanan,
         (SELECT MAX(dibuat) FROM shopee_pesanan p WHERE p.toko_id=t.id) AS pesanan_terakhir,
         (SELECT MAX(created_at) FROM shopee_upload u WHERE u.toko_id=t.id) AS upload_terakhir,
         t.gudang_platform_id, (SELECT COUNT(*) FROM shopee_pesanan p WHERE p.toko_id=t.id AND p.kilat=1) AS pesanan_platform
       FROM shopee_toko t LEFT JOIN gudang g ON g.id=t.gudang_id ORDER BY t.nama`),
    db.prepare("SELECT id, nama, jenis FROM gudang ORDER BY nama"),
  ]);
  return c.json({ toko: toko.results, gudang: gudang.results });
});

/** Gudang Kilat toko (stok di gudang Shopee, untuk pesanan Pengiriman Kilat): { gudang_id | null } */
shopee.put("/toko/:id/gudang-platform", async c => {
  const { gudang_id } = await c.req.json<{ gudang_id?: number | null }>();
  await c.env.DB.prepare("UPDATE shopee_toko SET gudang_platform_id=?, updated_at=? WHERE id=?")
    .bind(gudang_id ? Number(gudang_id) : null, new Date().toISOString(), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** Tambah / ubah toko: { id?, nama, username?, shop_id?, gudang_id?, mode? (api | upload) } */
shopee.put("/toko", async c => {
  const b = await c.req.json<{ id?: number; nama?: string; username?: string; shop_id?: string; gudang_id?: number | null; mode?: string }>();
  // mode tidak dikirim (mis. simpan username dari file iklan) → mode lama dipertahankan
  const mode = b.mode === "api" || b.mode === "upload" ? b.mode : null;
  const nama = String(b.nama ?? "").trim();
  if (!nama) return c.json({ error: "nama toko wajib diisi" }, 400);
  const username = String(b.username ?? "").trim() || null, shopId = String(b.shop_id ?? "").trim() || null;
  const gudang = b.gudang_id ? Number(b.gudang_id) : null, now = new Date().toISOString();
  try {
    if (b.id) {
      await c.env.DB.prepare("UPDATE shopee_toko SET nama=?, username=?, shop_id=?, gudang_id=?, mode=COALESCE(?, mode), updated_at=? WHERE id=?")
        .bind(nama, username, shopId, gudang, mode, now, b.id).run();
      return c.json({ ok: true, id: b.id });
    }
    const r = await c.env.DB.prepare("INSERT INTO shopee_toko (nama, username, shop_id, gudang_id, mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(nama, username, shopId, gudang, mode ?? "upload", now, now).run();
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "username Shopee itu sudah dipakai toko lain" }, 400);
    throw e;
  }
});

shopee.delete("/toko/:id", async c => {
  const id = Number(c.req.param("id"));
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM shopee_pesanan WHERE toko_id=?").bind(id).first<{ n: number }>();
  if (n?.n) return c.json({ error: `toko ini sudah punya ${n.n} pesanan — tidak bisa dihapus` }, 400);
  await c.env.DB.prepare("DELETE FROM shopee_toko WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});

// ---- Upload pesanan: buat catatan upload, lalu kirim pesanan per potongan (≤ 100 pesanan)
shopee.post("/upload", async c => {
  const b = await c.req.json<{ toko_id?: number; jenis?: string; nama_file?: string; baris?: number; dari?: string; sampai?: string; ringkasan?: string }>();
  const toko = await c.env.DB.prepare("SELECT id FROM shopee_toko WHERE id=?").bind(Number(b.toko_id)).first();
  if (!toko) return c.json({ error: "toko tidak ditemukan" }, 400);
  if (!["pesanan", "penghasilan", "iklan", "live", "live_produk"].includes(b.jenis ?? "")) return c.json({ error: "jenis file tidak dikenal" }, 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO shopee_upload (toko_id, jenis, nama_file, dari, sampai, baris, oleh, created_at, ringkasan, status) VALUES (?,?,?,?,?,?,?,?,?,'proses')")
    .bind(b.toko_id, b.jenis, String(b.nama_file ?? "").slice(0, 200), TGL.test(b.dari ?? "") ? b.dari : null, TGL.test(b.sampai ?? "") ? b.sampai : null,
      Number(b.baris) || 0, await oleh(c), new Date().toISOString(), String(b.ringkasan ?? "").slice(0, 400) || null).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

/** Tandai akhir upload (Log History): { status: terbaca | perlu_cek | gagal, catatan? } */
shopee.post("/upload/:id/selesai", async c => {
  const b = await c.req.json<{ status?: string; catatan?: string }>();
  if (!["terbaca", "perlu_cek", "gagal"].includes(b.status ?? "")) return c.json({ error: "status tidak dikenal" }, 400);
  await c.env.DB.prepare("UPDATE shopee_upload SET status=?, catatan=? WHERE id=?")
    .bind(b.status, String(b.catatan ?? "").slice(0, 400) || null, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

export type ItemIn = { sku?: string; sku_induk?: string; nama?: string; variasi?: string; harga_awal?: number; harga?: number; qty?: number; qty_retur?: number };
export type PesananIn = { no_pesanan?: string; status_asli?: string; alasan_batal?: string; status_retur?: string; resi?: string; kurir?: string; antar?: string;
  batas_kirim?: string; waktu_kirim?: string; dibuat?: string; dibayar?: string; selesai?: string; metode_bayar?: string;
  diskon_penjual?: number; voucher_penjual?: number; ongkir_pembeli?: number; total_bayar?: number; perkiraan_ongkir?: number;
  kota?: string; provinsi?: string; kilat?: boolean; items?: ItemIn[] };

/**
 * Simpan / perbarui pesanan Shopee (upsert per No. Pesanan; item diganti). sumber 'file': pesanan yang sudah tersinkron dari API
 * tidak ditimpa (isi file bisa lebih lama). sumber 'api': selalu menimpa.
 */
export async function simpanPesananShopee(db: D1Database, toko: { id: number; gudang_id: number | null }, pesanan: PesananIn[], sumber: "file" | "api", uploadId: number | null) {
  const teks = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s && s !== "-" ? s.slice(0, n) : null; };
  const angka = (v: unknown) => Math.round(Number(v) || 0);
  const waktu = (v: unknown) => { const s = teks(v, 20); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null; };
  const valid = pesanan.filter(p => teks(p.no_pesanan, 40) && waktu(p.dibuat));
  const ada = await db.prepare("SELECT no_pesanan, toko_id, sumber FROM shopee_pesanan WHERE no_pesanan IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(valid.map(p => teks(p.no_pesanan, 40)))).all<{ no_pesanan: string; toko_id: number; sumber: string }>();
  const lama = new Map(ada.results.map(r => [r.no_pesanan, r.toko_id]));
  const dariApi = new Set(sumber === "file" ? ada.results.filter(r => r.sumber === "api").map(r => r.no_pesanan) : []);
  const now = new Date().toISOString(), stmts: D1PreparedStatement[] = [];
  for (const p of valid) {
    if (dariApi.has(teks(p.no_pesanan, 40)!)) continue;
    const no = teks(p.no_pesanan, 40)!, items = (Array.isArray(p.items) ? p.items : []).slice(0, 50);
    const pcs = items.reduce((a, i) => a + (angka(i.qty) || 1), 0), pcsRetur = items.reduce((a, i) => a + angka(i.qty_retur), 0);
    const subtotal = items.reduce((a, i) => a + angka(i.harga) * (angka(i.qty) || 1), 0);
    const metode = teks(p.metode_bayar, 60);
    stmts.push(db.prepare(
      `INSERT INTO shopee_pesanan (no_pesanan, toko_id, gudang_id, status, status_asli, alasan_batal, status_retur, resi, kurir, antar, batas_kirim, waktu_kirim,
         dibuat, dibayar, selesai, metode_bayar, cod, subtotal, diskon_penjual, voucher_penjual, ongkir_pembeli, total_bayar, perkiraan_ongkir, pcs, pcs_retur,
         kota, provinsi, upload_id, sumber, created_at, updated_at, kilat)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?30,?31)
       ON CONFLICT(no_pesanan) DO UPDATE SET
         gudang_id=CASE WHEN shopee_pesanan.toko_id<>excluded.toko_id THEN excluded.gudang_id ELSE shopee_pesanan.gudang_id END, toko_id=excluded.toko_id,
         status=excluded.status, status_asli=excluded.status_asli, alasan_batal=excluded.alasan_batal, status_retur=excluded.status_retur,
         resi=COALESCE(excluded.resi, shopee_pesanan.resi), kurir=COALESCE(excluded.kurir, shopee_pesanan.kurir), antar=COALESCE(excluded.antar, shopee_pesanan.antar),
         batas_kirim=COALESCE(excluded.batas_kirim, shopee_pesanan.batas_kirim),
         waktu_kirim=COALESCE(excluded.waktu_kirim, shopee_pesanan.waktu_kirim), dibayar=COALESCE(excluded.dibayar, shopee_pesanan.dibayar),
         selesai=COALESCE(excluded.selesai, shopee_pesanan.selesai), metode_bayar=COALESCE(excluded.metode_bayar, shopee_pesanan.metode_bayar), cod=excluded.cod,
         subtotal=excluded.subtotal, diskon_penjual=excluded.diskon_penjual, voucher_penjual=excluded.voucher_penjual, ongkir_pembeli=excluded.ongkir_pembeli,
         total_bayar=excluded.total_bayar, perkiraan_ongkir=excluded.perkiraan_ongkir, pcs=excluded.pcs, pcs_retur=excluded.pcs_retur,
         kota=COALESCE(excluded.kota, shopee_pesanan.kota), provinsi=COALESCE(excluded.provinsi, shopee_pesanan.provinsi), upload_id=excluded.upload_id,
         sumber=excluded.sumber, updated_at=excluded.updated_at, kilat=COALESCE(excluded.kilat, shopee_pesanan.kilat)`)
      .bind(no, toko.id, toko.gudang_id, statusPesanan(String(p.status_asli ?? ""), String(p.status_retur ?? ""), pcsRetur), teks(p.status_asli, 200),
        teks(p.alasan_batal), teks(p.status_retur, 200), teks(p.resi, 60), teks(p.kurir, 100), teks(p.antar, 60), waktu(p.batas_kirim), waktu(p.waktu_kirim),
        waktu(p.dibuat), waktu(p.dibayar), waktu(p.selesai), metode, metode && /cod|bayar di tempat/i.test(metode) ? 1 : 0, subtotal,
        angka(p.diskon_penjual), angka(p.voucher_penjual), angka(p.ongkir_pembeli), angka(p.total_bayar), angka(p.perkiraan_ongkir), pcs, pcsRetur,
        teks(p.kota, 100), teks(p.provinsi, 100), uploadId, sumber, now, p.kilat == null ? null : p.kilat ? 1 : 0));
    stmts.push(db.prepare("DELETE FROM shopee_pesanan_item WHERE no_pesanan=?").bind(no));
    items.forEach((i, k) => stmts.push(db.prepare(
      "INSERT INTO shopee_pesanan_item (no_pesanan, urut, sku, sku_induk, nama, variasi, harga_awal, harga, qty, qty_retur) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(no, k, teks(i.sku, 80), teks(i.sku_induk, 80), teks(i.nama, 300), teks(i.variasi, 200), angka(i.harga_awal), angka(i.harga), angka(i.qty) || 1, angka(i.qty_retur))));
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  const dipakai = valid.filter(p => !dariApi.has(teks(p.no_pesanan, 40)!));
  const baru = dipakai.filter(p => !lama.has(teks(p.no_pesanan, 40)!)).length;
  const pindah = dipakai.filter(p => { const t = lama.get(teks(p.no_pesanan, 40)!); return t != null && t !== toko.id; }).length;
  return { disimpan: dipakai.length, baru, pindah, dilewati: pesanan.length - valid.length, dilewati_api: valid.length - dipakai.length };
}

shopee.post("/upload/:id/pesanan", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT u.id, u.toko_id, t.gudang_id FROM shopee_upload u JOIN shopee_toko t ON t.id=u.toko_id WHERE u.id=? AND u.jenis='pesanan'")
    .bind(id).first<{ id: number; toko_id: number; gudang_id: number | null }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { pesanan } = await c.req.json<{ pesanan?: PesananIn[] }>();
  if (!Array.isArray(pesanan) || !pesanan.length || pesanan.length > 100) return c.json({ error: "kirim 1–100 pesanan per permintaan" }, 400);
  const h = await simpanPesananShopee(db, { id: up.toko_id, gudang_id: up.gudang_id }, pesanan, "file", up.id);
  await db.prepare("UPDATE shopee_upload SET pesanan=pesanan+?, baru=baru+? WHERE id=?").bind(h.disimpan, h.baru, id).run();
  return c.json({ ok: true, ...h, diperbarui: h.disimpan - h.baru });
});

/**
 * Log History upload. ?from&to = periode data file beririsan dengan rentang (file tanpa periode → menurut tanggal upload WIB); ?toko opsional.
 * Tanpa from/to → 50 upload terakhir.
 */
shopee.get("/upload", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null;
  const w: string[] = [], args: (string | number)[] = [];
  if (TGL.test(from) && TGL.test(to)) {
    w.push(`COALESCE(u.dari, date(u.created_at,'+7 hours'))<=? AND COALESCE(u.sampai, u.dari, date(u.created_at,'+7 hours'))>=?`);
    args.push(to, from);
  }
  if (toko) { w.push("u.toko_id=?"); args.push(toko); }
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.toko_id, t.nama AS toko, u.jenis, u.nama_file, u.dari, u.sampai, u.baris, u.pesanan, u.baru, u.oleh, u.created_at,
       u.ringkasan, u.status, u.catatan
     FROM shopee_upload u JOIN shopee_toko t ON t.id=u.toko_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY u.id DESC LIMIT 200`).bind(...args).all();
  return c.json({ rows: rows.results });
});

/**
 * Kesehatan data per toko untuk satu jenis (pesanan | penghasilan | iklan) & rentang ?from&to: data terakhir keseluruhan,
 * cakupan di dalam rentang (tanggal pertama–terakhir yang ada datanya), jumlah (dan yang dari API), upload terakhir.
 * Status (terkini / tertinggal / belum ada) ditentukan di browser.
 */
shopee.get("/status", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", jenis = c.req.query("jenis") ?? "pesanan";
  if (!TGL.test(from) || !TGL.test(to)) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const T = (kol: string) => `MAX(${kol}) AS terakhir, MIN(CASE WHEN ${kol} BETWEEN ?1 AND ?2 THEN ${kol} END) AS awal_rentang,
    MAX(CASE WHEN ${kol} BETWEEN ?1 AND ?2 THEN ${kol} END) AS akhir_rentang, SUM(${kol} BETWEEN ?1 AND ?2) AS n`;
  const sql = jenis === "penghasilan"
    ? `SELECT h.toko_id, ${T("h.dilepas")}, SUM(h.dilepas BETWEEN ?1 AND ?2 AND h.sumber='api') AS n_api FROM shopee_penghasilan h GROUP BY h.toko_id`
    : jenis === "iklan"
    ? `SELECT l.toko_id, ${T("l.sampai")}, SUM(l.sampai BETWEEN ?1 AND ?2 AND l.sumber='api') AS n_api FROM shopee_iklan_laporan l GROUP BY l.toko_id`
    : `SELECT p.toko_id, ${T("substr(p.dibuat,1,10)")}, SUM(substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.sumber='api') AS n_api FROM shopee_pesanan p GROUP BY p.toko_id`;
  const [data, upload] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(from, to),
    c.env.DB.prepare("SELECT toko_id, MAX(created_at) AS upload_terakhir FROM shopee_upload WHERE jenis=? GROUP BY toko_id").bind(jenis),
  ]) as D1Result<Record<string, any>>[];
  const up = new Map(upload.results.map(r => [r.toko_id, r.upload_terakhir]));
  return c.json({ from, to, jenis, toko: data.results.map(r => ({ ...r, upload_terakhir: up.get(r.toko_id) ?? null })),
    upload: upload.results });
});

// ---- Pengiriman: ringkasan per tanggal pesanan dibuat (WIB)
function filter(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null;
  if (!TGL.test(from) || !TGL.test(to)) return null;
  const w = ["substr(p.dibuat,1,10) BETWEEN ? AND ?"], args: (string | number)[] = [from, to];
  if (toko) { w.push("p.toko_id=?"); args.push(toko); }
  return { from, to, toko, W: w.join(" AND "), args };
}
const sekarangWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

shopee.get("/pengiriman", async c => {
  const f = filter(c);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, q = (sql: string, ...extra: (string | number)[]) => db.prepare(sql).bind(...f.args, ...extra);
  const kini = sekarangWib();
  const [status, harian, perToko, perKurir, perSku, batal, telat, toko, gudang] = await db.batch([
    q(`SELECT ${GRUP} AS grup, COUNT(*) AS n, SUM(p.subtotal) AS nilai, SUM(p.pcs) AS pcs, SUM(p.cod) AS cod FROM shopee_pesanan p WHERE ${f.W} GROUP BY 1`),
    q(`SELECT substr(p.dibuat,1,10) AS tgl, ${GRUP} AS grup, COUNT(*) AS n FROM shopee_pesanan p WHERE ${f.W} GROUP BY 1, 2`),
    q(`SELECT p.toko_id, COUNT(*) AS n, SUM(p.status='belum_bayar') AS belum_bayar, SUM(p.status='perlu_dikirim') AS perlu_dikirim,
         SUM(p.status='dikirim') AS dikirim, SUM(p.status IN ('terkirim','diterima','selesai')) AS terkirim, SUM(p.status='batal') AS batal,
         SUM(p.status='retur') AS retur, SUM(CASE WHEN p.status NOT IN ('batal','belum_bayar') THEN p.subtotal ELSE 0 END) AS omzet,
         SUM(CASE WHEN p.status NOT IN ('batal','belum_bayar') THEN p.pcs ELSE 0 END) AS pcs, MAX(p.dibuat) AS terakhir
       FROM shopee_pesanan p WHERE ${f.W} GROUP BY p.toko_id`),
    q(`SELECT ${KURIR} AS kurir, COUNT(*) AS n, SUM(p.status='perlu_dikirim') AS perlu_dikirim, SUM(p.status='dikirim') AS dikirim,
         SUM(p.status IN ('terkirim','diterima','selesai')) AS terkirim, SUM(p.status='retur') AS retur, SUM(p.cod) AS cod,
         SUM(p.antar LIKE 'Pickup%') AS pickup
       FROM shopee_pesanan p WHERE ${f.W} AND p.status NOT IN ('batal','belum_bayar') GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT UPPER(TRIM(COALESCE(i.sku,''))) AS sku, MIN(i.nama) AS nama, MIN(i.variasi) AS variasi, SUM(i.qty) AS qty, COUNT(DISTINCT p.no_pesanan) AS pesanan,
         SUM(i.harga*i.qty) AS omzet, SUM(i.qty_retur) AS retur, MIN(p.gudang_id) AS gudang_id, COUNT(DISTINCT p.gudang_id) AS n_gudang,
         (SELECT s.id FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE) AS sku_id,
         (SELECT s.produk FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE) AS sku_produk
       FROM shopee_pesanan p JOIN shopee_pesanan_item i ON i.no_pesanan=p.no_pesanan
       WHERE ${f.W} AND p.status NOT IN ('batal','belum_bayar') GROUP BY 1 ORDER BY qty DESC`),
    q(`SELECT COALESCE(p.alasan_batal,'(tanpa alasan)') AS alasan, COUNT(*) AS n, SUM(p.subtotal) AS nilai, SUM(p.cod) AS cod FROM shopee_pesanan p WHERE ${f.W} AND p.status='batal' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT COUNT(*) AS n FROM shopee_pesanan p WHERE ${f.W} AND p.status='perlu_dikirim' AND p.batas_kirim IS NOT NULL AND p.batas_kirim < ?`, kini),
    db.prepare(`SELECT t.id, t.nama, t.gudang_id, g.nama AS gudang, g.jenis AS gudang_jenis,
        (SELECT MAX(dibuat) FROM shopee_pesanan x WHERE x.toko_id=t.id) AS data_sampai,
        (SELECT MAX(created_at) FROM shopee_upload u WHERE u.toko_id=t.id AND u.jenis='pesanan') AS upload_terakhir
      FROM shopee_toko t LEFT JOIN gudang g ON g.id=t.gudang_id ORDER BY t.nama`),
    db.prepare("SELECT id, nama, jenis FROM gudang ORDER BY nama"),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from: f.from, to: f.to, kini, status: status.results, harian: harian.results, per_toko: perToko.results, per_kurir: perKurir.results,
    per_sku: perSku.results, batal: batal.results, telat: telat.results[0]?.n ?? 0, toko: toko.results, gudang: gudang.results });
});

/** Daftar pesanan (100 per halaman): ?grup=perlu_dikirim|dikirim|terkirim|batal|retur|belum_bayar|telat & q= (no pesanan / resi / produk / SKU) */
shopee.get("/pengiriman/daftar", async c => {
  const f = filter(c);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const grup = c.req.query("grup") ?? "", cari = (c.req.query("q") ?? "").trim(), offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const w = [f.W], args = [...f.args];
  if (grup === "telat") { w.push("p.status='perlu_dikirim' AND p.batas_kirim < ?"); args.push(sekarangWib()); }
  else if (grup) { w.push(`${GRUP}=?`); args.push(grup); }
  if (cari) {
    w.push("(p.no_pesanan LIKE ? OR p.resi LIKE ? OR EXISTS (SELECT 1 FROM shopee_pesanan_item i WHERE i.no_pesanan=p.no_pesanan AND (i.nama LIKE ? OR i.sku LIKE ?)))");
    const pola = `%${cari}%`; args.push(pola, pola, pola, pola);
  }
  const W = w.join(" AND ");
  const [rows, total] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT p.no_pesanan, p.toko_id, t.nama AS toko, p.sumber, p.status, p.status_asli, p.alasan_batal, p.status_retur, p.resi, p.kurir, ${KURIR} AS kurir_singkat,
         p.antar, p.batas_kirim, p.waktu_kirim, p.dibuat, p.dibayar, p.selesai, p.metode_bayar, p.cod, p.subtotal, p.total_bayar, p.pcs, p.pcs_retur,
         p.kota, p.provinsi,
         (SELECT json_group_array(json_object('sku', i.sku, 'nama', i.nama, 'variasi', i.variasi, 'qty', i.qty, 'harga', i.harga))
            FROM shopee_pesanan_item i WHERE i.no_pesanan=p.no_pesanan) AS items
       FROM shopee_pesanan p JOIN shopee_toko t ON t.id=p.toko_id WHERE ${W}
       ORDER BY CASE WHEN p.status='perlu_dikirim' THEN 0 ELSE 1 END, CASE WHEN p.status='perlu_dikirim' THEN p.batas_kirim END, p.dibuat DESC
       LIMIT 100 OFFSET ?`).bind(...args, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM shopee_pesanan p WHERE ${W}`).bind(...args),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ rows: rows.results.map(r => ({ ...r, items: JSON.parse(r.items || "[]") })), total: total.results[0]?.n ?? 0, offset });
});

// ---- Penghasilan (file "Income.sudah dilepas…", sheet Penghasilan). Kelompok biaya ditentukan di browser dari judul kelompok Shopee.
export type PenghasilanIn = { no_pesanan?: string; dibuat?: string; dilepas?: string; metode_pelepasan?: string; tipe_pesanan?: string;
  harga_produk?: number; refund?: number; ongkir?: number; voucher?: number; biaya_platform?: number; biaya_gox?: number; biaya_layanan?: number;
  biaya_promosi?: number; biaya_lainnya?: number; pajak?: number; isi_saldo_iklan?: number; total?: number; dibayar_pembeli?: number;
  metode_bayar?: string; kurir?: string; produk?: { id?: string; nama?: string }[]; rincian?: Record<string, number> };

/** Simpan / perbarui penghasilan Shopee (upsert per No. Pesanan). sumber 'file' tidak menimpa baris dari API. */
export async function simpanPenghasilanShopee(db: D1Database, tokoId: number, rows: PenghasilanIn[], sumber: "file" | "api", uploadId: number | null) {
  const teks = (v: unknown, n = 200) => { const s = String(v ?? "").trim(); return s && s !== "-" ? s.slice(0, n) : null; };
  const angka = (v: unknown) => Math.round(Number(v) || 0);
  const tgl = (v: unknown) => { const s = String(v ?? "").trim().slice(0, 10); return TGL.test(s) ? s : null; };
  const valid = rows.filter(r => teks(r.no_pesanan, 40) && tgl(r.dilepas));
  const ada = await db.prepare("SELECT no_pesanan, toko_id, sumber FROM shopee_penghasilan WHERE no_pesanan IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(valid.map(r => teks(r.no_pesanan, 40)))).all<{ no_pesanan: string; toko_id: number; sumber: string }>();
  const lama = new Map(ada.results.map(r => [r.no_pesanan, r.toko_id]));
  const dariApi = new Set(sumber === "file" ? ada.results.filter(r => r.sumber === "api").map(r => r.no_pesanan) : []);
  const dipakai = valid.filter(r => !dariApi.has(teks(r.no_pesanan, 40)!));
  const now = new Date().toISOString();
  const rincian = (r: Record<string, number> | undefined) => {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(r ?? {}).slice(0, 80)) if (Number(v)) o[String(k).slice(0, 120)] = angka(v);
    return JSON.stringify(o);
  };
  const stmts = dipakai.map(r => db.prepare(
    `INSERT INTO shopee_penghasilan (no_pesanan, toko_id, dibuat, dilepas, metode_pelepasan, tipe_pesanan, harga_produk, refund, ongkir, voucher,
       biaya_platform, biaya_gox, biaya_layanan, biaya_promosi, biaya_lainnya, pajak, isi_saldo_iklan, total, dibayar_pembeli, metode_bayar, kurir,
       produk, rincian, upload_id, sumber, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?26)
     ON CONFLICT(no_pesanan) DO UPDATE SET toko_id=excluded.toko_id, dibuat=COALESCE(excluded.dibuat, shopee_penghasilan.dibuat), dilepas=excluded.dilepas,
       metode_pelepasan=COALESCE(excluded.metode_pelepasan, shopee_penghasilan.metode_pelepasan), tipe_pesanan=COALESCE(excluded.tipe_pesanan, shopee_penghasilan.tipe_pesanan),
       harga_produk=excluded.harga_produk, refund=excluded.refund,
       ongkir=excluded.ongkir, voucher=excluded.voucher, biaya_platform=excluded.biaya_platform, biaya_gox=excluded.biaya_gox,
       biaya_layanan=excluded.biaya_layanan, biaya_promosi=excluded.biaya_promosi, biaya_lainnya=excluded.biaya_lainnya, pajak=excluded.pajak,
       isi_saldo_iklan=excluded.isi_saldo_iklan, total=excluded.total, dibayar_pembeli=excluded.dibayar_pembeli,
       metode_bayar=COALESCE(excluded.metode_bayar, shopee_penghasilan.metode_bayar), kurir=COALESCE(excluded.kurir, shopee_penghasilan.kurir),
       produk=CASE WHEN excluded.produk='[]' THEN shopee_penghasilan.produk ELSE excluded.produk END, rincian=excluded.rincian, upload_id=excluded.upload_id,
       sumber=excluded.sumber, updated_at=excluded.updated_at`)
    .bind(teks(r.no_pesanan, 40), tokoId, tgl(r.dibuat), tgl(r.dilepas), teks(r.metode_pelepasan, 60), teks(r.tipe_pesanan, 60),
      angka(r.harga_produk), angka(r.refund), angka(r.ongkir), angka(r.voucher), angka(r.biaya_platform), angka(r.biaya_gox), angka(r.biaya_layanan),
      angka(r.biaya_promosi), angka(r.biaya_lainnya), angka(r.pajak), angka(r.isi_saldo_iklan), angka(r.total), angka(r.dibayar_pembeli),
      teks(r.metode_bayar, 60), teks(r.kurir, 100),
      JSON.stringify((Array.isArray(r.produk) ? r.produk : []).slice(0, 30).map(p => ({ id: teks(p.id, 40), nama: teks(p.nama, 300) }))),
      rincian(r.rincian), uploadId, sumber, now));
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  const baru = dipakai.filter(r => !lama.has(teks(r.no_pesanan, 40)!)).length;
  const pindah = dipakai.filter(r => { const t = lama.get(teks(r.no_pesanan, 40)!); return t != null && t !== tokoId; }).length;
  return { disimpan: dipakai.length, baru, pindah, dilewati: rows.length - valid.length, dilewati_api: valid.length - dipakai.length };
}

shopee.post("/upload/:id/penghasilan", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM shopee_upload WHERE id=? AND jenis='penghasilan'").bind(id).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { rows } = await c.req.json<{ rows?: PenghasilanIn[] }>();
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) return c.json({ error: "kirim 1–100 pesanan per permintaan" }, 400);
  const h = await simpanPenghasilanShopee(db, up.toko_id, rows, "file", up.id);
  await db.prepare("UPDATE shopee_upload SET pesanan=pesanan+?, baru=baru+? WHERE id=?").bind(h.disimpan, h.baru, id).run();
  return c.json({ ok: true, ...h, diperbarui: h.disimpan - h.baru });
});

function filterHasil(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null;
  if (!TGL.test(from) || !TGL.test(to)) return null;
  // basis=dibuat (atau iklan) → menurut tanggal pesanan dibuat; selain itu menurut tanggal dana dilepas
  const basis = ["dibuat", "iklan"].includes(c.req.query("basis") ?? "") ? "dibuat" : "dilepas", kol = `h.${basis}`;
  const w = [`${kol} BETWEEN ? AND ?`], args: (string | number)[] = [from, to];
  if (toko) { w.push("h.toko_id=?"); args.push(toko); }
  return { from, to, toko, basis, kol, W: w.join(" AND "), args };
}
// Biaya Shopee = semua kelompok potongan (tanpa ongkir / voucher / isi saldo iklan).
// HPP per pesanan = isi file Pesanan × HPP Manajemen SKU saat ini (sudah termasuk biaya gudang SKU).
const BIAYA = "(h.biaya_platform+h.biaya_gox+h.biaya_layanan+h.biaya_promosi+h.biaya_lainnya+h.pajak)";
export const HPP_PESANAN = "(SELECT SUM(i.qty*s.hpp) FROM shopee_pesanan_item i JOIN sku_produk s ON s.sku=TRIM(i.sku) COLLATE NOCASE WHERE i.no_pesanan=h.no_pesanan)";
export const SKU_KOSONG = `EXISTS (SELECT 1 FROM shopee_pesanan_item i WHERE i.no_pesanan=h.no_pesanan
  AND NOT EXISTS (SELECT 1 FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE))`;
export const ADA_PESANAN = "EXISTS (SELECT 1 FROM shopee_pesanan p WHERE p.no_pesanan=h.no_pesanan)";

shopee.get("/penghasilan", async c => {
  const f = filterHasil(c);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, q = (sql: string) => db.prepare(sql).bind(...f.args);
  // Komisi affiliate (AMS): sudah termasuk Biaya Promosi; diambil terpisah dari rincian (API: order_ams_commission_fee, file: Biaya Komisi AMS)
  const AMS = `COALESCE(ABS(json_extract(h.rincian,'$."api|order_ams_commission_fee"')), ABS(json_extract(h.rincian,'$."promosi|Biaya Komisi AMS"')), 0)`;
  const KOLOM = `COUNT(*) AS n, SUM(${AMS}) AS afiliasi, SUM(${AMS}>0) AS n_afiliasi, SUM(h.harga_produk) AS harga, SUM(h.refund) AS refund, SUM(h.ongkir) AS ongkir, SUM(h.voucher) AS voucher,
    SUM(h.biaya_platform) AS platform, SUM(h.biaya_gox) AS gox, SUM(h.biaya_layanan) AS layanan, SUM(h.biaya_promosi) AS promosi,
    SUM(h.biaya_lainnya) AS lainnya, SUM(h.pajak) AS pajak, SUM(h.isi_saldo_iklan) AS isi_saldo, SUM(h.total) AS total,
    SUM(${HPP_PESANAN}) AS hpp, SUM(NOT ${ADA_PESANAN}) AS tanpa_pesanan, SUM(${SKU_KOSONG}) AS sku_kosong`;
  // Pesanan dibuat di rentang (sudah dibayar, tidak batal) yang dananya belum dilepas — hanya untuk basis tanggal dibuat
  const tokoArg = f.toko ? [f.toko] : [];
  const belum = f.basis === "dibuat"
    ? db.prepare(`SELECT substr(p.dibuat,1,10) AS tgl, COUNT(*) AS n, SUM(p.subtotal) AS subtotal FROM shopee_pesanan p
        WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.status NOT IN ('batal','belum_bayar')${f.toko ? " AND p.toko_id=?3" : ""}
          AND NOT EXISTS (SELECT 1 FROM shopee_penghasilan h WHERE h.no_pesanan=p.no_pesanan) GROUP BY 1 ORDER BY 1`).bind(f.from, f.to, ...tokoArg)
    : db.prepare("SELECT NULL AS tgl LIMIT 0");
  // basis=iklan: corong order dari iklan. Shopee tidak memberi No. Pesanan per iklan, jadi batal / dikirim diperkirakan dari rasio
  // seluruh pesanan toko yang dibuat di rentang yang sama (selain belum bayar); konversi dari laporan iklan yang seluruh periodenya di dalam rentang.
  const corong = c.req.query("basis") === "iklan"
    ? db.prepare(`SELECT (SELECT COALESCE(SUM(i.konversi),0) FROM shopee_iklan i JOIN shopee_iklan_laporan l ON l.id=i.laporan_id
          WHERE l.dari>=?1 AND l.sampai<=?2${f.toko ? " AND l.toko_id=?3" : ""}) AS konversi,
        (SELECT COALESCE(SUM(i.omzet),0) FROM shopee_iklan i JOIN shopee_iklan_laporan l ON l.id=i.laporan_id
          WHERE l.dari>=?1 AND l.sampai<=?2${f.toko ? " AND l.toko_id=?3" : ""}) AS omzet,
        COUNT(*) AS pesanan, SUM(p.status='batal') AS batal, SUM(p.status IN ('dikirim','terkirim','diterima','selesai','retur')) AS dikirim
      FROM shopee_pesanan p WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.status<>'belum_bayar'${f.toko ? " AND p.toko_id=?3" : ""}`)
      .bind(f.from, f.to, ...tokoArg)
    : db.prepare("SELECT NULL AS konversi LIMIT 0");
  // Acuan rasio penghasilan untuk estimasi (pesanan belum dilepas / pesanan iklan) bila di rentang belum ada dana yang dilepas:
  // 60 hari pesanan dibuat s/d `to`. Hanya untuk basis tanggal dibuat / iklan.
  const iklanMode = c.req.query("basis") === "iklan", pakaiAcuan = f.basis === "dibuat";
  const acuanDari = new Date(Date.parse(f.to + "T00:00:00Z") - 59 * 864e5).toISOString().slice(0, 10);
  const wAcuan = `h.dibuat BETWEEN ?1 AND ?2${f.toko ? " AND h.toko_id=?3" : ""}`, aAcuan = [acuanDari, f.to, ...tokoArg];
  const acuanTot = pakaiAcuan ? db.prepare(`SELECT ${KOLOM} FROM shopee_penghasilan h WHERE ${wAcuan}`).bind(...aAcuan) : db.prepare("SELECT NULL AS n LIMIT 0");
  const acuanRin = pakaiAcuan
    ? db.prepare(`SELECT j.key AS kolom, SUM(j.value) AS jumlah, COUNT(*) AS n FROM shopee_penghasilan h, json_each(h.rincian) j WHERE ${wAcuan} GROUP BY 1`).bind(...aAcuan)
    : db.prepare("SELECT NULL AS kolom LIMIT 0");
  const [tot, harian, perToko, rincian, perSku, tanpa, toko, iklan, iklanLap, belumDilepas, corongIklan, acuanT, acuanR, afiliasiHarian, pesananValid, live, liveProduk] = await db.batch([
    q(`SELECT ${KOLOM} FROM shopee_penghasilan h WHERE ${f.W}`),
    q(`SELECT ${f.kol} AS tgl, COUNT(*) AS n, SUM(h.total) AS total, SUM(${BIAYA}) AS biaya, SUM(h.harga_produk) AS harga, SUM(h.isi_saldo_iklan) AS isi_saldo,
         SUM(${HPP_PESANAN}) AS hpp FROM shopee_penghasilan h WHERE ${f.W} GROUP BY 1 ORDER BY 1`),
    q(`SELECT h.toko_id, ${KOLOM} FROM shopee_penghasilan h WHERE ${f.W} GROUP BY h.toko_id`),
    q(`SELECT j.key AS kolom, SUM(j.value) AS jumlah, COUNT(*) AS n FROM shopee_penghasilan h, json_each(h.rincian) j WHERE ${f.W} GROUP BY 1`),
    // Per produk: penghasilan pesanan dibagi ke produknya menurut porsi harga (harga setelah diskon × qty) di file Pesanan
    q(`SELECT UPPER(TRIM(COALESCE(i.sku,''))) AS sku, MIN(i.nama) AS nama, SUM(i.qty) AS qty, COUNT(DISTINCT h.no_pesanan) AS pesanan,
         SUM(h.harga_produk*i.harga*i.qty*1.0/p.subtotal) AS harga, SUM(${BIAYA}*i.harga*i.qty*1.0/p.subtotal) AS biaya,
         SUM(h.total*i.harga*i.qty*1.0/p.subtotal) AS total, SUM(i.qty*s.hpp) AS hpp, MIN(s.id) AS sku_id, MIN(s.produk) AS sku_produk
       FROM shopee_penghasilan h JOIN shopee_pesanan p ON p.no_pesanan=h.no_pesanan JOIN shopee_pesanan_item i ON i.no_pesanan=h.no_pesanan
         LEFT JOIN sku_produk s ON s.sku=TRIM(i.sku) COLLATE NOCASE
       WHERE ${f.W} AND p.subtotal>0 GROUP BY 1 ORDER BY total DESC`),
    // Pesanan yang file Pesanan-nya belum di-upload: produk dari nama di file penghasilan
    q(`SELECT COALESCE(json_extract(h.produk,'$[0].nama'),'(tanpa nama)') AS nama, COUNT(*) AS pesanan, SUM(h.harga_produk) AS harga,
         SUM(${BIAYA}) AS biaya, SUM(h.total) AS total
       FROM shopee_penghasilan h WHERE ${f.W} AND NOT ${ADA_PESANAN} GROUP BY 1 ORDER BY total DESC`),
    db.prepare("SELECT t.id, t.nama, t.username, g.nama AS gudang FROM shopee_toko t LEFT JOIN gudang g ON g.id=t.gudang_id ORDER BY t.nama"),
    // Biaya iklan Shopee di rentang yang sama (tanggal iklan berjalan): hanya laporan yang seluruh periodenya di dalam rentang
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.dari>=?1 AND l.sampai<=?2 THEN (SELECT SUM(i.biaya) FROM shopee_iklan i WHERE i.laporan_id=l.id) END),0) AS biaya,
        SUM(l.dari>=?1 AND l.sampai<=?2) AS laporan, SUM(l.dari<?1 OR l.sampai>?2) AS terpotong
      FROM shopee_iklan_laporan l WHERE l.dari<=?2 AND l.sampai>=?1${f.toko ? " AND l.toko_id=?3" : ""}`).bind(f.from, f.to, ...(f.toko ? [f.toko] : [])),
    // Spend & omzet iklan per laporan (untuk bagan per kanal; laporan > 1 hari dibagi rata di browser)
    db.prepare(`SELECT l.dari, l.sampai, (SELECT SUM(i.biaya) FROM shopee_iklan i WHERE i.laporan_id=l.id) AS biaya,
        (SELECT SUM(i.omzet) FROM shopee_iklan i WHERE i.laporan_id=l.id) AS omzet
      FROM shopee_iklan_laporan l WHERE l.dari>=?1 AND l.sampai<=?2${f.toko ? " AND l.toko_id=?3" : ""}`).bind(f.from, f.to, ...(f.toko ? [f.toko] : [])),
    belum,
    corong,
    acuanTot,
    acuanRin,
    // Kanal affiliate: pesanan yang kena komisi AMS. Hanya pesanan yang dananya sudah dilepas (status affiliate baru diketahui dari penghasilan).
    q(`SELECT ${f.kol} AS tgl, COUNT(*) AS n, SUM(h.harga_produk) AS omzet, SUM(${AMS}) AS komisi, SUM(${HPP_PESANAN}) AS hpp,
         SUM(NOT ${ADA_PESANAN} OR ${SKU_KOSONG}) AS hpp_kurang
       FROM shopee_penghasilan h WHERE ${f.W} AND ${AMS}>0 GROUP BY 1 ORDER BY 1`),
    // Rasio pesanan valid (bukan batal / belum bayar) di rentang — omzet iklan atribusi Shopee masih termasuk pesanan batal
    db.prepare(`SELECT SUM(p.subtotal) AS semua, SUM(CASE WHEN p.status NOT IN ('batal','belum_bayar') THEN p.subtotal ELSE 0 END) AS valid
      FROM shopee_pesanan p WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2${f.toko ? " AND p.toko_id=?3" : ""}`).bind(f.from, f.to, ...tokoArg),
    // Laporan Live yang beririsan dengan rentang (dibagi rata per hari di browser; hanya hari di dalam rentang yang dihitung)
    db.prepare(`SELECT l.*, t.nama AS toko FROM shopee_live l JOIN shopee_toko t ON t.id=l.toko_id
      WHERE l.dari<=?2 AND l.sampai>=?1${f.toko ? " AND l.toko_id=?3" : ""} ORDER BY l.dari, t.nama`).bind(f.from, f.to, ...tokoArg),
    // Produk live + HPP per unit: rata-rata HPP Manajemen SKU dari pesanan toko yang sama (tidak batal) dengan nama produk sama,
    // 60 hari sebelum s/d akhir periode laporan. Nama dengan satu karakter rusak (�, mis. "—" di CSV non-UTF-8) dicocokkan per potongan
    // sebelum & sesudah karakter itu (pola LIKE sepanjang nama produk ditolak D1).
    db.prepare(`SELECT lp.*, (SELECT SUM(i.qty*s.hpp)*1.0/SUM(i.qty) FROM shopee_pesanan_item i JOIN shopee_pesanan p ON p.no_pesanan=i.no_pesanan
          JOIN sku_produk s ON s.sku=TRIM(i.sku) COLLATE NOCASE
          WHERE p.toko_id=l.toko_id AND p.status<>'batal' AND substr(p.dibuat,1,10) BETWEEN date(l.dari,'-60 days') AND l.sampai
            AND (i.nama=lp.produk OR (lp.rusak>0 AND length(i.nama)=length(lp.produk) AND substr(i.nama,1,lp.rusak-1)=substr(lp.produk,1,lp.rusak-1)
              AND substr(i.nama,lp.rusak+1)=substr(lp.produk,lp.rusak+1)))) AS hpp_unit
      FROM (SELECT *, instr(produk, char(65533)) AS rusak FROM shopee_live_produk) lp JOIN shopee_live l ON l.id=lp.live_id
      WHERE l.dari<=?2 AND l.sampai>=?1${f.toko ? " AND l.toko_id=?3" : ""} ORDER BY lp.live_id, lp.urut`).bind(f.from, f.to, ...tokoArg),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from: f.from, to: f.to, basis: iklanMode ? "iklan" : f.basis, dari_iklan: corongIklan.results[0] ?? null,
    acuan: pakaiAcuan ? { dari: acuanDari, sampai: f.to, total: acuanT.results[0] ?? {}, rincian: acuanR.results } : null, belum_dilepas: belumDilepas.results, total: tot.results[0] ?? {}, harian: harian.results, per_toko: perToko.results, rincian: rincian.results,
    per_sku: perSku.results, tanpa_pesanan: tanpa.results, toko: toko.results, iklan: iklan.results[0] ?? {}, iklan_laporan: iklanLap.results,
    afiliasi_harian: afiliasiHarian.results, pesanan_valid: pesananValid.results[0] ?? {}, live: live.results.map(l => ({ ...l, produk: liveProduk.results.filter(p => p.live_id === l.id) })) });
});

shopee.get("/penghasilan/daftar", async c => {
  const f = filterHasil(c);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const cari = (c.req.query("q") ?? "").trim(), offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const w = [f.W], args = [...f.args];
  if (cari) { w.push("(h.no_pesanan LIKE ? OR h.produk LIKE ?)"); args.push(`%${cari}%`, `%${cari}%`); }
  const W = w.join(" AND ");
  const [rows, total] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT h.no_pesanan, h.toko_id, t.nama AS toko, h.sumber, h.dibuat, h.dilepas, h.tipe_pesanan, h.harga_produk, h.refund, h.ongkir, h.voucher,
         h.biaya_platform, h.biaya_gox, h.biaya_layanan, h.biaya_promosi, h.biaya_lainnya, h.pajak, h.isi_saldo_iklan, h.total, h.metode_bayar, h.kurir,
         h.produk, ${HPP_PESANAN} AS hpp, ${ADA_PESANAN} AS ada_pesanan, ${SKU_KOSONG} AS sku_kosong,
         (SELECT json_group_array(json_object('sku', i.sku, 'nama', i.nama, 'variasi', i.variasi, 'qty', i.qty))
            FROM shopee_pesanan_item i WHERE i.no_pesanan=h.no_pesanan) AS items
       FROM shopee_penghasilan h JOIN shopee_toko t ON t.id=h.toko_id WHERE ${W} ORDER BY ${f.kol} DESC, h.no_pesanan LIMIT 100 OFFSET ?`).bind(...args, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM shopee_penghasilan h WHERE ${W}`).bind(...args),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ rows: rows.results.map(r => ({ ...r, produk: JSON.parse(r.produk || "[]"), items: JSON.parse(r.items || "[]") })),
    total: total.results[0]?.n ?? 0, offset });
});

// ---- Iklan: laporan "Semua Laporan Iklan CPC" per toko × periode (angka = total selama periode, bukan per hari)
type IklanIn = { nama?: string; status?: string; jenis?: string; kode_produk?: string; mode_bidding?: string; penempatan?: string; mulai?: string;
  dilihat?: number; klik?: number; keranjang?: number; konversi?: number; konversi_langsung?: number; terjual?: number; terjual_langsung?: number;
  omzet?: number; omzet_langsung?: number; biaya?: number };

/**
 * Buat laporan iklan { upload_id, dari, sampai }. Laporan lama toko itu yang periodenya ada di dalam periode baru diganti;
 * laporan yang hanya beririsan / lebih panjang ditolak (supaya biaya tidak terhitung dua kali) — hapus dulu dari daftar laporan.
 */
shopee.post("/iklan/laporan", async c => {
  const b = await c.req.json<{ upload_id?: number; dari?: string; sampai?: string }>();
  const db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM shopee_upload WHERE id=? AND jenis='iklan'").bind(Number(b.upload_id)).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const dari = String(b.dari ?? ""), sampai = String(b.sampai ?? "");
  if (!TGL.test(dari) || !TGL.test(sampai) || dari > sampai) return c.json({ error: "periode laporan tidak terbaca (baris Periode di file)" }, 400);
  const irisan = await db.prepare("SELECT id, dari, sampai FROM shopee_iklan_laporan WHERE toko_id=? AND dari<=? AND sampai>=?")
    .bind(up.toko_id, sampai, dari).all<{ id: number; dari: string; sampai: string }>();
  const api = await db.prepare("SELECT COUNT(*) AS n FROM shopee_iklan_laporan WHERE toko_id=? AND sumber='api' AND dari<=? AND sampai>=?")
    .bind(up.toko_id, sampai, dari).first<{ n: number }>();
  if (api?.n) return c.json({ error: `toko ini sudah punya data iklan dari API untuk ${api.n} hari di periode ini — data API diutamakan, upload file tidak diperlukan.` }, 409);
  const bentrok = irisan.results.filter(r => r.dari < dari || r.sampai > sampai);
  if (bentrok.length) return c.json({ error: "periode ini beririsan dengan laporan iklan yang sudah ada: " +
    bentrok.map(r => r.dari === r.sampai ? r.dari : `${r.dari} s/d ${r.sampai}`).join(", ") +
    " — hapus laporan itu dulu di Shopee › Iklan (tab Laporan ter-upload), atau upload periode yang mencakup seluruhnya." }, 409);
  const ganti = irisan.results.map(r => r.id);
  const stmts = [
    ...(ganti.length ? [db.prepare("DELETE FROM shopee_iklan_laporan WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ganti))] : []),
    db.prepare("INSERT INTO shopee_iklan_laporan (toko_id, dari, sampai, upload_id, created_at) VALUES (?,?,?,?,?)")
      .bind(up.toko_id, dari, sampai, up.id, new Date().toISOString()),
    db.prepare("UPDATE shopee_upload SET dari=?, sampai=? WHERE id=?").bind(dari, sampai, up.id),
  ];
  const res = await db.batch(stmts);
  return c.json({ ok: true, id: res[ganti.length ? 1 : 0].meta.last_row_id, diganti: ganti.length });
});

/** Baris iklan laporan (≤ 100 per permintaan): { awal, rows } — awal = nomor urut baris pertama */
shopee.post("/iklan/laporan/:id/baris", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const lap = await db.prepare("SELECT id, upload_id FROM shopee_iklan_laporan WHERE id=?").bind(id).first<{ id: number; upload_id: number | null }>();
  if (!lap) return c.json({ error: "laporan tidak ditemukan" }, 404);
  const { awal, rows } = await c.req.json<{ awal?: number; rows?: IklanIn[] }>();
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) return c.json({ error: "kirim 1–100 baris per permintaan" }, 400);
  const teks = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s && s !== "-" ? s.slice(0, n) : null; };
  const angka = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const stmts: D1PreparedStatement[] = [];
  rows.forEach((r, i) => {
    const nama = teks(r.nama);
    if (!nama) return;
    stmts.push(db.prepare(
      `INSERT OR REPLACE INTO shopee_iklan (laporan_id, urut, nama, status, jenis, kode_produk, mode_bidding, penempatan, mulai, dilihat, klik, keranjang,
         konversi, konversi_langsung, terjual, terjual_langsung, omzet, omzet_langsung, biaya) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, (Number(awal) || 0) + i, nama, teks(r.status, 60), teks(r.jenis, 60), teks(r.kode_produk, 60), teks(r.mode_bidding, 80), teks(r.penempatan, 80),
        TGL.test(String(r.mulai ?? "")) ? r.mulai! : null, angka(r.dilihat), angka(r.klik), angka(r.keranjang), angka(r.konversi), angka(r.konversi_langsung),
        angka(r.terjual), angka(r.terjual_langsung), angka(r.omzet), angka(r.omzet_langsung), angka(r.biaya)));
  });
  const n = stmts.length;
  if (lap.upload_id) stmts.push(db.prepare("UPDATE shopee_upload SET pesanan=pesanan+?, baru=baru+? WHERE id=?").bind(n, n, lap.upload_id));
  if (stmts.length) await db.batch(stmts);
  return c.json({ ok: true, disimpan: n, baru: n, diperbarui: 0, pindah: 0 });
});

shopee.delete("/iklan/laporan/:id", async c => {
  await c.env.DB.prepare("DELETE FROM shopee_iklan_laporan WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// ---- Live: file ekspor Shopee Live (overview) = total satu toko × satu periode. Aturan periode sama dengan laporan iklan:
// laporan lama toko itu yang ada di dalam periode baru diganti (spending manualnya dibawa bila periodenya sama persis), yang beririsan sebagian ditolak.
const LIVE_ANGKA = ["omzet", "pesanan", "omzet_dibuat", "pesanan_dibuat", "produk_terjual", "omzet_baru", "sesi", "durasi_detik", "penonton", "dilihat", "klik_produk", "keranjang"] as const;
shopee.post("/live/laporan", async c => {
  const b = await c.req.json<{ upload_id?: number; dari?: string; sampai?: string; user_id?: string } & Partial<Record<(typeof LIVE_ANGKA)[number], number>>>();
  const db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM shopee_upload WHERE id=? AND jenis='live'").bind(Number(b.upload_id)).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const dari = String(b.dari ?? ""), sampai = String(b.sampai ?? "");
  if (!TGL.test(dari) || !TGL.test(sampai) || dari > sampai) return c.json({ error: "periode laporan live tidak terbaca (kolom Periode Data)" }, 400);
  const irisan = await db.prepare("SELECT id, dari, sampai FROM shopee_live WHERE toko_id=? AND dari<=? AND sampai>=?")
    .bind(up.toko_id, sampai, dari).all<{ id: number; dari: string; sampai: string }>();
  const bentrok = irisan.results.filter(r => r.dari < dari || r.sampai > sampai);
  if (bentrok.length) return c.json({ error: "periode ini beririsan dengan laporan live yang sudah ada: " +
    bentrok.map(r => r.dari === r.sampai ? r.dari : `${r.dari} s/d ${r.sampai}`).join(", ") +
    " — hapus laporan itu dulu (Penghasilan Shopee › kanal Live), atau upload periode yang mencakup seluruhnya." }, 409);
  // Periode sama persis → diperbarui di tempat (spending manual & rincian produk tetap); laporan lebih pendek di dalamnya diganti
  const sama = irisan.results.find(r => r.dari === dari && r.sampai === sampai);
  const ganti = irisan.results.filter(r => r !== sama).map(r => r.id);
  const angka = (v: unknown) => Math.max(0, Math.round(Number(v) || 0)), now = new Date().toISOString();
  const uid = String(b.user_id ?? "").trim().slice(0, 40) || null, nilai = LIVE_ANGKA.map(k => angka(b[k]));
  const simpan = sama
    ? db.prepare(`UPDATE shopee_live SET upload_id=?, user_id=COALESCE(?, user_id), ${LIVE_ANGKA.map(k => `${k}=?`).join(", ")}, updated_at=? WHERE id=?`)
        .bind(up.id, uid, ...nilai, now, sama.id)
    : db.prepare(`INSERT INTO shopee_live (toko_id, dari, sampai, upload_id, user_id, ${LIVE_ANGKA.join(", ")}, created_at, updated_at)
        VALUES (?,?,?,?,?,${LIVE_ANGKA.map(() => "?").join(",")},?,?)`).bind(up.toko_id, dari, sampai, up.id, uid, ...nilai, now, now);
  const res = await db.batch([
    db.prepare("DELETE FROM shopee_live WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ganti)),
    simpan,
    db.prepare("UPDATE shopee_upload SET dari=?, sampai=?, pesanan=?, baru=? WHERE id=?").bind(dari, sampai, angka(b.pesanan), sama ? 0 : angka(b.pesanan), up.id),
  ]);
  return c.json({ ok: true, id: sama?.id ?? res[1].meta.last_row_id, diganti: ganti.length, diperbarui: !!sama });
});

/** Rincian produk live (ekspor daftar produk live): menempel ke laporan Live toko & periode yang sama; isi lama diganti. */
type LiveProdukIn = { urut?: number; produk?: string; klik?: number; keranjang?: number; pesanan?: number; terjual?: number; omzet?: number; omzet_dibuat?: number };
shopee.post("/live/produk", async c => {
  const b = await c.req.json<{ upload_id?: number; dari?: string; sampai?: string; user_id?: string; rows?: LiveProdukIn[] }>();
  const db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM shopee_upload WHERE id=? AND jenis='live_produk'").bind(Number(b.upload_id)).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return c.json({ error: "kirim 1–500 produk" }, 400);
  const lap = await db.prepare("SELECT id FROM shopee_live WHERE toko_id=? AND dari=? AND sampai=?").bind(up.toko_id, String(b.dari ?? ""), String(b.sampai ?? "")).first<{ id: number }>();
  if (!lap) return c.json({ error: `belum ada laporan Live (overview) toko ini untuk periode ${b.dari} s/d ${b.sampai} — upload file overview Live periode yang sama dulu, lalu upload file produk ini.` }, 409);
  const angka = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const rows = b.rows.filter(r => String(r.produk ?? "").trim());
  const uid = String(b.user_id ?? "").trim().slice(0, 40) || null;
  await db.batch([
    db.prepare("DELETE FROM shopee_live_produk WHERE live_id=?").bind(lap.id),
    ...rows.map((r, i) => db.prepare(
      "INSERT OR REPLACE INTO shopee_live_produk (live_id, urut, produk, klik, keranjang, pesanan, terjual, omzet, omzet_dibuat) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(lap.id, angka(r.urut) || i + 1, String(r.produk).trim().slice(0, 300), angka(r.klik), angka(r.keranjang), angka(r.pesanan), angka(r.terjual), angka(r.omzet), angka(r.omzet_dibuat))),
    db.prepare("UPDATE shopee_live SET user_id=COALESCE(user_id, ?), updated_at=? WHERE id=?").bind(uid, new Date().toISOString(), lap.id),
    db.prepare("UPDATE shopee_upload SET dari=?, sampai=?, pesanan=?, baru=? WHERE id=?").bind(b.dari, b.sampai, rows.length, rows.length, up.id),
  ]);
  return c.json({ ok: true, live_id: lap.id, produk: rows.length });
});

/** Toko dari User Id file Live (laporan Live sebelumnya) */
shopee.get("/live/toko", async c => {
  const r = await c.env.DB.prepare("SELECT toko_id FROM shopee_live WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(c.req.query("user_id") ?? "").first<{ toko_id: number }>();
  return c.json({ toko_id: r?.toko_id ?? null });
});

/** Biaya live diisi manual: { spending, ket? } */
shopee.put("/live/:id", async c => {
  const b = await c.req.json<{ spending?: number; ket?: string }>();
  const spending = Math.round(Number(b.spending));
  if (!Number.isFinite(spending) || spending < 0) return c.json({ error: "spending harus angka ≥ 0" }, 400);
  await c.env.DB.prepare("UPDATE shopee_live SET spending=?, spending_ket=?, updated_at=? WHERE id=?")
    .bind(spending, String(b.ket ?? "").trim().slice(0, 200) || null, new Date().toISOString(), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

shopee.delete("/live/:id", async c => {
  await c.env.DB.prepare("DELETE FROM shopee_live WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/**
 * Ringkasan iklan untuk rentang tanggal: hanya laporan yang periodenya seluruhnya di dalam rentang (laporan yang terpotong rentang
 * ditandai `terpotong` dan tidak dihitung). Pembanding TACOS: omzet pesanan Shopee (bukan batal) yang dibuat di rentang & toko yang sama.
 */
shopee.get("/iklan", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null;
  if (!TGL.test(from) || !TGL.test(to)) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, wT = toko ? " AND l.toko_id=?" : "", aT = toko ? [toko] : [];
  const W = `l.dari>=? AND l.sampai<=?${wT}`, args = [from, to, ...aT];
  const SUM = `SUM(i.dilihat) AS dilihat, SUM(i.klik) AS klik, SUM(i.keranjang) AS keranjang, SUM(i.konversi) AS konversi, SUM(i.konversi_langsung) AS konversi_langsung,
    SUM(i.terjual) AS terjual, SUM(i.omzet) AS omzet, SUM(i.omzet_langsung) AS omzet_langsung, SUM(i.biaya) AS biaya`;
  const [laporan, perIklan, perToko, total, omzetToko, tokoList] = await db.batch([
    db.prepare(`SELECT l.id, l.toko_id, t.nama AS toko, l.dari, l.sampai, l.created_at, l.sumber, (l.dari<? OR l.sampai>?) AS terpotong,
        COUNT(i.urut) AS iklan, SUM(i.biaya) AS biaya, SUM(i.omzet) AS omzet
      FROM shopee_iklan_laporan l JOIN shopee_toko t ON t.id=l.toko_id LEFT JOIN shopee_iklan i ON i.laporan_id=l.id
      WHERE l.dari<=? AND l.sampai>=?${wT} GROUP BY l.id ORDER BY l.dari DESC, t.nama`).bind(from, to, to, from, ...aT),
    db.prepare(`SELECT l.toko_id, t.nama AS toko, i.nama, i.jenis, i.mode_bidding, i.penempatan, MAX(i.kode_produk) AS kode_produk,
        MAX(l.sampai || '|' || COALESCE(i.status,'')) AS status_akhir, COUNT(DISTINCT l.id) AS laporan, ${SUM}
      FROM shopee_iklan i JOIN shopee_iklan_laporan l ON l.id=i.laporan_id JOIN shopee_toko t ON t.id=l.toko_id
      WHERE ${W} GROUP BY l.toko_id, i.nama, COALESCE(i.jenis,''), COALESCE(i.mode_bidding,''), COALESCE(i.penempatan,'') ORDER BY biaya DESC`).bind(...args),
    db.prepare(`SELECT l.toko_id, t.nama AS toko, COUNT(DISTINCT l.id) AS laporan, ${SUM}
      FROM shopee_iklan i JOIN shopee_iklan_laporan l ON l.id=i.laporan_id JOIN shopee_toko t ON t.id=l.toko_id WHERE ${W} GROUP BY l.toko_id ORDER BY biaya DESC`).bind(...args),
    db.prepare(`SELECT COUNT(DISTINCT l.id) AS laporan, ${SUM} FROM shopee_iklan i JOIN shopee_iklan_laporan l ON l.id=i.laporan_id WHERE ${W}`).bind(...args),
    db.prepare(`SELECT p.toko_id, COUNT(*) AS pesanan, SUM(p.subtotal) AS omzet FROM shopee_pesanan p
      WHERE substr(p.dibuat,1,10) BETWEEN ? AND ? AND p.status<>'batal'${toko ? " AND p.toko_id=?" : ""} GROUP BY p.toko_id`).bind(from, to, ...aT),
    db.prepare("SELECT id, nama, username FROM shopee_toko ORDER BY nama"),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from, to, total: total.results[0] ?? {}, laporan: laporan.results, per_iklan: perIklan.results.map(r => {
      const { status_akhir, ...x } = r; return { ...x, status: String(status_akhir ?? "").split("|")[1] || null }; }),
    per_toko: perToko.results, omzet_toko: omzetToko.results, toko: tokoList.results });
});
