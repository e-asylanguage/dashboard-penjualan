/**
 * Pengiriman (Mengantar) › Tracking & Masalah: lacak resi, kotak & grafik SLA, daftar paket bermasalah, follow up + WhatsApp + template per status,
 * rekap follow up per CS, ekspor CSV. Data: /api/report/shipments/problems, /shipments/followup, /shipments/wa-template, /api/track/:resi.
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta helper Mengantar
 * shQuery/shIsiKurir/shSync/shKecil/shKosong/shGagal/shStatus dari script utama (window.*), dan loadInRts() dari inventory-inbound-rts.js.
 * Dipanggil dari script utama: loadMasalah() (menu Tracking & Masalah).
 */
// Keterangan kejadian dari kurir (bahasa Inggris) → kalimat yang bisa langsung dipakai CS
const SH_ALASAN=[
  [/INCOMPLETE CONSIGNEE ADDRESS/,'Alamat penerima kurang lengkap'],
  [/CONSIGNEE UNKNOWN/,'Penerima tidak dikenal di alamat tujuan'],
  [/NOBODY AT HOME/,'Penerima tidak ada di tempat saat diantar'],
  [/REFUSED? TO RECEIVE/,'Penerima menolak paket (merasa tidak pesan)'],
  [/REFUSED? TO PAY/,'Penerima menolak membayar COD'],
  [/WAITING COD PAYMENT/,'Menunggu pembayaran COD dari penerima'],
  [/SHIPMENT PROBLEM/,'Ada masalah pengiriman di kurir'],
  [/HELD AS SHIPPER/,'Ditahan atas permintaan pengirim'],
  [/WITH DELIVERY COURIER/,'Dibawa kurir ke penerima'],
  [/DELIVERED/,'Terkirim'],
  [/RETURN/,'Proses retur ke pengirim'],
  [/PICKED UP/,'Diambil kurir dari gudang'],
  [/PROCESS AND FORWARD/,'Diteruskan ke hub tujuan'],
  [/SORTING CENTER/,'Diproses di pusat sortir'],
  [/TRANSIT/,'Transit antarkota'],
  [/RECEIVED AT|WAREHOUSE/,'Tiba di gudang / agen kurir'],
];
const shAlasan=d=>{const s=String(d||'').toUpperCase();for(const [re,t] of SH_ALASAN)if(re.test(s))return t;return d||'—'};
const hari1=v=>v==null?'—':nf.format(v)+' hari';

