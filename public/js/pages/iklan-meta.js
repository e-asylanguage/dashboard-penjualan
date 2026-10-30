/**
 * Grup menu Iklan Meta: Campaign & Ad (pohon BM → Campaign → Ad set → Ad, spend Meta + order Scalev via UTM) dan Konten (performa iklan per editor / kelompok).
 * Data: /api/report/iklan…, /api/report/konten…. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js, api.js, dan rentang() (window.rentang).
 * Dipanggil dari script utama: openIklan() (menu Campaign & Ad), loadKonten() (menu Konten).
 * Menu Produk Iklan masih di script utama (satu blok dengan Data Produk / Manajemen SKU).
 */
// ---- Iklan Meta: pohon BM → Campaign → Ad set → Ad (spend Meta + order Scalev via UTM)
const IK_TAG={1:'Produk',2:'Campaign',3:'Ad set',4:'Ad'};
let ikData=null,ikBusy=false;
const ikBuka=new Set();                 // id baris yang sedang terbuka

/**
 * Kode gabungan produk di nama campaign: "21/06/26 QM - TEST - PUS2" → "QM" bila ada gabungan bernama QM
 * di Data Produk. Kode dicocokkan per kata (dipisah spasi, "-", "/", dll.), tidak peka huruf besar/kecil.
 */
function ikKodeGab(nama){
  const kode=new Map((ikData.gabungan||[]).map(g=>[g.name.trim().toUpperCase(),g.name]));
  for(const t of String(nama||'').toUpperCase().split(/[^A-Z0-9]+/))if(kode.has(t))return kode.get(t);
  return null;
}

const IK_KUNCI=['spend','impressions','link_clicks','pixel_purchases','orders','confirmed','pending','canceled','completed','rts','revenue','revenue_closing',
  'hpp','scalev_fee','ongkir','cod_fee','hpp_kurang','tanpa_paket','ongkir_estimasi'];

/**
 * Pohon Gabungan produk → Campaign → Ad set → Ad.
 * Campaign masuk ke gabungan lewat kode di namanya; order campaign dari UTM id-nya.
 * Order berisi produk gabungan yang tidak terlacak ke campaign mana pun (UTM teks / kosong) masuk ke
 * baris "(order tanpa id campaign)" di bawah gabungannya — dihitung lewat produk, tanpa peduli id campaign.
 * Angka gabungan = jumlah semua anaknya.
 */
function ikSaring(){
  const rows=ikData.rows||[],bm=$('ikBm').value,gab=$('ikGab').value,q=$('ikCari').value.trim().toLowerCase();
  const aktif=(document.querySelector('#ikStatus button.on')||{}).dataset.st==='aktif';
  const byId=new Map(rows.map(r=>[r.id,r]));
  rows.forEach(r=>{if(r.level===2)r.gab=ikKodeGab(r.name)});
  const lolos=new Set(rows.filter(r=>r.level===2&&r.gab&&(!gab||r.gab===gab)&&(!bm||r.parent===bm)&&(!aktif||r.status==='ACTIVE')&&
    (!q||r.name.toLowerCase().includes(q)||r.gab.toLowerCase().includes(q))).map(r=>r.id));
  const induk=r=>{let x=r;while(x&&x.level>2)x=byId.get(x.parent);return x};
  const out=[];
  const akar=new Map();
  const simpul=g=>{if(!akar.has(g))akar.set(g,Object.assign({level:1,id:'g:'+g,parent:null,name:g,nCampaign:0},Object.fromEntries(IK_KUNCI.map(k=>[k,0]))));return akar.get(g)};
  for(const r of rows){
    if(r.level===2&&lolos.has(r.id)){
      const g=simpul(r.gab);IK_KUNCI.forEach(k=>{g[k]+=r[k]||0});g.nCampaign++;
      out.push(Object.assign({},r,{parent:g.id,bm:(byId.get(r.parent)||{}).name||''}));
    }else if(r.level>2&&lolos.has((induk(r)||{}).id))out.push(r);
  }
  // Order tanpa id campaign tidak bisa dipilah per BM, jadi disembunyikan saat filter BM dipakai.
  if(!bm)for(const g of ikData.gabungan||[]){
    const t=g.tanpa_id;
    if(!t||!t.orders||(gab&&g.name!==gab)||(q&&!g.name.toLowerCase().includes(q)))continue;
    const s=simpul(g.name);IK_KUNCI.forEach(k=>{s[k]+=t[k]||0});
    out.push(Object.assign({level:2,id:'g:'+g.name+':x',parent:s.id,name:'(order tanpa id campaign)',untracked:true,noId:true},
      Object.fromEntries(IK_KUNCI.map(k=>[k,t[k]||0]))));
  }
  return [...akar.values(),...out];
}

