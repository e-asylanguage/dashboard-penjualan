import { Hono } from "hono";
import { Env, todayReport } from "../env";
import { KOLOM_BIAYA, OrderBiaya, siapkanBiaya, siapkanPcs, ongkirPaket, JOIN_SALDO, KOLOM_SALDO, SaldoPaket } from "../lib/biaya";
import { SHIP_STATUS, SHIP_GUDANG, SHIP_BARANG, SHIP_SELESAI } from "./report";
import { COOKIE_SESI, bacaCookie, cekSesi, userDashboard } from "../lib/sesi";
import { ItemKatalog, cocokkan } from "../lib/katalog";
import { HPP_PESANAN as SHP_HPP, ADA_PESANAN as SHP_ADA, SKU_KOSONG as SHP_SKU_KOSONG } from "./shopee";
import { HPP_LAKU as TT_HPP_LAKU, ADA_PESANAN as TT_ADA, SKU_KOSONG as TT_SKU_KOSONG } from "./tiktok";

/** Menu Laporan: Laba Rugi, Margin Produk, Arus Kas (Nilai Persediaan dihitung di browser dari /report/stok + /settings/req). */
export const laporan = new Hono<{ Bindings: Env }>();

const BLN = /^\d{4}-\d{2}$/, TGL = /^\d{4}-\d{2}-\d{2}$/;
const geserBulan = (b: string, n: number) => new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const akhirBulan = (b: string) => new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7), 0)).toISOString().slice(0, 10);

/** ?dari=YYYY-MM&sampai=YYYY-MM → daftar bulan (default 3 bulan terakhir, maksimal 12) dan rentang tanggalnya */
function rentangBulan(c: { req: { query: (k: string) => string | undefined } }) {
  const kini = todayReport().slice(0, 7);
  let sampai = c.req.query("sampai") ?? "", dari = c.req.query("dari") ?? "";
  if (!BLN.test(sampai)) sampai = kini;
  if (!BLN.test(dari)) dari = geserBulan(sampai, -2);
  if (dari > sampai) [dari, sampai] = [sampai, dari];
  const bulan: string[] = [];
  for (let b = dari; b <= sampai && bulan.length < 12; b = geserBulan(b, 1)) bulan.push(b);
  return { bulan, from: `${bulan[0]}-01`, to: akhirBulan(bulan[bulan.length - 1]) };
}

// Spend iklan untuk campaign yang pernah menghasilkan order di Scalev (sama dengan Ringkasan); sisanya = iklan lain
const SCALEV = "i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0)";
const SQL_IKLAN = `SELECT substr(i.date,1,7) AS bln, SUM(CASE WHEN ${SCALEV} THEN i.spend ELSE 0 END) AS iklan,
    SUM(CASE WHEN ${SCALEV} THEN 0 ELSE i.spend END) AS luar
  FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? GROUP BY 1`;
// Laba Rugi & Margin Produk: hanya campaign yang menghasilkan order Scalev (tanggal order masuk) di periode yang dipilih — 2 parameter (from, to)
const SCALEV_PERIODE = "i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0 AND draft_date BETWEEN ? AND ?)";
const SQL_IKLAN_PERIODE = `SELECT substr(i.date,1,7) AS bln, SUM(CASE WHEN ${SCALEV_PERIODE} THEN i.spend ELSE 0 END) AS iklan,
    SUM(CASE WHEN ${SCALEV_PERIODE} THEN 0 ELSE i.spend END) AS luar
  FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? GROUP BY 1`;   // bind(from, to) ×3
const SQL_OPS = `SELECT substr(tanggal,1,7) AS bln, kategori, SUM(jumlah) AS jumlah FROM biaya_operasional WHERE tanggal BETWEEN ? AND ? GROUP BY 1, 2`;

/**
 * HPP isi paket dari nama barang Mengantar (untuk paket tanpa order Scalev) — sama dengan Outbound / SKU Mengantar:
 * pasangan nama barang → SKU × qty (isi SKU dari List Produk memakai HPP produk pada tanggal paket, SKU tanpa isi memakai
 * hpp_dasar) atau → List Produk langsung. Biaya gudang tidak termasuk (ditambah terpisah sekali per paket).
 */
