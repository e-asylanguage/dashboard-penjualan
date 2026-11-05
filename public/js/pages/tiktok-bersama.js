/**
 * Kode bersama TikTok Shop: pembaca file ekspor Seller Center, label status, chip toko, upload file (jenis dikenali dari isinya), sinkron API, Log History, dan Koneksi API (hubungkan toko & uji baca data).
 * Script biasa (bukan module), dimuat SETELAH script utama (js/main.js): memakai utils.js & api.js, serta dari script utama (window.*): spParseCsv, spMuatXlsx, spNorm, siTgl, liveBaris, spAngka, tkBar, LOG_JENIS, LOG_STATUS.
 * Dipanggil dari script utama: ttMuat() (Pengaturan); ttToko dibaca saat Buat SKU otomatis.
 */
/** "30/09/2026 20:40:42" / "2026/10/13" → "2026-09-30 20:40:42" / "2026-10-13" (WIB, apa adanya) */
function ttWaktu(v){
  const s=String(v==null?'':v).replace(/\t/g,'').trim();let m;
  if((m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/)))return m[3]+'-'+m[2]+'-'+m[1]+(m[4]?' '+(m[4].length===5?m[4]+':00':m[4]):'');
  if((m=s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/)))return m[1]+'-'+m[2]+'-'+m[3]+(m[4]?' '+(m[4].length===5?m[4]+':00':m[4]):'');
  return '';
}
const ttAngka=v=>{const s=String(v==null?'':v).replace(/\t/g,'').trim();if(!s)return 0;const n=Number(s.replace(/[^\d.-]/g,''));return isFinite(n)?Math.round(n):0};
const ttTeks=v=>String(v==null?'':v).replace(/\t/g,'').trim();
/**
 * File Pesanan TikTok (Pesanan → Ekspor, CSV): satu baris per SKU → pesanan [{order_id, …, items:[…]}].
 * Nilai tingkat pesanan (Order Amount, ongkir) berulang di tiap baris → diambil dari baris pertama.
 * Data pembeli (username, nama penerima, telepon, alamat detail) tidak diambil.
 */
function ttPesananDariFile(rows){
  const h=rows[0].map(ttTeks),k=n=>h.indexOf(n);
  const wajib=['Order ID','Order Status','Seller SKU','Quantity','Created Time'];
  const kurang=wajib.filter(n=>k(n)<0);if(kurang.length)throw new Error('Bukan file Pesanan TikTok — kolom tidak ada: '+kurang.join(', '));
  const g=new Map();
  for(const r of rows.slice(1)){
    const id=ttTeks(r[k('Order ID')]);if(!/^\d{6,}$/.test(id))continue;
    let p=g.get(id);
    if(!p){p={order_id:id,status_asli:ttTeks(r[k('Order Status')]),substatus:ttTeks(r[k('Order Substatus')]),tipe_batal:ttTeks(r[k('Cancelation/Return Type')]),
      alasan_batal:ttTeks(r[k('Cancel Reason')]),resi:ttTeks(r[k('Tracking ID')]),kurir:ttTeks(r[k('Shipping Provider Name')]),opsi_kirim:ttTeks(r[k('Delivery Option')]),
      dibuat:ttWaktu(r[k('Created Time')]),dibayar:ttWaktu(r[k('Paid Time')]),dikirim:ttWaktu(r[k('Shipped Time')]),terkirim:ttWaktu(r[k('Delivered Time')]),
      dibatalkan:ttWaktu(r[k('Cancelled Time')]),metode_bayar:ttTeks(r[k('Payment Method')]),diskon_penjual:0,diskon_platform:0,
      ongkir_pembeli:ttAngka(r[k('Shipping Fee After Discount')]),total:ttAngka(r[k('Order Amount')]),kota:ttTeks(r[k('Regency and City')]),
      provinsi:ttTeks(r[k('Province')]),channel:ttTeks(r[k('Purchase Channel')])||'TikTok',items:[]};
      // Fulfillment Type: "Fulfillment by seller" / "Fulfillment by TikTok Shop" (kolom tidak ada → belum diketahui)
      const ft=k('Fulfillment Type')>=0?ttTeks(r[k('Fulfillment Type')]):'';if(ft)p.fbt=/tiktok/i.test(ft)&&!/seller|penjual/i.test(ft);
      g.set(id,p)}
    p.diskon_penjual+=ttAngka(r[k('SKU Seller Discount')]);p.diskon_platform+=ttAngka(r[k('SKU Platform Discount')]);
    p.items.push({sku_id:ttTeks(r[k('SKU ID')]),sku:ttTeks(r[k('Seller SKU')]),nama:ttTeks(r[k('Product Name')]),variasi:ttTeks(r[k('Variation')]),
      harga_awal:ttAngka(r[k('SKU Unit Original Price')]),subtotal:ttAngka(r[k('SKU Subtotal After Discount')]),qty:ttAngka(r[k('Quantity')])||1,
      qty_retur:ttAngka(r[k('Sku Quantity of return')])});
  }
  return [...g.values()];
}
/**
 * File Income TikTok (Keuangan → unduh .xlsx), sheet "Detail pesanan": satu baris per pesanan / penyesuaian.
 * Kelompok biaya: ongkir = kolom "Ongkir" (sudah jumlah rinciannya), afiliasi = kolom berisi "afiliasi",
 * pajak = PPh / pajak, platform = Total Biaya − ongkir − afiliasi − pajak. Kolom uang lain disimpan di rincian.
 */
