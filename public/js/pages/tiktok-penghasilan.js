/**
 * TikTok Shop › Penghasilan: dana dilepas & estimasi, rincian biaya, kanal penjualan (Ads / Affiliate / Live), biaya live manual, ekspor CSV. Data: /api/tiktok/*.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, tiktok-bersama.js, serta rentang(), tkPasangPilih(), PH_KANAL, phBagiUnik() dari script utama (window.*).
 * Dipanggil dari script utama: loadTtHasil() (menu Penghasilan).
 */
let thRinciBuka=false,thData=null,thBusy=false,thOffset=0,thRows=[],thCariT=null;
// Basis tanggal: 'dibuat' (tanggal pesanan dibuat + estimasi pesanan yang dananya belum cair) atau 'dilepas' (tanggal dana cair → arus kas)
let thBasis='dibuat';try{if(localStorage.getItem('thBasis')==='dilepas')thBasis='dilepas'}catch(e){}
$('thBasis').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.basis===thBasis);b.onclick=()=>{
  thBasis=b.dataset.basis;try{localStorage.setItem('thBasis',thBasis)}catch(e){}
  $('thBasis').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));loadTtHasil()}});
const thQuery=()=>{const r=rentang('thRange'),q=new URLSearchParams({from:r.from,to:r.to,basis:thBasis});if($('thToko').value)q.set('toko',$('thToko').value);return q};
/**
 * Estimasi pesanan yang dananya belum cair (basis tanggal dibuat): subtotal pesanan × rasio komponen settlement terhadap subtotal pesanan
 * yang sudah cair di rentang (acuan 60 hari bila belum ada yang cair). Penyesuaian tidak diestimasi. null = basis tanggal cair.
 */
