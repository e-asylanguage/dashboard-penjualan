/**
 * Data Produk › SKU Mengantar: nama barang di paket Mengantar dipasangkan ke SKU × qty atau produk List Produk × qty, saran otomatis, simpan massal, impor & ekspor CSV.
 * Data: /api/settings/barang. Dipakai Outbound (lewat data server) untuk memecah paket ke pcs produk.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta SKU_IKON_EDIT / SKU_IKON_HAPUS, skuParseCsv() & gdPersen() dari script utama (window.*).
 * Dipanggil dari script utama: loadSkuMg() (menu SKU Mengantar).
 */
// ---- Data Produk › SKU Mengantar: nama barang di paket Mengantar (semua tanggal) dipasangkan ke SKU × qty per paket,
// atau langsung ke produk List Produk × qty (untuk barang yang tidak punya SKU, mis. tidak dijual lewat Scalev).
// Dipakai Outbound untuk memecah paket ke pcs produk. Data Mengantar tidak diubah.
let smData=null,smBusy=false,smBatas=200;
const smSku=id=>id&&smData?smData.sku.find(s=>s.id===id)||null:null;
const smProduk=id=>id&&smData?smData.produk.find(p=>p.id===id)||null:null;
const smKata=t=>String(t||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const smSudah=x=>!!(x.sku_id||x.produk.length);
// Paket tanpa order Scalev = yang butuh pasangan manual; nama barang tanpa paket (ditambah manual) dianggap perlu
const smTanpaScalev=x=>Math.max(0,(x.total||0)-(x.n_scalev||0));
const smOtomatis=x=>!smSudah(x)&&x.total>0&&!smTanpaScalev(x);
const smBelum=x=>!smSudah(x)&&!smOtomatis(x);

/** Isi satu paket dari pasangan { sku_id, qty } atau { produk: [{ produk_id, qty }] } */
function smIsi(p){
  if(!p)return '';
  const s=smSku(p.sku_id);
  if(s)return s.items.length?s.items.map(i=>(i.qty*p.qty)+'× '+i.nama).join(' + '):p.qty+'× '+s.produk+' (SKU belum punya isi dari List Produk)';
  return (p.produk||[]).map(i=>i.qty+'× '+((smProduk(i.produk_id)||{}).nama||'?')).join(' + ');
}
/**
 * Biaya gudang per paket (dikenakan sekali per paket, sama seperti Outbound): dari gudang yang benar-benar mengirim
 * paket bernama barang ini lewat pasangan nama pengirim di List Gudang — rata-rata menurut jumlah paket bila lebih
 * dari satu gudang. Belum ada paket / pengirim belum dipasangkan → gudang SKU (bila pasangan ke SKU).
 */
function smBiayaGudang(row,p){
  const gd=id=>(smData.gudang||[]).find(g=>g.id===id),biaya=g=>(g.biaya_penanganan||0)+(g.biaya_lain||0);
  const kirim=(row&&row.gudang||[]).filter(k=>gd(k.gudang_id));
  if(kirim.length){
    const n=kirim.reduce((a,k)=>a+k.n,0);
    return {biaya:kirim.reduce((a,k)=>a+k.n*biaya(gd(k.gudang_id)),0)/n,ket:kirim.length>1?'rata-rata '+kirim.length+' gudang':gd(kirim[0].gudang_id).nama};
  }
  const s=p&&smSku(p.sku_id),gs=s&&gd(s.gudang_id);
  if(gs)return {biaya:biaya(gs),ket:gs.nama+' (gudang SKU)'};
  return {biaya:0,ket:row&&row.total?'gudang pengirim belum dipasangkan di List Gudang':'gudang belum diketahui'};
}
/** HPP per paket = HPP produk × qty (tanpa biaya gudang) + biaya gudang sekali per paket */
function smHpp(p,row){
  const s=p&&smSku(p.sku_id);
  const produk=s?(s.hpp_dasar==null?s.hpp:s.hpp_dasar)*p.qty:(p&&p.produk||[]).reduce((a,i)=>a+i.qty*((smProduk(i.produk_id)||{}).hpp||0),0);
  const g=smBiayaGudang(row,p);
  return {produk,gudang:g.biaya,ket:g.ket,total:produk+g.biaya};
}
const smHppTeks=h=>'HPP '+rpFull(h.total)+' / paket'+'<br>produk '+rpFull(h.produk)+' + gudang '+(h.gudang?rpFull(h.gudang)+' · '+esc(h.ket):'Rp 0 · '+esc(h.ket));

/** Tebak qty per paket dari nama barang: "Beli 2 Gratis 1" → 3, "3 pcs" / "x2" → angkanya, selain itu 1 */
function smTebakQty(g){
  const t=g.toLowerCase();let m;
  if((m=t.match(/beli\s*(\d+)\s*(?:gratis|free|bonus)\s*(\d+)/)))return Number(m[1])+Number(m[2]);
  if((m=t.match(/(\d+)\s*(?:pcs|pc|botol|btl|box|pack|pak|bungkus|sachet)\b/)))return Number(m[1])||1;
  if((m=t.match(/(?:^|\s)(?:x\s*(\d+)|(\d+)\s*x)(?=\s|$)/)))return Number(m[1]||m[2])||1;
  return 1;
}

/**
 * Saran pasangan untuk nama barang. SKU cocok bila kodenya tertulis di nama barang, atau SKU / produk List Produk
 * cocok bila semua kata namanya (≥ 3 huruf) ada di nama barang — yang cocok paling banyak kata menang, SKU didahulukan
 * bila sama kuat. Dua kandidat sejenis yang sama kuat = tidak ada saran.
 */
function smSaran(g){
  const kata=smKata(g),set=new Set(kata),teks=' '+kata.join(' ')+' ';
  const cocok=nama=>{const k=smKata(nama).filter(w=>w.length>=3);return k.length&&k.every(w=>set.has(w))?k.length:0};
  const terbaik=(list,skor)=>{let best=null,n=0,seri=false;
    for(const x of list){const v=skor(x);if(v>n){best=x;n=v;seri=false}else if(v&&v===n)seri=true}
    return seri?{n:0}:{best,n}};
  const s=terbaik(smData.sku,x=>{const kode=smKata(x.sku);return kode.length&&/\d/.test(x.sku)&&teks.includes(' '+kode.join(' ')+' ')?100:cocok(x.produk)});
  const p=terbaik(smData.produk,x=>cocok(x.nama)),qty=smTebakQty(g);
  if(s.n&&s.n>=p.n)return {sku_id:s.best.id,qty};
  return p.n?{produk:[{produk_id:p.best.id,qty}]}:null;
}
const smSaranTeks=sr=>sr.sku_id?(smSku(sr.sku_id).sku+' · '+smSku(sr.sku_id).produk+' × '+int(sr.qty)):'List Produk: '+smIsi(sr);

async function loadSkuMg(){
  if(smBusy)return;smBusy=true;
  try{
    smData=await api('/api/settings/barang');
    for(const x of smData.rows)x.saran=smBelum(x)?smSaran(x.goods):null;
    const sel=$('smSkuF'),v=sel.value;
    sel.innerHTML='<option value="">Semua SKU / produk</option><option value="p">Langsung ke List Produk</option>'+
      '<optgroup label="SKU">'+smData.sku.map(s=>'<option value="s'+s.id+'">'+esc(s.sku)+' · '+esc(s.produk)+'</option>').join('')+'</optgroup>'+
      '<optgroup label="List Produk (langsung)">'+smData.produk.map(p=>'<option value="p'+p.id+'">'+esc(p.nama)+'</option>').join('')+'</optgroup>';
    sel.value=[...sel.options].some(o=>o.value===v)?v:'';
    renderSm();
  }catch(e){$('smRows').innerHTML='<tr><td colspan="8" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
  finally{smBusy=false}
}

function smSaring(){
  const q=$('smCari').value.trim().toLowerCase(),st=$('smStatus').value,f=$('smSkuF').value;
  return smData.rows.filter(x=>{
    const sudah=smSudah(x),belum=smBelum(x);
    if(st==='belum'&&!belum||st==='sudah'&&!sudah||st==='saran'&&(!belum||!x.saran)||st==='scalev'&&!smOtomatis(x))return false;
    if(f==='p'&&!x.produk.length||/^s\d/.test(f)&&'s'+x.sku_id!==f||/^p\d/.test(f)&&!x.produk.some(i=>'p'+i.produk_id===f))return false;
    if(!q||x.goods.toLowerCase().includes(q))return true;
    const s=smSku(x.sku_id);
    return (s?s.sku+' '+s.produk:smIsi(x)).toLowerCase().includes(q);
  });
}

function renderSm(){
  const semua=smData.rows,rows=smSaring(),sudah=semua.filter(smSudah),belum=semua.filter(smBelum),saran=belum.filter(x=>x.saran),oto=semua.filter(smOtomatis);
  // Paket terhitung = paket ber-order Scalev + paket tanpa order Scalev yang nama barangnya sudah dipasangkan
  const paket=semua.reduce((a,x)=>a+x.total,0),pSudah=semua.reduce((a,x)=>a+(smSudah(x)?x.total:(x.n_scalev||0)),0),langsung=sudah.filter(x=>!x.sku_id);
  const skuPakai=new Set(sudah.filter(x=>x.sku_id).map(x=>x.sku_id)),prdPakai=new Set(langsung.flatMap(x=>x.produk.map(i=>i.produk_id)));
  put('smK1',int(semua.length));put('smK1D',int(semua.filter(x=>x.n30).length)+' muncul di paket 30 hari terakhir');
  put('smK2',int(sudah.length));put('smK2D','+ '+int(oto.length)+' otomatis dari Scalev · '+gdPersen(pSudah,paket)+' paket terhitung');
  put('smK3',int(belum.length));put('smK3D',int(paket-pSudah)+' paket tanpa order Scalev · '+int(saran.length)+' nama punya saran');
  put('smK4',int(skuPakai.size));put('smK4D','dari '+int(smData.sku.length)+' SKU · '+int(prdPakai.size)+' produk dipakai langsung');
  $('smSaranSemua').disabled=!saran.length;$('smSaranSemua').textContent='Terapkan saran'+(saran.length?' ('+int(saran.length)+')':'');
  put('smInfo',semua.length?int(rows.length)+' dari '+int(semua.length)+' nama barang ditampilkan · urut paket terbanyak':'Belum ada nama barang. Klik "Tambah Pasangan" atau impor dari CSV.');
  const kosong='<span style="color:var(--muted)">—</span>',idx=new Map(semua.map((x,i)=>[x,i]));
  $('smRows').innerHTML=rows.slice(0,smBatas).map(x=>{
    const i=idx.get(x),s=smSku(x.sku_id),ada=smSudah(x),tanpa=smTanpaScalev(x);
    const ket=x.n_scalev?'<small class="sm-sv">'+int(x.n_scalev)+' paket isinya dari order Scalev'+(ada&&tanpa?' · pasangan ini dipakai untuk '+int(tanpa)+' paket tanpa order Scalev':'')+'</small>':'';
    const pasang=s?'<td class="sku">'+esc(s.sku)+'</td><td class="kat">'+esc(s.produk)+'</td><td class="n">'+int(x.qty)+'</td>'
      :'<td><span class="tag pb">List Produk</span></td><td class="kat">'+esc(x.produk.map(p=>(smProduk(p.produk_id)||{}).nama||'?').join(', '))+'</td><td class="n">'+kosong+'</td>';
    return '<tr><td class="prd">'+esc(x.goods)+'<small style="color:var(--muted)">'+(x.total?tglWib(x.first_at)+' – '+tglWib(x.last_at)+(x.n_gudang>1?' · '+int(x.n_gudang)+' gudang':''):'belum ada paket')+'</small></td>'+
      (ada?pasang+'<td class="ket">'+esc(smIsi(x))+'<small style="color:var(--muted)">'+smHppTeks(smHpp(x,x))+'</small>'+ket+'</td>'
        :smOtomatis(x)?'<td colspan="4"><span class="tag rev">Otomatis dari Scalev</span><small class="sm-sv">Semua paket punya order Scalev — isi &amp; HPP dari varian Scalev → Manajemen SKU, tidak perlu dipasangkan</small></td>'
        :'<td colspan="4"><span class="tag warn">Belum dipasangkan</span>'+(x.n_scalev?'<small class="sm-sv">'+int(tanpa)+' dari '+int(x.total)+' paket tanpa order Scalev</small>':'')+(x.saran?'<button class="sm-saran" data-saran="'+i+'" title="Pasangkan sesuai saran">Saran: '+esc(smSaranTeks(x.saran))+'</button>':'')+'</td>')+
      '<td class="n">'+int(x.total)+'<small>'+int(x.n30||0)+' · 30 hari</small></td>'+
      '<td class="n">'+(x.total?gdPersen(x.rts,x.total)+'<small>'+int(x.rts)+' paket</small>':kosong)+'</td>'+
      '<td class="n"><span class="ak"><button class="ed" data-ed="'+i+'" title="'+(ada?'Ubah':'Pasangkan')+'" aria-label="'+(ada?'Ubah':'Pasangkan')+' '+esc(x.goods)+'">'+SKU_IKON_EDIT+'</button>'+
      (ada?'<button class="hp" data-hp="'+i+'" title="Lepas pasangan" aria-label="Lepas pasangan '+esc(x.goods)+'">'+SKU_IKON_HAPUS+'</button>':'')+'</span></td></tr>'}).join('')||
    '<tr><td colspan="8" style="color:var(--muted)">'+(semua.length?'Tidak ada nama barang yang cocok dengan filter.':'Belum ada nama barang.')+'</td></tr>';
  $('smMore').hidden=rows.length<=smBatas;$('smMoreBtn').textContent='Tampilkan lebih banyak ('+int(Math.max(0,rows.length-smBatas))+' lagi)';
}

/** Simpan satu pasangan: p = { sku_id, qty } | { produk: [...] } | null (lepas) */
async function smSimpan(goods,p){
  await api('/api/settings/barang',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({goods},p||{}))});
  let r=smData.rows.find(x=>x.goods.toLowerCase()===goods.toLowerCase());
  if(!r&&p){r={goods,total:0,n30:0,terkirim:0,rts:0,n_gudang:0};smData.rows.push(r)}
  if(r){r.sku_id=p&&p.sku_id||null;r.qty=p&&p.qty||1;r.produk=p&&p.produk||[];r.saran=p?null:smSaran(r.goods)}
  renderSm();
}

