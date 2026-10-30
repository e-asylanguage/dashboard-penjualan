/**
 * Grup menu Order: Scalev (daftar order, omzet, grafik COD vs Non-COD, detail order) dan Performa Lead (pola jam & hari order masuk).
 * Data: /api/orders…, /api/report/lead-pattern. Script biasa (bukan module), dimuat SETELAH script utama index.html:
 * memakai utils.js & api.js, serta rentang() & loadSettings() dari script utama (window.*).
 * Dipanggil dari script utama: openOrders() (menu Scalev), loadLead() (menu Performa Lead).
 */
// ---- Scalev Order
let ordData=null,ordBusy=false,ordStatusFilled=false;
const STATUS_LABEL={draft:'Draft',pending:'Pending',confirmed:'Confirm',in_process:'Diproses',ready:'Siap kirim',
  shipped:'Dikirim',completed:'Selesai',canceled:'Batal',rts:'RTS',shipped_rts:'RTS',closed:'Ditutup'};
const STATUS_TAG={confirmed:'info',in_process:'info',ready:'info',shipped:'info',completed:'rev',
  canceled:'loss',rts:'loss',shipped_rts:'loss'};
const statusTag=s=>'<span class="tag'+(STATUS_TAG[s]?' '+STATUS_TAG[s]:'')+'">'+esc(STATUS_LABEL[s]||s||'—')+'</span>';
const waktu=iso=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date(iso));

const ordDates=()=>rentang('ordRange');

async function loadOrders(){
  if(ordBusy)return;ordBusy=true;
  for(const k in detCache)delete detCache[k];   // data bisa berubah setelah sinkron
  const e=$('ordNote');if(e){e.textContent='';e.hidden=true}
  $('ordRows').innerHTML='<tr><td colspan="8" style="color:var(--muted)">Memuat…</td></tr>';
  const r=ordDates();
  const q=new URLSearchParams({from:r.from,to:r.to});
  const st=$('ordStore').value,sx=$('ordStatus').value,py=$('ordPay').value;
  if(st)q.set('store_id',st); if(sx)q.set('status',sx); if(py)q.set('payment',py);
  try{
    ordData=await api('/api/report/orders?'+q);
    renderOrders(ordData);
  }catch(err){
    ordData=null;
    $('ordCodRing').innerHTML='';
    $('ordRows').innerHTML='<tr><td colspan="8" style="color:var(--loss)">Gagal memuat data.</td></tr>';
    const n=$('ordNote');if(n){n.textContent='Tidak bisa mengambil data ('+err.message+'). Coba jalankan sinkron lebih dulu.';n.hidden=false}
  }finally{ordBusy=false}
}

