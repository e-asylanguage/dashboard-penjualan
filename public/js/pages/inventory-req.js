/**
 * Inventory › Inbound REQ: permintaan barang ke supplier, penerimaan bertahap + HPP rata-rata tertimbang, pembayaran, berkas pengiriman (baca barcode resi), ekspor CSV.
 * Data: /api/settings/req (+ /:id/status, /terima, /bayar, /berkas), /api/report/stok. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta stHitung() & SKU_IKON_EDIT dari script utama (window.*).
 * Dipanggil dari script utama: loadReq() (menu Inbound REQ), rqLanded() (Nilai Persediaan). Saat dimuat: loadReq() mengisi badge menu.
 */
// ---- Inventory › Inbound REQ: permintaan barang ke supplier → dikirim → diterima gudang (bisa bertahap) → selesai.
// Qty diterima baik menambah stok gudang tujuan (Inventory › Stok). Saat menerima, HPP List Produk bisa diperbarui
// dengan rata-rata tertimbang: (stok × HPP lama + qty baik × harga beli per pcs termasuk ongkir) ÷ (stok + qty baik).
let rqData=null,rqBusy=false,rqTab='buka',rqEdit=null,rqItems=[],rqStok=null;
const RQ_ST={draft:['Draft',''],dikirim:['Dikirim','info'],sebagian:['Diterima sebagian','warn'],selesai:['Selesai','rev'],batal:['Batal','loss']};
const RQ_BAYAR={lunas:['Lunas','rev'],sebagian:['Dibayar sebagian','warn'],belum:['Belum dibayar','loss'],kosong:['Belum ada tagihan','']};
const rqTag=([l,k])=>'<span class="tag '+k+'">'+l+'</span>';
const rqTgl=t=>t?tglWib(t+'T12:00:00Z'):'—';

