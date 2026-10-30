import { Hono } from "hono";
import { Env } from "../env";
import { TiktokApi } from "../lib/tiktok-api";

/**
 * Koneksi TikTok Shop Open API (/api/tiktok-api). Tahap uji: menghubungkan toko & membaca contoh data
 * (tidak menulis ke laporan). Callback terbuka tanpa sesi; state dicek bila dikirim.
 */
export const tiktokApi = new Hono<{ Bindings: Env }>();
const STATE = (s: string) => `tiktok_state:${s}`;
type Toko = { id: string; name: string; region: string; cipher: string; code?: string };

tiktokApi.get("/link-izin", async c => {
  const api = new TiktokApi(c.env), state = crypto.randomUUID(), toko = Number(c.req.query("toko")) || null;
  await c.env.DB.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(STATE(state), JSON.stringify({ exp: Date.now() + 15 * 60000, toko })).run();
  return c.json({ url: api.linkIzin(state), redirect: `${new URL(c.req.url).origin}/api/tiktok-api/callback` });
});

tiktokApi.get("/callback", async c => {
  const code = c.req.query("code") ?? "", state = c.req.query("state") ?? "", db = c.env.DB;
  // Link dari dashboard membawa state sekali pakai {exp, toko}; link "Salin tautan otorisasi" dari Partner Center tidak
  let st: { exp: number; toko: number | null } = { exp: Infinity, toko: null };
  if (state) {
    const s = await db.prepare("SELECT value FROM kv WHERE key=?").bind(STATE(state)).first<{ value: string }>();
    await db.prepare("DELETE FROM kv WHERE key=?").bind(STATE(state)).run();
    try { const v = JSON.parse(s?.value ?? "0"); st = typeof v === "number" ? { exp: v, toko: null } : v; } catch { st = { exp: 0, toko: null }; }
  }
  const balik = (pesan: string) => c.redirect(`/?tiktok_api=${encodeURIComponent(pesan)}${st.toko != null ? "&ke=pengaturan" : ""}`);
  if (st.exp < Date.now()) return balik("Link izin kedaluwarsa, ulangi dari dashboard");
  if (!code) return balik("TikTok tidak mengirim code (izin dibatalkan?)");
  try {
    const api = new TiktokApi(c.env), { akun, nama, region } = await api.tukarCode(code), now = new Date().toISOString();
    await db.prepare(`INSERT INTO tiktok_api_akun (open_id, nama, region, access_token, refresh_token, expire_at, refresh_expire_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(open_id) DO UPDATE SET nama=excluded.nama, region=excluded.region, access_token=excluded.access_token,
      refresh_token=excluded.refresh_token, expire_at=excluded.expire_at, refresh_expire_at=excluded.refresh_expire_at, updated_at=excluded.updated_at`)
      .bind(akun.open_id, nama, region, akun.access_token, akun.refresh_token, akun.expire_at, akun.refresh_expire_at, now, now).run();
    const t = await api.panggil<{ shops?: Toko[] }>(akun.open_id, "/authorization/202309/shops").catch(() => ({ shops: [] as Toko[] }));
    await db.prepare("UPDATE tiktok_api_akun SET toko_json=? WHERE open_id=?").bind(JSON.stringify(t.shops ?? []), akun.open_id).run();
    // Pasangkan tiap toko dari izin ke toko dashboard: shop_id sama → toko itu; toko tujuan tanpa shop_id (izin 1 toko) → diisi; selain itu toko baru
    const shops = t.shops ?? [], dipasang: string[] = [];
    for (const sh of shops) {
      let tk = await db.prepare("SELECT id, nama FROM tiktok_toko WHERE shop_id=?").bind(sh.id).first<{ id: number; nama: string }>();
      if (!tk && st.toko && shops.length === 1) {
        const tj = await db.prepare("SELECT id, nama, shop_id FROM tiktok_toko WHERE id=?").bind(st.toko).first<{ id: number; nama: string; shop_id: string | null }>();
        if (tj && !tj.shop_id) { await db.prepare("UPDATE tiktok_toko SET shop_id=? WHERE id=?").bind(sh.id, tj.id).run(); tk = tj; }
      }
      if (!tk) {
        const r = await db.prepare("INSERT INTO tiktok_toko (shop_id, nama, mode, created_at, updated_at) VALUES (?,?,'api',?,?)").bind(sh.id, sh.name, now, now).run();
        tk = { id: Number(r.meta.last_row_id), nama: sh.name };
      }
      await db.prepare("UPDATE tiktok_toko SET mode='api', updated_at=? WHERE id=?").bind(now, tk.id).run();
      dipasang.push(`${sh.name} → ${tk.nama}`);
    }
    return balik(`${nama ?? "Akun"} terhubung · ${dipasang.join(", ") || "tidak ada toko"}`);
  } catch (e) { return balik(`Gagal menghubungkan: ${String((e as Error).message ?? e)}`); }
});

