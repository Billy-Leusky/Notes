// Service worker : garde l'app sur l'appareil pour qu'elle s'ouvre même sans Internet.
// - Fichiers de l'app : réseau d'abord (pour avoir la dernière version), sinon la copie gardée.
// - Bibliothèque Supabase (version figée) : copie gardée d'abord.
// - Données (Supabase) : jamais interceptées, l'app gère elle-même le hors-ligne.
const CACHE = 'sets-v20';
const CORE = ['./', './index.html', './app.css?v=20', './app.js?v=20', './vendor/diff_match_patch.js?v=1',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Chaque fichier séparément : un échec n'empêche pas de garder les autres
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    await fetch(CDN, { mode: 'no-cors' }).then(r => c.put(CDN, r)).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), ms))]);
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && url.href !== CDN) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (!same) {
      const hit = await c.match(CDN);
      if (hit) return hit;
      const r = await fetch(req); c.put(CDN, r.clone()); return r;
    }
    try {
      const r = await withTimeout(fetch(req), 5000);
      if (r && r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      return (await c.match(req)) || (await c.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? (await c.match('./index.html')) || (await c.match('./')) : null)
        || Response.error();
    }
  })());
});
