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
var API = 8;

/* Cuántos renglones de venta viaja la app. La hoja las guarda todas; el
   teléfono solo necesita las últimas para mostrarlas y poder corregirlas.
   Sin este tope, una temporada entera viajaría en cada sincronización. */
var VENTANA_VENTAS = 300;

var COLUMNAS = {
  ingresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  /* "persona" va al final (agregarla en el medio correría las columnas ya
     escritas). Se usa al liquidar horas: un egreso con concepto "sueldos"
     dice a quién se le pagó, y con eso sale el saldo de cada trabajador. */
  egresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod', 'persona'],
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
           'presentacion', 'unidad', 'cantidad', 'kg', 'precio', 'subtotal',
           'origen', 'obs', 'mod'],
  borrados: ['id', 'mod']
};

// Rubros del catálogo. "bolsón" es un producto compuesto: se vende como
// unidad y además se abre en lo que lleva adentro (ver PLAN.md, Fase 4).
var CATEGORIAS = ['hortaliza', 'fruta', 'congelado', 'elaborado',
                  'bioinsumo', 'animal', 'bolsón', 'otro'];

var ENCABEZADOS = {
  ingresos: ['id', 'fecha', 'punto de venta', 'monto', 'observaciones', 'mod'],
  egresos: ['id', 'fecha', 'concepto', 'monto', 'observaciones', 'mod', 'persona'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado', 'mod'],
  productos: ['id', 'producto', 'unidad', 'presentación', 'precio chacra',
              'comarca (fijo)', 'bariloche (fijo)', 'verdulerías (fijo)',
              'activo', 'mod', 'categoría', 'SKU'],
  ventas: ['id', 'venta', 'fecha', 'cliente', 'lista', 'producto',
           'presentación', 'unidad', 'cantidad', 'kg', 'precio', 'subtotal',
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
  actualizarFlujo_(movimientos);
  actualizarGraficos_();

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
    horas: resumirHoras_(),
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
    obj.kg = normMonto_(obj.kg) || '';
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
      obj.persona = String(obj.persona || '').trim();
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
  if (version !== 'v8' && version !== 'v9') {
    // v8 agrega la hoja de ventas y el SKU de los productos
    estilizarProductos_();
  }
  if (version !== 'v9' && version !== 'v10') {
    /* v9 rehace los encabezados de ventas. Al sumar la columna "kg" los
       datos pasaron a escribirse con ella, pero el encabezado seguía
       siendo el anterior: la columna de kilos decía "precio". */
    estilizarVentas_();
  }
  if (version !== 'v10' && version !== 'v11') {
    // v10 rearma la hoja resumen con el diseño compacto
    escribirResumen_();
    PropertiesService.getDocumentProperties().deleteProperty('graficos');
  }
  if (version !== 'v11' && version !== 'v12') {
    // v11 suma las tablas de horas de trabajo al resumen
    escribirResumenHoras_();
  }
  if (version !== 'v12') {
    /* v12: los egresos ganan la columna "persona" (para liquidar horas) y
       se unifican los conceptos de trabajo en "sueldos". */
    estilizarHojaDatos_('egresos', COLOR.tierra, COLOR.tierraClaro);
    escribirResumenHoras_();
    props.setProperty('esquema', 'v12');
  }
  /* Reparación de los efectos de una versión vieja del script (hoja
     "movimientos" recreada, conceptos vueltos al formato tipo|nombre).
     Corría en CADA petición y es cara: ahora solo si hay algo que reparar,
     que se comprueba con dos búsquedas de hoja. El endpoint tardaba entre
     13 y 23 segundos, y la app llegaba a cortar por tiempo. */
  var ss = SpreadsheetApp.getActive();
  var hc = ss.getSheetByName('conceptos');
  if (ss.getSheetByName('movimientos') ||
      (hc && String(hc.getRange(1, 1).getValue()).toLowerCase().trim() === 'tipo')) {
    reabsorberHojasViejas_();
  }
}

/* Antes esto borraba la hoja "resumen" y la volvía a crear. Eso rompió
   los gráficos que el usuario había armado apuntando a ella: al morir la
   hoja, los gráficos pierden su referencia y quedan vacíos.

   La hoja resumen es del usuario, no del script: se crea si no existe y
   nunca se destruye. Las correcciones se aplican sobre las celdas que
   hagan falta (ver actualizarFlujo_). */
function repararResumen_() {
  if (!SpreadsheetApp.getActive().getSheetByName('resumen')) crearResumen_();
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
  h.getRange(2, cols.indexOf('kg') + 1, 4999).setNumberFormat('#,##0.###');
  h.getRange(1, cols.indexOf('kg') + 1).setNote(
    'Kilos reales vendidos, ya calculados: cantidad × peso de la presentación.\n' +
    'Queda vacío cuando la presentación no dice peso (10 ml, maple x30).\n' +
    'Es la columna para preguntar "cuántos kg de acelga se vendieron".');
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
/* ================= Hoja "resumen" =================
   Diseño compacto: lo importante entra en la primera pantalla. Todo sale
   de fórmulas vivas, salvo la lista de meses del flujo, que la escribe el
   script (ver actualizarFlujo_).

   La hoja NUNCA se borra: se reescribe su contenido. Borrarla rompía los
   gráficos que el usuario tuviera apuntando a ella.

   Distribución:
     A1     título
     A3     totales de la temporada
     A10    ingresos por punto de venta (total)
     D3     FLUJO DE FONDOS mes a mes       ← lo que se mira primero
     J3     egresos por concepto (total)
     M3     deuda pendiente por persona
     A50    ingresos por punto de venta, mes a mes
     A75    egresos por concepto, mes a mes
   ============================================================ */

var COL_FLUJO = 4;      // columna D
var MESES_FLUJO = 36;   // tres temporadas

function crearResumen_() {
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('resumen')) ss.insertSheet('resumen', 0);
  escribirResumen_();
}

function escribirResumen_() {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('resumen') || ss.insertSheet('resumen', 0);
  h.setTabColor(COLOR.verde);
  h.clear();

  /* ---------- Título ---------- */
  h.getRange('A1:N1').merge().setValue('BIOMA · RESUMEN')
    .setBackground(COLOR.verde).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(15)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  h.setRowHeight(1, 34);

  /* ---------- Totales de la temporada ---------- */
  bloque_(h, 'A3', 'LA TEMPORADA', COLOR.verde, 2);
  h.getRange('A4:B8').setValues([
    ['Ingresos totales', '=SUM(ingresos!D2:D)'],
    ['Egresos totales', '=SUM(egresos!D2:D)'],
    ['Balance', '=B4-B5'],
    ['Debemos (pendiente)', '=SUMIFS(deudas!E2:E;deudas!G2:G;"pendiente";deudas!F2:F;"debemos")'],
    ['Nos deben (pendiente)', '=SUMIFS(deudas!E2:E;deudas!G2:G;"pendiente";deudas!F2:F;"nos deben")']
  ]);
  h.getRange('A4:A8').setFontWeight('bold');
  h.getRange('B4:B8').setNumberFormat('"$"#,##0').setHorizontalAlignment('right');
  h.getRange('A6:B6').setBackground(COLOR.verdeClaro).setFontWeight('bold');

  /* ---------- Flujo de fondos: lo primero que se mira ---------- */
  bloque_(h, 'D3', 'FLUJO DE FONDOS MES A MES', COLOR.verde, 5);
  h.getRange('D4:H4')
    .setValues([['mes', 'ingresos', 'egresos', 'resultado', 'acumulado']])
    .setFontWeight('bold').setBackground(COLOR.verdeClaro)
    .setHorizontalAlignment('center');
  escribirFormulasFlujo_(h);

  /* ---------- Desgloses del total ---------- */
  bloque_(h, 'A10', 'INGRESOS POR PUNTO DE VENTA', COLOR.verde, 2);
  h.getRange('A11').setValue(
    '=QUERY(ingresos!C2:D;"select C, sum(D) where C is not null group by C ' +
    'order by sum(D) desc label C \'punto de venta\', sum(D) \'total\'";0)');

  bloque_(h, 'J3', 'EGRESOS POR CONCEPTO', COLOR.tierra, 2);
  h.getRange('J4').setValue(
    '=QUERY(egresos!C2:D;"select C, sum(D) where C is not null group by C ' +
    'order by sum(D) desc label C \'concepto\', sum(D) \'total\'";0)');

  bloque_(h, 'M3', 'DEUDA PENDIENTE', COLOR.rojo, 2);
  h.getRange('M4').setValue(
    '=QUERY(deudas!C2:G;"select C, sum(E) where G=\'pendiente\' and C is not null ' +
    'group by C order by sum(E) desc label C \'persona\', sum(E) \'pendiente\'";0)');

  /* ---------- Mes a mes, por concepto ---------- */
  var mi = 'ARRAYFORMULA(IF(ingresos!B2:B="";"";TEXT(ingresos!B2:B;"yyyy-mm")))';
  var me = 'ARRAYFORMULA(IF(egresos!B2:B="";"";TEXT(egresos!B2:B;"yyyy-mm")))';

  bloque_(h, 'A50', 'INGRESOS POR PUNTO DE VENTA · MES A MES', COLOR.verde, 8);
  h.getRange('A51').setValue(
    '=QUERY({' + mi + '\\ingresos!C2:C\\ingresos!D2:D};' +
    '"select Col2, sum(Col3) where Col1 <> \'\' and Col2 is not null ' +
    'group by Col2 pivot Col1 label Col2 \'punto de venta\'";0)');

  bloque_(h, 'A75', 'EGRESOS POR CONCEPTO · MES A MES', COLOR.tierra, 8);
  h.getRange('A76').setValue(
    '=QUERY({' + me + '\\egresos!C2:C\\egresos!D2:D};' +
    '"select Col2, sum(Col3) where Col1 <> \'\' and Col2 is not null ' +
    'group by Col2 pivot Col1 label Col2 \'concepto\'";0)');

  /* ---------- Formatos ---------- */
  ['B11:B45', 'K4:K48', 'N4:N25', 'B51:N70', 'B76:N120']
    .forEach(function (r) { h.getRange(r).setNumberFormat('"$"#,##0'); });
  h.setColumnWidth(1, 190);
  h.setColumnWidth(4, 90);
  h.setColumnWidth(10, 180);
  h.setColumnWidth(13, 150);
  [5, 6, 7, 8, 11, 14].forEach(function (c) { h.setColumnWidth(c, 105); });

  /* Las tablas de horas van en esta misma hoja, más abajo. Se reponen acá
     porque el clear() de arriba las borra: si se dejaran sueltas, cualquier
     rearmado del resumen las haría desaparecer sin que nadie lo note. */
  escribirResumenHoras_();
}

// Encabezado de bloque: una barra de color con el título
function bloque_(h, celda, texto, color, ancho) {
  var r = h.getRange(celda);
  h.getRange(r.getRow(), r.getColumn(), 1, ancho).merge().setValue(texto)
    .setBackground(color).setFontColor(COLOR.blanco)
    .setFontWeight('bold').setFontSize(10).setVerticalAlignment('middle');
  h.setRowHeight(r.getRow(), 24);
}

/* Busca el título del flujo en vez de asumir una fila fija. Antes se
   salía en silencio si el bloque no estaba exactamente donde esperaba:
   no escribía nada, no avisaba, y la tabla quedaba vacía para siempre. */
function filaDelFlujo_(h) {
  var col = h.getRange(1, COL_FLUJO, 200, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).indexOf('FLUJO DE FONDOS') > -1) return i + 1;
  }
  return 0;
}

