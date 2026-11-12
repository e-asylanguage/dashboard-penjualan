/**
 * Menu Ringkasan: pipeline order (website / Shopee / TikTok), KPI harian, per BM, grafik harian & sparkline.
 * Data: /api/report/ringkasan. Script biasa (bukan module), dimuat SETELAH script utama (js/main.js):
 * memakai utils.js & api.js, serta rentang() dari script utama (window.rentang).
 * Dipanggil dari script utama: loadRingkasan() (pindah menu & setelah sinkron).
 */
// ---- Ringkasan: seluruh angka dari /api/report/ringkasan
let rkData=null,rkBusy=false,rkChart=null;const rkSpark={};

/** Selisih persen hari ini vs kemarin → "▲ 6%" hijau/merah; naikBaik=false untuk metrik yang lebih baik bila turun. */
function rkDelta(a,b,naikBaik){
  if(!b)return '';
  const d=100*(a-b)/b,naik=d>=0,baik=naikBaik===false?!naik:naik;
  return '<b class="'+(baik?'up':'down')+'">'+(naik?'▲':'▼')+' '+pct(Math.abs(d))+'</b>';
}
function rkDeltaPt(a,b,naikBaik){
  if(a==null||b==null)return '';
  const d=a-b,naik=d>=0,baik=naikBaik===false?!naik:naik;
  return '<b class="'+(baik?'up':'down')+'">'+(naik?'▲':'▼')+' '+nf.format(Math.round(Math.abs(d)*10)/10)+' pt</b>';
}
const rkSet=(id,html)=>{const e=$(id);if(e)e.innerHTML=html};
const rkBar=parts=>parts.filter(p=>p[0]>0).map(p=>'<i style="width:'+Math.min(100,p[0]).toFixed(1)+'%;background:'+p[1]+'"></i>').join('');
/** Rolling RTS 30 hari yang berakhir di `akhir` dari deret paket per hari (DELIVERED vs RTS). */
function rkRts(rh,akhir){
  let dl=0,rt=0;
  for(let i=0;i<30;i++){const r=rh.get(shift(akhir,-i));if(r){dl+=r.delivered;rt+=r.rts}}
  return dl+rt?100*rt/(dl+rt):null;
}

