/**
 * Inventory › Inbound RTS: paket retur dikonfirmasi diterima gudang (baik / rusak) atau hilang, calon RTS dari follow up WA, tab kerugian RTS, ekspor CSV, badge menu.
 * Data: /api/report/inbound-rts, /inbound-rts/mulai. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*):
 * pecahPaket(), belumTag(), belumPesan(), belumDari(), resiPaket(), cocokResi(), shSync().
 * Dipanggil dari script utama: loadInRts() (menu Inbound RTS); dari mengantar-tracking.js: loadInRts() setelah follow up.
 */
// ---- Inventory › Inbound RTS: paket retur Mengantar dikonfirmasi diterima gudang (baik / rusak) atau ditandai hilang.
// Status Mengantar "RTS" = retur sudah sampai di pengirim → menunggu dikonfirmasi gudang; status RTS lain
// (mis. SHIPMENT RETURN) = retur masih di jalan. Retur sebelum tanggal mulai pencatatan dianggap sudah beres.
// Hanya yang diterima baik nantinya menambah stok.
let irData=null,irBusy=false,irTab='menunggu',irRugiPer='mulai',irRugiGrup='produk';
const irPilih=new Set();                 // resi yang dicentang untuk aksi massal
const IR_TELAT=14;                       // hari sejak RTS: belum diterima selewat ini → perlu dicek / diklaim ke kurir
const IR_KOND={baik:['Diterima baik','rev'],rusak:['Diterima rusak','warn'],hilang:['Hilang','loss']};
const IR_TAHAP={calon:'Calon RTS',menunggu:'Menunggu diterima',jalan:'Retur di perjalanan',selesai:'Sudah diproses',lama:'Sebelum pencatatan'};