async function siapkanHppBarang(db: D1Database) {
  const [bs, bp, sku, isi, riw, gp, gd] = await db.batch([
    db.prepare("SELECT LOWER(goods) AS goods, sku_id, qty FROM barang_sku"),
    db.prepare("SELECT LOWER(goods) AS goods, produk_id, qty FROM barang_produk"),
    db.prepare("SELECT id, hpp, hpp_dasar FROM sku_produk"),
    db.prepare("SELECT sku_id, produk_id, qty FROM sku_produk_item"),
    db.prepare("SELECT produk_id, berlaku, hpp FROM produk_hpp ORDER BY produk_id, berlaku"),
    db.prepare("SELECT LOWER(shipper) AS shipper, gudang_id FROM gudang_pengirim"),
    db.prepare("SELECT id, COALESCE(biaya_penanganan,0)+COALESCE(biaya_lain,0) AS biaya FROM gudang"),
  ]) as D1Result<Record<string, any>>[];
  const kelompok = <T extends Record<string, any>>(rows: T[], k: string) => {
    const m = new Map<any, T[]>();
    for (const r of rows) m.set(r[k], [...(m.get(r[k]) ?? []), r]);
    return m;
  };
  const barangSku = new Map(bs.results.map(r => [r.goods, r])), barangProduk = kelompok(bp.results, "goods");
  const skuMap = new Map(sku.results.map(r => [r.id, r])), isiSku = kelompok(isi.results, "sku_id"), hppRiw = kelompok(riw.results, "produk_id");
  const biayaGd = new Map(gd.results.map(r => [r.id, Number(r.biaya) || 0])), pengirim = new Map(gp.results.map(r => [r.shipper, r.gudang_id]));
  const hppPada = (produk: number, tgl: string) => {
    let h: number | undefined;
    for (const r of hppRiw.get(produk) ?? []) { if (r.berlaku > tgl) break; h = r.hpp; }
    return h ?? 0;
  };
  return {
    hpp(goods: string, tgl: string): number | undefined {
      const k = goods.toLowerCase(), s = barangSku.get(k);
      if (s) {
        const sk = skuMap.get(s.sku_id), it = isiSku.get(s.sku_id) ?? [];
        if (it.length) return it.reduce((a, i) => a + i.qty * s.qty * hppPada(i.produk_id, tgl), 0);
        return sk ? (sk.hpp_dasar ?? sk.hpp ?? 0) * s.qty : undefined;
      }
      const p = barangProduk.get(k);
      return p?.length ? p.reduce((a, i) => a + i.qty * hppPada(i.produk_id, tgl), 0) : undefined;
    },
    gudang: (shipper: string) => biayaGd.get(pengirim.get(shipper.toLowerCase())) ?? 0,
  };
}

const POS = ["pendapatan", "hpp", "rugi_barang", "kompensasi", "iklan", "iklan_luar", "ongkir_kirim", "ongkir_rts", "cod_fee", "scalev_fee",
  "gudang_rts", "operasional", "paket_kirim", "paket_rts", "paket_hilang", "order", "pcs", "hpp_kurang", "ongkir_estimasi", "tanpa_order", "tanpa_order_noncod",
  // Marketplace (lihat posMarketplace): biaya disimpan positif, penyesuaian TikTok bertanda (+ = pemasukan)
  "shp_jual", "shp_hpp", "shp_biaya", "shp_ongkir", "shp_iklan", "shp_n", "shp_hpp_kurang",
  "tt_jual", "tt_hpp", "tt_biaya", "tt_ongkir", "tt_peny", "tt_iklan", "tt_n", "tt_hpp_kurang"] as const;
type Pos = Record<(typeof POS)[number], number>;
type Bulan = Pos & { bulan: string; ops: Record<string, number> };
const posNol = (): Pos => Object.fromEntries(POS.map(k => [k, 0])) as Pos;
const bulatkan = <T extends Pos>(m: T): T => ({ ...m, ...Object.fromEntries(POS.map(k => [k, Math.round(m[k])])) });

type PaketSelesai = SaldoPaket & { receipt: string | null; rk: string | null; st: string; tgl: string; cod_fee: number; nilai_cod: number;
  shipper: string; goods: string; kondisi: string | null; kompensasi: number | null };
type OrderJual = OrderBiaya & { gross_revenue: number };

