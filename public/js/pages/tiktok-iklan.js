/**
 * TikTok Shop › Iklan: biaya & omzet iklan per hari / jam, tab, ekspor CSV. Data: /api/tiktok/iklan.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, tiktok-bersama.js, serta rentang(), tkPasangPilih() dari script utama (window.*).
 * Dipanggil dari script utama: loadTtIklan() (menu Iklan).
 */
let tiData=null,tiBusy=false,tiTab='hari',tiChart=null,tiJamChart=null;
const tiQuery=()=>{const r=rentang('tiRange'),q=new URLSearchParams({from:r.from,to:r.to});if($('tiToko').value)q.set('toko',$('tiToko').value);return q};
const tiRoi=(o,b)=>b?nf2.format(o/b)+'×':'—';
async function loadTtIklan(){
  if(tiBusy)return;tiBusy=true;
  try{
    const r=rentang('tiRange');
    const [d,t,st]=await Promise.all([api('/api/tiktok/iklan?'+tiQuery()),ttToko?Promise.resolve(ttToko):api('/api/tiktok/toko'),api('/api/tiktok/status?'+new URLSearchParams({from:r.from,to:r.to,jenis:'iklan'}))]);
    tiData=d;ttToko=t;
    // Iklan belum lewat API: semua toko dianggap upload di halaman ini
    tkBar('ti',(t.toko||[]).map(x=>Object.assign({},x,{mode:'upload'})),st,r,'iklan','Belum ada toko — tambahkan di Pengaturan › Toko Marketplace.');
    renderTtIklan();
  }catch(e){$('tiIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{tiBusy=false}
}
function renderTtIklan(){
  const d=tiData,t=d.total||{},b=t.biaya||0,o=t.omzet||0,omzetTk=(d.omzet_toko||[]).filter(x=>(d.per_toko||[]).some(p=>p.toko_id===x.toko_id)).reduce((a,x)=>a+(x.omzet||0),0);
  put('tiPeriod','Iklan TikTok Shop · '+fmtRange(d.from,d.to)+' · '+int(t.hari||0)+' hari ada data');
  put('tiK1',rpFull(b));put('tiK1D',t.hari?'rata-rata '+rpFull(b/t.hari)+' / hari':'belum ada data');
  put('tiK2',rpFull(o));put('tiK2D',b?'ROI '+tiRoi(o,b)+' · ACOS '+pct(o?100*b/o:null):'—');
  put('tiK3',int(t.pesanan||0));put('tiK3D',t.pesanan?'biaya per pesanan '+rpFull(b/t.pesanan)+' · rata-rata '+rpFull(o/t.pesanan):'—');
  put('tiK4',omzetTk?pct(100*b/omzetTk):'—');put('tiK4D',omzetTk?'dari omzet semua pesanan TikTok '+rpFull(omzetTk)+' · '+pct(100*o/omzetTk)+' omzet lewat iklan':b?'omzet pesanan TikTok belum ada di rentang ini':'—');
  const w=[];
  if(!(d.harian||[]).length)w.push('Belum ada data iklan pada rentang ini. Klik <b>Upload file</b> lalu pilih file <b>Campaign overview data</b> (CSV) dari laporan iklan TikTok Shop — pilih toko yang sesuai.');
  $('tiWarn').hidden=!w.length;$('tiWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  tiGambar();tiRenderTab();
}
function tiGambar(){
  if(typeof Chart==='undefined')return;
  const d=tiData,hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const per=new Map((d.harian||[]).map(r=>[r.tgl,r]));
  const labels=hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const biaya=hari.map(t=>(per.get(t)||{}).biaya||0),omzet=hari.map(t=>(per.get(t)||{}).omzet||0),roi=hari.map((t,i)=>biaya[i]?Math.round(100*omzet[i]/biaya[i])/100:null);
  const legend={position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}};
  if(tiChart){tiChart.data.labels=labels;tiChart.data.datasets[0].data=biaya;tiChart.data.datasets[1].data=omzet;tiChart.data.datasets[2].data=roi;tiChart.update()}
  else tiChart=new Chart($('tiChart'),{type:'bar',
    data:{labels,datasets:[{label:'Biaya iklan',data:biaya,backgroundColor:css('--loss'),borderRadius:3,yAxisID:'y',order:2},{label:'Omzet dari iklan',data:omzet,backgroundColor:css('--rev'),borderRadius:3,yAxisID:'y',order:2},
      {type:'line',label:'ROI',data:roi,borderColor:css('--ink'),backgroundColor:css('--ink'),borderWidth:2,pointRadius:2,tension:.3,yAxisID:'y1',order:1,spanGaps:true}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{label:c=>c.datasetIndex===2?' ROI: '+(c.raw==null?'—':nf2.format(c.raw)+'×'):' '+c.dataset.label+': '+rpFull(c.raw)}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}},y:{grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>rp(v)}},
        y1:{position:'right',grid:{display:false},border:{display:false},beginAtZero:true,ticks:{callback:v=>v+'×'}}}}});
  // Per jam (hanya dari file per jam)
  const pj=new Map((d.per_jam||[]).map(r=>[r.jam,r])),jl=[...Array(24).keys()];
  put('tiJamSub',d.hari_jam?'Jumlah '+int(d.hari_jam)+' hari data per jam · biaya & omzet iklan per jam tayang (WIB)':'Belum ada data per jam — upload file Campaign overview per jam (rentang 1 hari)');
  const jb=jl.map(j=>(pj.get(j)||{}).biaya||0),jo=jl.map(j=>(pj.get(j)||{}).omzet||0),jlab=jl.map(j=>String(j).padStart(2,'0')+':00');
  if(tiJamChart){tiJamChart.data.datasets[0].data=jb;tiJamChart.data.datasets[1].data=jo;tiJamChart.update();return}
  tiJamChart=new Chart($('tiJam'),{type:'bar',
    data:{labels:jlab,datasets:[{label:'Biaya iklan',data:jb,backgroundColor:css('--loss'),borderRadius:3},{label:'Omzet dari iklan',data:jo,backgroundColor:css('--rev'),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+rpFull(c.raw),footer:it=>{const b=(it[0]||{}).raw||0,o=(it[1]||{}).raw||0;return b?'ROI '+nf2.format(o/b)+'×':''}}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}},y:{grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>rp(v)}}}}});
}
const TI_HEAD='<th class="n">Biaya</th><th class="n">Pesanan</th><th class="n">Biaya / pesanan</th><th class="n">Omzet iklan</th><th class="n">ROI</th><th class="n">ACOS</th>';
const tiSel=r=>'<td class="n">'+rpFull(r.biaya||0)+'</td><td class="n">'+int(r.pesanan||0)+'</td><td class="n">'+(r.pesanan?rpFull(r.biaya/r.pesanan):'—')+'</td>'+
  '<td class="n">'+rpFull(r.omzet||0)+'</td><td class="n"><b>'+tiRoi(r.omzet||0,r.biaya||0)+'</b></td><td class="n">'+(r.omzet?pct(100*r.biaya/r.omzet):'—')+'</td>';