/** Net profit = omzet closing − spend − HPP − Scalev fee − ongkir − COD fee. */
const ikNet=r=>r.revenue_closing-r.spend-r.hpp-r.scalev_fee-r.ongkir-r.cod_fee;

function ikSel(r){
  const cpr=r.orders?r.spend/r.orders:null,cf=r.orders?100*r.confirmed/r.orders:null;
  const roas=r.spend?r.revenue_closing/r.spend:null,net=ikNet(r);
  const bar=roas==null?'<span style="color:var(--muted)">—</span>':
    '<span class="roas'+(roas<1?' low':'')+'"><i><b style="width:'+Math.min(100,roas/3*100)+'%"></b></i>'+nf2.format(roas)+'×</span>';
  // Tanda * = sebagian order belum punya HPP / paket Mengantar, jadi angkanya lebih kecil dari seharusnya
  const bintang=(n,ket)=>n?'<sup class="ik-kurang" title="'+int(n)+' order '+ket+'">*</sup>':'';
  return '<td class="n">'+rpFull(r.spend)+'</td><td class="n">'+int(r.orders)+'</td><td class="n">'+int(r.pending)+'</td>'+
    '<td class="n">'+int(r.confirmed)+'</td><td class="n">'+int(r.canceled)+'</td><td class="n">'+(cpr==null?'—':rpFull(cpr))+'</td>'+
    '<td class="n">'+pct(cf)+'</td>'+
    '<td class="n">'+rpFull(r.revenue_closing)+'</td>'+
    '<td class="n">'+rpFull(r.hpp)+bintang(r.hpp_kurang,'closing belum punya HPP')+'</td><td class="n">'+rpFull(r.scalev_fee)+'</td>'+
    '<td class="n">'+rpFull(r.ongkir)+bintang(r.tanpa_paket,'sudah dikirim tapi paket Mengantar-nya tidak ditemukan')+'</td><td class="n">'+rpFull(r.cod_fee)+'</td>'+
    '<td class="n"><b class="roi '+(net>=0?'pos':'neg')+'">'+(net<0?'−':'')+rpFull(Math.abs(net))+'</b></td>'+
    '<td class="n">'+bar+'</td>'+
    // ROAS = revenue closing ÷ spend; ROI = net profit ÷ spend (sudah dikurangi HPP, fee, ongkir, COD fee).
    '<td class="n">'+(r.spend?'<b class="roi '+(net>=0?'pos':'neg')+'">'+(net>=0?'+':'')+pct(100*net/r.spend)+'</b>':'<span style="color:var(--muted)">—</span>')+'</td>';
}

