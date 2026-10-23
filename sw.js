/* Vitrola: guarda o app e as bibliotecas para funcionar sem internet */
const SHELL = 'vitrola-shell-v2';
const LIBS = 'vitrola-libs-v2';
/* o acervo de músicas foi retirado: o cache antigo dele é apagado na ativação */
const KEEP = [SHELL, LIBS];
const SHELL_FILES = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vitrola-') && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function page(req) {
  const c = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(req, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) await c.put('./', r.clone());
    return r;
  } catch (e) {
    return (await c.match('./')) || (await c.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(name, req) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}

async function staleWhileRevalidate(name, req) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    if (req.mode === 'navigate') return e.respondWith(page(req));
    return e.respondWith(cacheFirst(SHELL, req));
  }
  /* fontes: guardadas depois da primeira vez */
  if (url.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(LIBS, req));
  if (url.hostname === 'fonts.googleapis.com') return e.respondWith(staleWhileRevalidate(LIBS, req));
  /* o resto (capas, busca de capas) vai direto para a internet */
});
