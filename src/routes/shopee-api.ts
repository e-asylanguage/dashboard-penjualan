import { Hono } from "hono";
import { Env } from "../env";
import { ShopeeApi } from "../lib/shopee-api";

/**
 * Koneksi Shopee Open Platform (/api/shopee-api). Tahap uji: hanya menghubungkan toko & membaca contoh data
 * (tidak menulis ke tabel laporan Shopee). Callback terbuka tanpa sesi, dijaga `state` sekali pakai.
 */
export const shopeeApi = new Hono<{ Bindings: Env }>();

const STATE = (s: string) => `shopee_state:${s}`;

/** Link izin toko (?toko = id toko dashboard tujuan, opsional). Redirect kembali ke /api/shopee-api/callback di origin yang sama */
shopeeApi.get("/link-izin", async c => {
  const api = new ShopeeApi(c.env), state = crypto.randomUUID(), toko = Number(c.req.query("toko")) || null;
  await c.env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(STATE(state), JSON.stringify({ exp: Date.now() + 15 * 60000, toko })).run();
  const redirect = `${new URL(c.req.url).origin}/api/shopee-api/callback?state=${state}`;
  return c.json({ url: await api.linkIzin(redirect), sandbox: api.sandbox, host: api.host });
});

shopeeApi.get("/callback", async c => {
  const state = c.req.query("state") ?? "", code = c.req.query("code") ?? "", shopId = c.req.query("shop_id") ?? "";
  const db = c.env.DB, s = await db.prepare("SELECT value FROM kv WHERE key=?").bind(STATE(state)).first<{ value: string }>();
  await db.prepare("DELETE FROM kv WHERE key=?").bind(STATE(state)).run();
  // Nilai state: {exp, toko} (format lama: angka kedaluwarsa saja)
  let st: { exp: number; toko: number | null } = { exp: 0, toko: null };
  try { const v = JSON.parse(s?.value ?? "0"); st = typeof v === "number" ? { exp: v, toko: null } : v; } catch { /* rusak = kedaluwarsa */ }
  const balik = (pesan: string) => c.redirect(`/?shopee_api=${encodeURIComponent(pesan)}${st.toko != null ? "&ke=pengaturan" : ""}`);
  if (!s || st.exp < Date.now()) return balik("Link izin kedaluwarsa, ulangi dari dashboard");
  if (!code || !/^\d+$/.test(shopId)) return balik("Shopee tidak mengirim code / shop_id (izin dibatalkan?)");
  try {
    const api = new ShopeeApi(c.env), t = await api.tukarCode(code, shopId), now = new Date().toISOString();
    await db.prepare(`INSERT INTO shopee_api_toko (shop_id, host, access_token, refresh_token, expire_at, refresh_expire_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(shop_id, host) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      expire_at=excluded.expire_at, refresh_expire_at=excluded.refresh_expire_at, updated_at=excluded.updated_at`)
      .bind(shopId, api.host, t.access_token, t.refresh_token, t.expire_at, t.refresh_expire_at, now, now).run();
    const info = await api.panggil<{ shop_name?: string; region?: string }>(shopId, "/api/v2/shop/get_shop_info").catch(() => ({} as { shop_name?: string; region?: string }));
    await db.prepare("UPDATE shopee_api_toko SET nama=?, region=? WHERE shop_id=? AND host=?").bind(info.shop_name ?? null, info.region ?? null, shopId, api.host).run();
    if (api.sandbox) return balik(`Toko uji ${info.shop_name ?? shopId} terhubung (sandbox)`);
    // Pasangkan ke toko dashboard: shop_id sama → toko itu; toko tujuan tanpa shop_id → diisi; selain itu toko baru
    const nama = info.shop_name ?? `Toko Shopee ${shopId}`;
    let toko = await db.prepare("SELECT id, nama FROM shopee_toko WHERE shop_id=?").bind(shopId).first<{ id: number; nama: string }>(), catatan = "";
    if (!toko && st.toko) {
      const tj = await db.prepare("SELECT id, nama, shop_id FROM shopee_toko WHERE id=?").bind(st.toko).first<{ id: number; nama: string; shop_id: string | null }>();
      if (tj && !tj.shop_id) { await db.prepare("UPDATE shopee_toko SET shop_id=? WHERE id=?").bind(shopId, tj.id).run(); toko = tj; }
      else if (tj) catatan = ` — akun yang diizinkan (shop_id ${shopId}) bukan toko ${tj.nama} (shop_id ${tj.shop_id})`;
    }
    if (!toko) {
      const r = await db.prepare("INSERT INTO shopee_toko (nama, shop_id, mode, created_at, updated_at) VALUES (?,?, 'api', ?, ?)").bind(nama, shopId, now, now).run();
      toko = { id: Number(r.meta.last_row_id), nama };
      catatan += " — dibuat sebagai toko baru, atur gudangnya di Pengaturan › Toko Marketplace";
    }
    await db.prepare("UPDATE shopee_toko SET mode='api', updated_at=? WHERE id=?").bind(now, toko.id).run();
    return balik(`${nama} terhubung ke toko ${toko.nama}${catatan}`);
  } catch (e) { return balik(`Gagal menghubungkan: ${String((e as Error).message ?? e)}`); }
});

