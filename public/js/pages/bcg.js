/**
 * Analisis › BCG Matrix (satu halaman untuk Soskom, Shopee, TikTok Shop): kartu kuadran, matriks 2×2, tabel produk, ekspor CSV.
 * Data: /api/report/katalog (Soskom), /api/report/bcg-marketplace (Shopee & TikTok).
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta rentang() & loadSettings() dari script utama (window.*).
 * Dipanggil dari script utama: openBcg('soskom' | 'shopee' | 'tiktok') (tiga menu BCG Matrix).
 */
/**
 * Analisis › BCG Matrix: portofolio produk sendiri, bukan pasar.
 *  - Pangsa = omzet closing produk ÷ total omzet closing semua produk yang tampil. Batas tinggi/rendah =
 *    pangsa rata-rata (100% ÷ jumlah produk yang laku), jadi "tinggi" = menyumbang di atas rata-rata.
 *  - Pertumbuhan = omzet periode ini vs periode sebelumnya dengan panjang hari yang sama.
 *    Produk tanpa omzet di periode lalu = "Baru" dan dianggap tumbuh.
 * Angka diambil dari /api/report/katalog (sama dengan Produk Iklan), dua kali: periode ini dan periode lalu.
 */
const BCG_BATAS_TUMBUH=10;            // % pertumbuhan minimal untuk kuadran atas — ubah bila target berubah
const BCG_KARTU_MAKS=12;              // kartu produk per kuadran; sisanya cukup dilihat di tabel
// Ikon putih di pojok kuadran (bintang, tanda tanya, kepala sapi, kepala anjing)
const BCG_IKON={
  star:'<svg viewBox="0 0 48 48"><path d="M24 4.5l5.9 12.1 13.3 1.9-9.6 9.4 2.3 13.2L24 34.9l-11.9 6.2 2.3-13.2-9.6-9.4 13.3-1.9z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>',
  tanya:'<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff"/><path d="M18 18.5a6 6 0 1 1 8.6 5.4c-1.7.8-2.6 2-2.6 3.8v1.6" fill="none" stroke="var(--t)" stroke-width="4.2" stroke-linecap="round"/><circle cx="24" cy="35.5" r="2.7" fill="var(--t)"/></svg>',
  cow:'<svg viewBox="0 0 48 48" fill="#fff"><path d="M12 5c-2 3-2 7 1 9.5l3 1.6h16l3-1.6c3-2.5 3-6.5 1-9.5-.4 3-2 5-4.5 5.5H16.5C14 10 12.4 8 12 5z"/><path d="M3 18c3-2.4 7-2.8 10.5-1.6l.5 3.6C10 21.5 6 21 3 18zm42 0c-3-2.4-7-2.8-10.5-1.6l-.5 3.6c4 1.5 8 1 11-2z"/><path d="M15 15h18l-.8 13.5c-.2 2.5 2.3 4.2 2.3 7.5 0 4-2.8 7-6.5 7h-9c-3.7 0-6.5-3-6.5-7 0-3.3 2.5-5 2.3-7.5z"/></svg>',
  dog:'<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"><path d="M13 9h22l8 5-1.5 12-5.5-5v14a7 7 0 0 1-7 7H18a7 7 0 0 1-7-7V21l-5.5 5L4 14z"/><circle cx="18.5" cy="27" r="1.4" fill="#fff"/><circle cx="29.5" cy="27" r="1.4" fill="#fff"/><path d="M21.5 32.5l2.5 2.5 2.5-2.5M24 35v2.5"/></svg>',
};
const BCG_Q={
  star: {judul:'Star',          kelas:'bq-star', aksi:'Pangsa besar & tumbuh — tambah budget iklan, jaga stok'},
  tanya:{judul:'Question Mark', kelas:'bq-tanya',aksi:'Tumbuh tapi pangsa kecil — uji skala, dorong yang menjanjikan'},
  cow:  {judul:'Cash Cow',      kelas:'bq-cow',  aksi:'Pangsa besar, tumbuh pelan — pertahankan, efisienkan biaya'},
  dog:  {judul:'Dog',           kelas:'bq-dog',  aksi:'Pangsa kecil & tidak tumbuh — evaluasi, kurangi atau hentikan'},
};
const BCG_URUT=['star','tanya','cow','dog'];   // urutan baca matriks: kiri atas, kanan atas, kiri bawah, kanan bawah
let bcData=null,bcBusy=false,bcStoresOk=false,bcPlat='soskom',bcMuatKe=0;
/** Per platform: judul, label unit kedua, dan arti kolom closing / lead di tabel */
const BCG_PLAT={
  soskom:{judul:'BCG Matrix Soskom',unit2:'Produk gabungan',unitNama:['per produk Scalev','per produk gabungan'],omzet:'Omzet closing',a:'Closing',b:'Lead',
    ket:'Omzet = nilai gross order closing, dibagi rata bila satu order berisi beberapa produk'},
  shopee:{judul:'BCG Matrix Shopee',unit2:'Per SKU',unitNama:['per produk Shopee','per SKU Manajemen SKU'],omzet:'Omzet',a:'Pesanan',b:'Pcs',
    ket:'Omzet = harga setelah diskon × qty dari pesanan Shopee selain batal & belum bayar (tanggal pesanan dibuat), barang retur dikurangi'},
  tiktok:{judul:'BCG Matrix TikTok Shop',unit2:'Per SKU',unitNama:['per produk TikTok','per SKU Manajemen SKU'],omzet:'Omzet',a:'Pesanan',b:'Pcs',
    ket:'Omzet = subtotal setelah diskon dari pesanan TikTok selain batal & belum bayar (tanggal pesanan dibuat), barang retur dikurangi'},
};

