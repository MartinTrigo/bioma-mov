/* ============================================================
   Sincronización con la planilla de Google (Apps Script).
   La app manda su estado, el script lo fusiona con la planilla y
   devuelve el consolidado. Reglas de seguridad:
   · Se rechaza toda respuesta sin `api` (implementación vieja).
   · Un registro local solo se borra si el servidor confirma su tumba.
   ============================================================ */

const SYNC_URL_KEY = 'bioma-sync-url';
const API_MINIMA = 4;   // por debajo de esto la respuesta se descarta
const API_PRODUCTOS = 5; // desde acá el servidor entiende productos y listas
const API_VENTAS = 7;    // desde acá entiende la hoja de ventas
/* La app guarda solo los últimos renglones de venta: la planilla los tiene
   todos. Sin este tope, una temporada entera viajaría en cada sincronización
   y en cada carga del teléfono. */
const VENTANA_VENTAS = 300;

let sincronizando = false;

function urlSync() { return localStorage.getItem(SYNC_URL_KEY) || ''; }

async function sincronizar(silencioso) {
  const url = urlSync();
  if (!url || sincronizando) return;
  sincronizando = true;
  setSyncEstado('⟳');

  // Solo se suben los conceptos agregados desde la app ("+ agregar nuevo…").
  // La hoja "conceptos" manda: renombrar, borrar u ordenar ahí se refleja acá.
  const conceptosEnviados = {
    ingresos: [...db.conceptosNuevos.ingresos],
    egresos: [...db.conceptosNuevos.egresos]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      // sin Content-Type: evita el preflight CORS que Apps Script no soporta
      body: JSON.stringify({
        action: 'sync',
        // Identifica a esta versión de la app. El servidor solo acepta
        // conceptos de clientes >= 2: los anteriores mandaban su lista
        // entera y reponían lo que se borraba a mano en la planilla.
        cliente: 2,
        movimientos: db.movimientos,
        deudas: db.deudas,
        productos: db.productos,
        ventas: db.ventas,
        borrados: db.borrados,
        conceptos: conceptosEnviados
      })
    });
    const remoto = await res.json();
    if (remoto.error) throw new Error(remoto.error);

    if (!(remoto.api >= API_MINIMA)) {
      setSyncEstado('!');
      toast('El script de la planilla está desactualizado — datos a salvo');
      return;
    }

    const tumbas = new Set((remoto.borrados || []).map(b => b.id));
    const idsRemotos = new Set([
      ...(remoto.movimientos || []).map(x => x.id),
      ...(remoto.deudas || []).map(x => x.id),
      ...(remoto.productos || []).map(x => x.id),
      ...(remoto.ventas || []).map(x => x.id)
    ]);
    const conservar = x => !idsRemotos.has(x.id) && !tumbas.has(x.id);

    db.movimientos = [...remoto.movimientos, ...db.movimientos.filter(conservar)];
    db.deudas = [...remoto.deudas, ...db.deudas.filter(conservar)];
    db.deudas.forEach(x => { if (x.estado === 'pagada') x.estado = 'saldada'; });

    // Productos y listas solo si el servidor ya los entiende: contra una
    // versión anterior del script se conserva lo que haya en el dispositivo.
    if (remoto.api >= API_PRODUCTOS) {
      db.productos = [...(remoto.productos || []), ...db.productos.filter(conservar)];
      if (remoto.listas && remoto.listas.length) db.listas = remoto.listas;
    }
    if (remoto.api >= API_VENTAS) {
      /* La respuesta trae solo las últimas ventas, no todas: lo que falta no
         está borrado, está más atrás en la planilla. Por eso acá no se
         conserva "lo que no vino" salvo que sea más nuevo que la ventana, y
         se recorta al final para que el dispositivo no crezca sin límite. */
      const ventas = [...(remoto.ventas || []), ...db.ventas.filter(conservar)];
      ventas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) ||
        (a.mod || 0) - (b.mod || 0));
      db.ventas = ventas.slice(-VENTANA_VENTAS);
      db.ventasTotal = remoto.ventasTotal || db.ventas.length;
    }

    adoptarConceptos(remoto, conceptosEnviados);

    db.borrados = db.borrados.filter(b => !tumbas.has(b.id));
    db.ultimaSync = new Date().toISOString();
    save(true); // la planilla ya tiene todo: no quedan cambios sin subir
    initAll();
    setSyncEstado('✓');
    if (!silencioso) toast('Sincronizado con Drive ✓');
  } catch (e) {
    console.warn('Sync falló:', e);
    setSyncEstado('!');
    if (!silencioso) toast('Sin conexión — los datos quedan guardados en el dispositivo');
  } finally {
    sincronizando = false;
  }
}

/* La hoja "conceptos" manda siempre: lo que diga la planilla es lo que
   ve la app, con su orden y su forma de escribir.

   Antes, si la planilla volvía sin conceptos, la app reponía su lista
   local. Esa "reparación" terminó siendo el problema: reinyectaba la
   lista por defecto del código y devolvía a la vida los conceptos que
   se habían borrado a mano. Ahora la app nunca sube una lista completa;
   solo los conceptos creados con "+ agregar nuevo…". */