/** Toko yang terhubung (tanpa token) */
shopeeApi.get("/toko", async c => {
  const api = new ShopeeApi(c.env);
  const r = await c.env.DB.prepare("SELECT shop_id, nama, region, expire_at, refresh_expire_at, updated_at FROM shopee_api_toko WHERE host=? ORDER BY nama")
    .bind(api.host).all();
  return c.json({ sandbox: api.sandbox, host: api.host, toko: r.results });
});

shopeeApi.delete("/toko/:shop", async c => {
  const api = new ShopeeApi(c.env);
  await c.env.DB.prepare("DELETE FROM shopee_api_toko WHERE shop_id=? AND host=?").bind(c.req.param("shop"), api.host).run();
  return c.json({ ok: true });
});

/** PNG polos w×h satu warna (untuk foto produk uji) — dibuat di Worker tanpa library */
async function pngPolos(w: number, h: number, [r, g, b]: [number, number, number]): Promise<Uint8Array> {
  const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (d: Uint8Array) => { let c = 0xffffffff; for (const x of d) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const potong = (jenis: string, data: Uint8Array) => {
    const jd = new Uint8Array([...new TextEncoder().encode(jenis), ...data]);
    return new Uint8Array([...u32(data.length), ...jd, ...u32(crc(jd))]);
  };
  const mentah = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (1 + w * 3) + 1 + x * 3; mentah[i] = r; mentah[i + 1] = g; mentah[i + 2] = b; }
  const z = new Uint8Array(await new Response(new Blob([mentah]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 2, 0, 0, 0]);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...potong("IHDR", ihdr), ...potong("IDAT", z), ...potong("IEND", new Uint8Array())]);
}

/**
 * SANDBOX saja: buat 2 produk uji lewat API (tanpa Seller Center) — 1 produk biasa (SKU S1TMJ) dan 1 produk
 * bervariasi "Beli 1" (S1TMJ) / "Beli 2 Gratis 1" (STEPILSTE003--_cg). Mengembalikan log tiap langkah.
 */
