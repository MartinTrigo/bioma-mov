/* Service worker: cachea la app para funcionar sin conexión.
   Solo intercepta GET del mismo origen: las peticiones de sincronización
   a script.google.com pasan directo a la red. */
const CACHE = 'bioma-v20';
const ARCHIVOS = [
  './', './index.html', './styles.css', './logo.svg', './manifest.json',
  './js/util.js', './js/db.js', './js/sincro.js', './js/movimientos.js',
  './js/deudas.js', './js/productos.js', './js/ventas.js',
  './js/ventas-importar.js', './js/resumen.js', './js/respaldo.js',
  './app.js'
];

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