/** Grafik COD vs Non-COD: tren harian (bertumpuk) + perbandingan tiap tahap, mode jumlah lead / closing / omzet. */
let ordCodM='lead',ordChartH=null,ordChartT=null;
const ORD_COD_M={lead:['orders','Lead masuk'],closing:['confirmed','Lead closing'],omzet:['gross_confirmed','Omzet lead closing']};
function ordCodGambar(){
  const d=ordData;if(!d||typeof Chart==='undefined')return;
  $('ordCodMetrik').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.m===ordCodM));
  const uang=ordCodM==='omzet',[kol,judul]=ORD_COD_M[ordCodM],fmt=v=>uang?rpFull(v):int(v)+' order';
  put('ordCodSub',judul+' per hari menurut tanggal order masuk · kanan: perbandingan tiap tahap'+(uang?' (nilai gross order)':' (jumlah order)'));
  const hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const per=new Map((d.harian||[]).map(r=>[r.date+'|'+r.is_cod,r]));
  const labels=hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const seri=cod=>hari.map(t=>(per.get(t+'|'+cod)||{})[kol]||0);
  const warna=[css('--spend'),css('--rev')],garis=css('--line');
  const legend={position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}};
  if(ordChartH)ordChartH.destroy();
  ordChartH=new Chart($('ordCodHarian'),{type:'bar',
    data:{labels,datasets:[{label:'COD',data:seri(1),backgroundColor:warna[0],borderRadius:3,stack:'s'},{label:'Non-COD',data:seri(0),backgroundColor:warna[1],borderRadius:3,stack:'s'}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+fmt(c.raw),
        footer:it=>{const a=it.reduce((s,c)=>s+c.raw,0),cod=(it.find(c=>c.datasetIndex===0)||{}).raw||0;return 'Total: '+fmt(a)+(a?' · COD '+pct(100*cod/a):'')}}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:garis},border:{display:false},beginAtZero:true,ticks:{precision:0,callback:v=>uang?rp(v):int(v)}}}}});
  // Per tahap: COD & Non-COD berdampingan
  const pay=d.by_payment||[],nt=d.nilai_tahap||[],ambil=cod=>{const r=pay.find(p=>p.is_cod===cod)||{},v=nt.find(p=>p.is_cod===cod)||{};
    return uang?[r.gross_all,r.gross_confirmed,v.shipped_value,v.completed_value,r.revenue_lost].map(x=>x||0):[r.orders,r.confirmed,r.shipped,r.completed,r.lost].map(x=>x||0)};
  const tahap=[ambil(1),ambil(0)];
  if(ordChartT)ordChartT.destroy();
  ordChartT=new Chart($('ordCodTahap'),{type:'bar',
    data:{labels:['Lead masuk','Closing','Dikirim','Selesai','RTS / batal'],datasets:[{label:'COD',data:tahap[0],backgroundColor:warna[0],borderRadius:3},{label:'Non-COD',data:tahap[1],backgroundColor:warna[1],borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{label:c=>{const awal=tahap[c.datasetIndex][0];return ' '+c.dataset.label+': '+fmt(c.raw)+(c.dataIndex&&awal?' · '+pct(100*c.raw/awal)+' dari lead':'')}}}},
      scales:{x:{grid:{color:garis},border:{display:false},beginAtZero:true,ticks:{precision:0,callback:v=>uang?rp(v):int(v)}},y:{grid:{display:false}}}}});
  // Ringkasan angka per metode bayar
  const s=d.speed||{};
  $('ordCodRing').innerHTML=[[1,'COD','Bayar di tempat',s.aov_cod],[0,'Non-COD','Transfer / bayar di muka',s.aov_transfer]].map(([cod,nm,ket,aov],i)=>{
    const r=pay.find(p=>p.is_cod===cod);
    if(!r)return '<div><span class="dot" style="background:'+warna[i]+'"></span><b>'+nm+'</b> · tidak ada order</div>';
    return '<div><span class="dot" style="background:'+warna[i]+'"></span><b>'+nm+'</b> · '+ket+'<br>'+
      '<b>'+int(r.orders)+'</b> lead · <b>'+int(r.confirmed)+'</b> closing ('+pct(r.orders?100*r.confirmed/r.orders:0)+') · <b>'+int(r.shipped)+'</b> dikirim · <b>'+int(r.completed)+'</b> selesai<br>'+
      'Dibayar '+rpFull(r.revenue_paid||0)+' · RTS / batal '+int(r.lost)+' order (− '+rpFull(r.revenue_lost||0)+')'+(aov?' · rata-rata closing '+rpFull(aov):'')+'</div>';
  }).join('');
}
$('ordCodMetrik').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;ordCodM=b.dataset.m;ordCodGambar()});

