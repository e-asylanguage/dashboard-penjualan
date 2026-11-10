// Rakit public/index.html dari web/index.html + web/views/*.html.
// Tiap baris `<!-- @view nama -->` di web/index.html diganti isi web/views/nama.html.
// Dijalankan otomatis oleh `wrangler dev` / `wrangler deploy` (build.command di wrangler.jsonc).
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const dipakai = new Set();

const html = fs.readFileSync(path.join(web, "index.html"), "utf8").replace(/^[ \t]*<!-- @view ([\w-]+) -->\r?\n/gm, (_, nama) => {
  const f = path.join(web, "views", nama + ".html");
  if (!fs.existsSync(f)) throw new Error(`web/views/${nama}.html tidak ada`);
  dipakai.add(nama);
  return fs.readFileSync(f, "utf8");
});
const lupa = fs.readdirSync(path.join(web, "views")).map(f => f.replace(/\.html$/, "")).filter(n => !dipakai.has(n));
if (lupa.length) console.warn("Peringatan: view tidak dipakai di web/index.html:", lupa.join(", "));

// Cache-busting: script & stylesheet lokal diberi ?v=<hash isi file>, jadi setelah deploy browser langsung memuat versi baru
// (tanpa ini main.js lama bisa tertinggal di cache sementara index.html sudah baru → halaman baru tidak pernah dimuat).
const versi = (src) => {
  const f = path.join(root, "public", src.split("?")[0]);
  return fs.existsSync(f) ? crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 10) : null;
};
const hasil = html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")(\/(?:js|css)\/[^"?]+\.(?:js|css))(")/g, (m, a, src, b) => {
  const v = versi(src);
  return v ? `${a}${src}?v=${v}${b}` : m;
});

fs.writeFileSync(path.join(root, "public", "index.html"),
  hasil.replace(/^<!DOCTYPE html>\r?\n/i, "$&<!-- FILE HASIL BUILD dari web/ (scripts/build-html.mjs) — jangan diedit langsung -->\n"));
console.log(`public/index.html dirakit dari ${dipakai.size} view`);
