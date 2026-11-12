/**
 * Pengiriman (Mengantar) › Saldo COD: status saldo per resi COD, penghasilan bersih & pencairan dari mutasi akun Mengantar,
 * dan pop-up rincian transaksi. Data: /api/report/shipments/saldo, /shipments/saldo/detail.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta
 * rentang(), rgTgl() dan helper Mengantar shQuery/shIsiKurir/shSync/shKosong/shGagal/shStatus dari script utama (window.*).
 * Dipanggil dari script utama: loadSaldo() (menu Saldo COD).
 */
// ---------- 3. Saldo COD
let sdData=null,sdBusy=false,sdTab='',sdBatas=100,sdNonSv=false;
const SD_LBL={jalan:'Dalam perjalanan',pending:'Menunggu rekonsiliasi',rekon:'Sudah rekonsiliasi',rts:'RTS'};
const SD_TONE={jalan:'spend',pending:'info',rekon:'rev',rts:'loss'};
async function loadSaldo(){
  if(sdBusy)return;sdBusy=true;
  try{sdData=await api('/api/report/shipments/saldo?'+shQuery('sd').q);renderSaldo(sdData)}
  catch(e){shGagal(['sdRows'],e)}
  finally{sdBusy=false}
}
function renderSaldo(d){
  const r=rentang('sdRange');
  put('sdPeriod','Mengantar · paket COD '+(r.all?'semua tanggal':'dibuat '+fmtRange(d.from,d.to))+shSync(d));
  shIsiKurir('sdKurir',d.couriers);
  const rows=d.rows||[],g={};
  rows.forEach(x=>{const t=g[x.saldo]||(g[x.saldo]={n:0,cod:0,biaya:0,net:0});t.n++;t.cod+=x.cod_amount;t.biaya+=x.price+x.cod_fee;t.net+=x.net});
  const kartu=(id,k)=>{const t=g[k]||{n:0,cod:0,biaya:0,net:0};$(id).textContent=rpFull(t.net);
    // Rincian sebagai tiga kotak kecil (dulu satu baris teks abu-abu kecil yang sulit dibaca sekilas)
    $(id+'D').innerHTML='<span><small>Paket</small><b>'+int(t.n)+'</b></span><span><small>Nilai COD</small><b>'+rpFull(t.cod)+'</b></span>'+
      '<span title="Ongkir + fee COD"><small>Biaya</small><b>− '+rpFull(t.biaya)+'</b></span>'};
  kartu('sdKpiJalan','jalan');kartu('sdKpiPending','pending');kartu('sdKpiRekon','rekon');
  renderArus(d,g.pending);renderPrakiraan(d);
  if(sdTab&&!g[sdTab])sdTab='';
  $('sdTab').innerHTML='<button class="'+(sdTab?'':'on')+'" data-tab="">Semua <small>'+int(rows.length)+'</small></button>'+
    ['jalan','pending','rekon','rts'].filter(k=>g[k]).map(k=>'<button class="'+(sdTab===k?'on':'')+'" data-tab="'+k+'">'+SD_LBL[k]+' <small>'+int(g[k].n)+'</small></button>').join('')+
    // Filter terpisah (bisa digabung dengan status saldo): paket tanpa order Scalev = order manual / di luar Scalev
    '<button class="mm-diantar'+(sdNonSv?' on':'')+'" data-nonsv="1" title="Paket COD yang tidak punya order Scalev (order manual / di luar Scalev). Bisa digabung dengan filter status di kiri">Bukan dari Scalev <small>'+int(rows.filter(x=>!x.scalev).length)+'</small></button>';
  sdBatas=100;renderSdRows();
}
/**
 * Prakiraan saldo masuk (arus kas): kapan uang COD yang masih menggantung masuk saldo Mengantar.
 * - Terkirim belum rekonsiliasi → rekonsiliasi berikutnya (Mengantar merekonsiliasi tiap malam ±20.00 WIB): pasti.
 * - Di jalan → tanggal dibuat + SLA (tanpa SLA: rata-rata lama kirim kurir), nilainya × tingkat terkirim kurir 90 hari terakhir: perkiraan.
 * - Di jalan yang sudah lewat estimasi tidak diberi tanggal; di atas SD_PRAK_KRITIS hari dianggap berisiko hilang.
 * Tidak ikut filter tanggal & kurir halaman.
 */
