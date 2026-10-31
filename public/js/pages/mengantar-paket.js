/**
 * Pengiriman (Mengantar) › Ringkasan Paket: kotak status paket, grafik harian, tabel per kurir / gudang / barang, ekspor CSV per barang.
 * Data: /api/report/shipments. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta
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
function shBaris(label,r){
  return '<tr><td class="name">'+label+'</td>'+shSel(r.delivered,r.total)+shSel(r.on_going,r.total)+shSel(r.rts,r.total,true)+
    '<td class="n"><b>'+int(r.total)+'</b><small>100%</small></td></tr>';
}
function renderShip(d){
  const s=d.summary||{},tot=s.total||0,bagi=n=>tot?pct(100*(n||0)/tot):'—';
  put('shPeriod','Mengantar · paket dibuat '+fmtRange(d.from,d.to)+shSync(d));
  shIsiKurir('shKurir',d.couriers);

  $('shKpiDibuat').innerHTML=int(tot)+shKecil('100%');
  put('shKpiDibuatD',int(s.cod_count)+' COD · '+int(tot-(s.cod_count||0))+' non-COD · nilai COD '+rpFull(s.cod_total));
  $('shKpiJalan').innerHTML=int(s.on_going)+shKecil(bagi(s.on_going));
  $('shKpiJalanD').innerHTML=(s.perlu_perhatian?'<b>'+int(s.perlu_perhatian)+' bermasalah</b> · ':'')+(s.lost?int(s.lost)+' hilang · ':'')+'COD '+esc(rpFull(s.cod_in_transit));
  $('shKpiKirim').innerHTML=int(s.delivered)+shKecil(bagi(s.delivered));
  put('shKpiKirimD',(s.avg_days_to_deliver!=null?'Rata-rata '+nf.format(s.avg_days_to_deliver)+' hari · ':'')+'COD '+rpFull(s.cod_delivered));
  $('shKpiRts').innerHTML=int(s.rts)+shKecil(bagi(s.rts));
  put('shKpiRtsD','COD batal cair '+rpFull(s.cod_rts));

  drawShip(d.daily||[],d.from,d.to);
  $('shKurirRows').innerHTML=(d.by_courier||[]).length?d.by_courier.map(r=>shBaris(esc(r.courier||'—'),r)).join(''):shKosong(5);
  $('shGudangRows').innerHTML=(d.by_shipper||[]).length?d.by_shipper.map(r=>shBaris(esc(r.shipper),r)).join(''):shKosong(5);
  const br=d.by_goods||[];
  put('shBarangSub',int(br.length)+' jenis barang · isi paket sesuai keterangan barang di Mengantar');
  $('shBarangRows').innerHTML=br.length?br.map(r=>shBaris('<span class="sh-brg">'+esc(r.goods)+'</span>',r)).join(''):shKosong(5);
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
      {label:'Terkirim',data:data[1],type:'line',borderColor:rev,backgroundColor:rev,borderWidth:2.2,pointRadius:0,tension:.35},
      {label:'RTS',data:data[2],type:'line',borderColor:loss,backgroundColor:loss,borderWidth:1.8,pointRadius:0,tension:.35}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:10}},y:{grid:{color:line},border:{display:false},beginAtZero:true,ticks:{precision:0}}}}});
}

// Filter rentang, COD, kurir & ekspor per barang
function pasangPaket(){
  ['shRange','shCod'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.closest('button'))loadShip()}));
  $('shKurir').addEventListener('change',loadShip);
  $('shBarangExport').addEventListener('click',()=>{
    if(!shData||!(shData.by_goods||[]).length)return;
    const p=(n,t)=>t?Math.round(1000*n/t)/10:'';
    unduhCsv('mengantar-per-barang-'+shData.from+'_'+shData.to+'.csv',
      ['Barang','Terkirim','Terkirim (%)','Dalam perjalanan','Dalam perjalanan (%)','RTS','RTS (%)','Total paket'],
      shData.by_goods.map(r=>[r.goods,r.delivered,p(r.delivered,r.total),r.on_going,p(r.on_going,r.total),r.rts,p(r.rts,r.total),r.total]));
  });
}
pasangPaket();