shopeeApi.post("/sandbox/buat-produk/:shop", async c => {
  const api = new ShopeeApi(c.env), shop = c.req.param("shop"), log: Record<string, unknown> = {};
  if (!api.sandbox) return c.json({ error: "hanya untuk sandbox" }, 403);
  try {
    // Shopee mewajibkan 2–9 foto: dua gambar polos beda warna
    const imageIds: string[] = [];
    for (const warna of [[238, 77, 45], [38, 166, 154]] as [number, number, number][])
      imageIds.push(await api.unggahGambar((await pngPolos(600, 600, warna)).buffer as ArrayBuffer, "image/png"));
    log.gambar = imageIds;

    type Kat = { category_id: number; parent_category_id: number; display_category_name: string; has_children: boolean };
    const kat = await api.panggil<{ category_list?: Kat[] }>(shop, "/api/v2/product/get_category", { language: "id" });
    const daun = (kat.category_list ?? []).filter(k => !k.has_children);
    // Kategori daun "Pemanis"; bila tidak ada, daun di bawah induk Makanan & Minuman; terakhir daun pertama
    const induk = new Map((kat.category_list ?? []).map(k => [k.category_id, k]));
    const jalur = (k: Kat) => { const n: string[] = []; for (let x: Kat | undefined = k; x; x = induk.get(x.parent_category_id)) n.unshift(x.display_category_name); return n.join(" › "); };
    const pilih = daun.find(k => /^pemanis/i.test(k.display_category_name)) ?? daun.find(k => /makanans*&s*minuman/i.test(jalur(k))) ?? daun[0];
    if (!pilih) throw new Error("tidak ada kategori");
    log.kategori = `${jalur(pilih)} (${pilih.category_id})`;

    // Atribut wajib kategori (mis. "Shelf Life"): pilihan pertama, atau teks/angka contoh bila isian bebas.
    // get_attributes (format lama) dulu; bila gagal, get_attribute_tree (format baru).
    type Nilai = { value_id: number; original_value_name?: string; value_unit?: string };
    const atribut: { attribute_id: number; attribute_value_list: Nilai[] }[] = [], catatanAtribut: string[] = [];
    const isiBebas = (validasi: string, satuan: string[]): Nilai =>
      ({ value_id: 0, original_value_name: /INT|FLOAT|NUMBER/i.test(validasi) ? "12" : /DATE/i.test(validasi) ? String(Math.floor(Date.now() / 1000)) : "Uji", ...(satuan.length ? { value_unit: satuan[0] } : {}) });
    try {
      type AtrLama = { attribute_id: number; original_attribute_name?: string; is_mandatory: boolean; input_validation_type?: string; attribute_unit?: string[]; attribute_value_list?: { value_id: number; original_value_name?: string }[] };
      const a = await api.panggil<{ attribute_list?: AtrLama[] }>(shop, "/api/v2/product/get_attributes", { category_id: pilih.category_id, language: "id" });
      for (const x of (a.attribute_list ?? []).filter(x => x.is_mandatory)) {
        const v = x.attribute_value_list?.[0];
        atribut.push({ attribute_id: x.attribute_id, attribute_value_list: [v ? { value_id: v.value_id } : isiBebas(x.input_validation_type ?? "", x.attribute_unit ?? [])] });
        catatanAtribut.push(`${x.original_attribute_name ?? x.attribute_id} = ${v?.original_value_name ?? atribut.at(-1)!.attribute_value_list[0].original_value_name}`);
      }
    } catch {
      type AtrBaru = { attribute_id: number; name?: string; mandatory?: boolean; is_mandatory?: boolean; attribute_value_list?: { value_id: number; name?: string }[];
        attribute_info?: { input_validation_type?: number | string; attribute_unit_list?: string[] } };
      const t = await api.panggil<{ list?: { attribute_tree?: AtrBaru[] }[] }>(shop, "/api/v2/product/get_attribute_tree", { category_id_list: String(pilih.category_id), language: "id" });
      for (const x of (t.list?.[0]?.attribute_tree ?? []).filter(x => x.mandatory || x.is_mandatory)) {
        const v = x.attribute_value_list?.[0];
        atribut.push({ attribute_id: x.attribute_id, attribute_value_list: [v ? { value_id: v.value_id } : isiBebas(String(x.attribute_info?.input_validation_type ?? ""), x.attribute_info?.attribute_unit_list ?? [])] });
        catatanAtribut.push(`${x.name ?? x.attribute_id} = ${v?.name ?? atribut.at(-1)!.attribute_value_list[0].original_value_name}`);
      }
    }
    log.atribut_wajib = catatanAtribut;

    type Kanal = { logistics_channel_id: number; logistics_channel_name: string; enabled: boolean };
    const kanal = await api.panggil<{ logistics_channel_list?: Kanal[] }>(shop, "/api/v2/logistics/get_channel_list");
    const aktif = (kanal.logistics_channel_list ?? []).filter(k => k.enabled);
    const pakai = (aktif.length ? aktif : kanal.logistics_channel_list ?? []).slice(0, 3);
    log.jasa_kirim = pakai.map(k => `${k.logistics_channel_name} (${k.logistics_channel_id})${k.enabled ? "" : " — belum aktif di toko"}`);

    const dasar = (nama: string, harga: number, sku: string) => ({
      original_price: harga, item_name: nama, item_sku: sku, weight: 0.2, category_id: pilih.category_id,
      description: "Produk uji integrasi dashboard Tomo Joyo Marketing. Pemanis alami stevia 15ml, bebas gula, cocok untuk diet dan penderita diabetes.",
      image: { image_id_list: imageIds }, seller_stock: [{ stock: 100 }], item_status: "NORMAL", condition: "NEW",
      brand: { brand_id: 0, original_brand_name: "NoBrand" }, attribute_list: atribut,
      logistic_info: pakai.map(k => ({ logistic_id: k.logistics_channel_id, enabled: true })),
    });
    const p1 = await api.panggil<{ item_id?: number }>(shop, "/api/v2/product/add_item", {}, dasar("Steva Stevia Ori 15ml UJI", 75000, "S1TMJ"));
    log.produk_1 = { item_id: p1.item_id, sku: "S1TMJ" };

    const p2 = await api.panggil<{ item_id?: number }>(shop, "/api/v2/product/add_item", {}, dasar("Steva Stevia Paket Promo UJI", 75000, "STEVA-PROMO-UJI"));
    log.produk_2 = { item_id: p2.item_id };
    try {
      const v = await api.panggil(shop, "/api/v2/product/init_tier_variation", {}, {
        item_id: p2.item_id,
        tier_variation: [{ name: "Paket", option_list: [{ option: "Beli 1" }, { option: "Beli 2 Gratis 1" }] }],
        model: [
          { tier_index: [0], original_price: 75000, model_sku: "S1TMJ", seller_stock: [{ stock: 100 }] },
          { tier_index: [1], original_price: 140000, model_sku: "STEPILSTE003--_cg", seller_stock: [{ stock: 100 }] },
        ],
      });
      log.variasi = v;
    } catch (e) { log.variasi = { gagal: String((e as Error).message ?? e) }; }
    return c.json({ ok: true, ...log });
  } catch (e) { return c.json({ ok: false, ...log, gagal: String((e as Error).message ?? e) }); }
});

