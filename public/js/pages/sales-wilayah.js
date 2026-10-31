/**
 * Sales › Performa Wilayah: peta persebaran (provinsi / kabupaten-kota / kecamatan, per lead / closing / pending / cancel), top wilayah,
 * pop-up matriks Wilayah × CS, Wilayah × Produk, alasan batal per wilayah, ekspor CSV.
 * Data: /api/report/wilayah, /api/report/wilayah-daftar, public/geo/indonesia-provinsi.json, public/geo/titik-wilayah.json.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta rentang(), loadSettings(), jumlahkan() & pasangMatriks() dari script utama (window.*).
 * Dipanggil dari script utama: openWilayah() (menu Performa Wilayah).
 */
// ---- CS × Wilayah
let wlData=null,wlBusy=false,wlStoresOk=false;

const wlDates=()=>rentang('wlRange');

// ---- Peta persebaran: titik per provinsi / kabupaten-kota / kecamatan di atas peta dasar provinsi
const PETA_MODE={
  orders:   {tone:'info', judul:'Peta persebaran lead',        top:'Lead terbanyak'},
  confirmed:{tone:'rev',  judul:'Peta closing tertinggi',      top:'Closing tertinggi'},
  pending:  {tone:'spend',judul:'Peta lead pending tertinggi', top:'Pending tertinggi'},
  canceled: {tone:'loss', judul:'Peta lead cancel tertinggi',  top:'Cancel tertinggi'},
};
const PETA_TINGKAT={
  prov:{nama:'provinsi',       rMax:26},
  kab: {nama:'kabupaten/kota', rMax:17},
  kec: {nama:'kecamatan',      rMax:11},
};
let petaMode='orders',petaTingkat='prov',petaGeo=null,petaGeoJanji=null,petaProj=null,petaIx=null,petaTitikJanji=null,petaTitik=[];

/** Samakan penulisan nama provinsi Scalev dan peta: "DI. ACEH" = "Nanggroe Aceh Darussalam (NAD)". */
const kunciProv=s=>String(s||'').toUpperCase().replace(/\(.*?\)/g,'').replace(/[^A-Z]/g,'')
  .replace(/^DAERAHKHUSUS(IBUKOTA)?/,'DKI').replace(/^(DAERAHISTIMEWA|NANGGROE|DI)/,'').replace(/DARUSSALAM$/,'').replace(/^KEPULAUANBANGKA/,'BANGKA');

const muatJson=u=>fetch(u).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});
function muatGeo(){
  if(!petaGeoJanji)petaGeoJanji=muatJson('/geo/indonesia-provinsi.json').then(g=>petaGeo=g).catch(e=>{petaGeoJanji=null;throw e});
  return petaGeoJanji;
}
function muatTitik(){
  if(!petaTitikJanji)petaTitikJanji=muatJson('/geo/titik-wilayah.json').then(g=>petaIx=indeksTitik(g)).catch(e=>{petaTitikJanji=null;throw e});
  return petaTitikJanji;
}

// ---- Pencocokan nama wilayah Scalev → titik koordinat (public/geo/titik-wilayah.json)
const hurufSaja=s=>String(s||'').toUpperCase().replace(/[^A-Z]/g,'');
const ROMAWI={I:'SATU',II:'DUA',III:'TIGA',IV:'EMPAT',V:'LIMA'};
/**
 * Semua ejaan alternatif sebuah nama wilayah, dalam huruf saja:
 * "Sei/Sungai Raya" → SEIRAYA, SUNGAIRAYA · "Belah Batuh (Blahbatuh)" → keduanya ·
 * "Kudus Kota" → KUDUSKOTA, KUDUS, KOTAKUDUS, KOTA · "Ilir Barat I" → ILIRBARATI, ILIRBARATSATU.
 */
