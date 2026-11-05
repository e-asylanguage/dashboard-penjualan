/**
 * Pengaturan: Toko Marketplace (Shopee & TikTok: sumber data, gudang, koneksi API), Sinkronisasi Meta Ads (BM, token, centang ad account), salin template UTM, ambil ulang order Scalev.
 * Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js, serta dari script utama (window.*): loadSettings(), spToko & tkToko (dibaca & diisi), spBukaToko().
 * Dipanggil dari script utama: tmMuat(), loadMeta() (menu Pengaturan; tmMuat juga setelah simpan toko).
 */
let tmData=null;
async function tmMuat(){
  try{
    const [s,sa,t]=await Promise.all([api('/api/shopee/toko'),api('/api/shopee-api/toko').catch(e=>({gagal:e.message,toko:[]})),api('/api/tiktok/toko').catch(()=>({toko:[],gudang:[]}))]);
    tmData={s,sa,t};spToko=s;tmRender();
  }catch(e){$('tmIsi').innerHTML='<p style="color:var(--loss)">Gagal memuat toko ('+esc(e.message)+').</p>'}
}
const tmMode=(pf,t)=>'<select class="gd-pilih" data-tm-mode="'+pf+'|'+t.id+'"><option value="upload"'+(t.mode!=='api'?' selected':'')+'>⬆ Upload manual</option><option value="api"'+(t.mode==='api'?' selected':'')+'>⚡ API (otomatis)</option></select>';
/** Gudang Kilat (Shopee) / FBT (TikTok): stok di gudang platform — pesanan Kilat / FBT mengurangi stok gudang ini */
const tmPlat=(pf,t,gudang)=>{const lbl=pf==='shopee'?'Pengiriman Kilat':'Fulfilled by TikTok';
  return '<select class="gd-pilih'+(t.pesanan_platform&&!t.gudang_platform_id?' kosong':'')+'" data-tm-plat="'+pf+'|'+t.id+'" title="Gudang untuk pesanan '+lbl+'"><option value="">— tidak dipakai —</option>'+
    (gudang||[]).map(g=>'<option value="'+g.id+'"'+(g.id===t.gudang_platform_id?' selected':'')+'>'+esc(g.nama)+'</option>').join('')+'</select>'+
    '<small class="mm-sub">'+(t.pesanan_platform?int(t.pesanan_platform)+' pesanan '+lbl+(t.gudang_platform_id?'':' · belum mengurangi stok'):'belum ada pesanan '+lbl)+'</small>'};
