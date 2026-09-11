/* ============================================================
   Bioma · Backend en Google Apps Script (v2)
   ------------------------------------------------------------
   Script VINCULADO a la planilla bioma-db. Administra las hojas:
     · ingresos   (id, fecha, punto de venta, monto, obs, mod)
     · egresos    (id, fecha, concepto, monto, obs, mod)
     · deudas     (id, fecha, persona, concepto, monto, tipo, estado, mod)
     · conceptos  (dos columnas: ingresos | egresos)
     · borrados   (oculta; propaga eliminaciones entre dispositivos)
     · resumen    (fórmulas vivas; se crea una sola vez)
   Cualquier otra hoja de la planilla (calendarios, préstamos, etc.)
   NO es tocada por el script.

   Se pueden agregar filas a mano en ingresos/egresos/deudas: el
   script les genera id, normaliza fechas (3/8/2026 → 2026-08-03)
   y montos ($1.234,50 → 1234.5) en la próxima sincronización.

   La primera ejecución tras actualizar el código migra el esquema
   viejo automáticamente (separa "movimientos" en ingresos/egresos,
   conserva un respaldo oculto y aplica el formato visual).

   IMPORTANTE al actualizar el código: usar
     Implementar → Administrar implementaciones → ✏ → Nueva versión
   para que la URL /exec NO cambie.
   ============================================================ */

// Versión del protocolo. La app rechaza las respuestas que no la traigan:
// así una implementación vieja que haya quedado publicada no puede
// sobrescribir los datos del teléfono con un esquema que ya no existe.
var API = 7;

/* Cuántos renglones de venta viaja la app. La hoja las guarda todas; el
   teléfono solo necesita las últimas para mostrarlas y poder corregirlas.
   Sin este tope, una temporada entera viajaría en cada sincronización. */
var VENTANA_VENTAS = 300;

var COLUMNAS = {
  ingresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  egresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'direccion', 'estado', 'mod'],
  // Solo se carga el precio de chacra; los otros tres quedan vacíos y los
  // calcula la app con el porcentaje de la hoja "listas". Escribir un valor
  // en comarca/bariloche/verduleria fija ese precio y rompe el porcentaje.
  // "categoria" va al final a propósito: agregarla en el medio correría
  // todas las columnas de las filas ya escritas y las leería mal.
  productos: ['id', 'nombre', 'unidad', 'presentacion', 'chacra',
              'comarca', 'bariloche', 'verduleria', 'activo', 'mod',
              'categoria', 'sku'],
  /* Un renglón por producto vendido. "venta" agrupa los renglones de una
     misma operación (el remito); "origen" dice de dónde salió el renglón
     (manual, planilla, o el bolsón que lo contiene) para no sumar dos veces
     lo que ya se contó como bolsón. */
  ventas: ['id', 'venta', 'fecha', 'cliente', 'lista', 'producto',
           'presentacion', 'unidad', 'cantidad', 'precio', 'subtotal',
           'origen', 'obs', 'mod'],
  borrados: ['id', 'mod']
};

// Rubros del catálogo. "bolsón" es un producto compuesto: se vende como
// unidad y además se abre en lo que lleva adentro (ver PLAN.md, Fase 4).
var CATEGORIAS = ['hortaliza', 'fruta', 'congelado', 'elaborado',
                  'bioinsumo', 'animal', 'bolsón', 'otro'];

