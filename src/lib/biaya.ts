import { ItemKatalog, cocokkan } from "./katalog";

/**
 * Biaya per order closing → Net Profit (dipakai halaman Iklan Meta & Ringkasan).
 *  HPP        = Σ qty × HPP satuan varian (final_variants order), dicari lewat SKU varian di katalog Scalev:
 *               1. HPP Manajemen SKU dari SKU yang ditautkan di varian Scalev; SKU yang tersusun dari List Produk
 *                  memakai HPP produk yang berlaku pada tanggal order (riwayat produk_hpp) — sudah termasuk biaya gudang;
 *               2. COGS varian di katalog Scalev, hanya bila SKU-nya belum ada / belum ber-HPP di Manajemen SKU.
 *               Varian tanpa ketiganya → hpp_kurang (HPP-nya dihitung 0).
 *  Scalev fee = field scalev_fee pada order Scalev.
 *  Ongkir     = dari paket Mengantar yang remark1-nya = nomor order Scalev (atau resinya sama). Tarif `price`
 *               belum dipotong diskon Mengantar, jadi dipakai yang benar-benar ditagih di saldo Mengantar:
 *               1. paket retur dipotong "Payment for returned order …" → jumlah potongan itu;
 *               2. resi ada di rincian invoice (rekonsiliasi COD / batch) → cod_amount − cod_fee − amount (non-COD → −amount);
 *               3. potongan lain atas resi itu (mis. non-COD) → jumlah potongannya;
 *               lalu dikurangi refund klaim ongkir retur ("Claim approved for returned order…"; klaim barang hilang/rusak bukan ongkir). Tanpa ketiganya → price (ongkir_estimasi).
 *  COD fee    = cod_fee paket Mengantar.
 */
export type OrderBiaya = { order_id: string; shipment_receipt: string | null; status: string; fv: string | null; product_names: string | null;
  product_id: number | null; scalev_fee: number; tgl?: string | null };
export type Biaya = { hpp: number; scalev_fee: number; ongkir: number; cod_fee: number; hpp_kurang: number; tanpa_paket: number; ongkir_estimasi: number };

/** Kolom SQL yang dibutuhkan `hitung` — alias tabel orders harus `o`. */
export const KOLOM_BIAYA = `o.order_id, o.shipment_receipt, o.status, json_extract(o.raw_json,'$.final_variants') AS fv, o.product_names,
  CASE WHEN json_array_length(o.product_names)=1 THEN json_extract(o.raw_json,'$.follow_up_chats[0].product_id') END AS product_id,
  COALESCE(json_extract(o.raw_json,'$.scalev_fee'),0)+0 AS scalev_fee, o.draft_date AS tgl`;

type ItemHpp = ItemKatalog & { cogs: number | null };
/** Kolom saldo Mengantar per paket untuk `ongkirPaket` (cod_amount / inv_cod_fee / amount dari rincian invoice) */
export type SaldoPaket = { is_cod: number; price: number; amount: number | null; cod_amount: number | null; inv_cod_fee: number | null;
  potong_rts: number | null; potong: number | null; klaim: number | null };
type Paket = SaldoPaket & { id: string; rk: string | null; receipt: string | null; cod_fee: number };

/** Ongkir yang benar-benar ditagih Mengantar untuk satu paket (lihat urutan di atas), sudah dikurangi refund klaim ongkir retur */
export function ongkirPaket(p: SaldoPaket): { ongkir: number; estimasi: boolean } {
  let ongkir = p.price, estimasi = false;
  if (p.potong_rts != null) ongkir = p.potong_rts;   // retur: ongkir dipotong langsung dari saldo
  else if (p.amount != null) {
    const ditagih = p.is_cod ? (p.cod_amount ?? 0) - (p.inv_cod_fee ?? 0) - p.amount : -p.amount;
    if (ditagih >= 0) ongkir = ditagih;
  } else if (p.potong != null) ongkir = p.potong;
  else estimasi = true;
  return { ongkir: Math.max(0, ongkir - (p.klaim ?? 0)), estimasi };
}

/** SQL subquery saldo Mengantar per resi untuk `ongkirPaket`: join sebagai `inv` (rincian invoice) dan `sal` (mutasi) ke shipments s */
export const JOIN_SALDO = `LEFT JOIN (SELECT receipt, SUM(amount) AS amount, SUM(cod_amount) AS cod_amount, SUM(cod_fee) AS cod_fee
    FROM mengantar_invoice_items GROUP BY receipt) inv ON inv.receipt=s.receipt
  LEFT JOIN (SELECT receipt,
      SUM(CASE WHEN type='typePayment' AND description LIKE 'Payment for returned order%' THEN amount END) AS potong_rts,
      SUM(CASE WHEN type='typePayment' THEN amount END) AS potong,
      SUM(CASE WHEN type='typeRefund' AND description LIKE 'Claim approved for returned order%' THEN -amount ELSE 0 END) AS klaim,
      SUM(CASE WHEN type='typeRefund' AND description NOT LIKE 'Claim approved for returned order%' THEN -amount ELSE 0 END) AS kompensasi
    FROM mengantar_invoices WHERE status='statusCleared' AND receipt IS NOT NULL GROUP BY receipt) sal ON sal.receipt=s.receipt`;
