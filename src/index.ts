import { Hono } from "hono";
import { Env, hasMetaToken, metaToken } from "./env";
import { settings } from "./routes/settings";
import { report } from "./routes/report";
import { laporan } from "./routes/laporan";
import { shopee } from "./routes/shopee";
import { shopeeApi } from "./routes/shopee-api";
import { tiktokApi } from "./routes/tiktok-api";
import { tiktok } from "./routes/tiktok";
import { syncShopee } from "./lib/shopee-sync";
import { webhooks } from "./routes/webhooks";
import { runAll, syncMetaInsights, syncScalevOrders, backfillScalev, backfillScalevRange, syncMengantar, syncMengantarInvoices, syncScalevCatalog, trackReceipt, jalankanAntreanBackfill } from "./lib/sync";
import { MengantarClient } from "./lib/mengantar";
import { COOKIE_SESI, bacaCookie, bacaSesi, bolehPeninjau, buatSesi, cookieSesi, samaAman, userPeninjau } from "./lib/sesi";
import { MENU, akunSesi, cocokPassword, hashPassword, loginUser, menuApi } from "./lib/users";
import { users } from "./routes/users";
import { cloudflare } from "./routes/cloudflare";

const app = new Hono<{ Bindings: Env }>();

// --- Akses: hanya cookie sesi dari halaman login (akun Manajemen User, atau akun peninjau dari secret).
// /api/shopee-api/callback: Shopee mengarahkan pemilik toko ke sini setelah izin; dijaga state sekali pakai
const TERBUKA = new Set(["/api/health", "/api/login", "/api/logout", "/api/shopee-api/callback", "/api/tiktok-api/callback"]);
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/webhooks") || TERBUKA.has(c.req.path)) return next();
  const pw = c.env.DASHBOARD_PASSWORD;
  if (!pw) return next(); // kunci sesi belum di-set = terbuka (hanya untuk dev lokal)
  const sesi = await bacaSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI));
  const akun = sesi ? await akunSesi(c.env, sesi.user, sesi.exp) : null;
  if (akun) {
    const { method, path } = c.req;
    if (akun.peran === "admin") return next();
    // Akun peninjau: hanya baca menu Shopee
    if (akun.peran === "peninjau") return bolehPeninjau(method, path) ? next() : c.json({ error: "akun peninjau hanya bisa melihat menu Shopee" }, 403);
    // User dari Manajemen User: menu yang dicentang, dan hanya baca kecuali boleh ubah
    if (path === "/api/me" || path === "/api/logout" || path === "/api/me/password") return next();
    if (path === "/api/users" || path.startsWith("/api/users/")) return c.json({ error: "Hanya admin yang bisa mengelola user" }, 403);
    if (path === "/api/cloudflare" || path.startsWith("/api/cloudflare/")) return c.json({ error: "Hanya admin yang bisa melihat pemakaian Cloudflare" }, 403);
    if (method !== "GET" && !akun.boleh_ubah) return c.json({ error: "Akun Anda hanya bisa melihat data, tidak bisa mengubah" }, 403);
    const perlu = menuApi(method, path);
    if (perlu && !perlu.some(m => akun.menu.includes(m))) return c.json({ error: "Akun Anda tidak punya akses ke menu ini" }, 403);
    return next();
  }
  // tanpa sesi, atau sesi akun yang sudah dinonaktifkan / dihapus
  return c.json({ error: "unauthorized" }, 401);
});

app.get("/api/health", c => c.json({ ok: true, time: new Date().toISOString() }));