/* La lista de meses no es una fórmula: el QUERY que apilaba los meses de
   las dos hojas daba #VALUE! en la planilla real, y una fórmula rota deja
   toda la tabla en blanco. La escribe el script en cada sincronización. */
function actualizarFlujo_(movimientos) {
  var h = SpreadsheetApp.getActive().getSheetByName('resumen');
  if (!h) return;
  var fila = filaDelFlujo_(h);
  if (!fila) return;
  var primera = fila + 2;

  var vistos = {};
  (movimientos || []).forEach(function (m) {
    var k = String(m.fecha || '').slice(0, 7);
    if (k.length === 7) vistos[k] = true;
  });
  var meses = Object.keys(vistos).sort();   // del más viejo al más nuevo

  var filas = [];
  for (var i = 0; i < MESES_FLUJO; i++) filas.push([meses[i] || '']);
  h.getRange(primera, COL_FLUJO, MESES_FLUJO, 1).setNumberFormat('@').setValues(filas);

  if (!String(h.getRange(primera, COL_FLUJO + 1).getFormula())) escribirFormulasFlujo_(h);
}

function escribirFormulasFlujo_(h) {
  var fila = filaDelFlujo_(h) || 3;
  var primera = fila + 2;
  var filas = [];
  for (var i = 0; i < MESES_FLUJO; i++) {
    var n = primera + i;
    var m = '$D' + n;
    var ing = 'SUMPRODUCT((TEXT(ingresos!$B$2:$B$2000;"yyyy-mm")=' + m + ')*ingresos!$D$2:$D$2000)';
    var egr = 'SUMPRODUCT((TEXT(egresos!$B$2:$B$2000;"yyyy-mm")=' + m + ')*egresos!$D$2:$D$2000)';
    var ingAc = 'SUMPRODUCT((TEXT(ingresos!$B$2:$B$2000;"yyyy-mm")<=' + m + ')*(ingresos!$B$2:$B$2000<>"")*ingresos!$D$2:$D$2000)';
    var egrAc = 'SUMPRODUCT((TEXT(egresos!$B$2:$B$2000;"yyyy-mm")<=' + m + ')*(egresos!$B$2:$B$2000<>"")*egresos!$D$2:$D$2000)';
    filas.push([
      '=IF(' + m + '="";"";' + ing + ')',
      '=IF(' + m + '="";"";' + egr + ')',
      '=IF(' + m + '="";"";E' + n + '-F' + n + ')',
      '=IF(' + m + '="";"";' + ingAc + '-' + egrAc + ')'
    ]);
  }
  h.getRange(primera, COL_FLUJO + 1, MESES_FLUJO, 4)
    .setValues(filas).setNumberFormat('"$"#,##0');
}

