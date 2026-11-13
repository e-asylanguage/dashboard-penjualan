/**
 * Inventory › Stok: stok berjalan per produk × gudang, riwayat opname, isi stok awal, opname, ekspor CSV.
 * Data: /api/report/stok, /stok/awal, /stok/opname, /stok/mutasi/:id. Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js,
 * serta stHitung(), stDicatat(), stTanpaAwal(), stBelum() (dipakai juga Inbound REQ & Nilai Persediaan) dan belumPesan() dari script utama (window.*).
 * Dipanggil dari script utama: loadStok() (menu Stok).
 */
// ---- Inventory › Stok: stok berjalan per produk × gudang sejak tanggal stok awal (kv stok_mulai).
// Stok = stok awal + opname − barang keluar (paket Mengantar yang sudah dijemput kurir dan pesanan Shopee / TikTok yang sudah
//        dikirim, sejak tanggal mulai) + retur diterima baik di Inbound RTS (diterima sejak tanggal mulai). Semua jenis gudang dicatat.
let stData=null,stBusy=false,stTab='stok';
const ST_TIPIS=14;                       // hari: stok cukup kurang dari ini dianggap menipis

async function loadStok(){
  if(stBusy)return;stBusy=true;
  try{stSiapkan(await api('/api/report/stok'));renderStok()}
  catch(e){$('stIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{stBusy=false}
}

function stSiapkan(d){
  stHitung(d);
  stData=d;
  const sel2=$('stGudang'),v=sel2.value,gd=d.gudang.filter(stDicatat);
  sel2.innerHTML='<option value="">Semua gudang</option>'+gd.map(g=>'<option value="'+g.id+'">'+esc(g.nama)+'</option>').join('');
  sel2.value=[...sel2.options].some(o=>o.value===v)?v:'';
}

function stSaring(){
  const g=$('stGudang').value,q=$('stCari').value.trim().toLowerCase();
  return stData.stok.filter(s=>(!g||String(s.gudang.id)===g)&&(!q||s.produk.nama.toLowerCase().includes(q)));
}
// Stok minus = error pencatatan (barang keluar tercatat, tapi stok awal / barang masuk belum diinput), bukan kondisi stok.
// Dipisah ke tab "Error data" dan tidak ikut dihitung di kartu Habis maupun Nilai stok.
const stMinus=s=>s.stok<0;
/** Dugaan penyebab stok minus + tombol perbaikannya */
function stSebabMinus(s){
  if(s.awal==null)return ['Stok awal belum diisi','Barang sudah keluar '+int(s.keluar)+' pcs sejak tanggal mulai, tapi stok awalnya kosong.','awal'];
  if(!s.masuk)return ['Barang masuk belum dicatat','Stok awal '+int(s.awal)+' pcs sudah habis terpakai dan belum ada penerimaan di Inbound REQ.','req'];
  return ['Keluar melebihi awal + masuk','Stok awal '+int(s.awal)+' + masuk '+int(s.masuk)+' lebih kecil dari yang keluar — cek penerimaan yang belum dicatat atau lakukan opname.','opname'];
}
/**
 * Kelompok status untuk filter cepat & tag (stok minus punya tab sendiri):
 * habis = 0 · tipis = cukup < ST_TIPIS hari · lebih (overstock) = cukup > ST_LEBIH hari, atau masih ada stok tapi tidak keluar sama sekali 30 hari terakhir · sisanya aman.
 */
const ST_LEBIH=90;
const stKelompok=s=>s.stok<0?'minus':s.stok===0?'habis':s.hari!=null&&s.hari<ST_TIPIS?'tipis':(s.hari!=null&&s.hari>ST_LEBIH)||(!s.perHari&&s.awal!=null)?'lebih':'aman';
/**
 * Rekomendasi restock per produk × gudang, dari rata-rata keluar 30 hari:
 *   kebutuhan = keluar/hari × (lead time + target hari aman);  pesan = kebutuhan − stok sekarang (dibulatkan ke atas).
 * Direkomendasikan bila stok tidak cukup sampai barang pesanan datang + ST_TIPIS hari cadangan (cukup < lead time + ST_TIPIS), atau stok habis.
 * Lead time & target diatur di atas tabel, disimpan di browser ini (localStorage); bawaan 7 & 30 hari.
 * null = belum perlu pesan; {qty:null} = perlu tapi tidak bisa dihitung (tidak ada barang keluar 30 hari terakhir).
 */
let stLead=7,stTarget=30;
try{const s=JSON.parse(localStorage.getItem('stRestock')||'null');if(s&&s.lead>=0&&s.target>0){stLead=s.lead;stTarget=s.target}}catch(e){}
function stRestock(s){
  if(s.stok<0)return null;
  if(!s.perHari)return s.stok===0&&s.awal!=null?{qty:null}:null;
  if(s.stok>0&&s.hari>=stLead+ST_TIPIS)return null;
  return {qty:Math.max(1,Math.ceil(s.perHari*(stLead+stTarget)-s.stok)),telat:s.hari<stLead};
}
const ST_FIL=[['','Semua'],['habis','Habis'],['tipis','Menipis'],['lebih','Overstock'],['aman','Aman']];
let stFil='';
const stStatus=s=>{const k=stKelompok(s);return k==='minus'?['Minus · error data','loss']:k==='habis'?['Habis','loss']:k==='tipis'?['Menipis','warn']:k==='lebih'?[s.perHari?'Overstock':'Overstock · tidak keluar 30 hari','info']:s.awal==null?['Belum ada stok awal','info']:['Aman','rev']};

function renderStok(){
  const d=stData,rows=stSaring(),tglMulai=tglWib(d.mulai+'T12:00:00Z');
  put('stPeriod','Stok berjalan per produk × gudang sejak stok awal '+tglMulai+' · hanya gudang milik sendiri');
  const ada=rows.filter(s=>s.stok>0),tipis=rows.filter(s=>s.stok>0&&s.hari!=null&&s.hari<ST_TIPIS),habis=rows.filter(s=>s.stok===0),minus=rows.filter(stMinus);
  put('stK1',int(ada.reduce((a,s)=>a+s.stok,0))+' pcs');put('stK1D',int(ada.length)+' produk × gudang masih ada stok');
  put('stK2',int(tipis.length));put('stK2D','cukup untuk kurang dari '+ST_TIPIS+' hari (rata-rata keluar 30 hari)');
  put('stK3',int(habis.length));put('stK3D','produk × gudang'+(minus.length?' · '+int(minus.length)+' minus dipisah ke Error data':''));
  put('stK4',rpFull(rows.filter(s=>!stMinus(s)).reduce((a,s)=>a+s.nilai,0)));put('stK4D','stok × HPP List Produk terkini'+(minus.length?' · stok minus tidak dihitung':''));
  // Peringatan darurat stok minus (mengikuti filter gudang & pencarian) + jumlah di tab Error data
  const em=$('stMinus');em.hidden=!minus.length;
  if(minus.length){const tanpaAwalN=minus.filter(s=>s.awal==null).length;
    put('stMinusTeks',int(minus.length)+' produk × gudang tercatat minus (total '+int(minus.reduce((a,s)=>a+s.stok,0))+' pcs). Stok fisik tidak mungkin minus — ini tanda stok awal atau barang masuk belum diinput'+
      (tanpaAwalN?' ('+int(tanpaAwalN)+' di antaranya belum punya stok awal)':'')+'. Angka stok & nilai persediaan produk ini belum bisa dipercaya sampai diperbaiki.')}
  const tm=$('stTabMinus');tm.hidden=!minus.length;put('stTabMinusN',minus.length?String(minus.length):'');
  if(!minus.length&&stTab==='minus')stTab='stok';
  const w=[],ws=d.warn,tanpaAwal=[...new Set(stTanpaAwal(d).map(g=>g.nama))];
  if(tanpaAwal.length)w.push('<b>Stok awal '+tglMulai+' belum diisi</b> untuk '+tanpaAwal.map(esc).join(', ')+'. <button type="button" class="ob-link" data-st-awal>Isi stok awal →</button>');
  if(ws.belum)w.push(...belumPesan(stBelum(ws),'jadi belum mengurangi stok'));
  if(ws.skuKosong)w.push('<b>'+int(ws.skuKosong)+' isi paket memakai SKU tanpa isi produk</b>, jadi stoknya belum terlacak.'+obLink('sku','Manajemen SKU'));
  if(ws.tanpaGudang)w.push('<b>'+int(ws.tanpaGudang)+' paket dari pengirim yang belum dipasangkan ke gudang</b>, jadi belum mengurangi stok gudang mana pun.'+obLink('gudang','List Gudang'));
  // Butir pendek: masalah utama tebal di depan + tombol ke halaman perbaikannya
  $('stWarn').hidden=!w.length;$('stWarn').innerHTML='<ul class="ob-list">'+w.map(x=>'<li>'+x+'</li>').join('')+'</ul>';
  const ba=$('stWarn').querySelector('[data-st-awal]');if(ba)ba.onclick=()=>$('stAwalBtn').click();
  put('stTabN',d.mutasi.filter(m=>m.jenis==='opname').length?String(d.mutasi.filter(m=>m.jenis==='opname').length):'');
  stRenderTab();
}

function stRestockSel(s){
  const r=stRestock(s);if(!r)return '<span style="color:var(--muted)">—</span>';
  if(r.qty==null)return '<span class="tag warn">Perlu dicek</span><small>tidak ada data keluar 30 hari</small>';
  return '<b class="st-pesan'+(r.telat?' telat':'')+'">Pesan '+int(r.qty)+' pcs</b><small>'+(r.telat?'stok habis sebelum barang datang · ':'')+'± '+rpFull(r.qty*(s.produk.hpp||0))+'</small>';
}
function stRenderTab(){
  const d=stData,kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Belum ada data stok pada filter ini.</td></tr>',mut='<span style="color:var(--muted)">—</span>';
  $('stTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===stTab));
  if(stTab==='stok'){
    // Stok minus tidak dibaurkan dengan stok normal — lihat tab Error data
    const semua=stSaring().filter(s=>!stMinus(s)),jml={};semua.forEach(s=>{const k=stKelompok(s);jml[k]=(jml[k]||0)+1});
    // Filter cepat per status; chip yang jumlahnya 0 tetap tampil (redup) supaya terlihat bahwa memang tidak ada
    if(stFil&&!jml[stFil])stFil='';
    $('stFil').hidden=false;$('stAtur').hidden=false;
    $('stFil').innerHTML=ST_FIL.map(([k,l])=>'<button type="button" class="st-fil-'+(k||'semua')+(stFil===k?' on':'')+(k&&!jml[k]?' nol':'')+'" data-fil="'+k+'">'+l+' <small>'+int(k?jml[k]||0:semua.length)+'</small></button>').join('');
    const rows=semua.filter(s=>!stFil||stKelompok(s)===stFil).sort((a,b)=>a.produk.nama.localeCompare(b.produk.nama,'id')||a.gudang.nama.localeCompare(b.gudang.nama,'id'));
    put('stSub','Stok = stok awal + masuk (Inbound REQ) − keluar + retur diterima baik ± opname · keluar dihitung dari paket Mengantar yang sudah dijemput kurir + pesanan Shopee / TikTok yang sudah dikirim (Pengiriman Kilat / Fulfilled by TikTok dari gudang Kilat / FBT toko) · klik Opname untuk menyesuaikan dengan hitungan fisik');
    $('stIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Produk</th><th>Gudang</th><th class="n">Stok awal</th><th class="n" title="Barang diterima baik dari Inbound REQ">Masuk</th><th class="n">Keluar</th><th class="n">Retur baik</th><th class="n">Opname</th><th class="n">Stok sekarang</th><th class="n">Keluar / hari</th><th class="n">Cukup untuk</th><th class="n" title="Jumlah yang disarankan dipesan ke supplier: keluar/hari × (lead time + target hari aman) − stok sekarang">Rekomendasi restock</th><th class="n">Nilai</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (rows.map(s=>{const st=stStatus(s);
        return '<tr><td class="nm">'+esc(s.produk.nama)+'<small>HPP '+rpFull(s.produk.hpp)+'</small></td><td>'+esc(s.gudang.nama)+'</td>'+
          '<td class="n">'+(s.awal==null?mut:int(s.awal))+'</td><td class="n">'+(s.masuk?'+ '+int(s.masuk):mut)+'</td><td class="n">'+(s.keluar?'− '+int(s.keluar):mut)+'</td><td class="n">'+(s.retur?'+ '+int(s.retur):mut)+'</td>'+
          '<td class="n">'+(s.opname?(s.opname>0?'+ ':'− ')+int(Math.abs(s.opname)):mut)+'</td>'+
          '<td class="n"><b>'+int(s.stok)+'</b><small><span class="tag '+st[1]+'">'+st[0]+'</span></small></td>'+
          '<td class="n">'+(s.perHari?nf2.format(s.perHari):mut)+'</td><td class="n">'+(s.hari==null?mut:s.stok<=0?'0 hari':int(Math.floor(s.hari))+' hari')+'</td>'+
          '<td class="n">'+stRestockSel(s)+'</td>'+
          '<td class="n">'+rpFull(s.nilai)+'</td>'+
          '<td class="n"><span class="ir-aksi"><button class="ir-batal" data-op="'+s.produk.id+'|'+s.gudang.id+'">Opname</button></span></td></tr>'}).join('')||kosong(13))+'</tbody></table>';
  }else if(stTab==='minus'){
    $('stFil').hidden=true;$('stAtur').hidden=true;
    const rows=stSaring().filter(stMinus).sort((a,b)=>a.stok-b.stok);
    put('stSub','Stok tercatat di bawah nol = error pencatatan, bukan stok sungguhan · urut dari yang paling minus · perbaiki lewat stok awal, Inbound REQ, atau opname — setelah benar barisnya kembali ke tab Stok per produk');
    $('stIsi').innerHTML='<table class="sku-tbl gd-tbl" data-dt="off"><thead><tr><th>Produk</th><th>Gudang</th><th class="n">Stok awal</th><th class="n">Masuk</th><th class="n">Keluar</th><th class="n">Retur baik</th><th class="n">Opname</th><th class="n">Stok tercatat</th><th>Dugaan penyebab</th><th class="n">Perbaiki</th></tr></thead><tbody>'+
      (rows.map(s=>{const sb=stSebabMinus(s);
        return '<tr><td class="nm">'+esc(s.produk.nama)+'</td><td>'+esc(s.gudang.nama)+'</td>'+
          '<td class="n">'+(s.awal==null?'<span class="tag loss">kosong</span>':int(s.awal))+'</td><td class="n">'+(s.masuk?'+ '+int(s.masuk):mut)+'</td><td class="n">'+(s.keluar?'− '+int(s.keluar):mut)+'</td><td class="n">'+(s.retur?'+ '+int(s.retur):mut)+'</td>'+
          '<td class="n">'+(s.opname?(s.opname>0?'+ ':'− ')+int(Math.abs(s.opname)):mut)+'</td>'+
          '<td class="n"><b class="st-minus-v">'+int(s.stok)+'</b></td>'+
          '<td class="st-sebab"><b>'+esc(sb[0])+'</b><small>'+esc(sb[1])+'</small></td>'+
          '<td class="n"><span class="ir-aksi">'+(sb[2]==='awal'?'<button class="ir-batal" data-st-awal-g="'+s.gudang.id+'">Isi stok awal</button>':sb[2]==='req'?'<button class="ir-batal" data-buka-view="inreq">Inbound REQ</button>':'')+
            '<button class="ir-batal" data-op="'+s.produk.id+'|'+s.gudang.id+'">Opname</button></span></td></tr>'}).join('')||'<tr><td colspan="10" style="color:var(--muted)">Tidak ada stok minus pada filter ini. 🎉</td></tr>')+'</tbody></table>';
  }else{
    $('stFil').hidden=true;$('stAtur').hidden=true;
    const g=$('stGudang').value,q=$('stCari').value.trim().toLowerCase(),gd=new Map(d.gudang.map(x=>[x.id,x])),pr=new Map(d.produk.map(x=>[x.id,x]));
    const rows=d.mutasi.filter(m=>m.jenis==='opname'&&(!g||String(m.gudang_id)===g)&&(!q||((pr.get(m.produk_id)||{}).nama||'').toLowerCase().includes(q)));
    put('stSub','Penyesuaian stok dari hitungan fisik · selisih = stok fisik − stok sistem saat opname');
    $('stIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Tanggal</th><th>Produk</th><th>Gudang</th><th class="n">Selisih</th><th>Catatan</th><th>Oleh</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (rows.map(m=>'<tr><td>'+tglWib(m.tanggal+'T12:00:00Z')+(m.tanggal<d.mulai?'<small class="mm-sub"><span class="tag warn">sebelum tanggal mulai — tidak dihitung</span></small>':'')+'</td><td class="nm">'+esc((pr.get(m.produk_id)||{}).nama||'?')+'</td><td>'+esc((gd.get(m.gudang_id)||{}).nama||'?')+'</td>'+
        '<td class="n"><b style="color:var('+(m.qty<0?'--loss':'--rev')+')">'+(m.qty>0?'+':'−')+' '+int(Math.abs(m.qty))+'</b></td><td class="ket">'+(m.catatan?esc(m.catatan):mut)+'</td><td>'+esc(m.oleh||'')+'</td>'+
        '<td class="n"><span class="ir-aksi"><button class="ir-batal" data-hapus="'+m.id+'">Hapus</button></span></td></tr>').join('')||'<tr><td colspan="7" style="color:var(--muted)">Belum ada opname.</td></tr>')+'</tbody></table>';
  }
}