var ENCABEZADOS = {
  ingresos: ['id', 'fecha', 'punto de venta', 'monto', 'observaciones', 'mod'],
  egresos: ['id', 'fecha', 'concepto', 'monto', 'observaciones', 'mod'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado', 'mod'],
  productos: ['id', 'producto', 'unidad', 'presentación', 'precio chacra',
              'comarca (fijo)', 'bariloche (fijo)', 'verdulerías (fijo)',
              'activo', 'mod', 'categoría', 'SKU'],
  ventas: ['id', 'venta', 'fecha', 'cliente', 'lista', 'producto',
           'presentación', 'unidad', 'cantidad', 'precio', 'subtotal',
           'origen', 'observaciones', 'mod'],
  borrados: ['id', 'mod'],
  conceptos: ['ingresos', 'egresos'],
  listas: ['clave', 'nombre', 'ajuste %']
};

// Las cuatro listas de precios. "chacra" es la base; las demás se calculan
// como un porcentaje sobre ella. Se pueden cambiar en la hoja "listas".
var LISTAS_DEFAULT = [
  ['chacra', 'Chacra', 0],
  ['comarca', 'Comarca', 30],
  ['bariloche', 'Bariloche', 50],
  ['verduleria', 'Verdulerías', -20]
];

var COLOR = {
  verde: '#3d6b35', verdeClaro: '#e7efe3',
  tierra: '#b98a4a', tierraClaro: '#f3ead9',
  rojo: '#b0533c', crema: '#faf8f2', blanco: '#ffffff'
};

/* ================= Puntos de entrada ================= */

function doGet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    asegurarEsquema_();
    var estado = leerEstado_();
    estado.api = API;
    return salidaJson_(estado);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    asegurarEsquema_();
    var datos = JSON.parse(e.postData.contents);
    return salidaJson_(sincronizar_(datos));
  } catch (err) {
    return salidaJson_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ================= Sincronización ================= */

function sincronizar_(entrada) {
  var estado = leerEstado_();

  var borrados = {};
  estado.borrados.forEach(function (b) { borrados[b.id] = b; });
  (entrada.borrados || []).forEach(function (b) { borrados[b.id] = b; });

  var movimientos = fusionar_(estado.movimientos, entrada.movimientos || [], borrados);
  var deudas = fusionar_(estado.deudas, entrada.deudas || [], borrados);
  var productos = fusionar_(estado.productos, entrada.productos || [], borrados);
  /* Ventas: la app manda solo una ventana de las últimas, no todas. Acá se
     fusionan contra la hoja completa (que las conserva todas) y se devuelven
     solo las últimas, para que el teléfono no se baje una temporada entera. */
  var ventas = fusionar_(estado.ventas, entrada.ventas || [], borrados);

  /* La hoja "conceptos" es la fuente de verdad. La app solo aporta los
     agregados con "+ agregar nuevo…".

     Solo se aceptan de un cliente que se identifique (cliente >= 2): las
     versiones viejas de la app mandaban su lista COMPLETA en cada
     sincronización, así que reponían todo lo borrado a mano y volvían a
     inyectar su lista por defecto en minúsculas. Un teléfono con la app
     vieja en caché alcanzaba para deshacer la limpieza de la hoja. */
  var aporta = Number(entrada.cliente || 0) >= 2 ? (entrada.conceptos || {}) : {};
  var conceptos = {
    ingresos: unirConceptos_(estado.conceptos.ingresos, aporta.ingresos),
    egresos: unirConceptos_(estado.conceptos.egresos, aporta.egresos)
  };

  escribirDatos_('ingresos', movimientos.filter(function (m) { return m.tipo !== 'egreso'; }));
  escribirDatos_('egresos', movimientos.filter(function (m) { return m.tipo === 'egreso'; }));
  escribirDatos_('deudas', deudas);
  escribirDatos_('productos', productos);
  escribirDatos_('ventas', ventas);
  escribirBorrados_(borrados);
  escribirConceptos_(conceptos);

  // Se devuelve la lista completa de tumbas: la app la necesita para saber
  // qué borrar de su copia local sin tener que confiar ciegamente en que
  // "lo que no vino en la respuesta hay que borrarlo".
  var listaBorrados = Object.keys(borrados).map(function (id) {
    return { id: id, mod: borrados[id].mod };
  });
  return {
    api: API,
    movimientos: movimientos,
    deudas: deudas,
    productos: productos,
    ventas: ventas.slice(-VENTANA_VENTAS),
    ventasTotal: ventas.length,
    conceptos: conceptos,
    listas: estado.listas,
    borrados: listaBorrados
  };
}

function fusionar_(remotos, locales, borrados) {
  var porId = {};
  remotos.concat(locales).forEach(function (item) {
    if (!item || !item.id || borrados[item.id]) return;
    var previo = porId[item.id];
    if (!previo || (item.mod || 0) > (previo.mod || 0)) porId[item.id] = item;
  });
  return Object.keys(porId).map(function (id) { return porId[id]; })
    .sort(function (a, b) {
      // Los movimientos y deudas se ordenan por fecha; los productos, que
      // no tienen fecha, por nombre.
      var ka = a.fecha || a.nombre || '';
      var kb = b.fecha || b.nombre || '';
      return String(ka).localeCompare(String(kb));
    });
}

function unir_(a, b) {
  var visto = {}, out = [];
  (a || []).concat(b || []).forEach(function (x) {
    if (x && !visto[x]) { visto[x] = true; out.push(x); }
  });
  return out;
}

/* Une listas de conceptos ignorando mayúsculas y acentos, para que
   "Semillas" y "semillas" no convivan como dos conceptos distintos
   partiendo los totales del resumen. Gana la forma que ya está en la
   hoja, que es la que el usuario escribió. */
var ACENTOS_ = new RegExp('[\u0300-\u036f]', 'g');

function normClave_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(ACENTOS_, '');
}

function unirConceptos_(existentes, entrantes) {
  var visto = {}, out = [];
  (existentes || []).concat(entrantes || []).forEach(function (x) {
    var nombre = String(x || '').trim();
    if (!nombre) return;
    var k = normClave_(nombre);
    if (!visto[k]) { visto[k] = true; out.push(nombre); }
  });
  return out;
}

/* ================= Lectura ================= */

function leerEstado_() {
  var movimientos = leerDatos_('ingresos', 'ingreso').concat(leerDatos_('egresos', 'egreso'));
  return {
    movimientos: movimientos,
    deudas: leerDatos_('deudas', null),
    productos: leerProductos_(),
    ventas: leerVentas_(),
    borrados: leerBorrados_(),
    conceptos: leerConceptos_(),
    listas: leerListas_()
  };
}

/* Los productos no tienen fecha ni monto, así que necesitan su propia
   lectura. Como el resto, tolera filas escritas a mano: alcanza con poner
   el nombre y el precio de chacra, el id y el mod los completa el script.
   Los precios de comarca/bariloche/verdulerías se dejan vacíos salvo que
   se quiera fijar uno a mano. */
function leerProductos_() {
  var h = hoja_('productos');
  var valores = h.getDataRange().getValues();
  var cols = COLUMNAS.productos;
  var filas = [];
  var contador = 0;
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    obj.nombre = String(obj.nombre || '').trim();
    if (!obj.nombre) continue; // fila vacía o decorativa

    obj.id = String(obj.id || '').trim() || ('man' + Date.now().toString(36) + (contador++));
    obj.mod = Number(obj.mod) || Date.now();
    obj.unidad = String(obj.unidad || '').trim() || 'kg';
    obj.presentacion = String(obj.presentacion || '').trim();
    obj.chacra = normMonto_(obj.chacra);
    ['comarca', 'bariloche', 'verduleria'].forEach(function (k) {
      var n = normMonto_(obj[k]);
      obj[k] = n > 0 ? n : ''; // vacío = lo calcula el porcentaje de la lista
    });
    obj.activo = normBool_(obj.activo);
    obj.categoria = String(obj.categoria || '').trim().toLowerCase() || 'hortaliza';
    obj.sku = String(obj.sku || '').trim();
    filas.push(obj);
  }
  return filas;
}