/**
 * Satukan data menjadi unit BCG {nama, omzet, closing, orders}. Soskom: per nama produk Scalev, atau per produk gabungan.
 * Marketplace: per nama produk listing, atau per SKU (nama di Manajemen SKU, kalau belum ada pakai Seller SKU); closing = pesanan, orders = pcs.
 */
function bcUnit(d,mode){
  const m=new Map();
  const tambah=(nama,it)=>{const u=m.get(nama)||{nama,omzet:0,closing:0,orders:0};u.omzet+=it.omzet;u.closing+=it.closing;u.orders+=it.orders;m.set(nama,u)};
  if(bcPlat!=='soskom'){
    for(const it of d.items||[])tambah(mode==='gab'?(it.sku_produk||(it.sku?'SKU '+it.sku:'(tanpa SKU) '+it.nama)):it.nama,
      {omzet:Number(it.omzet)||0,closing:Number(it.pesanan)||0,orders:Number(it.pcs)||0});
  }else if(mode==='gab'){
    const perKey=new Map((d.items||[]).map(x=>[x.key,x]));
    for(const g of d.gabungan||[])for(const s of g.items){const it=perKey.get(s.key);if(it)tambah(g.name,it);else tambah(g.name,{omzet:0,closing:0,orders:0})}
  }else for(const it of d.items||[])if(it.orders||it.omzet)tambah(it.product_name||it.name,it);
  return m;
}

