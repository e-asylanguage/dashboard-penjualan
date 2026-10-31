/**
 * Sales › Performa CS: kotak lead / closing / pending / cancel + pop-up penyumbang per produk, tabel per CS, alasan batal, grafik harian,
 * waktu balas per jam / hari, status kapasitas CS, ekspor CSV. Data: /api/report/cs, /api/report/cs-rincian.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta rentang() & loadSettings() dari script utama (window.*).
 * Dipanggil dari script utama: openCs() (menu Performa CS), loadCs() (setelah sinkron manual saat halaman ini terbuka).
 */
// ---- Performa CS
const csNote=v=>{const e=$('csNote');if(e){e.textContent=v||'';e.hidden=!v}};
let csData=null,csBusy=false;

const csDates=()=>rentang('csRange');

async function loadCs(){
  if(csBusy)return;csBusy=true;csNote('');
  $('csRows').innerHTML='<tr><td colspan="10" style="color:var(--muted)">Memuat…</td></tr>';
  const r=csDates(),store=$('csStore').value;
  const q=new URLSearchParams({from:r.from,to:r.to});
  if(store)q.set('store_id',store);
  try{
    csData=await api('/api/report/cs?'+q);
    renderCs(csData);
  }catch(e){
    csData=null;
    $('csRows').innerHTML='<tr><td colspan="10" style="color:var(--loss)">Gagal memuat data.</td></tr>';
    $('csCancel').innerHTML='<tr><td colspan="3" style="color:var(--muted)">—</td></tr>';
    csNote('Tidak bisa mengambil data ('+esc(e.message)+'). Pastikan sinkron Scalev sudah pernah jalan dan password dashboard benar.');
  }finally{csBusy=false}
}

const csPcs=r=>r.confirmed?nf.format(Math.round(100*(r.sold||0)/r.confirmed)/100):'—';
function renderCs(d){
  const t=d.team||{},rows=d.per_cs||[];
  const active=rows.filter(r=>r.handler_id);
  put('csPeriod','Per handler order di Scalev · '+fmtRange(d.from,d.to)+' · tanggal acuan: order masuk');
  // Persentase semua card dihitung terhadap Lead Kotor (seluruh order masuk).
  const kpi=(id,n)=>{const e=$(id);if(e)e.innerHTML=esc(int(n))+'<span class="pc">'+esc(pct(t.orders?100*(n||0)/t.orders:null))+'</span>'};
  const dari=n=>int(n)+' dari '+int(t.orders)+' lead';
  kpi('csKpiLead',t.orders);
  put('csKpiLeadD',active.length?'Order masuk · '+active.length+' CS aktif · '+int(t.orders/active.length)+' per CS':'Order masuk · belum ada order ber-handler');
  kpi('csKpiClosing',t.confirmed);
  put('csKpiClosingD',dari(t.confirmed)+' sudah dikonfirmasi');
  kpi('csKpiPending',t.pending);
  put('csKpiPendingD',dari(t.pending)+' masih pending');
  kpi('csKpiCancel',t.canceled);
  put('csKpiCancelD',dari(t.canceled)+' dibatalkan');

  const best=Math.max(-1,...active.filter(r=>r.orders>=10&&r.confirm_rate!=null).map(r=>r.confirm_rate));
  $('csRows').innerHTML=rows.length?rows.map((r,i)=>{
    const anon=!r.handler_id;
    const cr=(!anon&&r.confirm_rate!=null&&r.confirm_rate===best)?'<span class="tag rev">'+pct(r.confirm_rate)+'</span>':pct(r.confirm_rate);
    return '<tr><td class="n" style="color:var(--muted)">'+(i+1)+'</td>'+
      '<td class="name"'+(anon?' style="color:var(--muted)"':'')+'>'+esc(r.handler_name)+'</td>'+
      '<td class="n">'+int(r.orders)+'</td><td class="n">'+int(r.confirmed)+'</td>'+
      '<td class="n">'+int(r.pending)+'</td><td class="n">'+int(r.canceled)+'</td>'+
      '<td class="n">'+cr+'</td>'+
      '<td class="n">'+int(r.sold)+(r.sold_kurang?'<small title="Varian belum punya SKU atau SKU-nya belum diisi komposisi List Produk di Manajemen SKU — dihitung 1 pcs per qty">'+int(r.sold_kurang)+' order isi SKU belum diatur</small>':'')+'</td><td class="n" title="Rata-rata '+esc(csPcs(r))+' pcs per closing">'+(r.confirmed?pct(100*r.sold/r.confirmed):'—')+'</td>'+
      '<td class="n">'+rpFull(r.confirmed_value)+'</td></tr>';
  }).join(''):'<tr><td colspan="10" style="color:var(--muted)">Belum ada order pada rentang ini.</td></tr>';

  const cr=d.cancel_reasons||[],tot=cr.reduce((a,b)=>a+(b.orders||0),0);
  $('csCancel').innerHTML=cr.length?cr.map((x,i)=>'<tr data-bt="'+i+'" style="cursor:pointer" title="Klik untuk melihat order ID"><td>'+esc(x.reason)+'</td><td class="n">'+int(x.orders)+'</td><td class="n">'+(tot?pct(100*x.orders/tot):'—')+'</td></tr>').join('')
    :'<tr><td colspan="3" style="color:var(--muted)">Tidak ada order batal pada rentang ini.</td></tr>';

  drawCs(d.daily||[],d.from,d.to);
  drawHeat(d);
  renderCap(d,active);
}