/**
 * SANDBOX saja: semua produk aktif toko diatur memakai satu jasa kirim (default Sandbox-J&T Express), supaya
 * Test Order di konsol Shopee menemukan jasa kirim yang sama. Mengembalikan daftar jasa kirim toko untuk diagnosa.
 */
shopeeApi.post("/sandbox/atur-kirim/:shop", async c => {
  const api = new ShopeeApi(c.env), shop = c.req.param("shop"), log: Record<string, unknown> = {};
  if (!api.sandbox) return c.json({ error: "hanya untuk sandbox" }, 403);
  try {
    type Kanal = { logistics_channel_id: number; logistics_channel_name: string; enabled: boolean; cod_enabled?: boolean; fee_type?: string; mask_channel_id?: number };
    const kanal = (await api.panggil<{ logistics_channel_list?: Kanal[] }>(shop, "/api/v2/logistics/get_channel_list")).logistics_channel_list ?? [];
    log.jasa_kirim_toko = kanal.map(k => `${k.logistics_channel_id} ${k.logistics_channel_name} · ${k.enabled ? "aktif" : "nonaktif"}${k.mask_channel_id ? ` · mask ${k.mask_channel_id}` : ""}`);
    const pilih = kanal.find(k => k.enabled && /j&t express/i.test(k.logistics_channel_name))
      ?? kanal.find(k => k.enabled && !/instant|cargo|same ?day/i.test(k.logistics_channel_name)) ?? kanal.find(k => k.enabled);
    if (!pilih) throw new Error("tidak ada jasa kirim aktif di toko uji");
    log.dipakai = `${pilih.logistics_channel_id} ${pilih.logistics_channel_name}`;
    const daftar = await api.panggil<{ item?: { item_id: number }[] }>(shop, "/api/v2/product/get_item_list", { offset: 0, page_size: 50, item_status: "NORMAL" });
    const hasil: Record<string, string> = {};
    for (const it of daftar.item ?? []) {
      try {
        await api.panggil(shop, "/api/v2/product/update_item", {}, { item_id: it.item_id,
          logistic_info: kanal.map(k => ({ logistic_id: k.logistics_channel_id, enabled: k.logistics_channel_id === pilih.logistics_channel_id })) });
        hasil[it.item_id] = "ok";
      } catch (e) { hasil[it.item_id] = String((e as Error).message ?? e); }
    }
    log.produk = hasil;
    return c.json({ ok: true, ...log });
  } catch (e) { return c.json({ ok: false, ...log, gagal: String((e as Error).message ?? e) }); }
});