/* ================= Gráficos =================
   Los arma el script y les ajusta el rango cuando aparecen meses o
   conceptos nuevos, así se actualizan solos.

   Usa la hoja que ya exista, se llame "gráficas" o "gráficos": la primera
   versión creaba una hoja nueva con su propio nombre y dejaba intacta la
   del usuario, que era la que estaba rota.

   Se rehacen solo cuando cambia la cantidad de datos (se guarda una firma
   en una propiedad): rehacerlos en cada sincronización sería lento.
   Son del script, así que los retoques manuales sobre ellos se pierden;
   para gráficos propios, conviene otra hoja apuntando a "resumen".
   ============================================================ */

var NOMBRES_GRAFICOS = ['gráficas', 'graficas', 'gráficos', 'graficos'];

function hojaDeGraficos_() {
  var ss = SpreadsheetApp.getActive();
  for (var i = 0; i < NOMBRES_GRAFICOS.length; i++) {
    var h = ss.getSheetByName(NOMBRES_GRAFICOS[i]);
    if (h) return h;
  }
  var nueva = ss.insertSheet('gráficas');
  nueva.setTabColor(COLOR.verde);
  return nueva;
}

// Última fila con contenido dentro de un bloque acotado
function ultimaFilaCon_(h, col, desde, hasta) {
  var v = h.getRange(desde, col, hasta - desde + 1, 1).getValues();
  var ultima = desde - 1;
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() !== '') ultima = desde + i;
  }
  return ultima;
}

