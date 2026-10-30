export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TZ_REPORT: string;
  META_API_VERSION: string;
  SCALEV_API_KEY: string;
  SCALEV_WEBHOOK_SECRET?: string;
  MENGANTAR_API_KEY?: string;
  DASHBOARD_PASSWORD?: string;
  DASHBOARD_USER?: string;         // username login, default "admin"
  META_TOKEN_UNIKA?: string;
  META_TOKEN_TOMOJOYO?: string;
  META_TOKEN_STEVA?: string;
  CF_API_TOKEN?: string;           // menu Pemakaian Cloudflare: token Account Analytics Read (+ D1 Read)
  CF_ACCOUNT_ID?: string;
  [key: string]: unknown;
}

/**
 * Token Meta sebuah BM: yang diisi di halaman Pengaturan (kolom token) lebih dulu,
 * lalu secret Worker bernama token_secret sebagai cadangan.
 */
export function metaToken(env: Env, bm: { token?: string | null; token_secret?: string | null }): string {
  if (bm.token) return bm.token;
  const v = bm.token_secret ? env[bm.token_secret] : undefined;
  if (typeof v !== "string" || !v) throw new Error("Token Meta belum diisi (Pengaturan › Sinkronisasi Meta Ads)");
  return v;
}

/** true bila BM punya token dari salah satu sumber. */
export function hasMetaToken(env: Env, bm: { token?: string | null; token_secret?: string | null }): boolean {
  try { metaToken(env, bm); return true; } catch { return false; }
}

/** YYYY-MM-DD di zona waktu laporan (default Asia/Jakarta). */
export function toReportDate(iso: string | null | undefined, tz = "Asia/Jakarta"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function todayReport(tz = "Asia/Jakarta"): string {
  return toReportDate(new Date().toISOString(), tz)!;
}

export function daysAgo(n: number, tz = "Asia/Jakarta"): string {
  return toReportDate(new Date(Date.now() - n * 86400000).toISOString(), tz)!;
}