function varianNama(s){
  const t=String(s||'').toUpperCase().trim();
  const out=new Set();
  const kurung=[...t.matchAll(/\(([^)]*)\)/g)].map(m=>m[1]);
  const tanpaKurung=t.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  const pecah=x=>{
    const m=/(\S*)\s*\/\s*(\S*)/.exec(x);
    if(!m)return[x];
    return [x.replace(m[0],m[1]),x.replace(m[0],m[2])].flatMap(pecah);
  };
  const tambah=x=>{
    out.add(hurufSaja(x));
    out.add(hurufSaja(x.replace(/\b(IV|V|I{1,3})\b/g,r=>ROMAWI[r])));
    const m=/^(.*?)\s*-?\s*\bKOTA\b\s*\)?\s*$/.exec(x);       // "Kudus Kota" = "Kota Kudus"
    if(m&&m[1]){out.add(hurufSaja(m[1]));out.add('KOTA'+hurufSaja(m[1]));out.add('KOTA')}
  };
  for(const x of [tanpaKurung,...kurung])for(const y of pecah(x))tambah(y);
  if(kurung.some(k=>/^\s*KOTA\s*$/.test(k)))for(const y of pecah(tanpaKurung))out.add('KOTA'+hurufSaja(y));  // "Ternate Selatan (Kota)"
  for(const v of [...out])if(ALIAS_WILAYAH[v])out.add(ALIAS_WILAYAH[v]);
  out.delete('');
  return [...out];
}
// Nama lama di Scalev untuk wilayah yang sudah berganti nama/dimekarkan (Kepmendagri 2025)
const ALIAS_WILAYAH={TOBASAMOSIR:'TOBA',TAMPAN:'TUAHMADANI'};
function jarak(a,b){                                  // Levenshtein
  if(Math.abs(a.length-b.length)>3)return 99;
  let p=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const q=[i];
    for(let j=1;j<=b.length;j++)q[j]=Math.min(p[j]+1,q[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));
    p=q;
  }
  return p[b.length];
}
/** Cari kunci terdekat: persis → mengandung → selisih huruf kecil (maks 20% panjang). */
function cariMirip(varian,calon){
  for(const v of varian)if(calon.has(v))return calon.get(v);
  let best=null,bd=99;
  for(const v of varian)for(const [k,val] of calon){
    if(v.length>=5&&k.length>=5&&(k.startsWith(v)||v.startsWith(k))){const d=Math.abs(k.length-v.length);if(d<bd){bd=d;best=val}continue}
    const d=jarak(v,k);if(d<=Math.max(1,Math.floor(Math.min(v.length,k.length)*.2))&&d<bd){bd=d;best=val}
  }
  return best;
}
const jenisKab=s=>/^\s*KOTA\b/i.test(String(s||''))?'KOTA':'KAB';
const namaKab=s=>String(s||'').toUpperCase().replace(/ADMINISTRASI|ADM\./g,' ').replace(/^\s*(KOTA|KABUPATEN|KAB\.?)\s*/,'');

/** Bangun indeks dari file titik: kab per jenis (KOTA/KAB), kec per kode kabupaten. */
function indeksTitik(g){
  const kab={KOTA:new Map(),KAB:new Map()},kec=new Map(),provNama=new Map(g.prov.map(r=>[r[0],r[1]]));
  for(const r of g.kab)for(const v of varianNama(namaKab(r[1])))kab[jenisKab(r[1])].set(v,r);
  for(const r of g.kec){
    const kk=r[0].slice(0,5);if(!kec.has(kk))kec.set(kk,new Map());
    for(const v of varianNama(r[1]))kec.get(kk).set(v,r);
  }
  const provTitik=new Map(g.prov.map(r=>[kunciProv(r[1]),r]));
  return {kab,kec,provNama,provTitik};
}
function titikKab(ix,city){return cariMirip(varianNama(namaKab(city)),ix.kab[jenisKab(city)])}
function titikKec(ix,city,kecamatan){
  const k=titikKab(ix,city);if(!k)return null;
  const m=ix.kec.get(k[0].slice(0,5));return m?cariMirip(varianNama(kecamatan),m):null;
}

