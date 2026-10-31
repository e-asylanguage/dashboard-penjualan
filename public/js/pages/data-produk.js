/**
 * Iklan Meta › Produk Iklan: katalog Scalev per kelompok PU / PB / BO / belum ber-SKU (ubah kelompok, sinkron katalog, ekspor CSV)
 * dan Gabungan produk (beberapa item disatukan dengan satu nama, dipakai juga BCG Matrix lewat data server).
 * Data: /api/report/katalog, /api/sync/katalog, /api/settings/product-category, /api/settings/produk-gabungan.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta rentang() & loadSettings() dari script utama (window.*).
 * Dipanggil dari script utama: openDataProduk() (menu Produk Iklan).
 */
// ---- Data Produk: katalog Scalev per kelompok PU / PB / BO / belum ber-SKU
const DP_GRUP=[
  {k:'PU',judul:'PRODUK SATUAN (PU / 1 SKU)'},
  {k:'PB',judul:'BUNDLING (PB / ≥2 SKU)'},
  {k:'BO',judul:'BONUS (BO)'},
  {k:'NONE',judul:'⚠️ BELUM BER-SKU / tanpa kategori'},
];
const DP_LABEL={PU:'Satuan (PU)',PB:'Bundling (PB)',BO:'Bonus (BO)',NONE:'Belum ber-SKU'};
const DP_BATAS=100;                     // baris per kelompok sebelum tombol "Tampilkan semua"
let dpData=null,dpBusy=false,dpStoresOk=false,dpAutoSync=false;
const dpTerbuka=new Set(),dpSemua=new Set();

/** Item yang lolos pencarian, centang "ada order", dan filter store. */
function dpSaring(){
  const q=$('dpCari').value.trim().toLowerCase(),ada=$('dpAdaOrder').checked;
  const st=$('dpStore').value?$('dpStore').selectedOptions[0].textContent:'';
  return (dpData.items||[]).filter(it=>(!ada||it.orders>0)&&
    (!st||it.orders>0||(it.stores||[]).includes(st))&&
    (!q||(it.name+' '+(it.product_name||'')+' '+(it.sku||'')).toLowerCase().includes(q)));
}

function dpBaris(it){
  const ket=[];
  if(it.kind==='bundle')ket.push('Bundle Scalev');
  if(it.kind==='order')ket.push('Tidak ada di katalog Scalev (nama dari order)');
  if(it.status==='deleted')ket.push('sudah dihapus di Scalev');
  if((it.stores||[]).length)ket.push(it.stores.join(', '));
  // Memilih kelompok tebakan otomatis = kembali ke otomatis (pilihan manual dihapus).
  const opsi=['PU','PB','BO','NONE'].map(k=>'<option value="'+k+'"'+(k===it.category?' selected':'')+'>'+
    DP_LABEL[k]+(k===it.category_auto?' · otomatis':'')+'</option>').join('');
  const mut=v=>v?'':' mut';
  return '<tr><td class="name">'+esc(it.name)+(ket.length?'<small>'+esc(ket.join(' · '))+'</small>':'')+'</td>'+
    '<td class="sku'+(it.sku?'':' kosong')+'">'+(it.sku?esc(it.sku):'belum ada')+'</td>'+
    '<td class="n'+mut(it.price!=null)+'">'+rpFull(it.price)+'</td>'+
    '<td class="n'+mut(it.orders)+'">'+int(it.orders)+'</td>'+
    '<td class="n'+mut(it.closing)+'">'+int(it.closing)+'</td>'+
    '<td class="n'+mut(it.omzet)+'">'+rpFull(it.omzet)+'</td>'+
    '<td><select data-key="'+esc(it.key)+'"'+(it.manual?' class="manual" title="Dipilih manual"':' title="Tebakan otomatis"')+'>'+opsi+'</select></td></tr>';
}

