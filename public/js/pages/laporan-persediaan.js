/**
 * Laporan › Nilai Persediaan: stok gudang sendiri × HPP terkini (dihitung sama dengan menu Stok) + sisa Inbound REQ di jalan + utang supplier, ekspor CSV. Data: /api/report/stok, /api/settings/req.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, rqLanded() dari inventory-req.js, serta stHitung(), stTanpaAwal(), stBelum(), belumPesan() dari script utama (window.*).
 * Dipanggil dari script utama: loadPersediaan().
 */
let npData=null,npBusy=false;
async function loadPersediaan(){
  if(npBusy)return;npBusy=true;
  try{
    const [st,rq]=await Promise.all([api('/api/report/stok'),api('/api/settings/req')]);
    stHitung(st);npData=npSiapkan(st,rq);renderPersediaan();
  }catch(e){$('npStok').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{npBusy=false}
}
function npSiapkan(st,rq){
  const prd=new Map(rq.produk.map(p=>[p.id,p])),gd=new Map(rq.gudang.map(g=>[g.id,g])),jalan=[],utang=new Map();
  for(const r of rq.rows){
    if(r.status==='batal')continue;
    const diterima=i=>r.terima.filter(x=>x.item_id===i.id).reduce((a,x)=>a+x.qty_baik+x.qty_rusak,0);
    if(r.status==='dikirim'||r.status==='sebagian'){
      let pcs=0,nilai=0;
      for(const i of r.items){const sisa=Math.max(0,i.qty-diterima(i));pcs+=sisa;nilai+=sisa*rqLanded(r,i)}
      if(pcs)jalan.push({nomor:r.nomor,supplier:r.supplier,eta:r.eta,gudang:(gd.get(r.gudang_id)||{}).nama||'?',isi:r.items.map(i=>(prd.get(i.produk_id)||{}).nama||'?').join(', '),pcs,nilai});
    }
    const tagihan=r.tagihan!=null?r.tagihan:r.items.reduce((a,i)=>a+i.harga*diterima(i),0),bayar=r.bayar.reduce((a,b)=>a+b.jumlah,0),sisa=Math.max(0,tagihan-bayar);
    if(sisa>0){const u=utang.get(r.supplier)||{supplier:r.supplier,req:[],tagihan:0,bayar:0,sisa:0};u.req.push(r.nomor);u.tagihan+=tagihan;u.bayar+=bayar;u.sisa+=sisa;utang.set(r.supplier,u)}
  }
  return {st,stok:st.stok.filter(s=>s.stok>0).sort((a,b)=>b.nilai-a.nilai),minus:st.stok.filter(s=>s.stok<0),
    jalan:jalan.sort((a,b)=>b.nilai-a.nilai),utang:[...utang.values()].sort((a,b)=>b.sisa-a.sisa)};
}
function renderPersediaan(){
  const d=npData,jml=(a,k)=>a.reduce((s,x)=>s+x[k],0),nStok=jml(d.stok,'nilai'),nJalan=jml(d.jalan,'nilai'),nUtang=jml(d.utang,'sisa');
  put('npPeriod','Nilai barang per '+tglWib(new Date())+' · stok × HPP List Produk terkini');
  put('npK1',rpFull(nStok));put('npK1D',int(jml(d.stok,'stok'))+' pcs · '+int(d.stok.length)+' produk × gudang');
  put('npK2',rpFull(nJalan));put('npK2D',int(jml(d.jalan,'pcs'))+' pcs · '+int(d.jalan.length)+' REQ belum diterima penuh');
  put('npK3',rpFull(nStok+nJalan));put('npK3D','stok di gudang + barang dalam perjalanan');
  put('npK4',rpFull(nUtang));put('npK4D',d.utang.length?int(d.utang.length)+' supplier belum lunas':'semua tagihan lunas');
  const w=[],st=d.st,tanpaAwal=stTanpaAwal(st).map(g=>g.nama);
  if(tanpaAwal.length)w.push('Stok awal belum diisi untuk <b>'+tanpaAwal.map(esc).join(', ')+'</b> — nilai stok belum benar. Isi di <b>Inventory › Stok</b>.');
  if(d.minus.length)w.push(int(d.minus.length)+' produk × gudang stoknya minus ('+d.minus.map(s=>esc(s.produk.nama)+' '+int(s.stok)).join(', ')+') — dihitung 0; cek stok awal / opname.');
  if(st.warn.belum)w.push(...belumPesan(stBelum(st.warn),'jadi belum mengurangi stok'));
  if(d.stok.some(s=>!s.produk.hpp))w.push('Ada produk tanpa HPP di List Produk — nilainya dihitung 0.');
  $('npWarn').hidden=!w.length;$('npWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  const kosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+t+'</td></tr>';
  $('npStok').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Produk</th><th>Gudang</th><th class="n">Stok</th><th class="n">HPP terkini</th><th class="n">Nilai</th><th class="n">Porsi</th></tr></thead><tbody>'+
    (d.stok.map(s=>'<tr><td class="nm">'+esc(s.produk.nama)+'</td><td>'+esc(s.gudang.nama)+'</td><td class="n">'+int(s.stok)+' pcs</td><td class="n">'+rpFull(s.produk.hpp||0)+'</td><td class="n">'+rpFull(s.nilai)+'</td><td class="n">'+lpPct(s.nilai,nStok)+'</td></tr>').join('')||kosong(6,'Belum ada stok tercatat.'))+'</tbody>'+
    (d.stok.length?'<tfoot><tr class="lr-akhir"><td colspan="2">Total</td><td class="n">'+int(jml(d.stok,'stok'))+' pcs</td><td></td><td class="n">'+rpFull(nStok)+'</td><td></td></tr></tfoot>':'')+'</table>';
  $('npJalan').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>REQ</th><th>Gudang</th><th class="n">Sisa</th><th class="n">Nilai</th></tr></thead><tbody>'+
    (d.jalan.map(j=>'<tr><td class="lr-nm"><b>'+esc(j.nomor)+'</b><small>'+esc(j.supplier)+' · '+esc(j.isi)+(j.eta?' · ETA '+esc(tglWib(j.eta+'T12:00:00Z')):'')+'</small></td><td>'+esc(j.gudang)+'</td><td class="n">'+int(j.pcs)+' pcs</td><td class="n">'+rpFull(j.nilai)+'</td></tr>').join('')||kosong(4,'Tidak ada barang dalam perjalanan.'))+'</tbody></table>';
  $('npUtang').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Supplier</th><th class="n">Tagihan</th><th class="n">Dibayar</th><th class="n">Sisa</th></tr></thead><tbody>'+
    (d.utang.map(u=>'<tr><td class="lr-nm"><b>'+esc(u.supplier)+'</b><small>'+u.req.map(esc).join(', ')+'</small></td><td class="n">'+rpFull(u.tagihan)+'</td><td class="n">'+rpFull(u.bayar)+'</td><td class="n"><span class="lr-neg">'+rpFull(u.sisa)+'</span></td></tr>').join('')||kosong(4,'Tidak ada utang supplier.'))+'</tbody></table>';
}
$('npExport').addEventListener('click',()=>{
  if(!npData)return;
  unduhCsv('nilai-persediaan-'+ymd(new Date())+'.csv',['Jenis','Nama','Gudang / supplier','Pcs','HPP / harga','Nilai'],
    [...npData.stok.map(s=>['Stok gudang',s.produk.nama,s.gudang.nama,s.stok,s.produk.hpp||0,Math.round(s.nilai)]),
     ...npData.jalan.map(j=>['Dalam perjalanan',j.nomor+' · '+j.isi,j.supplier,j.pcs,'',Math.round(j.nilai)]),
     ...npData.utang.map(u=>['Utang supplier',u.req.join(' '),u.supplier,'','',-Math.round(u.sisa)])]);
});
