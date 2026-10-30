import { Env } from "../env";
import { ShopeeApi } from "./shopee-api";
import { simpanPesananShopee, simpanPenghasilanShopee, PesananIn, PenghasilanIn } from "../routes/shopee";

/**
 * Sinkron Shopee Open API untuk toko dashboard bermode 'api' yang sudah diizinkan (shopee_api_toko, host live),
 * dicocokkan lewat shop_id. Hasil masuk ke tabel yang sama dengan upload file, sumber = 'api'.
 *  - Pesanan: get_order_list menurut update_time (jendela ≤ 15 hari) sejak sinkron terakhir − 1 jam (awal 30 hari),
 *    lalu get_order_detail per 50. Data pembeli tidak disimpan (hanya kota & provinsi bila tidak disamarkan).
 *  - Penghasilan: get_escrow_list menurut tanggal dana dilepas (awal 30 hari), lalu rincian dana per pesanan.
 * Batas per jalan supaya tidak melewati batas subrequest Worker; sisanya diteruskan sinkron berikutnya.
 */
type Obj = Record<string, any>;
const num = (v: unknown) => Number(v) || 0;
/** Unix detik → "YYYY-MM-DD HH:MM" WIB (format sama dengan file ekspor) */
const wib = (t: unknown) => Number(t) > 0 ? new Date((Number(t) + 7 * 3600) * 1000).toISOString().slice(0, 16).replace("T", " ") : undefined;
const HARI = 86400, JENDELA = 15 * HARI;

/** Status API → teks seperti di file ekspor (dibaca statusPesanan) */
const STATUS: Record<string, string> = { UNPAID: "Belum Bayar", INVOICE_PENDING: "Belum Bayar", READY_TO_SHIP: "Perlu Dikirim", PROCESSED: "Perlu Dikirim",
  RETRY_SHIP: "Perlu Dikirim", SHIPPED: "Sedang Dikirim", TO_CONFIRM_RECEIVE: "Telah Dikirim", COMPLETED: "Selesai", IN_CANCEL: "Batal (dalam proses)",
  CANCELLED: "Batal", TO_RETURN: "Pengembalian" };
const bersih = (v: unknown) => { const s = String(v ?? "").trim(); return s && !s.includes("*") ? s : undefined; };   // nilai disamarkan Shopee → kosong

function pesananDariApi(o: Obj): PesananIn {
  const alamat: Obj = o.recipient_address ?? {};
  return {
    no_pesanan: o.order_sn, status_asli: STATUS[o.order_status] ?? o.order_status, alasan_batal: o.cancel_reason || o.buyer_cancel_reason || undefined,
    kurir: o.shipping_carrier, batas_kirim: wib(o.ship_by_date), waktu_kirim: wib(o.pickup_done_time), dibuat: wib(o.create_time), dibayar: wib(o.pay_time),
    selesai: o.order_status === "COMPLETED" ? wib(o.update_time) : undefined, metode_bayar: o.cod ? "COD" : o.payment_method,
    total_bayar: num(o.total_amount), perkiraan_ongkir: num(o.estimated_shipping_fee), ongkir_pembeli: num(o.actual_shipping_fee),
    kota: bersih(alamat.city), provinsi: bersih(alamat.state),
    // Pengiriman Kilat = dikirim dari stok di gudang Shopee
    kilat: o.fulfillment_flag ? o.fulfillment_flag === "fulfilled_by_shopee" : undefined,
    items: ((o.item_list ?? []) as Obj[]).map(i => ({ sku: i.model_sku || i.item_sku, sku_induk: i.item_sku, nama: i.item_name, variasi: i.model_name,
      harga_awal: num(i.model_original_price), harga: num(i.model_discounted_price), qty: num(i.model_quantity_purchased) || 1, qty_retur: 0 })),
  };
}

/**
 * Rincian dana (order_income) → kelompok yang sama dengan file Penghasilan. Selisih yang tidak terpetakan masuk "lainnya",
 * jadi jumlah kelompok selalu = escrow_amount (dana dilepas). Semua komponen asli disimpan di rincian.
 */