function tmRender(){
  const {s,sa,t}=tmData,saPer=new Map((sa.toko||[]).map(x=>[String(x.shop_id),x]));
  {const ts=s.toko||[],tt=t.toko||[],nApi=[...ts,...tt].filter(x=>x.mode==='api').length;
    $('pgInfoToko').innerHTML='<b>'+int(ts.length)+'</b> toko Shopee · <b>'+int(tt.length)+'</b> toko TikTok · <b>'+int(nApi)+'</b> memakai API'}
  const kunciShopee=sa.gagal?'<span class="tag warn">kunci API Shopee belum di-set</span>':sa.sandbox?'<span class="tag warn">kunci API Shopee masih kunci UJI (sandbox) — ganti ke kunci Live</span>':'<span class="tag rev">API Shopee: Live</span>';
  const kon=(mode,ok,sejak,sub)=>mode!=='api'?'<span style="color:var(--muted)">— (upload manual)</span>':ok?'<span class="tag rev">✅ Terhubung</span><small class="mm-sub">'+esc(sub||'')+(sejak?' · sejak '+tglWib(sejak,true):'')+'</small>':'<span class="tag loss">❌ Belum terhubung</span><small class="mm-sub">klik Hubungkan API, login dengan akun toko ini</small>';
  $('tmIsi').innerHTML=
    '<div class="tm-plat"><div class="tm-h"><b>Shopee</b> '+kunciShopee+'<button class="btn ghost" data-tm-tambah="shopee">+ Tambah toko Shopee</button></div>'+
    '<table class="sku-tbl gd-tbl lr-tbl" data-dt="off"><thead><tr><th>Toko</th><th>Shop ID</th><th>Gudang</th><th>Gudang Kilat / FBT</th><th>Sumber data</th><th>Koneksi API</th><th class="n">Aksi</th></tr></thead><tbody>'+
    ((s.toko||[]).map(x=>{const c=saPer.get(String(x.shop_id||''));
      return '<tr><td class="lr-nm"><b>'+esc(x.nama)+'</b><small>'+esc(x.username||'username belum diisi')+'</small></td><td>'+(x.shop_id?esc(x.shop_id):'<span style="color:var(--muted)">—</span>')+'</td>'+
        '<td>'+(x.gudang?esc(x.gudang):'<span class="tag warn">belum diatur</span>')+'</td><td>'+tmPlat('shopee',x,s.gudang)+'</td><td>'+tmMode('shopee',x)+'</td>'+
        '<td>'+kon(x.mode,!!x.api_sejak,x.api_sejak,c&&c.expire_at?'token diperbarui otomatis':'')+'</td>'+
        '<td class="n"><span class="bo-aksi"><button data-tm-ubah="shopee|'+x.id+'">Ubah</button>'+(x.mode==='api'?'<button data-tm-hubung="shopee|'+x.id+'">'+(x.api_sejak?'Hubungkan ulang':'Hubungkan API')+'</button>':'')+
        (x.api_sejak?'<button class="hapus" data-tm-putus="shopee|'+esc(x.shop_id)+'">Putuskan API</button>':'')+(x.pesanan?'':'<button class="hapus" data-tm-hapus="shopee|'+x.id+'">Hapus</button>')+'</span></td></tr>'}).join('')||
      '<tr><td colspan="7" style="color:var(--muted)">Belum ada toko Shopee.</td></tr>')+'</tbody></table></div>'+
    '<div class="tm-plat"><div class="tm-h"><b>TikTok Shop</b> <span class="tag">termasuk channel Tokopedia</span><button class="btn ghost" data-tm-tambah="tiktok">+ Tambah toko TikTok</button></div>'+
    '<table class="sku-tbl gd-tbl lr-tbl" data-dt="off"><thead><tr><th>Toko</th><th>Shop ID</th><th>Gudang</th><th>Gudang Kilat / FBT</th><th>Sumber data</th><th>Koneksi API</th><th class="n">Aksi</th></tr></thead><tbody>'+
    ((t.toko||[]).map(x=>'<tr><td class="lr-nm"><b>'+esc(x.nama)+'</b><small>'+int(x.pesanan||0)+' pesanan tersimpan</small></td><td>'+(x.shop_id?esc(x.shop_id):'<span style="color:var(--muted)">—</span>')+'</td>'+
      '<td><select class="gd-pilih" data-tm-gudang="'+x.id+'"><option value="">— pilih gudang —</option>'+(t.gudang||[]).map(g=>'<option value="'+g.id+'"'+(g.id===x.gudang_id?' selected':'')+'>'+esc(g.nama)+'</option>').join('')+'</select></td>'+
      '<td>'+tmPlat('tiktok',x,t.gudang)+'</td><td>'+tmMode('tiktok',x)+'</td><td>'+kon(x.mode,!!x.api_akun,x.api_sejak,x.api_akun?'akun '+x.api_akun:'')+'</td>'+
      '<td class="n"><span class="bo-aksi"><button data-tm-ubah="tiktok|'+x.id+'">Ubah</button>'+(x.mode==='api'?'<button data-tm-hubung="tiktok|'+x.id+'">'+(x.api_akun?'Hubungkan ulang':'Hubungkan API')+'</button>':'')+
      (x.pesanan?'':'<button class="hapus" data-tm-hapus="tiktok|'+x.id+'">Hapus</button>')+'</span></td></tr>').join('')||
      '<tr><td colspan="7" style="color:var(--muted)">Belum ada toko TikTok.</td></tr>')+'</tbody></table></div>';
}
const tmSimpanTiktok=b=>api('/api/tiktok/toko',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
$('tmIsi').addEventListener('change',async e=>{
  const m=e.target.closest('[data-tm-mode]'),g=e.target.closest('[data-tm-gudang]'),pl=e.target.closest('[data-tm-plat]');
  try{
    if(pl){const [pf,id]=pl.dataset.tmPlat.split('|');
      await api('/api/'+pf+'/toko/'+id+'/gudang-platform',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({gudang_id:pl.value?Number(pl.value):null})});
      tkToko=null;spToko=null;await tmMuat();return}
    if(m){const [pf,id]=m.dataset.tmMode.split('|'),x=(pf==='shopee'?tmData.s:tmData.t).toko.find(y=>String(y.id)===id);
      if(pf==='shopee')await api('/api/shopee/toko',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id,nama:x.nama,username:x.username,shop_id:x.shop_id,gudang_id:x.gudang_id,mode:m.value})});
      else await tmSimpanTiktok({id:x.id,nama:x.nama,gudang_id:x.gudang_id,mode:m.value});
      tkToko=null;await tmMuat()}
    if(g){const x=tmData.t.toko.find(y=>String(y.id)===g.dataset.tmGudang);await tmSimpanTiktok({id:x.id,nama:x.nama,gudang_id:g.value?Number(g.value):null});await tmMuat()}
  }catch(err){alert('Gagal menyimpan: '+err.message);tmMuat()}
});
$('tmIsi').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const [pf,id]=(b.dataset.tmUbah||b.dataset.tmHubung||b.dataset.tmPutus||b.dataset.tmHapus||'').split('|');
  try{
    if(b.dataset.tmTambah==='shopee')return spBukaToko();
    if(b.dataset.tmTambah==='tiktok'){const nama=prompt('Nama toko TikTok:');if(nama&&nama.trim()){await tmSimpanTiktok({nama:nama.trim(),mode:'upload'});await tmMuat()}return}
    if(b.dataset.tmUbah){
      if(pf==='shopee')return spBukaToko(tmData.s.toko.find(y=>String(y.id)===id));
      const x=tmData.t.toko.find(y=>String(y.id)===id),nama=prompt('Nama toko:',x.nama);if(nama==null)return;
      const shop=prompt('Shop ID TikTok (kosongkan bila belum tahu — terisi otomatis saat Hubungkan API):',x.shop_id||'');if(shop==null)return;
      await tmSimpanTiktok({id:x.id,nama:nama.trim()||x.nama,gudang_id:x.gudang_id,shop_id:shop.trim()});return tmMuat();
    }
    if(b.dataset.tmHubung){
      const x=(pf==='shopee'?tmData.s:tmData.t).toko.find(y=>String(y.id)===id);
      if(!confirm('Hubungkan API untuk toko '+x.nama+'?\n\nAnda akan diarahkan ke halaman izin '+(pf==='shopee'?'Shopee':'TikTok Shop')+'. Login dengan akun penjual TOKO INI, lalu setujui. Data API otomatis masuk ke toko yang Shop ID-nya sama.'))return;
      const d=await api('/api/'+(pf==='shopee'?'shopee-api':'tiktok-api')+'/link-izin?toko='+id);location.href=d.url;return;
    }
    if(b.dataset.tmPutus&&confirm('Putuskan koneksi API Shopee untuk shop_id '+id+'? Data yang sudah tersimpan tetap ada.')){await api('/api/shopee-api/toko/'+encodeURIComponent(id),{method:'DELETE'});return tmMuat()}
    if(b.dataset.tmHapus){const x=(pf==='shopee'?tmData.s:tmData.t).toko.find(y=>String(y.id)===id);
      if(!confirm('Hapus toko '+x.nama+'?'))return;await api('/api/'+pf+'/toko/'+id,{method:'DELETE'});return tmMuat()}
  }catch(err){alert('Gagal: '+err.message)}
});