/* Un renglón por producto vendido. Tolera filas cargadas a mano, igual que
   el resto: alcanza con fecha, cliente, producto y cantidad. */
function leerVentas_() {
  var h = hoja_('ventas');
  var valores = h.getDataRange().getValues();
  var cols = COLUMNAS.ventas;
  var filas = [];
  var contador = 0;
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    obj.producto = String(obj.producto || '').trim();
    obj.fecha = normFecha_(obj.fecha);
    obj.cantidad = normMonto_(obj.cantidad);
    if (!obj.producto || (!obj.fecha && !obj.cantidad)) continue;
    if (!obj.fecha) obj.fecha = normFecha_(new Date());

    obj.id = String(obj.id || '').trim() || ('man' + Date.now().toString(36) + (contador++));
    obj.venta = String(obj.venta || '').trim() || obj.id;
    obj.mod = Number(obj.mod) || Date.now();
    obj.cliente = String(obj.cliente || '').trim() || 'sin cliente';
    obj.lista = String(obj.lista || '').trim() || 'chacra';
    obj.presentacion = String(obj.presentacion || '').trim();
    obj.unidad = String(obj.unidad || '').trim() || 'unidad';
    obj.precio = normMonto_(obj.precio);
    obj.subtotal = normMonto_(obj.subtotal) || (obj.cantidad * obj.precio);
    obj.origen = String(obj.origen || '').trim() || 'manual';
    obj.obs = String(obj.obs || '');
    filas.push(obj);
  }
  return filas;
}

// "SI", "TRUE", 1, vacío → activo. Solo "NO"/"FALSE"/0 lo desactivan.
function normBool_(v) {
  if (v === '' || v == null) return true;
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toLowerCase();
  return !(s === 'no' || s === 'false' || s === '0' || s === 'inactivo');
}

function leerListas_() {
  var h = hoja_('listas');
  var valores = h.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < valores.length; i++) {
    var clave = String(valores[i][0] || '').trim();
    if (!clave) continue;
    out.push({
      clave: clave,
      nombre: String(valores[i][1] || clave).trim(),
      ajuste: Number(normMonto_(valores[i][2])) || 0
    });
  }
  if (!out.length) { // hoja vacía: sembrar las cuatro listas de Bioma
    escribirListas_(LISTAS_DEFAULT);
    out = LISTAS_DEFAULT.map(function (l) {
      return { clave: l[0], nombre: l[1], ajuste: l[2] };
    });
  }
  return out;
}

function escribirListas_(filas) {
  var h = hoja_('listas');
  limpiarDatos_(h, 3);
  if (filas.length) h.getRange(2, 1, filas.length, 3).setValues(filas);
}

// Lee una hoja de datos tolerando filas agregadas a mano:
// genera id/mod si faltan y normaliza fecha, monto, estado y tipo.
function leerDatos_(nombre, tipo) {
  var h = hoja_(nombre);
  var valores = h.getDataRange().getValues();
  var cols = COLUMNAS[nombre];
  var filas = [];
  var contador = 0;
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var vacia = v.every(function (c) { return c === '' || c == null; });
    if (vacia) continue;
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    obj.id = String(obj.id || '').trim() || ('man' + Date.now().toString(36) + (contador++));
    obj.mod = Number(obj.mod) || Date.now();
    obj.fecha = normFecha_(obj.fecha);
    obj.monto = normMonto_(obj.monto);
    // Sin fecha ni monto no es un registro: ignorar (fila decorativa/nota)
    if (!obj.fecha && !obj.monto) continue;
    if (!obj.fecha) obj.fecha = normFecha_(new Date());

    if (tipo) {
      obj.tipo = tipo;
      obj.concepto = String(obj.concepto || '').trim() || 'varios';
      obj.obs = String(obj.obs || '');
    } else {
      obj.persona = String(obj.persona || '').trim() || 'sin nombre';
      obj.concepto = String(obj.concepto || '');
      obj.direccion = normDireccion_(obj.direccion);
      obj.estado = normEstado_(obj.estado);
    }
    filas.push(obj);
  }
  return filas;
}

function leerBorrados_() {
  var h = hoja_('borrados');
  var valores = h.getDataRange().getValues();
  var filas = [];
  for (var i = 1; i < valores.length; i++) {
    if (!valores[i][0]) continue;
    filas.push({ id: String(valores[i][0]), mod: Number(valores[i][1]) || 0 });
  }
  return filas;
}

function leerConceptos_() {
  var h = hoja_('conceptos');
  var valores = h.getDataRange().getValues();
  var conceptos = { ingresos: [], egresos: [] };
  for (var i = 1; i < valores.length; i++) {
    var ing = String(valores[i][0] || '').trim();
    var egr = String(valores[i][1] || '').trim();
    if (ing && conceptos.ingresos.indexOf(ing) < 0) conceptos.ingresos.push(ing);
    if (egr && conceptos.egresos.indexOf(egr) < 0) conceptos.egresos.push(egr);
  }
  return conceptos;
}

/* ================= Normalización ================= */

function pad2_(n) { return ('0' + n).slice(-2); }

function normFecha_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  if (!s) return '';
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // 3/8/2026
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                  // 2026-08-03
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  return '';
}

