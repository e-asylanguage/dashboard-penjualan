import { Hono } from "hono";
import { Env, hasMetaToken, todayReport } from "../env";
import { discoverAdAccounts, discoverBm, discoverStores, autoMapCampaigns } from "../lib/sync";
import { KATEGORI, Kategori } from "../lib/katalog";
import { SHIP_BARANG, SHIP_GUDANG, SHIP_STATUS, SHIP_SCALEV_ID } from "./report";
import { COOKIE_SESI, bacaCookie, cekSesi, userDashboard } from "../lib/sesi";

export const settings = new Hono<{ Bindings: Env }>();

/** Daftar BM, ad account (dengan centang), dan store Scalev. */
settings.get("/", async c => {
  // Token sendiri tidak pernah dikirim ke browser — hanya status tersimpan / pemilik / error terakhir.
  const bmRows = await c.env.DB.prepare(
    "SELECT id, name, app_id, is_active, token, token_secret, token_owner, token_checked_at, token_error FROM business_managers ORDER BY rowid")
    .all<{ id: string; token: string | null; token_secret: string | null; [k: string]: unknown }>();
  const tokens: Record<string, boolean> = {};
  const bms = bmRows.results.map(({ token, token_secret, ...b }) => { tokens[b.id] = hasMetaToken(c.env, { token, token_secret }); return b; });
  const accounts = await c.env.DB.prepare(
    `SELECT a.*, (SELECT ROUND(SUM(spend)) FROM ad_insights_daily i WHERE i.account_id=a.id AND i.date >= date('now','-30 days')) AS spend_30d
     FROM ad_accounts a ORDER BY a.bm_id, a.name`).all();
  const stores = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM orders o WHERE o.store_id=s.id AND o.draft_date >= date('now','-30 days')) AS orders_30d FROM stores s ORDER BY s.name`).all();
  const groups = await c.env.DB.prepare("SELECT * FROM product_groups ORDER BY name").all();
  const log = await c.env.DB.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 20").all();
  return c.json({ business_managers: bms, tokens, ad_accounts: accounts.results, stores: stores.results, product_groups: groups.results, sync_log: log.results });
});

/**
 * Buat/ubah BM dari halaman Pengaturan › Sinkronisasi Meta Ads. { id?, name, app_id, token? }
 * Token kosong = tidak diubah. Token baru dicek dulu ke Meta (/me); bila valid, daftar ad account langsung ditarik.
 */
settings.put("/bm", async c => {
  const b = await c.req.json<{ id?: string; name?: string; app_id?: string; token?: string }>();
  const name = String(b.name ?? "").trim(), appId = String(b.app_id ?? "").trim() || null, token = String(b.token ?? "").trim();
  if (!name) return c.json({ error: "Nama BM wajib diisi" }, 400);
  const now = new Date().toISOString();
  let owner: string | null = null;
  if (token) {
    const r = await fetch(`https://graph.facebook.com/${c.env.META_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const j = (await r.json().catch(() => ({}))) as { name?: string; error?: { message: string } };
    if (!r.ok || j.error) return c.json({ error: "Token ditolak Meta: " + (j.error?.message ?? `HTTP ${r.status}`) }, 400);
    owner = j.name ?? null;
  }
  let id = b.id;
  if (id) {
    const ada = await c.env.DB.prepare("SELECT id FROM business_managers WHERE id=?").bind(id).first();
    if (!ada) return c.json({ error: "BM tidak ditemukan" }, 404);
    await c.env.DB.prepare("UPDATE business_managers SET name=?, app_id=? WHERE id=?").bind(name, appId, id).run();
  } else {
    // id = slug nama, diberi akhiran angka bila sudah dipakai
    const dasar = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "bm";
    id = dasar;
    for (let i = 2; await c.env.DB.prepare("SELECT 1 FROM business_managers WHERE id=?").bind(id).first(); i++) id = `${dasar}-${i}`;
    await c.env.DB.prepare("INSERT INTO business_managers (id, name, app_id, token_secret, is_active) VALUES (?,?,?,'',1)").bind(id, name, appId).run();
  }
  if (token) await c.env.DB.prepare("UPDATE business_managers SET token=?, token_owner=?, token_checked_at=?, token_error=NULL WHERE id=?")
    .bind(token, owner, now, id).run();
  const bm = await c.env.DB.prepare("SELECT token, token_secret FROM business_managers WHERE id=?").bind(id).first<{ token: string | null; token_secret: string | null }>();
  const akun = bm && hasMetaToken(c.env, bm) ? await discoverBm(c.env, id) : null;
  return c.json({ ok: true, id, owner, accounts: akun });
});

/** Tarik ulang daftar ad account satu BM. */
settings.post("/bm/:id/discover", async c => c.json(await discoverBm(c.env, c.req.param("id"))));

/** Hapus BM beserta daftar ad account-nya. Data insight yang sudah tertarik tetap disimpan. */
settings.delete("/bm/:id", async c => {
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM ad_accounts WHERE bm_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM business_managers WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true });
});

/**
 * Centang ad account yang ditarik untuk satu BM, plus tax & admin (% dari spend) per akun.
 * { bm_id, selected: [act_id…], biaya?: { [act_id]: { tax_pct, admin_pct } } } — akun yang tidak dicentang dilepas.
 */
settings.put("/ad-accounts", async c => {
  const b = await c.req.json<{ bm_id: string; selected: string[]; biaya?: Record<string, { tax_pct?: unknown; admin_pct?: unknown }> }>();
  if (!b.bm_id) return c.json({ error: "bm_id wajib" }, 400);
  // Kosong = NULL (belum diisi); selain itu harus 0–100
  const persen = (v: unknown) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
  };
  const biaya = Object.entries(b.biaya ?? {}).map(([id, v]) => ({ id, tax: persen(v?.tax_pct), admin: persen(v?.admin_pct) }));
  const salah = biaya.find(x => Number.isNaN(x.tax) || Number.isNaN(x.admin));
  if (salah) return c.json({ error: `Tax / admin akun ${salah.id} harus angka 0–100 (%)` }, 400);
  const db = c.env.DB;
  const [r] = await db.batch([
    db.prepare("UPDATE ad_accounts SET is_selected=CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE bm_id=?")
      .bind(JSON.stringify(b.selected ?? []), b.bm_id),
    ...biaya.map(x => db.prepare("UPDATE ad_accounts SET tax_pct=?, admin_pct=? WHERE id=? AND bm_id=?").bind(x.tax, x.admin, x.id, b.bm_id)),
  ]);
  return c.json({ ok: true, updated: r.meta.changes, selected: (b.selected ?? []).length });
});

/** Tarik ulang daftar ad account & store dari Meta/Scalev. */
settings.post("/discover", async c => {
  const [accounts, stores] = await Promise.all([discoverAdAccounts(c.env), discoverStores(c.env)]);
  return c.json({ accounts, stores });
});

/** Simpan centang: { ad_accounts: [{id, is_selected, store_id}], stores: [{id, is_selected}] } */
settings.put("/", async c => {
  const body = await c.req.json<{ ad_accounts?: { id: string; is_selected: boolean; store_id?: number | null }[]; stores?: { id: number; is_selected: boolean }[] }>();
  const batch: D1PreparedStatement[] = [];
  for (const a of body.ad_accounts ?? [])
    batch.push(c.env.DB.prepare("UPDATE ad_accounts SET is_selected=?, store_id=? WHERE id=?").bind(a.is_selected ? 1 : 0, a.store_id ?? null, a.id));
  for (const s of body.stores ?? [])
    batch.push(c.env.DB.prepare("UPDATE stores SET is_selected=? WHERE id=?").bind(s.is_selected ? 1 : 0, s.id));
  if (batch.length) await c.env.DB.batch(batch);
  return c.json({ ok: true, updated: batch.length });
});

/** Kelompok produk: buat/ubah. { id, name, store_id?, match_prefix? } */
settings.put("/product-groups", async c => {
  const g = await c.req.json<{ id: string; name: string; store_id?: number; match_prefix?: string }>();
  await c.env.DB.prepare(
    `INSERT INTO product_groups (id, name, store_id, match_prefix) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, store_id=excluded.store_id, match_prefix=excluded.match_prefix`)
    .bind(g.id, g.name, g.store_id ?? null, g.match_prefix ?? null).run();
  await autoMapCampaigns(c.env);
  return c.json({ ok: true });
});

/** Kategori Data Produk pilihan manual. { item_key, category } — category null = kembali ke tebakan otomatis. */
settings.put("/product-category", async c => {
  const b = await c.req.json<{ item_key: string; category: Kategori | null }>();
  if (!b.item_key) return c.json({ error: "item_key wajib" }, 400);
  if (b.category == null) await c.env.DB.prepare("DELETE FROM product_categories WHERE item_key=?").bind(b.item_key).run();
  else if (!KATEGORI.includes(b.category)) return c.json({ error: "category harus PU, PB, BO, atau NONE" }, 400);
  else await c.env.DB.prepare(
    `INSERT INTO product_categories (item_key, category, updated_at) VALUES (?,?,?)
     ON CONFLICT(item_key) DO UPDATE SET category=excluded.category, updated_at=excluded.updated_at`)
    .bind(b.item_key, b.category, new Date().toISOString()).run();
  return c.json({ ok: true });
});