function renderOrders(d){
  const pay=d.by_payment||[];
  const total=pay.reduce((a,p)=>a+(p.orders||0),0);
  put('ordPeriod','Data Scalev · '+fmtRange(d.from,d.to)+' · '+int(total)+' order masuk');

  // Potensi omzet per kelompok status (nilai gross order); persen = porsi dari potensi omzet total
  const om=d.omzet||{},omTot=om.total||0,porsi=v=>omTot?pct(100*(v||0)/omTot):'—';
  const omCard=(id,nilai,n,teks)=>{$(id).innerHTML=esc(rpFull(nilai||0))+'<span class="pc">'+porsi(nilai)+'</span>';
    put(id+'D',int(n)+' lead · '+teks+(n?' · rata-rata '+rpFull((nilai||0)/n):''))};
  $('ordOmzetTotal').textContent=rpFull(omTot);
  const lain=(om.orders||0)-(om.confirmed||0)-(om.pending||0)-(om.canceled||0);
  put('ordOmzetTotalD',int(om.orders)+' lead'+(lain>0?' · termasuk '+int(lain)+' draft/lainnya':'')+(om.orders?' · rata-rata '+rpFull(omTot/om.orders):''));
  omCard('ordOmzetOk',om.confirmed_value,om.confirmed,'sudah dikonfirmasi');
  omCard('ordOmzetPending',om.pending_value,om.pending,'bisa dikejar CS');
  omCard('ordOmzetCancel',om.canceled_value,om.canceled,'dibatalkan');

  ordCodGambar();

  const s=d.speed||{};
  const n=$('ordNote');
  if(n){
    if(s.bad_timestamps){
      n.textContent='Ada '+int(s.bad_timestamps)+' order dengan stempel waktu tidak masuk akal (tahun di luar nalar) sehingga dikeluarkan dari perhitungan kecepatan. Periksa order tersebut di Scalev.';
      n.hidden=false;
    }else{n.textContent='';n.hidden=true}
  }

  if(!ordStatusFilled&&(d.statuses||[]).length){
    ordStatusFilled=true;
    for(const x of d.statuses)$('ordStatus').insertAdjacentHTML('beforeend',
      '<option value="'+esc(x.status)+'">'+esc(STATUS_LABEL[x.status]||x.status)+' ('+int(x.orders)+')</option>');
  }

  const rows=d.recent||[];
  $('ordRows').innerHTML=rows.length?rows.map(o=>{
    let produk='—';
    try{const p=JSON.parse(o.product_names||'[]');if(p.length)produk=p.join(', ')}catch(e){}
    const iklan=o.ad_name?esc(o.ad_name):(o.utm_content?esc(o.utm_content):'— <span class="tag warn">tanpa UTM</span>');
    const bayar=o.payment_method==='cod'?'<span class="tag spend">COD</span>':'<span class="tag rev">'+esc(o.payment_method||'—')+'</span>';
    return '<tr><td class="id" data-order="'+esc(o.order_id)+'"><span class="car">+</span>'+esc(o.order_id)+'</td>'+
      '<td>'+(o.draft_time?esc(waktu(o.draft_time)):'—')+'</td>'+
      '<td>'+esc(o.store_name||'—')+'</td><td>'+esc(produk)+'</td>'+
      '<td>'+bayar+'</td><td>'+statusTag(o.status)+'</td>'+
      '<td>'+iklan+'</td><td class="n">'+rp(o.gross_revenue)+'</td></tr>';
  }).join(''):'<tr><td colspan="8" style="color:var(--muted)">Tidak ada order sesuai filter.</td></tr>';
}

function openOrders(){loadSettings().catch(function(){});loadOrders();}
$('ordRange').addEventListener('click',e=>{if(e.target.closest('button'))loadOrders()});
['ordStore','ordStatus','ordPay'].forEach(id=>$(id).addEventListener('change',loadOrders));
$('ordExport').addEventListener('click',()=>{
  if(!ordData||!(ordData.recent||[]).length)return;
  unduhCsv('scalev-order-'+ordData.from+'_'+ordData.to+'.csv',
    ['Order','Waktu masuk','Store','Produk','Bayar','Status','Status bayar','utm_content','Iklan','Nilai'],
    ordData.recent.map(o=>{
      let p='';try{p=JSON.parse(o.product_names||'[]').join(' | ')}catch(e){}
      return [o.order_id,o.draft_time,o.store_name,p,o.payment_method,o.status,o.payment_status,o.utm_content,o.ad_name,o.gross_revenue];
    }));
});