function normMonto_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  // "1.234,56" (formato es-AR) → 1234.56
  if (s.indexOf(',') > -1 && s.lastIndexOf(',') > s.lastIndexOf('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  return Number(s) || 0;
}

function normEstado_(v) {
  var s = String(v || '').trim().toLowerCase();
  return (s === 'saldada' || s === 'pagada' || s === 'saldado') ? 'saldada' : 'pendiente';
}

function normDireccion_(v) {
  var s = String(v || '').trim().toLowerCase();
  return (s.indexOf('nos') === 0) ? 'nos_deben' : 'debo'; // "nos deben" / "debemos"
}

/* ================= Escritura ================= */

function escribirDatos_(nombre, objetos) {
  var h = hoja_(nombre);
  var cols = COLUMNAS[nombre];
  limpiarDatos_(h, cols.length);
  if (!objetos.length) return;
  var filas = objetos.map(function (o) {
    return cols.map(function (c) {
      var v = o[c];
      if (c === 'fecha') return fechaADate_(v);
      if (c === 'direccion') return v === 'nos_deben' ? 'nos deben' : 'debemos';
      return v == null ? '' : v;
    });
  });
  h.getRange(2, 1, filas.length, cols.length).setValues(filas);
}

function escribirBorrados_(borrados) {
  var h = hoja_('borrados');
  limpiarDatos_(h, 2);
  var ids = Object.keys(borrados);
  if (!ids.length) return;
  var filas = ids.map(function (id) { return [id, borrados[id].mod]; });
  h.getRange(2, 1, filas.length, 2).setValues(filas);
}

function escribirConceptos_(conceptos) {
  var h = hoja_('conceptos');
  limpiarDatos_(h, 2);
  var n = Math.max(conceptos.ingresos.length, conceptos.egresos.length);
  if (!n) return;
  var filas = [];
  for (var i = 0; i < n; i++) {
    filas.push([conceptos.ingresos[i] || '', conceptos.egresos[i] || '']);
  }
  h.getRange(2, 1, n, 2).setValues(filas);
}

function limpiarDatos_(h, anchoCols) {
  var ultimaFila = h.getLastRow();
  if (ultimaFila > 1) h.getRange(2, 1, ultimaFila - 1, anchoCols).clearContent();
}

function fechaADate_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function hoja_(nombre) {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.appendRow(ENCABEZADOS[nombre] || COLUMNAS[nombre]);
  }
  return h;
}

/* ================= Migración y formato (se ejecuta una vez) ================= */

