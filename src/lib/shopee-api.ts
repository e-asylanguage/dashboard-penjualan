import { Env } from "../env";

/**
 * Klien Shopee Open Platform v2.
 * - Kunci aplikasi: secret SHOPEE_PARTNER_ID & SHOPEE_PARTNER_KEY (Test = sandbox, Live = produksi).
 * - Host: var SHOPEE_HOST bila diisi; tanpa itu ditentukan dari Partner ID: Test Partner ID (SHOPEE_TEST_PARTNER) → sandbox,
 *   Partner ID lain (Live) → produksi. Jadi mengganti secret ke kunci Live otomatis memindahkan koneksi ke toko asli.
 * - Akses toko: pemilik toko memberi izin (auth_partner) → code → access_token (4 jam) + refresh_token (30 hari),
 *   disimpan di tabel shopee_api_toko dan diperbarui otomatis sebelum kedaluwarsa.
 * Data pembeli (nama, alamat, HP) tidak pernah disimpan.
 */
export const SHOPEE_SANDBOX = "https://openplatform.sandbox.test-stable.shopee.sg";
export const SHOPEE_LIVE = "https://partner.shopeemobile.com";
/** Test Partner ID aplikasi Tomo Joyo Marketing di Shopee Open Platform (bukan rahasia) */
const SHOPEE_TEST_PARTNER = 1247811;

export type TokenToko = { shop_id: string; access_token: string; refresh_token: string; expire_at: string; refresh_expire_at: string };
type JawabanShopee = { error?: string; message?: string; request_id?: string; response?: unknown; [k: string]: unknown };

export class ShopeeApi {
  readonly host: string;
  private readonly partnerId: number;
  private readonly key: string;
  constructor(private env: Env) {
    const id = Number(env.SHOPEE_PARTNER_ID), key = env.SHOPEE_PARTNER_KEY;
    if (!id || typeof key !== "string" || !key) throw new Error("Secret SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum di-set");
    this.partnerId = id; this.key = key;
    this.host = typeof env.SHOPEE_HOST === "string" && env.SHOPEE_HOST ? env.SHOPEE_HOST.replace(/\/$/, "") : id === SHOPEE_TEST_PARTNER ? SHOPEE_SANDBOX : SHOPEE_LIVE;
  }
  get sandbox() { return this.host !== SHOPEE_LIVE; }

  /** sign = HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]) hex */
  private async sign(base: string): Promise<string> {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(base)));
    return [...s].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  private async url(path: string, extra: Record<string, string | number> = {}, tok?: { access_token: string; shop_id: string }) {
    const ts = Math.floor(Date.now() / 1000);
    const sign = await this.sign(`${this.partnerId}${path}${ts}${tok ? tok.access_token + tok.shop_id : ""}`);
    const u = new URL(this.host + path);
    u.searchParams.set("partner_id", String(this.partnerId)); u.searchParams.set("timestamp", String(ts)); u.searchParams.set("sign", sign);
    if (tok) { u.searchParams.set("access_token", tok.access_token); u.searchParams.set("shop_id", tok.shop_id); }
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    return u;
  }
  private async kirim(u: URL, body?: unknown): Promise<JawabanShopee> {
    const r = await fetch(u, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}`, message: "respons bukan JSON" }))) as JawabanShopee;
    if (j.error) throw new Error(`Shopee ${u.pathname}: ${j.error} — ${j.message ?? ""}`.trim());
    return j;
  }

  /** Link izin toko; Shopee mengarahkan kembali ke `redirect` dengan ?code=&shop_id= */
  async linkIzin(redirect: string) {
    return (await this.url("/api/v2/shop/auth_partner", { redirect })).toString();
  }
  /** Tukar code dari halaman izin menjadi token toko */
  async tukarCode(code: string, shopId: string): Promise<TokenToko> {
    const j = await this.kirim(await this.url("/api/v2/auth/token/get"), { code, shop_id: Number(shopId), partner_id: this.partnerId });
    return this.simpanJawabanToken(shopId, j);
  }
  private simpanJawabanToken(shopId: string, j: JawabanShopee): TokenToko {
    const now = Date.now(), expireIn = Number(j.expire_in) || 4 * 3600;
    if (typeof j.access_token !== "string" || typeof j.refresh_token !== "string") throw new Error("Shopee tidak mengirim token");
    return { shop_id: shopId, access_token: j.access_token, refresh_token: j.refresh_token,
      expire_at: new Date(now + expireIn * 1000).toISOString(), refresh_expire_at: new Date(now + 30 * 86400000).toISOString() };
  }

  /** Token toko yang masih berlaku; diperbarui bila sisa < 10 menit */
  async token(shopId: string): Promise<TokenToko> {
    const t = await this.env.DB.prepare("SELECT shop_id, access_token, refresh_token, expire_at, refresh_expire_at FROM shopee_api_toko WHERE shop_id=? AND host=?")
      .bind(shopId, this.host).first<TokenToko>();
    if (!t) throw new Error(`Toko ${shopId} belum dihubungkan`);
    if (Date.parse(t.expire_at) - Date.now() > 10 * 60000) return t;
    const j = await this.kirim(await this.url("/api/v2/auth/access_token/get"), { refresh_token: t.refresh_token, shop_id: Number(shopId), partner_id: this.partnerId });
    const baru = this.simpanJawabanToken(shopId, j);
    await this.env.DB.prepare("UPDATE shopee_api_toko SET access_token=?, refresh_token=?, expire_at=?, refresh_expire_at=?, updated_at=? WHERE shop_id=? AND host=?")
      .bind(baru.access_token, baru.refresh_token, baru.expire_at, baru.refresh_expire_at, new Date().toISOString(), shopId, this.host).run();
    return baru;
  }

  /** Upload gambar ke media space Shopee (API level partner, tanpa token toko) → image_id */
  async unggahGambar(isi: ArrayBuffer, tipe: string): Promise<string> {
    const f = new FormData();
    f.append("image", new Blob([isi], { type: tipe }), tipe === "image/png" ? "gambar.png" : "gambar.jpg");
    const r = await fetch(await this.url("/api/v2/media_space/upload_image"), { method: "POST", body: f });
    const j = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as JawabanShopee & { response?: { image_info?: { image_id?: string } } };
    if (j.error) throw new Error(`Shopee upload_image: ${j.error} — ${j.message ?? ""}`);
    const id = j.response?.image_info?.image_id;
    if (!id) throw new Error("Shopee tidak mengirim image_id");
    return id;
  }

  /** Panggil API toko (GET, atau POST bila body diisi) */
  async panggil<T = unknown>(shopId: string, path: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
    const tok = await this.token(shopId);
    for (let coba = 0; ; coba++) {
      try {
        const j = await this.kirim(await this.url(path, params, tok), body);
        return (j.response ?? j) as T;
      } catch (e) {
        // Batas laju (terutama API iklan): tunggu sebentar lalu ulangi, maksimal 3×
        if (coba >= 3 || !/rate_limit|too many requests/i.test(String((e as Error).message))) throw e;
        await new Promise(r => setTimeout(r, 1500 * (coba + 1)));
      }
    }
  }
}