// Alasan batal → pop-up daftar order ID Scalev untuk alasan itu
let csBtIds=[];
$('csCancel').addEventListener('click',e=>{
  const tr=e.target.closest('tr[data-bt]'),x=tr&&csData&&(csData.cancel_reasons||[])[+tr.dataset.bt];if(!x)return;
  csBtIds=x.order_ids||[];
  put('csBtJ','Order batal: '+x.reason);
  put('csBtSub',int(x.orders)+' order · '+fmtRange(csData.from,csData.to)+(csBtIds.length<x.orders?' · '+int(x.orders-csBtIds.length)+' order tanpa order ID':''));
  $('csBtRows').innerHTML=csBtIds.length?csBtIds.map((id,i)=>'<tr><td class="n" style="color:var(--muted)">'+(i+1)+'</td><td>'+esc(id)+'</td></tr>').join('')
    :'<tr><td colspan="2" style="color:var(--muted)">Tidak ada order ID.</td></tr>';
  $('csBtSalin').textContent='Salin semua';$('csBtSalin').disabled=!csBtIds.length;
  $('csBtDlg').showModal();
});
$('csBtSalin').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(csBtIds.join('\n'));$('csBtSalin').textContent='Tersalin ✓'}catch{$('csBtSalin').textContent='Gagal menyalin'}
});

function openCs(){loadSettings().catch(function(){});loadCs();}

let csChart=null;
/** Deret harian from..to; tanggal tanpa order tetap tampil sebagai nol. */
function drawCs(daily,from,to){
  if(typeof Chart==='undefined')return;
  const per=new Map(daily.map(r=>[r.date,r]));
  const tgl=[];for(let t=from;t<=to&&tgl.length<400;t=shift(t,1))tgl.push(t);
  const seri=k=>tgl.map(t=>(per.get(t)||{})[k]||0);
  const labels=tgl.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const data=[seri('orders'),seri('confirmed'),seri('pending'),seri('canceled')];
  if(csChart){csChart.data.labels=labels;data.forEach((d,i)=>csChart.data.datasets[i].data=d);csChart.update();return;}
  const line=css('--line'),bar={borderRadius:3,barPercentage:.8,categoryPercentage:.8};
  csChart=new Chart(document.getElementById('csHourly'),{type:'bar',
    data:{labels,datasets:[
      Object.assign({label:'Lead kotor',data:data[0],backgroundColor:css('--info')},bar),
      Object.assign({label:'Closing',data:data[1],backgroundColor:css('--rev')},bar),
      Object.assign({label:'Pending',data:data[2],backgroundColor:css('--spend')},bar),
      Object.assign({label:'Cancel',data:data[3],backgroundColor:css('--loss')},bar)]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{grid:{display:false},stacked:false},y:{grid:{color:line},border:{display:false},beginAtZero:true}}}});
}

