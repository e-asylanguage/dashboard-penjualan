/**
 * TikTok Shop › Pesanan: kotak status, grafik, tab daftar / toko / kurir / produk / batal, ekspor CSV. Data: /api/tiktok/*.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, tiktok-bersama.js, serta rentang(), tkPasangPilih(), spAlasan(), spBatalGrup() dari script utama (window.*).
 * Dipanggil dari script utama: loadTtPesanan() (menu Pesanan); tpData dibaca saat Buat SKU otomatis.
 */
let tpData=null,tpBusy=false,tpGrup='',tpTab='daftar',tpOffset=0,tpRows=[],tpTotal=0,tpChart=null,tpCariT=null;
const tpQuery=()=>{const r=rentang('tpRange'),q=new URLSearchParams({from:r.from,to:r.to});if($('tpChannel').value)q.set('channel',$('tpChannel').value);if($('tpToko').value)q.set('toko',$('tpToko').value);return q};
async function loadTtPesanan(){
  if(tpBusy)return;tpBusy=true;
  try{
    const [d,t]=await Promise.all([api('/api/tiktok/pesanan?'+tpQuery()),api('/api/tiktok/toko')]);
    tpData=d;ttToko=t;renderTtPesanan();ttTkMuat('tp');await tpMuatDaftar(false);
  }catch(e){$('tpIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{tpBusy=false}
}
function renderTtPesanan(){
  const d=tpData,g={};for(const s of d.status)g[s.grup]=s;
  const n=k=>(g[k]&&g[k].n)||0,total=d.status.reduce((a,s)=>a+s.n,0),aktif=total-n('batal')-n('belum_bayar');
  const laku=d.status.filter(s=>s.grup!=='batal'&&s.grup!=='belum_bayar'),omzet=laku.reduce((a,s)=>a+(s.nilai||0),0);
  const pcsIsi=(d.per_sku||[]).reduce((a,s)=>a+(s.qty||0)*(s.isi_pcs||1),0),src=Object.fromEntries((d.sumber||[]).map(s=>[s.sumber,s.n]));
  put('tpPeriod','Pesanan dibuat '+fmtRange(d.from,d.to)+' · '+int(total)+' pesanan · omzet '+rpFull(omzet)+' · '+int(pcsIsi)+' pcs'+(n('belum_bayar')?' · '+int(n('belum_bayar'))+' belum dibayar':'')+
    ' · '+int(src.api||0)+' dari API, '+int(src.file||0)+' dari file'+ttSinkronTeks(d.sinkron));
  put('tpK1',int(n('perlu_dikirim')));put('tpK1D',int((g.perlu_dikirim&&g.perlu_dikirim.pcs)||0)+' qty · '+lpPct(n('perlu_dikirim'),aktif)+' dari pesanan aktif');
  put('tpK2',int(n('dikirim')));put('tpK2D',int((g.dikirim&&g.dikirim.pcs)||0)+' qty · '+lpPct(n('dikirim'),aktif)+' dari pesanan aktif');
  put('tpK3',int(n('terkirim')));put('tpK3D',lpPct(n('terkirim'),aktif)+' dari pesanan aktif · '+rpFull((g.terkirim&&g.terkirim.nilai)||0));
  put('tpK4',int(n('batal')));put('tpK4D',lpPct(n('batal'),total)+' dari pesanan masuk · '+rpFull((g.batal&&g.batal.nilai)||0));
  put('tpK5',int(n('retur')));put('tpK5D',lpPct(n('retur'),aktif)+' dari pesanan aktif');
  const tk=(ttToko&&ttToko.toko)||[],tanpaSku=(d.per_sku||[]).filter(s=>!s.sku_id),w=[];
  if(!tk.length)w.push('Belum ada toko TikTok Shop — tambahkan di <b>Pengaturan › Toko Marketplace</b>.');
  const tg=tk.filter(t=>!t.gudang_id);if(tg.length)w.push('Gudang belum ditentukan untuk: <b>'+tg.map(t=>esc(t.nama)).join(', ')+'</b> — atur di tabel Toko TikTok Shop di bawah.');
  if(tanpaSku.length)w.push(int(tanpaSku.length)+' SKU belum ada di <b>Manajemen SKU</b> ('+tanpaSku.slice(0,6).map(s=>esc(s.sku||'(kosong)')).join(', ')+(tanpaSku.length>6?', …':'')+') — HPP &amp; stoknya belum terhitung. Lihat tab <b>Per produk</b>.');
  $('tpWarn').hidden=!w.length;$('tpWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  put('tpTabSku',tanpaSku.length?String(tanpaSku.length):'');
  tpGambar();tpRenderToko();tpRenderTab();
}
function tpGambar(){
  if(typeof Chart==='undefined')return;
  const d=tpData,hari=[];for(let t=d.from;t<=d.to&&hari.length<400;t=shift(t,1))hari.push(t);
  const per=new Map();for(const r of d.harian)per.set(r.tgl+'|'+r.grup,r.n);
  const seri=[['terkirim','--rev'],['dikirim','--info'],['perlu_dikirim','--spend'],['retur','--pb'],['batal','--loss']];
  const labels=hari.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const data=seri.map(([k])=>hari.map(t=>per.get(t+'|'+k)||0));
  if(tpChart){tpChart.data.labels=labels;data.forEach((x,i)=>tpChart.data.datasets[i].data=x);tpChart.update();return}
  tpChart=new Chart($('tpDaily'),{type:'bar',
    data:{labels,datasets:seri.map(([k,c],i)=>({label:TT_GRUP[k][0],data:data[i],backgroundColor:css(c)||css('--muted'),borderRadius:3,stack:'s'}))},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{precision:0}}}}});
}
function tpRenderToko(){
  const gd=(ttToko&&ttToko.gudang)||[];
  $('tpTokoIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl" data-dt="off"><thead><tr><th>Toko</th><th>Sumber data</th><th>Gudang</th><th class="n">Pesanan</th><th>Pesanan terakhir</th><th>Upload terakhir</th></tr></thead><tbody>'+
    ((ttToko&&ttToko.toko||[]).map(t=>'<tr><td class="lr-nm"><b>'+esc(t.nama)+'</b>'+(t.shop_id?'<small>shop_id '+esc(t.shop_id)+'</small>':'')+'</td>'+
      '<td>'+(t.mode==='api'?'<span class="tk-src api">⚡ API</span><small class="mm-sub">'+(t.api_akun?'terhubung · '+esc(t.api_akun):'belum terhubung — hubungkan di Pengaturan')+'</small>':'<span class="tk-src up">⬆ Upload manual</span>')+'</td>'+
      '<td><select class="gd-pilih" data-tt-gudang="'+t.id+'" data-nama="'+esc(t.nama)+'"><option value="">— pilih gudang —</option>'+gd.map(g=>'<option value="'+g.id+'"'+(g.id===t.gudang_id?' selected':'')+'>'+esc(g.nama)+'</option>').join('')+'</select></td>'+
      '<td class="n">'+int(t.pesanan)+'</td><td>'+ttWkt(t.pesanan_terakhir)+'</td><td>'+(t.upload_terakhir?tglWib(t.upload_terakhir,true):'—')+'</td></tr>').join('')||
      ttKosong(6,'Belum ada toko — tambahkan di Pengaturan › Toko Marketplace.'))+'</tbody></table>';
}
async function tpMuatDaftar(tambah){
  if(!tambah){tpRows=[];tpTotal=0}
  const q=tpQuery();if(tpGrup)q.set('grup',tpGrup);const c=$('tpCari').value.trim();if(c)q.set('q',c);q.set('offset',String(tpRows.length));
  const d=await api('/api/tiktok/pesanan/daftar?'+q);
  tpRows=tpRows.concat(d.rows);tpTotal=d.total;
  if(tpTab==='daftar')tpRenderTab();
}
function tpRenderTab(){
  const d=tpData;if(!d)return;
  $('tpTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tpTab));
  $('tpCariWrap').hidden=tpTab!=='daftar';$('tpMore').hidden=true;
  const banyakToko=((ttToko&&ttToko.toko)||[]).length>1;
  if(tpTab==='daftar'){
    const g={};for(const s of d.status)g[s.grup]=s.n;const total=d.status.reduce((a,s)=>a+s.n,0);
    const chip=(k,l,n)=>'<button data-grup="'+k+'"'+(tpGrup===k?' class="on"':'')+'>'+l+' <small>'+int(n)+'</small></button>';
    $('tpSub').innerHTML='<span class="ob-mini">'+chip('','Semua',total)+chip('perlu_dikirim','Perlu dikirim',g.perlu_dikirim||0)+chip('dikirim','Dalam perjalanan',g.dikirim||0)+
      chip('terkirim','Terkirim',g.terkirim||0)+chip('batal','Batal',g.batal||0)+chip('retur','Pengembalian',g.retur||0)+(g.belum_bayar?chip('belum_bayar','Belum bayar',g.belum_bayar):'')+'</span>';
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Pesanan</th>'+(banyakToko?'<th>Toko</th>':'')+'<th>Produk</th><th>Kurir / resi</th><th>Dikirim</th><th>Status</th><th class="n">Nilai</th><th>Kota</th></tr></thead><tbody>'+
      (tpRows.map(p=>'<tr><td class="lr-nm"><b>'+esc(p.order_id)+'</b> '+(TT_SUMBER[p.sumber]||'')+'<small>'+ttWkt(p.dibuat)+' · '+esc(p.channel||'TikTok')+'</small></td>'+(banyakToko?'<td>'+esc(p.toko)+'</td>':'')+
        '<td class="sh">'+p.items.map(i=>esc(int(i.qty)+'× '+(i.nama||'?')+(i.variasi&&i.variasi!=='Default'?' ('+i.variasi+')':''))+'<small class="mm-sub">'+esc(i.sku||'tanpa SKU')+'</small>').join('')+'</td>'+
        '<td class="lr-nm">'+esc(p.kurir||'—')+'<small>'+(p.resi?esc(p.resi):'belum ada resi')+'</small></td>'+
        '<td class="lr-nm">'+(p.dikirim?ttWkt(p.dikirim):'—')+(p.terkirim?'<small>sampai '+ttWkt(p.terkirim)+'</small>':'')+'</td>'+
        '<td class="lr-nm">'+ttTag(p.status)+'<small>'+esc(p.status==='batal'&&p.alasan_batal?spAlasan(p.alasan_batal).label:[p.status_asli,p.substatus].filter(Boolean).join(' · '))+'</small></td>'+
        '<td class="n">'+rpFull(p.subtotal)+'<small>'+(p.cod?'COD':esc(p.metode_bayar||''))+'</small></td><td class="lr-nm">'+esc(p.kota||'—')+'<small>'+esc(p.provinsi||'')+'</small></td></tr>').join('')||
        ttKosong(banyakToko?8:7,'Tidak ada pesanan pada rentang / filter ini.'))+'</tbody></table>';
    $('tpMore').hidden=tpRows.length>=tpTotal;put('tpMoreBtn','Tampilkan lebih banyak ('+int(tpTotal-tpRows.length)+' lagi)');
  }else if(tpTab==='toko'){
    put('tpSub','Per toko · pesanan aktif = selain batal & belum bayar · omzet = subtotal produk setelah diskon');
    const nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t]));
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th>Gudang</th><th class="n">Pesanan</th><th class="n">Perlu dikirim</th><th class="n">Dalam perjalanan</th><th class="n">Terkirim</th><th class="n">Batal</th><th class="n">Pengembalian</th><th class="n">Qty</th><th class="n">Omzet</th></tr></thead><tbody>'+
      ((d.per_toko||[]).slice().sort((a,b)=>b.n-a.n).map(r=>{const t=nama.get(r.toko_id)||{};
        return '<tr><td class="nm">'+esc(t.nama||'?')+'</td><td>'+(t.gudang?esc(t.gudang):'<span class="tag warn">belum diatur</span>')+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+int(r.perlu_dikirim)+'</td>'+
          '<td class="n">'+int(r.dikirim)+'</td><td class="n">'+int(r.terkirim)+'</td><td class="n">'+int(r.batal)+'<small>'+lpPct(r.batal,r.n)+'</small></td><td class="n">'+int(r.retur)+'</td>'+
          '<td class="n">'+int(r.pcs)+'</td><td class="n">'+rpFull(r.omzet)+'</td></tr>'}).join('')||ttKosong(10,'Belum ada pesanan pada rentang ini.'))+'</tbody></table>';
  }else if(tpTab==='kurir'){
    put('tpSub','Pesanan aktif per kurir (selain batal & belum bayar)');
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Kurir</th><th class="n">Pesanan</th><th class="n">Perlu dikirim</th><th class="n">Dalam perjalanan</th><th class="n">Terkirim</th><th class="n">Pengembalian</th><th class="n">COD</th></tr></thead><tbody>'+
      ((d.per_kurir||[]).map(r=>'<tr><td class="nm">'+esc(r.kurir)+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+int(r.perlu_dikirim)+'</td><td class="n">'+int(r.dikirim)+'</td>'+
        '<td class="n">'+int(r.terkirim)+'</td><td class="n">'+int(r.retur)+'<small>'+lpPct(r.retur,r.n)+'</small></td><td class="n">'+int(r.cod)+'</td></tr>').join('')||ttKosong(7,'Belum ada pesanan aktif.'))+'</tbody></table>';
  }else if(tpTab==='produk'){
    const belum=(d.per_sku||[]).filter(x=>!x.sku_id&&x.sku).length;
    $('tpSub').innerHTML='Pesanan selain batal &amp; belum bayar · pcs = qty × isi SKU di Manajemen SKU (bonus tidak dihitung) · HPP = qty × HPP SKU saat ini'+
      (belum?' <span class="ob-mini"><button id="tpOtoBtn">Buat SKU otomatis ('+int(belum)+')</button></span>':'');
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>SKU</th><th>Produk</th><th class="n">Pesanan</th><th class="n">Qty</th><th class="n">Pcs</th><th class="n">Omzet</th><th class="n">HPP</th><th class="n">Retur</th><th>Manajemen SKU</th></tr></thead><tbody>'+
      ((d.per_sku||[]).map(s=>'<tr><td class="nm">'+esc(s.sku||'(kosong)')+'</td><td class="lr-nm">'+esc(s.nama||'—')+(s.variasi&&s.variasi!=='Default'?'<small>'+esc(s.variasi)+'</small>':'')+'</td>'+
        '<td class="n">'+int(s.pesanan)+'</td><td class="n">'+int(s.qty)+'</td><td class="n">'+int((s.qty||0)*(s.isi_pcs||1))+'</td><td class="n">'+rpFull(s.omzet)+'</td>'+
        '<td class="n">'+(s.hpp?rpFull(s.qty*s.hpp):'—')+'</td><td class="n">'+int(s.retur)+'</td><td>'+(s.sku_id?esc(s.sku_produk||''):'<span class="tag warn">belum ada</span>')+'</td></tr>').join('')||ttKosong(9,'Belum ada pesanan pada rentang ini.'))+'</tbody></table>';
  }else if(tpTab==='channel'){
    put('tpSub','Pembelian lewat aplikasi TikTok atau Tokopedia');
    const tot=(d.channel||[]).reduce((a,c)=>a+c.n,0);
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Channel</th><th class="n">Pesanan</th><th class="n">Porsi</th><th class="n">Batal</th><th class="n">Omzet</th></tr></thead><tbody>'+
      ((d.channel||[]).map(c=>'<tr><td class="nm">'+esc(c.channel)+'</td><td class="n">'+int(c.n)+'</td><td class="n">'+lpPct(c.n,tot)+'</td><td class="n">'+int(c.batal)+'<small>'+lpPct(c.batal,c.n)+'</small></td><td class="n">'+rpFull(c.omzet)+'</td></tr>').join('')||ttKosong(5,'Belum ada pesanan.'))+'</tbody></table>';
  }else{
    const g=spBatalGrup(d.batal),tot=g.reduce((a,r)=>a+r.n,0),nilai=g.reduce((a,r)=>a+r.nilai,0),maks=Math.max(1,...g.map(r=>r.n));
    const pihak={};for(const r of g)pihak[r.pihak]=(pihak[r.pihak]||0)+r.n;
    put('tpSub',int(tot)+' pesanan batal · nilai '+rpFull(nilai)+(tot?' · '+Object.entries(pihak).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+lpPct(v,tot)).join(' · '):''));
    $('tpIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Alasan pembatalan</th><th>Dibatalkan oleh</th><th class="n">Pesanan</th><th class="n">Porsi</th><th class="n">Nilai pesanan</th></tr></thead><tbody>'+
      (g.map(r=>'<tr><td class="lr-nm">'+esc(r.label)+(r.asli.length?'<small>'+esc(r.asli.join(' · '))+'</small>':'')+
        '<div style="height:4px;margin-top:6px;border-radius:2px;background:var(--line);max-width:260px"><div style="height:4px;border-radius:2px;width:'+(100*r.n/maks)+'%;background:'+(r.pihak==='Penjual'?'var(--loss)':r.pihak==='Pengiriman'?'var(--warn,#F79009)':'var(--info)')+'"></div></div></td>'+
        '<td><span class="tag'+(r.pihak==='Penjual'?' loss':r.pihak==='Pengiriman'?' warn':'')+'">'+esc(r.pihak)+'</span></td>'+
        '<td class="n">'+int(r.n)+'</td><td class="n">'+lpPct(r.n,tot)+'</td><td class="n">'+rpFull(r.nilai)+(r.cod?'<small>'+int(r.cod)+' COD</small>':'')+'</td></tr>').join('')||ttKosong(5,'Tidak ada pesanan batal.'))+'</tbody></table>';
  }
}