// ---- Sinkronisasi Meta Ads: BM (nama, app id, token) + centang ad account
// Status ad account Meta selain 1 (aktif)
const META_STATUS={2:'nonaktif',3:'tagihan belum lunas',7:'dalam review',8:'menunggu penyelesaian',9:'masa tenggang',100:'akan ditutup',101:'ditutup',201:'aktif (tertentu)'};
let metaSet=null,metaBaru=0;

function metaBlok(bm,akun,adaToken){
  const baru=!bm.id,dipilih=akun.filter(a=>a.is_selected).length;
  const st=[];
  if(bm.token_owner)st.push('Token milik <b>'+esc(bm.token_owner)+'</b>');
  if(bm.token_checked_at)st.push('dicek '+tglWib(bm.token_checked_at,true)+' WIB');
  if(bm.token_error)st.push('<span class="bad">Error terakhir: '+esc(bm.token_error)+'</span>');
  const li=akun.map(a=>{
    const info=[esc(a.id),esc(a.currency||'')].filter(Boolean);
    if(a.status!=null&&a.status!==1)info.push('<span class="st">'+esc(META_STATUS[a.status]||('status '+a.status))+'</span>');
    if(a.spend_30d)info.push(esc(rpFull(a.spend_30d))+' / 30 hari');
    const pc=v=>v==null?'':String(v).replace('.',',');
    return '<li><label><input type="checkbox" value="'+esc(a.id)+'"'+(a.is_selected?' checked':'')+'>'+
      '<span>'+esc(a.name)+' <small>('+info.join(' · ')+')</small></span></label>'+
      // Tax & admin dalam % dari spend; koma atau titik sama-sama diterima
      '<span class="mbm-biaya" data-akun="'+esc(a.id)+'">'+
        '<label>Tax <input name="tax_pct" inputmode="decimal" value="'+esc(pc(a.tax_pct))+'" placeholder="0" aria-label="Tax % '+esc(a.name)+'">%</label>'+
        '<label>Admin <input name="admin_pct" inputmode="decimal" value="'+esc(pc(a.admin_pct))+'" placeholder="0" aria-label="Admin % '+esc(a.name)+'">%</label>'+
      '</span></li>';
  }).join('');
  return '<div class="mbm" data-id="'+esc(bm.id||'')+'">'+
    '<div class="mbm-f">'+
      '<label><span>Nama BM</span><input name="name" value="'+esc(bm.name||'')+'" placeholder="mis. Unika Store Soscom"></label>'+
      '<label><span>App ID</span><input name="app_id" value="'+esc(bm.app_id||'')+'" inputmode="numeric"></label>'+
      '<label><span>Token '+(adaToken?'<span class="ok">(tersimpan ✓)</span>':'<span class="bad">(belum ada)</span>')+'</span>'+
        '<input name="token" type="password" autocomplete="new-password" class="'+(adaToken?'ada':'')+'" placeholder="'+(adaToken?'kosongkan = tak diubah':'tempel token System User')+'"></label>'+
      '<button type="button" class="btn primary" data-act="simpan">Simpan BM</button>'+
      '<button type="button" class="btn hapus" data-act="hapus">'+(baru?'Batal':'Hapus BM')+'</button>'+
    '</div>'+
    (st.length?'<div class="mbm-st">'+st.join(' · ')+'</div>':'')+
    '<div class="mbm-msg" style="padding:0 14px 8px" hidden></div>'+
    (baru||!adaToken?'<div class="mbm-kosong">'+(baru?'Simpan BM dulu untuk memuat daftar ad account.':'Isi token lalu Simpan BM untuk memuat daftar ad account.')+'</div>':
     '<div class="mbm-h"><span class="jml">'+int(akun.length)+' akun · '+int(dipilih)+' dipilih</span><span class="kanan">'+
       '<button type="button" data-act="tarik">Muat ulang akun</button>'+
       (akun.length?'<label><input type="checkbox" data-act="semua"'+(dipilih===akun.length?' checked':'')+'> pilih semua</label>':'')+'</span></div>'+
     (akun.length?'<div class="mbm-biaya-h">Tax &amp; admin (% dari spend)</div><ul class="mbm-akun">'+li+'</ul>'+
       '<div class="mbm-aksi"><button type="button" class="btn primary" data-act="pilih">Simpan akun, tax &amp; admin</button><span class="hasil"></span></div>'
       :'<div class="mbm-kosong">Belum ada ad account. Klik "Muat ulang akun".</div>'))+
  '</div>';
}