async function loadInRts(){
  if(irBusy)return;irBusy=true;
  try{irSiapkan(await api('/api/report/inbound-rts'));renderInRts()}
  catch(e){$('irIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{irBusy=false}
}

/** Golongkan tiap retur: menunggu | jalan | selesai | lama, beserta umur sejak RTS */
function irSiapkan(d){
  pecahPaket(d);
  const now=Date.now();
  for(const x of d.rows){
    x.tglRts=ymd(new Date(x.rts_at));
    x.umur=Math.max(0,Math.floor((now-new Date(x.rts_at))/864e5));
    x.auto=!x.diterima_at&&x.kondisi!=='hilang'&&x.st==='LOST';   // hilang menurut Mengantar, belum diproses gudang
    x.kond=x.diterima_at?x.kondisi:x.kondisi==='hilang'||x.auto?'hilang':null;
    // Calon RTS: masih di jalan menurut Mengantar, tetapi pembeli menolak saat di-follow up WA → belum masuk kerugian
    x.tahap=x.kond?'selesai':x.st==='ON_GOING'?'calon':d.mulai&&x.tglRts<d.mulai?'lama':x.status==='RTS'?'menunggu':'jalan';
    x.telat=(x.tahap==='menunggu'||x.tahap==='jalan')&&x.umur>IR_TELAT;
    // Kerugian: ongkir yang dipotong saldo Mengantar (tarif bila belum dipotong) − refund klaim ongkir
    // + biaya gudang per paket + HPP barang rusak / hilang − kompensasi barang dari Mengantar
    x.ongkirEst=!x.potong_n;
    x.ongkir=x.potong_n?Number(x.potong)||0:Number(x.price)||0;
    x.klaim=Number(x.klaim)||0;x.kompensasi=Number(x.kompensasi)||0;
    x.biayaGudang=x.g?(x.g.biaya_penanganan||0)+(x.g.biaya_lain||0):0;
    const kr=x.kond||(x.tahap==='lama'?x.kondisi:null);
    x.hppRugi=kr==='rusak'||kr==='hilang'?x.hppKeluar:0;
    x.rugi=x.ongkir-x.klaim+x.biayaGudang+x.hppRugi-x.kompensasi;
  }
  irData=d;
  $('irMulai').value=d.mulai||'';
  const sel=$('irGudang'),v=sel.value;
  sel.innerHTML='<option value="">Semua gudang</option>'+d.gudang.map(g=>'<option value="'+g.id+'">'+esc(g.nama)+'</option>').join('')+'<option value="x">Gudang belum dipasangkan</option>';
  sel.value=[...sel.options].some(o=>o.value===v)?v:'';
  for(const r of [...irPilih])if(!d.rows.some(x=>x.receipt===r&&(x.tahap==='menunggu'||x.tahap==='jalan')))irPilih.delete(r);
  const n=d.rows.filter(x=>x.tahap==='menunggu').length;
  $('navRts').hidden=!n;$('navRts').textContent=n>99?'99+':String(n);
}

/** Retur sesuai filter gudang (dan pencarian bila cari = true) */
function irSaring(tahap,cari){
  const g=$('irGudang').value,q=cari?$('irCari').value.trim().toLowerCase():'';
  return irData.rows.filter(x=>(!tahap||x.tahap===tahap)&&(!g||(g==='x'?!x.g:x.g&&String(x.g.id)===g))&&
    (!q||cocokResi(x,q)||x.goods.toLowerCase().includes(q)));
}

const irIsiTeks=x=>x.belum?belumTag(x):esc(x.isi.map(i=>i.pcs+'× '+i.nama).join(' + '));
const irJumlah=(rows,k)=>rows.reduce((a,x)=>a+(Number(x[k])||0),0);

function renderInRts(){
  const d=irData,semua=irSaring(),per=t=>semua.filter(x=>x.tahap===t);
  const tunggu=per('menunggu'),jalan=per('jalan'),selesai=per('selesai'),lama=per('lama'),calon=per('calon');
  const baik=selesai.filter(x=>x.kond==='baik'),rugi=selesai.filter(x=>x.kond!=='baik'),dicatat=semua.filter(x=>x.tahap!=='lama'&&x.tahap!=='calon');
  put('irPeriod','Paket retur Mengantar & pesanan Shopee / TikTok retur dikonfirmasi diterima gudang · pencatatan sejak '+(d.mulai?tglWib(d.mulai+'T12:00:00Z'):'awal')+shSync(d));
  put('irK1',int(tunggu.length)+' paket');put('irK1D',int(irJumlah(tunggu,'pcs'))+' pcs · '+int(tunggu.filter(x=>x.telat).length)+' lewat '+IR_TELAT+' hari');
  put('irK2',int(jalan.length)+' paket');put('irK2D',int(irJumlah(jalan,'pcs'))+' pcs · '+int(jalan.filter(x=>x.telat).length)+' lewat '+IR_TELAT+' hari');
  put('irK3',int(irJumlah(baik,'pcs'))+' pcs');put('irK3D',int(baik.length)+' paket · siap kembali ke stok');
  put('irK4',rpFull(irJumlah(dicatat,'rugi')));put('irK4D',int(dicatat.length)+' retur sejak pencatatan · '+int(irJumlah(rugi,'pcs'))+' pcs rusak/hilang · rincian di tab Kerugian RTS');
  const w=[],telat=semua.filter(x=>x.telat),belum=dicatat.filter(x=>x.belum&&x.tahap!=='selesai');
  if(telat.length)w.push(int(telat.length)+' retur sudah lebih dari '+IR_TELAT+' hari sejak RTS tetapi belum diterima gudang — cek ke kurir atau ajukan klaim.');
  if(calon.length)w.push(int(calon.length)+' paket ditolak pembeli saat di-follow up WA dan kemungkinan akan RTS ('+int(irJumlah(calon,'pcs'))+' pcs) — lihat tab <b>Calon RTS</b>.');
  if(belum.length)w.push(...belumPesan(belumDari(belum),'jadi pcs retur-nya belum terhitung'));
  $('irWarn').hidden=!w.length;$('irWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  [['irTabN1',tunggu],['irTabN2',jalan],['irTabN3',selesai],['irTabN4',lama],['irTabN5',calon]].forEach(([id,r])=>put(id,r.length?String(r.length):''));
  irRenderTab();
}

function irRenderTab(){
  const rows=irSaring(irTab,true),kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Tidak ada retur pada tab / filter ini.</td></tr>';
  $('irTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===irTab));
  const tombol=(x,daftar)=>x.receipt?'<span class="ir-aksi" data-resi="'+esc(x.receipt)+'">'+daftar.map(a=>'<button class="ir-'+a+'" data-ak="'+a+'">'+
    {baik:'Baik',rusak:'Rusak',hilang:'Hilang',batal:'Batalkan'}[a]+'</button>').join('')+'</span>':'<span style="color:var(--muted)">tanpa resi</span>';
  const resiTd=x=>'<td class="sd-resi">'+resiPaket(x)+'<small class="mm-sub">'+esc(x.courier||'')+(x.status&&x.status!=='RTS'?' · '+esc(x.status):'')+'</small>'+
    (x.fu_status==='menolak'&&x.tahap!=='calon'?'<small class="mm-sub"><span class="tag warn">Ditolak pembeli</span></small>':'')+'</td>';
  const gdTd=x=>'<td>'+(x.g?esc(x.g.nama):'<span style="color:var(--muted)">'+esc(x.shipper)+'</span>')+'</td>';
  const brgTd=x=>'<td class="sh">'+esc(x.goods)+'<small class="mm-sub">'+irIsiTeks(x)+'</small></td>';
  if(irTab==='calon'){
    put('irSub','Paket yang hasil follow up WA-nya "Menolak" di Tracking & Masalah tetapi masih di jalan menurut Mengantar — siapkan penerimaan returnya. Pindah otomatis ke Retur di perjalanan / Menunggu diterima saat Mengantar mengubah status ke RTS, dan hilang dari sini bila follow up diubah.');
    $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Ditolak</th><th>Resi</th><th>Gudang</th><th>Barang</th><th>Penerima</th><th>Catatan follow up</th><th class="n">Nilai COD</th><th class="n">Ongkir</th></tr></thead><tbody>'+
      (rows.slice().sort((a,b)=>String(b.fu_at||'').localeCompare(String(a.fu_at||''))).map(x=>'<tr><td>'+(x.fu_at?tglWib(x.fu_at,true):'—')+'</td>'+resiTd(x)+gdTd(x)+brgTd(x)+
        '<td>'+esc(x.receiver_name||'—')+'<small class="mm-sub">'+esc(x.receiver_city||'')+(x.cs?' · '+esc(x.cs):'')+'</small></td>'+
        '<td class="ket">'+(x.fu_note?esc(x.fu_note):'<span style="color:var(--muted)">—</span>')+'</td>'+
        '<td class="n">'+(x.is_cod?rpFull(x.cod_amount):'<span style="color:var(--muted)">non-COD</span>')+'</td><td class="n">'+rpFull(x.price)+'</td></tr>').join('')||kosong(8))+'</tbody></table>';
  }else if(irTab==='menunggu'||irTab==='jalan'){
    const semuaDipilih=rows.length&&rows.every(x=>!x.receipt||irPilih.has(x.receipt)),n=rows.filter(x=>irPilih.has(x.receipt)).length;
    $('irSub').innerHTML=(irTab==='menunggu'?'Retur sudah sampai di pengirim menurut Mengantar — cek fisik barang lalu konfirmasi kondisinya':'Retur masih di jalan kembali ke pengirim — bisa langsung dikonfirmasi bila barang sudah tiba lebih dulu')+
      ' <span class="ob-mini"><button data-massal="baik"'+(n?'':' disabled')+'>Terima baik ('+int(n)+')</button></span>';
    $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th class="ir-cek"><input type="checkbox" id="irSemua" aria-label="Pilih semua"'+(semuaDipilih&&rows.length?' checked':'')+'></th><th>Tanggal RTS</th><th>Resi</th><th>Gudang</th><th>Barang</th><th class="n">Ongkir</th><th class="n">Konfirmasi</th></tr></thead><tbody>'+
      (rows.map(x=>'<tr><td class="ir-cek">'+(x.receipt?'<input type="checkbox" data-pilih="'+esc(x.receipt)+'"'+(irPilih.has(x.receipt)?' checked':'')+' aria-label="Pilih '+esc(x.receipt)+'">':'')+'</td>'+
        '<td>'+tglWib(x.rts_at)+'<small class="mm-sub">'+(x.telat?'<span class="tag loss">'+int(x.umur)+' hari</span>':int(x.umur)+' hari lalu')+'</small></td>'+
        resiTd(x)+gdTd(x)+brgTd(x)+'<td class="n">'+rpFull(x.price)+'</td><td class="n">'+tombol(x,['baik','rusak'])+'</td></tr>').join('')||kosong(7))+'</tbody></table>';
  }else if(irTab==='selesai'){
    put('irSub','Retur yang sudah dikonfirmasi gudang atau hilang · "Batalkan" mengembalikan retur ke daftar menunggu');
    $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Diproses</th><th>Resi</th><th>Gudang</th><th>Barang</th><th>Kondisi</th><th>Catatan</th><th class="n">HPP</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (rows.sort((a,b)=>String(b.diterima_at||b.rts_at).localeCompare(String(a.diterima_at||a.rts_at))).map(x=>{const k=IR_KOND[x.kond];
        return '<tr><td>'+(x.diterima_at?tglWib(x.diterima_at,true)+'<small class="mm-sub">'+esc(x.diterima_oleh||'')+'</small>':'<span style="color:var(--muted)">—</span><small class="mm-sub">RTS '+tglWib(x.rts_at)+'</small>')+'</td>'+
          resiTd(x)+gdTd(x)+brgTd(x)+'<td><span class="tag '+k[1]+'">'+k[0]+'</span>'+(x.auto?'<small class="mm-sub">PARCEL LOST di Mengantar</small>':'')+'</td>'+
          '<td class="ket">'+(x.catatan?esc(x.catatan):'<span style="color:var(--muted)">—</span>')+'</td><td class="n">'+(x.belum?'<span style="color:var(--muted)">—</span>':rpFull(x.hppKeluar))+'</td>'+
          '<td class="n">'+irKlaim(x)+(x.auto?'':tombol(x,['batal']))+'</td></tr>'}).join('')||kosong(8))+'</tbody></table>';
  }else if(irTab==='rugi'){
    irRenderRugi();
  }else{
    put('irSub','Retur dengan tanggal RTS sebelum tanggal mulai pencatatan — dianggap sudah beres (kembali baik), tetap bisa dikonfirmasi bila perlu');
    $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Tanggal RTS</th><th>Resi</th><th>Gudang</th><th>Barang</th><th>Kondisi</th><th class="n">Konfirmasi</th></tr></thead><tbody>'+
      (rows.map(x=>'<tr><td>'+tglWib(x.rts_at)+'</td>'+resiTd(x)+gdTd(x)+brgTd(x)+
        '<td>'+(x.kondisi?'<span class="tag '+IR_KOND[x.kondisi][1]+'">'+IR_KOND[x.kondisi][0].replace('Diterima ','')+'</span>':'<span style="color:var(--muted)">dianggap baik</span>')+'</td>'+
        '<td class="n">'+tombol(x,['baik','rusak'])+'</td></tr>').join('')||kosong(6))+'</tbody></table>';
  }
}

// -- Tab Kerugian RTS: per produk / gudang / kurir / kota / resi, menurut tanggal RTS
const IR_RPER={mulai:'Sejak pencatatan',bulan:'Bulan ini','30':'30 hari',semua:'Semua'};
const IR_RGRUP={produk:'Per produk',gudang:'Per gudang',kurir:'Per kurir',kota:'Per kota',resi:'Per resi'};
function irRugiRows(){
  const t=ymd(new Date()),dari={mulai:irData.mulai||'',bulan:t.slice(0,8)+'01','30':shift(t,-29),semua:''}[irRugiPer];
  return irSaring(null,true).filter(x=>x.tahap!=='calon'&&(!dari||x.tglRts>=dari));
}
/**
 * Kelompokkan kerugian. Per produk: HPP rusak/hilang per produk persis; ongkir, klaim, biaya gudang, dan kompensasi
 * paket dibagi ke produk di dalamnya menurut porsi pcs.
 */
function irKelompok(rows,grup){
  const m=new Map();
  const tambah=(k,nama,x,porsi,hpp,pcs)=>{
    const t=m.get(k)||{nama,paket:new Set(),pcs:0,ongkir:0,klaim:0,gudang:0,hpp:0,komp:0,est:0};
    t.paket.add(x);t.pcs+=pcs;t.ongkir+=x.ongkir*porsi;t.klaim+=x.klaim*porsi;t.gudang+=x.biayaGudang*porsi;
    t.hpp+=hpp;t.komp+=x.kompensasi*porsi;if(x.ongkirEst)t.est++;m.set(k,t);
  };
  for(const x of rows){
    if(grup==='produk'){
      if(x.belum){tambah('x','Barang belum dipasangkan',x,1,0,0);continue}
      for(const i of x.isi)tambah(i.key,i.nama,x,x.pcs?i.pcs/x.pcs:1/x.isi.length,x.hppRugi?i.pcs*i.hpp:0,i.pcs);
    }else{
      const [k,n]=grup==='gudang'?[x.g?'g'+x.g.id:'s:'+x.shipper,x.g?x.g.nama:x.shipper+' (belum dipasangkan)']
        :grup==='kurir'?[x.courier||'-',x.courier||'(tanpa kurir)']:[String(x.receiver_city||'-').toUpperCase(),x.receiver_city||'(tanpa kota)'];
      tambah(k,n,x,1,x.hppRugi,x.pcs);
    }
  }
  return [...m.values()].map(t=>Object.assign(t,{total:t.ongkir-t.klaim+t.gudang+t.hpp-t.komp})).sort((a,b)=>b.total-a.total);
}
function irRenderRugi(){
  const rows=irRugiRows(),mini=(attr,pilihan,aktif)=>'<span class="ob-mini">'+Object.entries(pilihan).map(([k,l])=>'<button '+attr+'="'+k+'"'+(k===aktif?' class="on"':'')+'>'+l+'</button>').join('')+'</span>';
  const est=rows.filter(x=>x.ongkirEst).length;
  $('irSub').innerHTML=mini('data-rper',IR_RPER,irRugiPer)+mini('data-rgrup',IR_RGRUP,irRugiGrup)+
    ' Kerugian = ongkir dipotong Mengantar − refund klaim + biaya gudang + HPP rusak/hilang − kompensasi'+
    (est?' · <b>'+int(est)+' paket belum dipotong di saldo Mengantar — ongkirnya memakai tarif (perkiraan)</b>':'');
  const sel=(v,neg)=>v?(neg?'− ':'')+rpFull(v):'<span style="color:var(--muted)">—</span>';
  const jml=k=>rows.reduce((a,x)=>a+x[k],0),tot={ongkir:jml('ongkir'),klaim:jml('klaim'),gudang:jml('biayaGudang'),hpp:jml('hppRugi'),komp:jml('kompensasi'),total:jml('rugi')};
  const kaki='<tr class="ir-total"><td>Total</td>'+(irRugiGrup==='resi'?'<td></td><td></td>':'<td class="n">'+int(rows.length)+'</td><td class="n">'+int(jml('pcs'))+'</td>')+
    '<td class="n">'+rpFull(tot.ongkir)+'</td><td class="n">'+sel(tot.klaim,1)+'</td><td class="n">'+sel(tot.gudang)+'</td><td class="n">'+sel(tot.hpp)+'</td><td class="n">'+sel(tot.komp,1)+'</td><td class="n"><b>'+rpFull(tot.total)+'</b></td>'+
    '<td class="n">'+(rows.length?rpFull(tot.total/rows.length):'—')+'</td></tr>';
  const biaya=(o,est)=>'<td class="n">'+rpFull(o.ongkir)+(est?'<small>'+(est===true?'tarif':int(est)+' tarif')+'</small>':'')+'</td><td class="n">'+sel(o.klaim,1)+'</td><td class="n">'+sel(o.gudang)+'</td><td class="n">'+sel(o.hpp)+'</td><td class="n">'+sel(o.komp,1)+'</td><td class="n"><b>'+rpFull(o.total)+'</b></td>';
  const kepala='<th class="n">Ongkir RTS</th><th class="n">Refund klaim</th><th class="n">Biaya gudang</th><th class="n">HPP rusak/hilang</th><th class="n">Kompensasi</th><th class="n">Kerugian</th><th class="n">Per paket</th>';
  if(irRugiGrup==='resi'){
    $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Resi</th><th>Barang</th><th>Kondisi</th>'+kepala+'</tr></thead><tbody>'+
      (rows.slice().sort((a,b)=>b.rugi-a.rugi).map(x=>{const kr=x.kond||(x.tahap==='lama'?x.kondisi:null);
        return '<tr><td class="sd-resi">'+resiPaket(x)+'<small class="mm-sub">RTS '+tglWib(x.rts_at)+' · '+esc(x.courier||'')+'</small></td><td class="sh">'+esc(x.goods)+'<small class="mm-sub">'+irIsiTeks(x)+'</small></td>'+
          '<td>'+(kr?'<span class="tag '+IR_KOND[kr][1]+'">'+IR_KOND[kr][0].replace('Diterima ','')+'</span>':'<span style="color:var(--muted)">'+IR_TAHAP[x.tahap]+'</span>')+'</td>'+
          biaya({ongkir:x.ongkir,klaim:x.klaim,gudang:x.biayaGudang,hpp:x.hppRugi,komp:x.kompensasi,total:x.rugi},x.ongkirEst)+'<td class="n"></td></tr>'}).join('')||
        '<tr><td colspan="10" style="color:var(--muted)">Tidak ada retur pada periode / filter ini.</td></tr>')+'</tbody><tfoot>'+kaki+'</tfoot></table>';
    return;
  }
  const g=irKelompok(rows,irRugiGrup);
  $('irIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>'+{produk:'Produk',gudang:'Gudang',kurir:'Kurir',kota:'Kota penerima'}[irRugiGrup]+'</th><th class="n">Paket RTS</th><th class="n">Pcs</th>'+kepala+'</tr></thead><tbody>'+
    (g.map(t=>'<tr><td class="nm">'+esc(t.nama)+'</td><td class="n">'+int(t.paket.size)+'</td><td class="n">'+int(t.pcs)+'</td>'+biaya(t,t.est)+'<td class="n">'+rpFull(t.total/t.paket.size)+'</td></tr>').join('')||
      '<tr><td colspan="10" style="color:var(--muted)">Tidak ada retur pada periode / filter ini.</td></tr>')+'</tbody><tfoot>'+kaki+'</tfoot></table>';
}

/** Paket hilang: status klaim (kompensasi barang dari Mengantar / ekspedisi di saldo Mengantar) */
const irKlaim=x=>x.kond!=='hilang'?'':x.kompensasi>0
  ?'<span class="tag rev" title="Compensation for order di saldo Mengantar">Klaim diterima '+rpFull(x.kompensasi)+'</span>'
  :'<span class="tag warn">Belum dapat klaim</span>';
/** Simpan konfirmasi untuk satu / banyak resi lalu perbarui data lokal */
async function irAksi(resi,aksi){
  let catatan='';
  if(aksi==='rusak'||aksi==='hilang'){
    const c=prompt('Catatan '+(aksi==='rusak'?'kerusakan':'kehilangan')+(resi.length>1?' ('+resi.length+' resi)':'')+' — opsional:','');
    if(c===null)return;catatan=c.trim();
  }
  if(aksi==='batal'&&!confirm('Batalkan konfirmasi resi '+resi.join(', ')+'? Retur kembali ke daftar sebelumnya.'))return;
  const h=await api('/api/report/inbound-rts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipts:resi,aksi,catatan})});
  for(const x of irData.rows)if(resi.includes(x.receipt)){
    if(aksi==='batal'){x.kondisi=x.catatan=x.diterima_at=x.diterima_oleh=null}
    else{x.kondisi=aksi;if(catatan)x.catatan=catatan;x.diterima_at=h.diterima_at;x.diterima_oleh=h.diterima_at?h.oleh:null}
  }
  resi.forEach(r=>irPilih.delete(r));
  irSiapkan(irData);renderInRts();
}

$('irTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;irTab=b.dataset.tab;$('irCari').value='';if(irData)irRenderTab()});
$('irCari').addEventListener('input',()=>{if(irData)irRenderTab()});
$('irGudang').addEventListener('change',()=>{if(irData)renderInRts()});
$('irMulai').addEventListener('change',async()=>{
  const v=$('irMulai').value;if(!v||!irData)return;
  try{await api('/api/report/inbound-rts/mulai',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mulai:v})});irData.mulai=v;irSiapkan(irData);renderInRts()}
  catch(e){alert('Gagal menyimpan tanggal: '+e.message);$('irMulai').value=irData.mulai||''}
});
$('irIsi').addEventListener('change',e=>{
  if(e.target.id==='irSemua'){for(const x of irSaring(irTab,true))if(x.receipt)e.target.checked?irPilih.add(x.receipt):irPilih.delete(x.receipt);irRenderTab();return}
  const c=e.target.closest('[data-pilih]');if(!c)return;
  c.checked?irPilih.add(c.dataset.pilih):irPilih.delete(c.dataset.pilih);irRenderTab();
});
$('irIsi').addEventListener('click',async e=>{
  const b=e.target.closest('[data-ak]');if(!b)return;
  const box=b.closest('[data-resi]');box.querySelectorAll('button').forEach(x=>x.disabled=true);
  try{await irAksi([box.dataset.resi],b.dataset.ak)}catch(err){alert('Gagal menyimpan: '+err.message)}
  box.querySelectorAll('button').forEach(x=>x.disabled=false);
});
$('irSub').addEventListener('click',async e=>{
  const p=e.target.closest('[data-rper]'),g=e.target.closest('[data-rgrup]');
  if(p||g){if(p)irRugiPer=p.dataset.rper;if(g)irRugiGrup=g.dataset.rgrup;irRenderRugi();return}
  const b=e.target.closest('[data-massal]');if(!b)return;
  const resi=irSaring(irTab,true).map(x=>x.receipt).filter(r=>r&&irPilih.has(r));if(!resi.length)return;
  if(!confirm('Konfirmasi '+resi.length+' retur diterima dalam kondisi baik?'))return;
  b.disabled=true;
  try{await irAksi(resi,'baik')}catch(err){b.disabled=false;alert('Gagal menyimpan: '+err.message)}
});
$('irExport').addEventListener('click',()=>{
  if(!irData)return;
  if(irTab==='rugi'&&irRugiGrup!=='resi')return unduhCsv('kerugian-rts-'+irRugiGrup+'.csv',[{produk:'Produk',gudang:'Gudang',kurir:'Kurir',kota:'Kota penerima'}[irRugiGrup],'Paket RTS','Pcs','Ongkir RTS','Refund klaim','Biaya gudang','HPP rusak/hilang','Kompensasi','Kerugian','Paket ongkir tarif'],
    irKelompok(irRugiRows(),irRugiGrup).map(t=>[t.nama,t.paket.size,t.pcs,Math.round(t.ongkir),Math.round(t.klaim),Math.round(t.gudang),Math.round(t.hpp),Math.round(t.komp),Math.round(t.total),t.est]));
  unduhCsv('inbound-rts.csv',['Tanggal RTS','Resi','Kurir','Status Mengantar','Gudang','Kota penerima','Nama barang','Isi','Pcs','Tahap','Kondisi','Catatan','Diterima','Oleh',
    'Ongkir RTS','Ongkir dari','Refund klaim ongkir','Biaya gudang','HPP rusak/hilang','Kompensasi','Kerugian'],
    (irTab==='rugi'?irRugiRows():irSaring()).map(x=>[x.rts_at,x.receipt||'',x.courier||'',x.status||'',x.g?x.g.nama:x.shipper,x.receiver_city||'',x.goods,x.isi.map(i=>i.pcs+'x '+i.nama).join(' + '),x.pcs,
      IR_TAHAP[x.tahap],x.kond?IR_KOND[x.kond][0]:'',x.catatan||'',x.diterima_at||'',x.diterima_oleh||'',
      Math.round(x.ongkir),x.ongkirEst?'tarif':'saldo Mengantar',Math.round(x.klaim),Math.round(x.biayaGudang),Math.round(x.hppRugi),Math.round(x.kompensasi),Math.round(x.rugi)]));
});

loadInRts();                              // isi badge "menunggu diterima" di menu Inbound RTS
