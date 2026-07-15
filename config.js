// ============================================================
// SOZLASH: Supabase loyihangizning URL va anon key'ini shu yerga
// qo'ying (Supabase paneli -> Project Settings -> API).
// Bular OCHIQ maydonlar, frontendga qo'yish uchun mo'ljallangan.
// service_role kalitini HECH QACHON bu yerga qo'ymang.
// ============================================================
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
