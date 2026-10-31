/**
 * Sales › CS × Produk: grafik status lead & peta produk per CS, matriks CS × produk (pilihan metrik), tabel per produk, ekspor CSV.
 * Data: /api/report/cs-produk. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta rentang(), loadSettings(), jumlahkan() & pasangMatriks() dari script utama (window.*; dua terakhir dipakai juga Performa Wilayah).
 * Dipanggil dari script utama: openCsProduk() (menu CS × Produk).
 */
// ---- CS × Produk
let cpData=null,cpBusy=false,cpStoresOk=false;
const CP_MAKS_PRODUK=40;                // sama dengan LIMIT pada /api/report/cs-produk

const cpDates=()=>rentang('cpRange');

function renderCp(d){
  const metrik=$('cpMetrik').value;
  $('cpKet').innerHTML='Baris diurutkan dari produk dengan order terbanyak · sel dengan kurang dari 5 order ditulis samar karena angkanya belum berarti'+
    (metrik==='ringkas'?'<br>Angka besar = jumlah lead · % dari lead sel itu:<span class="rk-leg"><i class="cf">Complete</i><i class="pd">Pending</i><i class="cn">Cancel</i></span>':'');
  const produk=d.per_product||[];          // baris
  const cs=d.per_cs||[];                   // kolom
  put('cpPeriod','Silang penanganan CS dengan produk · '+fmtRange(d.from,d.to)+' · '+cs.length+' CS · '+produk.length+' produk');

  const peta={};
  for(const x of d.cells||[])peta[x.product+'|'+x.handler_id]=x;
  // Sudut kanan-bawah dijumlahkan dari per_cs, bukan dari per_product: order yang
  // memuat beberapa produk terhitung berulang bila dijumlahkan menurut produk.
  cpGambar(d);
  pasangMatriks('cpHead','cpRows',
    produk.map(p=>Object.assign({},p,{key:p.product,label:p.product})),
    cs.map(c=>Object.assign({},c,{key:c.handler_id,label:c.handler_name})),
    peta,metrik,'Produk','Semua CS','Semua produk',jumlahkan(cs));

  const semua=d.per_product||[];
  $('cpProdukRows').innerHTML=semua.length?semua.map(r=>{
    const rts=r.rts_rate==null?'—':(r.rts_rate>=10?'<span class="tag loss">'+pct(r.rts_rate)+'</span>':pct(r.rts_rate));
    return '<tr><td class="name">'+esc(r.product)+'</td>'+
      '<td class="n">'+int(r.orders)+'</td><td class="n">'+int(r.confirmed)+'</td>'+
      '<td class="n">'+pct(r.confirm_rate)+'</td>'+
      '<td class="n">'+int(r.canceled)+'</td><td class="n">'+rts+'</td>'+
      '<td class="n">'+rpFull(r.confirmed_value)+'</td></tr>';
  }).join(''):'<tr><td colspan="7" style="color:var(--muted)">Belum ada order pada rentang ini.</td></tr>';

  const n=$('cpNote');
  if(n){
    // Endpoint membatasi 40 produk; bila pas 40, kemungkinan masih ada yang terpotong.
    n.textContent=produk.length>=CP_MAKS_PRODUK
      ? 'Baris dibatasi '+CP_MAKS_PRODUK+' produk dengan order terbanyak. Baris "Semua produk" tetap menjumlahkan seluruh order, termasuk produk yang tidak tampil.'
      : '';
    n.hidden=!n.textContent;
  }
}

/**
 * Grafik CS × produk untuk CS terpilih (atau semua CS):
 *  - batang bertumpuk Complete / Pending / Cancel / lainnya per produk (15 teratas menurut lead), jumlah atau % dari lead;
 *  - peta produk: x = lead, y = confirm rate, besar titik = nilai confirm; garis putus = confirm rate rata-rata CS itu.
 * Produk dengan kurang dari 5 lead tidak masuk peta (angkanya belum berarti).
 */