function adoptarConceptos(remoto, enviados) {
  const hay = remoto.conceptos &&
    (remoto.conceptos.ingresos.length || remoto.conceptos.egresos.length);
  if (!hay) return; // planilla sin conceptos: se deja como está, no se repone

  db.conceptos = remoto.conceptos;
  db.conceptosNuevos.ingresos = db.conceptosNuevos.ingresos.filter(c => !enviados.ingresos.includes(c));
  db.conceptosNuevos.egresos = db.conceptosNuevos.egresos.filter(c => !enviados.egresos.includes(c));
}

function setSyncEstado(simbolo) {
  const b = $('#btnSync');
  if (!b) return;
  b.dataset.estado = simbolo;
  b.textContent = simbolo === '⟳' ? '⟳' : '↻';
  b.classList.toggle('sync-error', simbolo === '!');
  marcarPendientes();
}

/* Punto naranja sobre el botón ↻ mientras haya cambios que la planilla
   todavía no recibió. Es el aviso que faltaba: un catálogo importado sin
   sincronización configurada parecía guardado y vivía en un solo equipo. */
function marcarPendientes() {
  const b = $('#btnSync');
  if (!b) return;
  const hay = !!db.pendientes && !!urlSync();
  b.classList.toggle('pendiente', hay);
  b.title = hay
    ? 'Hay cambios sin subir a la planilla — tocá para sincronizar'
    : 'Sincronizar con Drive';
}

function actualizarSyncInfo() {
  $('#sync-url').value = urlSync();
  const pend = db.pendientes ? ' · ⚠ hay cambios sin subir' : '';
  $('#sync-status').textContent = urlSync()
    ? (db.ultimaSync
      ? 'Última sincronización: ' + new Date(db.ultimaSync).toLocaleString('es-AR') + pend
      : 'Configurada, aún sin sincronizar')
    : 'Sin configurar — los datos solo viven en este dispositivo';
  marcarPendientes();
  // Sin URL la app parece vacía aunque los datos estén a salvo en la
  // planilla: el aviso evita que se confunda con una pérdida de datos.
  $('#aviso-sync').classList.toggle('hidden', !!urlSync());
}

$('#btnSync').addEventListener('click', () => {
  if (!urlSync()) {
    $('#btnExport').click();
    toast('Configurá primero la URL de sincronización');
    return;
  }
  sincronizar(false);
});

$('#btnSyncSave').addEventListener('click', () => {
  const url = $('#sync-url').value.trim();
  if (url && !url.startsWith('https://script.google.com/')) {
    alert('La URL debe ser la del Web App de Google Apps Script\n(empieza con https://script.google.com/…)');
    return;
  }
  if (url) localStorage.setItem(SYNC_URL_KEY, url);
  else localStorage.removeItem(SYNC_URL_KEY);
  actualizarSyncInfo();
  if (url) sincronizar(false);
  else toast('Sincronización desactivada');
});

$('#aviso-sync').addEventListener('click', () => $('#btnExport').click());

/* Arma el enlace de alta para otro teléfono o computadora. Cuidado: lleva
   la URL del Web App, que funciona como contraseña de los datos. Se manda
   solo a quien tenga que usar la app. */
$('#btnEnlaceDispositivo').addEventListener('click', async () => {
  const url = urlSync();
  if (!url) { toast('Primero configurá la sincronización acá'); return; }
  const enlace = location.origin + location.pathname + '#sync=' + encodeURIComponent(url);
  try {
    await navigator.clipboard.writeText(enlace);
    toast('Enlace copiado — mandalo solo a quien use la app');
  } catch (e) {
    prompt('Copiá este enlace y abrilo en el otro dispositivo:', enlace);
  }
});

/* Configuración por enlace: abrir la app con
     …/bioma-mov/#sync=<URL del Web App>
   deja la sincronización lista sin tener que tipear la URL larga en el
   teléfono. Sirve para dar de alta un dispositivo nuevo mandando el
   enlace por WhatsApp. El hash no viaja al servidor y se borra apenas
   se usa, para que no quede en la barra de direcciones. */
function configurarDesdeEnlace() {
  const h = location.hash || '';
  const i = h.indexOf('sync=');
  if (i < 0) return;

  let url = '';
  try { url = decodeURIComponent(h.slice(i + 5)); } catch (e) { url = ''; }
  const limpiarHash = () =>
    history.replaceState(null, '', location.pathname + location.search);

  if (!url.startsWith('https://script.google.com/')) {
    limpiarHash();
    toast('El enlace no trae una dirección válida');
    return;
  }
  if (url === urlSync()) { limpiarHash(); return; } // ya estaba configurada

  const yaHabia = !!urlSync();
  const msg = yaHabia
    ? 'Este enlace apunta a otra planilla.\n¿Cambiar la sincronización de esta app?'
    : '¿Conectar esta app con la planilla de Bioma?';
  if (confirm(msg)) {
    localStorage.setItem(SYNC_URL_KEY, url);
    limpiarHash();
    actualizarSyncInfo();
    sincronizar(false);
  } else {
    limpiarHash();
  }
}

/* Pedirle al navegador que no descarte el almacenamiento local: sin esto
   Android puede vaciar la app y perder lo que aún no se sincronizó. */
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(ok => { if (!ok) navigator.storage.persist(); });
}
