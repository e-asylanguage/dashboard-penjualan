import { Hono } from "hono";
import { Env } from "../env";

/**
 * Menu Pemakaian Cloudflare (hanya admin — dijaga middleware di index.ts): pemakaian semua Worker, D1, dan R2 di akun
 * Cloudflare bulan ini dibanding kuota paket Workers Paid, proyeksi tagihan akhir bulan, lonjakan harian, dan query D1
 * terboros. Sumber: GraphQL Analytics API, memakai secret CF_API_TOKEN (izin Account Analytics: Read; D1: Read
 * opsional untuk nama database) dan var CF_ACCOUNT_ID.
 */
export const cloudflare = new Hono<{ Bindings: Env }>();

/** Kuota & harga lebih Workers Paid ($5/bulan). Ubah di sini bila Cloudflare mengganti harga. */
export const KUOTA = {
  workers_req:   { nama: "Workers · request",        termasuk: 10e6,  satuan: 1e6, harga: 0.30, unit: "request" },
  workers_cpu:   { nama: "Workers · CPU time",       termasuk: 30e6,  satuan: 1e6, harga: 0.02, unit: "ms" },
  observability: { nama: "Workers Observability",    termasuk: 20e6,  satuan: 1e6, harga: 0.60, unit: "event" },
  d1_read:       { nama: "D1 · rows read",           termasuk: 25e9,  satuan: 1e6, harga: 0.001, unit: "baris" },
  d1_write:      { nama: "D1 · rows written",        termasuk: 50e6,  satuan: 1e6, harga: 1.00, unit: "baris" },
  d1_storage:    { nama: "D1 · storage",             termasuk: 5e9,   satuan: 1e9, harga: 0.75, unit: "byte" },
  r2_storage:    { nama: "R2 · storage",             termasuk: 10e9,  satuan: 1e9, harga: 0.015, unit: "byte" },
  r2_a:          { nama: "R2 · operasi Class A",     termasuk: 1e6,   satuan: 1e6, harga: 4.50, unit: "operasi" },
  r2_b:          { nama: "R2 · operasi Class B",     termasuk: 10e6,  satuan: 1e6, harga: 0.36, unit: "operasi" },
} as const;
export const BIAYA_DASAR = 5;
type Kunci = keyof typeof KUOTA;

/** Operasi R2: gratis (hapus/batal), Class B (baca), sisanya Class A (tulis/list) */
const kelasR2 = (aksi: string): "a" | "b" | null =>
  /^(Delete|Abort)/.test(aksi) ? null : /^(Get|Head|UsageSummary)/.test(aksi) ? "b" : "a";

const tgl = (d: Date) => d.toISOString().slice(0, 10);
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

type Gql<T> = { data?: { viewer: { accounts: T[] } }; errors?: { message: string }[] | null };
async function gql<T>(env: Env, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json().catch(() => ({}))) as Gql<T>;
  if (j.errors?.length) throw new Error("Cloudflare GraphQL: " + j.errors.map(e => e.message).join("; "));
  if (!r.ok || !j.data) throw new Error(`Cloudflare GraphQL HTTP ${r.status}`);
  const a = j.data.viewer.accounts[0];
  if (!a) throw new Error("Akun Cloudflare tidak ditemukan — cek CF_ACCOUNT_ID dan izin token");
  return a;
}

type Akun = {
  w: { sum: { requests: number; subrequests: number; errors: number; cpuTimeUs: number }; dimensions: { scriptName: string; date: string } }[];
  d1: { sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number }; dimensions: { databaseId: string; date: string } }[];
  d1s: { max: { databaseSizeBytes: number }; dimensions: { databaseId: string; date: string } }[];
  r2o: { sum: { requests: number }; dimensions: { actionType: string; bucketName: string; date: string } }[];
  r2s: { max: { payloadSize: number; metadataSize: number; objectCount: number }; dimensions: { bucketName: string; date: string } }[];
  q: { count: number; sum: { rowsRead: number; rowsWritten: number; queryDurationMs: number }; dimensions: { query: string; databaseId: string } }[];
};
const QUERY = `query($a:String!,$s:Date!,$e:Date!,$k:Date!){viewer{accounts(filter:{accountTag:$a}){
  w:workersInvocationsAdaptive(limit:5000,filter:{date_geq:$s,date_leq:$e}){sum{requests subrequests errors cpuTimeUs}dimensions{scriptName date}}
  d1:d1AnalyticsAdaptiveGroups(limit:5000,filter:{date_geq:$s,date_leq:$e}){sum{readQueries writeQueries rowsRead rowsWritten}dimensions{databaseId date}}
  d1s:d1StorageAdaptiveGroups(limit:5000,filter:{date_geq:$k,date_leq:$e}){max{databaseSizeBytes}dimensions{databaseId date}}
  r2o:r2OperationsAdaptiveGroups(limit:5000,filter:{date_geq:$s,date_leq:$e}){sum{requests}dimensions{actionType bucketName date}}
  r2s:r2StorageAdaptiveGroups(limit:5000,filter:{date_geq:$k,date_leq:$e}){max{payloadSize metadataSize objectCount}dimensions{bucketName date}}
  q:d1QueriesAdaptiveGroups(limit:15,filter:{date_geq:$k,date_leq:$e},orderBy:[sum_rowsRead_DESC]){count sum{rowsRead rowsWritten queryDurationMs}dimensions{query databaseId}}
}}}`;

