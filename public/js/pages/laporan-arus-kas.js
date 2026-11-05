/**
 * Laporan › Arus Kas: uang masuk dan keluar per bulan, ekspor CSV. Data: /api/laporan/arus-kas.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js & laporan-bersama.js.
 * Dipanggil dari script utama: loadArusKas().
 */
let akData=null,akBusy=false;
const akMasuk=m=>m.cair+m.transfer+m.shp_cair+m.tt_cair,akIklan=m=>m.iklan+m.shp_iklan+m.tt_iklan;
const akKeluar=m=>m.topup+akIklan(m)+m.supplier+m.ongkir_req,akBersih=m=>akMasuk(m)-akKeluar(m);
async function loadArusKas(){
  if(akBusy)return;akBusy=true;
  try{akData=await api('/api/laporan/arus-kas?'+lpQuery('akPer','akSampai'));renderArusKas()}
  catch(e){$('akIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{akBusy=false}
}
function akBaris(d){
  return [
    ['judul','Uang masuk'],
    ['pos','Pencairan COD Mengantar',m=>m.cair,1,m=>m.cair_n?int(m.cair_n)+'× pencairan':''],
    ['pos','Transfer pembeli (non-COD)',m=>m.transfer,1,m=>m.transfer_n?int(m.transfer_n)+' order lunas':''],
    ['pos','Dana Shopee dilepas',m=>m.shp_cair,1,m=>m.shp_cair_n?int(m.shp_cair_n)+' pesanan':''],
    ['pos','Dana TikTok Shop dilepas',m=>m.tt_cair,1,m=>m.tt_cair_n?int(m.tt_cair_n)+' pesanan':''],
    ['sub','Total uang masuk',akMasuk,1],
    ['judul','Uang keluar'],
    ['pos','Top up saldo Mengantar',m=>m.topup,-1],
    ['pos','Iklan Meta',m=>m.iklan,-1],
    ['pos','Iklan Shopee',m=>m.shp_iklan,-1,m=>m.shp_isi_iklan?rpFull(Math.min(m.shp_isi_iklan,m.shp_iklan_spend))+' sudah dipotong dari dana Shopee':''],
    ['pos','Iklan TikTok',m=>m.tt_iklan,-1],
    ['pos','Pembayaran supplier',m=>m.supplier,-1],
    ['pos','Ongkir barang masuk (REQ)',m=>m.ongkir_req,-1],
    ['sub','Total uang keluar',akKeluar,-1],
    ['akhir','Arus kas bersih',akBersih,0],
    ['pos','Kumulatif sejak awal periode',m=>m.kum,0],
  ];
}
function renderArusKas(){
  const d=akData;let kum=0;
  for(const m of d.rows){kum+=akBersih(m);m.kum=kum}
  const t=lpTotal(d.rows);t.kum=kum;
  put('akPeriod','Uang masuk dan keluar per bulan · '+lpBulanPanjang(d.bulan[0])+(d.bulan.length>1?' – '+lpBulanPanjang(d.bulan[d.bulan.length-1]):''));
  put('akK1',rpFull(akMasuk(t)));put('akK1D','COD + transfer '+lpPct(t.cair+t.transfer,akMasuk(t))+' · Shopee '+lpPct(t.shp_cair,akMasuk(t))+' · TikTok '+lpPct(t.tt_cair,akMasuk(t)));
  put('akK2',rpFull(akKeluar(t)));put('akK2D','iklan '+lpPct(akIklan(t),akKeluar(t))+' dari uang keluar');
  $('akK3').innerHTML=lpRp(akBersih(t),0);put('akK3D',akBersih(t)>=0?'uang masuk lebih besar dari uang keluar':'uang keluar lebih besar dari uang masuk');
  $('akK4').innerHTML=lpRp(akBersih(t)/d.rows.length,0);put('akK4D','arus bersih rata-rata '+int(d.rows.length)+' bulan');
  const w=[];
  if(t.iklan_luar)w.push('Spend '+rpFull(t.iklan_luar)+' dari campaign yang tidak pernah menghasilkan order Scalev (mis. iklan toko / aplikasi lain) <b>tidak dihitung</b>, sama dengan halaman Ringkasan.');
  if(!t.shp_cair&&!t.tt_cair)w.push('Belum ada data Penghasilan Shopee / TikTok pada periode ini — upload / sinkron di menu Penghasilan masing-masing supaya dana marketplace ikut masuk.');
  w.push('Dana Shopee &amp; TikTok dihitung saat <b>dilepas ke saldo penjual</b> di marketplace; kalau saldo itu belum ditarik ke rekening, uangnya belum benar-benar ada di bank.');
  w.push('Arus kas bukan laba: pencairan COD bulan ini bisa berasal dari paket bulan lalu, dan pembelian stok langsung jadi uang keluar walau barangnya belum terjual.');
  $('akWarn').hidden=!w.length;$('akWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  $('akIsi').innerHTML=lpTabel(akBaris(d),[...d.rows,t]);
}
['akPer','akSampai'].forEach(id=>$(id).addEventListener('change',loadArusKas));
$('akExport').addEventListener('click',()=>{if(akData)lpCsv('arus-kas-'+akData.bulan[0]+'_'+akData.bulan[akData.bulan.length-1]+'.csv',akBaris(akData),[...akData.rows,Object.assign(lpTotal(akData.rows),{kum:akData.rows[akData.rows.length-1].kum})])});
