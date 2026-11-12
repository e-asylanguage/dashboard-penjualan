/**
 * Shopee › Pengiriman: pesanan dari API / file ekspor — kotak status, grafik harian, tab daftar pesanan / per toko / kurir / produk / alasan batal, ekspor CSV; tabel toko;
 * dan Koneksi API Shopee (hubungkan toko & uji baca data). Data: /api/shopee/pengiriman, /pengiriman/daftar, /api/shopee/toko, /api/shopee-api/*.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta dari script utama (window.*):
 * rentang(), spToko (dibaca & diisi), tkMuat(), tkTagSumber(), spAlasan(), spBatalGrup().
 * Dipanggil dari script utama: loadShpKirim() (menu Pengiriman, setelah upload / sinkron / ubah toko); spBukaOto() di script utama membaca spData.
 */
// ---- Shopee › Pengiriman: pesanan dari file ekspor Seller Centre (Pesanan Saya → Ekspor), satu file per toko.
// File di-parse di browser lalu dikirim per 100 pesanan; status diringkas di server (lihat routes/shopee.ts).
let spData=null,spBusy=false,spTab='daftar',spGrup='',spRows=[],spTotal=0,spChart=null,spCariT=null;
const SP_GRUP={perlu_dikirim:['Perlu dikirim','spend'],dikirim:['Dalam perjalanan','info'],terkirim:['Terkirim','rev'],batal:['Batal','loss'],retur:['Pengembalian','warn'],belum_bayar:['Belum bayar',''],lain:['Lainnya','']};
const SP_TERKIRIM={terkirim:'Sampai, belum dikonfirmasi pembeli',diterima:'Diterima pembeli',selesai:'Selesai'};
const spGrupDari=s=>SP_TERKIRIM[s]?'terkirim':s;
const spTglJam=s=>!s?'—':s.length<=10?tglWib(s+'T12:00:00+07:00'):tglWib(s.replace(' ','T')+':00+07:00',true);
function spQuery(){const r=rentang('spRange'),q=new URLSearchParams({from:r.from,to:r.to});if($('spToko').value)q.set('toko',$('spToko').value);return q}