/** Gabungan produk Data Produk: buat (tanpa id) atau ubah. { id?, name, items: [{key, name}] } */
settings.put("/produk-gabungan", async c => {
  const b = await c.req.json<{ id?: number; name: string; items: { key: string; name: string }[] }>();
  const name = String(b.name ?? "").trim();
  const items = (b.items ?? []).filter(i => i && typeof i.key === "string" && i.key).map(i => ({ key: i.key, name: String(i.name ?? i.key) }));
  if (!name) return c.json({ error: "nama wajib diisi" }, 400);
  if (!items.length) return c.json({ error: "pilih minimal satu produk" }, 400);
  const now = new Date().toISOString();
  if (b.id) {
    await c.env.DB.prepare("UPDATE produk_gabungan SET name=?, items=?, updated_at=? WHERE id=?").bind(name, JSON.stringify(items), now, b.id).run();
    return c.json({ ok: true, id: b.id });
  }
  const r = await c.env.DB.prepare("INSERT INTO produk_gabungan (name, items, created_at, updated_at) VALUES (?,?,?,?)")
    .bind(name, JSON.stringify(items), now, now).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

settings.delete("/produk-gabungan/:id", async c => {
  await c.env.DB.prepare("DELETE FROM produk_gabungan WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** Editor konten (halaman Iklan Meta › Konten): nama + kode di nama iklan. Satu kode hanya boleh milik satu editor. */
settings.put("/editor-konten", async c => {
  const b = await c.req.json<{ id?: number; name: string; codes: string[] }>();
  const name = String(b.name ?? "").trim();
  const codes = [...new Set((b.codes ?? []).map(k => String(k).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean))];
  if (!name) return c.json({ error: "nama editor wajib diisi" }, 400);
  if (!codes.length) return c.json({ error: "isi minimal satu kode" }, 400);
  const lain = await c.env.DB.prepare("SELECT id, name, codes FROM editor_konten WHERE id<>?").bind(b.id ?? 0).all<{ id: number; name: string; codes: string }>();
  for (const e of lain.results) {
    const bentrok = (JSON.parse(e.codes) as string[]).filter(k => codes.includes(k));
    if (bentrok.length) return c.json({ error: `kode ${bentrok.join(", ")} sudah dipakai ${e.name}` }, 400);
  }
  const now = new Date().toISOString();
  if (b.id) {
    await c.env.DB.prepare("UPDATE editor_konten SET name=?, codes=?, updated_at=? WHERE id=?").bind(name, JSON.stringify(codes), now, b.id).run();
    return c.json({ ok: true, id: b.id });
  }
  const r = await c.env.DB.prepare("INSERT INTO editor_konten (name, codes, created_at, updated_at) VALUES (?,?,?,?)")
    .bind(name, JSON.stringify(codes), now, now).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

settings.delete("/editor-konten/:id", async c => {
  await c.env.DB.prepare("DELETE FROM editor_konten WHERE id=?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

/** Petakan campaign ke kelompok produk. { campaign_id, product_group } (null = lepas) */
settings.put("/campaign-map", async c => {
  const b = await c.req.json<{ campaign_id: string; product_group: string | null }>();
  await c.env.DB.prepare("UPDATE campaigns SET product_group=? WHERE id=?").bind(b.product_group, b.campaign_id).run();
  return c.json({ ok: true });
});

/** Manajemen SKU: master SKU internal (HPP, gudang, niche) — terpisah dari katalog Scalev. */
type Sku = { id?: number; sku: string; produk: string; hpp: number; kategori?: string | null; gudang?: string | null; keterangan?: string | null; niche?: string | null };
const teks = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
/** Rapikan satu baris masukan; null = tidak valid (SKU & produk wajib, HPP angka ≥ 0). */
function bersihkanSku(b: Partial<Sku>): Sku | null {
  const sku = teks(b.sku), produk = teks(b.produk), hpp = Math.round(Number(b.hpp ?? 0));
  if (!sku || !produk || !Number.isFinite(hpp) || hpp < 0) return null;
  return { sku, produk, hpp, kategori: teks(b.kategori), gudang: teks(b.gudang), keterangan: teks(b.keterangan), niche: teks(b.niche) };
}

settings.get("/sku", async c => {
  const [rows, items, gudang, varian, order30] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM sku_produk ORDER BY sku"),
    c.env.DB.prepare(
      `SELECT i.sku_id, i.produk_id, i.qty, i.bonus, p.nama, p.hpp FROM sku_produk_item i JOIN produk_list p ON p.id=i.produk_id ORDER BY i.sku_id, i.urut`),
    c.env.DB.prepare("SELECT id, nama, jenis, biaya_penanganan, biaya_lain, biaya_lain_ket FROM gudang ORDER BY nama"),
    // Varian / bundle aktif di katalog Scalev beserta SKU-nya (SKU yang ditautkan di Scalev)
    c.env.DB.prepare("SELECT kind, name, product_name, price, UPPER(TRIM(sku)) AS sku, cogs FROM catalog_items WHERE COALESCE(status,'')<>'deleted' ORDER BY name"),
    // Order 30 hari terakhir per nama varian (kunci final_variants = nama varian katalog) — untuk mengurutkan varian tanpa SKU
    c.env.DB.prepare(
      `SELECT je.key AS name, COUNT(*) AS n FROM orders o, json_each(json_extract(o.raw_json,'$.final_variants')) je
       WHERE o.is_spam=0 AND o.draft_date >= date('now','+7 hours','-29 days') GROUP BY je.key`),
  ]);
  const nOrder = new Map((order30.results as { name: string; n: number }[]).map(x => [x.name, x.n]));
  const per = new Map<number, unknown[]>();
  for (const r of items.results as { sku_id: number }[]) { const { sku_id, ...x } = r; per.set(sku_id, [...(per.get(sku_id) ?? []), x]); }
  type Varian = { kind: string; name: string; product_name: string | null; price: number | null; sku: string | null; cogs: number | null };
  const perSku = new Map<string, Varian[]>(), tanpaSku: (Omit<Varian, "sku"> & { order30: number })[] = [];
  for (const v of varian.results as Varian[]) {
    if (!v.sku) { const { sku: _, ...x } = v; tanpaSku.push({ ...x, order30: nOrder.get(v.name) ?? 0 }); continue; }
    perSku.set(v.sku, [...(perSku.get(v.sku) ?? []), v]);
  }
  const ada = new Set((rows.results as { sku: string }[]).map(r => String(r.sku).trim().toUpperCase()));
  return c.json({
    rows: (rows.results as { id: number; sku: string }[]).map(r => ({ ...r, items: per.get(r.id) ?? [],
      scalev: (perSku.get(String(r.sku).trim().toUpperCase()) ?? []).map(v => v.name) })),
    gudang: gudang.results,
    // SKU yang dipakai varian Scalev tetapi belum ada di Manajemen SKU (HPP order-nya memakai COGS Scalev / belum terhitung)
    scalev_belum: [...perSku].filter(([k]) => !ada.has(k)).map(([sku, v]) => ({ sku, varian: v.map(x => x.name), cogs: v.find(x => (x.cogs ?? 0) > 0)?.cogs ?? null })),
    scalev_tanpa_sku: tanpaSku.sort((a, b) => b.order30 - a.order30 || a.name.localeCompare(b.name)),
  });
});

/**
 * Isi produk SKU dari List Produk. Produk yang sama dipilih dua kali → qty dijumlah.
 * Mengembalikan daftar bersih + HPP = Σ qty × HPP produk, atau pesan error.
 */
async function bersihkanIsiSku(db: D1Database, items: unknown) {
  const gabung = new Map<number, number>(), bonus = new Set<number>();
  for (const i of (Array.isArray(items) ? items : []) as { produk_id?: unknown; qty?: unknown; bonus?: unknown }[]) {
    const id = Number(i?.produk_id), qty = Math.round(Number(i?.qty));
    if (!Number.isInteger(id) || !(qty > 0)) return { error: "setiap isi produk harus punya produk dan qty ≥ 1" };
    gabung.set(id, (gabung.get(id) ?? 0) + qty);
    if (i?.bonus) bonus.add(id);
  }
  if (!gabung.size) return { items: [] as { produk_id: number; qty: number; bonus: number }[], hpp: null };
  const ada = await db.prepare(`SELECT id, hpp FROM produk_list WHERE id IN (${[...gabung.keys()].map(() => "?").join(",")})`)
    .bind(...gabung.keys()).all<{ id: number; hpp: number }>();
  if (ada.results.length !== gabung.size) return { error: "ada produk yang sudah tidak ada di List Produk" };
  const hpp = ada.results.reduce((a, p) => a + p.hpp * (gabung.get(p.id) ?? 0), 0);
  return { items: [...gabung].map(([produk_id, qty]) => ({ produk_id, qty, bonus: bonus.has(produk_id) ? 1 : 0 })), hpp };
}

/**
 * Hitung ulang HPP SKU: hpp_dasar = Σ qty × HPP List Produk (bila SKU tersusun dari List Produk) atau
 * HPP manual; hpp = hpp_dasar + biaya gudang per paket (penanganan + lain) dari List Gudang.
 * SQLite memakai nilai lama di seluruh SET, jadi ekspresi dasar ditulis ulang untuk hpp.
 */
function hitungUlangHpp(db: D1Database, saring: { produkId?: number; gudangId?: number; skuId?: number } = {}) {
  const isi = `(SELECT SUM(i.qty*p.hpp) FROM sku_produk_item i JOIN produk_list p ON p.id=i.produk_id WHERE i.sku_id=sku_produk.id)`;
  const dasar = `COALESCE(${isi}, hpp_dasar, hpp, 0)`;
  const biaya = `COALESCE((SELECT g.biaya_penanganan+g.biaya_lain FROM gudang g WHERE g.id=sku_produk.gudang_id), 0)`;
  const [where, args]: [string, number[]] = saring.produkId != null ? ["WHERE id IN (SELECT sku_id FROM sku_produk_item WHERE produk_id=?)", [saring.produkId]]
    : saring.gudangId != null ? ["WHERE gudang_id=?", [saring.gudangId]]
    : saring.skuId != null ? ["WHERE id=?", [saring.skuId]] : ["", []];
  return db.prepare(`UPDATE sku_produk SET hpp_dasar=${dasar}, hpp=${dasar}+${biaya} ${where}`).bind(...args);
}

/** Sambungkan isian gudang teks (impor CSV / data lama) ke List Gudang berdasarkan nama. */
const SAMBUNG_GUDANG = `UPDATE sku_produk SET gudang_id=(SELECT g.id FROM gudang g WHERE g.nama=TRIM(sku_produk.gudang) COLLATE NOCASE)`;

/**
 * Buat (tanpa id) atau ubah satu SKU. Kode SKU harus unik (tidak peka huruf besar/kecil).
 * items: [{produk_id, qty}] dari List Produk — bila ada, HPP dasar = Σ qty × HPP produk (HPP kiriman diabaikan).
 * gudang_id: gudang dari List Gudang — biaya per paketnya ditambahkan ke HPP. Tanpa gudang_id,
 * isian gudang teks lama (gudang) tetap disimpan apa adanya.
 */
settings.put("/sku", async c => {
  const b = await c.req.json<Partial<Sku> & { items?: unknown; gudang_id?: number | null }>();
  const db = c.env.DB;
  const isi = await bersihkanIsiSku(db, b.items);
  if ("error" in isi) return c.json({ error: isi.error }, 400);
  let gudangId: number | null = null, gudangNama = b.gudang;
  if (b.gudang_id != null) {
    const g = await db.prepare("SELECT id, nama FROM gudang WHERE id=?").bind(b.gudang_id).first<{ id: number; nama: string }>();
    if (!g) return c.json({ error: "gudang tidak ditemukan di List Gudang" }, 404);
    gudangId = g.id; gudangNama = g.nama;
  }
  const s = bersihkanSku({ ...b, gudang: gudangNama, hpp: isi.hpp ?? b.hpp });
  if (!s) return c.json({ error: "SKU dan produk wajib diisi, HPP harus angka ≥ 0" }, 400);
  const dobel = await db.prepare("SELECT id FROM sku_produk WHERE sku=? AND id IS NOT ?").bind(s.sku, b.id ?? null).first();
  if (dobel) return c.json({ error: `SKU ${s.sku} sudah ada` }, 409);
  const now = new Date().toISOString();
  let id = b.id;
  // s.hpp = HPP dasar; hpp final (+ biaya gudang) dihitung ulang di bawah
  if (id) {
    await db.prepare("UPDATE sku_produk SET sku=?, produk=?, hpp=?, hpp_dasar=?, kategori=?, gudang=?, gudang_id=?, keterangan=?, niche=?, updated_at=? WHERE id=?")
      .bind(s.sku, s.produk, s.hpp, s.hpp, s.kategori, s.gudang, gudangId, s.keterangan, s.niche, now, id).run();
  } else {
    const r = await db.prepare(
      "INSERT INTO sku_produk (sku, produk, hpp, hpp_dasar, kategori, gudang, gudang_id, keterangan, niche, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(s.sku, s.produk, s.hpp, s.hpp, s.kategori, s.gudang, gudangId, s.keterangan, s.niche, now, now).run();
    id = Number(r.meta.last_row_id);
  }
  await db.batch([
    db.prepare("DELETE FROM sku_produk_item WHERE sku_id=?").bind(id),
    ...isi.items.map((x, i) => db.prepare("INSERT INTO sku_produk_item (sku_id, produk_id, qty, urut, bonus) VALUES (?,?,?,?,?)").bind(id, x.produk_id, x.qty, i, x.bonus)),
    hitungUlangHpp(db, { skuId: id }),
  ]);
  return c.json({ ok: true, id });
});

/**
 * Impor banyak SKU sekaligus: SKU yang sudah ada diperbarui, yang baru ditambahkan. { rows: Sku[] }
 * Kolom HPP CSV = HPP dasar (tanpa biaya gudang). HPP SKU yang tersusun dari List Produk tidak ditimpa
 * (tetap Σ qty × HPP produk). Gudang yang namanya ada di List Gudang langsung tersambung + biayanya.
 */
settings.put("/sku/impor", async c => {
  const b = await c.req.json<{ rows: Partial<Sku>[] }>();
  const valid = (b.rows ?? []).map(bersihkanSku).filter((s): s is Sku => s !== null);
  if (!valid.length) return c.json({ error: "tidak ada baris valid" }, 400);
  const now = new Date().toISOString();
  const db = c.env.DB;
  const stmt = db.prepare(
    `INSERT INTO sku_produk (sku, produk, hpp, hpp_dasar, kategori, gudang, keterangan, niche, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(sku) DO UPDATE SET produk=excluded.produk,
       hpp_dasar=CASE WHEN EXISTS (SELECT 1 FROM sku_produk_item WHERE sku_id=sku_produk.id) THEN sku_produk.hpp_dasar ELSE excluded.hpp_dasar END,
       kategori=excluded.kategori, gudang=excluded.gudang,
       keterangan=excluded.keterangan, niche=excluded.niche, updated_at=excluded.updated_at`);
  await db.batch([
    ...valid.map(s => stmt.bind(s.sku, s.produk, s.hpp, s.hpp, s.kategori, s.gudang, s.keterangan, s.niche, now, now)),
    db.prepare(SAMBUNG_GUDANG),
    hitungUlangHpp(db),
  ]);
  return c.json({ ok: true, saved: valid.length, skipped: (b.rows?.length ?? 0) - valid.length });
});

/**
 * Tarik SKU dari katalog Scalev (catalog_items aktif yang ber-SKU), satu baris per kode SKU.
 * Varian berbeda ukuran/warna memakai SKU & HPP (cogs) yang sama, jadi nama diambil dari nama produk
 * bila satu SKU dipakai beberapa varian. SKU baru ditambahkan; SKU yang sudah ada hanya diisi
 * kolom yang masih kosong (HPP 0, produk category kosong) — isian manual tidak ditimpa.
 */
settings.post("/sku/tarik-scalev", async c => {
  const db = c.env.DB;
  const items = await db.prepare(
    `SELECT TRIM(sku) AS sku, name, product_name, cogs, price FROM catalog_items
     WHERE status='active' AND sku IS NOT NULL AND TRIM(sku)<>'' ORDER BY synced_at DESC`)
    .all<{ sku: string; name: string; product_name: string | null; cogs: number | null; price: number | null }>();
  const per = new Map<string, typeof items.results>();
  for (const it of items.results) { const k = it.sku.toUpperCase(); per.set(k, [...(per.get(k) ?? []), it]); }

  const now = new Date().toISOString();
  const ada = await db.prepare("SELECT UPPER(sku) AS k FROM sku_produk").all<{ k: string }>();
  const sudah = new Set(ada.results.map(r => r.k));
  const tambah = db.prepare(
    "INSERT INTO sku_produk (sku, produk, hpp, hpp_dasar, kategori, gudang, keterangan, niche, created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,NULL,?,?)");
  // HPP dasar hanya diisi bila masih 0 dan SKU tidak tersusun dari List Produk; HPP final dihitung ulang di akhir
  const lengkapi = db.prepare(
    `UPDATE sku_produk SET hpp_dasar=CASE WHEN COALESCE(hpp_dasar,0)=0 AND NOT EXISTS (SELECT 1 FROM sku_produk_item WHERE sku_id=sku_produk.id) THEN ? ELSE hpp_dasar END,
       kategori=COALESCE(kategori, ?),
       updated_at=CASE WHEN (COALESCE(hpp_dasar,0)=0 AND ?>0) OR (kategori IS NULL AND ? IS NOT NULL) THEN ? ELSE updated_at END
     WHERE sku=?`);
  const stmts: D1PreparedStatement[] = [];
  let baru = 0, tanpaHpp = 0;
  for (const vs of per.values()) {
    const v = vs[0];
    const hpp = Math.round(vs.find(x => x.cogs != null && x.cogs > 0)?.cogs ?? 0);
    const produk = (vs.length > 1 ? v.product_name : null) ?? v.name;
    const kategori = teks(v.product_name);
    if (!hpp) tanpaHpp++;
    if (sudah.has(v.sku.toUpperCase())) { stmts.push(lengkapi.bind(hpp, kategori, hpp, kategori, now, v.sku)); continue; }
    const harga = [...new Set(vs.map(x => x.price).filter((p): p is number => p != null))];
    const ket = `Scalev: ${vs.length} varian` + (harga.length === 1 ? ` · harga jual Rp ${harga[0].toLocaleString("id-ID")}` : "");
    stmts.push(tambah.bind(v.sku, produk, hpp, hpp, kategori, ket, now, now));
    baru++;
  }
  if (stmts.length) await db.batch([...stmts, hitungUlangHpp(db)]);
  const tanpaSku = await db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE status='active' AND (sku IS NULL OR TRIM(sku)='')").first<{ n: number }>();
  return c.json({ ok: true, sku_scalev: per.size, baru, sudah_ada: per.size - baru, tanpa_hpp: tanpaHpp, varian_tanpa_sku: tanpaSku?.n ?? 0 });
});

settings.delete("/sku/:id", async c => {
  const id = Number(c.req.param("id"));
  const dipakai = await c.env.DB.prepare(
    "SELECT GROUP_CONCAT(b.kode, ', ') AS kode FROM sku_bundling_item i JOIN sku_bundling b ON b.id=i.bundle_id WHERE i.sku_id=?")
    .bind(id).first<{ kode: string | null }>();
  if (dipakai?.kode) return c.json({ error: `SKU masih dipakai di produk bundling ${dipakai.kode}` }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sku_produk_item WHERE sku_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM barang_sku WHERE sku_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM sku_produk WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true });
});

/**
 * Produk Bundling: paket jual tersusun dari SKU dasar (sku_produk) + qty.
 * HPP otomatis = Σ qty × HPP komponen; HPP final = hpp_manual bila diisi, selain itu HPP otomatis.
 * Kode otomatis TMB-00001… diambil dari penghitung di kv yang hanya naik, jadi kode bundling
 * yang sudah dihapus tidak dipakai ulang (kode yang sudah dipasang di Scalev tidak bisa tertukar).
 */
type Bundling = { id?: number; kode?: string; nama: string; items: { sku_id: number; qty: number }[]; hpp_manual?: number | null;
  kategori?: string | null; gudang?: string | null; keterangan?: string | null; niche?: string | null };
const POLA_TMB = /^TMB-(\d+)$/i;

settings.get("/bundling", async c => {
  const [b, it] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM sku_bundling ORDER BY kode").all<Record<string, unknown> & { id: number; hpp_manual: number | null }>(),
    c.env.DB.prepare(
      `SELECT i.bundle_id, i.sku_id, i.qty, s.sku, s.produk, s.hpp, s.gudang FROM sku_bundling_item i JOIN sku_produk s ON s.id=i.sku_id
       ORDER BY i.bundle_id, i.urut`).all<{ bundle_id: number; sku_id: number; qty: number; sku: string; produk: string; hpp: number; gudang: string | null }>(),
  ]);
  const per = new Map<number, typeof it.results>();
  for (const r of it.results) per.set(r.bundle_id, [...(per.get(r.bundle_id) ?? []), r]);
  const rows = b.results.map(r => {
    const items = (per.get(r.id) ?? []).map(({ bundle_id, ...x }) => x);
    const hpp_otomatis = items.reduce((a, x) => a + x.qty * x.hpp, 0);
    return { ...r, items, hpp_otomatis, hpp_final: r.hpp_manual ?? hpp_otomatis };
  });
  return c.json({ rows });
});

/** Rapikan & validasi satu bundling. Mengembalikan pesan error bila tidak valid. */
async function bersihkanBundling(db: D1Database, b: Partial<Bundling>) {
  const nama = teks(b.nama), kode = teks(b.kode);
  const gabung = new Map<number, number>();              // SKU yang sama dipilih dua kali → qty dijumlah
  for (const i of b.items ?? []) {
    const id = Number(i?.sku_id), qty = Math.round(Number(i?.qty));
    if (!Number.isInteger(id) || !(qty > 0)) return { error: "setiap komponen harus punya SKU dan qty ≥ 1" };
    gabung.set(id, (gabung.get(id) ?? 0) + qty);
  }
  if (!nama) return { error: "nama produk wajib diisi" };
  if (!gabung.size) return { error: "pilih minimal satu SKU komponen" };
  const hm = b.hpp_manual == null || String(b.hpp_manual).trim() === "" ? null : Math.round(Number(b.hpp_manual));
  if (hm != null && !(hm >= 0)) return { error: "HPP manual harus angka ≥ 0" };
  const ada = await db.prepare(`SELECT COUNT(*) AS n FROM sku_produk WHERE id IN (${[...gabung.keys()].map(() => "?").join(",")})`)
    .bind(...gabung.keys()).first<{ n: number }>();
  if ((ada?.n ?? 0) !== gabung.size) return { error: "ada SKU komponen yang sudah tidak ada di Manajemen SKU" };
  return { ok: { kode, nama, hpp_manual: hm, kategori: teks(b.kategori), gudang: teks(b.gudang), keterangan: teks(b.keterangan), niche: teks(b.niche),
    items: [...gabung].map(([sku_id, qty]) => ({ sku_id, qty })) } };
}

/** Kode TMB berikutnya: lebih besar dari penghitung kv maupun kode TMB mana pun yang ada (termasuk hasil impor). */
async function kodeTmbBaru(db: D1Database) {
  const kv = await db.prepare("SELECT value FROM kv WHERE key='bundling_seq'").first<{ value: string }>();
  const semua = await db.prepare("SELECT kode FROM sku_bundling WHERE kode LIKE 'TMB-%'").all<{ kode: string }>();
  let n = Number(kv?.value ?? 0);
  for (const r of semua.results) { const m = POLA_TMB.exec(r.kode); if (m) n = Math.max(n, Number(m[1])); }
  n++;
  await db.prepare("INSERT INTO kv (key, value) VALUES ('bundling_seq', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(n)).run();
  return `TMB-${String(n).padStart(5, "0")}`;
}

settings.put("/bundling", async c => {
  const b = await c.req.json<Partial<Bundling>>();
  const r = await bersihkanBundling(c.env.DB, b);
  if (!r.ok) return c.json({ error: r.error }, 400);
  const s = r.ok, db = c.env.DB, now = new Date().toISOString();
  if (s.kode) {
    const dobel = await db.prepare("SELECT id FROM sku_bundling WHERE kode=? AND id IS NOT ?").bind(s.kode, b.id ?? null).first();
    if (dobel) return c.json({ error: `kode ${s.kode} sudah dipakai` }, 409);
  }
  let id = b.id ? Number(b.id) : 0;
  if (id) {
    const lama = await db.prepare("SELECT kode FROM sku_bundling WHERE id=?").bind(id).first<{ kode: string }>();
    if (!lama) return c.json({ error: "produk bundling tidak ditemukan" }, 404);
    await db.prepare("UPDATE sku_bundling SET kode=?, nama=?, hpp_manual=?, kategori=?, gudang=?, keterangan=?, niche=?, updated_at=? WHERE id=?")
      .bind(s.kode ?? lama.kode, s.nama, s.hpp_manual, s.kategori, s.gudang, s.keterangan, s.niche, now, id).run();
  } else {
    const kode = s.kode ?? await kodeTmbBaru(db);
    const ins = await db.prepare("INSERT INTO sku_bundling (kode, nama, hpp_manual, kategori, gudang, keterangan, niche, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(kode, s.nama, s.hpp_manual, s.kategori, s.gudang, s.keterangan, s.niche, now, now).run();
    id = Number(ins.meta.last_row_id);
  }
  const tulisItem = db.prepare("INSERT INTO sku_bundling_item (bundle_id, sku_id, qty, urut) VALUES (?,?,?,?)");
  await db.batch([db.prepare("DELETE FROM sku_bundling_item WHERE bundle_id=?").bind(id), ...s.items.map((i, n) => tulisItem.bind(id, i.sku_id, i.qty, n))]);
  return c.json({ ok: true, id });
});

/**
 * Impor dari spreadsheet. Komponen ditulis sebagai kode SKU (bukan id); baris yang SKU komponennya
 * tidak ada di Manajemen SKU dilewati dan dilaporkan. Kode yang sudah ada diperbarui.
 * { rows: [{ kode?, nama, komponen: [{sku, qty}], hpp_manual?, kategori?, gudang?, keterangan?, niche? }] }
 */
settings.put("/bundling/impor", async c => {
  const b = await c.req.json<{ rows: (Omit<Partial<Bundling>, "items"> & { baris?: number; komponen?: { sku: string; qty: number }[] })[] }>();
  const db = c.env.DB;
  const skus = await db.prepare("SELECT id, sku FROM sku_produk").all<{ id: number; sku: string }>();
  const idSku = new Map(skus.results.map(s => [s.sku.toUpperCase(), s.id]));
  const gagal: string[] = [];
  let saved = 0;
  for (const [n, r] of (b.rows ?? []).entries()) {
    const label = `baris ${r.baris ?? n + 2}${r.kode ? ` (${r.kode})` : ""}`;
    const hilang = (r.komponen ?? []).filter(k => !idSku.has(String(k.sku).trim().toUpperCase())).map(k => k.sku);
    if (hilang.length) { gagal.push(`${label}: SKU ${hilang.join(", ")} belum ada di Manajemen SKU`); continue; }
    const items = (r.komponen ?? []).map(k => ({ sku_id: idSku.get(String(k.sku).trim().toUpperCase())!, qty: k.qty }));
    const v = await bersihkanBundling(db, { ...r, items });
    if (!v.ok) { gagal.push(`${label}: ${v.error}`); continue; }
    const s = v.ok, now = new Date().toISOString();
    const lama = s.kode ? await db.prepare("SELECT id FROM sku_bundling WHERE kode=?").bind(s.kode).first<{ id: number }>() : null;
    let id = lama?.id ?? 0;
    if (id) await db.prepare("UPDATE sku_bundling SET nama=?, hpp_manual=?, kategori=?, gudang=?, keterangan=?, niche=?, updated_at=? WHERE id=?")
      .bind(s.nama, s.hpp_manual, s.kategori, s.gudang, s.keterangan, s.niche, now, id).run();
    else {
      const kode = s.kode ?? await kodeTmbBaru(db);
      const ins = await db.prepare("INSERT INTO sku_bundling (kode, nama, hpp_manual, kategori, gudang, keterangan, niche, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(kode, s.nama, s.hpp_manual, s.kategori, s.gudang, s.keterangan, s.niche, now, now).run();
      id = Number(ins.meta.last_row_id);
    }
    const tulisItem = db.prepare("INSERT INTO sku_bundling_item (bundle_id, sku_id, qty, urut) VALUES (?,?,?,?)");
    await db.batch([db.prepare("DELETE FROM sku_bundling_item WHERE bundle_id=?").bind(id), ...s.items.map((i, k) => tulisItem.bind(id, i.sku_id, i.qty, k))]);
    saved++;
  }
  return c.json({ ok: true, saved, gagal });
});

settings.delete("/bundling/:id", async c => {
  const id = Number(c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sku_bundling_item WHERE bundle_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM sku_bundling WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true });
});

/**
 * Inventory › List Gudang. Gudang buatan sendiri (sendiri | fulfillment | dropship) dan pasangan
 * nama gudang pengirim Mengantar ke gudang itu. Statistik paket dihitung dari salinan data
 * Mengantar (semua tanggal); data di Mengantar sendiri tidak pernah diubah.
 */
const JENIS_GUDANG = ["sendiri", "fulfillment", "dropship"];

settings.get("/gudang", async c => {
  const db = c.env.DB;
  const [gudang, pasangan, pengirim] = await db.batch([
    db.prepare("SELECT * FROM gudang ORDER BY nama"),
    db.prepare("SELECT shipper, gudang_id FROM gudang_pengirim"),
    db.prepare(
      `SELECT ${SHIP_GUDANG} AS shipper, COUNT(*) AS total,
         SUM(${SHIP_STATUS}='DELIVERED') AS delivered, SUM(${SHIP_STATUS}='RTS') AS rts,
         SUM(${SHIP_STATUS} IN ('ON_GOING','LOST')) AS on_going, SUM(s.is_cod=1) AS cod, MAX(s.created_at) AS last_at
       FROM shipments s GROUP BY shipper ORDER BY total DESC`),
  ]);
  const peta = new Map((pasangan.results as { shipper: string; gudang_id: number }[]).map(p => [p.shipper.toLowerCase(), p.gudang_id]));
  const shippers = (pengirim.results as { shipper: string }[]).map(s => ({ ...s, gudang_id: peta.get(s.shipper.toLowerCase()) ?? null }));
  // Pasangan yang namanya tidak (lagi) ada di data paket tetap dikirim supaya bisa dilepas
  const ada = new Set(shippers.map(s => s.shipper.toLowerCase()));
  const yatim = (pasangan.results as { shipper: string; gudang_id: number }[]).filter(p => !ada.has(p.shipper.toLowerCase()))
    .map(p => ({ shipper: p.shipper, total: 0, delivered: 0, rts: 0, on_going: 0, cod: 0, last_at: null, gudang_id: p.gudang_id }));
  return c.json({ rows: gudang.results, shippers: [...shippers, ...yatim] });
});

/**
 * Buat (tanpa id) atau ubah gudang. { id?, nama, jenis, kontak?, keterangan?, biaya_penanganan?, biaya_lain?, biaya_lain_ket?, shippers?: string[] }
 * shippers dipasangkan sekalian.
 */
settings.put("/gudang", async c => {
  const b = await c.req.json<{ id?: number; nama?: string; jenis?: string; kontak?: string; keterangan?: string; shippers?: string[];
    biaya_penanganan?: unknown; biaya_lain?: unknown; biaya_lain_ket?: string }>();
  const nama = teks(b.nama), jenis = String(b.jenis ?? "sendiri");
  if (!nama) return c.json({ error: "nama gudang wajib diisi" }, 400);
  if (!JENIS_GUDANG.includes(jenis)) return c.json({ error: "jenis harus sendiri, fulfillment, atau dropship" }, 400);
  // Biaya gudang per paket, dikenakan sekali per paket; kosong = 0
  const rp = (v: unknown) => Math.round(Number(v ?? 0) || 0);
  const penanganan = rp(b.biaya_penanganan), lain = rp(b.biaya_lain);
  if (penanganan < 0 || lain < 0) return c.json({ error: "biaya gudang harus angka ≥ 0" }, 400);
  const db = c.env.DB;
  const dobel = await db.prepare("SELECT id FROM gudang WHERE nama=? AND id IS NOT ?").bind(nama, b.id ?? null).first();
  if (dobel) return c.json({ error: `Gudang ${nama} sudah ada` }, 409);
  const now = new Date().toISOString();
  let id = b.id;
  if (id) {
    // SKU yang memakai gudang ini ikut berganti nama gudang dan HPP-nya (biaya gudang bisa berubah)
    await db.batch([
      db.prepare("UPDATE gudang SET nama=?, jenis=?, kontak=?, keterangan=?, biaya_penanganan=?, biaya_lain=?, biaya_lain_ket=?, updated_at=? WHERE id=?")
        .bind(nama, jenis, teks(b.kontak), teks(b.keterangan), penanganan, lain, teks(b.biaya_lain_ket), now, id),
      db.prepare("UPDATE sku_produk SET gudang=? WHERE gudang_id=?").bind(nama, id),
      hitungUlangHpp(db, { gudangId: id }),
    ]);
  } else {
    const r = await db.prepare("INSERT INTO gudang (nama, jenis, kontak, keterangan, biaya_penanganan, biaya_lain, biaya_lain_ket, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(nama, jenis, teks(b.kontak), teks(b.keterangan), penanganan, lain, teks(b.biaya_lain_ket), now, now).run();
    id = Number(r.meta.last_row_id);
  }
  const sh = (b.shippers ?? []).map(teks).filter((s): s is string => !!s);
  if (sh.length) await db.batch(sh.map(s => db.prepare(
    "INSERT INTO gudang_pengirim (shipper, gudang_id, updated_at) VALUES (?,?,?) ON CONFLICT(shipper) DO UPDATE SET gudang_id=excluded.gudang_id, updated_at=excluded.updated_at")
    .bind(s, id, now)));
  return c.json({ ok: true, id });
});

/** Pasangkan / lepas nama pengirim Mengantar. { shipper, gudang_id: number | null } */
settings.put("/gudang/pengirim", async c => {
  const b = await c.req.json<{ shipper?: string; gudang_id?: number | null }>();
  const shipper = teks(b.shipper);
  if (!shipper) return c.json({ error: "nama pengirim wajib diisi" }, 400);
  const db = c.env.DB;
  if (b.gudang_id == null) {
    await db.prepare("DELETE FROM gudang_pengirim WHERE shipper=?").bind(shipper).run();
    return c.json({ ok: true });
  }
  if (!await db.prepare("SELECT id FROM gudang WHERE id=?").bind(b.gudang_id).first()) return c.json({ error: "gudang tidak ditemukan" }, 404);
  await db.prepare(
    "INSERT INTO gudang_pengirim (shipper, gudang_id, updated_at) VALUES (?,?,?) ON CONFLICT(shipper) DO UPDATE SET gudang_id=excluded.gudang_id, updated_at=excluded.updated_at")
    .bind(shipper, b.gudang_id, new Date().toISOString()).run();
  return c.json({ ok: true });
});

/** Hapus gudang; pasangan nama pengirimnya ikut dilepas, SKU yang memakainya kehilangan biaya gudang di HPP. */
settings.delete("/gudang/:id", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const sku = await db.prepare("SELECT id FROM sku_produk WHERE gudang_id=?").bind(id).all<{ id: number }>();
  await db.batch([
    db.prepare("DELETE FROM gudang_pengirim WHERE gudang_id=?").bind(id),
    db.prepare("UPDATE sku_produk SET gudang_id=NULL WHERE gudang_id=?").bind(id),
    db.prepare("DELETE FROM gudang WHERE id=?").bind(id),
    ...sku.results.map(s => hitungUlangHpp(db, { skuId: s.id })),
  ]);
  return c.json({ ok: true });
});

/**
 * Inventory › List Produk: produk buatan sendiri (nama mengikuti nama iklan) dengan HPP manual yang
 * berlaku untuk semua gudang. SKU di Manajemen SKU memilih produk + qty dari daftar ini.
 */
settings.get("/produk-list", async c => {
  const [rows, pakai, barang, riwayat] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM produk_list ORDER BY nama"),
    c.env.DB.prepare("SELECT i.produk_id, i.qty, s.id AS sku_id, s.sku, s.produk FROM sku_produk_item i JOIN sku_produk s ON s.id=i.sku_id ORDER BY s.sku"),
    c.env.DB.prepare("SELECT produk_id, goods, qty FROM barang_produk ORDER BY goods"),
    c.env.DB.prepare("SELECT id, produk_id, berlaku, hpp, sumber, catatan FROM produk_hpp ORDER BY produk_id, berlaku DESC"),
  ]);
  const per = new Map<number, unknown[]>(), perBarang = new Map<number, unknown[]>(), perHpp = new Map<number, unknown[]>();
  for (const r of pakai.results as { produk_id: number }[]) { const { produk_id, ...x } = r; per.set(produk_id, [...(per.get(produk_id) ?? []), x]); }
  for (const r of barang.results as { produk_id: number }[]) { const { produk_id, ...x } = r; perBarang.set(produk_id, [...(perBarang.get(produk_id) ?? []), x]); }
  for (const r of riwayat.results as { produk_id: number }[]) { const { produk_id, ...x } = r; perHpp.set(produk_id, [...(perHpp.get(produk_id) ?? []), x]); }
  const sku = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(NOT EXISTS (SELECT 1 FROM sku_produk_item i WHERE i.sku_id=s.id)) AS belum FROM sku_produk s").first<{ total: number; belum: number | null }>();
  return c.json({ rows: (rows.results as { id: number }[]).map(r => ({ ...r, sku: per.get(r.id) ?? [], barang: perBarang.get(r.id) ?? [], riwayat: perHpp.get(r.id) ?? [] })),
    hari_ini: todayReport(),
    sku_total: sku?.total ?? 0, sku_belum: sku?.belum ?? 0 });
});

/** produk_list.hpp = HPP riwayat yang berlaku hari ini (dipakai SKU, laporan laba, dan tampilan HPP terkini). */
const hppTerkini = (db: D1Database, produkId: number) => db.prepare(
  "UPDATE produk_list SET hpp=COALESCE((SELECT hpp FROM produk_hpp WHERE produk_id=? AND berlaku<=? ORDER BY berlaku DESC LIMIT 1), hpp) WHERE id=?")
  .bind(produkId, todayReport(), produkId);

/**
 * Buat (tanpa id) atau ubah produk. { id?, nama, hpp, keterangan?, berlaku? }
 * HPP yang berubah dicatat di riwayat dengan tanggal berlaku (bawaan hari ini, tidak boleh di masa depan), supaya
 * paket / order sebelum tanggal itu tetap memakai HPP lama. HPP SKU yang memakai produk ini ikut dihitung ulang.
 */
settings.put("/produk-list", async c => {
  const b = await c.req.json<{ id?: number; nama?: string; hpp?: unknown; keterangan?: string; berlaku?: string }>();
  const nama = teks(b.nama), hpp = Math.round(Number(b.hpp ?? 0)), hari = todayReport();
  if (!nama || !Number.isFinite(hpp) || hpp < 0) return c.json({ error: "nama produk wajib diisi, HPP harus angka ≥ 0" }, 400);
  const berlaku = /^\d{4}-\d{2}-\d{2}$/.test(String(b.berlaku ?? "")) ? String(b.berlaku) : hari;
  if (berlaku > hari) return c.json({ error: "tanggal berlaku HPP tidak boleh di masa depan" }, 400);
  const db = c.env.DB;
  const dobel = await db.prepare("SELECT id FROM produk_list WHERE nama=? AND id IS NOT ?").bind(nama, b.id ?? null).first();
  if (dobel) return c.json({ error: `Produk ${nama} sudah ada` }, 409);
  const now = new Date().toISOString();
  if (b.id) {
    // HPP yang berlaku pada tanggal itu; bila berbeda → catat baris riwayat baru (atau timpa baris tanggal yang sama)
    const lama = await db.prepare("SELECT hpp FROM produk_hpp WHERE produk_id=? AND berlaku<=? ORDER BY berlaku DESC LIMIT 1")
      .bind(b.id, berlaku).first<{ hpp: number }>();
    await db.batch([
      db.prepare("UPDATE produk_list SET nama=?, keterangan=?, updated_at=? WHERE id=?").bind(nama, teks(b.keterangan), now, b.id),
      ...(lama?.hpp === hpp ? [] : [db.prepare(
        `INSERT INTO produk_hpp (produk_id, berlaku, hpp, sumber, created_at) VALUES (?,?,?,'manual',?)
         ON CONFLICT(produk_id, berlaku) DO UPDATE SET hpp=excluded.hpp, sumber='manual', created_at=excluded.created_at`).bind(b.id, berlaku, hpp, now)]),
      hppTerkini(db, b.id),
      hitungUlangHpp(db, { produkId: b.id }),
    ]);
    return c.json({ ok: true, id: b.id });
  }
  const r = await db.prepare("INSERT INTO produk_list (nama, hpp, keterangan, created_at, updated_at) VALUES (?,?,?,?,?)")
    .bind(nama, hpp, teks(b.keterangan), now, now).run();
  // Produk baru: HPP pertama berlaku untuk semua tanggal sebelumnya
  await db.prepare("INSERT INTO produk_hpp (produk_id, berlaku, hpp, sumber, created_at) VALUES (?, '2000-01-01', ?, 'awal', ?)")
    .bind(r.meta.last_row_id, hpp, now).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

/** Hapus satu baris riwayat HPP (bukan satu-satunya / yang paling awal); HPP terkini & HPP SKU dihitung ulang. */
settings.delete("/produk-list/:id/hpp/:hid", async c => {
  const id = Number(c.req.param("id")), hid = Number(c.req.param("hid")), db = c.env.DB;
  const awal = await db.prepare("SELECT id FROM produk_hpp WHERE produk_id=? ORDER BY berlaku LIMIT 1").bind(id).first<{ id: number }>();
  if (!awal || awal.id === hid) return c.json({ error: "HPP paling awal tidak bisa dihapus — ubah nilainya saja" }, 400);
  await db.batch([
    db.prepare("DELETE FROM produk_hpp WHERE id=? AND produk_id=?").bind(hid, id),
    hppTerkini(db, id),
    hitungUlangHpp(db, { produkId: id }),
  ]);
  return c.json({ ok: true });
});

/** Hapus produk; ditolak bila masih dipakai SKU supaya HPP SKU tidak berubah diam-diam. */
settings.delete("/produk-list/:id", async c => {
  const id = Number(c.req.param("id"));
  const dipakai = await c.env.DB.prepare(
    "SELECT GROUP_CONCAT(s.sku, ', ') AS sku FROM sku_produk_item i JOIN sku_produk s ON s.id=i.sku_id WHERE i.produk_id=?")
    .bind(id).first<{ sku: string | null }>();
  if (dipakai?.sku) return c.json({ error: `Produk masih dipakai di SKU ${dipakai.sku}` }, 409);
  const barang = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM barang_produk WHERE produk_id=?").bind(id).first<{ n: number }>();
  if (barang?.n) return c.json({ error: `Produk masih dipasangkan langsung ke ${barang.n} nama barang di SKU Mengantar` }, 409);
  const stok = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM stok_mutasi WHERE produk_id=?").bind(id).first<{ n: number }>();
  if (stok?.n) return c.json({ error: "Produk sudah punya catatan stok (stok awal / opname) — hapus catatannya dulu di Inventory › Stok" }, 409);
  await c.env.DB.prepare("DELETE FROM produk_list WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});

/**
 * Data Produk › SKU Mengantar: nama barang Mengantar (GOODS_DESC, semua tanggal) dipasangkan ke SKU + qty per paket
 * (barang_sku) atau langsung ke produk List Produk + qty (barang_produk), beserta jumlah paket per status.
 * Data Mengantar tidak diubah.
 */
settings.get("/barang", async c => {
  const db = c.env.DB;
  const [barang, pasangan, sku, isi, langsung, produk, kirim, gudang] = await db.batch([
    db.prepare(
      `SELECT ${SHIP_BARANG} AS goods, COUNT(*) AS total,
         SUM(s.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')) AS n30,
         SUM(${SHIP_STATUS}='DELIVERED') AS terkirim, SUM(${SHIP_STATUS} IN ('RTS','LOST')) AS rts,
         COUNT(DISTINCT ${SHIP_GUDANG}) AS n_gudang, MIN(s.created_at) AS first_at, MAX(s.created_at) AS last_at,
         -- Paket ber-order Scalev: isinya diambil dari order Scalev, tidak perlu pasangan manual
         SUM(${SHIP_SCALEV_ID} IS NOT NULL) AS n_scalev
       FROM shipments s GROUP BY goods COLLATE NOCASE ORDER BY total DESC`),   // beda huruf besar/kecil = barang yang sama (pasangan juga NOCASE)
    db.prepare("SELECT goods, sku_id, qty, updated_at FROM barang_sku"),
    db.prepare("SELECT id, sku, produk, hpp, hpp_dasar, gudang_id, niche FROM sku_produk ORDER BY sku"),
    db.prepare("SELECT i.sku_id, i.qty, p.nama FROM sku_produk_item i JOIN produk_list p ON p.id=i.produk_id ORDER BY i.sku_id, i.urut"),
    db.prepare("SELECT goods, produk_id, qty, updated_at FROM barang_produk ORDER BY goods, urut"),
    db.prepare("SELECT id, nama, hpp FROM produk_list ORDER BY nama"),
    // Gudang pengirim per nama barang (lewat pasangan nama pengirim di List Gudang) → biaya gudang per paket
    db.prepare(`SELECT ${SHIP_BARANG} AS goods, gp.gudang_id, COUNT(*) AS n FROM shipments s
      LEFT JOIN gudang_pengirim gp ON gp.shipper=${SHIP_GUDANG} GROUP BY goods COLLATE NOCASE, gp.gudang_id`),
    db.prepare("SELECT id, nama, biaya_penanganan, biaya_lain FROM gudang ORDER BY nama"),
  ]);
  type Pasangan = { goods: string; sku_id: number | null; qty: number; produk: { produk_id: number; qty: number }[]; updated_at: string | null };
  const peta = new Map<string, Pasangan>();
  for (const p of pasangan.results as { goods: string; sku_id: number; qty: number; updated_at: string }[])
    peta.set(p.goods.toLowerCase(), { ...p, produk: [] });
  for (const p of langsung.results as { goods: string; produk_id: number; qty: number; updated_at: string }[]) {
    const k = p.goods.toLowerCase(), x = peta.get(k) ?? { goods: p.goods, sku_id: null, qty: 1, produk: [], updated_at: p.updated_at };
    x.produk.push({ produk_id: p.produk_id, qty: p.qty });
    peta.set(k, x);
  }
  const per = new Map<number, { qty: number; nama: string }[]>();
  for (const r of isi.results as { sku_id: number; qty: number; nama: string }[]) per.set(r.sku_id, [...(per.get(r.sku_id) ?? []), { qty: r.qty, nama: r.nama }]);
  const perGudang = new Map<string, { gudang_id: number | null; n: number }[]>();
  for (const r of kirim.results as { goods: string; gudang_id: number | null; n: number }[]) {
    const k = r.goods.toLowerCase();
    perGudang.set(k, [...(perGudang.get(k) ?? []), { gudang_id: r.gudang_id, n: r.n }]);
  }
  const rows = (barang.results as { goods: string }[]).map(r => {
    const p = peta.get(r.goods.toLowerCase());
    peta.delete(r.goods.toLowerCase());
    return { ...r, sku_id: p?.sku_id ?? null, qty: p?.qty ?? 1, produk: p?.produk ?? [], updated_at: p?.updated_at ?? null,
      gudang: perGudang.get(r.goods.toLowerCase()) ?? [] };
  });
  // Pasangan yang ditambah manual sebelum ada paketnya tetap ditampilkan
  for (const p of peta.values()) rows.push({ total: 0, n30: 0, terkirim: 0, rts: 0, n_gudang: 0, n_scalev: 0, first_at: null, last_at: null, gudang: [], ...p } as typeof rows[number]);
  return c.json({
    rows,
    sku: (sku.results as { id: number }[]).map(s => ({ ...s, items: per.get(s.id) ?? [] })),
    produk: produk.results,
    gudang: gudang.results,
  });
});

type IsiBarang = { produk_id: number; qty: number };
type PasangBarang = { goods?: string; sku_id?: number | null; sku?: string; qty?: unknown; produk?: unknown };

/** Isi produk langsung: produk sama digabung (qty dijumlah); null = ada produk tak dikenal atau qty < 1. */
function bersihkanIsiBarang(items: unknown, ada: Set<number>): IsiBarang[] | null {
  const gabung = new Map<number, number>();
  for (const i of (Array.isArray(items) ? items : []) as { produk_id?: unknown; qty?: unknown }[]) {
    const id = Number(i?.produk_id), qty = Math.round(Number(i?.qty));
    if (!ada.has(id) || !(qty > 0)) return null;
    gabung.set(id, (gabung.get(id) ?? 0) + qty);
  }
  return [...gabung].map(([produk_id, qty]) => ({ produk_id, qty }));
}

/**
 * Pernyataan untuk mengganti pasangan satu nama barang: ke SKU, langsung ke produk, atau dilepas (keduanya kosong).
 * Pasangan lama di kedua tabel selalu dihapus dulu supaya satu nama barang hanya punya satu jenis pasangan.
 */
function gantiPasangan(db: D1Database, goods: string, now: string, p: { sku_id: number | null; qty: number; produk: IsiBarang[] }) {
  const s = [
    db.prepare("DELETE FROM barang_sku WHERE goods=?").bind(goods),
    db.prepare("DELETE FROM barang_produk WHERE goods=?").bind(goods),
  ];
  if (p.sku_id != null) s.push(db.prepare("INSERT INTO barang_sku (goods, sku_id, qty, updated_at) VALUES (?,?,?,?)").bind(goods, p.sku_id, p.qty, now));
  else p.produk.forEach((x, i) => s.push(
    db.prepare("INSERT INTO barang_produk (goods, produk_id, qty, urut, updated_at) VALUES (?,?,?,?,?)").bind(goods, x.produk_id, x.qty, i, now)));
  return s;
}

/** Rapikan satu masukan pasangan; string = pesan error. SKU boleh berupa id atau kode; produk = [{ produk_id, qty }]. */
function bacaPasangan(r: PasangBarang, skuId: Set<number>, skuKode: Map<string, number>, produkId: Set<number>) {
  const goods = teks(r?.goods);
  if (!goods) return "nama barang wajib diisi";
  const kode = teks(r.sku);
  const sku_id = r.sku_id != null ? Number(r.sku_id) : kode ? skuKode.get(kode.toUpperCase()) ?? -1 : null;
  const qty = Math.round(Number(r.qty ?? 1));
  if (sku_id != null) {
    if (!skuId.has(sku_id)) return "SKU tidak ditemukan";
    if (!(qty > 0)) return "qty harus ≥ 1";
    return { goods, sku_id, qty, produk: [] };
  }
  const produk = bersihkanIsiBarang(r.produk, produkId);
  if (!produk) return "setiap isi produk harus produk dari List Produk dengan qty ≥ 1";
  return { goods, sku_id: null, qty: 1, produk };
}

async function kamusPasangan(db: D1Database) {
  const [sku, produk] = await db.batch([db.prepare("SELECT id, sku FROM sku_produk"), db.prepare("SELECT id FROM produk_list")]);
  const s = sku.results as { id: number; sku: string }[];
  return [new Set(s.map(x => x.id)), new Map(s.map(x => [x.sku.toUpperCase(), x.id])), new Set((produk.results as { id: number }[]).map(x => x.id))] as const;
}

/**
 * Pasangkan banyak nama barang sekaligus (impor CSV / terapkan saran).
 * { rows: [{ goods, sku_id? | sku?, qty?, produk? }] } — tanpa SKU dan tanpa produk = lepas pasangan.
 */
settings.put("/barang/massal", async c => {
  const b = await c.req.json<{ rows?: PasangBarang[] }>();
  const db = c.env.DB, [skuId, skuKode, produkId] = await kamusPasangan(db);
  const now = new Date().toISOString(), stmts: D1PreparedStatement[] = [], gagal: string[] = [];
  let saved = 0;
  for (const r of Array.isArray(b.rows) ? b.rows : []) {
    if (!teks(r?.goods)) continue;
    const p = bacaPasangan(r, skuId, skuKode, produkId);
    if (typeof p === "string") { gagal.push(String(r.goods)); continue; }
    stmts.push(...gantiPasangan(db, p.goods, now, p));
    saved++;
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return c.json({ saved, skipped: gagal.length, gagal: gagal.slice(0, 20) });
});

/** Pasangkan / lepas satu nama barang. { goods, sku_id?, qty?, produk?: [{ produk_id, qty }] } */
settings.put("/barang", async c => {
  const db = c.env.DB, [skuId, skuKode, produkId] = await kamusPasangan(db);
  const p = bacaPasangan(await c.req.json<PasangBarang>(), skuId, skuKode, produkId);
  if (typeof p === "string") return c.json({ error: p }, 400);
  await db.batch(gantiPasangan(db, p.goods, new Date().toISOString(), p));
  return c.json({ ok: true });
});

/**
 * Inventory › Inbound REQ: permintaan barang ke supplier → dikirim → diterima gudang (bisa bertahap) → selesai.
 * Status draft | dikirim | sebagian | selesai | batal. Qty diterima baik menambah stok gudang tujuan (dihitung di
 * Inventory › Stok); penerimaan bisa sekaligus memperbarui HPP List Produk (riwayat HPP bersumber 'req').
 */
const tglValid = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null;
const olehSesi = async (c: { env: Env; req: { header: (k: string) => string | undefined } }) =>
  await cekSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI)) ?? userDashboard(c.env);

settings.get("/req", async c => {
  const db = c.env.DB;
  const [req, item, terima, bayar, gudang, produk, mulai, berkas] = await db.batch([
    db.prepare("SELECT * FROM inbound_req ORDER BY tanggal DESC, id DESC"),
    db.prepare("SELECT id, req_id, produk_id, qty, harga FROM inbound_req_item ORDER BY req_id, urut, id"),
    db.prepare("SELECT id, req_id, item_id, batch, tanggal, qty_baik, qty_rusak, catatan, oleh, created_at FROM inbound_req_terima ORDER BY tanggal, id"),
    db.prepare("SELECT id, req_id, tanggal, jumlah, catatan, oleh FROM inbound_req_bayar ORDER BY tanggal, id"),
    db.prepare("SELECT id, nama, jenis FROM gudang ORDER BY nama"),
    db.prepare("SELECT id, nama, hpp FROM produk_list ORDER BY nama"),
    db.prepare("SELECT value FROM kv WHERE key='stok_mulai'"),
    db.prepare("SELECT id, req_id, jenis, nama, tipe, ukuran, resi, oleh, created_at FROM inbound_req_berkas ORDER BY req_id, id"),
  ]);
  const per = <T extends { req_id: number }>(rows: T[]) => { const m = new Map<number, T[]>(); for (const r of rows) m.set(r.req_id, [...(m.get(r.req_id) ?? []), r]); return m; };
  const pi = per(item.results as { req_id: number }[]), pt = per(terima.results as { req_id: number }[]), pb = per(bayar.results as { req_id: number }[]);
  const pf = per(berkas.results as { req_id: number }[]);
  return c.json({
    rows: (req.results as { id: number }[]).map(r => ({ ...r, items: pi.get(r.id) ?? [], terima: pt.get(r.id) ?? [], bayar: pb.get(r.id) ?? [], berkas: pf.get(r.id) ?? [] })),
    gudang: gudang.results, produk: produk.results, hari_ini: todayReport(),
    stok_mulai: (mulai.results[0] as { value: string } | undefined)?.value ?? null,
  });
});

/**
 * Buat (tanpa id) / ubah REQ. { id?, gudang_id, supplier, kontak?, tanggal, eta?, resi?, ongkir?, tagihan?, catatan?,
 * items: [{ produk_id, qty, harga }] }. Daftar produk hanya bisa diganti selama belum ada penerimaan.
 */
settings.put("/req", async c => {
  const b = await c.req.json<{ id?: number; gudang_id?: number; supplier?: string; kontak?: string; tanggal?: string; eta?: string; resi?: string;
    ongkir?: unknown; tagihan?: unknown; catatan?: string; items?: { produk_id?: unknown; qty?: unknown; harga?: unknown }[] }>();
  const db = c.env.DB, supplier = teks(b.supplier), tanggal = tglValid(b.tanggal), now = new Date().toISOString();
  if (!supplier || !tanggal) return c.json({ error: "supplier dan tanggal wajib diisi" }, 400);
  const ongkir = Math.max(0, Math.round(Number(b.ongkir) || 0));
  const tagihan = b.tagihan === "" || b.tagihan == null ? null : Math.round(Number(b.tagihan));
  if (tagihan != null && !(tagihan >= 0)) return c.json({ error: "tagihan harus angka ≥ 0" }, 400);
  if (!await db.prepare("SELECT id FROM gudang WHERE id=?").bind(b.gudang_id ?? null).first()) return c.json({ error: "gudang tujuan wajib dipilih" }, 400);
  const items = (Array.isArray(b.items) ? b.items : []).map(i => ({ produk_id: Number(i?.produk_id), qty: Math.round(Number(i?.qty)), harga: Math.round(Number(i?.harga) || 0) }));
  if (!items.length || items.some(i => !Number.isInteger(i.produk_id) || !(i.qty > 0) || i.harga < 0)) return c.json({ error: "setiap baris produk harus punya produk, qty ≥ 1, dan harga ≥ 0" }, 400);
  if (new Set(items.map(i => i.produk_id)).size !== items.length) return c.json({ error: "produk yang sama dipilih lebih dari sekali" }, 400);
  const ada = await db.prepare(`SELECT COUNT(*) AS n FROM produk_list WHERE id IN (${items.map(() => "?").join(",")})`).bind(...items.map(i => i.produk_id)).first<{ n: number }>();
  if (ada?.n !== items.length) return c.json({ error: "ada produk yang tidak ada di List Produk" }, 400);
  const kolom = [b.gudang_id, supplier, teks(b.kontak), tanggal, tglValid(b.eta), teks(b.resi), ongkir, tagihan, teks(b.catatan)];
  let id = Number(b.id) || 0;
  if (id) {
    const lama = await db.prepare("SELECT status, (SELECT COUNT(*) FROM inbound_req_terima WHERE req_id=inbound_req.id) AS n_terima FROM inbound_req WHERE id=?").bind(id).first<{ status: string; n_terima: number }>();
    if (!lama) return c.json({ error: "REQ tidak ditemukan" }, 404);
    if (lama.status === "batal") return c.json({ error: "REQ yang dibatalkan tidak bisa diubah" }, 400);
    const stmts = [db.prepare("UPDATE inbound_req SET gudang_id=?, supplier=?, kontak=?, tanggal=?, eta=?, resi=?, ongkir=?, tagihan=?, catatan=?, updated_at=? WHERE id=?").bind(...kolom, now, id)];
    if (!lama.n_terima) stmts.push(db.prepare("DELETE FROM inbound_req_item WHERE req_id=?").bind(id),
      ...items.map((i, u) => db.prepare("INSERT INTO inbound_req_item (req_id, produk_id, qty, harga, urut) VALUES (?,?,?,?,?)").bind(id, i.produk_id, i.qty, i.harga, u)));
    else {
      // Sudah ada penerimaan: produk tidak bisa diganti, tetapi qty diminta & harga boleh dikoreksi
      const lamaItem = await db.prepare("SELECT id, produk_id FROM inbound_req_item WHERE req_id=?").bind(id).all<{ id: number; produk_id: number }>();
      const peta = new Map(lamaItem.results.map(x => [x.produk_id, x.id]));
      if (items.length !== peta.size || items.some(i => !peta.has(i.produk_id))) return c.json({ error: "REQ sudah ada penerimaan — produk tidak bisa ditambah / dihapus, hanya qty dan harga" }, 400);
      stmts.push(...items.map(i => db.prepare("UPDATE inbound_req_item SET qty=?, harga=? WHERE id=?").bind(i.qty, i.harga, peta.get(i.produk_id))));
    }
    await db.batch(stmts);
    await perbaruiStatusReq(db, id);
  } else {
    // Nomor REQ-YYMM-NNN, urut per bulan tanggal request
    const awalan = `REQ-${tanggal.slice(2, 4)}${tanggal.slice(5, 7)}-`;
    const akhir = await db.prepare("SELECT nomor FROM inbound_req WHERE nomor LIKE ? ORDER BY nomor DESC LIMIT 1").bind(awalan + "%").first<{ nomor: string }>();
    const nomor = awalan + String((Number(akhir?.nomor.slice(-3)) || 0) + 1).padStart(3, "0");
    const r = await db.prepare(
      "INSERT INTO inbound_req (nomor, gudang_id, supplier, kontak, tanggal, eta, resi, ongkir, tagihan, catatan, status, oleh, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
      .bind(nomor, ...kolom, await olehSesi(c), now, now).run();
    id = Number(r.meta.last_row_id);
    await db.batch(items.map((i, u) => db.prepare("INSERT INTO inbound_req_item (req_id, produk_id, qty, harga, urut) VALUES (?,?,?,?,?)").bind(id, i.produk_id, i.qty, i.harga, u)));
  }
  return c.json({ ok: true, id });
});

/** Status otomatis setelah penerimaan berubah: belum ada terima → (tetap draft/dikirim), sebagian, atau selesai bila semua qty terpenuhi. */
async function perbaruiStatusReq(db: D1Database, id: number) {
  const r = await db.prepare(
    `SELECT r.status, (SELECT COUNT(*) FROM inbound_req_terima t WHERE t.req_id=r.id) AS n,
       (SELECT COUNT(*) FROM inbound_req_item i WHERE i.req_id=r.id
          AND i.qty > COALESCE((SELECT SUM(t.qty_baik+t.qty_rusak) FROM inbound_req_terima t WHERE t.item_id=i.id),0)) AS kurang
     FROM inbound_req r WHERE r.id=?`).bind(id).first<{ status: string; n: number; kurang: number }>();
  if (!r || r.status === "batal") return;
  const baru = !r.n ? (r.status === "draft" ? "draft" : "dikirim") : r.kurang ? (r.status === "selesai" ? "selesai" : "sebagian") : "selesai";
  if (baru !== r.status) await db.prepare("UPDATE inbound_req SET status=?, updated_at=? WHERE id=?").bind(baru, new Date().toISOString(), id).run();
}

/**
 * Ubah status manual: { status: dikirim (dari draft) | draft (kembali, belum ada penerimaan) | selesai (tutup sisa) |
 * batal (belum ada penerimaan) | buka (selesai → sebagian, membuka lagi sisa) }.
 */
settings.put("/req/:id/status", async c => {
  const id = Number(c.req.param("id")), { status } = await c.req.json<{ status?: string }>(), db = c.env.DB;
  const r = await db.prepare("SELECT status, (SELECT COUNT(*) FROM inbound_req_terima WHERE req_id=inbound_req.id) AS n FROM inbound_req WHERE id=?").bind(id).first<{ status: string; n: number }>();
  if (!r) return c.json({ error: "REQ tidak ditemukan" }, 404);
  const boleh: Record<string, boolean> = {
    dikirim: r.status === "draft", draft: r.status === "dikirim" && !r.n, selesai: r.status === "sebagian" || r.status === "dikirim" && r.n > 0,
    batal: !r.n && r.status !== "batal", buka: r.status === "selesai" || r.status === "batal" && !r.n,
  };
  if (!status || !boleh[status]) return c.json({ error: `status tidak bisa diubah dari ${r.status} ke ${status}` }, 400);
  const baru = status === "buka" ? (r.status === "batal" ? "draft" : "sebagian") : status;
  await db.prepare("UPDATE inbound_req SET status=?, updated_at=? WHERE id=?").bind(baru, new Date().toISOString(), id).run();
  if (status === "buka") await perbaruiStatusReq(db, id);
  return c.json({ ok: true });
});

/** Hapus REQ draft yang belum ada penerimaan / pembayaran. */
// ---- Berkas pengiriman REQ (foto / scan resi, surat jalan, invoice)
const BERKAS_JENIS = ["resi", "surat_jalan", "invoice", "lain"], BERKAS_MAKS = 1_450_000;
const BERKAS_TIPE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

/** Upload satu berkas: body = isi file mentah; header Content-Type, X-Nama (encodeURIComponent), X-Jenis, X-Resi (hasil baca barcode) */
settings.post("/req/:id/berkas", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  if (!await db.prepare("SELECT id FROM inbound_req WHERE id=?").bind(id).first()) return c.json({ error: "REQ tidak ditemukan" }, 404);
  const tipe = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!BERKAS_TIPE.test(tipe)) return c.json({ error: "hanya foto (JPG/PNG/WebP) atau PDF" }, 400);
  const isi = new Uint8Array(await c.req.arrayBuffer());
  if (!isi.length) return c.json({ error: "berkas kosong" }, 400);
  if (isi.length > BERKAS_MAKS) return c.json({ error: "berkas terlalu besar (maks 1,4 MB) — kecilkan / scan ulang PDF-nya" }, 413);
  let bin = "";
  for (let i = 0; i < isi.length; i += 0x8000) bin += String.fromCharCode(...isi.subarray(i, i + 0x8000));
  const dekode = (v: string | undefined) => { try { return decodeURIComponent(v ?? ""); } catch { return v ?? ""; } };
  const nama = dekode(c.req.header("X-Nama")).trim().slice(0, 150) || "berkas";
  const jenis = BERKAS_JENIS.includes(c.req.header("X-Jenis") ?? "") ? c.req.header("X-Jenis")! : "lain";
  const resi = dekode(c.req.header("X-Resi")).trim().slice(0, 80) || null;
  const now = new Date().toISOString();
  const [r, isiResi] = await db.batch([
    db.prepare("INSERT INTO inbound_req_berkas (req_id, jenis, nama, tipe, ukuran, data, resi, oleh, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, jenis, nama, tipe, isi.length, btoa(bin), resi, await olehSesi(c), now),
    // Nomor resi dari barcode langsung jadi resi REQ bila resi REQ masih kosong
    db.prepare("UPDATE inbound_req SET resi=?, updated_at=? WHERE id=? AND COALESCE(TRIM(resi),'')='' AND ? IS NOT NULL").bind(resi, now, id, resi),
  ]);
  return c.json({ ok: true, id: r.meta.last_row_id, resi_diisi: isiResi.meta.changes > 0 });
});

/** Buka / unduh berkas (?unduh=1 untuk menyimpan) */
settings.get("/req/berkas/:bid", async c => {
  const b = await c.env.DB.prepare("SELECT nama, tipe, data FROM inbound_req_berkas WHERE id=?").bind(Number(c.req.param("bid")))
    .first<{ nama: string; tipe: string; data: string }>();
  if (!b) return c.json({ error: "berkas tidak ditemukan" }, 404);
  const bin = atob(b.data), isi = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) isi[i] = bin.charCodeAt(i);
  return new Response(isi, { headers: { "Content-Type": b.tipe, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${c.req.query("unduh") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(b.nama)}` } });
});

settings.delete("/req/berkas/:bid", async c => {
  await c.env.DB.prepare("DELETE FROM inbound_req_berkas WHERE id=?").bind(Number(c.req.param("bid"))).run();
  return c.json({ ok: true });
});

settings.delete("/req/:id", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const r = await db.prepare(
    "SELECT status, (SELECT COUNT(*) FROM inbound_req_terima WHERE req_id=?1) + (SELECT COUNT(*) FROM inbound_req_bayar WHERE req_id=?1) AS n FROM inbound_req WHERE id=?1")
    .bind(id).first<{ status: string; n: number }>();
  if (!r) return c.json({ error: "REQ tidak ditemukan" }, 404);
  if (!["draft", "batal"].includes(r.status) || r.n) return c.json({ error: "hanya REQ draft / batal tanpa penerimaan & pembayaran yang bisa dihapus" }, 400);
  await db.batch([db.prepare("DELETE FROM inbound_req_berkas WHERE req_id=?").bind(id), db.prepare("DELETE FROM inbound_req_item WHERE req_id=?").bind(id),
    db.prepare("DELETE FROM inbound_req WHERE id=?").bind(id)]);
  return c.json({ ok: true });
});

/**
 * Catat penerimaan barang. { tanggal, catatan?, rows: [{ item_id, baik, rusak }], hpp?: [{ produk_id, hpp }] }.
 * hpp = HPP baru hasil rata-rata tertimbang (dihitung di browser dari stok berjalan); dicatat di riwayat HPP
 * berlaku sejak tanggal terima, lalu HPP terkini & HPP SKU dihitung ulang.
 */
settings.post("/req/:id/terima", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB;
  const b = await c.req.json<{ tanggal?: string; catatan?: string; rows?: { item_id?: unknown; baik?: unknown; rusak?: unknown }[]; hpp?: { produk_id?: unknown; hpp?: unknown }[] }>();
  const tanggal = tglValid(b.tanggal), hari = todayReport();
  if (!tanggal || tanggal > hari) return c.json({ error: "tanggal terima wajib diisi dan tidak boleh di masa depan" }, 400);
  const r = await db.prepare("SELECT nomor, status FROM inbound_req WHERE id=?").bind(id).first<{ nomor: string; status: string }>();
  if (!r) return c.json({ error: "REQ tidak ditemukan" }, 404);
  if (["batal", "selesai"].includes(r.status)) return c.json({ error: `REQ ${r.status} — buka lagi dulu untuk menerima barang` }, 400);
  const item = await db.prepare("SELECT id, produk_id FROM inbound_req_item WHERE req_id=?").bind(id).all<{ id: number; produk_id: number }>();
  const milik = new Map(item.results.map(i => [i.id, i.produk_id]));
  const rows = (Array.isArray(b.rows) ? b.rows : []).map(x => ({ item_id: Number(x?.item_id), baik: Math.round(Number(x?.baik) || 0), rusak: Math.round(Number(x?.rusak) || 0) }))
    .filter(x => x.baik || x.rusak);
  if (!rows.length) return c.json({ error: "isi qty diterima minimal satu produk" }, 400);
  if (rows.some(x => !milik.has(x.item_id) || x.baik < 0 || x.rusak < 0)) return c.json({ error: "qty diterima harus ≥ 0 dan produk harus dari REQ ini" }, 400);
  const batch = crypto.randomUUID(), now = new Date().toISOString(), oleh = await olehSesi(c), catatan = teks(b.catatan);
  const stmts = rows.map(x => db.prepare(
    "INSERT INTO inbound_req_terima (req_id, item_id, batch, tanggal, qty_baik, qty_rusak, catatan, oleh, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, x.item_id, batch, tanggal, x.baik, x.rusak, catatan, oleh, now));
  const diterima = new Set(rows.filter(x => x.baik > 0).map(x => milik.get(x.item_id)));
  const hpp = (Array.isArray(b.hpp) ? b.hpp : []).map(h => ({ produk_id: Number(h?.produk_id), hpp: Math.round(Number(h?.hpp)) }))
    .filter(h => diterima.has(h.produk_id) && h.hpp >= 0);
  for (const h of hpp) stmts.push(db.prepare(
    `INSERT INTO produk_hpp (produk_id, berlaku, hpp, sumber, catatan, ref, created_at) VALUES (?,?,?,'req',?,?,?)
     ON CONFLICT(produk_id, berlaku) DO UPDATE SET hpp=excluded.hpp, sumber='req', catatan=excluded.catatan, ref=excluded.ref, created_at=excluded.created_at`)
    .bind(h.produk_id, tanggal, h.hpp, r.nomor, `req-terima:${batch}`, now));
  await db.batch(stmts);
  if (hpp.length) await db.batch(hpp.flatMap(h => [hppTerkini(db, h.produk_id), hitungUlangHpp(db, { produkId: h.produk_id })]));
  await perbaruiStatusReq(db, id);
  return c.json({ ok: true, batch });
});

/** Batalkan satu penerimaan (batch): baris terima & riwayat HPP dari penerimaan itu dihapus. */
settings.delete("/req/:id/terima/:batch", async c => {
  const id = Number(c.req.param("id")), batch = c.req.param("batch"), db = c.env.DB;
  const hpp = await db.prepare("SELECT DISTINCT produk_id FROM produk_hpp WHERE ref=?").bind(`req-terima:${batch}`).all<{ produk_id: number }>();
  await db.batch([
    db.prepare("DELETE FROM inbound_req_terima WHERE req_id=? AND batch=?").bind(id, batch),
    db.prepare("DELETE FROM produk_hpp WHERE ref=?").bind(`req-terima:${batch}`),
    ...hpp.results.flatMap(h => [hppTerkini(db, h.produk_id), hitungUlangHpp(db, { produkId: h.produk_id })]),
  ]);
  await perbaruiStatusReq(db, id);
  return c.json({ ok: true });
});

/** Catat pembayaran ke supplier. { tanggal, jumlah, catatan? } */
settings.post("/req/:id/bayar", async c => {
  const id = Number(c.req.param("id")), db = c.env.DB, b = await c.req.json<{ tanggal?: string; jumlah?: unknown; catatan?: string }>();
  const tanggal = tglValid(b.tanggal), jumlah = Math.round(Number(b.jumlah));
  if (!tanggal || !(jumlah > 0)) return c.json({ error: "tanggal dan jumlah (> 0) wajib diisi" }, 400);
  if (!await db.prepare("SELECT id FROM inbound_req WHERE id=?").bind(id).first()) return c.json({ error: "REQ tidak ditemukan" }, 404);
  await db.prepare("INSERT INTO inbound_req_bayar (req_id, tanggal, jumlah, catatan, oleh, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, tanggal, jumlah, teks(b.catatan), await olehSesi(c), new Date().toISOString()).run();
  return c.json({ ok: true });
});

settings.delete("/req/:id/bayar/:bid", async c => {
  await c.env.DB.prepare("DELETE FROM inbound_req_bayar WHERE id=? AND req_id=?").bind(Number(c.req.param("bid")), Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
