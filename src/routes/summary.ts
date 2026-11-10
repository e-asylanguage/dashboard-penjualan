import { Hono } from "hono";
import { Env } from "../env";
import { KOLOM_BIAYA, OrderBiaya, siapkanBiaya } from "../lib/biaya";
import { HPP_PESANAN as SHP_HPP } from "./shopee";
import { HPP_LAKU as TT_HPP } from "./tiktok";

/**
 * Laporan › Summary: satu tabel per kanal marketing (Meta, CPAS, Shopee per toko, Shopee Affiliate, Shopee Live,
 * TikTok Ads / Affiliate / Live) untuk rentang tanggal, menurut tanggal pesanan dibuat / iklan tayang.
 * Tiap kanal: spending, result dashboard (klaim platform), real result (pesanan tidak batal), total transaksi (pesanan selesai),
 * omzet, total revenue (= omzet − potongan marketplace − HPP). Net revenue, CPR, ROAS & ROI dihitung di browser.
 *
 * Shopee per toko memakai cara "tanpa dobel" (sama dengan spreadsheet ROI): real & omzet = pesanan toko tidak batal − pesanan Affiliate − pesanan Live;
 * spending = biaya iklan × (1 + PPN 11%) − bonus proteksi ROAS; result dashboard = klik iklan. Shopee Live memakai pesanan dibuat.
 *
 * Kanal marketplace lain yang tidak punya No. Pesanan (iklan TikTok, live TikTok, CPAS) memakai rasio toko pada rentang yang sama:
 *  - real result / transaksi = result dashboard × (pesanan tidak batal ÷ pesanan dibayar) / (pesanan selesai ÷ pesanan dibayar);
 *  - omzet iklan = omzet atribusi × rasio subtotal pesanan valid (atribusi iklan masih termasuk pesanan batal);
 *  - total revenue = omzet × (1 − potongan ÷ harga − biaya lain ÷ harga − HPP ÷ harga) dari penghasilan pesanan yang dibuat
 *    di rentang (acuan 60 hari s/d akhir rentang bila belum ada yang dananya dilepas). Komisi affiliate tidak termasuk potongan
 *    (sudah jadi spending kanal Affiliate), sama dengan kartu kanal di halaman Penghasilan.
 */
export const summary = new Hono<{ Bindings: Env }>();

const TGL = /^\d{4}-\d{2}-\d{2}$/;
type Baris = Record<string, any>;
export type Kanal = { key: string; label: string; grup: "meta" | "shopee" | "tiktok"; spend: number; dashboard: number | null; real: number | null;
  transaksi: number | null; omzet: number; revenue: number | null; ket: string };

const BIAYA_SHP = "(h.biaya_platform+h.biaya_gox+h.biaya_layanan+h.biaya_promosi+h.biaya_lainnya+h.pajak)";
const AMS = `COALESCE(ABS(json_extract(h.rincian,'$."api|order_ams_commission_fee"')), ABS(json_extract(h.rincian,'$."promosi|Biaya Komisi AMS"')), 0)`;
// Potongan Shopee tanpa komisi affiliate, biaya lain (refund, voucher penjual, selisih ongkir) — bernilai positif = biaya
const SHP_RASIO = `SUM(h.harga_produk) AS harga, SUM(-${BIAYA_SHP}-${AMS}) AS pot, SUM(-(h.refund+h.voucher+h.ongkir)) AS lain, SUM(${SHP_HPP}) AS hpp`;
const TT_RASIO = `SUM(h.pendapatan) AS harga, SUM(-h.biaya_total+h.biaya_afiliasi) AS pot, SUM(-h.penyesuaian) AS lain, SUM(${TT_HPP}) AS hpp`;
const STATUS = (laku: string, selesai: string) => `SUM(p.status<>'belum_bayar') AS dibayar, SUM(${laku}) AS laku, SUM(p.status IN (${selesai})) AS selesai,
  SUM(p.subtotal) AS sub_semua, SUM(CASE WHEN ${laku} THEN p.subtotal ELSE 0 END) AS sub_valid`;
const LAKU = "p.status NOT IN ('batal','belum_bayar')";

const hari = (dari: string, sampai: string) => Math.round((Date.parse(sampai + "T00:00:00Z") - Date.parse(dari + "T00:00:00Z")) / 864e5) + 1;
/** Porsi periode laporan [dari, sampai] yang ada di dalam rentang [from, to] */
const porsi = (dari: string, sampai: string, from: string, to: string) => {
  const a = dari > from ? dari : from, b = sampai < to ? sampai : to;
  return a > b ? 0 : hari(a, b) / hari(dari, sampai);
};
const n = (v: unknown) => Number(v) || 0;
/** PPN atas biaya iklan Shopee (spreadsheet ROI: Iklan + Pajak = biaya × 1,11) */
const PPN_IKLAN_SHP = 0.11;