function asegurarEsquema_() {
  var props = PropertiesService.getDocumentProperties();
  var version = props.getProperty('esquema');
  var conocidas = ['v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
  if (conocidas.indexOf(version) < 0) migrarV2_();
  if (version !== 'v5' && version !== 'v6' && version !== 'v7') {
    // v5 agrega el catálogo de productos y las listas de precios
    leerListas_(); // crea y siembra la hoja "listas" si no existía
  }
  if (version !== 'v6' && version !== 'v7') {
    // v6 suma a "resumen" las tablas mes a mes y el flujo de fondos
    repararResumen_();
  }
  if (version !== 'v7' && version !== 'v8') {
    // v7 agrega la categoría a los productos
    estilizarProductos_();
  }
  if (version !== 'v8') {
    // v8 agrega la hoja de ventas y el SKU de los productos
    estilizarProductos_();
    estilizarVentas_();
    props.setProperty('esquema', 'v8');
  }
  // En cada petición: deshacer los efectos de una versión vieja del script
  // que hubiera quedado publicada (hoja "movimientos" recreada, conceptos
  // vaciados o vueltos al formato tipo|nombre).
  reabsorberHojasViejas_();
}

// Reconstruye la hoja resumen (v3 corrige las fórmulas, que estaban en
// formato inglés y fallaban en planillas configuradas en español).
function repararResumen_() {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('resumen');
  if (h) ss.deleteSheet(h);
  crearResumen_();
}

// Pliega la hoja "movimientos" vieja (si una versión anterior del script la
// recreó) dentro de ingresos/egresos, y normaliza la hoja conceptos si
// quedó en el formato viejo. Es inofensivo cuando no hay nada que reparar.
function reabsorberHojasViejas_() {
  var ss = SpreadsheetApp.getActive();

  var hm = ss.getSheetByName('movimientos');
  if (hm) {
    var vm = hm.getDataRange().getValues();
    var extraIng = [], extraEgr = [];
    for (var i = 1; i < vm.length; i++) {
      var r = vm[i];
      if (!r[2] && !r[4]) continue;
      var obj = {
        id: String(r[0] || ''), fecha: r[2], concepto: String(r[3] || ''),
        monto: r[4], obs: String(r[5] || ''), mod: Number(r[6]) || 0
      };
      if (String(r[1] || '').trim() === 'egreso') extraEgr.push(obj);
      else extraIng.push(obj);
    }
    var borrados = {};
    leerBorrados_().forEach(function (b) { borrados[b.id] = b; });
    escribirDatos_('ingresos', fusionar_(leerDatos_('ingresos', 'ingreso'),
      normalizarLista_(extraIng, 'ingreso'), borrados));
    escribirDatos_('egresos', fusionar_(leerDatos_('egresos', 'egreso'),
      normalizarLista_(extraEgr, 'egreso'), borrados));
    ss.deleteSheet(hm);
  }

  var hc = ss.getSheetByName('conceptos');
  if (hc && String(hc.getRange(1, 1).getValue()).toLowerCase().trim() === 'tipo') {
    var vc = hc.getDataRange().getValues();
    var conceptos = { ingresos: [], egresos: [] };
    for (var i = 1; i < vc.length; i++) {
      var t = String(vc[i][0] || '').trim(), n = String(vc[i][1] || '').trim();
      if (conceptos[t] && n && conceptos[t].indexOf(n) < 0) conceptos[t].push(n);
    }
    hc.clear();
    estilizarConceptos_();
    escribirConceptos_(conceptos);
  }
}

// Migración inicial desde el esquema viejo (hoja "movimientos" única)
function migrarV2_() {
  var ss = SpreadsheetApp.getActive();

  // --- conceptos: convertir del formato viejo (tipo|nombre) a dos columnas
  var conceptos = { ingresos: [], egresos: [] };
  var hc = ss.getSheetByName('conceptos');
  if (hc && String(hc.getRange(1, 1).getValue()).toLowerCase().trim() === 'tipo') {
    var vc = hc.getDataRange().getValues();
    for (var i = 1; i < vc.length; i++) {
      var t = String(vc[i][0] || '').trim(), n = String(vc[i][1] || '').trim();
      if (conceptos[t] && n && conceptos[t].indexOf(n) < 0) conceptos[t].push(n);
    }
    hc.clear();
    hc.appendRow(ENCABEZADOS.conceptos);
  } else if (hc) {
    conceptos = leerConceptos_();
  }

  // --- movimientos: separar en ingresos / egresos (respaldo oculto)
  var ing = [], egr = [];
  var hm = ss.getSheetByName('movimientos');
  if (hm) {
    var vm = hm.getDataRange().getValues();
    for (var i = 1; i < vm.length; i++) {
      var r = vm[i];
      if (!r[2] && !r[4]) continue;
      var obj = {
        id: String(r[0] || ''), tipo: String(r[1] || '').trim(),
        fecha: r[2], concepto: String(r[3] || ''), monto: r[4],
        obs: String(r[5] || ''), mod: Number(r[6]) || 0
      };
      if (obj.tipo === 'egreso') egr.push(obj); else ing.push(obj);
    }
    if (!ss.getSheetByName('backup_movimientos')) {
      hm.setName('backup_movimientos');
      hm.hideSheet();
    }
  }

  // --- crear/estilizar hojas
  estilizarHojaDatos_('ingresos', COLOR.verde, COLOR.verdeClaro);
  estilizarHojaDatos_('egresos', COLOR.tierra, COLOR.tierraClaro);
  estilizarHojaDatos_('deudas', COLOR.rojo, '#f5e4df');
  estilizarConceptos_();
  hoja_('borrados').hideSheet();
  crearResumen_();

  // --- volcar datos migrados y normalizados
  if (ing.length || egr.length) {
    escribirDatos_('ingresos', normalizarLista_(ing, 'ingreso'));
    escribirDatos_('egresos', normalizarLista_(egr, 'egreso'));
  }
  var deudasViejas = leerDatos_('deudas', null);
  if (deudasViejas.length) escribirDatos_('deudas', deudasViejas);
  if (conceptos.ingresos.length || conceptos.egresos.length) escribirConceptos_(conceptos);
}

function normalizarLista_(lista, tipo) {
  var contador = 0;
  return lista.map(function (o) {
    return {
      id: o.id || ('mig' + Date.now().toString(36) + (contador++)),
      tipo: tipo,
      fecha: normFecha_(o.fecha) || normFecha_(new Date()),
      concepto: String(o.concepto || '').trim() || 'varios',
      monto: normMonto_(o.monto),
      obs: String(o.obs || ''),
      mod: Number(o.mod) || Date.now()
    };
  });
}

function estilizarHojaDatos_(nombre, colorFuerte, colorSuave) {
  var h = hoja_(nombre);
  var cols = COLUMNAS[nombre];
  var nCols = cols.length;

  h.setTabColor(colorFuerte);
  h.setFrozenRows(1);
  var encabezado = h.getRange(1, 1, 1, nCols);
  encabezado.setValues([ENCABEZADOS[nombre]]);
  encabezado.setBackground(colorFuerte).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(11);

  if (h.getBandings().length === 0) {
    h.getRange(1, 1, 1000, nCols).applyRowBanding()
      .setHeaderRowColor(colorFuerte)
      .setFirstRowColor(COLOR.blanco)
      .setSecondRowColor(colorSuave);
  }

  // Formatos por columna (fila 2 en adelante)
  var iFecha = cols.indexOf('fecha') + 1;
  var iMonto = cols.indexOf('monto') + 1;
  var iId = cols.indexOf('id') + 1;
  var iMod = cols.indexOf('mod') + 1;
  h.getRange(2, iFecha, 999).setNumberFormat('dd/mm/yyyy');
  h.getRange(2, iMonto, 999).setNumberFormat('"$"#,##0');
  h.getRange(2, iId, 999).setNumberFormat('@');
  h.getRange(2, iMod, 999).setNumberFormat('0');
  h.setColumnWidth(iFecha, 95);
  h.setColumnWidth(iMonto, 110);
  h.setColumnWidth(cols.indexOf('concepto') + 1, 170);
  if (cols.indexOf('obs') > -1) h.setColumnWidth(cols.indexOf('obs') + 1, 240);

  // Validaciones (advertencia, no bloqueo: las filas manuales no se rechazan)
  var ss = SpreadsheetApp.getActive();
  if (nombre === 'ingresos' || nombre === 'egresos') {
    var colConceptos = nombre === 'ingresos' ? 'A' : 'B';
    var regla = SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getRange('conceptos!' + colConceptos + '2:' + colConceptos + '500'), true)
      .setAllowInvalid(true).build();
    h.getRange(2, cols.indexOf('concepto') + 1, 999).setDataValidation(regla);
  }
  if (nombre === 'deudas') {
    var reglaTipo = SpreadsheetApp.newDataValidation()
      .requireValueInList(['debemos', 'nos deben'], true).setAllowInvalid(true).build();
    h.getRange(2, cols.indexOf('direccion') + 1, 999).setDataValidation(reglaTipo);
    var reglaEstado = SpreadsheetApp.newDataValidation()
      .requireValueInList(['pendiente', 'saldada'], true).setAllowInvalid(true).build();
    h.getRange(2, cols.indexOf('estado') + 1, 999).setDataValidation(reglaEstado);
  }

  // Ocultar columnas técnicas
  h.hideColumns(iId);
  h.hideColumns(iMod);
}

