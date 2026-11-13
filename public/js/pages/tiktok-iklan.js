/**
 * TikTok Shop › Iklan: biaya & omzet iklan per hari / jam, tab, ekspor CSV. Data: /api/tiktok/iklan.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, tiktok-bersama.js, serta rentang(), tkPasangPilih() dari script utama (window.*).
 * Dipanggil dari script utama: loadTtIklan() (menu Iklan).
 */
let tiData=null,tiBusy=false,tiTab='hari',tiChart=null,tiJamChart=null;
const tiQuery=()=>{const r=rentang('tiRange'),q=new URLSearchParams({from:r.from,to:r.to});if($('tiToko').value)q.set('toko',$('tiToko').value);return q};
const tiRoi=(o,b)=>b?nf2.format(o/b)+'×':'—';
/**
 * Pengingat upload iklan (data iklan TikTok belum bisa ditarik lewat API, jadi masih diunggah manual):
 * mulai pukul TI_TELAT_JAM WIB, toko yang data iklannya belum sampai KEMARIN ditandai merah — banner di halaman ini dan
 * titik merah di menu TikTok Shop › Iklan. Toko yang sudah > TI_TELAT_DIAM hari tanpa data dianggap tidak beriklan lagi.
 * st = hasil /api/tiktok/status?jenis=iklan bila sudah ada (kolom "terakhir" = tanggal data terakhir per toko).
 */