async function loadShpKirim(){
  if(spBusy)return;spBusy=true;
  try{
    const [d,t]=await Promise.all([api('/api/shopee/pengiriman?'+spQuery()),api('/api/shopee/toko')]);
    spData=d;spToko=t;renderShpKirim();tkMuat('sp');await spMuatDaftar(false);
  }catch(e){$('spIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{spBusy=false}
  saMuat();
}

// ---- Koneksi API Shopee (Open Platform): hubungkan toko & uji baca data. Belum menulis ke laporan.
async function saMuat(){
  try{
    const d=await api('/api/shopee-api/toko');
    put('saInfo',(d.sandbox?'Mode UJI (sandbox) — hanya toko uji Shopee, data tidak masuk laporan':'Mode LIVE')+' · '+d.host);
    $('saRows').innerHTML=d.toko.length?d.toko.map(t=>'<tr><td class="name">'+esc(t.nama||'—')+'<small class="mm-sub">'+esc(t.region||'')+'</small></td><td>'+esc(t.shop_id)+'</td>'+
      '<td>'+tglWib(t.expire_at,true)+'<small class="mm-sub">diperbarui otomatis · izin s.d. '+tglWib(t.refresh_expire_at)+'</small></td>'+
      '<td class="n">'+(d.sandbox?'<button class="btn ghost" data-sa-produk="'+esc(t.shop_id)+'">Buat produk uji</button> <button class="btn ghost" data-sa-kirim="'+esc(t.shop_id)+'">Atur jasa kirim uji</button> ':'')+'<button class="btn ghost" data-sa-uji="'+esc(t.shop_id)+'">Uji baca data</button> <button class="btn ghost" data-sa-hapus="'+esc(t.shop_id)+'">Putuskan</button></td></tr>').join('')
      :'<tr><td colspan="4" style="color:var(--muted)">Belum ada toko terhubung. Klik <b>Hubungkan toko</b>.</td></tr>';
  }catch(e){put('saInfo',e.message.includes('SHOPEE_PARTNER')?'Kunci aplikasi Shopee belum di-set (secret SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY)':'Gagal: '+e.message);
    $('saRows').innerHTML='<tr><td colspan="4" style="color:var(--muted)">—</td></tr>'}
}
$('saHubung').addEventListener('click',async()=>{
  try{const d=await api('/api/shopee-api/link-izin');location.href=d.url}catch(e){alert('Gagal membuat link izin: '+e.message)}
});
$('saRows').addEventListener('click',async e=>{
  const u=e.target.closest('[data-sa-uji]'),h=e.target.closest('[data-sa-hapus]'),p=e.target.closest('[data-sa-produk]'),out=$('saHasil');
  const k=e.target.closest('[data-sa-kirim]');
  if(k){out.hidden=false;out.textContent='Mengatur jasa kirim produk uji…';
    try{out.textContent=JSON.stringify(await api('/api/shopee-api/sandbox/atur-kirim/'+k.dataset.saKirim,{method:'POST'}),null,2)}catch(err){out.textContent='Gagal: '+err.message}}
  if(p&&confirm('Buat 2 produk uji di toko sandbox '+p.dataset.saProduk+' lewat API?')){out.hidden=false;out.textContent='Membuat produk uji…';
    try{out.textContent=JSON.stringify(await api('/api/shopee-api/sandbox/buat-produk/'+p.dataset.saProduk,{method:'POST'}),null,2)}catch(err){out.textContent='Gagal: '+err.message}}
  if(u){out.hidden=false;out.textContent='Membaca data toko '+u.dataset.saUji+'…';
    try{out.textContent=JSON.stringify(await api('/api/shopee-api/uji/'+u.dataset.saUji,{method:'POST'}),null,2)}catch(err){out.textContent='Gagal: '+err.message}}
  if(h&&confirm('Putuskan koneksi API toko '+h.dataset.saHapus+'?')){
    try{await api('/api/shopee-api/toko/'+h.dataset.saHapus,{method:'DELETE'});saMuat()}catch(err){alert('Gagal: '+err.message)}}
});
function renderShpKirim(){
  const d=spData,g={};for(const s of d.status)g[s.grup]=s;
  const n=k=>(g[k]&&g[k].n)||0,total=d.status.reduce((a,s)=>a+s.n,0),aktif=total-n('batal')-n('belum_bayar');
  const sel=$('spToko'),v=sel.value;
  sel.innerHTML='<option value="">Semua toko</option>'+spToko.toko.map(t=>'<option value="'+t.id+'">'+esc(t.nama)+'</option>').join('');
  sel.value=[...sel.options].some(o=>o.value===v)?v:'';
  put('spPeriod','Pesanan dibuat '+fmtRange(d.from,d.to)+' · '+int(total)+' pesanan'+(n('belum_bayar')?' · '+int(n('belum_bayar'))+' belum dibayar':'')+' · API & upload file digabung per No. Pesanan');
  put('spK1',int(n('perlu_dikirim')));const mp=(d.mepet||{}).n||0;
  // Kotak "Perlu dikirim": lewat batas → merah; ada yang harus dikirim hari ini → jumlahnya + batas paling awal
  $('spK1D').innerHTML=d.telat?'<b style="color:var(--loss)">'+int(d.telat)+' lewat batas kirim</b>'+(mp?' · '+int(mp)+' harus dikirim hari ini':'')
    :mp?'<b style="color:var(--loss)">⚠️ '+int(mp)+' harus dikirim hari ini</b> · paling awal '+esc(spSisa(d.mepet.paling_awal).teks):'semua masih dalam batas kirim';
  put('spK2',int(n('dikirim')));put('spK2D',int((g.dikirim&&g.dikirim.pcs)||0)+' pcs · '+lpPct(n('dikirim'),aktif)+' dari pesanan aktif');
  put('spK3',int(n('terkirim')));put('spK3D',lpPct(n('terkirim'),aktif)+' dari pesanan aktif · '+rpFull((g.terkirim&&g.terkirim.nilai)||0));
  put('spK4',int(n('batal')));
  // Rincian penyebab batal per pihak (spBatalGrup): Penjual = masalah gudang/stok (merah), Sistem = tidak dibayar, Pembeli = niat beli.
  // Klik → tab Alasan batal.
  const bg=spBatalGrup(d.batal),bTot=bg.reduce((a,r)=>a+r.n,0),bPihak={};
  for(const r of bg)bPihak[r.pihak]=(bPihak[r.pihak]||0)+r.n;
  const SP_PIHAK={Pembeli:'dibatalkan pembeli',Sistem:'tidak dibayar (sistem)',Penjual:'penjual / gudang',Pengiriman:'pengiriman gagal'};
  const urut=Object.entries(bPihak).sort((a,b)=>b[1]-a[1]);
  $('spK4D').innerHTML=esc(lpPct(n('batal'),total)+' dari pesanan masuk · '+rpFull((g.batal&&g.batal.nilai)||0))+
    (bTot?'<button type="button" class="sp-btl" title="'+esc('Alasan terbanyak: '+bg[0].label+' ('+int(bg[0].n)+') — klik untuk rincian alasan batal')+'">'+
      '<span class="sp-btl-bar">'+urut.map(([p,v])=>'<i class="p-'+p.toLowerCase()+'" style="width:'+(100*v/bTot).toFixed(1)+'%"></i>').join('')+'</span>'+
      urut.map(([p,v])=>'<span class="sp-btl-l p-'+p.toLowerCase()+'"><i></i>'+lpPct(v,bTot)+' '+esc(SP_PIHAK[p]||p)+'</span>').join('')+'</button>':'');
  const btl=$('spK4D').querySelector('.sp-btl');if(btl)btl.onclick=()=>{spTab='batal';spRenderTab()};
  put('spK5',int(n('retur')));put('spK5D',lpPct(n('retur'),aktif)+' dari pesanan aktif');
  $('spK1').style.color=d.telat?'var(--loss)':'';
  $('navShp').hidden=!d.telat;$('navShp').textContent=String(d.telat);
  const w=[],today=ymd(new Date()),tanpaGudang=spToko.toko.filter(t=>!t.gudang_id),skuBaru=d.per_sku.filter(s=>!s.sku_id);
  if(!spToko.toko.length)w.push('Belum ada toko Shopee — klik <b>Tambah toko</b> di bagian bawah, lalu <b>Upload file</b>.');
  if(d.telat)w.push(int(d.telat)+' pesanan <b>lewat batas kirim</b> dan belum dikirim — berisiko kena penalti Shopee. Lihat filter <b>Lewat batas</b> di daftar pesanan.');
  if(tanpaGudang.length)w.push('Gudang belum ditentukan untuk: <b>'+tanpaGudang.map(t=>esc(t.nama)).join(', ')+'</b> — atur di tabel Toko Shopee.');
  const lama=spToko.toko.filter(t=>t.pesanan&&t.pesanan_terakhir&&t.pesanan_terakhir.slice(0,10)<shift(today,-2));
  if(lama.length)w.push('Data pesanan belum diperbarui lebih dari 2 hari: '+lama.map(t=>'<b>'+esc(t.nama)+'</b> (sampai '+esc(spTglJam(t.pesanan_terakhir.slice(0,10)))+')').join(', ')+' — upload file terbaru supaya status pengiriman akurat.');
  if(skuBaru.length)w.push(int(skuBaru.length)+' kode SKU Shopee belum ada di <b>Manajemen SKU</b> ('+skuBaru.slice(0,6).map(s=>esc(s.sku||'(kosong)')).join(', ')+(skuBaru.length>6?', …':'')+') — isi paket & HPP-nya belum terbaca. Lihat tab <b>Per produk</b>.');
  $('spWarn').hidden=!w.length;$('spWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  put('spTabSku',skuBaru.length?String(skuBaru.length):'');
  spGambar();spRenderToko();spRenderTab();
}
function spGambar(){
  if(typeof Chart==='undefined')return;
  const d=spData,hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const per=new Map();for(const r of d.harian)per.set(r.tgl+'|'+r.grup,r.n);
  const seri=[['terkirim','--rev'],['dikirim','--info'],['perlu_dikirim','--spend'],['retur','--pb'],['batal','--loss']];
  const labels=hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const data=seri.map(([k])=>hari.map(t=>per.get(t+'|'+k)||0));
  if(spChart){spChart.data.labels=labels;data.forEach((x,i)=>spChart.data.datasets[i].data=x);spChart.update();return}
  spChart=new Chart($('spDaily'),{type:'bar',
    data:{labels,datasets:seri.map(([k,c],i)=>({label:SP_GRUP[k][0],data:data[i],backgroundColor:css(c)||css('--muted'),borderRadius:3,stack:'s'}))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{precision:0}}}}});
}
const spTag=s=>{const k=spGrupDari(s),x=SP_GRUP[k]||SP_GRUP.lain;return '<span class="tag '+x[1]+'">'+x[0]+'</span>'};
const spKosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+t+'</td></tr>';

async function spMuatDaftar(tambah){
  if(!tambah){spRows=[];spTotal=0;spPilih.clear()}
  const q=spQuery();if(spGrup)q.set('grup',spGrup);const c=$('spCari').value.trim();if(c)q.set('q',c);q.set('offset',String(spRows.length));
  const h=await api('/api/shopee/pengiriman/daftar?'+q);
  spRows=spRows.concat(h.rows);spTotal=h.total;
  if(spTab==='daftar')spRenderTab();
}
function spRenderTab(){
  const d=spData;
  $('spTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===spTab));
  $('spCariWrap').hidden=spTab!=='daftar';$('spMore').hidden=true;
  if(spTab==='daftar'){
    const g={};for(const s of d.status)g[s.grup]=s.n;const total=d.status.reduce((a,s)=>a+s.n,0);
    const chip=(k,l,n)=>'<button data-grup="'+k+'"'+(spGrup===k?' class="on"':'')+'>'+l+' <small>'+int(n)+'</small></button>';
    $('spSub').innerHTML='<span class="ob-mini">'+chip('','Semua',total)+chip('perlu_dikirim','Perlu dikirim',g.perlu_dikirim||0)+(d.telat?chip('telat','Lewat batas',d.telat):'')+((d.mepet||{}).n?chip('mepet','⚠️ Kirim hari ini',d.mepet.n).replace('<button','<button class="sp-mepet'+(spGrup==='mepet'?' on':'')+'" title="Belum dikirim, batas kirim hari ini atau kurang dari 12 jam lagi — urut dari yang paling mepet"').replace(' class="on"',''):'')+
      chip('dikirim','Dalam perjalanan',g.dikirim||0)+chip('terkirim','Terkirim',g.terkirim||0)+chip('batal','Batal',g.batal||0)+chip('retur','Pengembalian',g.retur||0)+
      (g.belum_bayar?chip('belum_bayar','Belum bayar',g.belum_bayar):'')+'</span>';
    $('spIsi').innerHTML=spAksiHtml()+'<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th class="sp-cek"><input type="checkbox" id="spCekSemua" title="Pilih semua pesanan yang tampil"'+(spRows.length&&spRows.every(r=>spPilih.has(r.no_pesanan))?' checked':'')+'></th><th>Pesanan</th><th>Toko</th><th>Produk</th><th>Kurir / resi</th><th>Batas kirim / dikirim</th><th>Status</th><th class="n">Nilai</th><th>Kota</th></tr></thead><tbody>'+
      (spRows.map(r=>{
        const telat=r.status==='perlu_dikirim'&&r.batas_kirim&&r.batas_kirim<d.kini;
        return '<tr'+(spPilih.has(r.no_pesanan)?' class="sp-dipilih"':'')+'><td class="sp-cek"><input type="checkbox" data-cek="'+esc(r.no_pesanan)+'"'+(spPilih.has(r.no_pesanan)?' checked':'')+'></td><td class="lr-nm"><b>'+esc(r.no_pesanan)+'</b>'+tkTagSumber(r.sumber)+'<small>'+spTglJam(r.dibuat)+'</small></td><td>'+esc(r.toko)+'</td>'+
          // Produk ringkas: satu baris per item "qty× SKU · variasi · nama…" — nama Shopee yang panjang (SEO) dipotong, lengkapnya di tooltip
          '<td class="sp-prod">'+r.items.map(i=>'<div class="sp-item" title="'+esc(i.qty+'× '+(i.nama||'?')+(i.variasi?' ('+i.variasi+')':'')+' · SKU '+(i.sku||'kosong'))+'">'+
            '<b>'+int(i.qty)+'×</b> '+(i.sku?'<span class="sp-sku">'+esc(i.sku)+'</span>':'<span class="sp-sku kosong">tanpa SKU</span>')+
            (i.variasi?'<span class="sp-var">'+esc(i.variasi)+'</span>':'')+'<span class="sp-nm">'+esc(i.nama||'?')+'</span></div>').join('')+'</td>'+
          '<td class="lr-nm">'+esc(r.kurir_singkat||'—')+'<small>'+(r.resi?esc(r.resi):'belum ada resi')+(r.antar?' · '+esc(r.antar):'')+'</small></td>'+
          '<td class="lr-nm">'+(r.waktu_kirim?'Dikirim '+spTglJam(r.waktu_kirim):r.batas_kirim?spBatas(r):'—')+'</td>'+
          '<td class="lr-nm">'+spTag(r.status)+'<small>'+esc(SP_TERKIRIM[r.status]||(r.status==='batal'?(r.alasan_batal?spAlasan(r.alasan_batal).label:''):r.status==='retur'?r.status_retur||'':''))+'</small></td>'+
          '<td class="n">'+rpFull(r.subtotal)+'<small>'+(r.cod?'COD':esc(r.metode_bayar||''))+'</small></td><td class="lr-nm">'+esc(r.kota||'—')+'<small>'+esc(r.provinsi||'')+'</small></td></tr>'}).join('')||
        spKosong(9,spToko.toko.length?'Tidak ada pesanan pada rentang / filter ini.':'Belum ada data — tambah toko lalu upload file pesanan.'))+'</tbody></table>';
    $('spMore').hidden=spRows.length>=spTotal;put('spMoreBtn','Tampilkan lebih banyak ('+int(spTotal-spRows.length)+' lagi)');
  }else if(spTab==='toko'){
    put('spSub','Per toko · pesanan aktif = selain batal & belum bayar · omzet = harga produk setelah diskon');
    const nama=new Map(spToko.toko.map(t=>[t.id,t]));
    $('spIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th>Gudang</th><th class="n">Pesanan</th><th class="n">Perlu dikirim</th><th class="n">Dalam perjalanan</th><th class="n">Terkirim</th><th class="n">Batal</th><th class="n">Pengembalian</th><th class="n">Pcs</th><th class="n">Omzet</th></tr></thead><tbody>'+
      (d.per_toko.slice().sort((a,b)=>b.n-a.n).map(r=>{const t=nama.get(r.toko_id)||{};
        return '<tr><td class="nm">'+esc(t.nama||'?')+'</td><td>'+(t.gudang?esc(t.gudang):'<span class="tag warn">belum diatur</span>')+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+int(r.perlu_dikirim)+'</td>'+
          '<td class="n">'+int(r.dikirim)+'</td><td class="n">'+int(r.terkirim)+'</td><td class="n">'+int(r.batal)+'<small>'+lpPct(r.batal,r.n)+'</small></td><td class="n">'+int(r.retur)+'</td>'+
          '<td class="n">'+int(r.pcs)+'</td><td class="n">'+rpFull(r.omzet)+'</td></tr>'}).join('')||spKosong(10,'Belum ada pesanan pada rentang ini.'))+'</tbody></table>';
  }else if(spTab==='kurir'){
    put('spSub','Pesanan aktif per kurir (dari Opsi Pengiriman) · pickup = dijemput kurir, sisanya diantar ke counter');
    $('spIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Kurir</th><th class="n">Pesanan</th><th class="n">Perlu dikirim</th><th class="n">Dalam perjalanan</th><th class="n">Terkirim</th><th class="n">Pengembalian</th><th class="n">COD</th><th class="n">Pickup</th></tr></thead><tbody>'+
      (d.per_kurir.map(r=>'<tr><td class="nm">'+esc(r.kurir)+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+int(r.perlu_dikirim)+'</td><td class="n">'+int(r.dikirim)+'</td>'+
        '<td class="n">'+int(r.terkirim)+'<small>'+lpPct(r.terkirim,r.n)+'</small></td><td class="n">'+int(r.retur)+'</td><td class="n">'+int(r.cod)+'<small>'+lpPct(r.cod,r.n)+'</small></td><td class="n">'+lpPct(r.pickup,r.n)+'</td></tr>').join('')||spKosong(8,'Belum ada pesanan pada rentang ini.'))+'</tbody></table>';
  }else if(spTab==='produk'){
    const belum=d.per_sku.filter(r=>!r.sku_id&&r.sku).length;
    $('spSub').innerHTML='Produk di pesanan aktif per Nomor Referensi SKU · SKU yang belum ada di Manajemen SKU belum bisa dipecah ke List Produk / HPP'+
      (belum?' <span class="ob-mini"><button id="spOtoBtn">Buat SKU otomatis ('+int(belum)+')</button></span>':'');
    $('spIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>SKU</th><th>Produk</th><th class="n">Pesanan</th><th class="n">Pcs</th><th class="n">Omzet</th><th class="n">Retur</th><th>Manajemen SKU</th></tr></thead><tbody>'+
      (d.per_sku.map(r=>'<tr><td class="nm">'+esc(r.sku||'(kosong)')+'</td><td class="lr-nm">'+esc(r.nama||'—')+(r.variasi?'<small>'+esc(r.variasi)+'</small>':'')+'</td><td class="n">'+int(r.pesanan)+'</td>'+
        '<td class="n">'+int(r.qty)+'</td><td class="n">'+rpFull(r.omzet)+'</td><td class="n">'+int(r.retur)+'</td>'+
        '<td>'+(r.sku_id?esc(r.sku_produk):'<span class="tag warn">belum ada</span>')+'</td></tr>').join('')||spKosong(7,'Belum ada pesanan pada rentang ini.'))+'</tbody></table>';
  }else{
    const g=spBatalGrup(d.batal),tot=g.reduce((a,r)=>a+r.n,0),nilai=g.reduce((a,r)=>a+r.nilai,0),maks=Math.max(1,...g.map(r=>r.n));
    const pihak={};for(const r of g)pihak[r.pihak]=(pihak[r.pihak]||0)+r.n;
    put('spSub',int(tot)+' pesanan batal · nilai '+rpFull(nilai)+' · '+Object.entries(pihak).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+lpPct(v,tot)).join(' · '));
    $('spIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Alasan pembatalan</th><th>Dibatalkan oleh</th><th class="n">Pesanan</th><th class="n">Porsi</th><th class="n">Nilai pesanan</th></tr></thead><tbody>'+
      (g.map(r=>'<tr><td class="lr-nm">'+esc(r.label)+(r.asli.length?'<small>'+esc(r.asli.join(' · '))+'</small>':'')+
        '<div style="height:4px;margin-top:6px;border-radius:2px;background:var(--line);max-width:260px"><div style="height:4px;border-radius:2px;width:'+(100*r.n/maks)+'%;background:'+(r.pihak==='Penjual'?'var(--loss)':r.pihak==='Pengiriman'?'var(--warn,#F79009)':'var(--info)')+'"></div></div></td>'+
        '<td><span class="tag'+(r.pihak==='Penjual'?' loss':r.pihak==='Pengiriman'?' warn':'')+'">'+esc(r.pihak)+'</span></td>'+
        '<td class="n">'+int(r.n)+'</td><td class="n">'+lpPct(r.n,tot)+'</td><td class="n">'+rpFull(r.nilai)+(r.cod?'<small>'+int(r.cod)+' COD</small>':'')+'</td></tr>').join('')||spKosong(5,'Tidak ada pesanan batal.'))+'</tbody></table>';
  }
}

/**
 * Tabel Toko Shopee + kesehatan data pesanan (dulu kartu terpisah di bawah halaman): satu baris per toko berisi sumber,
 * gudang, data terakhir, cakupan periode ini & status. Status dari tkBar (window.tkStatus.sp, event 'tk-status').
 */
/** Sisa waktu ke batas kirim (string WIB "YYYY-MM-DD HH:MM") dari jam sekarang: {jam, teks} */
function spSisa(batas){
  const b=Date.parse(String(batas).slice(0,16).replace(' ','T')+':00Z'),kini=Date.now()+7*3600e3,jam=(b-kini)/36e5;
  const a=Math.abs(jam),t=a<1?Math.max(1,Math.round(a*60))+' menit':a<48?Math.floor(a)+' jam'+(a<12&&Math.round((a%1)*60)?' '+Math.round((a%1)*60)+' mnt':''):Math.floor(a/24)+' hari';
  return {jam,teks:jam<0?'lewat '+t:'sisa '+t};
}
/** Kolom batas kirim pesanan yang belum dikirim: merah < 12 jam / lewat, oranye < 24 jam */
function spBatas(r){
  const tgl='Batas '+spTglJam(r.batas_kirim);
  if(r.status!=='perlu_dikirim')return tgl;
  const s=spSisa(r.batas_kirim),kls=s.jam<0?'sp-bk lewat':s.jam<12?'sp-bk mepet':s.jam<24?'sp-bk dekat':'';
  return kls?'<span class="'+kls+'">'+(s.jam<12?'⚠️ ':'')+tgl+'</span><small>'+esc(s.teks)+'</small>':tgl+'<small>'+esc(s.teks)+'</small>';
}
// ---- Pilih pesanan → daftar siap kemas untuk gudang (CSV / cetak). Pilihan hanya dari baris yang sudah dimuat; hilang saat filter berganti.
const spPilih=new Map();
function spAksiHtml(){
  const n=spPilih.size,pcs=[...spPilih.values()].reduce((a,r)=>a+r.items.reduce((b,i)=>b+(Number(i.qty)||0),0),0);
  const siap=spRows.filter(r=>r.status==='perlu_dikirim').length;
  return '<div class="sp-aksi'+(n?' on':'')+'">'+(n
    ?'<b>'+int(n)+' pesanan dipilih</b><span>'+int(pcs)+' pcs</span><span class="sp-aksi-tbl"><button class="btn primary" data-aksi="csv">Daftar siap kemas (CSV)</button>'+
      '<button class="btn ghost" data-aksi="cetak">Cetak / PDF</button><button class="btn ghost" data-aksi="hapus">Batal pilih</button></span>'
    :'<span>Centang pesanan untuk membuat daftar siap kemas per gudang.</span>'+(siap?'<button class="btn ghost" data-aksi="siap">Pilih '+int(siap)+' pesanan "Perlu dikirim" yang tampil</button>':''))+'</div>';
}
/** Rekap per gudang → per SKU + variasi: jumlah pcs & jumlah pesanan */
function spKemasRekap(){
  const per=new Map();
  for(const r of spPilih.values()){
    const g=r.gudang||'(gudang belum diatur)';if(!per.has(g))per.set(g,{gudang:g,pesanan:[],item:new Map()});
    const x=per.get(g);x.pesanan.push(r);
    for(const i of r.items){const k=(i.sku||'')+'|'+(i.variasi||'')+'|'+(i.sku?'':i.nama);
      const it=x.item.get(k)||{sku:i.sku||'',nama:i.nama||'?',variasi:i.variasi||'',qty:0,n:0};it.qty+=Number(i.qty)||0;it.n++;x.item.set(k,it)}
  }
  return [...per.values()].map(x=>({...x,item:[...x.item.values()].sort((a,b)=>(a.sku||'~').localeCompare(b.sku||'~')||b.qty-a.qty)})).sort((a,b)=>a.gudang.localeCompare(b.gudang));
}
function spKemasCsv(){
  const rk=spKemasRekap(),stamp=new Date(Date.now()+7*3600e3).toISOString().slice(0,16).replace(/[-:T]/g,'');
  unduhCsv('daftar-siap-kemas-'+stamp+'.csv',['Gudang','SKU','Produk','Variasi','Jumlah (pcs)','Pesanan'],
    rk.flatMap(g=>g.item.map(i=>[g.gudang,i.sku,i.nama,i.variasi,i.qty,i.n])));
}
function spKemasCetak(){
  const rk=spKemasRekap(),w=window.open('','_blank');
  if(!w)return alert('Jendela cetak diblokir browser — izinkan pop-up untuk dashboard ini, lalu coba lagi.');
  const wkt=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date());
  const isi=rk.map(g=>{const pcs=g.item.reduce((a,i)=>a+i.qty,0);
    return '<section><h2>'+esc(g.gudang)+'</h2><p>'+int(g.pesanan.length)+' pesanan · '+int(pcs)+' pcs</p>'+
      '<table><thead><tr><th class="c">✓</th><th>SKU</th><th>Produk</th><th>Variasi</th><th class="n">Jumlah</th></tr></thead><tbody>'+
      g.item.map(i=>'<tr><td class="c">☐</td><td class="sku">'+esc(i.sku||'—')+'</td><td>'+esc(i.nama)+'</td><td>'+esc(i.variasi||'—')+'</td><td class="n"><b>'+int(i.qty)+'</b></td></tr>').join('')+
      '</tbody><tfoot><tr><td colspan="4">Total</td><td class="n"><b>'+int(pcs)+'</b></td></tr></tfoot></table>'+
      '<h3>Daftar pesanan</h3><table class="ps"><thead><tr><th class="c">✓</th><th>No. pesanan</th><th>Kurir / resi</th><th>Isi</th></tr></thead><tbody>'+
      g.pesanan.map(r=>'<tr><td class="c">☐</td><td>'+esc(r.no_pesanan)+'</td><td>'+esc(r.kurir_singkat||'—')+(r.resi?'<br><small>'+esc(r.resi)+'</small>':'')+'</td><td>'+
        r.items.map(i=>esc(int(i.qty)+'× '+(i.sku||i.nama)+(i.variasi?' ('+i.variasi+')':''))).join('<br>')+'</td></tr>').join('')+'</tbody></table></section>'}).join('');
  w.document.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Daftar siap kemas</title><style>'+
    'body{font:13px/1.45 system-ui,sans-serif;color:#111;background:#fff;margin:24px}h1{font-size:18px;margin:0}h2{font-size:16px;margin:22px 0 2px}h3{font-size:13px;margin:14px 0 4px}'+
    'p{margin:0 0 8px;color:#555}table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}'+
    'th{background:#f2f2f2}.n{text-align:right}.c{width:22px;text-align:center}.sku{font-family:ui-monospace,monospace;white-space:nowrap}tfoot td{background:#fafafa}'+
    'section{page-break-after:always}section:last-child{page-break-after:auto}small{color:#555}@media print{body{margin:10mm}}</style></head><body>'+
    '<h1>Daftar siap kemas</h1><p>Dicetak '+esc(wkt)+' WIB · '+int(spPilih.size)+' pesanan</p>'+isi+'</body></html>');
  w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
$('spIsi').addEventListener('change',e=>{
  if(spTab!=='daftar')return;
  const t=e.target;
  if(t.id==='spCekSemua'){for(const r of spRows)t.checked?spPilih.set(r.no_pesanan,r):spPilih.delete(r.no_pesanan);spRenderTab();return}
  if(t.dataset&&t.dataset.cek!=null){const r=spRows.find(x=>x.no_pesanan===t.dataset.cek);if(!r)return;
    t.checked?spPilih.set(r.no_pesanan,r):spPilih.delete(r.no_pesanan);t.closest('tr').classList.toggle('sp-dipilih',t.checked);
    const a=$('spIsi').querySelector('.sp-aksi');if(a)a.outerHTML=spAksiHtml();
    const all=$('spCekSemua');if(all)all.checked=!!spRows.length&&spRows.every(x=>spPilih.has(x.no_pesanan))}
});
$('spIsi').addEventListener('click',e=>{
  const b=e.target.closest('.sp-aksi [data-aksi]');if(!b)return;const a=b.dataset.aksi;
  if(a==='csv')spKemasCsv();else if(a==='cetak')spKemasCetak();
  else if(a==='hapus'){spPilih.clear();spRenderTab()}
  else if(a==='siap'){for(const r of spRows)if(r.status==='perlu_dikirim')spPilih.set(r.no_pesanan,r);spRenderTab()}
});
function spRenderToko(){
  if(!spToko)return;
  const st=(window.tkStatus||{}).sp,per=new Map(st?st.nilai.map(x=>[x.t.id,x]):[]);
  put('spTokoSub',(st?fmtRange(st.r.from,st.r.to)+' · ':'')+'status data: pengingat bila tertinggal lebih dari 2 hari · gudang ditentukan per toko · pesanan baru memakai gudang toko saat file di-upload');
  $('spTokoIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th>Sumber data</th><th>Gudang</th><th class="n">Pesanan tersimpan</th>'+
    '<th>Data terakhir</th><th title="Rentang data pesanan yang ada di periode filter">Periode ini</th><th>Status</th><th class="n">Aksi</th></tr></thead><tbody>'+
    (spToko.toko.map(t=>{const x=per.get(t.id),s=x&&x.s||{};
      return '<tr><td class="lr-nm"><b>'+esc(t.nama)+'</b><small>'+esc(t.username||'username belum diisi')+'</small></td><td>'+(t.mode==='api'?'<span class="tk-src api">⚡ API</span><small>'+(t.api_sejak?'terhubung · shop_id '+esc(t.shop_id||'—'):'belum terhubung — hubungkan di Koneksi API Shopee')+'</small>':'<span class="tk-src up">⬆ Upload manual</span>')+'</td>'+
      '<td>'+(t.gudang?esc(t.gudang):'<span class="tag warn">belum diatur</span>')+'</td>'+
      '<td class="n">'+int(t.pesanan)+'</td>'+
      '<td>'+(t.pesanan_terakhir?spTglJam(t.pesanan_terakhir):'—')+(t.mode!=='api'&&t.upload_terakhir?'<small class="mm-sub">upload '+tglWib(t.upload_terakhir,true)+'</small>':'')+'</td>'+
      '<td>'+(!x?'…':s.n?esc(fmtRange(s.awal_rentang,s.akhir_rentang))+'<small class="mm-sub">'+int(s.n)+' pesanan'+(s.n_api?' · '+int(s.n_api)+' dari API':'')+'</small>':'<span style="color:var(--muted)">belum ada</span>')+'</td>'+
      '<td>'+(x?'<span class="tag '+x.v.kelas+'">'+x.v.ikon+' '+esc(x.v.teks)+'</span>':'…')+'</td>'+
      '<td class="n"><span class="bo-aksi"><button data-tk-ubah="'+t.id+'">Ubah</button>'+(t.pesanan?'':'<button class="hapus" data-tk-hapus="'+t.id+'">Hapus</button>')+'</span></td></tr>'}).join('')||
      spKosong(8,'Belum ada toko — klik <b>Tambah toko</b>.'))+'</tbody></table>';
}
document.addEventListener('tk-status',e=>{if(e.detail==='sp')spRenderToko()});

// -- Filter, tab, ekspor
$('spRange').addEventListener('click',e=>{if(e.target.closest('button'))loadShpKirim()});
$('spToko').addEventListener('change',loadShpKirim);
$('spTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!spData)return;spTab=b.dataset.tab;spRenderTab()});
$('spSub').addEventListener('click',async e=>{const b=e.target.closest('[data-grup]');if(!b||!spData)return;spGrup=b.dataset.grup;try{await spMuatDaftar(false)}catch(err){alert(err.message)}});
$('spCari').addEventListener('input',()=>{clearTimeout(spCariT);spCariT=setTimeout(()=>{if(spData)spMuatDaftar(false).catch(err=>alert(err.message))},350)});
$('spMoreBtn').addEventListener('click',()=>spMuatDaftar(true).catch(err=>alert(err.message)));
$('spExport').addEventListener('click',async()=>{
  if(!spData)return;const d=spData,nama=new Map(spToko.toko.map(t=>[t.id,t.nama])),akhir='-'+d.from+'_'+d.to+'.csv';
  if(spTab==='toko')return unduhCsv('shopee-per-toko'+akhir,['Toko','Pesanan','Perlu dikirim','Dalam perjalanan','Terkirim','Batal','Pengembalian','Pcs','Omzet'],d.per_toko.map(r=>[nama.get(r.toko_id)||'?',r.n,r.perlu_dikirim,r.dikirim,r.terkirim,r.batal,r.retur,r.pcs,r.omzet]));
  if(spTab==='kurir')return unduhCsv('shopee-per-kurir'+akhir,['Kurir','Pesanan','Perlu dikirim','Dalam perjalanan','Terkirim','Pengembalian','COD','Pickup'],d.per_kurir.map(r=>[r.kurir,r.n,r.perlu_dikirim,r.dikirim,r.terkirim,r.retur,r.cod,r.pickup]));
  if(spTab==='produk')return unduhCsv('shopee-per-produk'+akhir,['SKU','Produk','Variasi','Pesanan','Pcs','Omzet','Retur','Manajemen SKU'],d.per_sku.map(r=>[r.sku,r.nama,r.variasi||'',r.pesanan,r.qty,r.omzet,r.retur,r.sku_produk||'']));
  if(spTab==='batal')return unduhCsv('shopee-alasan-batal'+akhir,['Alasan','Dibatalkan oleh','Pesanan','Nilai pesanan','Alasan asli'],spBatalGrup(d.batal).map(r=>[r.label,r.pihak,r.n,r.nilai,r.asli.join(' | ')]));
  try{while(spRows.length<spTotal&&spRows.length<20000)await spMuatDaftar(true)}catch(err){alert(err.message);return}
  unduhCsv('shopee-pesanan'+akhir,['No. Pesanan','Toko','Dibuat','Status','Status Shopee','Alasan batal','Kurir','Resi','Batas kirim','Dikirim','Selesai','Metode bayar','Produk','SKU','Pcs','Nilai produk','Total pembayaran','Kota','Provinsi'],
    spRows.map(r=>[r.no_pesanan,r.toko,r.dibuat,(SP_GRUP[spGrupDari(r.status)]||SP_GRUP.lain)[0],r.status_asli||'',r.alasan_batal||'',r.kurir||'',r.resi||'',r.batas_kirim||'',r.waktu_kirim||'',r.selesai||'',r.metode_bayar||'',
      r.items.map(i=>i.qty+'x '+i.nama+(i.variasi?' ('+i.variasi+')':'')).join(' + '),r.items.map(i=>i.sku||'').join(' + '),r.pcs,r.subtotal,r.total_bayar,r.kota||'',r.provinsi||'']));
});