let thEst=null;
function thEstimasi(d){
  if(d.basis!=='dibuat')return null;
  const bl=(d.belum_cair||[]).reduce((a,r)=>({n:a.n+r.n,sub:a.sub+(r.subtotal||0)}),{n:0,sub:0});
  const ac=d.acuan||{},pakaiAcuan=!(d.total||{}).subtotal&&!!(ac.total&&ac.total.subtotal),ref=pakaiAcuan?ac.total:(d.total||{}),s=ref.subtotal||0,k=s?bl.sub/s:0;
  const LEWAT=new Set(['n','tanpa_pesanan','sku_kosong','penyesuaian']),total={...(d.total||{})};
  for(const x in ref)if(typeof ref[x]==='number'&&!LEWAT.has(x))total[x]=((d.total||{})[x]||0)+ref[x]*k;
  total.n=((d.total||{}).n||0)+bl.n;
  return {bl,pakaiAcuan,total,ref};
}
async function loadTtHasil(){
  if(thBusy)return;thBusy=true;
  try{
    const [d,t]=await Promise.all([api('/api/tiktok/penghasilan?'+thQuery()),ttToko?Promise.resolve(ttToko):api('/api/tiktok/toko')]);
    thData=d;ttToko=t;renderTtHasil();ttTkMuat('th');thOffset=0;await thMuatIsi(false);
  }catch(e){$('thIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</p>'}
  finally{thBusy=false}
}
function renderTtHasil(){
  const d=thData,est=thEst=thEstimasi(d),t=est?est.total:(d.total||{}),src=Object.fromEntries((d.sumber||[]).map(s=>[s.sumber,s.n]));
  put('thPeriod',est?'Pesanan dibuat '+fmtRange(d.from,d.to)+' · '+int((d.total||{}).n||0)+' transaksi sudah cair + '+int(est.bl.n)+' pesanan belum cair (diperkirakan) · dana yang benar-benar cair ada di "Tgl dana cair"'
    :'Dana dibayarkan '+fmtRange(d.from,d.to)+' · '+int(t.n||0)+' transaksi · '+int(src.api||0)+' dari API, '+int(src.file||0)+' dari file · API & upload file digabung per Order ID');
  const laba=(t.total||0)-(t.hpp||0);
  put('thK1L',est?'Dana (estimasi)':'Dana dicairkan');
  $('thK1').textContent=rpFull(t.total||0);put('thK1D',(est&&est.bl.n?'termasuk '+int(est.bl.n)+' pesanan belum cair · ':'')+int(t.n||0)+' transaksi'+(t.n?' · rata-rata '+rpFull((t.total||0)/t.n):'')+(t.penyesuaian?' · penyesuaian '+rpFull(t.penyesuaian):''));
  $('thK2').textContent=rpFull(-(t.biaya||0));put('thK2D',pct(t.pendapatan?-100*t.biaya/t.pendapatan:null)+' dari pendapatan');
  $('thK3').textContent=rpFull(t.pendapatan||0);put('thK3D','subtotal '+rpFull(t.subtotal||0)+' · refund '+rpFull(-(t.refund||0)));
  $('thK4').innerHTML=t.hpp?lpRp(laba,0):'—';put('thK4D',!t.hpp?'HPP belum terhitung — data Pesanan & SKU belum lengkap':'HPP '+rpFull(t.hpp)+' · margin '+pct(t.pendapatan?100*laba/t.pendapatan:null)+' dari pendapatan · belum termasuk iklan');
  const w=[];
  if(t.tanpa_pesanan)w.push(int(t.tanpa_pesanan)+' pesanan belum ada di data Pesanan — produk &amp; HPP-nya belum terhitung. Upload file Pesanan untuk periode pesanan dibuat yang sama, atau klik <b>Sinkron sekarang</b>.');
  if(t.sku_kosong)w.push(int(t.sku_kosong)+' pesanan berisi SKU yang belum ada di Manajemen SKU — HPP-nya belum lengkap.');
  if(est&&est.bl.n)w.push('<b>Estimasi.</b> '+int(est.bl.n)+' pesanan yang dibuat di rentang ini dananya <b>belum cair</b> (subtotal '+rpFull(est.bl.sub)+') — pendapatan, biaya TikTok &amp; HPP-nya diperkirakan dari rasio pesanan yang sudah cair'+
    (est.pakaiAcuan?' (acuan pesanan dibuat '+fmtRange(d.acuan.dari,d.acuan.sampai)+', karena di rentang ini belum ada yang cair)':'')+'. Rincian per kolom, tabel per pesanan / produk / toko, dan kanal Affiliate hanya transaksi yang sudah cair.');
  if(est&&est.bl.n&&!(est.ref||{}).subtotal)w.push('Belum ada data settlement TikTok 60 hari terakhir — pesanan yang belum cair belum bisa diperkirakan.');
  $('thWarn').hidden=!w.length;$('thWarn').innerHTML=w.map(x=>'<p>'+x+'</p>').join('');
  const pd=t.pendapatan||0,p=v=>pd?pct(100*v/pd):'—';
  const kel=[['Pendapatan',t.pendapatan,'b'],['Biaya platform (komisi, layanan, pemrosesan)',t.platform],['Ongkir & layanan logistik',t.ongkir],['Komisi afiliasi',t.afiliasi],['Pajak (PPh 22)',t.pajak],['Total biaya TikTok',t.biaya,'b'],['Penyesuaian',t.penyesuaian],[est?'Dana (estimasi, termasuk belum cair)':'Dana dicairkan',t.total,'b']];
  if(t.hpp)kel.push(['HPP (dari data Pesanan)',-t.hpp],['Laba kotor (sebelum iklan)',laba,'b']);
  const iklanTot=(d.iklan_harian||[]).reduce((a,r)=>a+(r.biaya||0),0);
  if(iklanTot)kel.push(['Spend iklan TikTok (tanggal tayang)',-iklanTot],[t.hpp?'Laba setelah iklan':'Dana setelah iklan',(t.hpp?laba:(t.total||0))-iklanTot,'b']);
  // Nama kolom API (Inggris) → istilah file Income; kolom total/ringkasan disembunyikan (sudah ada di atas). Kolom yang sama dari file & API digabung.
  const gab=new Map();
  for(const x of d.rincian||[]){const k=ttNamaKolom(x.kolom);if(!k)continue;const g=gab.get(k)||{kolom:k,jumlah:0,asli:[]};g.jumlah+=x.jumlah;g.asli.push(x.kolom);gab.set(k,g)}
  const kolom=[...gab.values()].filter(r=>r.jumlah).sort((a,b)=>Math.abs(b.jumlah)-Math.abs(a.jumlah));
  $('thRinci').innerHTML='<table class="sku-tbl gd-tbl lr-tbl" data-dt="off"><thead><tr><th>Komponen</th><th class="n">Jumlah</th><th class="n">% pendapatan</th></tr></thead><tbody>'+
    kel.map(k=>'<tr class="'+(k[2]?'lr-akhir':'lr-pos')+'"><td class="lr-nm">'+esc(k[0])+'</td><td class="n">'+lpRp(k[1]||0,0)+'</td><td class="n">'+p(k[1]||0)+'</td></tr>').join('')+
    (kolom.length?'<tr class="lr-judul th-rinci-tog" style="cursor:pointer" title="Klik untuk membuka / menutup"><td colspan="3">'+(thRinciBuka?'▾':'▸')+' Rincian per kolom laporan <span style="font-weight:400;text-transform:none;letter-spacing:0">· '+int(kolom.length)+' kolom · klik untuk '+(thRinciBuka?'menutup':'melihat detail potongan')+'</span></td></tr>'+kolom.map(r=>'<tr class="th-rinci-det"'+(thRinciBuka?'':' hidden')+'><td class="lr-nm" style="padding-left:28px;color:var(--muted)" title="'+esc(r.asli.join(', '))+'">'+esc(r.kolom)+'</td><td class="n" style="color:var(--muted)">'+lpRp(r.jumlah,0)+'</td><td class="n" style="color:var(--muted)">'+p(r.jumlah)+'</td></tr>').join(''):'')+'</tbody></table>';
  thRenderKanal();
}
/**
 * Kanal penjualan TikTok (rentang = tanggal dana dibayarkan): Ads (file Campaign overview: biaya & omzet per hari, tanggal tayang),
 * Affiliate (transaksi dengan komisi afiliasi; spending = komisi), Live (belum ada sumber data).
 * Net = omzet − potongan TikTok − biaya lain-lain − spending − HPP; potongan & biaya lain dibagi menurut omzet. Net baris toko = Laba setelah iklan.
 * Mode 'klaim' = atribusi masing-masing (beririsan); 'unik' = tanpa dobel (phBagiUnik, prioritas Affiliate → Live → Ads → Organik).
 */
let thKanal='ads',thKanalChart=null,thKanalData=null,thMode='unik';   // default saat halaman dibuka: Tanpa dobel
try{const k=localStorage.getItem('thKanal');if(k in PH_KANAL)thKanal=k;}catch(e){}
$('thKanalSeg').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.k===thKanal);b.onclick=()=>{
  thKanal=b.dataset.k;try{localStorage.setItem('thKanal',thKanal)}catch(e){}
  $('thKanalSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));if(thKanalData)thGambarKanal()}});
$('thModeSeg').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.m===thMode);b.onclick=()=>{
  thMode=b.dataset.m;
  $('thModeSeg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));if(thData)thRenderKanal()}});
// Biaya live TikTok (manual): tambah per periode / hapus
$('thKanalTbl').addEventListener('click',async e=>{
  const bt=e.target.closest('[data-tl-tambah]'),bh=e.target.closest('[data-tl-hapus]');if(!bt&&!bh)return;
  try{
    if(bh){if(!confirm('Hapus spending live ini?'))return;await api('/api/tiktok/live/biaya/'+bh.dataset.tlHapus,{method:'DELETE'})}
    else{
      const daftar=(ttToko&&ttToko.toko)||[];let toko=Number($('thToko').value)||(daftar.length===1?daftar[0].id:0);
      if(!toko){const p=prompt('Toko mana?\n'+daftar.map((t,i)=>(i+1)+'. '+t.nama).join('\n'),'1');if(p==null)return;toko=(daftar[Number(p)-1]||{}).id;if(!toko)return alert('Nomor toko tidak valid.')}
      const per=prompt('Periode biaya live (YYYY-MM-DD s/d YYYY-MM-DD):',thData.from+' s/d '+thData.to);if(per==null)return;
      const tg=per.match(/\d{4}-\d{2}-\d{2}/g)||[];if(!tg.length)return alert('Periode tidak terbaca. Contoh: 2026-10-01 s/d 2026-10-31');
      const v=prompt('Total biaya live periode itu (Rp) — fee host, iklan live, dll.:','');if(v==null)return;
      const ket=prompt('Keterangan (opsional):','');
      await api('/api/tiktok/live/biaya',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({toko_id:toko,dari:tg[0],sampai:tg[1]||tg[0],spending:spAngka(v),ket:ket||''})});
    }
    loadTtHasil();
  }catch(err){alert('Gagal: '+err.message)}
});
function thHitungKanal(){
  const d=thData,t=(thEst?thEst.total:d.total)||{},hari=[];for(let x=d.from;x<=d.to&&hari.length<400;x=shift(x,1))hari.push(x);
  const rasioHpp=t.pendapatan?(t.hpp||0)/t.pendapatan:0,pv=d.pesanan_valid||{},rasioValid=pv.semua?(pv.valid||0)/pv.semua:1;
  const kosong=()=>new Map(hari.map(x=>[x,{omzet:0,spend:0,hpp:0,n:0}]));
  const per={ads:kosong(),afiliasi:kosong(),live:kosong()};let hppKurang=0;
  // Omzet iklan TikTok masih termasuk pesanan batal / belum bayar → dikali rasio subtotal pesanan valid di rentang
  for(const r of d.iklan_harian||[]){const x=per.ads.get(r.tgl);if(x){x.omzet+=(r.omzet||0)*rasioValid;x.spend+=r.biaya||0;x.hpp=x.omzet*rasioHpp}}
  for(const r of d.afiliasi_harian||[]){const x=per.afiliasi.get(r.tgl);if(x){x.omzet+=r.omzet||0;x.spend+=r.komisi||0;x.hpp+=r.hpp||0;x.n+=r.n||0}hppKurang+=r.hpp_kurang||0}
  // Live: GMV dari LIVE per hari (langsung + tidak langsung), dikoreksi pesanan batal seperti iklan; HPP perkiraan. Biaya live manual dibagi rata per hari periodenya.
  for(const r of d.live_harian||[]){const x=per.live.get(r.tgl);if(x){x.omzet+=(r.omzet||0)*rasioValid;x.hpp=x.omzet*rasioHpp;x.n+=r.pesanan||0}}
  for(const b of d.live_biaya||[]){
    const n=Math.round((new Date(b.sampai+'T00:00:00Z')-new Date(b.dari+'T00:00:00Z'))/864e5)+1;
    for(let x=b.dari;x<=b.sampai;x=shift(x,1)){const y=per.live.get(x);if(y)y.spend+=(b.spending||0)/n}
  }
  const jumlah=m=>[...m.values()].reduce((a,x)=>({omzet:a.omzet+x.omzet,spend:a.spend+x.spend,hpp:a.hpp+x.hpp,n:a.n+x.n}),{omzet:0,spend:0,hpp:0,n:0});
  return {hari,per,rasioHpp,rasioValid,hppKurang,ada:{ads:!!(d.iklan_harian||[]).length,afiliasi:!!(d.afiliasi_harian||[]).length,live:!!(d.live_harian||[]).length},
    total:{ads:jumlah(per.ads),afiliasi:jumlah(per.afiliasi),live:jumlah(per.live)}};
}
function thRenderKanal(){
  const k=thKanalData=thHitungKanal(),t0=(thEst?thEst.total:thData.total)||{},pc=(a,b)=>b?nf.format(Math.round(1000*a/b)/10)+'%':'—',omzetToko=t0.pendapatan||0;
  const unik=thMode==='unik',t=k.total,u=phBagiUnik(t,{harga:omzetToko,hpp:t0.hpp||0});k.faktorAds=unik?u.faktorAds:1;
  // Potongan TikTok = biaya platform + ongkir & logistik + pajak (komisi afiliasi sudah jadi spending Affiliate); biaya lain-lain = penyesuaian
  const potongan=Math.max(0,-(t0.biaya||0)-t.afiliasi.spend),lain=-(t0.penyesuaian||0);
  k.rPot=omzetToko?potongan/omzetToko:0;k.rLain=omzetToko?lain/omzetToko:0;
  const sumK=f=>['ads','afiliasi','live'].reduce((s,c)=>s+(k.ada[c]?t[c][f]:0),0),totalKanal={omzet:sumK('omzet'),spend:sumK('spend'),hpp:sumK('hpp')};
  const dasarPorsi=unik?omzetToko:totalKanal.omzet;
  const baris=(nama,x,sub,cls,tot)=>{const pot=tot?potongan:x.omzet*k.rPot,ln=tot?lain:x.omzet*k.rLain,net=x.omzet-pot-ln-x.spend-x.hpp;
    return '<tr class="'+(cls||'')+'"><td class="lr-nm">'+esc(nama)+(sub?'<small>'+sub+'</small>':'')+'</td><td class="n">'+rpFull(x.omzet)+'</td><td class="n">'+(tot&&!unik?'—':pc(x.omzet,dasarPorsi))+'</td>'+
      '<td class="n">'+lpRp(pot,-1)+'</td><td class="n">'+lpRp(ln,-1)+'</td><td class="n">'+lpRp(x.spend,-1)+'</td><td class="n">'+lpRp(x.hpp,-1)+'</td>'+
      '<td class="n"><b>'+lpRp(net,0)+'</b></td><td class="n">'+(x.spend?'<span class="'+(net<0?'lr-neg':'')+'">'+pc(net,x.spend)+'</span>':'—')+'</td>'+
      '<td class="n">'+(x.spend?nf.format(Math.round(10*x.omzet/x.spend)/10)+'×':'—')+'</td></tr>'};
  const kosong=(nama,ket)=>'<tr><td class="lr-nm">'+esc(nama)+'</td><td colspan="9" style="color:var(--muted)">'+ket+'</td></tr>';
  const semua={omzet:omzetToko,spend:t.ads.spend+t.afiliasi.spend+t.live.spend,hpp:t0.hpp||0};
  let h='';
  if(!unik&&k.ada.ads&&(k.ada.afiliasi||k.ada.live))h+='<div class="ob-warn" style="margin-bottom:12px"><p><b>Omzet kanal beririsan'+(k.ada.live?' — omzet Live ikut terhitung di omzet Ads':'')+'.</b> '+
    'TikTok bisa mengakui pesanan yang sama sebagai hasil iklan (GMV Max'+(k.ada.live?', termasuk iklan LIVE':'')+'), affiliate, dan LIVE sekaligus'+
    (k.ada.live?' — jadi sebagian omzet Live ('+rpFull(t.live.omzet)+') kemungkinan sudah ada di omzet Ads ('+rpFull(t.ads.omzet)+')':'')+
    '. Ads + Affiliate + Live tidak sama dengan pendapatan toko — pilih <b>Tanpa dobel</b> untuk pembagian yang bisa dijumlah.</p></div>';
  h+='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Kanal</th><th class="n">Omzet</th><th class="n">Porsi omzet</th>'+
    '<th class="n" title="Biaya platform, ongkir & logistik, pajak (tanpa komisi afiliasi) — dibagi menurut omzet ('+pc(k.rPot,1)+')">Potongan TikTok</th>'+
    '<th class="n" title="Penyesuaian settlement — dibagi menurut omzet ('+pc(k.rLain,1)+')">Biaya lain-lain</th>'+
    '<th class="n">Spending</th><th class="n">HPP</th><th class="n">Net</th><th class="n" title="ROI = net ÷ spending">ROI</th><th class="n" title="ROAS = omzet ÷ spending">ROAS</th></tr></thead><tbody>';
  h+=k.ada.ads?baris('Ads',unik?u.ads:t.ads,(unik?'sisa pendapatan toko setelah affiliate & live, maksimal klaim TikTok '+rpFull(t.ads.omzet)
      :'omzet iklan TikTok × '+pc(k.rasioValid,1)+' pesanan tidak batal')+' · HPP perkiraan '+pc(k.rasioHpp,1)+' dari omzet · iklan menurut tanggal tayang')
    :kosong('Ads','Belum ada data iklan TikTok di rentang ini — upload file Campaign overview di TikTok Shop › Iklan.');
  h+=k.ada.afiliasi?baris('Affiliate',t.afiliasi,int(t.afiliasi.n)+' transaksi berkomisi afiliasi · spending = komisi afiliasi'+(k.hppKurang?' · HPP '+int(k.hppKurang)+' pesanan belum lengkap':''))
    :kosong('Affiliate','Belum ada transaksi berkomisi afiliasi yang dananya dibayarkan pada rentang ini.');
  const lh=thData.live_harian||[],ls=f=>lh.reduce((a,r)=>a+(r[f]||0),0),lb=thData.live_biaya||[];
  h+=k.ada.live?baris('Live',t.live,int(ls('siaran'))+' siaran · '+int(ls('pesanan'))+' pesanan · GMV dari LIVE '+rpFull(ls('omzet'))+' (langsung '+rpFull(ls('omzet_langsung'))+' + tidak langsung '+rpFull(ls('omzet_tidak_langsung'))+
      ') × '+pc(k.rasioValid,1)+' tidak batal · HPP perkiraan '+pc(k.rasioHpp,1)+' dari omzet · menurut tanggal siaran'+(!unik&&k.ada.ads?' · <b style="color:var(--loss)">sebagian juga terhitung di omzet Ads</b>':'')+
      (lb.length?'':' · <b style="color:var(--loss)">spending live belum diisi</b>'))
    :kosong('Live','Belum ada data Live TikTok di rentang ini — klik Upload file lalu pilih file Live Performance Core Stats (Seller Center › Analitik › LIVE).');
  if(k.ada.live||lb.length)h+='<tr><td colspan="10" style="padding:0 12px 10px 28px">'+lb.map(b=>'<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;color:var(--muted);padding-top:6px">'+
      '<span>Spending live <b style="color:var(--ink)">'+rpFull(b.spending)+'</b> · '+esc(b.toko)+' · '+esc(fmtRange(b.dari,b.sampai))+(b.ket?' · '+esc(b.ket):'')+'</span>'+
      '<button class="btn ghost" data-tl-hapus="'+b.id+'" style="padding:3px 9px;font-size:12px;color:var(--loss)">Hapus</button></div>').join('')+
    '<div style="padding-top:6px"><button class="btn ghost" data-tl-tambah="1" style="padding:3px 9px;font-size:12px">+ Spending live</button>'+
    '<span style="font-size:12px;color:var(--muted);margin-left:8px">fee host, iklan live, dll. per periode — dibagi rata per hari</span></div></td></tr>';
  if(unik){
    h+=baris('Organik / lainnya',u.organik,'sisa pendapatan toko yang tidak masuk affiliate, live, maupun klaim iklan · tanpa spending · HPP = HPP toko − kanal lain');
    h+=baris('Total = seluruh pendapatan toko',semua,'Affiliate + Live + Ads + Organik · net = Laba setelah iklan di Rincian penghasilan · prioritas: Affiliate (pasti per pesanan) → Live → Ads → Organik','lr-akhir',1);
  }else{
    h+=baris('Seluruh pendapatan toko',semua,'pembanding: net = Laba setelah iklan di Rincian penghasilan · spending = iklan + komisi afiliasi','lr-akhir',1);
  }
  $('thKanalTbl').innerHTML=h+'</tbody></table>';
  put('thKanalSub',(unik?'Tanpa dobel: tiap rupiah omzet masuk satu kanal':'Angka atribusi TikTok (beririsan)')+' · net = omzet − potongan TikTok − biaya lain-lain − spending − HPP · ROI = net ÷ spending · '+(thData.basis==='dilepas'?'Pendapatan & Affiliate menurut tanggal dana cair':'Pendapatan menurut tanggal pesanan dibuat (termasuk estimasi belum cair), Affiliate hanya yang sudah cair')+', Ads menurut tanggal tayang, Live menurut tanggal siaran');
  thGambarKanal();
}
function thGambarKanal(){
  if(typeof Chart==='undefined')return;
  // Mode tanpa dobel: omzet & HPP Ads per hari diskalakan dengan faktor yang sama dengan tabel
  const k=thKanalData,f=thKanal==='ads'?(k.faktorAds??1):1,rinci=k.hari.map(x=>{const r=k.per[thKanal].get(x);return {omzet:r.omzet*f,spend:r.spend,hpp:r.hpp*f}});
  for(const x of rinci){x.pot=x.omzet*(k.rPot||0);x.lain=x.omzet*(k.rLain||0)}
  const data=[rinci.map(x=>Math.round(x.omzet)),rinci.map(x=>-Math.round(x.spend)),rinci.map(x=>Math.round(x.omzet-x.pot-x.lain-x.spend-x.hpp))];
  const labels=k.hari.map(x=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(x+'T00:00:00Z')));
  put('thKanalP',PH_KANAL[thKanal]+' · batang = omzet & spending · garis = net (omzet − potongan − biaya lain − spending − HPP)'+(thKanal==='live'?' · belum ada data Live':''));
  if(thKanalChart){thKanalChart.data.labels=labels;data.forEach((x,i)=>thKanalChart.data.datasets[i].data=x);thKanalChart.$rinci=rinci;thKanalChart.update();return}
  thKanalChart=new Chart($('thKanal'),{type:'bar',
    data:{labels,datasets:[{label:'Omzet',data:data[0],backgroundColor:css('--rev'),borderRadius:3,stack:'s',order:2},
      {label:'Spending',data:data[1],backgroundColor:css('--loss'),borderRadius:3,stack:'s',order:2},
      {type:'line',label:'Net',data:data[2],borderColor:css('--ink')||'#334',backgroundColor:css('--ink')||'#334',borderWidth:2,pointRadius:2,tension:.3,stack:'net',order:1}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>' '+c.dataset.label+': '+rpFull(c.datasetIndex===1?-c.raw:c.raw),
          afterBody:it=>{const x=(thKanalChart.$rinci||[])[it[0].dataIndex];return x&&x.omzet?['Potongan TikTok: −'+rpFull(x.pot),'Biaya lain-lain: −'+rpFull(x.lain),'HPP: −'+rpFull(x.hpp)]:[]}}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:12}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},ticks:{callback:v=>rp(v)}}}}});
  thKanalChart.$rinci=rinci;
}
/** Nama kolom rincian settlement: API TikTok (snake_case) → istilah file Income; null = kolom total yang disembunyikan */
const TT_KOLOM_API={gross_sales_amount:null,net_sales_amount:null,revenue_amount:null,settlement_amount:null,fee_amount:null,fee_tax_amount:null,
  shipping_cost_amount:'Ongkir',after_seller_discounts_subtotal_amount:null,customer_payment_amount:null,customer_order_refund_amount:null,
  seller_discount_amount:'Diskon penjual',gross_sales_refund_amount:'Total pengembalian dana sebelum diskon',seller_discount_refund_amount:'Pengembalian dana diskon penjual',
  customer_refund_amount:'Pengembalian dana pembeli',platform_discount_amount:'Diskon platform',platform_discount_refund_amount:'Pengembalian dana diskon platform',
  actual_shipping_fee_amount:'Ongkir yang ditalangi penyedia jasa logistik',platform_shipping_fee_discount_amount:'Ongkir yang ditanggung platform',
  customer_shipping_fee_amount:'Ongkir yang ditanggung pembeli',customer_paid_shipping_fee_amount:'Ongkir yang ditanggung pembeli',
  customer_paid_shipping_fee_refund_amount:'Pengembalian ongkir yang dibayar pembeli',actual_return_shipping_fee_amount:'Ongkir pengembalian barang',
  shipping_fee_subsidy_amount:'Subsidi ongkir',logistics_service_fee_amount:'Biaya layanan logistik',platform_commission_amount:'Biaya komisi platform',
  transaction_fee_amount:'Biaya Pembayaran',mall_service_fee_amount:'Biaya layanan Mall',dynamic_commission_amount:'Komisi dinamis',
  growth_xtra_service_fee_amount:'Biaya layanan Program Growth Xtra',order_processing_fee_amount:'Biaya pemrosesan pesanan',
  affiliate_commission_amount:'Komisi Afiliasi',affiliate_partner_commission_amount:'Komisi mitra afiliasi',affiliate_ads_commission_amount:'Komisi Iklan Toko afiliasi',
  affiliate_commission_before_pit:null,pit_amount:'PPh Pasal 22 dipungut',adjustment_amount:'Jumlah penyesuaian',voucher_xtra_service_fee_amount:'Biaya layanan Voucher Xtra',
  free_shipping_service_fee_amount:'Biaya layanan Program Bebas Ongkir',live_specials_fee_amount:'Biaya layanan Khusus LIVE'};