function ttPenghasilanDariFile(rows){
  const h=rows[0].map(ttTeks),k=n=>h.indexOf(n);
  const wajib=['ID Pesanan/Penyesuaian','Jenis transaksi','Waktu pembayaran pesanan','Jumlah penyelesaian pembayaran','Total Biaya'];
  const kurang=wajib.filter(n=>k(n)<0);if(kurang.length)throw new Error('Bukan file Income TikTok (sheet Detail pesanan) — kolom tidak ada: '+kurang.join(', '));
  const BUKAN_UANG=/^(ID |Jenis transaksi|Waktu|Mata uang|Perkiraan berat|Berat paket|Detail produk|Sumber pesanan|ID pesanan terkait)/i;
  const iBiaya=k('Total Biaya'),iAkhirBiaya=k('Jumlah penyesuaian');
  const out=[];
  for(const r of rows.slice(1)){
    const id=ttTeks(r[k('ID Pesanan/Penyesuaian')]);if(!id)continue;
    const rinci={};h.forEach((n,i)=>{if(n&&!BUKAN_UANG.test(n)){const v=ttAngka(r[i]);if(v)rinci[n]=v}});
    // Komponen biaya = kolom di antara "Total Biaya" dan "Jumlah penyesuaian"; sub-rincian ongkir (setelah kolom "Ongkir") tidak dijumlah dua kali
    let afiliasi=0,pajak=0;
    h.forEach((n,i)=>{if(i<=iBiaya||(iAkhirBiaya>0&&i>=iAkhirBiaya))return;const v=ttAngka(r[i]);if(!v)return;
      if(/afiliasi/i.test(n))afiliasi+=v;else if(/^pph|pajak/i.test(n))pajak+=v});
    const biaya=ttAngka(r[iBiaya]),ongkir=ttAngka(r[k('Ongkir')]);
    out.push({id,jenis:ttTeks(r[k('Jenis transaksi')]),order_id:ttTeks(r[k('ID pesanan terkait')])||id,dibuat:ttWaktu(r[k('Waktu pemesanan')]).slice(0,10),
      dilepas:ttWaktu(r[k('Waktu pembayaran pesanan')]).slice(0,10),total:ttAngka(r[k('Jumlah penyelesaian pembayaran')]),pendapatan:ttAngka(r[k('Total Pendapatan')]),
      subtotal:ttAngka(r[k('Subtotal setelah diskon penjual')]),diskon_penjual:ttAngka(r[k('Diskon penjual')]),refund:ttAngka(r[k('Total pengembalian dana setelah diskon')]),
      biaya_total:biaya,biaya_ongkir:ongkir,biaya_afiliasi:afiliasi,pajak,biaya_platform:biaya-ongkir-afiliasi-pajak,penyesuaian:ttAngka(r[k('Jumlah penyesuaian')]),
      dibayar_pembeli:ttAngka(r[k('Pembayaran oleh pembeli')]),rincian:rinci});
  }
  return out;
}
/** Sheet Excel TikTok sering salah mencantumkan ukurannya (!ref) → hitung ulang dari sel yang benar-benar ada */
function ttBetulkanRef(X,ws){
  let R=0,C=0;for(const kk of Object.keys(ws)){if(kk[0]==='!')continue;const c=X.utils.decode_cell(kk);if(c.r>R)R=c.r;if(c.c>C)C=c.c}
  ws['!ref']=X.utils.encode_range({s:{r:0,c:0},e:{r:R,c:C}});
}
/** Baris sheet seperti hasil CSV: angka tetap angka (tanpa format ribuan), tanggal jadi "YYYY-MM-DD HH:MM:SS" */
function ttBarisXlsx(X,ws){
  ttBetulkanRef(X,ws);
  const R=X.utils.decode_range(ws['!ref']),p2=x=>String(x).padStart(2,'0'),out=[];
  const tgl=d=>d.y+'-'+p2(d.m)+'-'+p2(d.d)+' '+p2(d.H)+':'+p2(d.M)+':'+p2(Math.floor(d.S));
  for(let r=R.s.r;r<=R.e.r;r++){const b=[];
    for(let c=R.s.c;c<=R.e.c;c++){const s=ws[X.utils.encode_cell({r,c})];
      b.push(!s||s.v==null?'':s.t==='n'&&s.z&&X.SSF.is_date(s.z)?tgl(X.SSF.parse_date_code(s.v)):s.v)}
    out.push(b)}
  return out;
}

