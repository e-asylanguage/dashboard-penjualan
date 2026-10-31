/**
 * Data Produk › Manajemen SKU: master SKU internal (HPP, isi produk, kategori, gudang, niche), varian Scalev belum ber-SKU, Tarik dari Scalev, impor & ekspor CSV.
 * Data: /api/settings/sku, /api/settings/produk-list, /api/settings/sku/tarik-scalev, /api/settings/sku/impor.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*):
 * plData (dibaca & diisi, bersama List Produk), SKU_IKON_EDIT / SKU_IKON_HAPUS, skuParseCsv(), GD_JENIS, gdBiayaTeks().
 * Dipanggil dari script utama: openSku() (menu Manajemen SKU).
 */
// ---- Data Produk › Manajemen SKU: master SKU internal (HPP, kategori, gudang, niche)
let skuData=null,skuEditId=null,skuBusy=false,skuGdgList=[];
const SKU_KOLOM=['sku','produk','hpp','kategori','gudang','keterangan','niche'];
const skuUnik=k=>[...new Set((skuData||[]).map(r=>r[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));

function skuSaring(){
  const q=$('skuCari').value.trim().toLowerCase(),ni=$('skuNiche').value,gd=$('skuGudang').value,ln=$('skuLink').value;
  const tautan=r=>!ln||ln==='tanpa'||(ln==='scalev'?(r.scalev||[]).length>0:ln==='bukan'?!(r.scalev||[]).length:!(r.items||[]).length);
  return (skuData||[]).filter(r=>(!ni||r.niche===ni)&&(!gd||r.gudang===gd)&&tautan(r)&&
    (!q||r.sku.toLowerCase().includes(q)||r.produk.toLowerCase().includes(q)));
}

/** Isi ulang pilihan filter & saran isian form; pilihan yang sedang aktif dipertahankan. */
function skuIsiPilihan(){
  [['skuNiche','niche','Semua niche'],['skuGudang','gudang','Semua gudang']].forEach(([id,k,semua])=>{
    const sel=$(id),v=sel.value,opsi=skuUnik(k);
    sel.innerHTML='<option value="">'+semua+'</option>'+opsi.map(o=>'<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>').join('');
  });
  [['skuKatList','kategori'],['skuGdgList','gudang'],['skuNicheList','niche']].forEach(([id,k])=>{
    $(id).innerHTML=skuUnik(k).map(o=>'<option value="'+esc(o)+'">').join('');
  });
}

function renderSku(){
  const semua=skuData||[],rows=skuSaring();
  // KPI mengikuti filter yang aktif
  const hpp=rows.filter(r=>r.hpp>0);
  put('skuTotal',int(rows.length));put('skuTotalD',rows.length===semua.length?'semua SKU':'dari '+int(semua.length)+' SKU');
  put('skuHpp',hpp.length?rpFull(hpp.reduce((a,r)=>a+r.hpp,0)/hpp.length):'—');
  put('skuHppD',hpp.length?'terendah '+rpFull(Math.min(...hpp.map(r=>r.hpp)))+' · tertinggi '+rpFull(Math.max(...hpp.map(r=>r.hpp))):'belum ada HPP');
  put('skuKat',int(new Set(rows.map(r=>r.kategori).filter(Boolean)).size));
  const gdg=[...new Set(rows.map(r=>r.gudang).filter(Boolean))];
  put('skuGdg',int(gdg.length));put('skuGdgD',gdg.length?gdg.slice(0,3).join(', ')+(gdg.length>3?' +'+(gdg.length-3):''):'belum ada gudang');
  put('skuInfo',semua.length?int(rows.length)+' dari '+int(semua.length)+' SKU ditampilkan':'Belum ada SKU. Klik "Tambah SKU" atau impor dari CSV.');
  const w=[],bl=skuScalev.belum||[],ts=skuScalev.tanpa_sku||[];
  if(bl.length)w.push(int(bl.length)+' SKU dipakai varian Scalev tetapi belum ada di Manajemen SKU: <b>'+esc(bl.slice(0,8).map(x=>x.sku).join(', '))+(bl.length>8?', …':'')+
    '</b> — HPP order-nya memakai COGS Scalev (atau belum terhitung) dan stoknya tidak berkurang. Klik <b>Tarik dari Scalev</b> untuk menambahkannya.');
  if(ts.length)w.push(int(ts.length)+' varian aktif di Scalev belum punya SKU ('+int(ts.filter(v=>v.order30>0).length)+' di antaranya dipesan 30 hari terakhir) — pilih filter <b>Varian Scalev belum ber-SKU</b> untuk melihat daftarnya, lalu isi SKU-nya di Scalev.');
  $('skuWarn').hidden=!w.length;$('skuWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  skuRenderTanpa();
  const kosong='<span style="color:var(--muted)">—</span>';
  $('skuRows').innerHTML=rows.map(r=>'<tr><td class="sku">'+esc(r.sku)+((r.scalev||[]).length?'<small class="sku-sv" title="'+esc(r.scalev.join('\n'))+'">'+int(r.scalev.length)+' varian Scalev</small>':'<small class="sku-sv nol" title="Tidak ada varian Scalev ber-SKU ini — dipakai lewat SKU Mengantar / Shopee">bukan dari Scalev</small>')+'</td><td class="prd">'+esc(r.produk)+(r.items&&r.items.length?'<small>= '+esc(skuIsiTeks(r.items))+'</small>':'')+'</td>'+
    '<td class="n">'+rpFull(r.hpp)+(r.hpp_dasar!=null&&r.hpp!==r.hpp_dasar?'<small>produk '+rpFull(r.hpp_dasar)+' + gudang '+rpFull(r.hpp-r.hpp_dasar)+'</small>':'')+(r.items&&r.items.length?'<small>otomatis</small>':'')+'</td><td class="kat">'+(r.kategori?esc(r.kategori):kosong)+'</td>'+
    '<td>'+(r.gudang?'<span class="tag info">'+esc(r.gudang)+'</span>':kosong)+'</td>'+
    '<td class="ket">'+(r.keterangan?esc(r.keterangan):kosong)+'</td>'+
    '<td>'+(r.niche?'<span class="tag rev">'+esc(r.niche)+'</span>':kosong)+'</td>'+
    '<td class="n"><span class="ak"><button class="ed" data-ed="'+r.id+'" title="Ubah" aria-label="Ubah '+esc(r.sku)+'">'+SKU_IKON_EDIT+'</button>'+
    '<button class="hp" data-hp="'+r.id+'" title="Hapus" aria-label="Hapus '+esc(r.sku)+'">'+SKU_IKON_HAPUS+'</button></span></td></tr>').join('')||
    '<tr><td colspan="8" style="color:var(--muted)">'+(semua.length?'Tidak ada SKU yang cocok dengan filter.':'Belum ada SKU.')+'</td></tr>';
}

let skuScalev={belum:[],tanpa_sku:[]};
/** Varian Scalev tanpa SKU (filter "Varian Scalev belum ber-SKU"): urut order 30 hari terbanyak; isi SKU-nya di Scalev lalu Tarik dari Scalev */
function skuSaringTanpa(){
  const q=$('skuCari').value.trim().toLowerCase();
  return (skuScalev.tanpa_sku||[]).filter(v=>!q||v.name.toLowerCase().includes(q)||String(v.product_name||'').toLowerCase().includes(q));
}
function skuRenderTanpa(){
  const on=$('skuLink').value==='tanpa',semua=skuScalev.tanpa_sku||[],rows=on?skuSaringTanpa():[];
  $('skuTanpaCard').hidden=!on;$('skuRows').closest('.card').hidden=on;
  const opsi=$('skuLink').querySelector('option[value="tanpa"]');if(opsi)opsi.textContent='Varian Scalev belum ber-SKU ('+int(semua.length)+')';
  if(!on)return;
  const laku=semua.filter(v=>v.order30>0).length;
  put('skuTanpaInfo',int(rows.length)+' varian aktif tanpa SKU · '+int(laku)+' dipesan 30 hari terakhir · isi SKU varian di Scalev lalu klik Tarik dari Scalev — selama belum ber-SKU, HPP memakai COGS Scalev dan stok mengikuti pasangan SKU Mengantar');
  const kosong='<span style="color:var(--muted)">—</span>';
  $('skuTanpaRows').innerHTML=rows.map(v=>'<tr><td class="prd">'+esc(v.name)+(v.kind==='bundle'?'<small>bundle</small>':'')+'</td><td class="kat">'+(v.product_name?esc(v.product_name):kosong)+'</td>'+
    '<td class="n">'+(v.order30?'<b>'+int(v.order30)+'</b>':kosong)+'</td><td class="n">'+(v.price?rpFull(v.price):kosong)+'</td><td class="n">'+(v.cogs>0?rpFull(v.cogs):'<span class="tag warn">kosong</span>')+'</td></tr>').join('')||
    '<tr><td colspan="5" style="color:var(--muted)">'+(semua.length?'Tidak ada varian yang cocok dengan pencarian.':'Semua varian aktif di Scalev sudah punya SKU. 🎉')+'</td></tr>';
}
async function loadSku(){
  if(skuBusy)return;skuBusy=true;
  try{
    const [a,p]=await Promise.all([api('/api/settings/sku'),api('/api/settings/produk-list')]);
    skuData=a.rows||[];skuGdgList=a.gudang||[];skuScalev={belum:a.scalev_belum||[],tanpa_sku:a.scalev_tanpa_sku||[]};plData=p;skuIsiPilihan();renderSku();
  }
  catch(e){$('skuRows').innerHTML='<tr><td colspan="8" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
  finally{skuBusy=false}
}
function openSku(){loadSku()}

function skuBukaForm(r){
  skuEditId=r?r.id:null;
  const f=$('skuForm');f.reset();
  if(r)SKU_KOLOM.forEach(k=>{f.elements[k].value=r[k]==null?'':r[k]});
  if(r)f.elements.hpp.value=r.hpp_dasar==null?r.hpp:r.hpp_dasar;
  skuGdgIsi(r);
  $('skuIsi').innerHTML='';(r&&r.items||[]).forEach(x=>skuIsiBaris(x.produk_id,x.qty,x.bonus));skuIsiHitung();
  put('skuDlgJ',r?'Ubah SKU '+r.sku:'Tambah SKU');put('skuMsg','');
  $('skuDlg').showModal();f.elements.sku.focus();
}
/** Isi produk SKU: baris pilih produk (List Produk) + qty; HPP SKU = Σ qty × HPP produk */
const skuIsiTeks=items=>items.map(x=>x.qty+'× '+x.nama+(x.bonus?' (bonus)':'')).join(' + ');
/** Pcs terjual per 1 SKU = Σ qty komponen yang bukan bonus (dipakai Sold di Per CS & pcs di Margin Produk) */
const skuPcs=items=>items.reduce((a,x)=>a+(x.bonus?0:x.qty),0);
function skuIsiBaris(pid,qty,bonus){
  const p=(plData&&plData.rows)||[],d=document.createElement('div');d.className='sku-isi-r sku-isi-b';
  d.innerHTML='<select aria-label="Produk"><option value="">— Pilih produk —</option>'+p.map(x=>'<option value="'+x.id+'"'+(x.id===pid?' selected':'')+'>'+esc(x.nama)+' · '+rpFull(x.hpp)+'</option>').join('')+'</select>'+
    '<input type="number" min="1" step="1" value="'+(qty||1)+'" aria-label="Qty">'+
    '<label class="sku-bonus" title="Centang bila produk ini bonus/gratis: tetap masuk HPP & stok, tapi tidak dihitung sebagai pcs terjual"><input type="checkbox"'+(bonus?' checked':'')+'> Bonus</label>'+
    '<button type="button" title="Hapus" aria-label="Hapus produk">×</button>';
  $('skuIsi').appendChild(d);
}
function skuIsiAmbil(){
  return [...$('skuIsi').querySelectorAll('.sku-isi-r')].map(d=>({produk_id:Number(d.querySelector('select').value),qty:Math.round(Number(d.querySelector('input[type=number]').value)),bonus:d.querySelector('.sku-bonus input').checked?1:0}))
    .filter(x=>x.produk_id&&x.qty>0);
}
function skuIsiHitung(){
  const items=skuIsiAmbil(),f=$('skuForm'),hpp=f.elements.hpp,p=(plData&&plData.rows)||[];
  hpp.readOnly=items.length>0;
  if(items.length){
    const t=items.reduce((a,x)=>{const pr=p.find(y=>y.id===x.produk_id);return a+(pr?pr.hpp*x.qty:0)},0);
    hpp.value=t;put('skuIsiInfo','HPP otomatis = '+items.map(x=>{const pr=p.find(y=>y.id===x.produk_id);return x.qty+'× '+(pr?rpFull(pr.hpp):'?')}).join(' + ')+' = '+rpFull(t)+' · dihitung '+int(skuPcs(items))+' pcs terjual'+(items.some(x=>x.bonus)?' (bonus tidak dihitung)':''));
  }else put('skuIsiInfo',p.length?'Kosongkan bila HPP diisi manual':'Belum ada produk — buat dulu di Inventory › List Produk');
  skuTotalHitung();
}
/** Dropdown gudang dari List Gudang; isian teks lama yang belum ada di List Gudang tetap bisa dipilih */
const skuBiayaGdg=g=>g?(g.biaya_penanganan||0)+(g.biaya_lain||0):0;
function skuGdgIsi(r){
  const sel=$('skuGdgSel'),f=$('skuForm'),id=r&&r.gudang_id,lama=r&&!r.gudang_id&&r.gudang;
  sel.innerHTML='<option value="">— Tanpa gudang —</option>'+skuGdgList.map(g=>'<option value="'+g.id+'"'+(g.id===id?' selected':'')+'>'+esc(g.nama)+' · '+esc((GD_JENIS[g.jenis]||[g.jenis])[0])+(skuBiayaGdg(g)?' · +'+rpFull(skuBiayaGdg(g))+'/paket':'')+'</option>').join('')+
    (lama?'<option value="lama" selected>'+esc(lama)+' (belum ada di List Gudang)</option>':'');
  f.elements.gudang.value=r&&r.gudang||'';
  skuTotalHitung();
}
function skuTotalHitung(){
  const f=$('skuForm'),dasar=Number(f.elements.hpp.value)||0,v=f.elements.gudang_id.value;
  const g=/^\d+$/.test(v)?skuGdgList.find(x=>x.id===Number(v)):null,b=skuBiayaGdg(g);
  $('skuTotalHpp').innerHTML=g?'<span>HPP total (masuk ke laporan laba)</span><b>'+rpFull(dasar+b)+'</b>'+
    '<small>HPP produk '+rpFull(dasar)+' + biaya gudang '+esc(g.nama)+' '+rpFull(b)+(b?' ('+esc(gdBiayaTeks(g))+')':' — gudang ini belum punya biaya')+'</small>'
    :'<span>HPP total (masuk ke laporan laba)</span><b>'+rpFull(dasar)+'</b><small>'+(skuGdgList.length?'Pilih gudang untuk menambahkan biaya penanganan gudang':'Belum ada gudang — buat di Inventory › List Gudang')+'</small>';
}
$('skuGdgSel').addEventListener('change',skuTotalHitung);
$('skuForm').elements.hpp.addEventListener('input',skuTotalHitung);
$('skuIsiTambah').addEventListener('click',()=>{skuIsiBaris(null,1);skuIsiHitung()});
$('skuIsi').addEventListener('input',skuIsiHitung);
$('skuIsi').addEventListener('change',skuIsiHitung);
$('skuIsi').addEventListener('click',e=>{const b=e.target.closest('button');if(b){b.closest('.sku-isi-r').remove();skuIsiHitung()}});
$('skuTambah').addEventListener('click',()=>skuBukaForm(null));
$('skuTutup').addEventListener('click',()=>$('skuDlg').close());
$('skuBatal').addEventListener('click',()=>$('skuDlg').close());
$('skuDlg').addEventListener('click',e=>{if(e.target===$('skuDlg'))$('skuDlg').close()});
$('skuForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('skuForm'),b=$('skuSimpan'),data=Object.fromEntries(SKU_KOLOM.map(k=>[k,f.elements[k].value.trim()]));
  data.hpp=Number(data.hpp);
  data.items=skuIsiAmbil();
  const gs=f.elements.gudang_id.value;
  data.gudang_id=/^\d+$/.test(gs)?Number(gs):null;
  if(!gs)data.gudang='';
  if(skuEditId)data.id=skuEditId;
  b.disabled=true;put('skuMsg','');
  try{
    await api('/api/settings/sku',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    $('skuDlg').close();await loadSku();
  }catch(err){put('skuMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
$('skuRows').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-ed]'),hp=e.target.closest('[data-hp]');
  if(ed)skuBukaForm((skuData||[]).find(r=>r.id===Number(ed.dataset.ed)));
  if(hp){
    const r=(skuData||[]).find(x=>x.id===Number(hp.dataset.hp));
    if(!r||!confirm('Hapus SKU '+r.sku+' — '+r.produk+'?'))return;
    hp.disabled=true;
    try{await api('/api/settings/sku/'+r.id,{method:'DELETE'});await loadSku()}
    catch(err){hp.disabled=false;alert('Gagal menghapus: '+err.message)}
  }
});
['skuCari','skuNiche','skuGudang','skuLink'].forEach(id=>$(id).addEventListener(id==='skuCari'?'input':'change',()=>{if(skuData)renderSku()}));
$('skuTanpaExport').addEventListener('click',()=>{const rows=skuSaringTanpa();if(rows.length)unduhCsv('varian-scalev-tanpa-sku.csv',['Varian','Jenis','Produk Scalev','Order 30 hari','Harga','COGS Scalev'],
  rows.map(v=>[v.name,v.kind,v.product_name||'',v.order30,v.price||'',v.cogs||'']))});
$('skuReset').addEventListener('click',()=>{$('skuCari').value='';$('skuNiche').value='';$('skuGudang').value='';$('skuLink').value='';if(skuData)renderSku()});
$('skuExport').addEventListener('click',()=>{
  if(!skuData)return;
  unduhCsv('manajemen-sku.csv',['SKU','Produk','HPP','Produk category','Gudang','Keterangan','Niche','Biaya gudang','HPP + biaya gudang'],
    skuSaring().map(r=>{const d=r.hpp_dasar==null?r.hpp:r.hpp_dasar;return [r.sku,r.produk,d,r.kategori,r.gudang,r.keterangan,r.niche,r.hpp-d,r.hpp]}));
});

// Tarik dari Scalev & impor CSV
// Nama kolom CSV yang dikenali → field
const SKU_HEADER={sku:'sku',produk:'produk',product:'produk','nama produk':'produk',hpp:'hpp',
  kategori:'kategori','produk category':'kategori','product category':'kategori',category:'kategori',
  gudang:'gudang',warehouse:'gudang',keterangan:'keterangan',catatan:'keterangan',niche:'niche'};
$('skuTarik').addEventListener('click',async()=>{
  if(!confirm('Tarik SKU dari katalog Scalev?\nSKU baru ditambahkan. SKU yang sudah ada hanya dilengkapi bila HPP / produk category masih kosong.'))return;
  const b=$('skuTarik');b.disabled=true;b.textContent='Menarik…';
  try{
    const h=await api('/api/settings/sku/tarik-scalev',{method:'POST'});
    await loadSku();
    alert(int(h.baru)+' SKU baru ditambahkan, '+int(h.sudah_ada)+' sudah ada (hanya dilengkapi bila kosong).'+
      (h.tanpa_hpp?'\n'+int(h.tanpa_hpp)+' SKU belum punya HPP di Scalev — HPP-nya masih Rp 0.':'')+
      (h.varian_tanpa_sku?'\n'+int(h.varian_tanpa_sku)+' varian Scalev belum punya SKU sehingga tidak ikut ditarik.':''));
  }catch(e){alert('Gagal menarik data: '+e.message)}
  finally{b.disabled=false;b.textContent='Tarik dari Scalev'}
});
$('skuImpor').addEventListener('click',()=>{$('skuFile').value='';$('skuFile').click()});
$('skuFile').addEventListener('change',async()=>{
  const file=$('skuFile').files[0];if(!file)return;
  try{
    const [head,...isi]=skuParseCsv(await file.text());
    const peta=(head||[]).map(h=>SKU_HEADER[h.trim().toLowerCase()]||null);
    if(!peta.includes('sku')||!peta.includes('produk'))throw new Error('kolom SKU dan Produk wajib ada di baris judul');
    const rows=isi.map(v=>{const r={};peta.forEach((k,i)=>{if(k)r[k]=(v[i]||'').trim()});
      // "Rp 47.000" / "47000,00" → 47000: buang desimal 1–2 digit di ujung, lalu semua non-angka
      r.hpp=Number(String(r.hpp||'0').trim().replace(/[.,]\d{1,2}$/,'').replace(/[^\d]/g,''))||0;return r});
    if(!confirm('Impor '+rows.length+' baris dari '+file.name+'? SKU yang sudah ada akan diperbarui.'))return;
    const h=await api('/api/settings/sku/impor',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows})});
    await loadSku();
    alert(int(h.saved)+' SKU tersimpan'+(h.skipped?', '+int(h.skipped)+' baris dilewati (SKU/produk kosong)':'')+'.');
  }catch(e){alert('Impor gagal: '+e.message)}
});
