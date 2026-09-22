export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TZ_REPORT: string;
  META_API_VERSION: string;
  SCALEV_API_KEY: string;
  SCALEV_WEBHOOK_SECRET?: string;
  MENGANTAR_API_KEY?: string;
  DASHBOARD_PASSWORD?: string;
  META_TOKEN_UNIKA?: string;
  META_TOKEN_TOMOJOYO?: string;
  META_TOKEN_STEVA?: string;
  [key: string]: unknown;
}

/** Ambil token Meta berdasarkan nama secret yang tersimpan di tabel business_managers. */
export function metaToken(env: Env, secretName: string): string {
  const v = env[secretName];
  if (typeof v !== "string" || !v) throw new Error(`Secret ${secretName} belum di-set (wrangler secret put ${secretName})`);
  return v;
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
