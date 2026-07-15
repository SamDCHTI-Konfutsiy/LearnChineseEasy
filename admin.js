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
      <td></td>`;
    const actionTd = tr.querySelector('td:last-child');
    const btn = document.createElement('button');
    if(u.id === currentUserId){
      btn.textContent = "O'zingiz";
      btn.className = 'toggle-btn';
      btn.disabled = true;
    }else{
      btn.textContent = u.is_active ? 'Bloklash' : 'Faollashtirish';
      btn.className = 'toggle-btn ' + (u.is_active ? 'make-inactive' : 'make-active');
      btn.addEventListener('click', ()=> toggleActive(u));
    }
    actionTd.appendChild(btn);
    tbody.appendChild(tr);
  });
}

async function toggleActive(user){
  const newVal = !user.is_active;
  const {error} = await sb.from('profiles').update({is_active: newVal}).eq('id', user.id);
  if(error){ alert('Xatolik: '+error.message); return; }
  await loadUsers();
}

init();
