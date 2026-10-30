/**
 * Fungsi bantu umum: format Rupiah / angka / persen / tanggal, akses elemen, warna tema, unduh CSV.
 * Script biasa (bukan module) — semua nama di sini global dan dipakai script utama di index.html.
 * Dimuat sebelum api.js dan script utama.
 */
// ---- format
const nf=new Intl.NumberFormat('id-ID');
const rpFull=v=>v==null?'—':'Rp '+nf.format(Math.round(v));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const int=v=>v==null?'—':nf.format(Math.round(v));
const pct=v=>v==null?'—':nf.format(Math.round(v*10)/10)+'%';
function rp(v){
  if(v==null)return '—';
  const a=Math.abs(v);
  if(a>=1e9)return 'Rp '+nf.format(Math.round(v/1e8)/10)+' M';
  if(a>=1e6)return 'Rp '+nf.format(Math.round(v/1e5)/10)+' jt';
  if(a>=1e3)return 'Rp '+nf.format(Math.round(v/100)/10)+' rb';
  return 'Rp '+nf.format(Math.round(v));
}
function mins(m){
  if(m==null)return '—';
  m=Math.round(m);
  if(m<60)return m+' m';
  return Math.floor(m/60)+' j '+String(m%60).padStart(2,'0')+' m';
}
const ymd=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(d);
const shift=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
function fmtRange(a,b){
  const d=s=>new Date(s+'T00:00:00Z');
  const full=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  if(a===b)return full.format(d(a));
  const A=d(a),B=d(b);
  if(A.getUTCFullYear()===B.getUTCFullYear()&&A.getUTCMonth()===B.getUTCMonth())return A.getUTCDate()+'–'+full.format(B);
  return full.format(A)+' – '+full.format(B);
}
/** Tanggal (opsional jam) WIB: "30 Okt 26" / "30 Okt 26 14.05"; v = ISO / timestamp / Date; kosong → "—" */
const tglWib=(v,jam)=>v?new Intl.DateTimeFormat('id-ID',Object.assign({day:'numeric',month:'short',year:'2-digit',timeZone:'Asia/Jakarta'},jam?{hour:'2-digit',minute:'2-digit'}:{})).format(new Date(v)):'—';

// ---- Elemen & tema
const $=id=>document.getElementById(id);
const put=(id,v)=>{const e=$(id);if(e)e.textContent=v};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---- Laporan: Rupiah bertanda (negatif merah) & persen terhadap dasar
const lpRp=(v,tanda)=>{v=Math.round(v||0);if(!v)return '<span class="lr-nol">—</span>';const neg=tanda<0?v>0:v<0;return '<span class="'+(neg?'lr-neg':'')+'">'+(neg?'− ':'')+rpFull(Math.abs(v))+'</span>'};
const lpPct=(v,dasar)=>dasar?pct(100*v/dasar):'—';
// ---- Angka dengan 2 desimal (ROAS, rasio)
const nf2=new Intl.NumberFormat('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2});

// ---- Unduh tabel sebagai CSV (Excel-friendly: BOM + CRLF)
function unduhCsv(nama,head,body){
  const csv=[head].concat(body).map(r=>r.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=nama;a.click();
  URL.revokeObjectURL(url);
}
