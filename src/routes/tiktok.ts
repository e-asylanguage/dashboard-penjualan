import { Hono } from "hono";
import { Env } from "../env";
import { COOKIE_SESI, bacaCookie, cekSesi, userDashboard } from "../lib/sesi";
import { TiktokApi } from "../lib/tiktok-api";

/**
 * TikTok Shop (termasuk pesanan channel Tokopedia) — dua sumber ke tabel yang sama, kunci Order ID:
 *  - upload file ekspor Seller Center (di-parse di browser, dikirim per potongan ≤ 100), sumber 'file';
 *  - sinkron TikTok Shop Open API (tombol & cron tiap jam), sumber 'api'.
 * Keduanya memakai simpanPesanan / simpanPenghasilan, jadi bentuk datanya sama.
 */
export const tiktok = new Hono<{ Bindings: Env }>();

const TGL = /^\d{4}-\d{2}-\d{2}$/;
const oleh = async (c: { env: Env; req: { header: (k: string) => string | undefined } }) =>
  (await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI))) ?? userDashboard(c.env);
const teks = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s && s !== "-" && s !== "/" ? s.slice(0, n) : null; };
const angka = (v: unknown) => Math.round(Number(v) || 0);
const waktu = (v: unknown) => { const s = teks(v, 19); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null; };
const tgl = (v: unknown) => { const s = String(v ?? "").trim().slice(0, 10); return TGL.test(s) ? s : null; };
/** Unix detik → waktu WIB "YYYY-MM-DD HH:MM:SS" */
const wib = (t: unknown) => Number(t) > 0 ? new Date((Number(t) + 7 * 3600) * 1000).toISOString().slice(0, 19).replace("T", " ") : null;

/**
 * Status TikTok → status ringkas. Menerima status API (UNPAID, AWAITING_SHIPMENT, IN_TRANSIT, DELIVERED, COMPLETED,
 * CANCELLED, …) maupun teks file ekspor (Belum dibayar, Akan dikirim, Dikirim/Terkirim, Selesai, Dibatalkan).
 */
export function statusTiktok(asli: string, sub: string, tipe: string, qtyRetur: number): string {
  const s = asli.trim().toLowerCase(), d = sub.trim().toLowerCase(), t = tipe.trim().toLowerCase();
  if (qtyRetur > 0 || /return|refund|pengembalian/.test(t)) return "retur";
  if (/cancel|batal/.test(s)) return "batal";
  if (/^unpaid|belum (di)?bayar/.test(s)) return "belum_bayar";
  if (/on_hold|awaiting_shipment|partially_shipping|awaiting_collection|akan dikirim|perlu dikirim|menunggu|siap dikirim|diproses/.test(s)) return "perlu_dikirim";
  if (s === "delivered" || (s === "dikirim" && /terkirim|delivered/.test(d))) return "terkirim";
  if (s === "in_transit" || s === "dikirim" || s === "shipped") return "dikirim";
  if (s === "completed" || s === "selesai") return "selesai";
  return "lain";
}
const GRUP = `CASE WHEN p.status IN ('terkirim','selesai') THEN 'terkirim' ELSE p.status END`;
const LAKU = "p.status NOT IN ('batal','belum_bayar')";

export type ItemIn = { sku_id?: string; sku?: string; nama?: string; variasi?: string; harga_awal?: number; subtotal?: number; qty?: number; qty_retur?: number };
export type PesananIn = { order_id?: string; status_asli?: string; substatus?: string; tipe_batal?: string; alasan_batal?: string; resi?: string; kurir?: string;
  opsi_kirim?: string; dibuat?: string; dibayar?: string; dikirim?: string; terkirim?: string; dibatalkan?: string; metode_bayar?: string; cod?: number;
  diskon_penjual?: number; diskon_platform?: number; ongkir_pembeli?: number; total?: number; kota?: string; provinsi?: string; channel?: string;
  fbt?: boolean; items?: ItemIn[] };
export type PenghasilanIn = { id?: string; jenis?: string; order_id?: string; dibuat?: string; dilepas?: string; total?: number; pendapatan?: number;
  subtotal?: number; diskon_penjual?: number; refund?: number; biaya_total?: number; biaya_platform?: number; biaya_ongkir?: number; biaya_afiliasi?: number;
  pajak?: number; penyesuaian?: number; dibayar_pembeli?: number; rincian?: Record<string, number> };