/**
 * Uji baca data satu toko: info toko, pesanan 15 hari terakhir per status, contoh rincian pesanan (tanpa data
 * pembeli), rincian dana (escrow) satu pesanan selesai, dan saldo iklan. Hanya dikembalikan, tidak disimpan.
 */
shopeeApi.post("/uji/:shop", async c => {
  const api = new ShopeeApi(c.env), shop = c.req.param("shop"), hasil: Record<string, unknown> = {};
  const coba = async (k: string, f: () => Promise<unknown>) => { try { hasil[k] = await f(); } catch (e) { hasil[k] = { gagal: String((e as Error).message ?? e) }; } };
  await coba("toko", () => api.panggil(shop, "/api/v2/shop/get_shop_info"));
  const akhir = Math.floor(Date.now() / 1000), awal = akhir - 15 * 86400;
  type Daftar = { order_list?: { order_sn: string }[]; more?: boolean; next_cursor?: string };
  const sn: string[] = [];
  await coba("pesanan_15_hari", async () => {
    let cursor = "", hal = 0;
    do {
      const d = await api.panggil<Daftar>(shop, "/api/v2/order/get_order_list",
        { time_range_field: "create_time", time_from: awal, time_to: akhir, page_size: 100, cursor });
      for (const o of d.order_list ?? []) sn.push(o.order_sn);
      cursor = d.more ? d.next_cursor ?? "" : "";
    } while (cursor && ++hal < 10);
    return { jumlah: sn.length };
  });
  type Detail = { order_list?: { order_sn: string; order_status: string; total_amount: number; create_time: number; item_list?: { item_name: string; model_name: string; model_quantity_purchased: number; model_sku?: string; item_sku?: string }[] }[] };
  let selesai: string | undefined;
  await coba("contoh_pesanan", async () => {
    if (!sn.length) return [];
    const d = await api.panggil<Detail>(shop, "/api/v2/order/get_order_detail",
      { order_sn_list: sn.slice(0, 20).join(","), response_optional_fields: "item_list,total_amount" });
    const per: Record<string, number> = {};
    for (const o of d.order_list ?? []) per[o.order_status] = (per[o.order_status] ?? 0) + 1;
    selesai = d.order_list?.find(o => o.order_status === "COMPLETED")?.order_sn;
    return { status_20_pertama: per, contoh: (d.order_list ?? []).slice(0, 5).map(o => ({ order_sn: o.order_sn, status: o.order_status, total: o.total_amount,
      dibuat: new Date(o.create_time * 1000).toISOString(), barang: (o.item_list ?? []).map(i => `${i.item_name} · ${i.model_name} × ${i.model_quantity_purchased}${i.model_sku || i.item_sku ? ` (SKU ${i.model_sku || i.item_sku})` : ""}`) })) };
  });
  await coba("dana_escrow", async () => {
    if (!selesai) return "tidak ada pesanan COMPLETED di 20 pesanan pertama";
    const e = await api.panggil<{ order_sn: string; order_income?: Record<string, unknown> }>(shop, "/api/v2/payment/get_escrow_detail", { order_sn: selesai });
    const i = e.order_income ?? {};
    const ambil = ["escrow_amount", "buyer_total_amount", "original_price", "commission_fee", "service_fee", "seller_transaction_fee", "actual_shipping_fee", "shopee_shipping_rebate", "voucher_from_seller", "final_shipping_fee"];
    return { order_sn: e.order_sn, ...Object.fromEntries(ambil.filter(k => k in i).map(k => [k, i[k]])) };
  });
  await coba("saldo_iklan", () => api.panggil(shop, "/api/v2/ads/get_total_balance"));
  const tglAds = (t: number) => { const d = new Date((t + 7 * 3600) * 1000); return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`; };
  await coba("iklan_7_hari", () => api.panggil(shop, "/api/v2/ads/get_all_cpc_ads_daily_performance", { start_date: tglAds(akhir - 7 * 86400), end_date: tglAds(akhir - 86400) }));
  return c.json({ sandbox: api.sandbox, host: api.host, ...hasil });
});
