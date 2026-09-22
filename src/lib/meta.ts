/**
 * Klien Meta Marketing API (Graph API). Versi diatur lewat var META_API_VERSION (default v25.0).
 */
export interface AdAccount { id: string; account_id: string; name: string; currency: string; account_status: number }
export interface InsightRow {
  date_start: string; date_stop: string;
  account_id: string; campaign_id: string; campaign_name: string;
  adset_id: string; adset_name: string; ad_id: string; ad_name: string;
  spend?: string; impressions?: string; clicks?: string; reach?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

export class MetaClient {
  constructor(private token: string, private version = "v25.0") {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", this.token);
    const res = await fetch(url);
    const body = (await res.json()) as T & { error?: { message: string; code: number; error_subcode?: number } };
    if (!res.ok || body.error) {
      const e = body.error;
      throw new Error(`Meta ${e?.code ?? res.status}${e?.error_subcode ? "/" + e.error_subcode : ""}: ${e?.message ?? "request gagal"}`);
    }
    return body;
  }

  /** Semua ad account yang bisa diakses token ini (dipakai halaman Pengaturan). */
  async adAccounts(): Promise<AdAccount[]> {
    const out: AdAccount[] = [];
    let after: string | undefined;
    do {
      const r = await this.get<{ data: AdAccount[]; paging?: { cursors?: { after?: string }; next?: string } }>("me/adaccounts", {
        fields: "id,account_id,name,currency,account_status", limit: "100", ...(after ? { after } : {}),
      });
      out.push(...r.data);
      after = r.paging?.next ? r.paging.cursors?.after : undefined;
    } while (after);
    return out;
  }

  /** Insight harian level ad untuk rentang tanggal (YYYY-MM-DD, inklusif). */
  async insightsDaily(accountId: string, since: string, until: string): Promise<InsightRow[]> {
    const out: InsightRow[] = [];
    let after: string | undefined;
    do {
      const r = await this.get<{ data: InsightRow[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${accountId}/insights`, {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,reach,actions,action_values",
        action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
        limit: "500",
        ...(after ? { after } : {}),
      });
      out.push(...r.data);
      after = r.paging?.next ? r.paging.cursors?.after : undefined;
    } while (after);
    return out;
  }

  /** Status & objective campaign (untuk tabel Iklan). */
  async campaigns(accountId: string): Promise<{ id: string; name: string; status: string; objective?: string; updated_time?: string }[]> {
    const r = await this.get<{ data: { id: string; name: string; status: string; objective?: string; updated_time?: string }[] }>(`${accountId}/campaigns`, {
      fields: "id,name,status,objective,updated_time", limit: "500",
    });
    return r.data;
  }
}

export function actionValue(rows: { action_type: string; value: string }[] | undefined, type: string): number {
  const a = rows?.find(x => x.action_type === type);
  return a ? Number(a.value) || 0 : 0;
}