function actualizarGraficos_() {
  var ss = SpreadsheetApp.getActive();
  var res = ss.getSheetByName('resumen');
  if (!res) return;

  var filaFlujo = filaDelFlujo_(res);
  if (!filaFlujo) return;
  var cab = filaFlujo + 1;                                  // encabezados
  var finFlujo = ultimaFilaCon_(res, COL_FLUJO, cab + 1, cab + MESES_FLUJO);
  if (finFlujo <= cab) return;                              // todavía sin datos

  var finPuntos = ultimaFilaCon_(res, 1, 11, 45);
  var finConceptos = ultimaFilaCon_(res, 10, 4, 48);

  var firma = [filaFlujo, finFlujo, finPuntos, finConceptos].join('-');
  var props = PropertiesService.getDocumentProperties();
  if (props.getProperty('graficos') === firma) return;      // nada cambió

  var h = hojaDeGraficos_();
  h.getCharts().forEach(function (c) { h.removeChart(c); });

  var mes = res.getRange(cab, COL_FLUJO, finFlujo - cab + 1, 1);
  var col = function (n) {
    return res.getRange(cab, COL_FLUJO + n, finFlujo - cab + 1, 1);
  };

  // 1. Ingresos y egresos mes a mes
  h.insertChart(h.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(mes).addRange(col(1)).addRange(col(2))
    .setPosition(2, 1, 0, 0)
    .setOption('title', 'Ingresos y egresos mes a mes')
    .setOption('colors', [COLOR.verde, COLOR.tierra])
    .setOption('legend', { position: 'top' })
    .setOption('width', 640).setOption('height', 360)
    .build());

  // 2. Resultado del mes: cuándo se gastó más de lo que entró
  h.insertChart(h.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(mes).addRange(col(3))
    .setPosition(2, 8, 0, 0)
    .setOption('title', 'Resultado del mes (entró − salió)')
    .setOption('colors', [COLOR.verde])
    .setOption('legend', { position: 'none' })
    .setOption('width', 640).setOption('height', 360)
    .build());

  // 3. Acumulado: cómo se construye la temporada
  h.insertChart(h.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(mes).addRange(col(4))
    .setPosition(21, 1, 0, 0)
    .setOption('title', 'Acumulado de la temporada')
    .setOption('colors', [COLOR.verde])
    .setOption('legend', { position: 'none' })
    .setOption('curveType', 'function').setOption('pointSize', 6)
    .setOption('width', 640).setOption('height', 360)
    .build());

  // 4. De dónde viene la plata
  if (finPuntos > 11) {
    h.insertChart(h.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(res.getRange(11, 1, finPuntos - 10, 2))
      .setPosition(21, 8, 0, 0)
      .setOption('title', 'Ingresos por punto de venta')
      .setOption('pieSliceText', 'percentage')
      .setOption('width', 640).setOption('height', 360)
      .build());
  }

  // 5. En qué se va
  if (finConceptos > 4) {
    h.insertChart(h.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(res.getRange(4, 10, finConceptos - 3, 2))
      .setPosition(40, 1, 0, 0)
      .setOption('title', 'Egresos por concepto')
      .setOption('pieSliceText', 'percentage')
      .setOption('width', 640).setOption('height', 360)
      .build());
  }

  props.setProperty('graficos', firma);
}