/** Rasio per toko: faktor total revenue (1 − potongan − lain − HPP per Rp harga), rasio pesanan tidak batal / selesai, rasio omzet valid */
function rasio(pen: Baris | undefined, acuan: Baris | undefined, st: Baris | undefined) {
  const r = pen && n(pen.harga) ? pen : acuan && n(acuan.harga) ? acuan : null;
  const f = r ? 1 - (n(r.pot) + n(r.lain) + n(r.hpp)) / n(r.harga) : null;
  const dibayar = n(st?.dibayar);
  return { f, acuan: !!r && r === acuan, laku: dibayar ? n(st?.laku) / dibayar : null, selesai: dibayar ? n(st?.selesai) / dibayar : null,
    valid: n(st?.sub_semua) ? n(st?.sub_valid) / n(st?.sub_semua) : 1 };
}
type Rasio = ReturnType<typeof rasio>;
const kali = (x: number | null, r: number | null) => x == null || r == null ? null : x * r;
const catatanRasio = (r: Rasio) => r.f == null ? "total revenue belum bisa dihitung — belum ada penghasilan (dana dilepas) sebagai acuan potongan & HPP"
  : r.acuan ? "potongan & HPP dari acuan 60 hari (belum ada dana dilepas untuk pesanan di rentang ini)" : "";