/** Proyeksi equirectangular — cukup akurat untuk Indonesia yang dekat khatulistiwa. */
function gambarPeta(g){
  let x0=180,x1=-180,y0=90,y1=-90;
  const tiap=fn=>g.features.forEach(f=>f.geometry.coordinates.forEach(p=>p.forEach(r=>r.forEach(fn))));
  tiap(([x,y])=>{if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y});
  const k=20,W=(x1-x0)*k,H=(y1-y0)*k;
  petaProj={x:lng=>(lng-x0)*k,y:lat=>(y1-lat)*k};
  const paths=g.features.map(f=>'<path d="'+f.geometry.coordinates.map(p=>p.map(r=>'M'+r.map(([x,y])=>((x-x0)*k).toFixed(1)+','+((y1-y)*k).toFixed(1)).join('L')+'Z').join('')).join('')+'"/>').join('');
  $('wlPetaSvg').innerHTML='<svg viewBox="0 0 '+W.toFixed(0)+' '+H.toFixed(0)+'" role="img" aria-label="Peta persebaran wilayah Indonesia">'+
    '<g class="dasar">'+paths+'</g><g class="titik" id="wlTitik"></g></svg>';
}

/** Baris data per tingkat + titik koordinatnya. Wilayah yang jatuh ke titik yang sama digabung. */
function barisTingkat(d,daftar){
  const kosong={orders:0,confirmed:0,pending:0,canceled:0};
  const gabung=new Map();let lepas=0,lepasN=0;
  const masuk=(kode,nama,induk,lat,lng,r)=>{
    const x=gabung.get(kode)||Object.assign({kode,nama,induk,lat,lng},kosong);
    for(const k in kosong)x[k]+=r[k]||0;gabung.set(kode,x);
  };
  if(petaTingkat==='prov'){
    for(const r of d.per_wilayah||[]){
      if(r.province==='(tanpa wilayah)')continue;
      const t=petaIx.provTitik.get(kunciProv(r.province));
      if(t)masuk(t[0],r.province,'',t[2],t[3],r);else{lepas++;lepasN+=r[petaMode]||0}
    }
  }else if(petaTingkat==='kab'){
    for(const r of daftar.kab||[]){
      const t=titikKab(petaIx,r.city);
      if(t)masuk(t[0],r.city,r.province,t[2],t[3],r);else{lepas++;lepasN+=r[petaMode]||0}
    }
  }else{
    for(const r of daftar.kec||[]){
      const t=titikKec(petaIx,r.city,r.kecamatan);
      if(t)masuk(t[0],r.kecamatan,r.city,t[2],t[3],r);else{lepas++;lepasN+=r[petaMode]||0}
    }
  }
  return {baris:[...gabung.values()],lepas,lepasN};
}

