/**
 * Manajemen User (menu akun, hanya admin): daftar akun dashboard, tambah / ubah (menu yang boleh dibuka, hanya lihat / boleh ubah, aktif), hapus.
 * Data: /api/users. Script biasa (bukan module), dimuat SETELAH script utama index.html: memakai utils.js & api.js,
 * serta sembunyiPw() dan ikon SKU_IKON_EDIT / SKU_IKON_HAPUS dari script utama (window.*).
 * Dipanggil dari script utama: loadUsers() (menu Manajemen User).
 */
// ---- Manajemen User (hanya admin)
const US_MENU={ringkasan:'Ringkasan',iklan:'Iklan Meta',order:'Order',produk:'Data Produk',inventory:'Inventory',kirim:'Pengiriman',
  shopee:'Shopee',tiktok:'TikTok Shop',sales:'Sales',analisis:'Analisis',laporan:'Laporan keuangan',pengaturan:'Pengaturan'};
let usData=null,usEditId=null;
async function loadUsers(){
  try{usData=await api('/api/users');renderUsers()}
  catch(e){$('usRows').innerHTML='<tr><td colspan="6" style="color:var(--loss)">Gagal memuat data ('+esc(e.message)+').</td></tr>'}
}
function renderUsers(){
  const d=usData,aktif=d.rows.filter(r=>r.aktif).length;
  put('usInfo','Akun yang bisa masuk ke dashboard · '+int(d.rows.length)+' user · '+int(aktif)+' aktif');
  $('usRows').innerHTML=d.rows.map(r=>'<tr><td class="nm">'+esc(r.nama||r.username)+'<small>'+esc(r.username)+(r.username===d.saya?' · akun Anda':'')+'</small></td>'+
    '<td>'+(r.admin?'<span class="tag info">Semua menu + kelola user</span>':r.menu.map(m=>'<span class="tag">'+esc(US_MENU[m]||m)+'</span>').join(' '))+'</td>'+
    '<td>'+(r.admin||r.boleh_ubah?'<span class="tag rev">Boleh ubah</span>':'<span class="tag">Hanya lihat</span>')+'</td>'+
    '<td>'+(r.aktif?'<span class="tag rev">Aktif</span>':'<span class="tag loss">Nonaktif</span>')+'</td>'+
    '<td>'+(r.login_terakhir?esc(tglWib(r.login_terakhir,true)):'<span style="color:var(--muted)">Belum pernah</span>')+'</td>'+
    '<td class="n"><span class="ak"><button class="ed" data-ed="'+r.id+'" title="Ubah" aria-label="Ubah '+esc(r.username)+'">'+SKU_IKON_EDIT+'</button>'+
    (r.username===d.saya?'':'<button class="hp" data-hp="'+r.id+'" title="Hapus" aria-label="Hapus '+esc(r.username)+'">'+SKU_IKON_HAPUS+'</button>')+'</span></td></tr>').join('')||
    '<tr><td colspan="6" style="color:var(--muted)">Belum ada user. Klik "Tambah user" untuk membuat akun CS, gudang, atau tim lain.</td></tr>';
}
function usBukaForm(r){
  usEditId=r?r.id:null;const f=$('usForm');f.reset();sembunyiPw(f);
  $('usMenu').innerHTML=Object.keys(US_MENU).map(k=>'<label class="us-cek"><input type="checkbox" name="menu" value="'+k+'"'+(r&&r.menu.includes(k)?' checked':'')+'> '+US_MENU[k]+'</label>').join('');
  f.elements.mode.value=r&&r.boleh_ubah?'ubah':'lihat';f.elements.aktif.checked=!r||!!r.aktif;
  if(r){f.elements.username.value=r.username;f.elements.nama.value=r.nama||'';f.elements.admin.checked=!!r.admin}
  f.elements.password.required=!r;f.elements.password.placeholder=r?'Kosongkan bila tidak diganti':'Minimal 8 karakter';
  put('usDlgJ',r?'Ubah user '+r.username:'Tambah user');put('usMsg','');$('usAksesW').hidden=f.elements.admin.checked;
  $('usDlg').showModal();f.elements[r?'nama':'username'].focus();
}
$('usTambah').addEventListener('click',()=>usBukaForm(null));
$('usTutup').addEventListener('click',()=>$('usDlg').close());
$('usBatal').addEventListener('click',()=>$('usDlg').close());
$('usDlg').addEventListener('click',e=>{if(e.target===$('usDlg'))$('usDlg').close()});
$('usForm').elements.admin.addEventListener('change',e=>{$('usAksesW').hidden=e.target.checked});
$('usForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=$('usForm'),b=$('usSimpan');
  const data={username:f.elements.username.value.trim(),nama:f.elements.nama.value.trim(),password:f.elements.password.value,admin:f.elements.admin.checked,
    menu:[...f.querySelectorAll('input[name=menu]:checked')].map(x=>x.value),boleh_ubah:f.elements.mode.value==='ubah',aktif:f.elements.aktif.checked};
  if(usEditId)data.id=usEditId;
  b.disabled=true;put('usMsg','');
  try{
    await api('/api/users',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    $('usDlg').close();await loadUsers();
  }catch(err){put('usMsg','Gagal menyimpan: '+err.message)}
  finally{b.disabled=false}
});
$('usRows').addEventListener('click',async e=>{
  const ed=e.target.closest('[data-ed]'),hp=e.target.closest('[data-hp]');
  if(ed)usBukaForm(usData.rows.find(r=>r.id===Number(ed.dataset.ed)));
  if(hp){
    const r=usData.rows.find(x=>x.id===Number(hp.dataset.hp));
    if(!r||!confirm('Hapus user "'+r.username+'"? User ini tidak bisa login lagi. Untuk sementara saja, lebih baik nonaktifkan lewat tombol ubah.'))return;
    try{await api('/api/users/'+r.id,{method:'DELETE'});await loadUsers()}catch(err){alert('Gagal menghapus: '+err.message)}
  }
});