function renderIklan(){
  const d=ikData,rows=ikSaring(),anak=new Map();
  for(const r of rows)if(r.parent){if(!anak.has(r.parent))anak.set(r.parent,[]);anak.get(r.parent).push(r)}
  const urut=list=>list.sort((a,b)=>(a.untracked?1:0)-(b.untracked?1:0)||b.spend-a.spend||b.orders-a.orders);
  const baris=[];
  const tulis=(r)=>{
    const kids=anak.get(r.id)||[],buka=ikBuka.has(r.id);
    let nama=(kids.length?'<span class="tog">'+(buka?'–':'+')+'</span>':'<span class="tog" style="visibility:hidden"></span>')+
      '<span class="lvtag">'+IK_TAG[r.level]+'</span>'+esc(r.name);
    if(r.level===2&&!r.noId)nama+='<span class="stc'+(r.status==='ACTIVE'?'':' off')+'">'+(r.status==='ACTIVE'?'Aktif':'Jeda')+'</span>'+
      (r.account?'<span class="akun">'+esc(r.account)+'</span>':'');
    if(r.noId)nama+='<span class="akun">UTM bukan id campaign (teks manual / kosong) · dihitung dari produk</span>';
    const prd=r.level===1?'<span class="tag">'+int(r.nCampaign)+' campaign</span>':
      r.level===2&&r.bm?'<span class="tag">'+esc(r.bm)+'</span>':'';
    baris.push('<tr class="lv'+r.level+(r.untracked?' lacak':'')+'"'+(kids.length?' data-anak="'+esc(r.id)+'"':'')+'><td>'+nama+'</td><td class="prd">'+prd+'</td>'+ikSel(r)+'</tr>');
    if(buka)urut(kids).forEach(tulis);
  };
  const akar=urut(rows.filter(r=>r.level===1));
  akar.forEach(tulis);
  $('ikRows').innerHTML=baris.join('')||'<tr><td colspan="17" style="color:var(--muted)">'+
    ((d.rows||[]).length?'Tidak ada campaign yang cocok dengan filter.':'Belum ada data iklan pada rentang ini. Pastikan ad account sudah dicentang di Pengaturan › Sinkronisasi Meta Ads.')+'</td></tr>';

  // KPI & baris total = jumlah semua gabungan yang tampil
  const t=akar.reduce((a,b)=>{IK_KUNCI.forEach(k=>a[k]+=b[k]||0);a.n+=b.nCampaign;return a},
    Object.assign({n:0},Object.fromEntries(IK_KUNCI.map(k=>[k,0]))));
  $('ikFoot').innerHTML=akar.length?'<tr><td>Total keseluruhan<small>'+int(akar.length)+' gabungan produk · '+int(t.n)+' campaign</small></td><td></td>'+ikSel(t)+'</tr>':'';
  // Kartu Net profit & ROI memakai dasar yang sama dengan kolom Net Profit / ROI di tabel
  const netT=ikNet(t);
  put('ikOmzet',rpFull(t.revenue_closing));put('ikOmzetD','closing '+int(t.confirmed)+' · RTS '+pct(t.completed+t.rts?100*t.rts/(t.completed+t.rts):null));
  put('ikProfit',(netT<0?'−':'')+rpFull(Math.abs(netT)));
  put('ikProfitD','spend '+rpFull(t.spend)+' · HPP '+rpFull(t.hpp)+' · ongkir & fee '+rpFull(t.ongkir+t.cod_fee+t.scalev_fee));
  const pc=$('ikProfitCard');pc.classList.toggle('tone-spend',netT>=0);pc.classList.toggle('tone-loss',netT<0);
  // ROI sebelum ongkir & fee COD = (omzet − spend − HPP) ÷ spend
  const net0=t.revenue_closing-t.spend-t.hpp;
  put('ikRoi0',t.spend?(net0>=0?'+':'')+pct(100*net0/t.spend):'—');
  put('ikRoi0D',t.spend?'profit '+(net0<0?'−':'')+rpFull(Math.abs(net0))+' ÷ spend · ROAS '+nf2.format(t.revenue_closing/t.spend)+'×':'belum ada spend');
  put('ikRoi',t.spend?(netT>=0?'+':'')+pct(100*netT/t.spend):'—');
  put('ikRoiD',t.spend?'net profit ÷ spend · ongkir '+rpFull(t.ongkir)+' · fee COD '+rpFull(t.cod_fee)+' · fee Scalev '+rpFull(t.scalev_fee):'belum ada spend');
  put('ikCr',t.orders?pct(100*t.confirmed/t.orders):'—');
  put('ikCrD',int(t.confirmed)+' closing dari '+int(t.orders)+' lead · pending '+int(t.pending)+' · cancel '+int(t.canceled)+' · CPR '+(t.orders?rpFull(t.spend/t.orders):'—'));
  put('ikPeriod','Gabungan produk → Campaign → Ad set → Ad · '+fmtRange(d.from,d.to)+
    (d.last_sync?' · Meta disinkron '+tglWib(d.last_sync,true)+' WIB':''));
  const lacak=rows.filter(r=>r.level===3&&r.untracked).reduce((a,r)=>a+r.orders,0),n=$('ikNote');
  // Campaign tanpa kode gabungan disembunyikan — sebutkan jumlah & spend-nya supaya tidak hilang diam-diam.
  const tanpa=(d.rows||[]).filter(r=>r.level===2&&!r.gab&&(!$('ikBm').value||r.parent===$('ikBm').value));
  const cat=[];
  if(tanpa.length)cat.push(int(tanpa.length)+' campaign tanpa kode gabungan produk disembunyikan (spend '+rpFull(tanpa.reduce((a,r)=>a+r.spend,0))+
    ', '+int(tanpa.reduce((a,r)=>a+r.orders,0))+' order). Kode diambil dari nama campaign dan harus sama dengan nama gabungan di Data Produk ('+
    ((d.gabungan||[]).map(g=>g.name).join(', ')||'belum ada gabungan')+').');
  if(lacak)cat.push(int(lacak)+' order hanya terlacak sampai level campaign (utm_term / utm_content bukan id Meta) — tampil sebagai baris "(ad set tidak terlacak)".');
  // Kelengkapan biaya Net Profit (angka dari baris total yang tampil)
  if(t.hpp_kurang)cat.push('* HPP: '+int(t.hpp_kurang)+' dari '+int(t.confirmed)+' order closing belum punya HPP (varian tidak cocok dengan katalog Scalev atau COGS-nya kosong) — dihitung Rp 0. Lengkapi COGS di Scalev atau HPP di Data Produk › Manajemen SKU.');
  if(t.tanpa_paket)cat.push('* Ongkir: '+int(t.tanpa_paket)+' order sudah dikirim tapi paket Mengantar-nya tidak ditemukan (nomor order / resi tidak cocok) — ongkir & COD fee-nya belum terhitung.');
  if(t.ongkir_estimasi)cat.push(int(t.ongkir_estimasi)+' order memakai tarif ongkir Mengantar sebelum potongan karena resinya belum ditagih di saldo Mengantar — ongkir asli biasanya lebih kecil.');
  const noId=rows.filter(r=>r.noId).reduce((a,r)=>a+r.orders,0);
  if(noId)cat.push(int(noId)+' order berisi produk gabungan tanpa id campaign Meta di UTM — dihitung ke gabungannya lewat produk (baris "(order tanpa id campaign)"), tidak dibagi ke campaign. CPR & ROAS gabungan memakai semua order ini.');
  if($('ikBm').value)cat.push('Filter BM aktif: baris "(order tanpa id campaign)" disembunyikan karena order tanpa id tidak bisa dipilah per BM.');
  n.hidden=!cat.length;
  n.innerHTML=cat.map(esc).join('<br>');
}

