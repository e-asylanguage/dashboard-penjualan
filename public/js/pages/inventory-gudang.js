/**
 * Inventory › List Gudang: gudang buatan sendiri (jenis, kontak, biaya penanganan & lain) + pasangan nama pengirim Mengantar, statistik paket per gudang, ekspor CSV.
 * Data: /api/settings/gudang, /api/settings/gudang/pengirim. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta GD_JENIS, gdTag(), gdPersen(), gdBiayaTeks(), SKU_IKON_EDIT / SKU_IKON_HAPUS dari script utama (window.*).
 * Dipanggil dari script utama: openGudang() (menu List Gudang).
 */
// ---- Inventory › List Gudang: gudang buatan sendiri + pasangan nama pengirim Mengantar
let gdData=null,gdEditId=null,gdBusy=false,gdTab='',gdShBaru=null;
/** Jumlahkan statistik paket dari daftar nama pengirim */
const gdSum=list=>list.reduce((a,s)=>{a.total+=s.total;a.delivered+=s.delivered;a.rts+=s.rts;a.on_going+=s.on_going;return a},{total:0,delivered:0,rts:0,on_going:0});

async function loadGudang(){
  if(gdBusy)return;gdBusy=true;
  try{gdData=await api('/api/settings/gudang');renderGudang()}
  catch(e){$('gdRows').innerHTML='<tr><td colspan="9" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
  finally{gdBusy=false}
}
function openGudang(){loadGudang()}

function renderGudang(){
  const rows=gdData.rows||[],sh=gdData.shippers||[];
  const milik=id=>sh.filter(s=>s.gudang_id===id);
  // KPI per jenis gudang
  ['sendiri','fulfillment','dropship'].forEach(j=>{
    const g=rows.filter(r=>r.jenis===j),t=gdSum(g.flatMap(r=>milik(r.id))),K=j.charAt(0).toUpperCase()+j.slice(1);
    put('gdK'+K,int(g.length)+' gudang');
    put('gdK'+K+'D',int(t.total)+' paket · '+gdPersen(t.delivered,t.total)+' terkirim · RTS '+gdPersen(t.rts,t.total));
  });
  const belum=sh.filter(s=>!s.gudang_id&&s.total),tb=gdSum(belum);
  put('gdKBelum',int(belum.length)+' nama');
  put('gdKBelumD',belum.length?int(tb.total)+' paket belum masuk gudang mana pun':'semua nama pengirim sudah dipasangkan');
  put('gdInfo',rows.length?int(rows.length)+' gudang · statistik paket semua tanggal dari data Mengantar':'Belum ada gudang. Klik "Tambah Gudang", atau "Jadikan gudang" di daftar pengirim Mengantar di bawah.');
  const kosong='<span style="color:var(--muted)">—</span>';
  $('gdRows').innerHTML=rows.map(r=>{
    const m=milik(r.id),t=gdSum(m);
    return '<tr><td class="nm">'+esc(r.nama)+(r.kontak||r.keterangan?'<small>'+esc([r.kontak,r.keterangan].filter(Boolean).join(' · '))+'</small>':'')+'</td>'+
      '<td>'+gdTag(r.jenis)+'</td>'+
      '<td class="n">'+(r.biaya_penanganan||r.biaya_lain?rpFull((r.biaya_penanganan||0)+(r.biaya_lain||0))+'<small>'+esc(gdBiayaTeks(r))+'</small>':kosong)+'</td>'+
      '<td class="sh">'+(m.length?m.map(s=>'<span class="tag">'+esc(s.shipper)+'</span>').join(''):'<span style="color:var(--muted)">Belum dipasangkan</span>')+'</td>'+
      '<td class="n">'+(t.total?int(t.total):kosong)+'</td>'+
      '<td class="n">'+(t.total?int(t.delivered)+'<small>'+gdPersen(t.delivered,t.total)+'</small>':kosong)+'</td>'+
      '<td class="n">'+(t.total?int(t.rts)+'<small>'+gdPersen(t.rts,t.total)+'</small>':kosong)+'</td>'+
      '<td class="n">'+(t.total?int(t.on_going):kosong)+'</td>'+
      '<td class="n"><span class="ak"><button class="ed" data-ed="'+r.id+'" title="Ubah" aria-label="Ubah '+esc(r.nama)+'">'+SKU_IKON_EDIT+'</button>'+
      '<button class="hp" data-hp="'+r.id+'" title="Hapus" aria-label="Hapus '+esc(r.nama)+'">'+SKU_IKON_HAPUS+'</button></span></td></tr>';
  }).join('')||'<tr><td colspan="9" style="color:var(--muted)">Belum ada gudang.</td></tr>';
  renderGdPengirim();
}

function renderGdPengirim(){
  const rows=gdData.rows||[],sh=gdData.shippers||[],belum=sh.filter(s=>!s.gudang_id);
  if(gdTab==='belum'&&!belum.length)gdTab='';
  $('gdTab').innerHTML='<button class="'+(gdTab?'':'on')+'" data-tab="">Semua <small>'+int(sh.length)+'</small></button>'+
    '<button class="'+(gdTab==='belum'?'on':'')+'" data-tab="belum">Belum dipasangkan <small>'+int(belum.length)+'</small></button>';
  const q=$('gdCari').value.trim().toLowerCase();
  const list=sh.filter(s=>(!gdTab||!s.gudang_id)&&(!q||s.shipper.toLowerCase().includes(q)));
  const opsi=id=>'<option value="">— Belum dipasangkan —</option>'+rows.map(r=>'<option value="'+r.id+'"'+(r.id===id?' selected':'')+'>'+esc(r.nama)+' · '+esc((GD_JENIS[r.jenis]||[r.jenis])[0])+'</option>').join('');
  $('gdShRows').innerHTML=list.map(s=>'<tr><td class="nm">'+esc(s.shipper)+(s.total?'':'<small>tidak ada di data paket saat ini</small>')+'</td>'+
    '<td class="n">'+int(s.total)+'</td><td class="n">'+int(s.delivered)+'<small>'+gdPersen(s.delivered,s.total)+'</small></td>'+
    '<td class="n">'+int(s.rts)+'<small>'+gdPersen(s.rts,s.total)+'</small></td><td>'+tglWib(s.last_at)+'</td>'+
    '<td><select class="gd-pilih'+(s.gudang_id?'':' kosong')+'" data-sh="'+esc(s.shipper)+'" aria-label="Gudang untuk '+esc(s.shipper)+'">'+opsi(s.gudang_id)+'</select></td>'+
    '<td>'+(s.gudang_id?'':'<button class="gd-baru" data-baru="'+esc(s.shipper)+'">+ Jadikan gudang</button>')+'</td></tr>').join('')||
    '<tr><td colspan="7" style="color:var(--muted)">'+(sh.length?'Tidak ada nama pengirim yang cocok.':'Belum ada data paket Mengantar.')+'</td></tr>';
}

/** Form gudang; shipper diisi bila dibuka dari "Jadikan gudang" (nama itu langsung dipasangkan) */
function gdBukaForm(r,shipper){
  gdEditId=r?r.id:null;gdShBaru=shipper||null;
  const f=$('gdForm');f.reset();
  if(r){f.elements.nama.value=r.nama;f.elements.jenis.value=r.jenis;f.elements.kontak.value=r.kontak||'';f.elements.keterangan.value=r.keterangan||'';
    f.elements.biaya_penanganan.value=r.biaya_penanganan||'';f.elements.biaya_lain.value=r.biaya_lain||'';f.elements.biaya_lain_ket.value=r.biaya_lain_ket||''}
  else if(shipper)f.elements.nama.value=shipper;
  put('gdDlgJ',r?'Ubah gudang '+r.nama:'Tambah gudang');put('gdMsg','');
  const p=$('gdDlgSh');p.hidden=!shipper;if(shipper)p.textContent='Nama pengirim Mengantar "'+shipper+'" langsung dipasangkan ke gudang ini.';
  $('gdDlg').showModal();f.elements.nama.focus();
}
$('gdTambah').addEventListener('click',()=>gdBukaForm(null));
$('gdTutup').addEventListener('click',()=>$('gdDlg').close());
$('gdBatal').addEventListener('click',()=>$('gdDlg').close());
$('gdDlg').addEventListener('click',e=>{if(e.target===$('gdDlg'))$('gdDlg').close()});
$('gdForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('gdForm'),b=$('gdSimpan');
  const data={nama:f.elements.nama.value.trim(),jenis:f.elements.jenis.value,kontak:f.elements.kontak.value.trim(),keterangan:f.elements.keterangan.value.trim(),
    biaya_penanganan:Number(f.elements.biaya_penanganan.value)||0,biaya_lain:Number(f.elements.biaya_lain.value)||0,biaya_lain_ket:f.elements.biaya_lain_ket.value.trim()};
  if(gdEditId)data.id=gdEditId;
  if(gdShBaru)data.shippers=[gdShBaru];
  b.disabled=true;put('gdMsg','');
  try{
    await api('/api/settings/gudang',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    $('gdDlg').close();await loadGudang();
  }catch(err){put('gdMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
$('gdRows').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-ed]'),hp=e.target.closest('[data-hp]');
  if(ed)gdBukaForm((gdData.rows||[]).find(r=>r.id===Number(ed.dataset.ed)));
  if(hp){
    const r=(gdData.rows||[]).find(x=>x.id===Number(hp.dataset.hp));
    if(!r||!confirm('Hapus gudang '+r.nama+'?\nNama pengirim Mengantar yang dipasangkan ke gudang ini akan kembali "Belum dipasangkan". Data Mengantar tidak berubah.'))return;
    hp.disabled=true;
    try{await api('/api/settings/gudang/'+r.id,{method:'DELETE'});await loadGudang()}
    catch(err){hp.disabled=false;alert('Gagal menghapus: '+err.message)}
  }
});
$('gdShRows').addEventListener('change',async e=>{
  const sel=e.target.closest('select[data-sh]');if(!sel)return;
  sel.disabled=true;
  try{
    await api('/api/settings/gudang/pengirim',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({shipper:sel.dataset.sh,gudang_id:sel.value?Number(sel.value):null})});
    const s=gdData.shippers.find(x=>x.shipper===sel.dataset.sh);if(s)s.gudang_id=sel.value?Number(sel.value):null;
    renderGudang();
  }catch(err){sel.disabled=false;alert('Gagal memasangkan: '+err.message)}
});
$('gdShRows').addEventListener('click',e=>{const b=e.target.closest('[data-baru]');if(b)gdBukaForm(null,b.dataset.baru)});
$('gdTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;gdTab=b.dataset.tab;renderGdPengirim()});
$('gdCari').addEventListener('input',()=>{if(gdData)renderGdPengirim()});
$('gdExport').addEventListener('click',()=>{
  if(!gdData)return;
  const sh=gdData.shippers||[];
  unduhCsv('list-gudang.csv',['Gudang','Jenis','Kontak','Keterangan','Biaya penanganan / paket','Biaya lain / paket','Keterangan biaya lain','Nama di Mengantar','Paket','Terkirim','RTS','Dalam perjalanan'],
    (gdData.rows||[]).map(r=>{const m=sh.filter(s=>s.gudang_id===r.id),t=gdSum(m);
      return [r.nama,(GD_JENIS[r.jenis]||[r.jenis])[0],r.kontak||'',r.keterangan||'',r.biaya_penanganan||0,r.biaya_lain||0,r.biaya_lain_ket||'',m.map(s=>s.shipper).join('; '),t.total,t.delivered,t.rts,t.on_going]}));
});
