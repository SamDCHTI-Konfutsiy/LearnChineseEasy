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
      <td>${esc(u.email)}${u.role==='admin' ? '<span class="badge role-admin">admin</span>' : ''}${u.can_edit_hsk ? '<span class="badge role-admin" style="background:var(--good-soft);color:var(--good);">HSK muharrir</span>' : ''}</td>
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

    const detailBtn = document.createElement('button');
    detailBtn.textContent = 'HSK sozlamalari';
    detailBtn.className = 'toggle-btn';
    detailBtn.style.marginLeft = '6px';
    actionTd.appendChild(detailBtn);

    tbody.appendChild(tr);

    // ---- Kengaytirilgan qator: HSK darajalari + muharrirlik huquqi ----
    const detailTr = document.createElement('tr');
    detailTr.className = 'detail-row hidden';
    const detailTd = document.createElement('td');
    detailTd.colSpan = 4;
    const allowed = new Set(u.allowed_hsk_levels || [1,2,3,4,5,6]);
    const chipsHtml = [1,2,3,4,5,6].map(lvl =>
      `<label class="level-chip ${allowed.has(lvl)?'checked':''}" data-lvl="${lvl}">
        <input type="checkbox" value="${lvl}" ${allowed.has(lvl)?'checked':''}> HSK ${lvl}
      </label>`
    ).join('');
    detailTd.innerHTML = `
      <div style="padding:10px 0;">
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 6px;">O'rganishga ruxsat berilgan HSK darajalari:</p>
        <div class="level-picker">${chipsHtml}</div>
        <div style="margin-top:10px;">
          <button class="toggle-btn save-levels-btn">Darajalarni saqlash</button>
          <label class="editor-toggle" style="font-size:12.5px;">
            <input type="checkbox" class="editor-checkbox" ${u.can_edit_hsk?'checked':''}>
            HSK so'zlar bazasiga yangi so'z qo'sha oladi
          </label>
        </div>
      </div>`;
    detailTr.appendChild(detailTd);
    tbody.appendChild(detailTr);

    detailBtn.addEventListener('click', ()=> detailTr.classList.toggle('hidden'));
    detailTd.querySelectorAll('.level-chip').forEach(chip=>{
      chip.querySelector('input').addEventListener('change', (e)=>{
        chip.classList.toggle('checked', e.target.checked);
      });
    });
    detailTd.querySelector('.save-levels-btn').addEventListener('click', async ()=>{
      const levels = Array.from(detailTd.querySelectorAll('.level-chip input:checked')).map(i=>Number(i.value));
      const {error} = await sb.from('profiles').update({allowed_hsk_levels: levels}).eq('id', u.id);
      if(error){ alert('Xatolik: '+error.message); return; }
      showMsg('Darajalar saqlandi');
    });
    detailTd.querySelector('.editor-checkbox').addEventListener('change', async (e)=>{
      const {error} = await sb.from('profiles').update({can_edit_hsk: e.target.checked}).eq('id', u.id);
      if(error){ alert('Xatolik: '+error.message); e.target.checked = !e.target.checked; return; }
      await loadUsers();
    });
  });
}
function showMsg(text){
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 16px;border-radius:16px;font-size:12.5px;z-index:80;';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2000);
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