/**
 * Waktu balas CS: menit jam kerja CS (06:00–21:00 WIB, dihitung di backend) dari lead dibuat (created_at) sampai pending (pending_time).
 * Per jam lead masuk (0–23 WIB, seluruh rentang) atau per tanggal. Batang = median waktu balas;
 * rasio balas = lead yang sudah melewati pending ÷ semua lead. Batang paling lambat disorot.
 */
const BALAS_CEPAT_MENIT=15;          // "dibalas cepat" di tooltip — ubah bila target tim berubah
let csHeatChart=null,csHeatData=null;
const median=a=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),t=s.length>>1;return s.length%2?s[t]:(s[t-1]+s[t])/2};
function drawHeat(d){
  if(d)csHeatData=d;d=csHeatData;if(!d)return;
  const mode=((document.querySelector('#csHeatMode button.on')||{}).dataset||{}).mode||'jam';
  // balas: [tanggal, jam WIB, menit|null, ada_pending]
  const rows=d.balas||[];
  let kunci,labels,judul;
  if(mode==='hari'){
    kunci=[];for(let t=d.from;t<=d.to&&kunci.length<400;t=shift(t,1))kunci.push(t);
    const f=o=>new Intl.DateTimeFormat('id-ID',Object.assign({timeZone:'UTC'},o));
    labels=kunci.map(t=>f({day:'numeric',month:'short'}).format(new Date(t+'T00:00:00Z')));
    judul=kunci.map(t=>f({weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(t+'T00:00:00Z')));
    put('csHeatSub','Median waktu balas CS per tanggal lead masuk (WIB) · Created at → Pending at di Scalev, hanya jam kerja CS 06:00–21:00');
  }else{
    kunci=Array.from({length:24},(_,i)=>i);
    const jam=i=>String(i).padStart(2,'0')+':00';
    labels=kunci.map(jam);
    judul=kunci.map(i=>'Lead masuk '+jam(i)+' – '+(i===23?'24:00':jam(i+1))+' WIB');
    put('csHeatSub','Median waktu balas CS per jam lead masuk (WIB), seluruh rentang · Created at → Pending at di Scalev, hanya jam kerja CS 06:00–21:00');
  }
  const idx=new Map(kunci.map((k,i)=>[k,i]));
  const grup=kunci.map(()=>({lead:0,dibalas:0,menit:[]}));
  for(const [tgl,jam,m,ada] of rows){
    const i=idx.get(mode==='hari'?tgl:Number(jam));if(i==null)continue;
    const g=grup[i];g.lead++;if(ada)g.dibalas++;if(m!=null)g.menit.push(m);
  }
  const nilai=grup.map(g=>median(g.menit));
  // Ringkasan keseluruhan di badge
  const semua=rows.filter(r=>r[2]!=null).map(r=>r[2]),lead=rows.length,dibalas=rows.filter(r=>r[3]).length;
  const med=median(semua),tag=$('csPeak');
  if(tag)tag.textContent=lead?'Median balas '+(med==null?'—':mins(med))+' · rasio balas '+pct(100*dibalas/lead)+' ('+int(dibalas)+'/'+int(lead)+' lead)':'Belum ada lead';
  if(typeof Chart==='undefined')return;
  const maks=Math.max(0,...nilai.filter(v=>v!=null)),lambat=maks>0?nilai.indexOf(maks):-1;
  const warna=nilai.map((_,i)=>i===lambat?css('--loss'):css('--info'));
  const tip=it=>{const g=grup[it.dataIndex],v=nilai[it.dataIndex];if(!g.lead)return ' Tidak ada lead';
    const cepat=g.menit.filter(m=>m<=BALAS_CEPAT_MENIT).length;
    return [' Median balas: '+(v==null?'—':mins(v))+(it.dataIndex===lambat?' (paling lambat)':''),
      ' Rata-rata: '+(g.menit.length?mins(g.menit.reduce((a,b)=>a+b,0)/g.menit.length):'—'),
      ' Rasio balas: '+pct(100*g.dibalas/g.lead)+' ('+int(g.dibalas)+'/'+int(g.lead)+' lead)',
      ' Dibalas ≤ '+BALAS_CEPAT_MENIT+' menit: '+(g.menit.length?pct(100*cepat/g.menit.length):'—')]};
  if(csHeatChart){
    Object.assign(csHeatChart.data,{labels});
    Object.assign(csHeatChart.data.datasets[0],{data:nilai,backgroundColor:warna});
    csHeatChart.options.plugins.tooltip.callbacks.title=it=>judul[it[0].dataIndex];
    csHeatChart.options.plugins.tooltip.callbacks.label=tip;
    csHeatChart.options.scales.x.ticks.maxTicksLimit=mode==='hari'?12:24;
    csHeatChart.update();return;
  }
  csHeatChart=new Chart(document.getElementById('csHeat'),{type:'bar',
    data:{labels,datasets:[{label:'Median waktu balas',data:nilai,backgroundColor:warna,borderRadius:4,barPercentage:.75}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},
        tooltip:{callbacks:{title:it=>judul[it[0].dataIndex],label:tip}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:mode==='hari'?12:24}},
        y:{grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>mins(v)}}}}});
}