let petaUrut=0;
async function renderPeta(d){
  const cfg=PETA_MODE[petaMode],tk=PETA_TINGKAT[petaTingkat],card=$('wlPeta');if(!card)return;
  const giliran=++petaUrut;
  card.className='card peta-card tone-'+cfg.tone;
  put('wlPetaJudul',cfg.judul);put('wlTopJudul',cfg.top+' · per '+tk.nama);
  $('wlPetaMode').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.mode===petaMode));
  $('wlPetaTingkat').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tingkat===petaTingkat));
  if(!d)return;
  let daftar=null;
  try{
    await Promise.all([muatGeo(),muatTitik(),petaTingkat==='prov'?null:ambilDaftar(d).then(x=>daftar=x)]);
  }catch(e){
    if(giliran===petaUrut)$('wlTop').innerHTML='<li style="color:var(--loss)">Gagal memuat peta ('+esc(e.message)+').</li>';
    return;
  }
  if(giliran!==petaUrut)return;                         // tombol sudah berganti selagi menunggu
  if(!$('wlPetaSvg').querySelector('svg'))gambarPeta(petaGeo);

  const nilai=r=>r[petaMode]||0;
  const {baris,lepas,lepasN}=barisTingkat(d,daftar);
  const total=baris.reduce((a,r)=>a+(r.orders||0),0);
  const urut=baris.filter(r=>nilai(r)>0).sort((a,b)=>nilai(b)-nilai(a));
  const max=urut.length?nilai(urut[0]):0;
  const porsi=r=>petaMode==='orders'?(total?100*r.orders/total:null):(r.orders?100*nilai(r)/r.orders:null);

  // Titik: yang besar digambar dulu supaya yang kecil tetap terlihat di atasnya
  const rad=v=>(1.6+(tk.rMax-1.6)*Math.sqrt(v/max)).toFixed(1);
  $('wlTitik').innerHTML=urut.map(r=>'<circle data-kode="'+r.kode+'" cx="'+petaProj.x(r.lng).toFixed(1)+'" cy="'+petaProj.y(r.lat).toFixed(1)+'" r="'+rad(nilai(r))+'"/>').join('');
  petaTitik=urut;

  put('wlLegTeks','Ukuran titik = jumlah · terbesar '+int(max)+' · '+int(urut.length)+' '+tk.nama);
  put('wlPetaSub','Per '+tk.nama+' tujuan order · makin besar titik makin banyak · % '+
    (petaMode==='orders'?'dari semua lead':'dari lead '+tk.nama+' itu'));
  $('wlTop').innerHTML=urut.length?urut.slice(0,8).map(r=>'<li data-kode="'+r.kode+'"><div class="r"><span>'+esc(r.nama)+
      (r.induk?' <small>'+esc(r.induk)+'</small>':'')+'</span><b>'+int(nilai(r))+' <small>'+pct(porsi(r))+'</small></b></div>'+
      '<div class="br"><i style="width:'+(max?100*nilai(r)/max:0)+'%"></i></div></li>').join('')
    :'<li style="color:var(--muted)">Tidak ada data pada rentang ini.</li>';

  const catatan=[];
  const tanpa=(d.per_wilayah||[]).find(r=>r.province==='(tanpa wilayah)');
  if(tanpa&&nilai(tanpa))catatan.push(int(nilai(tanpa))+' order tanpa alamat (biasanya batal sebelum alamat diisi) tidak tampil di peta.');
  if(lepasN)catatan.push(int(lepasN)+' order di '+int(lepas)+' '+tk.nama+' belum dikenali lokasinya.');
  if(urut.length>8)catatan.push('Menampilkan 8 dari '+int(urut.length)+' '+tk.nama+'.');
  $('wlPetaCat').innerHTML=catatan.join('<br>');
}

// Semua kabupaten/kota & kecamatan dengan angkanya (sekali per rentang/store)
const daftarCache=new Map();
function ambilDaftar(d){
  const q=new URLSearchParams({from:d.from,to:d.to});
  const store=$('wlStore').value;if(store)q.set('store_id',store);
  const kunci=q.toString();
  if(!daftarCache.has(kunci))daftarCache.set(kunci,api('/api/report/wilayah-daftar?'+kunci).catch(e=>{daftarCache.delete(kunci);throw e}));
  return daftarCache.get(kunci);
}

