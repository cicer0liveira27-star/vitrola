/* Vitrola: guarda o app, as bibliotecas e o acervo para funcionar sem internet */
const SHELL = 'vitrola-shell-v1';
const LIBS = 'vitrola-libs-v2';
const ACERVO = 'vitrola-acervo-v1';
const KEEP = [SHELL, LIBS, ACERVO];
const SHELL_FILES = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './acervo/CREDITOS.md'];
const ACERVO_FILES = ['defiance', 'syntheticity', 'daybreak', 'the-forest-awakes', 'deserve-to-be-loved', 'king-of-the-desert',
  'a-memory-away', 'find-you', 'honky-tonk-villain', 'wild-waters', 'home', 'leaving-millie', 'carol-of-the-bells']
  .map(f => './acervo/' + f + '.mp3');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vitrola-') && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* o app pede para baixar o acervo aos poucos, em segundo plano */
let warming = false;
async function warmAcervo() {
  if (warming) return;
  warming = true;
  try {
    const c = await caches.open(ACERVO);
    for (const f of ACERVO_FILES) {
      const url = new URL(f, self.registration.scope).href;
      if (await c.match(url)) continue;
      try { const r = await fetch(url); if (r.ok && r.status === 200) await c.put(url, r); } catch (e) { break; }
    }
  } finally { warming = false; }
}
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'cache-acervo') e.waitUntil(warmAcervo());
});

/* áudio pede pedaços do arquivo (Range): monta a resposta parcial a partir do arquivo guardado */
async function withRange(req, res) {
  const range = req.headers.get('range');
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? +m[1] : 0;
  let end = m && m[2] ? +m[2] : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

async function acervo(req) {
  const c = await caches.open(ACERVO);
  const hit = await c.match(req.url);
  if (hit) return withRange(req, hit);
  /* ainda não guardado: toca pela internet e guarda o arquivo inteiro para a próxima vez */
  const net = fetch(req);
  net.then(() => fetch(req.url).then(r => { if (r.ok && r.status === 200) return c.put(req.url, r); })).catch(() => {});
  return net;
}

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
    if (url.pathname.includes('/acervo/') && url.pathname.endsWith('.mp3')) return e.respondWith(acervo(req));
    return e.respondWith(cacheFirst(SHELL, req));
  }
  /* fontes: guardadas depois da primeira vez */
  if (url.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(LIBS, req));
  if (url.hostname === 'fonts.googleapis.com') return e.respondWith(staleWhileRevalidate(LIBS, req));
  /* o resto (capas, busca de capas) vai direto para a internet */
});