function penghasilanDariApi(sn: string, dilepas: number, i: Obj, buyer: Obj): PenghasilanIn {
  const neg = (v: unknown) => -Math.abs(num(v));
  const harga = num(i.original_price) - Math.abs(num(i.seller_discount));
  const refund = neg(i.seller_return_refund) + neg(i.drc_adjustable_refund);
  const ongkir = num(i.buyer_paid_shipping_fee) + num(i.shopee_shipping_rebate) + num(i.shipping_fee_discount_from_3pl) - Math.abs(num(i.actual_shipping_fee)) - Math.abs(num(i.reverse_shipping_fee));
  const voucher = neg(i.voucher_from_seller) + neg(i.seller_coin_cash_back);
  const platform = neg(i.commission_fee) + neg(i.seller_order_processing_fee);
  // service_fee API = Biaya Pembayaran + Gratis Ongkir XTRA + Layanan Promo XTRA + Live XTRA (tidak dirinci API).
  // credit_card_transaction_fee = biaya transaksi yang dibayar pembeli, bukan potongan penjual.
  const layanan = neg(i.service_fee) + neg(i.seller_transaction_fee);
  const promosi = neg(i.order_ams_commission_fee) + neg(i.campaign_fee);
  const pajak = neg(i.escrow_tax) + neg(i.withholding_tax);
  const total = num(i.escrow_amount);
  const rincian: Record<string, number> = {};
  for (const [k, v] of Object.entries(i)) if (typeof v === "number" && v && k !== "escrow_amount") rincian[`api|${k}`] = v;
  return { no_pesanan: sn, dilepas: wib(dilepas)?.slice(0, 10), harga_produk: harga, refund, ongkir, voucher, biaya_platform: platform, biaya_gox: 0,
    biaya_layanan: layanan, biaya_promosi: promosi, pajak, isi_saldo_iklan: 0,
    biaya_lainnya: total - (harga + refund + ongkir + voucher + platform + layanan + promosi + pajak), total,
    dibayar_pembeli: num(buyer.buyer_total_amount), metode_bayar: buyer.buyer_payment_method, rincian,
    produk: ((i.items ?? []) as Obj[]).map(x => ({ id: String(x.item_id ?? ""), nama: x.item_name })) };
}

async function kv(db: D1Database, k: string, v?: string) {
  if (v === undefined) return (await db.prepare("SELECT value FROM kv WHERE key=?").bind(k).first<{ value: string }>())?.value;
  await db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, v).run();
}

/** Tanggal WIB "YYYY-MM-DD" ↔ format Ads API "DD-MM-YYYY" */
const tglWib = (t: number) => new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
const keAds = (ymd: string) => ymd.split("-").reverse().join("-");
const dariAds = (s: unknown) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s ?? "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s ?? "").slice(0, 10); };
const geser = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * HARI * 1000).toISOString().slice(0, 10);
/** Angka metrik iklan; nama field Ads API berbeda antar versi, jadi dicoba beberapa */
const ambil = (m: Obj, ...k: string[]) => { for (const x of k) if (m[x] != null && m[x] !== "") return Math.max(0, Math.round(num(m[x]))); return 0; };
const BIDDING: Record<string, string> = { auto: "Iklan Produk Otomatis", manual: "Manual", gmv_max_roas: "GMV Max ROAS", gmv_max: "GMV Max" };
const PENEMPATAN: Record<string, string> = { search: "Pencarian", discovery: "Rekomendasi", all: "Semua", search_and_discovery: "Semua" };

/**
 * Iklan (Ads API): performa harian per kampanye iklan produk → satu laporan per toko × hari (sumber 'api'), jadi bisa difilter per tanggal.
 * Selisih total CPC toko dengan jumlah kampanye (mis. iklan toko) masuk baris "Iklan lainnya" supaya total sama dengan Seller Centre.
 * Hari yang sudah tercakup laporan upload file dilewati (laporan file berisi total satu periode, tidak bisa dipotong per hari).
 */
