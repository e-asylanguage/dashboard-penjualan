/**
 * Sales › Pcs Terjual: pcs per produk List Produk (Scalev, Shopee, TikTok) dan per CS (Scalev), daftar varian / SKU yang isinya belum diatur, ekspor CSV.
 * Data: /api/report/pcs-terjual. Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta rentang() dari script utama (window.*).
 * Dipanggil dari script utama: loadPcsTerjual() (menu Pcs Terjual).
 */
// ---- Pcs Terjual: pcs per produk List Produk (semua channel) dan per CS (Scalev)
let ptData=null,ptBusy=false;
const ptCsBuka=new Set();   // CS yang baris rinciannya sedang terbuka (bertahan saat ganti rentang)
const PT_CH=[['scalev','Scalev'],['shopee','Shopee'],['tiktok','TikTok']];
const ptRata=(pcs,n)=>n?nf.format(Math.round(pcs/n*100)/100):'—';
const ptKosong='<span style="color:var(--muted)">—</span>';
async function loadPcsTerjual(){
  if(ptBusy)return;ptBusy=true;
  try{const r=rentang('ptRange');ptData=await api('/api/report/pcs-terjual?from='+r.from+'&to='+r.to);renderPcsTerjual()}
  catch(e){$('ptProdukRows').innerHTML='<tr><td colspan="6" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
  finally{ptBusy=false}
}
/** Produk yang jadi kolom di tabel Per CS: punya pcs dari Scalev, urut terbanyak */
const ptProdukCs=d=>d.produk.filter(p=>p.scalev>0).sort((a,b)=>b.scalev-a.scalev);
function renderPcsTerjual(){
  const d=ptData,tot={};d.total.forEach(t=>tot[t.channel]=t);
  // Filter produk: daftar = produk yang terjual di rentang ini; pilihan dipertahankan bila masih ada
  const sel=$('ptProduk'),pilih=sel.value;
  sel.innerHTML='<option value="">Semua produk</option>'+d.produk.filter(p=>p.total>0).map(p=>'<option value="'+p.produk_id+'">'+esc(p.nama)+' ('+int(p.total)+' pcs)</option>').join('');
  sel.value=d.produk.some(p=>String(p.produk_id)===pilih&&p.total>0)?pilih:'';
  const fp=sel.value?d.produk.find(p=>String(p.produk_id)===sel.value):null;
  // KPI: semua produk = total channel; satu produk = pcs & order yang memuat produk itu
  const kpi=fp?Object.fromEntries(PT_CH.map(([k])=>[k,{pcs:fp[k]||0,order:(fp.order||{})[k]||0}])):tot;
  const semua=PT_CH.reduce((a,[k])=>a+((kpi[k]||{}).pcs||0),0),nOrder=PT_CH.reduce((a,[k])=>a+((kpi[k]||{}).order||0),0);
  put('ptPeriod',(fp?fp.nama+' · semua channel':'Jumlah barang terjual per produk, semua channel')+' · '+fmtRange(d.from,d.to)+' · '+int(nOrder)+' order');
  $('ptK0L').textContent=fp?'Pcs terjual produk ini':'Total pcs terjual';
  put('ptK0',int(semua)+' pcs');put('ptK0D',int(nOrder)+' order · '+ptRata(semua,nOrder)+' pcs/order'+(fp&&d.produk.length?' · '+pct(100*fp.total/d.produk.reduce((a,p)=>a+p.total,0))+' dari semua produk':''));
  PT_CH.forEach(([k])=>{const t=kpi[k]||{pcs:0,order:0};
    put('ptK'+k,int(t.pcs)+' pcs');put('ptK'+k+'D',int(t.order)+' order · '+ptRata(t.pcs,t.order)+' pcs/order'+(semua?' · '+pct(100*t.pcs/semua):''))});
  const nKurang=d.total.reduce((a,t)=>a+t.order_kurang,0),pcsBelum=d.belum.reduce((a,b)=>a+b.pcs,0);
  $('ptWarn').hidden=!nKurang;
  $('ptWarn').innerHTML=nKurang?'<p>'+int(nKurang)+' order berisi varian / SKU yang isinya belum diatur di <b>Manajemen SKU</b>: '+int(pcsBelum)+' pcs dihitung 1 pcs per qty dan belum masuk tabel Per produk. Daftarnya ada di bawah.</p>':'';
  const totProduk=d.produk.reduce((a,p)=>a+p.total,0);
  $('ptProdukRows').innerHTML=d.produk.length?d.produk.map(p=>'<tr'+(fp&&p===fp?' class="pt-pilih"':'')+'><td class="nm">'+esc(p.nama)+'</td>'+PT_CH.map(([k])=>'<td class="n">'+(p[k]?int(p[k]):ptKosong)+'</td>').join('')+
    '<td class="n"><b>'+int(p.total)+'</b></td><td class="n">'+(totProduk?pct(100*p.total/totProduk):'—')+'</td></tr>').join('')+
    '<tr><td class="nm"><b>Total</b></td>'+PT_CH.map(([k])=>'<td class="n"><b>'+int(d.produk.reduce((a,p)=>a+p[k],0))+'</b></td>').join('')+'<td class="n"><b>'+int(totProduk)+'</b></td><td class="n">100%</td></tr>'
    :'<tr><td colspan="6" style="color:var(--muted)">Belum ada barang terjual pada rentang ini.</td></tr>';
  ptGambarDonut(d.produk,totProduk);
  ptGambarTren(d,fp);
  // Per CS: kolom tetap (tidak melebar per produk); rincian produk tiap CS di baris yang bisa dibuka
  const pc=ptProdukCs(d),nmP=new Map(pc.map(p=>[String(p.produk_id),p.nama]));
  const rinci=r=>Object.entries(r.produk||{}).filter(([,n])=>n>0).map(([id,n])=>({nama:nmP.get(String(id))||'?',n})).sort((a,b)=>b.n-a.n);
  // Filter produk aktif: hanya CS yang menjual produk itu · Complete = order yang memuat produk itu · kolom terakhir = porsi produk di pcs CS
  if(fp){const id=fp.produk_id,rows=d.per_cs.filter(r=>(r.produk||{})[id]>0).sort((a,b)=>b.produk[id]-a.produk[id]);
    $('ptCsSub').innerHTML='Order Complete Scalev yang memuat <b>'+esc(fp.nama)+'</b> · pilih "Semua produk" untuk rincian produk per CS';
    $('ptCsHead').innerHTML='<tr><th>CS</th><th class="n">Complete</th><th class="n">Pcs</th><th class="n">Pcs/closing</th><th class="n">Porsi dari pcs CS</th></tr>';
    $('ptCsRows').innerHTML=rows.length?rows.map(r=>{const n=r.produk[id],o=(r.produk_order||{})[id]||0;
      return '<tr><td class="nm">'+esc(r.handler_name)+'</td><td class="n">'+int(o)+'</td><td class="n"><b>'+int(n)+'</b></td><td class="n">'+ptRata(n,o)+'</td><td class="n">'+(r.pcs?pct(100*n/r.pcs):'—')+'</td></tr>'}).join('')
      :'<tr><td colspan="5" style="color:var(--muted)">Belum ada CS yang menjual produk ini lewat Scalev pada rentang ini.</td></tr>';
  }else{
  put('ptCsSub','Order Complete Scalev (marketplace tidak lewat CS) · klik nama CS untuk rincian pcs per produk · ekspor CSV tetap memuat semua produk');
  $('ptCsHead').innerHTML='<tr><th>CS</th><th class="n">Complete</th><th class="n">Pcs</th><th class="n">Pcs/closing</th><th>Produk terbanyak</th></tr>';
  $('ptCsRows').innerHTML=d.per_cs.length?d.per_cs.map(r=>{const p=rinci(r),k=String(r.handler_id??r.handler_name),buka=ptCsBuka.has(k),tot=p.reduce((a,x)=>a+x.n,0)||1;
    return '<tr><td class="nm"><button type="button" class="pt-x" data-pt-cs="'+esc(k)+'" aria-expanded="'+buka+'"'+(p.length?'':' disabled')+' aria-label="Rincian produk '+esc(r.handler_name)+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'+esc(r.handler_name)+'</button></td><td class="n">'+int(r.order)+'</td>'+
      '<td class="n"><b>'+int(r.pcs)+'</b>'+(r.kurang?'<small title="Varian belum punya SKU atau SKU-nya belum diisi komposisi List Produk, dihitung 1 pcs per qty">'+int(r.kurang)+' order isi SKU belum diatur</small>':'')+'</td>'+
      '<td class="n">'+ptRata(r.pcs,r.order)+'</td>'+
      '<td>'+(p.length?esc(p[0].nama)+' <span class="pt-n">'+int(p[0].n)+' pcs</span>'+(p.length>1?' <span class="pt-lain">+'+int(p.length-1)+' produk lain</span>':''):ptKosong)+'</td></tr>'+
      '<tr class="detail"'+(buka?'':' hidden')+'><td colspan="5"><ul class="pt-rinci">'+p.map(x=>'<li><span class="pt-nm">'+esc(x.nama)+'</span><span class="pt-bar"><i style="width:'+(100*x.n/tot).toFixed(1)+'%"></i></span>'+
        '<b>'+int(x.n)+'</b><span class="pt-pct">'+pct(100*x.n/tot)+'</span></li>').join('')+'</ul></td></tr>'}).join('')
    :'<tr><td colspan="5" style="color:var(--muted)">Belum ada order Complete pada rentang ini.</td></tr>';
  }
  const lbl=Object.fromEntries(PT_CH);
  $('ptBelumCard').hidden=!d.belum.length;
  $('ptBelumRows').innerHTML=d.belum.map(b=>'<tr><td>'+lbl[b.channel]+'</td><td class="nm">'+esc(b.nama)+'</td><td class="n">'+int(b.order)+'</td><td class="n">'+int(b.pcs)+'</td></tr>').join('');
}
/** Tren harian: satu garis per channel (satu sumbu pcs), mengikuti filter produk; tanggal kembar (11.11, 12.12 …) diberi garis penanda */
let ptTren=null;
const PT_TREN_W={scalev:'--rev',shopee:'--spend',tiktok:'--pb'};
const PT_KEMBAR={id:'ptKembar',afterDatasetsDraw(ch){
  const k=ch.$kembar||[];if(!k.length)return;const {ctx,chartArea:a,scales:{x}}=ch;ctx.save();
  for(const i of k){const px=x.getPixelForValue(i);ctx.strokeStyle=css('--muted');ctx.setLineDash([3,3]);ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(px,a.top);ctx.lineTo(px,a.bottom);ctx.stroke();
    ctx.setLineDash([]);ctx.fillStyle=css('--ink-2');ctx.font='600 10.5px "Plus Jakarta Sans",system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(ch.$hari[i].slice(8)+'.'+ch.$hari[i].slice(5,7),px,a.top-2)}
  ctx.restore()}};
function ptGambarTren(d,fp){
  const hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const sumber=fp?((d.harian_produk||{})[fp.produk_id]||{}):(d.harian||{});
  const seri=PT_CH.map((_,i)=>hari.map(t=>(sumber[t]||[0,0,0])[i]));
  const totHari=hari.map((_,j)=>seri.reduce((a,s)=>a+s[j],0)),maks=Math.max(0,...totHari),iMaks=totHari.indexOf(maks);
  const fmt=o=>new Intl.DateTimeFormat('id-ID',Object.assign({timeZone:'UTC'},o));
  const labels=hari.map(t=>fmt({day:'numeric',month:'short'}).format(new Date(t+'T00:00:00Z')));
  const kembar=hari.map((t,i)=>t.slice(5,7)===t.slice(8)?i:-1).filter(i=>i>=0);
  put('ptTrenSub',(fp?fp.nama+' · ':'')+'Pcs per tanggal order / pesanan dibuat · satu garis per channel'+(kembar.length?' · garis putus = tanggal kembar':''));
  $('ptTrenPuncak').innerHTML=maks?'Puncak <b>'+esc(fmt({weekday:'short',day:'numeric',month:'short'}).format(new Date(hari[iMaks]+'T00:00:00Z')))+'</b> · <b>'+int(maks)+' pcs</b>':'Belum ada penjualan';
  if(typeof Chart==='undefined')return;
  const ds=PT_CH.map(([k,l],i)=>({label:l,data:seri[i],borderColor:css(PT_TREN_W[k]),backgroundColor:css(PT_TREN_W[k]),borderWidth:2,pointRadius:hari.length>45?0:2.5,pointHoverRadius:5,tension:.25}));
  if(ptTren){ptTren.data.labels=labels;ptTren.data.datasets=ds;ptTren.$kembar=kembar;ptTren.$hari=hari;ptTren.update();return}
  ptTren=new Chart($('ptTren'),{type:'line',data:{labels,datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},layout:{padding:{top:14}},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{title:it=>fmt({weekday:'long',day:'numeric',month:'long'}).format(new Date(ptTren.$hari[it[0].dataIndex]+'T00:00:00Z')),
          label:c=>' '+c.dataset.label+': '+int(c.raw)+' pcs',footer:it=>'Total: '+int(it.reduce((a,x)=>a+(x.raw||0),0))+' pcs'}}},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}},y:{beginAtZero:true,grid:{color:css('--line')},border:{display:false},ticks:{precision:0}}}},
    plugins:[PT_KEMBAR]});
  ptTren.$kembar=kembar;ptTren.$hari=hari;ptTren.update('none');
}
/** Donat porsi pcs: 5 produk teratas + "Lainnya" (warna kategori urutan tetap, divalidasi CVD), tengahnya = produk terbesar */
let ptDonut=null;
const PT_WARNA=['--info','--rev','--spend','--pb','--bo'];
function ptGambarDonut(produk,tot){
  const box=$('ptDonutBox');box.hidden=!tot;if(!tot||typeof Chart==='undefined')return;
  const urut=produk.filter(p=>p.total>0).sort((a,b)=>b.total-a.total),atas=urut.slice(0,5),sisa=urut.slice(5).reduce((a,p)=>a+p.total,0);
  const it=atas.map((p,i)=>({nama:p.nama,n:p.total,w:css(PT_WARNA[i])}));
  if(sisa)it.push({nama:'Lainnya ('+int(urut.length-5)+' produk)',n:sisa,w:css('--line-2')});
  const top=atas[0];
  $('ptDonutT').innerHTML='<b>'+pct(100*top.total/tot)+'</b><span>'+esc(top.nama)+'</span>';
  $('ptDonutLeg').innerHTML=it.map(x=>'<li><i style="background:'+x.w+'"></i><span class="pt-leg-n">'+esc(x.nama)+'</span><b>'+pct(100*x.n/tot)+'</b></li>').join('');
  const data={labels:it.map(x=>x.nama),datasets:[{data:it.map(x=>x.n),backgroundColor:it.map(x=>x.w),borderColor:css('--card'),borderWidth:2,hoverOffset:4}]};
  if(ptDonut){ptDonut.data=data;ptDonut.update();return}
  ptDonut=new Chart($('ptDonut'),{type:'doughnut',data,
    options:{responsive:true,maintainAspectRatio:false,cutout:'66%',plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>' '+int(c.raw)+' pcs ('+pct(100*c.raw/c.dataset.data.reduce((a,x)=>a+x,0))+')'}}}}});
}
$('ptRange').addEventListener('click',e=>{if(e.target.closest('button'))loadPcsTerjual()});
$('ptProduk').addEventListener('change',()=>{if(ptData)renderPcsTerjual()});   // filter di sisi browser, tanpa memuat ulang
$('ptCsRows').addEventListener('click',e=>{
  const b=e.target.closest('.pt-x');if(!b)return;
  const buka=b.getAttribute('aria-expanded')!=='true',k=b.dataset.ptCs;
  b.setAttribute('aria-expanded',buka);buka?ptCsBuka.add(k):ptCsBuka.delete(k);
  const det=b.closest('tr').nextElementSibling;if(det&&det.classList.contains('detail'))det.hidden=!buka;
});
$('ptProdukExport').addEventListener('click',()=>{
  if(!ptData||!ptData.produk.length)return;
  unduhCsv('pcs-terjual-produk-'+ptData.from+'_'+ptData.to+'.csv',['Produk','Scalev','Shopee','TikTok','Total pcs'],
    ptData.produk.map(p=>[p.nama,p.scalev,p.shopee,p.tiktok,p.total]));
});
$('ptCsExport').addEventListener('click',()=>{
  if(!ptData||!ptData.per_cs.length)return;
  const pc=ptProdukCs(ptData);
  unduhCsv('pcs-terjual-cs-'+ptData.from+'_'+ptData.to+'.csv',['CS','Complete','Pcs','Pcs/closing','Order isi SKU belum diatur'].concat(pc.map(p=>p.nama)),
    ptData.per_cs.map(r=>[r.handler_name,r.order,r.pcs,r.order?Math.round(r.pcs/r.order*100)/100:'',r.kurang].concat(pc.map(p=>r.produk[p.produk_id]||0))));
});

