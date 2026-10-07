/* Service worker: cachea la app para funcionar sin conexión.
   Solo intercepta GET del mismo origen: las peticiones de sincronización
   a script.google.com pasan directo a la red. */
const CACHE = 'bioma-v36';
const ARCHIVOS = [
  './', './index.html', './styles.css', './logo.svg', './manifest.json',
  './js/util.js', './js/db.js', './js/sincro.js', './js/movimientos.js',
  './js/deudas.js', './js/productos.js', './js/ventas.js',
  './js/ventas-importar.js', './js/resumen.js', './js/proyeccion.js', './js/respaldo.js',
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

/* Pedidos de la app (01/10). Antes: 'reload' en cada archivo, que se saltea
   todo caché y BAJABA ENTERA la app en cada apertura (en vez de preguntar si
   cambió, que cuesta casi nada); sin plazo, así que con señal débil la
   pantalla quedaba en blanco; y guardaba cualquier respuesta, también un
   error: un 404 de GitHub en el momento justo quedaba guardado y se servía
   sin señal.
   Ahora: 'no-cache' (pregunta con el ETag; si no cambió, 304 y nada más), se
   guarda solo lo que llegó bien, y al abrir se espera a la red 3 s como
   máximo; si no llega, toda la página sale de la copia, sin mezclar
   versiones, y la red termina por detrás para la próxima vez. */
const ESPERA_RED_MS = 3000;
let usarCopia = false;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  if (e.request.mode === 'navigate') e.respondWith(abrir(e.request));
  else e.respondWith(usarCopia ? copiaPrimero(e.request) : redPrimero(e.request));
});

function deLaRed(pedido) {
  return fetch(pedido, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copia = res.clone();
      caches.open(CACHE).then(c => c.put(pedido, copia));
    }
    return res;
  });
}

async function abrir(pedido) {
  const red = deLaRed(pedido);
  red.catch(() => {});
  const plazo = new Promise(ok => setTimeout(() => ok(null), ESPERA_RED_MS));
  let res = null;
  try { res = await Promise.race([red, plazo]); } catch (_) { res = null; }
  if (res && res.ok) { usarCopia = false; return res; }
  const copia = (await caches.match(pedido)) || (await caches.match('./index.html'));
  if (copia) { usarCopia = true; return copia; }
  usarCopia = false;
  return res || red;
}

function redPrimero(pedido) {
  return deLaRed(pedido).then(res => res.ok ? res : caches.match(pedido).then(hit => hit || res))
    .catch(() => caches.match(pedido));
}

async function copiaPrimero(pedido) {
  const hit = await caches.match(pedido);
  if (hit) { deLaRed(pedido).catch(() => {}); return hit; }
  return deLaRed(pedido);
}
