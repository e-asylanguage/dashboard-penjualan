/**
 * Inventory › Outbound: barang keluar dari paket Mengantar & pesanan marketplace yang sudah dijemput kurir — kotak status, grafik harian,
 * tab per produk / gudang / matriks / rincian resi (kondisi paket kembali), ekspor CSV. Data: /api/report/outbound, /api/report/outbound/kondisi.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*):
 * rentang(), bukaView(), pecahPaket(), belumTag(), belumPesan(), belumDari(), resiPaket(), cocokResi(), gdPersen(), gdTag(), GD_JENIS.
 * Dipanggil dari script utama: loadOutbound() (menu Outbound).
 */
// ---- Inventory › Outbound: barang keluar dari paket Mengantar yang sudah dijemput kurir.
// Isi paket = nama barang Mengantar → SKU × qty (Data Produk › SKU Mengantar) → isi SKU dari List Produk.
// Biaya gudang dihitung sekali per paket. Paket kembali bisa ditandai baik / rusak / hilang.
let obData=null,obBusy=false,obTab='produk',obBatas=200,obChart=null;
const OB_ST={DELIVERED:'terkirim',ON_GOING:'jalan',RTS:'kembali',LOST:'kembali'};
const OB_ST_LBL={terkirim:['Terkirim','rev'],jalan:['Dalam perjalanan','info'],kembali:['Kembali','loss']};
const OB_KONDISI={baik:'Kembali baik',rusak:'Rusak',hilang:'Hilang'};
const OB_BELUM='x';                       // kunci produk/gudang yang belum dipasangkan