function titulo_(h, celda, texto, color) {
  h.getRange(celda).setValue(texto).setFontWeight('bold')
    .setFontColor(color).setFontSize(12);
}

/* ================= Horas de trabajo =================
   Las horas se registran en OTRA planilla (un formulario que llenan los
   socios) y son el grueso del costo de la temporada. Acá se traen para
   poder liquidarlas y para ver en qué se trabaja.

   No se copian a mano ni con IMPORTRANGE: las lee el script, las
   normaliza y las deja en la hoja `horas` de bioma-db. El motivo de
   normalizar es que las fechas vienen en tres formatos distintos
   (d/m/aaaa, d/m/aa y d/m/aaaa 12:00:00, según se cargue por formulario
   o a mano), y sin arreglarlas los meses salen mal.

   NO corre en cada sincronización: leer otra planilla es lento. Corre
   con el respaldo diario, y se puede ejecutar a mano desde el editor
   (función `importarHoras`).
   ============================================================ */

// Planilla "Registro de horas". Si alguna vez se cambia, es el único lugar.
var ID_PLANILLA_HORAS = '1tx8V0VLciiTLFvAmSViAR6KV9LL9hXzvX6-qy30Ubpg';

// Si un trabajador no tiene su hoja "Cuenta individual", se usa esta
var TARIFA_POR_DEFECTO = 10000;

/* Fechas: d/m/aaaa, d/m/aa o d/m/aaaa hh:mm:ss, y también Date real.
   Devuelve 'yyyy-mm-dd' o '' si no se entiende. Nunca adivina. */
function fechaHoras_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var m = String(v || '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  var a = Number(m[3]);
  if (a < 100) a += 2000;
  return a + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
}

// Tarifa de cada trabajador, de sus hojas "Cuenta individual — Nombre"
function tarifasPorTrabajador_(libro) {
  var tarifas = {};
  libro.getSheets().forEach(function (h) {
    var nombre = h.getName();
    if (nombre.toLowerCase().indexOf('cuenta individual') < 0) return;
    var v = h.getRange(1, 1, 6, 2).getValues();
    var quien = '', tarifa = 0;
    for (var i = 0; i < v.length; i++) {
      var etiqueta = String(v[i][0]).toLowerCase();
      if (etiqueta.indexOf('trabajador') > -1) quien = String(v[i][1]).trim();
      if (etiqueta.indexOf('tarifa') > -1) tarifa = normMonto_(v[i][1]);
    }
    if (quien && tarifa) tarifas[normClave_(quien)] = tarifa;
  });
  return tarifas;
}

