/**
 * Inventory › List Produk: produk + HPP manual dan riwayat HPP per tanggal berlaku; SKU memilih produk + qty dari sini.
 * Data: /api/settings/produk-list. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta plData (dibaca & diisi, bersama Manajemen SKU) dan SKU_IKON_EDIT / SKU_IKON_HAPUS dari script utama (window.*).
 * Dipanggil dari script utama: openProdukList() (menu List Produk).
 */
// ---- Inventory › List Produk: produk + HPP manual; SKU memilih produk + qty dari sini
let plEditId=null,plBusy=false;
async function loadProdukList(){
  if(plBusy)return;plBusy=true;
  try{plData=await api('/api/settings/produk-list');renderProdukList()}
  catch(e){$('plRows').innerHTML='<tr><td colspan="5" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
  finally{plBusy=false}
}
function openProdukList(){loadProdukList()}
function renderProdukList(){
  const semua=plData.rows||[],q=$('plCari').value.trim().toLowerCase();
  const rows=semua.filter(r=>!q||r.nama.toLowerCase().includes(q));
  const hpp=semua.filter(r=>r.hpp>0),terhubung=new Set(semua.flatMap(r=>r.sku.map(x=>x.sku_id)));
  put('plTotal',int(semua.length));put('plTotalD',hpp.length===semua.length?'semua sudah ada HPP':int(semua.length-hpp.length)+' produk HPP masih 0');
  put('plHpp',hpp.length?rpFull(hpp.reduce((a,r)=>a+r.hpp,0)/hpp.length):'—');
  put('plHppD',hpp.length?'terendah '+rpFull(Math.min(...hpp.map(r=>r.hpp)))+' · tertinggi '+rpFull(Math.max(...hpp.map(r=>r.hpp))):'belum ada HPP');
  put('plSku',int(terhubung.size));put('plSkuD','dari '+int(plData.sku_total)+' SKU di Manajemen SKU');
  put('plBelum',int(plData.sku_belum));
  put('plInfo',semua.length?int(rows.length)+' dari '+int(semua.length)+' produk · mengubah HPP langsung memperbarui HPP semua SKU yang memakainya':'Belum ada produk. Klik "Tambah Produk".');
  const kosong='<span style="color:var(--muted)">—</span>';
  $('plRows').innerHTML=rows.map(r=>'<tr><td class="nm">'+esc(r.nama)+'</td><td class="n">'+rpFull(r.hpp)+'</td>'+
    '<td class="sh">'+(r.sku.length||r.barang.length?r.sku.map(x=>'<span class="tag info" title="'+esc(x.produk)+'">'+(x.qty>1?x.qty+'× ':'')+esc(x.sku)+'</span>').join('')+r.barang.map(x=>'<span class="tag pb" title="Nama barang Mengantar (pasangan langsung)">'+(x.qty>1?x.qty+'× ':'')+esc(x.goods)+'</span>').join(''):'<span style="color:var(--muted)">Belum dipakai</span>')+'</td>'+
    '<td class="ket">'+(r.keterangan?esc(r.keterangan):kosong)+'</td>'+
    '<td class="n"><span class="ak"><button class="ed" data-ed="'+r.id+'" title="Ubah" aria-label="Ubah '+esc(r.nama)+'">'+SKU_IKON_EDIT+'</button>'+
    '<button class="hp" data-hp="'+r.id+'" title="Hapus" aria-label="Hapus '+esc(r.nama)+'">'+SKU_IKON_HAPUS+'</button></span></td></tr>').join('')||
    '<tr><td colspan="5" style="color:var(--muted)">'+(semua.length?'Tidak ada produk yang cocok.':'Belum ada produk.')+'</td></tr>';
}
function plBukaForm(r){
  plEditId=r?r.id:null;
  const f=$('plForm');f.reset();
  if(r){f.elements.nama.value=r.nama;f.elements.hpp.value=r.hpp;f.elements.keterangan.value=r.keterangan||''}
  // Produk lama: HPP yang diubah dicatat di riwayat dengan tanggal berlaku (bawaan hari ini)
  $('plBerlakuL').hidden=!r;f.elements.berlaku.value=plData.hari_ini||'';f.elements.berlaku.max=plData.hari_ini||'';
  plRenderRiwayat(r);
  put('plDlgJ',r?'Ubah produk '+r.nama:'Tambah produk');put('plMsg','');
  const info=$('plDlgInfo');info.hidden=!(r&&r.sku.length);
  if(r&&r.sku.length)info.textContent='Dipakai di '+r.sku.length+' SKU ('+r.sku.map(x=>x.sku).join(', ')+'). Mengubah HPP ikut memperbarui HPP SKU tersebut.';
  $('plDlg').showModal();f.elements.nama.focus();
}
const PL_SUMBER={awal:'HPP awal',manual:'diubah manual',req:'barang REQ diterima'};
/** Riwayat HPP produk (terbaru di atas); baris selain yang paling awal bisa dihapus */
function plRenderRiwayat(r){
  const box=$('plRiwayat'),riw=r&&r.riwayat||[];
  box.hidden=!riw.length;
  if(box.hidden)return;
  const awal=riw[riw.length-1];
  box.innerHTML='<div class="sku-isi-h"><b>Riwayat HPP</b><small>Paket &amp; order memakai HPP yang berlaku pada tanggalnya</small></div>'+
    riw.map(h=>'<div class="pl-riw-r"><span>'+(h.berlaku<='2000-01-01'?'Sejak awal':'Sejak '+tglWib(h.berlaku+'T12:00:00Z'))+'</span><b>'+rpFull(h.hpp)+'</b>'+
      '<small>'+esc(PL_SUMBER[h.sumber]||h.sumber)+'</small>'+(h===awal?'<i></i>':'<button type="button" data-hid="'+h.id+'" aria-label="Hapus riwayat">×</button>')+'</div>').join('');
}
$('plRiwayat').addEventListener('click',async e=>{
  const b=e.target.closest('[data-hid]');if(!b||!plEditId)return;
  if(!confirm('Hapus baris riwayat HPP ini? HPP pada periode itu kembali mengikuti baris sebelumnya.'))return;
  b.disabled=true;
  try{
    await api('/api/settings/produk-list/'+plEditId+'/hpp/'+b.dataset.hid,{method:'DELETE'});
    await loadProdukList();
    const r=(plData.rows||[]).find(x=>x.id===plEditId);if(r){$('plForm').elements.hpp.value=r.hpp;plRenderRiwayat(r)}
  }catch(err){b.disabled=false;put('plMsg','Gagal menghapus: '+err.message)}
});
$('plTambah').addEventListener('click',()=>plBukaForm(null));
$('plTutup').addEventListener('click',()=>$('plDlg').close());
$('plBatal').addEventListener('click',()=>$('plDlg').close());
$('plDlg').addEventListener('click',e=>{if(e.target===$('plDlg'))$('plDlg').close()});
$('plForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('plForm'),b=$('plSimpan');
  const data={nama:f.elements.nama.value.trim(),hpp:Number(f.elements.hpp.value),keterangan:f.elements.keterangan.value.trim()};
  if(plEditId){data.id=plEditId;data.berlaku=f.elements.berlaku.value||undefined}
  b.disabled=true;put('plMsg','');
  try{
    await api('/api/settings/produk-list',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    $('plDlg').close();await loadProdukList();
  }catch(err){put('plMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
$('plRows').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-ed]'),hp=e.target.closest('[data-hp]');
  if(ed)plBukaForm((plData.rows||[]).find(r=>r.id===Number(ed.dataset.ed)));
  if(hp){
    const r=(plData.rows||[]).find(x=>x.id===Number(hp.dataset.hp));
    if(!r||!confirm('Hapus produk '+r.nama+'?'))return;
    hp.disabled=true;
    try{await api('/api/settings/produk-list/'+r.id,{method:'DELETE'});await loadProdukList()}
    catch(err){hp.disabled=false;alert('Gagal menghapus: '+err.message)}
  }
});
$('plCari').addEventListener('input',()=>{if(plData)renderProdukList()});
$('plExport').addEventListener('click',()=>{
  if(!plData)return;
  unduhCsv('list-produk.csv',['Produk','HPP','Keterangan','Dipakai di SKU','Nama barang Mengantar'],
    (plData.rows||[]).map(r=>[r.nama,r.hpp,r.keterangan||'',r.sku.map(x=>(x.qty>1?x.qty+'x ':'')+x.sku).join('; '),r.barang.map(x=>(x.qty>1?x.qty+'x ':'')+x.goods).join('; ')]));
});