function renderDp(){
  const d=dpData,list=dpSaring();
  const sync=d.last_sync&&d.last_sync.finished_at?' · katalog disinkron '+tglWib(d.last_sync.finished_at,true)+' WIB':'';
  put('dpPeriod','Katalog produk Scalev per kelompok · angka Rp = omzet closing '+fmtRange(d.from,d.to)+sync);
  $('dpInfo').textContent=int(list.length)+' item · omzet closing '+rpFull(list.reduce((a,x)=>a+x.omzet,0));
  $('dpGrup').innerHTML=DP_GRUP.map(g=>{
    const isi=list.filter(x=>x.category===g.k),omzet=isi.reduce((a,x)=>a+x.omzet,0);
    const tampil=dpSemua.has(g.k)?isi:isi.slice(0,DP_BATAS);
    return '<details class="dp-grp '+g.k+'" data-k="'+g.k+'"'+(dpTerbuka.has(g.k)?' open':'')+'>'+
      '<summary><b>'+esc(g.judul)+' — '+int(isi.length)+' item</b><span>('+rpFull(omzet)+')</span></summary>'+
      '<div class="tbl-wrap"><table><thead><tr><th>Produk / varian</th><th>SKU</th><th class="n">Harga</th><th class="n">Lead</th>'+
      '<th class="n">Closing</th><th class="n">Omzet closing</th><th>Kelompok</th></tr></thead><tbody>'+
      (tampil.length?tampil.map(dpBaris).join(''):'<tr><td colspan="7" style="color:var(--muted)">Tidak ada item.</td></tr>')+
      '</tbody></table>'+
      (isi.length>tampil.length?'<div class="dp-lagi">Menampilkan '+int(tampil.length)+' dari '+int(isi.length)+' item · <button type="button" data-semua="'+g.k+'">Tampilkan semua</button></div>':'')+
      '</div></details>';
  }).join('');
  const n=$('dpNote');
  n.hidden=!d.katalog_kosong;
  n.textContent=d.katalog_kosong?'Katalog Scalev belum pernah disinkron — klik "Sinkron katalog". Sementara itu yang tampil hanya nama produk dari order.':'';
  renderGab();
}

async function loadDp(){
  if(dpBusy)return;dpBusy=true;
  const r=rentang('dpRange'),store=$('dpStore').value;
  const q=new URLSearchParams({from:r.from,to:r.to});
  if(store)q.set('store_id',store);
  try{
    dpData=await api('/api/report/katalog?'+q);
    renderDp();
    if(dpData.katalog_kosong&&!dpAutoSync){dpAutoSync=true;syncKatalog()}
  }catch(e){
    dpData=null;
    $('dpGrup').innerHTML='<div class="card"><div class="card-b" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</div></div>';
  }finally{dpBusy=false}
}

async function syncKatalog(){
  const b=$('dpSync');if(b.disabled)return;
  b.disabled=true;b.textContent='Menyinkron…';
  try{
    // paksa=1: ambil ulang semua detail — perubahan COGS di Scalev tidak menandai produk sebagai berubah
    const r=await api('/api/sync/katalog?paksa=1',{method:'POST'});
    if(!r.ok)alert('Sinkron katalog gagal: '+(r.message||'tidak diketahui'));
    else if(/terhenti|sisa/.test(r.message||''))alert('Sebagian produk belum terambil ('+r.message+'). Sisanya menyusul di sinkron berikutnya, atau klik lagi sebentar lagi.');
    await loadDp();
  }catch(e){alert('Sinkron katalog gagal: '+e.message)}
  finally{b.disabled=false;b.textContent='Sinkron katalog'}
}

