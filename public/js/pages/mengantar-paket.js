/**
 * Pengiriman (Mengantar) › Ringkasan Paket: kotak status paket, grafik harian, tabel per kurir / gudang / barang, ekspor CSV per barang.
 * Data: /api/report/shipments. Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta
 * helper Mengantar shQuery/shIsiKurir/shSync/shKecil/shKosong/shGagal dari script utama (window.*).
 * Dipanggil dari script utama: loadShip() (menu Ringkasan Paket).
 */
// ---------- 1. Ringkasan Paket
let shData=null,shBusy=false,shChart=null;
async function loadShip(){
  if(shBusy)return;shBusy=true;
  try{shData=await api('/api/report/shipments?'+shQuery('sh').q);renderShip(shData)}
  catch(e){shGagal(['shKurirRows','shGudangRows','shBarangRows'],e)}
  finally{shBusy=false}
}

/** Sel "jumlah · persen" untuk kolom status; RTS ≥8% ditandai merah */
function shSel(n,tot,rts){
  const p=tot?100*(n||0)/tot:0;
  const isi=int(n)+'<small>'+(tot?pct(p):'—')+'</small>';
  return '<td class="n">'+(rts&&n&&p>=8?'<span class="sh-rts">'+isi+'</span>':isi)+'</td>';
}
/**
 * rasio=true: tambah kolom Rasio sukses & Rasio RTS, dibagi total keseluruhan paket kurir. Rasio RTS ≥8% merah.
 */
function shBaris(label,r,rasio){
  let ek='';
  if(rasio){const tot=r.total||0,ps=tot?100*(r.delivered||0)/tot:0,pr=tot?100*(r.rts||0)/tot:0;
    ek=tot?'<td class="n"><b>'+pct(ps)+'</b><small>dari '+int(tot)+' paket</small></td><td class="n">'+(pr>=8?'<span class="sh-rts"><b>'+pct(pr)+'</b></span>':'<b>'+pct(pr)+'</b>')+'</td>'
      :'<td class="n" style="color:var(--muted)">—</td><td class="n" style="color:var(--muted)">—</td>'}
  return '<tr><td class="name">'+label+'</td>'+shSel(r.delivered,r.total)+shSel(r.on_going,r.total)+shSel(r.rts,r.total,true)+
    '<td class="n"><b>'+int(r.total)+'</b><small>100%</small></td>'+ek+'</tr>';
}
function renderShip(d){
  const s=d.summary||{},tot=s.total||0,bagi=n=>tot?pct(100*(n||0)/tot):'—';
  const gd=$('shGudang').value;
  put('shPeriod','Mengantar · paket dibuat '+fmtRange(d.from,d.to)+(gd?' · gudang '+gd:'')+shSync(d));
  shIsiKurir('shKurir',d.couriers,d.gudangs);

  $('shKpiDibuat').innerHTML=int(tot)+shKecil('100%');
  put('shKpiDibuatD',int(s.cod_count)+' COD · '+int(tot-(s.cod_count||0))+' non-COD · nilai COD '+rpFull(s.cod_total));
  $('shKpiJalan').innerHTML=int(s.on_going)+shKecil(bagi(s.on_going));
  $('shKpiJalanD').innerHTML=(s.perlu_perhatian?'<b>'+int(s.perlu_perhatian)+' bermasalah</b> · ':'')+(s.lost?int(s.lost)+' hilang · ':'')+'COD '+esc(rpFull(s.cod_in_transit));
  // Peringatan SLA: rata-rata hari kirim bisa menutupi paket yang sangat terlambat
  const ls=s.lewat_sla||0,w=$('shSlaWarn');w.hidden=!ls;
  if(ls)w.innerHTML='⚠️ '+int(ls)+' paket melebihi batas waktu (SLA) <span>Lihat →</span>';
  $('shKpiKirim').innerHTML=int(s.delivered)+shKecil(bagi(s.delivered));
  put('shKpiKirimD',(s.avg_days_to_deliver!=null?'Rata-rata '+nf.format(s.avg_days_to_deliver)+' hari · ':'')+'COD '+rpFull(s.cod_delivered));
  $('shKpiRts').innerHTML=int(s.rts)+shKecil(bagi(s.rts));
  put('shKpiRtsD','COD batal cair '+rpFull(s.cod_rts));

  drawShip(d.daily||[],d.from,d.to);
  $('shKurirRows').innerHTML=(d.by_courier||[]).length?d.by_courier.map(r=>shBaris(esc(r.courier||'—'),r,true)).join(''):shKosong(7);
  $('shGudangRows').innerHTML=(d.by_shipper||[]).length?d.by_shipper.map(r=>shBaris(esc(r.shipper),r)).join(''):shKosong(5);
  renderShBarang();
}
/**
 * Tabel per barang dengan urutan yang bisa dipilih, supaya barang ber-RTS tinggi tapi volume kecil
 * tidak tenggelam di bawah. "% RTS tertinggi" hanya untuk barang ≥ SH_RTS_MIN paket (sisanya di bawah)
 * agar 1 paket retur dari 1 paket (100%) tidak selalu jadi teratas.
 */