/** Simpan banyak pasangan sekaligus lalu muat ulang */
async function smMassal(rows){
  const h=await api('/api/settings/barang/massal',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});
  await loadSkuMg();
  return h;
}

// -- Form tambah / ubah pasangan: ke SKU, atau langsung ke satu / beberapa produk List Produk
let smEdit=null,smMode='sku';
function smSetMode(m){
  smMode=m;
  $('smMode').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  $('smForm').querySelectorAll('[data-m]').forEach(el=>el.hidden=el.dataset.m!==m);
  if(m==='produk'&&!$('smIsiProduk').children.length)smIsiBaris(null,1);
  smPrev();
}
function smIsiBaris(id,qty){
  const d=document.createElement('div');d.className='sku-isi-r';
  d.innerHTML='<select aria-label="Produk"><option value="">— Pilih produk —</option>'+smData.produk.map(p=>'<option value="'+p.id+'"'+(p.id===id?' selected':'')+'>'+esc(p.nama)+' · '+rpFull(p.hpp)+'</option>').join('')+'</select>'+
    '<input type="number" min="1" step="1" value="'+(qty||1)+'" aria-label="Qty per paket"><button type="button" aria-label="Hapus baris">×</button>';
  $('smIsiProduk').appendChild(d);
}
const smIsiAmbil=()=>[...$('smIsiProduk').querySelectorAll('.sku-isi-r')].map(r=>({produk_id:Number(r.querySelector('select').value)||null,qty:Math.round(Number(r.querySelector('input').value))}));
/** Pasangan yang sedang diisi di form */
function smFormNilai(){
  const f=$('smForm');
  return smMode==='sku'?{sku_id:Number(f.elements.sku_id.value)||null,qty:Math.round(Number(f.elements.qty.value))}:{produk:smIsiAmbil()};
}
function smPrev(){
  const p=smFormNilai(),ok=smMode==='sku'?!!p.sku_id:p.produk.some(i=>i.produk_id);
  const bersih=smMode==='sku'?Object.assign({},p,{qty:Math.max(1,p.qty||1)}):{produk:p.produk.filter(i=>i.produk_id).map(i=>({produk_id:i.produk_id,qty:Math.max(1,i.qty||1)}))};
  put('smIsiInfo',smData.produk.length?'Produk + qty per paket, mis. 2× Buku + 1× Steva':'Belum ada produk — buat dulu di Inventory › List Produk');
  $('smIsiPrev').innerHTML='<span>Isi per paket</span><b>'+(ok?esc(smIsi(bersih)):'—')+'</b><small>'+
    (ok?smHppTeks(smHpp(bersih,smEdit||smData.rows.find(x=>x.goods.toLowerCase()===$('smForm').elements.goods.value.trim().toLowerCase())))
      :smMode==='sku'?(smData.sku.length?'Pilih SKU dari Manajemen SKU':'Belum ada SKU — buat di Manajemen SKU, atau pasangkan langsung ke List Produk'):'Pilih produk dari List Produk')+'</small>';
}
function smBukaForm(r){
  smEdit=r;
  const f=$('smForm');f.reset();
  const pilih=r&&(smSudah(r)?{sku_id:r.sku_id,qty:r.qty,produk:r.produk}:r.saran);
  $('smSkuSel').innerHTML='<option value="">— Pilih SKU —</option>'+smData.sku.map(s=>'<option value="'+s.id+'"'+(pilih&&s.id===pilih.sku_id?' selected':'')+'>'+esc(s.sku)+' · '+esc(s.produk)+'</option>').join('');
  f.elements.goods.value=r?r.goods:'';f.elements.goods.readOnly=!!r;
  f.elements.qty.value=pilih&&pilih.sku_id?pilih.qty:1;
  $('smIsiProduk').innerHTML='';
  if(pilih&&!pilih.sku_id)(pilih.produk||[]).forEach(i=>smIsiBaris(i.produk_id,i.qty));
  $('smGoodsList').innerHTML=r?'':smData.rows.filter(x=>!smSudah(x)).map(x=>'<option value="'+esc(x.goods)+'">').join('');
  $('smDlgInfo').hidden=!r||!r.total;
  if(r&&r.total)$('smDlgInfo').textContent=int(r.total)+' paket · terakhir '+tglWib(r.last_at)+(!smSudah(r)&&r.saran?' · terisi sesuai saran':'');
  put('smDlgJ',r?(smSudah(r)?'Ubah pasangan':'Pasangkan nama barang'):'Tambah pasangan');put('smMsg','');
  smSetMode(pilih&&!pilih.sku_id&&pilih.produk&&pilih.produk.length||!smData.sku.length?'produk':'sku');
  $('smDlg').showModal();(r?(smMode==='sku'?f.elements.sku_id:$('smIsiProduk').querySelector('select')):f.elements.goods).focus();
}
$('smMode').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)smSetMode(b.dataset.mode)});
$('smForm').elements.goods.addEventListener('change',()=>{
  // Nama barang diketik / dipilih → isi dari saran bila belum ada isian
  const f=$('smForm'),g=f.elements.goods.value.trim();
  if(!g||f.elements.sku_id.value||smIsiAmbil().some(i=>i.produk_id))return;
  const sr=smSaran(g);if(!sr)return;
  if(sr.sku_id){f.elements.sku_id.value=sr.sku_id;f.elements.qty.value=sr.qty;smSetMode('sku')}
  else{$('smIsiProduk').innerHTML='';sr.produk.forEach(i=>smIsiBaris(i.produk_id,i.qty));smSetMode('produk')}
});
$('smForm').addEventListener('input',smPrev);
$('smForm').addEventListener('change',smPrev);
$('smIsiTambah').addEventListener('click',()=>{smIsiBaris(null,1);smPrev()});
$('smIsiProduk').addEventListener('click',e=>{const b=e.target.closest('button');if(b){b.closest('.sku-isi-r').remove();smPrev()}});
$('smTambah').addEventListener('click',()=>{if(smData)smBukaForm(null)});
$('smTutup').addEventListener('click',()=>$('smDlg').close());
$('smBatal').addEventListener('click',()=>$('smDlg').close());
$('smDlg').addEventListener('click',e=>{if(e.target===$('smDlg'))$('smDlg').close()});
$('smForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('smForm'),b=$('smSimpan'),goods=f.elements.goods.value.trim(),p=smFormNilai();
  if(smMode==='sku'){
    if(!p.sku_id){put('smMsg','Pilih SKU');return}
    if(!(p.qty>0)){put('smMsg','Qty harus ≥ 1');return}
  }else{
    if(!p.produk.length||p.produk.some(i=>!i.produk_id)){put('smMsg','Pilih produk di setiap baris');return}
    if(p.produk.some(i=>!(i.qty>0))){put('smMsg','Qty harus ≥ 1');return}
  }
  const lain=!smEdit&&smData.rows.find(x=>smSudah(x)&&x.goods.toLowerCase()===goods.toLowerCase());
  if(lain&&!confirm('"'+lain.goods+'" sudah dipasangkan ('+smIsi(lain)+'). Ganti pasangannya?'))return;
  b.disabled=true;put('smMsg','');
  try{await smSimpan(goods,p);$('smDlg').close()}
  catch(err){put('smMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});

['smStatus','smSkuF'].forEach(id=>$(id).addEventListener('change',()=>{if(smData){smBatas=200;renderSm()}}));
$('smCari').addEventListener('input',()=>{if(smData){smBatas=200;renderSm()}});
$('smReset').addEventListener('click',()=>{$('smCari').value='';$('smStatus').value='';$('smSkuF').value='';if(smData){smBatas=200;renderSm()}});
$('smMoreBtn').addEventListener('click',()=>{smBatas+=200;renderSm()});
$('smRows').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-ed]'),hp=e.target.closest('[data-hp]'),sr=e.target.closest('[data-saran]');
  if(ed)smBukaForm(smData.rows[Number(ed.dataset.ed)]);
  if(sr){
    const x=smData.rows[Number(sr.dataset.saran)];if(!x||!x.saran)return;
    sr.disabled=true;
    try{await smSimpan(x.goods,x.saran)}catch(err){sr.disabled=false;alert('Gagal menyimpan: '+err.message)}
  }
  if(hp){
    const x=smData.rows[Number(hp.dataset.hp)];
    if(!x||!confirm('Lepas pasangan "'+x.goods+'" ('+smIsi(x)+')?\nPaket dengan nama barang ini tidak lagi terhitung di Outbound.'))return;
    hp.disabled=true;
    try{await smSimpan(x.goods,null)}catch(err){hp.disabled=false;alert('Gagal melepas: '+err.message)}
  }
});
$('smSaranSemua').addEventListener('click',async()=>{
  const list=smData?smData.rows.filter(x=>!smSudah(x)&&x.saran):[];if(!list.length)return;
  if(!confirm('Pasangkan '+list.length+' nama barang sesuai saran?\nPeriksa dulu dengan filter "Belum dipasangkan · ada saran" bila ragu.'))return;
  const b=$('smSaranSemua');b.disabled=true;
  try{const h=await smMassal(list.map(x=>Object.assign({goods:x.goods},x.saran)));alert(int(h.saved)+' nama barang dipasangkan.')}
  catch(e){alert('Gagal menyimpan: '+e.message);b.disabled=false}
});
// Nama kolom CSV yang dikenali → field. Baris dengan SKU dipasangkan ke SKU; tanpa SKU tetapi berisi
// "Isi per paket" (mis. "2× Buku + 1× Steva") dipasangkan langsung ke List Produk.
const SM_HEADER={'nama barang di mengantar':'goods','nama barang':'goods',barang:'goods',goods:'goods',goods_desc:'goods',
  sku:'sku','kode sku':'sku',qty:'qty','qty per paket':'qty','qty / paket':'qty','isi per paket':'isi','isi produk':'isi',isi:'isi'};