async function loadReq(){
  if(rqBusy)return;rqBusy=true;
  try{rqSiapkan(await api('/api/settings/req'));renderReq()}
  catch(e){$('rqIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{rqBusy=false}
}

/** Ringkasan per REQ: diterima per produk, sisa, tagihan, dibayar, status bayar, terlambat */
function rqSiapkan(d){
  const prd=new Map(d.produk.map(p=>[p.id,p])),gd=new Map(d.gudang.map(g=>[g.id,g]));
  for(const r of d.rows){
    r.g=gd.get(r.gudang_id)||{nama:'?'};
    for(const i of r.items){
      const t=r.terima.filter(x=>x.item_id===i.id);
      i.nama=(prd.get(i.produk_id)||{}).nama||'?';
      i.baik=t.reduce((a,x)=>a+x.qty_baik,0);i.rusak=t.reduce((a,x)=>a+x.qty_rusak,0);
      i.sisa=Math.max(0,i.qty-i.baik-i.rusak);
    }
    const jml=k=>r.items.reduce((a,i)=>a+i[k],0);
    r.pcsMinta=jml('qty');r.pcsBaik=jml('baik');r.pcsRusak=jml('rusak');r.pcsSisa=['dikirim','sebagian','draft'].includes(r.status)?jml('sisa'):0;
    r.nilaiPesanan=r.items.reduce((a,i)=>a+i.harga*i.qty,0);
    r.tagihanAuto=r.items.reduce((a,i)=>a+i.harga*(i.baik+i.rusak),0);
    r.tagihanNilai=r.tagihan!=null?r.tagihan:r.tagihanAuto;
    r.dibayar=r.bayar.reduce((a,b)=>a+b.jumlah,0);
    r.sisaBayar=r.status==='batal'?0:Math.max(0,r.tagihanNilai-r.dibayar);
    r.stBayar=r.tagihanNilai<=0?(r.dibayar>0?'lunas':'kosong'):r.dibayar>=r.tagihanNilai?'lunas':r.dibayar>0?'sebagian':'belum';
    r.terbuka=['draft','dikirim','sebagian'].includes(r.status);
    r.terlambat=(r.status==='dikirim'||r.status==='sebagian')&&!!r.eta&&r.eta<d.hari_ini;
  }
  rqData=d;
  const sel=$('rqGudang'),v=sel.value;
  sel.innerHTML='<option value="">Semua gudang</option>'+d.gudang.filter(g=>g.jenis!=='dropship').map(g=>'<option value="'+g.id+'">'+esc(g.nama)+'</option>').join('');
  sel.value=[...sel.options].some(o=>o.value===v)?v:'';
  const n=d.rows.filter(r=>r.terlambat).length;
  $('navReq').hidden=!n;$('navReq').textContent=String(n);
}

function rqSaring(tab){
  const g=$('rqGudang').value,b=$('rqBayarF').value,q=$('rqCari').value.trim().toLowerCase();
  return rqData.rows.filter(r=>(tab==null||!tab||(tab==='buka'?r.terbuka:r.status===tab))&&(!g||String(r.gudang_id)===g)&&
    (!b||(b==='lunas'?r.stBayar==='lunas':['belum','sebagian'].includes(r.stBayar)))&&
    (!q||(r.nomor+' '+r.supplier+' '+r.items.map(i=>i.nama).join(' ')).toLowerCase().includes(q)));
}

function renderReq(){
  const d=rqData,semua=rqSaring(null),bulan=d.hari_ini.slice(0,7);
  put('rqPeriod','Permintaan barang ke supplier · barang diterima baik menambah stok gudang tujuan sejak '+rqTgl(d.stok_mulai));
  const buka=semua.filter(r=>r.terbuka),telat=semua.filter(r=>r.terlambat);
  put('rqK1',int(buka.length));put('rqK1D',int(buka.reduce((a,r)=>a+r.pcsSisa,0))+' pcs belum datang · '+int(buka.filter(r=>r.status==='draft').length)+' masih draft');
  put('rqK2',int(telat.length));put('rqK2D',telat.length?'cek ke supplier: '+telat.slice(0,2).map(r=>r.nomor).join(', ')+(telat.length>2?' …':''):'semua masih sesuai jadwal');
  let beli=0,pcs=0;
  for(const r of semua)for(const t of r.terima)if(t.tanggal.slice(0,7)===bulan){const i=r.items.find(x=>x.id===t.item_id);if(i){beli+=i.harga*(t.qty_baik+t.qty_rusak);pcs+=t.qty_baik+t.qty_rusak}}
  put('rqK3',rpFull(beli));put('rqK3D',int(pcs)+' pcs diterima bulan ini (harga beli, tanpa ongkir)');
  const utang=semua.filter(r=>r.sisaBayar>0);
  put('rqK4',rpFull(utang.reduce((a,r)=>a+r.sisaBayar,0)));put('rqK4D',int(utang.length)+' REQ belum lunas');
  [['rqTabN1',semua.filter(r=>r.terbuka)],['rqTabN2',semua.filter(r=>r.status==='selesai')],['rqTabN3',semua.filter(r=>r.status==='batal')]].forEach(([id,x])=>put(id,x.length?String(x.length):''));
  rqRenderTab();
}

function rqRenderTab(){
  $('rqTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===rqTab));
  const rows=rqSaring(rqTab),mut='<span style="color:var(--muted)">—</span>';
  $('rqIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Nomor</th><th>Supplier</th><th>Gudang</th><th>Produk</th><th class="n">Diterima</th><th>Perkiraan tiba</th><th class="n">Nilai</th><th>Pembayaran</th><th>Status</th><th class="n">Aksi</th></tr></thead><tbody>'+
    (rows.map(r=>'<tr><td class="nm">'+esc(r.nomor)+'<small>'+rqTgl(r.tanggal)+'</small></td><td>'+esc(r.supplier)+(r.kontak?'<small class="mm-sub">'+esc(r.kontak)+'</small>':'')+'</td><td>'+esc(r.g.nama)+'</td>'+
      '<td class="sh">'+esc(r.items.map(i=>i.qty+'× '+i.nama).join(', '))+'</td>'+
      '<td class="n">'+int(r.pcsBaik)+' / '+int(r.pcsMinta)+(r.pcsRusak?'<small>'+int(r.pcsRusak)+' rusak</small>':'')+'</td>'+
      '<td>'+(r.eta?rqTgl(r.eta):mut)+(r.terlambat?' <span class="tag loss">Lewat</span>':'')+(r.resi?'<small class="mm-sub">'+esc(r.resi)+'</small>':'')+'</td>'+
      '<td class="n">'+rpFull(r.tagihanNilai||r.nilaiPesanan)+'<small>'+(r.tagihanNilai?'tagihan':'nilai pesanan')+'</small></td>'+
      '<td>'+(r.status==='batal'?mut:rqTag(RQ_BAYAR[r.stBayar])+(r.sisaBayar?'<small class="mm-sub">sisa '+rpFull(r.sisaBayar)+'</small>':''))+'</td>'+
      '<td>'+rqTag(RQ_ST[r.status])+'</td>'+
      '<td class="n"><span class="ak"><button class="ed" data-rq="'+r.id+'" title="Buka" aria-label="Buka '+esc(r.nomor)+'">'+SKU_IKON_EDIT+'</button></span></td></tr>').join('')||
      '<tr><td colspan="10" style="color:var(--muted)">'+(rqData.rows.length?'Tidak ada REQ pada tab / filter ini.':'Belum ada REQ. Klik "Buat REQ".')+'</td></tr>')+'</tbody></table>';
}

// -- Dialog REQ: header, produk, status, penerimaan, pembayaran
const rqBolehUbah=()=>!rqEdit||!['batal','selesai'].includes(rqEdit.status);
const rqAdaTerima=()=>!!(rqEdit&&rqEdit.terima.length);
function rqItemsRender(){
  const ubah=rqBolehUbah(),kunci=rqAdaTerima(),info=rqEdit&&rqEdit.status!=='draft';
  $('rqItemHead').innerHTML='<tr><th>Produk</th><th class="n">Qty diminta</th><th class="n">Harga / pcs</th><th class="n">Subtotal</th>'+(info?'<th class="n">Baik</th><th class="n">Rusak</th><th class="n">Sisa</th>':'')+'<th></th></tr>';
  const opsi=id=>'<option value="">— Pilih produk —</option>'+rqData.produk.map(p=>'<option value="'+p.id+'"'+(p.id===id?' selected':'')+'>'+esc(p.nama)+'</option>').join('');
  $('rqItems').innerHTML=rqItems.map((i,n)=>'<tr data-n="'+n+'"><td><select class="gd-pilih rq-prd" aria-label="Produk"'+(kunci||!ubah?' disabled':'')+'>'+opsi(i.produk_id)+'</select></td>'+
    '<td class="n"><input class="ob-qty rq-qty" type="number" min="1" step="1" value="'+(i.qty||'')+'" aria-label="Qty diminta"'+(ubah?'':' disabled')+'></td>'+
    '<td class="n"><input class="ob-qty rq-harga" type="number" min="0" step="1" value="'+(i.harga==null?'':i.harga)+'" aria-label="Harga per pcs"'+(ubah?'':' disabled')+'></td>'+
    '<td class="n">'+rpFull((i.qty||0)*(i.harga||0))+'</td>'+
    (info?'<td class="n">'+int(i.baik||0)+'</td><td class="n">'+int(i.rusak||0)+'</td><td class="n">'+int(i.sisa==null?i.qty:i.sisa)+'</td>':'')+
    '<td class="n">'+(kunci||!ubah?'':'<button type="button" class="rq-hapus-i" aria-label="Hapus baris">×</button>')+'</td></tr>').join('');
  const nilai=rqItems.reduce((a,i)=>a+(i.qty||0)*(i.harga||0),0),ongkir=Number($('rqForm').elements.ongkir.value)||0,kol=info?7:4;
  $('rqItemFoot').innerHTML='<tr class="ir-total"><td colspan="3">Nilai pesanan</td><td class="n">'+rpFull(nilai)+'</td>'+(info?'<td colspan="3"></td>':'')+'<td></td></tr>'+
    (ongkir?'<tr><td colspan="3" style="color:var(--muted)">+ ongkir masuk (dibagi ke HPP)</td><td class="n">'+rpFull(ongkir)+'</td><td colspan="'+(kol-3)+'"></td></tr>':'');
  $('rqItemTambah').hidden=kunci||!ubah;
  put('rqItemInfo',kunci?'Sudah ada penerimaan — produk tidak bisa diganti, qty & harga masih bisa dikoreksi':'Harga beli per pcs dipakai untuk HPP & tagihan');
  $('rqTagihan').placeholder='otomatis: '+rpFull(rqEdit?rqEdit.tagihanAuto:0);
}
function rqStatusRender(){
  const r=rqEdit,bar=$('rqStatusBar');
  if(!r){bar.innerHTML='<span class="tag">Baru</span><small>Simpan sebagai draft dulu, lalu tandai dikirim saat supplier mengirim barang</small>';return}
  const t=!!r.terima.length,b=!!r.bayar.length,tombol=[];
  if(r.status==='draft')tombol.push(['dikirim','Tandai dikirim','primary']);
  if(r.status==='dikirim'||r.status==='sebagian')tombol.push(['terima','Terima barang','primary']);
  if(r.status==='sebagian')tombol.push(['selesai','Tutup sisa (selesai)','ghost']);
  if(r.status==='dikirim'&&!t)tombol.push(['draft','Kembali ke draft','ghost']);
  if(r.status==='selesai'||r.status==='batal')tombol.push(['buka','Buka lagi','ghost']);
  if(!t&&r.status!=='batal')tombol.push(['batal','Batalkan REQ','ghost']);
  if((r.status==='draft'||r.status==='batal')&&!t&&!b)tombol.push(['hapus','Hapus','ghost']);
  bar.innerHTML=rqTag(RQ_ST[r.status])+(r.terlambat?'<span class="tag loss">Lewat perkiraan tiba</span>':'')+
    '<small>Dibuat '+esc(r.oleh||'')+' · '+rqTgl(r.tanggal)+'</small><span class="rq-st-aksi">'+tombol.map(([k,l,c])=>'<button type="button" class="btn '+c+'" data-st="'+k+'">'+l+'</button>').join('')+'</span>';
}
function rqRiwRender(){
  const r=rqEdit,box=$('rqRiwBox');box.hidden=!r||!r.terima.length;if(box.hidden)return;
  const batch=new Map();for(const t of r.terima)batch.set(t.batch,[...(batch.get(t.batch)||[]),t]);
  $('rqRiw').innerHTML=[...batch].map(([k,ts])=>'<div class="rq-riw-r"><div><b>'+rqTgl(ts[0].tanggal)+'</b><small>'+esc(ts[0].oleh||'')+(ts[0].catatan?' · '+esc(ts[0].catatan):'')+'</small></div>'+
    '<div class="sh">'+ts.map(t=>{const i=r.items.find(x=>x.id===t.item_id)||{nama:'?'};return esc(i.nama)+': '+int(t.qty_baik)+' baik'+(t.qty_rusak?', '+int(t.qty_rusak)+' rusak':'')}).join(' · ')+'</div>'+
    '<span class="ir-aksi"><button type="button" class="ir-batal" data-batch="'+esc(k)+'">Batalkan</button></span></div>').join('');
}
function rqBayarRender(){
  const r=rqEdit,box=$('rqBayarBox');box.hidden=!r||r.status==='batal';if(box.hidden)return;
  put('rqBayarInfo','Tagihan '+rpFull(r.tagihanNilai)+(r.tagihan!=null?' (diisi manual)':' (otomatis dari qty diterima)')+' · dibayar '+rpFull(r.dibayar)+' · sisa '+rpFull(r.sisaBayar));
  $('rqBayarList').innerHTML=r.bayar.length?r.bayar.map(b=>'<div class="pl-riw-r"><span>'+rqTgl(b.tanggal)+'</span><b>'+rpFull(b.jumlah)+'</b><small>'+esc(b.catatan||'')+(b.oleh?' · '+esc(b.oleh):'')+'</small><button type="button" data-bayar="'+b.id+'" aria-label="Hapus pembayaran">×</button></div>').join('')
    :'<p style="color:var(--muted);font-size:12.5px">Belum ada pembayaran.</p>';
  $('rqByTgl').value=rqData.hari_ini;$('rqByJml').value=r.sisaBayar||'';$('rqByCat').value='';
}
function rqBuka(r){
  rqEdit=r;rqStok=null;
  const f=$('rqForm'),dlg=$('rqDlg');f.reset();
  $('rqGudangSel').innerHTML=rqData.gudang.filter(g=>g.jenis!=='dropship').map(g=>'<option value="'+g.id+'">'+esc(g.nama)+'</option>').join('');
  if(r){['supplier','kontak','tanggal','eta','resi','catatan'].forEach(k=>f.elements[k].value=r[k]||'');f.elements.gudang_id.value=r.gudang_id;f.elements.ongkir.value=r.ongkir||0;f.elements.tagihan.value=r.tagihan==null?'':r.tagihan}
  else f.elements.tanggal.value=rqData.hari_ini;
  rqItems=r?r.items.map(i=>({...i})):[{produk_id:null,qty:null,harga:null}];
  const ubah=rqBolehUbah();
  f.querySelectorAll('.rq-head input,.rq-head select').forEach(el=>el.disabled=!ubah);
  f.elements.tagihan.disabled=!r||r.status==='batal';
  $('rqSimpan').hidden=!ubah&&!(r&&r.status==='selesai');
  put('rqDlgJ',r?r.nomor+' · '+r.supplier:'Buat REQ');put('rqMsg','');
  $('rqTerimaBox').hidden=true;
  rqBkBaru=[];put('rqBkMsg','');$('rqBkFile').disabled=!!(r&&r.status==='batal');
  rqItemsRender();rqStatusRender();rqRiwRender();rqBayarRender();rqBkRender();
  if(!dlg.open)dlg.showModal();
}
// -- Berkas pengiriman: foto dikecilkan di browser (≤1600 px JPEG), nomor resi dibaca dari barcode (BarcodeDetector bawaan
//    browser, atau pustaka ZXing bila browser tidak punya), lalu di-upload ke REQ
let rqBkBaru=[],rqZxing=null;
const RQ_BK_JENIS={resi:'Resi',surat_jalan:'Surat jalan',invoice:'Invoice',lain:'Lainnya'};
const rqUkuran=n=>n>=1e6?nf.format(Math.round(n/1e5)/10)+' MB':int(Math.max(1,n/1e3))+' KB';
const rqMuatZxing=()=>rqZxing||(rqZxing=new Promise((ok,gagal)=>{
  const sc=document.createElement('script');sc.src='https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
  sc.onload=()=>ok(window.ZXing);sc.onerror=()=>{rqZxing=null;gagal(new Error('pembaca barcode gagal dimuat'))};document.head.appendChild(sc)}));
/** Kode yang paling mungkin nomor resi: barcode garis (bukan QR) didahulukan, 8–30 huruf/angka */
const rqPilihKode=list=>{const ok=list.filter(k=>/^[A-Za-z0-9-]{8,30}$/.test(String(k.teks||'').trim()));
  ok.sort((a,b)=>(b.garis?1:0)-(a.garis?1:0)||b.teks.length-a.teks.length);return ok.length?ok[0].teks.trim():''};
async function rqBacaBarcode(img,canvas){
  try{if('BarcodeDetector' in window){const h=await new BarcodeDetector().detect(img);
    const k=rqPilihKode(h.map(x=>({teks:x.rawValue,garis:!/qr|matrix|aztec|pdf417/i.test(x.format)})));if(k)return k}}catch(_){}
  let Z;try{Z=await rqMuatZxing()}catch(_){return ''}
  const hints=new Map();hints.set(Z.DecodeHintType.TRY_HARDER,true);
  const coba=async c=>{try{const res=await new Z.BrowserMultiFormatReader(hints).decodeFromImageUrl(c.toDataURL('image/png'));
    return rqPilihKode([{teks:res.getText(),garis:res.getBarcodeFormat()!==Z.BarcodeFormat.QR_CODE}])}catch(_){return ''}};
  // 1) foto apa adanya (≤1600 px); 2) diperbesar + hitam-putih — barcode bergaris tipis (mis. label Mengantar / JNE
  //    hasil cetak kecil) baru terbaca setelah garisnya dipertegas; 3) hitam-putih ukuran asli
  return await coba(canvas)||await coba(rqHitamPutih(img,Math.min(2,2400/Math.max(img.naturalWidth,img.naturalHeight))))||await coba(rqHitamPutih(img,1));
}
/** Salinan foto diperbesar/diperkecil `sk` kali lalu dibuat hitam-putih (ambang 75% kecerahan rata-rata) */
function rqHitamPutih(img,sk){
  const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*sk);c.height=Math.round(img.naturalHeight*sk);
  const g=c.getContext('2d');g.imageSmoothingEnabled=sk<1;g.drawImage(img,0,0,c.width,c.height);
  const d=g.getImageData(0,0,c.width,c.height),a=d.data;let jml=0;
  for(let i=0;i<a.length;i+=4)jml+=a[i]*.3+a[i+1]*.59+a[i+2]*.11;
  const batas=.75*jml/(a.length/4);
  for(let i=0;i<a.length;i+=4){const v=a[i]*.3+a[i+1]*.59+a[i+2]*.11<batas?0:255;a[i]=a[i+1]=a[i+2]=v}
  g.putImageData(d,0,0);return c;
}
/** Foto → JPEG ≤1600 px (≤1,4 MB); PDF dipakai apa adanya (maks 1,4 MB) */
async function rqSiapkanBerkas(f){
  if(f.type==='application/pdf'){if(f.size>1450000)throw new Error(f.name+': PDF terlalu besar (maks 1,4 MB)');return {blob:f,nama:f.name,tipe:f.type}}
  if(!/^image\//.test(f.type))throw new Error(f.name+': hanya foto atau PDF');
  const url=URL.createObjectURL(f);
  try{
    const img=await new Promise((ok,gagal)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>gagal(new Error(f.name+': foto tidak bisa dibaca'));i.src=url});
    const sk=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');
    c.width=Math.round(img.naturalWidth*sk);c.height=Math.round(img.naturalHeight*sk);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    let q=.82,blob;do{blob=await new Promise(ok=>c.toBlob(ok,'image/jpeg',q));q-=.12}while(blob&&blob.size>1400000&&q>.3);
    if(!blob)throw new Error(f.name+': foto tidak bisa diproses');
    return {blob,nama:f.name.replace(/\.[^.]+$/,'')+'.jpg',tipe:'image/jpeg',img,canvas:c};
  }finally{URL.revokeObjectURL(url)}
}
async function rqBkUpload(id,b){
  const h=await api('/api/settings/req/'+id+'/berkas',{method:'POST',body:b.blob,
    headers:{'Content-Type':b.tipe,'X-Nama':encodeURIComponent(b.nama),'X-Jenis':b.jenis,'X-Resi':encodeURIComponent(b.resi||'')}});
  return h;
}
function rqBkRender(){
  const ada=rqEdit&&rqEdit.berkas||[],ikon=t=>/pdf/.test(t)?'📄':'🖼️';
  $('rqBkList').innerHTML=ada.map(b=>'<span class="rq-bk"><a href="/api/settings/req/berkas/'+b.id+'" target="_blank" rel="noopener" title="Buka '+esc(b.nama)+'">'+ikon(b.tipe)+' '+esc(b.nama)+'</a>'+
      '<small>'+esc(RQ_BK_JENIS[b.jenis]||b.jenis)+' · '+rqUkuran(b.ukuran)+(b.resi?' · resi '+esc(b.resi):'')+'</small><button type="button" data-bk-hapus="'+b.id+'" title="Hapus berkas" aria-label="Hapus '+esc(b.nama)+'">×</button></span>').join('')+
    rqBkBaru.map((b,i)=>'<span class="rq-bk baru">'+ikon(b.tipe)+' '+esc(b.nama)+'<small>'+esc(RQ_BK_JENIS[b.jenis])+' · '+rqUkuran(b.blob.size)+' · tersimpan saat klik Simpan</small>'+
      '<button type="button" data-bk-batal="'+i+'" title="Batal" aria-label="Batal '+esc(b.nama)+'">×</button></span>').join('')||
    '<small style="color:var(--muted)">Belum ada berkas.</small>';
}
$('rqBkFile').addEventListener('change',async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length)return;
  const jenis=$('rqBkJenis').value,inp=$('rqForm').elements.resi,catat=[];
  for(const file of files){
    try{
      put('rqBkMsg','Memproses '+file.name+'…');
      const b=Object.assign(await rqSiapkanBerkas(file),{jenis,resi:''});
      if(jenis==='resi'&&b.canvas){put('rqBkMsg','Membaca barcode resi…');b.resi=await rqBacaBarcode(b.img,b.canvas)}
      delete b.img;delete b.canvas;
      if(b.resi){
        const lama=inp.value.trim();
        if(!lama)inp.value=b.resi;
        catat.push(lama&&lama!==b.resi?'Barcode terbaca '+b.resi+' (berbeda dengan resi yang diisi: '+lama+')':'Resi terbaca dari barcode: '+b.resi);
      }else if(jenis==='resi'&&/^image/.test(b.tipe))catat.push(file.name+': barcode tidak terbaca — isi resi manual bila perlu');
      if(rqEdit){
        put('rqBkMsg','Mengupload '+b.nama+'…');
        const h=await rqBkUpload(rqEdit.id,b);
        rqEdit.berkas=[...(rqEdit.berkas||[]),{id:h.id,req_id:rqEdit.id,jenis,nama:b.nama,tipe:b.tipe,ukuran:b.blob.size,resi:b.resi||null}];
        if(h.resi_diisi){rqEdit.resi=b.resi;inp.value=b.resi}
      }else rqBkBaru.push(b);
    }catch(err){catat.push('⚠ '+err.message)}
    rqBkRender();
  }
  put('rqBkMsg',catat.join(' · ')||(rqEdit?'Berkas tersimpan.':'Berkas tersimpan saat klik Simpan.'));
});
$('rqBkList').addEventListener('click',async e=>{
  const bt=e.target.closest('[data-bk-batal]');if(bt){rqBkBaru.splice(Number(bt.dataset.bkBatal),1);rqBkRender();return}
  const h=e.target.closest('[data-bk-hapus]');if(!h||!rqEdit)return;
  const b=(rqEdit.berkas||[]).find(x=>x.id===Number(h.dataset.bkHapus));if(!b||!confirm('Hapus berkas '+b.nama+'?'))return;
  try{await api('/api/settings/req/berkas/'+b.id,{method:'DELETE'});rqEdit.berkas=rqEdit.berkas.filter(x=>x!==b);rqBkRender();put('rqBkMsg','Berkas dihapus.')}
  catch(err){put('rqBkMsg','⚠ Gagal menghapus: '+err.message)}
});

/** Muat ulang data lalu tampilkan lagi REQ yang sedang dibuka */
async function rqSegarkan(id){
  rqSiapkan(await api('/api/settings/req'));renderReq();
  const r=rqData.rows.find(x=>x.id===id);if(r)rqBuka(r);
}
function rqAmbilItems(){
  $('rqItems').querySelectorAll('tr[data-n]').forEach(tr=>{const i=rqItems[Number(tr.dataset.n)];
    i.produk_id=Number(tr.querySelector('.rq-prd').value)||null;i.qty=Math.round(Number(tr.querySelector('.rq-qty').value))||null;
    const h=tr.querySelector('.rq-harga').value;i.harga=h===''?null:Math.round(Number(h))});
}
/** Simpan header + produk; kembalikan id REQ */
async function rqSimpanForm(){
  rqAmbilItems();
  const f=$('rqForm'),data=Object.fromEntries(['supplier','kontak','tanggal','eta','resi','catatan'].map(k=>[k,f.elements[k].value.trim()]));
  data.gudang_id=Number(f.elements.gudang_id.value);data.ongkir=Number(f.elements.ongkir.value)||0;data.tagihan=f.elements.tagihan.value;
  data.items=rqItems.map(i=>({produk_id:i.produk_id,qty:i.qty,harga:i.harga==null?0:i.harga}));
  if(rqEdit)data.id=rqEdit.id;
  const h=await api('/api/settings/req',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  // Berkas yang dipilih sebelum REQ punya nomor di-upload setelah REQ tersimpan
  while(rqBkBaru.length){put('rqMsg','Mengupload berkas '+rqBkBaru[0].nama+'…');await rqBkUpload(h.id,rqBkBaru[0]);rqBkBaru.shift()}
  return h.id;
}

// -- Penerimaan: qty baik / rusak per produk + pratinjau HPP rata-rata tertimbang
/** Harga beli per pcs termasuk bagian ongkir (dibagi menurut nilai pesanan; tanpa harga → menurut qty) */
function rqLanded(r,i){
  const nilai=r.items.reduce((a,x)=>a+x.harga*x.qty,0),qty=r.items.reduce((a,x)=>a+x.qty,0);
  return i.harga+(r.ongkir?(nilai?r.ongkir*i.harga/nilai:r.ongkir/qty):0);
}
/** Stok semua gudang yang dicatat untuk produk ini (sebelum penerimaan) */
const rqStokProduk=id=>rqStok?rqStok.stok.filter(s=>s.produk.id===id).reduce((a,s)=>a+s.stok,0):null;
function rqHppBaru(r,i,baik){
  const p=rqData.produk.find(x=>x.id===i.produk_id)||{hpp:0},stok=Math.max(0,rqStokProduk(i.produk_id)||0),beli=rqLanded(r,i);
  return {lama:p.hpp,stok,beli,baru:baik>0?Math.round((stok*p.hpp+baik*beli)/(stok+baik)):p.hpp};
}
function rqTrPrev(){
  const r=rqEdit,pakai=$('rqTrHpp').checked;
  $('rqTrRows').querySelectorAll('tr[data-item]').forEach(tr=>{
    const i=r.items.find(x=>x.id===Number(tr.dataset.item)),baik=Math.max(0,Math.round(Number(tr.querySelector('.rq-baik').value)||0)),h=rqHppBaru(r,i,baik);
    tr.lastElementChild.innerHTML=!pakai?'<span style="color:var(--muted)">tidak diubah ('+rpFull(h.lama)+')</span>'
      :rqStok==null?'<span style="color:var(--muted)">menghitung stok…</span>'
      :rpFull(h.lama)+' → <b>'+rpFull(h.baru)+'</b><small class="mm-sub">stok '+int(h.stok)+' × '+rpFull(h.lama)+' + '+int(baik)+' × '+rpFull(h.beli)+' (harga + ongkir)</small>';
  });
}
async function rqBukaTerima(){
  const r=rqEdit,box=$('rqTerimaBox');
  $('rqTrTgl').value=rqData.hari_ini;$('rqTrTgl').max=rqData.hari_ini;$('rqTrCat').value='';$('rqTrHpp').checked=true;
  $('rqTrRows').innerHTML=r.items.map(i=>'<tr data-item="'+i.id+'"><td class="nm">'+esc(i.nama)+'<small>'+rpFull(i.harga)+' / pcs</small></td><td class="n">'+int(i.sisa)+'</td>'+
    '<td class="n"><input class="ob-qty rq-baik" type="number" min="0" step="1" value="'+i.sisa+'" aria-label="Diterima baik"></td>'+
    '<td class="n"><input class="ob-qty rq-rusak" type="number" min="0" step="1" value="0" aria-label="Rusak"></td><td class="sh"></td></tr>').join('');
  box.hidden=false;box.scrollIntoView({block:'nearest'});
  rqTrPrev();
  if(!rqStok){try{const d=await api('/api/report/stok');stHitung(d);rqStok=d}catch(e){rqStok={stok:[]}}rqTrPrev()}
}
$('rqTrRows').addEventListener('input',rqTrPrev);
$('rqTrHpp').addEventListener('change',rqTrPrev);
$('rqTrBatal').addEventListener('click',()=>{$('rqTerimaBox').hidden=true});
$('rqTrSimpan').addEventListener('click',async()=>{
  const r=rqEdit,b=$('rqTrSimpan'),pakai=$('rqTrHpp').checked;
  const rows=[...$('rqTrRows').querySelectorAll('tr[data-item]')].map(tr=>({item_id:Number(tr.dataset.item),
    baik:Math.max(0,Math.round(Number(tr.querySelector('.rq-baik').value)||0)),rusak:Math.max(0,Math.round(Number(tr.querySelector('.rq-rusak').value)||0))}));
  if(!rows.some(x=>x.baik||x.rusak)){put('rqMsg','Isi qty diterima minimal satu produk');return}
  const lebih=rows.filter(x=>{const i=r.items.find(y=>y.id===x.item_id);return x.baik+x.rusak>i.sisa});
  if(lebih.length&&!confirm('Qty diterima melebihi sisa pesanan untuk '+lebih.length+' produk. Tetap simpan?'))return;
  const hpp=pakai?rows.filter(x=>x.baik>0).map(x=>{const i=r.items.find(y=>y.id===x.item_id);return {produk_id:i.produk_id,hpp:rqHppBaru(r,i,x.baik).baru}}):[];
  b.disabled=true;put('rqMsg','');
  try{
    await api('/api/settings/req/'+r.id+'/terima',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tanggal:$('rqTrTgl').value,catatan:$('rqTrCat').value.trim(),rows,hpp})});
    await rqSegarkan(r.id);
  }catch(e){put('rqMsg','Gagal menyimpan penerimaan: '+e.message)}
  finally{b.disabled=false}
});

