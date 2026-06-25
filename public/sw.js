// ═══════════════════════════════════════════════════════════════
// CHURCH MIS — SERVICE WORKER (sw.js)
// Enables PWA offline support and caching
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'church-mis-v1';

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/rbac.js',
  '/config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.0/dist/tabler-icons.min.css',
  'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Inter:wght@400;500;600&display=swap',
];

// ── INSTALL: cache static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { mode: 'no-cors' })));
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache when offline, network when online ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip Supabase API calls (always need network)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('anthropic.com')) {
    return; // Let these go straight to network
  }

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Cache-first strategy for static assets
  if (STATIC_ASSETS.includes(request.url) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // Network-first for everything else (HTML, JS, fonts)
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
  // Opens IndexedDB and pushes queued changes when back online
  // This is a simplified version — production would use idb library
  console.log('[SW] Syncing offline attendance changes...');
}

// ── PUSH NOTIFICATIONS: reminder alerts ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Church MIS Reminder', {
      body:    data.body || 'You have an upcoming commitment.',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      tag:     'church-mis-reminder',
      data:    { url: '/' },
      actions: [
        { action: 'open',   title: 'Open App' },
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