// ---- Detail order (dibuka dengan mengklik Order ID)
const detCache={};
const brs=(dt,dd,cls)=>'<dt'+(cls?' class="'+cls+'"':'')+'>'+dt+'</dt><dd'+(cls?' class="'+cls+'"':'')+'>'+dd+'</dd>';

function renderDetail(d){
  const p=d.pembeli||{},k=d.pengiriman||{},b=d.pembayaran||{};
  const alamat=[p.alamat,p.kecamatan,p.kota,p.provinsi,p.kode_pos].filter(Boolean).join(', ');
  let tags='';try{const t=JSON.parse(d.tags||'[]');if(t.length)tags=t.join(', ')}catch(e){}

  const kirim='<section><h5>Pengiriman</h5><dl class="txt">'+
    brs('Resi',k.resi?esc(k.resi):'<span style="color:var(--muted)">belum terbit</span>')+
    brs('Kurir',esc(k.kurir||'—')+(k.layanan?' · '+esc(k.layanan):''))+
    brs('Status Scalev',esc(k.status_scalev||'—'))+
    (k.status_mengantar?brs('Status kurir',esc(k.status_mengantar)):'')+
    (k.catatan_terakhir?brs('Catatan',esc(k.catatan_terakhir)):'')+
    (k.gagal_antar?brs('Gagal antar',int(k.gagal_antar)+'×'):'')+
    (d.public_order_url?brs('Tautan','<a href="'+esc(d.public_order_url)+'" target="_blank" rel="noopener">buka di Scalev</a>'):'')+
    '</dl></section>';

  const pembeli='<section><h5>Pembeli</h5><dl class="txt">'+
    brs('Nama',esc(p.nama||'—'))+
    brs('Telepon',esc(p.telepon||'—'))+
    (p.email?brs('Email',esc(p.email)):'')+
    (p.penerima&&p.penerima!==p.nama?brs('Penerima',esc(p.penerima)+(p.telepon_penerima?' · '+esc(p.telepon_penerima):'')):'')+
    brs('Alamat',alamat?esc(alamat):'—')+
    (d.handler_name?brs('CS',esc(d.handler_name)):'')+
    (tags?brs('Tag',esc(tags)):'')+
    '</dl></section>';

  // Susunan tagihan Scalev: gross_revenue adalah total yang dibayar pelanggan,
  // net_revenue adalah nilai produknya saja. Diuji pada 3.162 order, rumus
  // net + ongkir − diskon ongkir + pendapatan lain = gross cocok pada 3.156 di antaranya.
  const sub=(label,v,tanda)=>v?brs(label,(tanda||'− ')+rpFull(v),'sub'):'';
  const total=(b.net_revenue||0)+(b.shipping_cost||0)-(b.shipping_discount||0)+(b.other_income||0);
  const beda=b.gross_revenue==null?0:Math.round(b.gross_revenue-total);
  const bayar='<section><h5>Pembayaran</h5><dl class="num">'+
    brs('Nilai produk',rpFull(b.net_revenue))+
    sub('Diskon produk',b.product_discount)+
    sub('Kode unik',b.unique_code_discount)+
    sub('Kode diskon'+(b.discount_code_code?' '+esc(b.discount_code_code):''),b.discount_code_discount)+
    brs('Ongkir',rpFull(b.shipping_cost))+
    sub('Diskon ongkir',b.shipping_discount)+
    (b.other_income?brs(esc(b.other_income_name||'Pendapatan lain'),rpFull(b.other_income)):'')+
    (beda?brs('Selisih tak terinci',(beda<0?'− ':'+ ')+rpFull(Math.abs(beda))):'')+
    brs('Total dibayar',rpFull(b.gross_revenue),'tot')+
    (b.payment_fee?sub('Biaya bayar',b.payment_fee):'')+
    (b.scalev_fee?sub('Biaya Scalev',b.scalev_fee):'')+
    (b.service_fee?sub('Biaya layanan',b.service_fee):'')+
    (b.net_payment_revenue!=null?brs('Diterima',rpFull(b.net_payment_revenue)):'')+
    '</dl></section>'+
    ((b.product_discount||b.unique_code_discount||b.discount_code_discount)
      ? '<p class="ket">Potongan bertanda − sudah termasuk dalam nilai produk di atas.</p>' : '');

  return '<div class="det">'+kirim+pembeli+bayar+'</div>';
}