summary.get("/", async c => {
  const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "";
  if (!TGL.test(from) || !TGL.test(to) || from > to) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  const db = c.env.DB, acuanDari = new Date(Date.parse(to + "T00:00:00Z") - 59 * 864e5).toISOString().slice(0, 10);
  const SCALEV = "i.campaign_id IN (SELECT utm_campaign FROM orders WHERE utm_campaign IS NOT NULL AND is_spam=0)";
  const [metaSpend, metaOrder, shpToko, shpPen, shpAcuan, shpStatus, shpIklan, shpBonus, shpAff, shpAffToko, shpSampel, shpLive, cpas,
    ttPen, ttAcuan, ttStatus, ttIklan, ttAff, ttLive, ttLiveBiaya] = await db.batch([
    // Meta: hanya campaign yang menghasilkan order Scalev (sama dengan Ringkasan & Laba Rugi), spend + tax + admin per ad account
    db.prepare(`SELECT SUM(i.spend*(1+(COALESCE(a.tax_pct,0)+COALESCE(a.admin_pct,0))/100.0)) AS spend, SUM(i.spend) AS spend_asli, SUM(i.pixel_purchases) AS pembelian
      FROM ad_insights_daily i JOIN ad_accounts a ON a.id=i.account_id WHERE a.is_selected=1 AND i.date BETWEEN ? AND ? AND ${SCALEV}`).bind(from, to),
    db.prepare(`SELECT o.id, ${KOLOM_BIAYA}, o.gross_revenue FROM orders o JOIN campaigns cp ON cp.id=o.utm_campaign JOIN ad_accounts a ON a.id=cp.account_id
      WHERE o.is_spam=0 AND a.is_selected=1 AND o.draft_date BETWEEN ? AND ?
        AND o.status IN ('confirmed','in_process','ready','shipped','shipped_rts','completed','rts')`).bind(from, to),
    db.prepare("SELECT id, nama FROM shopee_toko ORDER BY id"),
    db.prepare(`SELECT h.toko_id, ${SHP_RASIO} FROM shopee_penghasilan h WHERE h.dibuat BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    db.prepare(`SELECT h.toko_id, ${SHP_RASIO} FROM shopee_penghasilan h WHERE h.dibuat BETWEEN ? AND ? GROUP BY 1`).bind(acuanDari, to),
    db.prepare(`SELECT p.toko_id, ${STATUS(LAKU, "'diterima','selesai'")} FROM shopee_pesanan p WHERE substr(p.dibuat,1,10) BETWEEN ? AND ? GROUP BY 1`).bind(from, to),
    // Iklan Shopee: hanya laporan yang seluruh periodenya di dalam rentang (sama dengan halaman Iklan Shopee)
    db.prepare(`SELECT l.toko_id, SUM(i.biaya) AS biaya, SUM(i.klik) AS klik, SUM(i.konversi) AS konversi, SUM(i.omzet) AS omzet
      FROM shopee_iklan_laporan l JOIN shopee_iklan i ON i.laporan_id=l.id WHERE l.dari>=? AND l.sampai<=? GROUP BY 1`).bind(from, to),
    db.prepare("SELECT toko_id, SUM(nominal) AS bonus FROM shopee_iklan_bonus WHERE tgl BETWEEN ? AND ? GROUP BY 1").bind(from, to),
    // Affiliate Shopee: pesanan berkomisi AMS yang dananya sudah dilepas, menurut tanggal pesanan dibuat
    db.prepare(`SELECT COUNT(*) AS n, SUM(${AMS}) AS komisi, ${SHP_RASIO} FROM shopee_penghasilan h WHERE h.dibuat BETWEEN ? AND ? AND ${AMS}>0`).bind(from, to),
    // Pesanan affiliate per toko (tidak batal) — dikeluarkan dari kanal Shopee supaya tidak dihitung dobel
    db.prepare(`SELECT p.toko_id, COUNT(*) AS n, SUM(p.subtotal) AS omzet FROM shopee_penghasilan h JOIN shopee_pesanan p ON p.no_pesanan=h.no_pesanan
      WHERE h.dibuat BETWEEN ? AND ? AND ${AMS}>0 AND ${LAKU} GROUP BY 1`).bind(from, to),
    db.prepare("SELECT COUNT(*) AS n, SUM(nilai) AS nilai FROM shopee_affiliate_sampel WHERE tgl BETWEEN ? AND ?").bind(from, to),
    db.prepare("SELECT toko_id, dari, sampai, omzet_dibuat, pesanan_dibuat, spending FROM shopee_live WHERE dari<=? AND sampai>=?").bind(to, from),
    db.prepare("SELECT toko_id, biaya, omzet, konversi FROM shopee_iklan_cpas WHERE dari>=? AND sampai<=?").bind(from, to),
    // TikTok Shop (semua toko digabung)
    db.prepare(`SELECT ${TT_RASIO} FROM tiktok_penghasilan h WHERE COALESCE(h.dibuat,h.dilepas) BETWEEN ? AND ?`).bind(from, to),
    db.prepare(`SELECT ${TT_RASIO} FROM tiktok_penghasilan h WHERE COALESCE(h.dibuat,h.dilepas) BETWEEN ? AND ?`).bind(acuanDari, to),
    db.prepare(`SELECT ${STATUS(LAKU, "'selesai'")} FROM tiktok_pesanan p WHERE substr(p.dibuat,1,10) BETWEEN ? AND ?`).bind(from, to),
    db.prepare("SELECT SUM(biaya) AS biaya, SUM(pesanan) AS pesanan, SUM(omzet) AS omzet FROM tiktok_iklan WHERE tgl BETWEEN ? AND ?").bind(from, to),
    db.prepare(`SELECT COUNT(*) AS n, SUM(-h.biaya_afiliasi) AS komisi, ${TT_RASIO} FROM tiktok_penghasilan h
      WHERE COALESCE(h.dibuat,h.dilepas) BETWEEN ? AND ? AND h.biaya_afiliasi<0`).bind(from, to),
    db.prepare("SELECT SUM(omzet) AS omzet, SUM(pesanan) AS pesanan FROM tiktok_live WHERE tgl BETWEEN ? AND ?").bind(from, to),
    db.prepare("SELECT dari, sampai, spending FROM tiktok_live_biaya WHERE dari<=? AND sampai>=?").bind(to, from),
  ]) as D1Result<Baris>[];

  const kanal: Kanal[] = [];
  const satu = (r: D1Result<Baris>) => r.results[0] ?? {};

  // ---- Meta (Facebook → Scalev): result dashboard = pembelian pixel; real = order closing; transaksi = order completed
  const hitung = await siapkanBiaya(db, from);
  let mOmzet = 0, mBiaya = 0, mSelesai = 0;
  for (const o of metaOrder.results as (OrderBiaya & { gross_revenue: number })[]) {
    const b = hitung(o);
    mOmzet += n(o.gross_revenue); mBiaya += b.hpp + b.scalev_fee + b.ongkir + b.cod_fee;
    if (o.status === "completed") mSelesai++;
  }
  const ms = satu(metaSpend);
  kanal.push({ key: "meta", label: "Facebook", grup: "meta", spend: n(ms.spend), dashboard: n(ms.pembelian), real: metaOrder.results.length, transaksi: mSelesai,
    omzet: mOmzet, revenue: mOmzet - mBiaya,
    ket: "Iklan Meta untuk campaign yang menghasilkan order Scalev · spending termasuk tax & admin (Pengaturan › Sinkronisasi Meta Ads)" +
      (n(ms.spend) > n(ms.spend_asli) ? ` · spend asli ${Math.round(n(ms.spend_asli))}` : "") +
      " · result dashboard = pembelian pixel · real = order closing · transaksi = order completed · total revenue = omzet − HPP − ongkir − COD fee − Scalev fee" });

  // ---- Shopee: rasio per toko
  const per = <T extends Baris>(r: D1Result<T>) => new Map(r.results.map(x => [Number(x.toko_id), x]));
  const pen = per(shpPen), acu = per(shpAcuan), st = per(shpStatus), ikl = per(shpIklan), bon = per(shpBonus);
  const rToko = new Map<number, Rasio>();
  for (const t of shpToko.results) rToko.set(Number(t.id), rasio(pen.get(Number(t.id)), acu.get(Number(t.id)), st.get(Number(t.id))));
  const rShp = rasio(shpPen.results.reduce(gabung, {}), shpAcuan.results.reduce(gabung, {}), shpStatus.results.reduce(gabung, {}));

  // CPAS (Meta → Shopee, manual)
  let cp = { spend: 0, konversi: 0, omzet: 0, revenue: 0, revenueAda: true };
  for (const x of cpas.results) {
    const r = rToko.get(Number(x.toko_id)) ?? rShp;
    cp.spend += n(x.biaya); cp.konversi += n(x.konversi); cp.omzet += n(x.omzet);
    if (r.f == null) cp.revenueAda = false; else cp.revenue += n(x.omzet) * r.f;
  }
  kanal.push({ key: "cpas", label: "CPAS", grup: "meta", spend: cp.spend, dashboard: cp.konversi, real: null, transaksi: null, omzet: cp.omzet,
    revenue: cp.revenueAda ? cp.revenue : null,
    ket: "Dicatat manual di Shopee › Iklan (hanya periode di dalam rentang) · omzet = nilai konversi Meta · real result & transaksi tidak tersedia (Meta tidak memberi No. Pesanan)" });

  // Shopee Affiliate (semua toko): spending = komisi AMS + sampel produk
  const af = satu(shpAff), smp = satu(shpSampel);
  kanal.push({ key: "shp_aff", label: "Shopee Affiliate", grup: "shopee", spend: n(af.komisi) + n(smp.nilai), dashboard: n(af.n), real: n(af.n), transaksi: n(af.n),
    omzet: n(af.harga), revenue: n(af.harga) - n(af.pot) - n(af.lain) - n(af.hpp),
    ket: "Pesanan berkomisi AMS yang dananya sudah dilepas (status affiliate baru diketahui saat dana dilepas) · spending = komisi" +
      (n(smp.nilai) ? ` + sampel produk (${n(smp.n)} kiriman)` : "") });

  // Shopee Live: laporan dibagi rata per hari, hanya hari di dalam rentang · menurut pesanan dibuat (sama dengan spreadsheet ROI)
  const liveToko = new Map<number, { pesanan: number; omzet: number }>();
  let lv = { spend: 0, pesanan: 0, omzet: 0, revenue: 0, selesai: 0 as number | null };
  for (const x of shpLive.results) {
    const k = porsi(x.dari, x.sampai, from, to), id = Number(x.toko_id), r = rToko.get(id) ?? rShp;
    const p = n(x.pesanan_dibuat) * k, o = n(x.omzet_dibuat) * k, lt = liveToko.get(id) ?? { pesanan: 0, omzet: 0 };
    lt.pesanan += p; lt.omzet += o; liveToko.set(id, lt);
    lv.spend += n(x.spending) * k; lv.pesanan += p; lv.omzet += o;
    lv.revenue += r.f == null ? 0 : o * r.f;
    lv.selesai = lv.selesai == null || r.selesai == null ? null : lv.selesai + p * r.selesai;
  }

  // Shopee per toko, tanpa dobel: pesanan toko tidak batal − pesanan Affiliate − pesanan Live (tiap pesanan dihitung di satu kanal saja)
  const afToko = per(shpAffToko);
  for (const t of shpToko.results) {
    const id = Number(t.id), x = ikl.get(id), r = rToko.get(id)!, bonus = n(bon.get(id)?.bonus), s0 = st.get(id);
    const af = afToko.get(id), lt = liveToko.get(id);
    const real = Math.max(0, n(s0?.laku) - n(af?.n) - n(lt?.pesanan));
    const omzet = Math.max(0, n(s0?.sub_valid) - n(af?.omzet) - n(lt?.omzet));
    if (!x && !bonus && !real) continue;
    const pkSelesai = n(s0?.laku) ? n(s0?.selesai) / n(s0?.laku) : null;
    kanal.push({ key: `shp_${id}`, label: shpToko.results.length > 1 ? `Shopee ${t.nama}` : "Shopee", grup: "shopee",
      spend: n(x?.biaya) * (1 + PPN_IKLAN_SHP) - bonus, dashboard: n(x?.klik), real, transaksi: kali(real, pkSelesai), omzet,
      revenue: r.f == null ? null : omzet * r.f,
      ket: `Spending = biaya iklan + PPN ${PPN_IKLAN_SHP * 100}%` + (bonus ? " − bonus proteksi ROAS" : "") +
        " (laporan iklan yang seluruh periodenya di dalam rentang) · result dashboard = klik iklan" +
        " · real / omzet = pesanan toko tidak batal dikurangi pesanan Affiliate & Live (tanpa dobel) · transaksi diperkirakan dari rasio pesanan selesai" +
        (catatanRasio(r) ? " · " + catatanRasio(r) : "") });
  }

  kanal.push({ key: "shp_live", label: "Shopee Live", grup: "shopee", spend: lv.spend, dashboard: lv.pesanan, real: lv.pesanan, transaksi: lv.selesai,
    omzet: lv.omzet, revenue: lv.revenue,
    ket: "Laporan Shopee Live (dibagi rata per hari) · result & real = pesanan dibuat · omzet = penjualan pesanan dibuat · spending diisi manual di Penghasilan Shopee" });

  // ---- TikTok Shop
  const rTt = rasio(satu(ttPen), satu(ttAcuan), satu(ttStatus)), ti = satu(ttIklan);
  const tOmzet = n(ti.omzet) * rTt.valid;
  kanal.push({ key: "tt_ads", label: "TikTok Ads", grup: "tiktok", spend: n(ti.biaya), dashboard: n(ti.pesanan), real: kali(n(ti.pesanan), rTt.laku),
    transaksi: kali(n(ti.pesanan), rTt.selesai), omzet: tOmzet, revenue: rTt.f == null ? null : tOmzet * rTt.f,
    ket: "Laporan iklan TikTok · result dashboard = pesanan SKU · real / transaksi diperkirakan dari rasio pesanan · omzet × rasio pesanan tidak batal" +
      (catatanRasio(rTt) ? " · " + catatanRasio(rTt) : "") });
  const ta = satu(ttAff);
  kanal.push({ key: "tt_aff", label: "TikTok Affiliate", grup: "tiktok", spend: n(ta.komisi), dashboard: n(ta.n), real: n(ta.n), transaksi: n(ta.n),
    omzet: n(ta.harga), revenue: n(ta.harga) - n(ta.pot) - n(ta.lain) - n(ta.hpp),
    ket: "Transaksi dengan komisi afiliasi yang dananya sudah dibayarkan · spending = komisi afiliasi" });
  const tl = satu(ttLive), tlSpend = ttLiveBiaya.results.reduce((a, x) => a + n(x.spending) * porsi(x.dari, x.sampai, from, to), 0);
  kanal.push({ key: "tt_live", label: "TikTok Live", grup: "tiktok", spend: tlSpend, dashboard: n(tl.pesanan), real: kali(n(tl.pesanan), rTt.laku),
    transaksi: kali(n(tl.pesanan), rTt.selesai), omzet: n(tl.omzet), revenue: rTt.f == null ? null : n(tl.omzet) * rTt.f,
    ket: "Laporan TikTok Live per hari · spending = biaya live manual (dibagi rata per hari) · real / transaksi diperkirakan dari rasio pesanan" });

  const bulat = (v: number | null) => v == null ? null : Math.round(v * 10) / 10;
  return c.json({ from, to, kanal: kanal.map(k => ({ ...k, spend: Math.round(k.spend), omzet: Math.round(k.omzet), revenue: k.revenue == null ? null : Math.round(k.revenue),
    dashboard: bulat(k.dashboard), real: bulat(k.real), transaksi: bulat(k.transaksi) })) });
});

/** Jumlahkan kolom angka beberapa baris (untuk rasio semua toko) */
function gabung(a: Baris, b: Baris) {
  for (const k of Object.keys(b)) if (k !== "toko_id" && typeof b[k] === "number") a[k] = (a[k] ?? 0) + b[k];
  return a;
}