/** Kolom hasil JOIN_SALDO dengan nama yang dipakai `SaldoPaket` */
export const KOLOM_SALDO = `inv.amount, inv.cod_amount, inv.cod_fee AS inv_cod_fee, sal.potong_rts, sal.potong, sal.klaim, sal.kompensasi`;

/** Varian order dari final_variants ({nama: qty}); tanpa itu → product_names dengan qty 1 */
function varianOrder(o: Pick<OrderBiaya, "fv" | "product_names">): [string, number][] {
  let varian: [string, number][] = [];
  try { varian = Object.entries(JSON.parse(o.fv ?? "null") ?? {}).map(([n, q]) => [n, Number(q) || 1]); } catch { /* fv rusak → pakai product_names */ }
  if (!varian.length) try { varian = (JSON.parse(o.product_names ?? "[]") as string[]).map(n => [n, 1]); } catch { /* kosong */ }
  return varian;
}

/** Rincian pcs: [produk_id List Produk, pcs] per komponen, dan [nama, qty] yang isinya belum diatur (dihitung 1 pcs per qty). */
export type IsiPcs = { pcs: number; kurang: boolean; produk: [number, number][]; tanpaIsi: [string, number][] };

/**
 * Penghitung pcs terjual dari komposisi List Produk di Manajemen SKU; komponen bertanda bonus tidak dihitung
 * (mis. "Beli 2 Gratis 1" = 3, "Isi 2" = 2, "Buku + bonus Parfum" = 1).
 *  - order(o): order Scalev → Σ qty varian × isi SKU varian (varian dicocokkan ke katalog Scalev);
 *  - sku(kode, qty): baris marketplace (Seller SKU Shopee / TikTok) → qty × isi SKU.
 * Varian tanpa SKU / SKU tanpa komposisi (selain bonus) dihitung 1 pcs per qty dan ditandai `kurang`.
 */
export async function siapkanIsiPcs(db: D1Database) {
  const [katalog, isi] = await db.batch([
    db.prepare("SELECT key, kind, product_id, product_name, name, option_tail, sku, status FROM catalog_items"),
    db.prepare(`SELECT UPPER(TRIM(s.sku)) AS sku, i.produk_id, i.qty FROM sku_produk_item i JOIN sku_produk s ON s.id=i.sku_id WHERE i.bonus=0 ORDER BY i.urut`),
  ]);
  const perNama = new Map<string, ItemKatalog[]>(), perProduk = new Map<number, ItemKatalog[]>();
  for (const it of katalog.results as ItemKatalog[]) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const isiSku = new Map<string, { produk_id: number; qty: number }[]>();
  for (const r of isi.results as { sku: string; produk_id: number; qty: number }[]) isiSku.set(r.sku, [...(isiSku.get(r.sku) ?? []), r]);
  const tambah = (h: IsiPcs, sku: string | null | undefined, nama: string, qty: number) => {
    const komponen = sku ? isiSku.get(sku.trim().toUpperCase()) : undefined;
    if (komponen?.length) for (const k of komponen) { h.pcs += qty * k.qty; h.produk.push([k.produk_id, qty * k.qty]); }
    else { h.pcs += qty; h.kurang = true; h.tanpaIsi.push([nama, qty]); }
  };
  return {
    order(o: Pick<OrderBiaya, "fv" | "product_names" | "product_id">): IsiPcs {
      const varian = varianOrder(o), h: IsiPcs = { pcs: 0, kurang: !varian.length, produk: [], tanpaIsi: [] };
      for (const [nama, qty] of varian)
        tambah(h, cocokkan(nama, varian.length === 1 && o.product_id != null ? Number(o.product_id) : null, perNama, perProduk)?.sku, nama, qty);
      return h;
    },
    sku(kode: string | null, nama: string, qty: number): IsiPcs {
      const h: IsiPcs = { pcs: 0, kurang: false, produk: [], tanpaIsi: [] };
      tambah(h, kode, nama, qty);
      return h;
    },
  };
}

/** Pcs terjual per order Scalev (lihat siapkanIsiPcs). */
export async function siapkanPcs(db: D1Database) {
  return (await siapkanIsiPcs(db)).order;
}

