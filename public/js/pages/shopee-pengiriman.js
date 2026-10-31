/**
 * Shopee › Pengiriman: pesanan dari API / file ekspor — kotak status, grafik harian, tab daftar pesanan / per toko / kurir / produk / alasan batal, ekspor CSV; tabel toko;
 * dan Koneksi API Shopee (hubungkan toko & uji baca data). Data: /api/shopee/pengiriman, /pengiriman/daftar, /api/shopee/toko, /api/shopee-api/*.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*):
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
  put('spK1',int(n('perlu_dikirim')));put('spK1D',d.telat?int(d.telat)+' lewat batas kirim':'semua masih dalam batas kirim');
  put('spK2',int(n('dikirim')));put('spK2D',int((g.dikirim&&g.dikirim.pcs)||0)+' pcs · '+lpPct(n('dikirim'),aktif)+' dari pesanan aktif');
  put('spK3',int(n('terkirim')));put('spK3D',lpPct(n('terkirim'),aktif)+' dari pesanan aktif · '+rpFull((g.terkirim&&g.terkirim.nilai)||0));
  put('spK4',int(n('batal')));put('spK4D',lpPct(n('batal'),total)+' dari pesanan masuk · '+rpFull((g.batal&&g.batal.nilai)||0));
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
  if(!tambah){spRows=[];spTotal=0}
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
    $('spSub').innerHTML='<span class="ob-mini">'+chip('','Semua',total)+chip('perlu_dikirim','Perlu dikirim',g.perlu_dikirim||0)+(d.telat?chip('telat','Lewat batas',d.telat):'')+
      chip('dikirim','Dalam perjalanan',g.dikirim||0)+chip('terkirim','Terkirim',g.terkirim||0)+chip('batal','Batal',g.batal||0)+chip('retur','Pengembalian',g.retur||0)+
      (g.belum_bayar?chip('belum_bayar','Belum bayar',g.belum_bayar):'')+'</span>';
    $('spIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pesanan</th><th>Toko</th><th>Produk</th><th>Kurir / resi</th><th>Batas kirim / dikirim</th><th>Status</th><th class="n">Nilai</th><th>Kota</th></tr></thead><tbody>'+
      (spRows.map(r=>{
        const telat=r.status==='perlu_dikirim'&&r.batas_kirim&&r.batas_kirim<d.kini;
        return '<tr><td class="lr-nm"><b>'+esc(r.no_pesanan)+'</b>'+tkTagSumber(r.sumber)+'<small>'+spTglJam(r.dibuat)+'</small></td><td>'+esc(r.toko)+'</td>'+
          '<td class="sh">'+r.items.map(i=>esc(i.qty+'× '+(i.nama||'?')+(i.variasi?' ('+i.variasi+')':''))+'<small class="mm-sub">'+esc(i.sku||'tanpa SKU')+'</small>').join('')+'</td>'+
          '<td class="lr-nm">'+esc(r.kurir_singkat||'—')+'<small>'+(r.resi?esc(r.resi):'belum ada resi')+(r.antar?' · '+esc(r.antar):'')+'</small></td>'+
          '<td class="lr-nm">'+(r.waktu_kirim?'Dikirim '+spTglJam(r.waktu_kirim):r.batas_kirim?'<span class="'+(telat?'lr-neg':'')+'">Batas '+spTglJam(r.batas_kirim)+'</span>':'—')+'</td>'+
          '<td class="lr-nm">'+spTag(r.status)+'<small>'+esc(SP_TERKIRIM[r.status]||(r.status==='batal'?(r.alasan_batal?spAlasan(r.alasan_batal).label:''):r.status==='retur'?r.status_retur||'':''))+'</small></td>'+
          '<td class="n">'+rpFull(r.subtotal)+'<small>'+(r.cod?'COD':esc(r.metode_bayar||''))+'</small></td><td class="lr-nm">'+esc(r.kota||'—')+'<small>'+esc(r.provinsi||'')+'</small></td></tr>'}).join('')||
        spKosong(8,spToko.toko.length?'Tidak ada pesanan pada rentang / filter ini.':'Belum ada data — tambah toko lalu upload file pesanan.'))+'</tbody></table>';
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

function spRenderToko(){
  $('spTokoIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th>Sumber data</th><th>Gudang</th><th class="n">Pesanan tersimpan</th><th>Data pesanan sampai</th><th>Upload terakhir</th><th class="n">Aksi</th></tr></thead><tbody>'+
    (spToko.toko.map(t=>'<tr><td class="lr-nm"><b>'+esc(t.nama)+'</b><small>'+esc(t.username||'username belum diisi')+'</small></td><td>'+(t.mode==='api'?'<span class="tk-src api">⚡ API</span><small>'+(t.api_sejak?'terhubung · shop_id '+esc(t.shop_id||'—'):'belum terhubung — hubungkan di Koneksi API Shopee')+'</small>':'<span class="tk-src up">⬆ Upload manual</span>')+'</td>'+
      '<td>'+(t.gudang?esc(t.gudang):'<span class="tag warn">belum diatur</span>')+'</td>'+
      '<td class="n">'+int(t.pesanan)+'</td><td>'+(t.pesanan_terakhir?spTglJam(t.pesanan_terakhir):'—')+'</td><td>'+(t.upload_terakhir?tglWib(t.upload_terakhir,true):'—')+'</td>'+
      '<td class="n"><span class="bo-aksi"><button data-tk-ubah="'+t.id+'">Ubah</button>'+(t.pesanan?'':'<button class="hapus" data-tk-hapus="'+t.id+'">Hapus</button>')+'</span></td></tr>').join('')||
      spKosong(7,'Belum ada toko — klik <b>Tambah toko</b>.'))+'</tbody></table>';
}

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
