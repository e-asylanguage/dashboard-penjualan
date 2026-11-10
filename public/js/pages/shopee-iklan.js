/**
 * Shopee › Iklan: laporan Iklan Shopee per toko × periode (hanya laporan yang seluruh periodenya di dalam rentang), grafik harian, tab per iklan / toko / laporan, ekspor CSV. Data: /api/shopee/iklan.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta dari script utama (window.*): rentang(), tkMuat(), tkTagSumber(), spBukaUpload().
 * Dipanggil dari script utama: loadShpIklan() (menu Iklan, setelah upload / sinkron), siRoas() (ringkasan hasil upload).
 */
let siData=null,siBusy=false,siTab='iklan',siChart=null;
const siRoas=(o,b)=>b?nf.format(Math.round(100*o/b)/100)+'×':'—';
const siBagi=(a,b)=>b?a/b:null;
/** ROI = (omzet iklan − biaya) ÷ biaya, sama dengan ROI (M) di Iklan Meta */
const siRoi=(o,b)=>b?(o>=b?'+':'')+pct(100*(o-b)/b):'—';
const siStatus=s=>!s?'':'<span class="tag'+(/berjalan/i.test(s)?' rev':/jeda/i.test(s)?' spend':'')+'">'+esc(s)+'</span>';
function siQuery(){const r=rentang('siRange'),q=new URLSearchParams({from:r.from,to:r.to});if($('siToko').value)q.set('toko',$('siToko').value);return q}
async function loadShpIklan(){
  if(siBusy)return;siBusy=true;
  try{siData=await api('/api/shopee/iklan?'+siQuery());renderShpIklan();tkMuat('si')}
  catch(e){$('siIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{siBusy=false}
}
/** Omzet pesanan Shopee (file Pesanan) untuk TACOS — hanya toko yang punya laporan iklan di rentang ini */
const siOmzetToko=d=>{const ada=new Set(d.per_toko.map(r=>r.toko_id));return d.omzet_toko.filter(r=>ada.has(r.toko_id)).reduce((a,r)=>a+(r.omzet||0),0)};
function renderShpIklan(){
  // Kartu KPI memakai biaya bersih = biaya iklan Shopee + CPAS − bonus proteksi ROAS yang masuk di rentang ini; tabel per iklan / toko tetap biaya kotor iklan Shopee (sama dengan Seller Centre)
  const d=siData,t0=d.total||{},cp=siCpasDihitung(d),bonus=(d.bonus||[]).reduce((a,x)=>a+(x.nominal||0),0);
  const t={...t0,biaya:(t0.biaya||0)+cp.biaya,omzet:(t0.omzet||0)+cp.omzet,konversi:(t0.konversi||0)+cp.konversi,klik:(t0.klik||0)+cp.klik};
  const kotor=t.biaya,b=kotor-bonus,o=t.omzet,dipakai=d.laporan.filter(l=>!l.terpotong),potong=d.laporan.filter(l=>l.terpotong),cpPotong=(d.cpas||[]).filter(x=>x.terpotong);
  const sel=$('siToko'),v=sel.value;
  sel.innerHTML='<option value="">Semua toko</option>'+d.toko.map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('');
  sel.value=[...sel.options].some(x=>x.value===v)?v:'';
  put('siPeriod','Iklan Shopee · '+fmtRange(d.from,d.to)+' · '+int(dipakai.length)+' laporan · '+int(d.per_iklan.length)+' iklan');
  const omzetToko=siOmzetToko(d);
  put('siK1',rpFull(b));put('siK1D',(cp.biaya?'Iklan Shopee '+rpFull(kotor-cp.biaya)+' + CPAS '+rpFull(cp.biaya)+' · ':'')+(bonus?'Biaya kotor '+rpFull(kotor)+' − bonus proteksi ROAS '+rpFull(bonus)+' · ':'')+
    (omzetToko?'TACOS '+pct(100*b/omzetToko)+' dari omzet pesanan '+rpFull(omzetToko):b?'TACOS belum bisa dihitung — upload file Pesanan toko ini':'—'));
  put('siK2',rpFull(o));put('siK2D',b?'ROAS '+siRoas(o,b)+' · ACOS '+pct(siBagi(100*b,o))+(t.omzet_langsung?' · langsung '+rpFull(t.omzet_langsung):''):'—');
  put('siKRoi',b?siRoi(o,b):'—');put('siKRoiD',b?(o>=b?'untung ':'rugi ')+rpFull(Math.abs(o-b))+' (omzet iklan − biaya) ÷ biaya':'belum ada biaya iklan');
  put('siK3',int(t.konversi||0));put('siK3D',t.konversi?rpFull(b/t.konversi)+' / konversi · '+int(t.terjual)+' produk terjual':'—');
  put('siKCr',t.klik?pct(100*(t.konversi||0)/t.klik):'—');put('siKCrD',t.klik?int(t.konversi||0)+' konversi dari '+int(t.klik)+' klik':'—');
  put('siK4',int(t.klik||0));put('siK4D',t.klik?(t0.klik?'CTR iklan Shopee '+pct(siBagi(100*t0.klik,t0.dilihat))+' dari '+int(t0.dilihat)+' dilihat · ':'')+'CPC '+rpFull(b/t.klik)+(cp.klik?' · '+int(cp.klik)+' klik CPAS':''):'—');
  const w=[];
  if(cpPotong.length)w.push(int(cpPotong.length)+' catatan CPAS periodenya melewati rentang tanggal ini ('+cpPotong.map(x=>esc(x.toko)+' '+esc(fmtRange(x.dari,x.sampai))).join(', ')+') — <b>tidak dihitung</b>. Pilih rentang yang mencakup seluruh periodenya, atau catat CPAS per hari.');
  if(!d.laporan.length)w.push('Belum ada laporan iklan pada rentang ini. Toko bermode API: klik <b>Sinkron sekarang</b>. Toko upload manual: klik <b>Upload file</b> lalu pilih file <b>Semua Laporan Iklan CPC</b> dari Iklan Shopee → Laporan → Data Keseluruhan. Upload per hari supaya bisa dilihat per tanggal.');
  if(potong.length)w.push(int(potong.length)+' laporan periodenya melewati rentang tanggal ini ('+potong.map(l=>esc(l.toko)+' '+esc(fmtRange(l.dari,l.sampai))).join(', ')+
    ') — <b>tidak dihitung</b>, karena angkanya total satu periode dan tidak bisa dipotong per hari. Pilih rentang yang mencakup seluruh periodenya.');
  $('siWarn').hidden=!w.length;$('siWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  siGambar(dipakai.concat((d.cpas||[]).filter(x=>!x.terpotong)));siRenderTab();
}
/** Total CPAS yang dihitung (seluruh periodenya di dalam rentang) */
function siCpasDihitung(d){
  const t={biaya:0,omzet:0,konversi:0,klik:0};
  for(const x of (d.cpas||[]))if(!x.terpotong)for(const k in t)t[k]+=x[k]||0;
  return t;
}
function siGambar(laporan){
  if(typeof Chart==='undefined')return;
  const d=siData,hari=[];for(let x=d.from;x<=d.to&&hari.length<400;x=shift(x,1))hari.push(x);
  const by=new Map(hari.map(x=>[x,{b:0,o:0}]));let rata=false;
  for(const l of laporan){
    const n=Math.round((new Date(l.sampai+'T00:00:00Z')-new Date(l.dari+'T00:00:00Z'))/864e5)+1;if(n>1)rata=true;
    for(let x=l.dari;x<=l.sampai;x=shift(x,1)){const h=by.get(x);if(h){h.b+=(l.biaya||0)/n;h.o+=(l.omzet||0)/n}}
  }
  put('siChartSub',rata?'Laporan lebih dari satu hari dibagi rata ke hari-harinya — upload laporan harian untuk angka per hari yang sebenarnya':'Dari laporan harian');
  const labels=hari.map(x=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(x+'T00:00:00Z')));
  const data=[hari.map(x=>Math.round(by.get(x).b)),hari.map(x=>Math.round(by.get(x).o))];
  if(siChart){siChart.data.labels=labels;data.forEach((x,i)=>siChart.data.datasets[i].data=x);siChart.update();return}
  siChart=new Chart($('siChart'),{type:'bar',
    data:{labels,datasets:[{label:'Biaya iklan',data:data[0],backgroundColor:css('--loss'),borderRadius:3},{label:'Omzet dari iklan',data:data[1],backgroundColor:css('--rev'),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+rpFull(c.raw),footer:it=>{const b=(it[0]||{}).raw||0,o=(it[1]||{}).raw||0;return b?'ROAS '+siRoas(o,b):''}}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}},y:{grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>rp(v)}}}}});
}
/** Sel metrik iklan bersama: dilihat, klik (CTR), konversi (CR), terjual, omzet, biaya, ROAS, ACOS, biaya/konversi */
const siSel=r=>'<td class="n">'+int(r.dilihat)+'</td><td class="n">'+int(r.klik)+'<small>CTR '+pct(siBagi(100*r.klik,r.dilihat))+'</small></td>'+
  '<td class="n">'+int(r.konversi)+'<small>CR '+pct(siBagi(100*r.konversi,r.klik))+'</small></td><td class="n">'+int(r.terjual)+'</td>'+
  '<td class="n">'+rpFull(r.omzet)+'</td><td class="n">'+rpFull(r.biaya)+'</td><td class="n"><b>'+siRoas(r.omzet,r.biaya)+'</b></td>'+
  '<td class="n">'+siRoi(r.omzet,r.biaya)+'</td><td class="n">'+pct(siBagi(100*r.biaya,r.omzet))+'</td><td class="n">'+(r.konversi?rpFull(r.biaya/r.konversi):'—')+'</td>';