/* La hoja de productos tiene su propio formato: no hay fecha ni monto
   único, sino un precio base y tres precios opcionales que solo se
   completan cuando se quiere romper el porcentaje. */
function estilizarProductos_() {
  var h = hoja_('productos');
  var cols = COLUMNAS.productos;
  var n = cols.length;

  h.setTabColor(COLOR.verde);
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, n).setValues([ENCABEZADOS.productos])
    .setBackground(COLOR.verde).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(11);

  if (h.getBandings().length === 0) {
    h.getRange(1, 1, 500, n).applyRowBanding()
      .setHeaderRowColor(COLOR.verde)
      .setFirstRowColor(COLOR.blanco)
      .setSecondRowColor(COLOR.verdeClaro);
  }

  var iChacra = cols.indexOf('chacra') + 1;
  h.getRange(2, iChacra, 499, 4).setNumberFormat('"$"#,##0'); // chacra + los 3 fijos
  h.setColumnWidth(cols.indexOf('nombre') + 1, 170);
  h.setColumnWidth(cols.indexOf('presentacion') + 1, 140);

  // Las tres columnas de precio fijo se marcan como opcionales
  h.getRange(1, cols.indexOf('comarca') + 1, 1, 3)
    .setNote('Dejar vacío para que el precio salga del porcentaje de la hoja "listas".\n' +
             'Escribir un valor acá fija ese precio para este producto.');

  var reglaUnidad = SpreadsheetApp.newDataValidation()
    .requireValueInList(['kg', 'atado', 'unidad', 'bandeja', 'bolsa', 'planta', 'docena'], true)
    .setAllowInvalid(true).build();
  h.getRange(2, cols.indexOf('unidad') + 1, 499).setDataValidation(reglaUnidad);

  var reglaActivo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['SI', 'NO'], true).setAllowInvalid(true).build();
  h.getRange(2, cols.indexOf('activo') + 1, 499).setDataValidation(reglaActivo);

  var reglaCat = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIAS, true).setAllowInvalid(true).build();
  var iCat = cols.indexOf('categoria') + 1;
  h.getRange(2, iCat, 499).setDataValidation(reglaCat);
  h.setColumnWidth(iCat, 120);

  h.hideColumns(cols.indexOf('id') + 1);
  h.hideColumns(cols.indexOf('mod') + 1);

  var hl = hoja_('listas');
  hl.setTabColor(COLOR.verde);
  hl.setFrozenRows(1);
  hl.getRange(1, 1, 1, 3).setValues([ENCABEZADOS.listas])
    .setBackground(COLOR.verde).setFontColor(COLOR.blanco).setFontWeight('bold');
  hl.setColumnWidth(1, 110);
  hl.setColumnWidth(2, 140);
  hl.getRange(1, 3).setNote('Porcentaje sobre el precio de chacra. ' +
    'Ej: 30 = un 30% más caro; -20 = un 20% más barato.');
}

/* La hoja de ventas: un renglón por producto vendido. Es la que más va a
   crecer (~6.000 renglones por temporada), así que se deja lista para
   tabla dinámica: encabezados congelados y columnas con formato. */
function estilizarVentas_() {
  var h = hoja_('ventas');
  var cols = COLUMNAS.ventas;
  var n = cols.length;

  h.setTabColor(COLOR.tierra);
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, n).setValues([ENCABEZADOS.ventas])
    .setBackground(COLOR.tierra).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(11);

  h.getRange(2, cols.indexOf('fecha') + 1, 4999).setNumberFormat('dd/mm/yyyy');
  h.getRange(2, cols.indexOf('cantidad') + 1, 4999).setNumberFormat('#,##0.##');
  h.getRange(2, cols.indexOf('precio') + 1, 4999).setNumberFormat('"$"#,##0');
  h.getRange(2, cols.indexOf('subtotal') + 1, 4999).setNumberFormat('"$"#,##0');
  h.setColumnWidth(cols.indexOf('producto') + 1, 190);
  h.setColumnWidth(cols.indexOf('cliente') + 1, 140);
  h.setColumnWidth(cols.indexOf('presentacion') + 1, 120);

  h.hideColumns(cols.indexOf('id') + 1);
  h.hideColumns(cols.indexOf('mod') + 1);

  h.getRange(1, cols.indexOf('origen') + 1).setNote(
    'De dónde salió el renglón: "manual" (cargado en la app), "planilla" ' +
    '(importado de la tienda virtual) o el bolsón que lo contiene.\n' +
    'Los renglones que vienen de abrir un bolsón NO se suman al total ' +
    'facturado: ese importe ya está en el renglón del bolsón.');
}

function estilizarConceptos_() {
  var h = hoja_('conceptos');
  h.setTabColor(COLOR.verde);
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, 2).setValues([ENCABEZADOS.conceptos])
    .setBackground(COLOR.verde).setFontColor(COLOR.blanco).setFontWeight('bold');
  h.setColumnWidth(1, 180);
  h.setColumnWidth(2, 180);
}