// ---------- 2. Tracking & Masalah
let mmData=null,mmBusy=false,mmChartD=null,mmChartK=null,mmKat='',mmTplIsi=null;
const MM_KAT=['Gagal antar','Proses retur','Tiket komplain','Lewat SLA','Tidak bergerak','Paket hilang','Sedang diantar'];
const MM_KAT_TONE={'Gagal antar':'loss','Proses retur':'loss','Paket hilang':'loss','Tiket komplain':'spend','Lewat SLA':'spend','Tidak bergerak':'info','Sedang diantar':'rev'};
// "Sedang diantar" (status Mengantar DELIVERY COURIER) bukan masalah: tidak masuk KPI, grafik, rekap CS, dan pilihan "Semua"
const MM_DIANTAR='Sedang diantar',mmMasalah=rows=>(rows||[]).filter(r=>r.kategori!==MM_DIANTAR);
// Kritis: lebih dari 14 hari tanpa update dari kurir (sejak status/scan pengiriman terakhir) → kemungkinan hilang / terselip;
// tindakannya klaim ke ekspedisi, bukan follow up pembeli.
// Filter tambahan di atas kategori (satu paket tetap punya kategorinya sendiri), "Sedang diantar" tidak dihitung.
const MM_KRITIS='Kritis',MM_KRITIS_HARI=14,mmDiam=r=>(Number(r.hours_since_update)||0)/24,mmKritis=r=>r.kategori!==MM_DIANTAR&&mmDiam(r)>MM_KRITIS_HARI;
// Melebihi SLA: paket masih di jalan yang umurnya lewat SLA Mengantar, apa pun kategorinya (termasuk sedang diantar).
// Dibuka juga dari peringatan SLA di Ringkasan Paket.
const MM_LEWAT='Melebihi SLA',mmLewat=r=>!!Number(r.lewat_sla);
const mmCocokKat=r=>mmKat===MM_KRITIS?mmKritis(r):mmKat===MM_LEWAT?mmLewat(r):mmKat?r.kategori===mmKat:r.kategori!==MM_DIANTAR;
const MM_FU={dihubungi:'Sudah dihubungi',siap_terima:'Siap terima',tidak_respon:'Tidak respon',menolak:'Menolak',selesai:'Selesai'};
const MM_TPL_BAWAAN='Halo Kak {nama} 🙏\n\nKami ingin mengonfirmasi pesanan *{barang}* dengan resi *{resi}* ({kurir}).\nInfo terakhir dari kurir: {alasan}.\n\nBoleh dibantu supaya paketnya bisa diterima ya Kak? {info_cod}\nTerima kasih 🙏';
// Template bawaan per status paket; yang disimpan user (mmTplIsi[kategori]) didahulukan
const MM_TPL_KAT={
  'Gagal antar':MM_TPL_BAWAAN,
  'Proses retur':'Halo Kak {nama} 🙏\n\nPaket *{barang}* dengan resi *{resi}* ({kurir}) saat ini sedang dalam proses dikembalikan ke kami.\nInfo terakhir dari kurir: {alasan}.\n\nApakah Kakak masih ingin menerima pesanan ini? Jika ya, mohon konfirmasi alamat & nomor yang bisa dihubungi, nanti kami bantu kirim ulang. {info_cod}\nTerima kasih 🙏',
  'Tiket komplain':'Halo Kak {nama} 🙏\n\nKami sedang menindaklanjuti kendala pengiriman paket *{barang}* dengan resi *{resi}* ({kurir}) ke pihak ekspedisi.\nInfo terakhir dari kurir: {alasan}.\n\nMohon ditunggu ya Kak, kami kabari lagi perkembangannya. Jika ada info tambahan dari Kakak, silakan balas pesan ini.\nTerima kasih 🙏',
  'Lewat SLA':'Halo Kak {nama} 🙏\n\nMohon maaf, paket *{barang}* dengan resi *{resi}* ({kurir}) mengalami keterlambatan pengiriman.\nInfo terakhir dari kurir: {alasan}.\n\nKami terus memantau supaya paket segera sampai di {kota}. Mohon pastikan nomor HP aktif agar kurir mudah menghubungi ya Kak. {info_cod}\nTerima kasih atas kesabarannya 🙏',
  'Tidak bergerak':'Halo Kak {nama} 🙏\n\nKami melihat status paket *{barang}* dengan resi *{resi}* ({kurir}) belum ada pembaruan beberapa waktu ini.\nInfo terakhir dari kurir: {alasan}.\n\nKami sedang cek ke pihak ekspedisi. Boleh dibantu konfirmasi alamat lengkap & patokan rumah Kakak supaya pengiriman lancar?\nTerima kasih 🙏',
  'Paket hilang':'Halo Kak {nama} 🙏\n\nMohon maaf, paket *{barang}* dengan resi *{resi}* ({kurir}) dilaporkan bermasalah di ekspedisi.\nInfo terakhir dari kurir: {alasan}.\n\nKami sedang mengurus klaim ke pihak ekspedisi dan akan segera mengabari solusinya untuk Kakak.\nTerima kasih atas pengertiannya 🙏',
  'Sedang diantar':'Halo Kak {nama} 😊\n\nKabar baik! Paket *{barang}* dengan resi *{resi}* ({kurir}) sedang dibawa kurir menuju alamat Kakak.\n\nMohon pastikan ada yang bisa menerima di rumah dan HP tetap aktif ya Kak. {info_cod}\nTerima kasih 🙏'
};
const mmTplDari=kat=>mmTplIsi&&mmTplIsi[kat]||MM_TPL_KAT[kat]||mmTplIsi&&mmTplIsi['']||MM_TPL_BAWAAN;
function mmTplTampil(kat){
  $('mmTplKat').value=kat;$('mmTplText').value=mmTplDari(kat);
  put('mmTplInfo',mmTplIsi&&mmTplIsi[kat]?'· template Anda sendiri':'· template bawaan');put('mmTplMsg','');
}

