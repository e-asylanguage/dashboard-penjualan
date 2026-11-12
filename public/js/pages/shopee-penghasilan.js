/**
 * Shopee › Penghasilan: dana dilepas per pesanan (API + upload "Penghasilan Saya"), basis tgl dibuat / dilepas / dari iklan,
 * rincian potongan, kanal Ads / Affiliate / Live (+ laporan Live), tabel per pesanan / produk / toko.
 * Data: /api/shopee/penghasilan, /penghasilan/daftar, /api/shopee/toko, /api/shopee/live/:id.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta dari script utama (window.*):
 * rentang(), spToko (dibaca & diisi), tkMuat(), tkTagSumber(), spAngka(), liveDurasi(), PH_KANAL & phBagiUnik() (dipakai bersama Penghasilan TikTok).
 * Dipanggil dari script utama: loadShpHasil() (menu Penghasilan, setelah upload / sinkron / ganti sumber data).
 */
// ---- Shopee › Penghasilan: dana yang dilepas per pesanan (laporan Penghasilan Saya → Sudah Dilepas), menurut tanggal dana dilepas
let phData=null,phBusy=false,phTab='pesanan',phRows=[],phTotal=0,phCariT=null;
const PH_GRUP={platform:'Biaya Platform',gox:'Biaya Gratis Ongkir XTRA',layanan:'Biaya Layanan (termasuk Gratis Ongkir XTRA)',promosi:'Biaya Promosi',lainnya:'Biaya Lainnya',pajak:'Pajak'};
const PH_LAIN={harga:'Harga produk',refund:'Pengembalian dana ke pembeli',ongkir:'Ongkos kirim (selisih)',voucher:'Voucher & potongan dari penjual',isi_saldo:'Isi saldo iklan otomatis'};
const phBiaya=o=>(o.platform||0)+(o.gox||0)+(o.layanan||0)+(o.promosi||0)+(o.lainnya||0)+(o.pajak||0);
// Basis tanggal: 'dibuat' (tanggal pesanan dibuat → profit per hari order) atau 'dilepas' (tanggal dana dilepas → arus kas)
// atau 'iklan' (tanggal pesanan dibuat, angka diskalakan ke perkiraan order iklan yang dikirim — lihat phSkalaIklan)
let phBasis='dibuat';try{const b=localStorage.getItem('phBasis');if(b==='dilepas'||b==='iklan')phBasis=b}catch(e){}
$('phBasis').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.basis===phBasis));
function phQuery(){const r=rentang('phRange'),q=new URLSearchParams({from:r.from,to:r.to,basis:phBasis});if($('phToko').value)q.set('toko',$('phToko').value);return q}
async function loadShpHasil(){
  if(phBusy)return;phBusy=true;
  try{
    const [d,t]=await Promise.all([api('/api/shopee/penghasilan?'+phQuery()),api('/api/shopee/toko')]);
    phData=d;spToko=t;renderShpHasil();tkMuat('ph');phMuatOngkir();await phMuatDaftar(false);
  }catch(e){$('phIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{phBusy=false}
}
/**
 * Pemantau beban ongkir ke penjual (/api/shopee/penghasilan/ongkir): total "Ongkos kirim (selisih)" dipilah per penyebab —
 * selisih berat (ongkir aktual kurir > estimasi Shopee), retur / refund, lainnya — dibanding periode sebelumnya yang sama panjang,
 * plus produk & pesanan penyumbang terbesar untuk investigasi. Dimuat terpisah supaya tidak menahan halaman.
 */
const PH_SEBAB={berat:'Selisih berat',retur:'Retur / refund',lain:'Lainnya'};
async function phMuatOngkir(){
  const box=$('phOngkir');
  try{const o=await api('/api/shopee/penghasilan/ongkir?'+phQuery());phRenderOngkir(o)}
  catch(e){box.hidden=false;box.className='card ph-ongkir';box.innerHTML='<div class="card-b" style="color:var(--loss)">Gagal memuat pemantau ongkir ('+esc(e.message)+').</div>'}
}
function phRenderOngkir(o){
  const box=$('phOngkir'),k=o.kini||{},s=o.sebelum||{},tot=o.total||{},n=v=>Number(v)||0;
  box.hidden=!n(tot.n);if(box.hidden)return;
  const beban=n(k.beban),lalu=n(s.beban),berat=n(k.berat);
  box.className='card tone ph-ongkir '+(berat?'tone-loss':beban?'tone-spend':'tone-rev');
  const naik=lalu?100*(beban-lalu)/lalu:null;
  const delta=!beban&&!lalu?'sama dengan periode sebelumnya (Rp 0)':lalu?(beban>=lalu?'▲ ':'▼ ')+pct(Math.abs(naik))+' vs periode sebelumnya ('+rpFull(lalu)+')':'periode sebelumnya Rp 0';
  const kotak=(l,v,nn,ket,cls)=>'<div class="ph-og-k'+(cls?' '+cls:'')+'"><small>'+l+'</small><b>'+(v?'− '+rpFull(v):'Rp 0')+'</b><span>'+ket(nn)+'</span></div>';
  const apiPct=n(tot.n)?100*n(tot.n_api)/n(tot.n):0;
  let h='<div class="card-h"><div><h3>Beban ongkir ke penjual'+(berat?' · ⚠️ ada selisih berat':'')+'</h3><p>'+esc(fmtRange(o.from,o.to))+' · '+int(k.n)+' dari '+int(tot.n)+' pesanan kena beban ongkir · '+
    '<b class="'+(naik!=null&&naik>25&&beban>50000?'ph-og-naik':'')+'">'+esc(delta)+'</b></p></div></div><div class="card-b">';
  h+='<div class="ph-og-grid">'+
    '<div class="ph-og-k utama"><small>Total "Ongkos kirim (selisih)"</small><b>'+(beban?'− '+rpFull(beban):'Rp 0')+'</b><span>'+(k.n?'rata-rata '+rpFull(beban/k.n)+' per pesanan':'tidak ada beban ongkir')+'</span></div>'+
    kotak('Selisih berat <i class="sd-i" title="Ongkir aktual dari kurir lebih besar dari estimasi Shopee saat checkout — biasanya berat / dimensi paket di sistem lebih kecil dari aslinya. Hanya bisa dicek untuk data API ('+pct(apiPct)+' pesanan di rentang ini).">i</i>',berat,k.n_berat,x=>x?int(x)+' pesanan · aktual > estimasi':'✅ tidak ada · aktual = estimasi',berat?'bahaya':'')+
    kotak('Retur / refund <i class="sd-i" title="Pesanan yang dikembalikan / direfund: subsidi ongkir Shopee hilang sehingga ongkir kirim ditanggung penjual, ditambah ongkir retur.">i</i>',n(k.retur),k.n_retur,x=>int(x)+' pesanan · ongkir kirim + retur')+
    (n(k.lain)?kotak('Lainnya',n(k.lain),k.n_lain,x=>int(x)+' pesanan · data upload tanpa rincian'):'')+'</div>';
  if(k.n){
    const pr=o.produk||[],ps=o.pesanan||[];
    h+='<details class="ph-og-det"><summary>Produk &amp; pesanan penyumbang beban ongkir</summary><div class="ph-og-tbl">'+
      '<table class="sku-tbl gd-tbl"><thead><tr><th>Produk</th><th class="n">Pesanan</th><th class="n">Selisih berat</th><th class="n">Retur / refund</th><th class="n">Beban ongkir</th></tr></thead><tbody>'+
      pr.map(x=>'<tr><td class="name">'+esc(x.produk)+'</td><td class="n">'+int(x.n)+'</td><td class="n">'+(x.n_berat?'<b style="color:var(--loss)">'+int(x.n_berat)+'</b>':'0')+'</td><td class="n">'+int(x.n_retur)+'</td><td class="n">− '+rpFull(x.beban)+'</td></tr>').join('')+
      '</tbody></table><table class="sku-tbl gd-tbl"><thead><tr><th>No. Pesanan</th><th>Produk</th><th>Penyebab</th><th class="n" title="Estimasi Shopee saat checkout">Ongkir estimasi</th><th class="n" title="Tagihan kurir">Ongkir aktual</th><th class="n">Ongkir retur</th><th class="n">Beban</th></tr></thead><tbody>'+
      ps.map(x=>'<tr><td class="sd-resi">'+esc(x.no_pesanan)+'<small class="mm-sub">'+esc(tglWib(String(x.dilepas||x.dibuat).slice(0,10)+'T12:00:00+07:00'))+'</small></td><td>'+esc(x.produk)+'</td>'+
        '<td><span class="tag '+(x.sebab==='berat'?'loss':x.sebab==='retur'?'spend':'')+'">'+PH_SEBAB[x.sebab]+'</span></td>'+
        '<td class="n">'+(x.est!=null?rpFull(x.est):'—')+'</td><td class="n">'+(x.act!=null?(x.act>x.est?'<b style="color:var(--loss)">'+rpFull(x.act)+'</b>':rpFull(x.act)):'—')+'</td>'+
        '<td class="n">'+(x.rev!=null?rpFull(x.rev):'—')+'</td><td class="n"><b>− '+rpFull(x.beban)+'</b></td></tr>').join('')+
      '</tbody></table>'+(ps.length>=50?'<p class="ph-og-cat">Daftar dibatasi 50 pesanan dengan beban terbesar.</p>':'')+'</div></details>';
  }
  box.innerHTML=h+'</div>';
}
/**
 * Mode "Dari iklan": Shopee tidak memberi No. Pesanan per iklan, jadi corongnya perkiraan —
 * order closing = konversi laporan iklan; batal / dikirim = konversi × rasio batal / dikirim seluruh pesanan toko yang dibuat di rentang;
 * semua pos penghasilan (harga, potongan, HPP, …) = total pesanan yang sudah dilepas × (order iklan dikirim ÷ jumlah pesanan itu).
 */
function phSkalaIklan(d){
  const c=d.dari_iklan||{},kv=c.konversi||0,ps=c.pesanan||0;
  const batal=ps?Math.round(kv*(c.batal||0)/ps):0,transaksi=Math.max(0,kv-batal);
  // Rata-rata per pesanan dari pesanan rentang ini yang dananya sudah dilepas; bila belum ada → acuan 60 hari terakhir
  const ac=d.acuan||{},pakaiAcuan=!d.total.n&&!!(ac.total&&ac.total.n),ref=pakaiAcuan?ac:d,n=ref.total.n||0;
  const k=n?transaksi/n:0,sk=o=>{const r={};for(const x in o)r[x]=typeof o[x]==='number'?o[x]*k:o[x];return r};
  const total=sk(ref.total);total.n=transaksi;
  return {kv,ps,batal,transaksi,c,total,ref,pakaiAcuan,rincian:(ref.rincian||[]).map(r=>({...r,jumlah:r.jumlah*k,n:Math.round(r.n*k)}))};
}
/**
 * Mode "Tgl pesanan dibuat" = estimasi penghasilan yang akan didapat: pesanan yang dananya sudah dilepas (angka asli)
 * + pesanan yang belum dilepas (selain batal / belum bayar) = subtotal produknya × rasio tiap pos terhadap harga produk
 * dari pesanan rentang ini yang sudah dilepas (bila belum ada → acuan 60 hari terakhir). Angka asli dana dilepas ada di "Tgl dana dilepas".
 */
let phEst=null;
function phEstimasi(d){
  const bl=(d.belum_dilepas||[]).reduce((a,r)=>({n:a.n+r.n,sub:a.sub+(r.subtotal||0)}),{n:0,sub:0});
  const ac=d.acuan||{},pakaiAcuan=!d.total.harga&&!!(ac.total&&ac.total.harga),ref=pakaiAcuan?ac:d,h=ref.total.harga||0;
  const k=h?bl.sub/h:0,LEWAT=new Set(['n','tanpa_pesanan','sku_kosong']);
  const total={...d.total};
  for(const x in ref.total)if(typeof ref.total[x]==='number'&&!LEWAT.has(x))total[x]=(d.total[x]||0)+ref.total[x]*k;
  total.n=(d.total.n||0)+bl.n;
  const rin=new Map(d.rincian.map(r=>[r.kolom,{...r}]));
  for(const r of ref.rincian||[]){const x=rin.get(r.kolom)||{kolom:r.kolom,jumlah:0,n:0};x.jumlah+=r.jumlah*k;x.n+=Math.round(r.n*k);rin.set(r.kolom,x)}
  const per=v=>h?(v||0)/h:0;   // rasio pos terhadap harga produk, untuk estimasi per hari
  return {bl,ref,pakaiAcuan,total,rincian:[...rin.values()],rasio:{total:per(ref.total.total),biaya:per(phBiaya(ref.total)),hpp:per(ref.total.hpp),isi_saldo:per(ref.total.isi_saldo)},
    ket:'estimasi · '+int(d.total.n||0)+' pesanan sudah dilepas + '+int(bl.n)+' pesanan belum dilepas'};
}
function phRenderCorong(s){
  const box=$('phCorong');box.hidden=!s;if(!s)return;
  const pct=(a,b)=>b?nf.format(Math.round(1000*a/b)/10)+'%':'—',t=s.total,rn=s.ref.total.n||0;
  put('phCorongSub','· perkiraan · '+fmtRange(phData.from,phData.to));
  const li=(cls,lbl,v,em)=>'<li'+(cls?' class="'+cls+'"':'')+'><span>'+lbl+'</span><b>'+v+'</b><em>'+em+'</em></li>';
  $('phCorongIsi').innerHTML=!s.kv?'<li style="grid-column:1/-1"><span>Belum ada konversi iklan pada rentang ini.</span><em>Upload / sinkron laporan iklan di Shopee › Iklan. Hanya laporan yang seluruh periodenya di dalam rentang yang dihitung.</em></li>':
    li('','Pesanan terbuat',int(s.kv),'konversi laporan iklan · omzet iklan '+rpFull(s.c.omzet||0))+
    li('batal','Batal',(s.batal?'−':'')+int(s.batal),pct(s.c.batal||0,s.ps)+' pesanan toko batal')+
    li('','Total transaksi',int(s.transaksi),'pesanan terbuat − batal (dikirim & belum dikirim)')+
    li('paid','Estimasi penghasilan',rn?rpFull(t.total||0):'—',rn?'rata-rata '+rpFull((s.ref.total.total||0)/rn)+' / pesanan'+(s.pakaiAcuan?' (acuan 60 hari terakhir)':''):'belum ada data penghasilan untuk acuan');
}
function renderShpHasil(){
  const d=phData,iklanMode=d.basis==='iklan',sk=iklanMode?phSkalaIklan(d):null;
  const est=phEst=d.basis==='dibuat'?phEstimasi(d):null,src=sk||est;
  const t=src?src.total:d.total,n=t.n||0,biaya=phBiaya(t),laba=(t.total||0)-(t.hpp||0),rt=src?src.ref.total:d.total,hppLengkap=n&&!rt.tanpa_pesanan&&!rt.sku_kosong;
  const sel=$('phToko'),v=sel.value;
  sel.innerHTML='<option value="">Semua toko</option>'+spToko.toko.map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('');
  sel.value=[...sel.options].some(o=>o.value===v)?v:'';
  const bl=(d.belum_dilepas||[]).reduce((a,r)=>({n:a.n+r.n,sub:a.sub+(r.subtotal||0)}),{n:0,sub:0});
  put('phPeriod',iklanMode?'Dari iklan · pesanan dibuat '+fmtRange(d.from,d.to)+' · perkiraan '+int(n)+' transaksi dari '+int(sk.kv)+' pesanan terbuat lewat iklan':
    est?'Estimasi penghasilan · pesanan dibuat '+fmtRange(d.from,d.to)+' · '+int(d.total.n||0)+' sudah dilepas + '+int(bl.n)+' belum dilepas (diperkirakan) · dana yang benar-benar cair ada di "Tgl dana dilepas"':
    'Dana dilepas '+fmtRange(d.from,d.to)+' · '+int(n)+' pesanan sudah dilepas · API & upload file digabung per No. Pesanan');
  phRenderCorong(sk);
  // Kotak utama dibuat ringkas: angka + satu keterangan pendek; rincian lainnya di tooltip ikon "i"
  const info=(k,rinci)=>{const e=$('phK'+k+'I'),t2=rinci.filter(Boolean).join('\n');e.hidden=!t2;e.title=t2};
  put('phK1',rpFull(t.total||0));put('phK1D',n?int(n)+' pesanan'+(est&&bl.n?' · estimasi':''):'belum ada data');
  info(1,[n&&'Rata-rata '+rpFull((t.total||0)/n)+' per pesanan',est&&bl.n&&'Termasuk perkiraan '+int(bl.n)+' pesanan yang dananya belum dilepas']);
  $('phK2').innerHTML=lpRp(biaya,0);put('phK2D',lpPct(-biaya,t.harga)+' dari harga produk');
  info(2,[n&&'Rata-rata '+rpFull(-biaya/n)+' per pesanan',t.afiliasi&&'Komisi affiliate '+rpFull(t.afiliasi)+' ('+int(t.n_afiliasi)+' pesanan)','Rincian per jenis potongan ada di tabel di bawah']);
  put('phK3',rpFull(t.harga||0));put('phK3D',n?int(n)+' pesanan':'—');
  info(3,[t.refund&&'Pengembalian dana '+rpFull(-t.refund),t.voucher?'Voucher penjual '+rpFull(-t.voucher):'Tanpa voucher penjual']);
  const spend=(d.iklan||{}).biaya||0,labaIk=laba-(t.isi_saldo||0)-spend;   // isi saldo iklan sudah bagian dari spend
  $('phK4').innerHTML=n&&t.hpp?lpRp(iklanMode?labaIk:laba,0):'—';
  // Peringatan HPP tetap tampil (bukan di tooltip) karena membuat angkanya meleset
  put('phK4D',!n?'—':!t.hpp?'HPP belum terhitung':'margin '+lpPct(iklanMode?labaIk:laba,t.harga)+(hppLengkap?'':' · HPP belum lengkap'));
  info(4,[!n?'':!t.hpp?'Upload file Pesanan & lengkapi SKU supaya HPP terhitung':iklanMode?'Setelah spend iklan '+rpFull(spend):'Belum termasuk biaya iklan',
    n&&t.hpp&&'Margin dihitung terhadap harga produk']);
  const w=[];
  if(iklanMode)w.push('<b>Estimasi.</b> Shopee tidak memberi nomor pesanan per iklan, jadi batal memakai rasio seluruh pesanan toko, dan penghasilan / potongan / HPP = rata-rata per pesanan yang dananya sudah dilepas × total transaksi iklan. Grafik &amp; tabel di bawah tetap seluruh pesanan toko (tanggal pesanan dibuat).');
  if(iklanMode&&sk.pakaiAcuan)w.push('Di rentang ini belum ada pesanan yang dananya dilepas — rata-rata per pesanan diambil dari pesanan dibuat '+fmtRange(d.acuan.dari,d.acuan.sampai)+' ('+int(sk.ref.total.n)+' pesanan sudah dilepas).');
  if(iklanMode&&sk.kv&&!sk.ref.total.n)w.push('Belum ada data penghasilan Shopee 60 hari terakhir — estimasi penghasilan belum bisa dihitung. Upload / sinkron Penghasilan dulu.');
  if(est&&bl.n)w.push('<b>Estimasi.</b> '+int(bl.n)+' pesanan yang dibuat di rentang ini dananya <b>belum dilepas</b> Shopee (subtotal produk '+rpFull(bl.sub)+') — penghasilan, potongan &amp; HPP-nya diperkirakan dari rasio pesanan yang sudah dilepas'+
    (est.pakaiAcuan?' (acuan pesanan dibuat '+fmtRange(d.acuan.dari,d.acuan.sampai)+', karena di rentang ini belum ada yang dilepas)':'')+'. Angka asli dana yang cair ada di <b>Tgl dana dilepas</b>. Tabel per pesanan / produk / toko di bawah hanya pesanan yang sudah dilepas.');
  if(est&&bl.n&&!est.ref.total.harga)w.push('Belum ada data penghasilan Shopee 60 hari terakhir — pesanan yang belum dilepas belum bisa diperkirakan.');
  if(!spToko.toko.length)w.push('Belum ada toko Shopee — tambahkan di <b>Shopee › Pengiriman</b> (tabel Toko Shopee), lalu klik <b>Upload file</b>.');
  if(d.total.tanpa_pesanan)w.push(int(d.total.tanpa_pesanan)+' pesanan belum ada di file Pesanan yang di-upload — produk & HPP-nya belum terhitung. Upload juga file <b>Pesanan</b> (Pesanan Saya → Ekspor) untuk periode pesanan dibuat yang sama.');
  if(d.total.sku_kosong)w.push(int(d.total.sku_kosong)+' pesanan berisi SKU yang belum ada di Manajemen SKU — HPP-nya belum lengkap. Pakai <b>Buat SKU otomatis</b> di Shopee › Pengiriman → Per produk.');
  if(t.isi_saldo)w.push('Isi saldo iklan otomatis '+rpFull(-t.isi_saldo)+' dipotong dari penghasilan — tidak dihitung sebagai biaya Shopee (masuk biaya iklan).');
  $('phWarn').hidden=!w.length;$('phWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  phRenderRinci(src);phRenderKanal(est?est.total:d.total);phRenderTab();
}
/** Rincian: tiap kelompok biaya Shopee + kolom aslinya dari laporan (mode Dari iklan: angka yang sudah diskalakan) */
const phRinciBuka=new Set();
$('phRinci').addEventListener('click',e=>{
  const tr=e.target.closest('.ph-rinci-tog');if(!tr)return;
  const g=tr.dataset.g,buka=!phRinciBuka.has(g);buka?phRinciBuka.add(g):phRinciBuka.delete(g);
  $('phRinci').querySelectorAll('.ph-rinci-det[data-g="'+g+'"]').forEach(r=>r.hidden=!buka);
  tr.querySelector('span').textContent=buka?'▾':'▸';tr.title='Klik untuk '+(buka?'menutup':'melihat')+' rincian';
  const s=tr.querySelector('small');if(s)s.textContent=s.textContent.replace(/klik untuk \w+/,'klik untuk '+(buka?'menutup':'melihat'));
});
function phRenderRinci(sk){
  const src=sk||phData,t=src.total,harga=t.harga||0,n=t.n||0,per={};
  for(const r of src.rincian){const [g,...k]=r.kolom.split('|');(per[g]=per[g]||[]).push({nama:k.join('|'),jumlah:r.jumlah,n:r.n})}
  const baris=(nama,v,cls,sub)=>'<tr class="'+cls+'"><td class="lr-nm">'+esc(nama)+(sub?'<small>'+sub+'</small>':'')+'</td><td class="n">'+lpRp(v,0)+'</td><td class="n">'+(harga&&v?lpPct(Math.abs(v),harga):'—')+'</td><td class="n">'+(n&&v?rpFull(v/n):'—')+'</td></tr>';
  let h='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pos</th><th class="n">Jumlah</th><th class="n">% harga</th><th class="n">Per pesanan</th></tr></thead><tbody>';
  h+=baris(PH_LAIN.harga,harga,'lr-sub');
  for(const k of ['refund','voucher','ongkir'])if(t[k])h+=baris(PH_LAIN[k],t[k],'lr-pos');
  h+='<tr class="lr-judul"><td colspan="4">Potongan Shopee</td></tr>';
  // Rincian tiap kelompok biaya disembunyikan; klik baris kelompok untuk membuka / menutup (phRinciBuka, bertahan selama halaman terbuka)
  let grp='';
  const sub=x=>'<tr class="ph-rinci-det" data-g="'+grp+'"'+(phRinciBuka.has(grp)?'':' hidden')+'><td class="lr-nm" style="padding-left:44px;color:var(--muted)">'+esc(x.nama)+'<small>'+int(x.n)+' pesanan'+(x.ket?' · '+esc(x.ket):'')+'</small></td><td class="n" style="color:var(--muted)">'+lpRp(x.jumlah,0)+'</td><td class="n" style="color:var(--muted)">'+lpPct(Math.abs(x.jumlah),harga)+'</td><td></td></tr>';
  const api=k=>(per.api||[]).find(x=>x.nama===k);
  for(const [g,label] of Object.entries(PH_GRUP)){
    if(g==='gox')continue;   // Gratis Ongkir XTRA digabung ke Biaya Layanan (API Shopee tidak memisahkannya)
    const nilai=g==='layanan'?(t.layanan||0)+(t.gox||0):t[g];
    if(!nilai)continue;
    let rinci=(per[g]||[]).slice();
    // Komisi affiliate (AMS) dari API & file digabung jadi satu baris (lihat AMS di routes/shopee.ts)
    if(g==='promosi'){rinci=rinci.filter(x=>!/AMS/.test(x.nama));if(t.afiliasi)rinci.push({nama:'Komisi affiliate (AMS)',jumlah:-t.afiliasi,n:t.n_afiliasi})}
    if(g==='layanan'){
      rinci=rinci.concat(per.gox||[]);
      // API: service_fee = Gratis Ongkir XTRA + Promo XTRA + Live/Video XTRA (+ biaya pembayaran) dalam satu angka
      const sf=api('service_fee'),tf=api('seller_transaction_fee');
      if(sf)rinci.push({nama:'Gratis Ongkir XTRA, Promo XTRA & Live/Video XTRA',jumlah:-Math.abs(sf.jumlah),n:sf.n,ket:'data API Shopee, tidak dirinci per biaya'});
      if(tf)rinci.push({nama:'Biaya transaksi penjual',jumlah:-Math.abs(tf.jumlah),n:tf.n,ket:'data API Shopee'});
    }
    grp=g;
    const buka=phRinciBuka.has(g),ada=rinci.length;
    h+=ada?'<tr class="lr-pos ph-rinci-tog" data-g="'+g+'" style="cursor:pointer" title="Klik untuk '+(buka?'menutup':'melihat')+' rincian"><td class="lr-nm">'+
        '<span style="display:inline-block;width:14px;color:var(--muted)">'+(buka?'▾':'▸')+'</span>'+esc(label)+'<small>'+int(ada)+' rincian · klik untuk '+(buka?'menutup':'melihat')+'</small></td>'+
        '<td class="n">'+lpRp(nilai,0)+'</td><td class="n">'+(harga?lpPct(Math.abs(nilai),harga):'—')+'</td><td class="n">'+(n?rpFull(nilai/n):'—')+'</td></tr>'
      :baris(label,nilai,'lr-pos');
    for(const x of rinci.sort((a,b)=>a.jumlah-b.jumlah))h+=sub(x);
  }
  h+=baris('Total potongan Shopee',phBiaya(t),'lr-sub');
  if(t.isi_saldo)h+=baris(PH_LAIN.isi_saldo,t.isi_saldo,'lr-pos','dipisahkan dari biaya Shopee');
  h+=baris('Penghasilan bersih',t.total||0,'lr-akhir',src.ket&&src.bl.n?src.ket:'');
  if(t.hpp){h+=baris('HPP (dari file Pesanan)',-t.hpp,'lr-pos');h+=baris('Laba kotor (sebelum iklan)',(t.total||0)-t.hpp,'lr-akhir')}
  // Spend iklan Shopee (Shopee › Iklan) di rentang yang sama; isi saldo iklan otomatis sudah bagian dari spend → dikembalikan supaya tidak dobel
  const ik=phData.iklan||{};
  const sampel=(phData.sampel_harian||[]).reduce((a,r)=>a+(r.nilai||0),0);
  if(ik.biaya||ik.laporan||ik.bonus||ik.cpas||sampel){
    const sub=int(ik.laporan)+' laporan iklan · termasuk PPN 11% · menurut tanggal iklan berjalan'+(ik.terpotong?' · '+int(ik.terpotong)+' laporan melewati rentang tidak dihitung':'');
    h+='<tr class="lr-judul"><td colspan="4">Iklan</td></tr>';
    // CPAS (spend Meta untuk penjualan Shopee) menambah spend; bonus proteksi ROAS mengurangi; ik.biaya dari server sudah biaya bersih
    if(ik.cpas){
      h+=baris('Spend iklan Shopee',-((ik.biaya||0)+(ik.bonus||0)-ik.cpas),'lr-pos',sub);
      h+=baris('Iklan CPAS (Meta)',-ik.cpas,'lr-pos','dicatat di Shopee › Iklan · hanya periode di dalam rentang');
      if(ik.bonus)h+=baris('Bonus proteksi ROAS',ik.bonus,'lr-pos','menurut tanggal bonus masuk · dicatat di Shopee › Iklan');
      h+=baris('Spend iklan bersih',-(ik.biaya||0),'lr-pos');
    }else if(ik.bonus){
      h+=baris('Spend iklan Shopee (kotor)',-((ik.biaya||0)+ik.bonus),'lr-pos',sub);
      h+=baris('Bonus proteksi ROAS',ik.bonus,'lr-pos','menurut tanggal bonus masuk · dicatat di Shopee › Iklan');
      h+=baris('Spend iklan bersih',-(ik.biaya||0),'lr-pos');
    }else h+=baris('Spend iklan Shopee',-(ik.biaya||0),'lr-pos',sub);
    if(t.isi_saldo)h+=baris('Isi saldo iklan otomatis (sudah termasuk spend)',-t.isi_saldo,'lr-pos','dikembalikan supaya tidak terhitung dua kali');
    if(sampel)h+=baris('Sampel produk affiliate',-sampel,'lr-pos','HPP + ongkir sampel gratis · menurut tanggal kirim · dicatat di Shopee › Iklan');
    if(t.hpp)h+=baris('Laba setelah iklan',(t.total||0)-(t.isi_saldo||0)-t.hpp-(ik.biaya||0)-sampel,'lr-akhir');
    else h+=baris('Penghasilan setelah iklan',(t.total||0)-(t.isi_saldo||0)-(ik.biaya||0)-sampel,'lr-akhir');
  }
  $('phRinci').innerHTML=n?h+'</tbody></table>':'<p style="color:var(--muted)">Belum ada penghasilan pada rentang ini. Upload laporan <b>Penghasilan Saya → Sudah Dilepas</b>.</p>';
  phRenderAir(t,ik,sampel);
}
/**
 * Grafik air terjun "Perjalanan uang": harga produk → refund/voucher/ongkir → potongan Shopee → penghasilan bersih
 * → HPP → iklan → laba. Langkah dihitung dari angka yang sama dengan tabel Rincian potongan; selisih kecil
 * (mis. isi saldo iklan yang sudah terpotong di penghasilan) masuk "Lainnya" supaya batang selalu tersambung.
 */
let phAirChart=null;
function phRenderAir(t,ik,sampel){
  const card=$('phAirCard'),n=t.n||0;card.hidden=!n||typeof Chart==='undefined';
  if(card.hidden){if(phAirChart){phAirChart.destroy();phAirChart=null}return}
  const harga=t.harga||0,lain=(t.refund||0)+(t.voucher||0)+(t.ongkir||0),biaya=phBiaya(t),bersih=t.total||0;
  const sisa=bersih-harga-lain-biaya,hpp=t.hpp||0,adaIklan=!!(ik.biaya||ik.laporan||ik.bonus||ik.cpas||sampel);
  const akhir=bersih-(adaIklan?(t.isi_saldo||0)+(ik.biaya||0)+sampel:0)-hpp;
  // [label, nilai, jenis] — jenis: total (batang dari 0) | langkah (naik/turun dari batang sebelumnya)
  const L=[['Harga produk',harga,'total']];
  if(lain)L.push(['Refund, voucher & ongkir',lain,'langkah']);
  L.push(['Potongan Shopee',biaya,'langkah']);
  if(Math.round(sisa))L.push(['Lainnya',sisa,'langkah']);
  L.push(['Penghasilan bersih',bersih,'total']);
  if(hpp)L.push(['HPP',-hpp,'langkah']);
  if(adaIklan)L.push(['Iklan',akhir-(bersih-hpp),'langkah']);
  if(hpp||adaIklan)L.push([hpp?(adaIklan?'Laba setelah iklan':'Laba kotor'):'Setelah iklan',akhir,'total']);
  let jalan=0;
  const bar=L.map(([l,v,j])=>{const a=j==='total'?0:jalan,b=j==='total'?v:jalan+v;jalan=b;return {l,v,j,a,b}});
  const rev=css('--rev'),loss=css('--loss'),ink=css('--muted'),line=css('--line');
  const warna=x=>x.j==='total'?(x.l==='Harga produk'?ink:x.v>=0?rev:loss):x.v>=0?rev:loss;
  const jt=v=>(v<0?'− ':'')+rp(Math.abs(v)),pc=v=>harga?' · '+nf.format(Math.round(1000*Math.abs(v)/harga)/10)+'% dari harga':'';
  const labels=bar.map(x=>[x.l,(x.j==='langkah'&&x.v>0?'+ ':'')+jt(x.v)]);
  put('phAirSub','Dari harga produk sampai '+(hpp?'laba':'penghasilan')+(adaIklan?' setelah iklan':'')+' · '+(hpp?'laba '+(akhir<0?'minus ':'')+pc(akhir).slice(3):'HPP belum terhitung')+' · angka sama dengan Rincian potongan di bawah');
  if(phAirChart)phAirChart.destroy();
  phAirChart=new Chart($('phAir'),{type:'bar',
    data:{labels,datasets:[{data:bar.map(x=>[x.a,x.b]),backgroundColor:bar.map(warna),borderRadius:4,borderSkipped:false,barPercentage:.62,categoryPercentage:.9}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>bar[c[0].dataIndex].l,
        label:c=>{const x=bar[c.dataIndex];return ' '+(x.j==='langkah'?(x.v<0?'Mengurangi ':'Menambah ')+rpFull(Math.abs(x.v)):rpFull(x.v))+pc(x.v)}}}},
      scales:{x:{grid:{display:false},ticks:{autoSkip:false,maxRotation:0,font:{size:11}}},
        y:{grid:{color:line},border:{display:false},ticks:{callback:v=>rp(v)}}}}});
}
/** Kanal penjualan Shopee: Ads (laporan iklan, omzet atribusi Shopee menurut tanggal tayang; laporan > 1 hari dibagi rata),
 *  Affiliate (pesanan berkomisi AMS yang dananya sudah dilepas; spending = komisi), Live (belum ada sumber data).
 *  Net = omzet − spending − HPP. HPP Ads diperkirakan dari rasio HPP ÷ harga produk pesanan (Shopee tidak memberi No. Pesanan per iklan). */
let phKanal='ads',phKanalChart=null,phKanalData=null;
try{const k=localStorage.getItem('phKanal');if(k in PH_KANAL)phKanal=k}catch(e){}
$('phKanalSeg').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.k===phKanal);b.onclick=()=>{
  phKanal=b.dataset.k;try{localStorage.setItem('phKanal',phKanal)}catch(e){}
  $('phKanalSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));if(phKanalData)phGambarKanal()}});
// Laporan Live: isi biaya live manual (fee host, iklan live, …) atau hapus laporan
$('phKanalTbl').addEventListener('click',async e=>{
  const bs=e.target.closest('[data-lv-spend]'),bh=e.target.closest('[data-lv-hapus]');if(!bs&&!bh)return;
  const l=(phData.live||[]).find(x=>String(x.id)===(bs||bh).dataset[bs?'lvSpend':'lvHapus']);if(!l)return;
  const hdr={'Content-Type':'application/json'};
  try{
    if(bh){
      if(!confirm('Hapus laporan Live '+l.toko+' '+fmtRange(l.dari,l.sampai)+'? Spending yang sudah diisi ikut terhapus.'))return;
      await api('/api/shopee/live/'+l.id,{method:'DELETE'});
    }else{
      const v=prompt('Total biaya live '+l.toko+' '+fmtRange(l.dari,l.sampai)+' (Rp) — fee host, iklan live, dll:',l.spending?String(l.spending):'');
      if(v==null)return;
      const ket=prompt('Keterangan (opsional), mis. "fee host 2 orang + iklan live":',l.spending_ket||'');
      await api('/api/shopee/live/'+l.id,{method:'PUT',headers:hdr,body:JSON.stringify({spending:spAngka(v),ket:ket||''})});
    }
    loadShpHasil();
  }catch(err){alert('Gagal: '+err.message)}
});
/** Rincian produk satu laporan Live (lipat): terjual, omzet, HPP (terjual × HPP per unit dari pesanan toko), margin */
function phLiveProduk(l,rasioHpp){
  const pr=(l.produk||[]).filter(p=>p.terjual||p.klik);
  if(!pr.length)return '<div style="font-size:12px;color:var(--muted);padding:4px 0 0">Belum ada rincian produk — upload file produk live (Live Streaming › Data › Produk) periode '+esc(fmtRange(l.dari,l.sampai))+'.</div>';
  const jml=pr.reduce((a,p)=>a+p.omzet,0),gap=l.omzet-jml;
  const rows=pr.map(p=>{const asli=p.hpp_unit!=null,hpp=asli?p.terjual*p.hpp_unit:p.omzet*rasioHpp,m=p.omzet-hpp;
    return '<tr><td style="max-width:420px">'+esc(p.produk)+(asli?'':'<small style="color:var(--loss)">nama tidak ditemukan di pesanan toko · HPP perkiraan</small>')+'</td>'+
      '<td class="n">'+int(p.klik)+'</td><td class="n">'+int(p.keranjang)+'</td><td class="n">'+int(p.pesanan)+'</td><td class="n">'+int(p.terjual)+'</td><td class="n">'+rpFull(p.omzet)+'</td>'+
      '<td class="n">'+(asli?rpFull(p.hpp_unit):'—')+'</td><td class="n">'+lpRp(hpp,-1)+'</td><td class="n">'+(p.omzet?nf.format(Math.round(1000*m/p.omzet)/10)+'%':'—')+'</td></tr>'}).join('');
  return '<details style="padding:4px 0 2px"><summary style="cursor:pointer;font-size:12.5px;color:var(--ink-2)">Produk terjual di live ('+int(pr.length)+') · HPP '+rpFull(l.hpp)+'</summary>'+
    '<div class="tbl-wrap"><table class="sku-tbl gd-tbl" style="margin-top:6px"><thead><tr><th>Produk</th><th class="n">Klik</th><th class="n">Keranjang</th><th class="n">Pesanan</th><th class="n">Terjual</th>'+
    '<th class="n">Penjualan</th><th class="n">HPP/unit</th><th class="n">HPP</th><th class="n">Margin kotor</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<p style="font-size:12px;color:var(--muted);margin:6px 0 0">Jumlah penjualan per produk '+rpFull(jml)+(gap?' · selisih '+rpFull(gap)+' dengan omzet overview (voucher tingkat pesanan tidak dibagi ke produk) — omzet kanal tetap dari overview':'')+
    ' · HPP/unit = rata-rata HPP Manajemen SKU pesanan toko dengan nama produk sama, 60 hari sebelum s/d akhir periode.</p></details>';
}
function phHitungKanal(){
  const d=phData,hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const rt=d.total.hpp&&d.total.harga?d.total:(d.acuan&&d.acuan.total)||{},rasioHpp=rt.harga?(rt.hpp||0)/rt.harga:0;
  const kosong=()=>new Map(hari.map(t=>[t,{omzet:0,spend:0,hpp:0,n:0}]));
  const per={ads:kosong(),afiliasi:kosong(),live:kosong()};let rata=false,hppKurang=0;
  // Omzet iklan atribusi Shopee masih termasuk pesanan batal / belum bayar → dikali rasio subtotal pesanan valid di rentang
  const pv=d.pesanan_valid||{},rasioValid=pv.semua?(pv.valid||0)/pv.semua:1;
  // bonus = bonus proteksi ROAS (baris biaya negatif) — tetap mengurangi spending (net), tapi tidak dipakai untuk ROAS
  let bonus=0;
  for(const l of d.iklan_laporan||[]){
    const n=Math.round((new Date(l.sampai+'T00:00:00Z')-new Date(l.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    if((l.biaya||0)<0)bonus-=l.biaya;
    for(let t=l.dari;t<=l.sampai;t=shift(t,1)){const x=per.ads.get(t);if(x){x.omzet+=(l.omzet||0)*rasioValid/n;x.spend+=(l.biaya||0)/n}}
  }
  for(const x of per.ads.values())x.hpp=x.omzet*rasioHpp;
  // Live: laporan = total periode → dibagi rata per hari; hanya hari di dalam rentang yang dihitung.
  // HPP = Σ terjual × HPP per unit produk (file produk live); produk yang tidak cocok / laporan tanpa file produk → omzet × rasio HPP toko.
  for(const l of d.live||[]){
    const n=Math.round((new Date(l.sampai+'T00:00:00Z')-new Date(l.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    const pr=l.produk||[],cocok=pr.filter(p=>p.hpp_unit!=null);
    // Kanal Live memakai pesanan dibuat (sama dengan Laporan › Summary); HPP produk (dari pesanan siap dikirim) diskalakan ke omzet pesanan dibuat
    const hppSiap=pr.length?pr.reduce((s,p)=>s+(p.hpp_unit!=null?p.terjual*p.hpp_unit:p.omzet*rasioHpp),0):(l.omzet||0)*rasioHpp;
    l.hpp=l.omzet?hppSiap*(l.omzet_dibuat||0)/l.omzet:(l.omzet_dibuat||0)*rasioHpp;
    l.hppAsli=pr.length&&cocok.length===pr.filter(p=>p.terjual).length;
    for(let t=l.dari;t<=l.sampai;t=shift(t,1)){const x=per.live.get(t);if(x){x.omzet+=(l.omzet_dibuat||0)/n;x.spend+=(l.spending||0)/n;x.hpp+=l.hpp/n;x.n+=(l.pesanan_dibuat||0)/n}}
  }
  let komisi=0,sampel=0,nSampel=0;
  for(const r of d.afiliasi_harian||[]){const x=per.afiliasi.get(r.tgl);if(x){x.omzet+=r.omzet||0;x.spend+=r.komisi||0;x.hpp+=r.hpp||0;x.n+=r.n||0;komisi+=r.komisi||0}hppKurang+=r.hpp_kurang||0}
  // Sampel produk affiliate (Shopee › Iklan, manual) = spending Affiliate di luar komisi AMS, menurut tanggal kirim
  for(const r of d.sampel_harian||[]){const x=per.afiliasi.get(r.tgl);if(x){x.spend+=r.nilai||0;sampel+=r.nilai||0;nSampel+=r.n||0}}
  const jumlah=m=>[...m.values()].reduce((a,x)=>({omzet:a.omzet+x.omzet,spend:a.spend+x.spend,hpp:a.hpp+x.hpp,n:a.n+x.n}),{omzet:0,spend:0,hpp:0,n:0});
  return {hari,per,rata,rasioHpp,rasioValid,hppKurang,komisi,sampel,nSampel,bonus,ada:{ads:!!(d.iklan_laporan||[]).length,afiliasi:!!((d.afiliasi_harian||[]).length||sampel),live:!!(d.live||[]).length},
    total:{ads:jumlah(per.ads),afiliasi:jumlah(per.afiliasi),live:jumlah(per.live)}};
}
// Mode tabel kanal: 'klaim' = atribusi Shopee apa adanya (beririsan); 'unik' = tiap rupiah omzet masuk satu kanal (jumlah = seluruh pesanan toko)
// Mode default saat halaman dibuka: Tanpa dobel (pilihan Klaim Shopee tidak diingat antar kunjungan)
let phKanalToko=null,phMode='unik';
$('phModeSeg').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.m===phMode);b.onclick=()=>{
  phMode=b.dataset.m;
  $('phModeSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));if(phKanalToko)phRenderKanal(phKanalToko)}});
/** toko = total pesanan toko di Rincian potongan (harga produk & HPP, termasuk estimasi belum dilepas) sebagai pembanding */
function phRenderKanal(toko){
  phKanalToko=toko;
  const k=phKanalData=phHitungKanal(),pct=(a,b)=>b?nf.format(Math.round(1000*a/b)/10)+'%':'—',omzetToko=toko.harga||0;
  const unik=phMode==='unik',t=k.total,u=phBagiUnik(t,toko);k.faktorAds=unik?u.faktorAds:1;
  // Potongan Shopee (Rincian potongan) tanpa komisi affiliate — komisi sudah jadi spending kanal Affiliate — dan biaya lain-lain
  // (pengembalian dana, voucher penjual, selisih ongkir) dibagi ke kanal menurut omzet. Net baris toko = Laba setelah iklan (sudah dikurangi sampel affiliate) − spending live.
  const potongan=Math.max(0,-phBiaya(toko)-k.komisi),lain=-((toko.refund||0)+(toko.voucher||0)+(toko.ongkir||0));
  k.rPot=omzetToko?potongan/omzetToko:0;k.rLain=omzetToko?lain/omzetToko:0;
  // Porsi omzet: mode klaim = ÷ total kanal (Ads + Affiliate + Live, beririsan); mode tanpa dobel = ÷ seluruh pesanan toko. Jumlah porsi 100%.
  const sumK=f=>['ads','afiliasi','live'].reduce((s,c)=>s+(k.ada[c]?t[c][f]:0),0),totalKanal={omzet:sumK('omzet'),spend:sumK('spend'),hpp:sumK('hpp')};
  const dasarPorsi=unik?omzetToko:totalKanal.omzet;
  // ROI = net ÷ spending bersih (setelah bonus proteksi ROAS); ROAS = omzet ÷ biaya iklan kotor (sebelum bonus), standar industri.
  // Bonus proteksi masuk menurut tanggal bonus, jadi bisa lebih besar dari biaya iklan di rentang itu → spending bersih ≤ 0:
  // ROI tidak bermakna dan ditampilkan "—" (bukan angka negatif).
  // Baris tabel juga disimpan ke k.baris untuk Ekspor CSV
  k.baris=[];
  const bonusTeks='Spending bersih ≤ 0: bonus proteksi ROAS '+rpFull(k.bonus)+' (masuk di rentang ini, untuk iklan periode sebelumnya) lebih besar dari biaya iklan di rentang ini';
  const baris=(nama,x,sub,cls,tot)=>{const pot=tot?potongan:x.omzet*k.rPot,ln=tot?lain:x.omzet*k.rLain,net=x.omzet-pot-ln-x.spend-x.hpp;
    const kotor=x.spend+(x.bonus||0),roi=x.spend>0?100*net/x.spend:null,roas=kotor>0?x.omzet/kotor:null;
    k.baris.push({nama,ket:String(sub||'').replace(/<[^>]+>/g,''),omzet:x.omzet,porsi:tot&&!unik?null:(dasarPorsi?100*x.omzet/dasarPorsi:null),pot,ln,spend:x.spend,hpp:x.hpp,net,roi,roas});
    return '<tr class="'+(cls||'')+'"><td class="lr-nm">'+esc(nama)+(sub?'<small>'+sub+'</small>':'')+'</td><td class="n">'+rpFull(x.omzet)+'</td><td class="n">'+(tot&&!unik?'—':pct(x.omzet,dasarPorsi))+'</td>'+
      '<td class="n">'+lpRp(pot,-1)+'</td><td class="n">'+lpRp(ln,-1)+'</td><td class="n">'+lpRp(x.spend,-1)+'</td><td class="n">'+lpRp(x.hpp,-1)+'</td>'+
      '<td class="n"><b>'+lpRp(net,0)+'</b></td><td class="n">'+(roi!=null?'<span class="'+(net<0?'lr-neg':'')+'">'+pct(net,x.spend)+'</span>'
        :x.spend<0?'<span title="'+esc(bonusTeks)+'" style="cursor:help">—<small>bonus &gt; biaya</small></span>':'—')+'</td>'+
      '<td class="n"'+(x.bonus&&roas!=null?' title="Omzet ÷ biaya iklan '+esc(rpFull(kotor))+' sebelum dikurangi bonus proteksi ROAS"':'')+'>'+(roas!=null?nf.format(Math.round(10*roas)/10)+'×':'—')+'</td></tr>'};
  const kosong=(nama,ket)=>'<tr><td class="lr-nm">'+esc(nama)+'</td><td colspan="9" style="color:var(--muted)">'+ket+'</td></tr>';
  const semua={omzet:omzetToko,spend:t.ads.spend+t.afiliasi.spend+t.live.spend,hpp:toko.hpp||0,bonus:k.bonus};
  t.ads.bonus=u.ads.bonus=k.bonus;
  let h='';
  // Peringatan irisan (mode klaim): Shopee mengatribusikan pesanan ke iklan bila pembeli pernah klik iklan, termasuk yang akhirnya checkout di live
  if(!unik&&k.ada.live&&k.ada.ads)h+='<div class="ob-warn" style="margin-bottom:12px"><p><b>Omzet Live ikut terhitung di omzet Ads.</b> Shopee mengakui pesanan dari pembeli yang pernah mengklik iklan sebagai hasil iklan, '+
    'termasuk yang akhirnya checkout di live — jadi sebagian besar omzet Live ('+rpFull(t.live.omzet)+') kemungkinan sudah ada di omzet Ads ('+rpFull(t.ads.omzet)+'). '+
    'Jangan menjumlah Ads + Live (juga Affiliate) sebagai omzet toko — pilih <b>Tanpa dobel</b> untuk pembagian yang bisa dijumlah.</p></div>';
  h+='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Kanal</th><th class="n">Omzet</th><th class="n">Porsi omzet</th>'+
    '<th class="n" title="Biaya platform, layanan, promosi (tanpa komisi affiliate), pajak, lainnya — dibagi menurut omzet ('+pct(k.rPot,1)+')">Potongan Shopee</th>'+
    '<th class="n" title="Pengembalian dana, voucher penjual, selisih ongkir — dibagi menurut omzet ('+pct(k.rLain,1)+')">Biaya lain-lain</th>'+
    '<th class="n">Spending</th><th class="n">HPP</th><th class="n">Net</th><th class="n" title="ROI = net ÷ spending bersih (setelah bonus proteksi ROAS)">ROI</th><th class="n" title="ROAS = omzet ÷ biaya iklan sebelum dikurangi bonus proteksi ROAS">ROAS</th></tr></thead><tbody>';
  h+=k.ada.ads?baris('Ads',unik?u.ads:t.ads,(unik?'sisa omzet toko setelah affiliate & live, maksimal klaim Shopee '+rpFull(t.ads.omzet)
      :'omzet atribusi Shopee × '+pct(k.rasioValid,1)+' pesanan tidak batal')+' · HPP perkiraan '+pct(k.rasioHpp,1)+' dari omzet'+(k.rata?' · laporan > 1 hari dibagi rata':''))
    :kosong('Ads','Belum ada laporan iklan yang seluruh periodenya di dalam rentang ini — upload / sinkron di Shopee › Iklan.');
  h+=k.ada.afiliasi?baris('Affiliate',t.afiliasi,int(t.afiliasi.n)+' pesanan berkomisi AMS · spending = komisi affiliate '+rpFull(k.komisi)+
      (k.sampel?' + sampel produk '+rpFull(k.sampel)+' ('+int(k.nSampel)+' kiriman)':'')+(k.hppKurang?' · HPP '+int(k.hppKurang)+' pesanan belum lengkap':''))
    :kosong('Affiliate','Belum ada pesanan berkomisi affiliate (AMS) yang dananya sudah dilepas pada rentang ini.');
  const lv=phData.live||[],terpotong=lv.some(l=>l.dari<phData.from||l.sampai>phData.to),tanpaSpend=lv.filter(l=>!l.spending).length;
  const hppTeks=lv.every(l=>l.hppAsli)?'HPP dari produk terjual di live':lv.some(l=>(l.produk||[]).length)?'HPP dari produk terjual (sebagian perkiraan '+pct(k.rasioHpp,1)+')':'HPP perkiraan '+pct(k.rasioHpp,1)+' dari omzet — upload file produk live untuk HPP asli';
  h+=k.ada.live?baris('Live',t.live,int(Math.round(t.live.n))+' pesanan dibuat · '+hppTeks+(!unik&&k.ada.ads?' · <b style="color:var(--loss)">sebagian besar juga terhitung di omzet Ads</b>':'')+
      (terpotong?' · laporan yang melewati rentang dihitung sebagian (dibagi rata per hari)':'')+(tanpaSpend?' · <b style="color:var(--loss)">'+int(tanpaSpend)+' laporan belum diisi spending</b>':''))
    :kosong('Live','Belum ada laporan Live di rentang ini — klik Upload file lalu pilih ekspor Shopee Live (Live Streaming › Data).');
  if(lv.length)h+='<tr><td colspan="10" style="padding:0 12px 10px 28px">'+lv.map(l=>'<div class="lv-lap" style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;color:var(--muted);padding-top:6px">'+
      '<span><b style="color:var(--ink)">'+esc(l.toko)+'</b> · '+esc(fmtRange(l.dari,l.sampai))+'</span><span>omzet '+rpFull(l.omzet_dibuat||0)+' · '+int(l.pesanan_dibuat||0)+' pesanan dibuat ('+int(l.pesanan)+' siap dikirim) · '+int(l.sesi)+' sesi ('+liveDurasi(l.durasi_detik)+')</span>'+
      '<span>spending <b style="color:var(--ink)">'+rpFull(l.spending)+'</b>'+(l.spending_ket?' · '+esc(l.spending_ket):'')+'</span>'+
      '<button class="btn ghost" data-lv-spend="'+l.id+'" style="padding:3px 9px;font-size:12px">Spending</button>'+
      '<button class="btn ghost" data-lv-hapus="'+l.id+'" style="padding:3px 9px;font-size:12px;color:var(--loss)">Hapus</button></div>'+phLiveProduk(l,k.rasioHpp)).join('')+'</td></tr>';
  if(unik){
    h+=baris('Organik / lainnya',u.organik,'sisa omzet toko yang tidak masuk affiliate, live, maupun klaim iklan · tanpa spending · HPP = HPP toko − kanal lain');
    h+=baris('Total = seluruh pesanan toko',semua,'Affiliate + Live + Ads + Organik · net = Laba setelah iklan di Rincian potongan'+(t.live.spend?' − spending live (biaya di luar Shopee)':'')+
      ' · prioritas: Affiliate (pasti per pesanan) → Live → Ads → Organik; pesanan affiliate lewat live masuk Affiliate','lr-akhir',1);
  }else{
    h+=baris('Seluruh pesanan toko',semua,'pembanding: net = Laba setelah iklan di Rincian potongan'+(t.live.spend?' − spending live (biaya di luar Shopee)':'')+
      ' · spending = iklan + komisi & sampel affiliate + live','lr-akhir',1);
  }
  $('phKanalTbl').innerHTML=h+'</tbody></table>';
  put('phKanalSub',(unik?'Tanpa dobel: tiap rupiah omzet masuk satu kanal':'Angka atribusi Shopee (beririsan)')+' · net = omzet − potongan Shopee − biaya lain-lain − spending − HPP · ROI = net ÷ spending bersih · ROAS = omzet ÷ biaya iklan sebelum bonus proteksi · Ads menurut tanggal iklan tayang · Affiliate menurut '+
    (phData.basis==='dilepas'?'tanggal dana dilepas':'tanggal pesanan dibuat (hanya yang dananya sudah dilepas)'));
  phGambarKanal();
}
function phGambarKanal(){
  if(typeof Chart==='undefined')return;
  // Mode tanpa dobel: omzet & HPP Ads per hari diskalakan dengan faktor yang sama dengan tabel
  const k=phKanalData,f=phKanal==='ads'?(k.faktorAds??1):1,rinci=k.hari.map(t=>{const x=k.per[phKanal].get(t);return {omzet:x.omzet*f,spend:x.spend,hpp:x.hpp*f}});
  // Potongan Shopee & biaya lain-lain per hari = omzet × rasio yang sama dengan tabel
  for(const x of rinci){x.pot=x.omzet*(k.rPot||0);x.lain=x.omzet*(k.rLain||0)}
  const data=[rinci.map(x=>Math.round(x.omzet)),rinci.map(x=>-Math.round(x.spend)),rinci.map(x=>Math.round(x.omzet-x.pot-x.lain-x.spend-x.hpp))];
  const labels=k.hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  put('phKanalP',PH_KANAL[phKanal]+' · batang = omzet & spending · garis = net (omzet − spending − HPP)'+
    (phKanal==='live'?(k.ada.live?' · laporan live dibagi rata per hari periode laporan':' · belum ada data Live'):''));
  if(phKanalChart){phKanalChart.data.labels=labels;data.forEach((x,i)=>phKanalChart.data.datasets[i].data=x);phKanalChart.$rinci=rinci;phKanalChart.update();return}
  phKanalChart=new Chart($('phKanal'),{type:'bar',
    data:{labels,datasets:[{label:'Omzet',data:data[0],backgroundColor:css('--rev'),borderRadius:3,stack:'s',order:2},
      {label:'Spending',data:data[1],backgroundColor:css('--loss'),borderRadius:3,stack:'s',order:2},
      {type:'line',label:'Net',data:data[2],borderColor:css('--ink')||'#334',backgroundColor:css('--ink')||'#334',borderWidth:2,pointRadius:2,tension:.3,stack:'net',order:1}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+rpFull(c.datasetIndex===1?-c.raw:c.raw),
          afterBody:it=>{const x=(phKanalChart.$rinci||[])[it[0].dataIndex];return x&&x.omzet?['Potongan Shopee: −'+rpFull(x.pot),'Biaya lain-lain: −'+rpFull(x.lain),'HPP: −'+rpFull(x.hpp)]:[]}}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},ticks:{callback:v=>rp(v)}}}}});
  phKanalChart.$rinci=rinci;
}
async function phMuatDaftar(tambah){
  if(!tambah){phRows=[];phTotal=0}
  const q=phQuery(),c=$('phCari').value.trim();if(c)q.set('q',c);q.set('offset',String(phRows.length));
  const h=await api('/api/shopee/penghasilan/daftar?'+q);
  phRows=phRows.concat(h.rows);phTotal=h.total;
  if(phTab==='pesanan')phRenderTab();
}
const phLaba=(total,hpp)=>hpp?total-hpp:null;
function phRenderTab(){
  const d=phData,kosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+t+'</td></tr>';
  $('phTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===phTab));
  $('phCariWrap').hidden=phTab!=='pesanan';$('phMore').hidden=true;
  const labaTd=(laba,harga,hppKurang)=>laba==null?'<td class="n"><span style="color:var(--muted)">—</span></td><td class="n">—</td>'
    :'<td class="n">'+lpRp(laba,0)+(hppKurang?'<small>HPP belum lengkap</small>':'')+'</td><td class="n">'+lpPct(laba,harga)+'</td>';
  if(phTab==='pesanan'){
    put('phSub','Per pesanan, urut tanggal '+(d.basis!=='dilepas'?'pesanan dibuat':'dana dilepas')+' · potongan = biaya Shopee · laba = penghasilan bersih − HPP');
    $('phIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pesanan</th><th>Toko</th><th>Produk</th><th>Dilepas</th><th class="n">Harga produk</th><th class="n">Potongan</th><th class="n">Penghasilan</th><th class="n">HPP</th><th class="n">Laba</th><th class="n">Margin</th></tr></thead><tbody>'+
      (phRows.map(r=>{
        const biaya=r.biaya_platform+r.biaya_gox+r.biaya_layanan+r.biaya_promosi+r.biaya_lainnya+r.pajak;
        const produk=r.items.length?r.items.map(i=>esc(i.qty+'× '+(i.nama||'?')+(i.variasi?' ('+i.variasi+')':''))+'<small class="mm-sub">'+esc(i.sku||'tanpa SKU')+'</small>').join('')
          :r.produk.map(p=>esc(p.nama||'?')).join('<br>')+'<small class="mm-sub">file Pesanan belum di-upload</small>';
        return '<tr><td class="lr-nm"><b>'+esc(r.no_pesanan)+'</b>'+tkTagSumber(r.sumber)+'<small>dibuat '+esc(r.dibuat?tglWib(r.dibuat.slice(0,10)+'T12:00:00+07:00'):'—')+'</small></td><td>'+esc(r.toko)+'</td>'+
          '<td class="sh">'+produk+'</td><td>'+esc(tglWib(r.dilepas+'T12:00:00+07:00'))+'</td><td class="n">'+rpFull(r.harga_produk)+'</td>'+
          '<td class="n">'+lpRp(biaya,0)+'<small>'+lpPct(-biaya,r.harga_produk)+'</small></td><td class="n"><b>'+rpFull(r.total)+'</b></td>'+
          '<td class="n">'+(r.hpp?rpFull(r.hpp):'<span style="color:var(--muted)">—</span>')+'</td>'+labaTd(phLaba(r.total,r.hpp),r.harga_produk,r.sku_kosong)+'</tr>'}).join('')||
        kosong(10,'Belum ada penghasilan pada rentang / filter ini.'))+'</tbody></table>';
    $('phMore').hidden=phRows.length>=phTotal;put('phMoreBtn','Tampilkan lebih banyak ('+int(phTotal-phRows.length)+' lagi)');
  }else if(phTab==='produk'){
    put('phSub','Penghasilan pesanan dibagi ke produknya menurut porsi harga di file Pesanan · HPP dari Manajemen SKU');
    const rows=d.per_sku.map(r=>'<tr><td class="nm">'+esc(r.sku||'(kosong)')+'</td><td class="lr-nm">'+esc(r.nama||'—')+(r.sku_id?'':'<small><span class="tag warn">SKU belum ada di Manajemen SKU</span></small>')+'</td>'+
      '<td class="n">'+int(r.pesanan)+'</td><td class="n">'+int(r.qty)+'</td><td class="n">'+rpFull(r.harga)+'</td><td class="n">'+lpRp(r.biaya,0)+'<small>'+lpPct(-r.biaya,r.harga)+'</small></td>'+
      '<td class="n"><b>'+rpFull(r.total)+'</b></td><td class="n">'+(r.hpp?rpFull(r.hpp):'—')+'</td>'+labaTd(phLaba(r.total,r.hpp),r.harga,!r.sku_id)+'</tr>');
    const tanpa=d.tanpa_pesanan.map(r=>'<tr><td class="nm" style="color:var(--muted)">—</td><td class="lr-nm">'+esc(r.nama)+'<small><span class="tag warn">file Pesanan belum di-upload</span></small></td>'+
      '<td class="n">'+int(r.pesanan)+'</td><td class="n">—</td><td class="n">'+rpFull(r.harga)+'</td><td class="n">'+lpRp(r.biaya,0)+'<small>'+lpPct(-r.biaya,r.harga)+'</small></td>'+
      '<td class="n"><b>'+rpFull(r.total)+'</b></td><td class="n">—</td><td class="n">—</td><td class="n">—</td></tr>');
    $('phIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>SKU</th><th>Produk</th><th class="n">Pesanan</th><th class="n">Pcs</th><th class="n">Harga produk</th><th class="n">Potongan</th><th class="n">Penghasilan</th><th class="n">HPP</th><th class="n">Laba</th><th class="n">Margin</th></tr></thead><tbody>'+
      (rows.concat(tanpa).join('')||kosong(10,'Belum ada penghasilan pada rentang ini.'))+'</tbody></table>';
  }else{
    put('phSub','Per toko · potongan = biaya Shopee · laba = penghasilan bersih − HPP (belum termasuk iklan)');
    const nama=new Map(spToko.toko.map(t=>[t.id,t.nama]));
    $('phIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th class="n">Pesanan</th><th class="n">Harga produk</th><th class="n">Potongan</th><th class="n">Penghasilan</th><th class="n">HPP</th><th class="n">Laba</th><th class="n">Margin</th></tr></thead><tbody>'+
      (d.per_toko.slice().sort((a,b)=>b.total-a.total).map(r=>{const b=phBiaya(r);
        return '<tr><td class="nm">'+esc(nama.get(r.toko_id)||'?')+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+rpFull(r.harga)+'</td><td class="n">'+lpRp(b,0)+'<small>'+lpPct(-b,r.harga)+'</small></td>'+
          '<td class="n"><b>'+rpFull(r.total)+'</b></td><td class="n">'+(r.hpp?rpFull(r.hpp):'—')+'</td>'+labaTd(phLaba(r.total,r.hpp),r.harga,r.tanpa_pesanan||r.sku_kosong)+'</tr>'}).join('')||
        kosong(8,'Belum ada penghasilan pada rentang ini.'))+'</tbody></table>';
  }
}
$('phRange').addEventListener('click',e=>{if(e.target.closest('button'))loadShpHasil()});
$('phToko').addEventListener('change',loadShpHasil);
$('phBasis').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.dataset.basis===phBasis)return;
  phBasis=b.dataset.basis;try{localStorage.setItem('phBasis',phBasis)}catch(err){}loadShpHasil()});
$('phTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!phData)return;phTab=b.dataset.tab;phRenderTab()});
$('phCari').addEventListener('input',()=>{clearTimeout(phCariT);phCariT=setTimeout(()=>{if(phData)phMuatDaftar(false).catch(err=>alert(err.message))},350)});
$('phMoreBtn').addEventListener('click',()=>phMuatDaftar(true).catch(err=>alert(err.message)));
$('phExport').addEventListener('click',async()=>{
  if(!phData)return;const d=phData,akhir='-'+d.from+'_'+d.to+'.csv',nama=new Map(spToko.toko.map(t=>[t.id,t.nama]));
  if(phTab==='produk')return unduhCsv('shopee-penghasilan-per-produk'+akhir,['SKU','Produk','Pesanan','Pcs','Harga produk','Potongan Shopee','Penghasilan bersih','HPP','Laba'],
    d.per_sku.map(r=>[r.sku,r.nama,r.pesanan,r.qty,Math.round(r.harga),Math.round(r.biaya),Math.round(r.total),r.hpp||'',r.hpp?Math.round(r.total-r.hpp):''])
      .concat(d.tanpa_pesanan.map(r=>['',r.nama+' (file Pesanan belum di-upload)',r.pesanan,'',r.harga,r.biaya,r.total,'',''])));
  if(phTab==='toko')return unduhCsv('shopee-penghasilan-per-toko'+akhir,['Toko','Pesanan','Harga produk','Potongan Shopee','Penghasilan bersih','HPP','Laba'],
    d.per_toko.map(r=>[nama.get(r.toko_id)||'?',r.n,r.harga,phBiaya(r),r.total,r.hpp||'',r.hpp?r.total-r.hpp:'']));
  try{while(phRows.length<phTotal&&phRows.length<20000)await phMuatDaftar(true)}catch(err){alert(err.message);return}
  unduhCsv('shopee-penghasilan'+akhir,['No. Pesanan','Toko','Dibuat','Dana dilepas','Tipe','Produk','Harga produk','Pengembalian dana','Ongkir','Voucher penjual',
    'Biaya Platform','Biaya Gratis Ongkir XTRA','Biaya Layanan','Biaya Promosi','Biaya Lainnya','Pajak','Isi saldo iklan','Penghasilan bersih','HPP','Laba'],
    phRows.map(r=>[r.no_pesanan,r.toko,r.dibuat||'',r.dilepas,r.tipe_pesanan||'',(r.items.length?r.items.map(i=>i.qty+'x '+i.nama):r.produk.map(p=>p.nama)).join(' + '),
      r.harga_produk,r.refund,r.ongkir,r.voucher,r.biaya_platform,r.biaya_gox,r.biaya_layanan,r.biaya_promosi,r.biaya_lainnya,r.pajak,r.isi_saldo_iklan,r.total,r.hpp||'',r.hpp?r.total-r.hpp:'']));
});
// Ekspor kartu "Omzet, spending & net per kanal": tabel per kanal (mode yang sedang dipilih) & per hari semua kanal
$('phKanalExport').addEventListener('click',()=>{
  const k=phKanalData;if(!k||!k.baris)return;const r=Math.round;
  unduhCsv('shopee-kanal-'+(phMode==='unik'?'tanpa-dobel':'klaim-shopee')+'-'+phData.from+'_'+phData.to+'.csv',
    ['Kanal','Keterangan','Omzet','Porsi omzet (%)','Potongan Shopee','Biaya lain-lain','Spending','HPP','Net','ROI (%)','ROAS'],
    k.baris.map(x=>[x.nama,x.ket,r(x.omzet),x.porsi==null?'':x.porsi.toFixed(1),r(x.pot),r(x.ln),r(x.spend),r(x.hpp),r(x.net),
      x.roi!=null?x.roi.toFixed(1):'',x.roas!=null?x.roas.toFixed(2):'']));
});
$('phKanalHarianExport').addEventListener('click',()=>{
  const k=phKanalData;if(!k)return;const r=Math.round,kanal=['ads','afiliasi','live'],H=[];
  for(const c of kanal)H.push(PH_KANAL[c]+' omzet',PH_KANAL[c]+' spending',PH_KANAL[c]+' net');
  // Sama dengan grafik: omzet & HPP Ads diskalakan faktor mode tanpa dobel; net = omzet − potongan − biaya lain-lain − spending − HPP
  unduhCsv('shopee-kanal-per-hari-'+phData.from+'_'+phData.to+'.csv',['Tanggal',...H],k.hari.map(t=>[t,...kanal.flatMap(c=>{
    const x=k.per[c].get(t),f=c==='ads'?(k.faktorAds??1):1,o=x.omzet*f;
    return [r(o),r(x.spend),r(o-o*(k.rPot||0)-o*(k.rLain||0)-x.spend-x.hpp*f)]})]));
});