// TikTok Shop › Pesanan & Penghasilan (upload file + sinkron API, digabung per Order ID)
const TT_GRUP={perlu_dikirim:['Perlu dikirim','spend'],dikirim:['Dikirim','info'],terkirim:['Terkirim / selesai','rev'],batal:['Batal','loss'],retur:['Retur','loss'],belum_bayar:['Belum bayar',''],lain:['Lainnya','']};
const TT_SUMBER={api:'<span class="tag info" title="Dari sinkron API TikTok Shop">API</span>',file:'<span class="tag" title="Dari upload file">File</span>'};
let ttToko=null;
const ttSinkronTeks=s=>s&&s.waktu?' · sinkron API '+tglWib(s.waktu,true):'';
const ttWkt=v=>v?tglWib(v.replace(' ','T')+'+07:00',true):'—';
const ttKosong=(n,t)=>'<tr><td colspan="'+n+'" style="color:var(--muted)">'+t+'</td></tr>';
/** Chip toko + kesehatan data TikTok (komponen sama dengan Shopee) */
async function ttTkMuat(p){
  const r=rentang(p+'Range');
  try{
    const [t,st]=await Promise.all([ttToko?Promise.resolve(ttToko):api('/api/tiktok/toko'),api('/api/tiktok/status?'+new URLSearchParams({from:r.from,to:r.to,jenis:p==='tp'?'pesanan':'penghasilan'}))]);
    ttToko=t;tkBar(p,t.toko||[],st,r,p==='tp'?'pesanan':'dana dicairkan','Belum ada toko — tambahkan di Pengaturan › Toko Marketplace.');
  }catch(e){$(p+'TkBar').innerHTML='<span style="color:var(--loss)">Gagal memuat toko ('+esc(e.message)+')</span>'}
}
// Dipakai Pesanan & Penghasilan
const ttTag=s=>{const x=TT_GRUP[s==='selesai'?'terkirim':s]||TT_GRUP.lain;return '<span class="tag '+x[1]+'">'+x[0]+'</span>'};
/**
 * File "Campaign overview data" (iklan TikTok Shop): Time; Biaya; Pesanan SKU; Biaya per pesanan; Penghasilan bruto; ROI; Mata Uang.
 * Kolom pertama "Time"/"Per Jam" = per jam, "Per Hari" = per hari (tanggal tetap ditulis "YYYY-MM-DD 00:00:00").
 * Tanpa jam ("YYYY-MM-DD") = per hari. Baris total ("-") dipakai untuk cek jumlah.
 */
