// ═══════════════════════════════════════════════════════
// Strážce Pokladu - Service Worker
// Network-first pro HTML (vždy čerstvé), cache-first pro assets
// ═══════════════════════════════════════════════════════

const VERSION = 'v2.30.0'; // ← SW dieta: precache jen shell (atomicky), těžké assety best-effort + runtime cache
const CACHE = `strazce-${VERSION}`;

// ═══ CORE — kritický shell aplikace ═══
// Instaluje se ATOMICKY (addAll): selže-li jediný soubor, instalace SW
// spadne celá. Proto sem patří jen malé soubory nutné pro offline start.
const CORE_ASSETS = [
  './', './index.html', './manifest.json',
  './splash-bg.jpg',
  './bg-night.jpg',            // výchozí pozadí Nádvoří
  './favicon.ico', './favicon.png',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-180.png', './icons/icon-maskable-512.png'
];

// ═══ WARMUP — těžké/sekundární assety ═══
// Stahují se BEST-EFFORT (allSettled): když se nestáhnou (pomalá síť,
// přerušení), instalace SW přesto uspěje. Doplní je runtime cache
// při prvním použití.
const WARMUP_ASSETS = [
  './intro.mp4',               // 4 MB — hlavní důvod diety
  './mg0-bg.jpg',
  './bg-dawn.jpg', './bg-day.jpg', './bg-golden.jpg'
];

// ═══ INSTALL ═══
self.addEventListener('install', e => {
  console.log(`[SW] Install ${VERSION}`);
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // 1) Shell atomicky — musí uspět celý
      c.addAll(CORE_ASSETS).then(() =>
        // 2) Warm-up best-effort — selhání jednotlivostí nevadí
        Promise.allSettled(
          WARMUP_ASSETS.map(url =>
            c.add(url).catch(err =>
              console.warn(`[SW] Warm-up přeskočen: ${url}`, err)
            )
          )
        )
      )
    )
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

  // Přeskočit non-http(s) schémata (chrome-extension://, data:, blob: atd.)
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

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
    // ═══ CACHE-FIRST pro assets (obrázky, video, audio) ═══
    // Rychlé načítání; co není v precache, uloží se při prvním použití
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          // Kešujeme same-origin ('basic') i CORS odpovědi se statusem 200.
          // Opaque odpovědi (status 0) nekešujeme — nelze ověřit obsah.
          const cacheable = res && res.status === 200 &&
                            (res.type === 'basic' || res.type === 'cors');
          if (!cacheable) return res;
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() =>
          // Offline a asset není v cache → korektní síťová chyba
          // (dřív se vracel index.html, což pro obrázek/audio nedává smysl)
          Response.error()
        );
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
