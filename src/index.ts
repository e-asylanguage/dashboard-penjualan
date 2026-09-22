import { Hono } from "hono";
import { Env } from "./env";
import { settings } from "./routes/settings";
import { report } from "./routes/report";
import { webhooks } from "./routes/webhooks";
import { runAll, syncMetaInsights, syncScalevOrders, backfillScalev, syncMengantar, trackReceipt } from "./lib/sync";
import { MengantarClient } from "./lib/mengantar";

const app = new Hono<{ Bindings: Env }>();

// --- Proteksi sederhana: header X-Dashboard-Key atau cookie dk=<password>. Ganti dengan Cloudflare Access saat produksi.
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/webhooks") || c.req.path === "/api/health") return next();
  const pw = c.env.DASHBOARD_PASSWORD;
  if (!pw) return next(); // belum di-set = terbuka (hanya untuk dev lokal)
  const cookie = c.req.header("Cookie") ?? "";
  const given = c.req.header("X-Dashboard-Key") ?? /(?:^|;\s*)dk=([^;]+)/.exec(cookie)?.[1];
  if (given !== pw) return c.json({ error: "unauthorized" }, 401);
  return next();
});

app.get("/api/health", c => c.json({ ok: true, time: new Date().toISOString() }));

app.route("/api/settings", settings);
app.route("/api/report", report);
app.route("/api/webhooks", webhooks);

// --- Sinkron manual
app.post("/api/sync/run", async c => c.json(await runAll(c.env)));
app.post("/api/sync/meta", async c => {
  const since = c.req.query("since"), until = c.req.query("until");
  return c.json(await syncMetaInsights(c.env, since, until));
});
app.post("/api/sync/scalev", async c => c.json(await syncScalevOrders(c.env, c.req.query("since"))));
app.post("/api/sync/backfill", async c => c.json(await backfillScalev(c.env, Number(c.req.query("days") ?? 90))));
app.post("/api/sync/mengantar", async c => c.json(await syncMengantar(c.env, Number(c.req.query("days") ?? 45))));
app.get("/api/track/:receipt", async c => {
  try { const o = await trackReceipt(c.env, c.req.param("receipt")); return o ? c.json(o) : c.json({ error: "resi tidak ditemukan" }, 404); }
  catch (e) { return c.json({ error: String(e) }, 502); }
});

// --- Cek koneksi cepat: satu request ke tiap API, untuk halaman Pengaturan > "Tes koneksi"
app.post("/api/settings/test", async c => {
  const out: Record<string, string> = {};
  try {
    const r = await fetch("https://api.scalev.com/v3/orders?page_size=1", { headers: { Authorization: `Bearer ${c.env.SCALEV_API_KEY}` } });
    out.scalev = r.ok ? "ok" : `HTTP ${r.status}`;
  } catch (e) { out.scalev = String(e); }
  if (c.env.MENGANTAR_API_KEY) { try { out.mengantar = await new MengantarClient(c.env.MENGANTAR_API_KEY).ping(); } catch (e) { out.mengantar = String(e); } }
  else out.mengantar = "secret belum di-set";
  const bms = await c.env.DB.prepare("SELECT id, token_secret FROM business_managers").all<{ id: string; token_secret: string }>();
  for (const b of bms.results) {
    const tok = c.env[b.token_secret];
    if (typeof tok !== "string" || !tok) { out[`meta:${b.id}`] = "secret belum di-set"; continue; }
    try {
      const r = await fetch(`https://graph.facebook.com/${c.env.META_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(tok)}`);
      const j = (await r.json()) as { name?: string; error?: { message: string } };
      out[`meta:${b.id}`] = j.error ? j.error.message : `ok (${j.name})`;
    } catch (e) { out[`meta:${b.id}`] = String(e); }
  }
  return c.json(out);
});

// Selain /api/*, layani frontend statis dari public/
app.all("*", c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Cron tiap jam (lihat wrangler.jsonc > triggers)
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAll(env));
  },
} satisfies ExportedHandler<Env>;