// Ambang panel kapasitas CS — ubah di sini bila standar tim berubah.
const KAPASITAS_LEAD_PER_CS=80;     // lead/hari yang sanggup ditangani satu CS
const BATAS_KONFIRMASI_MENIT=60;    // target waktu dari order masuk sampai dikonfirmasi
const batasTeks=BATAS_KONFIRMASI_MENIT%60===0?(BATAS_KONFIRMASI_MENIT/60)+' jam':BATAS_KONFIRMASI_MENIT+' menit';

function renderCap(d,active){
  const t=d.team||{};
  const nCs=Math.max(1,active.length);
  const hari=Math.max(1,Math.round((new Date(d.to)-new Date(d.from))/86400000)+1);
  const perHari=(t.orders||0)/hari, perCs=perHari/nCs;
  const beban=perCs/KAPASITAS_LEAD_PER_CS;
  const baris=(id,tone,teks,rasio)=>{
    const el=$(id);if(!el)return;
    el.className='cap tone-'+tone;
    el.querySelector('b').textContent=teks;
    el.querySelector('i').style.width=Math.min(100,Math.max(0,rasio*100))+'%';
  };
  put('csCapTitle','Status Kapasitas '+nCs+' CS');
  put('csCapSub','Indikator otomatis kebutuhan menambah CS ke-'+(nCs+1)+' · kapasitas '+KAPASITAS_LEAD_PER_CS+' lead/hari per CS · waktu dihitung di jam kerja CS 06:00–21:00');
  baris('csCapVol',beban>=1?'loss':beban>=.7?'spend':'rev',
    nf.format(Math.round(perCs))+' / '+KAPASITAS_LEAD_PER_CS+' lead/hari ('+pct(beban*100)+')',beban);

  const med=t.median_confirm_minutes;
  if(med==null)baris('csCapSpeed','info','Belum ada data',0);
  else baris('csCapSpeed',med<=BATAS_KONFIRMASI_MENIT?'rev':'loss',mins(med)+' / batas '+batasTeks,med/BATAS_KONFIRMASI_MENIT);

  const antre=t.unhandled||0,lama=t.unhandled_over_6h||0;
  baris('csCapBacklog',lama?'spend':'info',int(antre)+' lead'+(lama?' · '+int(lama)+' > 6 jam kerja':''),t.orders?antre/t.orders:0);

  const target=nCs*KAPASITAS_LEAD_PER_CS;
  let rek=beban>=1
    ?'Beban sudah melewati kapasitas ('+nf.format(Math.round(perHari))+' lead/hari untuk '+nCs+' CS). Disarankan menambah CS ke-'+(nCs+1)+'.'
    :beban>=.7
    ?'Beban mendekati kapasitas. Mulai siapkan CS ke-'+(nCs+1)+'; rekrut bila lead harian konsisten di atas '+nf.format(target)+' lead/hari.'
    :'Kapasitas CS saat ini ideal. Belum perlu menambah CS ke-'+(nCs+1)+' sampai lead harian mendekati konsisten di angka '+nf.format(target)+' lead/hari.';
  if(med!=null&&med>BATAS_KONFIRMASI_MENIT)rek+=' Waktu konfirmasi median '+mins(med)+' masih di atas batas '+batasTeks+' — percepat follow-up lebih dulu.';
  if(lama)rek+=' Ada '+int(lama)+' lead menunggu lebih dari 6 jam kerja.';
  put('csCapRec',rek);
}