$('rqTambah').addEventListener('click',()=>{if(rqData)rqBuka(null)});
$('rqIsi').addEventListener('click',e=>{const b=e.target.closest('[data-rq]');if(b)rqBuka(rqData.rows.find(r=>r.id===Number(b.dataset.rq)))});
$('rqItemTambah').addEventListener('click',()=>{rqAmbilItems();rqItems.push({produk_id:null,qty:null,harga:null});rqItemsRender()});
$('rqItems').addEventListener('click',e=>{const b=e.target.closest('.rq-hapus-i');if(!b)return;rqAmbilItems();rqItems.splice(Number(b.closest('tr').dataset.n),1);rqItemsRender()});
$('rqItems').addEventListener('change',()=>{rqAmbilItems();rqItemsRender()});
$('rqForm').elements.ongkir.addEventListener('change',()=>{rqAmbilItems();rqItemsRender()});
['rqTutup','rqBatal'].forEach(id=>$(id).addEventListener('click',()=>$('rqDlg').close()));
$('rqForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const b=$('rqSimpan');b.disabled=true;put('rqMsg','');
  try{const id=await rqSimpanForm();await rqSegarkan(id);put('rqMsg','')}
  catch(err){put('rqMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
$('rqStatusBar').addEventListener('click',async e=>{
  const b=e.target.closest('[data-st]');if(!b||!rqEdit)return;
  const st=b.dataset.st,r=rqEdit;
  if(st==='terima'){rqBukaTerima();return}
  const tanya={batal:'Batalkan REQ '+r.nomor+'?',hapus:'Hapus REQ '+r.nomor+'? Tidak bisa dikembalikan.',selesai:'Tutup sisa pesanan '+r.nomor+'? Sisa qty yang belum datang dianggap tidak dikirim supplier.'}[st];
  if(tanya&&!confirm(tanya))return;
  b.disabled=true;put('rqMsg','');
  try{
    if(st==='hapus'){await api('/api/settings/req/'+r.id,{method:'DELETE'});$('rqDlg').close();rqSiapkan(await api('/api/settings/req'));renderReq();return}
    if(rqBolehUbah())await rqSimpanForm();       // simpan perubahan form dulu supaya tidak hilang
    await api('/api/settings/req/'+r.id+'/status',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:st})});
    await rqSegarkan(r.id);
  }catch(err){b.disabled=false;put('rqMsg','Gagal: '+err.message)}
});
$('rqRiw').addEventListener('click',async e=>{
  const b=e.target.closest('[data-batch]');if(!b||!rqEdit)return;
  if(!confirm('Batalkan penerimaan ini? Stok berkurang lagi dan perubahan HPP dari penerimaan ini dihapus.'))return;
  b.disabled=true;
  try{await api('/api/settings/req/'+rqEdit.id+'/terima/'+encodeURIComponent(b.dataset.batch),{method:'DELETE'});await rqSegarkan(rqEdit.id)}
  catch(err){b.disabled=false;put('rqMsg','Gagal: '+err.message)}
});
$('rqByTambah').addEventListener('click',async()=>{
  const r=rqEdit,b=$('rqByTambah'),jumlah=Math.round(Number($('rqByJml').value));
  if(!(jumlah>0)){put('rqMsg','Isi jumlah pembayaran');return}
  b.disabled=true;put('rqMsg','');
  try{await api('/api/settings/req/'+r.id+'/bayar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tanggal:$('rqByTgl').value,jumlah,catatan:$('rqByCat').value.trim()})});await rqSegarkan(r.id)}
  catch(err){put('rqMsg','Gagal mencatat pembayaran: '+err.message)}
  finally{b.disabled=false}
});
$('rqBayarList').addEventListener('click',async e=>{
  const b=e.target.closest('[data-bayar]');if(!b||!rqEdit||!confirm('Hapus catatan pembayaran ini?'))return;
  b.disabled=true;
  try{await api('/api/settings/req/'+rqEdit.id+'/bayar/'+b.dataset.bayar,{method:'DELETE'});await rqSegarkan(rqEdit.id)}
  catch(err){b.disabled=false;put('rqMsg','Gagal: '+err.message)}
});
$('rqTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;rqTab=b.dataset.tab;if(rqData)rqRenderTab()});
['rqGudang','rqBayarF'].forEach(id=>$(id).addEventListener('change',()=>{if(rqData)renderReq()}));
$('rqCari').addEventListener('input',()=>{if(rqData)rqRenderTab()});
$('rqExport').addEventListener('click',()=>{
  if(!rqData)return;
  unduhCsv('inbound-req.csv',['Nomor','Tanggal','Supplier','Kontak','Gudang','Status','Perkiraan tiba','Resi','Produk','Pcs diminta','Pcs baik','Pcs rusak','Nilai pesanan','Ongkir','Tagihan','Dibayar','Sisa bayar','Status bayar'],
    rqSaring(rqTab).map(r=>[r.nomor,r.tanggal,r.supplier,r.kontak||'',r.g.nama,RQ_ST[r.status][0],r.eta||'',r.resi||'',r.items.map(i=>i.qty+'x '+i.nama+' @'+i.harga).join(' + '),
      r.pcsMinta,r.pcsBaik,r.pcsRusak,r.nilaiPesanan,r.ongkir,r.tagihanNilai,r.dibayar,r.sisaBayar,RQ_BAYAR[r.stBayar][0]]));
});

loadReq();                                // isi badge "lewat perkiraan tiba" di menu Inbound REQ
