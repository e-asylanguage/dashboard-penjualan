/**
 * Laporan › Summary: tabel spending, result, omzet, revenue, ROAS & ROI per kanal marketing (Meta, CPAS, Shopee, TikTok Shop) + TOTAL.
 * Data: /api/laporan/summary (rumus di src/routes/summary.ts).
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta rentang() dari script utama (window.*).
 * Dipanggil dari script utama: loadSummary() (menu Summary).
 */
let sumData=null,sumBusy=false;
async function loadSummary(){
  if(sumBusy)return;sumBusy=true;
  try{const r=rentang('sumRange');sumData=await api('/api/laporan/summary?'+new URLSearchParams({from:r.from,to:r.to}));renderSummary()}
  catch(e){$('sumIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{sumBusy=false}
}
/** Kolom TOTAL: jumlah semua kanal (real / transaksi / revenue hanya dari kanal yang punya angkanya) */
function sumTotal(k){
  const jml=f=>k.reduce((a,x)=>a+(x[f]||0),0),ada=f=>k.some(x=>x[f]!=null);
  return {key:'total',label:'TOTAL',spend:jml('spend'),dashboard:jml('dashboard'),real:ada('real')?jml('real'):null,transaksi:ada('transaksi')?jml('transaksi'):null,
    omzet:jml('omzet'),revenue:ada('revenue')?jml('revenue'):null,ket:'Jumlah semua kanal',kurang:k.some(x=>x.revenue==null&&x.omzet)};
}
/** Kanal yang real result / transaksi-nya diperkirakan dari rasio pesanan toko */
const sumPerkiraan=x=>/^shp_\d+$|^tt_ads$|^tt_live$/.test(x.key)||(x.key==='shp_live');
const sumNet=x=>x.revenue==null?null:x.revenue-x.spend;
const SUM_BARIS=[
  ['Spending + tax',x=>x.spend,'rp'],
  ['Result dashboard',x=>x.dashboard,'n'],
  ['Real result',x=>x.real,'n~'],
  ['CPR',x=>x.real?x.spend/x.real:null,'rp'],
  ['Total transaksi',x=>x.transaksi,'n~'],
  ['Omzet',x=>x.omzet,'rp'],
  ['Total revenue',x=>x.revenue,'rp'],
  ['Net revenue',sumNet,'rp'],
  ['ROAS',x=>x.spend?x.omzet/x.spend:null,'x'],
  ['ROI',x=>{const n=sumNet(x);return x.spend&&n!=null?100*n/x.spend:null},'%'],
];
function sumSel(v,jenis,x){
  if(v==null||!Number.isFinite(v))return '<span style="color:var(--muted)">—</span>';
  if(jenis==='rp')return '<span class="'+(v<0?'lr-neg':'')+'">'+rpFull(v)+'</span>';
  if(jenis==='x')return nf2.format(v)+'×';
  if(jenis==='%')return '<span class="'+(v<0?'lr-neg':'')+'">'+pct(v)+'</span>';
  const r=Math.round(v);return (jenis==='n~'&&sumPerkiraan(x)&&v!==r?'≈ ':'')+int(r);
}
function renderSummary(){
  const d=sumData,k=d.kanal||[],t=sumTotal(k),kol=[...k,t],net=sumNet(t);
  put('sumPeriod','Meta, Shopee & TikTok Shop per kanal · '+fmtRange(d.from,d.to)+' · menurut tanggal pesanan dibuat / iklan tayang');
  put('sumK1',rpFull(t.spend));put('sumK1D',k.filter(x=>x.spend).sort((a,b)=>b.spend-a.spend).slice(0,3).map(x=>x.label+' '+lpPct(x.spend,t.spend)).join(' · ')||'belum ada spending');
  put('sumK2',rpFull(t.omzet));put('sumK2D',t.spend?'ROAS '+nf2.format(t.omzet/t.spend)+'× · '+int(Math.round(t.real||0))+' real result':'—');
  put('sumK3',net==null?'—':rpFull(net));put('sumK3D',t.revenue==null?'—':'Total revenue '+rpFull(t.revenue)+' − spending'+(t.kurang?' · sebagian kanal belum ada acuan potongan & HPP':''));
  put('sumK4',t.spend&&net!=null?pct(100*net/t.spend):'—');put('sumK4D',t.spend&&net!=null?(net>=0?'untung ':'rugi ')+rpFull(Math.abs(net))+' dari spending '+rpFull(t.spend):'—');
  $('sumIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Keterangan</th>'+
    kol.map(x=>'<th class="n'+(x.key==='total'?' lr-tot':'')+'" title="'+esc(x.ket)+'">'+esc(x.label)+'</th>').join('')+'</tr></thead><tbody>'+
    SUM_BARIS.map(([nama,f,jenis])=>'<tr class="'+(nama==='Net revenue'?'lr-akhir':'lr-pos')+'"><td class="lr-nm">'+esc(nama)+'</td>'+
      kol.map(x=>'<td class="n'+(x.key==='total'?' lr-tot':'')+'">'+sumSel(f(x),jenis,x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
$('sumRange').addEventListener('click',e=>{if(e.target.closest('button'))loadSummary()});
$('sumExport').addEventListener('click',()=>{
  if(!sumData)return;const k=sumData.kanal||[],kol=[...k,sumTotal(k)];
  unduhCsv('summary-kanal-'+sumData.from+'_'+sumData.to+'.csv',['Keterangan',...kol.map(x=>x.label)],
    SUM_BARIS.map(([nama,f,jenis])=>[nama,...kol.map(x=>{const v=f(x);return v==null||!Number.isFinite(v)?'':jenis==='x'?v.toFixed(2):jenis==='%'?v.toFixed(2):Math.round(v)})]));
});