/** Simpan / perbarui pesanan (upsert per Order ID; item diganti). Mengembalikan jumlah disimpan & baru. */
export async function simpanPesanan(db: D1Database, toko: { id: number; gudang_id: number | null }, pesanan: PesananIn[], sumber: "file" | "api", uploadId: number | null) {
  const valid = pesanan.filter(p => teks(p.order_id, 40) && waktu(p.dibuat));
  const ada = await db.prepare("SELECT order_id FROM tiktok_pesanan WHERE order_id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(valid.map(p => teks(p.order_id, 40)))).all<{ order_id: string }>();
  const lama = new Set(ada.results.map(r => r.order_id)), now = new Date().toISOString(), stmts: D1PreparedStatement[] = [];
  for (const p of valid) {
    const id = teks(p.order_id, 40)!, items = (Array.isArray(p.items) ? p.items : []).slice(0, 60);
    const pcs = items.reduce((a, i) => a + (angka(i.qty) || 1), 0), pcsRetur = items.reduce((a, i) => a + angka(i.qty_retur), 0);
    const subtotal = items.reduce((a, i) => a + angka(i.subtotal), 0), awal = items.reduce((a, i) => a + angka(i.harga_awal) * (angka(i.qty) || 1), 0);
    const metode = teks(p.metode_bayar, 60);
    stmts.push(db.prepare(
      `INSERT INTO tiktok_pesanan (order_id, toko_id, gudang_id, status, status_asli, substatus, tipe_batal, alasan_batal, resi, kurir, opsi_kirim,
         dibuat, dibayar, dikirim, terkirim, dibatalkan, metode_bayar, cod, subtotal_awal, diskon_penjual, diskon_platform, subtotal, ongkir_pembeli, total,
         pcs, pcs_retur, kota, provinsi, channel, sumber, upload_id, created_at, updated_at, fbt)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?32,?33)
       ON CONFLICT(order_id) DO UPDATE SET toko_id=excluded.toko_id, status=excluded.status, status_asli=excluded.status_asli, substatus=excluded.substatus,
         tipe_batal=excluded.tipe_batal, alasan_batal=excluded.alasan_batal, resi=COALESCE(excluded.resi, tiktok_pesanan.resi), kurir=COALESCE(excluded.kurir, tiktok_pesanan.kurir),
         opsi_kirim=COALESCE(excluded.opsi_kirim, tiktok_pesanan.opsi_kirim), dibayar=COALESCE(excluded.dibayar, tiktok_pesanan.dibayar),
         dikirim=COALESCE(excluded.dikirim, tiktok_pesanan.dikirim), terkirim=COALESCE(excluded.terkirim, tiktok_pesanan.terkirim),
         dibatalkan=COALESCE(excluded.dibatalkan, tiktok_pesanan.dibatalkan), metode_bayar=COALESCE(excluded.metode_bayar, tiktok_pesanan.metode_bayar),
         cod=excluded.cod, subtotal_awal=excluded.subtotal_awal, diskon_penjual=excluded.diskon_penjual, diskon_platform=excluded.diskon_platform,
         subtotal=excluded.subtotal, ongkir_pembeli=excluded.ongkir_pembeli, total=excluded.total, pcs=excluded.pcs, pcs_retur=excluded.pcs_retur,
         kota=COALESCE(excluded.kota, tiktok_pesanan.kota), provinsi=COALESCE(excluded.provinsi, tiktok_pesanan.provinsi),
         channel=COALESCE(excluded.channel, tiktok_pesanan.channel), sumber=excluded.sumber, upload_id=excluded.upload_id, updated_at=excluded.updated_at,
         fbt=COALESCE(excluded.fbt, tiktok_pesanan.fbt)`)
      .bind(id, toko.id, toko.gudang_id, statusTiktok(String(p.status_asli ?? ""), String(p.substatus ?? ""), String(p.tipe_batal ?? ""), pcsRetur),
        teks(p.status_asli, 60), teks(p.substatus, 60), teks(p.tipe_batal, 60), teks(p.alasan_batal), teks(p.resi, 60), teks(p.kurir, 100), teks(p.opsi_kirim, 100),
        waktu(p.dibuat), waktu(p.dibayar), waktu(p.dikirim), waktu(p.terkirim), waktu(p.dibatalkan), metode,
        p.cod != null ? (p.cod ? 1 : 0) : metode && /cod|bayar di tempat/i.test(metode) ? 1 : 0,
        awal, angka(p.diskon_penjual), angka(p.diskon_platform), subtotal, angka(p.ongkir_pembeli), angka(p.total), pcs, pcsRetur,
        teks(p.kota, 100), teks(p.provinsi, 100), teks(p.channel, 30), sumber, uploadId, now, p.fbt == null ? null : p.fbt ? 1 : 0));
    stmts.push(db.prepare("DELETE FROM tiktok_pesanan_item WHERE order_id=?").bind(id));
    items.forEach((i, k) => stmts.push(db.prepare(
      "INSERT INTO tiktok_pesanan_item (order_id, urut, sku_id, sku, nama, variasi, harga_awal, subtotal, qty, qty_retur) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, k, teks(i.sku_id, 40), teks(i.sku, 80), teks(i.nama, 300), teks(i.variasi, 200), angka(i.harga_awal), angka(i.subtotal), angka(i.qty) || 1, angka(i.qty_retur))));
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  const baru = valid.filter(p => !lama.has(teks(p.order_id, 40)!)).length;
  return { disimpan: valid.length, baru, dilewati: pesanan.length - valid.length };
}

/** Simpan / perbarui penghasilan (upsert per ID pesanan/penyesuaian) */
export async function simpanPenghasilan(db: D1Database, tokoId: number, rows: PenghasilanIn[], sumber: "file" | "api", uploadId: number | null) {
  const valid = rows.filter(r => teks(r.id, 40) && tgl(r.dilepas));
  const ada = await db.prepare("SELECT id FROM tiktok_penghasilan WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(valid.map(r => teks(r.id, 40)))).all<{ id: string }>();
  const lama = new Set(ada.results.map(r => r.id)), now = new Date().toISOString();
  const rincian = (r: Record<string, number> | undefined) => {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(r ?? {}).slice(0, 120)) if (Number(v)) o[String(k).slice(0, 120)] = angka(v);
    return JSON.stringify(o);
  };
  const stmts = valid.map(r => db.prepare(
    `INSERT INTO tiktok_penghasilan (id, toko_id, jenis, order_id, dibuat, dilepas, total, pendapatan, subtotal, diskon_penjual, refund, biaya_total,
       biaya_platform, biaya_ongkir, biaya_afiliasi, pajak, penyesuaian, dibayar_pembeli, sumber, rincian, upload_id, created_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?22)
     ON CONFLICT(id) DO UPDATE SET toko_id=excluded.toko_id, jenis=excluded.jenis, order_id=excluded.order_id, dibuat=COALESCE(excluded.dibuat, tiktok_penghasilan.dibuat),
       dilepas=excluded.dilepas, total=excluded.total, pendapatan=excluded.pendapatan, subtotal=excluded.subtotal, diskon_penjual=excluded.diskon_penjual,
       refund=excluded.refund, biaya_total=excluded.biaya_total, biaya_platform=excluded.biaya_platform, biaya_ongkir=excluded.biaya_ongkir,
       biaya_afiliasi=excluded.biaya_afiliasi, pajak=excluded.pajak, penyesuaian=excluded.penyesuaian, dibayar_pembeli=excluded.dibayar_pembeli,
       sumber=excluded.sumber, rincian=excluded.rincian, upload_id=excluded.upload_id, updated_at=excluded.updated_at`)
    .bind(teks(r.id, 40), tokoId, teks(r.jenis, 60), teks(r.order_id, 40) ?? teks(r.id, 40), tgl(r.dibuat), tgl(r.dilepas), angka(r.total), angka(r.pendapatan),
      angka(r.subtotal), angka(r.diskon_penjual), angka(r.refund), angka(r.biaya_total), angka(r.biaya_platform), angka(r.biaya_ongkir), angka(r.biaya_afiliasi),
      angka(r.pajak), angka(r.penyesuaian), angka(r.dibayar_pembeli), sumber, rincian(r.rincian), uploadId, now));
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { disimpan: valid.length, baru: valid.filter(r => !lama.has(teks(r.id, 40)!)).length, dilewati: rows.length - valid.length };
}

// ---- Toko: toko dari koneksi API otomatis ditambahkan; gudang diatur per toko
async function sinkronToko(db: D1Database) {
  const akun = await db.prepare("SELECT toko_json FROM tiktok_api_akun").all<{ toko_json: string | null }>().catch(() => ({ results: [] as { toko_json: string | null }[] }));
  const now = new Date().toISOString(), stmts: D1PreparedStatement[] = [];
  for (const a of akun.results) for (const t of JSON.parse(a.toko_json ?? "[]") as { id: string; name: string }[])
    stmts.push(db.prepare("INSERT INTO tiktok_toko (shop_id, nama, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(shop_id) DO NOTHING").bind(t.id, t.name, now, now));
  if (stmts.length) await db.batch(stmts);
}

tiktok.get("/toko", async c => {
  const db = c.env.DB;
  await sinkronToko(db);
  const [toko, gudang] = await db.batch([
    db.prepare(`SELECT t.id, t.shop_id, t.nama, t.gudang_id, g.nama AS gudang, t.mode,
        (SELECT a.nama FROM tiktok_api_akun a, json_each(COALESCE(a.toko_json,'[]')) j WHERE json_extract(j.value,'$.id')=t.shop_id LIMIT 1) AS api_akun,
        (SELECT a.updated_at FROM tiktok_api_akun a, json_each(COALESCE(a.toko_json,'[]')) j WHERE json_extract(j.value,'$.id')=t.shop_id LIMIT 1) AS api_sejak,
        (SELECT COUNT(*) FROM tiktok_pesanan p WHERE p.toko_id=t.id) AS pesanan, (SELECT MAX(dibuat) FROM tiktok_pesanan p WHERE p.toko_id=t.id) AS pesanan_terakhir,
        (SELECT MAX(created_at) FROM tiktok_upload u WHERE u.toko_id=t.id) AS upload_terakhir,
        t.gudang_platform_id, (SELECT COUNT(*) FROM tiktok_pesanan p WHERE p.toko_id=t.id AND p.fbt=1) AS pesanan_platform
      FROM tiktok_toko t LEFT JOIN gudang g ON g.id=t.gudang_id ORDER BY t.nama`),
    db.prepare("SELECT id, nama, jenis FROM gudang ORDER BY nama"),
  ]);
  return c.json({ toko: toko.results, gudang: gudang.results });
});

/** Gudang FBT toko (stok di gudang TikTok, untuk pesanan Fulfilled by TikTok): { gudang_id | null } */
tiktok.put("/toko/:id/gudang-platform", async c => {
  const { gudang_id } = await c.req.json<{ gudang_id?: number | null }>();
  await c.env.DB.prepare("UPDATE tiktok_toko SET gudang_platform_id=?, updated_at=? WHERE id=?")
    .bind(gudang_id ? Number(gudang_id) : null, new Date().toISOString(), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** Tambah / ubah toko: { id?, nama, gudang_id?, mode? (api | upload), shop_id? } — mode/shop_id tidak dikirim = tetap */
tiktok.put("/toko", async c => {
  const b = await c.req.json<{ id?: number; nama?: string; gudang_id?: number | null; mode?: string; shop_id?: string }>();
  const nama = String(b.nama ?? "").trim(), gudang = b.gudang_id ? Number(b.gudang_id) : null, now = new Date().toISOString();
  const mode = b.mode === "api" || b.mode === "upload" ? b.mode : null, shop = b.shop_id === undefined ? undefined : String(b.shop_id ?? "").trim() || null;
  if (!nama) return c.json({ error: "nama toko wajib diisi" }, 400);
  try {
    if (b.id) {
      await c.env.DB.prepare(`UPDATE tiktok_toko SET nama=?, gudang_id=?, mode=COALESCE(?, mode), ${shop === undefined ? "" : "shop_id=?, "}updated_at=? WHERE id=?`)
        .bind(...[nama, gudang, mode, ...(shop === undefined ? [] : [shop]), now, b.id]).run();
      return c.json({ ok: true, id: b.id });
    }
    const r = await c.env.DB.prepare("INSERT INTO tiktok_toko (nama, gudang_id, mode, shop_id, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .bind(nama, gudang, mode ?? "upload", shop ?? null, now, now).run();
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "Shop ID itu sudah dipakai toko TikTok lain" }, 400);
    throw e;
  }
});
tiktok.delete("/toko/:id", async c => {
  const id = Number(c.req.param("id"));
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tiktok_pesanan WHERE toko_id=?").bind(id).first<{ n: number }>();
  if (n?.n) return c.json({ error: `toko ini sudah punya ${n.n} pesanan — tidak bisa dihapus` }, 400);
  await c.env.DB.prepare("DELETE FROM tiktok_toko WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});

// ---- Upload file: buat catatan upload, kirim data per potongan, lalu tandai selesai (Log History)
tiktok.post("/upload", async c => {
  const b = await c.req.json<{ toko_id?: number; jenis?: string; nama_file?: string; baris?: number; dari?: string; sampai?: string; ringkasan?: string }>();
  const toko = await c.env.DB.prepare("SELECT id FROM tiktok_toko WHERE id=?").bind(Number(b.toko_id)).first();
  if (!toko) return c.json({ error: "toko tidak ditemukan" }, 400);
  if (!["pesanan", "penghasilan", "iklan", "live"].includes(b.jenis ?? "")) return c.json({ error: "jenis file tidak dikenal" }, 400);
  const r = await c.env.DB.prepare(
    "INSERT INTO tiktok_upload (toko_id, jenis, sumber, nama_file, dari, sampai, baris, ringkasan, status, oleh, created_at) VALUES (?,?,'file',?,?,?,?,?,'proses',?,?)")
    .bind(b.toko_id, b.jenis, String(b.nama_file ?? "").slice(0, 200), TGL.test(b.dari ?? "") ? b.dari : null, TGL.test(b.sampai ?? "") ? b.sampai : null,
      Number(b.baris) || 0, String(b.ringkasan ?? "").slice(0, 400) || null, await oleh(c), new Date().toISOString()).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
tiktok.post("/upload/:id/selesai", async c => {
  const b = await c.req.json<{ status?: string; catatan?: string }>();
  if (!["terbaca", "perlu_cek", "gagal"].includes(b.status ?? "")) return c.json({ error: "status tidak dikenal" }, 400);
  await c.env.DB.prepare("UPDATE tiktok_upload SET status=?, catatan=? WHERE id=?").bind(b.status, String(b.catatan ?? "").slice(0, 400) || null, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
tiktok.post("/upload/:id/pesanan", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT u.id, u.toko_id, t.gudang_id FROM tiktok_upload u JOIN tiktok_toko t ON t.id=u.toko_id WHERE u.id=? AND u.jenis='pesanan'")
    .bind(id).first<{ id: number; toko_id: number; gudang_id: number | null }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { pesanan } = await c.req.json<{ pesanan?: PesananIn[] }>();
  if (!Array.isArray(pesanan) || !pesanan.length || pesanan.length > 100) return c.json({ error: "kirim 1–100 pesanan per permintaan" }, 400);
  const h = await simpanPesanan(db, { id: up.toko_id, gudang_id: up.gudang_id }, pesanan, "file", up.id);
  await db.prepare("UPDATE tiktok_upload SET pesanan=pesanan+?, baru=baru+? WHERE id=?").bind(h.disimpan, h.baru, id).run();
  return c.json({ ok: true, ...h, diperbarui: h.disimpan - h.baru });
});
tiktok.post("/upload/:id/penghasilan", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM tiktok_upload WHERE id=? AND jenis='penghasilan'").bind(id).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { rows } = await c.req.json<{ rows?: PenghasilanIn[] }>();
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) return c.json({ error: "kirim 1–100 baris per permintaan" }, 400);
  const h = await simpanPenghasilan(db, up.toko_id, rows, "file", up.id);
  await db.prepare("UPDATE tiktok_upload SET pesanan=pesanan+?, baru=baru+? WHERE id=?").bind(h.disimpan, h.baru, id).run();
  return c.json({ ok: true, ...h, diperbarui: h.disimpan - h.baru });
});
/**
 * Baris iklan satu file (semua sekaligus, ≤ 3000): [{tgl, jam (0–23 | -1), biaya, pesanan, omzet}].
 * Tanggal yang ada di file menggantikan data iklan toko itu pada tanggal tersebut.
 */
tiktok.post("/upload/:id/iklan", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM tiktok_upload WHERE id=? AND jenis='iklan'").bind(id).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { rows } = await c.req.json<{ rows?: { tgl?: string; jam?: number; biaya?: number; pesanan?: number; omzet?: number }[] }>();
  if (!Array.isArray(rows) || !rows.length || rows.length > 3000) return c.json({ error: "kirim 1–3000 baris" }, 400);
  const ok = rows.filter(r => TGL.test(String(r.tgl ?? ""))).map(r => ({ tgl: r.tgl!, jam: Number.isInteger(r.jam) && r.jam! >= 0 && r.jam! <= 23 ? r.jam! : -1,
    biaya: Math.max(0, angka(r.biaya)), pesanan: Math.max(0, angka(r.pesanan)), omzet: Math.max(0, angka(r.omzet)) }));
  const tglList = [...new Set(ok.map(r => r.tgl))], kini = new Date().toISOString();
  const stmts = [db.prepare("DELETE FROM tiktok_iklan WHERE toko_id=? AND tgl IN (SELECT value FROM json_each(?))").bind(up.toko_id, JSON.stringify(tglList)),
    ...ok.map(r => db.prepare(`INSERT INTO tiktok_iklan (toko_id, tgl, jam, biaya, pesanan, omzet, sumber, upload_id, updated_at) VALUES (?,?,?,?,?,?,'file',?,?)
      ON CONFLICT(toko_id, tgl, jam) DO UPDATE SET biaya=biaya+excluded.biaya, pesanan=pesanan+excluded.pesanan, omzet=omzet+excluded.omzet`)
      .bind(up.toko_id, r.tgl, r.jam, r.biaya, r.pesanan, r.omzet, up.id, kini)),
    db.prepare("UPDATE tiktok_upload SET pesanan=?, baru=? WHERE id=?").bind(tglList.length, ok.length, id)];
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500));
  return c.json({ ok: true, hari: tglList.length, baris: ok.length });
});

/** Live: baris per hari dari file Live Performance Core Stats; tanggal yang ada di file menggantikan data lama toko itu. */
type LiveIn = { tgl?: string; omzet?: number; omzet_langsung?: number; omzet_tidak_langsung?: number; siaran?: number; terjual?: number; pesanan?: number; tayangan?: number };
tiktok.post("/upload/:id/live", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const up = await db.prepare("SELECT id, toko_id FROM tiktok_upload WHERE id=? AND jenis='live'").bind(id).first<{ id: number; toko_id: number }>();
  if (!up) return c.json({ error: "upload tidak ditemukan" }, 404);
  const { rows } = await c.req.json<{ rows?: LiveIn[] }>();
  if (!Array.isArray(rows) || !rows.length || rows.length > 400) return c.json({ error: "kirim 1–400 hari" }, 400);
  const n = (v: unknown) => Math.max(0, angka(v)), ok = rows.filter(r => TGL.test(String(r.tgl ?? ""))), kini = new Date().toISOString();
  const tglList = [...new Set(ok.map(r => r.tgl!))];
  await db.batch([
    db.prepare("DELETE FROM tiktok_live WHERE toko_id=? AND tgl IN (SELECT value FROM json_each(?))").bind(up.toko_id, JSON.stringify(tglList)),
    ...ok.map(r => db.prepare(`INSERT OR REPLACE INTO tiktok_live (toko_id, tgl, omzet, omzet_langsung, omzet_tidak_langsung, siaran, terjual, pesanan, tayangan, upload_id, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(up.toko_id, r.tgl, n(r.omzet), n(r.omzet_langsung), n(r.omzet_tidak_langsung), n(r.siaran), n(r.terjual), n(r.pesanan), n(r.tayangan), up.id, kini)),
    db.prepare("UPDATE tiktok_upload SET pesanan=?, baru=? WHERE id=?").bind(tglList.length, tglList.length, id),
  ]);
  return c.json({ ok: true, hari: tglList.length });
});

/** Biaya live (manual, file Live tidak memuat biaya): { toko_id, dari, sampai, spending, ket? } — dibagi rata per hari periode itu */
tiktok.post("/live/biaya", async c => {
  const b = await c.req.json<{ toko_id?: number; dari?: string; sampai?: string; spending?: number; ket?: string }>();
  const dari = String(b.dari ?? ""), sampai = String(b.sampai ?? ""), spending = Math.round(Number(b.spending));
  if (!TGL.test(dari) || !TGL.test(sampai) || dari > sampai) return c.json({ error: "periode tidak valid (YYYY-MM-DD)" }, 400);
  if (!Number.isFinite(spending) || spending < 0) return c.json({ error: "spending harus angka ≥ 0" }, 400);
  const toko = await c.env.DB.prepare("SELECT id FROM tiktok_toko WHERE id=?").bind(Number(b.toko_id)).first();
  if (!toko) return c.json({ error: "toko tidak ditemukan" }, 400);
  const r = await c.env.DB.prepare("INSERT INTO tiktok_live_biaya (toko_id, dari, sampai, spending, ket, created_at) VALUES (?,?,?,?,?,?)")
    .bind(Number(b.toko_id), dari, sampai, spending, String(b.ket ?? "").trim().slice(0, 200) || null, new Date().toISOString()).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
tiktok.delete("/live/biaya/:id", async c => {
  await c.env.DB.prepare("DELETE FROM tiktok_live_biaya WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/**
 * Ringkasan iklan TikTok untuk rentang & toko: total, per hari, per jam (bila file per jam), per toko, dan omzet pesanan TikTok
 * (selain batal & belum bayar, per tanggal pesanan dibuat) sebagai pembanding TACOS.
 */
tiktok.get("/iklan", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null;
  if (!TGL.test(from) || !TGL.test(to)) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, wT = toko ? " AND i.toko_id=?3" : "", wP = toko ? " AND p.toko_id=?3" : "", a = toko ? [from, to, toko] : [from, to];
  const SUM = "SUM(i.biaya) AS biaya, SUM(i.pesanan) AS pesanan, SUM(i.omzet) AS omzet";
  const [tot, harian, jam, perToko, omzet, omzetHari, hariJam] = await db.batch([
    db.prepare(`SELECT ${SUM}, COUNT(DISTINCT i.tgl) AS hari FROM tiktok_iklan i WHERE i.tgl BETWEEN ?1 AND ?2${wT}`).bind(...a),
    db.prepare(`SELECT i.tgl, ${SUM} FROM tiktok_iklan i WHERE i.tgl BETWEEN ?1 AND ?2${wT} GROUP BY 1 ORDER BY 1`).bind(...a),
    db.prepare(`SELECT i.jam, ${SUM} FROM tiktok_iklan i WHERE i.tgl BETWEEN ?1 AND ?2 AND i.jam>=0${wT} GROUP BY 1 ORDER BY 1`).bind(...a),
    db.prepare(`SELECT i.toko_id, ${SUM}, COUNT(DISTINCT i.tgl) AS hari FROM tiktok_iklan i WHERE i.tgl BETWEEN ?1 AND ?2${wT} GROUP BY 1`).bind(...a),
    db.prepare(`SELECT p.toko_id, COUNT(*) AS pesanan, SUM(p.subtotal) AS omzet FROM tiktok_pesanan p
      WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND ${LAKU}${wP} GROUP BY 1`).bind(...a),
    db.prepare(`SELECT substr(p.dibuat,1,10) AS tgl, SUM(p.subtotal) AS omzet FROM tiktok_pesanan p
      WHERE substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND ${LAKU}${wP} GROUP BY 1`).bind(...a),
    db.prepare(`SELECT COUNT(DISTINCT i.tgl) AS n FROM tiktok_iklan i WHERE i.tgl BETWEEN ?1 AND ?2 AND i.jam>=0${wT}`).bind(...a),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from, to, total: tot.results[0] ?? {}, harian: harian.results, per_jam: jam.results, hari_jam: hariJam.results[0]?.n ?? 0,
    per_toko: perToko.results, omzet_toko: omzet.results, omzet_harian: omzetHari.results });
});

/** Log History: upload file & sinkron API (50 terakhir, atau beririsan dengan from/to) */
tiktok.get("/upload", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", jenis = c.req.query("jenis") ?? "";
  const w: string[] = [], args: string[] = [];
  if (TGL.test(from) && TGL.test(to)) { w.push(`COALESCE(u.dari, date(u.created_at,'+7 hours'))<=? AND COALESCE(u.sampai, u.dari, date(u.created_at,'+7 hours'))>=?`); args.push(to, from); }
  if (jenis) { w.push("u.jenis=?"); args.push(jenis); }
  const r = await c.env.DB.prepare(`SELECT u.*, t.nama AS toko FROM tiktok_upload u JOIN tiktok_toko t ON t.id=u.toko_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY u.id DESC LIMIT 100`)
    .bind(...args).all();
  return c.json({ rows: r.results });
});

/**
 * Kesehatan data per toko untuk jenis pesanan | penghasilan & rentang ?from&to (bentuk sama dengan /api/shopee/status):
 * data terakhir, cakupan di dalam rentang, jumlah (dan yang dari API), upload terakhir.
 */
tiktok.get("/status", async c => {
  const j = c.req.query("jenis"), from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", jenis = j === "penghasilan" || j === "iklan" ? j : "pesanan";
  if (!TGL.test(from) || !TGL.test(to)) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const T = (kol: string) => `MAX(${kol}) AS terakhir, MIN(CASE WHEN ${kol} BETWEEN ?1 AND ?2 THEN ${kol} END) AS awal_rentang,
    MAX(CASE WHEN ${kol} BETWEEN ?1 AND ?2 THEN ${kol} END) AS akhir_rentang, SUM(${kol} BETWEEN ?1 AND ?2) AS n`;
  const sql = jenis === "iklan"
    ? `SELECT i.toko_id, MAX(i.tgl) AS terakhir, MIN(CASE WHEN i.tgl BETWEEN ?1 AND ?2 THEN i.tgl END) AS awal_rentang,
        MAX(CASE WHEN i.tgl BETWEEN ?1 AND ?2 THEN i.tgl END) AS akhir_rentang, COUNT(DISTINCT CASE WHEN i.tgl BETWEEN ?1 AND ?2 THEN i.tgl END) AS n, 0 AS n_api
      FROM tiktok_iklan i GROUP BY i.toko_id`
    : jenis === "penghasilan"
    ? `SELECT h.toko_id, ${T("h.dilepas")}, SUM(h.dilepas BETWEEN ?1 AND ?2 AND h.sumber='api') AS n_api FROM tiktok_penghasilan h GROUP BY h.toko_id`
    : `SELECT p.toko_id, ${T("substr(p.dibuat,1,10)")}, SUM(substr(p.dibuat,1,10) BETWEEN ?1 AND ?2 AND p.sumber='api') AS n_api FROM tiktok_pesanan p GROUP BY p.toko_id`;
  const [data, upload] = await c.env.DB.batch([
    c.env.DB.prepare(sql).bind(from, to),
    c.env.DB.prepare("SELECT toko_id, MAX(created_at) AS upload_terakhir FROM tiktok_upload WHERE jenis=? GROUP BY toko_id").bind(jenis),
  ]) as D1Result<Record<string, any>>[];
  const up = new Map(upload.results.map(r => [r.toko_id, r.upload_terakhir]));
  return c.json({ from, to, jenis, toko: data.results.map(r => ({ ...r, upload_terakhir: up.get(r.toko_id) ?? null })) });
});

// ---- Pesanan: ringkasan per tanggal pesanan dibuat (WIB)
function filter(c: { req: { query: (k: string) => string | undefined } }, kolom: string) {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", toko = Number(c.req.query("toko")) || null, ch = c.req.query("channel") ?? "";
  if (!TGL.test(from) || !TGL.test(to)) return null;
  const w = [`substr(${kolom},1,10) BETWEEN ? AND ?`], args: (string | number)[] = [from, to];
  if (toko) { w.push(kolom.startsWith("p.") ? "p.toko_id=?" : "h.toko_id=?"); args.push(toko); }
  if (ch && kolom.startsWith("p.")) { w.push("p.channel=?"); args.push(ch); }
  return { from, to, W: w.join(" AND "), args };
}
const SKU_ID = "(SELECT s.id FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE)";
const SKU_PCS = "(SELECT SUM(CASE WHEN x.bonus=1 THEN 0 ELSE x.qty END) FROM sku_produk_item x JOIN sku_produk s ON s.id=x.sku_id WHERE s.sku=TRIM(i.sku) COLLATE NOCASE)";

tiktok.get("/pesanan", async c => {
  const f = filter(c, "p.dibuat");
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, q = (sql: string) => db.prepare(sql).bind(...f.args);
  const [status, harian, channel, perSku, batal, sumber, sinkron, perToko, perKurir] = await db.batch([
    q(`SELECT ${GRUP} AS grup, COUNT(*) AS n, SUM(p.subtotal) AS nilai, SUM(p.total) AS total, SUM(p.pcs) AS pcs, SUM(p.cod) AS cod FROM tiktok_pesanan p WHERE ${f.W} GROUP BY 1`),
    q(`SELECT substr(p.dibuat,1,10) AS tgl, ${GRUP} AS grup, COUNT(*) AS n FROM tiktok_pesanan p WHERE ${f.W} GROUP BY 1, 2 ORDER BY 1`),
    q(`SELECT COALESCE(p.channel,'TikTok') AS channel, COUNT(*) AS n, SUM(CASE WHEN ${LAKU} THEN p.subtotal ELSE 0 END) AS omzet, SUM(p.status='batal') AS batal
       FROM tiktok_pesanan p WHERE ${f.W} GROUP BY 1`),
    q(`SELECT UPPER(TRIM(COALESCE(i.sku,''))) AS sku, MIN(i.nama) AS nama, MIN(i.variasi) AS variasi, SUM(i.qty) AS qty, COUNT(DISTINCT p.order_id) AS pesanan,
         SUM(i.subtotal) AS omzet, SUM(i.qty_retur) AS retur, ${SKU_ID} AS sku_id, (SELECT s.produk FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE) AS sku_produk,
         (SELECT s.hpp FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE) AS hpp, ${SKU_PCS} AS isi_pcs
       FROM tiktok_pesanan p JOIN tiktok_pesanan_item i ON i.order_id=p.order_id WHERE ${f.W} AND ${LAKU} GROUP BY 1 ORDER BY qty DESC`),
    q(`SELECT COALESCE(p.alasan_batal,'(tanpa alasan)') AS alasan, COUNT(*) AS n, SUM(p.subtotal) AS nilai, SUM(p.cod) AS cod FROM tiktok_pesanan p WHERE ${f.W} AND p.status='batal' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT p.sumber, COUNT(*) AS n FROM tiktok_pesanan p WHERE ${f.W} GROUP BY 1`),
    db.prepare("SELECT value FROM kv WHERE key='tiktok_sinkron_terakhir'"),
    q(`SELECT p.toko_id, COUNT(*) AS n, SUM(p.status='belum_bayar') AS belum_bayar, SUM(p.status='perlu_dikirim') AS perlu_dikirim,
         SUM(p.status='dikirim') AS dikirim, SUM(p.status IN ('terkirim','selesai')) AS terkirim, SUM(p.status='batal') AS batal, SUM(p.status='retur') AS retur,
         SUM(CASE WHEN ${LAKU} THEN p.subtotal ELSE 0 END) AS omzet, SUM(CASE WHEN ${LAKU} THEN p.pcs ELSE 0 END) AS pcs
       FROM tiktok_pesanan p WHERE ${f.W} GROUP BY p.toko_id`),
    q(`SELECT COALESCE(NULLIF(TRIM(p.kurir),''),'(belum ada kurir)') AS kurir, COUNT(*) AS n, SUM(p.status='perlu_dikirim') AS perlu_dikirim, SUM(p.status='dikirim') AS dikirim,
         SUM(p.status IN ('terkirim','selesai')) AS terkirim, SUM(p.status='retur') AS retur, SUM(p.cod) AS cod
       FROM tiktok_pesanan p WHERE ${f.W} AND ${LAKU} GROUP BY 1 ORDER BY n DESC`),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from: f.from, to: f.to, status: status.results, harian: harian.results, channel: channel.results, per_sku: perSku.results,
    batal: batal.results, sumber: sumber.results, sinkron: sinkron.results[0] ? JSON.parse(sinkron.results[0].value) : null,
    per_toko: perToko.results, per_kurir: perKurir.results });
});

tiktok.get("/pesanan/daftar", async c => {
  const f = filter(c, "p.dibuat");
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const grup = c.req.query("grup") ?? "", cari = (c.req.query("q") ?? "").trim(), offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const w = [f.W], args = [...f.args];
  if (grup) { w.push(`${GRUP}=?`); args.push(grup); }
  if (cari) { w.push("(p.order_id LIKE ? OR p.resi LIKE ? OR EXISTS (SELECT 1 FROM tiktok_pesanan_item i WHERE i.order_id=p.order_id AND (i.nama LIKE ? OR i.sku LIKE ?)))"); const k = `%${cari}%`; args.push(k, k, k, k); }
  const W = w.join(" AND ");
  const [rows, total] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT p.*, t.nama AS toko,
        (SELECT json_group_array(json_object('sku', i.sku, 'nama', i.nama, 'variasi', i.variasi, 'qty', i.qty, 'subtotal', i.subtotal)) FROM tiktok_pesanan_item i WHERE i.order_id=p.order_id) AS items
      FROM tiktok_pesanan p JOIN tiktok_toko t ON t.id=p.toko_id WHERE ${W} ORDER BY p.dibuat DESC LIMIT 100 OFFSET ?`).bind(...args, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tiktok_pesanan p WHERE ${W}`).bind(...args),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ rows: rows.results.map(r => ({ ...r, items: JSON.parse(r.items || "[]") })), total: total.results[0]?.n ?? 0, offset });
});

// ---- Penghasilan: per tanggal dana dibayarkan (WIB). HPP = isi pesanan × HPP Manajemen SKU saat ini.
const HPP = "(SELECT SUM(i.qty*s.hpp) FROM tiktok_pesanan_item i JOIN sku_produk s ON s.sku=TRIM(i.sku) COLLATE NOCASE WHERE i.order_id=h.order_id)";
export const ADA_PESANAN = "EXISTS (SELECT 1 FROM tiktok_pesanan p WHERE p.order_id=h.order_id)";
export const SKU_KOSONG = `EXISTS (SELECT 1 FROM tiktok_pesanan_item i WHERE i.order_id=h.order_id AND NOT EXISTS (SELECT 1 FROM sku_produk s WHERE s.sku=TRIM(i.sku) COLLATE NOCASE))`;
// HPP hanya untuk pesanan yang dananya positif (barang terjual); pesanan refund penuh tidak dibebani HPP di sini
export const HPP_LAKU = `CASE WHEN h.jenis='Pesanan' AND h.pendapatan>0 THEN ${HPP} END`;

/** Basis tanggal penghasilan: 'dibuat' (tanggal pesanan dibuat; penyesuaian tanpa tanggal pesanan → tanggal cair) atau 'dilepas' (tanggal dana cair) */
const kolomBasis = (c: { req: { query: (k: string) => string | undefined } }) => c.req.query("basis") === "dilepas" ? "h.dilepas" : "COALESCE(h.dibuat, h.dilepas)";

tiktok.get("/penghasilan", async c => {
  const basis = c.req.query("basis") === "dilepas" ? "dilepas" : "dibuat", kol = kolomBasis(c);
  const f = filter(c, kol);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, q = (sql: string) => db.prepare(sql).bind(...f.args);
  const KOLOM = `COUNT(*) AS n, SUM(h.total) AS total, SUM(h.pendapatan) AS pendapatan, SUM(h.subtotal) AS subtotal, SUM(h.diskon_penjual) AS diskon,
    SUM(h.refund) AS refund, SUM(h.biaya_total) AS biaya, SUM(h.biaya_platform) AS platform, SUM(h.biaya_ongkir) AS ongkir, SUM(h.biaya_afiliasi) AS afiliasi,
    SUM(h.pajak) AS pajak, SUM(h.penyesuaian) AS penyesuaian, SUM(${HPP_LAKU}) AS hpp,
    SUM(h.jenis='Pesanan' AND h.pendapatan>0 AND NOT ${ADA_PESANAN}) AS tanpa_pesanan, SUM(h.jenis='Pesanan' AND h.pendapatan>0 AND ${SKU_KOSONG}) AS sku_kosong`;
  const tI = Number(c.req.query("toko")) || null;
  const tA = tI ? [tI] : [];
  // Basis tanggal dibuat: pesanan dibuat di rentang (dibayar, tidak batal) yang dananya belum cair → diperkirakan di browser dari rasio
  // pesanan yang sudah cair (per subtotal setelah diskon penjual). Acuan rasio bila di rentang belum ada yang cair: pesanan dibuat 60 hari s/d `to`.
  const acuanDari = new Date(Date.parse(f.to + "T00:00:00Z") - 59 * 864e5).toISOString().slice(0, 10);
  const kosong = db.prepare("SELECT NULL AS x LIMIT 0");
  const [tot, harian, rincian, perSku, sumber, perToko, iklan, afiliasi, valid, live, liveBiaya, belum, acuan] = await db.batch([
    q(`SELECT ${KOLOM} FROM tiktok_penghasilan h WHERE ${f.W}`),
    q(`SELECT substr(${kol},1,10) AS tgl, COUNT(*) AS n, SUM(h.total) AS total, SUM(h.biaya_total) AS biaya, SUM(h.pendapatan) AS pendapatan, SUM(h.subtotal) AS subtotal,
         SUM(${HPP_LAKU}) AS hpp FROM tiktok_penghasilan h WHERE ${f.W} GROUP BY 1 ORDER BY 1`),
    q(`SELECT j.key AS kolom, SUM(j.value) AS jumlah, COUNT(*) AS n FROM tiktok_penghasilan h, json_each(h.rincian) j WHERE ${f.W} GROUP BY 1`),
    q(`SELECT UPPER(TRIM(COALESCE(i.sku,''))) AS sku, MIN(i.nama) AS nama, SUM(i.qty) AS qty, COUNT(DISTINCT h.order_id) AS pesanan,
         SUM(h.pendapatan*i.subtotal*1.0/p.subtotal) AS pendapatan, SUM(h.biaya_total*i.subtotal*1.0/p.subtotal) AS biaya,
         SUM(h.total*i.subtotal*1.0/p.subtotal) AS total, SUM(i.qty*s.hpp) AS hpp, MIN(s.id) AS sku_id
       FROM tiktok_penghasilan h JOIN tiktok_pesanan p ON p.order_id=h.order_id JOIN tiktok_pesanan_item i ON i.order_id=h.order_id
         LEFT JOIN sku_produk s ON s.sku=TRIM(i.sku) COLLATE NOCASE
       WHERE ${f.W} AND h.jenis='Pesanan' AND h.pendapatan>0 AND p.subtotal>0 GROUP BY 1 ORDER BY total DESC`),
    q(`SELECT h.sumber, COUNT(*) AS n FROM tiktok_penghasilan h WHERE ${f.W} GROUP BY 1`),
    q(`SELECT h.toko_id, ${KOLOM} FROM tiktok_penghasilan h WHERE ${f.W} GROUP BY h.toko_id`),
    // Spend & omzet iklan TikTok di rentang yang sama (tanggal iklan tayang)
    db.prepare(`SELECT i.tgl, SUM(i.biaya) AS biaya, SUM(i.omzet) AS omzet FROM tiktok_iklan i WHERE i.tgl BETWEEN ? AND ?${tI ? " AND i.toko_id=?" : ""} GROUP BY 1`).bind(f.from, f.to, ...tA),
    // Kanal affiliate: transaksi dengan komisi afiliasi (biaya_afiliasi negatif), per tanggal dana dibayarkan
    q(`SELECT substr(${kol},1,10) AS tgl, COUNT(*) AS n, SUM(h.pendapatan) AS omzet, SUM(-h.biaya_afiliasi) AS komisi, SUM(${HPP_LAKU}) AS hpp,
         SUM(h.jenis='Pesanan' AND h.pendapatan>0 AND (NOT ${ADA_PESANAN} OR ${SKU_KOSONG})) AS hpp_kurang
       FROM tiktok_penghasilan h WHERE ${f.W} AND h.biaya_afiliasi<0 GROUP BY 1 ORDER BY 1`),
    // Rasio pesanan valid (bukan batal / belum bayar) di rentang — omzet iklan TikTok masih termasuk pesanan batal
    db.prepare(`SELECT SUM(p.subtotal) AS semua, SUM(CASE WHEN ${LAKU} THEN p.subtotal ELSE 0 END) AS valid FROM tiktok_pesanan p
      WHERE substr(p.dibuat,1,10) BETWEEN ? AND ?${tI ? " AND p.toko_id=?" : ""}`).bind(f.from, f.to, ...tA),
    // Live per hari (tanggal siaran) & biaya live manual yang beririsan dengan rentang
    db.prepare(`SELECT l.tgl, SUM(l.omzet) AS omzet, SUM(l.omzet_langsung) AS omzet_langsung, SUM(l.omzet_tidak_langsung) AS omzet_tidak_langsung,
        SUM(l.siaran) AS siaran, SUM(l.terjual) AS terjual, SUM(l.pesanan) AS pesanan, SUM(l.tayangan) AS tayangan
      FROM tiktok_live l WHERE l.tgl BETWEEN ? AND ?${tI ? " AND l.toko_id=?" : ""} GROUP BY 1 ORDER BY 1`).bind(f.from, f.to, ...tA),
    db.prepare(`SELECT b.*, t.nama AS toko FROM tiktok_live_biaya b JOIN tiktok_toko t ON t.id=b.toko_id
      WHERE b.dari<=? AND b.sampai>=?${tI ? " AND b.toko_id=?" : ""} ORDER BY b.dari`).bind(f.to, f.from, ...tA),
    basis === "dibuat"
      ? db.prepare(`SELECT substr(p.dibuat,1,10) AS tgl, COUNT(*) AS n, SUM(p.subtotal) AS subtotal FROM tiktok_pesanan p
          WHERE substr(p.dibuat,1,10) BETWEEN ? AND ? AND ${LAKU}${tI ? " AND p.toko_id=?" : ""}
            AND NOT EXISTS (SELECT 1 FROM tiktok_penghasilan h WHERE h.order_id=p.order_id) GROUP BY 1 ORDER BY 1`).bind(f.from, f.to, ...tA)
      : kosong,
    basis === "dibuat"
      ? db.prepare(`SELECT ${KOLOM} FROM tiktok_penghasilan h WHERE COALESCE(h.dibuat, h.dilepas) BETWEEN ? AND ?${tI ? " AND h.toko_id=?" : ""}`).bind(acuanDari, f.to, ...tA)
      : kosong,
  ]) as D1Result<Record<string, any>>[];
  return c.json({ from: f.from, to: f.to, total: tot.results[0] ?? {}, harian: harian.results, rincian: rincian.results, per_sku: perSku.results, sumber: sumber.results,
    per_toko: perToko.results, iklan_harian: iklan.results, afiliasi_harian: afiliasi.results, pesanan_valid: valid.results[0] ?? {},
    live_harian: live.results, live_biaya: liveBiaya.results, basis, belum_cair: belum.results,
    acuan: basis === "dibuat" ? { dari: acuanDari, sampai: f.to, total: acuan.results[0] ?? {} } : null });
});

tiktok.get("/penghasilan/daftar", async c => {
  const kol = kolomBasis(c), f = filter(c, kol);
  if (!f) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const cari = (c.req.query("q") ?? "").trim(), offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const w = [f.W], args = [...f.args];
  if (cari) { w.push("(h.id LIKE ? OR h.order_id LIKE ?)"); args.push(`%${cari}%`, `%${cari}%`); }
  const W = w.join(" AND ");
  const [rows, total] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT h.id, h.jenis, h.order_id, h.dibuat, h.dilepas, h.total, h.pendapatan, h.subtotal, h.refund, h.biaya_total, h.biaya_platform,
        h.biaya_ongkir, h.biaya_afiliasi, h.pajak, h.penyesuaian, h.sumber, ${HPP_LAKU} AS hpp, ${ADA_PESANAN} AS ada_pesanan,
        (SELECT json_group_array(json_object('sku', i.sku, 'nama', i.nama, 'qty', i.qty)) FROM tiktok_pesanan_item i WHERE i.order_id=h.order_id) AS items,
        (SELECT t.nama FROM tiktok_toko t WHERE t.id=h.toko_id) AS toko
      FROM tiktok_penghasilan h WHERE ${W} ORDER BY ${kol} DESC, h.id LIMIT 100 OFFSET ?`).bind(...args, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tiktok_penghasilan h WHERE ${W}`).bind(...args),
  ]) as D1Result<Record<string, any>>[];
  return c.json({ rows: rows.results.map(r => ({ ...r, items: JSON.parse(r.items || "[]") })), total: total.results[0]?.n ?? 0, offset });
});

// =====================================================================================================
// Sinkron API: pesanan (menurut update_time) dan settlement (statement → transaksi per pesanan)
// =====================================================================================================
type Obj = Record<string, any>;
const num = (v: unknown) => Number(v) || 0;

/** Pesanan API → bentuk PesananIn. line_items TikTok = 1 baris per pcs → digabung per SKU. */
function pesananDariApi(o: Obj): PesananIn {
  const pay: Obj = o.payment ?? {}, items = new Map<string, ItemIn>();
  for (const li of (o.line_items ?? []) as Obj[]) {
    const k = String(li.sku_id ?? li.seller_sku ?? li.id), it = items.get(k) ?? { sku_id: li.sku_id, sku: li.seller_sku, nama: li.product_name, variasi: li.sku_name,
      harga_awal: num(li.original_price), subtotal: 0, qty: 0, qty_retur: 0 };
    it.qty = (it.qty ?? 0) + 1; it.subtotal = (it.subtotal ?? 0) + num(li.sale_price);
    if (/return|refund/i.test(String(li.display_status ?? "")) ) it.qty_retur = (it.qty_retur ?? 0) + 1;
    items.set(k, it);
  }
  const daerah = (lvl: string, pola: RegExp) => {
    const d = ((o.recipient_address ?? {}).district_info ?? []) as Obj[];
    return (d.find(x => x.address_level === lvl) ?? d.find(x => pola.test(String(x.address_level_name ?? ""))))?.address_name;
  };
  const li0: Obj = (o.line_items ?? [])[0] ?? {};
  return {
    order_id: o.id, status_asli: o.status, tipe_batal: o.cancellation_initiator ? "Cancel" : undefined, alasan_batal: o.cancel_reason,
    resi: o.tracking_number ?? li0.tracking_number, kurir: o.shipping_provider ?? li0.shipping_provider_name, opsi_kirim: o.delivery_option_name,
    dibuat: wib(o.create_time) ?? undefined, dibayar: wib(o.paid_time) ?? undefined, dikirim: wib(o.rts_time ?? o.collection_time) ?? undefined,
    terkirim: wib(o.delivery_time) ?? undefined, dibatalkan: wib(o.cancel_time) ?? undefined, metode_bayar: o.payment_method_name, cod: o.is_cod ? 1 : 0,
    diskon_penjual: num(pay.seller_discount), diskon_platform: num(pay.platform_discount), ongkir_pembeli: num(pay.shipping_fee), total: num(pay.total_amount),
    provinsi: daerah("L1", /province|provinsi/i), kota: daerah("L2", /city|kota|regency|kabupaten/i),
    channel: /tokopedia/i.test(String(o.commerce_platform ?? o.order_type ?? "")) ? "Tokopedia" : "TikTok",
    // Fulfilled by TikTok = dikirim dari stok di gudang TikTok
    fbt: o.fulfillment_type ? o.fulfillment_type === "FULFILLMENT_BY_TIKTOK" : undefined,
    items: [...items.values()],
  };
}

/** Transaksi settlement API → PenghasilanIn. Komponen bersarang diratakan ke rincian. */
function penghasilanDariApi(t: Obj, statementTime: number): PenghasilanIn {
  const rinci: Record<string, number> = {};
  const ratakan = (o: Obj, awal = "") => { for (const [k, v] of Object.entries(o ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) ratakan(v, `${awal}${k}.`);
    else if (/amount$/.test(k) && num(v)) rinci[awal + k] = num(v);
  } };
  ratakan(t);
  const jumlah = (pola: RegExp) => Object.entries(rinci).filter(([k]) => pola.test(k)).reduce((a, [, v]) => a + v, 0);
  const ongkir = num(t.shipping_cost_amount), fee = num(t.fee_amount ?? t.fee_tax_amount);
  const afiliasi = jumlah(/affiliate/i), pajak = jumlah(/(^|_|\.)(pit|tax|vat|gst)(_|$)/i);
  // fee_amount sudah termasuk shipping_cost_amount (settlement = revenue + fee + adjustment) → ongkir dipisah dari biaya platform, tidak ditambah lagi
  return {
    id: String(t.order_id ?? t.adjustment_id ?? t.id), jenis: /order/i.test(String(t.type ?? "ORDER")) ? "Pesanan" : String(t.type),
    order_id: t.order_id ? String(t.order_id) : undefined, dibuat: wib(t.order_create_time)?.slice(0, 10), dilepas: wib(statementTime)?.slice(0, 10),
    total: num(t.settlement_amount), pendapatan: num(t.revenue_amount), subtotal: num(t.after_seller_discounts_subtotal_amount),
    diskon_penjual: -Math.abs(num(t.seller_discount_amount)), refund: num(t.customer_refund_amount ?? t.refund_amount),
    biaya_total: fee, biaya_ongkir: ongkir, biaya_afiliasi: afiliasi, pajak, biaya_platform: fee - ongkir - afiliasi - pajak,
    penyesuaian: num(t.adjustment_amount), dibayar_pembeli: num(t.customer_payment_amount), rincian: rinci,
  };
}

/**
 * Sinkron semua toko TikTok yang terhubung API. Pesanan: update_time sejak sinkron terakhir − 1 jam (awal 30 hari).
 * Settlement: statement 45 hari terakhir. Dibatasi per jalan supaya tidak melebihi batas subrequest Worker.
 */
export async function syncTiktok(env: Env, opsi: { hariPesanan?: number; hariDana?: number } = {}) {
  let api: TiktokApi;
  try { api = new TiktokApi(env); } catch { return { ok: false, pesan: "kunci TikTok belum di-set" }; }
  const db = env.DB;
  await sinkronToko(db);
  const akun = await db.prepare("SELECT open_id, toko_json FROM tiktok_api_akun").all<{ open_id: string; toko_json: string | null }>();
  const hasil: Obj[] = [], kini = Math.floor(Date.now() / 1000);
  for (const a of akun.results) for (const s of JSON.parse(a.toko_json ?? "[]") as Obj[]) {
    const toko = await db.prepare("SELECT id, gudang_id FROM tiktok_toko WHERE shop_id=?").bind(s.id).first<{ id: number; gudang_id: number | null }>();
    if (!toko) continue;
    const r: Obj = { toko: s.name };
    // Pesanan
    try {
      const kunci = `tiktok_sync_pesanan:${s.id}`, k = await db.prepare("SELECT value FROM kv WHERE key=?").bind(kunci).first<{ value: string }>();
      const mulai = opsi.hariPesanan ? kini - opsi.hariPesanan * 86400 : k ? Number(k.value) - 3600 : kini - 30 * 86400;
      let token = "", hal = 0, n = 0, baru = 0;
      do {
        const d = await api.panggil<{ orders?: Obj[]; next_page_token?: string }>(a.open_id, "/order/202309/orders/search",
          { page_size: 100, ...(token ? { page_token: token } : {}) }, { update_time_ge: mulai, update_time_lt: kini }, s.cipher);
        const ps = (d.orders ?? []).map(pesananDariApi);
        if (ps.length) { const h = await simpanPesanan(db, toko, ps, "api", null); n += h.disimpan; baru += h.baru; }
        token = d.next_page_token ?? "";
      } while (token && ++hal < 30);
      if (!token) await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(kunci, String(kini)).run();
      r.pesanan = { disimpan: n, baru, selesai: !token };
    } catch (e) { r.pesanan = { gagal: String((e as Error).message ?? e) }; }
    // Settlement
    try {
      const mulai = kini - (opsi.hariDana ?? 45) * 86400;
      const st = await api.panggil<{ statements?: Obj[] }>(a.open_id, "/finance/202309/statements",
        { page_size: 100, sort_field: "statement_time", statement_time_ge: mulai, statement_time_lt: kini }, undefined, s.cipher);
      let n = 0, baru = 0, statement = 0;
      for (const x of st.statements ?? []) {
        let token = "", hal = 0;
        do {
          const d = await api.panggil<{ statement_transactions?: Obj[]; next_page_token?: string }>(a.open_id, `/finance/202309/statements/${x.id}/statement_transactions`,
            { page_size: 100, sort_field: "order_create_time", ...(token ? { page_token: token } : {}) }, undefined, s.cipher);
          const rows = (d.statement_transactions ?? []).map(t => penghasilanDariApi(t, Number(x.statement_time)));
          if (rows.length) { const h = await simpanPenghasilan(db, toko.id, rows, "api", null); n += h.disimpan; baru += h.baru; }
          token = d.next_page_token ?? "";
        } while (token && ++hal < 20);
        statement++;
      }
      r.penghasilan = { statement, disimpan: n, baru };
    } catch (e) { r.penghasilan = { gagal: String((e as Error).message ?? e) }; }
    hasil.push(r);
  }
  await db.prepare("INSERT INTO kv (key, value) VALUES ('tiktok_sinkron_terakhir', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(JSON.stringify({ waktu: new Date().toISOString(), hasil })).run();
  return { ok: true, hasil };
}

tiktok.post("/sinkron", async c => c.json(await syncTiktok(c.env, { hariPesanan: Number(c.req.query("hari")) || undefined, hariDana: Number(c.req.query("hari_dana")) || undefined })));
