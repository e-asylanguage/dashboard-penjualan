/**
 * Shopee › Penghasilan: dana dilepas per pesanan (API + upload "Penghasilan Saya"), basis tgl dibuat / dilepas / dari iklan,
 * rincian potongan, kanal Ads / Affiliate / Live (+ laporan Live), tabel per pesanan / produk / toko.
 * Data: /api/shopee/penghasilan, /penghasilan/daftar, /api/shopee/toko, /api/shopee/live/:id.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*):
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
    phData=d;spToko=t;renderShpHasil();tkMuat('ph');await phMuatDaftar(false);
  }catch(e){$('phIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{phBusy=false}
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
  put('phK1',rpFull(t.total||0));put('phK1D',n?int(n)+' pesanan · rata-rata '+rpFull((t.total||0)/n)+' / pesanan'+(est&&bl.n?' · estimasi':''):'belum ada data');
  $('phK2').innerHTML=lpRp(biaya,0);put('phK2D',lpPct(-biaya,t.harga)+' dari harga produk · '+(n?rpFull(-biaya/n)+' / pesanan':'—')+(t.afiliasi?' · komisi affiliate '+rpFull(t.afiliasi)+' ('+int(t.n_afiliasi)+' pesanan)':''));
  put('phK3',rpFull(t.harga||0));put('phK3D',(t.refund?'pengembalian dana '+rpFull(-t.refund)+' · ':'')+(t.voucher?'voucher penjual '+rpFull(-t.voucher):'tanpa voucher penjual'));
  const spend=(d.iklan||{}).biaya||0,labaIk=laba-(t.isi_saldo||0)-spend;   // isi saldo iklan sudah bagian dari spend
  $('phK4').innerHTML=n&&t.hpp?lpRp(iklanMode?labaIk:laba,0):'—';
  put('phK4D',!n?'—':!t.hpp?'HPP belum terhitung — upload file Pesanan & lengkapi SKU':iklanMode?'setelah spend iklan '+rpFull(spend)+' · margin '+lpPct(labaIk,t.harga)+(hppLengkap?'':' · HPP belum lengkap')
    :'margin '+lpPct(laba,t.harga)+' dari harga produk'+(hppLengkap?'':' · HPP belum lengkap')+' · belum termasuk iklan');
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
  if(ik.biaya||ik.laporan){
    const sub=int(ik.laporan)+' laporan iklan · menurut tanggal iklan berjalan'+(ik.terpotong?' · '+int(ik.terpotong)+' laporan melewati rentang tidak dihitung':'');
    h+='<tr class="lr-judul"><td colspan="4">Iklan</td></tr>';
    h+=baris('Spend iklan Shopee',-(ik.biaya||0),'lr-pos',sub);
    if(t.isi_saldo)h+=baris('Isi saldo iklan otomatis (sudah termasuk spend)',-t.isi_saldo,'lr-pos','dikembalikan supaya tidak terhitung dua kali');
    if(t.hpp)h+=baris('Laba setelah iklan',(t.total||0)-(t.isi_saldo||0)-t.hpp-(ik.biaya||0),'lr-akhir');
    else h+=baris('Penghasilan setelah iklan',(t.total||0)-(t.isi_saldo||0)-(ik.biaya||0),'lr-akhir');
  }
  $('phRinci').innerHTML=n?h+'</tbody></table>':'<p style="color:var(--muted)">Belum ada penghasilan pada rentang ini. Upload laporan <b>Penghasilan Saya → Sudah Dilepas</b>.</p>';
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
  for(const l of d.iklan_laporan||[]){
    const n=Math.round((new Date(l.sampai+'T00:00:00Z')-new Date(l.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    for(let t=l.dari;t<=l.sampai;t=shift(t,1)){const x=per.ads.get(t);if(x){x.omzet+=(l.omzet||0)*rasioValid/n;x.spend+=(l.biaya||0)/n}}
  }
  for(const x of per.ads.values())x.hpp=x.omzet*rasioHpp;
  // Live: laporan = total periode → dibagi rata per hari; hanya hari di dalam rentang yang dihitung.
  // HPP = Σ terjual × HPP per unit produk (file produk live); produk yang tidak cocok / laporan tanpa file produk → omzet × rasio HPP toko.
  for(const l of d.live||[]){
    const n=Math.round((new Date(l.sampai+'T00:00:00Z')-new Date(l.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    const pr=l.produk||[],cocok=pr.filter(p=>p.hpp_unit!=null);
    l.hpp=pr.length?pr.reduce((s,p)=>s+(p.hpp_unit!=null?p.terjual*p.hpp_unit:p.omzet*rasioHpp),0):(l.omzet||0)*rasioHpp;
    l.hppAsli=pr.length&&cocok.length===pr.filter(p=>p.terjual).length;
    for(let t=l.dari;t<=l.sampai;t=shift(t,1)){const x=per.live.get(t);if(x){x.omzet+=(l.omzet||0)/n;x.spend+=(l.spending||0)/n;x.hpp+=l.hpp/n;x.n+=(l.pesanan||0)/n}}
  }
  for(const r of d.afiliasi_harian||[]){const x=per.afiliasi.get(r.tgl);if(x){x.omzet+=r.omzet||0;x.spend+=r.komisi||0;x.hpp+=r.hpp||0;x.n+=r.n||0}hppKurang+=r.hpp_kurang||0}
  const jumlah=m=>[...m.values()].reduce((a,x)=>({omzet:a.omzet+x.omzet,spend:a.spend+x.spend,hpp:a.hpp+x.hpp,n:a.n+x.n}),{omzet:0,spend:0,hpp:0,n:0});
  return {hari,per,rata,rasioHpp,rasioValid,hppKurang,ada:{ads:!!(d.iklan_laporan||[]).length,afiliasi:!!(d.afiliasi_harian||[]).length,live:!!(d.live||[]).length},
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
  // (pengembalian dana, voucher penjual, selisih ongkir) dibagi ke kanal menurut omzet. Net baris toko = Laba setelah iklan − spending live.
  const potongan=Math.max(0,-phBiaya(toko)-t.afiliasi.spend),lain=-((toko.refund||0)+(toko.voucher||0)+(toko.ongkir||0));
  k.rPot=omzetToko?potongan/omzetToko:0;k.rLain=omzetToko?lain/omzetToko:0;
  // Porsi omzet: mode klaim = ÷ total kanal (Ads + Affiliate + Live, beririsan); mode tanpa dobel = ÷ seluruh pesanan toko. Jumlah porsi 100%.
  const sumK=f=>['ads','afiliasi','live'].reduce((s,c)=>s+(k.ada[c]?t[c][f]:0),0),totalKanal={omzet:sumK('omzet'),spend:sumK('spend'),hpp:sumK('hpp')};
  const dasarPorsi=unik?omzetToko:totalKanal.omzet;
  // ROI = net ÷ spending (laba bersih per Rp1 spending); ROAS = omzet ÷ spending
  const baris=(nama,x,sub,cls,tot)=>{const pot=tot?potongan:x.omzet*k.rPot,ln=tot?lain:x.omzet*k.rLain,net=x.omzet-pot-ln-x.spend-x.hpp;
    return '<tr class="'+(cls||'')+'"><td class="lr-nm">'+esc(nama)+(sub?'<small>'+sub+'</small>':'')+'</td><td class="n">'+rpFull(x.omzet)+'</td><td class="n">'+(tot&&!unik?'—':pct(x.omzet,dasarPorsi))+'</td>'+
      '<td class="n">'+lpRp(pot,-1)+'</td><td class="n">'+lpRp(ln,-1)+'</td><td class="n">'+lpRp(x.spend,-1)+'</td><td class="n">'+lpRp(x.hpp,-1)+'</td>'+
      '<td class="n"><b>'+lpRp(net,0)+'</b></td><td class="n">'+(x.spend?'<span class="'+(net<0?'lr-neg':'')+'">'+pct(net,x.spend)+'</span>':'—')+'</td>'+
      '<td class="n">'+(x.spend?nf.format(Math.round(10*x.omzet/x.spend)/10)+'×':'—')+'</td></tr>'};
  const kosong=(nama,ket)=>'<tr><td class="lr-nm">'+esc(nama)+'</td><td colspan="9" style="color:var(--muted)">'+ket+'</td></tr>';
  const semua={omzet:omzetToko,spend:t.ads.spend+t.afiliasi.spend+t.live.spend,hpp:toko.hpp||0};
  let h='';
  // Peringatan irisan (mode klaim): Shopee mengatribusikan pesanan ke iklan bila pembeli pernah klik iklan, termasuk yang akhirnya checkout di live
  if(!unik&&k.ada.live&&k.ada.ads)h+='<div class="ob-warn" style="margin-bottom:12px"><p><b>Omzet Live ikut terhitung di omzet Ads.</b> Shopee mengakui pesanan dari pembeli yang pernah mengklik iklan sebagai hasil iklan, '+
    'termasuk yang akhirnya checkout di live — jadi sebagian besar omzet Live ('+rpFull(t.live.omzet)+') kemungkinan sudah ada di omzet Ads ('+rpFull(t.ads.omzet)+'). '+
    'Jangan menjumlah Ads + Live (juga Affiliate) sebagai omzet toko — pilih <b>Tanpa dobel</b> untuk pembagian yang bisa dijumlah.</p></div>';
  h+='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Kanal</th><th class="n">Omzet</th><th class="n">Porsi omzet</th>'+
    '<th class="n" title="Biaya platform, layanan, promosi (tanpa komisi affiliate), pajak, lainnya — dibagi menurut omzet ('+pct(k.rPot,1)+')">Potongan Shopee</th>'+
    '<th class="n" title="Pengembalian dana, voucher penjual, selisih ongkir — dibagi menurut omzet ('+pct(k.rLain,1)+')">Biaya lain-lain</th>'+
    '<th class="n">Spending</th><th class="n">HPP</th><th class="n">Net</th><th class="n" title="ROI = net ÷ spending">ROI</th><th class="n" title="ROAS = omzet ÷ spending">ROAS</th></tr></thead><tbody>';
  h+=k.ada.ads?baris('Ads',unik?u.ads:t.ads,(unik?'sisa omzet toko setelah affiliate & live, maksimal klaim Shopee '+rpFull(t.ads.omzet)
      :'omzet atribusi Shopee × '+pct(k.rasioValid,1)+' pesanan tidak batal')+' · HPP perkiraan '+pct(k.rasioHpp,1)+' dari omzet'+(k.rata?' · laporan > 1 hari dibagi rata':''))
    :kosong('Ads','Belum ada laporan iklan yang seluruh periodenya di dalam rentang ini — upload / sinkron di Shopee › Iklan.');
  h+=k.ada.afiliasi?baris('Affiliate',t.afiliasi,int(t.afiliasi.n)+' pesanan berkomisi AMS · spending = komisi affiliate'+(k.hppKurang?' · HPP '+int(k.hppKurang)+' pesanan belum lengkap':''))
    :kosong('Affiliate','Belum ada pesanan berkomisi affiliate (AMS) yang dananya sudah dilepas pada rentang ini.');
  const lv=phData.live||[],terpotong=lv.some(l=>l.dari<phData.from||l.sampai>phData.to),tanpaSpend=lv.filter(l=>!l.spending).length;
  const hppTeks=lv.every(l=>l.hppAsli)?'HPP dari produk terjual di live':lv.some(l=>(l.produk||[]).length)?'HPP dari produk terjual (sebagian perkiraan '+pct(k.rasioHpp,1)+')':'HPP perkiraan '+pct(k.rasioHpp,1)+' dari omzet — upload file produk live untuk HPP asli';
  h+=k.ada.live?baris('Live',t.live,int(Math.round(t.live.n))+' pesanan siap dikirim · '+hppTeks+(!unik&&k.ada.ads?' · <b style="color:var(--loss)">sebagian besar juga terhitung di omzet Ads</b>':'')+
      (terpotong?' · laporan yang melewati rentang dihitung sebagian (dibagi rata per hari)':'')+(tanpaSpend?' · <b style="color:var(--loss)">'+int(tanpaSpend)+' laporan belum diisi spending</b>':''))
    :kosong('Live','Belum ada laporan Live di rentang ini — klik Upload file lalu pilih ekspor Shopee Live (Live Streaming › Data).');
  if(lv.length)h+='<tr><td colspan="10" style="padding:0 12px 10px 28px">'+lv.map(l=>'<div class="lv-lap" style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;color:var(--muted);padding-top:6px">'+
      '<span><b style="color:var(--ink)">'+esc(l.toko)+'</b> · '+esc(fmtRange(l.dari,l.sampai))+'</span><span>omzet '+rpFull(l.omzet)+' · '+int(l.pesanan)+' pesanan · '+int(l.sesi)+' sesi ('+liveDurasi(l.durasi_detik)+')</span>'+
      '<span>spending <b style="color:var(--ink)">'+rpFull(l.spending)+'</b>'+(l.spending_ket?' · '+esc(l.spending_ket):'')+'</span>'+
      '<button class="btn ghost" data-lv-spend="'+l.id+'" style="padding:3px 9px;font-size:12px">Spending</button>'+
      '<button class="btn ghost" data-lv-hapus="'+l.id+'" style="padding:3px 9px;font-size:12px;color:var(--loss)">Hapus</button></div>'+phLiveProduk(l,k.rasioHpp)).join('')+'</td></tr>';
  if(unik){
    h+=baris('Organik / lainnya',u.organik,'sisa omzet toko yang tidak masuk affiliate, live, maupun klaim iklan · tanpa spending · HPP = HPP toko − kanal lain');
    h+=baris('Total = seluruh pesanan toko',semua,'Affiliate + Live + Ads + Organik · net = Laba setelah iklan di Rincian potongan'+(t.live.spend?' − spending live (biaya di luar Shopee)':'')+
      ' · prioritas: Affiliate (pasti per pesanan) → Live → Ads → Organik; pesanan affiliate lewat live masuk Affiliate','lr-akhir',1);
  }else{
    h+=baris('Seluruh pesanan toko',semua,'pembanding: net = Laba setelah iklan di Rincian potongan'+(t.live.spend?' − spending live (biaya di luar Shopee)':'')+
      ' · spending = iklan + komisi affiliate + live','lr-akhir',1);
  }
  $('phKanalTbl').innerHTML=h+'</tbody></table>';
  put('phKanalSub',(unik?'Tanpa dobel: tiap rupiah omzet masuk satu kanal':'Angka atribusi Shopee (beririsan)')+' · net = omzet − potongan Shopee − biaya lain-lain − spending − HPP · ROI = net ÷ spending · Ads menurut tanggal iklan tayang · Affiliate menurut '+
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
