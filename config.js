// ============================================================
// SOZLASH: Supabase loyihangizning URL va anon key'ini shu yerga
// qo'ying (Supabase paneli -> Project Settings -> API).
// Bular OCHIQ maydonlar, frontendga qo'yish uchun mo'ljallangan.
// service_role kalitini HECH QACHON bu yerga qo'ymang.
// ============================================================
const SUPABASE_URL = 'https://edbgorsbsyxrbofbxuss.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkYmdvcnNic3l4cmJvZmJ4dXNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQzODgsImV4cCI6MjA5OTY5MDM4OH0.Q09GbMf5IwKGFaY9wFAeJW3KNMC7Mbbo0kAXxbT-als';

// Telegram xabarnomasi va admin parol-tiklash uchun bitta Cloudflare
// Worker manzili (relay-worker.js). Ikkalasi ham shu bitta Worker'ga boradi.
const TELEGRAM_WORKER_URL = 'https://rough-glade-7019.narzullayevumidjon976.workers.dev';
const ADMIN_ACTIONS_WORKER_URL = 'https://rough-glade-7019.narzullayevumidjon976.workers.dev';

// Push-bildirishnoma uchun VAPID ochiq kaliti (frontendga qo'yish
// uchun mo'ljallangan, maxfiy emas — maxfiy (PRIVATE) kalit faqat
// Cloudflare Worker'ning SECRET sozlamalarida turadi).
const VAPID_PUBLIC_KEY = 'BAhi0l60_FLd8DvvyBBwSnSgos9Ux-IiFYeXK0Yi80UWjuCo2-pSOfNrafkzQMQTQPcGRoK_ubLt2x2lRKIeykc';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