function renderMeta(){
  const s=metaSet;if(!s)return;
  const akun=s.ad_accounts||[];
  const blok=(s.business_managers||[]).map(bm=>metaBlok(bm,akun.filter(a=>a.bm_id===bm.id),!!(s.tokens||{})[bm.id]));
  for(let i=0;i<metaBaru;i++)blok.push(metaBlok({},[],false));
  $('metaBmList').innerHTML=blok.join('')||'<div style="color:var(--muted)">Belum ada BM. Klik "+ Tambah BM".</div>';
  {const bm=s.business_managers||[],aktif=akun.filter(a=>a.is_selected).length;
    $('pgInfoMeta').innerHTML='<b>'+int(bm.length)+'</b> BM · <b>'+int(aktif||akun.length)+'</b> akun iklan'+(aktif?' ditarik':'')}
}

async function loadMeta(){
  try{metaSet=await loadSettings();renderMeta()}
  catch(e){$('metaBmList').innerHTML='<div style="color:var(--loss)">Gagal memuat ('+esc(e.message)+').</div>'}
}

const metaPesan=(blok,t,kelas)=>{const m=blok.querySelector('.mbm-msg');m.hidden=!t;m.innerHTML=t||'';m.className='mbm-msg '+(kelas||'')};
const metaJson=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
// api() hanya melempar "HTTP 400"; di sini pesan error dari server ikut ditampilkan (mis. token ditolak Meta).
async function metaApi(path,opts){
  const r=await fetch(path,{method:opts.method,headers:Object.assign({},opts.headers),body:opts.body});
  if(r.status===401)return api(path,opts);
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
  return j;
}
const metaBlokId=id=>document.querySelector('#metaBmList .mbm[data-id="'+CSS.escape(id)+'"]');

