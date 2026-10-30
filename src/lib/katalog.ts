/**
 * Kelompok produk halaman Data Produk.
 *  PU   = Produk satuan (1 SKU)
 *  PB   = Bundling (≥2 SKU: beli banyak, beli X gratis Y, atau produk + bonus fisik)
 *  BO   = Bonus (tidak bisa ditebak dari data Scalev — dipilih manual)
 *  NONE = Belum ber-SKU / tanpa kategori
 * Pilihan manual (tabel product_categories) selalu menimpa tebakan di sini.
 */
export type Kategori = "PU" | "PB" | "BO" | "NONE";
export const KATEGORI: Kategori[] = ["PU", "PB", "BO", "NONE"];

export interface ItemKatalog {
  key: string;
  kind: string;               // variant | bundle | order (nama di order yang tidak ada di katalog)
  product_id: number | null;
  product_name: string | null;
  name: string;
  option_tail: string | null;
  sku: string | null;
  price: number | null;
  status?: string | null;
}

// "isi 30 pcs" / "isi 3" = isi kemasan, bukan jumlah SKU — dibuang sebelum pola jumlah dicek.
const ISI_KEMASAN = /\bisi\s*\d+\s*(pcs|botol|buku|pasang)?/g;
const POLA_BUNDLING = [
  /\b(beli|buy|bundling|paket|dapat|get|total)\s*([2-9]|[1-9]\d)\b/,  // Beli 2, Dapat 3 Botol, Total 3 Pcs
  /\bgratis\s*\d/, /\b\d+\s*gratis\b/,                                  // Beli 2 Gratis 1
  /\b([2-9]|[1-9]\d)\s*(pcs|botol|pasang|buku)\b/,                     // Haneva 2 Pcs, 12 Buku
  /\b(bonus|free|gratis|\+)\s*(\d+\s*)?(parfum|mushaf|cholesty|steva|cover)/, // produk + bonus barang fisik
];
const POLA_BONUS = /^(bonus|free|gratis)\b/;

/** Tebakan kategori dari data Scalev. */
export function kategoriOtomatis(it: ItemKatalog): Kategori {
  if (it.kind === "bundle") return "PB";
  if (!it.sku) return "NONE";
  const s = it.name.toLowerCase();
  if (POLA_BONUS.test(s) || it.price === 0) return "BO";
  const tanpaIsi = s.replace(ISI_KEMASAN, " ");
  if (POLA_BUNDLING.some(re => re.test(tanpaIsi))) return "PB";
  return "PU";
}

/**
 * Cocokkan nama produk di order (snapshot saat order dibuat) ke item katalog.
 * Nama varian bisa sudah diganti di Scalev, jadi urutannya:
 *  1. nama persis sama (dalam produk yang sama bila product_id order diketahui);
 *  2. nama order diakhiri opsi varian ("… - Beli 2 Gratis 1"), opsi terpanjang menang;
 *  3. produknya hanya punya satu varian aktif.
 * `productId` diambil dari follow_up_chats order (satu-satunya rujukan id produk di list order Scalev).
 */
export function cocokkan<T extends ItemKatalog>(nama: string, productId: number | null, perNama: Map<string, T[]>, perProduk: Map<number, T[]>): T | null {
  const calon = productId != null ? perProduk.get(productId) ?? [] : null;
  const sama = (perNama.get(nama) ?? []).filter(i => !calon || i.product_id === productId);
  if (sama.length) return sama[0];
  if (!calon || !calon.length) return null;
  let terbaik: T | null = null;
  for (const i of calon) {
    const t = i.option_tail;
    if (t && (nama === t || nama.endsWith(" - " + t)) && (!terbaik || t.length > (terbaik.option_tail ?? "").length)) terbaik = i;
  }
  if (terbaik) return terbaik;
  const aktif = calon.filter(i => i.status !== "deleted");
  return aktif.length === 1 ? aktif[0] : null;
}
