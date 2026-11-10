/**
 * Script utama dashboard: navigasi menu (bukaView), login & sesi, menu akun, hak akses per menu, fungsi bersama
 * yang dipakai file js/pages/*.js lewat window.*, dialog Shopee bersama, dan tabel sortir/sticky (dtJalan).
 * Script biasa (bukan module), dimuat SETELAH utils.js & api.js dan SEBELUM semua js/pages/*.js.
 * HTML-nya: web/index.html (kerangka + sidebar) dan web/views/*.html (satu file per halaman).
 */
(function(){
  // ---- navigation
  const nav=document.getElementById('nav');

  /** Pindah halaman sekaligus menandai tombol dan grup yang sedang aktif. */
  /** Menu yang memakai halaman menu lain (BCG Shopee / TikTok memakai halaman BCG yang sama) */
  const VIEW_HALAMAN={bcgshp:'bcg',bcgtt:'bcg'};
  window.bukaView=bukaView;   // dipakai file halaman di js/pages/ (fungsi di bawah ter-hoist)
  function bukaView(view){
    if(!bolehView(view))return;
    const hal=VIEW_HALAMAN[view]||view;
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='v-'+hal));
    nav.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
    window.scrollTo({top:0});
    if(view==='ringkasan')loadRingkasan();
    if(view==='iklan')openIklan();
    if(view==='konten')loadKonten();
    if(view==='mengantar')loadShip();
    if(view==='mgmasalah')loadMasalah();
    if(view==='mgsaldo')loadSaldo();
    if(view==='cs')openCs();
    if(view==='csproduk')openCsProduk();
    if(view==='pcsterjual')loadPcsTerjual();
    if(view==='users')loadUsers();
    if(view==='cloudflare')loadCf();
    if(view==='dataproduk')openDataProduk();
    if(view==='sku')openSku();
    if(view==='skumg')loadSkuMg();
    if(view==='produklist')openProdukList();
    if(view==='gudang')openGudang();
    if(view==='outbound')loadOutbound();
    if(view==='inrts')loadInRts();
    if(view==='inreq')loadReq();
    if(view==='stok')loadStok();
    if(view==='shpkirim')loadShpKirim();
    if(view==='shphasil')loadShpHasil();
    if(view==='shpiklan')loadShpIklan();
    if(view==='ttpesanan')loadTtPesanan();
    if(view==='tthasil')loadTtHasil();
    if(view==='iklansemua')loadIklanSemua();
    if(view==='ttiklan')loadTtIklan();
    if(view==='labarugi')loadLabaRugi();
    if(view==='summary')loadSummary();
    if(view==='marginproduk')loadMarginProduk();
    if(view==='aruskas')loadArusKas();
    if(view==='persediaan')loadPersediaan();
    if(view==='bcg')openBcg('soskom');
    if(view==='bcgshp')openBcg('shopee');
    if(view==='bcgtt')openBcg('tiktok');
    if(view==='wilayah')openWilayah();
    if(view==='pesanan')openOrders();
    if(view==='lead')loadLead();
    if(view==='pengaturan'){loadMeta();tmMuat();ttMuat()}
  }

  nav.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    // Tombol induk: buka daftar anaknya (dan tutup grup lain), lalu tampilkan
    // halaman anak pertamanya supaya satu klik sudah mengubah isi layar.
    if(b.classList.contains('par')){
      const grp=b.closest('.grp'),tadinya=grp.classList.contains('open');
      nav.querySelectorAll('.grp').forEach(g=>g.classList.remove('open'));
      if(!tadinya)grp.classList.add('open');
    }
    bukaView(b.dataset.view);
    // Layar kecil: bilah menu digeser ke samping — bawa tombol yang ditekan ke tengah
    if(matchMedia('(max-width:900px)').matches)b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
  });
  // ---- Sidebar ciut/lebar (desktop): tombol garis tiga di samping logo; pilihan diingat per browser
  const sideCiut=document.getElementById('sideCiut');
  function aturCiut(ciut){
    document.body.classList.toggle('side-ciut',ciut);
    const t=ciut?'Lebarkan menu':'Ciutkan menu';
    sideCiut.setAttribute('aria-label',t);sideCiut.title=t;sideCiut.setAttribute('aria-expanded',String(!ciut));
    // Saat ciut, nama menu tampil sebagai tooltip ikon
    nav.querySelectorAll('button').forEach(b=>{const l=b.querySelector('.l');if(l&&!b.closest('.sub'))b.title=ciut?l.textContent:''});
    const s=document.querySelector('.side .foot .sync');if(s)s.title=ciut?'Sinkron sekarang':'';
    if(!ciut)nav.querySelectorAll('.sub.melayang').forEach(x=>x.classList.remove('melayang'));
  }
  try{aturCiut(localStorage.getItem('sideCiut')==='1')}catch{aturCiut(false)}
  sideCiut.addEventListener('click',()=>{
    const ciut=!document.body.classList.contains('side-ciut');aturCiut(ciut);
    try{localStorage.setItem('sideCiut',ciut?'1':'0')}catch{}
  });
  // Submenu melayang di kanan ikon grup saat disorot (mode ciut)
  nav.querySelectorAll('.grp').forEach(g=>{
    const sub=g.querySelector('.sub');if(!sub)return;
    g.addEventListener('mouseenter',()=>{
      if(!document.body.classList.contains('side-ciut'))return;
      nav.querySelectorAll('.sub.melayang').forEach(x=>x!==sub&&x.classList.remove('melayang'));
      sub.classList.add('melayang');
      const r=g.querySelector('.par').getBoundingClientRect();
      sub.style.top=Math.max(8,Math.min(r.top,innerHeight-sub.offsetHeight-8))+'px';
    });
    g.addEventListener('mouseleave',()=>sub.classList.remove('melayang'));
    sub.addEventListener('click',()=>sub.classList.remove('melayang'));
  });
  // segmented controls (visual only)
  document.querySelectorAll('.seg').forEach(seg=>seg.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  }));

  // ---- Filter tanggal: setiap .seg rentang disembunyikan dan diganti satu tombol tanggal.
  // Klik tombol membuka popup (preset di kiri + kalender dua bulan). Terapkan meneruskan pilihan
  // ke seg asli (klik tombol preset yang cocok, atau tombol "custom" dengan data-from/data-to),
  // sehingga semua halaman tetap memuat data lewat handler seg & rentang() seperti biasa.
  const RG_PRESET=[
    ['today','Hari ini',t=>({from:t,to:t})],
    ['yesterday','Kemarin',t=>{const y=shift(t,-1);return{from:y,to:y}}],
    ['7','7 hari terakhir',t=>({from:shift(t,-6),to:t})],
    ['14','14 hari terakhir',t=>({from:shift(t,-13),to:t}),true],
    ['30','30 hari terakhir',t=>({from:shift(t,-29),to:t})],
    ['month','Bulan ini',t=>({from:t.slice(0,8)+'01',to:t})],
    ['lastmonth','Bulan kemarin',t=>{const z=shift(t.slice(0,8)+'01',-1);return{from:z.slice(0,8)+'01',to:z}}],
    ['90','90 hari terakhir',t=>({from:shift(t,-89),to:t})],
    ['year','Tahun ini',t=>({from:t.slice(0,4)+'-01-01',to:t})],
    ['all','Semua tanggal',null,true],
  ];// elemen ke-4 true = hanya tampil bila seg punya tombol data-range itu
  const RG_HARI=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const rgTgl=(s,o)=>new Intl.DateTimeFormat('id-ID',Object.assign({timeZone:'UTC'},o)).format(new Date(s+'T00:00:00Z'));
  const rgPendek=s=>rgTgl(s,{day:'2-digit',month:'short'})+(s.slice(0,4)===ymd(new Date()).slice(0,4)?'':' '+s.slice(0,4));
  const rgBulan=(ym,n)=>{const d=new Date(ym+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7)};
  const rgMobile=()=>matchMedia('(max-width:760px)').matches;
  const rgSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14h3"/></svg>';
  function rgLabelSeg(seg){
    const r=rentang(seg.id),teks=r.all?'Semua tanggal':rgPendek(r.from)+' - '+rgPendek(r.to);
    (seg.rgTrigs||[]).forEach(t=>t.querySelector('span').textContent=teks);
  }
  let rg=null;// {seg,a,z,hov,view,preset}
  const rgPanel=document.createElement('div');
  rgPanel.className='rg-panel';rgPanel.hidden=true;
  rgPanel.innerHTML='<div class="rg-pre"></div><div class="rg-cal"></div>'+
    '<div class="rg-kaki"><span class="rg-info"></span><button type="button" class="btn rg-batal">Batal</button><button type="button" class="btn rg-ok">Terapkan</button></div>';
  document.body.appendChild(rgPanel);
  const rgQ=s=>rgPanel.querySelector(s);
  /** Jadikan t tombol pembuka popup untuk seg (bisa lebih dari satu tombol per seg) */
  function rgPasang(seg,t){
    t.type='button';t.classList.add('rg-trig');t.setAttribute('aria-haspopup','dialog');t.setAttribute('aria-expanded','false');
    t.innerHTML=rgSvg+'<span>—</span><i class="rg-caret"></i>';
    (seg.rgTrigs=seg.rgTrigs||[]).push(t);
    t.addEventListener('click',e=>{e.stopPropagation();rg&&rg.anchor===t?rgTutup():rgBuka(seg,t)});
  }
  document.querySelectorAll('.seg').forEach(seg=>{
    if(!seg.querySelector('button[data-range="custom"]'))return;
    seg.classList.add('rg-asal');
    const t=document.createElement('button');
    seg.after(t);rgPasang(seg,t);
    seg.addEventListener('click',()=>rgLabelSeg(seg));
  });
  // ymd/shift baru terdefinisi di bawah, jadi label awal diisi setelah skrip selesai jalan
  setTimeout(()=>document.querySelectorAll('.seg.rg-asal').forEach(rgLabelSeg));

  function rgPresetAda(seg){
    return RG_PRESET.filter(p=>!p[3]||seg.querySelector('button[data-range="'+p[0]+'"]'));
  }
  function rgCocok(){
    if(!rg.a||!rg.z)return null;
    const t=ymd(new Date());
    const p=rgPresetAda(rg.seg).find(p=>{if(!p[2])return false;const r=p[2](t);return r.from===rg.a&&r.to===rg.z});
    return p?p[0]:null;
  }
  function rgBuka(seg,anchor){
    if(rg)rgTutup();
    const on=seg.querySelector('button.on'),r=rentang(seg.id),today=ymd(new Date());
    const mode=on?on.dataset.range:'month';
    rg={seg,anchor,a:r.all?null:r.from,z:r.all?null:r.to,hov:null,preset:mode==='all'?'all':null};
    if(!r.all)rg.preset=rgCocok();
    const akhir=(rg.z||today).slice(0,7);
    rg.view=rgMobile()?akhir:rgBulan(akhir,-1);
    rgQ('.rg-pre').innerHTML=rgPresetAda(seg).map(p=>'<button type="button" data-p="'+p[0]+'">'+p[1]+'</button>').join('');
    rgBangun();
    rgPanel.hidden=false;anchor.setAttribute('aria-expanded','true');
    const k=anchor.getBoundingClientRect(),w=rgPanel.offsetWidth;
    rgPanel.style.top=(window.scrollY+k.bottom+6)+'px';
    rgPanel.style.left=Math.max(8,Math.min(window.scrollX+k.right-w,window.scrollX+document.documentElement.clientWidth-w-8))+'px';
  }
  function rgTutup(){
    if(!rg)return;
    rg.anchor.setAttribute('aria-expanded','false');
    rgPanel.hidden=true;rg=null;
  }
  /** Gambar ulang dua bulan mulai rg.view (bulan kiri) */
  function rgBangun(){
    const today=ymd(new Date()),bulanIni=today.slice(0,7);
    const blok=ym=>{
      const awal=ym+'-01',dow=new Date(awal+'T00:00:00Z').getUTCDay(),mulai=shift(awal,-dow);
      let sel='';
      for(let i=0;i<42;i++){
        const d=shift(mulai,i),w=i%7,kls=[];
        if(w===0||w===6)kls.push('we');
        if(d.slice(0,7)!==ym)kls.push('luar');
        if(d===today)kls.push('hari-ini');
        sel+='<button type="button" data-d="'+d+'" class="'+kls.join(' ')+'"'+(d>today?' disabled':'')+'>'+(+d.slice(8))+'</button>';
      }
      const judul=rgTgl(awal,{month:'long',year:'numeric'});
      return '<div class="rg-bln"><div class="rg-bln-h"><button type="button" class="rg-nav kiri" data-nav="-1" aria-label="Bulan sebelumnya">‹</button>'+
        '<span>'+judul.charAt(0).toUpperCase()+judul.slice(1)+'</span>'+
        '<button type="button" class="rg-nav kanan" data-nav="1" aria-label="Bulan berikutnya"'+(ym>=bulanIni?' disabled':'')+'>›</button></div>'+
        '<div class="rg-dow">'+RG_HARI.map(h=>'<span>'+h+'</span>').join('')+'</div><div class="rg-grid">'+sel+'</div></div>';
    };
    rgQ('.rg-cal').innerHTML=blok(rg.view)+blok(rgBulan(rg.view,1));
    if(!rgMobile()&&rgBulan(rg.view,1)>=bulanIni)rgPanel.querySelectorAll('.rg-nav.kanan').forEach(b=>b.disabled=true);
    rgCat();
  }
  /** Perbarui sorotan rentang, preset aktif, info & tombol Terapkan tanpa membangun ulang grid */
  function rgCat(){
    let a=rg.a,z=rg.z;
    if(a&&!z&&rg.hov){z=rg.hov>a?rg.hov:a;a=rg.hov<a?rg.hov:a}
    rgPanel.querySelectorAll('.rg-grid button').forEach(b=>{
      const d=b.dataset.d;
      b.classList.toggle('ujung',!!a&&(d===a||d===(z||a)));
      b.classList.toggle('in',!!(a&&z)&&d>a&&d<z);
    });
    rgPanel.querySelectorAll('.rg-pre button').forEach(b=>b.classList.toggle('on',b.dataset.p===rg.preset));
    const info=rgQ('.rg-info');
    if(rg.preset==='all')info.textContent='Semua data';
    else if(rg.a&&rg.z){
      const n=Math.round((new Date(rg.z)-new Date(rg.a))/864e5)+1,f=s=>rgTgl(s,{day:'numeric',month:'short',year:'numeric'});
      info.textContent=f(rg.a)+' – '+f(rg.z)+' · '+n+' hari';
    }else info.textContent=rg.a?'Pilih tanggal akhir':'Pilih tanggal awal';
    rgQ('.rg-ok').disabled=!(rg.preset==='all'||(rg.a&&rg.z));
  }
  rgPanel.addEventListener('click',e=>{
    e.stopPropagation();
    if(!rg)return;
    const p=e.target.closest('.rg-pre button');
    if(p){
      const def=RG_PRESET.find(x=>x[0]===p.dataset.p);
      rg.preset=def[0];rg.hov=null;
      if(def[2]){const r=def[2](ymd(new Date())),ym=r.to.slice(0,7);rg.a=r.from;rg.z=r.to;rg.view=rgMobile()?ym:rgBulan(ym,-1)}
      else rg.a=rg.z=null;
      rgBangun();return;
    }
    const nav=e.target.closest('.rg-nav');
    if(nav&&!nav.disabled){rg.view=rgBulan(rg.view,+nav.dataset.nav);rgBangun();return}
    const d=e.target.closest('.rg-grid button');
    if(d&&!d.disabled){
      const v=d.dataset.d;
      if(!rg.a||rg.z){rg.a=v;rg.z=null}
      else if(v<rg.a){rg.z=rg.a;rg.a=v}
      else rg.z=v;
      rg.hov=null;rg.preset=rgCocok();rgCat();
    }
  });
  rgPanel.addEventListener('mouseover',e=>{
    const d=e.target.closest('.rg-grid button');
    if(!rg||!rg.a||rg.z||!d||d.disabled||rg.hov===d.dataset.d)return;
    rg.hov=d.dataset.d;rgCat();
  });
  rgQ('.rg-batal').addEventListener('click',rgTutup);
  rgQ('.rg-ok').addEventListener('click',()=>{
    if(!rg)return;
    const seg=rg.seg,pilih=rg.preset&&seg.querySelector('button[data-range="'+rg.preset+'"]');
    if(pilih){delete seg.dataset.from;delete seg.dataset.to}
    else{seg.dataset.from=rg.a;seg.dataset.to=rg.z}
    rgTutup();
    (pilih||seg.querySelector('button[data-range="custom"]')).click();
  });
  document.addEventListener('click',()=>{if(rg)rgTutup()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&rg)rgTutup()});
  window.addEventListener('resize',()=>{if(rg)rgTutup()});


  // ---- Ringkasan: lihat js/pages/ringkasan.js (dimuat setelah script ini)

  // ---- Mengantar: tiga submenu, seluruhnya dari data Mengantar
  //   Ringkasan Paket (/api/report/shipments) · Tracking & Masalah (/shipments/problems) · Saldo COD (/shipments/saldo)
  const SH_STATUS={
    'ACTIVE':'Belum diproses kurir','AWAITING PICKUP':'Menunggu pickup','WAREHOUSE':'Di gudang kurir',
    'ORIGIN GATEWAY':'Berangkat dari kota asal','SORTING CENTER':'Di pusat sortir','TRANSIT CITY':'Transit antarkota',
    'INBOUND STATION':'Tiba di hub tujuan','INBOUND PROCESS':'Diproses di hub tujuan','DELIVERY COURIER':'Dibawa kurir ke penerima',
    'UNDELIVERED':'Gagal antar','DELIVERY PROBLEM':'Masalah pengiriman','SHIPMENT RETURN':'Proses retur','PARCEL LOST':'Paket hilang',
    'DELIVERED':'Terkirim','RTS':'RTS · kembali ke pengirim',
  };
  const SH_BURUK=new Set(['UNDELIVERED','DELIVERY PROBLEM','SHIPMENT RETURN','PARCEL LOST','RTS']);
  const shStatus=s=>{const k=String(s||'').toUpperCase();const l=SH_STATUS[k]||s||'—';
    return SH_BURUK.has(k)?'<span class="tag loss">'+esc(l)+'</span>':k==='DELIVERED'?'<span class="tag rev">'+esc(l)+'</span>':esc(l)};

  /**
   * Rentang tanggal (WIB) dari filter seg, dipakai semua halaman:
   * today | yesterday | month | lastmonth | 7/14/30/90 (hari terakhir termasuk hari ini) | all | custom (data-from/data-to pada seg)
   */
  window.rentang=rentang;   // dipakai file halaman di js/pages/ (fungsi di bawah ter-hoist)
  function rentang(segId){
    const today=ymd(new Date()),seg=document.getElementById(segId);
    const on=seg&&seg.querySelector('button.on');
    const mode=on?on.dataset.range:'month';
    if(mode==='custom'&&seg.dataset.from&&seg.dataset.to)return{from:seg.dataset.from,to:seg.dataset.to};
    if(mode==='today')return{from:today,to:today};
    if(mode==='yesterday'){const y=shift(today,-1);return{from:y,to:y}}
    if(mode==='all')return{from:'2020-01-01',to:today,all:true};
    if(mode==='lastmonth'){const akhir=shift(today.slice(0,8)+'01',-1);return{from:akhir.slice(0,8)+'01',to:akhir}}
    if(/^\d+$/.test(mode))return{from:shift(today,-(+mode-1)),to:today};
    return{from:today.slice(0,8)+'01',to:today};
  }
  /** Query string bersama: rentang + kurir + COD (bila ada kontrolnya) */
  function shQuery(p){
    const r=rentang(p+'Range'),q=new URLSearchParams({from:r.from,to:r.to});
    const k=$(p+'Kurir').value;if(k)q.set('courier',k);
    const cod=document.querySelector('#'+p+'Cod button.on');if(cod&&cod.dataset.cod)q.set('cod',cod.dataset.cod);
    return {q,r};
  }
  /** Isi pilihan kurir dari data; pilihan yang sedang aktif dipertahankan */
  function shIsiKurir(id,list){
    const sel=$(id),pilih=sel.value;
    sel.innerHTML='<option value="">Semua kurir</option>'+(list||[]).map(k=>'<option'+(k===pilih?' selected':'')+'>'+esc(k)+'</option>').join('');
  }
  const shSync=d=>d.last_sync?' · sinkron terakhir '+tglWib(d.last_sync,true)+' WIB':'';
  const shKecil=t=>' <span class="pc">'+t+'</span>';
  const shKosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+(t||'Belum ada paket pada rentang ini.')+'</td></tr>';
  const shGagal=(ids,e)=>ids.forEach(id=>$(id).innerHTML=shKosong(10,'<span style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</span>'));
  // dipakai js/pages/saldo-cod.js, mengantar-paket.js, mengantar-tracking.js & inventory-inbound-rts.js
  Object.assign(window,{shQuery,shIsiKurir,shSync,shKecil,shKosong,shGagal,shStatus,rgTgl});

  // ---------- 1. Ringkasan Paket: lihat js/pages/mengantar-paket.js (dimuat setelah script ini)

  // ---------- 2. Tracking & Masalah: lihat js/pages/mengantar-tracking.js (dimuat setelah script ini)

  // ---------- 3. Saldo COD: lihat js/pages/saldo-cod.js (dimuat setelah script ini)

  // ---- Order › Performa Lead: lihat js/pages/order.js

  // ---- Login & api(): lihat js/api.js. Setelah login berhasil, periksa ulang hak akses akun yang baru masuk.
  document.addEventListener('login-berhasil',()=>{api('/api/me').then(terapkanAkses).catch(()=>{})});


  // ---- Sales › Performa CS: lihat js/pages/sales-cs.js (dimuat setelah script ini)
  let csStoresLoaded=false;
  /** Satu panggilan untuk dua keperluan: isi dropdown store (sekali) dan segarkan log sinkron. */
  window.loadSettings=loadSettings;   // dipakai file halaman di js/pages/ (fungsi di bawah ter-hoist)
  async function loadSettings(){
    const s=await api('/api/settings');
    if(!csStoresLoaded&&(s.stores||[]).length){
      csStoresLoaded=true;
      const opsi=s.stores.map(st=>'<option value="'+esc(st.id)+'">'+esc(st.name)+'</option>').join('');
      ['csStore','ordStore','cpStore','wlStore','dpStore','bcStore'].forEach(id=>{const el=$(id);if(el)el.insertAdjacentHTML('beforeend',opsi)});
    }
    renderSyncLog(s.sync_log||[]);
    return s;
  }

  // ---- Iklan Meta › Produk Iklan & Gabungan produk: lihat js/pages/data-produk.js (dimuat setelah script ini)
  // ---- Analisis › BCG Matrix: lihat js/pages/bcg.js (dimuat setelah script ini)

  // ---- Data Produk › Manajemen SKU: lihat js/pages/data-sku.js (dimuat setelah script ini)
  // Ikon tombol tabel, dipakai banyak halaman
  const SKU_IKON_EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const SKU_IKON_HAPUS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
  // Data List Produk, dipakai bersama List Produk & Manajemen SKU; lewat accessor supaya js/pages/data-sku.js membaca & mengisi variabel yang sama
  let plData=null;
  Object.defineProperty(window,'plData',{get:()=>plData,set:v=>{plData=v}});

  // ---- Inventory › List Produk: lihat js/pages/inventory-produk.js (dimuat setelah script ini)
  // ---- Inventory › List Gudang: lihat js/pages/inventory-gudang.js (dimuat setelah script ini)
  // Label & hitungan gudang, dipakai List Gudang, Outbound, Manajemen SKU & SKU Mengantar
  const GD_JENIS={sendiri:['Milik sendiri','rev'],fulfillment:['Fulfillment','info'],dropship:['Supplier dropship','pb']};
  const gdTag=j=>{const x=GD_JENIS[j]||[j,''];return '<span class="tag '+x[1]+'">'+esc(x[0])+'</span>'};
  const gdPersen=(n,t)=>t?pct(100*n/t):'—';
  const gdBiayaTeks=r=>[r.biaya_penanganan?'penanganan '+rpFull(r.biaya_penanganan):'',r.biaya_lain?(r.biaya_lain_ket||'lain')+' '+rpFull(r.biaya_lain):''].filter(Boolean).join(' + ');
  Object.assign(window,{GD_JENIS,gdTag,gdPersen,gdBiayaTeks});   // dipakai file halaman di js/pages/

  window.skuParseCsv=skuParseCsv;   // dipakai js/pages/data-sku.js (fungsi di bawah ter-hoist)
  /** CSV sederhana: pemisah koma atau titik koma (Excel Indonesia), sel boleh berkutip. */
  function skuParseCsv(teks){
    teks=teks.replace(/^﻿/,'');
    const baris1=teks.split(/\r?\n/)[0]||'',pisah=(baris1.split(';').length>baris1.split(',').length)?';':',';
    const out=[];let row=[],sel='',kutip=false;
    for(let i=0;i<teks.length;i++){
      const ch=teks[i];
      if(kutip){if(ch==='"'){if(teks[i+1]==='"'){sel+='"';i++}else kutip=false}else sel+=ch}
      else if(ch==='"')kutip=true;
      else if(ch===pisah){row.push(sel);sel=''}
      else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&teks[i+1]==='\n')i++;row.push(sel);sel='';if(row.some(v=>v.trim()))out.push(row);row=[]}
      else sel+=ch;
    }
    row.push(sel);if(row.some(v=>v.trim()))out.push(row);
    return out;
  }

  // ---- Inventory › Outbound: lihat js/pages/inventory-outbound.js (dimuat setelah script ini)
  /**
   * Pecah paket ke produk (dipakai Outbound, Inbound RTS, Stok): mengisi x.g (gudang), x.isi [{key,nama,pcs,hpp}],
   * x.belum, x.sebab ('scalev' = SKU varian Scalev belum ada di Manajemen SKU), x.sumber (scalev | manual), x.pcs, x.hppKeluar.
   * Paket ber-order Scalev: varian order → SKU yang ditautkan di Scalev → isi SKU. Paket tanpa order Scalev: pasangan manual
   * nama barang di SKU Mengantar (SKU × qty, atau langsung ke List Produk).
   */
  function pecahPaket(d){
    const gdg=new Map(d.gudang.map(g=>[g.id,g])),sku=new Map(d.sku.map(s=>[s.id,s])),prd=new Map(d.produk.map(p=>[p.id,p])),isi=new Map();
    for(const i of d.isi)isi.set(i.sku_id,[...(isi.get(i.sku_id)||[]),i]);
    // Nama barang yang dipasangkan langsung ke List Produk (tanpa SKU)
    const langsung=new Map();
    for(const b of d.barang_produk||[]){const k=b.goods.toLowerCase();langsung.set(k,[...(langsung.get(k)||[]),b])}
    // Riwayat HPP List Produk (urut naik per produk): paket memakai HPP yang berlaku pada tanggal paket dibuat
    const riw=new Map();
    for(const r of d.hpp_riwayat||[])riw.set(r.produk_id,[...(riw.get(r.produk_id)||[]),r]);
    let tgl='';
    const hppPada=(id,p)=>{let h=p.hpp;for(const r of riw.get(id)||[]){if(r.berlaku>tgl)break;h=r.hpp}return h};
    const keProduk=(id,pcs)=>{const p=prd.get(id)||{nama:'?',hpp:0};return {key:'p'+id,nama:p.nama,pcs,hpp:hppPada(id,p)}};
    // SKU × qty → isi SKU dari List Produk, atau SKU itu sendiri bila belum punya isi
    const dariSku=(s,qty)=>(isi.get(s.id)||[]).length?isi.get(s.id).map(i=>keProduk(i.produk_id,i.qty*qty))
      :[{key:'s'+s.id,nama:s.produk+' ('+s.sku+')',pcs:qty,hpp:s.hpp_dasar==null?s.hpp:s.hpp_dasar}];
    const manual=x=>{const s=x.sku_id&&sku.get(x.sku_id);return s?dariSku(s,x.sku_qty):(langsung.get(x.goods.toLowerCase())||[]).map(i=>keProduk(i.produk_id,i.qty))};
    // Pesanan Shopee / TikTok: Seller SKU tiap barang → Manajemen SKU (kode SKU, tanpa beda huruf besar/kecil)
    const perKode=new Map(d.sku.map(s=>[String(s.sku||'').trim().toUpperCase(),s]));
    for(const x of d.rows){
      x.g=gdg.get(x.gudang_id)||null;
      tgl=x.created_at?ymd(new Date(x.created_at)):'';
      x.sebab='';x.sumber='';x.goods=x.goods||'';
      if(x.mp){
        let br=[];try{br=JSON.parse(x.mp_isi||'[]')}catch(e){}
        const kurang=br.filter(v=>!perKode.get(v.sku));
        if(br.length&&!kurang.length){x.isi=br.flatMap(v=>dariSku(perKode.get(v.sku),Number(v.qty)||1));x.sumber=x.mp}
        else{x.isi=[];x.sebab='mp';x.kurangSku=kurang.map(v=>v.sku||v.nama||'?')}
        x.belum=!x.isi.length;x.pcs=x.isi.reduce((a,i)=>a+i.pcs,0);x.hppKeluar=x.isi.reduce((a,i)=>a+i.pcs*i.hpp,0);
        continue;
      }
      const sv=Array.isArray(x.scalev)&&x.scalev.length?x.scalev:null;
      const kurang=sv?sv.filter(v=>!sku.get(v.sku_id)):[];
      if(sv&&!kurang.length){x.isi=sv.flatMap(v=>dariSku(sku.get(v.sku_id),v.qty));x.sumber='scalev'}
      else{
        // Varian Scalev yang SKU-nya belum ada di Manajemen SKU: pakai pasangan manual bila ada, selain itu belum terhitung
        x.isi=manual(x);if(x.isi.length)x.sumber='manual';
        if(!x.isi.length&&sv){x.sebab='scalev';x.kurangSku=kurang.map(v=>v.sku||v.nama)}
      }
      x.belum=!x.isi.length;
      x.pcs=x.isi.reduce((a,i)=>a+i.pcs,0);
      x.hppKeluar=x.isi.reduce((a,i)=>a+i.pcs*i.hpp,0);
    }
  }

  /** Teks paket yang isinya belum terhitung: SKU varian Scalev belum ada, atau nama barang (tanpa order Scalev) belum dipasangkan */
  const belumTag=x=>x.sebab==='mp'?'<span class="tag warn" title="Seller SKU: '+esc((x.kurangSku||[]).join(', '))+'">SKU '+(x.mp==='tiktok'?'TikTok':'Shopee')+' belum di Manajemen SKU</span>':x.sebab==='scalev'?'<span class="tag warn" title="SKU varian Scalev: '+esc((x.kurangSku||[]).join(', '))+'">SKU Scalev belum di Manajemen SKU</span>':'<span class="tag warn">belum dipasangkan</span>';
  /**
   * Peringatan paket yang isinya belum terhitung, dipisah menurut sebabnya: n semua, nSv Scalev (sku = daftar SKU Scalev),
   * nMp pesanan Shopee / TikTok (skuMp = Seller SKU yang belum ada di Manajemen SKU), sisanya pasangan manual Mengantar
   */
  function belumPesan({n,nSv,sku,nMp=0,skuMp=[]},akibat){
    const w=[];
    if(nMp)w.push(int(nMp)+' pesanan <b>Shopee / TikTok</b> berisi Seller SKU yang belum ada di <b>Manajemen SKU</b>'+(skuMp.length?' ('+esc(skuMp.slice(0,6).join(', '))+(skuMp.length>6?', …':'')+')':'')+
      ', '+akibat+' — tambahkan SKU itu di Manajemen SKU (atau <b>Buat SKU otomatis</b> di Shopee › Pengiriman → Per produk).');
    if(n-nSv-nMp>0)w.push(int(n-nSv-nMp)+' paket <b>tanpa order Scalev</b> nama barangnya belum dipasangkan, '+akibat+' — pasangkan di <b>Data Produk › SKU Mengantar</b>.');
    if(nSv)w.push(int(nSv)+' paket ber-order Scalev memakai SKU varian yang belum ada di <b>Manajemen SKU</b>'+(sku.length?' ('+esc(sku.slice(0,6).join(', '))+(sku.length>6?', …':'')+')':'')+
      ', '+akibat+' — tambahkan SKU itu di Manajemen SKU (atau klik <b>Tarik dari Scalev</b>), atau isi SKU variannya di Scalev.');
    return w;
  }
  const belumDari=list=>{const sv=list.filter(x=>x.sebab==='scalev'),mp=list.filter(x=>x.sebab==='mp');
    return {n:list.length,nSv:sv.length,sku:[...new Set(sv.flatMap(x=>x.kurangSku||[]))],nMp:mp.length,skuMp:[...new Set(mp.flatMap(x=>x.kurangSku||[]))]}};
  Object.assign(window,{pecahPaket,belumTag,belumPesan,belumDari});   // dipakai js/pages/inventory-outbound.js

  // ---- Inventory › Stok: lihat js/pages/inventory-stok.js (dimuat setelah script ini)
  // Hitung stok, dipakai Stok, Inbound REQ & Nilai Persediaan
  const stDicatat=g=>!!g;                  // semua jenis gudang dicatat stoknya (sendiri, fulfillment / mitra, dropship)
  /** Gudang yang sudah punya pergerakan stok tetapi stok awalnya belum diisi (gudang tanpa pergerakan tidak diingatkan) */
  const stTanpaAwal=d=>d.gudang.filter(g=>stDicatat(g)&&!d.mutasi.some(m=>m.jenis==='awal'&&m.gudang_id===g.id)&&(d.stok||[]).some(s=>s.gudang.id===g.id));
  /** Ringkasan paket yang belum terhitung di stok → argumen belumPesan */
  const stBelum=ws=>({n:ws.belum,nSv:ws.belumSv,sku:[...ws.kurangSku],nMp:ws.belumMp,skuMp:[...ws.kurangMp]});
  /** Hitung stok per produk × gudang (tanpa menyentuh tampilan): stok awal, opname, masuk REQ, paket keluar, retur diterima baik */
  function stHitung(d){
    pecahPaket(d);
    const m=new Map(),gudang=new Map(d.gudang.map(g=>[g.id,g])),produk=new Map(d.produk.map(p=>[p.id,p]));
    const sel=(p,g)=>{const k=p+'|'+g;if(!m.has(k))m.set(k,{produk:produk.get(p)||{id:p,nama:'?',hpp:0},gudang:gudang.get(g)||{id:g,nama:'?'},awal:null,masuk:0,keluar:0,retur:0,opname:0,keluar30:0});return m.get(k)};
    // Opname sebelum tanggal mulai stok sudah tercakup di stok awal → diabaikan
    for(const x of d.mutasi){if(x.jenis!=='awal'&&x.tanggal<d.mulai)continue;const s=sel(x.produk_id,x.gudang_id);if(x.jenis==='awal')s.awal=x.qty;else s.opname+=x.qty}
    for(const x of d.masuk||[])if(x.tanggal>=d.mulai)sel(x.produk_id,x.gudang_id).masuk+=x.qty;
    const dari30=shift(d.hari_ini,-29),w={belum:0,belumSv:0,kurangSku:new Set(),belumMp:0,kurangMp:new Set(),tanpaGudang:0,skuKosong:0};
    for(const x of d.rows){
      const g=x.gudang_id&&gudang.get(x.gudang_id);
      if(g&&!stDicatat(g))continue;
      // Retur menambah stok bila diterima baik dan tanggal RTS-nya sejak tanggal mulai (retur sebelumnya sudah ada di stok awal)
      const keluar=ymd(new Date(x.created_at))>=d.mulai,kembali=x.kondisi==='baik'&&x.diterima_at&&ymd(new Date(x.rts_at))>=d.mulai;
      if(!keluar&&!kembali)continue;
      if(!g){if(keluar)w.tanpaGudang++;continue}
      if(x.belum){if(keluar){w.belum++;if(x.sebab==='scalev'){w.belumSv++;(x.kurangSku||[]).forEach(k=>w.kurangSku.add(k))}
        else if(x.sebab==='mp'){w.belumMp++;(x.kurangSku||[]).forEach(k=>w.kurangMp.add(k))}}continue}
      for(const i of x.isi){
        if(i.key[0]!=='p'){if(keluar)w.skuKosong++;continue}     // SKU tanpa isi List Produk: stoknya tidak bisa dilacak
        const s=sel(Number(i.key.slice(1)),g.id);
        if(keluar){s.keluar+=i.pcs;if(ymd(new Date(x.created_at))>=dari30)s.keluar30+=i.pcs}
        if(kembali)s.retur+=i.pcs;
      }
    }
    for(const s of m.values()){
      s.stok=(s.awal||0)+s.masuk-s.keluar+s.retur+s.opname;
      s.perHari=s.keluar30/30;
      s.hari=s.perHari?s.stok/s.perHari:null;
      s.nilai=Math.max(0,s.stok)*(s.produk.hpp||0);
    }
    d.stok=[...m.values()].filter(s=>stDicatat(s.gudang));
    d.warn=w;
  }
  Object.assign(window,{stDicatat,stTanpaAwal,stBelum,stHitung});   // dipakai js/pages/inventory-stok.js & inventory-req.js

  // ---- Inventory › Inbound REQ: lihat js/pages/inventory-req.js (dimuat setelah script ini)

  // ---- Inventory › Inbound RTS: lihat js/pages/inventory-inbound-rts.js (dimuat setelah script ini; memuat badge menu saat startup)
  /** Nomor resi paket: pesanan Shopee / TikTok memakai resi kurir (Order ID di bawahnya); belum ada resi → Order ID */
  function resiPaket(x){
    if(!x.mp)return esc(x.receipt||'—');
    return x.resi?esc(x.resi)+'<small class="mm-sub">Order ID '+esc(x.receipt)+'</small>':esc(x.receipt||'—')+'<small class="mm-sub">Order ID · resi belum ada</small>';
  }
  const cocokResi=(x,q)=>String(x.receipt||'').toLowerCase().includes(q)||String(x.resi||'').toLowerCase().includes(q);
  Object.assign(window,{resiPaket,cocokResi});   // dipakai js/pages/inventory-outbound.js

  // ---- Shopee › Pengiriman & Koneksi API Shopee: lihat js/pages/shopee-pengiriman.js (dimuat setelah script ini)
  // Dipakai bersama halaman Shopee, Pengaturan, dan form upload
  let spToko=null,spUp=null,spEdit=null;
  // ---- Shopee: pilihan toko + sumber data (API / upload) + kesehatan data, dipakai Pengiriman (sp), Penghasilan (ph), Iklan (si)
  const TK_JENIS={sp:'pesanan',ph:'penghasilan',si:'iklan'};
  const TK_JENIS_LBL={pesanan:'pesanan',penghasilan:'dana dilepas',iklan:'laporan iklan'};
  const TK_TOLERANSI=2;                                  // data tertinggal lebih dari 2 hari → pengingat
  let tkToko=null;
  const tkTgl=s=>s?tglWib(String(s).slice(0,10)+'T12:00:00+07:00'):'—';
  const tkSelisih=(a,b)=>Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/864e5);
  /** Status satu toko pada rentang: {kelas, ikon, teks, kurang} */
  function tkNilai(t,s,r){
    const hari=ymd(new Date()),batas=r.to<hari?r.to:hari;
    if(t.mode==='api'&&!t.api_sejak)return {kelas:'loss',ikon:'❌',teks:'API belum terhubung',kurang:null};
    if(!s||!s.n)return {kelas:'loss',ikon:'❌',teks:t.mode==='api'?'Belum tersinkron':'Belum upload',kurang:null};
    const kurang=Math.max(0,tkSelisih(s.akhir_rentang,batas));
    return kurang>TK_TOLERANSI?{kelas:'spend',ikon:'⚠',teks:'Kurang '+int(kurang)+' hari',kurang}:{kelas:'rev',ikon:'✅',teks:'Terkini',kurang};
  }
  /** Label sumber di chip: ⚡API · … atau ⬆Upload · data s.d. … */
  function tkLabel(t,s){
    if(t.mode==='api')return '<span class="tk-src api">⚡ API</span>'+(t.api_sejak?(s&&s.terakhir?' · s.d. '+tkTgl(s.terakhir):' · menunggu sinkron'):' · belum terhubung');
    return '<span class="tk-src up">⬆ Upload</span>'+(s&&s.terakhir?' · data s.d. '+tkTgl(s.terakhir):' · belum ada data');
  }
  async function tkMuat(p){
    const r=rentang(p+'Range'),jenis=TK_JENIS[p];
    try{
      const [t,st]=await Promise.all([spToko?Promise.resolve(spToko):api('/api/shopee/toko'),api('/api/shopee/status?'+new URLSearchParams({from:r.from,to:r.to,jenis}))]);
      tkToko=t;if(!spToko)spToko=t;tkRender(p,st,r);
    }catch(e){$(p+'TkBar').innerHTML='<span style="color:var(--loss)">Gagal memuat toko ('+esc(e.message)+')</span>'}
  }
  function tkRender(p,st,r){tkBar(p,tkToko.toko||[],st,r,TK_JENIS_LBL[TK_JENIS[p]],'Belum ada toko — tambahkan di Pengaturan › Toko Marketplace.')}
  /** Chip pilihan toko + kartu kesehatan data + tombol Sinkron/Upload mengikuti mode toko. Dipakai Shopee (sp/ph/si) & TikTok (tp/th). */
  function tkBar(p,toko,st,r,jenisLbl,kosong){
    const pilih=$(p+'Toko').value,per=new Map((st.toko||[]).map(s=>[s.toko_id,s]));
    // Pilihan toko di select tersembunyi harus ada supaya filter halaman tetap jalan
    const sel=$(p+'Toko');if([...sel.options].length!==toko.length+1)sel.innerHTML='<option value="">Semua toko</option>'+toko.map(t=>'<option value="'+t.id+'">'+esc(t.nama)+'</option>').join('');
    sel.value=pilih;
    const nilai=toko.map(t=>({t,s:per.get(t.id),v:tkNilai(t,per.get(t.id),r)}));
    const masalah=nilai.filter(x=>x.v.kelas!=='rev').length;
    $(p+'TkBar').innerHTML='<button class="tk-chip'+(pilih?'':' on')+'" data-tk=""><b>Semua toko</b><small>'+int(toko.length)+' toko'+(masalah?' · <span class="tk-warn">'+int(masalah)+' perlu dicek</span>':'')+'</small></button>'+
      nilai.map(x=>'<button class="tk-chip'+(String(x.t.id)===pilih?' on':'')+'" data-tk="'+x.t.id+'" title="'+esc(x.v.teks)+'"><b>'+esc(x.t.nama)+(x.v.kelas!=='rev'?' <span class="tk-ikon">'+x.v.ikon+'</span>':'')+'</b><small>'+tkLabel(x.t,x.s)+'</small></button>').join('')+
      (toko.length?'':'<span style="color:var(--muted)">'+kosong+'</span>');
    // Kesehatan data: hanya saat "Semua toko"
    const box=$(p+'Sehat');box.hidden=!!pilih||!toko.length;
    if(!box.hidden)box.innerHTML='<div class="card-h"><div><h3>Kesehatan data '+jenisLbl+'</h3><p>'+esc(fmtRange(r.from,r.to))+' · pengingat bila data tertinggal lebih dari '+TK_TOLERANSI+' hari · klik baris untuk melihat tokonya</p></div></div>'+
      '<div class="card-b tbl-wrap"><table class="sku-tbl gd-tbl lr-tbl tk-tbl" data-dt="off"><thead><tr><th>Toko</th><th>Sumber</th><th>Data terakhir</th><th>Cakupan periode ini</th><th class="n">Data</th><th>Status</th></tr></thead><tbody>'+
      nilai.map(x=>{const s=x.s||{};
        return '<tr data-tk="'+x.t.id+'"><td class="nm">'+esc(x.t.nama)+'</td><td>'+(x.t.mode==='api'?'<span class="tk-src api">⚡ API</span>':'<span class="tk-src up">⬆ Upload</span>')+'</td>'+
          '<td>'+tkTgl(s.terakhir)+(x.t.mode!=='api'&&s.upload_terakhir?'<small class="mm-sub">upload '+tglWib(s.upload_terakhir,true)+'</small>':'')+'</td>'+
          '<td>'+(s.n?esc(fmtRange(s.awal_rentang,s.akhir_rentang)):'<span style="color:var(--muted)">belum ada</span>')+'</td>'+
          '<td class="n">'+int(s.n||0)+(s.n_api?'<small>'+int(s.n_api)+' dari API</small>':'')+'</td>'+
          '<td><span class="tag '+x.v.kelas+'">'+x.v.ikon+' '+esc(x.v.teks)+'</span></td></tr>'}).join('')+'</tbody></table></div>';
    // Tombol utama mengikuti mode toko terpilih: API → Sinkron; Upload → Upload file (API: upload hanya untuk data lama)
    const t=toko.find(x=>String(x.id)===pilih),adaApi=toko.some(x=>x.mode==='api'),up=$(p+'UpBtn'),sy=$(p+'SyncBtn');
    const modeApi=t?t.mode==='api':false;
    sy.hidden=!(modeApi||(!t&&adaApi));
    up.classList.toggle('primary',!modeApi);up.classList.toggle('ghost',modeApi);
    up.lastChild.textContent=modeApi?'Upload data lama':'Upload file';
    up.title=modeApi?'Toko ini memakai API — upload hanya untuk melengkapi data sebelum API terhubung; data dari API tidak ditimpa':'';
  }
  /** Klik chip / baris kesehatan → pilih toko di select tersembunyi */
  function tkPasangPilih(p){
    const pilihToko=id=>{const sel=$(p+'Toko');if(![...sel.options].some(o=>o.value===id))sel.insertAdjacentHTML('beforeend','<option value="'+id+'"></option>');
      sel.value=id;sel.dispatchEvent(new Event('change'))};
    $(p+'TkBar').addEventListener('click',e=>{const b=e.target.closest('[data-tk]');if(b)pilihToko(b.dataset.tk)});
    $(p+'Sehat').addEventListener('click',e=>{const b=e.target.closest('tr[data-tk]');if(b)pilihToko(b.dataset.tk)});
  }
  for(const p of Object.keys(TK_JENIS)){
    tkPasangPilih(p);
    // Cek kondisi sebenarnya: kunci (uji / live) → toko terhubung → sinkron
    $(p+'SyncBtn').addEventListener('click',async()=>{
      let d;try{d=await api('/api/shopee-api/toko')}catch(e){return alert('Kunci API Shopee belum dipasang (secret SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY).')}
      if(d.sandbox)return alert('Kunci API Shopee yang terpasang masih kunci UJI (sandbox), belum kunci Live.\n\nJalankan di terminal proyek:\n  npx.cmd wrangler secret put SHOPEE_PARTNER_ID   → isi Live Partner_id\n  npx.cmd wrangler secret put SHOPEE_PARTNER_KEY  → isi Live API Partner Key\n\nSetelah itu buka Pengaturan › Toko Marketplace › Hubungkan API.');
      const api1=(tkToko&&tkToko.toko||[]).filter(t=>t.mode==='api'),belum=api1.filter(t=>!t.api_sejak);
      if(!d.toko.length||belum.length)return alert('Kunci Live sudah terpasang ✓\n\n'+(belum.length?'Toko berikut belum dihubungkan: '+belum.map(t=>t.nama).join(', ')+'.\n':'')+'Buka Pengaturan › Toko Marketplace, klik Hubungkan API pada toko itu, lalu login dengan akun penjual toko tersebut.');
      const btn=$(p+'SyncBtn'),asli=btn.innerHTML;btn.disabled=true;btn.lastChild.textContent='Menyinkron…';
      try{
        const h=await api('/api/shopee/sinkron',{method:'POST'});
        if(!h.ok)return alert('Sinkron Shopee: '+(h.pesan||'gagal'));
        const tk=x=>x&&x.gagal?'GAGAL — '+x.gagal:int(x.disimpan)+' disimpan ('+int(x.baru)+' baru)'+(x.selesai===false?' · sebagian, sisanya ikut sinkron berikutnya':'');
        alert('Sinkron Shopee selesai:\n\n'+(h.hasil.map(x=>x.toko+'\n· Pesanan: '+tk(x.pesanan)+'\n· Penghasilan: '+tk(x.penghasilan)+'\n· Iklan: '+(!x.iklan?'-':x.iklan.gagal?'GAGAL — '+x.iklan.gagal:int(x.iklan.hari)+' hari, '+int(x.iklan.kampanye)+' kampanye'+(x.iklan.dilewati_file?' ('+int(x.iklan.dilewati_file)+' hari dilewati karena sudah ada upload file)':''))).join('\n\n')||'Tidak ada toko bermode API yang terhubung.'));
        tkToko=null;spToko=null;
        if(p==='sp')loadShpKirim();else if(p==='ph')loadShpHasil();else loadShpIklan();
      }catch(e){alert('Sinkron Shopee gagal: '+e.message)}
      finally{btn.disabled=false;btn.innerHTML=asli}
    });
  }
  const tkTagSumber=s=>s==='api'?' <span class="tag info" title="Dari sinkron API Shopee">API</span>':' <span class="tag" title="Dari upload file">File</span>';
  // ---- Pengaturan › Toko Marketplace: lihat js/pages/pengaturan.js (dimuat setelah script ini)
  // -- Buat SKU otomatis: kode SKU Shopee yang belum ada di Manajemen SKU → tebak isinya dari List Produk, dicek dulu sebelum disimpan
  let spOto=null;
  /** Ukuran yang disebut di teks, mis. ["15ml"] */
  const spUkuran=t=>[...new Set((String(t||'').toLowerCase().match(/\d+(?:[.,]\d+)?\s*ml\b/g)||[]).map(x=>x.replace(/\s+/g,'').replace(',','.')))];
  /** Qty per paket dari teks: "Beli 2 Gratis 1" → 3, "Isi 3 Pcs" / "Beli 6" / "6 Pcs" → angkanya; null = tidak disebut */
  function spTebakQty(t){
    t=String(t||'').toLowerCase();let m;
    if((m=t.match(/beli\s*(\d+)\s*(?:gratis|free|bonus)\s*(\d+)/)))return +m[1]+ +m[2];
    if((m=t.match(/(?:isi|beli)\s*(\d+)\b(?!\s*ml)/)))return +m[1];
    if((m=t.match(/(\d+)\s*(?:pcs|pc|botol|btl|pack|pak)\b/)))return +m[1];
    return null;
  }
  const spKataProduk=p=>String(p.nama).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!/^\d+ml$/.test(w));
  /**
   * Tebak isi satu SKU Shopee → {items:[{produk_id,qty}], dasar, yakin}:
   * 1. Pola kode SKU yang sudah ada: satu angka di kode diganti 1 (S3TMJ → S1TMJ × 3), atau gabungan dua kode
   *    dengan akhiran yang sama (S1SA1TMJ → S1TMJ + SA1TMJ).
   * 2. Nama produk & variasi: produk List Produk yang mereknya (kata pertama) disebut, ukurannya sama (15 mL), dan kata
   *    pembedanya (mis. "original" / "gula aren") disebut semua; qty dari "Isi 3 Pcs" / "Beli 2 Gratis 1".
   */
  function spTebakIsi(r,kenal,produk){
    const K=String(r.sku||'').toUpperCase(),isiDari=k=>{const s=kenal.get(k);return s&&s.items.length?s.items:null};
    const m=K.match(/^(\D*)(\d+)(\D*)$/);
    if(m&&+m[2]>1){const b=m[1]+'1'+m[3],isi=isiDari(b);
      if(isi&&isi.length===1)return {items:isi.map(i=>({produk_id:i.produk_id,qty:i.qty*+m[2]})),dasar:'pola kode '+b+' × '+m[2],yakin:true,dari:b}}
    for(let i=1;i<K.length;i++){
      const kiri=K.slice(0,i),kanan=K.slice(i),akhir=(kanan.match(/\D+$/)||[''])[0];
      const a=isiDari(kiri)?kiri:akhir&&isiDari(kiri+akhir)?kiri+akhir:null;
      if(a&&isiDari(kanan)&&a!==K&&kanan!==K)return {items:[...isiDari(a),...isiDari(kanan)].map(i=>({produk_id:i.produk_id,qty:i.qty})),dasar:'gabungan '+a+' + '+kanan,yakin:true,dari:a};
    }
    const teks=(r.variasi||'')+' '+(r.nama||''),kata=new Set(teks.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const ukuran=spUkuran(r.variasi).length?spUkuran(r.variasi):spUkuran(r.nama);
    const cocok=produk.filter(p=>{const w=spKataProduk(p),u=spUkuran(p.nama);
      return w.length&&kata.has(w[0])&&!(ukuran.length&&u.length&&!u.some(x=>ukuran.includes(x)))});
    if(!cocok.length){
      const merek=produk.some(p=>{const w=spKataProduk(p);return w.length&&kata.has(w[0])});
      return {items:[],dasar:merek&&ukuran.length?'ukuran '+ukuran.join(' / ').replace(/ml/g,' mL')+' belum ada di List Produk':'tidak ada produk List Produk yang cocok',yakin:false};
    }
    const umum=cocok.map(spKataProduk).reduce((a,w)=>a.filter(x=>w.includes(x)));
    const pas=cocok.length===1?cocok:cocok.filter(p=>{const beda=spKataProduk(p).filter(w=>!umum.includes(w));return beda.length&&beda.every(w=>kata.has(w))});
    if(pas.length===1){const q=spTebakQty(r.variasi)??spTebakQty(r.nama);
      return {items:[{produk_id:pas[0].id,qty:q||1}],dasar:'nama produk'+(q?' · qty dari "'+(spTebakQty(r.variasi)!=null?r.variasi:'nama')+'"':' · qty tidak disebut, dianggap 1'),yakin:q!=null||cocok.length===1}}
    if(pas.length>1&&/\+|paket|varian|bundle/i.test(teks))return {items:pas.map(p=>({produk_id:p.id,qty:1})),dasar:'paket berisi beberapa produk · qty masing-masing dianggap 1',yakin:false};
    return {items:[],dasar:'nama tidak menyebut varian yang jelas ('+cocok.map(p=>p.nama).join(' / ')+')',yakin:false};
  }
  /** Buat SKU otomatis dari per_sku halaman Shopee / TikTok: asal = {per_sku, plat, muat} */
  async function spBukaOto(asal){
    asal=asal||{per_sku:spData.per_sku,plat:'Shopee',muat:loadShpKirim};
    $('spOtoIsi').innerHTML='';put('spOtoInfo','Menebak isi paket…');put('spOtoMsg','');$('spOtoSimpan').disabled=true;$('spOtoDlg').showModal();
    try{
      const [s,p]=await Promise.all([api('/api/settings/sku'),api('/api/settings/produk-list')]);
      const kenal=new Map(s.rows.map(r=>[String(r.sku).toUpperCase(),r])),produk=p.rows,nama=new Map(produk.map(x=>[x.id,x]));
      const rows=asal.per_sku.filter(r=>!r.sku_id&&r.sku&&!kenal.has(String(r.sku).toUpperCase())).map(r=>Object.assign({},r,{variasi:/^default$/i.test(r.variasi||'')?'':r.variasi}))
        .map(r=>Object.assign({r},spTebakIsi(r,kenal,produk)));
      for(const x of rows){const b=x.dari&&kenal.get(x.dari);x.base=b||null;x.hpp=x.items.reduce((a,i)=>a+i.qty*((nama.get(i.produk_id)||{}).hpp||0),0)}
      spOto={rows,nama,asal};
      const bisa=rows.filter(x=>x.items.length).length;
      put('spOtoInfo',int(rows.length)+' kode SKU belum ada di Manajemen SKU · '+int(bisa)+' bisa ditebak isinya. Yang dicentang akan dibuat. Isi yang tidak bisa ditebak bisa dipilih langsung dari List Produk di kolom Isi paket; '+
        'produk yang belum ada di List Produk tambahkan dulu di Inventory › List Produk.');
      spOto.opsi=produk.map(p=>'<option value="'+p.id+'">'+esc(p.nama)+'</option>').join('');
      // Isi paket bisa diubah di sini: satu atau beberapa produk (bundling), qty, dan tanda bonus
      const isiTd=(x,i)=>'<div class="sp-oto-isi" data-oto-isi="'+i+'">'+spOtoBarisIsi(x.items)+'</div>';
      $('spOtoIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th></th><th>Kode SKU</th><th>Produk di '+esc(asal.plat)+'</th><th>Isi paket</th><th class="n">HPP produk</th></tr></thead><tbody>'+
        rows.map((x,i)=>'<tr><td><input type="checkbox" data-oto="'+i+'"'+(x.items.length?'':' disabled')+(x.items.length&&x.yakin?' checked':'')+'></td>'+
          '<td class="nm">'+esc(x.r.sku)+'</td><td class="lr-nm">'+esc(x.r.nama||'—')+(x.r.variasi?'<small>Variasi: '+esc(x.r.variasi)+'</small>':'')+'</td>'+
          '<td class="lr-nm">'+isiTd(x,i)+'<small data-oto-dasar="'+i+'">'+(x.items.length?'':'<span class="tag warn">tidak bisa ditebak</span> ')+esc(x.dasar)+'</small></td>'+
          '<td class="n" data-oto-hpp="'+i+'">'+(x.items.length?rpFull(x.hpp):'—')+'</td></tr>').join('')+'</tbody></table>';
      spOtoHitung();
    }catch(err){put('spOtoInfo','Gagal memuat Manajemen SKU / List Produk: '+err.message)}
  }
  /** Baris isi paket: [produk][qty][Bonus][×] per item, lalu tombol "+ produk" */
  function spOtoBarisIsi(items){
    const baris=(it)=>'<span class="sp-oto-pilih"><select data-oto-produk><option value="">— pilih produk —</option>'+
      spOto.opsi.replace('value="'+(it&&it.produk_id)+'"','value="'+(it&&it.produk_id)+'" selected')+'</select>'+
      '<input type="number" min="1" step="1" data-oto-qty value="'+(it?it.qty:1)+'" aria-label="Qty">'+
      '<label class="sp-oto-bonus" title="Produk bonus/gratis: masuk HPP & stok, tidak dihitung pcs terjual"><input type="checkbox" data-oto-bonus'+(it&&it.bonus?' checked':'')+'>Bonus</label>'+
      '<button type="button" class="sp-oto-x" data-oto-hapus title="Hapus baris" aria-label="Hapus baris">×</button></span>';
    return (items.length?items:[null]).map(baris).join('')+'<button type="button" class="sp-oto-tambah" data-oto-tambah>+ produk (bundling)</button>';
  }
  function spOtoHitung(){const n=$('spOtoIsi').querySelectorAll('input[data-oto]:checked').length;$('spOtoSimpan').disabled=!n;put('spOtoSimpan',n?'Buat '+n+' SKU':'Simpan')}
  $('spSub').addEventListener('click',e=>{if(e.target.closest('#spOtoBtn'))spBukaOto()});
  $('tpSub').addEventListener('click',e=>{if(!e.target.closest('#tpOtoBtn')||!tpData)return;
    // Gudang SKU baru: gudang toko TikTok bila semua toko memakai satu gudang yang sama
    const gd=[...new Set(((ttToko&&ttToko.toko)||[]).map(t=>t.gudang_id).filter(Boolean))];
    spBukaOto({per_sku:tpData.per_sku.map(x=>Object.assign({},x,gd.length===1?{gudang_id:gd[0],n_gudang:1}:{})),plat:'TikTok Shop',muat:loadTtPesanan})});
  /** Isi dipilih / diubah manual di jendela: baca semua baris produk SKU itu → isi, HPP, dan centang barisnya */
  function spOtoUbah(box){
    const i=+box.dataset.otoIsi,x=spOto.rows[i],cek=$('spOtoIsi').querySelector('[data-oto="'+i+'"]');
    const gabung=new Map();
    for(const b of box.querySelectorAll('.sp-oto-pilih')){
      const id=Number(b.querySelector('[data-oto-produk]').value);if(!id)continue;
      const qty=Math.max(1,Math.round(Number(b.querySelector('[data-oto-qty]').value)||1)),bonus=b.querySelector('[data-oto-bonus]').checked?1:0;
      const g=gabung.get(id)||{produk_id:id,qty:0,bonus:0};g.qty+=qty;g.bonus=g.bonus||bonus;gabung.set(id,g);
    }
    x.items=[...gabung.values()];
    x.hpp=x.items.reduce((a,it)=>a+it.qty*((spOto.nama.get(it.produk_id)||{}).hpp||0),0);
    const pcs=x.items.reduce((a,it)=>a+(it.bonus?0:it.qty),0);
    x.dasar=x.items.length?'dipilih manual':'pilih produk dari List Produk';
    $('spOtoIsi').querySelector('[data-oto-dasar="'+i+'"]').textContent=x.items.length?'dipilih manual · '+int(pcs)+' pcs terjual per paket':x.dasar;
    $('spOtoIsi').querySelector('[data-oto-hpp="'+i+'"]').textContent=x.items.length?rpFull(x.hpp):'—';
    cek.disabled=!x.items.length;cek.checked=!!x.items.length;spOtoHitung();
  }
  $('spOtoIsi').addEventListener('change',e=>{const box=e.target.closest('[data-oto-isi]');if(box&&spOto)spOtoUbah(box);else spOtoHitung()});
  $('spOtoIsi').addEventListener('click',e=>{
    const box=e.target.closest('[data-oto-isi]');if(!box||!spOto)return;
    if(e.target.closest('[data-oto-tambah]')){spOtoUbah(box);box.innerHTML=spOtoBarisIsi([...spOto.rows[+box.dataset.otoIsi].items,{produk_id:null,qty:1}]);return}
    const h=e.target.closest('[data-oto-hapus]');
    if(h){h.closest('.sp-oto-pilih').remove();spOtoUbah(box);if(!box.querySelector('.sp-oto-pilih'))box.innerHTML=spOtoBarisIsi([])}
  });
  ['spOtoTutup','spOtoBatal'].forEach(id=>$(id).addEventListener('click',()=>$('spOtoDlg').close()));
  $('spOtoForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!spOto)return;
    const pilih=[...$('spOtoIsi').querySelectorAll('input[data-oto]:checked')].map(c=>spOto.rows[+c.dataset.oto]);
    $('spOtoSimpan').disabled=true;const gagal=[];
    for(const [k,x] of pilih.entries()){
      put('spOtoMsg','Menyimpan '+(k+1)+' / '+pilih.length+'…');
      const r=x.r,b=x.base,gudang=r.n_gudang===1&&r.gudang_id?r.gudang_id:b&&b.gudang_id?b.gudang_id:null;
      try{await api('/api/settings/sku',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        sku:r.sku,produk:((r.nama||r.sku)+(r.variasi?' - '+r.variasi:'')).slice(0,200),hpp:0,kategori:b&&b.kategori||'',gudang:'',
        keterangan:'Dibuat otomatis dari '+spOto.asal.plat+' ('+x.dasar+')',niche:b&&b.niche||'',items:x.items,gudang_id:gudang})})}
      catch(err){gagal.push(r.sku+': '+err.message)}
    }
    $('spOtoDlg').close();
    alert((pilih.length-gagal.length)+' SKU dibuat di Manajemen SKU.'+(gagal.length?'\n\nGagal:\n'+gagal.join('\n'):''));
    spOto.asal.muat();
  });

  // -- Kelola toko
  function spBukaToko(t){
    spEdit=t||null;const f=$('spTkForm');
    put('spTkJ',t?'Ubah toko Shopee':'Tambah toko Shopee');put('spTkMsg','');
    f.gudang_id.innerHTML='<option value="">— belum ditentukan —</option>'+spToko.gudang.map(g=>'<option value="'+g.id+'">'+esc(g.nama)+' ('+esc(g.jenis)+')</option>').join('');
    f.nama.value=t?t.nama:'';f.username.value=t?t.username||'':'';f.shop_id.value=t?t.shop_id||'':'';f.gudang_id.value=t&&t.gudang_id?String(t.gudang_id):'';f.mode.value=t&&t.mode==='api'?'api':'upload';
    $('spTkDlg').showModal();
  }
  $('spTkTambah').addEventListener('click',()=>{if(spToko)spBukaToko()});
  ['spTkTutup','spTkBatal'].forEach(id=>$(id).addEventListener('click',()=>$('spTkDlg').close()));
  $('spTkForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=$('spTkForm');
    const body={id:spEdit&&spEdit.id,nama:f.nama.value,username:f.username.value,shop_id:f.shop_id.value,gudang_id:f.gudang_id.value?Number(f.gudang_id.value):null,mode:f.mode.value};
    $('spTkSimpan').disabled=true;put('spTkMsg','Menyimpan…');
    try{const h=await api('/api/shopee/toko',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      $('spTkDlg').close();tkToko=null;
      if($('v-pengaturan').classList.contains('active'))await tmMuat();else await loadShpKirim();
      if($('spUpDlg').open){spIsiTokoUpload();$('spUpToko').value=String(h.id)}}
    catch(err){put('spTkMsg','Gagal: '+err.message)}
    finally{$('spTkSimpan').disabled=false}
  });
  $('spTokoIsi').addEventListener('click',async e=>{
    const u=e.target.closest('[data-tk-ubah]'),h=e.target.closest('[data-tk-hapus]');
    if(u)return spBukaToko(spToko.toko.find(t=>t.id===Number(u.dataset.tkUbah)));
    if(!h)return;const t=spToko.toko.find(x=>x.id===Number(h.dataset.tkHapus));
    if(!t||!confirm('Hapus toko '+t.nama+'?'))return;
    try{await api('/api/shopee/toko/'+t.id,{method:'DELETE'});loadShpKirim()}catch(err){alert('Gagal menghapus: '+err.message)}
  });

  // -- Upload file pesanan
  /** CSV Shopee: pemisah ; atau , (dideteksi dari baris judul), kutip ganda didukung */
  function spParseCsv(teks){
    teks=teks.replace(/^﻿/,'');
    // Pemisah dari baris dengan pemisah terbanyak di 15 baris pertama (baris 1 laporan iklan hanya judul, tanpa pemisah)
    const awal=teks.split('\n',15),maks=c=>Math.max(...awal.map(b=>b.split(c).length)),sep=maks(';')>maks(',')?';':',';
    const rows=[];let row=[],f='',q=false;
    for(let i=0;i<teks.length;i++){const ch=teks[i];
      if(q){if(ch==='"'){if(teks[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
      else if(ch==='"')q=true;
      else if(ch===sep){row.push(f);f=''}
      else if(ch==='\n'){row.push(f.replace(/\r$/,''));rows.push(row);row=[];f=''}
      else f+=ch;
    }
    if(f||row.length){row.push(f.replace(/\r$/,''));rows.push(row)}
    return rows.filter(r=>r.some(x=>x.trim()));
  }
  /** File Excel (.xlsx / .xls) dibaca dengan SheetJS yang dimuat saat pertama dibutuhkan; sheet pertama = data pesanan */
  let spXlsxJanji=null;
  const spMuatXlsx=()=>spXlsxJanji||(spXlsxJanji=new Promise((ok,gagal)=>{
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=()=>ok(window.XLSX);s.onerror=()=>{spXlsxJanji=null;gagal(new Error('Gagal memuat pembaca Excel — cek koneksi internet lalu coba lagi.'))};
    document.head.appendChild(s);
  }));
  window.spMuatXlsx=spMuatXlsx;   // dipakai ekspor Excel js/pages/iklan-meta.js
  /** Semua sheet file CSV / Excel → [{nama, rows}]; sel tanggal Excel → "YYYY-MM-DD HH:MM" seperti di CSV, angka tetap angka */
  async function spBacaFile(file){
    if(!/\.xlsx?$/i.test(file.name))return [{nama:'',rows:spParseCsv(await file.text())}];
    const X=await spMuatXlsx(),wb=X.read(await file.arrayBuffer(),{type:'array',cellDates:true});
    const dua=n=>String(n).padStart(2,'0');
    const tgl=d=>{d=new Date(d.getTime()+30000);return d.getFullYear()+'-'+dua(d.getMonth()+1)+'-'+dua(d.getDate())+' '+dua(d.getHours())+':'+dua(d.getMinutes())};
    // Baris kosong dipertahankan sebagai [] supaya posisi baris judul kelompok (baris 1–2 laporan penghasilan) tetap benar
    return wb.SheetNames.map(nama=>({nama,rows:X.utils.sheet_to_json(wb.Sheets[nama],{header:1,raw:true,defval:'',blankrows:true}).map(r=>r.map(v=>v instanceof Date?tgl(v):v))}));
  }
  const spNorm=s=>String(s==null?'':s).toLowerCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
  /**
   * Laporan Penghasilan Shopee (sheet "Penghasilan"): baris judul = baris yang memuat "No. Pesanan" & "Total Penghasilan";
   * dua baris di atasnya = judul kelompok (Rincian Jumlah Pelepasan Dana → Biaya Platform / Layanan / …). Uang diambil dari baris
   * "Order", produk dari baris "Sku". Total dicocokkan dengan sheet Summary bila ada. null = bukan file penghasilan.
   */
  function spBacaPenghasilan(sheets){
    const urut=[...sheets].sort((a,b)=>(/penghasilan|income/i.test(b.nama)?1:0)-(/penghasilan|income/i.test(a.nama)?1:0));
    let sh=null,hi=-1;
    for(const s of urut){const i=s.rows.slice(0,15).findIndex(r=>{const n=(r||[]).map(spNorm);return n.includes('no. pesanan')&&n.includes('total penghasilan')});if(i>=0){sh=s;hi=i;break}}
    if(!sh)return null;
    const rows=sh.rows,judul=rows[hi].map(x=>String(x==null?'':x).trim()),head=judul.map(spNorm);
    // Kelompok: baris hi-2 (besar) dan hi-1 (kecil), diteruskan ke kanan; kelompok kecil berhenti saat kelompok besar berganti
    const g1=[],g2=[];let a='',b='';
    head.forEach((_,j)=>{const v1=hi>=2?spNorm((rows[hi-2]||[])[j]):'',v2=hi>=1?spNorm((rows[hi-1]||[])[j]):'';if(v1){a=v1;b=''}if(v2)b=v2;g1.push(a);g2.push(b)});
    const adaG1=g1.some(x=>x.includes('pelepasan'));
    const awal=head.indexOf('total penghasilan'),akhir=head.findIndex((h,j)=>j>awal&&/username|jumlah dibayar pembeli/.test(h));
    const uang=head.map((_,j)=>adaG1?g1[j].includes('pelepasan'):j>=awal&&(akhir<0||j<akhir));
    const kelas=(g,n)=>{
      if(n==='total penghasilan'||g==='total penghasilan')return 'total';
      if(/isi saldo/.test(n))return 'isi_saldo';
      if(/subtotal pesanan/.test(g)||/^harga (asli )?produk$/.test(n))return /pengembalian/.test(n)?'refund':'harga';
      const t=g||n;
      if(/gratis ongkir xtra/.test(t))return 'gox';
      if(/ongkos kirim|ongkir|pengiriman/.test(t))return 'ongkir';
      if(/voucher|potongan harga|cashback|diskon/.test(t))return 'voucher';
      if(/platform|administrasi|proses pesanan|biaya pembayaran/.test(t))return 'platform';
      if(/layanan|transaksi|spaylater/.test(t))return 'layanan';
      if(/promosi|kampanye|komisi|ams/.test(t))return 'promosi';
      if(/pajak|pph|ppn/.test(t))return 'pajak';
      return 'lainnya';
    };
    const KE={harga:'harga_produk',refund:'refund',ongkir:'ongkir',voucher:'voucher',platform:'biaya_platform',gox:'biaya_gox',layanan:'biaya_layanan',
      promosi:'biaya_promosi',lainnya:'biaya_lainnya',pajak:'pajak',isi_saldo:'isi_saldo_iklan',total:'total'};
    const kol=head.map((h,j)=>uang[j]&&h?kelas(g2[j],h):null);
    const ix=n=>head.indexOf(n),I={no:ix('no. pesanan'),lihat:ix('lihat berdasarkan'),idp:ix('id produk'),nama:ix('nama produk'),dibuat:ix('waktu pesanan dibuat'),
      dilepas:ix('tanggal dana dilepaskan'),metode:ix('metode pelepasan dana'),tipe:ix('tipe pesanan'),dibayar:ix('jumlah dibayar pembeli'),
      bayar:ix('metode pembayaran pembeli'),kurir:ix('nama kurir')>=0?ix('nama kurir'):ix('jasa kirim')};
    if(I.dilepas<0)throw new Error('Kolom "Tanggal Dana Dilepaskan" tidak ditemukan di laporan penghasilan.');
    const sel=(r,k)=>I[k]>=0?String((r||[])[I[k]]==null?'':r[I[k]]).trim():'';
    const per=new Map(),baru=no=>{let o=per.get(no);if(!o){o={no_pesanan:no,produk:[],rincian:{},ada:false};per.set(no,o)}return o};
    for(const r of rows.slice(hi+1)){
      const no=sel(r,'no');if(!no||no==='-')continue;
      const o=baru(no),lihat=spNorm(sel(r,'lihat'));
      if(lihat==='sku'){const nm=sel(r,'nama');if(nm&&nm!=='-')o.produk.push({id:sel(r,'idp'),nama:nm});continue}
      if(o.ada)continue;o.ada=true;
      Object.assign(o,{dibuat:sel(r,'dibuat'),dilepas:sel(r,'dilepas'),metode_pelepasan:sel(r,'metode'),tipe_pesanan:sel(r,'tipe'),
        dibayar_pembeli:spAngka(I.dibayar>=0?r[I.dibayar]:0),metode_bayar:sel(r,'bayar'),kurir:sel(r,'kurir')});
      for(const k of Object.values(KE))o[k]=0;
      kol.forEach((k,j)=>{if(!k)return;const v=spAngka(r[j]);o[KE[k]]+=v;if(v&&k!=='total')o.rincian[k+'|'+judul[j]]=(o.rincian[k+'|'+judul[j]]||0)+v});
    }
    const hasil=[...per.values()].filter(o=>o.ada);
    // Cek: komponen dijumlah harus sama dengan Total Penghasilan per pesanan
    const komponen=o=>Object.values(KE).filter(k=>k!=='total').reduce((s,k)=>s+o[k],0);
    const selisih=hasil.filter(o=>Math.abs(komponen(o)-o.total)>1).length;
    // Sheet Summary: total pendapatan + total pengeluaran (atau total penghasilan), username / nama toko, periode
    let ringkasan=null,username='',namaToko='';
    const sum=sheets.find(s=>/summary|ringkasan/i.test(s.nama));
    if(sum){
      let pend=null,keluar=null,peng=null;
      const angkaAkhir=r=>{for(let j=r.length-1;j>=0;j--){const v=r[j];if(typeof v==='number')return v;if(/^-?[\d.,]+$/.test(String(v).trim())&&String(v).trim())return spAngka(v)}return null};
      for(const r of sum.rows){
        const sel2=(r||[]).map(spNorm),lbl=sel2.find(Boolean)||'';
        if(/total pendapatan/.test(lbl))pend=angkaAkhir(r);
        else if(/total pengeluaran/.test(lbl))keluar=angkaAkhir(r);
        else if(/^(\d+\.\s*)?total penghasilan/.test(lbl))peng=angkaAkhir(r);
        const iu=sel2.findIndex(x=>/^(username|nama pengguna)/.test(x)),it=sel2.findIndex(x=>/^(nama toko|shop name|toko)$/.test(x));
        if(iu>=0)username=String(r.slice(iu+1).find(x=>String(x).trim())||'').trim();
        if(it>=0)namaToko=String(r.slice(it+1).find(x=>String(x).trim())||'').trim();
      }
      ringkasan=peng!=null?peng:pend!=null&&keluar!=null?pend+keluar:null;
    }
    const tgl=hasil.map(o=>String(o.dilepas).slice(0,10)).filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(t)).sort();
    const jml=k=>hasil.reduce((s,o)=>s+o[k],0);
    return {jenis:'penghasilan',rows:hasil.map(({ada,...o})=>o),baris:rows.length-hi-1,dari:tgl[0]||null,sampai:tgl[tgl.length-1]||null,
      total:jml('total'),harga:jml('harga_produk'),biaya:['biaya_platform','biaya_gox','biaya_layanan','biaya_promosi','biaya_lainnya','pajak'].reduce((s,k)=>s+jml(k),0),
      selisih,ringkasan,username,namaToko,sheet:sh.nama};
  }
  /** Angka laporan iklan (CSV memakai titik desimal: "17940.17", "1.91%"); angka Excel apa adanya; "-" / kosong → 0 */
  const siAngka=v=>{if(typeof v==='number')return v;const s=String(v==null?'':v).trim().replace(/%$/,'');if(!s||s==='-')return 0;
    if(/^-?[\d,]*(\.\d+)?$/.test(s))return Number(s.replace(/,/g,''))||0;return Number(s.replace(/\./g,'').replace(',','.'))||0};
  /** "14/02/2026 00:00:00" / "2026-02-14 00:00" → "2026-02-14" */
  const siTgl=v=>{const s=String(v==null?'':v).trim();let m=s.match(/^\d{4}-\d{2}-\d{2}/);if(m)return m[0];m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):''};
  /**
   * Laporan Iklan Shopee ("Semua Laporan Iklan CPC"): blok info di atas (Username, Nama Toko, ID Toko, Periode dd/mm/yyyy - dd/mm/yyyy),
   * lalu baris judul "Urutan, Nama Iklan, …, Biaya, …", satu baris per iklan berisi total selama periode. null = bukan laporan iklan.
   */
  function spBacaIklan(sheets){
    for(const sh of sheets){
      const rows=sh.rows,hi=rows.slice(0,30).findIndex(r=>{const n=(r||[]).map(spNorm);return n.includes('nama iklan')&&n.includes('biaya')});
      if(hi<0)continue;
      const info={};
      for(const r of rows.slice(0,hi)){const k=spNorm((r||[])[0]);if(k)info[k]=String((r||[]).slice(1).find(x=>String(x).trim())||'').trim()}
      const per=String(info.periode||'').split(/\s+-\s+|\s*s\/d\s*/).map(siTgl);
      const head=rows[hi].map(spNorm),I={};
      const K={nama:'nama iklan',status:'status',jenis:'jenis iklan',kode:'kode produk',mode:'mode bidding',tempat:'penempatan iklan',mulai:'tanggal mulai',
        dilihat:'dilihat',klik:'jumlah klik',keranjang:'tambah ke keranjang',konversi:'konversi',konvL:'konversi langsung',terjual:'produk terjual',terjualL:'terjual langsung',
        omzet:'omzet penjualan',omzetL:'penjualan langsung (gmv langsung)',biaya:'biaya'};
      for(const [k,n] of Object.entries(K))I[k]=head.indexOf(n);
      if(I.omzetL<0)I.omzetL=head.findIndex(h=>h.startsWith('penjualan langsung'));
      if(I.biaya<0||I.nama<0)throw new Error('Kolom Nama Iklan / Biaya tidak ditemukan di laporan iklan.');
      const t=(r,k)=>I[k]>=0?String(r[I[k]]==null?'':r[I[k]]).trim():'',a=(r,k)=>I[k]>=0?siAngka(r[I[k]]):0;
      const iklan=rows.slice(hi+1).filter(r=>r&&t(r,'nama')).map(r=>({nama:t(r,'nama'),status:t(r,'status'),jenis:t(r,'jenis'),kode_produk:t(r,'kode'),
        mode_bidding:t(r,'mode'),penempatan:t(r,'tempat'),mulai:siTgl(t(r,'mulai')),dilihat:a(r,'dilihat'),klik:a(r,'klik'),keranjang:a(r,'keranjang'),
        konversi:a(r,'konversi'),konversi_langsung:a(r,'konvL'),terjual:a(r,'terjual'),terjual_langsung:a(r,'terjualL'),omzet:a(r,'omzet'),omzet_langsung:a(r,'omzetL'),biaya:a(r,'biaya')}));
      return {jenis:'iklan',rows:iklan,baris:iklan.length,dari:per[0]||null,sampai:per[1]||per[0]||null,
        username:info.username||'',namaToko:info['nama toko']||'',shopId:info['id toko']||'',
        biaya:iklan.reduce((s,x)=>s+x.biaya,0),omzet:iklan.reduce((s,x)=>s+x.omzet,0)};
    }
    return null;
  }
  /**
   * Laporan Live bisa CSV asli Shopee atau CSV yang dibuka & disimpan ulang di Excel. Excel bisa: menaruh baris ber-";" di satu kolom,
   * mengubah "21.427" jadi 21,427 (setelan Inggris), dan mengubah tanggal jadi sel tanggal (tertukar hari/bulan). Helper di bawah menormalkannya.
   */
  const liveBaris=rows=>rows.map(r=>{const isi=(r||[]).filter(x=>String(x).trim()!=='');return isi.length===1&&String(isi[0]).includes(';')?String(isi[0]).split(';'):(r||[])});
  /** Jumlah (bukan uang): angka pecahan dari Excel = titik ribuan yang terbaca sebagai desimal → ×1000 */
  const liveJml=v=>typeof v==='number'&&!Number.isInteger(v)?Math.round(v*1000):spAngka(v);
  /** "01-10-2026 - 31-10-2026" / "28-10-2026" → [dari, sampai]; sel tanggal Excel ("2026-10-28 00:00") ditandai excel:true */
  function livePeriode(v){
    const s=String(v==null?'':v).trim(),excel=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s);
    const per=s.split(/\s+-\s+/).map(x=>{const m=String(x).trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);return m?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):siTgl(x)});
    return {dari:per[0]||null,sampai:per[1]||per[0]||null,excel};
  }
  /**
   * Laporan Shopee Live (ekspor "overview" Live Streaming): baris judul memuat "Periode Data" & "Penjualan(Pesanan Siap Dikirim)",
   * baris berikutnya = total periode ("01-10-2026 - 31-10-2026" atau satu tanggal untuk ekspor harian). Uang "Rp58.632.467", durasi "428j37m29d".
   * null = bukan laporan live.
   */
  function spBacaLive(sheets){
    for(const sh of sheets){
      const rows=liveBaris(sh.rows),hi=rows.slice(0,10).findIndex(r=>{const n=(r||[]).map(spNorm);return n.includes('periode data')&&n.includes('penjualan(pesanan siap dikirim)')});
      if(hi<0)continue;
      const head=rows[hi].map(spNorm),r=rows.slice(hi+1).find(x=>x&&String(x[head.indexOf('periode data')]||'').trim())||[],kol=n=>{const i=head.indexOf(n);return i<0?'':r[i]};
      const a=n=>spAngka(kol(n)),j=n=>liveJml(kol(n)),per=livePeriode(kol('periode data'));
      const dur=String(kol('jumlah durasi livestream')),bag=h=>Number((dur.match(new RegExp('(\d+)'+h))||[])[1]||0);
      return {jenis:'live',dari:per.dari,sampai:per.sampai,tglExcel:per.excel,baris:1,userId:String(kol('user id')||''),
        omzet:a('penjualan(pesanan siap dikirim)'),pesanan:j('pesanan(pesanan siap dikirim)'),omzet_dibuat:a('penjualan(pesanan dibuat)'),pesanan_dibuat:j('pesanan(pesanan dibuat)'),
        produk_terjual:j('produk terjual(pesanan siap dikirim)'),omzet_baru:a('penjualan dari pembeli baru(pesanan siap dikirim)'),sesi:j('jumlah livestream'),
        durasi_detik:bag('j')*3600+bag('m')*60+bag('d'),penonton:j('penonton'),dilihat:j('dilihat'),klik_produk:j('klik produk'),keranjang:j('tambah ke keranjang')};
    }
    return null;
  }
  /** Daftar produk live (ekspor "sc_live_product_list"): judul "Periode Data;User Id;Ranking;Produk;…", satu baris per produk. null = bukan file ini. */
  function spBacaLiveProduk(sheets){
    for(const sh of sheets){
      const rows=liveBaris(sh.rows),hi=rows.slice(0,5).findIndex(r=>{const n=(r||[]).map(spNorm);return n.includes('periode data')&&n.includes('ranking')&&n.includes('produk')});
      if(hi<0)continue;
      const head=rows[hi].map(spNorm),ix=n=>head.indexOf(n),v=(r,n)=>ix(n)<0?'':r[ix(n)],a=(r,n)=>spAngka(v(r,n)),j=(r,n)=>liveJml(v(r,n));
      const isi=rows.slice(hi+1).filter(r=>r&&String(v(r,'produk')).trim());
      const per=livePeriode(v(isi[0]||[],'periode data'));
      const produk=isi.map((r,i)=>({urut:j(r,'ranking')||i+1,produk:String(v(r,'produk')).trim(),klik:j(r,'klik produk'),keranjang:j(r,'tambah ke keranjang'),
        pesanan:j(r,'pesanan(pesanan siap dikirim)'),terjual:j(r,'produk terjual(pesanan siap dikirim)'),omzet:a(r,'penjualan(pesanan siap dikirim)'),omzet_dibuat:a(r,'penjualan(pesanan dibuat)')}));
      return {jenis:'live_produk',dari:per.dari,sampai:per.sampai,tglExcel:per.excel,userId:String(v(isi[0]||[],'user id')||''),rows:produk,baris:produk.length,
        omzet:produk.reduce((s,x)=>s+x.omzet,0),terjual:produk.reduce((s,x)=>s+x.terjual,0)};
    }
    return null;
  }
  /** "428j37m29d" dari detik → "428 jam 37 mnt" */
  const liveDurasi=s=>{s=Math.round(s||0);const j=Math.floor(s/3600),m=Math.floor(s%3600/60);return (j?int(j)+' jam ':'')+m+' mnt'};
  /** Kenali jenis file: laporan live, laporan iklan, laporan penghasilan, atau ekspor pesanan */
  function spBacaUpload(sheets){
    const lp=spBacaLiveProduk(sheets);if(lp)return lp;   // dicek sebelum overview: kolom penjualan-nya sama
    const l=spBacaLive(sheets);if(l)return l;
    const i=spBacaIklan(sheets);if(i)return i;
    const p=spBacaPenghasilan(sheets);if(p)return p;
    const s=sheets.find(x=>(x.rows[0]||[]).map(spNorm).includes('no. pesanan'))||sheets[0];
    return Object.assign(spBacaPesanan((s.rows||[]).filter(r=>r&&r.some(x=>String(x).trim()))),{jenis:'pesanan'});
  }
  /** "97.000" → 97000 (titik ribuan, koma desimal); angka dari Excel dipakai apa adanya; "-" / kosong → 0 */
  const spAngka=v=>{if(typeof v==='number')return Math.round(v);const s=String(v==null?'':v).trim();if(!s||s==='-')return 0;return Number(s.replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'))||0};
  const SP_KOLOM={no:'No. Pesanan',status:'Status Pesanan',alasan:'Alasan Pembatalan',retur:'Status Pembatalan/ Pengembalian',resi:'No. Resi',kurir:'Opsi Pengiriman',
    antar:'Antar ke counter/ pick-up',batas:'Pesanan Harus Dikirimkan Sebelum',kirim:'Waktu Pengiriman Diatur',dibuat:'Waktu Pesanan Dibuat',dibayar:'Waktu Pembayaran Dilakukan',
    metode:'Metode Pembayaran',skuInduk:'SKU Induk',nama:'Nama Produk',sku:'Nomor Referensi SKU',variasi:'Nama Variasi',hargaAwal:'Harga Awal',harga:'Harga Setelah Diskon',
    qty:'Jumlah',qtyRetur:'Returned quantity',diskon:'Diskon Dari Penjual',voucher:'Voucher Ditanggung Penjual',ongkir:'Ongkos Kirim Dibayar oleh Pembeli',
    total:'Total Pembayaran',perkiraan:'Perkiraan Ongkos Kirim',kota:'Kota/Kabupaten',provinsi:'Provinsi',selesai:'Waktu Pesanan Selesai'};
  /** Baris CSV / Excel → pesanan (beberapa baris produk dengan No. Pesanan sama digabung jadi satu pesanan) */
  function spBacaPesanan(rows){
    if(rows.length&&/laporan iklan/i.test(rows[0][0]||''))throw new Error('Ini file laporan iklan — upload iklan belum tersedia. Pilih file ekspor Pesanan.');
    const norm=s=>String(s||'').toLowerCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
    const head=(rows[0]||[]).map(norm),ix={};
    for(const [k,nama] of Object.entries(SP_KOLOM)){const n=norm(nama);ix[k]=head.findIndex(h=>h===n||h.startsWith(n))}
    if(ix.no<0||ix.status<0||ix.dibuat<0)throw new Error('Kolom No. Pesanan / Status Pesanan / Waktu Pesanan Dibuat tidak ditemukan — pastikan ini file ekspor Pesanan Saya dari Shopee.');
    const ambil=(r,k)=>ix[k]>=0?String(r[ix[k]]==null?'':r[ix[k]]).trim():'';
    const nilai=(r,k)=>ix[k]>=0?r[ix[k]]:'';   // angka: biarkan tipe aslinya (Excel = number)
    const per=new Map();
    for(const r of rows.slice(1)){
      const no=ambil(r,'no');if(!no)continue;
      let p=per.get(no);
      if(!p){p={no_pesanan:no,status_asli:ambil(r,'status'),alasan_batal:ambil(r,'alasan'),status_retur:ambil(r,'retur'),resi:ambil(r,'resi'),kurir:ambil(r,'kurir'),
        antar:ambil(r,'antar'),batas_kirim:ambil(r,'batas'),waktu_kirim:ambil(r,'kirim'),dibuat:ambil(r,'dibuat'),dibayar:ambil(r,'dibayar'),selesai:ambil(r,'selesai'),
        metode_bayar:ambil(r,'metode'),diskon_penjual:0,voucher_penjual:spAngka(nilai(r,'voucher')),ongkir_pembeli:spAngka(nilai(r,'ongkir')),
        total_bayar:spAngka(nilai(r,'total')),perkiraan_ongkir:spAngka(nilai(r,'perkiraan')),kota:ambil(r,'kota'),provinsi:ambil(r,'provinsi'),items:[]};per.set(no,p)}
      p.diskon_penjual+=spAngka(nilai(r,'diskon'));
      p.items.push({sku:ambil(r,'sku'),sku_induk:ambil(r,'skuInduk'),nama:ambil(r,'nama'),variasi:ambil(r,'variasi'),harga_awal:spAngka(nilai(r,'hargaAwal')),
        harga:spAngka(nilai(r,'harga')),qty:spAngka(nilai(r,'qty'))||1,qty_retur:spAngka(nilai(r,'qtyRetur'))});
    }
    const pesanan=[...per.values()],tgl=pesanan.map(p=>p.dibuat.slice(0,10)).filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(t)).sort();
    return {pesanan,baris:rows.length-1,dari:tgl[0]||null,sampai:tgl[tgl.length-1]||null,
      batal:pesanan.filter(p=>/^batal/i.test(p.status_asli)).length,pcs:pesanan.reduce((a,p)=>a+p.items.reduce((s,i)=>s+i.qty,0),0)};
  }
  function spIsiTokoUpload(){
    const sel=$('spUpToko'),v=sel.value;
    sel.innerHTML='<option value="">— pilih toko —</option>'+spToko.toko.map(t=>'<option value="'+t.id+'">'+esc(t.nama)+(t.gudang?' · '+esc(t.gudang):'')+'</option>').join('')+'<option value="baru">+ Tambah toko baru…</option>';
    sel.value=[...sel.options].some(o=>o.value===v)?v:($('spToko').value||$('phToko').value||'');
  }
  /** Toko dari username / nama toko di file (sheet Summary laporan penghasilan) */
  function spTokoDariFile(h){
    const u=String(h.username||'').toLowerCase(),n=String(h.namaToko||'').toLowerCase(),id=String(h.shopId||'');
    return (u&&spToko.toko.find(t=>String(t.username||'').toLowerCase()===u))||(id&&spToko.toko.find(t=>String(t.shop_id||'')===id))||
      (n&&spToko.toko.find(t=>t.nama.toLowerCase()===n))||null;
  }
  async function spBukaUpload(){
    try{if(!spToko)spToko=await api('/api/shopee/toko')}catch(err){alert('Gagal memuat daftar toko: '+err.message);return}
    spUp=null;$('spUpForm').reset();$('spUpInfo').hidden=true;put('spUpMsg','');$('spUpSimpan').disabled=true;
    spIsiTokoUpload();$('spUpDlg').showModal();
  }
  $('spUpBtn').addEventListener('click',spBukaUpload);
  $('phUpBtn').addEventListener('click',spBukaUpload);
  ['spUpTutup','spUpBatal'].forEach(id=>$(id).addEventListener('click',()=>$('spUpDlg').close()));
  $('spUpToko').addEventListener('change',()=>{if($('spUpToko').value==='baru'){$('spUpToko').value='';spBukaToko()}});
  $('spUpFile').addEventListener('change',async()=>{
    const file=$('spUpFile').files[0];spUp=null;$('spUpSimpan').disabled=true;$('spUpInfo').hidden=true;put('spUpMsg','');
    if(!file)return;
    try{
      const h=spBacaUpload(await spBacaFile(file));
      spUp=Object.assign(h,{nama_file:file.name});
      // Ekspor overview Live harian menulis tanggalnya di nama file ("overview-v2_1d_2026-10-28_…") → lebih andal daripada sel tanggal Excel
      const tglNama=h.jenis==='live'&&(file.name.match(/_1d_(\d{4}-\d{2}-\d{2})_/)||[])[1];
      if(tglNama){h.dari=h.sampai=tglNama;h.tglExcel=false}
      const rentangTeks=h.dari?esc(fmtRange(h.dari,h.sampai||h.dari)):'—';
      if(h.jenis==='penghasilan'){
        if(!h.rows.length)throw new Error('Tidak ada pesanan di laporan penghasilan ini.');
        const cocok=h.ringkasan==null?'':Math.abs(h.ringkasan-h.total)<=1?'<br>✓ Total sama dengan sheet Summary':'<br><b style="color:var(--loss)">⚠ Total berbeda dengan sheet Summary ('+rpFull(h.ringkasan)+') — ada baris yang tidak terbaca, mohon kabari admin.</b>';
        const t=spTokoDariFile(h);if(t)$('spUpToko').value=String(t.id);
        $('spUpInfo').innerHTML='<b>Laporan Penghasilan</b> · '+int(h.rows.length)+' pesanan · dana dilepas '+rentangTeks+
          '<br>Harga produk '+rpFull(h.harga)+' · potongan Shopee '+rpFull(-h.biaya)+' · <b>penghasilan bersih '+rpFull(h.total)+'</b>'+cocok+
          (h.selisih?'<br><b style="color:var(--loss)">⚠ '+int(h.selisih)+' pesanan rinciannya tidak sama dengan Total Penghasilan.</b>':'')+
          (t?'<br>Toko terdeteksi dari file: <b>'+esc(t.nama)+'</b>':h.username||h.namaToko?'<br>Username di file: <b>'+esc(h.username||h.namaToko)+'</b> — belum cocok dengan toko mana pun (isi username toko di tabel Toko Shopee)':'');
      }else if(h.jenis==='live'||h.jenis==='live_produk'){
        if(!h.dari)throw new Error('Kolom "Periode Data" tidak terbaca di laporan live.');
        if(h.jenis==='live_produk'&&!h.rows.length)throw new Error('Tidak ada produk di file ini.');
        // File Live tidak memuat nama toko → toko dikenali dari User Id laporan Live sebelumnya
        let t=null;if(h.userId)try{const r=await api('/api/shopee/live/toko?'+new URLSearchParams({user_id:h.userId}));t=spToko.toko.find(x=>x.id===r.toko_id)||null}catch(_){}
        if(t)$('spUpToko').value=String(t.id);
        const cekTgl=h.tglExcel?'<br><b style="color:var(--loss)">⚠ Periode terbaca dari sel tanggal Excel — Excel bisa menukar hari & bulan (mis. 01-10 jadi 10 Januari). Pastikan periode di atas benar; bila salah, upload file CSV asli dari Shopee.</b>':'';
        const tokoTeks=cekTgl+(t?'<br>Toko dikenali dari User Id '+esc(h.userId)+': <b>'+esc(t.nama)+'</b>':'<br>Pilih tokonya — file Live tidak memuat nama toko'+(h.userId?' (User Id '+esc(h.userId)+'; berikutnya dikenali otomatis)':'')+'.');
        $('spUpInfo').innerHTML=h.jenis==='live'
          ?'<b>Laporan Live</b> · periode '+rentangTeks+' · '+int(h.sesi)+' sesi live ('+liveDurasi(h.durasi_detik)+')'+
            '<br>Penjualan siap dikirim <b>'+rpFull(h.omzet)+'</b> ('+int(h.pesanan)+' pesanan) · pesanan dibuat '+rpFull(h.omzet_dibuat)+' ('+int(h.pesanan_dibuat)+', termasuk batal)'+tokoTeks+
            '<br>Biaya live diisi manual setelah upload, di Penghasilan Shopee › kanal Live.'
          :'<b>Produk Live</b> · periode '+rentangTeks+' · '+int(h.rows.length)+' produk · '+int(h.terjual)+' terjual · penjualan '+rpFull(h.omzet)+tokoTeks+
            '<br>Dipakai untuk HPP Live — upload file <b>overview Live</b> periode yang sama dulu bila belum.';
      }else if(h.jenis==='iklan'){
        if(!h.rows.length)throw new Error('Tidak ada iklan di laporan ini.');
        if(!h.dari)throw new Error('Baris "Periode" tidak terbaca di laporan iklan.');
        const t=spTokoDariFile(h);if(t)$('spUpToko').value=String(t.id);
        $('spUpInfo').innerHTML='<b>Laporan Iklan</b> · '+int(h.rows.length)+' iklan · periode '+rentangTeks+
          '<br>Biaya '+rpFull(h.biaya)+' · omzet dari iklan '+rpFull(h.omzet)+(h.biaya?' · ROAS '+siRoas(h.omzet,h.biaya):'')+
          (t?'<br>Toko terdeteksi dari file: <b>'+esc(t.nama)+'</b>':'<br>Toko di file: <b>'+esc(h.namaToko||'—')+'</b> (username '+esc(h.username||'—')+
            ') — belum cocok dengan toko mana pun. Pilih tokonya; username-nya akan disimpan ke toko itu supaya berikutnya terdeteksi otomatis.');
      }else{
        if(!h.pesanan.length)throw new Error('Tidak ada pesanan di file ini.');
        $('spUpInfo').innerHTML='<b>Ekspor Pesanan</b> · '+int(h.pesanan.length)+' pesanan ('+int(h.baris)+' baris produk, '+int(h.pcs)+' pcs) · dibuat '+rentangTeks+
          '<br>'+int(h.batal)+' batal · '+int(h.pesanan.length-h.batal)+' lainnya';
      }
      $('spUpInfo').hidden=false;$('spUpSimpan').disabled=false;
    }catch(err){put('spUpMsg',err.message)}
  });
  $('spUpForm').addEventListener('submit',async e=>{
    e.preventDefault();const toko=Number($('spUpToko').value);
    if(!spUp)return;if(!toko){put('spUpMsg','Pilih toko dulu.');return}
    $('spUpSimpan').disabled=true;
    const json=b=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
    const rk=spRingkasan(spUp);let u=null;
    try{
      u=await api('/api/shopee/upload',json({toko_id:toko,jenis:spUp.jenis,nama_file:spUp.nama_file,baris:spUp.baris,dari:spUp.dari,sampai:spUp.sampai,ringkasan:rk.teks}));
      if(spUp.jenis==='live'){
        const {jenis,dari,sampai,baris,userId,nama_file,...angka}=spUp;
        const lap=await api('/api/shopee/live/laporan',json(Object.assign({upload_id:u.id,dari,sampai,user_id:userId},angka)));
        await api('/api/shopee/upload/'+u.id+'/selesai',json({status:'terbaca'}));
        $('spUpDlg').close();
        alert('Upload live selesai: periode '+fmtRange(dari,sampai)+', omzet '+rpFull(angka.omzet)+'.'+(lap.diganti?'\n'+lap.diganti+' laporan live lama di periode ini diganti.':'')+
          (lap.diperbarui?'\nLaporan periode ini diperbarui — spending & rincian produk yang sudah ada tetap.':'\nBerikutnya: upload file produk live periode yang sama (untuk HPP), lalu isi biaya live (tombol Spending).'));
      }else if(spUp.jenis==='live_produk'){
        const r=await api('/api/shopee/live/produk',json({upload_id:u.id,dari:spUp.dari,sampai:spUp.sampai,user_id:spUp.userId,rows:spUp.rows}));
        await api('/api/shopee/upload/'+u.id+'/selesai',json({status:'terbaca'}));
        $('spUpDlg').close();
        alert('Upload produk live selesai: '+r.produk+' produk, periode '+fmtRange(spUp.dari,spUp.sampai)+'. HPP Live sekarang dihitung dari produk ini.');
      }else if(spUp.jenis==='iklan'){
        // Laporan iklan: buat laporan periode (menggantikan laporan lama di dalam periode ini), lalu kirim baris iklan per 100
        const lap=await api('/api/shopee/iklan/laporan',json({upload_id:u.id,dari:spUp.dari,sampai:spUp.sampai}));
        for(let i=0;i<spUp.rows.length;i+=100){
          put('spUpMsg','Mengirim '+int(Math.min(i+100,spUp.rows.length))+' / '+int(spUp.rows.length)+' iklan…');
          await api('/api/shopee/iklan/laporan/'+lap.id+'/baris',json({awal:i,rows:spUp.rows.slice(i,i+100)}));
        }
        // Username di file disimpan ke toko yang dipilih bila tokonya belum punya username → upload berikutnya terdeteksi otomatis
        const tk=spToko.toko.find(x=>x.id===toko);
        if(tk&&!tk.username&&spUp.username)try{
          await api('/api/shopee/toko',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tk.id,nama:tk.nama,username:spUp.username,shop_id:tk.shop_id||spUp.shopId,gudang_id:tk.gudang_id,mode:tk.mode})});
          tk.username=spUp.username;
        }catch(_){/* username sudah dipakai toko lain — abaikan */}
        await api('/api/shopee/upload/'+u.id+'/selesai',json({status:rk.cek?'perlu_cek':'terbaca',catatan:rk.cek}));
        $('spUpDlg').close();
        alert('Upload iklan selesai: '+spUp.rows.length+' iklan, periode '+fmtRange(spUp.dari,spUp.sampai)+'.'+(lap.diganti?'\n'+lap.diganti+' laporan lama di periode ini diganti.':''));
      }else{
        const isi=spUp.jenis==='penghasilan'?spUp.rows:spUp.pesanan,kunci=spUp.jenis==='penghasilan'?'rows':'pesanan';
        const tot={baru:0,diperbarui:0,pindah:0,api:0};
        for(let i=0;i<isi.length;i+=100){
          put('spUpMsg','Mengirim '+int(Math.min(i+100,isi.length))+' / '+int(isi.length)+' pesanan…');
          const h=await api('/api/shopee/upload/'+u.id+'/'+spUp.jenis,json({[kunci]:isi.slice(i,i+100)}));
          tot.baru+=h.baru;tot.diperbarui+=h.diperbarui;tot.pindah+=h.pindah;tot.api+=h.dilewati_api||0;
        }
        await api('/api/shopee/upload/'+u.id+'/selesai',json({status:rk.cek?'perlu_cek':'terbaca',catatan:rk.cek}));
        $('spUpDlg').close();
        alert('Upload '+(spUp.jenis==='penghasilan'?'penghasilan':'pesanan')+' selesai: '+tot.baru+' pesanan baru, '+tot.diperbarui+' diperbarui.'+(tot.api?'\n'+tot.api+' pesanan dilewati karena sudah tersinkron dari API (data API tidak ditimpa file).':'')+
          (tot.pindah?'\n\nPerhatian: '+tot.pindah+' pesanan sebelumnya tercatat di toko lain dan sekarang dipindah ke toko ini. Bila salah pilih toko, upload ulang file ini dengan toko yang benar.':''));
      }
      // Isi file di luar filter tanggal yang sedang dipilih → pindahkan filter ke periode file supaya datanya langsung terlihat
      const segId=$('v-shphasil').classList.contains('active')?'phRange':$('v-shpiklan').classList.contains('active')?'siRange':'spRange',r=rentang(segId),seg=$(segId);
      if(spUp.dari&&spUp.sampai&&(spUp.dari<r.from||spUp.sampai>r.to)){
        seg.dataset.from=spUp.dari;seg.dataset.to=spUp.sampai;seg.querySelector('button[data-range="custom"]').click();
      }else if(segId==='phRange')loadShpHasil();else if(segId==='siRange')loadShpIklan();else loadShpKirim();
    }catch(err){
      put('spUpMsg','Gagal: '+err.message);$('spUpSimpan').disabled=false;
      if(u)api('/api/shopee/upload/'+u.id+'/selesai',json({status:'gagal',catatan:err.message})).catch(()=>{});
    }
  });
  /** Ringkasan isi file untuk Log History (disimpan saat upload) + catatan bila ada yang janggal (status "Perlu dicek") */
  function spRingkasan(h){
    if(h.jenis==='live_produk')return {teks:'Produk live: '+int(h.rows.length)+' produk · '+int(h.terjual)+' terjual · penjualan '+rpFull(h.omzet),cek:''};
    if(h.jenis==='live')return {teks:'Omzet live '+rpFull(h.omzet)+' · '+int(h.pesanan)+' pesanan siap dikirim · '+int(h.sesi)+' sesi',cek:''};
    if(h.jenis==='iklan')return {teks:'Biaya '+rpFull(h.biaya)+' · omzet iklan '+rpFull(h.omzet)+(h.biaya?' · ROAS '+siRoas(h.omzet,h.biaya):'')+' · '+int(h.rows.length)+' iklan',cek:''};
    if(h.jenis==='penghasilan'){
      const beda=h.ringkasan!=null&&Math.abs(h.ringkasan-h.total)>1;
      return {teks:'Penghasilan bersih '+rpFull(h.total)+' · potongan '+rpFull(-h.biaya)+' · '+int(h.rows.length)+' pesanan',
        cek:[beda?'Total beda dengan sheet Summary ('+rpFull(h.ringkasan)+')':'',h.selisih?int(h.selisih)+' pesanan rinciannya tidak sama dengan Total Penghasilan':''].filter(Boolean).join(' · ')};
    }
    const omzet=h.pesanan.filter(p=>!/^batal/i.test(p.status_asli)).reduce((a,p)=>a+p.items.reduce((s,i)=>s+i.harga*i.qty,0),0);
    return {teks:'Omzet '+rpFull(omzet)+' · '+int(h.pesanan.length)+' pesanan · '+int(h.batal)+' batal · '+int(h.pcs)+' pcs',cek:''};
  }

  // -- Log History: file yang sudah di-upload untuk periode (filter tanggal) halaman yang sedang dibuka
  const LOG_JENIS={pesanan:'Pesanan',penghasilan:'Penghasilan',iklan:'Iklan',live:'Live',live_produk:'Produk Live'};
  const LOG_STATUS={terbaca:['rev','✓ Terbaca'],perlu_cek:['spend','Perlu dicek'],gagal:['loss','Gagal'],proses:['loss','Tidak selesai']};
  async function bukaLog(segId,tokoId){
    const r=rentang(segId),q=new URLSearchParams({from:r.from,to:r.to});if($(tokoId).value)q.set('toko',$(tokoId).value);
    put('upLogSub','Periode '+fmtRange(r.from,r.to)+($(tokoId).value?' · '+$(tokoId).selectedOptions[0].textContent:' · semua toko')+' · menurut periode isi file');
    $('upLogIsi').innerHTML='<p style="color:var(--muted)">Memuat…</p>';$('upLogDlg').showModal();
    try{
      const d=await api('/api/shopee/upload?'+q);
      $('upLogIsi').innerHTML='<table class="sku-tbl gd-tbl up-log"><thead><tr><th>File</th><th>Toko</th><th>Jenis</th><th class="n">Baris</th><th>Ringkasan terbaca</th><th>Status</th></tr></thead><tbody>'+
        (d.rows.map(u=>{
          const st=LOG_STATUS[u.status]||LOG_STATUS.terbaca,lama=!u.ringkasan;
          // Upload lama (sebelum Log History) belum punya ringkasan: pakai jumlah data yang tersimpan
          const isi=lama?int(u.pesanan)+' '+(u.jenis==='iklan'?'iklan':'pesanan')+' · '+int(u.baru)+' baru':esc(u.ringkasan);
          return '<tr><td class="nm">'+esc(u.nama_file||'—')+'<small>'+tglWib(u.created_at,true)+(u.oleh?' · '+esc(u.oleh):'')+'</small></td><td>'+esc(u.toko)+'</td>'+
            '<td>'+(LOG_JENIS[u.jenis]||esc(u.jenis))+(u.dari?'<small>'+esc(fmtRange(u.dari,u.sampai||u.dari))+'</small>':'')+'</td><td class="n">'+int(u.baris)+'</td>'+
            '<td class="ket">'+isi+(u.catatan?'<small style="color:var(--loss)">'+esc(u.catatan)+'</small>':'')+'</td>'+
            '<td><span class="tag '+st[0]+'">'+st[1]+'</span></td></tr>'}).join('')||
          '<tr><td colspan="6" style="color:var(--muted)">Belum ada file yang di-upload untuk periode ini.</td></tr>')+'</tbody></table>';
    }catch(err){$('upLogIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat ('+esc(err.message)+').</p>'}
  }
  $('spLogBtn').addEventListener('click',()=>bukaLog('spRange','spToko'));
  $('phLogBtn').addEventListener('click',()=>bukaLog('phRange','phToko'));
  $('siLogBtn').addEventListener('click',()=>bukaLog('siRange','siToko'));
  $('upLogTutup').addEventListener('click',()=>$('upLogDlg').close());

  // ---- Shopee › Iklan: lihat js/pages/shopee-iklan.js (dimuat setelah script ini)
  // Alasan batal Shopee: dipakai Pengiriman Shopee & Pesanan TikTok
  /** Alasan batal Shopee (API berbahasa Inggris, file ekspor berbahasa Indonesia) → label Indonesia seragam + pihak yang membatalkan */
  const SP_ALASAN=[
    [/unpaid|belum dibayar|tidak dibayar|batas waktu pembayaran|otomatis oleh sistem/i,'Tidak dibayar sampai batas waktu','Sistem'],
    [/modify existing|need to modify|ubah pesanan|mengubah pesanan/i,'Ingin mengubah pesanan (warna, ukuran, alamat, voucher, dll.)','Pembeli'],
    [/delivery address|alamat/i,'Ingin mengubah alamat pengiriman','Pembeli'],
    [/voucher/i,'Ingin memasukkan / mengubah kode voucher','Pembeli'],
    [/payment procedure|pembayaran.*(sulit|rumit|repot)/i,'Proses pembayaran merepotkan','Pembeli'],
    [/cheaper|lebih murah/i,'Menemukan harga lebih murah','Pembeli'],
    [/don.?t want|tidak ingin|tidak mau|change of mind|berubah pikiran/i,'Tidak ingin membeli lagi / berubah pikiran','Pembeli'],
    [/did not ship|tidak mengirim|out of stock|stok habis|penjual/i,'Penjual tidak mengirim / stok habis','Penjual'],
    [/failed delivery|gagal kirim|gagal dikirim|pengiriman gagal/i,'Pengiriman gagal','Pengiriman'],
    [/lost|hilang/i,'Paket hilang dalam pengiriman (dikompensasi Shopee)','Pengiriman'],
    [/^others?$|^lainnya$/i,'Lainnya','Pembeli'],
  ];
  const spAlasan=a=>{const s=String(a||'').trim();for(const [re,label,pihak] of SP_ALASAN)if(re.test(s))return {label,pihak};
    return {label:s||'(tanpa alasan)',pihak:/sistem|system/i.test(s)?'Sistem':'Pembeli'}};
  Object.assign(window,{spAlasan,spBatalGrup});   // dipakai js/pages/shopee-pengiriman.js (spBatalGrup ter-hoist)
  /** Gabungkan alasan yang sama artinya; asli = teks asli yang berbeda dari label */
  function spBatalGrup(rows){
    const m=new Map();
    for(const r of rows||[]){const a=spAlasan(r.alasan),x=m.get(a.label)||{label:a.label,pihak:a.pihak,n:0,nilai:0,cod:0,asli:[]};
      x.n+=r.n||0;x.nilai+=r.nilai||0;x.cod+=r.cod||0;if(r.alasan&&r.alasan!==a.label&&!x.asli.includes(r.alasan))x.asli.push(r.alasan);m.set(a.label,x)}
    return [...m.values()].sort((a,b)=>b.n-a.n);
  }

  // ---- Shopee › Penghasilan: lihat js/pages/shopee-penghasilan.js (dimuat setelah script ini)
  // Kanal penjualan (dipakai Penghasilan Shopee & TikTok)
  const PH_KANAL={ads:'Ads',afiliasi:'Affiliate',live:'Live'};
  /**
   * Pembagian tanpa dobel (prioritas): Affiliate (pasti per pesanan, komisi AMS) → Live (overview Live) → Ads (klaim Shopee, maksimal sisa omzet
   * toko) → Organik (sisa). Spending tiap kanal tetap; HPP Ads ikut diskalakan, HPP Organik = HPP toko − kanal lain.
   */
  function phBagiUnik(t,toko){
    const omzetToko=toko.harga||0,sisa=Math.max(0,omzetToko-t.afiliasi.omzet-t.live.omzet),adsOm=Math.min(t.ads.omzet,sisa),f=t.ads.omzet?adsOm/t.ads.omzet:0;
    const ads={omzet:adsOm,spend:t.ads.spend,hpp:t.ads.hpp*f};
    const organik={omzet:Math.max(0,sisa-adsOm),spend:0,hpp:Math.max(0,(toko.hpp||0)-t.afiliasi.hpp-t.live.hpp-ads.hpp)};
    return {ads,organik,faktorAds:f};
  }
  // dipakai js/pages/shopee-penghasilan.js; spToko lewat accessor supaya file halaman bisa membaca & mengisi variabel yang sama
  Object.assign(window,{tkMuat,tkTagSumber,spAngka,liveDurasi,PH_KANAL,phBagiUnik});
  Object.defineProperty(window,'spToko',{get:()=>spToko,set:v=>{spToko=v}});

  // ---- Laporan: lihat js/pages/laporan-bersama.js, laporan-laba-rugi.js, laporan-margin-produk.js, laporan-arus-kas.js, laporan-persediaan.js (dimuat setelah script ini)

  // ---- Data Produk › SKU Mengantar: lihat js/pages/sku-mengantar.js (dimuat setelah script ini)
  // ---- Iklan Meta › Campaign & Ad dan Konten: lihat js/pages/iklan-meta.js (dimuat setelah script ini)
  // ---- Hak akses akun (lihat /api/me): menu yang tidak boleh dibuka disembunyikan, akun hanya-lihat tanpa tombol ubah
  let menuBoleh=null;   // null = semua menu
  /** Kunci menu sebuah halaman = data-group grupnya di sidebar, atau nama halaman untuk tombol tunggal */
  function kunciView(view){
    const b=nav.querySelector('button[data-view="'+view+'"]'),g=b&&b.closest('.grp');
    return g?g.dataset.group:view;
  }
  function bolehView(view){
    if(!menuBoleh)return true;
    return view!=='users'&&view!=='cloudflare'&&menuBoleh.has(kunciView(view));
  }
  function terapkanAkses(j){
    const nama=j.nama||j.user||'',kata=nama.trim().split(/\s+/).filter(Boolean);
    put('akunNama',nama);put('akunPeran',j.peran==='admin'?'Admin · akses penuh':j.boleh_ubah?'User · boleh ubah':'User · hanya lihat');
    put('akunAv',(kata.length>1?kata[0][0]+kata[1][0]:nama.slice(0,2))||'?');$('akunChip').title=nama;
    document.body.classList.toggle('admin',j.peran==='admin');
    document.body.classList.toggle('akun-db',!!j.id);
    if(j.peran==='admin')cfCekBadge();
    menuBoleh=j.peran==='admin'?null:new Set(j.menu||[]);
    // Akun peninjau: hanya menu Shopee, tanpa tombol ubah (server juga menolak permintaan selain baca)
    if(j.peran==='peninjau'){document.body.classList.add('peninjau');bukaView('shpkirim');return}
    document.body.classList.toggle('hanya-lihat',!j.boleh_ubah);
    nav.querySelectorAll(':scope>.grp').forEach(g=>g.classList.toggle('tak-boleh',!!menuBoleh&&!menuBoleh.has(g.dataset.group)));
    nav.querySelectorAll(':scope>button[data-view]').forEach(b=>b.classList.toggle('tak-boleh',!bolehView(b.dataset.view)));
    $('akunPengaturan').hidden=!bolehView('pengaturan');
    const aktif=document.querySelector('.view.active'),v=aktif?aktif.id.slice(2):'';
    if(!bolehView(v)){const b=[...nav.querySelectorAll('button[data-view]')].find(x=>bolehView(x.dataset.view));if(b)bukaView(b.dataset.view)}
  }

  // ---- Manajemen User: lihat js/pages/users.js (dimuat setelah script ini)
  /** Tombol Lihat/Sembunyi di kolom password (form user & ganti password) */
  function lihatPw(b,lihat){
    const p=b.previousElementSibling;p.type=lihat?'text':'password';
    b.textContent=lihat?'Sembunyi':'Lihat';b.setAttribute('aria-label',lihat?'Sembunyikan password':'Tampilkan password');
  }
  const sembunyiPw=root=>root.querySelectorAll('[data-lihat-pw]').forEach(b=>lihatPw(b,false));
  document.addEventListener('click',e=>{const b=e.target.closest('[data-lihat-pw]');if(b)lihatPw(b,b.previousElementSibling.type==='password')});
  // dipakai js/pages/users.js
  Object.assign(window,{sembunyiPw,SKU_IKON_EDIT,SKU_IKON_HAPUS});
  // ---- Pemakaian Cloudflare: lihat js/pages/cloudflare.js (dimuat setelah script ini)

  // Tab Pengaturan: Umum | Pemakaian Cloudflare (admin)
  document.querySelectorAll('[data-pg-tab]').forEach(b=>b.addEventListener('click',()=>bukaView(b.dataset.pgTab)));

  // Menu akun di bawah sidebar: buka / tutup, klik di luar / Esc menutup
  function akunTutup(){$('akunPop').hidden=true;$('akunChip').setAttribute('aria-expanded','false')}
  $('akunChip').addEventListener('click',()=>{
    const buka=$('akunPop').hidden;$('akunPop').hidden=!buka;$('akunChip').setAttribute('aria-expanded',String(buka));
  });
  $('akunPop').addEventListener('click',e=>{const b=e.target.closest('[data-akun-buka]');if(b){akunTutup();bukaView(b.dataset.akunBuka)}});
  document.addEventListener('click',e=>{if(!$('akunPop').hidden&&!e.target.closest('.akun-m'))akunTutup()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('akunPop').hidden){akunTutup();$('akunChip').focus()}});
  // Ganti password sendiri (akun Manajemen User)
  document.querySelector('[data-gantipw]').addEventListener('click',()=>{akunTutup();$('usPwForm').reset();sembunyiPw($('usPwForm'));put('usPwMsg','');$('usPwDlg').showModal()});
  $('usPwTutup').addEventListener('click',()=>$('usPwDlg').close());
  $('usPwBatal').addEventListener('click',()=>$('usPwDlg').close());
  $('usPwForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const f=$('usPwForm'),b=$('usPwSimpan');
    if(f.elements.baru.value!==f.elements.ulang.value){put('usPwMsg','Password baru dan ulangannya tidak sama');return}
    b.disabled=true;put('usPwMsg','');
    try{
      await api('/api/me/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lama:f.elements.lama.value,baru:f.elements.baru.value})});
      $('usPwDlg').close();alert('Password berhasil diganti. Perangkat lain yang memakai akun ini otomatis keluar.');
    }catch(err){put('usPwMsg',err.message)}
    finally{b.disabled=false}
  });

  // ---- Sales › Pcs Terjual: lihat js/pages/sales-pcs.js (dimuat setelah script ini)
  // ---- Sales › CS × Produk: lihat js/pages/sales-cs-produk.js (dimuat setelah script ini)

  // Matriks dengan tepi total (dipakai CS × Produk & Performa Wilayah)
  Object.assign(window,{jumlahkan,pasangMatriks});   // dipakai js/pages/sales-cs-produk.js & sales-wilayah.js (fungsi di bawah ter-hoist)
  /** Tampilkan satu sel sesuai metrik yang dipilih. */
  function cpSel(row,metrik){
    if(!row)return '<td class="c kosong">—</td>';
    const tipis=row.orders<5?' tipis':'';
    if(metrik==='ringkas'){
      // Jumlah lead + porsi Complete (dikonfirmasi) / Pending / Cancel dari lead sel itu
      const p=n=>row.orders?Math.round(100*(n||0)/row.orders)+'%':'—';
      return '<td class="c rk'+tipis+'"><b>'+int(row.orders)+'</b><span class="rk-p">'+
        '<i class="cf" title="Complete">'+p(row.confirmed)+'</i><i class="pd" title="Pending">'+p(row.pending)+'</i>'+
        '<i class="cn" title="Cancel">'+p(row.canceled)+'</i></span></td>';
    }
    if(metrik==='confirm_rate'){
      const v=row.confirm_rate;
      const warna=v==null?'':(v>=80?' hi':(v<60?' lo':''));
      return '<td class="c'+warna+tipis+'">'+pct(v)+'<small>'+int(row.orders)+' order</small></td>';
    }
    if(metrik==='confirmed_value')return '<td class="c'+tipis+'">'+rp(row.confirmed_value)+'</td>';
    if(metrik==='canceled')return '<td class="c'+tipis+'">'+int(row.canceled)+'<small>dari '+int(row.orders)+'</small></td>';
    return '<td class="c'+tipis+'">'+int(row.orders)+'</td>';
  }

  /** Jumlahkan daftar baris/kolom menjadi satu total; confirm_rate dihitung ulang. */
  function jumlahkan(list){
    const g=(list||[]).reduce((a,c)=>({orders:a.orders+(c.orders||0),confirmed:a.confirmed+(c.confirmed||0),
      pending:a.pending+(c.pending||0),canceled:a.canceled+(c.canceled||0),confirmed_value:a.confirmed_value+(c.confirmed_value||0)}),
      {orders:0,confirmed:0,pending:0,canceled:0,confirmed_value:0});
    g.confirm_rate=g.orders?Math.round(1000*g.confirmed/g.orders)/10:null;
    return g;
  }

  /**
   * Susun satu matriks lengkap dengan tepi total di kanan dan bawah.
   * `rows` dan `cols` berisi {key, label, ...metrik}; `peta` dikunci "kunciBaris|kunciKolom".
   */
  function pasangMatriks(idHead,idBody,rows,cols,peta,metrik,judul,totalKanan,totalBawah,grand){
    $(idHead).innerHTML='<tr><th>'+esc(judul)+'</th>'+
      cols.map(c=>'<th class="n">'+esc(c.label)+'</th>').join('')+
      '<th class="n tot">'+esc(totalKanan)+'</th></tr>';
    if(!rows.length){
      $(idBody).innerHTML='<tr><td colspan="'+(cols.length+2)+'" style="color:var(--muted)">Belum ada order pada rentang ini.</td></tr>';
      return;
    }
    const tot=x=>cpSel(x,metrik).replace('class="c','class="c tot');
    const isi=rows.map(r=>'<tr><td class="name p">'+esc(r.label)+'</td>'+
      cols.map(c=>cpSel(peta[r.key+'|'+c.key],metrik)).join('')+tot(r)+'</tr>').join('');
    const kaki='<tr class="tot"><td class="name p">'+esc(totalBawah)+'</td>'+
      cols.map(c=>tot(c)).join('')+tot(grand)+'</tr>';
    $(idBody).innerHTML=isi+kaki;
  }

  // ---- Sales › Performa Wilayah: lihat js/pages/sales-wilayah.js (dimuat setelah script ini)
  // Dipakai Performa Wilayah, Performa CS & Pengaturan
  // Kartu ringkas → buka pop-up tabel lengkap; × atau klik di luar kotak menutup
  document.querySelectorAll('.wl-kartu[data-dlg]').forEach(k=>k.addEventListener('click',()=>$(k.dataset.dlg).showModal()));
  document.querySelectorAll('dialog.wl-dlg').forEach(dl=>dl.addEventListener('click',e=>{
    if(e.target===dl||e.target.closest('[data-tutup]'))dl.close();
  }));

  // ---- Order › Scalev & detail order: lihat js/pages/order.js
  // ---- Sinkron manual
  let syncing=false;
  const syncBtns=()=>document.querySelectorAll('[data-sync]');
  syncBtns().forEach(b=>{const l=b.querySelector('.lbl');if(l)b.dataset.idle=l.textContent;});

  function syncFoot(state,text){
    const el=$('syncFoot');if(!el)return;
    el.innerHTML='<span class="dot'+(state==='ok'?'':' '+state)+'"></span>'+esc(text);
  }

  function setSyncBusy(on,text){
    syncing=on;
    syncBtns().forEach(b=>{
      b.disabled=on;
      const l=b.querySelector('.lbl');
      if(l)l.textContent=on?(text||'Menyinkron…'):(b.dataset.idle||'Sinkron sekarang');
    });
    const ic=$('syncIcon');if(ic)ic.classList.toggle('spin',on);
  }

  /** runAll mengembalikan {scalev:{ok,rows}, meta:{<akun>:{ok,rows}}, ...} — ratakan jadi satu daftar. */
  function flattenSync(res){
    const out=[];
    const add=(name,v)=>{if(v&&typeof v==='object'&&'ok' in v)out.push({name:name,ok:!!v.ok,rows:v.rows||0,message:v.message||''})};
    for(const k in res||{}){
      const v=res[k];
      if(v&&typeof v==='object'&&'ok' in v)add(k,v);
      else if(v&&typeof v==='object')for(const k2 in v)add(k+':'+k2,v[k2]);
    }
    return out;
  }

  const jam=iso=>new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(iso));

  function renderSyncLog(rows){
    const el=$('syncLog');
    if(el){
      el.innerHTML=rows.length?rows.slice(0,12).map(r=>{
        const dtk=(r.started_at&&r.finished_at)?(new Date(r.finished_at)-new Date(r.started_at))/1000:null;
        const ket=r.ok?int(r.rows)+' baris':'gagal';
        const ekor=(r.finished_at?jam(r.finished_at):'—')+' · '+ket+(dtk==null?'':' · '+nf.format(Math.round(dtk*10)/10)+' dtk');
        return '<li><div>'+esc(r.source)+(r.ok?(r.message?' <span>'+esc(r.message)+'</span>':''):' <span style="color:var(--loss)">'+esc(String(r.message||'').slice(0,90))+'</span>')+'</div>'+
          '<span'+(r.ok?'':' style="color:var(--loss)"')+'>'+ekor+'</span></li>';
      }).join(''):'<li><div style="color:var(--muted)">Belum ada catatan sinkron.</div></li>';
    }
    const last=rows[0];
    if($('pgInfoSync'))$('pgInfoSync').innerHTML=last&&last.finished_at?'Terakhir <b>'+new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(last.finished_at))+' WIB</b>'+
      (rows.filter(r=>r.finished_at&&new Date(last.finished_at)-new Date(r.finished_at)<120000).some(r=>!r.ok)?' · <span style="color:var(--loss)">ada yang gagal</span>':' · semua berhasil'):'Belum pernah sinkron';
    if(last&&last.finished_at){
      const w=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(last.finished_at));
      // Hanya catatan dari putaran sinkron yang sama (selisih <2 menit) yang menentukan warna,
      // supaya kegagalan dari sinkron lama tidak membuat status terlihat merah terus.
      const akhir=new Date(last.finished_at).getTime();
      const seputaran=rows.filter(r=>r.finished_at&&akhir-new Date(r.finished_at).getTime()<120000);
      syncFoot(seputaran.some(r=>!r.ok)?'bad':'ok','Sinkron terakhir '+w+' WIB');
    }else syncFoot('off','Belum pernah sinkron');
  }

  async function runSync(){
    if(syncing)return;
    const t0=Date.now();
    setSyncBusy(true);
    const tick=setInterval(()=>setSyncBusy(true,'Menyinkron… '+Math.round((Date.now()-t0)/1000)+' dtk'),1000);
    try{
      const parts=flattenSync(await api('/api/sync/run',{method:'POST'}));
      const gagal=parts.filter(p=>!p.ok),baris=parts.reduce((a,p)=>a+p.rows,0);
      await loadSettings().catch(function(){});
      const aktif=document.querySelector('.view.active');
      if(aktif&&aktif.id==='v-cs')await loadCs();
      if(aktif&&aktif.id==='v-ringkasan')await loadRingkasan();
      syncFoot(gagal.length?'bad':'ok','Selesai · '+int(baris)+' baris'+(gagal.length?' · gagal: '+gagal.map(g=>g.name).join(', '):''));
    }catch(e){
      syncFoot('bad','Sinkron gagal: '+e.message);
    }finally{
      clearInterval(tick);setSyncBusy(false);
    }
  }

  syncBtns().forEach(b=>b.addEventListener('click',runSync));

  // ---- Pengaturan › Sinkronisasi Meta Ads: lihat js/pages/pengaturan.js (dimuat setelah script ini)

  // ---- Pengaturan › Salin template UTM: lihat js/pages/pengaturan.js (dimuat setelah script ini)

  // ---- Pengaturan › Ambil ulang order Scalev: lihat js/pages/pengaturan.js (dimuat setelah script ini)
  loadSettings().catch(e=>syncFoot('bad','Status tidak bisa dimuat'));
  // ---- TikTok Shop › Pesanan & Penghasilan: lihat js/pages/tiktok-pesanan.js, tiktok-penghasilan.js, tiktok-bersama.js (dimuat setelah script ini)

  // ---- Spending Iklan: lihat js/pages/spending-iklan.js (dimuat setelah script ini)
  // ---- TikTok Shop › Iklan: lihat js/pages/tiktok-iklan.js (dimuat setelah script ini)




  // ---- TikTok Shop › Koneksi API: lihat js/pages/tiktok-bersama.js (dimuat setelah script ini)
  {const q=new URLSearchParams(location.search).get('tiktok_api');
    if(q){const ke=new URLSearchParams(location.search).get('ke');history.replaceState(null,'',location.pathname+location.hash);bukaView('pengaturan');setTimeout(()=>alert('TikTok Shop API: '+q),300)}}
  // Kembali dari halaman izin Shopee (/api/shopee-api/callback → /?shopee_api=pesan): tampilkan hasilnya
  {const q=new URLSearchParams(location.search).get('shopee_api');
    if(q){const ke=new URLSearchParams(location.search).get('ke');history.replaceState(null,'',location.pathname+location.hash);bukaView(ke==='pengaturan'?'pengaturan':'shpkirim');setTimeout(()=>alert('Shopee API: '+q),300)}}
  // dipakai js/pages/shopee-iklan.js, laporan-*.js, tiktok-*.js & pengaturan.js; tkToko lewat accessor supaya file halaman bisa membaca & mengisi variabel yang sama
  Object.assign(window,{spBukaUpload,spMuatXlsx,tkPasangPilih,tkBar,spParseCsv,spNorm,siTgl,liveBaris,LOG_JENIS,LOG_STATUS,spBukaToko,loadSettings});
  Object.defineProperty(window,'tkToko',{get:()=>tkToko,set:v=>{tkToko=v}});
  // Nama akun di sidebar (sekaligus memunculkan halaman login bila belum masuk)
  api('/api/me').then(terapkanAkses).catch(()=>{});

  // ---- Tabel data: "Tampilkan N data", urut per kolom (klik judul kolom), dan halaman.
  // Dipasang otomatis ke semua tabel, termasuk yang baru dirender ulang. Tidak dipasang ke tabel di dialog (formulir),
  // pohon campaign, dan laporan berbentuk susunan pos (Laba Rugi, rincian potongan) yang urutannya punya arti.
  const DT_LEWAT='.tree,.rq-item,[data-dt="off"]',DT_SUSUNAN='tr.lr-judul,tr.lr-sub,tr.lr-akhir,tr.lr-pos,tr.sd-tot';
  const DT_BLN={jan:1,feb:2,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,agu:8,agt:8,aug:8,sep:9,okt:10,oct:10,nov:11,des:12,dec:12};
  let dtSibuk=false,dtNo=0;
  /** Nilai sel untuk pengurutan: data-sort bila ada, tanggal, angka format Indonesia (Rp 1.234,5 · 58,6% · 5,1 jt), selain itu teks */
  function dtNilai(td){
    if(!td)return null;
    if(td.dataset.sort!=null){const v=td.dataset.sort;return v!==''&&!isNaN(v)?+v:v.toLowerCase()}
    const t=td.textContent.replace(/\s+/g,' ').trim();
    if(!t||t==='—'||t==='-')return null;
    if(/^\d{4}-\d{2}-\d{2}/.test(t))return t;
    let m=t.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.?(?: (\d{4}))?(?:,? (\d{1,2})[.:](\d{2}))?/);
    if(m&&DT_BLN[m[2].toLowerCase()])return (+(m[3]||0)*10000+DT_BLN[m[2].toLowerCase()]*100+ +m[1])*10000+ +(m[4]||0)*100+ +(m[5]||0);
    m=t.match(/^([−-])?\s*(?:Rp\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(jt|rb|M)?(?![\w-])/i);
    if(m){let v=parseFloat(m[2].replace(/\./g,'')+(m[3]?'.'+m[3]:''));const s=(m[4]||'').toLowerCase();v*=s==='jt'?1e6:s==='rb'?1e3:s==='m'?1e9:1;return m[1]?-v:v}
    return t.toLowerCase();
  }
  function dtSiap(tbl){
    if(tbl._dt)return tbl._dt;
    const wrap=document.createElement('div'),atas=document.createElement('div'),gulir=document.createElement('div'),bawah=document.createElement('div');
    wrap.className='dt-wrap';atas.className='dt-atas';gulir.className='dt-gulir';bawah.className='dt-bawah';
    atas.innerHTML='<label>Tampilkan <select aria-label="Jumlah data per halaman">'+[10,25,50,100].map(n=>'<option value="'+n+'">'+n+'</option>').join('')+'<option value="0">Semua</option></select> data</label>';
    tbl.before(wrap);gulir.append(tbl);wrap.append(atas,gulir,bawah);
    const st={atas,bawah,ukuran:10,hal:1,kol:-1,arah:1};
    tbl._dt=st;tbl.classList.add('dt');
    atas.querySelector('select').addEventListener('change',e=>{st.ukuran=+e.target.value;st.hal=1;dtJalan([tbl])});
    bawah.addEventListener('click',e=>{const b=e.target.closest('button[data-hal]');if(!b||b.disabled)return;st.hal=+b.dataset.hal;dtJalan([tbl])});
    tbl.addEventListener('click',e=>{
      const th=e.target.closest('th.dt-sort');if(!th||th.closest('table')!==tbl||e.target.closest('input,button,select,a'))return;
      const i=+th.dataset.dtKol;
      if(st.kol===i)st.arah=-st.arah;else{st.kol=i;st.arah=th.classList.contains('n')?-1:1}   // kolom angka: terbesar dulu
      st.hal=1;dtJalan([tbl]);
    });
    return st;
  }
  function dtTerap(tbl){
    const st=dtSiap(tbl),tb=tbl.tBodies[0];if(!tb)return;
    // Judul kolom yang bisa diklik (hanya untuk header satu baris tanpa sel gabungan)
    const hr=tbl.tHead?tbl.tHead.rows:[],bisa=hr.length===1&&![...hr[0].cells].some(c=>c.colSpan>1);
    if(!bisa)st.kol=-1;
    if(hr.length)[...hr[0].cells].forEach((th,i)=>{
      const ok=bisa&&!!th.textContent.trim()&&!th.querySelector('input,button,select');
      th.classList.toggle('dt-sort',ok);if(ok)th.dataset.dtKol=i;
      th.classList.toggle('dt-asc',ok&&st.kol===i&&st.arah===1);th.classList.toggle('dt-desc',ok&&st.kol===i&&st.arah===-1);
    });
    // Kelompok baris: baris detail (dibuka dari baris di atasnya) ikut baris induknya
    const grup=[];
    for(const tr of tb.rows){if(tr.classList.contains('detail')&&grup.length)grup[grup.length-1].push(tr);else grup.push([tr])}
    // Baris tunggal "Memuat…" / "Belum ada data" (satu sel melebar) bukan data
    const kosong=grup.length===1&&grup[0][0].cells.length===1&&(grup[0][0].cells[0].colSpan>1||(hr.length>0&&hr[0].cells.length>1));
    const atasT=[],data=[],bawahT=[];
    for(const g of grup){
      if(kosong||g[0].classList.contains('tot'))(data.length?bawahT:atasT).push(g);
      else{if(!g[0].dataset.dtI)g[0].dataset.dtI=++dtNo;data.push(g)}
    }
    const asli=(x,y)=>x[0].dataset.dtI-y[0].dataset.dtI;
    if(st.kol>=0){
      for(const g of data)g.v=dtNilai(g[0].cells[st.kol]);
      const angka=data.every(g=>g.v==null||typeof g.v==='number');
      data.sort((x,y)=>{
        if(x.v==null||y.v==null)return x.v==null&&y.v==null?asli(x,y):x.v==null?1:-1;   // sel kosong selalu di bawah
        return (angka?x.v-y.v:String(x.v).localeCompare(String(y.v),'id',{numeric:true}))*st.arah||asli(x,y);
      });
    }else data.sort(asli);
    const urutan=[...atasT,...data,...bawahT].flat();
    if(urutan.some((tr,i)=>tb.rows[i]!==tr))tb.append(...urutan);
    // Halaman — baris yang disembunyikan filter halaman (atribut hidden) tidak dihitung
    const tampil=data.filter(g=>!g[0].hidden),n=tampil.length,uk=st.ukuran||n||1,jml=Math.max(1,Math.ceil(n/uk));
    st.hal=Math.min(Math.max(1,st.hal),jml);
    const awal=(st.hal-1)*uk,akhir=Math.min(n,awal+uk);
    tampil.forEach((g,i)=>{const on=i>=awal&&i<akhir;for(const tr of g)tr.classList.toggle('dt-off',!on);g[0].classList.toggle('dt-gj',on&&(i-awal)%2===0)});
    for(const tr of tb.rows)if(!tr.classList.contains('detail'))[...tr.cells].forEach((c,i)=>c.classList.toggle('dt-kol',i===st.kol&&!kosong));
    st.atas.hidden=st.bawah.hidden=kosong;
    if(kosong)return;
    const tb2=(h,isi,cls)=>'<button type="button" data-hal="'+h+'"'+(cls?' class="'+cls+'"':'')+(h<1||h>jml||cls==='on'?' disabled':'')+'>'+isi+'</button>';
    const hal=[];for(let h=1;h<=jml;h++)if(h===1||h===jml||Math.abs(h-st.hal)<=1)hal.push(h);else if(hal[hal.length-1]!=='…')hal.push('…');
    st.bawah.innerHTML='<span>'+(n?'Menampilkan '+int(awal+1)+' sampai '+int(akhir)+' dari '+int(n)+' data':'Tidak ada data')+'</span>'+
      '<div class="dt-hal">'+tb2(st.hal-1,'Sebelumnya','dt-nav')+hal.map(h=>h==='…'?'<i>…</i>':tb2(h,h,h===st.hal?'on':'')).join('')+tb2(st.hal+1,'Berikutnya','dt-nav')+'</div>';
  }
  const dtBoleh=t=>t.isConnected&&t.tBodies.length&&!t.closest('dialog')&&!t.matches(DT_LEWAT)&&!(t.parentElement&&t.parentElement.closest('table'))&&!t.querySelector(DT_SUSUNAN);
  function dtJalan(tbls){
    dtSibuk=true;
    try{for(const t of tbls){if(dtBoleh(t))dtTerap(t);else if(t._dt&&t.isConnected){t._dt.atas.hidden=t._dt.bawah.hidden=true;t.querySelectorAll('.dt-off').forEach(x=>x.classList.remove('dt-off'))}}}
    catch(e){console.error('tabel',e)}
    finally{dtObs.takeRecords();dtSibuk=false}
  }
  const dtObs=new MutationObserver(ms=>{
    if(dtSibuk)return;const set=new Set();
    for(const m of ms){
      const el=m.target.nodeType===1?m.target:m.target.parentElement,t=el&&el.closest('table');if(t)set.add(t);
      m.addedNodes.forEach(x=>{if(x.nodeType!==1)return;if(x.tagName==='TABLE')set.add(x);else x.querySelectorAll('table').forEach(y=>set.add(y))});
    }
    if(set.size)dtJalan(set);
  });
  dtJalan(document.querySelectorAll('table'));
  dtObs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
})();