/**
 * Pos laba rugi dari paket Mengantar yang selesai (terkirim / RTS / hilang, WIB) pada rentang tanggal, dijumlahkan ke
 * kelompok `kunci(paket, order)` (mis. bulan, atau gabungan produk). Kelompok yang belum ada dibuat lewat `buat`.
 *  - Pendapatan = nilai order Scalev (gross_revenue) yang paketnya terkirim; paket COD tanpa order Scalev → nilai COD.
 *  - HPP = HPP order (lib/biaya.ts, sudah termasuk biaya gudang bila SKU diatur); paket tanpa order → HPP dari SKU Mengantar + biaya gudang.
 *  - Kerugian barang = HPP paket retur rusak / hilang (Inbound RTS) atau hilang di kurir; kompensasi Mengantar mengurangi.
 *  - Ongkir = ongkir yang ditagih di saldo Mengantar (ongkirPaket), dipisah terkirim / retur; COD fee hanya paket terkirim.
 *  - Biaya gudang retur = biaya penanganan gudang pengirim untuk paket yang kembali (barangnya tidak terjual).
 *  - Scalev fee sekali per order yang paketnya selesai pada rentang itu.
 * Iklan & biaya operasional tidak di sini — menurut tanggalnya sendiri (tanggal tayang / tanggal biaya).
 */
async function posPaket<T extends Pos>(db: D1Database, from: string, to: string,
  kunci: (p: PaketSelesai, o: OrderJual | null) => string | null, buat: (k: string) => T, per: Map<string, T>) {
  const paket = await db.prepare(
    `SELECT s.receipt, json_extract(s.raw_json,'$.remark1') AS rk, ${SHIP_STATUS} AS st, date(${SHIP_SELESAI},'+7 hours') AS tgl,
       s.is_cod, s.price, s.cod_fee, s.cod_amount AS nilai_cod, ${SHIP_GUDANG} AS shipper, ${SHIP_BARANG} AS goods, k.kondisi, ${KOLOM_SALDO}
     FROM shipments s ${JOIN_SALDO} LEFT JOIN outbound_kondisi k ON k.receipt=s.receipt
     WHERE ${SHIP_STATUS} IN ('DELIVERED','RTS','LOST') AND date(${SHIP_SELESAI},'+7 hours') BETWEEN ? AND ?`).bind(from, to).all<PaketSelesai>();

  // Order Scalev pasangan paket: remark1 = nomor order, atau resi sama
  const rk = [...new Set(paket.results.map(p => p.rk).filter(Boolean))], resi = [...new Set(paket.results.map(p => p.receipt).filter(Boolean))];
  const [orders, hitung, brg, hitungPcs] = await Promise.all([
    db.prepare(
      `SELECT o.gross_revenue, ${KOLOM_BIAYA} FROM orders o
       WHERE o.is_spam=0 AND (o.order_id IN (SELECT value FROM json_each(?1)) OR o.shipment_receipt IN (SELECT value FROM json_each(?2)))`)
      .bind(JSON.stringify(rk), JSON.stringify(resi)).all<OrderJual>(),
    siapkanBiaya(db, to),   // hanya HPP & Scalev fee yang dipakai; ongkir dihitung per paket di bawah
    siapkanHppBarang(db),
    siapkanPcs(db),   // pcs = qty varian × isi SKU di Manajemen SKU
  ]);
  const perOid = new Map(orders.results.map(o => [o.order_id, o])), perResi = new Map(orders.results.filter(o => o.shipment_receipt).map(o => [o.shipment_receipt!, o]));
  const sudahFee = new Set<string>(), sudahJual = new Set<string>();
  for (const p of paket.results) {
    const o = (p.rk && perOid.get(p.rk)) || (p.receipt && perResi.get(p.receipt)) || null;
    const k = kunci(p, o);
    if (k == null) continue;
    let m = per.get(k);
    if (!m) { m = buat(k); per.set(k, m); }
    const b = o ? hitung(o) : null;
    const { ongkir, estimasi } = ongkirPaket(p);
    if (estimasi) m.ongkir_estimasi++;
    if (o && b && !sudahFee.has(o.order_id)) { sudahFee.add(o.order_id); m.scalev_fee += b.scalev_fee; m.order++; }
    m.kompensasi += Number(p.kompensasi) || 0;
    if (p.st === "DELIVERED") {
      m.paket_kirim++; m.ongkir_kirim += ongkir;
      if (p.is_cod) m.cod_fee += p.inv_cod_fee ?? p.cod_fee ?? 0;
      if (o && b) {
        if (!sudahJual.has(o.order_id)) {
          sudahJual.add(o.order_id); m.pendapatan += Number(o.gross_revenue) || 0; m.hpp += b.hpp; m.pcs += hitungPcs(o).pcs;
          if (b.hpp_kurang) m.hpp_kurang++;
        }
      } else if (p.is_cod) {
        m.tanpa_order++; m.pendapatan += Number(p.nilai_cod) || 0;
        const h = brg.hpp(p.goods, p.tgl);
        if (h == null) m.hpp_kurang++; else m.hpp += h + brg.gudang(p.shipper);
      } else m.tanpa_order_noncod++;   // mis. kirim sampel / pindah gudang: ongkir tetap biaya, tidak ada penjualan
    } else {
      const hilang = p.st === "LOST" || p.kondisi === "hilang";
      if (hilang) m.paket_hilang++; else m.paket_rts++;
      m.ongkir_rts += ongkir; m.gudang_rts += brg.gudang(p.shipper);
      if (hilang || p.kondisi === "rusak") {
        // HPP produk tanpa biaya gudang (sudah dihitung di gudang retur); tanpa pasangan SKU Mengantar → HPP order Scalev
        const h = brg.hpp(p.goods, p.tgl) ?? (b && !b.hpp_kurang ? b.hpp : undefined);
        if (h == null) m.hpp_kurang++; else m.rugi_barang += h;
      }
    }
  }
}