const detSel=(html)=>'<td colspan="8"><div class="det"><section>'+html+'</section></div></td>';

$('ordRows').addEventListener('click',async e=>{
  const td=e.target.closest('td.id');if(!td)return;
  const tr=td.parentElement,id=td.dataset.order,sib=tr.nextElementSibling;
  if(sib&&sib.classList.contains('detail')){sib.remove();td.querySelector('.car').textContent='+';return}
  $('ordRows').querySelectorAll('tr.detail').forEach(x=>x.remove());
  $('ordRows').querySelectorAll('td.id .car').forEach(x=>x.textContent='+');
  td.querySelector('.car').textContent='–';
  const row=document.createElement('tr');
  row.className='detail';
  row.innerHTML=detSel('<span style="color:var(--muted)">Memuat detail…</span>');
  tr.after(row);
  try{
    let d=detCache[id];
    if(!d){d=await api('/api/report/order/'+encodeURIComponent(id));detCache[id]=d}
    row.innerHTML='<td colspan="8">'+renderDetail(d)+'</td>';
  }catch(err){
    row.innerHTML=detSel('<span style="color:var(--loss)">Gagal memuat detail order.</span>');
  }
});

// ---- Order › Performa Lead: pola jam order masuk (/api/report/lead-pattern)
let ldData=null,ldBusy=false,ldChart=null,ldMini=[];
const LD_SERI=[{k:'orders',l:'Lead masuk',c:'--info'},{k:'confirmed',l:'Complete',c:'--rev'},{k:'pending',l:'Pending',c:'--spend'},{k:'canceled',l:'Cancel',c:'--loss'}];
const ldOn=new Set(LD_SERI.map(s=>s.k));
const LD_HARI=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const LD_URUT=[1,2,3,4,5,6,0];   // Senin dulu
const ldJam=h=>String(h).padStart(2,'0')+':00';
const ldJamS=h=>ldJam(h)+'–'+(h===23?'24:00':ldJam(h+1))+' WIB';
const ld1=v=>nf.format(Math.round(v*10)/10);

async function loadLead(){
  if(ldBusy)return;ldBusy=true;
  const r=rentang('ldRange'),q=new URLSearchParams({from:r.from,to:r.to});
  if($('ldStore').value)q.set('store_id',$('ldStore').value);
  if($('ldProduk').value)q.set('product',$('ldProduk').value);
  try{ldData=await api('/api/report/lead-pattern?'+q);renderLead(ldData,r)}
  catch(e){put('ldPeriod','Gagal memuat data ('+e.message+')')}
  finally{ldBusy=false}
}

/** Isi dropdown dari data; pilihan aktif dipertahankan walau tidak ada di daftar baru */
function ldIsi(id,awal,rows,val,lbl){
  const sel=$(id),pilih=sel.value;
  sel.innerHTML='<option value="">'+awal+'</option>'+rows.map(x=>'<option value="'+esc(val(x))+'"'+(String(val(x))===pilih?' selected':'')+'>'+esc(lbl(x))+'</option>').join('')+
    (pilih&&!rows.some(x=>String(val(x))===pilih)?'<option value="'+esc(pilih)+'" selected>'+esc(pilih)+'</option>':'');
}

