// ═══════════════════════════════════════════════════════════════
// CHURCH MIS — SERVICE WORKER (sw.js)
// ═══════════════════════════════════════════════════════════════

// Bump this version whenever you deploy to bust the old cache
const CACHE_NAME = 'jil-mis-v2';

// Only cache local files — CDN resources are handled by the browser's
// own HTTP cache (CDNs set long-lived cache headers). Fetching CDN URLs
// from the service worker violates the connect-src CSP and breaks the app.
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/rbac.js',
  '/config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// External origins the SW should never intercept — let them go straight
// to the browser's network stack so CSP / CORS headers are applied correctly.
const PASSTHROUGH_ORIGINS = [
  'supabase.co',
  'anthropic.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── INSTALL: cache local static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: delete every old cache (including broken church-mis-v1) ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for local assets, passthrough for external ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Let external origins bypass the SW entirely
  if (PASSTHROUGH_ORIGINS.some(origin => url.hostname.includes(origin))) return;

  // Cache-first for local static assets
  if (STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // Network-first for anything else (future dynamic routes, etc.)
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── BACKGROUND SYNC: queue offline attendance changes ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncOfflineAttendance());
  }
});

async function syncOfflineAttendance() {
  console.log('[SW] Syncing offline attendance changes...');
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'JIL Church MIS', {
      body:    data.body || 'You have an upcoming commitment.',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     'jil-mis-reminder',
      data:    { url: '/' },
      actions: [
        { action: 'open',    title: 'Open App' },
        { action: 'dismiss', title: 'Dismiss'  },
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow('/');
      })
    );
  }
});
