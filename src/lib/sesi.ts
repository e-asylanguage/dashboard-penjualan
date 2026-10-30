import { Env } from "../env";

/**
 * Sesi login dashboard: cookie `sesi` = base64url(user).exp.tanda, ditandatangani HMAC-SHA256 dengan
 * DASHBOARD_PASSWORD. Mengganti password otomatis membatalkan semua sesi lama.
 */
export const COOKIE_SESI = "sesi";
export const UMUR_SESI = 30 * 24 * 3600; // detik

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dariB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));

async function kunci(env: Env) {
  return crypto.subtle.importKey("raw", enc.encode(env.DASHBOARD_PASSWORD ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Username login: secret DASHBOARD_USER, default "admin". */
export const userDashboard = (env: Env) => (typeof env.DASHBOARD_USER === "string" && env.DASHBOARD_USER.trim()) || "admin";

/**
 * Akun peninjau (mis. untuk peninjauan Go-Live Shopee): secret DASHBOARD_REVIEW_USER + DASHBOARD_REVIEW_PASSWORD.
 * Hanya boleh membaca menu Shopee (lihat bolehPeninjau). Kosong = akun peninjau nonaktif.
 */
export const userPeninjau = (env: Env) =>
  typeof env.DASHBOARD_REVIEW_USER === "string" && env.DASHBOARD_REVIEW_USER.trim() && typeof env.DASHBOARD_REVIEW_PASSWORD === "string" && env.DASHBOARD_REVIEW_PASSWORD
    ? env.DASHBOARD_REVIEW_USER.trim() : null;
/** Permintaan yang boleh dilakukan akun peninjau: baca menu Shopee, uji baca data API, info akun, logout */
export function bolehPeninjau(method: string, path: string) {
  if (path === "/api/me" || path === "/api/logout") return true;
  if (method === "GET" && (path.startsWith("/api/shopee/") || path === "/api/shopee-api/toko")) return true;
  return method === "POST" && /^\/api\/shopee-api\/uji\/\d+$/.test(path);
}

/** Bandingkan dua string tanpa bocor lewat waktu eksekusi (bandingkan HMAC keduanya). */
export async function samaAman(env: Env, a: string, b: string) {
  const k = await kunci(env);
  const [x, y] = await Promise.all([crypto.subtle.sign("HMAC", k, enc.encode(a)), crypto.subtle.sign("HMAC", k, enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let beda = 0;
  for (let i = 0; i < ua.length; i++) beda |= ua[i] ^ ub[i];
  return beda === 0;
}

export async function buatSesi(env: Env, user: string) {
  const exp = Math.floor(Date.now() / 1000) + UMUR_SESI;
  const isi = `${b64url(enc.encode(user))}.${exp}`;
  const tanda = await crypto.subtle.sign("HMAC", await kunci(env), enc.encode(isi));
  return `${isi}.${b64url(tanda)}`;
}

/** Username & waktu kedaluwarsa (detik) sesi bila token sah & belum kedaluwarsa, selain itu null. */
export async function bacaSesi(env: Env, token: string | undefined | null): Promise<{ user: string; exp: number } | null> {
  const [u, exp, tanda] = (token ?? "").split(".");
  if (!u || !exp || !tanda || !(Number(exp) > Date.now() / 1000)) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await kunci(env), dariB64url(tanda), enc.encode(`${u}.${exp}`));
    return ok ? { user: new TextDecoder().decode(dariB64url(u)), exp: Number(exp) } : null;
  } catch { return null; }
}

/** Username pemilik sesi bila token sah & belum kedaluwarsa, selain itu null. */
export async function cekSesi(env: Env, token: string | undefined | null): Promise<string | null> {
  return (await bacaSesi(env, token))?.user ?? null;
}

export const bacaCookie = (header: string | undefined, nama: string) =>
  new RegExp(`(?:^|;\\s*)${nama}=([^;]+)`).exec(header ?? "")?.[1] ?? null;

export const cookieSesi = (token: string, umur = UMUR_SESI) =>
  `${COOKIE_SESI}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${umur}`;