function renderRingkasan(){
  const d=rkData,o=d.orders||{},s=d.spend||{},b=d.biaya||{},n=v=>v||0;
  const bmSel=$('rkBm'),stSel=$('rkStore');
  put('rkPeriod',fmtRange(d.from,d.to)+' · '+(bmSel.value?bmSel.options[bmSel.selectedIndex].text:'semua BM')+
    (stSel.value?' · '+stSel.options[stSel.selectedIndex].text:'')+' · tanggal acuan: order masuk');

  rkPipeline();
  // kr = kebocoran yang membuat angka meleset (merah, paling atas); cat = catatan biasa
  // Masalah data (spend tidak terhitung, HPP kosong, paket tidak ditemukan) ditampilkan di Pengaturan — lihat pgMasalah di pengaturan.js
  const cat=[],kr=[];
  if(bmSel.value)cat.push('Filter BM aktif: hanya order dengan UTM campaign milik BM ini yang dihitung.');
  if((bmSel.value||stSel.value)&&rkKanal!=='web')cat.push('Filter BM / store hanya berlaku untuk website — angka Shopee & TikTok di pipeline tetap semua toko.');
  if(bmSel.value||stSel.value)cat.push('RTS di kartu "Selesai & cair" diambil dari Mengantar dan tidak ikut filter BM / store (paket belum bisa dipasangkan ke order Scalev).');
  // Spend dipilah per store lewat pasangan store pada ad account; tanpa pasangan spend-nya kosong
  if(stSel.value&&!s.spend)kr.push('Spend tidak bisa dipilah per store karena belum ada akun iklan yang dipasangkan ke store ini — ROAS, biaya per order, dan net profit di halaman ini belum dikurangi spend iklan.');
  const nt2=$('rkNote');nt2.hidden=!(kr.length+cat.length);nt2.classList.toggle('kritis',!!kr.length);
  nt2.innerHTML='<div class="ik-alert-h">⚠ '+(kr.length?'Perlu dicek: '+int(kr.length)+' masalah data yang membuat angka meleset':'Catatan data')+'</div><ul>'+
    kr.map(x=>'<li class="kr">'+esc(x)+'</li>').join('')+cat.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';

  // KPI harian (tidak ikut rentang, tetap ikut filter BM / store)
  const k=d.kpi,sp=k.spend,od=k.orders,L=sp.length-1;
  put('rkK1',rp(sp[L].spend));rkSet('rkK1D',rkDelta(sp[L].spend,sp[L-1].spend)+' vs kemarin ('+esc(rp(sp[L-1].spend))+')');
  put('rkK2',int(od[L].orders));
  rkSet('rkK2D',rkDelta(od[L].orders,od[L-1].orders)+' vs kemarin · CPR '+(od[L].orders?esc(rpFull(sp[L].spend/od[L].orders)):'—'));
  const cr=a=>{const t=a.reduce((x,r)=>({o:x.o+r.orders,c:x.c+r.confirmed}),{o:0,c:0});return t.o?100*t.c/t.o:null};
  const cr7=cr(od.slice(7)),crLalu=cr(od.slice(0,7));
  put('rkK3',pct(cr7));
  const lemah=(k.store_7d||[]).map(r=>({n:r.store_name,v:100*r.confirmed/r.orders})).sort((a,b)=>a.v-b.v)[0];
  rkSet('rkK3D',rkDeltaPt(cr7,crLalu)+' vs 7 hari sebelumnya'+(lemah?' · terendah '+esc(lemah.n)+' '+pct(lemah.v):''));
  // RTS: paket Mengantar (tanggal paket dibuat), tidak ikut filter BM / store
  const rh=new Map((k.rts_hari||[]).map(r=>[r.date,r]));
  const rts=rkRts(rh,d.today),rtsLalu=rkRts(rh,shift(d.today,-30));
  put('rkK4',pct(rts));
  const kurir=(k.rts_kurir||[]).map(r=>({n:r.courier,v:100*r.rts/(r.rts+r.delivered)})).sort((a,b)=>b.v-a.v)[0];
  rkSet('rkK4D',rkDeltaPt(rts,rtsLalu,false)+' vs 30 hari sebelumnya'+(kurir?' · tertinggi '+esc(kurir.n)+' '+pct(kurir.v):''));

  // Per BM
  // BM tanpa spend campaign Scalev dan tanpa order tidak ditampilkan
  const bms=(d.per_bm||[]).filter(r=>r.spend>0||r.orders>0);
  put('rkBmP',fmtRange(d.from,d.to)+' · ROAS = nilai closing ÷ spend');
  const baris=bms.map(r=>{const roas=r.spend?r.omzet/r.spend:null;
    return '<tr><td class="name">'+esc(r.name)+'<small>'+int(r.akun)+' akun iklan · closing '+int(r.confirmed)+'</small></td><td class="n">'+rpFull(r.spend)+'</td><td class="n">'+int(r.orders)+'</td>'+
      '<td class="n">'+(roas==null?'—':'<span class="roas'+(roas<1?' low':'')+'"><i><b style="width:'+Math.min(100,roas/3*100)+'%"></b></i>'+nf2.format(roas)+'×</span>')+'</td></tr>'});
  if(d.tanpa_bm&&d.tanpa_bm.orders)baris.push('<tr><td class="name">Tanpa BM<small>UTM kosong / bukan campaign akun terpilih</small></td><td class="n">—</td><td class="n">'+int(d.tanpa_bm.orders)+'</td><td class="n">—</td></tr>');
  $('rkBmRows').innerHTML=baris.join('')||'<tr><td colspan="4" style="color:var(--muted)">Belum ada akun iklan yang dicentang.</td></tr>';
  const aktif=bms.filter(r=>r.spend>0),terendah=aktif.slice().sort((a,b)=>a.omzet/a.spend-b.omzet/b.spend)[0],cat2=[];
  if(terendah&&aktif.length>1){
    const t=terendah.top_campaign;
    cat2.push(terendah.name+' punya ROAS terendah ('+nf2.format(terendah.omzet/terendah.spend)+'×)'+
      (t&&t.name?'. Campaign "'+t.name+'" menyumbang '+pct(100*t.spend/terendah.spend)+' spend BM ini.':'.'));
  }
  if(d.tanpa_bm&&d.tanpa_bm.orders)cat2.push(int(d.tanpa_bm.orders)+' order tidak terlacak ke BM mana pun — cek template UTM di iklan.');
  $('rkBmNote').hidden=!cat2.length;$('rkBmNote').textContent=cat2.join(' ');

  rkGrafik();
}

