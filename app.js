// sb (Supabase client) config.js faylidan keladi — u shu fayldan oldin ulanadi.

const state = {
  user: null,
  profile: null,
  decks: [],
  books: [],
  currentBook: null,
  cardsByDeck: new Map(),
  reviews: new Map(),
  currentDeck: null,
  queue: [],
  qIndex: 0,
  revealed: false,
  studyMode: 'flashcard',
};
const STUDY_MODE_KEY = 'flashcards_study_mode';
try{
  const savedMode = localStorage.getItem(STUDY_MODE_KEY);
  if(savedMode) state.studyMode = savedMode;
}catch(e){}
document.getElementById('studyModeSelect').value = state.studyMode;
document.getElementById('studyModeSelect').addEventListener('change', (e)=>{
  state.studyMode = e.target.value;
  try{ localStorage.setItem(STUDY_MODE_KEY, state.studyMode); }catch(err){}
});

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

// Telegram xabarnomasi — faqat email/vaqt/holat, HECH QACHON parol yubormaydi.
function notifyTelegram(event, extra){
  if(!TELEGRAM_WORKER_URL) return;
  try{
    fetch(TELEGRAM_WORKER_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action:'notify', event, ...extra}),
    }).catch(()=>{});
  }catch(e){}
}

// Offline holat banneri
function updateOfflineBanner(){
  const b = document.getElementById('offlineBanner');
  if(b) b.classList.toggle('show', !navigator.onLine);
}
updateOfflineBanner();
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('online', ()=>{ updateOfflineBanner(); flushOfflineQueue(); });

// ============================================================
// KUNDUZGI / KECHKI REJIM (dark mode)
// ============================================================
const THEME_KEY = 'flashcards_theme';
function getTheme(){
  try{
    const saved = localStorage.getItem(THEME_KEY);
    if(saved==='dark' || saved==='light') return saved;
  }catch(e){}
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme==='dark';
  const topbarBtn = document.getElementById('themeToggleBtn');
  if(topbarBtn) topbarBtn.textContent = isDark ? '☀️' : '🌙';
  const profilBtn = document.getElementById('themeToggleBtnProfil');
  if(profilBtn) profilBtn.textContent = t(isDark ? 'profil.toggle_theme_light' : 'profil.toggle_theme');
}
function toggleTheme(){
  const next = getTheme()==='dark' ? 'light' : 'dark';
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  applyTheme(next);
}
applyTheme(getTheme());
document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
document.getElementById('themeToggleBtnProfil')?.addEventListener('click', toggleTheme);