function ttIklanDariFile(rows){
  const H=rows[0].map(h=>String(h||'').trim().toLowerCase()),k=re=>H.findIndex(h=>re.test(h));
  const harian=/^(per hari|by day|daily|harian|per minggu|by week|per bulan|by month)$/.test(H[0]);
  const I={t:0,biaya:k(/^(biaya|cost|spend)/),pesanan:k(/^(pesanan|orders?|sku orders?)/),omzet:k(/(penghasilan bruto|gross revenue|pendapatan bruto|revenue)/)};
  if(I.biaya<0)throw new Error('Kolom Biaya tidak ditemukan di laporan iklan.');
  const n=v=>{const x=String(v??'').trim().replace(/[^0-9.,-]/g,'');return Number(x.includes(',')&&!x.includes('.')?x.replace(',','.'):x.replace(/,/g,''))||0};
  const out=[];let total=null;
  for(const r of rows.slice(1)){
    const t=String(r[I.t]||'').trim();if(!t)continue;
    const v={biaya:n(r[I.biaya]),pesanan:I.pesanan<0?0:n(r[I.pesanan]),omzet:I.omzet<0?0:n(r[I.omzet])};
    if(!/^\d{4}-\d{2}-\d{2}/.test(t)){if(/^[-–]$|total/i.test(t))total=v;continue}
    const jam=harian?null:/^\d{4}-\d{2}-\d{2}[ T](\d{2})/.exec(t);
    out.push(Object.assign({tgl:t.slice(0,10),jam:jam?+jam[1]:-1},v));
  }
  if(total){const s=out.reduce((a,x)=>a+x.biaya,0);if(Math.abs(s-total.biaya)>1)out.cek='jumlah biaya per baris ('+rpFull(s)+') ≠ baris total ('+rpFull(total.biaya)+')'}
  return out;
}
/**
 * File "Live Performance Core Stats" (Seller Center → Analitik → LIVE): baris "Date Range: …", lalu judul "Waktu;GMV dari LIVE (Rp);…",
 * satu baris per hari. null = bukan file live.
 */