// -- Isi stok awal per gudang: semua produk List Produk, kosongkan = tidak punya stok awal di gudang itu
function stAwalIsi(){
  const g=Number($('stAwalGudang').value),awal=new Map(stData.mutasi.filter(m=>m.jenis==='awal'&&m.gudang_id===g).map(m=>[m.produk_id,m.qty]));
  put('stAwalInfo','Hasil hitung fisik per '+tglWib(stData.mulai+'T12:00:00Z')+' (sebelum paket hari itu dikirim) · kosongkan produk yang tidak disimpan di gudang ini');
  $('stAwalList').innerHTML=stData.produk.length?stData.produk.map(p=>'<label class="st-awal-r"><span>'+esc(p.nama)+'</span><input type="number" min="0" step="1" data-produk="'+p.id+'" value="'+(awal.has(p.id)?awal.get(p.id):'')+'" placeholder="—"></label>').join('')
    :'<p style="color:var(--muted)">Belum ada produk — buat dulu di Inventory › List Produk.</p>';
}
$('stAwalBtn').addEventListener('click',()=>{
  if(!stData)return;
  const gd=stData.gudang.filter(stDicatat);
  if(!gd.length){alert('Belum ada gudang milik sendiri di List Gudang.');return}
  $('stAwalGudang').innerHTML=gd.map(g=>'<option value="'+g.id+'">'+esc(g.nama)+'</option>').join('');
  if($('stGudang').value)$('stAwalGudang').value=$('stGudang').value;
  stAwalIsi();put('stAwalMsg','');$('stAwalDlg').showModal();
});
$('stAwalGudang').addEventListener('change',stAwalIsi);
$('stAwalForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const g=Number($('stAwalGudang').value),b=$('stAwalSimpan');
  const rows=[...$('stAwalList').querySelectorAll('[data-produk]')].map(i=>({produk_id:Number(i.dataset.produk),qty:i.value===''?null:Number(i.value)}));
  if(rows.some(r=>r.qty!=null&&!(r.qty>=0))){put('stAwalMsg','Stok awal harus angka ≥ 0');return}
  b.disabled=true;put('stAwalMsg','');
  try{await api('/api/report/stok/awal',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({gudang_id:g,rows})});$('stAwalDlg').close();await loadStok()}
  catch(err){put('stAwalMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
['stAwalTutup','stAwalBatal'].forEach(id=>$(id).addEventListener('click',()=>$('stAwalDlg').close()));

// -- Opname: stok fisik → selisih terhadap stok sistem
let stOp=null;
function stOpPrev(){
  const f=$('stOpForm'),fisik=f.elements.fisik.value===''?null:Number(f.elements.fisik.value);
  const sel=fisik==null?null:fisik-stOp.stok;
  $('stOpPrev').innerHTML='<span>Selisih</span><b>'+(sel==null?'—':(sel>0?'+ ':sel<0?'− ':'')+int(Math.abs(sel))+' pcs')+'</b><small>'+(sel?'Stok sistem '+int(stOp.stok)+' → '+int(fisik):'Isi stok fisik hasil hitung')+'</small>';
}
$('stIsi').addEventListener('click',async e=>{
  const op=e.target.closest('[data-op]'),hp=e.target.closest('[data-hapus]');
  if(op){
    const [p,g]=op.dataset.op.split('|').map(Number);stOp=stData.stok.find(s=>s.produk.id===p&&s.gudang.id===g);if(!stOp)return;
    const f=$('stOpForm');f.reset();f.elements.tanggal.value=stData.hari_ini;f.elements.tanggal.max=stData.hari_ini;f.elements.tanggal.min=stData.mulai;
    put('stOpJ','Opname '+stOp.produk.nama);put('stOpInfo',stOp.gudang.nama+' · stok sistem saat ini '+int(stOp.stok)+' pcs');put('stOpMsg','');stOpPrev();
    $('stOpDlg').showModal();f.elements.fisik.focus();
  }
  if(hp){
    if(!confirm('Hapus catatan opname ini? Stok kembali seperti sebelum opname.'))return;
    hp.disabled=true;
    try{await api('/api/report/stok/mutasi/'+hp.dataset.hapus,{method:'DELETE'});await loadStok()}catch(err){hp.disabled=false;alert('Gagal menghapus: '+err.message)}
  }
});
$('stOpForm').addEventListener('input',stOpPrev);
$('stOpForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('stOpForm'),b=$('stOpSimpan'),fisik=Number(f.elements.fisik.value),sel=fisik-stOp.stok;
  if(!(fisik>=0)){put('stOpMsg','Stok fisik harus angka ≥ 0');return}
  if(!sel){put('stOpMsg','Stok fisik sama dengan stok sistem — tidak ada yang perlu disesuaikan');return}
  b.disabled=true;put('stOpMsg','');
  try{
    await api('/api/report/stok/opname',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({gudang_id:stOp.gudang.id,produk_id:stOp.produk.id,qty:sel,tanggal:f.elements.tanggal.value,catatan:f.elements.catatan.value.trim()})});
    $('stOpDlg').close();await loadStok();
  }catch(err){put('stOpMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
['stOpTutup','stOpBatal'].forEach(id=>$(id).addEventListener('click',()=>$('stOpDlg').close()));

$('stTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;stTab=b.dataset.tab;if(stData)stRenderTab()});
// Error data stok minus: tombol di peringatan membuka tabnya; "Isi stok awal" di baris membuka formulir untuk gudang baris itu
// Lead time & target hari aman untuk rekomendasi restock; nilai tidak masuk akal dikembalikan ke nilai terakhir yang sah
$('stLead').value=stLead;$('stTarget').value=stTarget;
['stLead','stTarget'].forEach(id=>$(id).addEventListener('change',()=>{
  const l=parseFloat($('stLead').value),t=parseFloat($('stTarget').value);
  if(l>=0&&t>0){stLead=l;stTarget=t;try{localStorage.setItem('stRestock',JSON.stringify({lead:l,target:t}))}catch(e){}}
  $('stLead').value=stLead;$('stTarget').value=stTarget;if(stData)stRenderTab();
}));
$('stFil').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!stData)return;stFil=b.dataset.fil;stRenderTab()});
$('stMinusLihat').addEventListener('click',()=>{if(!stData)return;stTab='minus';stRenderTab();$('stTab').scrollIntoView({behavior:'smooth',block:'start'})});
$('stIsi').addEventListener('click',e=>{const b=e.target.closest('[data-st-awal-g]');if(!b)return;$('stAwalBtn').click();
  const sel=$('stAwalGudang');if([...sel.options].some(o=>o.value===b.dataset.stAwalG)){sel.value=b.dataset.stAwalG;sel.dispatchEvent(new Event('change'))}});
$('stGudang').addEventListener('change',()=>{if(stData)renderStok()});
$('stCari').addEventListener('input',()=>{if(stData)stRenderTab()});
$('stExport').addEventListener('click',()=>{
  if(!stData)return;
  unduhCsv('stok-'+stData.hari_ini+'.csv',['Produk','Gudang','Stok awal','Masuk','Keluar','Retur baik','Opname','Stok sekarang','Keluar per hari (30 hari)','Cukup untuk (hari)','HPP','Nilai stok','Status','Rekomendasi restock (pcs)'],
    stSaring().map(s=>[s.produk.nama,s.gudang.nama,s.awal==null?'':s.awal,s.masuk,s.keluar,s.retur,s.opname,s.stok,Math.round(s.perHari*100)/100,s.hari==null?'':Math.floor(s.hari),s.produk.hpp,Math.round(s.nilai),stStatus(s)[0],(r=>r?(r.qty==null?'perlu dicek':r.qty):'')(stRestock(s))]));
});