// La hoja resumen se crea UNA sola vez: si la modificás o la borrás y
// se vuelve a sincronizar, no se pisa (solo se recrea si no existe).
function crearResumen_() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName('resumen')) return;
  var h = ss.insertSheet('resumen', 0);
  h.setTabColor(COLOR.verde);

  h.getRange('A1:N1').merge().setValue('BIOMA · RESUMEN')
    .setBackground(COLOR.verde).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');

  // Nota: la planilla está configurada en español, así que las fórmulas
  // usan ";" como separador de argumentos.
  h.getRange('A3:B7').setValues([
    ['Ingresos totales', '=SUM(ingresos!D2:D)'],
    ['Egresos totales', '=SUM(egresos!D2:D)'],
    ['Balance', '=B3-B4'],
    ['Debemos (pendiente)', '=SUMIFS(deudas!E2:E;deudas!G2:G;"pendiente";deudas!F2:F;"debemos")'],
    ['Nos deben (pendiente)', '=SUMIFS(deudas!E2:E;deudas!G2:G;"pendiente";deudas!F2:F;"nos deben")']
  ]);
  h.getRange('A3:A7').setFontWeight('bold');
  h.getRange('B3:B7').setNumberFormat('"$"#,##0');

  var titulos = [
    ['A9', 'INGRESOS POR PUNTO DE VENTA', COLOR.verde],
    ['D9', 'EGRESOS POR CONCEPTO', COLOR.tierra],
    ['G9', 'INGRESOS POR MES', COLOR.verde],
    ['J9', 'EGRESOS POR MES', COLOR.tierra],
    ['M9', 'DEUDA PENDIENTE POR PERSONA', COLOR.rojo]
  ];
  titulos.forEach(function (t) {
    h.getRange(t[0]).setValue(t[1]).setFontWeight('bold').setFontColor(t[2]);
  });

  h.getRange('A10').setValue('=QUERY(ingresos!C2:D;"select C, sum(D) where C is not null group by C order by sum(D) desc label C \'punto de venta\', sum(D) \'total\'";0)');
  h.getRange('D10').setValue('=QUERY(egresos!C2:D;"select C, sum(D) where C is not null group by C order by sum(D) desc label C \'concepto\', sum(D) \'total\'";0)');
  // Meses como texto "yyyy-mm" (evita funciones de fecha de QUERY, que
  // fallan según el tipo de columna). El "\" separa columnas en la
  // sintaxis de matrices de las planillas en español.
  h.getRange('G10').setValue('=QUERY({ARRAYFORMULA(IF(ingresos!B2:B="";"";TEXT(ingresos!B2:B;"yyyy-mm")))\\ingresos!D2:D};"select Col1, sum(Col2) where Col1<>\'\' group by Col1 order by Col1 desc label Col1 \'mes\', sum(Col2) \'total\'";0)');
  h.getRange('J10').setValue('=QUERY({ARRAYFORMULA(IF(egresos!B2:B="";"";TEXT(egresos!B2:B;"yyyy-mm")))\\egresos!D2:D};"select Col1, sum(Col2) where Col1<>\'\' group by Col1 order by Col1 desc label Col1 \'mes\', sum(Col2) \'total\'";0)');
  h.getRange('M10').setValue('=QUERY(deudas!C2:G;"select C, sum(E) where G=\'pendiente\' and C is not null group by C order by sum(E) desc label C \'persona\', sum(E) \'pendiente\'";0)');

  ['B10:B', 'E10:E', 'H10:H', 'K10:K', 'N10:N'].forEach(function (r) {
    h.getRange(r).setNumberFormat('"$"#,##0');
  });

  agregarTablasMensuales_(h);
  ['A', 'D', 'G', 'J', 'M'].forEach(function (c) {
    h.setColumnWidth(h.getRange(c + '1').getColumn(), 170);
  });
}

/* Tablas mes a mes de la hoja "resumen".

   Van más abajo en la misma hoja, separadas por bloques con aire de sobra
   para que ninguna pise a la otra cuando aparezcan meses o conceptos nuevos.

   Notas de las fórmulas (ya nos costaron errores antes, ver DECISIONES.md):
   · la planilla está en español: separador ";" y "\" entre columnas de matriz;
   · nada de year()/month() de QUERY, que fallan según el tipo de columna: se
     agrupa por TEXT(fecha;"yyyy-mm"), que además ordena solo;
   · rangos acotados (2000 filas) para que SUMPRODUCT no se arrastre. */
