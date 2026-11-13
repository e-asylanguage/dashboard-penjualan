/**
 * Inventory › List Produk: produk + HPP manual dan riwayat HPP per tanggal berlaku; SKU memilih produk + qty dari sini.
 * Data: /api/settings/produk-list. Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js,
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
/**
 * Kolom "Dipakai di": paling banyak PL_CHIP chip supaya tinggi baris tetap seragam; sisanya di balik tombol "+ N lainnya"
 * (klik untuk membuka / menutup; produk yang sedang dibuka diingat di plBuka selama halaman terbuka).
 */
const PL_CHIP=3,plBuka=new Set();
function plPakai(r){
  const chip=r.sku.map(x=>'<span class="tag info" title="'+esc(x.produk)+'">'+(x.qty>1?x.qty+'× ':'')+esc(x.sku)+'</span>')
    .concat(r.barang.map(x=>'<span class="tag pb" title="Nama barang Mengantar (pasangan langsung)">'+(x.qty>1?x.qty+'× ':'')+esc(x.goods)+'</span>'));
  if(!chip.length)return '<span style="color:var(--muted)">Belum dipakai</span>';
  if(chip.length<=PL_CHIP+1)return chip.join('');   // sisa 1 chip tidak perlu disembunyikan (tombolnya sama lebarnya)
  const buka=plBuka.has(r.id),sisa=chip.length-PL_CHIP;
  return chip.slice(0,buka?chip.length:PL_CHIP).join('')+
    '<button type="button" class="pl-lebih" data-pl-lebih="'+r.id+'" aria-expanded="'+buka+'" title="'+(buka?'Tampilkan 3 pertama saja':esc(r.sku.slice(PL_CHIP).map(x=>x.sku).concat(r.barang.slice(Math.max(0,PL_CHIP-r.sku.length)).map(x=>x.goods)).join(', ')))+'">'+
    (buka?'Sembunyikan':'+ '+int(sisa)+' lainnya')+'</button>';
}
// Filter cepat "butuh perhatian": HPP kosong (dihitung Rp 0 di laporan) dan produk yang belum dipakai SKU / nama barang mana pun
/**
 * Tanggal HPP yang sekarang berlaku: baris riwayat terbaru (riwayat urut terbaru di atas). HPP awal (berlaku 2000-01-01 = "sejak dulu")
 * memakai tanggal produk dibuat. Lebih dari PL_HPP_LAMA hari dianggap perlu dicek ulang ke vendor.
 */