/** "2× Buku + 1x Steva" → [{produk_id, qty}]; null bila ada nama produk yang tidak ada di List Produk */
function smBacaIsi(t){
  const peta=new Map(smData.produk.map(p=>[p.nama.trim().toLowerCase(),p.id])),out=[];
  for(const bag of t.split('+').map(x=>x.trim()).filter(Boolean)){
    const m=bag.match(/^(\d+)\s*[x×]\s*(.+)$/i),id=peta.get((m?m[2]:bag).trim().toLowerCase());
    if(!id)return null;
    out.push({produk_id:id,qty:m?Number(m[1]):1});
  }
  return out.length?out:null;
}
$('smImpor').addEventListener('click',()=>{$('smFile').value='';$('smFile').click()});
$('smFile').addEventListener('change',async()=>{
  const file=$('smFile').files[0];if(!file||!smData)return;
  try{
    const [head,...isi]=skuParseCsv(await file.text());
    const peta=(head||[]).map(h=>SM_HEADER[h.replace(/^﻿/,'').trim().toLowerCase()]||null);
    if(!peta.includes('goods')||!peta.includes('sku')&&!peta.includes('isi'))throw new Error('kolom Nama barang di Mengantar dan SKU (atau Isi per paket) wajib ada di baris judul');
    const rows=[],gagal=[];
    for(const v of isi){
      const r={};peta.forEach((k,i)=>{if(k)r[k]=(v[i]||'').trim()});
      if(!r.goods||!r.sku&&!r.isi)continue;
      if(r.sku){rows.push({goods:r.goods,sku:r.sku,qty:Math.max(1,Math.round(Number(r.qty)||1))});continue}
      const produk=smBacaIsi(r.isi);
      if(produk)rows.push({goods:r.goods,produk});else gagal.push(r.goods);
    }
    if(!rows.length)throw new Error('tidak ada baris berisi nama barang + SKU / isi produk yang dikenali'+(gagal.length?' ('+gagal.length+' baris berisi produk yang tidak ada di List Produk)':''));
    if(!confirm('Impor '+rows.length+' pasangan dari '+file.name+'? Pasangan yang sudah ada akan diganti; baris tanpa SKU dan tanpa isi dilewati.'))return;
    const h=await smMassal(rows),lewat=gagal.concat(h.gagal||[]);
    alert(int(h.saved)+' pasangan tersimpan'+(lewat.length?', '+int(gagal.length+h.skipped)+' dilewati (SKU / produk tidak dikenali atau qty tidak valid):\n'+lewat.slice(0,20).join('\n'):'')+'.');
  }catch(e){alert('Impor gagal: '+e.message)}
});
$('smExport').addEventListener('click',()=>{
  if(!smData)return;
  unduhCsv('sku-mengantar.csv',['Nama barang di Mengantar','Paket','Paket 30 hari','Terkirim','RTS','Dipasangkan ke','SKU','Produk SKU','Qty per paket','Isi per paket','HPP produk per paket','Biaya gudang per paket','Gudang','HPP per paket'],
    smSaring().map(x=>{const s=smSku(x.sku_id),ada=smSudah(x);
      return [x.goods,x.total,x.n30||0,x.terkirim,x.rts,s?'SKU':ada?'List Produk':'',s?s.sku:'',s?s.produk:'',s?x.qty:'',smIsi(x),...(ada?(h=>[Math.round(h.produk),Math.round(h.gudang),h.ket,Math.round(h.total)])(smHpp(x,x)):['','','',''])]}));
});

