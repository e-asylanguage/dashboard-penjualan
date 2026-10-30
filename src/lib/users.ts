import { Env } from "../env";
import { userPeninjau, UMUR_SESI } from "./sesi";

/**
 * Akun login dari menu Manajemen User (tabel users) — satu-satunya cara login selain akun peninjau Shopee (secret
 * DASHBOARD_REVIEW_*). Minimal satu admin aktif selalu dijaga (routes/users.ts) supaya dashboard tidak terkunci.
 *  - admin=1 → semua menu + kelola user;
 *  - selain itu hanya menu di kolom `menu`, dan hanya baca kecuali boleh_ubah=1.
 */

/** Kunci menu = data-group di sidebar (ringkasan & pengaturan = tombol tunggal) */
export const MENU = ["ringkasan", "iklan", "order", "produk", "inventory", "kirim", "shopee", "tiktok", "sales", "analisis", "laporan", "pengaturan"] as const;
export type Menu = (typeof MENU)[number];

export type Akun = { user: string; nama: string | null; peran: "admin" | "peninjau" | "user"; menu: Menu[]; boleh_ubah: boolean; id: number | null };
type BarisUser = { id: number; username: string; nama: string | null; admin: number; menu: string; boleh_ubah: number; aktif: number; sesi_sejak: number; pass_hash: string };

export const bacaMenu = (s: string | null | undefined): Menu[] => {
  try { const a = JSON.parse(s ?? "[]"); return Array.isArray(a) ? a.filter((m): m is Menu => (MENU as readonly string[]).includes(m)) : []; } catch { return []; }
};

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dariB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
const ITERASI = 100_000; // batas PBKDF2 di Workers

async function pbkdf2(password: string, salt: Uint8Array, iterasi: number) {
  const k = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iterasi }, k, 256));
}
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERASI}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ITERASI))}`;
}
export async function cocokPassword(password: string, simpan: string) {
  const [alg, it, salt, hash] = simpan.split("$");
  if (alg !== "pbkdf2" || !it || !salt || !hash) return false;
  const a = await pbkdf2(password, dariB64url(salt), Number(it)), b = dariB64url(hash);
  if (a.length !== b.length) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a[i] ^ b[i];
  return beda === 0;
}

/** Username akun peninjau (secret) tidak boleh dipakai di tabel users */
export const usernameCadangan = (env: Env, u: string) => {
  const p = userPeninjau(env);
  return !!p && p.toLowerCase() === u.trim().toLowerCase();
};

/** Login akun tabel users; null bila username / password salah atau akun nonaktif */
export async function loginUser(env: Env, username: string, password: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT id, username, pass_hash, aktif FROM users WHERE username=?").bind(username.trim()).first<BarisUser>();
  if (!r) { await hashPassword(password); return null; } // samakan waktu respons dengan username yang ada
  if (!(await cocokPassword(password, r.pass_hash)) || !r.aktif) return null;
  await env.DB.prepare("UPDATE users SET login_terakhir=? WHERE id=?").bind(new Date().toISOString(), r.id).run();
  return r.username;
}

/**
 * Akun pemilik sesi (`exp` = waktu kedaluwarsa token). null = sesi tidak berlaku lagi (akun dihapus / nonaktif /
 * password diganti setelah sesi dibuat).
 */
export async function akunSesi(env: Env, user: string, exp: number): Promise<Akun | null> {
  const p = userPeninjau(env);
  if (p && user.toLowerCase() === p.toLowerCase()) return { user, nama: null, peran: "peninjau", menu: ["shopee"], boleh_ubah: false, id: null };
  const r = await env.DB.prepare("SELECT id, username, nama, admin, menu, boleh_ubah, aktif, sesi_sejak FROM users WHERE username=?").bind(user).first<BarisUser>();
  if (!r || !r.aktif || exp - UMUR_SESI < r.sesi_sejak) return null;
  return r.admin
    ? { user: r.username, nama: r.nama, peran: "admin", menu: [...MENU], boleh_ubah: true, id: r.id }
    : { user: r.username, nama: r.nama, peran: "user", menu: bacaMenu(r.menu), boleh_ubah: !!r.boleh_ubah, id: r.id };
}

const ada = (p: string, ...awal: string[]) => awal.some(a => p === a || p.startsWith(a + "/"));
/**
 * Menu yang membuka akses ke sebuah API (salah satu cukup). null = boleh untuk semua user yang login (data bersama
 * seperti daftar store, katalog, master SKU untuk dibaca). Hanya untuk user non-admin.
 */
export function menuApi(method: string, path: string): Menu[] | null {
  const tulis = method !== "GET";
  if (ada(path, "/api/laporan")) return ["laporan"];
  if (ada(path, "/api/shopee", "/api/shopee-api")) return ["shopee", "pengaturan"];
  if (ada(path, "/api/tiktok", "/api/tiktok-api")) return ["tiktok", "pengaturan"];
  if (ada(path, "/api/report/iklan", "/api/report/iklan-semua", "/api/report/konten")) return ["iklan"];
  if (ada(path, "/api/report/cs", "/api/report/cs-produk", "/api/report/cs-rincian", "/api/report/wilayah", "/api/report/wilayah-daftar", "/api/report/pcs-terjual")) return ["sales"];
  if (ada(path, "/api/report/orders", "/api/report/lead-pattern")) return ["order"];
  if (ada(path, "/api/report/ringkasan")) return ["ringkasan"];
  if (ada(path, "/api/report/bcg-marketplace")) return ["analisis"];
  if (ada(path, "/api/report/shipments")) return ["kirim"];
  if (ada(path, "/api/report/stok", "/api/report/outbound", "/api/report/inbound-rts")) return tulis ? ["inventory"] : ["inventory", "laporan"];
  if (ada(path, "/api/settings/test") || (ada(path, "/api/sync") && path !== "/api/sync/run")) return ["pengaturan"];
  if (!tulis) return null;
  // Perubahan master data menurut menu tempat datanya diubah
  if (ada(path, "/api/settings/produk-list", "/api/settings/gudang", "/api/settings/req")) return ["inventory"];
  if (ada(path, "/api/settings/sku", "/api/settings/bundling", "/api/settings/barang")) return ["produk"];
  if (ada(path, "/api/settings/produk-gabungan", "/api/settings/product-category", "/api/settings/product-groups", "/api/settings/campaign-map",
    "/api/settings/editor-konten")) return ["iklan", "produk"];
  if (ada(path, "/api/settings")) return ["pengaturan"];
  return null;
}
