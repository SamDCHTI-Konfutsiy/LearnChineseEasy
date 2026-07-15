// ============================================================
// SERVICE WORKER: ilovani offline ishlatish uchun
// Faqat statik fayllarni keshlaydi (Supabase so'rovlari internet
// talab qiladi — foydalanuvchi ma'lumotlari xavfsizlik uchun
// hech qachon keshlanmaydi).
// ============================================================
const CACHE_NAME = 'flashcards-v1';
const APP_SHELL = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './hsk-data.js',
  './manifest.json',
  './launch-256.png',
  './launch-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase va boshqa tashqi API so'rovlariga tegmaymiz — ular
  // to'g'ridan-to'g'ri tarmoqqa boradi (offline bo'lsa, o'zi xato beradi
  // va app.js buni ushlab, navbatga qo'yadi).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok && event.request.method === 'GET') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});