let cpBar=null,cpPeta=null;
function cpGambar(d){
  const sel=$('cpGrafCs'),v=sel.value,cs=d.per_cs||[];
  sel.innerHTML='<option value="">Semua CS</option>'+cs.map(c=>'<option value="'+esc(c.handler_id)+'">'+esc(c.handler_name)+'</option>').join('');
  sel.value=cs.some(c=>String(c.handler_id)===v)?v:'';
  if(typeof Chart==='undefined')return;
  const id=sel.value,persen=(document.querySelector('#cpGrafMode button.on')||{}).dataset.m==='p';
  const baris=(id?(d.cells||[]).filter(x=>String(x.handler_id)===id):(d.per_product||[])).filter(x=>x.orders>0).sort((a,b)=>b.orders-a.orders);
  const nama=id?(cs.find(c=>String(c.handler_id)===id)||{}).handler_name:'semua CS';
  const tot=jumlahkan(id?cs.filter(c=>String(c.handler_id)===id):cs);
  put('cpGrafSub',esc(nama)+' · '+int(tot.orders)+' lead · confirm rate '+pct(tot.confirm_rate)+' · '+int(baris.length)+' produk');
  const atas=baris.slice(0,15),pendek=t=>t.length>34?t.slice(0,33)+'…':t;
  put('cpGrafN',atas.length<baris.length?atas.length+' produk teratas menurut lead':int(atas.length)+' produk');
  $('cpBarWrap').style.height=Math.max(200,60+atas.length*30)+'px';
  const lain=x=>Math.max(0,(x.orders||0)-(x.confirmed||0)-(x.pending||0)-(x.canceled||0));
  const bag=[['Complete',x=>x.confirmed||0,'--rev'],['Pending',x=>x.pending||0,'--spend'],['Cancel',x=>x.canceled||0,'--loss'],['Lainnya',lain,'--line-2']];
  const nilai=(f,x)=>persen?(x.orders?100*f(x)/x.orders:0):f(x);
  const legend={position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:12}};
  if(cpBar)cpBar.destroy();
  cpBar=new Chart($('cpBar'),{type:'bar',
    data:{labels:atas.map(x=>pendek(x.product)),datasets:bag.filter(([n,f])=>n!=='Lainnya'||atas.some(x=>f(x))).map(([label,f,w])=>({label,data:atas.map(x=>nilai(f,x)),backgroundColor:css(w),stack:'s',borderRadius:2,barThickness:18,f}))},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend,tooltip:{callbacks:{title:it=>atas[it[0].dataIndex].product+' · '+int(atas[it[0].dataIndex].orders)+' lead',
        label:c=>{const x=atas[c.dataIndex],n=c.dataset.f(x);return ' '+c.dataset.label+': '+int(n)+' ('+pct(x.orders?100*n/x.orders:0)+')'}}}},
      scales:{x:{stacked:true,max:persen?100:undefined,grid:{color:css('--line')},border:{display:false},ticks:{precision:0,callback:v=>persen?v+'%':int(v)}},y:{stacked:true,grid:{display:false},ticks:{font:{size:11}}}}}});
  // Peta produk
  const titik=baris.filter(x=>x.orders>=5),maksNilai=Math.max(1,...titik.map(x=>x.confirmed_value||0));
  const rata=tot.confirm_rate,xMax=Math.ceil(Math.max(10,...titik.map(x=>x.orders))*1.08/10)*10;
  const warna=x=>css(x.confirm_rate>=rata+10?'--rev':x.confirm_rate<=rata-10?'--loss':'--info');
  if(cpPeta)cpPeta.destroy();
  cpPeta=new Chart($('cpPeta'),{type:'bubble',
    data:{datasets:[
      {label:'Produk',data:titik.map(x=>({x:x.orders,y:x.confirm_rate||0,r:5+13*Math.sqrt((x.confirmed_value||0)/maksNilai)})),
        backgroundColor:titik.map(x=>warna(x)+'B3'),borderColor:titik.map(warna),borderWidth:1},
      {type:'line',label:'Rata-rata',data:rata==null?[]:[{x:0,y:rata},{x:xMax,y:rata}],borderColor:css('--muted'),borderDash:[5,4],borderWidth:1,pointRadius:0,fill:false}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{filter:it=>it.datasetIndex===0,callbacks:{label:c=>{const x=titik[c.dataIndex];
        return [x.product,int(x.orders)+' lead · confirm rate '+pct(x.confirm_rate),'Pending '+int(x.pending)+' · cancel '+int(x.canceled)+' · nilai confirm '+rpFull(x.confirmed_value||0)]}}}},
      scales:{x:{type:'linear',min:0,max:xMax,title:{display:true,text:'Jumlah lead'},grid:{color:css('--line')},ticks:{precision:0}},
        y:{min:0,max:100,title:{display:true,text:'Confirm rate'},grid:{color:css('--line')},ticks:{callback:v=>v+'%'}}}}});
}
$('cpGrafCs').addEventListener('change',()=>{if(cpData)cpGambar(cpData)});
$('cpGrafMode').addEventListener('click',e=>{if(e.target.closest('button')&&cpData)setTimeout(()=>cpGambar(cpData))});