function openDataProduk(){
  if(!dpStoresOk){dpStoresOk=true;loadSettings().catch(function(){dpStoresOk=false})}
  loadDp();
}
$('dpRange').addEventListener('click',e=>{if(e.target.closest('button'))loadDp()});
$('dpStore').addEventListener('change',loadDp);
$('dpSync').addEventListener('click',syncKatalog);
$('dpCari').addEventListener('input',()=>{if(dpData)renderDp()});
$('dpAdaOrder').addEventListener('change',()=>{if(dpData)renderDp()});
// Ingat kelompok yang sedang terbuka supaya tidak menutup sendiri saat data dirender ulang.
$('dpGrup').addEventListener('toggle',e=>{
  const g=e.target.closest('details[data-k]');if(!g)return;
  if(g.open)dpTerbuka.add(g.dataset.k);else dpTerbuka.delete(g.dataset.k);
},true);
$('dpGrup').addEventListener('click',e=>{
  const b=e.target.closest('button[data-semua]');if(!b)return;
  dpSemua.add(b.dataset.semua);renderDp();
});
$('dpGrup').addEventListener('change',async e=>{
  const s=e.target.closest('select[data-key]');if(!s||!dpData)return;
  const it=dpData.items.find(x=>x.key===s.dataset.key);if(!it)return;
  const lama={category:it.category,manual:it.manual},manual=s.value!==it.category_auto;
  s.disabled=true;
  try{
    await api('/api/settings/product-category',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({item_key:it.key,category:manual?s.value:null})});
    it.category=s.value;it.manual=manual;
    renderDp();
  }catch(err){
    Object.assign(it,lama);s.value=lama.category;s.disabled=false;
    alert('Gagal menyimpan kelompok: '+err.message);
  }
});
$('dpExport').addEventListener('click',()=>{
  if(!dpData)return;
  const list=dpSaring(),urut={PU:0,PB:1,BO:2,NONE:3};
  unduhCsv('data-produk-'+dpData.from+'_'+dpData.to+'.csv',
    ['Kelompok','Produk / varian','SKU','Harga','Lead','Closing','Omzet closing','Store','Kelompok dipilih'],
    list.slice().sort((a,b)=>urut[a.category]-urut[b.category]).map(x=>[DP_LABEL[x.category],x.name,x.sku,x.price,x.orders,x.closing,x.omzet,
      (x.stores||[]).join(', '),x.manual?'manual':'otomatis']));
});

// ---- Data Produk › Gabungan produk: beberapa item disatukan dengan satu nama
const GAB_TONE=['tone-info','tone-rev','tone-pb','tone-spend'];
const gabPilih=new Map();               // key → nama item yang dicentang di form
let gabEditId=null;

function gabPesan(t,kelas){const m=$('dpGabMsg');m.textContent=t||'';m.className=kelas||''}

function renderGabPilihan(){
  if(!dpData)return;
  const q=$('dpGabCari').value.trim().toLowerCase(),urut=$('dpGabUrut').value;
  const idNum=k=>/^[vb]:\d+$/.test(k)?+k.slice(2):-1;
  const list=(dpData.items||[]).filter(it=>!q||(it.name+' '+(it.sku||'')).toLowerCase().includes(q));
  list.sort(urut==='nama'?(a,b)=>a.name.localeCompare(b.name):
    urut==='order'?(a,b)=>b.orders-a.orders||a.name.localeCompare(b.name):
    (a,b)=>idNum(b.key)-idNum(a.key));
  $('dpGabList').innerHTML=list.length?list.map(it=>{
    const on=gabPilih.has(it.key);
    return '<label'+(on?' class="on"':'')+' title="'+esc(it.name+(it.sku?' · '+it.sku:''))+'"><input type="checkbox" data-key="'+esc(it.key)+'"'+(on?' checked':'')+'>'+
      '<span>'+esc(it.name)+'</span>'+(it.orders?'<small>· '+int(it.orders)+'</small>':'')+'</label>';
  }).join(''):'<div class="kosong">Tidak ada produk yang cocok.</div>';
  $('dpGabInfo').textContent=int(list.length)+' produk'+(gabPilih.size?' · '+int(gabPilih.size)+' dipilih':'');
}

function renderGabDaftar(){
  const perKey=new Map((dpData.items||[]).map(x=>[x.key,x]));
  const daftar=dpData.gabungan||[];
  $('dpGabDaftar').innerHTML=daftar.map((g,i)=>{
    const isi=g.items.map(s=>({s,it:perKey.get(s.key)}));
    const t=isi.reduce((a,x)=>x.it?{orders:a.orders+x.it.orders,closing:a.closing+x.it.closing,omzet:a.omzet+x.it.omzet}:a,{orders:0,closing:0,omzet:0});
    const cr=t.orders?Math.round(1000*t.closing/t.orders)/10:null;
    const kpi=(tone,l,v,d)=>'<div class="card kpi tone '+tone+'"><div class="l">'+l+'</div><div class="v">'+v+'</div>'+(d?'<div class="d">'+d+'</div>':'')+'</div>';
    return '<div class="card dp-gab '+GAB_TONE[i%GAB_TONE.length]+'">'+
      '<div class="card-h"><div><h3>'+esc(g.name)+'</h3></div><div style="display:flex;gap:6px">'+
        '<button type="button" class="btn ghost" data-gab-edit="'+g.id+'">Edit</button>'+
        '<button type="button" class="btn hapus" data-gab-hapus="'+g.id+'">Hapus</button></div></div>'+
      '<div class="chips">'+isi.map(x=>x.it
        ?'<span>'+esc(x.it.name)+' · '+int(x.it.orders)+'</span>'
        :'<span class="hilang" title="Tidak ada di katalog / tanpa order pada periode ini">'+esc(x.s.name)+' · 0</span>').join('')+'</div>'+
      '<div class="card-b"><div class="grid g-4">'+
        kpi('tone-info','Total order',int(t.orders),'lead masuk')+
        kpi('tone-rev','Closing',int(t.closing),cr==null?'—':'closing rate '+pct(cr))+
        kpi('tone-spend','Revenue',rpFull(t.omzet),'omzet closing')+
        kpi('tone-pb','Jumlah produk',int(g.items.length),'')+
      '</div></div></div>';
  }).join('');
}