/** Nama database D1 (butuh izin D1: Read); gagal = tampil ID saja */
async function namaD1(env: Env): Promise<Record<string, string>> {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database?per_page=100`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
    const j = (await r.json()) as { result?: { uuid: string; name: string }[] };
    return Object.fromEntries((j.result ?? []).map(d => [d.uuid, d.name]));
  } catch { return {}; }
}

// Cache singkat per isolate supaya buka-tutup halaman tidak membanjiri API Cloudflare
let cache: { t: number; data: unknown } | null = null;
const UMUR_CACHE = 5 * 60_000;

cloudflare.get("/", async c => {
  const env = c.env;
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID)
    return c.json({ belum: true, error: "Secret CF_API_TOKEN atau var CF_ACCOUNT_ID belum di-set" });
  if (cache && Date.now() - cache.t < UMUR_CACHE && c.req.query("segar") !== "1") return c.json(cache.data);

  // Tanggal mengikuti UTC (dimensi date GraphQL); periode tagihan dihitung per bulan kalender
  const kini = new Date(), hari = tgl(kini);
  const awalBulan = hari.slice(0, 8) + "01";
  const hariKe = kini.getUTCDate(), jmlHari = new Date(Date.UTC(kini.getUTCFullYear(), kini.getUTCMonth() + 1, 0)).getUTCDate();
  const tigaPuluh = tgl(new Date(kini.getTime() - 29 * 86400_000));
  const dari = tigaPuluh < awalBulan ? tigaPuluh : awalBulan;
  const kemarin = tgl(new Date(kini.getTime() - 86400_000));
  // Porsi bulan yang sudah lewat (jam berjalan ikut dihitung) untuk proyeksi akhir bulan
  const porsi = (hariKe - 1 + (kini.getUTCHours() * 60 + kini.getUTCMinutes()) / 1440) / jmlHari;

  let a: Akun, nama: Record<string, string>;
  try {
    [a, nama] = await Promise.all([gql<Akun>(env, QUERY, { a: env.CF_ACCOUNT_ID, s: dari, e: hari, k: kemarin }), namaD1(env)]);
  } catch (e) { return c.json({ error: String(e instanceof Error ? e.message : e) }, 502); }
  const nmDb = (id: string) => nama[id] ?? id.slice(0, 8);

  // --- Deret harian per Worker / database / bucket (30 hari terakhir + sejak awal bulan)
  const tanggal: string[] = [];
  for (let t = new Date(dari + "T00:00:00Z"); tgl(t) <= hari; t = new Date(t.getTime() + 86400_000)) tanggal.push(tgl(t));
  const idx = new Map(tanggal.map((t, i) => [t, i]));
  const deret = () => tanggal.map(() => 0);

  const worker = new Map<string, { req: number[]; cpu: number[]; err: number; sub: number }>();
  for (const r of a.w) {
    const k = r.dimensions.scriptName, i = idx.get(r.dimensions.date); if (i == null) continue;
    const w = worker.get(k) ?? { req: deret(), cpu: deret(), err: 0, sub: 0 }; worker.set(k, w);
    w.req[i] += r.sum.requests; w.cpu[i] += r.sum.cpuTimeUs / 1000;
    if (r.dimensions.date >= awalBulan) { w.err += r.sum.errors; w.sub += r.sum.subrequests; }
  }
  const db = new Map<string, { read: number[]; write: number[]; q: number }>();
  for (const r of a.d1) {
    const k = r.dimensions.databaseId, i = idx.get(r.dimensions.date); if (i == null) continue;
    const d = db.get(k) ?? { read: deret(), write: deret(), q: 0 }; db.set(k, d);
    d.read[i] += r.sum.rowsRead; d.write[i] += r.sum.rowsWritten;
    if (r.dimensions.date >= awalBulan) d.q += r.sum.readQueries + r.sum.writeQueries;
  }
  // Ukuran terakhir yang tercatat (hari ini, atau kemarin bila hari ini belum ada)
  const terakhir = <T extends { dimensions: { date: string } }>(rows: T[], kunci: (r: T) => string) => {
    const m = new Map<string, T>();
    for (const r of rows) { const k = kunci(r), p = m.get(k); if (!p || r.dimensions.date > p.dimensions.date) m.set(k, r); }
    return m;
  };
  const ukuranDb = terakhir(a.d1s, r => r.dimensions.databaseId);
  for (const k of ukuranDb.keys()) if (!db.has(k)) db.set(k, { read: deret(), write: deret(), q: 0 });
  const bucket = new Map<string, { a: number[]; b: number[] }>();
  for (const r of a.r2o) {
    const kls = kelasR2(r.dimensions.actionType), i = idx.get(r.dimensions.date); if (!kls || i == null) continue;
    const k = r.dimensions.bucketName || "(akun)";
    const b = bucket.get(k) ?? { a: deret(), b: deret() }; bucket.set(k, b);
    b[kls][i] += r.sum.requests;
  }
  const ukuranR2 = terakhir(a.r2s, r => r.dimensions.bucketName);
  for (const k of ukuranR2.keys()) if (!bucket.has(k)) bucket.set(k, { a: deret(), b: deret() });

  const iBulan = tanggal.indexOf(awalBulan), iHari = tanggal.length - 1;
  const mtd = (s: number[]) => s.slice(iBulan).reduce((x, y) => x + y, 0);
  /** Total harian seluruh Worker / database / bucket */
  const total = <T>(m: Map<string, T>, f: (v: T) => number[]) => tanggal.map((_, i) => [...m.values()].reduce((x, v) => x + f(v)[i], 0));

  // --- Pemakaian bulan ini vs kuota
  const harian: Partial<Record<Kunci, number[]>> = {
    workers_req: total(worker, w => w.req),
    workers_cpu: total(worker, w => w.cpu),
    // Tidak ada data event observability di GraphQL: minimal 1 event per request (ditambah tiap console.log)
    observability: total(worker, w => w.req),
    d1_read: total(db, d => d.read),
    d1_write: total(db, d => d.write),
    r2_a: total(bucket, b => b.a),
    r2_b: total(bucket, b => b.b),
  };
  // Ukuran saat ini (bukan akumulasi)
  const stok: Partial<Record<Kunci, number>> = {
    d1_storage: [...ukuranDb.values()].reduce((x, r) => x + r.max.databaseSizeBytes, 0),
    r2_storage: [...ukuranR2.values()].reduce((x, r) => x + r.max.payloadSize + r.max.metadataSize, 0),
  };
  // Proyeksi akhir bulan = sampai kemarin + hari ini (minimal laju) + laju × sisa hari; laju = rata-rata 3 hari penuh
  // terakhir supaya lonjakan cepat terlihat (proyeksi linear dari awal bulan baru bereaksi berhari-hari kemudian)
  const sisaHari = jmlHari - hariKe;
  const proyeksiDari = (s: number[]) => {
    const laju = s.slice(Math.max(0, iHari - 3), iHari).reduce((x, y) => x + y, 0) / Math.min(3, iHari);
    return mtd(s) - s[iHari] + Math.max(s[iHari], laju) + laju * sisaHari;
  };
  const kuota = (Object.keys(KUOTA) as Kunci[]).map(k => {
    const q = KUOTA[k], s = harian[k];
    const p = s ? mtd(s) : stok[k] ?? 0;
    const proyeksi = s ? proyeksiDari(s) : p;
    const biaya = Math.max(0, proyeksi - q.termasuk) / q.satuan * q.harga;
    return { kunci: k, nama: q.nama, unit: q.unit, termasuk: q.termasuk, harga: q.harga, satuan: q.satuan,
      pakai: p, proyeksi, persen: p / q.termasuk * 100, persen_proyeksi: proyeksi / q.termasuk * 100, biaya,
      estimasi: k === "observability" };
  });
  const biayaLebih = kuota.reduce((x, k) => x + k.biaya, 0);

  // --- Lonjakan: hari ini (berjalan) atau kemarin ≥ 3× median 7 hari sebelumnya
  const lonjak = (s: number[], min: number) => {
    const dasar = median(s.slice(Math.max(0, iHari - 8), iHari - 1));
    const kmrn = s[iHari - 1] ?? 0, ini = s[iHari] ?? 0, puncak = Math.max(kmrn, ini);
    return dasar > 0 && puncak >= 3 * dasar && puncak >= min ? { dasar, kemarin: kmrn, hari_ini: ini, kali: puncak / dasar } : null;
  };

  const peringatan: { tingkat: "bahaya" | "waspada"; judul: string; pesan: string; pemilik?: string }[] = [];
  for (const k of kuota) {
    if (k.persen >= 100) peringatan.push({ tingkat: "bahaya", judul: `${k.nama} sudah melewati kuota`,
      pesan: `Terpakai ${Math.round(k.persen)}% dari kuota bulan ini; perkiraan biaya lebih $${k.biaya.toFixed(2)}.` });
    else if (k.persen_proyeksi >= 100) peringatan.push({ tingkat: "bahaya", judul: `${k.nama} diperkirakan melewati kuota`,
      pesan: `Baru ${Math.round(k.persen)}%, tapi dengan laju sekarang akhir bulan mencapai ${Math.round(k.persen_proyeksi)}% (biaya lebih ±$${k.biaya.toFixed(2)}).` });
    else if (k.persen_proyeksi >= 70) peringatan.push({ tingkat: "waspada", judul: `${k.nama} mendekati kuota`,
      pesan: `Akhir bulan diperkirakan ${Math.round(k.persen_proyeksi)}% dari kuota.` });
  }

  const workers = [...worker].map(([nama, w]) => ({ nama, req: mtd(w.req), cpu_ms: mtd(w.cpu), err: w.err, sub: w.sub,
    req_kemarin: w.req[iHari - 1] ?? 0, req_hari_ini: w.req[iHari], lonjakan: lonjak(w.req, 100_000), harian: w.req }))
    .sort((x, y) => y.req - x.req);
  const databases = [...db].map(([id, d]) => ({ id, nama: nmDb(id), read: mtd(d.read), write: mtd(d.write), query: d.q,
    ukuran: ukuranDb.get(id)?.max.databaseSizeBytes ?? 0, read_kemarin: d.read[iHari - 1] ?? 0, read_hari_ini: d.read[iHari],
    lonjakan: lonjak(d.read, 100e6), harian: d.read }))
    .sort((x, y) => y.read - x.read);
  const buckets = [...bucket].map(([nama, b]) => ({ nama, a: mtd(b.a), b: mtd(b.b),
    ukuran: (ukuranR2.get(nama)?.max.payloadSize ?? 0) + (ukuranR2.get(nama)?.max.metadataSize ?? 0),
    objek: ukuranR2.get(nama)?.max.objectCount ?? 0, lonjakan: lonjak(b.b, 200_000) }))
    .filter(b => b.a + b.b + b.ukuran > 0)
    .sort((x, y) => y.b - x.b);

  for (const d of databases) if (d.lonjakan) peringatan.push({ tingkat: "bahaya", pemilik: d.nama, judul: `Lonjakan rows read di database ${d.nama}`,
    pesan: `${(d.lonjakan.kali).toFixed(1)}× dari biasanya (median 7 hari ${Math.round(d.lonjakan.dasar / 1e6)} juta/hari; kemarin ${Math.round(d.lonjakan.kemarin / 1e6)} juta, hari ini ${Math.round(d.lonjakan.hari_ini / 1e6)} juta). Cek query terboros di bawah.` });
  for (const w of workers) if (w.lonjakan) peringatan.push({ tingkat: "waspada", pemilik: w.nama, judul: `Lonjakan request di Worker ${w.nama}`,
    pesan: `${w.lonjakan.kali.toFixed(1)}× dari biasanya (median 7 hari ${Math.round(w.lonjakan.dasar).toLocaleString("id-ID")} request/hari).` });
  for (const b of buckets) if (b.lonjakan) peringatan.push({ tingkat: "waspada", pemilik: b.nama, judul: `Lonjakan baca R2 di bucket ${b.nama}`,
    pesan: `${b.lonjakan.kali.toFixed(1)}× dari biasanya (median 7 hari ${Math.round(b.lonjakan.dasar).toLocaleString("id-ID")} operasi/hari).` });
  peringatan.sort((x, y) => (x.tingkat === y.tingkat ? 0 : x.tingkat === "bahaya" ? -1 : 1));

  const query_boros = a.q.map(r => ({ database: nmDb(r.dimensions.databaseId), query: r.dimensions.query, jalan: r.count,
    rows_read: r.sum.rowsRead, rata_rows: r.count ? r.sum.rowsRead / r.count : 0, rows_written: r.sum.rowsWritten,
    durasi_ms: r.sum.queryDurationMs }));

  const data = {
    diperbarui: kini.toISOString(), periode: { dari: awalBulan, sampai: hari, hari_ke: hariKe, jumlah_hari: jmlHari, porsi },
    query_sejak: kemarin, tanggal, biaya_dasar: BIAYA_DASAR, biaya_lebih: biayaLebih, tagihan_proyeksi: BIAYA_DASAR + biayaLebih,
    kuota, peringatan, workers, databases, buckets, query_boros,
  };
  cache = { t: Date.now(), data };
  return c.json(data);
});