function renderBcg(){
  const {kini,lalu,prev}=bcData;
  const mode=((document.querySelector('#bcUnit button.on')||{}).dataset||{}).unit||'produk';
  const P=BCG_PLAT[bcPlat],sel=bcPlat==='soskom'?$('bcStore'):$('bcToko');
  const st=sel.value?' · '+sel.selectedOptions[0].textContent:'';
  put('bcPeriod',fmtRange(kini.from,kini.to)+' dibanding '+fmtRange(prev.from,prev.to)+st+' · '+P.unitNama[mode==='gab'?1:0]);
  const A=bcUnit(kini,mode),B=bcUnit(lalu,mode);
  const nama=new Set([...A.keys(),...B.keys()]);
  const rows=[...nama].map(n=>{
    const a=A.get(n)||{omzet:0,closing:0,orders:0},b=B.get(n)||{omzet:0};
    return {nama:n,omzet:a.omzet,closing:a.closing,orders:a.orders,lalu:b.omzet,tumbuh:b.omzet>0?100*(a.omzet-b.omzet)/b.omzet:null};
  }).filter(r=>r.omzet>0||r.lalu>0);
  const laku=rows.filter(r=>r.omzet>0),total=laku.reduce((s,r)=>s+r.omzet,0);
  const batasPangsa=laku.length?100/laku.length:0;
  for(const r of rows){
    r.pangsa=total?100*r.omzet/total:0;
    r.q=r.omzet<=0?null:(r.pangsa>=batasPangsa?(r.tumbuh==null||r.tumbuh>=BCG_BATAS_TUMBUH?'star':'cow'):(r.tumbuh==null||r.tumbuh>=BCG_BATAS_TUMBUH?'tanya':'dog'));
  }
  rows.sort((x,y)=>(x.q?BCG_URUT.indexOf(x.q):9)-(y.q?BCG_URUT.indexOf(y.q):9)||y.omzet-x.omzet||y.lalu-x.lalu);
  bcData.rows=rows;

  // Kartu per kuadran
  $('bcKpi').innerHTML=BCG_URUT.map(k=>{
    const q=BCG_Q[k],isi=laku.filter(r=>r.q===k),om=isi.reduce((s,r)=>s+r.omzet,0);
    return '<div class="card kpi tone '+q.kelas+'"><div class="l">'+q.judul+' · '+int(isi.length)+' produk</div><div class="v">'+rp(om)+'</div>'+
      '<div class="d"><b>'+pct(total?100*om/total:0)+'</b> dari omzet · '+esc(q.aksi)+'</div></div>';
  }).join('');

  // Tabel
  const tumbuhTeks=r=>r.tumbuh==null?(r.omzet>0?'<span class="bc-up">Baru</span>':'—'):
    '<span class="'+(r.tumbuh>=0?'bc-up':'bc-down')+'">'+(r.tumbuh>=0?'▲ ':'▼ ')+pct(Math.abs(r.tumbuh))+'</span>';
  $('bcRows').innerHTML=rows.length?rows.map(r=>'<tr><td class="name">'+esc(r.nama)+'</td>'+
    '<td>'+(r.q?'<span class="bc-q '+BCG_Q[r.q].kelas+'">'+BCG_Q[r.q].judul+'</span>':'<span class="bc-q mut">Tidak laku periode ini</span>')+'</td>'+
    '<td class="n">'+rpFull(r.omzet)+'</td><td class="n">'+rpFull(r.lalu)+'</td><td class="n">'+tumbuhTeks(r)+'</td>'+
    '<td class="n">'+pct(r.pangsa)+'</td><td class="n">'+int(r.closing)+'</td><td class="n">'+int(r.orders)+'</td></tr>').join('')
    :'<tr><td colspan="8" style="color:var(--muted)">'+(bcPlat!=='soskom'?'Belum ada pesanan '+(bcPlat==='shopee'?'Shopee':'TikTok')+' pada rentang ini — upload / sinkron di menu Pesanan.':mode==='gab'&&!(kini.gabungan||[]).length?'Belum ada produk gabungan — buat di Iklan Meta › Produk Iklan, atau pilih "Per produk".':'Belum ada omzet closing pada rentang ini.')+'</td></tr>';

  // Catatan
  const cat=['Pangsa tinggi = di atas rata-rata '+pct(batasPangsa)+' ('+int(laku.length)+' produk laku) · tumbuh = omzet naik minimal '+BCG_BATAS_TUMBUH+'% dari periode lalu.'];
  const baru=laku.filter(r=>r.tumbuh==null).length;
  if(baru)cat.push(int(baru)+' produk tanpa omzet di periode lalu dihitung "Baru" (dianggap tumbuh).');
  const hilang=rows.filter(r=>!r.q).length;
  if(hilang)cat.push(int(hilang)+' produk laku di periode lalu tapi tidak ada omzet closing periode ini — tidak masuk matriks, lihat tabel.');
  if(bcPlat!=='soskom'&&mode==='gab'){
    const tanpa=laku.filter(r=>/^(SKU |\(tanpa SKU\) )/.test(r.nama)).length;
    if(tanpa)cat.push(int(tanpa)+' baris belum punya nama di Manajemen SKU — ditampilkan dengan Seller SKU / nama produk.');
  }
  if(bcPlat==='soskom'&&mode==='gab'){
    const semua=(kini.items||[]).reduce((s,x)=>s+x.omzet,0);
    if(semua)cat.push('Produk gabungan mencakup '+pct(100*total/semua)+' dari omzet closing seluruh produk'+(total>semua?' (ada produk yang masuk lebih dari satu gabungan)':'')+'.');
  }
  $('bcNote').hidden=false;$('bcNote').innerHTML=cat.map(esc).join('<br>');

  bcMatriks(laku);
}

/** Matriks 2×2: tiap kuadran berisi kartu produk (omzet terbesar dulu), sisanya ditunjuk ke tabel. */
function bcMatriks(laku){
  const tumbuh=r=>r.tumbuh==null?'Baru':(r.tumbuh>=0?'▲ ':'▼ ')+pct(Math.abs(r.tumbuh));
  $('bcGrid').innerHTML=BCG_URUT.map(k=>{
    const q=BCG_Q[k],isi=laku.filter(r=>r.q===k),om=isi.reduce((s,r)=>s+r.omzet,0);
    const kartu=isi.slice(0,BCG_KARTU_MAKS).map(r=>'<div class="bq-kartu" title="'+esc(r.nama+' · omzet '+rpFull(r.omzet)+' · pangsa '+pct(r.pangsa)+' · pertumbuhan '+tumbuh(r))+'">'+
      '<b>'+esc(r.nama)+'</b><span>'+rp(r.omzet)+' · '+tumbuh(r)+'</span></div>').join('');
    const lagi=isi.length-BCG_KARTU_MAKS;
    return '<div class="bq '+q.kelas+'"><div class="bq-h"><div><h4>'+q.judul+'</h4><small>'+esc(q.aksi)+'</small></div>'+BCG_IKON[k]+'</div>'+
      '<div class="bq-isi">'+(kartu||'<span class="bq-kosong">Belum ada produk di kuadran ini</span>')+'</div>'+
      '<div class="bq-f"><span><b>'+int(isi.length)+'</b> produk · <b>'+rp(om)+'</b></span>'+(lagi>0?'<span>+'+int(lagi)+' produk lain di tabel</span>':'')+'</div></div>';
  }).join('');
}