/**
 * Pipeline "Dari iklan sampai barang diterima" per kanal: semua | web | shopee | tiktok.
 * Website (Scalev + Mengantar) dan marketplace (pesanan Shopee / TikTok menurut tanggal dibuat) dipetakan ke tahap yang sama:
 *  order masuk → dikonfirmasi (website: closing · marketplace: selain batal & belum bayar) → dikirim → selesai & cair.
 * ROI, ongkir + COD fee, dan net profit hanya ada untuk website (HPP & biaya marketplace ada di halaman Penghasilan masing-masing).
 */
let rkKanal='semua';
const RK_KANAL={semua:'Semua platform',web:'Website',shopee:'Shopee',tiktok:'TikTok Shop'};
function rkPipeAngka(){
  const d=rkData,o=d.orders||{},s=d.spend||{},n=v=>Number(v)||0,mg=d.rts_mengantar||{},mp=d.marketplace||{};
  const web={spend:n(s.spend),orders:n(o.orders),nilai:n(o.nilai),confirmed:n(o.confirmed),cval:n(o.confirmed_value),bayar:n(o.tf_paid),
    shipped:n(o.shipped),sval:n(o.shipped_value),antre:n(o.antre),jalan:n(o.perjalanan),jval:n(o.perjalanan_value),
    selesai:n(o.cair_cod)+n(o.tf_paid),selval:n(o.revenue_paid),rts:n(mg.rts),rtsval:n(mg.rts_value),batal:n(o.batal),
    terkirim:n(mg.delivered),omzet_iklan:0};
  const pasar=x=>{x=x&&x.total||{};return {spend:n(x.spend),orders:n(x.pesanan),nilai:n(x.nilai),confirmed:n(x.laku),cval:n(x.omzet),bayar:n(x.laku),
    shipped:n(x.kirim),sval:n(x.kirim_nilai),antre:n(x.antre),jalan:n(x.perjalanan),jval:n(x.perjalanan_nilai),
    selesai:n(x.terkirim),selval:n(x.terkirim_nilai),rts:n(x.retur),rtsval:n(x.retur_nilai),batal:n(x.batal),terkirim:n(x.terkirim),omzet_iklan:n(x.omzet_iklan)}};
  const k={web,shopee:pasar(mp.shopee),tiktok:pasar(mp.tiktok)};
  k.semua=Object.fromEntries(Object.keys(web).map(f=>[f,web[f]+k.shopee[f]+k.tiktok[f]]));
  return k;
}
function rkPipeline(){
  const d=rkData,o=d.orders||{},s=d.spend||{},b=d.biaya||{},n=v=>Number(v)||0,K=rkPipeAngka(),x=K[rkKanal],web=rkKanal==='web';
  const pO=v=>x.orders?100*n(v)/x.orders:0,tiga=f=>'<span>Web <b>'+f(K.web)+'</b></span><span>Shopee <b>'+f(K.shopee)+'</b></span><span>TikTok <b>'+f(K.tiktok)+'</b></span>';
  put('rkPipeSub',web?'Ikuti uang di tiap tahap. Order COD baru terhitung cair saat status selesai.'
    :rkKanal==='semua'?'Website + Shopee + TikTok Shop. Website: COD cair saat status selesai · marketplace: selesai saat pesanan terkirim / diterima.'
    :RK_KANAL[rkKanal]+' · pesanan menurut tanggal dibuat · selesai saat pesanan terkirim / diterima · tidak ikut filter BM / store.');
  // Spend
  put('rkSpend',rp(x.spend));
  put('rkSpendS',web?int(s.bms)+' BM · '+int(s.campaigns)+' campaign dengan order Scalev':rkKanal==='semua'?'Meta + iklan Shopee + iklan TikTok':'Iklan '+RK_KANAL[rkKanal]);
  rkSet('rkSpendX',web?'<span>CPM <b>'+(s.impressions?rpFull(1000*x.spend/s.impressions):'—')+'</b></span><span>CTR <b>'+(s.impressions?pct(100*n(s.link_clicks)/s.impressions):'—')+'</b></span>'
    :rkKanal==='semua'?tiga(c=>rp(c.spend)):'<span>Omzet dari iklan <b>'+rp(x.omzet_iklan)+'</b></span>');
  // Order masuk
  put('rkOrdR',x.orders&&x.spend>0?'CPR '+rp(x.spend/x.orders):'');put('rkOrd',int(x.orders));put('rkOrdS',rp(x.nilai)+' nilai order');
  rkSet('rkOrdX',web?'<span>COD <b>'+int(o.cod)+'</b></span><span>Transfer <b>'+int(o.transfer)+'</b></span>'
    :rkKanal==='semua'?tiga(c=>int(c.orders)):'<span>Belum bayar <b>'+int(Math.max(0,x.orders-x.confirmed-x.batal))+'</b></span><span>Batal <b>'+int(x.batal)+'</b></span>');
  // Dikonfirmasi
  put('rkCfR',x.orders?pct(100*x.confirmed/x.orders):'');put('rkCf',int(x.confirmed));put('rkCfS',rp(x.cval));
  rkSet('rkCfB',rkBar([[pO(x.bayar),'var(--rev)'],[pO(x.confirmed-x.bayar),'#B8C2CE']]));
  rkSet('rkCfX','<span>'+(web?'Sudah bayar (TF)':'Sudah dibayar')+' <b>'+int(x.bayar)+'</b></span>');
  // Dikirim
  const kirimCair=Math.min(x.selesai,x.shipped);
  put('rkShR',x.confirmed?pct(100*x.shipped/x.confirmed):'');put('rkSh',int(x.shipped));put('rkShS',rp(x.sval)+' · '+int(x.antre)+' antre');
  rkSet('rkShB',rkBar([[pO(kirimCair),'var(--rev)'],[pO(x.shipped-kirimCair),'#B8C2CE']]));
  rkSet('rkShX','<span>Dalam perjalanan <b>'+int(x.jalan)+'</b></span>');
  // Selesai & cair. Rasio RTS dari pesanan yang sudah selesai (terkirim + RTS / retur); website dari paket Mengantar
  const selesaiKirim=x.terkirim+x.rts;
  put('rkDnR',selesaiKirim?'RTS '+pct(100*x.rts/selesaiKirim):'');
  rkSet('rkDn',web?int(o.cair_cod)+'<small>+ '+int(o.tf_paid)+' TF</small>':int(x.selesai));put('rkDnS',rp(x.selval)+' sudah diterima');
  rkSet('rkDnB',rkBar([[pO(x.selesai),'var(--rev)'],[pO(x.rts+x.batal),'var(--loss)']]));
  const lRts=web?'RTS':rkKanal==='semua'?'RTS / retur':'Retur';
  rkSet('rkDnX','<span>'+lRts+' <b style="color:var(--loss)">'+int(x.rts)+'</b> · '+rp(x.rtsval)+'</span><span>Batal <b style="color:var(--loss)">'+int(x.batal)+'</b></span>');
  const rtsEl=$('rkDnR');if(rtsEl)rtsEl.title=selesaiKirim?int(x.rts)+' '+lRts+' dari '+int(selesaiKirim)+' pesanan yang sudah selesai dikirim'+(web?' (paket Mengantar dibuat pada rentang ini)':''):'';

  // Baris bawah. ROAS & CPR untuk kanal terpilih; ROI, ongkir & net profit hanya website (rumus halaman Iklan Meta)
  // Spend Shopee bisa ≤ 0 bila bonus proteksi ROAS lebih besar dari biaya iklan di rentang ini → ROAS / CPR tidak bermakna
  put('rkRoas',x.spend>0?nf2.format(x.cval/x.spend)+'×':'—');
  $('rkRoasBox').title=web?'Nilai order closing ÷ spend — sama dengan ROAS halaman Iklan Meta':'Omzet (pesanan dikonfirmasi) ÷ spend iklan';
  put('rkCpr',x.orders&&x.spend>0?rpFull(x.spend/x.orders):'—');
  put('rkJalan',rp(x.jval));
  const adaWeb=web||rkKanal==='semua',tag=rkKanal==='semua'?' <small>website</small>':'';
  rkSet('rkRoiL','ROI'+tag);rkSet('rkOngkirL','Ongkir + COD fee'+tag);rkSet('rkNetL','Net profit'+tag);
  const ri=$('rkRoi'),nt=$('rkNet');
  if(adaWeb){
    const sp=n(s.spend),net=n(o.confirmed_value)-sp-n(b.hpp)-n(b.scalev_fee)-n(b.ongkir)-n(b.cod_fee);
    ri.textContent=sp?(net>=0?'+':'')+pct(100*net/sp):'—';ri.className=sp&&net>=0?'pos':'';ri.style.color=sp&&net<0?'var(--loss)':'';
    put('rkOngkir',rp(n(b.ongkir)+n(b.cod_fee)));
    nt.textContent=(net>=0?'+ ':'− ')+rp(Math.abs(net));nt.className=net>=0?'pos':'';nt.style.color=net<0?'var(--loss)':'';
  }else{
    for(const e of [ri,nt]){e.textContent='—';e.className='';e.style.color=''}
    put('rkOngkir','—');
  }
  const lain=adaWeb?'':' Untuk '+RK_KANAL[rkKanal]+', lihat menu Penghasilan '+RK_KANAL[rkKanal]+'.';
  $('rkRoiBox').title='Website saja: net profit ÷ spend Meta — sama dengan ROI halaman Iklan Meta.'+lain;
  $('rkOngkirBox').title='Website saja: ongkir + COD fee paket Mengantar untuk order closing.'+lain;
  $('rkNetBox').title='Website saja: nilai closing − spend − HPP − Scalev fee − ongkir − COD fee (rumus halaman Iklan Meta).'+lain;
}
function rkGrafik(){
  if(typeof Chart==='undefined'||!rkData)return;
  const spend=css('--spend'),rev=css('--rev'),muted=css('--muted'),line=css('--line'),ink=css('--ink-2');
  Chart.defaults.font.family='"Plus Jakarta Sans",system-ui,sans-serif';Chart.defaults.font.size=11.5;Chart.defaults.color=ink;
  // Harian atau mingguan (Senin–Minggu)
  const on=document.querySelector('#rkGrain button.on'),mingguan=!!on&&on.dataset.g==='w';
  // Gabung deret website + Shopee + TikTok per tanggal
  const KOLOM=['spend','spend_shp','spend_tt','orders','revenue_paid','omzet_mp'],gab=new Map();
  const baru=t=>{let x=gab.get(t);if(!x){x={date:t};KOLOM.forEach(k=>x[k]=0);gab.set(t,x)}return x};
  for(const r of rkData.harian||[]){const x=baru(r.date);x.spend+=r.spend;x.orders+=r.orders;x.revenue_paid+=r.revenue_paid}
  const mp=rkData.marketplace||{};
  for(const [k,s] of [['shopee','spend_shp'],['tiktok','spend_tt']])for(const r of (mp[k]||{}).harian||[]){const x=baru(r.tgl);x[s]+=r.spend;x.orders+=r.pesanan;x.omzet_mp+=r.omzet}
  let rows=[...gab.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(mingguan){
    const m=new Map();
    for(const r of rows){const t=new Date(r.date+'T00:00:00Z'),senin=shift(r.date,-((t.getUTCDay()+6)%7));
      const x=m.get(senin)||Object.fromEntries([['date',senin]].concat(KOLOM.map(k=>[k,0])));KOLOM.forEach(k=>x[k]+=r[k]);m.set(senin,x)}
    rows=[...m.values()];
  }
  const lbl=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'});
  const labels=rows.map(r=>(mingguan?'Mg ':'')+lbl.format(new Date(r.date+'T00:00:00Z')));
  const jt=v=>Math.round(v/1e5)/10;
  if(rkChart)rkChart.destroy();
  rkChart=new Chart(document.getElementById('daily'),{
    type:'bar',
    data:{labels:labels,datasets:[
      {label:'Spend Meta',data:rows.map(r=>jt(r.spend)),backgroundColor:spend,barPercentage:.6,stack:'s',order:2},
      {label:'Spend Shopee',data:rows.map(r=>jt(r.spend_shp)),backgroundColor:css('--info'),barPercentage:.6,stack:'s',order:2},
      {label:'Spend TikTok',data:rows.map(r=>jt(r.spend_tt)),backgroundColor:css('--pb'),barPercentage:.6,stack:'s',order:2},
      {label:'Revenue cair website',data:rows.map(r=>jt(r.revenue_paid)),type:'line',stack:'l1',borderColor:rev,backgroundColor:rev,borderWidth:2.2,pointRadius:0,pointHoverRadius:4,tension:.35,order:1},
      {label:'Omzet Shopee + TikTok',data:rows.map(r=>jt(r.omzet_mp)),type:'line',stack:'l2',borderColor:css('--bo'),backgroundColor:css('--bo'),borderWidth:2,borderDash:[6,3],pointRadius:0,pointHoverRadius:4,tension:.35,order:1},
      {label:'Pesanan masuk',data:rows.map(r=>r.orders),type:'line',stack:'l3',borderColor:'#B8C2CE',borderDash:[4,4],borderWidth:1.5,pointRadius:0,tension:.35,yAxisID:'y2',order:0}
    ].filter(s=>s.yAxisID||s.label==='Spend Meta'||s.label==='Revenue cair website'||s.data.some(v=>v))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='y2'?' '+c.dataset.label+': '+nf.format(c.raw)+' order':' '+c.dataset.label+': Rp '+nf.format(c.raw)+' jt'}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:8}},
        y:{stacked:true,grid:{color:line},ticks:{callback:v=>'Rp '+nf.format(v)+' jt'},border:{display:false},suggestedMin:0},
        y2:{position:'right',grid:{display:false},ticks:{callback:v=>nf.format(v)+' order'},border:{display:false},suggestedMin:0}}}
  });
  // Sparkline 7 hari terakhir
  const k=rkData.kpi,tujuh=a=>a.slice(-7);
  const spark=(id,data,color)=>{if(rkSpark[id])rkSpark[id].destroy();
    rkSpark[id]=new Chart(document.getElementById(id),{type:'line',
      data:{labels:data.map((_,i)=>i),datasets:[{data:data,borderColor:color,borderWidth:1.8,pointRadius:0,tension:.4,fill:{target:'origin',above:color+'22'}}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false}}}})};
  spark('sp1',tujuh(k.spend).map(r=>r.spend),spend);
  spark('sp2',tujuh(k.orders).map(r=>r.orders),muted);
  spark('sp3',tujuh(k.orders).map(r=>r.orders?100*r.confirmed/r.orders:null),rev);
  const rh=new Map((k.rts_hari||[]).map(r=>[r.date,r]));
  spark('sp4',Array.from({length:7},(_,i)=>rkRts(rh,shift(rkData.today,i-6))),css('--loss'));
}