const SI_HEAD='<th class="n">Dilihat</th><th class="n">Klik</th><th class="n">Konversi</th><th class="n">Terjual</th><th class="n">Omzet iklan</th><th class="n">Biaya</th><th class="n">ROAS</th><th class="n">ROI</th><th class="n">ACOS</th><th class="n">Biaya / konversi</th>';
function siRenderTab(){
  const d=siData,kosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+t+'</td></tr>',banyakToko=d.per_toko.length>1;
  $('siTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===siTab));
  if(siTab==='iklan'){
    put('siSub','Per iklan (digabung dari semua laporan di rentang ini) · urut biaya terbesar · status dari laporan terakhir');
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Iklan</th>'+SI_HEAD+'</tr></thead><tbody>'+
      (d.per_iklan.map(r=>'<tr><td class="nm">'+esc(r.nama)+'<small>'+[banyakToko?esc(r.toko):'',esc(r.mode_bidding||r.jenis||''),esc(r.penempatan||'')].filter(Boolean).join(' · ')+
        (r.status?' '+siStatus(r.status):'')+'</small></td>'+siSel(r)+'</tr>').join('')||kosong(11,'Belum ada data iklan.'))+'</tbody></table>';
  }else if(siTab==='toko'){
    put('siSub','Per toko · TACOS = biaya iklan ÷ omzet semua pesanan Shopee toko itu (file Pesanan, bukan batal)');
    const om=new Map(d.omzet_toko.map(r=>[r.toko_id,r]));
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Toko</th><th class="n">Laporan</th>'+SI_HEAD+'<th class="n">Omzet pesanan</th><th class="n">TACOS</th></tr></thead><tbody>'+
      (d.per_toko.map(r=>{const p=om.get(r.toko_id);return '<tr><td class="nm">'+esc(r.toko)+'</td><td class="n">'+int(r.laporan)+'</td>'+siSel(r)+
        '<td class="n">'+(p?rpFull(p.omzet)+'<small>'+int(p.pesanan)+' pesanan</small>':'<span style="color:var(--muted)">—</span>')+'</td><td class="n">'+(p&&p.omzet?pct(100*r.biaya/p.omzet):'—')+'</td></tr>'}).join('')||
        kosong(14,'Belum ada data iklan.'))+'</tbody></table>';
  }else if(siTab==='bonus'){
    const bonus=d.bonus||[],jml=bonus.reduce((a,x)=>a+(x.nominal||0),0);
    put('siSub','Bonus proteksi ROAS yang masuk di rentang ini (menurut tanggal bonus masuk) · '+int(bonus.length)+' bonus · total '+rpFull(jml)+' · dicatat manual lewat tombol + Bonus proteksi ROAS');
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Tanggal masuk</th><th>Toko</th><th>Periode iklan</th><th>Iklan / grup iklan</th><th class="n">Nominal</th><th>Keterangan</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (bonus.map(x=>'<tr><td class="nm">'+esc(fmtRange(x.tgl,x.tgl))+'</td><td>'+esc(x.toko)+'</td><td>'+(x.dari?esc(fmtRange(x.dari,x.sampai||x.dari)):'<span style="color:var(--muted)">—</span>')+'</td>'+
        '<td>'+esc(x.kampanye||'—')+'</td><td class="n"><b>'+rpFull(x.nominal)+'</b></td><td>'+esc(x.ket||'')+'</td>'+
        '<td class="n"><span class="bo-aksi"><button class="hapus" data-si-bonus-hapus="'+x.id+'">Hapus</button></span></td></tr>').join('')||
        kosong(7,'Belum ada bonus proteksi ROAS di rentang ini.'))+'</tbody></table>';
  }else if(siTab==='cpas'){
    const cpas=d.cpas||[],j=siCpasDihitung(d);
    put('siSub','Iklan CPAS (Meta → Shopee) yang beririsan dengan rentang ini · '+int(cpas.length)+' catatan · dihitung: spend '+rpFull(j.biaya)+', omzet '+rpFull(j.omzet)+(j.biaya?' (ROAS '+siRoas(j.omzet,j.biaya)+')':'')+' · dicatat manual lewat tombol + CPAS');
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Periode</th><th>Toko</th><th>Kampanye</th><th class="n">Klik</th><th class="n">Pembelian</th><th class="n">Nilai konversi</th><th class="n">Spend</th><th class="n">ROAS</th><th class="n">ROI</th><th>Keterangan</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (cpas.map(x=>'<tr><td class="nm">'+esc(fmtRange(x.dari,x.sampai))+(x.terpotong?'<small style="color:var(--loss)">tidak dihitung — melewati rentang</small>':'')+'</td><td>'+esc(x.toko)+'</td><td>'+esc(x.kampanye||'—')+'</td>'+
        '<td class="n">'+int(x.klik||0)+'</td><td class="n">'+int(x.konversi||0)+(x.konversi?'<small>'+rpFull(x.biaya/x.konversi)+' / pembelian</small>':'')+'</td>'+
        '<td class="n">'+rpFull(x.omzet||0)+'</td><td class="n"><b>'+rpFull(x.biaya)+'</b></td><td class="n">'+siRoas(x.omzet||0,x.biaya)+'</td><td class="n">'+siRoi(x.omzet||0,x.biaya)+'</td><td>'+esc(x.ket||'')+'</td>'+
        '<td class="n"><span class="bo-aksi"><button class="hapus" data-si-cpas-hapus="'+x.id+'">Hapus</button></span></td></tr>').join('')||
        kosong(11,'Belum ada iklan CPAS di rentang ini. Klik + CPAS untuk mencatat dari Meta Ads Manager.'))+'</tbody></table>';
  }else if(siTab==='sampel'){
    const s=d.sampel||[],jml=s.reduce((a,x)=>a+(x.nilai||0),0),aff=new Set(s.map(x=>x.affiliate.toLowerCase())).size;
    put('siSub','Sampel produk gratis untuk affiliate yang dikirim di rentang ini · '+int(s.length)+' kiriman ke '+int(aff)+' affiliate · total '+rpFull(jml)+' · masuk spending kanal Affiliate di Penghasilan Shopee');
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Tanggal kirim</th><th>Toko</th><th>Affiliate</th><th>Produk</th><th class="n">Qty</th><th class="n">HPP / unit</th><th class="n">Ongkir</th><th class="n">Nilai</th><th>Keterangan</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (s.map(x=>'<tr><td class="nm">'+esc(fmtRange(x.tgl,x.tgl))+'</td><td>'+esc(x.toko)+'</td><td>'+esc(x.affiliate)+'</td><td>'+esc(x.produk)+'</td>'+
        '<td class="n">'+int(x.qty)+'</td><td class="n">'+rpFull(x.hpp)+'</td><td class="n">'+rpFull(x.ongkir||0)+'</td><td class="n"><b>'+rpFull(x.nilai)+'</b></td><td>'+esc(x.ket||'')+'</td>'+
        '<td class="n"><span class="bo-aksi"><button class="hapus" data-si-sampel-hapus="'+x.id+'">Hapus</button></span></td></tr>').join('')||
        kosong(10,'Belum ada sampel affiliate di rentang ini. Klik + Sampel affiliate untuk mencatat.'))+'</tbody></table>';
  }else{
    put('siSub','Laporan iklan yang beririsan dengan rentang ini · API = satu laporan per hari dari sinkron · laporan bertanda "tidak dihitung" periodenya melewati rentang');
    $('siIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Periode</th><th>Toko</th><th class="n">Iklan</th><th class="n">Omzet iklan</th><th class="n">Biaya</th><th class="n">ROAS</th><th>Di-upload</th><th class="n">Aksi</th></tr></thead><tbody>'+
      (d.laporan.map(l=>'<tr><td class="nm">'+esc(fmtRange(l.dari,l.sampai))+(l.terpotong?'<small style="color:var(--loss)">tidak dihitung — melewati rentang</small>':'')+'</td><td>'+esc(l.toko)+'</td>'+
        '<td class="n">'+int(l.iklan)+'</td><td class="n">'+rpFull(l.omzet||0)+'</td><td class="n">'+rpFull(l.biaya||0)+'</td><td class="n">'+siRoas(l.omzet||0,l.biaya||0)+'</td>'+
        '<td>'+(l.sumber==='api'?tkTagSumber('api')+' ':'')+tglWib(l.created_at,true)+'</td><td class="n">'+(l.sumber==='api'?'':'<span class="bo-aksi"><button class="hapus" data-si-hapus="'+l.id+'">Hapus</button></span>')+'</td></tr>').join('')||
        kosong(8,'Belum ada laporan iklan yang di-upload untuk rentang ini.'))+'</tbody></table>';
  }
}
$('siUpBtn').addEventListener('click',spBukaUpload);
$('siRange').addEventListener('click',e=>{if(e.target.closest('button'))loadShpIklan()});
$('siToko').addEventListener('change',loadShpIklan);
$('siTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!siData)return;siTab=b.dataset.tab;siRenderTab()});
$('siIsi').addEventListener('click',async e=>{
  const bh=e.target.closest('[data-si-bonus-hapus]');
  if(bh&&siData){
    const x=(siData.bonus||[]).find(y=>y.id===Number(bh.dataset.siBonusHapus));
    if(!x||!confirm('Hapus bonus proteksi ROAS '+x.toko+' '+rpFull(x.nominal)+' ('+fmtRange(x.tgl,x.tgl)+')?'))return;
    try{await api('/api/shopee/iklan/bonus/'+x.id,{method:'DELETE'});loadShpIklan()}catch(err){alert('Gagal menghapus: '+err.message)}
    return;
  }
  const sh=e.target.closest('[data-si-sampel-hapus]');
  if(sh&&siData){
    const x=(siData.sampel||[]).find(y=>y.id===Number(sh.dataset.siSampelHapus));
    if(!x||!confirm('Hapus sampel affiliate '+x.affiliate+' · '+x.produk+' '+rpFull(x.nilai)+' ('+fmtRange(x.tgl,x.tgl)+')?'))return;
    try{await api('/api/shopee/iklan/sampel/'+x.id,{method:'DELETE'});loadShpIklan()}catch(err){alert('Gagal menghapus: '+err.message)}
    return;
  }
  const ch=e.target.closest('[data-si-cpas-hapus]');
  if(ch&&siData){
    const x=(siData.cpas||[]).find(y=>y.id===Number(ch.dataset.siCpasHapus));
    if(!x||!confirm('Hapus iklan CPAS '+x.toko+' '+rpFull(x.biaya)+' ('+fmtRange(x.dari,x.sampai)+')?'))return;
    try{await api('/api/shopee/iklan/cpas/'+x.id,{method:'DELETE'});loadShpIklan()}catch(err){alert('Gagal menghapus: '+err.message)}
    return;
  }
  const h=e.target.closest('[data-si-hapus]');if(!h||!siData)return;
  const l=siData.laporan.find(x=>x.id===Number(h.dataset.siHapus));
  if(!l||!confirm('Hapus laporan iklan '+l.toko+' periode '+fmtRange(l.dari,l.sampai)+'?'))return;
  try{await api('/api/shopee/iklan/laporan/'+l.id,{method:'DELETE'});loadShpIklan()}catch(err){alert('Gagal menghapus: '+err.message)}
});
$('siExport').addEventListener('click',()=>{
  if(!siData)return;const d=siData,akhir='-'+d.from+'_'+d.to+'.csv';
  const m=r=>[r.dilihat,r.klik,r.konversi,r.terjual,r.omzet,r.biaya,r.biaya?(r.omzet/r.biaya).toFixed(2):'',r.biaya?(100*(r.omzet-r.biaya)/r.biaya).toFixed(1):'',r.omzet?(100*r.biaya/r.omzet).toFixed(1):''];
  const H=['Dilihat','Klik','Konversi','Terjual','Omzet iklan','Biaya','ROAS','ROI (%)','ACOS (%)'];
  if(siTab==='toko')return unduhCsv('shopee-iklan-per-toko'+akhir,['Toko','Laporan',...H],d.per_toko.map(r=>[r.toko,r.laporan,...m(r)]));
  if(siTab==='bonus')return unduhCsv('shopee-iklan-bonus-roas'+akhir,['Tanggal masuk','Toko','Periode dari','Periode sampai','Iklan / grup iklan','Nominal','Keterangan'],
    (d.bonus||[]).map(x=>[x.tgl,x.toko,x.dari||'',x.sampai||'',x.kampanye||'',x.nominal,x.ket||'']));
  if(siTab==='sampel')return unduhCsv('shopee-sampel-affiliate'+akhir,['Tanggal kirim','Toko','Affiliate','Produk','Qty','HPP per unit','Ongkir','Nilai','Keterangan'],
    (d.sampel||[]).map(x=>[x.tgl,x.toko,x.affiliate,x.produk,x.qty,x.hpp,x.ongkir||0,x.nilai,x.ket||'']));
  if(siTab==='cpas')return unduhCsv('shopee-iklan-cpas'+akhir,['Dari','Sampai','Toko','Kampanye','Klik','Pembelian','Nilai konversi','Spend','ROAS','Keterangan','Dihitung'],
    (d.cpas||[]).map(x=>[x.dari,x.sampai,x.toko,x.kampanye||'',x.klik||0,x.konversi||0,x.omzet||0,x.biaya,x.biaya?((x.omzet||0)/x.biaya).toFixed(2):'',x.ket||'',x.terpotong?'tidak':'ya']));
  if(siTab==='laporan')return unduhCsv('shopee-iklan-laporan'+akhir,['Dari','Sampai','Toko','Iklan','Omzet iklan','Biaya','Dihitung'],d.laporan.map(l=>[l.dari,l.sampai,l.toko,l.iklan,l.omzet||0,l.biaya||0,l.terpotong?'tidak':'ya']));
  unduhCsv('shopee-iklan-per-iklan'+akhir,['Toko','Iklan','Status','Jenis','Mode bidding','Penempatan','Kode produk',...H],
    d.per_iklan.map(r=>[r.toko,r.nama,r.status||'',r.jenis||'',r.mode_bidding||'',r.penempatan||'',r.kode_produk||'',...m(r)]));
});
// Bonus proteksi ROAS (manual): API & file laporan iklan tidak memuatnya
function siBukaBonus(){
  if(!siData)return;
  const f=$('siBonusForm'),d=siData,hariIni=new Date(Date.now()+7*36e5).toISOString().slice(0,10);f.reset();
  f.elements.toko_id.innerHTML=d.toko.map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('');
  if($('siToko').value)f.elements.toko_id.value=$('siToko').value;
  f.elements.tgl.value=d.to<hariIni?d.to:hariIni;f.elements.tgl.max=hariIni;
  // Saran nama iklan: iklan GMV Max ROAS lebih dulu
  const nama=[...new Set(d.per_iklan.slice().sort((a,b)=>/ROAS/i.test(b.mode_bidding||'')-/ROAS/i.test(a.mode_bidding||'')).map(r=>r.nama))];
  $('siBonusIklan').innerHTML=nama.map(n=>'<option value="'+esc(n)+'">').join('');
  put('siBonusMsg','');$('siBonusDlg').showModal();f.elements.nominal.focus();
}
$('siBonusTambah').addEventListener('click',siBukaBonus);
$('siBonusTutup').addEventListener('click',()=>$('siBonusDlg').close());
$('siBonusBatal').addEventListener('click',()=>$('siBonusDlg').close());
$('siBonusDlg').addEventListener('click',e=>{if(e.target===$('siBonusDlg'))$('siBonusDlg').close()});
$('siBonusForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('siBonusForm'),b=$('siBonusSimpan'),v=k=>f.elements[k].value.trim();
  if(v('sampai')&&!v('dari'))return put('siBonusMsg','Isi juga tanggal awal periode iklan.');
  b.disabled=true;put('siBonusMsg','Menyimpan…');
  try{
    await api('/api/shopee/iklan/bonus',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({toko_id:Number(v('toko_id')),tgl:v('tgl'),nominal:Number(v('nominal')),dari:v('dari'),sampai:v('sampai'),kampanye:v('kampanye'),ket:v('ket')})});
    $('siBonusDlg').close();siTab='bonus';loadShpIklan();
  }catch(err){put('siBonusMsg','Gagal: '+err.message)}
  finally{b.disabled=false}
});
// Iklan CPAS (Meta → Shopee, manual): spend ditagih Meta, penjualan di Shopee — angka dari Meta Ads Manager
function siBukaCpas(){
  if(!siData)return;
  const f=$('siCpasForm'),d=siData,hariIni=new Date(Date.now()+7*36e5).toISOString().slice(0,10),akhir=d.to<hariIni?d.to:hariIni;f.reset();
  f.elements.toko_id.innerHTML=d.toko.map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('');
  if($('siToko').value)f.elements.toko_id.value=$('siToko').value;
  f.elements.dari.value=akhir;f.elements.sampai.value=akhir;f.elements.dari.max=f.elements.sampai.max=hariIni;
  put('siCpasMsg','');$('siCpasDlg').showModal();f.elements.biaya.focus();
}
$('siCpasTambah').addEventListener('click',siBukaCpas);
$('siCpasTutup').addEventListener('click',()=>$('siCpasDlg').close());
$('siCpasBatal').addEventListener('click',()=>$('siCpasDlg').close());
$('siCpasDlg').addEventListener('click',e=>{if(e.target===$('siCpasDlg'))$('siCpasDlg').close()});
$('siCpasForm').elements.dari.addEventListener('change',e=>{const s=$('siCpasForm').elements.sampai;if(!s.value||s.value<e.target.value)s.value=e.target.value});
$('siCpasForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('siCpasForm'),b=$('siCpasSimpan'),v=k=>f.elements[k].value.trim();
  if(v('sampai')<v('dari'))return put('siCpasMsg','Tanggal akhir sebelum tanggal awal.');
  b.disabled=true;put('siCpasMsg','Menyimpan…');
  try{
    await api('/api/shopee/iklan/cpas',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({toko_id:Number(v('toko_id')),dari:v('dari'),sampai:v('sampai'),biaya:Number(v('biaya')),omzet:Number(v('omzet'))||0,
        konversi:Number(v('konversi'))||0,klik:Number(v('klik'))||0,kampanye:v('kampanye'),ket:v('ket')})});
    $('siCpasDlg').close();siTab='cpas';loadShpIklan();
  }catch(err){put('siCpasMsg','Gagal: '+err.message)}
  finally{b.disabled=false}
});
// Sampel produk affiliate (manual): nilai = qty × HPP per unit + ongkir; HPP kosong → HPP List Produk pada tanggal kirim (dihitung server)
function siSampelHitung(){
  const f=$('siSampelForm'),lain=f.elements.produk_id.value==='lain',p=(siData.produk||[]).find(x=>String(x.id)===f.elements.produk_id.value);
  $('siSampelNamaL').hidden=!lain;f.elements.produk.required=lain;
  f.elements.hpp.placeholder=p?'otomatis · saat ini '+rpFull(p.hpp):'isi HPP per unit';f.elements.hpp.required=lain;
  const hpp=f.elements.hpp.value!==''?Number(f.elements.hpp.value):p?p.hpp:0,qty=Math.max(0,Math.round(Number(f.elements.qty.value)||0));
  f.elements.nilai.value=rpFull(qty*hpp+Math.max(0,Number(f.elements.ongkir.value)||0))+(p&&f.elements.hpp.value===''?' (perkiraan)':'');
}
function siBukaSampel(){
  if(!siData)return;
  const f=$('siSampelForm'),d=siData,hariIni=new Date(Date.now()+7*36e5).toISOString().slice(0,10);f.reset();
  f.elements.toko_id.innerHTML=d.toko.map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('');
  if($('siToko').value)f.elements.toko_id.value=$('siToko').value;
  f.elements.tgl.value=d.to<hariIni?d.to:hariIni;f.elements.tgl.max=hariIni;
  f.elements.produk_id.innerHTML=(d.produk||[]).map(x=>'<option value="'+x.id+'">'+esc(x.nama)+'</option>').join('')+'<option value="lain">Lainnya (di luar List Produk)…</option>';
  $('siSampelAff').innerHTML=[...new Set((d.sampel||[]).map(x=>x.affiliate))].map(n=>'<option value="'+esc(n)+'">').join('');
  siSampelHitung();put('siSampelMsg','');$('siSampelDlg').showModal();f.elements.affiliate.focus();
}
$('siSampelTambah').addEventListener('click',siBukaSampel);
$('siSampelTutup').addEventListener('click',()=>$('siSampelDlg').close());
$('siSampelBatal').addEventListener('click',()=>$('siSampelDlg').close());
$('siSampelDlg').addEventListener('click',e=>{if(e.target===$('siSampelDlg'))$('siSampelDlg').close()});
$('siSampelForm').addEventListener('input',siSampelHitung);
$('siSampelForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('siSampelForm'),b=$('siSampelSimpan'),v=k=>f.elements[k].value.trim(),lain=v('produk_id')==='lain';
  b.disabled=true;put('siSampelMsg','Menyimpan…');
  try{
    await api('/api/shopee/iklan/sampel',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({toko_id:Number(v('toko_id')),tgl:v('tgl'),affiliate:v('affiliate'),produk_id:lain?null:Number(v('produk_id'))||null,produk:lain?v('produk'):'',
        qty:Number(v('qty')),hpp:v('hpp')===''?null:Number(v('hpp')),ongkir:Number(v('ongkir'))||0,ket:v('ket')})});
    $('siSampelDlg').close();siTab='sampel';loadShpIklan();
  }catch(err){put('siSampelMsg','Gagal: '+err.message)}
  finally{b.disabled=false}
});
