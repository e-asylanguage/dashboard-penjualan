/**
 * Spending Iklan: spending, omzet iklan & ROAS gabungan Meta + Shopee + TikTok Shop — kartu per platform, grafik harian & porsi,
 * tabel per akun / toko dan per hari. Data: /api/report/iklan-semua.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta rentang() & bukaView() dari script utama (window.*).
 * Dipanggil dari script utama: loadIklanSemua() (menu Spending Iklan).
 */
// ---- Spending Iklan: semua platform (Meta, Shopee, TikTok Shop)
const IS_PLAT=[['meta','Meta','--info','iklan'],['shopee','Shopee','--spend','shpiklan'],['tiktok','TikTok Shop','--pb','ttiklan']];
let isData=null,isBusy=false,isTab='akun',isChart=null,isPorsi=null;
async function loadIklanSemua(){
  if(isBusy)return;isBusy=true;
  try{const r=rentang('isRange');isData=isOlah(await api('/api/report/iklan-semua?'+new URLSearchParams({from:r.from,to:r.to})));renderIklanSemua()}
  catch(e){$('isIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{isBusy=false}
}
/** Satukan bentuk data: per hari per platform & per akun {platform, akun, biaya, omzet, pesanan} */
function isOlah(d){
  const hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const per=new Map(hari.map(t=>[t,{meta:0,shopee:0,tiktok:0,omzet:0}])),akun=new Map();
  const tambahAkun=(pf,id,nama,v)=>{const k=pf+'|'+id,a=akun.get(k)||{platform:pf,akun:nama||'?',biaya:0,omzet:0,pesanan:0,hari:new Set()};
    a.biaya+=v.biaya||0;a.omzet+=v.omzet||0;a.pesanan+=v.pesanan||0;if(v.tgl&&v.biaya)a.hari.add(v.tgl);if(nama)a.akun=nama;akun.set(k,a)};
  for(const x of d.meta||[]){const h=per.get(x.tgl);if(h)h.meta+=x.biaya||0;tambahAkun('meta',x.akun_id,x.akun,{biaya:x.biaya,tgl:x.tgl})}
  for(const x of d.meta_omzet||[]){const h=per.get(x.tgl);if(h)h.omzet+=x.omzet||0;tambahAkun('meta',x.akun_id,null,{omzet:x.omzet,pesanan:x.pesanan})}
  let rata=false;
  for(const x of d.shopee||[]){
    const n=Math.round((new Date(x.sampai+'T00:00:00Z')-new Date(x.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    for(let t=x.dari;t<=x.sampai;t=shift(t,1)){const h=per.get(t);if(h){h.shopee+=(x.biaya||0)/n;h.omzet+=(x.omzet||0)/n}}
    tambahAkun('shopee',x.akun_id,x.akun,{biaya:x.biaya,omzet:x.omzet,pesanan:x.pesanan,tgl:x.dari});
  }
  for(const x of d.tiktok||[]){const h=per.get(x.tgl);if(h){h.tiktok+=x.biaya||0;h.omzet+=x.omzet||0}tambahAkun('tiktok',x.akun_id,x.akun,{biaya:x.biaya,omzet:x.omzet,pesanan:x.pesanan,tgl:x.tgl})}
  const plat={};for(const [k] of IS_PLAT)plat[k]={biaya:0,omzet:0,pesanan:0,akun:0};
  for(const a of akun.values()){const p=plat[a.platform];p.biaya+=a.biaya;p.omzet+=a.omzet;p.pesanan+=a.pesanan;if(a.biaya)p.akun++}
  return {from:d.from,to:d.to,hari,per,akun:[...akun.values()],plat,rata,terpotong:d.shopee_terpotong||0,metaLuar:d.meta_luar||{}};
}
const isRoas=(o,b)=>b?nf2.format(o/b)+'×':'—';
function renderIklanSemua(){
  const d=isData,P=d.plat,b=IS_PLAT.reduce((a,[k])=>a+P[k].biaya,0),o=IS_PLAT.reduce((a,[k])=>a+P[k].omzet,0),n=IS_PLAT.reduce((a,[k])=>a+P[k].pesanan,0);
  const nHari=d.hari.length,aktif=IS_PLAT.filter(([k])=>P[k].biaya);
  put('isPeriod','Meta, Shopee & TikTok Shop · '+fmtRange(d.from,d.to)+' · '+int(aktif.length)+' platform ada spending');
  put('isK1',rpFull(b));put('isK1D',nHari?'rata-rata '+rpFull(b/nHari)+' / hari · '+aktif.map(([k,l])=>l+' '+lpPct(P[k].biaya,b)).join(' · '):'—');
  put('isK2',rpFull(o));put('isK2D',b?'ROAS gabungan '+isRoas(o,b)+' · ACOS '+pct(o?100*b/o:null):'—');
  put('isK3',int(n));put('isK3D',n?'biaya per pesanan '+rpFull(b/n)+' · rata-rata omzet '+rpFull(o/n):'—');
  const top=aktif.slice().sort((x,y)=>P[y[0]].biaya-P[x[0]].biaya)[0];
  put('isK4',top?top[1]:'—');put('isK4D',top?rpFull(P[top[0]].biaya)+' · '+lpPct(P[top[0]].biaya,b)+' dari total · ROAS '+isRoas(P[top[0]].omzet,P[top[0]].biaya):'belum ada spending');
  const w=[];
  for(const [k,l] of IS_PLAT)if(!P[k].biaya)w.push('<b>'+l+'</b>: belum ada data spending pada rentang ini'+(k==='meta'?' — cek akun iklan di Pengaturan › Sinkronisasi Meta Ads.':k==='shopee'?' — sinkron API atau upload laporan di Shopee › Iklan.':' — upload laporan Campaign overview di TikTok Shop › Iklan.'));
  if(d.terpotong)w.push(int(d.terpotong)+' laporan iklan Shopee periodenya melewati rentang tanggal ini — <b>tidak dihitung</b>. Pilih rentang yang mencakup seluruh periodenya.');
  $('isWarn').hidden=!w.length;$('isWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  // Kartu per platform
  $('isPlat').innerHTML=IS_PLAT.map(([k,l,warna,view])=>{const p=P[k];
    return '<button type="button" class="card wl-kartu" data-is-buka="'+view+'" style="border-left:4px solid var('+warna+')">'+
      '<span class="wl-k-h">'+l+'</span><span class="wl-k-p">'+(p.biaya?lpPct(p.biaya,b)+' dari total spending · '+int(p.akun)+' '+(k==='meta'?'BM':'toko'):'belum ada spending')+
        (k==='meta'?'<br>hanya campaign yang menghasilkan order di Scalev'+(d.metaLuar.biaya?' · di luar itu '+rpFull(d.metaLuar.biaya)+' ('+int(d.metaLuar.campaign)+' campaign) tidak dihitung':''):'')+'</span>'+
      '<span class="wl-k-info" style="font-size:20px;font-weight:700;color:var(--ink)">'+rpFull(p.biaya)+'</span>'+
      '<span class="wl-k-info">Omzet <b>'+rpFull(p.omzet)+'</b> · ROAS <b>'+isRoas(p.omzet,p.biaya)+'</b><br>'+int(p.pesanan)+' pesanan · '+(p.pesanan?rpFull(p.biaya/p.pesanan)+' / pesanan':'—')+'</span>'+
      '<span class="wl-k-buka">Buka halaman iklan '+l+' →</span></button>'}).join('');
  put('isChartSub','Ditumpuk per platform · garis = ROAS gabungan (omzet iklan ÷ spending)'+(d.rata?' · laporan Shopee lebih dari 1 hari dibagi rata':''));
  isGambar();isRenderTab();
}
function isGambar(){
  if(typeof Chart==='undefined')return;
  const d=isData,labels=d.hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const seri=IS_PLAT.map(([k])=>d.hari.map(t=>Math.round(d.per.get(t)[k])));
  const roas=d.hari.map(t=>{const h=d.per.get(t),b=h.meta+h.shopee+h.tiktok;return b?Math.round(100*h.omzet/b)/100:null});
  const legend={position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}};
  if(isChart){isChart.data.labels=labels;seri.forEach((x,i)=>isChart.data.datasets[i].data=x);isChart.data.datasets[3].data=roas;isChart.update()}
  else isChart=new Chart($('isChart'),{type:'bar',
    data:{labels,datasets:[...IS_PLAT.map(([k,l,warna],i)=>({label:l,data:seri[i],backgroundColor:css(warna),borderRadius:3,stack:'s',yAxisID:'y',order:2})),
      {type:'line',label:'ROAS',data:roas,borderColor:css('--ink'),backgroundColor:css('--ink'),borderWidth:2,pointRadius:2,tension:.3,yAxisID:'y1',order:1,spanGaps:true}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{label:c=>c.dataset.type==='line'?' ROAS: '+(c.raw==null?'—':nf2.format(c.raw)+'×'):' '+c.dataset.label+': '+rpFull(c.raw),
        footer:it=>{const tot=it.filter(x=>x.dataset.type!=='line').reduce((a,x)=>a+(x.raw||0),0);return 'Total: '+rpFull(tot)}}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>rp(v)}},
        y1:{position:'right',grid:{display:false},border:{display:false},beginAtZero:true,ticks:{callback:v=>v+'×'}}}}});
  const porsi=IS_PLAT.map(([k])=>Math.round(d.plat[k].biaya));
  if(isPorsi){isPorsi.data.datasets[0].data=porsi;isPorsi.update();return}
  isPorsi=new Chart($('isPorsi'),{type:'doughnut',
    data:{labels:IS_PLAT.map(x=>x[1]),datasets:[{data:porsi,backgroundColor:IS_PLAT.map(x=>css(x[2])),borderColor:css('--card'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'62%',
      plugins:{legend:{position:'bottom',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>{const t=c.dataset.data.reduce((a,x)=>a+x,0);return ' '+c.label+': '+rpFull(c.raw)+' ('+(t?nf.format(Math.round(1000*c.raw/t)/10):0)+'%)'}}}}}});
}
function isRenderTab(){
  const d=isData,nama=Object.fromEntries(IS_PLAT.map(x=>[x[0],x[1]])),kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Belum ada spending pada rentang ini.</td></tr>';
  $('isTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===isTab));
  const tot=d.akun.reduce((a,x)=>a+x.biaya,0);
  if(isTab==='akun'){
    put('isSub','Per BM Meta / toko marketplace · urut spending terbesar');
    $('isIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Akun / toko</th><th>Platform</th><th class="n">Spending</th><th class="n">Porsi</th><th class="n">Omzet iklan</th><th class="n">ROAS</th><th class="n">Pesanan</th><th class="n">Biaya / pesanan</th></tr></thead><tbody>'+
      (d.akun.filter(a=>a.biaya||a.omzet).sort((a,b)=>b.biaya-a.biaya).map(a=>'<tr><td class="nm">'+esc(a.akun)+'</td><td><span class="tag">'+esc(nama[a.platform])+'</span></td><td class="n"><b>'+rpFull(a.biaya)+'</b></td>'+
        '<td class="n">'+lpPct(a.biaya,tot)+'</td><td class="n">'+rpFull(a.omzet)+'</td><td class="n">'+isRoas(a.omzet,a.biaya)+'</td><td class="n">'+int(a.pesanan)+'</td><td class="n">'+(a.pesanan?rpFull(a.biaya/a.pesanan):'—')+'</td></tr>').join('')||kosong(8))+'</tbody></table>';
  }else{
    put('isSub','Spending per tanggal iklan tayang · omzet = omzet dari iklan semua platform');
    $('isIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Tanggal</th>'+IS_PLAT.map(x=>'<th class="n">'+x[1]+'</th>').join('')+'<th class="n">Total</th><th class="n">Omzet iklan</th><th class="n">ROAS</th></tr></thead><tbody>'+
      (d.hari.slice().reverse().map(t=>{const h=d.per.get(t),b=h.meta+h.shopee+h.tiktok;return b||h.omzet?'<tr><td class="nm">'+esc(fmtRange(t,t))+'</td>'+IS_PLAT.map(([k])=>'<td class="n">'+(h[k]?rpFull(Math.round(h[k])):'—')+'</td>').join('')+
        '<td class="n"><b>'+rpFull(Math.round(b))+'</b></td><td class="n">'+rpFull(Math.round(h.omzet))+'</td><td class="n">'+isRoas(h.omzet,b)+'</td></tr>':''}).join('')||kosong(7))+'</tbody></table>';
  }
}
$('isRange').addEventListener('click',e=>{if(e.target.closest('button'))loadIklanSemua()});
$('isTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!isData)return;isTab=b.dataset.tab;isRenderTab()});
$('isPlat').addEventListener('click',e=>{const b=e.target.closest('[data-is-buka]');if(b)bukaView(b.dataset.isBuka)});
$('isExport').addEventListener('click',()=>{
  if(!isData)return;const d=isData,akhir='-'+d.from+'_'+d.to+'.csv',nama=Object.fromEntries(IS_PLAT.map(x=>[x[0],x[1]]));
  if(isTab==='akun')return unduhCsv('spending-iklan-per-akun'+akhir,['Akun / toko','Platform','Spending','Omzet iklan','Pesanan'],d.akun.map(a=>[a.akun,nama[a.platform],Math.round(a.biaya),Math.round(a.omzet),a.pesanan]));
  unduhCsv('spending-iklan-per-hari'+akhir,['Tanggal','Meta','Shopee','TikTok Shop','Total','Omzet iklan'],d.hari.map(t=>{const h=d.per.get(t);return [t,Math.round(h.meta),Math.round(h.shopee),Math.round(h.tiktok),Math.round(h.meta+h.shopee+h.tiktok),Math.round(h.omzet)]}));
});

