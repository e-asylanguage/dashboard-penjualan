/**
 * Laporan › Laba Rugi: per bulan & per platform menurut tanggal paket Mengantar selesai / dana dilepas, ekspor CSV & Excel. Data: /api/laporan/laba-rugi.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, laporan-bersama.js, serta spMuatXlsx() dari script utama (window.*).
 * Dipanggil dari script utama: loadLabaRugi().
 */
let lrData=null,lrBusy=false;
// Iklan lain (campaign tanpa order Scalev) tidak dihitung, sama dengan Ringkasan — hanya disebut di catatan
const LR_JUAL=['iklan','ongkir_kirim','ongkir_rts','gudang_rts','cod_fee','scalev_fee'];
const LR_PLAT=[['scalev','Scalev / website'],['shopee','Shopee'],['tiktok','TikTok Shop']];
/** Per platform: penjualan, HPP (termasuk kerugian barang), biaya penjualan & marketing, iklan */
const LR_F={
  scalev:{jual:m=>m.pendapatan,hpp:m=>m.hpp+m.rugi_barang-m.kompensasi,biaya:m=>LR_JUAL.reduce((a,k)=>a+(m[k]||0),0),iklan:m=>m.iklan},
  shopee:{jual:m=>m.shp_jual,hpp:m=>m.shp_hpp,biaya:m=>m.shp_iklan+(m.shp_sampel||0)+m.shp_biaya+m.shp_ongkir,iklan:m=>m.shp_iklan},
  tiktok:{jual:m=>m.tt_jual,hpp:m=>m.tt_hpp,biaya:m=>m.tt_iklan+m.tt_biaya+m.tt_ongkir-m.tt_peny,iklan:m=>m.tt_iklan},
};
const lrPilih=()=>{const v=$('lrPlat').value;return v?[v]:LR_PLAT.map(x=>x[0])};
const lrSum=(k,m,pl)=>pl.reduce((a,x)=>a+(LR_F[x][k](m)||0),0);
const lrPenj=(m,pl)=>lrSum('jual',m,pl||lrPilih());
const lrKotor=(m,pl)=>{pl=pl||lrPilih();return lrSum('jual',m,pl)-lrSum('hpp',m,pl)};
const lrJual=(m,pl)=>lrSum('biaya',m,pl||lrPilih());
const lrBersih=(m,pl)=>lrKotor(m,pl)-lrJual(m,pl);
async function loadLabaRugi(){
  if(lrBusy)return;lrBusy=true;
  try{lrData=await api('/api/laporan/laba-rugi?'+lpQuery('lrPer','lrSampai'));renderLabaRugi()}
  catch(e){$('lrIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{lrBusy=false}
}
/** Baris laporan untuk platform yang dipilih; banyak platform → tiap pos diberi nama platformnya + total penjualan */
function lrBaris(){
  const pl=lrPilih(),ada=x=>pl.includes(x),banyak=pl.length>1,nm=(n,x)=>banyak?n+' '+x:n;
  const persen=(f,dasar)=>m=>dasar(m)?lpPct(f(m),dasar(m))+' dari penjualan':'';
  const b=[['judul','Pendapatan']];
  if(ada('scalev'))b.push(['pos',nm('Penjualan','Scalev / website'),m=>m.pendapatan,1,m=>int(m.paket_kirim)+' paket terkirim']);
  if(ada('shopee'))b.push(['pos',nm('Penjualan','Shopee'),m=>m.shp_jual,1,m=>int(m.shp_n)+' pesanan dana dilepas']);
  if(ada('tiktok'))b.push(['pos',nm('Penjualan','TikTok Shop'),m=>m.tt_jual,1,m=>int(m.tt_n)+' pesanan dana dilepas']);
  if(banyak)b.push(['sub','Total penjualan',m=>lrPenj(m,pl),0,()=>'']);
  b.push(['judul','Harga pokok penjualan']);
  if(ada('scalev'))b.push(['pos',nm('HPP','Scalev / website'),m=>m.hpp,-1],['pos','Kerugian barang retur rusak / hilang',m=>m.rugi_barang,-1],
    ['pos','Kompensasi barang dari Mengantar',m=>m.kompensasi,1]);
  if(ada('shopee'))b.push(['pos',nm('HPP','Shopee'),m=>m.shp_hpp,-1]);
  if(ada('tiktok'))b.push(['pos',nm('HPP','TikTok Shop'),m=>m.tt_hpp,-1]);
  b.push(['sub','Laba kotor',m=>lrKotor(m,pl),0],['judul','Biaya penjualan & marketing']);
  if(ada('scalev'))b.push(['pos','Iklan Meta',m=>m.iklan,-1,persen(m=>m.iklan,m=>m.pendapatan),banyak?'dibanding penjualan Scalev':''],
    ['pos','Ongkir paket terkirim',m=>m.ongkir_kirim,-1],
    ['pos','Ongkir retur (RTS)',m=>m.ongkir_rts,-1,m=>int(m.paket_rts+m.paket_hilang)+' paket retur / hilang'],
    ['pos','Biaya gudang paket retur',m=>m.gudang_rts,-1],['pos','COD fee',m=>m.cod_fee,-1],['pos','Scalev fee',m=>m.scalev_fee,-1]);
  if(ada('shopee'))b.push(['pos','Iklan Shopee',m=>m.shp_iklan,-1,persen(m=>m.shp_iklan,m=>m.shp_jual),banyak?'dibanding penjualan Shopee':''],
    ['pos','Sampel affiliate Shopee',m=>m.shp_sampel||0,-1,'','HPP + ongkir sampel produk gratis untuk affiliate · dicatat di Shopee › Iklan'],
    ['pos','Biaya Shopee',m=>m.shp_biaya,-1,persen(m=>m.shp_biaya,m=>m.shp_jual),'admin, layanan, Gratis Ongkir XTRA, promosi, pajak'],
    ['pos','Ongkir Shopee',m=>m.shp_ongkir,-1]);
  if(ada('tiktok'))b.push(['pos','Iklan TikTok',m=>m.tt_iklan,-1,persen(m=>m.tt_iklan,m=>m.tt_jual),banyak?'dibanding penjualan TikTok':''],
    ['pos','Biaya TikTok',m=>m.tt_biaya,-1,persen(m=>m.tt_biaya,m=>m.tt_jual),'komisi, layanan, afiliasi, pajak'],
    ['pos','Ongkir TikTok',m=>m.tt_ongkir,-1],['pos','Penyesuaian TikTok',m=>-m.tt_peny,-1]);
  b.push(['akhir','Laba bersih',m=>lrBersih(m,pl),0]);
  return b;
}
/** Tabel ringkas laba per platform untuk total periode */
function lrPerPlatform(t){
  const kol=LR_PLAT.map(([k,l])=>({l,pl:[k]})).concat([{l:'Total',pl:LR_PLAT.map(x=>x[0])}]);
  const baris=[['Penjualan',(m,pl)=>lrPenj(m,pl),1],['HPP',(m,pl)=>lrSum('hpp',m,pl),-1],['Laba kotor',lrKotor,0,1],
    ['Iklan',(m,pl)=>lrSum('iklan',m,pl),-1],['Biaya penjualan & marketing (termasuk iklan)',lrJual,-1],['Laba bersih',lrBersih,0,1]];
  return '<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pos</th>'+kol.map((k,i)=>'<th class="n'+(i===kol.length-1?' lr-tot':'')+'">'+esc(k.l)+'</th>').join('')+'</tr></thead><tbody>'+
    baris.map(([n,f,tanda,margin])=>'<tr class="lr-'+(n==='Laba bersih'?'akhir':margin?'sub':'pos')+'"><td class="lr-nm">'+esc(n)+'</td>'+kol.map((k,i)=>{
      const v=f(t,k.pl),j=lrPenj(t,k.pl);
      return '<td class="n'+(i===kol.length-1?' lr-tot':'')+'">'+lpRp(v,tanda)+(margin&&j?'<small>margin '+lpPct(v,j)+'</small>':'')+'</td>'}).join('')+'</tr>').join('')+'</tbody></table>';
}
function renderLabaRugi(){
  const d=lrData,t=lpTotal(d.rows),kol=[...d.rows,t],pl=lrPilih(),ada=x=>pl.includes(x),jual=lrPenj(t,pl),mp=d.marketplace||{};
  const nmPlat=$('lrPlat').value?$('lrPlat').selectedOptions[0].textContent:'Semua platform';
  put('lrPeriod',nmPlat+' · per bulan · '+lpBulanPanjang(d.bulan[0])+(d.bulan.length>1?' – '+lpBulanPanjang(d.bulan[d.bulan.length-1]):''));
  put('lrK1',rpFull(jual));
  put('lrK1D',pl.length>1?LR_PLAT.map(([k,l])=>l.split(' ')[0]+' '+lpPct(lrPenj(t,[k]),jual)).join(' · '):
    ada('scalev')?int(t.paket_kirim)+' paket terkirim · '+int(t.paket_rts+t.paket_hilang)+' retur / hilang':int(ada('shopee')?t.shp_n:t.tt_n)+' pesanan dana dilepas');
  put('lrK2',rpFull(lrKotor(t,pl)));put('lrK2D','margin kotor '+lpPct(lrKotor(t,pl),jual));
  put('lrK3',rpFull(lrJual(t,pl)));put('lrK3D','iklan '+lpPct(lrSum('iklan',t,pl),jual)+' dari penjualan · sisanya ongkir, fee, dan potongan marketplace');
  $('lrK4').innerHTML=lpRp(lrBersih(t,pl),0);put('lrK4D','margin bersih '+lpPct(lrBersih(t,pl),jual)+' · belum termasuk gaji, sewa, dan biaya rutin lain');
  const w=[],mulai=d.data_mulai,akhir=d.bulan[d.bulan.length-1];
  if(ada('scalev')&&mulai&&d.bulan[0]<mulai.slice(0,7))w.push('Data paket Mengantar baru tersedia sejak '+esc(tglWib(mulai+'T12:00:00Z'))+' — bulan sebelumnya belum lengkap.');
  if(d.bulan.includes(lpKini()))w.push('Bulan '+esc(lpBulanLbl(lpKini()))+' masih berjalan: paket yang belum selesai dan dana marketplace yang belum dilepas belum masuk penjualan, sementara iklannya sudah terhitung.');
  // Data marketplace: kapan mulai & sampai kapan ada di dashboard
  [['shopee','Shopee',mp.shp_mulai,mp.shp_sampai,'shp'],['tiktok','TikTok',mp.tt_mulai,mp.tt_sampai,'tt']].forEach(([k,l,a,b,p])=>{
    if(!ada(k))return;
    if(!a){w.push('Belum ada data Penghasilan '+l+' — upload / sinkron di menu '+l+' › Penghasilan supaya penjualannya masuk.');return}
    if(d.bulan[0]<a.slice(0,7))w.push('Data Penghasilan '+l+' baru tersedia sejak '+esc(tglWib(a+'T12:00:00Z'))+' — bulan sebelumnya belum lengkap.');
    if(b<ymd(new Date())&&b.slice(0,7)<=akhir)w.push('Data Penghasilan '+l+' baru sampai '+esc(tglWib(b+'T12:00:00Z'))+' — dana yang dilepas sesudahnya belum masuk.');
    if(t[p+'_hpp_kurang'])w.push(int(t[p+'_hpp_kurang'])+' pesanan '+l+' belum punya HPP (file Pesanan belum di-upload atau SKU-nya belum ada di Manajemen SKU) — HPP-nya dihitung 0.');
  });
  if(ada('tiktok')&&mp.tt_mulai&&!mp.tt_iklan_sampai)w.push('Belum ada data iklan TikTok — biaya iklan TikTok dihitung 0 sampai data iklannya di-upload / disinkron.');
  if(ada('scalev')&&t.iklan_luar)w.push('Spend '+rpFull(t.iklan_luar)+' dari campaign yang tidak menghasilkan order Scalev di periode ini (mis. iklan toko / aplikasi lain, atau campaign tanpa order) <b>tidak dihitung</b>.');
  if(ada('scalev')&&t.hpp_kurang)w.push(int(t.hpp_kurang)+' paket belum punya HPP (SKU varian Scalev belum ada / belum ber-HPP di Manajemen SKU, atau paket tanpa order Scalev belum dipasangkan di SKU Mengantar) — HPP-nya dihitung 0, jadi laba terlihat lebih besar.');
  if(ada('scalev')&&t.ongkir_estimasi)w.push(int(t.ongkir_estimasi)+' paket ongkirnya belum dipotong di saldo Mengantar — memakai tarif (perkiraan).');
  if(ada('scalev')&&t.tanpa_order)w.push(int(t.tanpa_order)+' paket COD terkirim tanpa order Scalev — penjualannya memakai nilai COD, HPP dari SKU Mengantar.');
  if(ada('scalev')&&t.tanpa_order_noncod)w.push(int(t.tanpa_order_noncod)+' paket non-COD tanpa order Scalev (mis. kirim sampel / pindah gudang) — hanya ongkirnya yang dihitung sebagai biaya.');
  $('lrWarn').hidden=!w.length;$('lrWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  $('lrIsi').innerHTML=lpTabel(lrBaris(),kol,m=>lrPenj(m,pl));
  $('lrPlatIsi').innerHTML=lrPerPlatform(t);
}
['lrPer','lrSampai'].forEach(id=>$(id).addEventListener('change',loadLabaRugi));
$('lrPlat').addEventListener('change',()=>{if(lrData)renderLabaRugi()});
$('lrExport').addEventListener('click',()=>{if(lrData)lpCsv('laba-rugi-'+($('lrPlat').value||'semua')+'-'+lrData.bulan[0]+'_'+lrData.bulan[lrData.bulan.length-1]+'.csv',lrBaris(),[...lrData.rows,lpTotal(lrData.rows)])});

/** Ekspor Excel: sheet "Laba Rugi" (per bulan + total, dengan judul bagian) dan sheet "Per Platform" */
$('lrXlsx').addEventListener('click',async()=>{
  if(!lrData)return;const btn=$('lrXlsx');btn.disabled=true;
  try{
    const X=await spMuatXlsx(),d=lrData,t=lpTotal(d.rows),kol=[...d.rows,t],pl=lrPilih();
    const nmPlat=$('lrPlat').value?$('lrPlat').selectedOptions[0].textContent:'Semua platform';
    const periode=lpBulanPanjang(d.bulan[0])+(d.bulan.length>1?' – '+lpBulanPanjang(d.bulan[d.bulan.length-1]):'');
    const rp=v=>Math.round(v||0);
    // Sheet 1: laporan laba rugi, pos biaya bertanda minus, plus kolom % dari penjualan total
    const a1=[['Laporan Laba Rugi'],[nmPlat+' · '+periode],[],
      ['Pos',...d.rows.map(m=>lpBulanLbl(m.bulan)),'Total','% dari penjualan']];
    const jualT=lrPenj(t,pl);
    lrBaris().forEach(([jenis,n,f,tanda])=>{
      if(jenis==='judul'){a1.push([n]);return}
      const v=kol.map(m=>rp(f(m))*(tanda<0?-1:1));
      a1.push([jenis==='pos'?'   '+n:n,...v,jualT?v[v.length-1]/jualT:null]);
    });
    const s1=X.utils.aoa_to_sheet(a1),nk=kol.length;
    // Sheet 2: laba per platform (total periode)
    const kp=LR_PLAT.map(([k,l])=>({l,pl:[k]})).concat([{l:'Total',pl:LR_PLAT.map(x=>x[0])}]);
    const a2=[['Laba per Platform'],[periode],[],['Pos',...kp.map(k=>k.l)],
      ['Penjualan',...kp.map(k=>rp(lrPenj(t,k.pl)))],['HPP',...kp.map(k=>-rp(lrSum('hpp',t,k.pl)))],
      ['Laba kotor',...kp.map(k=>rp(lrKotor(t,k.pl)))],['Iklan',...kp.map(k=>-rp(lrSum('iklan',t,k.pl)))],
      ['Biaya penjualan & marketing (termasuk iklan)',...kp.map(k=>-rp(lrJual(t,k.pl)))],
      ['Laba bersih',...kp.map(k=>rp(lrBersih(t,k.pl)))],
      ['Margin bersih',...kp.map(k=>{const j=lrPenj(t,k.pl);return j?lrBersih(t,k.pl)/j:null})]];
    const s2=X.utils.aoa_to_sheet(a2);
    // Format angka: rupiah tanpa desimal (minus dalam kurung), persen 1 desimal
    const fmt=(ws,dariBaris,kolom,z)=>{const r=X.utils.decode_range(ws['!ref']);
      for(let R=dariBaris;R<=r.e.r;R++)kolom.forEach(C=>{const c=ws[X.utils.encode_cell({r:R,c:C})];if(c&&c.t==='n')c.z=z})};
    const RP='#,##0;(#,##0);-',PCT='0.0%';
    fmt(s1,4,Array.from({length:nk},(_,i)=>i+1),RP);fmt(s1,4,[nk+1],PCT);
    fmt(s2,4,kp.map((_,i)=>i+1),RP);
    kp.forEach((_,i)=>{const c=s2[X.utils.encode_cell({r:a2.length-1,c:i+1})];if(c&&c.t==='n')c.z=PCT});
    s1['!cols']=[{wch:44},...kol.map(()=>({wch:16})),{wch:16}];
    s2['!cols']=[{wch:44},...kp.map(()=>({wch:18}))];
    const wb=X.utils.book_new();X.utils.book_append_sheet(wb,s1,'Laba Rugi');X.utils.book_append_sheet(wb,s2,'Per Platform');
    X.writeFile(wb,'laba-rugi-'+($('lrPlat').value||'semua')+'-'+d.bulan[0]+'_'+d.bulan[d.bulan.length-1]+'.xlsx');
  }catch(e){alert('Gagal membuat file Excel: '+e.message)}
  finally{btn.disabled=false}
});
