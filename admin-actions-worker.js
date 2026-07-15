// ============================================================
// CLOUDFLARE WORKER: Admin — foydalanuvchi parolini tiklash
//
// ESLATMA: hech kim (admin ham) userning ESKI parolini ko'ra
// olmaydi — Supabase uni umuman saqlamaydi, faqat qaytarib
// bo'lmaydigan xesh saqlaydi. Bu Worker faqat YANGI parol
// O'RNATISHGA imkon beradi (eski parol chiqarilmaydi/ko'rsatilmaydi).
//
// O'RNATISH:
// 1. https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
// 2. Shu kodni joylashtiring (Deploy)
// 3. Worker -> Settings -> Variables and Secrets:
//      SUPABASE_URL              (masalan https://xxxx.supabase.co)
//      SUPABASE_ANON_KEY         (config.js'dagi bilan bir xil)
//      SUPABASE_SERVICE_ROLE_KEY (Supabase -> Settings -> API ->
//                                  "service_role" kaliti — SECRET
//                                  sifatida qo'shing, hech qachon
//                                  frontendga qo'ymang!)
//      ALLOWED_ORIGIN             (masalan https://foydalanuvchi.github.io)
// 4. Worker manzilini config.js'dagi ADMIN_ACTIONS_WORKER_URL'ga qo'ying.
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

    const authHeader = request.headers.get('Authorization') || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!accessToken) return new Response('Unauthorized', { status: 401, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) { return new Response('Bad request', { status: 400, headers: cors }); }
    const { target_user_id, new_password } = body || {};
    if (!target_user_id || !new_password || String(new_password).length < 6) {
      return new Response('Invalid payload', { status: 400, headers: cors });
    }

    // 1) So'rov yuborayotgan kim ekanini access_token orqali aniqlaymiz
    const whoResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!whoResp.ok) return new Response('Unauthorized', { status: 401, headers: cors });
    const who = await whoResp.json();
    const callerId = who.id;

    // 2) Shu user chindan ham admin ekanini tekshiramiz (RLS'ni
    //    chetlab o'tib, service_role bilan to'g'ridan-to'g'ri)
    const profResp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=role`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const profRows = await profResp.json();
    if (!profResp.ok || !Array.isArray(profRows) || !profRows.length || profRows[0].role !== 'admin') {
      return new Response('Forbidden: faqat adminlar uchun', { status: 403, headers: cors });
    }

    // 3) Maqsadli foydalanuvchiga YANGI parol o'rnatamiz (eskisi
    //    hech qachon o'qilmaydi/ko'rsatilmaydi — bu shunchaki reset)
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

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