async function loadCp(){
  if(cpBusy)return;cpBusy=true;
  $('cpRows').innerHTML='<tr><td style="color:var(--muted)">Memuat…</td></tr>';
  $('cpProdukRows').innerHTML='<tr><td colspan="7" style="color:var(--muted)">Memuat…</td></tr>';
  const r=cpDates(),store=$('cpStore').value;
  const q=new URLSearchParams({from:r.from,to:r.to});
  if(store)q.set('store_id',store);
  try{
    cpData=await api('/api/report/cs-produk?'+q);
    renderCp(cpData);
  }catch(e){
    cpData=null;
    $('cpHead').innerHTML='';
    $('cpRows').innerHTML='<tr><td style="color:var(--loss)">Gagal memuat data.</td></tr>';
    $('cpProdukRows').innerHTML='<tr><td colspan="7" style="color:var(--muted)">—</td></tr>';
  }finally{cpBusy=false}
}

function openCsProduk(){
  if(!cpStoresOk){cpStoresOk=true;loadSettings().catch(function(){cpStoresOk=false})}
  loadCp();
}
$('cpRange').addEventListener('click',e=>{if(e.target.closest('button'))loadCp()});
$('cpStore').addEventListener('change',loadCp);
$('cpMetrik').addEventListener('change',()=>{if(cpData)renderCp(cpData)});
$('cpProdukExport').addEventListener('click',()=>{
  if(!cpData||!(cpData.per_product||[]).length)return;
  unduhCsv('per-produk-'+cpData.from+'_'+cpData.to+'.csv',
    ['Produk','Order masuk','Dikonfirmasi','Confirm rate (%)','Dibatalkan','RTS (%)','Nilai confirm'],
    cpData.per_product.map(r=>[r.product,r.orders,r.confirmed,r.confirm_rate,r.canceled,r.rts_rate,r.confirmed_value]));
});
$('cpExport').addEventListener('click',()=>{
  if(!cpData||!(cpData.cells||[]).length)return;
  unduhCsv('cs-x-produk-'+cpData.from+'_'+cpData.to+'.csv',
    ['CS','Produk','Lead','Complete','Complete (%)','Pending','Pending (%)','Cancel','Cancel (%)','Nilai confirm'],
    cpData.cells.map(x=>{const p=n=>x.orders?Math.round(1000*(n||0)/x.orders)/10:'';
      return [x.handler_name,x.product,x.orders,x.confirmed,p(x.confirmed),x.pending,p(x.pending),x.canceled,p(x.canceled),x.confirmed_value]}));
});