$('metaTambah').addEventListener('click',()=>{
  metaBaru++;renderMeta();
  const b=[...document.querySelectorAll('#metaBmList .mbm')].pop();if(b)b.querySelector('input[name=name]').focus();
});

// Ketik tax/admin → tandai belum disimpan (event change baru jalan saat input ditinggalkan)
$('metaBmList').addEventListener('input',e=>{
  if(!e.target.closest('.mbm-biaya'))return;
  e.target.classList.remove('bad');
  const h=e.target.closest('.mbm').querySelector('.mbm-aksi .hasil');if(h){h.textContent='Belum disimpan';h.className='hasil'}
});
$('metaBmList').addEventListener('change',e=>{
  const blok=e.target.closest('.mbm');if(!blok)return;
  const kotak=[...blok.querySelectorAll('.mbm-akun input[type=checkbox]')];
  if(e.target.dataset.act==='semua')kotak.forEach(k=>{k.checked=e.target.checked});
  const n=kotak.filter(k=>k.checked).length,j=blok.querySelector('.jml');
  if(j)j.textContent=int(kotak.length)+' akun · '+int(n)+' dipilih';
  const semua=blok.querySelector('input[data-act=semua]');if(semua)semua.checked=kotak.length>0&&n===kotak.length;
  const h=blok.querySelector('.mbm-aksi .hasil');if(h){h.textContent='Belum disimpan';h.className='hasil'}
});