function tiRenderTab(){
  const d=tiData,kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Belum ada data iklan.</td></tr>';
  $('tiTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tiTab));
  if(tiTab==='hari'){
    put('tiSub','Per tanggal tayang · omzet pesanan = semua pesanan TikTok hari itu (selain batal & belum bayar) · TACOS = biaya ÷ omzet pesanan');
    const om=new Map((d.omzet_harian||[]).map(r=>[r.tgl,r.omzet||0]));
    $('tiIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Tanggal</th>'+TI_HEAD+'<th class="n">Omzet pesanan</th><th class="n">TACOS</th></tr></thead><tbody>'+
      ((d.harian||[]).slice().reverse().map(r=>{const p=om.get(r.tgl)||0;return '<tr><td class="nm">'+esc(fmtRange(r.tgl,r.tgl))+'</td>'+tiSel(r)+'<td class="n">'+(p?rpFull(p):'—')+'</td><td class="n">'+(p?pct(100*r.biaya/p):'—')+'</td></tr>'}).join('')||kosong(9))+'</tbody></table>';
  }else if(tiTab==='toko'){
    put('tiSub','Per toko · TACOS = biaya iklan ÷ omzet semua pesanan TikTok toko itu');
    const nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama])),om=new Map((d.omzet_toko||[]).map(r=>[r.toko_id,r]));
    $('tiIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th class="n">Hari</th>'+TI_HEAD+'<th class="n">Omzet pesanan</th><th class="n">TACOS</th></tr></thead><tbody>'+
      ((d.per_toko||[]).slice().sort((a,b)=>b.biaya-a.biaya).map(r=>{const p=om.get(r.toko_id);return '<tr><td class="nm">'+esc(nama.get(r.toko_id)||'?')+'</td><td class="n">'+int(r.hari)+'</td>'+tiSel(r)+
        '<td class="n">'+(p?rpFull(p.omzet)+'<small>'+int(p.pesanan)+' pesanan</small>':'—')+'</td><td class="n">'+(p&&p.omzet?pct(100*r.biaya/p.omzet):'—')+'</td></tr>'}).join('')||kosong(10))+'</tbody></table>';
  }else{
    put('tiSub',d.hari_jam?'Jumlah per jam tayang dari '+int(d.hari_jam)+' hari data per jam (WIB)':'Belum ada data per jam — upload file Campaign overview per jam');
    const pj=new Map((d.per_jam||[]).map(r=>[r.jam,r]));
    $('tiIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl" data-dt="off"><thead><tr><th>Jam</th>'+TI_HEAD+'</tr></thead><tbody>'+
      (d.hari_jam?[...Array(24).keys()].map(j=>'<tr><td class="nm">'+String(j).padStart(2,'0')+':00–'+String(j).padStart(2,'0')+':59</td>'+tiSel(pj.get(j)||{})+'</tr>').join(''):kosong(7))+'</tbody></table>';
  }
}
$('tiRange').addEventListener('click',e=>{if(e.target.closest('button'))loadTtIklan()});
$('tiToko').addEventListener('change',loadTtIklan);
tkPasangPilih('ti');
$('tiTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!tiData)return;tiTab=b.dataset.tab;tiRenderTab()});
$('tiExport').addEventListener('click',()=>{
  if(!tiData)return;const d=tiData,akhir='-'+d.from+'_'+d.to+'.csv',nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama]));
  if(tiTab==='toko')return unduhCsv('tiktok-iklan-per-toko'+akhir,['Toko','Hari','Biaya','Pesanan','Omzet iklan'],(d.per_toko||[]).map(r=>[nama.get(r.toko_id)||'?',r.hari,r.biaya,r.pesanan,r.omzet]));
  if(tiTab==='jam')return unduhCsv('tiktok-iklan-per-jam'+akhir,['Jam','Biaya','Pesanan','Omzet iklan'],(d.per_jam||[]).map(r=>[r.jam,r.biaya,r.pesanan,r.omzet]));
  unduhCsv('tiktok-iklan-per-hari'+akhir,['Tanggal','Biaya','Pesanan','Omzet iklan'],(d.harian||[]).map(r=>[r.tgl,r.biaya,r.pesanan,r.omzet]));
});
