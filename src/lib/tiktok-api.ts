import { Env } from "../env";

/**
 * Klien TikTok Shop Open API (versi 202309).
 * - Kunci aplikasi: secret TIKTOK_APP_KEY & TIKTOK_APP_SECRET; ID layanan (service_id) di var TIKTOK_SERVICE_ID.
 * - Izin toko: pemilik toko membuka link otorisasi → TikTok mengarahkan ke Redirect URL aplikasi dengan ?code=
 *   → access_token + refresh_token (per penjual / open_id), disimpan di tiktok_api_akun dan diperbarui otomatis.
 * - Setiap API toko butuh shop_cipher (dari /authorization/202309/shops).
 * - Tanda tangan: HMAC-SHA256(app_secret, app_secret + path + Σ(key+value urut, tanpa sign & access_token) + body + app_secret).
 * Data pembeli tidak pernah disimpan.
 */
const HOST_API = "https://open-api.tiktokglobalshop.com";
const HOST_AUTH = "https://auth.tiktok-shops.com";
const HOST_IZIN = "https://services.tiktokshop.com";

export type AkunTiktok = { open_id: string; access_token: string; refresh_token: string; expire_at: string; refresh_expire_at: string };
type Jawaban<T> = { code: number; message: string; request_id?: string; data?: T };

export class TiktokApi {
  private readonly key: string;
  private readonly secret: string;
  constructor(private env: Env) {
    const key = env.TIKTOK_APP_KEY, secret = env.TIKTOK_APP_SECRET;
    if (typeof key !== "string" || !key || typeof secret !== "string" || !secret) throw new Error("Secret TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum di-set");
    this.key = key; this.secret = secret;
  }

  private async hmac(teks: string) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(teks)))].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /** Link otorisasi toko (service_id dari var TIKTOK_SERVICE_ID) */
  linkIzin(state: string) {
    const sid = this.env.TIKTOK_SERVICE_ID;
    if (typeof sid !== "string" || !sid) throw new Error("Var TIKTOK_SERVICE_ID belum di-set");
    return `${HOST_IZIN}/open/authorize?service_id=${encodeURIComponent(sid)}&state=${encodeURIComponent(state)}`;
  }

  private async token(params: Record<string, string>, jalur: string) {
    const u = new URL(HOST_AUTH + jalur);
    u.searchParams.set("app_key", this.key); u.searchParams.set("app_secret", this.secret);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const j = (await (await fetch(u)).json()) as Jawaban<{ access_token: string; access_token_expire_in: number; refresh_token: string;
      refresh_token_expire_in: number; open_id: string; seller_name?: string; seller_base_region?: string }>;
    if (j.code !== 0 || !j.data) throw new Error(`TikTok token: ${j.code} ${j.message}`);
    const d = j.data, detik = (x: number) => new Date((x > 1e12 ? x : x * 1000)).toISOString();
    return { akun: { open_id: d.open_id, access_token: d.access_token, refresh_token: d.refresh_token,
      expire_at: detik(d.access_token_expire_in), refresh_expire_at: detik(d.refresh_token_expire_in) } as AkunTiktok,
      nama: d.seller_name ?? null, region: d.seller_base_region ?? null };
  }
  tukarCode(code: string) { return this.token({ auth_code: code, grant_type: "authorized_code" }, "/api/v2/token/get"); }

  /** Akun penjual dengan token yang masih berlaku; diperbarui bila sisa < 10 menit */
  async akun(openId: string): Promise<AkunTiktok> {
    const a = await this.env.DB.prepare("SELECT open_id, access_token, refresh_token, expire_at, refresh_expire_at FROM tiktok_api_akun WHERE open_id=?")
      .bind(openId).first<AkunTiktok>();
    if (!a) throw new Error(`Akun TikTok ${openId} belum dihubungkan`);
    if (Date.parse(a.expire_at) - Date.now() > 10 * 60000) return a;
    const { akun } = await this.token({ refresh_token: a.refresh_token, grant_type: "refresh_token" }, "/api/v2/token/refresh");
    await this.env.DB.prepare("UPDATE tiktok_api_akun SET access_token=?, refresh_token=?, expire_at=?, refresh_expire_at=?, updated_at=? WHERE open_id=?")
      .bind(akun.access_token, akun.refresh_token, akun.expire_at, akun.refresh_expire_at, new Date().toISOString(), openId).run();
    return akun;
  }

  /** Panggil API; `cipher` wajib untuk API toko. GET bila body tidak diisi */
  async panggil<T = unknown>(openId: string, path: string, query: Record<string, string | number> = {}, body?: unknown, cipher?: string): Promise<T> {
    const a = await this.akun(openId);
    const q: Record<string, string> = { app_key: this.key, timestamp: String(Math.floor(Date.now() / 1000)) };
    if (cipher) q.shop_cipher = cipher;
    for (const [k, v] of Object.entries(query)) q[k] = String(v);
    const isi = body === undefined ? "" : JSON.stringify(body);
    const urut = Object.keys(q).sort().map(k => k + q[k]).join("");
    const sign = await this.hmac(this.secret + path + urut + isi + this.secret);
    const u = new URL(HOST_API + path);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    u.searchParams.set("sign", sign);
    const r = await fetch(u, { method: body === undefined ? "GET" : "POST", headers: { "x-tts-access-token": a.access_token, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: isi }) });
    const j = (await r.json().catch(() => ({ code: r.status, message: "respons bukan JSON" }))) as Jawaban<T>;
    if (j.code !== 0) throw new Error(`TikTok ${path}: ${j.code} ${j.message}`);
    return j.data as T;
  }
}
