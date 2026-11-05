/**
 * Laporan › Margin Produk: margin produk & contribution margin per gabungan produk (pos sama dengan Laba Rugi), grafik, ekspor CSV. Data: /api/laporan/margin-produk.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, laporan-bersama.js, serta rentang() dari script utama (window.*).
 * Dipanggil dari script utama: loadMarginProduk().
 */
let mpData=null,mpBusy=false,mpChart=null;
const mpOngkir=m=>m.ongkir_kirim+m.ongkir_rts+m.gudang_rts+m.rugi_barang-m.kompensasi,mpFee=m=>m.cod_fee+m.scalev_fee;
const mpMargin=m=>m.pendapatan-m.hpp,mpCm=m=>mpMargin(m)-mpOngkir(m)-mpFee(m)-m.iklan;
const mpKhusus=n=>n.startsWith('(');
async function loadMarginProduk(){
  if(mpBusy)return;mpBusy=true;
  try{const r=rentang('mpRange');mpData=await api('/api/laporan/margin-produk?from='+r.from+'&to='+r.to);renderMarginProduk()}
  catch(e){$('mpIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{mpBusy=false}
}
function mpBaris(){
  // Produk berisi data dulu (urut penjualan), baris khusus (belum dikelompokkan / tanpa order) di bawah
  const isi=m=>['pendapatan','hpp','iklan','ongkir_kirim','ongkir_rts','paket_kirim','paket_rts'].some(k=>m[k]);
  const rows=mpData.rows.filter(isi);
  return rows.filter(m=>!mpKhusus(m.nama)).sort((a,b)=>b.pendapatan-a.pendapatan).concat(rows.filter(m=>mpKhusus(m.nama)));
}
function renderMarginProduk(){
  const d=mpData,rows=mpBaris(),t=lpTotal(rows);
  put('mpPeriod','Per gabungan produk menurut tanggal paket selesai · '+fmtRange(d.from,d.to)+' · '+int(t.paket_kirim||0)+' paket terkirim');
  const pj=t.pendapatan||0;
  put('mpK1',rpFull(pj));put('mpK1D',int(t.paket_kirim||0)+' paket terkirim · '+int(t.pcs||0)+' pcs dari order Scalev');
  $('mpK2').innerHTML=lpRp(mpMargin(t),0);put('mpK2D',lpPct(mpMargin(t),pj)+' dari penjualan · setelah HPP');
  $('mpK3').innerHTML=lpRp(mpCm(t),0);put('mpK3D',lpPct(mpCm(t),pj)+' dari penjualan · setelah semua biaya variabel');
  $('mpK4').innerHTML=t.paket_kirim?lpRp(mpCm(t)/t.paket_kirim,0):'—';put('mpK4D',t.paket_kirim?'margin produk '+rpFull(mpMargin(t)/t.paket_kirim)+' / paket':'—');
  const w=[],belum=rows.find(m=>m.nama==='(belum dikelompokkan)'),tanpa=rows.find(m=>m.nama==='(paket tanpa order Scalev)');
  if(d.to>=ymd(new Date()))w.push('Periode masih berjalan: paket yang belum selesai belum masuk penjualan, sementara iklannya sudah terhitung — contribution margin bisa terlihat lebih kecil.');
  if(t.hpp_kurang)w.push(int(t.hpp_kurang)+' paket belum punya HPP (SKU belum diatur) — HPP-nya dihitung 0, jadi margin terlihat lebih besar.');
  if(t.ongkir_estimasi)w.push(int(t.ongkir_estimasi)+' paket ongkirnya belum dipotong di saldo Mengantar — memakai tarif (perkiraan).');
  if(belum&&(belum.pendapatan||belum.iklan))w.push([belum.pendapatan?'<b>'+rpFull(belum.pendapatan)+'</b> penjualan':'',belum.iklan?'<b>'+rpFull(belum.iklan)+'</b> iklan':''].filter(Boolean).join(' dan ')+' belum masuk gabungan produk mana pun — atur di <b>Data Produk</b> (gabungan) atau beri kode gabungan di nama campaign.');
  if(tanpa&&tanpa.paket_kirim)w.push(int(tanpa.paket_kirim)+' paket terkirim tanpa order Scalev ('+rpFull(tanpa.pendapatan)+') tidak bisa dipasangkan ke produk — ditampilkan di baris sendiri.');
  $('mpWarn').hidden=!w.length;$('mpWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  const nm=m=>mpKhusus(m.nama)?'<span style="color:var(--muted)">'+esc(m.nama)+'</span>':esc(m.nama);
  const sel=(v,dasar,tanda)=>'<td class="n">'+lpRp(v,tanda)+(dasar&&v?'<small>'+lpPct(Math.abs(v),dasar)+'</small>':'')+'</td>';
  const tr=m=>'<tr><td class="nm">'+nm(m)+'</td><td class="n">'+int(m.paket_kirim)+(m.pcs?'<small>'+int(m.pcs)+' pcs</small>':'')+'</td>'+
    '<td class="n">'+rpFull(m.pendapatan)+'</td>'+sel(m.hpp,m.pendapatan,-1)+
    '<td class="n">'+lpRp(mpMargin(m),0)+'<small>'+lpPct(mpMargin(m),m.pendapatan)+'</small></td>'+
    sel(mpOngkir(m),m.pendapatan,-1)+sel(mpFee(m),m.pendapatan,-1)+sel(m.iklan,m.pendapatan,-1)+
    '<td class="n"><b>'+lpRp(mpCm(m),0)+'</b><small>'+lpPct(mpCm(m),m.pendapatan)+'</small></td>'+
    '<td class="n">'+(m.paket_kirim?lpRp(mpCm(m)/m.paket_kirim,0):'—')+'</td></tr>';
  $('mpIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Produk</th><th class="n">Paket terkirim</th><th class="n">Penjualan</th><th class="n">HPP</th><th class="n">Margin produk</th>'+
    '<th class="n">Ongkir &amp; retur</th><th class="n">Fee</th><th class="n">Iklan</th><th class="n">Contribution margin</th><th class="n">CM / paket</th></tr></thead><tbody>'+
    (rows.map(tr).join('')||'<tr><td colspan="10" style="color:var(--muted)">Belum ada paket selesai pada rentang ini.</td></tr>')+'</tbody>'+
    (rows.length?'<tfoot>'+tr(Object.assign({},t,{nama:'Total'})).replace('<tr>','<tr class="mp-tot">')+'</tfoot>':'')+'</table>';
  mpGambar(rows.filter(m=>m.pendapatan>0));
}
/** Batang 100% per produk: HPP, ongkir & retur, fee, iklan, sisa = contribution margin (minus → 0, angka asli di tooltip) */
function mpGambar(rows){
  if(typeof Chart==='undefined')return;
  $('mpChartWrap').style.height=Math.max(160,70+rows.length*42)+'px';
  const bag=[['HPP',m=>m.hpp,'--pb'],['Ongkir & retur',mpOngkir,'--bo'],['Fee',mpFee,'--info'],['Iklan',m=>m.iklan,'--spend'],['Contribution margin',m=>Math.max(0,mpCm(m)),'--rev']];
  const data={labels:rows.map(m=>m.nama),datasets:bag.map(([label,f,w])=>({label,data:rows.map(m=>100*f(m)/m.pendapatan),backgroundColor:css(w),borderRadius:2,stack:'s',barThickness:22}))};
  if(mpChart)mpChart.destroy();
  mpChart=new Chart($('mpChart'),{type:'bar',data,
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>{const m=rows[c.dataIndex],v=c.datasetIndex===4?mpCm(m):bag[c.datasetIndex][1](m);return ' '+c.dataset.label+': '+rpFull(v)+' ('+lpPct(v,m.pendapatan)+')'}}}},
      scales:{x:{stacked:true,grid:{color:css('--line')},border:{display:false},ticks:{callback:v=>v+'%'}},y:{stacked:true,grid:{display:false}}}}});
}
$('mpRange').addEventListener('click',e=>{if(e.target.closest('button'))loadMarginProduk()});
$('mpExport').addEventListener('click',()=>{
  if(!mpData)return;const rows=mpBaris();
  unduhCsv('margin-produk-'+mpData.from+'_'+mpData.to+'.csv',['Produk','Paket terkirim','Pcs','Penjualan','HPP','Margin produk','Margin produk (%)','Ongkir & retur','Fee','Iklan','Contribution margin','CM (%)','CM per paket'],
    rows.map(m=>[m.nama,m.paket_kirim,m.pcs,m.pendapatan,m.hpp,mpMargin(m),m.pendapatan?(100*mpMargin(m)/m.pendapatan).toFixed(1):'',mpOngkir(m),mpFee(m),m.iklan,mpCm(m),
      m.pendapatan?(100*mpCm(m)/m.pendapatan).toFixed(1):'',m.paket_kirim?Math.round(mpCm(m)/m.paket_kirim):'']));
});