function renderLead(d,r){
  ldIsi('ldStore','Semua store',d.stores||[],x=>x.id,x=>x.name||('Store '+x.id));
  ldIsi('ldProduk','Semua produk',d.products||[],x=>x.product,x=>x.product+' ('+int(x.orders)+')');

  // Hari kalender efektif: rentang filter dipotong ke order pertama di database dan ke hari ini
  const today=ymd(new Date());
  const from=d.data_from&&d.data_from>d.from?d.data_from:d.from,to=d.to>today?today:d.to;
  const nDow=Array(7).fill(0);let nHari=0;
  for(let t=from;t<=to&&nHari<5000;t=shift(t,1)){nDow[new Date(t+'T00:00:00Z').getUTCDay()]++;nHari++}
  const kosong=()=>({orders:0,confirmed:0,pending:0,canceled:0});
  const jam=Array.from({length:24},kosong),grid=Array.from({length:7},()=>Array.from({length:24},kosong)),tot=kosong();
  for(const g of d.grid||[]){
    if(g.hour==null||g.dow==null)continue;
    for(const s of LD_SERI){const v=g[s.k]||0;jam[g.hour][s.k]+=v;grid[g.dow][g.hour][s.k]+=v;tot[s.k]+=v}
  }

  const prod=$('ldProduk').value,store=$('ldStore').selectedOptions[0];
  put('ldPeriod','Pola jam order masuk · '+(r.all?'semua data sejak '+fmtRange(from,from):fmtRange(d.from,d.to))+' · '+int(nHari)+' hari'+
    (store&&store.value?' · '+store.textContent:'')+(prod?' · '+prod:''));
  const bagi=n=>tot.orders?pct(100*n/tot.orders):'—',perHari=n=>nHari?ld1(n/nHari)+' /hari':'';
  const angka=(id,n)=>{$(id).innerHTML=int(n)+'<span class="pc">'+bagi(n)+'</span>'};
  $('ldKpiLead').textContent=int(tot.orders);put('ldKpiLeadD',int(nHari)+' hari · '+perHari(tot.orders));
  angka('ldKpiComplete',tot.confirmed);put('ldKpiCompleteD','Order dikonfirmasi · '+perHari(tot.confirmed));
  angka('ldKpiPending',tot.pending);put('ldKpiPendingD','Lead masih pending');
  angka('ldKpiCancel',tot.canceled);put('ldKpiCancelD','Lead dibatalkan');

  // Puncak dihitung dari rata-rata lead masuk
  const jamMax=Math.max(...jam.map(x=>x.orders)),jamP=jamMax>0?jam.findIndex(x=>x.orders===jamMax):-1;
  $('ldKpiJam').textContent=jamP<0?'—':ldJam(jamP);
  put('ldKpiJamD',jamP<0?'Belum ada lead':ldJamS(jamP)+' · '+ld1(jamMax/Math.max(1,nHari))+' lead/hari');
  const rataDow=LD_HARI.map((_,i)=>nDow[i]?grid[i].reduce((a,x)=>a+x.orders,0)/nDow[i]:0);
  const dowMax=Math.max(...rataDow),dowP=dowMax>0?rataDow.indexOf(dowMax):-1;
  $('ldKpiHari').textContent=dowP<0?'—':LD_HARI[dowP];
  put('ldKpiHariD',dowP<0?'Belum ada lead':ld1(dowMax)+' lead rata-rata per '+LD_HARI[dowP]);

  put('ldJamSub','Rata-rata order per jam per hari (WIB), dari '+int(nHari)+' hari · puncak lead '+(jamP<0?'—':ldJam(jamP))+(dowP<0?'':' · hari puncak '+LD_HARI[dowP]));
  ldSeriTombol();
  const rata=(x,n)=>{const o={};for(const s of LD_SERI)o[s.k]=n?x[s.k]/n:0;return o};
  if(typeof Chart!=='undefined'){if(ldChart)ldChart.destroy();ldChart=new Chart($('ldJam'),ldConfig(jam.map(x=>rata(x,nHari)),false))}

  // Per hari: rata-rata per jam untuk hari itu (dibagi berapa kali hari tsb muncul di rentang)
  const mini=LD_URUT.map(i=>({i,n:nDow[i],jam:grid[i].map(x=>rata(x,nDow[i]))}));
  const skala=Math.max(1,...mini.flatMap(m=>m.jam.flatMap(x=>LD_SERI.filter(s=>ldOn.has(s.k)).map(s=>x[s.k]))));
  $('ldHari').innerHTML=mini.map(m=>{
    const t=m.jam.reduce((a,x)=>{a.o+=x.orders;a.c+=x.confirmed;return a},{o:0,c:0});
    return '<div class="card ld-mini'+(m.i===dowP?' puncak':'')+'"><div class="ld-mini-h"><b>'+LD_HARI[m.i]+(m.i===dowP?' <span class="tag info">Puncak</span>':'')+'</b>'+
      '<span><b class="ld-c-lead">'+ld1(t.o)+'</b> lead · <b class="ld-c-ok">'+ld1(t.c)+'</b> complete /hari · '+int(m.n)+'×</span></div>'+
      '<div class="ld-mini-c"><canvas></canvas></div></div>'}).join('');
  ldMini.forEach(c=>c.destroy());ldMini=[];
  if(typeof Chart==='undefined')return;
  $('ldHari').querySelectorAll('canvas').forEach((cv,k)=>ldMini.push(new Chart(cv,ldConfig(mini[k].jam,true,skala))));
}