async function loadRingkasan(){
  if(rkBusy)return;rkBusy=true;
  const r=rentang('rkRange'),q=new URLSearchParams({from:r.from,to:r.to});
  if($('rkBm').value)q.set('bm',$('rkBm').value);if($('rkStore').value)q.set('store',$('rkStore').value);
  try{
    rkData=await api('/api/report/ringkasan?'+q);
    // Data bulan ini tanpa filter = persis yang dipakai peringatan masalah data di Pengaturan → tidak perlu diambil dua kali
    if(!q.get('bm')&&!q.get('store')&&typeof pgMasalahDari==='function'&&r.from===pgBulanIni().from&&r.to===pgBulanIni().to)pgMasalahDari(rkData);
    // Pilihan BM & store dari data; pilihan aktif dipertahankan
    const isi=(id,list,semua)=>{const sel=$(id),v=sel.value;
      sel.innerHTML='<option value="">'+semua+'</option>'+list.map(x=>'<option value="'+esc(x.id)+'"'+(String(x.id)===v?' selected':'')+'>'+esc(x.name)+'</option>').join('')};
    isi('rkBm',rkData.pilihan.bms,'Semua BM');isi('rkStore',rkData.pilihan.stores,'Semua store');
    renderRingkasan();
  }catch(e){put('rkPeriod','Gagal memuat data ('+e.message+')')}
  finally{rkBusy=false}
}
// Startup (fonts siap / window load): muat sekali, berikutnya cukup gambar ulang grafik
function drawCharts(){if(rkData)rkGrafik();else loadRingkasan()}

// ---- Ringkasan: filter
$('rkRange').addEventListener('click',e=>{if(e.target.closest('button'))loadRingkasan()});
$('rkBm').addEventListener('change',loadRingkasan);
$('rkStore').addEventListener('change',loadRingkasan);
$('rkKanal').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!rkData)return;
  rkKanal=b.dataset.k;$('rkKanal').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderRingkasan()});
$('rkGrain').addEventListener('click',e=>{if(e.target.closest('button'))setTimeout(rkGrafik)});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(drawCharts);else drawCharts();
window.addEventListener('load',drawCharts);