const PL_HPP_LAMA=90;
function plHppTgl(r){
  const h=(r.riwayat||[])[0],t=h&&h.berlaku>'2000-01-01'?h.berlaku:String((h&&h.created_at)||r.created_at||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t))return null;
  const hari=Math.round((Date.parse((plData.hari_ini||ymd(new Date()))+'T00:00:00Z')-Date.parse(t+'T00:00:00Z'))/864e5);
  return {tgl:t,hari,sumber:h?h.sumber:'awal',lama:hari>PL_HPP_LAMA};
}
function plHppTglSel(r){
  const x=plHppTgl(r);if(!x)return '<span style="color:var(--muted)">—</span>';
  return esc(tglWib(x.tgl+'T12:00:00Z'))+'<small>'+(x.lama?'<span class="tag warn">'+int(x.hari)+' hari lalu · cek ulang</span>':x.hari<=0?'hari ini':int(x.hari)+' hari lalu')+' · '+esc(PL_SUMBER[x.sumber]||x.sumber)+'</small>';
}
const PL_FIL={hpp:r=>!(r.hpp>0),lepas:r=>!r.sku.length&&!r.barang.length,lama:r=>{const x=plHppTgl(r);return !!x&&x.lama}};
let plFil='';
function renderProdukList(){
  const semua=plData.rows||[],q=$('plCari').value.trim().toLowerCase();
  const nHpp=semua.filter(PL_FIL.hpp).length,nLepas=semua.filter(PL_FIL.lepas).length,nLama=semua.filter(PL_FIL.lama).length;
  if(plFil&&!semua.some(PL_FIL[plFil]))plFil='';
  const chip=(k,l,n)=>'<button type="button" class="'+(k?'pl-fil-w':'st-fil-semua')+(plFil===k?' on':'')+(k&&!n?' nol':'')+'" data-fil="'+k+'">'+l+' <small>'+int(n)+'</small></button>';
  $('plFil').innerHTML=chip('','Semua produk',semua.length)+chip('hpp','⚠ HPP kosong',nHpp)+chip('lepas','⚠ Belum terhubung SKU',nLepas)+chip('lama','⚠ HPP > '+PL_HPP_LAMA+' hari',nLama)+
    // SKU di Manajemen SKU yang belum memilih produk dari daftar ini tidak punya baris di sini → tautan ke halamannya
    (plData.sku_belum?'<button type="button" class="ob-link" data-buka-view="sku">'+int(plData.sku_belum)+' SKU belum terhubung ke produk → Manajemen SKU</button>':'');
  const rows=semua.filter(r=>(!q||r.nama.toLowerCase().includes(q))&&(!plFil||PL_FIL[plFil](r)));
  const hpp=semua.filter(r=>r.hpp>0),terhubung=new Set(semua.flatMap(r=>r.sku.map(x=>x.sku_id)));
  put('plTotal',int(semua.length));put('plTotalD',hpp.length===semua.length?'semua sudah ada HPP':int(semua.length-hpp.length)+' produk HPP masih 0');
  put('plHpp',hpp.length?rpFull(hpp.reduce((a,r)=>a+r.hpp,0)/hpp.length):'—');
  put('plHppD',hpp.length?'terendah '+rpFull(Math.min(...hpp.map(r=>r.hpp)))+' · tertinggi '+rpFull(Math.max(...hpp.map(r=>r.hpp))):'belum ada HPP');
  put('plSku',int(terhubung.size));put('plSkuD','dari '+int(plData.sku_total)+' SKU di Manajemen SKU');
  put('plBelum',int(plData.sku_belum));
  put('plInfo',semua.length?int(rows.length)+' dari '+int(semua.length)+' produk · mengubah HPP langsung memperbarui HPP semua SKU yang memakainya':'Belum ada produk. Klik "Tambah Produk".');
  $('plRows').innerHTML=rows.map(r=>'<tr><td class="nm">'+esc(r.nama)+(r.keterangan?'<small class="pl-ket" title="Keterangan">'+esc(r.keterangan)+'</small>':'')+'</td><td class="n">'+rpFull(r.hpp)+'</td><td class="pl-tgl">'+plHppTglSel(r)+'</td>'+
    '<td class="sh">'+plPakai(r)+'</td>'+
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
  const lb=e.target.closest('[data-pl-lebih]');
  if(lb){const id=Number(lb.dataset.plLebih);if(plBuka.has(id))plBuka.delete(id);else plBuka.add(id);renderProdukList();return}
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
$('plFil').addEventListener('click',e=>{const b=e.target.closest('[data-fil]');if(!b||!plData)return;plFil=b.dataset.fil;renderProdukList()});

// ---- Impor update HPP massal: file CSV (hasil Ekspor CSV yang kolom HPP-nya diubah) → pratinjau → terapkan.
// Hanya HPP produk yang SUDAH ADA yang diubah (dicocokkan dari nama, tanpa membedakan huruf besar/kecil); nama & keterangan tidak disentuh,
// produk baru tidak dibuat. Tiap perubahan lewat PUT /api/settings/produk-list yang sama dengan form Ubah, jadi riwayat HPP & HPP SKU ikut diperbarui.
/** CSV → baris sel; pemisah koma / titik koma / tab (Excel berbahasa Indonesia menyimpan dengan titik koma), kutip ganda didukung */
function plCsv(teks){
  teks=teks.replace(/^\uFEFF/,'');
  const b1=teks.split(/\r?\n/)[0]||'',pisah=[';','\t',','].sort((a,b)=>b1.split(b).length-b1.split(a).length)[0];
  const rows=[];let sel='',baris=[],kutip=false;
  for(let i=0;i<teks.length;i++){const c=teks[i];
    if(kutip){if(c==='"'){if(teks[i+1]==='"'){sel+='"';i++}else kutip=false}else sel+=c}
    else if(c==='"')kutip=true;
    else if(c===pisah){baris.push(sel);sel=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&teks[i+1]==='\n')i++;baris.push(sel);sel='';rows.push(baris);baris=[]}
    else sel+=c}
  if(sel||baris.length){baris.push(sel);rows.push(baris)}
  return rows.filter(r=>r.some(x=>String(x).trim()));
}
/** "Rp 12.500", "12,500", "12500,00", "12500.5" → rupiah bulat; null bila bukan angka */
function plAngkaHpp(v){
  let s=String(v==null?'':v).replace(/rp/i,'').replace(/\s/g,'');
  if(!s||/[^0-9.,]/.test(s))return null;
  if(/^\d{1,3}([.,]\d{3})+$/.test(s))s=s.replace(/[.,]/g,'');            // pemisah ribuan
  else if(/^\d{1,3}(\.\d{3})+,\d+$/.test(s))s=s.replace(/\./g,'').replace(',','.');   // 12.500,00
  else if(/^\d{1,3}(,\d{3})+\.\d+$/.test(s))s=s.replace(/,/g,'');       // 12,500.00
  else s=s.replace(',','.');                                               // desimal
  const n=Number(s);return Number.isFinite(n)&&n>=0?Math.round(n):null;
}
let plImporUbah=[];
function plImporBaca(teks){
  const rows=plCsv(teks),hi=rows.findIndex(r=>r.some(h=>/^produk$|^nama( produk)?$/i.test(String(h).trim()))&&r.some(h=>/^hpp/i.test(String(h).trim())));
  if(hi<0)throw new Error('Kolom "Produk" dan "HPP" tidak ditemukan. Pakai file hasil Ekspor CSV halaman ini.');
  const H=rows[hi].map(h=>String(h).trim()),iN=H.findIndex(h=>/^produk$|^nama( produk)?$/i.test(h)),iH=H.findIndex(h=>/^hpp/i.test(h));
  const ada=new Map((plData.rows||[]).map(r=>[r.nama.trim().toLowerCase(),r])),ubah=[],takAda=[],salah=[],dobel=[],lihat=new Set();let sama=0;
  for(const r of rows.slice(hi+1)){
    const nama=String(r[iN]==null?'':r[iN]).trim();if(!nama)continue;
    const p=ada.get(nama.toLowerCase());if(!p){takAda.push(nama);continue}
    if(lihat.has(p.id)){dobel.push(nama);continue}lihat.add(p.id);
    const hpp=plAngkaHpp(r[iH]);if(hpp==null){salah.push(nama+' ("'+String(r[iH]==null?'':r[iH]).trim()+'")');continue}
    if(hpp===p.hpp)sama++;else ubah.push({p,hpp});
  }
  return {ubah,takAda,salah,dobel,sama};
}
function plImporTampil(h,namaFile){
  plImporUbah=h.ubah;
  const daftar=(l,n=8)=>esc(l.slice(0,n).join(', '))+(l.length>n?', … ('+int(l.length)+')':'');
  $('plImporRing').innerHTML='File <b>'+esc(namaFile)+'</b>: <b>'+int(h.ubah.length)+' HPP akan diubah</b> · '+int(h.sama)+' sama (dilewati)';
  const c=[];
  if(h.takAda.length)c.push('<li><b>'+int(h.takAda.length)+' nama tidak ada di List Produk</b> (dilewati, produk baru tidak dibuat): '+daftar(h.takAda)+'</li>');
  if(h.salah.length)c.push('<li><b>'+int(h.salah.length)+' HPP bukan angka</b> (dilewati): '+daftar(h.salah)+'</li>');
  if(h.dobel.length)c.push('<li><b>'+int(h.dobel.length)+' nama muncul lebih dari sekali</b> (dipakai baris pertama): '+daftar(h.dobel)+'</li>');
  const jauh=h.ubah.filter(x=>x.p.hpp>0&&Math.abs(x.hpp-x.p.hpp)/x.p.hpp>0.5||!x.hpp).length;
  if(jauh)c.push('<li><b>'+int(jauh)+' perubahan lebih dari 50% atau menjadi Rp 0</b> — ditandai merah di bawah, periksa dulu barangkali salah ketik.</li>');
  $('plImporCatat').hidden=!c.length;$('plImporCatat').innerHTML=c.length?'<ul class="ob-list">'+c.join('')+'</ul>':'';
  $('plImporRows').innerHTML=h.ubah.map(x=>{const d=x.hpp-x.p.hpp,pr=x.p.hpp?100*d/x.p.hpp:null,aneh=!x.hpp||(pr!=null&&Math.abs(pr)>50);
    return '<tr'+(aneh?' class="pl-impor-aneh"':'')+'><td class="nm">'+esc(x.p.nama)+(x.p.sku.length?'<small>dipakai '+int(x.p.sku.length)+' SKU</small>':'')+'</td><td class="n">'+rpFull(x.p.hpp)+'</td><td class="n"><b>'+rpFull(x.hpp)+'</b></td>'+
      '<td class="n"><span style="color:var('+(d>0?'--loss':'--rev')+')">'+(d>0?'+ ':'− ')+rpFull(Math.abs(d))+'</span>'+(pr==null?'':'<small>'+(d>0?'+':'−')+nf.format(Math.round(Math.abs(pr)*10)/10)+'%</small>')+'</td></tr>'}).join('')||
    '<tr><td colspan="5" style="color:var(--muted)">Tidak ada HPP yang berubah di file ini.</td></tr>';
  $('plImporBerlaku').value=plData.hari_ini||'';$('plImporBerlaku').max=plData.hari_ini||'';
  const b=$('plImporTerap');b.disabled=!h.ubah.length;b.textContent=h.ubah.length?'Terapkan '+int(h.ubah.length)+' perubahan':'Terapkan';
  put('plImporMsg','');$('plImporDlg').showModal();
}
$('plImpor').addEventListener('click',()=>{if(plData)$('plImporFile').click()});
$('plImporFile').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f||!plData)return;
  if(/\.xlsx?$/i.test(f.name)){alert('File Excel belum didukung. Di Excel pilih Save As → CSV, lalu unggah file CSV-nya.');return}
  try{plImporTampil(plImporBaca(await f.text()),f.name)}catch(err){alert('File tidak bisa dibaca: '+err.message)}
});
['plImporTutup','plImporBatal'].forEach(id=>$(id).addEventListener('click',()=>$('plImporDlg').close()));
$('plImporTerap').addEventListener('click',async()=>{
  const b=$('plImporTerap'),berlaku=$('plImporBerlaku').value||undefined,ubah=plImporUbah;if(!ubah.length)return;
  if(!confirm('Ubah HPP '+ubah.length+' produk sekaligus? HPP SKU yang memakainya ikut diperbarui.'))return;
  b.disabled=true;$('plImporBatal').disabled=true;
  const gagal=[];let ok=0;
  for(const x of ubah){
    put('plImporMsg','Menyimpan '+(ok+gagal.length+1)+' dari '+ubah.length+'…');
    try{await api('/api/settings/produk-list',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.p.id,nama:x.p.nama,hpp:x.hpp,keterangan:x.p.keterangan||'',berlaku})});ok++}
    catch(err){gagal.push(x.p.nama+' ('+err.message+')')}
  }
  $('plImporBatal').disabled=false;
  await loadProdukList();
  if(gagal.length){put('plImporMsg',ok+' berhasil, '+gagal.length+' gagal');alert(ok+' HPP berhasil diubah, '+gagal.length+' gagal:\n'+gagal.slice(0,15).join('\n'));b.disabled=false}
  else{$('plImporDlg').close();alert(ok+' HPP produk berhasil diubah.')}
});
$('plExport').addEventListener('click',()=>{
  if(!plData)return;
  unduhCsv('list-produk.csv',['Produk','HPP','Keterangan','Dipakai di SKU','Nama barang Mengantar','HPP berlaku sejak'],
    (plData.rows||[]).map(r=>[r.nama,r.hpp,r.keterangan||'',r.sku.map(x=>(x.qty>1?x.qty+'x ':'')+x.sku).join('; '),r.barang.map(x=>(x.qty>1?x.qty+'x ':'')+x.goods).join('; '),(plHppTgl(r)||{}).tgl||'']));
});

