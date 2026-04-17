// ═══════════════════════════════════════════════════════
// Strážce Pokladu - Service Worker
// Network-first pro HTML (vždy čerstvé), cache-first pro assets
// ═══════════════════════════════════════════════════════

const VERSION = 'v2.7.1'; // ← KROK 6B úprava: deposit_3 target 1 (místo 3)
const CACHE = `strazce-${VERSION}`;
const ASSETS = ['./', './index.html', './manifest.json'];

// ═══ INSTALL ═══
self.addEventListener('install', e => {
  console.log(`[SW] Install ${VERSION}`);
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting(); // Okamžitě aktivuj novou verzi
});

// ═══ ACTIVATE - smaž staré cache ═══
self.addEventListener('activate', e => {
  console.log(`[SW] Activate ${VERSION}`);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log(`[SW] Deleting old cache: ${k}`);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
     .then(() => {
       // Pošli zprávu všem klientům že je nová verze
       self.clients.matchAll().then(clients => {
         clients.forEach(client => {
           client.postMessage({ type: 'NEW_VERSION', version: VERSION });
         });
       });
     })
  );
});

// ═══ FETCH ═══
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Nepresekáváme Google API volání
  if (url.includes('googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com') ||
      url.includes('gstatic.com')) {
    return;
  }

  // Jen GET požadavky
  if (e.request.method !== 'GET') return;

  const isHTML = e.request.mode === 'navigate' ||
                 url.endsWith('.html') ||
                 url.endsWith('/') ||
                 url.endsWith('/strazce-pokladu/');

  if (isHTML) {
    // ═══ NETWORK-FIRST pro HTML ═══
    // Vždy zkus internet, aby testeri viděli nejnovější verzi
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Ulož čerstvou kopii
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback
          return caches.match(e.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
  } else {
    // ═══ CACHE-FIRST pro assets (fonty, obrázky) ═══
    // Rychlé načítání, nemění se často
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});

// ═══ MESSAGE - příjem zpráv z aplikace ═══
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data?.type === 'GET_VERSION') {
    e.ports[0].postMessage({ version: VERSION });
  }
  if (e.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => 
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => {
      e.ports[0]?.postMessage({ cleared: true });
    });
  }
});