const SD_PRAK_JAM=20,SD_PRAK_HARI=7,SD_PRAK_KRITIS=14;
function sdPrakiraan(d,kini){
  const p=d.prakiraan||{},wib=new Date((kini||Date.now())+7*36e5).toISOString(),hariIni=wib.slice(0,10);
  const rekon=+wib.slice(11,13)<SD_PRAK_JAM?hariIni:shift(hariIni,1);
  const kur=new Map((p.kurir||[]).map(k=>[k.courier,k])),tot=(p.kurir||[]).reduce((a,k)=>{a.t+=k.terkirim||0;a.r+=k.rts||0;return a},{t:0,r:0});
  const rasioSemua=tot.t+tot.r?tot.t/(tot.t+tot.r):1;
  // Kurir dengan riwayat terlalu sedikit (< 20 paket selesai) memakai angka gabungan semua kurir
  const rasio=c=>{const k=kur.get(c);return k&&(k.terkirim||0)+(k.rts||0)>=20?k.terkirim/(k.terkirim+k.rts):rasioSemua};
  const per=new Map(),ambil=t=>{if(!per.has(t))per.set(t,{tgl:t,pasti:0,nPasti:0,kira:0,nKira:0});return per.get(t)};
  const telat={n:0,net:0},kritis={n:0,net:0};
  for(const x of p.paket||[]){
    if(x.saldo==='pending'){const h=ambil(rekon);h.pasti+=x.net;h.nPasti++;continue}
    const dibuat=ymd(new Date(x.created_at)),umur=(Date.parse(hariIni+'T00:00:00Z')-Date.parse(dibuat+'T00:00:00Z'))/864e5;
    const lama=x.sla_days>0?x.sla_days:Math.max(1,Math.round((kur.get(x.courier)||{}).hari||4)),est=shift(dibuat,lama);
    if(umur>SD_PRAK_KRITIS){kritis.n++;kritis.net+=x.net}
    else if(est<rekon){telat.n++;telat.net+=x.net}
    else{const h=ambil(est);h.kira+=x.net*rasio(x.courier);h.nKira++}
  }
  const hari=[...per.values()].sort((a,b)=>a.tgl<b.tgl?-1:1);
  return {hariIni,rekon,hari,telat,kritis,rasioSemua,kosong:!(p.paket||[]).length};
}
function renderPrakiraan(d){
  const f=sdPrakiraan(d),tgl=t=>t===f.hariIni?'malam ini':t===shift(f.hariIni,1)?'besok, '+rgTgl(t,{day:'numeric',month:'short'}):rgTgl(t,{weekday:'short',day:'numeric',month:'short'});
  const dekat=f.hari.filter(h=>h.tgl<=shift(f.hariIni,SD_PRAK_HARI-1)),lanjut=f.hari.filter(h=>h.tgl>shift(f.hariIni,SD_PRAK_HARI-1));
  const pertama=f.hari[0],jml=h=>h.pasti+h.kira;
  $('sdPrakV').textContent=pertama?rpFull(jml(pertama)):'—';
  put('sdPrakD',pertama?'masuk saldo Mengantar '+tgl(pertama.tgl)+' ±'+SD_PRAK_JAM+'.00 WIB'+(pertama.kira?(pertama.pasti?' · '+rpFull(pertama.pasti)+' sudah terkirim (pasti), sisanya perkiraan':' · perkiraan dari paket yang masih di jalan'):' · dari '+int(pertama.nPasti)+' paket yang sudah terkirim')
    :f.kosong?'Tidak ada paket COD yang menunggu masuk saldo.':'Belum ada paket yang bisa diperkirakan tanggalnya.');
  const total=dekat.reduce((a,h)=>a+jml(h),0);
  $('sdPrakTot').textContent=rpFull(total);
  put('sdPrakTotD',SD_PRAK_HARI+' hari ke depan (s.d. '+rgTgl(shift(f.hariIni,SD_PRAK_HARI-1),{day:'numeric',month:'short'})+') · paket di jalan dihitung × '+pct(100*f.rasioSemua)+' tingkat terkirim');
  $('sdPrakHari').innerHTML=dekat.length?dekat.map(h=>'<div class="sd-pr-h'+(h.pasti?' pasti':'')+'"><small>'+esc(tgl(h.tgl))+'</small><b>'+rpFull(jml(h))+'</b>'+
    '<span>'+[h.nPasti?int(h.nPasti)+' terkirim':'',h.nKira?int(h.nKira)+' di jalan':''].filter(Boolean).join(' + ')+'</span></div>').join(''):'';
  const cat=[];
  if(lanjut.length)cat.push('Setelah '+SD_PRAK_HARI+' hari: '+rpFull(lanjut.reduce((a,h)=>a+jml(h),0))+' dari '+int(lanjut.reduce((a,h)=>a+h.nKira,0))+' paket.');
  if(f.telat.n)cat.push(int(f.telat.n)+' paket ('+rpFull(f.telat.net)+') sudah lewat estimasi tiba — tanggal cairnya tidak bisa diperkirakan, tidak dihitung di atas.');
  if(f.kritis.n)cat.push('<b>'+int(f.kritis.n)+' paket ('+rpFull(f.kritis.net)+') sudah lebih dari '+SD_PRAK_KRITIS+' hari di jalan</b> — berisiko hilang, tidak dihitung; cek di Tracking &amp; Masalah.');
  cat.push('Uang masuk ke saldo Mengantar, bukan langsung ke rekening — pencairan ke rekening tetap diajukan sendiri. Tidak mengikuti filter tanggal &amp; kurir.');
  $('sdPrakCat').innerHTML=cat.map(t=>'<p>'+t+'</p>').join('');
}
/** Penghasilan bersih, pencairan, dan saldo akun dari mutasi /invoices Mengantar */
function renderArus(d,pending){
  const a=d.arus||{},v=k=>a[k]||0;
  const potong=v('potong_rts')+v('potong_noncod')+v('potong_lain');
  const bersih=v('rekon')+v('refund')-potong;
  const r=rentang('sdRange');
  const sejak=d.mutasi_sejak?(r.all||d.from<d.mutasi_sejak.slice(0,10)?' · mutasi tercatat sejak '+tglWib(d.mutasi_sejak):''):' · mutasi belum tersinkron';
  put('sdArusSub','Dari mutasi saldo akun Mengantar · transaksi '+(r.all?'semua tanggal':fmtRange(d.from,d.to))+sejak+' · semua kurir');
  const baris=(l,n,sub)=>'<div><span>'+l+(sub?'<small>'+sub+'</small>':'')+'</span><b>'+n+'</b></div>';
  $('sdKpiBersih').textContent=rpFull(bersih);
  // COD terkumpul dari rincian resi invoice rekonsiliasi; bila rinciannya belum lengkap
  // (lebih kecil dari nilai rekonsiliasi) cukup tampilkan nilai rekonsiliasinya
  const cod=d.rekon_cod||0,rinciLengkap=cod>=v('rekon')&&cod>0,ck=d.cod_kirim||{};
  $('sdBersihRinci').innerHTML=
    (rinciLengkap?baris('Dikumpulkan dari pelanggan',rpFull(cod),int(d.rekon_resi)+' resi')+baris('Ongkir &amp; fee COD dipotong','− '+rpFull(cod-v('rekon')))
      :baris('Rekonsiliasi COD',rpFull(v('rekon')),int(v('rekon_n'))+' invoice'))+
    baris('Klaim diterima','+ '+rpFull(v('refund')),'retur / hilang / rusak, kompensasi, koreksi harga')+
    // Potongan dirinci per jenis di sini (dulu di kartu "Rincian penghasilan bersih" yang mengulang hitungan yang sama)
    baris('Potongan ongkir RTS','− '+rpFull(v('potong_rts')),'ongkir paket retur ditagih dari saldo')+
    baris('Potongan ongkir non-COD','− '+rpFull(v('potong_noncod')),'pembayaran batch non-COD')+
    (v('potong_lain')?baris('Potongan lain','− '+rpFull(v('potong_lain')),'koreksi berat / harga dan penyesuaian'):'')+
    // Info saja (= "Total Pendapatan COD" di Balance Mengantar), tidak ikut dijumlahkan ke penghasilan bersih
    '<div class="sd-t-info"><span>Nilai COD dikirim<small>'+int(ck.n)+' paket · '+int(ck.terkirim)+' terkirim · '+int(ck.rts)+' retur · '+int(ck.jalan)+' di jalan · info, tidak dijumlahkan</small></span><b>'+rpFull(ck.nilai||0)+'</b></div>';
  $('sdKpiKlaim').textContent=rpFull(v('refund'));
  // Per jenis klaim (deskripsi mutasi Mengantar); sisanya koreksi harga / pengembalian non-COD
  const jk=(l,k,sub)=>baris(l,rpFull(v(k)),int(v(k+'_n'))+' klaim · '+sub);
  const lainN=v('refund_n')-v('klaim_retur_n')-v('klaim_komp_n')-v('klaim_rusak_n');
  $('sdKlaimRinci').innerHTML=
    jk('Claim return','klaim_retur','klaim ongkir paket retur')+
    jk('Claim compensation','klaim_komp','kompensasi dari Mengantar')+
    jk('Claim damage / lost','klaim_rusak','paket rusak atau hilang')+
    (lainN?baris('Lainnya',rpFull(v('refund')-v('klaim_retur')-v('klaim_komp')-v('klaim_rusak')),int(lainN)+' transaksi · koreksi harga, pengembalian non-COD'):'')+
    '<hr class="sd-t-sep">'+
    baris('Jumlah klaim',int(v('refund_n'))+' klaim')+
    baris('Rata-rata per klaim',v('refund_n')?rpFull(v('refund')/v('refund_n')):'—');
  $('sdKpiCair').textContent=rpFull(v('cair'));
  const pc=d.pencairan||[],proses=pc.filter(x=>!x.paid_at);
  put('sdKpiCairD',int(v('cair_n'))+' kali pencairan'+(pc[0]?' · terakhir '+tglWib(pc[0].created_at,true):'')+(proses.length?' · '+int(proses.length)+' masih diproses':''));
  $('sdKpiTopup').textContent=rpFull(v('topup'));
  // Belum dicairkan = paket COD sudah terkirim tapi belum direkonsiliasi Mengantar (uang bersihnya belum masuk saldo)
  const pd=pending||{n:0,net:0},sa=d.saldo_akun;
  $('sdKpiBelum').textContent=rpFull(pd.net);
  put('sdKpiBelumD',int(pd.n)+' paket terkirim belum rekonsiliasi');
  $('sdKpiSaldo').textContent=sa?rpFull(sa.balance):'—';
  $('sdCairRows').innerHTML=pc.length?pc.map(x=>'<tr><td>'+tglWib(x.created_at,true)+'</td><td>'+(x.paid_at?tglWib(x.paid_at,true):'<span class="tag spend">Diproses</span>')+'</td>'+
    '<td>'+esc(x.bank||'—')+'</td><td class="n"><b>'+rpFull(x.amount)+'</b></td></tr>').join(''):shKosong(4,'Belum ada pencairan pada rentang ini.');
}
// ---- Pop-up rincian transaksi Saldo COD. Data resi & mutasi dimuat saat pop-up dibuka
// (/shipments/saldo/detail), paket dalam perjalanan diambil dari sdData.rows.
const SD_IC={
  cod:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  ongkir:'<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  fee:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  klaim:'<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  rts:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  potong:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  jalan:'<rect x="3" y="7" width="13" height="10" rx="1"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
};
// tone: warna angka; min: ditampilkan sebagai pengurang penghasilan
const SD_KAT=[
  {k:'cod',l:'Dikumpulkan dari pelanggan',tx:'Nilai COD',tone:'info'},
  {k:'ongkir',l:'Total ongkir COD yang dibayar',tx:'Ongkir',tone:'loss',min:true},
  {k:'fee',l:'Total biaya COD',tx:'Fee COD',tone:'loss',min:true},
  {k:'klaim',l:'Total klaim',tx:'Klaim',tone:'pb'},
  {k:'rts',l:'Potongan ongkir RTS',tx:'Ongkir retur',tone:'loss',min:true},
  {k:'potong',l:'Potongan non-COD & lain',tx:'Potongan',tone:'loss',min:true},
  {k:'jalan',l:'Paket COD dalam perjalanan',tx:'Dalam perjalanan',tone:'spend'},
];
let sdDet=null,sdDetKey='',sdDetKat='cod',sdDetBatas=200;
/** Jenis klaim dari deskripsi mutasi Mengantar */
function sdJenisKlaim(d){
  d=d||'';
  if(/^Claim approved for returned order/i.test(d))return 'Claim return';
  if(/^Compensation for order/i.test(d))return 'Claim compensation';
  if(/^Claim approved for damaged or lost order/i.test(d))return 'Claim damage / lost';
  return 'Klaim lain';
}
/** Baris seragam {t,kurir,oid,resi,tx,ket,jml} untuk satu kategori */
function sdDetBaris(k){
  if(k==='jalan')return (sdData&&sdData.rows||[]).filter(x=>x.saldo==='jalan')
    .map(x=>({t:x.created_at,kurir:x.courier,oid:x.order_id,resi:x.receipt,tx:'Dalam perjalanan',ket:'Estimasi uang diterima',jml:x.net}));
  if(!sdDet)return [];
  if(k==='cod'||k==='ongkir'||k==='fee')return sdDet.items.map(x=>({t:x.created_at,kurir:x.courier,oid:x.order_id,resi:x.receipt,
    tx:k==='cod'?'Nilai COD':k==='fee'?'Fee COD':'Ongkir',jml:k==='cod'?x.cod:k==='fee'?x.fee:x.cod-x.fee-x.net}));
  return sdDet.mutasi.filter(x=>x.jenis===k).map(x=>({t:x.created_at,kurir:x.courier,oid:x.order_id,resi:x.receipt,
    tx:k==='klaim'?sdJenisKlaim(x.description):k==='rts'?'Ongkir retur':/^Payment for Non-COD/i.test(x.description||'')?'Non-COD':'Potongan lain',ket:x.description,jml:x.amount}));
}
/** Total per kategori: rekonsiliasi dari SUM server, mutasi dari arus (sama dengan kotak di halaman) */
function sdDetTotal(k){
  const a=sdData&&sdData.arus||{},t=sdDet&&sdDet.total||{};
  if(k==='cod')return t.cod||0;if(k==='ongkir')return t.ongkir||0;if(k==='fee')return t.fee||0;
  if(k==='klaim')return a.refund||0;if(k==='rts')return a.potong_rts||0;
  if(k==='potong')return (a.potong_noncod||0)+(a.potong_lain||0);
  return sdDetBaris('jalan').reduce((s,x)=>s+x.jml,0);
}
async function bukaSdDlg(kat){
  if(!sdData)return;
  sdDetKat=kat;sdDetBatas=200;$('sdDlgCari').value='';
  const r=rentang('sdRange'),f=s=>rgTgl(s,{day:'2-digit',month:'short',year:'numeric'});
  put('sdDlgPeriode',r.all?'Periode semua tanggal':'Periode '+f(sdData.from)+' - '+f(sdData.to));
  const dl=$('sdDlg');if(!dl.open)dl.showModal();
  const key=sdData.from+'|'+sdData.to;
  if(sdDetKey!==key){
    sdDet=null;sdDetKey=key;renderSdDlg(true);
    try{const d=await api('/api/report/shipments/saldo/detail?'+new URLSearchParams({from:sdData.from,to:sdData.to}));if(sdDetKey===key)sdDet=d}
    catch(e){sdDetKey='';$('sdDlgRows').innerHTML=shKosong(6,'<span style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</span>');return}
  }
  renderSdDlg();
}
function renderSdDlg(memuat){
  const kat=SD_KAT.find(x=>x.k===sdDetKat);
  $('sdDlgKat').innerHTML=SD_KAT.map(x=>'<button type="button" role="tab" class="tone-'+x.tone+(x.k===sdDetKat?' on':'')+'" data-kat="'+x.k+'" aria-selected="'+(x.k===sdDetKat)+'">'+
    '<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+SD_IC[x.k]+'</svg></i><span>'+x.l+'</span>'+
    '<b>'+(memuat&&x.k!=='jalan'&&!['klaim','rts','potong'].includes(x.k)?'…':rpFull(sdDetTotal(x.k)))+'</b></button>').join('');
  put('sdDlgJ','Detail Transaksi: '+kat.l);
  if(memuat&&kat.k!=='jalan'){$('sdDlgRows').innerHTML=shKosong(6,'Memuat…');$('sdDlgMore').hidden=true;put('sdDlgSub','');put('sdDlgTot','—');return}
  const cari=$('sdDlgCari').value.trim().toLowerCase();
  const semua=sdDetBaris(kat.k),rows=cari?semua.filter(x=>String(x.resi||'').toLowerCase().includes(cari)||String(x.oid||'').toLowerCase().includes(cari)):semua;
  const tampil=rows.slice(0,sdDetBatas);
  $('sdDlgRows').innerHTML=tampil.length?tampil.map(x=>{
    const t=x.t?new Date(x.t):null;
    return '<tr><td>'+(t?tglWib(x.t)+'<small class="mm-sub">'+new Intl.DateTimeFormat('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(t)+'</small>':'—')+'</td>'+
      '<td>'+(x.kurir?'<span class="sd-kurir">'+esc(x.kurir)+'</span>':'—')+'</td><td>'+esc(x.oid||'—')+'</td><td class="sd-resi">'+esc(x.resi||'—')+'</td>'+
      '<td>'+esc(x.tx)+(x.ket?'<small class="mm-sub" title="'+esc(x.ket)+'">'+esc(x.ket.length>48?x.ket.slice(0,46)+'…':x.ket)+'</small>':'')+'</td>'+
      '<td class="n"><span class="sd-amt tone-'+kat.tone+'">'+(kat.min?'− ':'')+rpFull(x.jml)+'</span></td></tr>';
  }).join(''):shKosong(6,cari?'Tidak ada resi yang cocok.':'Tidak ada transaksi pada rentang ini.');
  const m=$('sdDlgMore');m.hidden=rows.length<=sdDetBatas;
  $('sdDlgMoreBtn').textContent='Tampilkan lebih banyak ('+int(Math.max(0,rows.length-sdDetBatas))+' lagi)';
  const potong=kat.k!=='jalan'&&sdDet&&semua.length>=sdDet.batas;
  put('sdDlgSub',int(rows.length)+' transaksi'+(cari?' cocok':'')+(potong?' · daftar dibatasi '+int(sdDet.batas)+' baris terbaru, total tetap lengkap':'')+
    (kat.k==='jalan'?' · paket dibuat pada rentang ini, belum terkirim':''));
  put('sdDlgTotL',cari?'Total '+int(rows.length)+' transaksi cocok':'Total');
  $('sdDlgTot').textContent=(kat.min?'− ':'')+rpFull(cari?rows.reduce((s,x)=>s+x.jml,0):sdDetTotal(kat.k));
}
function sdFiltered(){
  const cari=$('sdCari').value.trim().toLowerCase();
  return (sdData&&sdData.rows||[]).filter(x=>(!sdTab||x.saldo===sdTab)&&(!sdNonSv||!x.scalev)&&
    (!cari||String(x.receipt||'').toLowerCase().includes(cari)||String(x.shipper||'').toLowerCase().includes(cari)));
}
function renderSdRows(){
  const rows=sdFiltered(),tampil=rows.slice(0,sdBatas);
  $('sdRows').innerHTML=tampil.length?tampil.map(x=>'<tr><td class="name">'+esc(x.receipt||'—')+'<small>'+tglWib(x.created_at)+(x.scalev?'':' · <span class="tag warn">bukan Scalev</span>')+'</small></td>'+
    '<td>'+esc(x.courier||'—')+'<small class="mm-sub">'+esc(x.shipper||'')+'</small></td><td>'+shStatus(x.status)+(x.done_at?'<small class="mm-sub">'+tglWib(x.done_at)+'</small>':'')+'</td>'+
    '<td><span class="tag '+SD_TONE[x.saldo]+'">'+SD_LBL[x.saldo]+'</span></td>'+
    '<td class="n">'+rpFull(x.cod_amount)+'</td><td class="n">'+rpFull(x.price)+'</td><td class="n">'+rpFull(x.cod_fee)+'</td>'+
    '<td class="n"><b'+(x.net<0?' class="sd-min"':'')+'>'+(x.saldo==='rts'&&!x.net?'<span style="color:var(--muted)">Rp 0</span>':rpFull(x.net))+'</b></td></tr>').join('')
    :shKosong(8,sdData&&sdData.rows&&sdData.rows.length?'Tidak ada resi untuk filter ini.':'Belum ada paket COD pada rentang ini.');
  const t=rows.reduce((a,x)=>{a.cod+=x.cod_amount;a.p+=x.price;a.f+=x.cod_fee;a.net+=x.net;return a},{cod:0,p:0,f:0,net:0});
  $('sdFoot').innerHTML=rows.length?'<tr><td colspan="4"><b>Total '+int(rows.length)+' resi</b></td><td class="n"><b>'+rpFull(t.cod)+'</b></td><td class="n"><b>'+rpFull(t.p)+'</b></td><td class="n"><b>'+rpFull(t.f)+'</b></td><td class="n"><b>'+rpFull(t.net)+'</b></td></tr>':'';
  const m=$('sdMore');m.hidden=rows.length<=sdBatas;
  $('sdMoreBtn').textContent='Tampilkan lebih banyak ('+int(Math.max(0,rows.length-sdBatas))+' lagi)';
}

// Filter, kotak penghasilan, pop-up rincian, tabel resi
function pasangSaldo(){
  $('sdRange').addEventListener('click',e=>{if(e.target.closest('button'))loadSaldo()});
  $('sdKurir').addEventListener('change',loadSaldo);
  // Kotak penghasilan: tombol panah buka/tutup rincian, Lihat Detail ke tabel rincian / pop-up klaim
  document.querySelectorAll('#v-mgsaldo .sd-t-x').forEach(b=>b.addEventListener('click',()=>{
    const buka=b.getAttribute('aria-expanded')!=='true';
    b.setAttribute('aria-expanded',buka);b.setAttribute('aria-label',buka?'Sembunyikan rincian':'Tampilkan rincian');
    b.closest('.sd-t').querySelector('.sd-t-rinci').hidden=!buka;
  }));
  $('sdBersihDetail').addEventListener('click',()=>bukaSdDlg('cod'));
  $('sdKlaimDetail').addEventListener('click',()=>bukaSdDlg('klaim'));
  $('sdDlg').addEventListener('click',e=>{
    if(e.target===e.currentTarget||e.target.closest('[data-tutup]')){e.currentTarget.close();return}
    const k=e.target.closest('[data-kat]');if(k){sdDetKat=k.dataset.kat;sdDetBatas=200;renderSdDlg(!sdDet)}
  });
  $('sdDlgCari').addEventListener('input',()=>{sdDetBatas=200;renderSdDlg(!sdDet)});
  $('sdDlgMoreBtn').addEventListener('click',()=>{sdDetBatas+=200;renderSdDlg()});
  $('sdDlgExport').addEventListener('click',()=>{
    const kat=SD_KAT.find(x=>x.k===sdDetKat),rows=sdDetBaris(sdDetKat);if(!rows.length)return;
    unduhCsv('mengantar-'+kat.k+'-'+sdData.from+'_'+sdData.to+'.csv',['Tanggal','Ekspedisi','ID pesanan','Nomor resi','Transaksi','Keterangan','Jumlah'],
      rows.map(x=>[x.t||'',x.kurir||'',x.oid||'',x.resi||'',x.tx,x.ket||'',(kat.min?-1:1)*x.jml]));
  });
  $('sdTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;sdBatas=100;
    if(b.dataset.nonsv){sdNonSv=!sdNonSv;b.classList.toggle('on',sdNonSv)}
    else{sdTab=b.dataset.tab;$('sdTab').querySelectorAll('button[data-tab]').forEach(x=>x.classList.toggle('on',x===b))}
    renderSdRows()});
  $('sdCari').addEventListener('input',()=>{sdBatas=100;renderSdRows()});
  $('sdMoreBtn').addEventListener('click',()=>{sdBatas+=100;renderSdRows()});
  $('sdExport').addEventListener('click',()=>{
    const rows=sdFiltered();if(!rows.length)return;
    unduhCsv('mengantar-saldo-cod-'+sdData.from+'_'+sdData.to+'.csv',
      ['Resi','Dibuat','Kurir','Gudang','Status paket','Selesai','Status saldo','Order Scalev','Nilai COD','Ongkir','Fee COD','Uang diterima'],
      rows.map(x=>[x.receipt,x.created_at,x.courier,x.shipper,x.status,x.done_at||'',SD_LBL[x.saldo],x.scalev?'Ya':'Tidak',x.cod_amount,x.price,x.cod_fee,x.net]));
  });
}
pasangSaldo();
