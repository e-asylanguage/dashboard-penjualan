/**
 * Menu Ringkasan: pipeline order, KPI harian, per BM, per platform (website / Shopee / TikTok), grafik harian & sparkline.
 * Data: /api/report/ringkasan. Script biasa (bukan module), dimuat SETELAH script utama index.html:
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
  const spend=n(s.spend),orders=n(o.orders);
  const bmSel=$('rkBm'),stSel=$('rkStore');
  put('rkPeriod',fmtRange(d.from,d.to)+' · '+(bmSel.value?bmSel.options[bmSel.selectedIndex].text:'semua BM')+
    (stSel.value?' · '+stSel.options[stSel.selectedIndex].text:'')+' · tanggal acuan: order masuk');

  // Pipeline
  put('rkSpend',rp(spend));put('rkSpendS',int(s.bms)+' BM · '+int(s.campaigns)+' campaign dengan order Scalev');
  rkSet('rkSpendX','<span>CPM <b>'+(s.impressions?rpFull(1000*spend/s.impressions):'—')+'</b></span><span>CTR <b>'+(s.impressions?pct(100*n(s.link_clicks)/s.impressions):'—')+'</b></span>');
  put('rkOrdR',orders?'CPR '+rp(spend/orders):'');put('rkOrd',int(orders));put('rkOrdS',rp(o.nilai)+' nilai order');
  rkSet('rkOrdX','<span>COD <b>'+int(o.cod)+'</b></span><span>Transfer <b>'+int(o.transfer)+'</b></span>');
  const cair=n(o.cair_cod)+n(o.tf_paid),pO=v=>orders?100*n(v)/orders:0;
  put('rkCfR',orders?pct(100*n(o.confirmed)/orders):'');put('rkCf',int(o.confirmed));put('rkCfS',rp(o.confirmed_value));
  rkSet('rkCfB',rkBar([[pO(o.tf_paid),'var(--rev)'],[pO(n(o.confirmed)-n(o.tf_paid)),'#B8C2CE']]));
  rkSet('rkCfX','<span>Sudah bayar (TF) <b>'+int(o.tf_paid)+'</b></span>');
  const kirimCair=Math.min(cair,n(o.shipped));
  put('rkShR',o.confirmed?pct(100*n(o.shipped)/o.confirmed):'');put('rkSh',int(o.shipped));put('rkShS',rp(o.shipped_value)+' · '+int(o.antre)+' antre');
  rkSet('rkShB',rkBar([[pO(kirimCair),'var(--rev)'],[pO(n(o.shipped)-kirimCair),'#B8C2CE']]));
  rkSet('rkShX','<span>Dalam perjalanan <b>'+int(o.perjalanan)+'</b></span>');
  // RTS dari paket Mengantar (dibuat pada rentang ini); batal dari status order Scalev
  const mg=d.rts_mengantar||{},mgSelesai=n(mg.delivered)+n(mg.rts);
  put('rkDnR',mgSelesai?'RTS '+pct(100*n(mg.rts)/mgSelesai):'');
  rkSet('rkDn',int(o.cair_cod)+'<small>+ '+int(o.tf_paid)+' TF</small>');put('rkDnS',rp(o.revenue_paid)+' sudah diterima');
  rkSet('rkDnB',rkBar([[pO(cair),'var(--rev)'],[pO(n(mg.rts)+n(o.batal)),'var(--loss)']]));
  rkSet('rkDnX','<span>RTS <b style="color:var(--loss)">'+int(mg.rts||0)+'</b> · '+rp(mg.rts_value||0)+'</span><span>Batal <b style="color:var(--loss)">'+int(o.batal||0)+'</b></span>');
  const rtsEl=$('rkDnR');if(rtsEl)rtsEl.title=mgSelesai?'Dari Mengantar: '+int(mg.rts)+' RTS dari '+int(mgSelesai)+' paket yang sudah selesai (terkirim + RTS), paket dibuat pada rentang ini':'';

  // Baris bawah pipeline — net profit sama dengan halaman Iklan Meta
  const net=n(o.confirmed_value)-spend-n(b.hpp)-n(b.scalev_fee)-n(b.ongkir)-n(b.cod_fee);
  const ri=$('rkRoi');ri.textContent=spend?(net>=0?'+':'')+pct(100*net/spend):'—';ri.className=spend&&net>=0?'pos':'';ri.style.color=spend&&net<0?'var(--loss)':'';
  put('rkRoas',spend?nf2.format(n(o.confirmed_value)/spend)+'×':'—');
  put('rkCpr',orders?rpFull(spend/orders):'—');
  put('rkOngkir',rp(n(b.ongkir)+n(b.cod_fee)));
  const nt=$('rkNet');nt.textContent=(net>=0?'+ ':'− ')+rp(Math.abs(net));nt.className=net>=0?'pos':'';nt.style.color=net<0?'var(--loss)':'';
  put('rkJalan',rp(o.perjalanan_value));
  const cat=[],lu=d.spend_luar||{};
  if(lu.spend)cat.push(int(lu.campaigns)+' campaign yang ordernya tidak pernah masuk ke Scalev tidak dihitung (spend '+rpFull(lu.spend)+').');
  if(b.hpp_kurang)cat.push(int(b.hpp_kurang)+' dari '+int(o.confirmed)+' order closing belum punya HPP (dihitung Rp 0) — net profit lebih tinggi dari seharusnya.');
  if(b.tanpa_paket)cat.push(int(b.tanpa_paket)+' order sudah dikirim tapi paket Mengantar-nya tidak ditemukan — ongkir-nya belum terhitung.');
  if(bmSel.value)cat.push('Filter BM aktif: hanya order dengan UTM campaign milik BM ini yang dihitung.');
  if(bmSel.value||stSel.value)cat.push('RTS di kartu "Selesai & cair" diambil dari Mengantar dan tidak ikut filter BM / store (paket belum bisa dipasangkan ke order Scalev).');
  // Spend dipilah per store lewat pasangan store pada ad account; tanpa pasangan spend-nya kosong
  if(stSel.value&&!s.spend)cat.push('Spend tidak bisa dipilah per store karena belum ada akun iklan yang dipasangkan ke store ini — ROAS, biaya per order, dan net profit di atas belum dikurangi spend iklan.');
  $('rkNote').hidden=!cat.length;$('rkNote').innerHTML=cat.map(esc).join('<br>');

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

  rkPlatform();
  rkGrafik();
}

/** Tabel per platform: website (Scalev, ikut filter BM / store) + Shopee & TikTok Shop (tanggal pesanan dibuat) */
function rkPlatform(){
  const d=rkData,o=d.orders||{},n=v=>v||0,mp=d.marketplace||{},S=(mp.shopee||{}).total||{},T=(mp.tiktok||{}).total||{};
  const W={spend:n((d.spend||{}).spend),pesanan:n(o.orders),omzet:n(o.confirmed_value),laku:n(o.confirmed),
    selesai:n(o.cair_cod)+n(o.tf_paid),selesai_nilai:n(o.revenue_paid),proses:n(o.antre)+n(o.perjalanan),gagal:n(o.batal)+n(o.rts)};
  const M=x=>({spend:n(x.spend),pesanan:n(x.pesanan),omzet:n(x.omzet),laku:n(x.laku),selesai:n(x.terkirim),selesai_nilai:n(x.terkirim_nilai),proses:n(x.proses),gagal:n(x.batal)+n(x.retur)});
  const kol=[['Website (Scalev)',W],['Shopee',M(S)],['TikTok Shop',M(T)]];
  const tot={};for(const k of Object.keys(W))tot[k]=kol.reduce((a,c)=>a+c[1][k],0);
  kol.push(['Total',tot]);
  const pc=(a,b)=>b?pct(100*a/b):'—';
  const baris=[
    ['Spend iklan',x=>x.spend?'<span style="color:var(--loss)">− '+rpFull(x.spend)+'</span>':'—'],
    ['Pesanan masuk',x=>int(x.pesanan)],
    ['Omzet','Website: nilai order closing · marketplace: pesanan selain batal & belum bayar',x=>'<b>'+rpFull(x.omzet)+'</b><small>'+int(x.laku)+' pesanan · '+pc(x.laku,x.pesanan)+'</small>'],
    ['Selesai / terkirim','Website: COD cair + transfer lunas',x=>rpFull(x.selesai_nilai)+'<small>'+int(x.selesai)+' pesanan</small>'],
    ['Masih diproses / dikirim',x=>int(x.proses)],
    ['Batal / RTS / retur',x=>x.gagal?'<span style="color:var(--loss)">'+int(x.gagal)+'</span><small>'+pc(x.gagal,x.pesanan)+' dari pesanan</small>':'0'],
    ['ROAS','Omzet ÷ spend iklan',x=>x.spend?'<b>'+nf2.format(x.omzet/x.spend)+'×</b><small>iklan '+pc(x.spend,x.omzet)+' dari omzet</small>':'—'],
  ];
  $('rkPlatIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pos</th>'+kol.map((k,i)=>'<th class="n'+(i===3?' lr-tot':'')+'">'+esc(k[0])+'</th>').join('')+'</tr></thead><tbody>'+
    baris.map(b=>{const f=b[b.length-1],ket=b.length>2?b[1]:'';
      return '<tr class="lr-'+(b[0]==='Omzet'||b[0]==='ROAS'?'sub':'pos')+'"><td class="lr-nm">'+esc(b[0])+(ket?'<small>'+esc(ket)+'</small>':'')+'</td>'+
        kol.map((k,i)=>'<td class="n'+(i===3?' lr-tot':'')+'">'+f(k[1])+'</td>').join('')+'</tr>'}).join('')+'</tbody></table>';
  put('rkPlatSub',fmtRange(d.from,d.to)+' · tanggal acuan: pesanan masuk · omzet website '+pc(W.omzet,tot.omzet)+', Shopee '+pc(kol[1][1].omzet,tot.omzet)+', TikTok '+pc(kol[2][1].omzet,tot.omzet));
  const cat=[];
  if($('rkBm').value||$('rkStore').value)cat.push('Filter BM / store hanya berlaku untuk kolom Website — Shopee & TikTok tetap semua toko.');
  if(!S.pesanan&&!S.spend)cat.push('Belum ada pesanan / iklan Shopee pada rentang ini — sinkron atau upload di menu Shopee.');
  if(!T.pesanan&&!T.spend)cat.push('Belum ada pesanan / iklan TikTok pada rentang ini — sinkron atau upload di menu TikTok Shop.');
  else if(T.pesanan&&!T.spend)cat.push('Pesanan TikTok ada tapi data iklannya belum ada — upload Campaign overview di TikTok Shop › Iklan.');
  cat.push('Spend Shopee: laporan iklan lebih dari satu hari dibagi rata ke hari-harinya. Spend Meta hanya campaign yang ordernya masuk ke Scalev.');
  $('rkPlatNote').hidden=!cat.length;$('rkPlatNote').innerHTML=cat.map(esc).join('<br>');
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
$('rkGrain').addEventListener('click',e=>{if(e.target.closest('button'))setTimeout(rkGrafik)});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(drawCharts);else drawCharts();
window.addEventListener('load',drawCharts);
