/**
 * Kode bersama halaman Laporan (Laba Rugi, Margin Produk, Arus Kas): label bulan, query periode, kolom total, tabel & CSV laporan.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js. Dimuat sebelum file laporan lain.
 */
const lpTgl=b=>new Date(b+'-01T00:00:00Z');
const lpBulanLbl=b=>new Intl.DateTimeFormat('id-ID',{month:'short',year:'numeric',timeZone:'UTC'}).format(lpTgl(b));
const lpBulanPanjang=b=>new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(lpTgl(b));
const lpGeser=(b,n)=>new Date(Date.UTC(+b.slice(0,4),+b.slice(5,7)-1+n,1)).toISOString().slice(0,7);
const lpKini=()=>ymd(new Date()).slice(0,7);
/** Rupiah bertanda: tanda −1 = biaya ("− Rp …", merah), 0 = hasil (merah bila minus), nol abu-abu */
/** Query ?dari&sampai dari pilihan periode (n bulan) dan bulan terakhir */
function lpQuery(per,sampai){const s=$(sampai).value||lpKini();$(sampai).value=s;return 'dari='+lpGeser(s,1-Number($(per).value||3))+'&sampai='+s}
/** Kolom total: jumlah semua angka per bulan */
function lpTotal(rows){
  const t={bulan:'total'};
  for(const m of rows){for(const k in m)if(typeof m[k]==='number')t[k]=(t[k]||0)+m[k]}
  return t;
}
/**
 * Tabel laporan: baris [jenis, nama, nilai(m), tanda, catatan(m)?, keterangan?]; jenis judul | pos | sub | akhir.
 * Kolom = tiap bulan + total. Baris sub / akhir diberi persen terhadap dasar(m) (mis. penjualan).
 */
function lpTabel(baris,kol,dasar){
  const n=kol.length,cls=i=>'n'+(i===n-1?' lr-tot':'');
  return '<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pos</th>'+kol.map((m,i)=>'<th class="'+cls(i)+'">'+(i===n-1?'Total':lpBulanLbl(m.bulan))+'</th>').join('')+'</tr></thead><tbody>'+
    baris.map(([jenis,nama,f,tanda,cat,ket])=>jenis==='judul'?'<tr class="lr-judul"><td colspan="'+(n+1)+'">'+esc(nama)+'</td></tr>':
      '<tr class="lr-'+jenis+'"><td class="lr-nm">'+esc(nama)+(ket?'<small>'+esc(ket)+'</small>':'')+'</td>'+kol.map((m,i)=>{
        const v=f(m),kecil=cat?cat(m):jenis!=='pos'&&dasar&&dasar(m)?lpPct(v,dasar(m))+' dari penjualan':'';
        return '<td class="'+cls(i)+'">'+lpRp(v,tanda)+(kecil?'<small>'+kecil+'</small>':'')+'</td>'}).join('')+'</tr>').join('')+'</tbody></table>';
}
function lpCsv(nama,baris,kol){
  unduhCsv(nama,['Pos',...kol.map((m,i)=>i===kol.length-1?'Total':m.bulan)],
    baris.filter(b=>b[0]!=='judul').map(([,n,f,tanda])=>[n,...kol.map(m=>Math.round(f(m)||0)*(tanda<0?-1:1))]));
}