async function loadMasalah(){
  if(mmBusy)return;mmBusy=true;
  try{
    const tpl=mmTplIsi==null?api('/api/report/shipments/wa-template').catch(()=>({})):null;
    mmData=await api('/api/report/shipments/problems?'+shQuery('mm').q);
    if(tpl){const t=await tpl;mmTplIsi=t&&t.templates||{};
      $('mmTplKat').innerHTML=MM_KAT.map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');mmTplTampil(mmKat||MM_KAT[0])}
    renderMasalah(mmData);
  }catch(e){shGagal(['mmRows','mmSlaRows'],e)}
  finally{mmBusy=false}
}

function renderMasalah(d){
  put('mmPeriod','Mengantar · paket dibuat '+fmtRange(d.from,d.to)+shSync(d));
  shIsiKurir('mmKurir',d.couriers,d.gudangs);
  const pr=mmMasalah(d.problems),sla=d.sla||[];
  const sum=k=>sla.reduce((a,r)=>a+(r[k]||0),0);
  const codRisiko=pr.reduce((a,r)=>a+(r.is_cod?r.cod_amount:0),0);
  const sudahFu=pr.filter(r=>r.fu_status).length;
  $('mmKpiMasalah').innerHTML=int(pr.length)+shKecil(sum('on_going')?pct(100*pr.length/sum('on_going'))+' dari di jalan':'');
  put('mmKpiMasalahD','COD berisiko '+rpFull(codRisiko)+' · '+int(sudahFu)+' sudah di-follow up');
  $('mmKpiLewat').innerHTML=int(sum('on_going_late'))+shKecil(sum('on_going')?pct(100*sum('on_going_late')/sum('on_going')):'—');
  put('mmKpiLewatD','dari '+int(sum('on_going'))+' paket yang masih di jalan');
  const kirim=sum('delivered'),rata=k=>kirim?sla.reduce((a,r)=>a+(r[k]||0)*(r.delivered||0),0)/kirim:null;
  const avgD=rata('avg_days'),avgS=rata('avg_sla');
  $('mmKpiDurasi').textContent=avgD==null?'—':nf.format(Math.round(avgD*10)/10)+' hari';
  put('mmKpiDurasiD',avgS==null?'Belum ada paket terkirim':'Rata-rata SLA '+nf.format(Math.round(avgS*10)/10)+' hari · '+int(kirim)+' paket terkirim');
  const withSla=sum('with_sla'),tepat=sum('on_time');
  $('mmKpiTepat').textContent=withSla?pct(100*tepat/withSla):'—';
  put('mmKpiTepatD',int(tepat)+' dari '+int(withSla)+' paket terkirim ber-SLA');

  $('mmSlaRows').innerHTML=sla.length?sla.map(r=>{
    const p=r.with_sla?100*r.on_time/r.with_sla:null;
    const tp=p==null?'—':(p<80?'<span class="sh-rts">'+pct(p)+'</span>':pct(p));
    return '<tr><td class="name">'+esc(r.courier||'—')+'</td><td class="n">'+int(r.delivered)+'</td><td class="n">'+hari1(r.avg_days)+'</td>'+
      '<td class="n">'+hari1(r.avg_sla)+'</td><td class="n">'+tp+'<small>'+int(r.on_time)+' dari '+int(r.with_sla)+'</small></td>'+
      '<td class="n">'+int(r.on_going_late)+'<small>dari '+int(r.on_going)+' di jalan</small></td><td class="n">'+int(r.problems)+'</td></tr>'}).join(''):shKosong(7);

  drawDurasi(d.durations||[]);
  drawKategori(pr);
  renderMmRows();
  renderMmCs();
}

/**
 * Rekap follow up per CS: rekap_cs dari server (semua paket di rentang yang pernah di-follow up) digabung dengan
 * paket bermasalah sekarang dan yang belum di-follow up dari daftar masalah.
 */
function mmCsRekap(){
  const m=new Map(),nol={fu:0,wa:0,dihubungi:0,siap_terima:0,tidak_respon:0,menolak:0,selesai:0,terkirim:0,rts:0,hilang:0,jalan:0};
  const ambil=cs=>{const k=cs||'';if(!m.has(k))m.set(k,Object.assign({cs:k,masalah:0,belum:0},nol));return m.get(k)};
  for(const r of mmData&&mmData.rekap_cs||[])Object.assign(ambil(r.cs),Object.fromEntries(Object.keys(nol).map(k=>[k,Number(r[k])||0])));
  for(const r of mmMasalah(mmData&&mmData.problems)){const t=ambil(r.cs);t.masalah++;if(!r.fu_status)t.belum++}
  return [...m.values()].sort((a,b)=>b.fu-a.fu||b.masalah-a.masalah);
}
const mmCsSelamat=t=>{const n=t.terkirim+t.rts+t.hilang;return n?100*t.terkirim/n:null};
function renderMmCs(){
  const rows=mmCsRekap();
  $('mmCsRows').innerHTML=rows.length?rows.map(t=>{const s=mmCsSelamat(t);
    return '<tr><td class="name">'+(t.cs?esc(t.cs):'<span style="color:var(--muted)">(tanpa CS)</span>')+'</td>'+
      '<td class="n">'+int(t.masalah)+(t.belum?'<small class="sh-rts">'+int(t.belum)+' belum di-follow up</small>':'')+'</td>'+
      '<td class="n">'+int(t.fu)+'</td><td class="n">'+int(t.wa)+'</td><td class="n">'+int(t.siap_terima)+'</td>'+
      '<td class="n">'+(t.menolak?'<span class="sh-rts">'+int(t.menolak)+'</span>':'0')+'</td><td class="n">'+int(t.tidak_respon)+'</td>'+
      '<td class="n">'+int(t.terkirim)+'</td><td class="n">'+int(t.rts+t.hilang)+(t.hilang?'<small>'+int(t.hilang)+' hilang</small>':'')+'</td><td class="n">'+int(t.jalan)+'</td>'+
      '<td class="n"><b>'+(s==null?'—':pct(s))+'</b></td></tr>'}).join(''):shKosong(11,'Belum ada paket yang di-follow up pada rentang ini.');
}
/** Perbarui rekap CS di browser setelah follow up satu paket bermasalah disimpan (tanpa memuat ulang) */
function mmCsUbah(r,lama){
  let t=(mmData.rekap_cs=mmData.rekap_cs||[]).find(x=>(x.cs||'')===(r.cs||''));
  if(!t){t={cs:r.cs||''};mmData.rekap_cs.push(t)}
  // Kurangi sumbangan lama paket ini, lalu tambahkan yang baru (follow up dikembalikan ke "Belum" = tidak dihitung)
  const ubah=(s,wa,n)=>{if(!s)return;for(const k of ['fu',s,r.kategori==='Paket hilang'?'hilang':'jalan'])t[k]=(Number(t[k])||0)+n;t.wa=(Number(t.wa)||0)+n*(Number(wa)||0)};
  ubah(lama.status,lama.wa,-1);ubah(r.fu_status,r.fu_count,1);
}

function mmFiltered(){
  const fu=(document.querySelector('#mmFu button.on')||{}).dataset||{};
  return (mmData&&mmData.problems||[]).filter(r=>mmCocokKat(r)&&
    (!fu.fu||(fu.fu==='belum'?!r.fu_status:!!r.fu_status)));
}

const MM_TIKET={open:'Terbuka',replied:'Dibalas',closed:'Ditutup',resolved:'Selesai'};
/** Ikon "i" di kolom Masalah: rincian yang tadinya memenuhi sel (keterangan asli kurir, waktu kejadian, status Mengantar) */
function mmInfo(r){
  const asli=String(r.last_desc||'').trim(),isi=[shAlasan(r.last_desc||r.status)];
  if(asli&&asli.toUpperCase()!==isi[0].toUpperCase())isi.push('Kurir: '+asli);
  if(r.last_date)isi.push('Waktu: '+r.last_date);
  if(r.status)isi.push('Status Mengantar: '+r.status);
  const t=isi.join('\n');
  return '<span class="is-info" data-tip="'+esc(t)+'" aria-label="'+esc(t)+'" role="img" tabindex="0">i</span>';
}
// Paket yang dicentang (resi) untuk "Salin resi terpilih" — follow up ke PIC ekspedisi, bukan ke pembeli
const mmPilih=new Set();
/** Paket tercentang yang sedang tampil (filter aktif), urut seperti di tabel */
const mmTerpilih=()=>mmFiltered().filter(r=>r.receipt&&mmPilih.has(r.receipt));
function mmPilihTampil(){
  const tampil=mmFiltered().filter(r=>r.receipt),n=tampil.filter(r=>mmPilih.has(r.receipt)).length,b=$('mmSalin'),c=$('mmCekSemua');
  b.disabled=!n;b.textContent=n?'Salin '+int(n)+' resi terpilih':'Salin resi terpilih';
  c.checked=!!n&&n===tampil.length;c.indeterminate=!!n&&n<tampil.length;c.disabled=!tampil.length;
}
/** Teks siap tempel ke grup WA ekspedisi: dikelompokkan per kurir, satu baris per resi */
function mmTeksResi(rows){
  const per=new Map();for(const r of rows){const k=r.courier||'Kurir lain';if(!per.has(k))per.set(k,[]);per.get(k).push(r)}
  const klaim=rows.every(mmKritis);
  return [...per].map(([kurir,list])=>(klaim?'Mohon investigasi / proses klaim '+list.length+' paket '+kurir+' berikut (sudah lebih dari '+MM_KRITIS_HARI+' hari tanpa update pengiriman):':'Mohon bantu cek '+list.length+' paket '+kurir+' berikut:')+'\n'+list.map((r,i)=>(i+1)+'. '+r.receipt+' — '+r.kategori+
    (r.days_in_transit!=null?', '+nf.format(r.days_in_transit)+' hari':'')+([r.receiver_city,r.receiver_region].filter(Boolean).length?', tujuan '+[r.receiver_city,r.receiver_region].filter(Boolean).join(', '):'')+
    (r.last_desc?' ('+String(r.last_desc).trim()+(r.last_date?' · '+r.last_date:'')+')':'')).join('\n')).join('\n\n');
}
async function mmSalinTeks(t){
  try{await navigator.clipboard.writeText(t);return true}catch(e){}
  // Cadangan untuk browser yang menolak Clipboard API
  const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();
  let ok=false;try{ok=document.execCommand('copy')}catch(e){}a.remove();return ok;
}
function renderMmRows(){
  const semua=mmData&&mmData.problems||[],masalah=mmMasalah(semua);
  const n={};semua.forEach(r=>n[r.kategori]=(n[r.kategori]||0)+1);
  const kritis=semua.filter(mmKritis),lewat=semua.filter(mmLewat);
  if(mmKat&&!(mmKat===MM_KRITIS?kritis.length:mmKat===MM_LEWAT?lewat.length:n[mmKat]))mmKat='';
  // Peringatan klaim: muncul selama ada paket kritis, apa pun filter yang sedang dipilih
  const kw=$('mmKritisWarn');kw.hidden=!kritis.length;
  if(kritis.length){const cod=kritis.reduce((a,r)=>a+(r.is_cod?r.cod_amount:0),0),tua=Math.max(...kritis.map(mmDiam));
    put('mmKritisTeks',int(kritis.length)+' paket sudah lebih dari '+MM_KRITIS_HARI+' hari tanpa update dari kurir sejak pengiriman terakhir (terlama '+nf.format(Math.round(tua))+' hari'+(cod?', nilai COD '+rpFull(cod):'')+
      '). Kemungkinan hilang atau terselip di gudang kurir — segera ajukan investigasi / klaim ganti rugi ke ekspedisi, bukan lagi mengejar pembeli.')}
  // Chip "Sedang diantar" selalu tampil (terpisah di kanan) supaya paket yang sedang dibawa kurir mudah dicari
  $('mmKat').innerHTML='<button class="'+(mmKat?'':'on')+'" data-kat="">Semua <small>'+int(masalah.length)+'</small></button>'+
    MM_KAT.filter(k=>n[k]&&k!==MM_DIANTAR).map(k=>'<button class="'+(mmKat===k?'on':'')+'" data-kat="'+esc(k)+'">'+esc(k)+' <small>'+int(n[k])+'</small></button>').join('')+
    (kritis.length?'<button class="mm-kritis'+(mmKat===MM_KRITIS?' on':'')+'" data-kat="'+MM_KRITIS+'" title="Lebih dari '+MM_KRITIS_HARI+' hari tanpa update dari kurir sejak pengiriman terakhir — ajukan klaim ke ekspedisi">Kritis: &gt; '+MM_KRITIS_HARI+' hari <small>'+int(kritis.length)+'</small></button>':'')+
    (lewat.length?'<button class="mm-kritis'+(mmKat===MM_LEWAT?' on':'')+'" data-kat="'+MM_LEWAT+'" title="Paket masih di jalan yang umurnya melebihi SLA dari Mengantar, termasuk yang sedang diantar">⚠️ '+MM_LEWAT+' <small>'+int(lewat.length)+'</small></button>':'')+
    '<button class="mm-diantar'+(mmKat===MM_DIANTAR?' on':'')+'" data-kat="'+MM_DIANTAR+'" title="Status Mengantar DELIVERY COURIER — paket sedang dibawa kurir ke penerima">🚚 '+MM_DIANTAR+' <small>'+int(n[MM_DIANTAR]||0)+'</small></button>';
  const pr=mmFiltered();
  put('mmMasalahN',int(pr.length)+' paket');
  const jam=h=>h==null?'—':(h>=48?'<b style="color:var(--loss)">'+(h>=72?nf.format(Math.round(h/24*10)/10)+' hari':int(h)+' jam')+'</b>':int(h)+' jam');
  $('mmRows').innerHTML=pr.length?pr.map(r=>{
    const lewat=r.sla_days&&r.days_in_transit>r.sla_days;
    const telp=waNomor(r.receiver_phone);
    const alasan=shAlasan(r.last_desc||r.status),tiket=r.ticket&&r.ticket!=='none'?String(r.ticket):'';
    return '<tr data-resi="'+esc(r.receipt||'')+'"'+(r.receipt&&mmPilih.has(r.receipt)?' class="mm-dipilih"':'')+'>'+
      '<td class="mm-cek"><input type="checkbox" data-pilih="'+esc(r.receipt||'')+'" aria-label="Pilih paket '+esc(r.receipt||'')+'"'+(r.receipt?(mmPilih.has(r.receipt)?' checked':''):' disabled title="Resi belum terbit"')+'></td>'+
      '<td class="name">'+(r.receipt?'<button class="mm-resi" data-lacak="'+esc(r.receipt)+'">'+esc(r.receipt)+'</button>':'<span style="color:var(--muted)" title="Paket sudah dibuat di Mengantar tapi resinya belum terbit">Belum ada resi</span>')+'<small class="mm-brg">'+esc(r.goods||'')+'</small></td>'+
      // Kolom Masalah: badge + satu baris alasan; keterangan asli kurir & waktunya di tooltip ikon "i". Tiket komplain di kolom sendiri.
      '<td class="mm-alasan"><span class="mm-kat"><span class="tag '+(MM_KAT_TONE[r.kategori]||'')+'">'+esc(r.kategori)+'</span>'+(mmKritis(r)?'<span class="tag mm-kritis-tag" title="Lebih dari '+MM_KRITIS_HARI+' hari tanpa update dari kurir — ajukan klaim ke ekspedisi">Kritis</span>':'')+mmInfo(r)+'</span>'+
        '<small class="mm-ringkas">'+esc(alasan)+'</small></td>'+
      '<td>'+(tiket?'<span class="tag '+(/open/i.test(tiket)?'loss':/repl/i.test(tiket)?'spend':'')+'">'+esc(MM_TIKET[tiket.toLowerCase()]||tiket)+'</span>':'<span style="color:var(--muted)">—</span>')+'</td>'+
      '<td>'+esc(r.courier||'—')+'<small class="mm-sub">'+esc(r.shipper||'')+'</small></td>'+
      '<td class="n">'+(lewat?'<b style="color:var(--loss)">'+hari1(r.days_in_transit)+'</b>':hari1(r.days_in_transit))+'<small>SLA '+(r.sla_days?r.sla_days+' hari':'—')+'</small></td>'+
      '<td class="n">'+jam(r.hours_since_update)+'</td>'+
      '<td>'+esc(r.receiver_name||'—')+'<small class="mm-sub">'+esc([r.receiver_city,r.receiver_region].filter(Boolean).join(', '))+(r.cs?' · '+esc(r.cs):'')+'</small></td>'+
      '<td class="n">'+(r.is_cod?rpFull(r.cod_amount):'<span style="color:var(--muted)">non-COD</span>')+'</td>'+
      '<td class="mm-fu">'+(telp?'<button class="btn wa" data-wa="'+esc(r.receipt||'')+'">WA</button>':'<span style="color:var(--muted)">tanpa nomor</span>')+
        '<select data-fu="'+esc(r.receipt||'')+'"><option value="">Belum</option>'+Object.entries(MM_FU).map(([k,v])=>'<option value="'+k+'"'+(r.fu_status===k?' selected':'')+'>'+v+'</option>').join('')+'</select>'+
        '<small>'+(r.fu_at?int(r.fu_count)+'× WA · '+tglWib(r.fu_at,true):'')+'</small>'+
        // Catatan internal hasil percakapan (untuk CS shift berikutnya); disimpan di shipment_followups.note
        (r.receipt?'<div class="mm-catat" data-catat="'+esc(r.receipt)+'">'+(r.fu_note?'<span class="mm-catat-isi" title="Catatan internal — klik untuk mengubah">'+esc(r.fu_note)+'</span>':
          '<button type="button" class="mm-catat-tambah">+ Catatan</button>')+'</div>':'')+'</td></tr>'}).join('')
    :shKosong(10,mmKat===MM_DIANTAR?'Tidak ada paket yang sedang dibawa kurir (DELIVERY COURIER).':masalah.length?'Tidak ada paket untuk filter ini.':'Tidak ada paket bermasalah. 🎉');
  mmPilihTampil();
}

/** Nomor HP penerima → format wa.me (62…) */
function waNomor(v){
  let d=String(v||'').replace(/\D/g,'');
  if(!d)return '';
  if(d.startsWith('0'))d='62'+d.slice(1);else if(d.startsWith('8'))d='62'+d;
  return d.length>=10?d:'';
}
function waPesan(r){
  const isi={nama:r.receiver_name||'',resi:r.receipt||'',kurir:r.courier||'',barang:r.goods||'',
    alasan:shAlasan(r.last_desc||r.status),cod:r.is_cod?rpFull(r.cod_amount):'-',kota:r.receiver_city||'',
    info_cod:r.is_cod?'Total yang dibayar saat paket datang '+rpFull(r.cod_amount)+'.':''};
  // Template mengikuti status paket ini; yang sedang terbuka di editor dipakai bila statusnya sama (walau belum disimpan)
  const tpl=$('mmTplKat').value===r.kategori&&$('mmTplText').value.trim()?$('mmTplText').value:mmTplDari(r.kategori);
  return tpl.replace(/\{(\w+)\}/g,(m,k)=>k in isi?isi[k]:m).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function mmSimpanFu(resi,body){
  const r=(mmData.problems||[]).find(x=>x.receipt===resi);
  try{const b=await api('/api/report/shipments/followup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({receipt:resi},body))});
    if(r){const lama={status:r.fu_status,wa:r.fu_count};Object.assign(r,b);mmCsUbah(r,lama)}
    renderMmRows();renderMmCs();
    // "Menolak" → calon RTS di Inbound RTS: muat ulang supaya tab dan badge di sana ikut berubah
    if(body.status!==undefined||body.note!==undefined)loadInRts()}
  catch(e){alert('Follow up gagal disimpan: '+e.message)}
}

function drawDurasi(rows){
  if(typeof Chart==='undefined')return;
  const per=new Map(rows.map(r=>[r.days,r]));
  const hari=[1,2,3,4,5,6,7,8,9,10,11];
  const labels=hari.map(h=>h===11?'>10 hari':h+' hari');
  const a=hari.map(h=>(per.get(h)||{}).on_time||0),b=hari.map(h=>(per.get(h)||{}).late||0);
  if(mmChartD){mmChartD.data.datasets[0].data=a;mmChartD.data.datasets[1].data=b;mmChartD.update();return}
  mmChartD=new Chart(document.getElementById('mmDurasi'),{type:'bar',
    data:{labels,datasets:[
      {label:'Tepat SLA',data:a,backgroundColor:css('--rev'),borderRadius:3,stack:'s'},
      {label:'Lewat SLA',data:b,backgroundColor:css('--loss'),borderRadius:3,stack:'s'}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}}},
      scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{precision:0}}}}});
}
function drawKategori(pr){
  if(typeof Chart==='undefined')return;
  const n={};pr.forEach(r=>n[r.kategori]=(n[r.kategori]||0)+1);
  const k=MM_KAT.filter(x=>n[x]),data=k.map(x=>n[x]);
  const warna=k.map(x=>css('--'+(MM_KAT_TONE[x]||'info')));
  if(mmChartK){mmChartK.data.labels=k;mmChartK.data.datasets[0].data=data;mmChartK.data.datasets[0].backgroundColor=warna;mmChartK.update();return}
  mmChartK=new Chart(document.getElementById('mmKategori'),{type:'bar',
    data:{labels:k,datasets:[{label:'Paket',data,backgroundColor:warna,borderRadius:4,barPercentage:.7}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{precision:0}},y:{grid:{display:false}}}}});
}