/** File Income: kolom total sudah tampil di ringkasan → disembunyikan */
const TT_KOLOM_TOTAL=/^(Total |Jumlah penyelesaian|Subtotal|Pembayaran oleh pembeli)/;
function ttNamaKolom(k){
  const dasar=String(k).replace(/^.*\./,'');                // komponen bersarang (fee_breakdown.xxx) → nama terakhir
  if(/^[a-z0-9_]+$/.test(dasar)){
    if(dasar in TT_KOLOM_API)return TT_KOLOM_API[dasar];
    const t=dasar.replace(/_amount$/,'').replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1);  // belum dikenal: tampil apa adanya, lebih rapi
  }
  return TT_KOLOM_TOTAL.test(k)?null:k;
}
async function thMuatIsi(tambah){
  const tab=(document.querySelector('#thTab button.on')||{}).dataset.tab;
  $('thCariWrap').hidden=tab!=='pesanan';
  if(tab==='toko'){
    $('thMore').hidden=true;put('thSub','Per toko · dana dicairkan, biaya TikTok, dan laba kotor (dana − HPP)');
    const nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama]));
    $('thIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Toko</th><th class="n">Transaksi</th><th class="n">Pendapatan</th><th class="n">Biaya TikTok</th><th class="n">% biaya</th><th class="n">Dana dicairkan</th><th class="n">HPP</th><th class="n">Laba kotor</th></tr></thead><tbody>'+
      ((thData.per_toko||[]).slice().sort((a,b)=>(b.total||0)-(a.total||0)).map(r=>{const l=(r.total||0)-(r.hpp||0);
        return '<tr><td class="nm">'+esc(nama.get(r.toko_id)||'?')+'</td><td class="n">'+int(r.n)+'</td><td class="n">'+rpFull(r.pendapatan||0)+'</td><td class="n">'+rpFull(r.biaya||0)+'</td>'+
          '<td class="n">'+pct(r.pendapatan?-100*r.biaya/r.pendapatan:null)+'</td><td class="n"><b>'+rpFull(r.total||0)+'</b></td><td class="n">'+(r.hpp?rpFull(r.hpp):'—')+'</td><td class="n">'+(r.hpp?lpRp(l,0):'—')+'</td></tr>'}).join('')||
        '<tr><td colspan="8" style="color:var(--muted)">Belum ada data.</td></tr>')+'</tbody></table>';
    return;
  }
  if(tab==='produk'){
    $('thMore').hidden=true;put('thSub','Dana tiap pesanan dibagi ke produknya menurut porsi subtotal');
    $('thIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>SKU</th><th>Produk</th><th class="n">Qty</th><th class="n">Pendapatan</th><th class="n">Biaya</th><th class="n">Dana</th><th class="n">HPP</th><th class="n">Laba kotor</th></tr></thead><tbody>'+
      ((thData.per_sku||[]).map(s=>{const l=s.total-(s.hpp||0);return '<tr><td class="name">'+esc(s.sku||'(kosong)')+(s.sku_id?'':'<small><span class="tag warn">belum di Manajemen SKU</span></small>')+'</td><td>'+esc(s.nama||'')+'</td>'+
        '<td class="n">'+int(s.qty)+'</td><td class="n">'+rpFull(s.pendapatan)+'</td><td class="n">'+rpFull(s.biaya)+'</td><td class="n">'+rpFull(s.total)+'</td><td class="n">'+(s.hpp?rpFull(s.hpp):'—')+'</td>'+
        '<td class="n"><b'+(l<0?' class="sd-min"':'')+'>'+rpFull(l)+'</b></td></tr>'}).join('')||'<tr><td colspan="8" style="color:var(--muted)">Belum ada data.</td></tr>')+'</tbody></table>';
    return;
  }
  const q=thQuery(),c=$('thCari').value.trim();if(c)q.set('q',c);q.set('offset',tambah?thOffset:0);
  const d=await api('/api/tiktok/penghasilan/daftar?'+q);
  thRows=tambah?thRows.concat(d.rows):d.rows;thOffset=thRows.length;
  put('thSub',int(d.total)+' transaksi'+(c?' · cari "'+c+'"':''));
  const bt=((ttToko&&ttToko.toko)||[]).length>1;
  $('thIsi').innerHTML='<table class="sku-tbl gd-tbl lr-tbl"><thead><tr><th>Order ID</th>'+(bt?'<th>Toko</th>':'')+'<th>Produk</th><th class="n">Pendapatan</th><th class="n">Platform</th><th class="n">Ongkir</th><th class="n">Afiliasi</th><th class="n">Pajak</th><th class="n">Dana</th><th class="n">HPP</th></tr></thead><tbody>'+
    (thRows.map(h=>'<tr><td class="name">'+esc(h.order_id||h.id)+'<small class="mm-sub">'+(h.jenis!=='Pesanan'?esc(h.jenis)+' · ':'')+'cair '+tglWib(h.dilepas+'T12:00:00Z')+(h.dibuat?' · dibuat '+tglWib(h.dibuat+'T12:00:00Z'):'')+' '+(TT_SUMBER[h.sumber]||'')+'</small></td>'+(bt?'<td>'+esc(h.toko||'')+'</td>':'')+
      '<td>'+(h.items.length?h.items.map(i=>esc(i.sku||'—')+' × '+int(i.qty)).join('<br>'):'<span style="color:var(--muted)">'+(h.ada_pesanan?'—':'pesanan belum ada')+'</span>')+'</td>'+
      '<td class="n">'+rpFull(h.pendapatan)+(h.refund?'<small class="mm-sub">refund '+rpFull(h.refund)+'</small>':'')+'</td><td class="n">'+rpFull(h.biaya_platform)+'</td><td class="n">'+rpFull(h.biaya_ongkir)+'</td>'+
      '<td class="n">'+rpFull(h.biaya_afiliasi)+'</td><td class="n">'+rpFull(h.pajak)+'</td><td class="n"><b>'+rpFull(h.total)+'</b></td><td class="n">'+(h.hpp?rpFull(h.hpp):'—')+'</td></tr>').join('')||
      '<tr><td colspan="9" style="color:var(--muted)">Tidak ada transaksi untuk filter ini.</td></tr>')+'</tbody></table>';
  $('thMore').hidden=thRows.length>=d.total;
}