/** Tooltip, sorotan, dan tombol: dipasang sekali, membaca data terbaru saat dipakai. */
function pasangPeta(){
  const card=$('wlPeta'),tip=$('wlTip');if(!card)return;
  const cari=kode=>petaTitik.find(r=>r.kode===kode);
  const sorot=kode=>card.querySelectorAll('#wlTitik circle').forEach(c=>c.classList.toggle('aktif',!!kode&&c.dataset.kode===kode));
  card.addEventListener('mousemove',e=>{
    const c=e.target.closest('#wlTitik circle');
    if(!c){tip.hidden=true;return}
    const r=cari(c.dataset.kode);if(!r)return;
    const baris=(l,v)=>'<div><span>'+l+'</span><span>'+v+'</span></div>';
    tip.innerHTML='<b>'+esc(r.nama)+'</b>'+(r.induk?'<div class="ind">'+esc(r.induk)+'</div>':'')+
      baris('Lead',int(r.orders))+baris('Closing',int(r.confirmed)+' · '+pct(r.orders?100*r.confirmed/r.orders:null))+
      baris('Pending',int(r.pending))+baris('Cancel',int(r.canceled));
    const b=card.getBoundingClientRect();
    tip.hidden=false;
    let x=e.clientX-b.left+14,y=e.clientY-b.top+14;
    if(x+tip.offsetWidth>b.width)x=e.clientX-b.left-tip.offsetWidth-14;
    tip.style.left=x+'px';tip.style.top=y+'px';
  });
  card.addEventListener('mouseleave',()=>{tip.hidden=true});
  $('wlTop').addEventListener('mouseover',e=>{const li=e.target.closest('li[data-kode]');sorot(li?li.dataset.kode:null)});
  $('wlTop').addEventListener('mouseleave',()=>sorot(null));
  $('wlPetaMode').addEventListener('click',e=>{const b=e.target.closest('button');if(b){petaMode=b.dataset.mode;renderPeta(wlData)}});
  $('wlPetaTingkat').addEventListener('click',e=>{const b=e.target.closest('button');if(b){petaTingkat=b.dataset.tingkat;renderPeta(wlData)}});
}

function renderWl(d){
  renderPeta(d);
  const metrik=$('wlMetrik').value;
  const wil=d.per_wilayah||[],cs=d.per_cs||[],prd=d.per_product||[];
  const grand=jumlahkan(cs);
  put('wlPeriod','Persebaran order per provinsi · '+fmtRange(d.from,d.to)+' · '+wil.length+' wilayah · '+cs.length+' CS');

  const barisWil=wil.map(x=>Object.assign({},x,{key:x.province,label:x.province}));

  const pCs={};for(const x of d.cs_cells||[])pCs[x.province+'|'+x.handler_id]=x;
  pasangMatriks('wlCsHead','wlCsRows',barisWil,
    cs.map(c=>Object.assign({},c,{key:c.handler_id,label:c.handler_name})),
    pCs,metrik,'Wilayah','Semua CS','Semua wilayah',grand);

  const pPr={};for(const x of d.produk_cells||[])pPr[x.province+'|'+x.product]=x;
  pasangMatriks('wlPrHead','wlPrRows',barisWil,
    prd.map(p=>Object.assign({},p,{key:p.product,label:p.product})),
    pPr,metrik,'Wilayah','Semua produk','Semua wilayah',grand);

  // Tabel alasan batal: selalu jumlah order, tidak ikut pemilih metrik.
  const alasan=d.alasan||[];
  const pBt={};for(const x of d.batal_cells||[])pBt[x.province+'|'+x.reason]=x.orders;
  const wilBatal=wil.filter(x=>x.canceled>0);
  $('wlBtHead').innerHTML='<tr><th>Wilayah</th>'+
    alasan.map(a=>'<th class="n">'+esc(a.reason)+'</th>').join('')+'<th class="n tot">Total batal</th></tr>';
  $('wlBtRows').innerHTML=wilBatal.length?wilBatal.map(x=>
    '<tr><td class="name p">'+esc(x.province)+'</td>'+
    alasan.map(a=>{const v=pBt[x.province+'|'+a.reason];
      return '<td class="c'+(v?'':' kosong')+'">'+(v?int(v):'—')+'</td>'}).join('')+
    '<td class="c tot">'+int(x.canceled)+'</td></tr>').join('')
    +'<tr class="tot"><td class="name p">Semua wilayah</td>'+
    alasan.map(a=>'<td class="c tot">'+int(a.orders)+'</td>').join('')+
    '<td class="c tot">'+int(jumlahkan(wil).canceled)+'</td></tr>'
    :'<tr><td colspan="'+(alasan.length+2)+'" style="color:var(--muted)">Tidak ada pembatalan pada rentang ini.</td></tr>';

  // Ringkasan di kartu (tabel lengkapnya di pop-up)
  const wilNyata=wil.filter(x=>x.province!=='(tanpa wilayah)');
  const nama=l=>'<b>'+esc(l)+'</b>';
  const csTop=wilNyata.length?[...wilNyata].sort((a,b)=>b.orders-a.orders)[0]:null;
  $('wlInfoCs').innerHTML=int(wilNyata.length)+' wilayah × '+int(cs.length)+' CS'+
    (csTop?' · terbanyak '+nama(csTop.province)+' ('+int(csTop.orders)+' order, confirm '+pct(csTop.confirm_rate)+')':'');
  $('wlInfoPr').innerHTML=int(wilNyata.length)+' wilayah × '+int(prd.length)+' produk'+
    (prd.length?' · teratas '+nama(prd[0].product)+' ('+int(prd[0].orders)+' order)':'');
  $('wlInfoBt').innerHTML=wilBatal.length?int(jumlahkan(wil).canceled)+' order batal di '+int(wilBatal.length)+' wilayah'+
    (alasan.length?' · alasan utama '+nama(alasan[0].reason)+' ('+int(alasan[0].orders)+')':''):'Tidak ada pembatalan pada rentang ini.';
}