let shUrut='total';const SH_RTS_MIN=5;
function renderShBarang(){
  const br=[...(shData&&shData.by_goods||[])],rp=r=>r.total?r.rts/r.total:0;
  if(shUrut==='rts')br.sort((a,b)=>b.rts-a.rts||rp(b)-rp(a));
  else if(shUrut==='rts_pct')br.sort((a,b)=>(b.total>=SH_RTS_MIN)-(a.total>=SH_RTS_MIN)||rp(b)-rp(a)||b.rts-a.rts);
  else br.sort((a,b)=>b.total-a.total);
  put('shBarangSub',int(br.length)+' jenis barang · isi paket sesuai keterangan barang di Mengantar'+
    (shUrut==='rts_pct'?' · % RTS diurutkan untuk barang ≥ '+SH_RTS_MIN+' paket':''));
  $('shBarangRows').innerHTML=br.length?br.map(r=>shBaris('<span class="sh-brg">'+esc(r.goods)+'</span>',r)).join(''):shKosong(5);
  $('shBarangRows').closest('.sh-scroll').scrollTop=0;
}

/** Grafik harian dari..sampai; hari tanpa kejadian tetap tampil sebagai nol. */
function drawShip(daily,from,to){
  if(typeof Chart==='undefined')return;
  const per=new Map(daily.map(r=>[r.date,r]));
  const tgl=[];for(let t=from;t<=to&&tgl.length<400;t=shift(t,1))tgl.push(t);
  const seri=k=>tgl.map(t=>(per.get(t)||{})[k]||0);
  const labels=tgl.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const data=[seri('created'),seri('delivered'),seri('rts')];
  if(shChart){shChart.data.labels=labels;data.forEach((x,i)=>shChart.data.datasets[i].data=x);shChart.update();return}
  const rev=css('--rev'),loss=css('--loss'),line=css('--line');
  shChart=new Chart(document.getElementById('shipDaily'),{type:'bar',
    data:{labels,datasets:[
      {label:'Dibuat',data:data[0],backgroundColor:css('--line-2'),borderRadius:3,barPercentage:.7},
      // Garis memakai sumbu kanan sendiri (berlabel) supaya angkanya terbaca tanpa hover
      {label:'Terkirim',data:data[1],type:'line',yAxisID:'y1',borderColor:rev,backgroundColor:rev,borderWidth:2.2,pointRadius:2,pointHoverRadius:4,tension:.35},
      {label:'RTS',data:data[2],type:'line',yAxisID:'y1',borderColor:loss,backgroundColor:loss,borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.35}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:10}},
        y:{position:'left',grid:{color:line},border:{display:false},beginAtZero:true,ticks:{precision:0},
          title:{display:true,text:'Dibuat (batang)',color:css('--muted'),font:{size:11}}},
        y1:{position:'right',grid:{display:false},border:{display:false},beginAtZero:true,ticks:{precision:0,color:rev},
          title:{display:true,text:'Terkirim / RTS (garis)',color:rev,font:{size:11}}}}}});
}

// Filter rentang, COD, kurir & ekspor per barang
function pasangPaket(){
  ['shRange','shCod'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.closest('button'))loadShip()}));
  ['shKurir','shGudang'].forEach(id=>$(id).addEventListener('change',loadShip));
  // Ke Tracking & Masalah dengan filter "Melebihi SLA", membawa rentang tanggal, kurir & gudang yang sama
  $('shSlaWarn').addEventListener('click',()=>{
    const salin=(dari,ke)=>{const v=$(dari).value,s=$(ke);
      if(v&&![...s.options].some(o=>o.value===v))s.add(new Option(v,v));s.value=v};
    salin('shKurir','mmKurir');salin('shGudang','mmGudang');
    mmKat=MM_LEWAT;
    const cod=($('shCod').querySelector('button.on')||{}).dataset,mc=$('mmCod');
    if(mc&&cod)mc.querySelectorAll('button').forEach(b=>b.classList.toggle('on',(b.dataset.cod||'')===(cod.cod||'')));
    const on=$('shRange').querySelector('button.on'),mode=on&&on.dataset.range,seg=$('mmRange');
    const sama=mode&&mode!=='custom'&&seg.querySelector('button[data-range="'+mode+'"]');
    if(sama){delete seg.dataset.from;delete seg.dataset.to;sama.click()}
    else{const r=rentang('shRange');seg.dataset.from=r.from;seg.dataset.to=r.to;seg.querySelector('button[data-range="custom"]').click()}
    bukaView('mgmasalah');
  });
  $('shBarangUrut').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    shUrut=b.dataset.urut;$('shBarangUrut').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderShBarang()});
  $('shBarangExport').addEventListener('click',()=>{
    if(!shData||!(shData.by_goods||[]).length)return;
    const p=(n,t)=>t?Math.round(1000*n/t)/10:'';
    unduhCsv('mengantar-per-barang-'+shData.from+'_'+shData.to+'.csv',
      ['Barang','Terkirim','Terkirim (%)','Dalam perjalanan','Dalam perjalanan (%)','RTS','RTS (%)','Total paket'],
      shData.by_goods.map(r=>[r.goods,r.delivered,p(r.delivered,r.total),r.on_going,p(r.on_going,r.total),r.rts,p(r.rts,r.total),r.total]));
  });
}
pasangPaket();