/**
 * Pos Shopee & TikTok Shop per bulan menurut tanggal dana dilepas (laporan penghasilan), sama dengan halaman Penghasilan masing-masing.
 *  - Shopee: penjualan = harga produk + voucher penjual + refund; biaya = platform, Gratis Ongkir XTRA, layanan, promosi, lainnya, pajak;
 *    HPP = isi file Pesanan × HPP Manajemen SKU saat ini. Iklan dari laporan iklan, dibagi rata ke hari-hari periodenya.
 *  - TikTok: penjualan = pendapatan (setelah diskon penjual & refund); semua potongan = pendapatan + penyesuaian − dana dilepas
 *    (ongkir sudah termasuk di fee TikTok), dipisah menjadi ongkir dan biaya lain; HPP hanya pesanan yang barangnya terjual.
 */
async function posMarketplace(db: D1Database, from: string, to: string, per: Map<string, Pos>) {
  const BIAYA_SHP = "(h.biaya_platform+h.biaya_gox+h.biaya_layanan+h.biaya_promosi+h.biaya_lainnya+h.pajak)";
  const [shp, tt, iklanShp, iklanTt] = await db.batch([
    db.prepare(
      `SELECT substr(h.dilepas,1,7) AS bln, COUNT(*) AS n, SUM(h.harga_produk+h.voucher+h.refund) AS jual, SUM(-${BIAYA_SHP}) AS biaya, SUM(-h.ongkir) AS ongkir,
         SUM(${SHP_HPP}) AS hpp, SUM(NOT ${SHP_ADA} OR ${SHP_SKU_KOSONG}) AS hpp_kurang
       FROM shopee_penghasilan h WHERE h.dilepas BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(
      `SELECT substr(h.dilepas,1,7) AS bln, SUM(h.jenis='Pesanan') AS n, SUM(h.pendapatan) AS jual, SUM(h.penyesuaian) AS peny,
         SUM(h.pendapatan+h.penyesuaian-h.total) AS potongan, SUM(-h.biaya_ongkir) AS ongkir, SUM(${TT_HPP_LAKU}) AS hpp,
         SUM(h.jenis='Pesanan' AND h.pendapatan>0 AND (NOT ${TT_ADA} OR ${TT_SKU_KOSONG})) AS hpp_kurang
       FROM tiktok_penghasilan h WHERE h.dilepas BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(SQL_IKLAN_SHP).bind(to, from),
    db.prepare("SELECT substr(tgl,1,7) AS bln, SUM(biaya) AS biaya FROM tiktok_iklan WHERE tgl BETWEEN ? AND ? GROUP BY 1").bind(from, to),
  ]) as D1Result<Record<string, any>>[];
  for (const r of shp.results) {
    const m = per.get(r.bln); if (!m) continue;
    m.shp_n += r.n; m.shp_jual += r.jual; m.shp_biaya += r.biaya; m.shp_ongkir += r.ongkir; m.shp_hpp += r.hpp ?? 0; m.shp_hpp_kurang += r.hpp_kurang;
  }
  for (const r of tt.results) {
    const m = per.get(r.bln); if (!m) continue;
    m.tt_n += r.n; m.tt_jual += r.jual; m.tt_peny += r.peny; m.tt_ongkir += r.ongkir; m.tt_biaya += r.potongan - r.ongkir; m.tt_hpp += r.hpp ?? 0; m.tt_hpp_kurang += r.hpp_kurang;
  }
  for (const [bln, v] of iklanShopeeBulanan(iklanShp.results, from, to)) { const m = per.get(bln); if (m) m.shp_iklan += v; }
  for (const r of iklanTt.results) { const m = per.get(r.bln); if (m) m.tt_iklan += Number(r.biaya) || 0; }
}
const SQL_IKLAN_SHP = `SELECT l.dari, l.sampai, (SELECT SUM(i.biaya) FROM shopee_iklan i WHERE i.laporan_id=l.id) AS biaya
  FROM shopee_iklan_laporan l WHERE l.dari<=? AND l.sampai>=?`;   // bind(to, from)
/** Laporan iklan Shopee bisa lebih dari satu hari: biayanya dibagi rata per hari, hanya hari di dalam rentang yang dihitung → per bulan */
function iklanShopeeBulanan(laporan: Record<string, any>[], from: string, to: string) {
  const per = new Map<string, number>();
  for (const l of laporan) {
    const hari: string[] = [];
    for (let d = new Date(`${l.dari}T00:00:00Z`); d.toISOString().slice(0, 10) <= l.sampai; d.setUTCDate(d.getUTCDate() + 1)) hari.push(d.toISOString().slice(0, 10));
    for (const h of hari) if (h >= from && h <= to) per.set(h.slice(0, 7), (per.get(h.slice(0, 7)) ?? 0) + (Number(l.biaya) || 0) / hari.length);
  }
  return per;
}

/**
 * Laba Rugi per bulan semua platform: Scalev / website menurut tanggal paket Mengantar selesai (lihat posPaket), Shopee & TikTok menurut
 * tanggal dana dilepas (posMarketplace); iklan & biaya operasional menurut tanggalnya sendiri.
 */
laporan.get("/laba-rugi", async c => {
  const { bulan, from, to } = rentangBulan(c);
  const db = c.env.DB;
  const per = new Map<string, Bulan>(bulan.map(b => [b, { bulan: b, ops: {}, ...posNol() }]));
  const [iklan, ops, mulai, mp] = await db.batch([
    db.prepare(SQL_IKLAN_PERIODE).bind(from, to, from, to, from, to),
    db.prepare(SQL_OPS).bind(from, to),
    db.prepare("SELECT MIN(date(created_at,'+7 hours')) AS t FROM shipments"),
    db.prepare(`SELECT (SELECT MIN(dilepas) FROM shopee_penghasilan) AS shp_mulai, (SELECT MAX(dilepas) FROM shopee_penghasilan) AS shp_sampai,
      (SELECT MIN(dilepas) FROM tiktok_penghasilan) AS tt_mulai, (SELECT MAX(dilepas) FROM tiktok_penghasilan) AS tt_sampai,
      (SELECT MAX(sampai) FROM shopee_iklan_laporan) AS shp_iklan_sampai, (SELECT MAX(tgl) FROM tiktok_iklan) AS tt_iklan_sampai`),
  ]) as [D1Result<{ bln: string; iklan: number; luar: number }>, D1Result<{ bln: string; kategori: string; jumlah: number }>, D1Result<{ t: string | null }>,
    D1Result<Record<string, string | null>>];
  await Promise.all([
    posPaket(db, from, to, p => per.has(p.tgl.slice(0, 7)) ? p.tgl.slice(0, 7) : null, b => ({ bulan: b, ops: {}, ...posNol() }), per),
    posMarketplace(db, from, to, per),
  ]);
  for (const r of iklan.results) { const m = per.get(r.bln); if (m) { m.iklan += r.iklan; m.iklan_luar += r.luar; } }
  for (const r of ops.results) { const m = per.get(r.bln); if (m) { m.ops[r.kategori] = r.jumlah; m.operasional += r.jumlah; } }
  const rows = [...per.values()].map(bulatkan);
  return c.json({ bulan, from, to, rows, data_mulai: mulai.results[0]?.t ?? null, marketplace: mp.results[0] ?? {}, hari_ini: todayReport() });
});

/**
 * Margin Produk per gabungan produk (Data Produk), rentang tanggal paket selesai — pos sama dengan Laba Rugi.
 *  - Order → gabungan lewat nama produk order (dicocokkan ke katalog seperti halaman Data Produk); order berisi beberapa
 *    gabungan masuk ke gabungan produk pertamanya. Order tanpa gabungan → "Belum dikelompokkan"; paket tanpa order Scalev → baris sendiri.
 *  - Iklan (campaign dengan order Scalev, sama dengan Laba Rugi) → gabungan lewat kode gabungan di nama campaign (sama dengan halaman Iklan Meta).
 * Margin produk = pendapatan − HPP; contribution margin = pendapatan − semua biaya variabel (HPP, kerugian retur, ongkir, gudang retur, fee, iklan).
 */
const BELUM = "(belum dikelompokkan)", TANPA_ORDER = "(paket tanpa order Scalev)";
laporan.get("/margin-produk", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "";
  if (!TGL.test(from) || !TGL.test(to)) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB;
  type Baris = Pos & { nama: string };
  const [gab, katalog, iklan] = await db.batch([
    db.prepare("SELECT name, items FROM produk_gabungan ORDER BY name"),
    db.prepare("SELECT key, kind, product_id, product_name, name, option_tail, sku, price, cogs, status FROM catalog_items"),
    db.prepare(
      `SELECT cp.name AS campaign, SUM(i.spend) AS spend FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id
       LEFT JOIN campaigns cp ON cp.id=i.campaign_id
       WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? AND ${SCALEV_PERIODE} GROUP BY i.campaign_id`).bind(from, to, from, to),
  ]) as [D1Result<{ name: string; items: string }>, D1Result<ItemKatalog>, D1Result<{ campaign: string | null; spend: number }>];

  const per = new Map<string, Baris>(gab.results.map(g => [g.name, { nama: g.name, ...posNol() }]));
  const gabPerKey = new Map<string, string>();
  for (const g of gab.results) for (const it of JSON.parse(g.items) as { key: string }[]) if (!gabPerKey.has(it.key)) gabPerKey.set(it.key, g.name);
  const perNama = new Map<string, ItemKatalog[]>(), perProduk = new Map<number, ItemKatalog[]>();
  for (const it of katalog.results) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const gabOrder = (o: OrderJual) => {
    let nama: string[] = [];
    try { nama = JSON.parse(o.product_names ?? "[]"); } catch { /* kosong */ }
    for (const n of nama) {
      const it = cocokkan(n, nama.length === 1 && o.product_id != null ? Number(o.product_id) : null, perNama, perProduk);
      const g = gabPerKey.get(it?.key ?? `n:${n}`);
      if (g) return g;
    }
    return BELUM;
  };
  await posPaket(db, from, to, (_, o) => o ? gabOrder(o) : TANPA_ORDER, k => ({ nama: k, ...posNol() }), per);

  // Kode gabungan di nama campaign (token huruf/angka, tanpa beda huruf besar-kecil)
  const kode = new Map(gab.results.map(g => [g.name.trim().toUpperCase(), g.name]));
  for (const r of iklan.results) {
    const g = String(r.campaign ?? "").toUpperCase().split(/[^A-Z0-9]+/).map(t => kode.get(t)).find(Boolean) ?? BELUM;
    let m = per.get(g);
    if (!m) { m = { nama: g, ...posNol() }; per.set(g, m); }
    m.iklan += Number(r.spend) || 0;
  }
  return c.json({ from, to, rows: [...per.values()].map(bulatkan), hari_ini: todayReport() });
});

