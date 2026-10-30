/**
 * Pemanggil API Worker + login. Script biasa (bukan module) — `api()` global dipakai script utama.
 * Setelah login berhasil dikirim event `login-berhasil` di document (script utama memeriksa ulang hak akses).
 * Dimuat setelah utils.js, sebelum script utama; elemen login & tombol keluar sudah ada di HTML di atasnya.
 */
// ---- Login: sesi disimpan server sebagai cookie HttpOnly; 401 dari API → tampilkan halaman login,
// tunggu sampai berhasil masuk, lalu ulangi permintaan yang tadi ditolak.
try{localStorage.removeItem('dk')}catch(e){}   // sisa cara lama (password disimpan di browser)
let tungguLogin=null,loginSelesai=null;
function mintaLogin(){
  if(!tungguLogin){
    tungguLogin=new Promise(res=>{loginSelesai=res});
    const el=document.getElementById('login');el.hidden=false;
    document.getElementById('loginMsg').textContent='';
    setTimeout(()=>{const u=document.getElementById('loginUser');(u.value?document.getElementById('loginPw'):u).focus()});
  }
  return tungguLogin;
}
document.getElementById('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const b=document.getElementById('loginBtn'),msg=document.getElementById('loginMsg');
  b.disabled=true;b.textContent='Memeriksa…';msg.textContent='';
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:document.getElementById('loginUser').value,password:document.getElementById('loginPw').value})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){msg.textContent=j.error||('Gagal masuk (HTTP '+r.status+')');document.getElementById('loginPw').select();return}
    document.getElementById('loginPw').value='';
    document.getElementById('login').hidden=true;
    document.dispatchEvent(new CustomEvent('login-berhasil'));   // script utama memeriksa ulang hak akses (akun baru bisa beda)
    const selesai=loginSelesai;tungguLogin=null;loginSelesai=null;selesai();
  }catch(err){msg.textContent='Tidak bisa terhubung ke server ('+err.message+')'}
  finally{b.disabled=false;b.textContent='Masuk'}
});
document.getElementById('loginLihat').addEventListener('click',()=>{
  const p=document.getElementById('loginPw'),t=document.getElementById('loginLihat'),lihat=p.type==='password';
  p.type=lihat?'text':'password';t.textContent=lihat?'Sembunyi':'Lihat';t.setAttribute('aria-label',lihat?'Sembunyikan password':'Tampilkan password');
});
document.querySelectorAll('[data-keluar]').forEach(b=>b.addEventListener('click',async()=>{
  b.disabled=true;
  try{await fetch('/api/logout',{method:'POST'})}catch(e){}
  location.reload();
}));

async function api(path,opts){
  opts=opts||{};
  for(let i=0;i<4;i++){
    const r=await fetch(path,{method:opts.method||'GET',headers:Object.assign({},opts.headers),body:opts.body});
    if(r.status===401){await mintaLogin();continue}
    if(!r.ok){
      // Pakai pesan { error } dari server bila ada, supaya pengguna tahu apa yang salah
      let m='HTTP '+r.status;
      try{const j=await r.json();if(j&&j.error)m=j.error}catch(e){}
      throw new Error(m);
    }
    return r.json();
  }
  throw new Error('login gagal berulang kali');
}
