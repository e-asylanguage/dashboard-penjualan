/**
 * Pemakaian Cloudflare (menu akun, hanya admin): proyeksi tagihan Workers Paid, kuota, peringatan lonjakan, grafik harian,
 * query D1 terboros, tabel D1 / Worker / R2, salin pesan peringatan untuk tim. Data: /api/cloudflare.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: hanya memakai utils.js & api.js.
 * Dipanggil dari script utama: loadCf() (menu Pemakaian Cloudflare), cfCekBadge() (badge peringatan setelah admin masuk).
 */
// ---- Pemakaian Cloudflare (hanya admin): kuota Workers Paid, peringatan lonjakan, query D1 terboros
let cfData=null,cfBusy=false,cfChart=null,cfSeri='d1';
/** Jumlah besar diringkas: rb / jt / miliar */
const cfJml=v=>{if(v==null)return '—';const a=Math.abs(v);
  return a>=1e9?nf.format(Math.round(v/1e8)/10)+' miliar':a>=1e6?nf.format(Math.round(v/1e5)/10)+' jt':a>=1e4?nf.format(Math.round(v/100)/10)+' rb':nf.format(Math.round(v))};
const cfByte=v=>v>=1e9?nf.format(Math.round(v/1e8)/10)+' GB':v>=1e6?nf.format(Math.round(v/1e5)/10)+' MB':nf.format(Math.round(v/1e3))+' KB';
const cfUsd=v=>'$'+(Math.round(v*100)/100).toFixed(2);
const cfMs=v=>v>=36e5?nf.format(Math.round(v/36e4)/10)+' jam':v>=6e4?nf.format(Math.round(v/6e3)/10)+' mnt':nf.format(Math.round(v/100)/10)+' dtk';
/** Angka sesuai satuan kuota (byte → GB, ms → durasi, lainnya ringkas) */
const cfNilai=(k,v)=>k.unit==='byte'?cfByte(v):k.unit==='ms'?cfMs(v):cfJml(v);
const cfTone=p=>p>=100?'tone-loss':p>=70?'tone-spend':'tone-rev';

async function loadCf(segar){
  if(cfBusy)return;cfBusy=true;$('cfMuat').disabled=true;
  try{
    const j=await api('/api/cloudflare'+(segar?'?segar=1':''));
    if(j.belum){$('cfSetup').hidden=false;put('cfSetupErr','');put('cfInfo','Belum tersambung — lihat langkah di bawah');return}
    $('cfSetup').hidden=true;cfData=j;renderCf();
  }catch(e){
    $('cfSetup').hidden=false;put('cfSetupErr','Gagal mengambil data: '+e.message);put('cfInfo','Gagal memuat');
  }finally{cfBusy=false;$('cfMuat').disabled=false}
}
/** Badge merah di menu akun & tab Pengaturan = jumlah peringatan "bahaya" (dicek sekali saat admin masuk) */
function cfBadge(n){document.querySelectorAll('.cf-badge').forEach(b=>{b.hidden=!n;b.textContent=String(n||'')})}
function cfCekBadge(){api('/api/cloudflare').then(j=>{if(!j.belum){cfBadge(j.peringatan.filter(p=>p.tingkat==='bahaya').length)}}).catch(()=>{})}

