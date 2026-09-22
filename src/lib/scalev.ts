/**
 * Klien Scalev API v3 — https://api.scalev.com/v3
 * Dokumentasi: https://docs.scalev.dev (repo github.com/scalevcom/dev-docs)
 */
const BASE = "https://api.scalev.com/v3";

export const ORDER_COLUMNS = [
  "order_id", "status", "payment_status", "payment_method", "gross_revenue", "net_revenue",
  "shipping_cost", "product_discount", "draft_time", "confirmed_time", "shipped_time",
  "completed_time", "rts_time", "canceled_time", "store", "final_variants", "destination_address",
  "utm_source", "metadata", "page", "advertiser", "platform", "is_repeat",
].join(",");

export interface ScalevOrder {
  id: string;
  order_id: string;
  status: string;
  payment_status?: string;
  payment_method?: string;
  gross_revenue?: string | number;
  net_revenue?: string | number;
  shipping_cost?: number;
  product_discount?: number;
  draft_time?: string;
  confirmed_time?: string | null;
  shipped_time?: string | null;
  completed_time?: string | null;
  rts_time?: string | null;
  canceled_time?: string | null;
  store?: { id?: number; name?: string } | null;
  final_variants?: Record<string, number>;
  destination_address?: { city?: string; province?: string } | null;
  utm_source?: string | null;
  metadata?: Record<string, unknown> | null;
  is_probably_spam?: boolean;
  last_updated_at?: string;
  [k: string]: unknown;
}

interface ListResp<T> { data: T[]; has_next?: boolean; next_cursor?: string | null }

export class ScalevClient {
  constructor(private apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" } });
    if (res.status === 429) {
      const reset = res.headers.get("X-Ratelimit-Reset");
      throw new Error(`Scalev rate limit (reset ${reset ?? "?"})`);
    }
    if (!res.ok) throw new Error(`Scalev ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<T>;
  }

  /** Daftar store yang dimiliki business. */
  async stores(): Promise<{ id: number; name: string }[]> {
    const r = await this.get<ListResp<{ id: number; name: string }>>("/stores", { page_size: "25" });
    return r.data ?? [];
  }

  /**
   * Iterasi order halaman demi halaman (urut created_at desc, max 25/halaman).
   * `stop(order)` mengembalikan true untuk berhenti (mis. order sudah lebih tua dari batas).
   */
  async *orders(params: Record<string, string | undefined>, stop?: (o: ScalevOrder) => boolean): AsyncGenerator<ScalevOrder> {
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await this.get<ListResp<ScalevOrder>>("/orders", { ...params, columns: ORDER_COLUMNS, page_size: "25", next_cursor: cursor });
      for (const o of r.data ?? []) {
        if (stop && stop(o)) return;
        yield o;
      }
      cursor = r.has_next && r.next_cursor ? r.next_cursor : undefined;
      pages++;
      if (pages > 400) throw new Error("Scalev: terlalu banyak halaman (>10.000 order) dalam satu sync — persempit rentang");
    } while (cursor);
  }

  /** Statistik agregat (untuk verifikasi angka dashboard vs Scalev). */
  async statistics(params: Record<string, string | undefined>) {
    return this.get<unknown>("/orders/statistics", { tz: "Asia/Jakarta", datetime_type: "draft_time", ...params });
  }
}

/** Ambil nilai UTM dari order. Scalev menaruh utm_source di kolom sendiri; sisanya diduga ada di metadata. */
export function extractUtm(o: ScalevOrder): { source?: string; medium?: string; campaign?: string; term?: string; content?: string } {
  const m = (o.metadata ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = m[k] ?? (o as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  return {
    source: o.utm_source ?? pick("utm_source", "utmSource"),
    medium: pick("utm_medium", "utmMedium"),
    campaign: pick("utm_campaign", "utmCampaign"),
    term: pick("utm_term", "utmTerm"),
    content: pick("utm_content", "utmContent"),
  };
}

/** Verifikasi tanda tangan webhook Scalev (header X-Scalev-Hmac-Sha256, base64 HMAC-SHA256 dari raw body). */
export async function verifyScalevSignature(secret: string, rawBody: ArrayBuffer, signatureB64: string | null): Promise<boolean> {
  if (!secret || !signatureB64) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  let expected: Uint8Array;
  try { expected = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0)); } catch { return false; }
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ expected[i];
  return diff === 0;
}
