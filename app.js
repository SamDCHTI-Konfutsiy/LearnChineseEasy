// sb (Supabase client) config.js faylidan keladi — u shu fayldan oldin ulanadi.

const state = {
  user: null,
  profile: null,
  decks: [],
  cardsByDeck: new Map(),
  reviews: new Map(),
  currentDeck: null,
  queue: [],
  qIndex: 0,
  revealed: false,
};

// ---------- helpers ----------
function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function hskKey(level, hanzi, pinyin){ return `hsk:L${level}:${hanzi}|${pinyin}`; }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)'; }, 2400);
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ============================================================
// AUTH
// ============================================================
let authMode = 'login';
document.querySelectorAll('.auth-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    authMode = tab.dataset.mode;
    document.querySelectorAll('.auth-tab').forEach(t=>t.classList.toggle('active', t===tab));
    document.getElementById('authSubmitBtn').textContent = authMode==='login' ? 'Kirish' : "Ro'yxatdan o'tish";
    document.getElementById('authErr').textContent = '';
  });
});

document.getElementById('authForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authErr');
  errEl.textContent = '';
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  try{
    if(authMode==='login'){
      const {data, error} = await sb.auth.signInWithPassword({email, password});
      if(error) throw error;
      await enterAppFromSession(data.session);
    }else{
      const {data, error} = await sb.auth.signUp({email, password});
      if(error) throw error;
      if(data.session){
        await enterAppFromSession(data.session);
      }else{
        errEl.style.color = 'var(--good)';
        errEl.textContent = "Ro'yxatdan o'tdingiz. Emailingizga yuborilgan havolani tasdiqlang, so'ng kiring.";
      }
    }
  }catch(err){
    errEl.style.color = 'var(--bad)';
    errEl.textContent = translateAuthError(err.message);
  }finally{
    btn.disabled = false;
  }
});

function translateAuthError(msg){
  if(/already registered|already exists/i.test(msg)) return "Bu email allaqachon ro'yxatdan o'tgan.";
  if(/invalid login credentials/i.test(msg)) return "Email yoki parol noto'g'ri.";
  if(/password.*at least/i.test(msg)) return "Parol kamida 6 ta belgidan iborat bo'lishi kerak.";
  return msg;
}

async function enterAppFromSession(session, retry=0){
  if(!session){ showAuthScreen(); return; }
  const {data: profile, error} = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if(error || !profile){
    // profil trigger orqali yaratiladi, biroz kechikishi mumkin
    if(retry < 5){ setTimeout(()=>enterAppFromSession(session, retry+1), 500); return; }
    showToast("Profilni yuklashda xatolik. Sahifani yangilang.");
    return;
  }
  if(!profile.is_active){
    showBlockedScreen();
    await sb.auth.signOut();
    return;
  }
  state.user = session.user;
  state.profile = profile;
  showAppScreen();
  document.getElementById('adminLink').classList.toggle('hidden', profile.role !== 'admin');
  await loadInitialData();
  renderDashboard();
}

document.getElementById('logoutBtn').addEventListener('click', async ()=>{ await sb.auth.signOut(); location.reload(); });
document.getElementById('blockedLogoutBtn').addEventListener('click', async ()=>{ await sb.auth.signOut(); location.reload(); });

function showAuthScreen(){
  document.getElementById('screen-auth').classList.remove('hidden');
  document.getElementById('screen-blocked').classList.add('hidden');
  document.getElementById('screen-app').classList.add('hidden');
}
function showBlockedScreen(){
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-blocked').classList.remove('hidden');
  document.getElementById('screen-app').classList.add('hidden');
}
function showAppScreen(){
  document.getElementById('screen-auth').classList.add('hidden');
  document.getElementById('screen-blocked').classList.add('hidden');
  document.getElementById('screen-app').classList.remove('hidden');
}