// Til almashganda ekranda ko'rinib turgan ro'yxatlarni (ular JS orqali
// yaratilgani uchun data-i18n qamrab olmaydi) qayta chizamiz.
function onLanguageChanged(){
  applyTheme(getTheme()); // profildagi tugma matnini ham yangilaydi
  if(!state.user) return;
  renderDashboard();
  if(!document.getElementById('tab-decks').classList.contains('hidden')){
    if(!document.getElementById('bookDetailView').classList.contains('hidden')){
      renderTopicList();
    }else{
      renderCustomDecks('customDeckList2');
      renderBooksList();
    }
  }
}

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
      await enterAppFromSession(data.session, 'login');
    }else{
      const {data, error} = await sb.auth.signUp({email, password});
      if(error) throw error;
      if(data.session){
        await enterAppFromSession(data.session, 'register');
      }else{
        notifyTelegram('register', {email, user_id: data.user ? data.user.id : null, created_at: new Date().toISOString()});
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

async function enterAppFromSession(session, notifyEvent=null, retry=0){
  if(!session){ showAuthScreen(); return; }
  const {data: profile, error} = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if(error || !profile){
    // profil trigger orqali yaratiladi, biroz kechikishi mumkin
    if(retry < 5){ setTimeout(()=>enterAppFromSession(session, notifyEvent, retry+1), 500); return; }
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
  document.getElementById('hskManageLink').classList.toggle('hidden', !(profile.role === 'admin' || profile.can_edit_hsk));
  if(notifyEvent){
    notifyTelegram(notifyEvent, {
      email: session.user.email, user_id: session.user.id,
      role: profile.role, is_active: profile.is_active, created_at: profile.created_at,
    });
  }
  await loadCustomHskWords();
  await loadInitialData();
  renderDashboard();
  loadAnnouncement();
  if(navigator.onLine) flushOfflineQueue();
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
  if(tab==='decks'){ showDeckListView(); state.currentBook = null; renderHskGrid('hskGridDecks'); renderCustomDecks('customDeckList2'); renderBooksList(); }
  if(tab==='profil'){ populateVoiceSelect(); updatePushButtonState(); }
  if(tab==='hskmanage'){ renderCustomHskWordList(); }
  if(tab==='words'){ initWordsTab(); }
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadInitialData(){
  // Owner_id filtri qasddan qo'yilmagan — RLS o'zi kimga nima ko'rinishi
  // kerakligini hal qiladi: o'zining decks/books + adminning "ochiq"
  // qilib qo'ygan kitoblari va ularning mavzulari/kartalari.
  const [{data: decks}, {data: reviews}, {data: books}] = await Promise.all([
    sb.from('decks').select('*').order('created_at'),
    sb.from('reviews').select('*').eq('user_id', state.user.id),
    sb.from('books').select('*').order('created_at'),
  ]);
  state.decks = decks || [];
  state.books = books || [];
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
// HSK MAXSUS SO'ZLAR (muharrirlar qo'shgan, hammaga ko'rinadigan)
// ============================================================
state.customHskWords = [];
async function loadCustomHskWords(){
  const {data, error} = await sb.from('hsk_words_custom').select('*').order('created_at');
  if(error){ return; } // jadval hali yaratilmagan bo'lishi mumkin — jim o'tkazamiz
  state.customHskWords = data || [];
  const seen = new Set(HSK_DATA.map(w=>w[0]+'|'+w[1]));
  data.forEach(w=>{
    const k = w.hanzi+'|'+w.pinyin;
    if(!seen.has(k)){ HSK_DATA.push([w.hanzi, w.pinyin, w.meaning, w.level]); seen.add(k); }
  });
}
function renderCustomHskWordList(){
  const el = document.getElementById('customHskWordList');
  if(!state.customHskWords.length){ el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Hali qo'shilgan so'z yo'q.</p>`; return; }
  el.innerHTML = '';
  state.customHskWords.slice().reverse().forEach(w=>{
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<div><span class="cf">${escapeHtml(w.hanzi)}</span> (${escapeHtml(w.pinyin)}) — <span class="cb">${escapeHtml(w.meaning)} · HSK ${w.level}</span></div>
      <button class="x-btn" title="O'chirish">&times;</button>`;
    row.querySelector('.x-btn').addEventListener('click', async ()=>{
      if(!confirm("Bu so'z o'chirilsinmi?")) return;
      const {error} = await sb.from('hsk_words_custom').delete().eq('id', w.id);
      if(error){ showToast("Xatolik: "+error.message); return; }
      state.customHskWords = state.customHskWords.filter(x=>x.id!==w.id);
      renderCustomHskWordList();
      showToast("O'chirildi (sahifani yangilasangiz to'liq qo'llanadi)");
    });
    el.appendChild(row);
  });
}
document.getElementById('addHskWordForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const hanzi = document.getElementById('hskWordHanzi').value.trim();
  const pinyin = document.getElementById('hskWordPinyin').value.trim();
  const meaning = document.getElementById('hskWordMeaning').value.trim();
  const level = Number(document.getElementById('hskWordLevel').value);
  if(!hanzi || !pinyin || !meaning) return;
  const {data, error} = await sb.from('hsk_words_custom').insert({
    hanzi, pinyin, meaning, level, created_by: state.user.id
  }).select().single();
  if(error){ showToast("Xatolik: "+error.message); return; }
  state.customHskWords.push(data);
  HSK_DATA.push([data.hanzi, data.pinyin, data.meaning, data.level]);
  e.target.reset();
  renderCustomHskWordList();
  showToast("So'z qo'shildi");
});

// ============================================================
// DASHBOARD
// ============================================================
function isLevelAllowed(lvl){
  if(!state.profile) return true;
  if(state.profile.role === 'admin') return true;
  const allowed = state.profile.allowed_hsk_levels || [1,2,3,4,5,6];
  return allowed.includes(lvl);
}
function hskLearnedCount(level){
  const words = HSK_DATA.filter(w=>w[3]===level);
  let n = 0;
  for(const w of words){
    const r = state.reviews.get(hskKey(level, w[0], w[1]));
    if(r && Number(r.reps) > 0) n++;
  }
  return n;
}
function computeStats(){
  let totalLearned = 0, dueToday = 0;
  const today = todayStr();
  const daysSet = new Set();
  state.reviews.forEach(r=>{
    if(Number(r.reps) > 0) totalLearned++;
    if(r.due_date <= today) dueToday++;
    if(r.last_reviewed) daysSet.add(r.last_reviewed.slice(0,10));
  });
  let streak = 0;
  let cursor = new Date();
  if(!daysSet.has(today)) cursor = addDays(cursor, -1);
  while(daysSet.has(cursor.toISOString().slice(0,10))){
    streak++;
    cursor = addDays(cursor, -1);
  }
  return { totalLearned, dueToday, streak };
}
function renderStats(){
  const el = document.getElementById('statsRow');
  if(!el) return;
  const s = computeStats();
  el.innerHTML = `
    <div class="stat-box" style="--stat-accent:var(--accent);"><div class="ico">📖</div><div class="num">${s.totalLearned}</div><div class="lbl">${t('dash.stat_learned')}</div></div>
    <div class="stat-box" style="--stat-accent:var(--warn);"><div class="ico">⏰</div><div class="num">${s.dueToday}</div><div class="lbl">${t('dash.stat_due_today')}</div></div>
    <div class="stat-box" style="--stat-accent:var(--good);"><div class="ico">🔥</div><div class="num">${s.streak}</div><div class="lbl">${t('dash.stat_streak')}</div></div>`;
}
function renderHskGrid(containerId){
  const grid = document.getElementById(containerId);
  if(!grid) return;
  grid.innerHTML = '';
  for(let lvl=1; lvl<=6; lvl++){
    const total = HSK_DATA.filter(w=>w[3]===lvl).length;
    const due = hskDueCount(lvl);
    const learned = hskLearnedCount(lvl);
    const pct = total ? Math.round((learned/total)*100) : 0;
    const allowed = isLevelAllowed(lvl);
    const div = document.createElement('div');
    div.className = 'deck-card' + (allowed ? '' : ' locked');
    div.innerHTML = `${allowed ? (due>0?`<span class="due-dot">${due}</span>`:'') : `<span class="lock-tag">🔒</span>`}
      <div class="dk-name">HSK ${lvl}</div>
      <div class="dk-sub">${LEVEL_NAMES[lvl]} · ${total} so'z${allowed ? '' : ' · yopiq'}</div>
      ${allowed ? `<div class="dk-bar"><i style="width:${pct}%;"></i></div>` : ''}`;
    div.addEventListener('click', ()=>{
      if(!allowed){ showToast("Bu daraja administrator tomonidan yopilgan"); return; }
      startHskStudy(lvl);
    });
    grid.appendChild(div);
  }
}
function renderDashboard(){
  renderStats();
  renderHskGrid('hskGrid');
  renderCustomDecks('customDeckList');
}
function renderCustomDecks(containerId){
  const el = document.getElementById(containerId);
  const standalone = state.decks.filter(d=>!d.book_id);
  if(!standalone.length){
    el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">${t('dyn.no_decks_yet')}</p>`;
    return;
  }
  el.innerHTML = '';
  standalone.forEach(deck=>{
    const cardCount = (state.cardsByDeck.get(deck.id)||[]).length;
    const due = deckDueCount(deck.id);
    const row = document.createElement('div');
    row.className = 'custom-deck-row';
    row.style.cursor = 'pointer';
    if(deck.is_locked){
      row.innerHTML = `<div>
          <div class="name">${escapeHtml(deck.name)}</div>
          <div class="meta">${t('dyn.locked_by_admin')}</div>
        </div>
        <span style="font-size:16px;">🔒</span>`;
      row.addEventListener('click', ()=> showToast(t('dyn.locked_toast')));
    }else{
      row.innerHTML = `<div>
          <div class="name">${escapeHtml(deck.name)}</div>
          <div class="meta">${cardCount} ${t('dyn.cards_word')}${due>0?` · ${due} ${t('dyn.due_suffix')}`:''}</div>
        </div>
        <span style="color:var(--ink-faint);font-size:16px;">→</span>`;
      row.addEventListener('click', ()=>{ switchTab('decks'); state.currentBook = null; openDeckDetail(deck); });
    }
    el.appendChild(row);
  });
}
document.getElementById('newDeckBtnDash').addEventListener('click', createDeckPrompt);
document.getElementById('newDeckBtn').addEventListener('click', createDeckPrompt);
async function createDeckPrompt(){
  const name = prompt(t('dyn.deck_name_prompt'));
  if(!name || !name.trim()) return;
  const {data, error} = await sb.from('decks').insert({owner_id: state.user.id, name: name.trim()}).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.decks.push(data);
  state.cardsByDeck.set(data.id, []);
  showToast(t('dyn.deck_created'));
  renderDashboard();
  renderCustomDecks('customDeckList2');
}

// ============================================================
// DECK DETAIL
// ============================================================
function showDeckListView(){
  document.getElementById('deckListView').classList.remove('hidden');
  document.getElementById('bookDetailView').classList.add('hidden');
  document.getElementById('deckDetailView').classList.add('hidden');
}
function openDeckDetail(deck){
  if(deck.is_locked){ showToast(t('dyn.locked_toast')); return; }
  state.currentDeck = deck;
  cancelEditCard();
  document.getElementById('deckListView').classList.add('hidden');
  document.getElementById('bookDetailView').classList.add('hidden');
  document.getElementById('deckDetailView').classList.remove('hidden');
  document.getElementById('deckDetailName').textContent = deck.name;
  document.getElementById('deckNotesInput').value = deck.notes || '';

  const isOwner = deck.owner_id === state.user.id;
  ['renameDeckBtn','deleteDeckBtn','deckNotesCard','addCardCard','deckCsvActions'].forEach(id=>{
    document.getElementById(id).classList.toggle('hidden', !isOwner);
  });
  const roNote = document.getElementById('deckReadonlyNote');
  roNote.classList.toggle('hidden', isOwner);
  if(!isOwner) roNote.textContent = t('dyn.shared_readonly_deck');

  renderCardListInDeck();
}
document.getElementById('backToDeckList').addEventListener('click', ()=>{
  // Agar bu mavzu bitta kitobga tegishli bo'lsa — kitob ichiga qaytamiz,
  // aks holda to'g'ridan-to'g'ri to'plamlar ro'yxatiga.
  if(state.currentDeck && state.currentDeck.book_id && state.currentBook){
    openBookDetail(state.currentBook);
  }else{
    showDeckListView();
  }
});
document.getElementById('renameDeckBtn').addEventListener('click', async ()=>{
  const name = prompt(t('dyn.rename_prompt'), state.currentDeck.name);
  if(!name || !name.trim() || name.trim()===state.currentDeck.name) return;
  const {data, error} = await sb.from('decks').update({name: name.trim()}).eq('id', state.currentDeck.id).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.currentDeck.name = data.name;
  const idx = state.decks.findIndex(d=>d.id===data.id);
  if(idx>=0) state.decks[idx] = data;
  document.getElementById('deckDetailName').textContent = data.name;
  renderCustomDecks('customDeckList2');
  renderDashboard();
  showToast(t('dyn.name_updated'));
});
document.getElementById('saveDeckNotesBtn').addEventListener('click', async ()=>{
  const notes = document.getElementById('deckNotesInput').value;
  const {data, error} = await sb.from('decks').update({notes}).eq('id', state.currentDeck.id).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.currentDeck.notes = data.notes;
  const idx = state.decks.findIndex(d=>d.id===data.id);
  if(idx>=0) state.decks[idx] = data;
  showToast(t('dyn.notes_saved'));
});

// ============================================================
// KITOBLAR VA MAVZULAR
// Kitob — konteyner (masalan "HSK 1 kitobim"); mavzu — o'sha kitob
// ichidagi bitta bo'lim, texnik jihatdan oddiy deck (book_id bilan).
// ============================================================
function renderBooksList(){
  const myBooks = state.books.filter(b=>b.owner_id===state.user.id);
  const sharedBooks = state.books.filter(b=>b.owner_id!==state.user.id && b.is_shared);

  const el = document.getElementById('bookList');
  if(!myBooks.length){
    el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">${t('dyn.no_books_yet')}</p>`;
  }else{
    el.innerHTML = '';
    myBooks.forEach(book=>{
      const topicCount = state.decks.filter(d=>d.book_id===book.id).length;
      const row = document.createElement('div');
      row.className = 'custom-deck-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `<div>
          <div class="name">📚 ${escapeHtml(book.name)}${book.is_shared ? ` <span class="shared-badge">🌐 ${t('decks.shared_badge')}</span>` : ''}</div>
          <div class="meta">${topicCount} ${t('dyn.topics_word')}${book.notes ? ' · '+t('dyn.has_note') : ''}</div>
        </div>
        <span style="color:var(--ink-faint);font-size:16px;">→</span>`;
      row.addEventListener('click', ()=> openBookDetail(book));
      el.appendChild(row);
    });
  }

  const sharedEl = document.getElementById('sharedBookList');
  if(!sharedBooks.length){
    sharedEl.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">${t('dyn.no_shared_books')}</p>`;
  }else{
    sharedEl.innerHTML = '';
    sharedBooks.forEach(book=>{
      const topicCount = state.decks.filter(d=>d.book_id===book.id).length;
      const row = document.createElement('div');
      row.className = 'custom-deck-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `<div>
          <div class="name">📚 ${escapeHtml(book.name)}</div>
          <div class="meta">${topicCount} ${t('dyn.topics_word')}</div>
        </div>
        <span style="color:var(--ink-faint);font-size:16px;">→</span>`;
      row.addEventListener('click', ()=> openBookDetail(book));
      sharedEl.appendChild(row);
    });
  }
}
document.getElementById('newBookBtn').addEventListener('click', async ()=>{
  const name = prompt(t('dyn.book_name_prompt'));
  if(!name || !name.trim()) return;
  const {data, error} = await sb.from('books').insert({owner_id: state.user.id, name: name.trim()}).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.books.push(data);
  showToast(t('dyn.book_created'));
  renderBooksList();
});

function openBookDetail(book){
  state.currentBook = book;
  document.getElementById('deckListView').classList.add('hidden');
  document.getElementById('deckDetailView').classList.add('hidden');
  document.getElementById('bookDetailView').classList.remove('hidden');

  const isOwner = book.owner_id === state.user.id;
  const isAdmin = state.profile && state.profile.role === 'admin';
  document.getElementById('bookDetailName').innerHTML = '📚 ' + escapeHtml(book.name) +
    (book.is_shared ? ` <span class="shared-badge">🌐 ${t('decks.shared_badge')}</span>` : '');
  document.getElementById('bookNotesInput').value = book.notes || '';

  document.getElementById('bookOwnerActions').classList.toggle('hidden', !isOwner);
  document.getElementById('bookNotesCard').classList.toggle('hidden', !isOwner);
  document.getElementById('bookTopicActions').classList.toggle('hidden', !isOwner);

  const shareBtn = document.getElementById('shareBookBtn');
  if(isOwner && isAdmin){
    shareBtn.classList.remove('hidden');
    shareBtn.textContent = book.is_shared ? t('decks.unshare_book') : t('decks.share_book');
  }else{
    shareBtn.classList.add('hidden');
  }

  renderTopicList();
}
document.getElementById('shareBookBtn').addEventListener('click', async ()=>{
  const newVal = !state.currentBook.is_shared;
  const {data, error} = await sb.from('books').update({is_shared: newVal}).eq('id', state.currentBook.id).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.currentBook.is_shared = data.is_shared;
  const idx = state.books.findIndex(b=>b.id===data.id);
  if(idx>=0) state.books[idx] = data;
  showToast(newVal ? t('dyn.book_shared') : t('dyn.book_unshared'));
  openBookDetail(state.currentBook);
  renderBooksList();
});
document.getElementById('backToDeckListFromBook').addEventListener('click', ()=>{
  state.currentBook = null;
  showDeckListView();
});
document.getElementById('renameBookBtn').addEventListener('click', async ()=>{
  const name = prompt(t('dyn.rename_prompt'), state.currentBook.name);
  if(!name || !name.trim() || name.trim()===state.currentBook.name) return;
  const {data, error} = await sb.from('books').update({name: name.trim()}).eq('id', state.currentBook.id).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.currentBook.name = data.name;
  const idx = state.books.findIndex(b=>b.id===data.id);
  if(idx>=0) state.books[idx] = data;
  document.getElementById('bookDetailName').textContent = '📚 ' + data.name;
  showToast(t('dyn.name_updated'));
});
document.getElementById('deleteBookBtn').addEventListener('click', async ()=>{
  const topicCount = state.decks.filter(d=>d.book_id===state.currentBook.id).length;
  const msg = topicCount
    ? `"${state.currentBook.name}" (${topicCount} ${t('dyn.topics_word')}) — ?`
    : `"${state.currentBook.name}" — ?`;
  if(!confirm(msg)) return;
  const {error} = await sb.from('books').delete().eq('id', state.currentBook.id);
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.books = state.books.filter(b=>b.id!==state.currentBook.id);
  state.decks = state.decks.filter(d=>d.book_id!==state.currentBook.id);
  state.currentBook = null;
  showToast(t('dyn.book_deleted'));
  showDeckListView();
  renderBooksList();
  renderCustomDecks('customDeckList2');
  renderDashboard();
});
document.getElementById('saveBookNotesBtn').addEventListener('click', async ()=>{
  const notes = document.getElementById('bookNotesInput').value;
  const {data, error} = await sb.from('books').update({notes}).eq('id', state.currentBook.id).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.currentBook.notes = data.notes;
  const idx = state.books.findIndex(b=>b.id===data.id);
  if(idx>=0) state.books[idx] = data;
  showToast(t('dyn.notes_saved'));
});

function renderTopicList(){
  const topics = state.decks.filter(d=>d.book_id===state.currentBook.id)
    .sort((a,b)=> (a.topic_order||0)-(b.topic_order||0) || new Date(a.created_at)-new Date(b.created_at));
  const el = document.getElementById('topicList');
  if(!topics.length){
    el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">${t('dyn.no_topics_yet')}</p>`;
    return;
  }
  el.innerHTML = '';
  topics.forEach((deck, i)=>{
    const cardCount = (state.cardsByDeck.get(deck.id)||[]).length;
    const due = deckDueCount(deck.id);
    const row = document.createElement('div');
    row.className = 'custom-deck-row';
    row.style.cursor = 'pointer';
    row.innerHTML = `<div>
        <div class="name">${i+1}. ${escapeHtml(deck.name)}</div>
        <div class="meta">${cardCount} ${t('dyn.cards_word')}${due>0?` · ${due} ${t('dyn.due_suffix')}`:''}${deck.notes ? ' · '+t('dyn.has_note') : ''}</div>
      </div>
      <span style="color:var(--ink-faint);font-size:16px;">→</span>`;
    row.addEventListener('click', ()=> openDeckDetail(deck));
    el.appendChild(row);
  });
}
document.getElementById('newTopicBtn').addEventListener('click', async ()=>{
  const name = prompt(t('dyn.topic_name_prompt'));
  if(!name || !name.trim()) return;
  const existingCount = state.decks.filter(d=>d.book_id===state.currentBook.id).length;
  const {data, error} = await sb.from('decks').insert({
    owner_id: state.user.id, name: name.trim(),
    book_id: state.currentBook.id, topic_order: existingCount,
  }).select().single();
  if(error){ showToast(t('dyn.error_prefix')+error.message); return; }
  state.decks.push(data);
  state.cardsByDeck.set(data.id, []);
  showToast(t('dyn.topic_created'));
  renderTopicList();
});

// ============================================================
// AI NATIJASIDAN OMMAVIY IMPORT
// Kutilgan format:
//   ===MAVZU: 1-dars: Salomlashish===
//   front,back,hanzi,pinyin
//   Salom,Salom,你好,nǐ hǎo
//   ===MAVZU: 2-dars: Oila===
//   ...
// Bitta joylashda ko'plab mavzu va ularning kartalarini bir yo'la
// yaratadi — 15-40 mavzuli kitoblar uchun mo'ljallangan.
// ============================================================
document.getElementById('openBulkImportBtn').addEventListener('click', ()=>{
  document.getElementById('bulkImportText').value = '';
  const statusEl = document.getElementById('bulkImportStatus');
  statusEl.textContent = '';
  document.getElementById('bulkImportModal').classList.add('open');
});
document.getElementById('bulkImportClose').addEventListener('click', ()=>{
  document.getElementById('bulkImportModal').classList.remove('open');
});

function parseBulkImportText(text){
  const topicRegex = /===\s*MAVZU\s*:\s*(.+?)\s*===/gi;
  const markers = [];
  let m;
  while((m = topicRegex.exec(text)) !== null){
    markers.push({ name: m[1].trim(), markerStart: m.index, contentStart: topicRegex.lastIndex });
  }
  const topics = [];
  for(let i=0; i<markers.length; i++){
    const contentEnd = (i+1 < markers.length) ? markers[i+1].markerStart : text.length;
    const block = text.slice(markers[i].contentStart, contentEnd).trim();
    const lines = block.split(/\r?\n/).filter(l=>l.trim());
    let start = 0;
    if(lines.length){
      const firstCols = parseCsvLine(lines[0]).map(s=>s.toLowerCase());
      if(firstCols[0]==='front' || firstCols[0]==="old tomon") start = 1;
    }
    const cards = [];
    for(let j=start;j<lines.length;j++){
      const cols = parseCsvLine(lines[j]);
      if(cols.length>=1 && cols[0]){
        cards.push({ front: cols[0], back: cols[1]||'', hanzi: cols[2]||null, pinyin: cols[3]||null });
      }
    }
    if(markers[i].name) topics.push({ name: markers[i].name, cards });
  }
  return topics;
}

document.getElementById('bulkImportSubmitBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('bulkImportText').value;
  const statusEl = document.getElementById('bulkImportStatus');
  const btn = document.getElementById('bulkImportSubmitBtn');
  const topics = parseBulkImportText(text);
  if(!topics.length){
    statusEl.style.color = 'var(--bad)';
    statusEl.textContent = t('bulk.no_topics_found');
    return;
  }
  btn.disabled = true;
  statusEl.style.color = 'var(--ink-soft)';
  statusEl.textContent = t('bulk.importing');

  let existingCount = state.decks.filter(d=>d.book_id===state.currentBook.id).length;
  let totalTopics = 0, totalCards = 0;
  const errors = [];

  for(const topic of topics){
    const {data: deckData, error: deckError} = await sb.from('decks').insert({
      owner_id: state.user.id, name: topic.name,
      book_id: state.currentBook.id, topic_order: existingCount,
    }).select().single();
    if(deckError){ errors.push(topic.name+': '+deckError.message); continue; }
    existingCount++;
    state.decks.push(deckData);
    state.cardsByDeck.set(deckData.id, []);
    totalTopics++;

    for(let i=0;i<topic.cards.length;i+=300){
      const chunk = topic.cards.slice(i,i+300).map(c=>({...c, deck_id: deckData.id}));
      if(!chunk.length) continue;
      const {data: cardsData, error: cardsError} = await sb.from('cards').insert(chunk).select();
      if(cardsError){ errors.push(topic.name+' ('+t('decks.cards')+'): '+cardsError.message); continue; }
      const arr = state.cardsByDeck.get(deckData.id) || [];
      state.cardsByDeck.set(deckData.id, arr.concat(cardsData));
      totalCards += cardsData.length;
    }
  }

  btn.disabled = false;
  renderTopicList();
  renderDashboard();
  const summary = `${totalTopics} ${t('dyn.topics_word')}, ${totalCards} ${t('dyn.cards_word')}`;
  if(errors.length){
    statusEl.style.color = 'var(--bad)';
    statusEl.textContent = `${summary} — ${t('dyn.error_prefix')}${errors[0]}`;
  }else{
    statusEl.style.color = 'var(--good)';
    statusEl.textContent = `${t('bulk.success_prefix')} ${summary}`;
    setTimeout(()=>{ document.getElementById('bulkImportModal').classList.remove('open'); }, 1400);
  }
});

function renderCardListInDeck(){
  const cards = state.cardsByDeck.get(state.currentDeck.id) || [];
  const el = document.getElementById('cardListInDeck');
  if(!cards.length){ el.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Hali karta yo'q.</p>`; return; }
  el.innerHTML = '';
  cards.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'card-row';
    row.innerHTML = `<div><span class="cf">${escapeHtml(c.front)}</span> — <span class="cb">${escapeHtml(c.back)}</span></div>
      <div class="row-actions">
        <button class="edit-btn" title="Tahrirlash">✎</button>
        <button class="x-btn" title="O'chirish">&times;</button>
      </div>`;
    row.querySelector('.edit-btn').addEventListener('click', ()=> startEditCard(c));
    row.querySelector('.x-btn').addEventListener('click', async ()=>{
      if(!confirm("Bu karta o'chirilsinmi?")) return;
      const {error} = await sb.from('cards').delete().eq('id', c.id);
      if(error){ showToast("Xatolik: "+error.message); return; }
      state.cardsByDeck.set(state.currentDeck.id, cards.filter(x=>x.id!==c.id));
      renderCardListInDeck();
    });
    el.appendChild(row);
  });
}

let editingCardId = null;
function startEditCard(c){
  editingCardId = c.id;
  document.getElementById('cardFront').value = c.front || '';
  document.getElementById('cardBack').value = c.back || '';
  document.getElementById('cardHanzi').value = c.hanzi || '';
  document.getElementById('cardPinyin').value = c.pinyin || '';
  document.getElementById('cardImage').value = c.image_url || '';
  document.getElementById('cardFormLabel').textContent = 'Kartani tahrirlash';
  document.getElementById('cardFormSubmitBtn').textContent = 'Yangilash';
  document.getElementById('cancelEditCardBtn').classList.remove('hidden');
  document.getElementById('cardFront').scrollIntoView({behavior:'smooth', block:'center'});
}
function cancelEditCard(){
  editingCardId = null;
  document.getElementById('addCardForm').reset();
  document.getElementById('cardFormLabel').textContent = "Karta qo'shish";
  document.getElementById('cardFormSubmitBtn').textContent = "Qo'shish";
  document.getElementById('cancelEditCardBtn').classList.add('hidden');
}
document.getElementById('cancelEditCardBtn').addEventListener('click', cancelEditCard);
document.getElementById('addCardForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const front = document.getElementById('cardFront').value.trim();
  const back = document.getElementById('cardBack').value.trim();
  const hanzi = document.getElementById('cardHanzi').value.trim();
  const pinyin = document.getElementById('cardPinyin').value.trim();
  const image_url = document.getElementById('cardImage').value.trim();
  if(!front || !back) return;
  const arr = state.cardsByDeck.get(state.currentDeck.id) || [];
  if(editingCardId){
    const {data, error} = await sb.from('cards').update({
      front, back, hanzi: hanzi||null, pinyin: pinyin||null, image_url: image_url||null
    }).eq('id', editingCardId).select().single();
    if(error){ showToast("Xatolik: "+error.message); return; }
    const idx = arr.findIndex(c=>c.id===editingCardId);
    if(idx>=0) arr[idx] = data;
    state.cardsByDeck.set(state.currentDeck.id, arr);
    cancelEditCard();
    renderCardListInDeck();
    showToast("Karta yangilandi");
  }else{
    const {data, error} = await sb.from('cards').insert({
      deck_id: state.currentDeck.id, front, back, hanzi: hanzi||null, pinyin: pinyin||null, image_url: image_url||null
    }).select().single();
    if(error){ showToast("Xatolik: "+error.message); return; }
    arr.push(data);
    state.cardsByDeck.set(state.currentDeck.id, arr);
    e.target.reset();
    renderCardListInDeck();
    showToast("Karta qo'shildi");
  }
});
document.getElementById('deleteDeckBtn').addEventListener('click', async ()=>{
  const wasInBook = state.currentDeck.book_id ? state.currentBook : null;
  const confirmMsg = wasInBook ? "Mavzu va undagi barcha kartalar o'chiriladi. Davom etasizmi?" : "To'plam va undagi barcha kartalar o'chiriladi. Davom etasizmi?";
  if(!confirm(confirmMsg)) return;
  const {error} = await sb.from('decks').delete().eq('id', state.currentDeck.id);
  if(error){ showToast("Xatolik: "+error.message); return; }
  state.decks = state.decks.filter(d=>d.id!==state.currentDeck.id);
  state.cardsByDeck.delete(state.currentDeck.id);
  if(wasInBook){ openBookDetail(wasInBook); }
  else{ showDeckListView(); }
  renderCustomDecks('customDeckList2');
  renderDashboard();
});
document.getElementById('studyThisDeckBtn').addEventListener('click', ()=> startDeckStudy(state.currentDeck.id));

// ============================================================
// PROFIL: parol o'zgartirish
// ============================================================
document.getElementById('changePasswordForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const p1 = document.getElementById('newPassword').value;
  const p2 = document.getElementById('newPassword2').value;
  const errEl = document.getElementById('pwErr');
  errEl.style.color = 'var(--bad)';
  if(p1 !== p2){ errEl.textContent = "Parollar mos kelmadi."; return; }
  if(p1.length < 6){ errEl.textContent = "Parol kamida 6 ta belgidan iborat bo'lishi kerak."; return; }
  const {error} = await sb.auth.updateUser({password: p1});
  if(error){ errEl.textContent = error.message; return; }
  errEl.style.color = 'var(--good)';
  errEl.textContent = "Parol muvaffaqiyatli yangilandi.";
  e.target.reset();
  showToast("Parol yangilandi");
});

// ============================================================
// CSV IMPORT / EXPORT (to'plam kartalari)
// ============================================================
function toCsvField(s){
  s = (s==null ? '' : String(s));
  if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function parseCsvLine(line){
  const out=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){ if(inQ && line[i+1]==='"'){ cur+='"'; i++; } else inQ=!inQ; }
    else if(c===',' && !inQ){ out.push(cur); cur=''; }
    else cur+=c;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
document.getElementById('exportDeckCsvBtn').addEventListener('click', ()=>{
  const cards = state.cardsByDeck.get(state.currentDeck.id) || [];
  const lines = ['front,back,hanzi,pinyin'];
  cards.forEach(c=> lines.push([c.front,c.back,c.hanzi,c.pinyin].map(toCsvField).join(',')));
  const blob = new Blob(['\uFEFF'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (state.currentDeck.name || 'toplam') + '.csv'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('importDeckCsv').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    const text = ev.target.result;
    const lines = text.split(/\r?\n/).filter(l=>l.trim());
    if(!lines.length){ showToast("CSV bo'sh."); return; }
    let start = 0;
    const firstCols = parseCsvLine(lines[0]).map(s=>s.toLowerCase());
    if(firstCols[0]==='front' || firstCols[0]==="old tomon") start = 1;
    const rows = [];
    for(let i=start;i<lines.length;i++){
      const cols = parseCsvLine(lines[i]);
      if(cols.length>=1 && cols[0]){
        rows.push({deck_id: state.currentDeck.id, front: cols[0], back: cols[1]||'', hanzi: cols[2]||null, pinyin: cols[3]||null});
      }
    }
    if(!rows.length){ showToast("CSV faylda karta topilmadi."); return; }
    const {data, error} = await sb.from('cards').insert(rows).select();
    if(error){ showToast("Xatolik: "+error.message); return; }
    const arr = state.cardsByDeck.get(state.currentDeck.id) || [];
    state.cardsByDeck.set(state.currentDeck.id, arr.concat(data));
    renderCardListInDeck();
    showToast(`${data.length} ta karta import qilindi`);
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

// ============================================================
// JSON TO'LIQ ZAXIRA (decks + cards + reviews)
// ============================================================
document.getElementById('exportBackupBtn').addEventListener('click', ()=>{
  const allCards = [];
  state.cardsByDeck.forEach(arr => allCards.push(...arr));
  const backup = {
    exported_at: new Date().toISOString(),
    decks: state.decks,
    cards: allCards,
    reviews: Array.from(state.reviews.values()),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'flashcards_backup.json'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('importBackupJson').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    let backup;
    try{ backup = JSON.parse(ev.target.result); }catch(err){ showToast("Fayl noto'g'ri formatda."); return; }
    const nDecks = (backup.decks||[]).length, nCards=(backup.cards||[]).length, nRev=(backup.reviews||[]).length;
    if(!confirm(`${nDecks} ta to'plam, ${nCards} ta karta, ${nRev} ta natija tiklanadi. Davom etasizmi?`)) return;
    try{
      if(nDecks){
        const rows = backup.decks.map(d=>({id:d.id, owner_id: state.user.id, name:d.name, created_at:d.created_at}));
        const {error} = await sb.from('decks').upsert(rows);
        if(error) throw error;
      }
      if(nCards){
        const rows = backup.cards.map(c=>({id:c.id, deck_id:c.deck_id, front:c.front, back:c.back, hanzi:c.hanzi, pinyin:c.pinyin, created_at:c.created_at}));
        const {error} = await sb.from('cards').upsert(rows);
        if(error) throw error;
      }
      if(nRev){
        const rows = backup.reviews.map(r=>({...r, user_id: state.user.id}));
        const {error} = await sb.from('reviews').upsert(rows, {onConflict:'user_id,card_key'});
        if(error) throw error;
      }
      showToast("Zaxira tiklandi");
      await loadInitialData();
      renderDashboard();
      renderCustomDecks('customDeckList2');
    }catch(err){
      showToast("Xatolik: "+err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

// ============================================================
// TEXT-TO-SPEECH (brauzerning o'z ovozi — offline ham ishlaydi,
// agar qurilmada xitoycha ovoz o'rnatilgan bo'lsa)
// ============================================================
let cachedVoices = [];
function loadVoices(){ if('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices(); }
if('speechSynthesis' in window){
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
function getChineseVoices(){
  return cachedVoices.filter(v => /zh|cmn/i.test(v.lang) || /chinese|mandarin/i.test(v.name));
}
const TTS_VOICE_KEY = 'flashcards_tts_voice_uri';
function pickVoice(){
  const zh = getChineseVoices();
  if(!zh.length) return null;
  let preferred = null;
  try{ preferred = localStorage.getItem(TTS_VOICE_KEY); }catch(e){}
  if(preferred){
    const chosen = zh.find(v=>v.voiceURI===preferred);
    if(chosen) return chosen;
  }
  const local = zh.filter(v=>v.localService);
  const pool = local.length ? local : zh;
  const exact = pool.filter(v=>/zh-CN|cmn-Hans|cmn-CN/i.test(v.lang));
  return exact[0] || pool[0];
}
function populateVoiceSelect(){
  const sel = document.getElementById('voiceSelect');
  if(!sel) return;
  loadVoices();
  const zh = getChineseVoices();
  let saved = null;
  try{ saved = localStorage.getItem(TTS_VOICE_KEY); }catch(e){}
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = ''; auto.textContent = 'Avtomatik (eng yaxshisini tanlaydi)';
  sel.appendChild(auto);
  if(!zh.length){
    const opt = document.createElement('option');
    opt.value=''; opt.disabled=true; opt.textContent = "Qurilmangizda xitoycha ovoz topilmadi";
    sel.appendChild(opt);
    return;
  }
  zh.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang}) — ${v.localService ? 'Mahalliy/offline' : 'Internet talab qiladi'}`;
    sel.appendChild(opt);
  });
  sel.value = saved || '';
}
if('speechSynthesis' in window){
  window.speechSynthesis.onvoiceschanged = ()=>{ loadVoices(); populateVoiceSelect(); };
}
document.getElementById('voiceSelect').addEventListener('change', (e)=>{
  try{ localStorage.setItem(TTS_VOICE_KEY, e.target.value); }catch(err){}
});
document.getElementById('testVoiceBtn').addEventListener('click', ()=> speakHanzi('你好', null));
function speakHanzi(hanzi, hintEl){
  if(!('speechSynthesis' in window)){
    if(hintEl) hintEl.textContent = "Bu brauzer ovozli o'qishni qo'llab-quvvatlamaydi.";
    return;
  }
  loadVoices();
  const voice = pickVoice();
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(hanzi);
    u.lang = 'zh-CN'; u.rate = 0.78; u.pitch = 1;
    if(voice){
      u.voice = voice;
      if(hintEl) hintEl.textContent = voice.localService ? '' : "Bu ovoz internet talab qilishi mumkin.";
    }else if(hintEl){
      hintEl.textContent = "Qurilmangizda xitoycha ovoz topilmadi. Sozlamalar → Til va kiritish → Nutqni sintez qilishdan xitoy (Mandarin) ovozini qo'shing.";
    }
    window.speechSynthesis.speak(u);
  }catch(e){
    if(hintEl) hintEl.textContent = "Ovozni ijro etishda xatolik yuz berdi.";
  }
}

// ============================================================
// IEROGLIF KATAKLARI (bir nechta belgili so'zlar uchun har biriga alohida katak)
// ============================================================
function tzgRowHtml(hanzi){
  const chars = Array.from(hanzi);
  const n = chars.length;
  const box = n<=2 ? 100 : (n===3 ? 76 : 60);
  const font = Math.round(box*0.6);
  const cells = chars.map(ch=>
    `<div class="tzg" data-char="${escapeHtml(ch)}" style="width:${box}px;height:${box}px;" title="Yozilish tartibini ko'rish"><span style="font-size:${font}px;">${escapeHtml(ch)}</span></div>`
  ).join('');
  return `<div class="tzg-row">${cells}</div>`;
}

// ============================================================
// IEROGLIF YOZILISH OYNASI (hanzipi.com'ni ilova ichida ochadi)
// ============================================================
function openHanziModal(ch){
  const url = 'https://www.hanzipi.com/' + encodeURIComponent(ch) + '.html';
  document.getElementById('hzModalChar').textContent = ch;
  document.getElementById('hzModalOpenNew').href = url;
  document.getElementById('hzModalOpenNew2').href = url;
  document.getElementById('hzModalFallback').style.display = 'none';
  const frame = document.getElementById('hzModalFrame');
  frame.src = url;
  document.getElementById('hanziModal').classList.add('open');
  clearTimeout(window._hzModalTimer);
  window._hzModalTimer = setTimeout(()=>{
    try{
      if(frame.src !== 'about:blank' && !frame.contentWindow){
        document.getElementById('hzModalFallback').style.display = 'flex';
      }
    }catch(e){}
  }, 4000);
}
function closeHanziModal(){
  document.getElementById('hanziModal').classList.remove('open');
  document.getElementById('hzModalFrame').src = 'about:blank';
  clearTimeout(window._hzModalTimer);
}
document.getElementById('hzModalClose').addEventListener('click', closeHanziModal);
document.getElementById('hanziModal').addEventListener('click', (e)=>{
  if(e.target.id==='hanziModal') closeHanziModal();
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape' && document.getElementById('hanziModal').classList.contains('open')) closeHanziModal();
});

// ============================================================
// SO'ZLAR RO'YXATI (barcha ruxsat etilgan HSK so'zlarini ko'rish)
// ============================================================
let wordsShownCount = 0;
const WORDS_PAGE_SIZE = 100;
function allowedLevelsList(){
  const list = [];
  for(let l=1;l<=6;l++) if(isLevelAllowed(l)) list.push(l);
  return list;
}
function initWordsTab(){
  const sel = document.getElementById('wordsLevelSelect');
  const allowed = allowedLevelsList();
  sel.innerHTML = allowed.map(l=>`<option value="${l}">HSK ${l}</option>`).join('');
  if(!allowed.length){
    document.getElementById('wordsListWrap').innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Sizga hech qanday HSK darajasi ochilmagan.</p>`;
    document.getElementById('loadMoreWordsBtn').classList.add('hidden');
    return;
  }
  wordsShownCount = WORDS_PAGE_SIZE;
  renderWordList();
}
document.getElementById('wordsLevelSelect').addEventListener('change', ()=>{ wordsShownCount = WORDS_PAGE_SIZE; renderWordList(); });
document.getElementById('wordsSearchInput').addEventListener('input', ()=>{ wordsShownCount = WORDS_PAGE_SIZE; renderWordList(); });
document.getElementById('loadMoreWordsBtn').addEventListener('click', ()=>{ wordsShownCount += WORDS_PAGE_SIZE; renderWordList(); });
function renderWordList(){
  const level = Number(document.getElementById('wordsLevelSelect').value);
  const q = document.getElementById('wordsSearchInput').value.trim().toLowerCase();
  let words = HSK_DATA.filter(w=>w[3]===level);
  if(q){
    words = words.filter(w => w[0].includes(q) || w[1].toLowerCase().includes(q) || w[2].toLowerCase().includes(q));
  }
  const wrap = document.getElementById('wordsListWrap');
  if(!words.length){ wrap.innerHTML = `<p style="color:var(--ink-faint);font-size:13px;">Hech narsa topilmadi.</p>`; document.getElementById('loadMoreWordsBtn').classList.add('hidden'); return; }
  const shown = words.slice(0, wordsShownCount);
  wrap.innerHTML = shown.map(w=>{
    const r = state.reviews.get(hskKey(level, w[0], w[1]));
    const learned = r && Number(r.reps) > 0;
    return `<div class="word-row">
      <div><span class="wh">${escapeHtml(w[0])}</span><span class="wp">${escapeHtml(w[1])}</span></div>
      <div class="wm">${escapeHtml(w[2])} ${learned?'<span class="learned-tag">✓ o\'rganilgan</span>':''}</div>
    </div>`;
  }).join('');
  document.getElementById('loadMoreWordsBtn').classList.toggle('hidden', wordsShownCount >= words.length);
}

// ============================================================
// OFFLINE NAVBAT: internet yo'q paytda baholarni saqlab, qaytganda yuboradi
// ============================================================
const OFFLINE_QUEUE_KEY = 'flashcards_offline_queue_v1';
function queueOfflineReview(row){
  try{
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const q = raw ? JSON.parse(raw) : [];
    const idx = q.findIndex(r=>r.card_key===row.card_key);
    if(idx>=0) q[idx]=row; else q.push(row);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
  }catch(e){}
}
async function flushOfflineQueue(){
  let q;
  try{ const raw = localStorage.getItem(OFFLINE_QUEUE_KEY); q = raw ? JSON.parse(raw) : []; }catch(e){ q = []; }
  if(!q.length || !state.user) return;
  const {error} = await sb.from('reviews').upsert(q, {onConflict:'user_id,card_key'});
  if(!error){
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    showToast(`${q.length} ta offline natija serverga saqlandi`);
  }
}

// ============================================================
// STUDY (spaced repetition)
// ============================================================
function startHskStudy(level){
  if(!isLevelAllowed(level)){ showToast("Bu daraja administrator tomonidan yopilgan"); return; }
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
  const deckObj = state.decks.find(d=>d.id===deckId);
  if(deckObj && deckObj.is_locked){ showToast("Bu to'plam administrator tomonidan yopilgan"); return; }
  const cards = state.cardsByDeck.get(deckId) || [];
  const due = [];
  cards.forEach(c=>{
    const r = state.reviews.get(c.id);
    if(!r || r.due_date <= todayStr()){
      due.push({key:c.id, type:'custom', front:c.front, back:c.back, hanzi:c.hanzi, pinyin:c.pinyin, image_url:c.image_url, label: state.currentDeck ? state.currentDeck.name : ''});
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

function normalizePinyin(s){
  return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'').trim();
}
function getDistractors(item, count){
  let pool;
  if(item.type === 'hsk'){
    pool = HSK_DATA.filter(w=>w[2]!==item.meaning).map(w=>w[2]);
  }else{
    const deckCards = (state.currentDeck ? state.cardsByDeck.get(state.currentDeck.id) : null) || [];
    pool = deckCards.filter(c=>c.back!==item.back).map(c=>c.back);
    if(pool.length < count) pool = pool.concat(HSK_DATA.map(w=>w[2]));
  }
  shuffle(pool);
  return [...new Set(pool)].slice(0, count);
}

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
  const mode = state.studyMode || 'flashcard';
  const hanzi = item.hanzi;
  const correctAnswer = item.type==='hsk' ? item.meaning : item.back;
  const correctPinyin = item.pinyin || '';
  const imgHtml = item.image_url ? `<img class="card-img" src="${escapeHtml(item.image_url)}" alt="">` : '';

  if(mode === 'quiz') renderQuizCard(stage, item, hanzi, correctAnswer, imgHtml);
  else if(mode === 'listen') renderListenCard(stage, item, hanzi, correctPinyin, correctAnswer, imgHtml);
  else if(mode === 'type') renderTypeCard(stage, item, hanzi, correctPinyin, correctAnswer, imgHtml);
  else renderFlashcardCard(stage, item, hanzi, correctPinyin, correctAnswer, imgHtml);
}

function wireCommon(stage, hanzi){
  const speakBtn = document.getElementById('speakBtn');
  if(speakBtn) speakBtn.addEventListener('click', ()=> speakHanzi(hanzi, document.getElementById('ttsHint')));
  stage.querySelectorAll('.tzg-row .tzg').forEach(cell=>{
    cell.addEventListener('click', ()=> openHanziModal(cell.dataset.char));
  });
  document.querySelectorAll('.grade-btn').forEach(b=>{
    b.addEventListener('click', ()=> grade(b.dataset.q));
  });
}

function renderFlashcardCard(stage, item, hanzi, pinyin, answer, imgHtml){
  let html = imgHtml;
  if(hanzi){ html += tzgRowHtml(hanzi); html += `<button class="speak-btn" id="speakBtn" title="Talaffuzni eshitish">🔊</button><div class="tts-hint" id="ttsHint"></div>`; }
  if(!hanzi) html += `<div class="front-text">${escapeHtml(item.front)}</div>`;
  if(!state.revealed){
    html += `<div class="btn-row" style="margin-top:14px;"><button class="btn" id="revealBtn">Ko'rsatish</button></div>`;
  }else{
    if(pinyin) html += `<div class="pinyin-text">${escapeHtml(pinyin)}</div>`;
    html += `<div class="back-text">${escapeHtml(answer)}</div>`;
    html += gradeRowHtml();
  }
  stage.innerHTML = html;
  const revealBtn = document.getElementById('revealBtn');
  if(revealBtn) revealBtn.addEventListener('click', ()=>{ state.revealed = true; renderStudyCard(); });
  wireCommon(stage, hanzi);
}

function renderQuizCard(stage, item, hanzi, answer, imgHtml){
  let html = imgHtml;
  if(hanzi){ html += tzgRowHtml(hanzi); html += `<button class="speak-btn" id="speakBtn" title="Talaffuzni eshitish">🔊</button><div class="tts-hint" id="ttsHint"></div>`; }
  else html += `<div class="front-text">${escapeHtml(item.front)}</div>`;
  if(!state.revealed){
    const options = shuffle([answer, ...getDistractors(item, 3)]);
    html += `<div class="quiz-options">${options.map(o=>`<button class="quiz-opt" data-val="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}</div>`;
  }else{
    html += `<div class="back-text">${escapeHtml(answer)}</div>` + gradeRowHtml();
  }
  stage.innerHTML = html;
  wireCommon(stage, hanzi);
  stage.querySelectorAll('.quiz-opt').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const correct = btn.dataset.val === answer;
      stage.querySelectorAll('.quiz-opt').forEach(b=>{
        b.disabled = true;
        if(b.dataset.val === answer) b.classList.add('correct');
        else if(b===btn && !correct) b.classList.add('wrong');
      });
      state.revealed = true;
      state.lastQuizCorrect = correct;
      setTimeout(()=>{ renderStudyCard(); }, 700);
    });
  });
}

function renderListenCard(stage, item, hanzi, pinyin, answer, imgHtml){
  let html = imgHtml;
  if(!state.revealed){
    html += `<div class="btn-row" style="margin-top:6px;"><button class="speak-btn" id="playBtn" title="Eshitish" style="width:64px;height:64px;font-size:28px;">🔊</button></div>
      <div class="tts-hint" id="ttsHint" style="margin-top:10px;"></div>
      <div class="btn-row" style="margin-top:16px;"><button class="btn" id="revealBtn">Ko'rsatish</button></div>`;
  }else{
    if(hanzi) html += tzgRowHtml(hanzi);
    if(pinyin) html += `<div class="pinyin-text">${escapeHtml(pinyin)}</div>`;
    html += `<div class="back-text">${escapeHtml(answer)}</div>` + gradeRowHtml();
  }
  stage.innerHTML = html;
  wireCommon(stage, hanzi);
  const playBtn = document.getElementById('playBtn');
  if(playBtn) playBtn.addEventListener('click', ()=> speakHanzi(hanzi || answer, document.getElementById('ttsHint')));
  const revealBtn = document.getElementById('revealBtn');
  if(revealBtn) revealBtn.addEventListener('click', ()=>{ state.revealed = true; renderStudyCard(); });
  if(!state.revealed) setTimeout(()=> speakHanzi(hanzi || answer, document.getElementById('ttsHint')), 300);
}

function renderTypeCard(stage, item, hanzi, pinyin, answer, imgHtml){
  let html = imgHtml;
  if(hanzi){ html += tzgRowHtml(hanzi); html += `<button class="speak-btn" id="speakBtn" title="Talaffuzni eshitish">🔊</button><div class="tts-hint" id="ttsHint"></div>`; }
  else html += `<div class="front-text">${escapeHtml(item.front)}</div>`;
  if(!state.revealed){
    html += `<div class="type-answer-row"><input id="typeAnswerInput" placeholder="Pinyin'ni tering..." autocomplete="off"><button class="btn" id="checkTypeBtn">Tekshirish</button></div>`;
  }else{
    const ok = state.lastTypeCorrect;
    html += `<div class="answer-feedback ${ok?'ok':'no'}">${ok ? "✓ To'g'ri!" : "✗ Noto'g'ri"}</div>`;
    html += `<div class="pinyin-text">${escapeHtml(pinyin)}</div><div class="back-text">${escapeHtml(answer)}</div>`;
    html += gradeRowHtml();
  }
  stage.innerHTML = html;
  wireCommon(stage, hanzi);
  const checkBtn = document.getElementById('checkTypeBtn');
  const input = document.getElementById('typeAnswerInput');
  function submit(){
    const val = input.value;
    state.lastTypeCorrect = pinyin ? (normalizePinyin(val) === normalizePinyin(pinyin)) : false;
    state.revealed = true;
    renderStudyCard();
  }
  if(checkBtn) checkBtn.addEventListener('click', submit);
  if(input){ input.focus(); input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } }); }
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
  state.reviews.set(item.key, row); // optimistik: darhol lokal holatni yangilaymiz (offline'da ham ishlaydi)
  if(navigator.onLine){
    const {data, error} = await sb.from('reviews').upsert(row, {onConflict:'user_id,card_key'}).select().single();
    if(error){ queueOfflineReview(row); }
    else{ state.reviews.set(item.key, data); }
  }else{
    queueOfflineReview(row);
  }
  state.qIndex++;
  state.revealed = false;
  renderStudyCard();
}

// ============================================================
// E'LON BANNERI: admin qo'ygan so'nggi faol e'lonni ko'rsatadi.
// Har bir e'lon bir marta ko'rsatiladi (yopilgandan keyin localStorage'da
// eslab qolinadi, qayta chiqmaydi).
// ============================================================
async function loadAnnouncement(){
  try{
    const {data, error} = await sb.from('announcements')
      .select('id,message').eq('active', true)
      .order('created_at', {ascending:false}).limit(1).maybeSingle();
    if(error || !data) return;
    const seenId = localStorage.getItem('flashcards_last_seen_announcement');
    if(seenId === data.id) return;
    const bar = document.getElementById('announcementBanner');
    if(!bar) return;
    document.getElementById('announcementText').textContent = data.message;
    bar.classList.add('show');
    bar.dataset.announcementId = data.id;
  }catch(e){ /* jim tur — e'lon ko'rinmasa ham ilova ishlayveradi */ }
}
document.getElementById('announcementCloseBtn')?.addEventListener('click', ()=>{
  const bar = document.getElementById('announcementBanner');
  if(bar.dataset.announcementId) localStorage.setItem('flashcards_last_seen_announcement', bar.dataset.announcementId);
  bar.classList.remove('show');
});

// ============================================================
// PUSH-BILDIRISHNOMA OBUNASI
// ============================================================
function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getPushSubscriptionState(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'subscribed' : 'unsubscribed';
}

async function updatePushButtonState(){
  const btn = document.getElementById('togglePushBtn');
  if(!btn) return;
  const state = await getPushSubscriptionState();
  if(state === 'unsupported'){
    btn.textContent = "Bu qurilmada push qo'llab-quvvatlanmaydi";
    btn.disabled = true;
  }else if(state === 'subscribed'){
    btn.textContent = "Bildirishnomalar yoqilgan ✓ (o'chirish)";
  }else{
    btn.textContent = 'Bildirishnomalarni yoqish';
  }
}

async function subscribeToPush(){
  const btn = document.getElementById('togglePushBtn');
  try{
    if(!('serviceWorker' in navigator) || !('PushManager' in window)){
      showToast("Bu qurilmada push qo'llab-quvvatlanmaydi.");
      return;
    }

    // MUHIM: ruxsat oynasi faqat tugma bosilgan zahoti, ORADA hech
    // qanday boshqa await bo'lmasa chiqadi (brauzerning "user gesture"
    // qoidasi). Shu sabab bu — funksiyadagi ENG BIRINCHI async ish.
    if(Notification.permission === 'denied'){
      showToast("Bildirishnomalar brauzer tomonidan bloklangan. Manzil satridagi qulf belgisi orqali qo'lda yoqing.");
      return;
    }
    if(Notification.permission === 'default'){
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){
        showToast("Ruxsat berilmadi.");
        return;
      }
    }

    // Bu yerga yetganda ruxsat allaqachon 'granted' — endi obuna holatini tekshiramiz
    const reg = await navigator.serviceWorker.ready;
    const existingSub = await reg.pushManager.getSubscription();

    if(existingSub){
      // Ruxsat bor va allaqachon obuna — demak bu bosilish "o'chirish" degani
      await sb.from('push_subscriptions').delete().eq('endpoint', existingSub.endpoint);
      await existingSub.unsubscribe();
      showToast('Bildirishnomalar o\'chirildi.');
      await updatePushButtonState();
      return;
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const subJson = sub.toJSON();
    const {error} = await sb.from('push_subscriptions').upsert({
      user_id: state_getUserId(),
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
    }, {onConflict:'endpoint'});
    if(error){ showToast('Xatolik: '+error.message); return; }
    showToast('Bildirishnomalar yoqildi!');
    await updatePushButtonState();
  }catch(e){
    showToast('Xatolik: '+e.message);
  }finally{
    // tugma matni updatePushButtonState orqali yangilanadi
  }
}
function state_getUserId(){ return state.user ? state.user.id : null; }

document.getElementById('togglePushBtn')?.addEventListener('click', subscribeToPush);
