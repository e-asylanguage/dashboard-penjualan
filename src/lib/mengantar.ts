/**
 * Klien Mengantar Public API. Pola: {BASE}/api/public/{API_KEY}/{endpoint}
 * Referensi: https://app.mengantar.com/docs (mirror: github.com/ongkipro/mengantar-documentation)
 * Key ada di URL → hanya boleh dipanggil dari Worker.
 */
const BASE = "https://api-public.mengantar.com";

export interface MengantarOrder {
  _id: string;
  ORDER_ID?: string;
  cnote_no?: string | null;
  courier?: string;
  SERVICE_CODE?: string;
  status?: string;
  statusCategory?: string;
  lastStatusChange?: string;
  isPaid?: boolean;
  COD_FLAG?: string | boolean;
  COD_AMOUNT?: number | string;
  COD_FEE?: number | string;
  price?: number | string;
  RECEIVER_CITY?: string;
  RECEIVER_REGION?: string;
  RECEIVER_PHONE?: string;
  WEIGHT?: number;
  createdAt?: string;
  createdDate?: string;
  updatedAt?: string;
  history?: Record<string, unknown>[];
  [k: string]: unknown;
}

interface Envelope<T> { success: boolean; data?: T; message?: string; errorsFront?: string; total?: number; totalPage?: number }

export class MengantarClient {
  constructor(private apiKey: string) {}

  private async get<T>(endpoint: string, params: Record<string, string | undefined>): Promise<Envelope<T>> {
    const url = new URL(`${BASE}/api/public/${this.apiKey}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    // User-Agent dikirim eksplisit karena fetch dari Worker tidak menyertakannya.
    // Catatan: 403 "Not allowed" dari Worker (Sep 2026) terjadi dengan key lama saja —
    // key yang dibuat ulang pada 24 Sep 2026 langsung diterima dari Cloudflare Workers.
    // Bila 403 muncul lagi, coba buat ulang API key di dashboard Mengantar lebih dulu.
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "marketing-dashboard/0.1 (+https://dashboard-penjualan.empatribupaketdotcom.workers.dev)",
      },
    });
    const text = await res.text();
    let body: Envelope<T>;
    try { body = JSON.parse(text) as Envelope<T>; } catch { throw new Error(`Mengantar ${res.status}: respons bukan JSON (${text.slice(0, 200)}) [cf-ray ${res.headers.get("cf-ray") ?? "-"}, server ${res.headers.get("server") ?? "-"}]`); }
    // cf-ray & server ikut dilaporkan: Mengantar berada di belakang Cloudflare, dan
    // penolakan dari sana perlu dibedakan dari penolakan aplikasi Mengantar sendiri.
    if (!res.ok || body.success === false) throw new Error(`Mengantar ${res.status}: ${body.errorsFront ?? body.message ?? "gagal"} [body ${text.slice(0, 160)}] [cf-ray ${res.headers.get("cf-ray") ?? "-"}, server ${res.headers.get("server") ?? "-"}]`);
    return body;
  }

  /** Satu paket + riwayat status, berdasarkan resi. */
  async byReceipt(receipt: string): Promise<MengantarOrder | null> {
    const r = await this.get<MengantarOrder | MengantarOrder[]>("order", { tracking_id: receipt });
    const d = r.data;
    if (!d) return null;
    return Array.isArray(d) ? d[0] ?? null : d;
  }

  /** Daftar paket dalam rentang tanggal (ISO). Halaman demi halaman, size maks 50. */
  async *list(startIso: string, endIso: string, extra: Record<string, string | undefined> = {}): AsyncGenerator<MengantarOrder> {
    let page = 1;
    for (;;) {
      const r = await this.get<MengantarOrder[]>("order", {
        page: String(page), size: "50",
        dateRange: JSON.stringify({ startDate: startIso, endDate: endIso }),
        ...extra,
      });
      const rows = r.data ?? [];
      for (const o of rows) yield o;
      if (rows.length < 50) return;
      page++;
      if (page > 400) throw new Error("Mengantar: terlalu banyak halaman dalam satu sync");
    }
  }

  /** Ping ringan untuk Tes koneksi: minta 1 order terbaru. */
  async ping(): Promise<string> {
    const end = new Date().toISOString(), start = new Date(Date.now() - 7 * 86400000).toISOString();
    const r = await this.get<MengantarOrder[]>("order", { page: "1", size: "1", dateRange: JSON.stringify({ startDate: start, endDate: end }) });
    return `ok (${r.data?.length ?? 0} paket 7 hari terakhir)`;
  }
}

/** DELIVERED | RTS | ON_GOING — aturan penyederhanaan resmi Mengantar. */
export function simpleStatus(status?: string, category?: string): "DELIVERED" | "RTS" | "ON_GOING" {
  const s = (status ?? "").toUpperCase(), c = (category ?? "").toLowerCase();
  if (s.includes("DELIVERED") && !s.includes("UNDELIVERED")) return "DELIVERED";
  if (s.includes("RTS") || s.includes("RETURN") || c === "rts") return "RTS";
  return "ON_GOING";
}

/** Turunkan tanggal delivered/RTS, jumlah gagal antar, dan event terakhir dari history[]. */
export function summarizeHistory(history: Record<string, unknown>[] | undefined) {
  let delivered: string | null = null, rts: string | null = null, undelivered = 0;
  let lastAt: string | null = null, lastNote: string | null = null;
  for (const h of history ?? []) {
    const st = String(h.status ?? h.STATUS ?? h.desc ?? h.description ?? "").toUpperCase();
    const at = String(h.date ?? h.createdAt ?? h.time ?? h.updatedAt ?? "");
    if (st.includes("UNDELIVERED") || st.includes("GAGAL")) undelivered++;
    else if (st.includes("DELIVERED") && !delivered) delivered = at;
    if ((st.includes("RTS") || st.includes("RETURN")) && !rts) rts = at;
    if (!lastAt || at > lastAt) { lastAt = at; lastNote = String(h.status ?? h.desc ?? h.description ?? ""); }
  }
  return { delivered, rts, undelivered, lastAt, lastNote };
}