// Filter, tab, cari, gudang toko
$('tpRange').addEventListener('click',e=>{if(e.target.closest('button'))loadTtPesanan()});
$('tpChannel').addEventListener('change',loadTtPesanan);
$('tpTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!tpData)return;tpTab=b.dataset.tab;tpRenderTab()});
$('tpSub').addEventListener('click',async e=>{const b=e.target.closest('[data-grup]');if(!b||!tpData)return;tpGrup=b.dataset.grup;try{await tpMuatDaftar(false)}catch(err){alert(err.message)}});
$('tpToko').addEventListener('change',()=>{tpGrup='';loadTtPesanan()});
tkPasangPilih('tp');
$('tpExport').addEventListener('click',async()=>{
  if(!tpData)return;const d=tpData,akhir='-'+d.from+'_'+d.to+'.csv',nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama]));
  if(tpTab==='toko')return unduhCsv('tiktok-per-toko'+akhir,['Toko','Pesanan','Perlu dikirim','Dalam perjalanan','Terkirim','Batal','Pengembalian','Qty','Omzet'],(d.per_toko||[]).map(r=>[nama.get(r.toko_id)||'?',r.n,r.perlu_dikirim,r.dikirim,r.terkirim,r.batal,r.retur,r.pcs,r.omzet]));
  if(tpTab==='kurir')return unduhCsv('tiktok-per-kurir'+akhir,['Kurir','Pesanan','Perlu dikirim','Dalam perjalanan','Terkirim','Pengembalian','COD'],(d.per_kurir||[]).map(r=>[r.kurir,r.n,r.perlu_dikirim,r.dikirim,r.terkirim,r.retur,r.cod]));
  if(tpTab==='produk')return unduhCsv('tiktok-per-produk'+akhir,['SKU','Produk','Variasi','Pesanan','Qty','Pcs','Omzet','HPP','Retur'],(d.per_sku||[]).map(s=>[s.sku,s.nama,s.variasi||'',s.pesanan,s.qty,(s.qty||0)*(s.isi_pcs||1),s.omzet,s.hpp?s.qty*s.hpp:'',s.retur]));
  if(tpTab==='channel')return unduhCsv('tiktok-per-channel'+akhir,['Channel','Pesanan','Batal','Omzet'],(d.channel||[]).map(c=>[c.channel,c.n,c.batal,c.omzet]));
  if(tpTab==='batal')return unduhCsv('tiktok-alasan-batal'+akhir,['Alasan','Dibatalkan oleh','Pesanan','Nilai pesanan','Alasan asli'],spBatalGrup(d.batal).map(r=>[r.label,r.pihak,r.n,r.nilai,r.asli.join(' | ')]));
  try{while(tpRows.length<tpTotal&&tpRows.length<20000)await tpMuatDaftar(true)}catch(err){alert(err.message);return}
  unduhCsv('tiktok-pesanan'+akhir,['Order ID','Toko','Channel','Dibuat','Status','Status TikTok','Alasan batal','Kurir','Resi','Dikirim','Metode bayar','Produk','SKU','Qty','Subtotal','Total dibayar','Kota','Provinsi','Sumber'],
    tpRows.map(p=>[p.order_id,p.toko,p.channel||'TikTok',p.dibuat,(TT_GRUP[p.status==='selesai'?'terkirim':p.status]||TT_GRUP.lain)[0],[p.status_asli,p.substatus].filter(Boolean).join(' · '),p.alasan_batal||'',p.kurir||'',p.resi||'',p.dikirim||'',p.metode_bayar||'',
      p.items.map(i=>i.qty+'x '+i.nama+(i.variasi&&i.variasi!=='Default'?' ('+i.variasi+')':'')).join(' + '),p.items.map(i=>i.sku||'').join(' + '),p.pcs,p.subtotal,p.total,p.kota||'',p.provinsi||'',p.sumber]));
});
$('tpCari').addEventListener('input',()=>{clearTimeout(tpCariT);tpCariT=setTimeout(()=>tpMuatDaftar(false),350)});
$('tpMoreBtn').addEventListener('click',()=>tpMuatDaftar(true));
$('tpTokoIsi').addEventListener('change',async e=>{
  const s=e.target.closest('[data-tt-gudang]');if(!s)return;
  try{await api('/api/tiktok/toko',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(s.dataset.ttGudang),nama:s.dataset.nama,gudang_id:s.value?Number(s.value):null})});
    ttToko=null;loadTtPesanan()}catch(err){alert('Gagal menyimpan gudang: '+err.message)}
});