async function loadIklan(){
  if(ikBusy)return;ikBusy=true;
  const r=rentang('ikRange');
  $('ikRows').innerHTML='<tr><td colspan="17" style="color:var(--muted)">Memuat…</td></tr>';
  try{
    ikData=await api('/api/report/iklan?'+new URLSearchParams({from:r.from,to:r.to}));
    // Isi pilihan BM dari data; pilihan yang aktif dipertahankan
    const sel=$('ikBm'),pilih=sel.value,bms=(ikData.rows||[]).filter(x=>x.level===1);
    sel.innerHTML='<option value="">Semua BM</option>'+bms.map(b=>'<option value="'+esc(b.id)+'"'+(b.id===pilih?' selected':'')+'>'+esc(b.name)+'</option>').join('');
    const sg=$('ikGab'),pg=sg.value;
    sg.innerHTML='<option value="">Semua gabungan produk</option>'+(ikData.gabungan||[]).map(g=>'<option'+(g.name===pg?' selected':'')+'>'+esc(g.name)+'</option>').join('');
    if(!ikBuka.size)(ikData.gabungan||[]).forEach(g=>ikBuka.add('g:'+g.name));
    renderIklan();
  }catch(e){
    ikData=null;$('ikRows').innerHTML='<tr><td colspan="17" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>';
  }finally{ikBusy=false}
}

$('ikRange').addEventListener('click',e=>{if(e.target.closest('button'))loadIklan()});
$('ikStatus').addEventListener('click',e=>{if(e.target.closest('button')&&ikData)renderIklan()});
$('ikBm').addEventListener('change',()=>{if(ikData)renderIklan()});
$('ikGab').addEventListener('change',()=>{if(ikData)renderIklan()});
$('ikCari').addEventListener('input',()=>{if(ikData)renderIklan()});
$('ikRows').addEventListener('click',e=>{
  const tr=e.target.closest('tr[data-anak]');if(!tr)return;
  const id=tr.dataset.anak;
  if(ikBuka.has(id))ikBuka.delete(id);else ikBuka.add(id);
  renderIklan();
});
$('ikExport').addEventListener('click',()=>{
  if(!ikData)return;
  const rows=ikSaring(),byId=new Map(rows.map(r=>[r.id,r]));
  const jalur=r=>{const p=[];let x=r;while(x){p.unshift(x.name);x=byId.get(x.parent)}return p};
  unduhCsv('iklan-meta-'+ikData.from+'_'+ikData.to+'.csv',
    ['Level','Gabungan','Campaign','Ad set','Ad','Status','BM','Spend','Impresi','Link klik','Lead','Pending','Closing','Cancel','Revenue','HPP','Scalev Fee','Ongkir','COD Fee','Net Profit','ROAS','ROI (%)'],
    rows.slice().sort((a,b)=>jalur(a).join('|').localeCompare(jalur(b).join('|'))).map(r=>{const j=jalur(r);
      return [IK_TAG[r.level],j[0],j[1]||'',j[2]||'',j[3]||'',r.level===2&&!r.noId?r.status:'',r.bm||'',r.spend,r.impressions,r.link_clicks,
        r.orders,r.pending,r.confirmed,r.canceled,r.revenue_closing,r.hpp,r.scalev_fee,r.ongkir,r.cod_fee,ikNet(r),r.spend?Math.round(100*r.revenue_closing/r.spend)/100:'',r.spend?Math.round(1000*ikNet(r)/r.spend)/10:''];}));
});
function openIklan(){loadIklan()}

/**
 * Iklan Meta › Konten: performa per ad, dikelompokkan per editor konten (kode di nama iklan) dan per
 * kelompok (kode gabungan produk di nama campaign, sama dengan halaman Campaign & Ad).
 * Omzet Meta & pembelian = pixel purchase; ROI (M) = (omzet Meta − spend) ÷ spend; CPL = spend ÷ lead Scalev (utm_content);
 * CPP = spend ÷ pembelian pixel. Hook = tayangan ≥3 detik ÷ impressions, hold = ThruPlay ÷ tayangan ≥3 detik (iklan video saja).
 */