sb.auth.onAuthStateChange((event, session)=>{
  if(event === 'SIGNED_OUT'){ showAuthScreen(); }
});
(async function initSession(){
  const {data:{session}} = await sb.auth.getSession();
  if(session) await enterAppFromSession(session);
  else showAuthScreen();
})();

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.navbtn[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=> switchTab(btn.dataset.tab));
});
function switchTab(tab){
  document.querySelectorAll('.navbtn[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tabpanel').forEach(p=>p.classList.add('hidden'));
  document.getElementById('tab-'+tab).classList.remove('hidden');
  if(tab==='decks'){ showDeckListView(); renderCustomDecks('customDeckList2'); }
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadInitialData(){
  const [{data: decks}, {data: reviews}] = await Promise.all([
    sb.from('decks').select('*').eq('owner_id', state.user.id).order('created_at'),
    sb.from('reviews').select('*').eq('user_id', state.user.id),
  ]);
  state.decks = decks || [];
  state.reviews = new Map((reviews||[]).map(r=>[r.card_key, r]));
  if(state.decks.length){
    const ids = state.decks.map(d=>d.id);
    const {data: cards} = await sb.from('cards').select('*').in('deck_id', ids).order('created_at');
    state.cardsByDeck = new Map();
    (cards||[]).forEach(c=>{
      if(!state.cardsByDeck.has(c.deck_id)) state.cardsByDeck.set(c.deck_id, []);
      state.cardsByDeck.get(c.deck_id).push(c);
    });
  }else{
    state.cardsByDeck = new Map();
  }
}

function hskDueCount(level){
  const words = HSK_DATA.filter(w=>w[3]===level);
  let n = 0;
  for(const w of words){
    const r = state.reviews.get(hskKey(level, w[0], w[1]));
    if(!r || r.due_date <= todayStr()) n++;
  }
  return n;
}
function deckDueCount(deckId){
  const cards = state.cardsByDeck.get(deckId) || [];
  let n = 0;
  for(const c of cards){
    const r = state.reviews.get(c.id);
    if(!r || r.due_date <= todayStr()) n++;
  }
  return n;
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard(){
  const grid = document.getElementById('hskGrid');
  grid.innerHTML = '';
  for(let lvl=1; lvl<=6; lvl++){
    const total = HSK_DATA.filter(w=>w[3]===lvl).length;
    const due = hskDueCount(lvl);
    const div = document.createElement('div');
    div.className = 'deck-card';
    div.innerHTML = `${due>0?`<span class="due-dot">${due}</span>`:''}
      <div class="dk-name">HSK ${lvl}</div>
      <div class="dk-sub">${LEVEL_NAMES[lvl]} · ${total} so'z</div>`;
    div.addEventListener('click', ()=> startHskStudy(lvl));
    grid.appendChild(div);
  }
  renderCustomDecks('customDeckList');
}
function renderCustomDecks(containerId){
  const el = document.getElementById(containerId);
  if(!state.decks.length){
    el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Hali to'plam yo'q. Pastdagi tugma orqali birinchi to'plamingizni yarating.</p>`;
    return;
  }
  el.innerHTML = '';
  state.decks.forEach(deck=>{
    const cardCount = (state.cardsByDeck.get(deck.id)||[]).length;
    const due = deckDueCount(deck.id);
    const row = document.createElement('div');
    row.className = 'custom-deck-row';
    row.innerHTML = `<div>
        <div class="name">${escapeHtml(deck.name)}</div>
        <div class="meta">${cardCount} karta${due>0?` · ${due} ta o'rganish kutmoqda`:''}</div>
      </div>`;
    row.querySelector('.name').addEventListener('click', ()=>{ switchTab('decks'); openDeckDetail(deck); });
    el.appendChild(row);
  });
}
document.getElementById('newDeckBtnDash').addEventListener('click', createDeckPrompt);
document.getElementById('newDeckBtn').addEventListener('click', createDeckPrompt);
async function createDeckPrompt(){
  const name = prompt("To'plam nomi:");
  if(!name || !name.trim()) return;
  const {data, error} = await sb.from('decks').insert({owner_id: state.user.id, name: name.trim()}).select().single();
  if(error){ showToast("Xatolik: "+error.message); return; }
  state.decks.push(data);
  state.cardsByDeck.set(data.id, []);
  showToast("To'plam yaratildi");
  renderDashboard();
  renderCustomDecks('customDeckList2');
}

// ============================================================
// DECK DETAIL
// ============================================================
function showDeckListView(){
  document.getElementById('deckListView').classList.remove('hidden');
  document.getElementById('deckDetailView').classList.add('hidden');
}
function openDeckDetail(deck){
  state.currentDeck = deck;
  document.getElementById('deckListView').classList.add('hidden');
  document.getElementById('deckDetailView').classList.remove('hidden');
  document.getElementById('deckDetailName').textContent = deck.name;
  renderCardListInDeck();
}
document.getElementById('backToDeckList').addEventListener('click', showDeckListView);

function renderCardListInDeck(){
  const cards = state.cardsByDeck.get(state.currentDeck.id) || [];
  const el = document.getElementById('cardListInDeck');
  if(!cards.length){ el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Hali karta yo'q.</p>`; return; }
  el.innerHTML = '';
  cards.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<div><span class="cf">${escapeHtml(c.front)}</span> — <span class="cb">${escapeHtml(c.back)}</span></div>
      <button class="x-btn" title="O'chirish">&times;</button>`;
    row.querySelector('.x-btn').addEventListener('click', async ()=>{
      const {error} = await sb.from('cards').delete().eq('id', c.id);
      if(error){ showToast("Xatolik: "+error.message); return; }
      state.cardsByDeck.set(state.currentDeck.id, cards.filter(x=>x.id!==c.id));
      renderCardListInDeck();
    });
    el.appendChild(row);
  });
}
document.getElementById('addCardForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const front = document.getElementById('cardFront').value.trim();
  const back = document.getElementById('cardBack').value.trim();
  const hanzi = document.getElementById('cardHanzi').value.trim();
  const pinyin = document.getElementById('cardPinyin').value.trim();
  if(!front || !back) return;
  const {data, error} = await sb.from('cards').insert({
    deck_id: state.currentDeck.id, front, back, hanzi: hanzi||null, pinyin: pinyin||null
  }).select().single();
  if(error){ showToast("Xatolik: "+error.message); return; }
  const arr = state.cardsByDeck.get(state.currentDeck.id) || [];
  arr.push(data);
  state.cardsByDeck.set(state.currentDeck.id, arr);
  e.target.reset();
  renderCardListInDeck();
  showToast("Karta qo'shildi");
});
document.getElementById('deleteDeckBtn').addEventListener('click', async ()=>{
  if(!confirm("To'plam va undagi barcha kartalar o'chiriladi. Davom etasizmi?")) return;
  const {error} = await sb.from('decks').delete().eq('id', state.currentDeck.id);
  if(error){ showToast("Xatolik: "+error.message); return; }
  state.decks = state.decks.filter(d=>d.id!==state.currentDeck.id);
  state.cardsByDeck.delete(state.currentDeck.id);
  showDeckListView();
  renderCustomDecks('customDeckList2');
  renderDashboard();
});
document.getElementById('studyThisDeckBtn').addEventListener('click', ()=> startDeckStudy(state.currentDeck.id));

// ============================================================
// STUDY (spaced repetition)
// ============================================================
function startHskStudy(level){
  const words = HSK_DATA.filter(w=>w[3]===level);
  const due = [];
  words.forEach(w=>{
    const key = hskKey(level, w[0], w[1]);
    const r = state.reviews.get(key);
    if(!r || r.due_date <= todayStr()){
      due.push({key, type:'hsk', hanzi:w[0], pinyin:w[1], meaning:w[2], label:`HSK ${level}`});
    }
  });
  beginSession(due);
}
function startDeckStudy(deckId){
  const cards = state.cardsByDeck.get(deckId) || [];
  const due = [];
  cards.forEach(c=>{
    const r = state.reviews.get(c.id);
    if(!r || r.due_date <= todayStr()){
      due.push({key:c.id, type:'custom', front:c.front, back:c.back, hanzi:c.hanzi, pinyin:c.pinyin, label: state.currentDeck ? state.currentDeck.name : ''});
    }
  });
  beginSession(due);
}
function beginSession(due){
  if(!due.length){ showToast("Bugun uchun o'rganadigan karta yo'q 🎉"); return; }
  state.queue = shuffle(due).slice(0, 30);
  state.qIndex = 0;
  state.revealed = false;
  switchTab('study');
  renderStudyCard();
}
document.getElementById('exitStudyBtn').addEventListener('click', ()=>{
  switchTab('dashboard'); renderDashboard();
});

function renderStudyCard(){
  const stage = document.getElementById('cardStage');
  const meta = document.getElementById('studyMeta');
  if(state.qIndex >= state.queue.length){
    meta.textContent = '';
    stage.innerHTML = `<div class="empty-state"><h3>Ajoyib! 🎉</h3><p>Ushbu sessiya uchun barcha kartalar tugadi.</p></div>`;
    return;
  }
  const item = state.queue[state.qIndex];
  meta.textContent = `${item.label||''} · ${state.qIndex+1}/${state.queue.length}`;
  let html = '';
  const hanzi = item.type==='hsk' ? item.hanzi : item.hanzi;
  if(hanzi){
    html += `<div class="tzg"><span>${escapeHtml(hanzi)}</span></div>`;
  }
  if(item.type==='hsk'){
    if(!state.revealed){
      html += `<div class="btn-row" style="margin-top:14px;"><button class="btn" id="revealBtn">Ko'rsatish</button></div>`;
    }else{
      html += `<div class="pinyin-text">${escapeHtml(item.pinyin)}</div><div class="back-text">${escapeHtml(item.meaning)}</div>`;
      html += gradeRowHtml();
    }
  }else{
    if(!hanzi) html += `<div class="front-text">${escapeHtml(item.front)}</div>`;
    if(!state.revealed){
      html += `<div class="btn-row" style="margin-top:14px;"><button class="btn" id="revealBtn">Ko'rsatish</button></div>`;
    }else{
      if(item.pinyin) html += `<div class="pinyin-text">${escapeHtml(item.pinyin)}</div>`;
      html += `<div class="back-text">${escapeHtml(item.back)}</div>`;
      html += gradeRowHtml();
    }
  }
  stage.innerHTML = html;
  const revealBtn = document.getElementById('revealBtn');
  if(revealBtn) revealBtn.addEventListener('click', ()=>{ state.revealed = true; renderStudyCard(); });
  document.querySelectorAll('.grade-btn').forEach(b=>{
    b.addEventListener('click', ()=> grade(b.dataset.q));
  });
}
function gradeRowHtml(){
  return `<div class="grade-row">
    <button class="grade-btn again" data-q="again">Bilmadim</button>
    <button class="grade-btn hard" data-q="hard">Qiyin</button>
    <button class="grade-btn good" data-q="good">Bo'ldi</button>
    <button class="grade-btn easy" data-q="easy">Oson</button>
  </div>`;
}

function computeNext(prev, quality){
  let ease = prev ? Number(prev.ease) : 2.5;
  let interval = prev ? Number(prev.interval_days) : 0;
  let reps = prev ? Number(prev.reps) : 0;
  if(quality==='again'){
    reps = 0; interval = 0; ease = Math.max(1.3, ease-0.2);
  }else{
    if(quality==='hard'){ ease = Math.max(1.3, ease-0.15); interval = reps===0 ? 1 : Math.max(1, Math.round(interval*1.2)); }
    else if(quality==='good'){ interval = reps===0 ? 1 : (reps===1 ? 3 : Math.round(interval*ease)); }
    else if(quality==='easy'){ ease = ease+0.15; interval = reps===0 ? 2 : Math.round(interval*ease*1.3)+1; }
    reps++;
  }
  const due = addDays(new Date(), quality==='again' ? 0 : interval);
  return { ease, interval_days: interval, reps, due_date: due.toISOString().slice(0,10), last_reviewed: new Date().toISOString() };
}

async function grade(quality){
  const item = state.queue[state.qIndex];
  const prev = state.reviews.get(item.key);
  const next = computeNext(prev, quality);
  const row = { user_id: state.user.id, card_key: item.key, ...next };
  const {data, error} = await sb.from('reviews').upsert(row, {onConflict:'user_id,card_key'}).select().single();
  if(error){ showToast("Xatolik: "+error.message); }
  else{ state.reviews.set(item.key, data); }
  state.qIndex++;
  state.revealed = false;
  renderStudyCard();
}
