// Service Worker — Home Interview (interview-survey)
// ⚠️ origin เดียวกับระบบเดิม (itsminimize.github.io) → Cache Storage ใช้ร่วมกันทั้ง origin
// CACHE_PREFIX แยกของเราออกจากระบบเดิม และ activate ลบเฉพาะ cache ที่ขึ้นต้นด้วย prefix นี้
// ห้ามลบ cache ที่ไม่มี prefix — นั่นคือของระบบเดิมที่ยังใช้งานจริงอยู่
const CACHE_PREFIX  = 'is-hi-';
const CACHE_VERSION = CACHE_PREFIX + 'v6-station-popup';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/project-service.js',
  './js/data.js',
  './js/auth-role.js',
  './js/zone-service.js',
  './js/app.js',
  './js/firebase.js',
  './js/place-service.js',
  './js/map-leaflet.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});

// ตอบเวอร์ชัน cache ให้หน้าเว็บ (ใช้แสดงป้ายเวอร์ชันมุมจอ — เช็ค cache freshness)
self.addEventListener('message', (e) => {
  if (e.data === 'getVersion' && e.source) e.source.postMessage({ type: 'version', version: CACHE_VERSION });
});