const KF_BARIS=100;                   // baris per kelompok sebelum tombol "Tampilkan semua"
const KF_TANPA_KODE='(tanpa kode)',KF_TANPA_GAB='(tanpa kelompok)';
let kfData=null,kfBusy=false,kfEditId=null;
const kfTerbuka=new Set(),kfSemua=new Set();

/** Kode pertama di nama (dipisah per kata, tidak peka huruf besar/kecil) yang ada di peta kode → nilai. */
function kfKode(nama,peta){
  for(const t of String(nama||'').toUpperCase().split(/[^A-Z0-9]+/))if(peta.has(t))return peta.get(t);
  return null;
}

/** Lengkapi tiap ad dengan editor & kelompok, lalu hitung metrik turunannya. */
function kfSiapkan(d){
  const petaEd=new Map(),petaGab=new Map((d.gabungan||[]).map(g=>[g.trim().toUpperCase(),g]));
  for(const e of d.editors||[])for(const k of e.codes)petaEd.set(k,e.name);
  for(const a of d.ads){
    a.editor=kfKode(a.name,petaEd)||KF_TANPA_KODE;
    a.gab=kfKode(a.campaign_name,petaGab)||KF_TANPA_GAB;
    // Info kreatif (video_id/object_type) sering kosong; iklan yang punya tayangan ≥3 detik pasti video
    a.video=!!(a.video_id||a.object_type==='VIDEO'||a.video_3s>0);
    Object.assign(a,kfMetrik(a));
  }
}

/** Metrik turunan dari jumlah mentah (satu ad atau gabungan beberapa ad). */
function kfMetrik(t){
  const vImp=t.vImp!=null?t.vImp:(t.video?t.impressions:0),v3=t.v3!=null?t.v3:(t.video?t.video_3s:0),vTp=t.vTp!=null?t.vTp:(t.video?t.thruplay:0);
  return {cpm:t.impressions?1000*t.spend/t.impressions:null, ctr:t.impressions?100*t.link_clicks/t.impressions:null,
    roas:t.spend?t.purchase_value/t.spend:null, roi:t.spend?100*(t.purchase_value-t.spend)/t.spend:null,
    cpl:t.orders?t.spend/t.orders:null, cpp:t.purchases?t.spend/t.purchases:null,
    hook:vImp&&v3?100*v3/vImp:null, hold:v3?100*vTp/v3:null};
}

/** Jumlahkan sekumpulan ad; angka video hanya dari iklan video supaya hook rate tidak terseret iklan gambar. */
function kfJumlah(list){
  const t={n:0,spend:0,impressions:0,link_clicks:0,purchases:0,purchase_value:0,orders:0,closing:0,vImp:0,v3:0,vTp:0};
  for(const a of list){
    t.n++;for(const k of ['spend','impressions','link_clicks','purchases','purchase_value','orders','closing'])t[k]+=a[k]||0;
    if(a.video){t.vImp+=a.impressions;t.v3+=a.video_3s;t.vTp+=a.thruplay}
  }
  return Object.assign(t,kfMetrik(t));
}

/** Filter bersama. tanpaEditor=true untuk tabel editor, supaya semua editor tetap terlihat saat satu dipilih. */
function kfSaring(tanpaEditor){
  const q=$('kfCari').value.trim().toLowerCase(),gab=$('kfGab').value,akun=$('kfAkun').value,ed=$('kfEditor').value;
  return kfData.ads.filter(a=>(a.spend>0||a.orders>0)&&(!gab||a.gab===gab)&&(!akun||a.account_id===akun)&&(tanpaEditor||!ed||a.editor===ed)&&
    (!q||(a.name+' '+(a.campaign_name||'')+' '+(a.adset_name||'')).toLowerCase().includes(q)));
}

function kfUrutkan(list){
  const k=$('kfUrut').value,naik=k==='cpl'||k==='cpp';
  // Nilai kosong (mis. CPP tanpa pembelian) selalu di bawah
  const v=a=>a[k]==null?(naik?Infinity:-Infinity):a[k];
  return list.slice().sort((a,b)=>(naik?v(a)-v(b):v(b)-v(a))||b.spend-a.spend);
}

// Sel metrik yang sama untuk tabel editor dan rincian iklan
const kfSel=t=>'<td class="n c-spend">'+rpFull(t.spend)+'</td><td class="n c-rev">'+rpFull(t.purchase_value)+'</td>'+
  '<td class="n">'+(t.cpm==null?'—':rpFull(t.cpm))+'</td>'+
  '<td class="n"><b class="'+(t.roi==null?'':t.roi>=0?'c-rev':'c-loss')+'">'+(t.roi==null?'—':(t.roi>=0?'+':'')+pct(t.roi))+'</b></td>'+
  '<td class="n c-rev">'+pct(t.ctr)+'</td><td class="n">'+(t.cpl==null?'—':rpFull(t.cpl))+'</td>'+
  '<td class="n c-pb">'+pct(t.hook)+'</td><td class="n c-pb">'+pct(t.hold)+'</td><td class="n">'+(t.cpp==null?'—':rpFull(t.cpp))+'</td>';