// Filter, tab, cari
$('thRange').addEventListener('click',e=>{if(e.target.closest('button'))loadTtHasil()});
$('thToko').addEventListener('change',loadTtHasil);
$('thRinci').addEventListener('click',e=>{if(!e.target.closest('.th-rinci-tog')||!thData)return;thRinciBuka=!thRinciBuka;renderTtHasil()});
tkPasangPilih('th');
$('thExport').addEventListener('click',async()=>{
  if(!thData)return;const d=thData,akhir='-'+d.from+'_'+d.to+'.csv',tab=(document.querySelector('#thTab button.on')||{}).dataset.tab,nama=new Map(((ttToko&&ttToko.toko)||[]).map(t=>[t.id,t.nama]));
  if(tab==='toko')return unduhCsv('tiktok-penghasilan-per-toko'+akhir,['Toko','Transaksi','Pendapatan','Biaya TikTok','Dana dicairkan','HPP'],(d.per_toko||[]).map(r=>[nama.get(r.toko_id)||'?',r.n,r.pendapatan,r.biaya,r.total,r.hpp||'']));
  if(tab==='produk')return unduhCsv('tiktok-penghasilan-per-produk'+akhir,['SKU','Produk','Qty','Pendapatan','Biaya','Dana','HPP'],(d.per_sku||[]).map(s=>[s.sku,s.nama,s.qty,Math.round(s.pendapatan),Math.round(s.biaya),Math.round(s.total),s.hpp||'']));
  try{let n=0;while(thRows.length<(thData.n_daftar||Infinity)&&n++<200){const before=thRows.length;await thMuatIsi(true);if(thRows.length===before)break}}catch(err){alert(err.message);return}
  unduhCsv('tiktok-penghasilan'+akhir,['Order ID','Toko','Jenis','Dibuat','Dicairkan','Pendapatan','Refund','Platform','Ongkir','Afiliasi','Pajak','Penyesuaian','Dana','HPP','Sumber'],
    thRows.map(h=>[h.order_id||h.id,h.toko||'',h.jenis,h.dibuat||'',h.dilepas,h.pendapatan,h.refund,h.biaya_platform,h.biaya_ongkir,h.biaya_afiliasi,h.pajak,h.penyesuaian,h.total,h.hpp||'',h.sumber]));
});
$('thCari').addEventListener('input',()=>{clearTimeout(thCariT);thCariT=setTimeout(()=>thMuatIsi(false),350)});
$('thMoreBtn').addEventListener('click',()=>thMuatIsi(true));
$('thTab').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $('thTab').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));thMuatIsi(false)});
