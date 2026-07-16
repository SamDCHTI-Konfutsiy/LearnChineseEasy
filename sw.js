// ============================================================
// SERVICE WORKER: ilovani offline ishlatish uchun
// Faqat statik fayllarni keshlaydi (Supabase so'rovlari internet
// talab qiladi — foydalanuvchi ma'lumotlari xavfsizlik uchun
// hech qachon keshlanmaydi).
//
// STRATEGIYA: NETWORK-FIRST
// Avval tarmoqdan yangi faylni olishga harakat qilamiz, faqat
// internet yo'q bo'lsa keshdagi (oxirgi saqlangan) versiyani beramiz.
// Shunday qilib kod yangilanganda foydalanuvchi doim eng so'nggi
// versiyani ko'radi, "yarim eski / yarim yangi" holat bo'lmaydi.
// ============================================================
const CACHE_VERSION = 'v3'; // Har safar sw.js ni o'zgartirganda bu raqamni oshiring
const CACHE_NAME = `flashcards-${CACHE_VERSION}`;
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
    caches.keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase va boshqa tashqi API so'rovlariga tegmaymiz — ular
  // to'g'ridan-to'g'ri tarmoqqa boradi (offline bo'lsa, o'zi xato beradi
  // va app.js buni ushlab, navbatga qo'yadi).
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

// ============================================================
// PUSH-BILDIRISHNOMA: admin yuborgan xabarni tizim bildirishnoma
// panelida ko'rsatamiz (ilova yopiq bo'lsa ham ishlaydi).
// ============================================================
self.addEventListener('push', (event) => {
  let data = { title: 'Flashcards', body: 'Yangi xabar bor.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Flashcards', {
      body: data.body || '',
      icon: './launch-192.png',
      badge: './launch-192.png',
      tag: 'flashcards-announcement',
      renotify: true,
    })
  );
});

// Bildirishnomani bosganda ilovani ochish (agar ochiq bo'lsa, unga o'tish)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