function renderKonten(){
  const d=kfData,list=kfSaring(false);
  put('kfPeriod',fmtRange(d.from,d.to)+' · omzet & pembelian = pixel Meta · lead dari Scalev lewat UTM id ad'+(d.last_sync?' · sinkron Meta '+tglWib(d.last_sync,true)+' WIB':''));

  // Filter aktif ditampilkan di atas kartu — semua angka di halaman mengikuti filter ini
  const aktif=[['kfEditor','Editor'],['kfGab','Kelompok'],['kfAkun','Akun']].filter(([id])=>$(id).value)
    .map(([id,l])=>'<button type="button" data-hapus="'+id+'" title="Hapus filter ini">'+l+': '+esc($(id).selectedOptions[0].textContent)+' ×</button>');
  const q=$('kfCari').value.trim();
  if(q)aktif.push('<button type="button" data-hapus="kfCari" title="Hapus pencarian">Cari: '+esc(q)+' ×</button>');
  const semua=kfJumlah(kfData.ads.filter(a=>a.spend>0||a.orders>0));
  $('kfAktif').hidden=!aktif.length;
  $('kfAktif').innerHTML='<span>Angka di bawah hanya untuk filter:</span>'+aktif.join('')+
    '<button type="button" class="reset" data-hapus="*">Tampilkan semua ('+rpFull(semua.spend)+' spend)</button>';

  // KPI
  const t=kfJumlah(list);
  put('kfK1',int(t.n));put('kfK1D',int(list.filter(a=>a.video).length)+' video · '+int(list.filter(a=>!a.video).length)+' gambar'+(aktif.length?' · dari '+int(semua.n)+' iklan':''));
  put('kfK2',rpFull(t.spend));put('kfK2D','CPM '+(t.cpm==null?'—':rpFull(t.cpm)));
  put('kfK3',rpFull(t.purchase_value));
  put('kfK4',t.roas==null?'—':nf2.format(t.roas)+'×');put('kfK4D','ROI '+(t.roi==null?'—':(t.roi>=0?'+':'')+pct(t.roi)));
  put('kfK5',int(t.purchases));put('kfK5D','CPP '+(t.cpp==null?'—':rpFull(t.cpp)));
  put('kfK6',pct(t.ctr));put('kfK6D',int(t.link_clicks)+' klik link');
  put('kfK7',t.cpl==null?'—':rpFull(t.cpl));put('kfK7D',int(t.orders)+' lead Scalev · '+int(t.closing)+' closing');

  // Tabel editor: editor terdaftar + "(tanpa kode)", urut spend
  const edPilih=$('kfEditor').value,perEd=new Map();
  for(const a of kfSaring(true)){const x=perEd.get(a.editor)||[];x.push(a);perEd.set(a.editor,x)}
  const edInfo=new Map((d.editors||[]).map(e=>[e.name,e]));
  const baris=[...new Set([...(d.editors||[]).map(e=>e.name),...perEd.keys()])]
    .map(n=>({n,t:kfJumlah(perEd.get(n)||[]),e:edInfo.get(n)}))
    .sort((a,b)=>(a.n===KF_TANPA_KODE)-(b.n===KF_TANPA_KODE)||b.t.spend-a.t.spend);
  $('kfEdRows').innerHTML=baris.length?baris.map(r=>'<tr class="kf-ed'+(r.n===edPilih?' on':'')+'" data-ed="'+esc(r.n)+'">'+
    '<td class="name"><b>'+esc(r.n)+'</b>'+(r.e?' <span class="kf-kode">'+esc(r.e.codes.join(', '))+'</span> <button type="button" class="kf-edit" data-edit="'+r.e.id+'">edit</button>':'')+'</td>'+
    '<td class="n">'+int(r.t.n)+'</td>'+kfSel(r.t)+'</tr>').join('')
    :'<tr><td colspan="11" style="color:var(--muted)">Belum ada iklan pada rentang ini.</td></tr>';

  // Rincian per kelompok
  const perGab=new Map();
  for(const a of kfUrutkan(list)){const x=perGab.get(a.gab)||[];x.push(a);perGab.set(a.gab,x)}
  const grup=[...perGab].map(([g,ads])=>({g,ads,t:kfJumlah(ads)})).sort((a,b)=>(a.g===KF_TANPA_GAB)-(b.g===KF_TANPA_GAB)||b.t.spend-a.t.spend);
  put('kfGrupJudul','Rincian Iklan per Kelompok — '+int(grup.length)+' kelompok');
  $('kfGrup').innerHTML=grup.length?grup.map(({g,ads,t})=>{
    const tampil=kfSemua.has(g)?ads:ads.slice(0,KF_BARIS);
    return '<details class="kf-grp" data-g="'+esc(g)+'"'+(kfTerbuka.has(g)?' open':'')+'>'+
      '<summary><b>'+esc(g)+'</b><span>'+int(ads.length)+' iklan · spend '+rpFull(t.spend)+' · omzet '+rpFull(t.purchase_value)+
        ' · ROAS '+(t.roas==null?'—':nf2.format(t.roas)+'×')+'</span></summary>'+
      '<div class="tbl-wrap"><table class="kf-tbl"><thead><tr><th>Iklan</th><th>Editor</th><th class="n">Spend</th><th class="n">Omzet</th><th class="n">CPM</th>'+
        '<th class="n">ROI (M)</th><th class="n">CTR</th><th class="n">CPL</th><th class="n">Hook</th><th class="n">Hold</th><th class="n">CPP</th></tr></thead><tbody>'+
      tampil.map(a=>{const img=a.image_url||a.thumbnail_url;
        return '<tr><td class="name"><div class="kf-ad">'+
          '<span class="kf-thumb">'+(img?'<img src="'+esc(img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'')+(a.video?'<i>▶</i>':'')+'</span>'+
          '<span><b title="'+esc(a.name)+'">'+esc(a.name)+'</b><small title="'+esc((a.campaign_name||'')+' › '+(a.adset_name||''))+'">'+esc(a.campaign_name||'—')+' · '+esc(a.account_name||'')+'</small></span></div></td>'+
          '<td>'+esc(a.editor)+'</td>'+kfSel(a)+'</tr>'}).join('')+
      '</tbody></table>'+
      (ads.length>tampil.length?'<div class="dp-lagi">Menampilkan '+int(tampil.length)+' dari '+int(ads.length)+' iklan · <button type="button" data-semua="'+esc(g)+'">Tampilkan semua</button></div>':'')+
      '</div></details>';
  }).join(''):'<div style="color:var(--muted)">Tidak ada iklan pada rentang / filter ini.</div>';

  const cat=[];
  if(d.video_belum)cat.push('Sebagian data pada rentang ini ditarik sebelum metrik video tersedia, jadi hook & hold rate belum lengkap — klik "Tarik ulang data Meta".');
  if(!(d.editors||[]).length)cat.push('Belum ada editor terdaftar — klik "Editor baru" dan isi kode yang dipakai di nama iklan.');
  $('kfNote').hidden=!cat.length;$('kfNote').textContent=cat.join(' ');
}

/** Isi pilihan dropdown dari data; pilihan yang sedang aktif dipertahankan. */
function kfIsi(id,semua,opsi){
  const sel=$(id),pilih=sel.value;
  sel.innerHTML='<option value="">'+semua+'</option>'+opsi.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===pilih?' selected':'')+'>'+esc(l)+'</option>').join('');
}