/** Muat katalog, HPP Manajemen SKU, dan paket Mengantar sejak `from`, lalu kembalikan penghitung biaya per order. */
export async function siapkanBiaya(db: D1Database, from: string) {
  const [katalog, paket, skuHpp, skuIsi, riwayat] = await Promise.all([
    db.prepare("SELECT key, kind, product_id, product_name, name, option_tail, sku, price, cogs, status FROM catalog_items").all<ItemHpp>(),
    // Paket dibuat setelah order masuk; mundur 3 hari untuk jaga-jaga selisih zona waktu.
    db.prepare(
      `SELECT s.id, json_extract(s.raw_json,'$.remark1') AS rk, s.receipt, s.is_cod, s.price, s.cod_fee, ${KOLOM_SALDO}
       FROM shipments s ${JOIN_SALDO}
       WHERE s.created_at >= date(?, '-3 days')`).bind(from).all<Paket>(),
    // diatur = SKU tersusun dari List Produk atau terhubung ke List Gudang → HPP dashboard didahulukan
    db.prepare(
      `SELECT UPPER(TRIM(sku)) AS sku, hpp, (gudang_id IS NOT NULL OR EXISTS (SELECT 1 FROM sku_produk_item i WHERE i.sku_id=sku_produk.id)) AS diatur
       FROM sku_produk WHERE hpp>0`).all<{ sku: string; hpp: number; diatur: number }>(),
    // Isi SKU dari List Produk + biaya gudang SKU → HPP SKU pada tanggal order dari riwayat HPP produk
    db.prepare(
      `SELECT UPPER(TRIM(s.sku)) AS sku, i.produk_id, i.qty, COALESCE(g.biaya_penanganan+g.biaya_lain, 0) AS biaya
       FROM sku_produk_item i JOIN sku_produk s ON s.id=i.sku_id LEFT JOIN gudang g ON g.id=s.gudang_id`)
      .all<{ sku: string; produk_id: number; qty: number; biaya: number }>(),
    db.prepare("SELECT produk_id, berlaku, hpp FROM produk_hpp ORDER BY produk_id, berlaku").all<{ produk_id: number; berlaku: string; hpp: number }>(),
  ]);
  const isiSku = new Map<string, { produk_id: number; qty: number; biaya: number }[]>();
  for (const r of skuIsi.results) isiSku.set(r.sku, [...(isiSku.get(r.sku) ?? []), r]);
  const hppPer = new Map<number, { berlaku: string; hpp: number }[]>();
  for (const r of riwayat.results) hppPer.set(r.produk_id, [...(hppPer.get(r.produk_id) ?? []), r]);
  /** HPP produk yang berlaku pada tanggal (riwayat urut naik); tanpa tanggal → yang terbaru */
  const hppPada = (produk: number, tgl: string | null | undefined) => {
    let h: number | undefined;
    for (const r of hppPer.get(produk) ?? []) { if (tgl && r.berlaku > tgl) break; h = r.hpp; }
    return h;
  };
  /** HPP SKU tersusun dari List Produk pada tanggal order = Σ qty × HPP produk saat itu + biaya gudang SKU */
  const hppSkuPada = (sku: string, tgl: string | null | undefined) => {
    const isi = isiSku.get(sku);
    if (!isi?.length) return undefined;
    let total = isi[0].biaya;
    for (const i of isi) { const h = hppPada(i.produk_id, tgl); if (h == null) return undefined; total += i.qty * h; }
    return total;
  };
  const perNama = new Map<string, ItemHpp[]>(), perProduk = new Map<number, ItemHpp[]>();
  for (const it of katalog.results) {
    perNama.set(it.name, [...(perNama.get(it.name) ?? []), it]);
    if (it.product_id != null) perProduk.set(it.product_id, [...(perProduk.get(it.product_id) ?? []), it]);
  }
  const hppSku = new Map(skuHpp.results.map(r => [r.sku, r.hpp]));
  const paketPer = new Map<string, Paket[]>();
  for (const p of paket.results)
    for (const k of [p.rk && `o:${p.rk}`, p.receipt && `r:${p.receipt}`]) if (k) paketPer.set(k, [...(paketPer.get(k) ?? []), p]);

  return function hitung(o: OrderBiaya): Biaya {
    const b: Biaya = { hpp: 0, scalev_fee: Number(o.scalev_fee) || 0, ongkir: 0, cod_fee: 0, hpp_kurang: 0, tanpa_paket: 0, ongkir_estimasi: 0 };
    const varian = varianOrder(o);
    let kurang = !varian.length;
    for (const [nama, qty] of varian) {
      const it = cocokkan(nama, varian.length === 1 && o.product_id != null ? Number(o.product_id) : null, perNama, perProduk);
      const sku = it?.sku ? it.sku.trim().toUpperCase() : null;
      const satuan = (sku && (hppSkuPada(sku, o.tgl) || hppSku.get(sku))) || (it?.cogs && it.cogs > 0 ? it.cogs : undefined);
      if (satuan) b.hpp += qty * satuan; else kurang = true;
    }
    b.hpp_kurang = kurang ? 1 : 0;
    // Satu order bisa punya lebih dari satu paket (mis. kirim ulang)
    const pk = new Map<string, Paket>();
    for (const k of [`o:${o.order_id}`, o.shipment_receipt && `r:${o.shipment_receipt}`]) if (k) for (const p of paketPer.get(k) ?? []) pk.set(p.id, p);
    for (const p of pk.values()) {
      const { ongkir, estimasi } = ongkirPaket(p);
      if (estimasi) b.ongkir_estimasi = 1;
      b.ongkir += ongkir; b.cod_fee += p.cod_fee;
    }
    if (!pk.size && ["shipped", "completed", "rts", "shipped_rts"].includes(o.status)) b.tanpa_paket = 1;
    return b;
  };
}