// ---- Pop-up rincian card Performa CS per produk / kelompok produk
const RINCIAN={
  orders:   {judul:'LEAD KOTOR',tone:'info', gross:'gross_orders'},
  confirmed:{judul:'CLOSING',   tone:'rev',  gross:'gross_confirmed'},
  pending:  {judul:'PENDING',   tone:'spend',gross:'gross_pending'},
  canceled: {judul:'CANCEL',    tone:'loss', gross:'gross_canceled'},
};
const rinciSt={key:'orders',mode:'produk',data:null,q:''};

/** "AQWBUKDEB001 Buku Debat - FB" → "Buku Debat": buang kode SKU di depan dan varian setelah " - ". */
function namaKelompok(p){
  return String(p||'').replace(/^[A-Z]{3,}[A-Z0-9]*\d\s+/,'').split(' - ')[0].trim()||String(p||'');
}

function renderRinci(){
  const d=rinciSt.data,cfg=RINCIAN[rinciSt.key],k=rinciSt.key;
  if(!d)return;
  const t=d.total||{},lead=t.orders||0;
  let baris=(d.products||[]).map(r=>({nama:r.product,n:r[k]||0,lead:r.orders||0,gross:r[cfg.gross]||0}));
  if(rinciSt.mode==='kelompok'){
    const g=new Map();
    for(const r of baris){
      const kunci=namaKelompok(r.nama).toLowerCase();
      const x=g.get(kunci)||{nama:namaKelompok(r.nama),n:0,lead:0,gross:0,varian:0};
      x.n+=r.n;x.lead+=r.lead;x.gross+=r.gross;x.varian++;g.set(kunci,x);
    }
    baris=[...g.values()];
  }
  baris=baris.filter(r=>r.n>0).sort((a,b)=>b.n-a.n||b.gross-a.gross);
  const semuaLead=k==='orders';
  const persen=r=>semuaLead?(lead?100*r.n/lead:null):(r.lead?100*r.n/r.lead:null);
  const jml=t[k]||0;
  $('rinciSum').innerHTML='Total '+esc(cfg.judul)+': <b>'+int(jml)+'</b>'+
    (semuaLead?'':' ('+pct(lead?100*jml/lead:null)+' dari '+int(lead)+' lead)')+
    ' · omzet <b>'+rpFull(t[cfg.gross])+'</b> — diurut terbanyak → terkecil.'+
    ' Order berisi beberapa produk dihitung di tiap produknya.';
  $('rinciKolom').textContent=rinciSt.mode==='kelompok'?'Kelompok':'Produk';
  $('rinciPctH').textContent=semuaLead?'% Total':'% Lead';
  $('rinciLeadH').hidden=semuaLead;
  $('rinciKet').textContent=semuaLead?'% = porsi dari seluruh lead':'% = terhadap jumlah lead '+(rinciSt.mode==='kelompok'?'kelompok':'produk')+' itu';
  $('rinciRows').innerHTML=baris.length?baris.map(r=>'<tr><td class="name">'+esc(r.nama)+
      (r.varian>1?' <small style="color:var(--muted)">'+r.varian+' varian</small>':'')+'</td>'+
      '<td class="n"><b>'+int(r.n)+'</b></td><td class="n pc">'+pct(persen(r))+'</td>'+
      (semuaLead?'':'<td class="n mut">'+int(r.lead)+'</td>')+
      '<td class="n">'+rpFull(r.gross)+'</td></tr>').join('')
    :'<tr><td colspan="5" style="color:var(--muted)">Tidak ada order '+esc(cfg.judul.toLowerCase())+' pada rentang ini.</td></tr>';
}