function ldSeriTombol(){
  $('ldSeri').innerHTML=LD_SERI.map(s=>'<button class="'+(ldOn.has(s.k)?'on':'')+'" data-k="'+s.k+'" style="--c:var('+s.c+')"><i></i>'+s.l+'</button>').join('');
}
/** Grafik batang 24 jam; versi kecil untuk kartu per hari memakai skala sumbu y yang sama */
function ldConfig(jam,kecil,skala){
  const bar={borderRadius:kecil?1:3,barPercentage:.85,categoryPercentage:kecil?.9:.8};
  return {type:'bar',
    data:{labels:jam.map((_,h)=>kecil?String(h).padStart(2,'0'):ldJam(h)),
      datasets:LD_SERI.filter(s=>ldOn.has(s.k)).map(s=>Object.assign({label:s.l,data:jam.map(x=>Math.round(x[s.k]*100)/100),backgroundColor:css(s.c)},bar))},
    options:{responsive:true,maintainAspectRatio:false,animation:kecil?false:undefined,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{callbacks:{title:it=>ldJamS(it[0].dataIndex),label:it=>it.dataset.label+': '+ld1(it.raw)+' /hari'}}},
      scales:{x:{grid:{display:false},ticks:kecil?{maxTicksLimit:8,font:{size:10},maxRotation:0}:{maxRotation:0}},
        y:{display:!kecil,max:kecil?skala:undefined,grid:{color:css('--line')},border:{display:false},beginAtZero:true}}}};
}
function pasangLead(){
  $('ldRange').addEventListener('click',e=>{if(e.target.closest('button'))loadLead()});
  $('ldStore').addEventListener('change',loadLead);
  $('ldProduk').addEventListener('change',loadLead);
  $('ldSeri').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(ldOn.has(b.dataset.k)){if(ldOn.size>1)ldOn.delete(b.dataset.k)}else ldOn.add(b.dataset.k);
    if(ldData)renderLead(ldData,rentang('ldRange'));
  });
}

// Filter & tombol seri Performa Lead
pasangLead();