// --- Login / logout: akun dari Manajemen User (tabel users), atau akun peninjau (secret DASHBOARD_REVIEW_*).
// Secret DASHBOARD_PASSWORD hanya kunci tanda tangan sesi, bukan password login.
app.post("/api/login", async c => {
  const b = await c.req.json<{ username?: string; password?: string }>().catch(() => ({} as { username?: string; password?: string }));
  // Tanpa kunci sesi dashboard terbuka (mode dev) — HMAC juga tidak bisa dibuat dengan kunci kosong
  if (!c.env.DASHBOARD_PASSWORD) return c.json({ error: "Login belum diaktifkan: secret DASHBOARD_PASSWORD belum di-set" }, 503);
  // Akun peninjau (bila diaktifkan): username & password selalu dicek berdua supaya waktu respons tidak membocorkan mana yang salah
  const pUser = userPeninjau(c.env), pPw = typeof c.env.DASHBOARD_REVIEW_PASSWORD === "string" ? c.env.DASHBOARD_REVIEW_PASSWORD : "";
  const [okPUser, okPPw] = pUser ? await Promise.all([
    samaAman(c.env, String(b.username ?? "").trim().toLowerCase(), pUser.toLowerCase()),
    samaAman(c.env, String(b.password ?? ""), pPw),
  ]) : [false, false];
  // Lalu akun dari Manajemen User (tabel users)
  const masuk = okPUser && okPPw && pUser ? pUser
    : await loginUser(c.env, String(b.username ?? ""), String(b.password ?? ""));
  if (!masuk) {
    await new Promise(r => setTimeout(r, 800)); // perlambat tebak-tebakan password
    return c.json({ error: "Username atau password salah" }, 401);
  }
  c.header("Set-Cookie", cookieSesi(await buatSesi(c.env, masuk)));
  return c.json({ ok: true, user: masuk });
});
app.post("/api/logout", c => { c.header("Set-Cookie", cookieSesi("", 0)); return c.json({ ok: true }); });
/** Akun yang sedang login + hak aksesnya (sidebar menyembunyikan menu yang tidak boleh dibuka) */
app.get("/api/me", async c => {
  const s = await bacaSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI));
  const akun = s && await akunSesi(c.env, s.user, s.exp);
  if (akun) return c.json(akun);
  // Mode dev (tanpa kunci sesi): semua menu terbuka
  return c.env.DASHBOARD_PASSWORD ? c.json({ error: "unauthorized" }, 401)
    : c.json({ user: "dev", nama: null, peran: "admin", menu: [...MENU], boleh_ubah: true, id: null });
});
/** Ganti password sendiri (akun Manajemen User): { lama, baru } */
app.post("/api/me/password", async c => {
  const s = await bacaSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI));
  const akun = s ? await akunSesi(c.env, s.user, s.exp) : null;
  if (!akun?.id) return c.json({ error: "Password akun peninjau diatur lewat secret Cloudflare, bukan dari dashboard" }, 400);
  const b = await c.req.json<{ lama?: string; baru?: string }>().catch(() => ({} as { lama?: string; baru?: string }));
  const baru = String(b.baru ?? "");
  if (baru.length < 8) return c.json({ error: "Password baru minimal 8 karakter" }, 400);
  const r = await c.env.DB.prepare("SELECT pass_hash FROM users WHERE id=?").bind(akun.id).first<{ pass_hash: string }>();
  if (!r || !(await cocokPassword(String(b.lama ?? ""), r.pass_hash))) return c.json({ error: "Password lama salah" }, 400);
  // Sesi lain milik akun ini otomatis keluar; sesi ini diganti yang baru
  const kini = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare("UPDATE users SET pass_hash=?, sesi_sejak=?, updated_at=? WHERE id=?").bind(await hashPassword(baru), kini, new Date().toISOString(), akun.id).run();
  c.header("Set-Cookie", cookieSesi(await buatSesi(c.env, akun.user)));
  return c.json({ ok: true });
});

app.route("/api/users", users);
app.route("/api/cloudflare", cloudflare);
app.route("/api/settings", settings);
app.route("/api/report", report);
app.route("/api/laporan", laporan);
// Sinkron Shopee API sekarang (tombol "Sinkron sekarang"); ?hari=N menarik ulang N hari terakhir
app.post("/api/shopee/sinkron", async c => c.json(await syncShopee(c.env, { hari: Number(c.req.query("hari")) || undefined })));
app.route("/api/shopee", shopee);
app.route("/api/shopee-api", shopeeApi);
app.route("/api/tiktok-api", tiktokApi);
app.route("/api/tiktok", tiktok);
app.route("/api/webhooks", webhooks);

// --- Sinkron manual
app.post("/api/sync/run", async c => c.json(await runAll(c.env)));
app.post("/api/sync/meta", async c => {
  const since = c.req.query("since"), until = c.req.query("until");
  return c.json(await syncMetaInsights(c.env, since, until));
});
app.post("/api/sync/scalev", async c => c.json(await syncScalevOrders(c.env, c.req.query("since"))));
app.post("/api/sync/backfill", async c => c.json(await backfillScalev(c.env, Number(c.req.query("days") ?? 90))));
app.post("/api/sync/backfill-range", async c => {
  const from = c.req.query("from"), to = c.req.query("to");
  if (!from || !to) return c.json({ error: "from dan to (YYYY-MM-DD) wajib" }, 400);
  return c.json(await backfillScalevRange(c.env, from, to));
});
app.post("/api/sync/katalog", async c => c.json(await syncScalevCatalog(c.env, Number(c.req.query("max") ?? 200), c.req.query("paksa") === "1")));
app.post("/api/sync/mengantar", async c => c.json(await syncMengantar(c.env, Number(c.req.query("days") ?? 45))));
app.post("/api/sync/mengantar-saldo", async c => c.json(await syncMengantarInvoices(c.env, Number(c.req.query("days") ?? 10))));
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
  const bms = await c.env.DB.prepare("SELECT id, token, token_secret FROM business_managers").all<{ id: string; token: string | null; token_secret: string | null }>();
  for (const b of bms.results) {
    if (!hasMetaToken(c.env, b)) { out[`meta:${b.id}`] = "token belum diisi"; continue; }
    const tok = metaToken(c.env, b);
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
    // Sinkron rutin dulu, lalu satu rentang dari antrean backfill (bila ada)
    ctx.waitUntil(runAll(env).then(() => jalankanAntreanBackfill(env)));
  },
} satisfies ExportedHandler<Env>;