const TI_TELAT_JAM=9,TI_TELAT_DIAM=14;
async function tiCekTelat(st){
  try{
    const hariIni=ymd(new Date()),kemarin=shift(hariIni,-1),jam=+new Date(Date.now()+7*36e5).toISOString().slice(11,13);
    const s=st||await api('/api/tiktok/status?'+new URLSearchParams({from:kemarin,to:kemarin,jenis:'iklan'}));
    const telat=jam<TI_TELAT_JAM?[]:(s.toko||[]).filter(x=>x.terakhir&&x.terakhir<kemarin&&x.terakhir>=shift(kemarin,-TI_TELAT_DIAM));
    document.querySelectorAll('.tt-titik').forEach(b=>{b.hidden=!telat.length;b.title=telat.length?'Data iklan TikTok kemarin belum di-upload':''});
    const box=$('tiTelat');box.hidden=!telat.length;if(!telat.length)return;
    if(!ttToko)ttToko=await api('/api/tiktok/toko');
    const nama=new Map((ttToko.toko||[]).map(t=>[t.id,t.nama])),hari=t=>Math.round((Date.parse(kemarin)-Date.parse(t))/864e5);
    box.innerHTML='<div class="ik-alert-h">⚠ Data iklan kemarin ('+esc(fmtRange(kemarin,kemarin))+') belum di-upload</div><ul>'+
      telat.map(x=>'<li class="kr">'+esc(nama.get(x.toko_id)||'Toko #'+x.toko_id)+' — data terakhir '+esc(fmtRange(x.terakhir,x.terakhir))+' ('+int(hari(x.terakhir))+' hari tertinggal)</li>').join('')+'</ul>'+
      '<p class="rk-sync-aksi"><button type="button" class="btn primary" data-ti-upload>Upload file sekarang</button><span>Unduh Campaign overview data dari iklan TikTok Shop, lalu upload per toko. Pengingat muncul tiap hari mulai pukul '+String(TI_TELAT_JAM).padStart(2,'0')+'.00 WIB.</span></p>';
    box.querySelector('[data-ti-upload]').onclick=()=>$('tiUpBtn').click();
  }catch(e){}
}
async function loadTtIklan(){
  if(tiBusy)return;tiBusy=true;
  try{
    const r=rentang('tiRange');
    const [d,t,st]=await Promise.all([api('/api/tiktok/iklan?'+tiQuery()),ttToko?Promise.resolve(ttToko):api('/api/tiktok/toko'),api('/api/tiktok/status?'+new URLSearchParams({from:r.from,to:r.to,jenis:'iklan'}))]);
    tiData=d;ttToko=t;tiCekTelat(st);
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
  // Per jam (hanya dari file per jam). Tanpa data per jam kartunya disembunyikan supaya tidak jadi kotak kosong setengah layar.
  $('tiJamKartu').hidden=!d.hari_jam;$('tiJamInfo').hidden=!!d.hari_jam;$('tiGrafik').classList.toggle('ti-satu',!d.hari_jam);
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
/**
 * Warna sel ROI di semua tab: merah di bawah ROI minimal (BEP), kuning dari BEP sampai di bawah batas bagus, hijau di atasnya.
 * Kedua batas diatur di atas tabel dan disimpan di browser ini (localStorage); bawaan 3,5× dan 5×.
 */
let tiBep=3.5,tiBagus=5;
try{const s=JSON.parse(localStorage.getItem('tiRoiBatas')||'null');if(s&&s.bep>0&&s.bagus>=s.bep){tiBep=s.bep;tiBagus=s.bagus}}catch(e){}
const tiRoiKelas=(o,b)=>{if(!b)return '';const r=o/b;return r<tiBep?' ti-roi-m':r<tiBagus?' ti-roi-k':' ti-roi-h'};
const tiSel=r=>'<td class="n">'+rpFull(r.biaya||0)+'</td><td class="n">'+int(r.pesanan||0)+'</td><td class="n">'+(r.pesanan?rpFull(r.biaya/r.pesanan):'—')+'</td>'+
  '<td class="n">'+rpFull(r.omzet||0)+'</td><td class="n ti-roi'+tiRoiKelas(r.omzet||0,r.biaya||0)+'"><b>'+tiRoi(r.omzet||0,r.biaya||0)+'</b></td><td class="n">'+(r.omzet?pct(100*r.biaya/r.omzet):'—')+'</td>';
/**
 * Penilaian satu campaign dibanding ROI rata-rata semua campaign di rentang yang sama (bukan angka mutlak, supaya ikut margin toko):
 * tanpa pesanan → boros; ROI ≥ 120% rata-rata → layak dinaikkan; ROI ≤ 80% rata-rata → perlu dievaluasi; sisanya rata-rata.
 */
function tiNilaiKode(r,roiAll){
  const b=r.biaya||0;if(!b)return ['','Tidak tayang'];
  if(!(r.pesanan||0))return ['loss','Boros · tanpa pesanan'];
  const roi=(r.omzet||0)/b;
  return roiAll&&roi>=1.2*roiAll?['rev','ROI tinggi · naikkan']:roiAll&&roi<=0.8*roiAll?['loss','ROI rendah · evaluasi']:['info','Rata-rata'];
}
const tiNilai=(r,roiAll)=>{const [t,l]=tiNilaiKode(r,roiAll);return t?'<span class="tag '+t+'">'+esc(l)+'</span>':'<span style="color:var(--muted)">'+esc(l)+'</span>'};
function tiRenderTab(){
  const d=tiData,kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Belum ada data iklan.</td></tr>';
  $('tiTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tiTab));
  if(tiTab==='hari'){
    put('tiSub','Per tanggal tayang · omzet pesanan = semua pesanan TikTok hari itu (selain batal & belum bayar) · TACOS = biaya ÷ omzet pesanan');
    const om=new Map((d.omzet_harian||[]).map(r=>[r.tgl,r.omzet||0]));
    $('tiIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Tanggal</th>'+TI_HEAD+'<th class="n">Omzet pesanan</th><th class="n">TACOS</th></tr></thead><tbody>'+
      ((d.harian||[]).slice().reverse().map(r=>{const p=om.get(r.tgl)||0;return '<tr><td class="nm">'+esc(fmtRange(r.tgl,r.tgl))+'</td>'+tiSel(r)+'<td class="n">'+(p?rpFull(p):'—')+'</td><td class="n">'+(p?pct(100*r.biaya/p):'—')+'</td></tr>'}).join('')||kosong(9))+'</tbody></table>';
  }else if(tiTab==='kampanye'){
    const semuaK=d.per_kampanye||[],rows=semuaK.filter(r=>(r.biaya||0)>0||(r.pesanan||0)>0),diam=semuaK.length-rows.length,ck=d.cakupan_kampanye||{},T=rows.reduce((a,r)=>{a.biaya+=r.biaya||0;a.omzet+=r.omzet||0;a.pesanan+=r.pesanan||0;return a},{biaya:0,omzet:0,pesanan:0});
    const roiAll=T.biaya?T.omzet/T.biaya:0,tot=(d.total||{}).biaya||0,nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama])),banyakToko=new Set(rows.map(r=>r.toko_id)).size>1;
    // Cakupan: rincian per campaign hanya ada untuk tanggal yang file Product campaign-nya di-upload
    const kurang=rows.length&&Math.abs(tot-T.biaya)>Math.max(1000,tot*0.01);
    put('tiSub',semuaK.length?'Per kampanye, urut biaya terbesar · rincian tersedia '+int(ck.hari||0)+' hari ('+fmtRange(ck.dari,ck.sampai)+') · penilaian dibanding ROI rata-rata semua campaign '+tiRoi(T.omzet,T.biaya)+
      (diam?' · '+int(diam)+' campaign tanpa biaya disembunyikan':'')+
      (kurang?' · biaya per campaign '+rpFull(T.biaya)+' dari total iklan '+rpFull(tot)+' — selisihnya dari iklan di luar file Product campaign (mis. GMV Max LIVE) atau hari yang filenya belum di-upload':'')
      :'Belum ada rincian per campaign pada rentang ini — klik Upload file lalu pilih file Product campaign data dari iklan TikTok Shop.');
    $('tiIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Campaign</th><th>Penilaian</th><th class="n">Hari aktif</th>'+TI_HEAD+'<th class="n">Porsi biaya</th></tr></thead><tbody>'+
      (rows.map(r=>'<tr><td class="nm">'+esc(r.nama||'(tanpa nama)')+'<small>ID '+esc(r.kampanye_id)+(banyakToko?' · '+esc(nama.get(r.toko_id)||'?'):'')+'</small></td>'+
        '<td>'+tiNilai(r,roiAll)+'</td><td class="n">'+int(r.hari||0)+'</td>'+tiSel(r)+'<td class="n">'+(T.biaya?pct(100*(r.biaya||0)/T.biaya):'—')+'</td></tr>').join('')||kosong(10))+
      (rows.length>1?'<tr class="lr-akhir"><td class="nm"><b>Total '+int(rows.length)+' campaign</b></td><td></td><td class="n"></td>'+tiSel(T)+'<td class="n">100%</td></tr>':'')+'</tbody></table>';
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
// Batas warna ROI: BEP & batas bagus; nilai tidak masuk akal dikembalikan ke nilai terakhir yang sah
$('tiBep').value=tiBep;$('tiBagus').value=tiBagus;
['tiBep','tiBagus'].forEach(id=>$(id).addEventListener('change',()=>{
  const bep=parseFloat($('tiBep').value),bagus=parseFloat($('tiBagus').value);
  if(bep>0&&bagus>=bep){tiBep=bep;tiBagus=bagus;try{localStorage.setItem('tiRoiBatas',JSON.stringify({bep,bagus}))}catch(e){}}
  $('tiBep').value=tiBep;$('tiBagus').value=tiBagus;if(tiData)tiRenderTab();
}));
$('tiTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!tiData)return;tiTab=b.dataset.tab;tiRenderTab()});
$('tiExport').addEventListener('click',()=>{
  if(!tiData)return;const d=tiData,akhir='-'+d.from+'_'+d.to+'.csv',nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama]));
  if(tiTab==='kampanye'){const rows=(d.per_kampanye||[]).filter(r=>(r.biaya||0)>0||(r.pesanan||0)>0),tb=rows.reduce((a,r)=>a+(r.biaya||0),0),to=rows.reduce((a,r)=>a+(r.omzet||0),0),roiAll=tb?to/tb:0;
    return unduhCsv('tiktok-iklan-per-campaign'+akhir,['ID campaign','Nama campaign','Toko','Penilaian','Hari aktif','Biaya','Pesanan','Biaya per pesanan','Omzet iklan','ROI','Porsi biaya (%)'],
      rows.map(r=>[r.kampanye_id,r.nama||'',nama.get(r.toko_id)||'?',tiNilaiKode(r,roiAll)[1],r.hari||0,r.biaya,r.pesanan,r.pesanan?Math.round(r.biaya/r.pesanan):'',r.omzet,r.biaya?(r.omzet/r.biaya).toFixed(2):'',tb?(100*r.biaya/tb).toFixed(1):'']))}
  if(tiTab==='toko')return unduhCsv('tiktok-iklan-per-toko'+akhir,['Toko','Hari','Biaya','Pesanan','Omzet iklan'],(d.per_toko||[]).map(r=>[nama.get(r.toko_id)||'?',r.hari,r.biaya,r.pesanan,r.omzet]));
  if(tiTab==='jam')return unduhCsv('tiktok-iklan-per-jam'+akhir,['Jam','Biaya','Pesanan','Omzet iklan'],(d.per_jam||[]).map(r=>[r.jam,r.biaya,r.pesanan,r.omzet]));
  unduhCsv('tiktok-iklan-per-hari'+akhir,['Tanggal','Biaya','Pesanan','Omzet iklan'],(d.harian||[]).map(r=>[r.tgl,r.biaya,r.pesanan,r.omzet]));
});