function agregarTablasMensuales_(h) {
  // Meses presentes en cualquiera de las dos hojas, del más nuevo al más viejo
  var mesesIngresos = 'ARRAYFORMULA(IF(ingresos!B2:B="";"";TEXT(ingresos!B2:B;"yyyy-mm")))';
  var mesesEgresos = 'ARRAYFORMULA(IF(egresos!B2:B="";"";TEXT(egresos!B2:B;"yyyy-mm")))';

  /* ---------- FLUJO DE FONDOS MES A MES (fila 60) ---------- */
  titulo_(h, 'A60', 'FLUJO DE FONDOS MES A MES', COLOR.verde);
  h.getRange('A61:E61').setValues([['mes', 'ingresos', 'egresos', 'resultado', 'acumulado']])
    .setFontWeight('bold').setBackground(COLOR.verdeClaro);

  h.getRange('A62').setValue(
    '=QUERY({' + mesesIngresos + ';' + mesesEgresos + '};' +
    '"select Col1 where Col1 is not null and Col1 <> \'\' group by Col1 order by Col1 desc";0)');

  // Una fila por mes; 60 alcanza para cinco temporadas
  var filas = [];
  for (var i = 62; i < 122; i++) {
    var m = '$A' + i;
    var ing = 'SUMPRODUCT((TEXT(ingresos!$B$2:$B$2000;"yyyy-mm")=' + m + ')*ingresos!$D$2:$D$2000)';
    var egr = 'SUMPRODUCT((TEXT(egresos!$B$2:$B$2000;"yyyy-mm")=' + m + ')*egresos!$D$2:$D$2000)';
    // El acumulado suma todos los meses hasta ese, sin depender del orden
    var ingAcum = 'SUMPRODUCT((TEXT(ingresos!$B$2:$B$2000;"yyyy-mm")<=' + m + ')*(ingresos!$B$2:$B$2000<>"")*ingresos!$D$2:$D$2000)';
    var egrAcum = 'SUMPRODUCT((TEXT(egresos!$B$2:$B$2000;"yyyy-mm")<=' + m + ')*(egresos!$B$2:$B$2000<>"")*egresos!$D$2:$D$2000)';
    filas.push([
      '=IF(' + m + '="";"";' + ing + ')',
      '=IF(' + m + '="";"";' + egr + ')',
      '=IF(' + m + '="";"";B' + i + '-C' + i + ')',
      '=IF(' + m + '="";"";' + ingAcum + '-' + egrAcum + ')'
    ]);
  }
  h.getRange('B62:E121').setValues(filas).setNumberFormat('"$"#,##0');

  /* ---------- INGRESOS POR PUNTO DE VENTA, MES A MES (fila 125) ---------- */
  titulo_(h, 'A125', 'INGRESOS POR PUNTO DE VENTA · MES A MES', COLOR.verde);
  h.getRange('A126').setValue(
    '=QUERY({' + mesesIngresos + '\\ingresos!C2:C\\ingresos!D2:D};' +
    '"select Col2, sum(Col3) where Col1 <> \'\' and Col2 is not null ' +
    'group by Col2 pivot Col1 label Col2 \'punto de venta\'";0)');

  /* ---------- EGRESOS POR CONCEPTO, MES A MES (fila 170) ---------- */
  titulo_(h, 'A170', 'EGRESOS POR CONCEPTO · MES A MES', COLOR.tierra);
  h.getRange('A171').setValue(
    '=QUERY({' + mesesEgresos + '\\egresos!C2:C\\egresos!D2:D};' +
    '"select Col2, sum(Col3) where Col1 <> \'\' and Col2 is not null ' +
    'group by Col2 pivot Col1 label Col2 \'concepto\'";0)');

  h.getRange('B126:Z160').setNumberFormat('"$"#,##0');
  h.getRange('B171:Z215').setNumberFormat('"$"#,##0');
  h.setColumnWidth(1, 200);
}

function titulo_(h, celda, texto, color) {
  h.getRange(celda).setValue(texto).setFontWeight('bold')
    .setFontColor(color).setFontSize(12);
}

/* ================= Respaldos automáticos =================
   Cada madrugada se guarda una copia completa de la planilla en una
   carpeta "respaldos bioma-db", al lado de la original en Drive. Se
   conservan los últimos 30 días; los más viejos van a la papelera.

   Para activarlo, una sola vez: en el editor de Apps Script elegir la
   función `instalarRespaldoDiario` y tocar Ejecutar. Pide autorización
   para acceder a Drive porque tiene que crear la copia.

   Para restaurar: abrir la copia del día que sirva y usar
   "Archivo → Hacer una copia", o copiar las hojas que hagan falta a la
   planilla original. Nunca se toca la planilla en uso.
   ============================================================ */

var CARPETA_RESPALDOS = 'respaldos bioma-db';
var RESPALDOS_A_CONSERVAR = 30;

function crearRespaldoDiario() {
  var ss = SpreadsheetApp.getActive();
  var archivo = DriveApp.getFileById(ss.getId());
  var padres = archivo.getParents();
  var padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();

  var carpetas = padre.getFoldersByName(CARPETA_RESPALDOS);
  var carpeta = carpetas.hasNext() ? carpetas.next() : padre.createFolder(CARPETA_RESPALDOS);

  var sello = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var nombre = 'bioma-db ' + sello;
  if (carpeta.getFilesByName(nombre).hasNext()) return nombre + ' (ya estaba hecho)';

  archivo.makeCopy(nombre, carpeta);
  purgarRespaldos_(carpeta);
  return nombre;
}

function purgarRespaldos_(carpeta) {
  var lista = [];
  var it = carpeta.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    lista.push({ f: f, t: f.getDateCreated().getTime() });
  }
  lista.sort(function (a, b) { return b.t - a.t; }); // del más nuevo al más viejo
  for (var i = RESPALDOS_A_CONSERVAR; i < lista.length; i++) lista[i].f.setTrashed(true);
}

// Ejecutar UNA vez a mano desde el editor para dejarlo programado.
function instalarRespaldoDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crearRespaldoDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('crearRespaldoDiario').timeBased().atHour(3).everyDays(1).create();
  var primero = crearRespaldoDiario(); // uno ya mismo, para no esperar a mañana
  return 'Respaldo diario activado (3 de la mañana). Primera copia: ' + primero;
}

// Para mirar desde el editor qué respaldos hay disponibles.
function listarRespaldos() {
  var ss = SpreadsheetApp.getActive();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  var carpetas = padre.getFoldersByName(CARPETA_RESPALDOS);
  if (!carpetas.hasNext()) return 'Todavía no hay respaldos.';
  var it = carpetas.next().getFiles();
  var nombres = [];
  while (it.hasNext()) nombres.push(it.next().getName());
  nombres.sort().reverse();
  Logger.log(nombres.join('\n'));
  return nombres.length + ' respaldos:\n' + nombres.join('\n');
}

/* ================= Salida ================= */

function salidaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