async function loadBcg(){
  // Pindah platform saat masih memuat: hasil lama diabaikan (bcMuatKe), bukan ditolak
  const ke=++bcMuatKe,plat=bcPlat;bcBusy=true;
  const r=rentang('bcRange'),store=$('bcStore').value,toko=$('bcToko').value;
  const hari=Math.round((new Date(r.to+'T00:00:00Z')-new Date(r.from+'T00:00:00Z'))/86400000)+1;
  const prev={from:shift(r.from,-hari),to:shift(r.from,-1)};
  const q=x=>{const p=new URLSearchParams({from:x.from,to:x.to});
    if(plat==='soskom'){if(store)p.set('store_id',store);return '/api/report/katalog?'+p}
    p.set('platform',plat);if(toko)p.set('toko',toko);return '/api/report/bcg-marketplace?'+p};
  $('bcRows').innerHTML='<tr><td colspan="8" style="color:var(--muted)">Memuat…</td></tr>';
  try{
    const [kini,lalu]=await Promise.all([api(q(r)),api(q(prev))]);
    if(ke!==bcMuatKe)return;
    bcData={kini,lalu,prev};
    if(plat!=='soskom'){
      const sel=$('bcToko'),v=sel.value;
      sel.innerHTML='<option value="">Semua toko</option>'+(kini.toko||[]).map(t=>'<option value="'+t.id+'">'+esc(t.nama)+'</option>').join('');
      sel.value=[...sel.options].some(o=>o.value===v)?v:'';
    }
    renderBcg();
  }catch(e){
    if(ke!==bcMuatKe)return;
    bcData=null;
    $('bcRows').innerHTML='<tr><td colspan="8" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>';
  }finally{if(ke===bcMuatKe)bcBusy=false}
}

/** Buka BCG untuk satu platform: judul, filter (store / toko), dan label kolom ikut platformnya */
function openBcg(plat){
  if(plat!==bcPlat){bcPlat=plat;bcData=null;$('bcToko').value=''}
  const P=BCG_PLAT[bcPlat];
  put('bcJudul',P.judul);put('bcTblKet',P.ket);put('bcThOmzet',P.omzet);put('bcThA',P.a);put('bcThB',P.b);
  const u=$('bcUnit').querySelector('[data-unit="gab"]');if(u)u.textContent=P.unit2;
  $('bcStoreW').hidden=bcPlat!=='soskom';$('bcTokoW').hidden=bcPlat==='soskom';
  if(bcPlat==='soskom'&&!bcStoresOk){bcStoresOk=true;loadSettings().catch(function(){bcStoresOk=false})}
  loadBcg();
}
$('bcRange').addEventListener('click',e=>{if(e.target.closest('button'))loadBcg()});
$('bcStore').addEventListener('change',loadBcg);
$('bcToko').addEventListener('change',loadBcg);
$('bcUnit').addEventListener('click',e=>{if(e.target.closest('button')&&bcData)renderBcg()});
$('bcExport').addEventListener('click',()=>{
  if(!bcData||!bcData.rows)return;
  const P=BCG_PLAT[bcPlat];
  unduhCsv('bcg-matrix-'+bcPlat+'-'+bcData.kini.from+'_'+bcData.kini.to+'.csv',
    ['Produk','Kuadran',P.omzet,'Omzet periode lalu','Pertumbuhan (%)','Pangsa omzet (%)',P.a,P.b],
    bcData.rows.map(r=>[r.nama,r.q?BCG_Q[r.q].judul:'Tidak laku periode ini',Math.round(r.omzet),Math.round(r.lalu),
      r.tumbuh==null?(r.omzet>0?'Baru':''):Math.round(r.tumbuh*10)/10,Math.round(r.pangsa*10)/10,r.closing,r.orders]));
});