async function loadWl(){
  if(wlBusy)return;wlBusy=true;
  ['wlCsRows','wlPrRows','wlBtRows'].forEach(id=>$(id).innerHTML='<tr><td style="color:var(--muted)">Memuat…</td></tr>');
  const r=wlDates(),store=$('wlStore').value;
  const q=new URLSearchParams({from:r.from,to:r.to});
  if(store)q.set('store_id',store);
  try{
    wlData=await api('/api/report/wilayah?'+q);
    renderWl(wlData);
  }catch(e){
    wlData=null;
    ['wlCsHead','wlPrHead','wlBtHead'].forEach(id=>$(id).innerHTML='');
    ['wlCsRows','wlPrRows','wlBtRows'].forEach(id=>$(id).innerHTML='<tr><td style="color:var(--loss)">Gagal memuat data.</td></tr>');
    ['wlInfoCs','wlInfoPr','wlInfoBt'].forEach(id=>$(id).textContent='Gagal memuat data.');
  }finally{wlBusy=false}
}

function openWilayah(){
  if(!wlStoresOk){wlStoresOk=true;loadSettings().catch(function(){wlStoresOk=false})}
  loadWl();
}
$('wlRange').addEventListener('click',e=>{if(e.target.closest('button'))loadWl()});
$('wlStore').addEventListener('change',loadWl);
$('wlMetrik').addEventListener('change',()=>{if(wlData)renderWl(wlData)});
pasangPeta();
$('wlCsExport').addEventListener('click',()=>{
  if(!wlData)return;
  unduhCsv('wilayah-x-cs-'+wlData.from+'_'+wlData.to+'.csv',
    ['Wilayah','CS','Order masuk','Dikonfirmasi','Confirm rate (%)','Dibatalkan','Nilai confirm'],
    (wlData.cs_cells||[]).map(x=>[x.province,(wlData.per_cs.find(c=>c.handler_id===x.handler_id)||{}).handler_name||'',x.orders,x.confirmed,x.confirm_rate,x.canceled,x.confirmed_value]));
});
$('wlPrExport').addEventListener('click',()=>{
  if(!wlData)return;
  unduhCsv('wilayah-x-produk-'+wlData.from+'_'+wlData.to+'.csv',
    ['Wilayah','Produk','Order masuk','Dikonfirmasi','Confirm rate (%)','Dibatalkan','Nilai confirm'],
    (wlData.produk_cells||[]).map(x=>[x.province,x.product,x.orders,x.confirmed,x.confirm_rate,x.canceled,x.confirmed_value]));
});
$('wlBtExport').addEventListener('click',()=>{
  if(!wlData)return;
  unduhCsv('alasan-batal-per-wilayah-'+wlData.from+'_'+wlData.to+'.csv',
    ['Wilayah','Alasan','Order batal'],
    (wlData.batal_cells||[]).map(x=>[x.province,x.reason,x.orders]));
});
