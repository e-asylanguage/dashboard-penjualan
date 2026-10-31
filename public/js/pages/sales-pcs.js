/**
 * Sales › Pcs Terjual: pcs per produk List Produk (Scalev, Shopee, TikTok) dan per CS (Scalev), daftar varian / SKU yang isinya belum diatur, ekspor CSV.
 * Data: /api/report/pcs-terjual. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta rentang() dari script utama (window.*).
 * Dipanggil dari script utama: loadPcsTerjual() (menu Pcs Terjual).
 */
// ---- Pcs Terjual: pcs per produk List Produk (semua channel) dan per CS (Scalev)
let ptData=null,ptBusy=false;
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
  const semua=d.total.reduce((a,t)=>a+t.pcs,0),nOrder=d.total.reduce((a,t)=>a+t.order,0);
  put('ptPeriod','Jumlah barang terjual per produk, semua channel · '+fmtRange(d.from,d.to)+' · '+int(nOrder)+' order');
  put('ptK0',int(semua)+' pcs');put('ptK0D',int(nOrder)+' order · '+ptRata(semua,nOrder)+' pcs/order');
  PT_CH.forEach(([k])=>{const t=tot[k]||{pcs:0,order:0};
    put('ptK'+k,int(t.pcs)+' pcs');put('ptK'+k+'D',int(t.order)+' order · '+ptRata(t.pcs,t.order)+' pcs/order'+(semua?' · '+pct(100*t.pcs/semua):''))});
  const nKurang=d.total.reduce((a,t)=>a+t.order_kurang,0),pcsBelum=d.belum.reduce((a,b)=>a+b.pcs,0);
  $('ptWarn').hidden=!nKurang;
  $('ptWarn').innerHTML=nKurang?'<p>'+int(nKurang)+' order berisi varian / SKU yang isinya belum diatur di <b>Manajemen SKU</b>: '+int(pcsBelum)+' pcs dihitung 1 pcs per qty dan belum masuk tabel Per produk. Daftarnya ada di bawah.</p>':'';
  const totProduk=d.produk.reduce((a,p)=>a+p.total,0);
  $('ptProdukRows').innerHTML=d.produk.length?d.produk.map(p=>'<tr><td class="nm">'+esc(p.nama)+'</td>'+PT_CH.map(([k])=>'<td class="n">'+(p[k]?int(p[k]):ptKosong)+'</td>').join('')+
    '<td class="n"><b>'+int(p.total)+'</b></td><td class="n">'+(totProduk?pct(100*p.total/totProduk):'—')+'</td></tr>').join('')+
    '<tr><td class="nm"><b>Total</b></td>'+PT_CH.map(([k])=>'<td class="n"><b>'+int(d.produk.reduce((a,p)=>a+p[k],0))+'</b></td>').join('')+'<td class="n"><b>'+int(totProduk)+'</b></td><td class="n">100%</td></tr>'
    :'<tr><td colspan="6" style="color:var(--muted)">Belum ada barang terjual pada rentang ini.</td></tr>';
  const pc=ptProdukCs(d);
  $('ptCsHead').innerHTML='<tr><th>CS</th><th class="n">Complete</th><th class="n">Pcs</th><th class="n">Pcs/closing</th>'+pc.map(p=>'<th class="n">'+esc(p.nama)+'</th>').join('')+'</tr>';
  $('ptCsRows').innerHTML=d.per_cs.length?d.per_cs.map(r=>'<tr><td class="nm">'+esc(r.handler_name)+'</td><td class="n">'+int(r.order)+'</td>'+
    '<td class="n"><b>'+int(r.pcs)+'</b>'+(r.kurang?'<small title="Varian belum punya SKU atau SKU-nya belum diisi komposisi List Produk, dihitung 1 pcs per qty">'+int(r.kurang)+' order isi SKU belum diatur</small>':'')+'</td>'+
    '<td class="n">'+ptRata(r.pcs,r.order)+'</td>'+
    pc.map(p=>'<td class="n">'+(r.produk[p.produk_id]?int(r.produk[p.produk_id]):ptKosong)+'</td>').join('')+'</tr>').join('')
    :'<tr><td colspan="'+(4+pc.length)+'" style="color:var(--muted)">Belum ada order Complete pada rentang ini.</td></tr>';
  const lbl=Object.fromEntries(PT_CH);
  $('ptBelumCard').hidden=!d.belum.length;
  $('ptBelumRows').innerHTML=d.belum.map(b=>'<tr><td>'+lbl[b.channel]+'</td><td class="nm">'+esc(b.nama)+'</td><td class="n">'+int(b.order)+'</td><td class="n">'+int(b.pcs)+'</td></tr>').join('');
}
$('ptRange').addEventListener('click',e=>{if(e.target.closest('button'))loadPcsTerjual()});
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