$('metaBmList').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-act]');if(!b)return;
  const blok=b.closest('.mbm'),id=blok.dataset.id,act=b.dataset.act;
  const val=n=>blok.querySelector('input[name='+n+']').value.trim();
  if(act==='hapus'){
    if(!id){metaBaru=Math.max(0,metaBaru-1);renderMeta();return}
    if(!confirm('Hapus BM "'+(val('name')||id)+'" beserta daftar ad account-nya? Data spend yang sudah tertarik tetap disimpan.'))return;
    b.disabled=true;
    try{await metaApi('/api/settings/bm/'+encodeURIComponent(id),{method:'DELETE'});await loadMeta()}
    catch(err){b.disabled=false;metaPesan(blok,'Gagal menghapus: '+esc(err.message),'bad')}
    return;
  }
  if(act==='simpan'){
    if(!val('name')){metaPesan(blok,'Nama BM wajib diisi','bad');return}
    if(!id&&!val('token')){metaPesan(blok,'Isi token untuk BM baru','bad');return}
    b.disabled=true;metaPesan(blok,val('token')?'Mengecek token ke Meta &amp; memuat daftar akun…':'Menyimpan…');
    try{
      const r=await metaApi('/api/settings/bm',metaJson('PUT',{id:id||undefined,name:val('name'),app_id:val('app_id'),token:val('token')||undefined}));
      if(!id)metaBaru=Math.max(0,metaBaru-1);
      await loadMeta();
      const gagal=r.accounts&&!r.accounts.ok,bl=metaBlokId(r.id);
      if(bl)metaPesan(bl,gagal?'Tersimpan, tetapi daftar akun gagal dimuat: '+esc(r.accounts.message||''):
        'Tersimpan'+(r.owner?' · token milik '+esc(r.owner):'')+(r.accounts?' · '+esc(r.accounts.message||''):''),gagal?'bad':'ok');
    }catch(err){b.disabled=false;metaPesan(blok,esc(err.message),'bad')}
    return;
  }
  if(act==='tarik'){
    b.disabled=true;b.textContent='Memuat…';
    try{
      const r=await metaApi('/api/settings/bm/'+encodeURIComponent(id)+'/discover',{method:'POST'});
      await loadMeta();
      const bl=metaBlokId(id);if(bl)metaPesan(bl,esc(r.message||''),r.ok?'ok':'bad');
    }catch(err){b.disabled=false;b.textContent='Muat ulang akun';metaPesan(blok,esc(err.message),'bad')}
    return;
  }
  if(act==='pilih'){
    const pilih=[...blok.querySelectorAll('.mbm-akun input[type=checkbox]:checked')].map(k=>k.value);
    const h=blok.querySelector('.mbm-aksi .hasil');
    // Tax & admin per akun: kosong = belum diisi, selain itu 0–100 (koma desimal diterima)
    const biaya={},salah=[];
    blok.querySelectorAll('.mbm-biaya').forEach(sp=>{
      const v={};
      ['tax_pct','admin_pct'].forEach(k=>{
        const inp=sp.querySelector('input[name='+k+']'),t=inp.value.trim().replace(',','.');
        const n=t===''?null:Number(t),ok=n===null||(Number.isFinite(n)&&n>=0&&n<=100);
        inp.classList.toggle('bad',!ok);if(!ok)salah.push(inp);v[k]=n;
      });
      biaya[sp.dataset.akun]=v;
    });
    if(salah.length){h.textContent='Tax / admin harus angka 0–100 (%)';h.className='hasil bad';salah[0].focus();return}
    b.disabled=true;h.textContent='Menyimpan…';h.className='hasil';
    try{
      await metaApi('/api/settings/ad-accounts',metaJson('PUT',{bm_id:id,selected:pilih,biaya}));
      (metaSet.ad_accounts||[]).forEach(a=>{if(a.bm_id===id){a.is_selected=pilih.includes(a.id)?1:0;
        if(biaya[a.id]){a.tax_pct=biaya[a.id].tax_pct;a.admin_pct=biaya[a.id].admin_pct}}});
      h.textContent='Tersimpan · '+int(pilih.length)+' akun ditarik pada sinkron berikutnya';h.className='hasil ok';
    }catch(err){h.textContent='Gagal: '+err.message;h.className='hasil bad'}
    finally{b.disabled=false}
  }
});

// ---- Salin template UTM
$('utmSalin').addEventListener('click',async()=>{
  const b=$('utmSalin'),teks=$('utmKode').textContent.trim();
  // Cadangan execCommand untuk browser yang menolak Clipboard API (mis. bukan HTTPS / tanpa izin).
  const cadangan=()=>{const t=document.createElement('textarea');t.value=teks;t.style.position='fixed';t.style.opacity='0';
    document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();return ok};
  let ok=false;
  try{await navigator.clipboard.writeText(teks);ok=true}catch(e){ok=cadangan()}
  b.textContent=ok?'Tersalin':'Gagal menyalin';
  setTimeout(()=>{b.textContent='Salin'},1500);
});

// ---- Ambil ulang order Scalev per rentang tanggal (default: kemarin WIB)
(function(){
  const f=$('pullForm');if(!f)return;
  const tglWib=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d);
  const kemarin=tglWib(new Date(Date.now()-86400000));
  $('pullFrom').value=kemarin;$('pullTo').value=kemarin;
  $('pullFrom').max=$('pullTo').max=tglWib(new Date());
  f.addEventListener('submit',async e=>{
    e.preventDefault();
    const from=$('pullFrom').value,to=$('pullTo').value,msg=$('pullMsg'),btn=$('pullBtn');
    if(from>to){msg.textContent='Tanggal "Dari" harus sebelum "Sampai".';return}
    btn.disabled=true;btn.textContent='Mengambil…';msg.textContent='';
    try{
      const r=await api('/api/sync/backfill-range?from='+from+'&to='+to,{method:'POST'});
      msg.textContent=r.ok?'Selesai · '+int(r.rows)+' order diperbarui ('+from+(from===to?'':' s/d '+to)+')':'Gagal: '+(r.message||'tidak diketahui');
      await loadSettings().catch(function(){});
    }catch(err){msg.textContent='Gagal: '+err.message}
    finally{btn.disabled=false;btn.textContent='Ambil'}
  });
})();