async function sinkronIklan(db: D1Database, api: ShopeeApi, t: { id: number; shop_id: string }, kini: number, hariMundur?: number) {
  const kunci = `shopee_sync_iklan:${t.shop_id}`, terakhir = await kv(db, kunci);
  const hariIni = tglWib(kini);
  // Data iklan beberapa hari terakhir masih bisa berubah → selalu tarik ulang 3 hari terakhir
  let dari = hariMundur ? geser(hariIni, -hariMundur) : terakhir ? geser(terakhir, -3) : geser(hariIni, -30);
  // Kampanye iklan produk (semua status)
  const idList: string[] = [];
  for (let off = 0, hal = 0; hal < 20; hal++, off += 100) {
    const d = await api.panggil<Obj>(t.shop_id, "/api/v2/ads/get_product_level_campaign_id_list", { ad_type: "", offset: off, limit: 100 });
    for (const c of (d.campaign_list ?? []) as Obj[]) if (c.campaign_id != null) idList.push(String(c.campaign_id));
    if (!d.has_next_page) break;
  }
  const info = new Map<string, Obj>();
  for (let i = 0; i < idList.length; i += 100) {
    const d = await api.panggil<Obj>(t.shop_id, "/api/v2/ads/get_product_level_campaign_setting_info",
      { campaign_id_list: idList.slice(i, i + 100).join(","), info_type_list: "1" });
    for (const c of (d.campaign_list ?? []) as Obj[]) info.set(String(c.campaign_id), c.common_info ?? {});
  }
  let nHari = 0, nBaris = 0;
  const dilewati: string[] = [];
  while (dari <= hariIni) {
    const sampai = [geser(dari, 29), hariIni].sort()[0];           // ≤ 30 hari per permintaan
    type Baris = Obj & { _hari: string };
    const per = new Map<string, Baris[]>();
    for (let i = 0; i < idList.length; i += 100) {
      const d = await api.panggil<Obj>(t.shop_id, "/api/v2/ads/get_product_campaign_daily_performance",
        { start_date: keAds(dari), end_date: keAds(sampai), campaign_id_list: idList.slice(i, i + 100).join(",") });
      for (const c of (d.campaign_list ?? []) as Obj[]) {
        const ci = info.get(String(c.campaign_id)) ?? {};
        for (const m of (c.metrics_list ?? []) as Obj[]) {
          const hari = dariAds(m.date);
          const b: Baris = { _hari: hari, ...m, campaign_id: c.campaign_id, ad_name: c.ad_name ?? ci.ad_name, ad_type: c.ad_type ?? ci.ad_type,
            campaign_placement: c.campaign_placement ?? ci.campaign_placement, status: ci.campaign_status, bidding: ci.bidding_method,
            mulai: ci.campaign_duration?.start_time, item: (ci.item_id_list ?? [])[0] };
          if (!ambil(m, "impression") && !ambil(m, "expense") && !ambil(m, "clicks")) continue;
          (per.get(hari) ?? per.set(hari, []).get(hari)!).push(b);
        }
      }
    }
    // Total CPC toko per hari (termasuk iklan toko / lainnya)
    const tot = await api.panggil<Obj>(t.shop_id, "/api/v2/ads/get_all_cpc_ads_daily_performance", { start_date: keAds(dari), end_date: keAds(sampai) });
    const totHari = new Map(((Array.isArray(tot) ? tot : tot.list ?? tot.daily_performance ?? []) as Obj[]).map(m => [dariAds(m.date), m]));
    const file = await db.prepare("SELECT dari, sampai FROM shopee_iklan_laporan WHERE toko_id=? AND sumber='file' AND dari<=? AND sampai>=?")
      .bind(t.id, sampai, dari).all<{ dari: string; sampai: string }>();
    for (let h = dari; h <= sampai; h = geser(h, 1)) {
      if (file.results.some(f => f.dari <= h && f.sampai >= h)) { dilewati.push(h); continue; }
      const rows: Obj[] = (per.get(h) ?? []).map((b): Obj => ({
        nama: String(b.ad_name || `Kampanye ${b.campaign_id}`), status: b.status, jenis: b.ad_type === "gmv_max" ? "GMV Max" : "Iklan Produk",
        kode_produk: b.item != null ? String(b.item) : null, mode_bidding: BIDDING[String(b.bidding ?? b.ad_type)] ?? b.bidding ?? b.ad_type ?? null,
        penempatan: PENEMPATAN[String(b.campaign_placement)] ?? b.campaign_placement ?? null,
        mulai: Number(b.mulai) > 0 ? tglWib(Number(b.mulai)) : null,
        dilihat: ambil(b, "impression"), klik: ambil(b, "clicks"), keranjang: ambil(b, "add_to_cart", "broad_add_to_cart"),
        konversi: ambil(b, "broad_order", "broad_conversions"), konversi_langsung: ambil(b, "direct_order", "direct_conversions"),
        terjual: ambil(b, "broad_item_sold", "broad_order_amount"), terjual_langsung: ambil(b, "direct_item_sold", "direct_order_amount"),
        omzet: ambil(b, "broad_gmv"), omzet_langsung: ambil(b, "direct_gmv"), biaya: ambil(b, "expense"),
      }));
      const m = totHari.get(h);
      if (m) {
        const s = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        const sisa = { biaya: ambil(m, "expense") - s("biaya"), omzet: ambil(m, "broad_gmv") - s("omzet"), dilihat: ambil(m, "impression") - s("dilihat"),
          klik: ambil(m, "clicks") - s("klik"), konversi: ambil(m, "broad_order", "broad_conversions") - s("konversi"),
          konversi_langsung: ambil(m, "direct_order", "direct_conversions") - s("konversi_langsung"),
          terjual: ambil(m, "broad_item_sold", "broad_order_amount") - s("terjual"), terjual_langsung: ambil(m, "direct_item_sold", "direct_order_amount") - s("terjual_langsung"),
          omzet_langsung: ambil(m, "direct_gmv") - s("omzet_langsung") };
        if (sisa.biaya > 0 || sisa.omzet > 0)
          rows.push({ nama: "Iklan lainnya (iklan toko / di luar iklan produk)", status: null, jenis: "Lainnya", kode_produk: null, mode_bidding: null, penempatan: null,
            mulai: null, keranjang: 0, ...Object.fromEntries(Object.entries(sisa).map(([k, v]) => [k, Math.max(0, v)])) as typeof sisa });
      }
      const stmts: D1PreparedStatement[] = [
        db.prepare("DELETE FROM shopee_iklan WHERE laporan_id IN (SELECT id FROM shopee_iklan_laporan WHERE toko_id=? AND sumber='api' AND dari=? AND sampai=?)").bind(t.id, h, h),
        db.prepare("DELETE FROM shopee_iklan_laporan WHERE toko_id=? AND sumber='api' AND dari=? AND sampai=?").bind(t.id, h, h),
      ];
      if (rows.length) {
        stmts.push(db.prepare("INSERT INTO shopee_iklan_laporan (toko_id, dari, sampai, upload_id, created_at, sumber) VALUES (?,?,?,NULL,?,'api')")
          .bind(t.id, h, h, new Date().toISOString()));
        rows.forEach((r, i) => stmts.push(db.prepare(
          `INSERT INTO shopee_iklan (laporan_id, urut, nama, status, jenis, kode_produk, mode_bidding, penempatan, mulai, dilihat, klik, keranjang,
             konversi, konversi_langsung, terjual, terjual_langsung, omzet, omzet_langsung, biaya)
           VALUES ((SELECT MAX(id) FROM shopee_iklan_laporan WHERE toko_id=? AND sumber='api' AND dari=?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(t.id, h, i, r.nama.slice(0, 300), r.status ?? null, r.jenis, r.kode_produk, r.mode_bidding, r.penempatan, r.mulai,
            r.dilihat, r.klik, r.keranjang, r.konversi, r.konversi_langsung, r.terjual, r.terjual_langsung, r.omzet, r.omzet_langsung, r.biaya)));
        nHari++; nBaris += rows.length;
      }
      await db.batch(stmts);
    }
    await kv(db, kunci, sampai);
    dari = geser(sampai, 1);
  }
  return { disimpan: nBaris, hari: nHari, kampanye: idList.length, selesai: true, ...(dilewati.length ? { dilewati_file: dilewati.length } : {}) };
}

export async function syncShopee(env: Env, opsi: { hari?: number } = {}) {
  let api: ShopeeApi;
  try { api = new ShopeeApi(env); } catch { return { ok: false, pesan: "kunci API Shopee belum di-set", hasil: [] as Obj[] }; }
  if (api.sandbox) return { ok: false, pesan: "kunci API Shopee masih kunci uji (sandbox)", hasil: [] as Obj[] };
  const db = env.DB, kini = Math.floor(Date.now() / 1000), hasil: Obj[] = [];
  const toko = await db.prepare(`SELECT t.id, t.nama, t.gudang_id, t.shop_id FROM shopee_toko t
      WHERE t.mode='api' AND EXISTS (SELECT 1 FROM shopee_api_toko a WHERE a.shop_id=t.shop_id AND a.host=?)`).bind(api.host)
    .all<{ id: number; nama: string; gudang_id: number | null; shop_id: string }>();
  for (const t of toko.results) {
    const r: Obj = { toko: t.nama };
    // ---- Pesanan
    try {
      const kunci = `shopee_sync_pesanan:${t.shop_id}`, terakhir = Number(await kv(db, kunci)) || 0;
      let mulai = opsi.hari ? kini - opsi.hari * HARI : terakhir ? terakhir - 3600 : kini - 30 * HARI, n = 0, baru = 0, panggilan = 0, selesai = true;
      const ANGGARAN = 350;                                   // panggilan API pesanan per jalan
      while (mulai < kini) {
        const akhir = Math.min(mulai + JENDELA, kini), sn: string[] = [];
        let cursor = "", hal = 0;
        do {
          const d = await api.panggil<{ order_list?: { order_sn: string }[]; more?: boolean; next_cursor?: string }>(t.shop_id, "/api/v2/order/get_order_list",
            { time_range_field: "update_time", time_from: mulai, time_to: akhir, page_size: 100, cursor }); panggilan++; hal++;
          for (const o of d.order_list ?? []) sn.push(o.order_sn);
          cursor = d.more ? d.next_cursor ?? "" : "";
        } while (cursor && hal < 80 && panggilan < ANGGARAN);
        for (let i = 0; i < sn.length; i += 50) {
          const d = await api.panggil<{ order_list?: Obj[] }>(t.shop_id, "/api/v2/order/get_order_detail", { order_sn_list: sn.slice(i, i + 50).join(","),
            response_optional_fields: "item_list,total_amount,payment_method,shipping_carrier,pay_time,recipient_address,cancel_reason,buyer_cancel_reason,actual_shipping_fee,estimated_shipping_fee,pickup_done_time,fulfillment_flag" });
          panggilan++;
          const h = await simpanPesananShopee(db, { id: t.id, gudang_id: t.gudang_id }, (d.order_list ?? []).map(pesananDariApi), "api", null);
          n += h.disimpan; baru += h.baru;
        }
        if (cursor || panggilan >= ANGGARAN) { selesai = false; break; }   // terlalu banyak untuk satu jalan → lanjut dari jendela ini
        mulai = akhir;
        await kv(db, kunci, String(akhir));
      }
      r.pesanan = { disimpan: n, baru, selesai };
    } catch (e) { r.pesanan = { gagal: String((e as Error).message ?? e) }; }
    // ---- Resi: get_order_detail tidak memuat nomor resi → get_tracking_number per pesanan yang sudah dikirim dan resinya belum ada.
    //      Retur / batal dulu (dicari di Inbound RTS), lalu yang terbaru; sisanya diteruskan sinkron berikutnya.
    //      Sudah dikirim > 3 hari tetapi Shopee tidak memberi resi → resi = '' supaya tidak dicoba terus.
    try {
      const belum = await db.prepare(`SELECT no_pesanan, waktu_kirim < datetime('now','+7 hours','-3 days') AS lama FROM shopee_pesanan
          WHERE toko_id=? AND resi IS NULL AND (waktu_kirim IS NOT NULL OR status IN ('dikirim','terkirim','diterima','selesai','retur'))
          ORDER BY status IN ('retur','batal') DESC, dibuat DESC LIMIT 60`).bind(t.id).all<{ no_pesanan: string; lama: number | null }>();
      let isi = 0, kosong = 0, gagal = 0;
      for (const p of belum.results) {
        try {
          const d = await api.panggil<{ tracking_number?: string }>(t.shop_id, "/api/v2/logistics/get_tracking_number", { order_sn: p.no_pesanan });
          const resi = String(d.tracking_number ?? "").trim();
          if (resi) { await db.prepare("UPDATE shopee_pesanan SET resi=? WHERE no_pesanan=?").bind(resi.slice(0, 60), p.no_pesanan).run(); isi++; }
          else if (p.lama) { await db.prepare("UPDATE shopee_pesanan SET resi='' WHERE no_pesanan=?").bind(p.no_pesanan).run(); kosong++; }
          gagal = 0;
        } catch (e) {
          if (++gagal >= 3) throw e;   // mis. izin logistik belum diberikan → berhenti, laporkan
        }
      }
      r.resi = { diisi: isi, tanpa_resi: kosong, sisa: belum.results.length - isi - kosong };
    } catch (e) { r.resi = { gagal: String((e as Error).message ?? e) }; }
    // ---- Penghasilan (dana dilepas)
    try {
      const kunci = `shopee_sync_dana:${t.shop_id}`, terakhir = Number(await kv(db, kunci)) || 0;
      let mulai = opsi.hari ? kini - opsi.hari * HARI : terakhir ? terakhir - 2 * HARI : kini - 30 * HARI, n = 0, baru = 0, panggilan = 0, selesai = true, batch = true;
      const ANGGARAN = 400;                                   // panggilan API penghasilan per jalan
      while (mulai < kini) {
        const akhir = Math.min(mulai + JENDELA, kini), daftar: { order_sn: string; escrow_release_time: number }[] = [];
        let hal = 1, lagi = true;
        while (lagi && hal <= 60 && panggilan < ANGGARAN) {
          const d = await api.panggil<{ escrow_list?: { order_sn: string; escrow_release_time: number }[]; more?: boolean }>(t.shop_id, "/api/v2/payment/get_escrow_list",
            { release_time_from: mulai, release_time_to: akhir, page_size: 100, page_no: hal++ }); panggilan++;
          daftar.push(...(d.escrow_list ?? [])); lagi = !!d.more;
        }
        // Dana yang sudah dilepas tidak berubah → yang sudah tersimpan dari API dilewati, jadi tiap jalan selalu maju
        const sudah = new Set<string>();
        for (let i = 0; i < daftar.length; i += 400) {
          const r2 = await db.prepare("SELECT no_pesanan FROM shopee_penghasilan WHERE sumber='api' AND no_pesanan IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(daftar.slice(i, i + 400).map(e => e.order_sn))).all<{ no_pesanan: string }>();
          for (const x of r2.results) sudah.add(x.no_pesanan);
        }
        const perlu = daftar.filter(e => !sudah.has(e.order_sn)), lepas = new Map(perlu.map(e => [e.order_sn, e.escrow_release_time]));
        const rows: PenghasilanIn[] = [];
        for (let i = 0; i < perlu.length; i += 50) {
          if (panggilan >= ANGGARAN) { selesai = false; break; }
          const bagian = perlu.slice(i, i + 50);
          let detail: Obj[] | null = null;
          if (batch) try {
            const d = await api.panggil<Obj>(t.shop_id, "/api/v2/payment/get_escrow_detail_batch", {}, { order_sn_list: bagian.map(e => e.order_sn) }); panggilan++;
            const arr = (Array.isArray(d) ? d : d.order_list ?? d.escrow_detail_list ?? d.list ?? []) as Obj[];
            detail = arr.map(x => x.escrow_detail ?? x);
            if (!detail.length) throw new Error("batch kosong");
          } catch { batch = false; detail = null; }
          if (!detail) {
            detail = [];
            for (const e of bagian) {
              if (panggilan >= ANGGARAN) { selesai = false; break; }
              detail.push({ order_sn: e.order_sn, ...(await api.panggil<Obj>(t.shop_id, "/api/v2/payment/get_escrow_detail", { order_sn: e.order_sn })) }); panggilan++;
            }
          }
          for (const d of detail) if (d.order_sn && lepas.has(d.order_sn))
            rows.push(penghasilanDariApi(d.order_sn, lepas.get(d.order_sn)!, d.order_income ?? {}, d.buyer_payment_info ?? {}));
          if (!selesai) break;
        }
        if (rows.length) { const h = await simpanPenghasilanShopee(db, t.id, rows, "api", null); n += h.disimpan; baru += h.baru; }
        if (!selesai || lagi) { selesai = false; break; }
        mulai = akhir;
        await kv(db, kunci, String(akhir));
      }
      // Tanggal pesanan dibuat untuk penghasilan dari API diambil dari data pesanan
      await db.prepare(`UPDATE shopee_penghasilan SET dibuat=(SELECT substr(p.dibuat,1,10) FROM shopee_pesanan p WHERE p.no_pesanan=shopee_penghasilan.no_pesanan)
        WHERE toko_id=? AND dibuat IS NULL`).bind(t.id).run();
      r.penghasilan = { disimpan: n, baru, selesai };
    } catch (e) { r.penghasilan = { gagal: String((e as Error).message ?? e) }; }
    // ---- Iklan
    try { r.iklan = await sinkronIklan(db, api, t, kini, opsi.hari); }
    catch (e) { r.iklan = { gagal: String((e as Error).message ?? e) }; }
    hasil.push(r);
  }
  await kv(db, "shopee_sinkron_terakhir", JSON.stringify({ waktu: new Date().toISOString(), hasil }));
  return { ok: true, hasil };
}