async function loadKonten(){
  if(kfBusy)return;kfBusy=true;
  const r=rentang('kfRange');
  try{
    kfData=await api('/api/report/konten?'+new URLSearchParams({from:r.from,to:r.to}));
    kfSiapkan(kfData);
    const ads=kfData.ads.filter(a=>a.spend>0||a.orders>0);
    const unik=f=>[...new Set(ads.map(f))].sort((a,b)=>(a===KF_TANPA_GAB||a===KF_TANPA_KODE)-(b===KF_TANPA_GAB||b===KF_TANPA_KODE)||a.localeCompare(b,'id'));
    kfIsi('kfGab','Semua kelompok',unik(a=>a.gab).map(g=>[g,g]));
    const akun=new Map(ads.filter(a=>a.account_id).map(a=>[a.account_id,a.account_name||a.account_id]));
    kfIsi('kfAkun','Semua akun',[...akun].sort((a,b)=>a[1].localeCompare(b[1],'id')));
    kfIsi('kfEditor','Semua editor',[...new Set([...(kfData.editors||[]).map(e=>e.name),...unik(a=>a.editor)])].map(n=>[n,n]));
    kfSemua.clear();renderKonten();
  }catch(e){
    kfData=null;
    $('kfGrup').innerHTML='<div style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</div>';
  }finally{kfBusy=false}
}

