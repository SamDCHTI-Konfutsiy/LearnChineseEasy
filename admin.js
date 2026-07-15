// sb (Supabase client) config.js faylidan keladi.

let currentUserId = null;

function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString('uz-UZ'); }catch(e){ return iso; } }

async function init(){
  const {data:{session}} = await sb.auth.getSession();
  if(!session){
    document.getElementById('stateLoading').innerHTML =
      `<p>Avval tizimga kiring.</p><p><a href="index.html">Kirish sahifasiga o'tish</a></p>`;
    return;
  }
  currentUserId = session.user.id;
  const {data: myProfile, error} = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if(error || !myProfile || myProfile.role !== 'admin'){
    document.getElementById('stateLoading').classList.add('hidden');
    document.getElementById('stateNoAccess').classList.remove('hidden');
    return;
  }
  document.getElementById('stateLoading').classList.add('hidden');
  document.getElementById('adminContent').classList.remove('hidden');
  await loadUsers();
}

async function loadUsers(){
  const {data: users, error} = await sb.from('profiles').select('*').order('created_at', {ascending:false});
  if(error){ alert('Xatolik: '+error.message); return; }
  const tbody = document.getElementById('usersTbody');
  tbody.innerHTML = '';
  users.forEach(u=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(u.email)}${u.role==='admin' ? '<span class="badge role-admin">admin</span>' : ''}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td><span class="badge ${u.is_active ? 'active':'inactive'}">${u.is_active ? 'Faol':'Bloklangan'}</span></td>
      <td class="actions-cell"></td>`;
    const actionTd = tr.querySelector('.actions-cell');

    const toggleBtn = document.createElement('button');
    if(u.id === currentUserId){
      toggleBtn.textContent = "O'zingiz";
      toggleBtn.className = 'toggle-btn';
      toggleBtn.disabled = true;
    }else{
      toggleBtn.textContent = u.is_active ? 'Bloklash' : 'Faollashtirish';
      toggleBtn.className = 'toggle-btn ' + (u.is_active ? 'make-inactive' : 'make-active');
      toggleBtn.addEventListener('click', ()=> toggleActive(u));
    }
    actionTd.appendChild(toggleBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Parol tiklash';
    resetBtn.className = 'toggle-btn';
    resetBtn.style.marginLeft = '6px';
    resetBtn.addEventListener('click', ()=> resetPassword(u));
    actionTd.appendChild(resetBtn);

    tbody.appendChild(tr);
  });
}

async function toggleActive(user){
  const newVal = !user.is_active;
  const {error} = await sb.from('profiles').update({is_active: newVal}).eq('id', user.id);
  if(error){ alert('Xatolik: '+error.message); return; }
  await loadUsers();
}

// ============================================================
// PAROLNI TIKLASH: eski parolni hech kim ko'rmaydi (u umuman
// saqlanmaydi) — bu faqat YANGI parol o'rnatadi.
// ============================================================
async function resetPassword(user){
  if(!ADMIN_ACTIONS_WORKER_URL){
    alert("Bu funksiya uchun admin-actions-worker.js hali sozlanmagan. config.js dagi ADMIN_ACTIONS_WORKER_URL'ni to'ldiring.");
    return;
  }
  const newPass = prompt(`${user.email} uchun yangi parol kiriting (kamida 6 belgi):`);
  if(!newPass) return;
  if(newPass.length < 6){ alert("Parol kamida 6 ta belgidan iborat bo'lishi kerak."); return; }
  const {data:{session}} = await sb.auth.getSession();
  try{
    const resp = await fetch(ADMIN_ACTIONS_WORKER_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token},
      body: JSON.stringify({action:'reset_password', target_user_id: user.id, new_password: newPass}),
    });
    if(!resp.ok){ const t = await resp.text(); throw new Error(t); }
    alert(`${user.email} uchun parol muvaffaqiyatli yangilandi.`);
  }catch(err){
    alert('Xatolik: '+err.message);
  }
}

init();
