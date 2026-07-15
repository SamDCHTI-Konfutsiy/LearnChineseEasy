// ============================================================
// BIRLASHTIRILGAN CLOUDFLARE WORKER
// Ikki vazifani bajaradi (frontend "action" maydoni bilan tanlaydi):
//   action: "notify"         -> Telegram'ga xabar yuboradi (parolsiz)
//   action: "reset_password" -> Admin userga yangi parol o'rnatadi
//
// SOZLASH (Worker -> Settings -> Variables and Secrets):
//   TELEGRAM_BOT_TOKEN         (@BotFather'dan olingan token, "Secret")
//   TELEGRAM_CHAT_ID           = 660086073
//   SUPABASE_URL               = https://edbgorsbsyxrbofbxuss.supabase.co
//   SUPABASE_ANON_KEY          (config.js dagi bilan bir xil, ochiq)
//   SUPABASE_SERVICE_ROLE_KEY  (Supabase -> Settings -> API,
//                                MAXFIY -> "Secret" turida qo'shing)
//   ALLOWED_ORIGIN             = https://samdchti-konfutsiy.github.io
// ============================================================

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) { return new Response('Bad request', { status: 400, headers: cors }); }

    if (body.action === 'reset_password') return handleResetPassword(request, body, env, cors);
    if (body.action === 'notify') return handleNotify(body, env, cors);
    return new Response('Unknown action', { status: 400, headers: cors });
  },
};

async function handleNotify(body, env, cors) {
  const { event, email, user_id, is_active, role, created_at } = body;
  if (!['register', 'login'].includes(event) || !email) {
    return new Response('Invalid payload', { status: 400, headers: cors });
  }
  const time = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  const title = event === 'register' ? "🆕 Yangi ro'yxatdan o'tish" : '🔑 Tizimga kirish';
  const text =
    `${title}\n\n` +
    `Email: ${email}\n` +
    `User ID: ${user_id || '-'}\n` +
    `Rol: ${role || 'user'}\n` +
    `Holat: ${is_active === false ? 'Bloklangan' : 'Faol'}\n` +
    `Ro'yxatdan o'tgan: ${created_at ? new Date(created_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' }) : '-'}\n` +
    `Vaqt: ${time}`;

  const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const tgResp = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    if (!tgResp.ok) return new Response('Telegram error', { status: 502, headers: cors });
  } catch (e) {
    return new Response('Telegram request failed', { status: 502, headers: cors });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function handleResetPassword(request, body, env, cors) {
  const authHeader = request.headers.get('Authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!accessToken) return new Response('Unauthorized', { status: 401, headers: cors });

  const { target_user_id, new_password } = body;
  if (!target_user_id || !new_password || String(new_password).length < 6) {
    return new Response('Invalid payload', { status: 400, headers: cors });
  }

  // 1) So'rov yuborgan kim ekanini aniqlaymiz
  const whoResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!whoResp.ok) return new Response('Unauthorized', { status: 401, headers: cors });
  const who = await whoResp.json();

  // 2) U chindan ham admin ekanini tekshiramiz
  const profResp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${who.id}&select=role`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const profRows = await profResp.json();
  if (!profResp.ok || !Array.isArray(profRows) || !profRows.length || profRows[0].role !== 'admin') {
    return new Response('Forbidden', { status: 403, headers: cors });
  }

  // 3) Yangi parolni o'rnatamiz (eski parol hech qachon o'qilmaydi)
  const updateResp = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: new_password }),
  });
  if (!updateResp.ok) {
    const t = await updateResp.text();
    return new Response('Xatolik: ' + t, { status: 502, headers: cors });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