/** Lacak satu resi langsung ke Mengantar, lengkap dengan riwayat & foto; hasilnya juga disimpan ke dashboard. */
async function lacakResi(resi){
  const box=$('shLacak');box.hidden=false;box.innerHTML='<div class="sh-hasil-in">Melacak '+esc(resi)+'…</div>';
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
  try{
    const o=await api('/api/track/'+encodeURIComponent(resi));
    const baris=(l,v)=>'<div><span>'+l+'</span><b>'+v+'</b></div>';
    const sk=o.receiverScore||{};
    const hist=(o.history||[]).slice().reverse();
    const foto=h=>[1,2,3,4,5,6,7,8].map(i=>h['photo'+i]).filter(Boolean).map((u,i)=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">Foto '+(i+1)+'</a>').join('');
    box.innerHTML='<div class="sh-hasil-in"><div class="sh-hasil-h"><b>'+esc(o.cnote_no||resi)+'</b> · '+esc(o.courier||'—')+' · '+shStatus(o.status)+
      '<button class="rinci-x" id="shLacakTutup" aria-label="Tutup">×</button></div><div class="sh-hasil-g">'+
      baris('Paket dibuat',tglWib(o.createdAt,true))+baris('Status berubah',o.lastStatusChange?tglWib(Date.parse(o.lastStatusChange)-7*36e5,true):'—')+
      baris('SLA Mengantar',esc(String(o.estimate_delivery||'—').replace('Days','hari')))+
      baris('Tujuan',esc([o.RECEIVER_DISTRICT,o.RECEIVER_CITY,o.RECEIVER_REGION].filter(Boolean).join(', ')||'—'))+
      baris('Gudang',esc(String(o.SHIPPER_NAME||'—').replace(/&#039;/g,"'")))+baris('Barang',esc(o.GOODS_DESC||'—'))+
      baris('Nilai COD',+o.COD_AMOUNT>0?rpFull(+o.COD_AMOUNT):'non-COD')+baris('Ongkir + fee COD',rpFull((+o.price||0)+(+o.COD_FEE||0)))+
      baris('Riwayat penerima di Mengantar',sk.delivered!=null?int(sk.delivered)+' terkirim · '+int(sk.rts)+' RTS · '+int(sk.undelivered)+' gagal':'—')+
      baris('Tiket',esc(o.ticketStatus&&o.ticketStatus!=='none'?o.ticketStatus:'—'))+'</div>'+
      (hist.length?'<ol class="sh-tl">'+hist.map((h,i)=>'<li class="'+(i===0?'now':'')+(/^U|^D\d|^CR|^R\d/.test(h.code||'')?' bad':'')+'">'+
        '<div class="t">'+esc(h.date||'')+'</div><div class="e"><b>'+esc(shAlasan(h.desc))+'</b><small>'+esc(h.desc||'')+(h.location&&h.location!=='null'?' · '+esc(h.location):'')+'</small>'+
        (foto(h)?'<div class="f">'+foto(h)+'</div>':'')+'</div></li>').join('')+'</ol>'
        :'<p class="sh-tl-kosong">Belum ada riwayat perjalanan dari kurir.</p>')+'</div>';
  }catch(e){
    box.innerHTML='<div class="sh-hasil-in"><div class="sh-hasil-h"><span style="color:var(--loss)">Resi '+esc(resi)+' tidak ditemukan ('+esc(e.message)+').</span><button class="rinci-x" id="shLacakTutup" aria-label="Tutup">×</button></div></div>';
  }
}

// Filter, lacak resi, follow up & WA, template, ekspor
function pasangTracking(){
  ['mmRange','mmCod'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.closest('button'))loadMasalah()}));
  ['mmKurir','mmGudang'].forEach(id=>$(id).addEventListener('change',loadMasalah));
  $('mmFu').addEventListener('click',e=>{if(e.target.closest('button'))renderMmRows()});
  $('mmKat').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;mmKat=b.dataset.kat;renderMmRows();
    // Editor template ikut status yang dipilih (kecuali sedang mengubah teks yang belum disimpan)
    if(mmKat&&mmKat!==MM_KRITIS&&mmKat!==MM_LEWAT&&mmTplIsi&&$('mmTplText').value===mmTplDari($('mmTplKat').value))mmTplTampil(mmKat)});
  $('shLacakForm').addEventListener('submit',e=>{e.preventDefault();const r=$('shLacakResi').value.trim();if(r)lacakResi(r)});
  $('shLacak').addEventListener('click',e=>{if(e.target.closest('#shLacakTutup'))$('shLacak').hidden=true});
  $('mmRows').addEventListener('click',e=>{
    // Ikon info: ketuk untuk buka / tutup (layar sentuh tidak punya hover)
    const inf=e.target.closest('.is-info'),buka=inf&&!inf.classList.contains('on');
    $('mmRows').querySelectorAll('.is-info.on').forEach(x=>x.classList.remove('on'));
    if(inf){inf.classList.toggle('on',buka);return}
    // Catatan internal: klik "+ Catatan" / teks catatan → kotak isian di tempat; Simpan (atau Ctrl+Enter) / Batal
    const ct=e.target.closest('.mm-catat');
    if(ct){
      if(e.target.closest('.mm-catat-batal')){renderMmRows();return}
      if(e.target.closest('.mm-catat-simpan')){mmSimpanFu(ct.dataset.catat,{note:ct.querySelector('textarea').value.trim().slice(0,500)});return}
      if(ct.querySelector('textarea'))return;
      const r=(mmData.problems||[]).find(x=>x.receipt===ct.dataset.catat);
      ct.innerHTML='<textarea rows="3" maxlength="500" placeholder="Hasil percakapan, mis. pembeli minta dikirim ulang hari Senin"></textarea>'+
        '<span class="mm-catat-aksi"><button type="button" class="btn ghost mm-catat-batal">Batal</button><button type="button" class="btn primary mm-catat-simpan">Simpan</button></span>';
      const ta=ct.querySelector('textarea');ta.value=r&&r.fu_note||'';ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);return}
    const l=e.target.closest('[data-lacak]');
    if(l&&l.dataset.lacak){$('shLacakResi').value=l.dataset.lacak;lacakResi(l.dataset.lacak);return}
    const w=e.target.closest('[data-wa]');if(!w)return;
    const r=(mmData.problems||[]).find(x=>x.receipt===w.dataset.wa);if(!r)return;
    window.open('https://wa.me/'+waNomor(r.receiver_phone)+'?text='+encodeURIComponent(waPesan(r)),'_blank','noopener');
    mmSimpanFu(r.receipt,{wa:true});
  });
  $('mmRows').addEventListener('keydown',e=>{
    const ta=e.target.closest('.mm-catat textarea');if(!ta)return;
    if(e.key==='Escape')renderMmRows();
    else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();mmSimpanFu(ta.closest('.mm-catat').dataset.catat,{note:ta.value.trim().slice(0,500)})}
  });
  $('mmRows').addEventListener('change',e=>{
    const c=e.target.closest('input[data-pilih]');
    if(c){if(c.checked)mmPilih.add(c.dataset.pilih);else mmPilih.delete(c.dataset.pilih);c.closest('tr').classList.toggle('mm-dipilih',c.checked);mmPilihTampil();return}
    const s=e.target.closest('select[data-fu]');if(!s||!s.value)return;
    mmSimpanFu(s.dataset.fu,{status:s.value});
  });
  $('mmTplSave').addEventListener('click',async()=>{
    const kat=$('mmTplKat').value,t=$('mmTplText').value;put('mmTplMsg','Menyimpan…');
    // Teks sama dengan bawaan → simpan sebagai "pakai bawaan" (kosong) supaya ikut bila bawaan diperbarui
    const kirim=t.trim()===(MM_TPL_KAT[kat]||'').trim()?'':t;
    try{const b=await api('/api/report/shipments/wa-template',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({kategori:kat,template:kirim})});
      mmTplIsi=b.templates||{};mmTplTampil(kat);put('mmTplMsg','Tersimpan untuk "'+kat+'"')}
    catch(e){put('mmTplMsg','Gagal: '+e.message)}
  });
  $('mmTplKat').addEventListener('change',e=>mmTplTampil(e.target.value));
  $('mmTplReset').addEventListener('click',()=>{$('mmTplText').value=MM_TPL_KAT[$('mmTplKat').value]||MM_TPL_BAWAAN;put('mmTplMsg','Klik Simpan untuk memakai template bawaan')});
  // Tombol di peringatan kritis: buka filter Kritis dan centang semuanya, siap disalin ke PIC ekspedisi
  $('mmKritisLihat').addEventListener('click',()=>{mmKat=MM_KRITIS;$('mmFu').querySelectorAll('button').forEach(b=>b.classList.toggle('on',!b.dataset.fu));
    mmPilih.clear();for(const r of mmFiltered())if(r.receipt)mmPilih.add(r.receipt);renderMmRows()});
  $('mmCekSemua').addEventListener('change',e=>{
    for(const r of mmFiltered())if(r.receipt){if(e.target.checked)mmPilih.add(r.receipt);else mmPilih.delete(r.receipt)}
    renderMmRows();
  });
  $('mmSalin').addEventListener('click',async()=>{
    const rows=mmTerpilih();if(!rows.length)return;
    const ok=await mmSalinTeks(mmTeksResi(rows)),b=$('mmSalin');
    b.textContent=ok?'Tersalin ✓ '+int(rows.length)+' resi':'Gagal menyalin';setTimeout(mmPilihTampil,1800);
  });
  $('mmExport').addEventListener('click',()=>{
    const pr=mmFiltered();if(!pr.length)return;
    unduhCsv('mengantar-paket-bermasalah-'+mmData.from+'_'+mmData.to+'.csv',
      ['Resi','Kategori','Keterangan kurir','Waktu kejadian','Kurir','Gudang','Barang','Umur paket (hari)','SLA (hari)','Jam tanpa update','Nama penerima','No HP','Kota','Provinsi','CS','COD','Nilai COD','Tiket','Follow up','Jumlah WA','Follow up terakhir','Catatan'],
      pr.map(r=>[r.receipt,r.kategori,shAlasan(r.last_desc||r.status),r.last_date,r.courier,r.shipper,r.goods,r.days_in_transit,r.sla_days,r.hours_since_update,
        r.receiver_name,r.receiver_phone,r.receiver_city,r.receiver_region,r.cs,r.is_cod?'ya':'tidak',r.cod_amount,r.ticket,MM_FU[r.fu_status]||'Belum',r.fu_count||0,r.fu_at||'',r.fu_note||'']));
  });
  $('mmCsExport').addEventListener('click',()=>{
    const rows=mmCsRekap();if(!rows.length)return;
    unduhCsv('follow-up-per-cs-'+mmData.from+'_'+mmData.to+'.csv',
      ['CS','Bermasalah sekarang','Belum di-follow up','Di-follow up','WA dikirim','Sudah dihubungi','Siap terima','Menolak','Tidak respon','Selesai','Terkirim','RTS','Hilang','Masih di jalan','Diselamatkan (%)'],
      rows.map(t=>{const s=mmCsSelamat(t);return [t.cs||'(tanpa CS)',t.masalah,t.belum,t.fu,t.wa,t.dihubungi,t.siap_terima,t.menolak,t.tidak_respon,t.selesai,t.terkirim,t.rts,t.hilang,t.jalan,s==null?'':Math.round(s*10)/10]}));
  });
}
pasangTracking();