function importarHoras() {
  var libro = SpreadsheetApp.openById(ID_PLANILLA_HORAS);
  var origen = libro.getSheets()[0];   // la hoja del formulario
  var valores = origen.getDataRange().getValues();
  if (valores.length < 2) return 'La planilla de horas está vacía';

  // Se ubican las columnas por su nombre: el formulario puede reordenarlas
  var cab = valores[0].map(function (x) { return normClave_(x); });
  var col = function (nombres) {
    for (var i = 0; i < nombres.length; i++) {
      var j = cab.indexOf(nombres[i]);
      if (j > -1) return j;
    }
    return -1;
  };
  var iFecha = col(['fecha']);
  var iQuien = col(['biomere', 'trabajador', 'integrante', 'persona']);
  var iHoras = col(['horas']);
  var iAct = col(['actividad [fila 1]', 'actividad', 'actividades']);
  var iArea = col(['area', 'área']);
  var iObs = col(['observaciones', 'obs']);
  if (iFecha < 0 || iQuien < 0 || iHoras < 0) {
    throw new Error('La planilla de horas no tiene las columnas fecha, trabajador y horas');
  }

  var tarifas = tarifasPorTrabajador_(libro);
  var filas = [], sinFecha = 0, sinArea = 0;
  for (var i = 1; i < valores.length; i++) {
    var f = valores[i];
    var quien = String(f[iQuien] || '').trim();
    var horas = normMonto_(f[iHoras]);
    if (!quien || !horas) continue;

    var fecha = fechaHoras_(f[iFecha]);
    if (!fecha) { sinFecha++; continue; }   // sin fecha no se puede imputar al mes
    var area = iArea > -1 ? String(f[iArea] || '').trim() : '';
    if (!area) { area = 'sin área'; sinArea++; }

    filas.push([
      fecha, fecha.slice(0, 7), quien, horas,
      iAct > -1 ? String(f[iAct] || '').trim() : '',
      area,
      tarifas[normClave_(quien)] || TARIFA_POR_DEFECTO,
      horas * (tarifas[normClave_(quien)] || TARIFA_POR_DEFECTO),
      iObs > -1 ? String(f[iObs] || '').trim() : ''
    ]);
  }

  filas.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  escribirHoras_(filas);
  escribirResumenHoras_();

  var aviso = filas.length + ' registros importados';
  if (sinFecha) aviso += ' · ' + sinFecha + ' sin fecha entendible (quedaron afuera)';
  if (sinArea) aviso += ' · ' + sinArea + ' sin área';
  return aviso;
}

/* Lo que viaja a la app: no los ~400 registros sueltos, sino un renglón
   por mes + trabajador + área. Alcanza para todos los resúmenes de la
   pantalla y es una fracción del tamaño. */
function resumirHoras_() {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('horas');
  if (!h || h.getLastRow() < 2) return [];
  var v = h.getRange(2, 1, h.getLastRow() - 1, 8).getValues();
  var acum = {};
  for (var i = 0; i < v.length; i++) {
    var mes = String(v[i][1] || '');
    var quien = String(v[i][2] || '');
    var area = String(v[i][5] || '');
    if (!mes || !quien) continue;
    var k = mes + '|' + quien + '|' + area;
    if (!acum[k]) acum[k] = { mes: mes, trabajador: quien, area: area, horas: 0, devengado: 0 };
    acum[k].horas += Number(v[i][3]) || 0;
    acum[k].devengado += Number(v[i][7]) || 0;
  }
  return Object.keys(acum).map(function (k) { return acum[k]; });
}

