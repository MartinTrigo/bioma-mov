/* Service worker: cachea la app para funcionar sin conexión.
   Solo intercepta GET del mismo origen: las peticiones de sincronización
   a script.google.com pasan directo a la red. */
const CACHE = 'bioma-v7';
const ARCHIVOS = ['./', './index.html', './styles.css', './app.js', './logo.svg', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // `cache: 'reload'` saltea el caché HTTP del navegador: sin esto una copia
  // vieja de app.js podía seguir sirviéndose durante horas y la app parecía
  // no actualizarse nunca.
  e.respondWith(
    fetch(e.request, { cache: 'reload' })
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