// Dialog editor baru / edit
function kfBukaDlg(e){
  kfEditId=e?e.id:null;
  const f=$('kfForm');f.nama.value=e?e.name:'';f.kode.value=e?e.codes.join(', '):'';
  put('kfDlgJ',e?'Edit editor: '+e.name:'Editor baru');put('kfDlgMsg','');
  $('kfDlgHapus').hidden=!e;$('kfDlg').showModal();f.nama.focus();
}
$('kfEdBaru').addEventListener('click',()=>kfBukaDlg(null));
$('kfDlgX').addEventListener('click',()=>$('kfDlg').close());
$('kfDlgBatal').addEventListener('click',()=>$('kfDlg').close());
$('kfForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const f=$('kfForm'),codes=f.kode.value.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
  put('kfDlgMsg','Menyimpan…');
  try{
    await api('/api/settings/editor-konten',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:kfEditId||undefined,name:f.nama.value.trim(),codes})});
    $('kfDlg').close();await loadKonten();
  }catch(e){put('kfDlgMsg','Gagal: '+e.message)}
});
$('kfDlgHapus').addEventListener('click',async()=>{
  const e=(kfData.editors||[]).find(x=>x.id===kfEditId);if(!e)return;
  if(!confirm('Hapus editor "'+e.name+'"? Iklannya akan masuk ke '+KF_TANPA_KODE+'.'))return;
  try{await api('/api/settings/editor-konten/'+e.id,{method:'DELETE'});$('kfDlg').close();await loadKonten()}
  catch(err){put('kfDlgMsg','Gagal menghapus: '+err.message)}
});

// Klik baris editor = filter editor (klik lagi = lepas); tombol edit membuka dialog
$('kfEdRows').addEventListener('click',e=>{
  if(!kfData)return;
  const ed=e.target.closest('[data-edit]');
  if(ed){kfBukaDlg((kfData.editors||[]).find(x=>x.id===+ed.dataset.edit));return}
  const tr=e.target.closest('tr[data-ed]');if(!tr)return;
  const sel=$('kfEditor');sel.value=sel.value===tr.dataset.ed?'':tr.dataset.ed;renderKonten();
});
$('kfGrup').addEventListener('toggle',e=>{
  const g=e.target.closest('details[data-g]');if(!g)return;
  if(g.open)kfTerbuka.add(g.dataset.g);else kfTerbuka.delete(g.dataset.g);
},true);
$('kfGrup').addEventListener('click',e=>{const b=e.target.closest('button[data-semua]');if(b){kfSemua.add(b.dataset.semua);renderKonten()}});
$('kfAktif').addEventListener('click',e=>{
  const b=e.target.closest('[data-hapus]');if(!b||!kfData)return;
  const ids=b.dataset.hapus==='*'?['kfEditor','kfGab','kfAkun','kfCari']:[b.dataset.hapus];
  ids.forEach(id=>{$(id).value=''});renderKonten();
});
$('kfRange').addEventListener('click',e=>{if(e.target.closest('button'))loadKonten()});
['kfGab','kfAkun','kfEditor','kfUrut'].forEach(id=>$(id).addEventListener('change',()=>{if(kfData)renderKonten()}));
$('kfCari').addEventListener('input',()=>{if(kfData)renderKonten()});
$('kfTarik').addEventListener('click',async()=>{
  const b=$('kfTarik'),r=rentang('kfRange');if(b.disabled)return;
  b.disabled=true;b.textContent='Menarik data Meta…';
  try{
    const hasil=await api('/api/sync/meta?'+new URLSearchParams({since:r.from,until:r.to}),{method:'POST'});
    const gagal=Object.values(hasil||{}).filter(x=>!x.ok);
    if(gagal.length)alert('Sebagian akun gagal ditarik: '+gagal.map(x=>x.message).join('; '));
    await loadKonten();
  }catch(e){alert('Tarik data Meta gagal: '+e.message)}
  finally{b.disabled=false;b.textContent='Tarik ulang data Meta'}
});
$('kfExport').addEventListener('click',()=>{
  if(!kfData)return;
  const r1=v=>v==null?'':Math.round(v*10)/10;
  unduhCsv('konten-iklan-'+kfData.from+'_'+kfData.to+'.csv',
    ['Iklan','Editor','Kelompok','Campaign','Ad set','Akun','Tipe','Spend','Impressions','Klik link','Omzet Meta','Pembelian','Lead Scalev','Closing Scalev',
      'CPM','ROI (%)','CTR (%)','CPL','Hook rate (%)','Hold rate (%)','CPP'],
    kfUrutkan(kfSaring(false)).map(a=>[a.name,a.editor,a.gab,a.campaign_name,a.adset_name,a.account_name,a.video?'Video':'Gambar',
      a.spend,a.impressions,a.link_clicks,a.purchase_value,a.purchases,a.orders,a.closing,
      a.cpm==null?'':Math.round(a.cpm),r1(a.roi),a.ctr==null?'':Math.round(a.ctr*100)/100,a.cpl==null?'':Math.round(a.cpl),r1(a.hook),r1(a.hold),a.cpp==null?'':Math.round(a.cpp)]));
});