function renderGab(){renderGabPilihan();renderGabDaftar()}

function gabReset(){
  gabEditId=null;gabPilih.clear();
  $('dpGabNama').value='';$('dpGabJudul').textContent='Gabungkan produk';
  $('dpGabSimpan').textContent='Simpan gabungan';$('dpGabBatal').hidden=true;
  renderGabPilihan();
}

$('dpGabCari').addEventListener('input',renderGabPilihan);
$('dpGabUrut').addEventListener('change',renderGabPilihan);
$('dpGabMuat').addEventListener('click',syncKatalog);
$('dpGabList').addEventListener('change',e=>{
  const c=e.target.closest('input[data-key]');if(!c)return;
  const it=(dpData.items||[]).find(x=>x.key===c.dataset.key);
  if(c.checked)gabPilih.set(c.dataset.key,it?it.name:c.dataset.key);else gabPilih.delete(c.dataset.key);
  c.closest('label').classList.toggle('on',c.checked);
  $('dpGabInfo').textContent=$('dpGabInfo').textContent.replace(/ · .*$/,'')+(gabPilih.size?' · '+int(gabPilih.size)+' dipilih':'');
});
$('dpGabBatal').addEventListener('click',()=>{gabReset();gabPesan('')});
$('dpGabSimpan').addEventListener('click',async()=>{
  const nama=$('dpGabNama').value.trim();
  if(!nama){gabPesan('Isi nama gabungan dulu','bad');$('dpGabNama').focus();return}
  if(!gabPilih.size){gabPesan('Pilih minimal satu produk','bad');return}
  const b=$('dpGabSimpan');b.disabled=true;gabPesan('Menyimpan…');
  try{
    await api('/api/settings/produk-gabungan',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:gabEditId||undefined,name:nama,items:[...gabPilih].map(([key,name])=>({key,name}))})});
    gabReset();gabPesan('Tersimpan','ok');
    await loadDp();
  }catch(e){gabPesan('Gagal menyimpan: '+e.message,'bad')}
  finally{b.disabled=false}
});
$('dpGabDaftar').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-gab-edit]'),hp=e.target.closest('[data-gab-hapus]');
  if(ed){
    const g=(dpData.gabungan||[]).find(x=>x.id===+ed.dataset.gabEdit);if(!g)return;
    gabEditId=g.id;gabPilih.clear();g.items.forEach(s=>gabPilih.set(s.key,s.name));
    $('dpGabNama').value=g.name;$('dpGabJudul').textContent='Edit gabungan: '+g.name;
    $('dpGabSimpan').textContent='Simpan perubahan';$('dpGabBatal').hidden=false;gabPesan('');
    renderGabPilihan();
    $('dpGabForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  if(hp){
    const g=(dpData.gabungan||[]).find(x=>x.id===+hp.dataset.gabHapus);if(!g)return;
    if(!confirm('Hapus gabungan "'+g.name+'"? Produknya sendiri tidak ikut terhapus.'))return;
    hp.disabled=true;
    try{await api('/api/settings/produk-gabungan/'+g.id,{method:'DELETE'});if(gabEditId===g.id)gabReset();await loadDp()}
    catch(err){hp.disabled=false;alert('Gagal menghapus: '+err.message)}
  }
});