async function loadOutbound(){
  if(obBusy)return;obBusy=true;
  const r=rentang('obRange');
  try{obSiapkan(await api('/api/report/outbound?'+new URLSearchParams({from:r.from,to:r.to})));renderOutbound()}
  catch(e){$('obIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{obBusy=false}
}

/** Pecah tiap paket ke produk + pcs, status, kondisi, HPP keluar, dan biaya gudang */
function obSiapkan(d){
  pecahPaket(d);
  // Paket yang belum dijemput kurir hanya tampil di kartu Pending Pickup, tidak dihitung barang keluar
  d.pending=d.rows.filter(x=>x.pending);d.rows=d.rows.filter(x=>!x.pending);
  for(const x of d.rows){
    x.picked=/PICK/i.test(x.status_mg||'');
    x.masalah=/UNDELIVERED|PROBLEM/i.test(x.status_mg||'');
    x.status=OB_ST[x.st]||'jalan';
    x.kond=x.status==='kembali'?(x.kondisi||(x.st==='LOST'?'hilang':'baik')):null;
    x.biaya=x.g?(x.g.biaya_penanganan||0)+(x.g.biaya_lain||0):0;
    x.tgl=ymd(new Date(x.created_at));
  }
  obData=d;
  // Pilihan filter gudang & produk dari data yang ada; pilihan aktif dipertahankan
  const isiSel=(id,semua,opsi)=>{const sel=$(id),v=sel.value;
    sel.innerHTML='<option value="">'+semua+'</option>'+opsi.map(([k,l])=>'<option value="'+esc(k)+'"'+(k===v?' selected':'')+'>'+esc(l)+'</option>').join('')};
  isiSel('obGudang','Semua gudang',[...d.gudang.map(g=>[String(g.id),g.nama]),[OB_BELUM,'Gudang belum dipasangkan']]);
  const pk=new Map();for(const x of d.rows)for(const i of x.isi)pk.set(i.key,i.nama);
  isiSel('obProduk','Semua produk',[...[...pk].sort((a,b)=>a[1].localeCompare(b[1],'id')),[OB_BELUM,'Barang belum dipasangkan']]);
}

/** Paket sesuai filter jenis gudang / gudang / produk (bawaan: paket yang sudah dijemput kurir) */
function obSaring(list){
  const j=$('obJenis').value,g=$('obGudang').value,p=$('obProduk').value;
  return (list||obData.rows).filter(x=>(!j||(x.g&&x.g.jenis===j))&&(!g||(g===OB_BELUM?!x.g:x.g&&String(x.g.id)===g))&&
    (!p||(p===OB_BELUM?x.belum:x.isi.some(i=>i.key===p))));
}
/** Pcs paket; bila filter produk aktif hanya pcs produk itu */
const obPcs=x=>{const p=$('obProduk').value;return p&&p!==OB_BELUM?x.isi.filter(i=>i.key===p).reduce((a,i)=>a+i.pcs,0):x.pcs};

function renderOutbound(){
  const d=obData,rows=obSaring(),r=rentang('obRange');
  const t={paket:0,pcs:0,biaya:0,hpp:0,terkirim:0,picked:0,jalan:0,kembali:0,pT:0,pP:0,pJ:0,pK:0,pM:0,baik:0,rusak:0,hilang:0};
  for(const x of rows){
    const n=obPcs(x);t.paket++;t.pcs+=n;t.biaya+=x.biaya;t.hpp+=x.hppKeluar;
    // Shipment Picked dipisah dari Paket Dijalan (tabel & grafik tetap menggabungkannya sebagai "Dalam perjalanan")
    const k=x.status==='jalan'&&x.picked?'picked':x.status;t[k]+=n;
    t[{terkirim:'pT',picked:'pP',jalan:'pJ',kembali:'pK'}[k]]++;
    if(k==='jalan'&&x.masalah)t.pM++;
    if(x.kond)t[x.kond]+=n;
  }
  const pend=obSaring(d.pending),pendPcs=pend.reduce((a,x)=>a+obPcs(x),0);
  const nMp=rows.filter(x=>x.mp).length;
  put('obPeriod','Paket Mengantar & pesanan marketplace '+fmtRange(d.from,d.to)+(nMp?' ('+int(nMp)+' pesanan Shopee / TikTok)':'')+' · keluar (sudah dijemput kurir) '+int(t.pcs)+' pcs dari '+int(t.paket)+' paket · HPP '+rpFull(t.hpp)+' · biaya gudang '+rpFull(t.biaya)+shSync(d));
  put('obK1',int(pendPcs)+' pcs');put('obK1D',int(pend.length)+' paket belum dijemput kurir · belum dihitung keluar');
  put('obK2',int(t.picked)+' pcs');put('obK2D',int(t.pP)+' paket baru dijemput kurir');
  put('obK3',int(t.jalan)+' pcs');put('obK3D',int(t.pJ)+' paket di kurir'+(t.pM?' · '+int(t.pM)+' bermasalah':''));
  put('obK4',int(t.terkirim)+' pcs');put('obK4D',int(t.pT)+' paket · '+gdPersen(t.pT,t.paket)+' dari paket keluar');
  put('obK5',int(t.kembali)+' pcs');put('obK5D',int(t.pK)+' paket · baik '+int(t.baik)+' · rusak '+int(t.rusak)+' · hilang '+int(t.hilang)+' pcs');
  // Peringatan data yang belum dipasangkan
  const nb=rows.filter(x=>x.belum).length,ng=rows.filter(x=>!x.g).length,w=[];
  if(nb)w.push(...belumPesan(belumDari(rows.filter(x=>x.belum)),'jadi pcs & HPP-nya belum terhitung'));
  if(ng)w.push(int(ng)+' paket dikirim dari gudang yang belum dipasangkan di Inventory › List Gudang (biaya gudang belum terhitung).');
  $('obWarn').hidden=!w.length;$('obWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  put('obTabBelum',obData.rows.some(x=>x.belum)?String(new Set(obData.rows.filter(x=>x.belum).map(x=>x.goods.toLowerCase())).size):'');
  obGrafik(rows,d.from,d.to);
  obRenderTab();
}

function obGrafik(rows,from,to){
  if(typeof Chart==='undefined')return;
  const tgl=[];for(let t=from;t<=to&&tgl.length<400;t=shift(t,1))tgl.push(t);
  const idx=new Map(tgl.map((t,i)=>[t,i])),seri={terkirim:tgl.map(()=>0),jalan:tgl.map(()=>0),kembali:tgl.map(()=>0)};
  for(const x of rows){const i=idx.get(x.tgl);if(i!=null)seri[x.status][i]+=obPcs(x)}
  const labels=tgl.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const data=[seri.terkirim,seri.jalan,seri.kembali];
  if(obChart){obChart.data.labels=labels;data.forEach((x,i)=>obChart.data.datasets[i].data=x);obChart.update();return}
  const line=css('--line');
  obChart=new Chart($('obDaily'),{type:'bar',
    data:{labels,datasets:[
      {label:'Terkirim',data:data[0],backgroundColor:css('--rev'),borderRadius:3,stack:'s'},
      {label:'Dalam perjalanan',data:data[1],backgroundColor:css('--info'),borderRadius:3,stack:'s'},
      {label:'Kembali',data:data[2],backgroundColor:css('--loss'),borderRadius:3,stack:'s'}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:10}},y:{stacked:true,grid:{color:line},border:{display:false},beginAtZero:true,ticks:{precision:0}}}}});
}

/** Ringkasan per kunci (produk / gudang) */
function obKelompok(rows,kunci){
  const m=new Map();
  for(const x of rows)for(const [k,nama,pcs,hpp] of kunci(x)){
    const t=m.get(k)||{k,nama,paket:new Set(),pcs:0,terkirim:0,jalan:0,kembali:0,baik:0,rusak:0,hilang:0,hpp:0,biaya:0,pT:0,pK:0,x};
    if(!t.paket.has(x.receipt)){t.paket.add(x.receipt);t.biaya+=x.biaya;if(x.status==='terkirim')t.pT++;if(x.status==='kembali')t.pK++}
    t.pcs+=pcs;t[x.status]+=pcs;if(x.kond)t[x.kond]+=pcs;t.hpp+=hpp;m.set(k,t);
  }
  return [...m.values()].sort((a,b)=>b.pcs-a.pcs||b.paket.size-a.paket.size);
}
const obKunciProduk=x=>{const p=$('obProduk').value;
  return x.belum?[[OB_BELUM,'Barang belum dipasangkan',0,0]]:x.isi.filter(i=>!p||p===OB_BELUM||i.key===p).map(i=>[i.key,i.nama,i.pcs,i.pcs*i.hpp])};
const obKunciGudang=x=>[[x.g?'g'+x.g.id:'s:'+x.shipper,x.g?x.g.nama:x.shipper,obPcs(x),x.hppKeluar]];

function obRenderTab(){
  const rows=obSaring(),q=$('obCari').value.trim().toLowerCase(),kosong=n=>'<tr><td colspan="'+n+'" style="color:var(--muted)">Tidak ada data pada rentang / filter ini.</td></tr>';
  $('obTab').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===obTab));
  $('obCari').placeholder={produk:'Cari produk…',gudang:'Cari gudang…',matriks:'Cari produk…',resi:'Cari resi / barang…'}[obTab];
  $('obMore').hidden=true;
  const kembaliTeks=t=>int(t.kembali)+(t.kembali?'<small>baik '+int(t.baik)+' · rusak '+int(t.rusak)+' · hilang '+int(t.hilang)+'</small>':'');
  if(obTab==='produk'){
    const g=obKelompok(rows,obKunciProduk).filter(t=>!q||t.nama.toLowerCase().includes(q));
    put('obSub','Pcs = qty SKU per paket × isi produk SKU · % RTS = pcs kembali ÷ pcs keluar · HPP keluar = pcs × HPP List Produk');
    $('obIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Produk</th><th class="n">Paket</th><th class="n">Pcs keluar</th><th class="n">Terkirim</th><th class="n">Dalam perjalanan</th><th class="n">Kembali</th><th class="n">% RTS</th><th class="n">HPP keluar</th></tr></thead><tbody>'+
      (g.map(t=>t.k===OB_BELUM
        ?'<tr><td class="nm"><span class="tag warn">Barang belum dipasangkan</span></td><td class="n">'+int(t.paket.size)+'</td><td class="n" colspan="6" style="color:var(--muted);text-align:left">Pcs belum bisa dihitung — pasangkan nama barangnya ke SKU di Data Produk › SKU Mengantar</td></tr>'
        :'<tr><td class="nm">'+esc(t.nama)+'</td><td class="n">'+int(t.paket.size)+'</td><td class="n"><b>'+int(t.pcs)+'</b></td><td class="n">'+int(t.terkirim)+'</td><td class="n">'+int(t.jalan)+'</td>'+
          '<td class="n">'+kembaliTeks(t)+'</td><td class="n">'+gdPersen(t.kembali,t.pcs)+'</td><td class="n">'+rpFull(t.hpp)+'</td></tr>').join('')||kosong(8))+'</tbody></table>';
  }else if(obTab==='gudang'){
    const g=obKelompok(rows,obKunciGudang).filter(t=>!q||t.nama.toLowerCase().includes(q));
    put('obSub','Biaya gudang = paket × (biaya penanganan + biaya lain) di List Gudang, sekali per paket');
    $('obIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Gudang</th><th>Jenis</th><th class="n">Paket</th><th class="n">Pcs keluar</th><th class="n">Terkirim</th><th class="n">RTS</th><th class="n">Biaya gudang</th><th class="n">HPP keluar</th></tr></thead><tbody>'+
      (g.map(t=>{const gd=t.x.g;
        return '<tr><td class="nm">'+esc(t.nama)+(gd?'':'<small>nama pengirim Mengantar · belum dipasangkan di List Gudang</small>')+'</td><td>'+(gd?gdTag(gd.jenis):'<span class="tag warn">Belum dipasangkan</span>')+'</td>'+
          '<td class="n">'+int(t.paket.size)+'</td><td class="n"><b>'+int(t.pcs)+'</b></td><td class="n">'+int(t.pT)+'<small>'+gdPersen(t.pT,t.paket.size)+'</small></td>'+
          '<td class="n">'+int(t.pK)+'<small>'+gdPersen(t.pK,t.paket.size)+'</small></td><td class="n">'+rpFull(t.biaya)+'</td><td class="n">'+rpFull(t.hpp)+'</td></tr>'}).join('')||kosong(8))+'</tbody></table>';
  }else if(obTab==='matriks'){
    const gd=obKelompok(rows,obKunciGudang).slice(0,12),pr=obKelompok(rows,obKunciProduk).filter(t=>t.k!==OB_BELUM&&(!q||t.nama.toLowerCase().includes(q)));
    const sel=new Map();
    for(const x of rows){const kg=obKunciGudang(x)[0][0];for(const [kp,,pcs] of obKunciProduk(x)){const k=kp+'|'+kg;sel.set(k,(sel.get(k)||0)+pcs)}}
    put('obSub','Pcs keluar per produk dari tiap gudang'+(gd.length>=12?' · 12 gudang dengan pcs terbanyak':''));
    $('obIsi').innerHTML=pr.length?'<table class="sku-tbl gd-tbl"><thead><tr><th>Produk</th>'+gd.map(g=>'<th class="n">'+esc(g.nama)+'</th>').join('')+'<th class="n">Total</th></tr></thead><tbody>'+
      pr.map(p=>'<tr><td class="nm">'+esc(p.nama)+'</td>'+gd.map(g=>{const v=sel.get(p.k+'|'+g.k)||0;return '<td class="n">'+(v?int(v):'<span style="color:var(--muted)">—</span>')+'</td>'}).join('')+'<td class="n"><b>'+int(p.pcs)+'</b></td></tr>').join('')+
      '</tbody></table>':'<p style="color:var(--muted)">Belum ada produk terhitung — pasangkan nama barang ke SKU dulu.</p>';
  }else if(obTab==='resi'){
    const list=rows.filter(x=>!q||cocokResi(x,q)||x.goods.toLowerCase().includes(q)),tampil=list.slice(0,obBatas);
    put('obSub',int(list.length)+' paket · kondisi bisa diubah untuk paket yang kembali (RTS) atau hilang · modal = HPP keluar + biaya gudang');
    $('obIsi').innerHTML='<table class="sku-tbl gd-tbl"><thead><tr><th>Tanggal</th><th>Resi</th><th>Gudang</th><th>Barang</th><th>Status</th><th>Kondisi</th><th class="n">Modal</th></tr></thead><tbody>'+
      (tampil.map(x=>'<tr><td>'+tglWib(x.created_at,true)+'</td><td class="sd-resi">'+resiPaket(x)+'<small class="mm-sub">'+esc(x.courier||'')+'</small></td>'+
        '<td>'+(x.g?esc(x.g.nama):'<span style="color:var(--muted)">'+esc(x.shipper)+'</span>')+'</td>'+
        '<td class="sh">'+esc(x.goods)+'<small class="mm-sub">'+(x.belum?belumTag(x):esc(x.isi.map(i=>i.pcs+'× '+i.nama).join(' + ')))+'</small></td>'+
        '<td><span class="tag '+OB_ST_LBL[x.status][1]+'">'+(x.st==='LOST'?'Hilang di kurir':OB_ST_LBL[x.status][0])+'</span></td>'+
        '<td>'+(x.kond?'<div class="ob-kond"><select data-kond="'+esc(x.receipt)+'" class="gd-pilih">'+Object.entries(OB_KONDISI).map(([k,l])=>'<option value="'+k+'"'+(k===x.kond?' selected':'')+'>'+l+'</option>').join('')+'</select>'+
          '<input data-cat="'+esc(x.receipt)+'" value="'+esc(x.catatan||'')+'" placeholder="Catatan…" maxlength="200"></div>':'<span style="color:var(--muted)">—</span>')+'</td>'+
        '<td class="n">'+(x.belum?'<span style="color:var(--muted)">—</span>':rpFull(x.hppKeluar+x.biaya))+(x.biaya?'<small>gudang '+rpFull(x.biaya)+'</small>':'')+'</td></tr>').join('')||kosong(7))+'</tbody></table>';
    $('obMore').hidden=list.length<=obBatas;$('obMoreBtn').textContent='Tampilkan lebih banyak ('+int(Math.max(0,list.length-obBatas))+' lagi)';
  }
}

$('obRange').addEventListener('click',e=>{if(e.target.closest('button'))loadOutbound()});
['obJenis','obGudang','obProduk'].forEach(id=>$(id).addEventListener('change',()=>{if(obData){obBatas=200;renderOutbound()}}));
$('obTab').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  // Pasangan nama barang → SKU dikelola di halaman sendiri (Data Produk › SKU Mengantar)
  if(b.dataset.tab==='barang'){bukaView('skumg');return}
  obTab=b.dataset.tab;obBatas=200;$('obCari').value='';
  if(obData)obRenderTab();
});
$('obCari').addEventListener('input',()=>{obBatas=200;if(obData)obRenderTab()});
$('obMoreBtn').addEventListener('click',()=>{obBatas+=200;obRenderTab()});
$('obIsi').addEventListener('change',async e=>{
  const k=e.target.closest('[data-kond]'),c=e.target.closest('[data-cat]');if(!k&&!c)return;
  const resi=(k||c).dataset.kond||(k||c).dataset.cat,x=obData.rows.find(r=>r.receipt===resi);if(!x)return;
  const box=(k||c).closest('.ob-kond'),kond=box.querySelector('select').value,cat=box.querySelector('input').value.trim();
  try{
    await api('/api/report/outbound/kondisi',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt:resi,kondisi:kond,catatan:cat})});
    x.kondisi=kond;x.kond=kond;x.catatan=cat;renderOutbound();
  }catch(err){alert('Gagal menyimpan kondisi: '+err.message)}
});
$('obExport').addEventListener('click',()=>{
  if(!obData)return;
  const rows=obSaring(),nm='outbound-'+obTab+'-'+obData.from+'_'+obData.to+'.csv';
  if(obTab==='produk')unduhCsv(nm,['Produk','Paket','Pcs keluar','Terkirim','Dalam perjalanan','Kembali','Kembali baik','Rusak','Hilang','HPP keluar'],
    obKelompok(rows,obKunciProduk).map(t=>[t.nama,t.paket.size,t.pcs,t.terkirim,t.jalan,t.kembali,t.baik,t.rusak,t.hilang,Math.round(t.hpp)]));
  else if(obTab==='gudang'||obTab==='matriks')unduhCsv(nm,['Gudang','Jenis','Paket','Pcs keluar','Paket terkirim','Paket RTS','Biaya gudang','HPP keluar'],
    obKelompok(rows,obKunciGudang).map(t=>[t.nama,t.x.g?(GD_JENIS[t.x.g.jenis]||[t.x.g.jenis])[0]:'Belum dipasangkan',t.paket.size,t.pcs,t.pT,t.pK,t.biaya,Math.round(t.hpp)]));
  else if(obTab==='resi')unduhCsv(nm,['Tanggal dibuat','Resi','Kurir','Gudang','Nama barang','Isi','Pcs','Status','Kondisi','Catatan','HPP keluar','Biaya gudang'],
    rows.map(x=>[x.created_at,x.receipt||'',x.courier||'',x.g?x.g.nama:x.shipper,x.goods,x.isi.map(i=>i.pcs+'x '+i.nama).join(' + '),x.pcs,
      x.st==='LOST'?'Hilang di kurir':OB_ST_LBL[x.status][0],x.kond?OB_KONDISI[x.kond]:'',x.catatan||'',Math.round(x.hppKeluar),x.biaya]));
});