function ttLiveDariFile(rows){
  rows=liveBaris(rows);   // CSV ber-";" yang disimpan ulang di Excel bisa masuk ke satu kolom
  // Tanggal dari Excel: teks "2026-10-01", "2026-10-01 00:00:00", atau nomor seri (46296) bila format tanggalnya hilang
  const tglX=v=>typeof v==='number'&&v>30000&&v<80000?new Date(Math.round((v-25569)*864e5)).toISOString().slice(0,10):siTgl(v);
  const hi=rows.slice(0,10).findIndex(r=>{const n=(r||[]).map(spNorm);return n.includes('waktu')&&n.includes('gmv dari live (rp)')});
  if(hi<0)return null;
  const head=rows[hi].map(spNorm),ix=n=>head.indexOf(n);
  // Angka bulat; "1.234" / "1,234" (pemisah ribuan) → 1234; angka Excel apa adanya
  const a=(r,n)=>{const v=ix(n)<0?'':r[ix(n)];if(typeof v==='number')return Math.round(v);const s=String(v==null?'':v).trim().replace(/[^\d.,-]/g,'');
    if(!s||s==='-')return 0;return /^-?\d{1,3}([.,]\d{3})+$/.test(s)?Number(s.replace(/[.,]/g,'')):Math.round(Number(s.replace(',','.'))||0)};
  return rows.slice(hi+1).map(r=>({tgl:tglX((r||[])[ix('waktu')]),omzet:a(r,'gmv dari live (rp)'),omzet_langsung:a(r,'gmv live (rp)'),
    omzet_tidak_langsung:a(r,'gmv tidak langsung dari live (rp)'),siaran:a(r,'siaran live'),terjual:a(r,'produk yang terjual melalui live'),
    pesanan:a(r,'pesanan sku teratribusi'),tayangan:a(r,'tayangan live')})).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.tgl));
}
// -- Upload file (jenis dikenali dari isinya)
let ttUp=null;
async function ttBukaUpload(){
  ttUp=null;$('ttUpFile').value='';put('ttUpInfo','');put('ttUpMsg','');$('ttUpSimpan').disabled=true;
  try{if(!ttToko)ttToko=await api('/api/tiktok/toko')}catch(e){alert('Gagal memuat daftar toko: '+e.message);return}
  $('ttUpToko').innerHTML=(ttToko.toko||[]).map(t=>'<option value="'+t.id+'">'+esc(t.nama)+'</option>').join('')||'<option value="">(belum ada toko — hubungkan dulu di Pengaturan)</option>';
  $('ttUpDlg').showModal();
}
$('ttUpFile').addEventListener('change',async()=>{
  const f=$('ttUpFile').files[0];ttUp=null;$('ttUpSimpan').disabled=true;if(!f)return;
  put('ttUpInfo','Membaca '+f.name+'…');
  try{
    let jenis,data;
    let rows=null;
    if(/\.xlsx?$/i.test(f.name)){
      const X=await spMuatXlsx(),wb=X.read(await f.arrayBuffer(),{type:'array',cellNF:true}),ws=wb.Sheets['Detail pesanan'];
      if(ws){ttBetulkanRef(X,ws);jenis='penghasilan';data=ttPenghasilanDariFile(X.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}))}
      else rows=ttBarisXlsx(X,wb.Sheets[wb.SheetNames[0]]).filter(b=>b.some(v=>String(v).trim()));
    }else rows=spParseCsv(await f.text());
    const lv=rows&&ttLiveDariFile(rows);
    if(lv){jenis='live';data=lv}
    else if(rows){
      if(/^(time|waktu|tanggal|date|per (jam|hari)|by (hour|day)|hourly|daily)$/i.test(String((rows[0]||[])[0]||'').trim())&&(rows[0]||[]).some(h=>/biaya|cost/i.test(h))){jenis='iklan';data=ttIklanDariFile(rows)}
      else{jenis='pesanan';data=ttPesananDariFile(rows)}}
    if(!data.length)throw new Error('Tidak ada baris data di file ini.');
    const tg=data.map(x=>(jenis==='pesanan'?x.dibuat:jenis==='iklan'||jenis==='live'?x.tgl:x.dilepas)||'').filter(Boolean).map(s=>s.slice(0,10)).sort();
    ttUp={jenis,data,nama:f.name,dari:tg[0],sampai:tg[tg.length-1]};
    if(jenis==='pesanan'){
      const batal=data.filter(p=>/batal|cancel/i.test(p.status_asli)).length,pcs=data.reduce((a,p)=>a+p.items.reduce((s,i)=>s+i.qty,0),0);
      ttUp.ringkasan='Omzet '+rpFull(data.filter(p=>!/batal|cancel/i.test(p.status_asli)).reduce((a,p)=>a+p.items.reduce((s,i)=>s+i.subtotal,0),0))+' · '+int(data.length)+' pesanan · '+int(batal)+' batal · '+int(pcs)+' pcs';
    }else if(jenis==='live'){
      const s=k=>data.reduce((a,r)=>a+r[k],0);
      ttUp.ringkasan='GMV dari LIVE '+rpFull(s('omzet'))+' (langsung '+rpFull(s('omzet_langsung'))+' · tidak langsung '+rpFull(s('omzet_tidak_langsung'))+') · '+
        int(s('pesanan'))+' pesanan · '+int(s('siaran'))+' siaran · '+int(data.length)+' hari';
    }else if(jenis==='iklan'){
      const s=k=>data.reduce((a,r)=>a+r[k],0);
      ttUp.ringkasan='Biaya '+rpFull(s('biaya'))+' · omzet iklan '+rpFull(s('omzet'))+' · '+int(s('pesanan'))+' pesanan · ROI '+(s('biaya')?nf2.format(s('omzet')/s('biaya')):'—')+' · '+int(new Set(data.map(r=>r.tgl)).size)+' hari';
      ttUp.cek=data.cek||'';
    }else{
      const s=k=>data.reduce((a,r)=>a+r[k],0),beda=data.filter(r=>Math.abs(r.total-(r.pendapatan+r.biaya_total+r.penyesuaian))>1).length;
      ttUp.ringkasan='Dana '+rpFull(s('total'))+' · pendapatan '+rpFull(s('pendapatan'))+' · biaya '+rpFull(s('biaya_total'))+' · '+int(data.length)+' transaksi';
      ttUp.cek=beda?int(beda)+' baris: dana ≠ pendapatan + biaya + penyesuaian':'';
    }
    put('ttUpInfo','File '+(jenis==='pesanan'?'Pesanan':jenis==='iklan'?'Iklan (Campaign overview)':jenis==='live'?'Live (Live Performance Core Stats)':'Penghasilan (Income)')+' · '+(ttUp.dari?fmtRange(ttUp.dari,ttUp.sampai)+' · ':'')+ttUp.ringkasan);
    $('ttUpSimpan').disabled=!$('ttUpToko').value;
  }catch(e){put('ttUpInfo','Tidak bisa dibaca: '+e.message)}
});
$('ttUpForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!ttUp)return;
  const json=b=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  $('ttUpSimpan').disabled=true;let u=null;
  try{
    u=await api('/api/tiktok/upload',json({toko_id:Number($('ttUpToko').value),jenis:ttUp.jenis,nama_file:ttUp.nama,baris:ttUp.data.length,dari:ttUp.dari,sampai:ttUp.sampai,ringkasan:ttUp.ringkasan}));
    const tot={baru:0,diperbarui:0};
    if(ttUp.jenis==='iklan'||ttUp.jenis==='live'){put('ttUpMsg','Menyimpan…');const h=await api('/api/tiktok/upload/'+u.id+'/'+ttUp.jenis,json({rows:ttUp.data}));tot.baru=h.hari}
    else for(let i=0;i<ttUp.data.length;i+=100){
      put('ttUpMsg','Menyimpan '+Math.min(i+100,ttUp.data.length)+' / '+ttUp.data.length+'…');
      const part=ttUp.data.slice(i,i+100);
      const h=await api('/api/tiktok/upload/'+u.id+'/'+ttUp.jenis,json(ttUp.jenis==='pesanan'?{pesanan:part}:{rows:part}));
      tot.baru+=h.baru;tot.diperbarui+=h.diperbarui;
    }
    await api('/api/tiktok/upload/'+u.id+'/selesai',json({status:ttUp.cek?'perlu_cek':'terbaca',catatan:ttUp.cek||''}));
    $('ttUpDlg').close();
    alert(ttUp.jenis==='iklan'||ttUp.jenis==='live'?'Upload '+ttUp.jenis+' selesai: '+tot.baru+' hari disimpan (tanggal yang sama menggantikan data lama).'+
      (ttUp.jenis==='live'?'\nIsi biaya live di Penghasilan TikTok › kanal Live (tombol + Spending live).':''):'Upload '+(ttUp.jenis==='pesanan'?'pesanan':'penghasilan')+' selesai: '+tot.baru+' baru, '+tot.diperbarui+' diperbarui.');
    // Pindahkan filter ke periode file bila di luar rentang yang sedang dipilih
    const tuju={pesanan:['tpRange','ttpesanan'],penghasilan:['thRange','tthasil'],iklan:['tiRange','ttiklan'],live:['thRange','tthasil']}[ttUp.jenis],segId=tuju[0],r=rentang(segId),seg=$(segId);
    if(ttUp.jenis==='iklan')tiData=null;
    if(ttUp.dari&&(ttUp.dari<r.from||ttUp.sampai>r.to)){seg.dataset.from=ttUp.dari;seg.dataset.to=ttUp.sampai;
      bukaView(tuju[1]);seg.querySelector('button[data-range="custom"]').click()}
    else bukaView(tuju[1]);
  }catch(err){put('ttUpMsg','Gagal: '+err.message);$('ttUpSimpan').disabled=false;
    if(u)api('/api/tiktok/upload/'+u.id+'/selesai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'gagal',catatan:err.message})}).catch(()=>{})}
});
['ttUpTutup','ttUpBatal'].forEach(id=>$(id).addEventListener('click',()=>$('ttUpDlg').close()));
$('ttUpToko').addEventListener('change',()=>{$('ttUpSimpan').disabled=!ttUp||!$('ttUpToko').value});
// -- Sinkron API & Log History
async function ttSinkron(btn){
  btn.disabled=true;const asli=btn.innerHTML;btn.lastChild.textContent='Menyinkron…';
  try{
    const d=await api('/api/tiktok/sinkron',{method:'POST'});
    if(!d.ok){alert('Sinkron TikTok: '+(d.pesan||'gagal'));return}
    alert('Sinkron TikTok Shop selesai:\n\n'+(d.hasil||[]).map(x=>x.toko+'\n· Pesanan: '+(x.pesanan&&x.pesanan.gagal?'GAGAL — '+x.pesanan.gagal:int(x.pesanan.disimpan)+' disimpan ('+int(x.pesanan.baru)+' baru)')+
      '\n· Penghasilan: '+(x.penghasilan&&x.penghasilan.gagal?'GAGAL — '+x.penghasilan.gagal:int(x.penghasilan.disimpan)+' transaksi dari '+int(x.penghasilan.statement)+' settlement ('+int(x.penghasilan.baru)+' baru)')).join('\n\n')||'Tidak ada toko terhubung API.');
    ttToko=null;if($('v-ttpesanan').classList.contains('active'))loadTtPesanan();else loadTtHasil();
  }catch(e){alert('Sinkron gagal: '+e.message)}
  finally{btn.disabled=false;btn.innerHTML=asli}
}
$('tpSyncBtn').addEventListener('click',e=>ttSinkron(e.currentTarget));
$('thSyncBtn').addEventListener('click',e=>ttSinkron(e.currentTarget));
async function ttBukaLog(segId){
  const r=rentang(segId),q=new URLSearchParams({from:r.from,to:r.to});
  put('upLogSub','TikTok Shop · periode '+fmtRange(r.from,r.to)+' · menurut periode isi file');
  $('upLogIsi').innerHTML='<p style="color:var(--muted)">Memuat…</p>';$('upLogDlg').showModal();
  try{
    const d=await api('/api/tiktok/upload?'+q);
    $('upLogIsi').innerHTML='<table class="sku-tbl gd-tbl up-log"><thead><tr><th>File</th><th>Toko</th><th>Jenis</th><th class="n">Baris</th><th>Ringkasan terbaca</th><th>Status</th></tr></thead><tbody>'+
      (d.rows.map(u=>{const st=LOG_STATUS[u.status]||LOG_STATUS.terbaca;
        return '<tr><td class="nm">'+esc(u.nama_file||'—')+'<small>'+tglWib(u.created_at,true)+(u.oleh?' · '+esc(u.oleh):'')+'</small></td><td>'+esc(u.toko)+'</td>'+
          '<td>'+(LOG_JENIS[u.jenis]||esc(u.jenis))+(u.dari?'<small>'+esc(fmtRange(u.dari,u.sampai||u.dari))+'</small>':'')+'</td><td class="n">'+int(u.baris)+'</td>'+
          '<td class="ket">'+esc(u.ringkasan||int(u.pesanan)+' data')+(u.catatan?'<small style="color:var(--loss)">'+esc(u.catatan)+'</small>':'')+'</td><td><span class="tag '+st[0]+'">'+st[1]+'</span></td></tr>'}).join('')||
        '<tr><td colspan="6" style="color:var(--muted)">Belum ada file yang di-upload untuk periode ini.</td></tr>')+'</tbody></table>';
  }catch(err){$('upLogIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat ('+esc(err.message)+').</p>'}
}
$('tpLogBtn').addEventListener('click',()=>ttBukaLog('tpRange'));
$('thLogBtn').addEventListener('click',()=>ttBukaLog('thRange'));
$('tiLogBtn').addEventListener('click',()=>ttBukaLog('tiRange'));
$('tiUpBtn').addEventListener('click',ttBukaUpload);
$('tpUpBtn').addEventListener('click',ttBukaUpload);
$('thUpBtn').addEventListener('click',ttBukaUpload);

// ---- TikTok Shop › Koneksi API: hubungkan toko & uji baca data (belum menulis ke laporan)
async function ttMuat(){
  try{
    const d=await api('/api/tiktok-api/toko');
    put('ttInfo',d.siap?'Kunci aplikasi tersimpan · '+int(d.akun.length)+' akun penjual terhubung':'Kunci aplikasi belum di-set (secret TIKTOK_APP_KEY / TIKTOK_APP_SECRET)');
    $('pgInfoTt').innerHTML=d.siap?'<b>'+int(d.akun.length)+'</b> akun penjual terhubung'+(d.akun.length?' · '+esc(d.akun.map(a=>a.nama||a.open_id).join(', ')):''):'Kunci aplikasi belum di-set';
    const baris=[];
    for(const a of d.akun)for(const t of (a.toko.length?a.toko:[null]))baris.push('<tr><td class="name">'+esc(a.nama||a.open_id)+'<small class="mm-sub">'+esc(a.region||'')+'</small></td>'+
      '<td>'+(t?esc(t.name)+'<small class="mm-sub">'+esc(t.region||'')+' · '+esc(t.id)+'</small>':'<span style="color:var(--muted)">belum ada toko</span>')+'</td>'+
      '<td>'+tglWib(a.expire_at,true)+'<small class="mm-sub">diperbarui otomatis · izin s.d. '+new Date(a.refresh_expire_at).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+'</small></td>'+
      '<td class="n">'+(t?'<button class="btn ghost" data-tt-uji="'+esc(a.open_id)+'|'+esc(t.id)+'">Uji baca data</button> ':'<button class="btn ghost" data-tt-muat="'+esc(a.open_id)+'">Muat ulang toko</button> ')+'<button class="btn ghost" data-tt-hapus="'+esc(a.open_id)+'">Putuskan</button></td></tr>');
    $('ttRows').innerHTML=baris.join('')||'<tr><td colspan="4" style="color:var(--muted)">Belum ada toko terhubung. Klik <b>Hubungkan toko</b>.</td></tr>';
  }catch(e){put('ttInfo','Gagal: '+e.message);$('ttRows').innerHTML='<tr><td colspan="4" style="color:var(--muted)">—</td></tr>'}
}
$('ttHubung').addEventListener('click',async()=>{
  try{const d=await api('/api/tiktok-api/link-izin');location.href=d.url}catch(e){alert('Gagal membuat link izin: '+e.message)}
});
$('ttRows').addEventListener('click',async e=>{
  const u=e.target.closest('[data-tt-uji]'),h=e.target.closest('[data-tt-hapus]'),m=e.target.closest('[data-tt-muat]'),out=$('ttHasil');
  if(m){out.hidden=false;out.textContent='Mengambil daftar toko…';
    try{const d=await api('/api/tiktok-api/akun/'+encodeURIComponent(m.dataset.ttMuat)+'/muat-toko',{method:'POST'});out.textContent=JSON.stringify(d,null,2);if(d.ok&&d.jumlah)ttMuat()}catch(err){out.textContent='Gagal: '+err.message}}
  if(u){const [o,sid]=u.dataset.ttUji.split('|');out.hidden=false;out.textContent='Membaca data toko…';
    try{out.textContent=JSON.stringify(await api('/api/tiktok-api/uji/'+encodeURIComponent(o)+'/'+encodeURIComponent(sid),{method:'POST'}),null,2)}catch(err){out.textContent='Gagal: '+err.message}}
  if(h&&confirm('Putuskan koneksi akun TikTok ini?')){try{await api('/api/tiktok-api/akun/'+encodeURIComponent(h.dataset.ttHapus),{method:'DELETE'});ttMuat()}catch(err){alert('Gagal: '+err.message)}}
});