function renderCf(){
  const d=cfData,p=d.periode,bahaya=d.peringatan.filter(x=>x.tingkat==='bahaya').length,waspada=d.peringatan.length-bahaya;
  cfBadge(bahaya);
  put('cfInfo','Semua Worker, D1, dan R2 di akun Cloudflare · '+tglWib(p.dari)+' – '+tglWib(p.sampai)+' (hari ke-'+p.hari_ke+' dari '+p.jumlah_hari+') · diperbarui '+tglWib(d.diperbarui,true));
  $('cfK1').textContent=cfUsd(d.tagihan_proyeksi);
  put('cfK1D','Biaya dasar '+cfUsd(d.biaya_dasar)+' + di luar kuota '+cfUsd(d.biaya_lebih));
  $('cfK2').textContent=cfUsd(d.biaya_lebih);$('cfK2').style.color=d.biaya_lebih>=1?'var(--loss)':'var(--rev)';
  const terbesar=d.kuota.filter(k=>k.biaya>0).sort((a,b)=>b.biaya-a.biaya)[0];
  put('cfK2D',terbesar?'Terbesar dari '+terbesar.nama+' ('+cfUsd(terbesar.biaya)+')':'Semua layanan masih dalam kuota');
  $('cfK3').textContent=int(d.peringatan.length);$('cfK3').style.color=bahaya?'var(--loss)':waspada?'var(--spend)':'var(--rev)';
  put('cfK3D',d.peringatan.length?int(bahaya)+' bahaya · '+int(waspada)+' waspada':'Tidak ada pemakaian berlebih');
  const rdHari=d.databases.reduce((s,x)=>s+(x.read_hari_ini||0),0),rdKmrn=d.databases.reduce((s,x)=>s+(x.read_kemarin||0),0);
  $('cfK4').textContent=cfJml(rdHari);
  put('cfK4D','Kemarin '+cfJml(rdKmrn)+' · kuota rata-rata '+cfJml(25e9/p.jumlah_hari)+'/hari');

  $('cfAl').innerHTML=d.peringatan.length?d.peringatan.map(a=>'<li class="'+(a.tingkat==='bahaya'?'tone-loss':'tone-spend')+'"><b>'+esc(a.judul)+'</b>'+esc(a.pesan)+'</li>').join('')
    :'<li class="cf-kosong">Semua aman — tidak ada layanan yang mendekati kuota atau melonjak.</li>';
  $('cfSalin').disabled=!d.peringatan.length;

  const CF_UNIT={request:'request',ms:'',event:'event',baris:'baris',byte:'',operasi:'operasi'};
  $('cfKuota').innerHTML=d.kuota.map(k=>{
    const t=cfTone(k.persen_proyeksi),u=CF_UNIT[k.unit]?' '+CF_UNIT[k.unit]:'',stok=k.unit==='byte';
    return '<div class="cap '+t+'"><div class="cap-top"><span>'+esc(k.nama)+(k.estimasi?' <span class="tag">perkiraan</span>':'')+'</span><b>'+pct(k.persen)+'</b></div>'+
      '<div class="cap-bar"><i class="p" style="width:'+Math.min(100,k.persen_proyeksi).toFixed(1)+'%"></i><i style="width:'+Math.min(100,k.persen).toFixed(1)+'%"></i></div>'+
      '<div class="cap-sub"><span>'+cfNilai(k,k.pakai)+' dari '+cfNilai(k,k.termasuk)+u+'</span>'+
      (stok?'<span>Ukuran saat ini</span>':'<span>Akhir bulan ±<b>'+cfNilai(k,k.proyeksi)+'</b> ('+pct(k.persen_proyeksi)+')'+(k.biaya>0?' · <b>'+cfUsd(k.biaya)+'</b>':'')+'</span>')+'</div></div>';
  }).join('');

  $('cfQ').innerHTML=d.query_boros.map((q,i)=>'<tr><td class="nm">'+esc(q.database)+'</td><td class="q"><code data-cfq="'+i+'" title="Klik untuk lihat lengkap">'+esc(q.query)+'</code></td>'+
    '<td class="n">'+int(q.jalan)+'</td><td class="n"><b>'+cfJml(q.rows_read)+'</b></td><td class="n">'+cfJml(q.rata_rows)+'</td><td class="n">'+cfMs(q.durasi_ms)+'</td></tr>').join('')||
    '<tr><td colspan="6" style="color:var(--muted)">Belum ada query sejak kemarin.</td></tr>';
  $('cfDb').innerHTML=d.databases.map(x=>'<tr'+(x.lonjakan?' class="lonjak"':'')+'><td class="nm">'+esc(x.nama)+(x.lonjakan?' <span class="tag loss">melonjak '+nf.format(Math.round(x.lonjakan.kali*10)/10)+'×</span>':'')+'</td>'+
    '<td class="n"><b>'+cfJml(x.read)+'</b></td><td class="n">'+cfJml(x.write)+'</td><td class="n">'+cfJml(x.query)+'</td><td class="n">'+cfJml(x.read_kemarin)+'</td><td class="n">'+cfJml(x.read_hari_ini)+'</td><td class="n">'+cfByte(x.ukuran)+'</td></tr>').join('')||
    '<tr><td colspan="7" style="color:var(--muted)">Tidak ada database D1.</td></tr>';
  $('cfW').innerHTML=d.workers.map(x=>'<tr'+(x.lonjakan?' class="lonjak"':'')+'><td class="nm">'+esc(x.nama)+(x.lonjakan?' <span class="tag loss">melonjak</span>':'')+'<small>rata-rata CPU '+nf.format(x.req?Math.round(x.cpu_ms/x.req*10)/10:0)+' ms/request</small></td>'+
    '<td class="n"><b>'+cfJml(x.req)+'</b></td><td class="n">'+cfMs(x.cpu_ms)+'</td><td class="n">'+cfJml(x.err)+'</td><td class="n">'+cfJml(x.req_kemarin)+'</td></tr>').join('')||
    '<tr><td colspan="5" style="color:var(--muted)">Tidak ada Worker.</td></tr>';
  $('cfR2').innerHTML=d.buckets.map(x=>'<tr'+(x.lonjakan?' class="lonjak"':'')+'><td class="nm">'+esc(x.nama)+'<small>'+int(x.objek)+' objek</small></td>'+
    '<td class="n">'+cfJml(x.a)+'</td><td class="n"><b>'+cfJml(x.b)+'</b></td><td class="n">'+cfByte(x.ukuran)+'</td></tr>').join('')||
    '<tr><td colspan="4" style="color:var(--muted)">Tidak ada bucket R2.</td></tr>';
  renderCfChart();
}