function escribirHoras_(filas) {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('horas');
  if (!h) { h = ss.insertSheet('horas'); }
  h.clear();
  h.setTabColor(COLOR.tierra);
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, 9).setValues([[
    'fecha', 'mes', 'trabajador', 'horas', 'actividad', 'área',
    'tarifa $/h', 'devengado $', 'observaciones'
  ]]).setBackground(COLOR.tierra).setFontColor(COLOR.blanco).setFontWeight('bold');

  if (filas.length) {
    h.getRange(2, 1, filas.length, 9).setValues(filas);
    h.getRange(2, 1, filas.length, 1).setNumberFormat('@');
    h.getRange(2, 2, filas.length, 1).setNumberFormat('@');
    h.getRange(2, 4, filas.length, 1).setNumberFormat('#,##0.##');
    h.getRange(2, 7, filas.length, 2).setNumberFormat('"$"#,##0');
  }
  h.setColumnWidth(3, 110);
  h.setColumnWidth(5, 170);
  h.setColumnWidth(6, 140);
  h.setColumnWidth(9, 240);
  h.getRange(1, 1).setNote('Esta hoja la reescribe el script desde la planilla ' +
    'de registro de horas. No editarla a mano: los cambios se pierden en la ' +
    'próxima importación. Corregir en la planilla de origen.');
}

/* Las tablas de horas van en la misma hoja "resumen", debajo de todo, para
   que la gestión económica se mire en un solo lugar. */
function escribirResumenHoras_() {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('resumen');
  if (!h) return;

  /* Ojo con las letras: dentro de QUERY se cuentan desde el inicio del
     rango, no desde la hoja. En horas!B2:D -> A=mes, B=trabajador, C=horas. */
  bloque_(h, 'A100', 'HORAS POR TRABAJADOR · MES A MES', COLOR.tierra, 8);
  h.getRange('A101').setValue(
    '=IFERROR(QUERY(horas!B2:D;"select B, sum(C) where B is not null ' +
    'group by B pivot A label B \'trabajador\'";0);"sin datos")');

  bloque_(h, 'A120', 'HORAS POR ÁREA · MES A MES', COLOR.tierra, 8);
  h.getRange('A121').setValue(
    '=IFERROR(QUERY({horas!B2:B\\horas!F2:F\\horas!D2:D};' +
    '"select Col2, sum(Col3) where Col2 is not null ' +
    'group by Col2 pivot Col1 label Col2 \'área\'";0);"sin datos")');

  /* A liquidar: lo devengado sale de las horas, lo pagado de los egresos
     con concepto "sueldos" y la persona en su columna. El saldo es la
     resta. Mientras no se pague, eso es plata que el proyecto debe y que
     NO aparece en el balance: por eso se mira acá.
     En horas!C2:H -> A=trabajador, B=horas, C=actividad, D=área, E=tarifa, F=devengado */
  bloque_(h, 'J100', 'A LIQUIDAR POR TRABAJADOR', COLOR.rojo, 5);
  h.getRange('J101').setValue(
    '=IFERROR(QUERY(horas!C2:H;"select A, sum(B), sum(F) where A is not null ' +
    'group by A order by sum(F) desc ' +
    'label A \'trabajador\', sum(B) \'horas\', sum(F) \'devengado\'";0);"sin datos")');

  h.getRange('M101:N101').setValues([['pagado', 'saldo']])
    .setFontWeight('bold').setBackground(COLOR.verdeClaro)
    .setHorizontalAlignment('center');
  var pagos = [];
  for (var i = 102; i < 122; i++) {
    var pagado = 'SUMIFS(egresos!$D$2:$D$2000;egresos!$C$2:$C$2000;"sueldos";' +
                 'egresos!$G$2:$G$2000;$J' + i + ')';
    pagos.push([
      '=IF($J' + i + '="";"";' + pagado + ')',
      '=IF($J' + i + '="";"";L' + i + '-M' + i + ')'
    ]);
  }
  h.getRange('M102:N121').setValues(pagos).setNumberFormat('"$"#,##0');

  h.getRange('B101:N118').setNumberFormat('#,##0.##');
  h.getRange('B121:N140').setNumberFormat('#,##0.##');
  h.getRange('K101:K120').setNumberFormat('#,##0.##');
  h.getRange('L101:L120').setNumberFormat('"$"#,##0');
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

  /* Con el respaldo se traen las horas del día. Es el momento adecuado:
     de madrugada, sin nadie usando la app, y leer otra planilla es
     demasiado lento para hacerlo en cada sincronización. */
  try { importarHoras(); } catch (e) { Logger.log('Horas: ' + e); }
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