/**
 * Arus Kas per bulan (uang yang benar-benar bergerak di rekening):
 *  masuk  = pencairan saldo Mengantar ke bank + order transfer (non-COD) yang lunas (menurut tanggal order masuk)
 *           + dana Shopee & TikTok yang dilepas ke saldo penjual (menurut tanggal dilepas, sudah dipotong biaya marketplace);
 *  keluar = top up saldo Mengantar + spend iklan Meta (akun dicentang) + iklan Shopee & TikTok + pembayaran supplier & ongkir Inbound REQ
 *           + biaya operasional. Iklan Shopee yang dibayar lewat isi saldo iklan otomatis dari penghasilan sudah memotong dana dilepas,
 *           jadi hanya sisanya yang dihitung keluar.
 */
laporan.get("/arus-kas", async c => {
  const { bulan, from, to } = rentangBulan(c);
  const db = c.env.DB;
  const [mg, tf, iklan, sup, ongkirReq, ops, shp, tt, iklanShp, iklanTt] = await db.batch([
    db.prepare(
      `SELECT substr(date(created_at,'+7 hours'),1,7) AS bln, SUM(CASE WHEN type='typeWithdraw' THEN amount ELSE 0 END) AS cair,
         SUM(type='typeWithdraw') AS cair_n, SUM(CASE WHEN type='typeAddBalance' THEN amount ELSE 0 END) AS topup
       FROM mengantar_invoices WHERE status='statusCleared' AND date(created_at,'+7 hours') BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(
      `SELECT substr(draft_date,1,7) AS bln, SUM(gross_revenue) AS transfer, COUNT(*) AS transfer_n FROM orders
       WHERE is_spam=0 AND is_cod=0 AND payment_status IN ('paid','settled') AND draft_date BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(SQL_IKLAN).bind(from, to),
    db.prepare(`SELECT substr(tanggal,1,7) AS bln, SUM(jumlah) AS supplier FROM inbound_req_bayar WHERE tanggal BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(`SELECT substr(tanggal,1,7) AS bln, SUM(ongkir) AS ongkir_req FROM inbound_req WHERE status<>'batal' AND tanggal BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(SQL_OPS).bind(from, to),
    db.prepare(`SELECT substr(dilepas,1,7) AS bln, SUM(total) AS shp_cair, COUNT(*) AS shp_cair_n, SUM(ABS(isi_saldo_iklan)) AS shp_isi_iklan
      FROM shopee_penghasilan WHERE dilepas BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(`SELECT substr(dilepas,1,7) AS bln, SUM(total) AS tt_cair, SUM(jenis='Pesanan') AS tt_cair_n FROM tiktok_penghasilan WHERE dilepas BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(SQL_IKLAN_SHP).bind(to, from),
    db.prepare("SELECT substr(tgl,1,7) AS bln, SUM(biaya) AS tt_iklan FROM tiktok_iklan WHERE tgl BETWEEN ? AND ? GROUP BY 1").bind(from, to),
  ]) as D1Result<Record<string, any>>[];
  const per = new Map(bulan.map(b => [b, { bulan: b, cair: 0, cair_n: 0, transfer: 0, transfer_n: 0, topup: 0, iklan: 0, iklan_luar: 0, supplier: 0, ongkir_req: 0,
    shp_cair: 0, shp_cair_n: 0, shp_isi_iklan: 0, shp_iklan: 0, shp_iklan_spend: 0, tt_cair: 0, tt_cair_n: 0, tt_iklan: 0,
    operasional: 0, ops: {} as Record<string, number> }]));
  for (const res of [mg, tf, sup, ongkirReq, shp, tt, iklanTt])
    for (const r of res.results) { const m = per.get(r.bln) as Record<string, any> | undefined; if (m) for (const k of Object.keys(r)) if (k !== "bln") m[k] += Number(r[k]) || 0; }
  // Iklan lain (campaign tanpa order Scalev) tidak dihitung, sama dengan Ringkasan & Laba Rugi — dikirim terpisah untuk catatan
  for (const r of iklan.results) { const m = per.get(r.bln); if (m) { m.iklan += r.iklan; m.iklan_luar += r.luar; } }
  for (const r of ops.results) { const m = per.get(r.bln); if (m) { m.ops[r.kategori] = r.jumlah; m.operasional += r.jumlah; } }
  // Iklan Shopee keluar dari rekening = spend − bagian yang sudah dibayar dari isi saldo iklan otomatis (memotong dana dilepas)
  for (const [bln, v] of iklanShopeeBulanan(iklanShp.results, from, to)) { const m = per.get(bln); if (m) m.shp_iklan_spend += v; }
  for (const m of per.values()) m.shp_iklan = Math.max(0, m.shp_iklan_spend - m.shp_isi_iklan);
  const bulat = ["iklan", "iklan_luar", "shp_iklan", "shp_iklan_spend"] as const;
  return c.json({ bulan, from, to, rows: [...per.values()].map(m => ({ ...m, ...Object.fromEntries(bulat.map(k => [k, Math.round(m[k])])) })), hari_ini: todayReport() });
});

// ---- Biaya Operasional (input manual)
laporan.get("/biaya", async c => {
  const b = c.req.query("bulan") ?? "", bln = BLN.test(b) ? b : todayReport().slice(0, 7);
  const [rows, kat, tren] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, tanggal, kategori, keterangan, jumlah, oleh, updated_at FROM biaya_operasional WHERE tanggal BETWEEN ? AND ? ORDER BY tanggal, id")
      .bind(`${bln}-01`, akhirBulan(bln)),
    c.env.DB.prepare("SELECT kategori, COUNT(*) AS n FROM biaya_operasional GROUP BY kategori ORDER BY n DESC"),
    // Total 6 bulan terakhir sampai bulan ini, untuk pembanding
    c.env.DB.prepare("SELECT substr(tanggal,1,7) AS bln, SUM(jumlah) AS jumlah FROM biaya_operasional WHERE tanggal BETWEEN ? AND ? GROUP BY 1")
      .bind(`${geserBulan(bln, -5)}-01`, akhirBulan(bln)),
  ]);
  return c.json({ bulan: bln, rows: rows.results, kategori: (kat.results as { kategori: string }[]).map(r => r.kategori), tren: tren.results, hari_ini: todayReport() });
});

/** Tambah / ubah satu biaya: { id?, tanggal, kategori, keterangan?, jumlah } */
laporan.put("/biaya", async c => {
  const b = await c.req.json<{ id?: number; tanggal?: string; kategori?: string; keterangan?: string; jumlah?: number }>();
  const tanggal = String(b.tanggal ?? ""), kategori = String(b.kategori ?? "").trim(), jumlah = Math.round(Number(b.jumlah));
  if (!TGL.test(tanggal)) return c.json({ error: "tanggal harus berformat YYYY-MM-DD" }, 400);
  if (!kategori) return c.json({ error: "kategori wajib diisi" }, 400);
  if (!Number.isFinite(jumlah) || jumlah < 0) return c.json({ error: "jumlah harus angka ≥ 0" }, 400);
  const ket = String(b.keterangan ?? "").trim() || null, now = new Date().toISOString();
  const oleh = await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env);
  if (b.id) {
    const r = await c.env.DB.prepare("UPDATE biaya_operasional SET tanggal=?, kategori=?, keterangan=?, jumlah=?, oleh=?, updated_at=? WHERE id=?")
      .bind(tanggal, kategori, ket, jumlah, oleh, now, b.id).run();
    if (!r.meta.changes) return c.json({ error: "biaya tidak ditemukan" }, 404);
    return c.json({ ok: true, id: b.id });
  }
  const r = await c.env.DB.prepare("INSERT INTO biaya_operasional (tanggal, kategori, keterangan, jumlah, oleh, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(tanggal, kategori, ket, jumlah, oleh, now, now).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

laporan.delete("/biaya/:id", async c => {
  await c.env.DB.prepare("DELETE FROM biaya_operasional WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** Salin semua biaya bulan `dari` ke bulan `ke` (tanggal sama, dibatasi akhir bulan) — untuk biaya rutin. { dari, ke } */
laporan.post("/biaya/salin", async c => {
  const { dari, ke } = await c.req.json<{ dari?: string; ke?: string }>();
  if (!BLN.test(dari ?? "") || !BLN.test(ke ?? "") || dari === ke) return c.json({ error: "bulan asal dan tujuan harus berformat YYYY-MM dan berbeda" }, 400);
  const db = c.env.DB, now = new Date().toISOString(), akhir = akhirBulan(ke!);
  const oleh = await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env);
  const rows = await db.prepare("SELECT tanggal, kategori, keterangan, jumlah FROM biaya_operasional WHERE tanggal BETWEEN ? AND ?")
    .bind(`${dari}-01`, akhirBulan(dari!)).all<{ tanggal: string; kategori: string; keterangan: string | null; jumlah: number }>();
  if (!rows.results.length) return c.json({ error: "bulan asal belum punya biaya" }, 400);
  await db.batch(rows.results.map(r => {
    const t = `${ke}-${r.tanggal.slice(8)}`;
    return db.prepare("INSERT INTO biaya_operasional (tanggal, kategori, keterangan, jumlah, oleh, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(t > akhir ? akhir : t, r.kategori, r.keterangan, r.jumlah, oleh, now, now);
  }));
  return c.json({ ok: true, disalin: rows.results.length });
});