function renderCfChart(){
  const d=cfData;if(!d)return;
  const sumber=cfSeri==='d1'?d.databases.map(x=>({n:x.nama,s:x.harian})):d.workers.map(x=>({n:x.nama,s:x.harian}));
  // 5 terbesar ditampilkan sendiri, sisanya digabung "Lainnya"
  const tot=s=>s.reduce((a,b)=>a+b,0),urut=sumber.filter(x=>tot(x.s)>0).sort((a,b)=>tot(b.s)-tot(a.s));
  const atas=urut.slice(0,5),sisa=urut.slice(5);
  if(sisa.length)atas.push({n:'Lainnya',s:d.tanggal.map((_,i)=>sisa.reduce((a,x)=>a+x.s[i],0))});
  const warna=['--info','--spend','--rev','--pb','--loss','--line-2'].map(css);
  const labels=d.tanggal.map(t=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(t+'T00:00:00Z')));
  const datasets=atas.map((x,i)=>({label:x.n,data:x.s,backgroundColor:warna[i%warna.length],borderRadius:2,barPercentage:.75,stack:'a'}));
  put('cfChartSub',(cfSeri==='d1'?'Rows read per database':'Request per Worker')+' per hari, tanggal UTC · hari terakhir masih berjalan');
  if(cfChart)cfChart.destroy();
  cfChart=new Chart($('cfChart'),{type:'bar',data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'end',labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:'rectRounded',padding:14}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': '+cfJml(c.parsed.y)}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:10}},
        y:{stacked:true,grid:{color:css('--line')},border:{display:false},beginAtZero:true,ticks:{callback:v=>cfJml(v)}}}}});
}

/** Ringkasan peringatan untuk ditempel ke WhatsApp tim */
function cfPesan(){
  const d=cfData,p=d.periode;
  return '*Peringatan pemakaian Cloudflare* ('+tglWib(p.sampai)+')\n'+
    'Proyeksi tagihan bulan ini: *'+cfUsd(d.tagihan_proyeksi)+'* (di luar kuota '+cfUsd(d.biaya_lebih)+')\n\n'+
    d.peringatan.map(a=>(a.tingkat==='bahaya'?'🔴 ':'🟠 ')+'*'+a.judul+'*\n'+a.pesan).join('\n\n')+
    (d.query_boros.length?'\n\nQuery D1 terboros ('+d.query_boros[0].database+'): '+int(d.query_boros[0].jalan)+'× jalan, rata-rata '+cfJml(d.query_boros[0].rata_rows)+' baris dibaca per jalan:\n```'+d.query_boros[0].query.slice(0,300)+(d.query_boros[0].query.length>300?'…':'')+'```':'')+
    '\n\nMohon dicek ya 🙏';
}
$('cfMuat').addEventListener('click',()=>loadCf(true));
$('cfSeri').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  cfSeri=b.dataset.s;$('cfSeri').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderCfChart()});
$('cfQ').addEventListener('click',e=>{const c=e.target.closest('code[data-cfq]');if(c)c.classList.toggle('buka')});
$('cfSalin').addEventListener('click',async()=>{
  if(!cfData)return;const s=$('cfSalin').querySelector('span');
  try{await navigator.clipboard.writeText(cfPesan());s.textContent='Tersalin ✓'}
  catch(e){prompt('Salin pesan ini:',cfPesan());return}
  setTimeout(()=>{s.textContent='Salin pesan untuk tim'},2000);
});