async function bukaRinci(key){
  const cfg=RINCIAN[key],dlg=$('rinci');if(!cfg||!dlg)return;
  rinciSt.key=key;
  dlg.className='rinci tone-'+cfg.tone;
  $('rinciJudul').textContent='Penyumbang '+cfg.judul+' per '+(rinciSt.mode==='kelompok'?'Kelompok':'Produk');
  if(!dlg.open)dlg.showModal();
  const r=csDates(),store=$('csStore').value;
  const q=new URLSearchParams({from:r.from,to:r.to});if(store)q.set('store_id',store);
  if(rinciSt.q!==q.toString()||!rinciSt.data){
    rinciSt.data=null;$('rinciRows').innerHTML='';$('rinciSum').textContent='Memuat…';
    try{rinciSt.data=await api('/api/report/cs-rincian?'+q);rinciSt.q=q.toString()}
    catch(e){$('rinciSum').textContent='Gagal memuat data ('+e.message+').';return}
  }
  renderRinci();
}

/** Dipanggil di bawah, setelah helper $ tersedia. */
function pasangRinci(){
  document.querySelectorAll('[data-rincian]').forEach(el=>{
    el.addEventListener('click',()=>bukaRinci(el.dataset.rincian));
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();bukaRinci(el.dataset.rincian)}});
  });
  $('rinciTabs').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    rinciSt.mode=b.dataset.mode;
    $('rinciTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
    $('rinciJudul').textContent='Penyumbang '+RINCIAN[rinciSt.key].judul+' per '+(rinciSt.mode==='kelompok'?'Kelompok':'Produk');
    renderRinci();
  });
  $('rinciTutup').addEventListener('click',()=>$('rinci').close());
  // Klik di luar kotak (backdrop) menutup pop-up
  $('rinci').addEventListener('click',e=>{if(e.target===$('rinci'))$('rinci').close()});
}

// Filter, ekspor & pop-up rincian
pasangRinci();
$('csRange').addEventListener('click',e=>{if(e.target.closest('button'))loadCs()});
$('csStore').addEventListener('change',loadCs);
$('csHeatMode').addEventListener('click',e=>{if(e.target.closest('button'))drawHeat()});
$('csExport').addEventListener('click',()=>{
  if(!csData||!(csData.per_cs||[]).length)return;
  unduhCsv('performa-cs-'+csData.from+'_'+csData.to+'.csv',
    ['#','CS','Lead','Complete','Pending','Cancel','CR (%)','Sold (pcs)','CR Sold (%)','Revenue'],
    csData.per_cs.map((r,i)=>[i+1,r.handler_name,r.orders,r.confirmed,r.pending,r.canceled,r.confirm_rate,r.sold,r.confirmed?Math.round(1000*r.sold/r.confirmed)/10:'',r.confirmed_value]));
});