/** Akun & toko terhubung (tanpa token / cipher) */
tiktokApi.get("/toko", async c => {
  const r = await c.env.DB.prepare("SELECT open_id, nama, region, expire_at, refresh_expire_at, toko_json, updated_at FROM tiktok_api_akun ORDER BY nama")
    .all<{ open_id: string; nama: string | null; region: string | null; expire_at: string; refresh_expire_at: string; toko_json: string | null; updated_at: string }>();
  let siap = true; try { new TiktokApi(c.env); } catch { siap = false; }
  return c.json({ siap, akun: r.results.map(({ toko_json, ...a }) => ({ ...a,
    toko: (JSON.parse(toko_json ?? "[]") as Toko[]).map(t => ({ id: t.id, name: t.name, region: t.region, code: t.code })) })) });
});

/** Ambil ulang daftar toko yang diizinkan (shop id, nama, cipher); pesan error TikTok dikembalikan apa adanya */
tiktokApi.post("/akun/:open/muat-toko", async c => {
  const api = new TiktokApi(c.env), openId = c.req.param("open");
  try {
    const t = await api.panggil<{ shops?: Toko[] }>(openId, "/authorization/202309/shops");
    await c.env.DB.prepare("UPDATE tiktok_api_akun SET toko_json=?, updated_at=? WHERE open_id=?").bind(JSON.stringify(t.shops ?? []), new Date().toISOString(), openId).run();
    return c.json({ ok: true, jumlah: (t.shops ?? []).length, toko: (t.shops ?? []).map(s => ({ id: s.id, name: s.name, region: s.region })) });
  } catch (e) { return c.json({ ok: false, gagal: String((e as Error).message ?? e) }); }
});

tiktokApi.delete("/akun/:open", async c => {
  await c.env.DB.prepare("DELETE FROM tiktok_api_akun WHERE open_id=?").bind(c.req.param("open")).run();
  return c.json({ ok: true });
});

/**
 * Uji baca data satu toko: pesanan 15 hari (jumlah, status, contoh barang & SKU tanpa data pembeli),
 * settlement (statement) 30 hari, dan rincian transaksi settlement satu pesanan. Hanya dikembalikan.
 */
tiktokApi.post("/uji/:open/:shop", async c => {
  const api = new TiktokApi(c.env), openId = c.req.param("open"), shopId = c.req.param("shop"), hasil: Record<string, unknown> = {};
  const a = await c.env.DB.prepare("SELECT toko_json FROM tiktok_api_akun WHERE open_id=?").bind(openId).first<{ toko_json: string | null }>();
  const toko = (JSON.parse(a?.toko_json ?? "[]") as Toko[]).find(t => t.id === shopId);
  if (!toko) return c.json({ error: "toko tidak ditemukan — hubungkan ulang" }, 404);
  hasil.toko = { id: toko.id, nama: toko.name, region: toko.region };
  const coba = async (k: string, f: () => Promise<unknown>) => { try { hasil[k] = await f(); } catch (e) { hasil[k] = { gagal: String((e as Error).message ?? e) }; } };
  const akhir = Math.floor(Date.now() / 1000);
  type Pesanan = { id: string; status: string; create_time: number; payment?: { total_amount?: string; currency?: string };
    line_items?: { product_name: string; sku_name?: string; seller_sku?: string }[] };
  let contohId: string | undefined;
  await coba("pesanan_15_hari", async () => {
    const d = await api.panggil<{ orders?: Pesanan[]; total_count?: number }>(openId, "/order/202309/orders/search", { page_size: 50 },
      { create_time_ge: akhir - 15 * 86400, create_time_lt: akhir }, toko.cipher);
    const per: Record<string, number> = {};
    for (const o of d.orders ?? []) per[o.status] = (per[o.status] ?? 0) + 1;
    contohId = (d.orders ?? []).find(o => o.status === "COMPLETED")?.id ?? d.orders?.[0]?.id;
    return { jumlah: d.total_count ?? (d.orders ?? []).length, status_50_pertama: per,
      contoh: (d.orders ?? []).slice(0, 5).map(o => ({ id: o.id, status: o.status, dibuat: new Date(o.create_time * 1000).toISOString(),
        total: o.payment?.total_amount, barang: (o.line_items ?? []).map(i => `${i.product_name}${i.sku_name ? ` · ${i.sku_name}` : ""}${i.seller_sku ? ` (SKU ${i.seller_sku})` : ""}`) })) };
  });
  await coba("settlement_30_hari", async () => {
    const d = await api.panggil<{ statements?: { id: string; statement_time: number; settlement_amount?: string; revenue_amount?: string; fee_amount?: string; payment_status?: string }[] }>(
      openId, "/finance/202309/statements", { page_size: 20, sort_field: "statement_time", statement_time_ge: akhir - 30 * 86400, statement_time_lt: akhir }, undefined, toko.cipher);
    return (d.statements ?? []).slice(0, 10).map(s => ({ id: s.id, tanggal: new Date(s.statement_time * 1000).toISOString().slice(0, 10),
      dana: s.settlement_amount, omzet: s.revenue_amount, biaya: s.fee_amount, status: s.payment_status }));
  });
  await coba("rincian_dana_pesanan", async () => {
    if (!contohId) return "tidak ada pesanan untuk dicontohkan";
    return api.panggil(openId, `/finance/202309/orders/${contohId}/statement_transactions`, {}, undefined, toko.cipher);
  });
  return c.json(hasil);
});
