import { Hono } from "hono";
import { Env } from "../env";
import { COOKIE_SESI, bacaCookie, bacaSesi } from "../lib/sesi";
import { MENU, akunSesi, bacaMenu, hashPassword, usernameCadangan } from "../lib/users";

/** Menu Manajemen User (hanya admin — dijaga middleware di index.ts). */
export const users = new Hono<{ Bindings: Env }>();

const USERNAME = /^[a-z0-9._-]{3,32}$/i;
/** Jumlah admin aktif selain user `id` — minimal harus tersisa satu supaya dashboard tidak terkunci */
const adminLain = async (env: Env, id: number) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE admin=1 AND aktif=1 AND id<>?").bind(id).first<{ n: number }>())?.n ?? 0;
const akunIni = async (c: { env: Env; req: { header: (k: string) => string | undefined } }) => {
  const s = await bacaSesi(c.env, bacaCookie(c.req.header("Cookie"), COOKIE_SESI));
  return s ? await akunSesi(c.env, s.user, s.exp) : null;
};

users.get("/", async c => {
  const rows = await c.env.DB.prepare(
    "SELECT id, username, nama, admin, menu, boleh_ubah, aktif, login_terakhir, dibuat_oleh, created_at, updated_at FROM users ORDER BY aktif DESC, admin DESC, username")
    .all<Record<string, unknown> & { menu: string }>();
  const saya = await akunIni(c);
  return c.json({
    menu: MENU, saya: saya?.user ?? null,
    rows: rows.results.map(r => ({ ...r, menu: bacaMenu(r.menu) })),
  });
});

/** Tambah / ubah user: { id?, username, nama?, password? (wajib saat tambah), admin, menu[], boleh_ubah, aktif } */
users.put("/", async c => {
  const b = await c.req.json<{ id?: number; username?: string; nama?: string; password?: string; admin?: boolean; menu?: string[]; boleh_ubah?: boolean; aktif?: boolean }>();
  const username = String(b.username ?? "").trim(), nama = String(b.nama ?? "").trim() || null, password = String(b.password ?? "");
  if (!USERNAME.test(username)) return c.json({ error: "Username 3–32 karakter: huruf, angka, titik, garis bawah, atau strip (tanpa spasi)" }, 400);
  if (usernameCadangan(c.env, username)) return c.json({ error: "Username itu sudah dipakai akun admin utama / peninjau" }, 400);
  if ((!b.id || password) && password.length < 8) return c.json({ error: "Password minimal 8 karakter" }, 400);
  const menu = JSON.stringify(bacaMenu(JSON.stringify(b.menu ?? []))), admin = b.admin ? 1 : 0, ubah = b.boleh_ubah ? 1 : 0, aktif = b.aktif === false ? 0 : 1;
  if (!admin && menu === "[]") return c.json({ error: "Pilih minimal satu menu" }, 400);
  const saya = await akunIni(c), now = new Date().toISOString(), kini = Math.floor(Date.now() / 1000);
  const dupe = await c.env.DB.prepare("SELECT id FROM users WHERE username=? AND id<>?").bind(username, b.id ?? 0).first();
  if (dupe) return c.json({ error: "Username sudah dipakai user lain" }, 400);

  if (b.id) {
    const lama = await c.env.DB.prepare("SELECT id, aktif, admin FROM users WHERE id=?").bind(b.id).first<{ id: number; aktif: number; admin: number }>();
    if (!lama) return c.json({ error: "User tidak ditemukan" }, 404);
    if (saya?.id === b.id && (!aktif || !admin)) return c.json({ error: "Tidak bisa menonaktifkan atau menurunkan akses akun Anda sendiri" }, 400);
    if (lama.admin && lama.aktif && (!admin || !aktif) && !(await adminLain(c.env, b.id)))
      return c.json({ error: "Harus ada minimal satu admin aktif — jadikan user lain admin dulu" }, 400);
    // Password diganti / akun dinonaktifkan → semua sesi user itu keluar
    const putus = !!password || (lama.aktif && !aktif);
    await c.env.DB.prepare(
      `UPDATE users SET username=?, nama=?, admin=?, menu=?, boleh_ubah=?, aktif=?, updated_at=?${password ? ", pass_hash=?" : ""}${putus ? ", sesi_sejak=?" : ""} WHERE id=?`)
      .bind(...[username, nama, admin, menu, ubah, aktif, now, ...(password ? [await hashPassword(password)] : []), ...(putus ? [kini] : []), b.id]).run();
    return c.json({ ok: true, id: b.id });
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO users (username, nama, pass_hash, admin, menu, boleh_ubah, aktif, sesi_sejak, dibuat_oleh, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?,?)`)
    .bind(username, nama, await hashPassword(password), admin, menu, ubah, aktif, saya?.user ?? null, now, now).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});

users.delete("/:id", async c => {
  const id = Number(c.req.param("id")), saya = await akunIni(c);
  if (saya?.id === id) return c.json({ error: "Tidak bisa menghapus akun Anda sendiri" }, 400);
  const r = await c.env.DB.prepare("SELECT admin, aktif FROM users WHERE id=?").bind(id).first<{ admin: number; aktif: number }>();
  if (r?.admin && r.aktif && !(await adminLain(c.env, id))) return c.json({ error: "Harus ada minimal satu admin aktif — jadikan user lain admin dulu" }, 400);
  await c.env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
