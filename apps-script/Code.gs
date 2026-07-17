/* ============================================================
   Bioma · Backend en Google Apps Script
   ------------------------------------------------------------
   Este script debe estar VINCULADO a una planilla de Google
   (crearla dentro de la carpeta de Drive del proyecto y abrir
   Extensiones → Apps Script). Guarda los datos de la app en
   cuatro hojas: movimientos, deudas, borrados y conceptos.

   La app envía su estado local; el script lo fusiona con la
   planilla (gana la versión con `mod` más reciente; la hoja
   "borrados" propaga las eliminaciones a todos los dispositivos)
   y devuelve el estado consolidado en JSON.

   Publicar como Web App:
     Implementar → Nueva implementación → Aplicación web
     · Ejecutar como: Yo
     · Acceso: Cualquier usuario
   ============================================================ */

var COLUMNAS = {
  movimientos: ['id', 'tipo', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'direccion', 'estado', 'mod'],
  borrados: ['id', 'mod'],
  conceptos: ['tipo', 'nombre']
};

function doGet() {
  return salidaJson(leerEstado());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var datos = JSON.parse(e.postData.contents);
    return salidaJson(sincronizar(datos));
  } catch (err) {
    return salidaJson({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function sincronizar(entrada) {
  var estado = leerEstado();

  // 1. Tombstones: unir los locales con los remotos
  var borrados = {};
  estado.borrados.forEach(function (b) { borrados[b.id] = b; });
  (entrada.borrados || []).forEach(function (b) { borrados[b.id] = b; });

  // 2. Fusionar por id: gana el `mod` más reciente; excluir borrados
  var movimientos = fusionar(estado.movimientos, entrada.movimientos || [], borrados);
  var deudas = fusionar(estado.deudas, entrada.deudas || [], borrados);

  // 3. Conceptos: unión de listas
  var conceptos = {
    ingresos: unir(estado.conceptos.ingresos, (entrada.conceptos || {}).ingresos),
    egresos: unir(estado.conceptos.egresos, (entrada.conceptos || {}).egresos)
  };

  // 4. Persistir en la planilla
  escribirHoja('movimientos', movimientos.map(aFila('movimientos')));
  escribirHoja('deudas', deudas.map(aFila('deudas')));
  escribirHoja('borrados', Object.keys(borrados).map(function (id) { return [id, borrados[id].mod]; }));
  var filasConceptos = conceptos.ingresos.map(function (n) { return ['ingresos', n]; })
    .concat(conceptos.egresos.map(function (n) { return ['egresos', n]; }));
  escribirHoja('conceptos', filasConceptos);

  return { movimientos: movimientos, deudas: deudas, conceptos: conceptos, borrados: [] };
}

function fusionar(remotos, locales, borrados) {
  var porId = {};
  remotos.concat(locales).forEach(function (item) {
    if (!item || !item.id || borrados[item.id]) return;
    var previo = porId[item.id];
    if (!previo || (item.mod || 0) > (previo.mod || 0)) porId[item.id] = item;
  });
  return Object.keys(porId).map(function (id) { return porId[id]; })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

function unir(a, b) {
  var set = {};
  var out = [];
  (a || []).concat(b || []).forEach(function (x) {
    if (x && !set[x]) { set[x] = true; out.push(x); }
  });
  return out;
}

/* ================= Lectura / escritura de hojas ================= */

function hoja(nombre) {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName(nombre);
  if (!h) {
    h = ss.insertSheet(nombre);
    h.appendRow(COLUMNAS[nombre]);
  }
  return h;
}

function leerHoja(nombre) {
  var h = hoja(nombre);
  var valores = h.getDataRange().getValues();
  var cols = COLUMNAS[nombre];
  var filas = [];
  for (var i = 1; i < valores.length; i++) {
    if (!valores[i][0]) continue;
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = normalizar(valores[i][j]);
    filas.push(obj);
  }
  return filas;
}

// Sheets convierte "2026-07-17" en Date; volver siempre a texto YYYY-MM-DD
function normalizar(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function escribirHoja(nombre, filas) {
  var h = hoja(nombre);
  var cols = COLUMNAS[nombre];
  h.clearContents();
  h.appendRow(cols);
  if (filas.length) {
    var rango = h.getRange(2, 1, filas.length, cols.length);
    rango.setNumberFormat('@'); // texto plano: no convertir fechas ni montos
    rango.setValues(filas);
  }
}

function aFila(nombre) {
  var cols = COLUMNAS[nombre];
  return function (obj) {
    return cols.map(function (c) { return obj[c] == null ? '' : obj[c]; });
  };
}

function leerEstado() {
  var movimientos = leerHoja('movimientos').map(function (m) {
    m.monto = Number(m.monto) || 0;
    m.mod = Number(m.mod) || 0;
    return m;
  });
  var deudas = leerHoja('deudas').map(function (d) {
    d.monto = Number(d.monto) || 0;
    d.mod = Number(d.mod) || 0;
    return d;
  });
  var borrados = leerHoja('borrados').map(function (b) {
    b.mod = Number(b.mod) || 0;
    return b;
  });
  var conceptos = { ingresos: [], egresos: [] };
  leerHoja('conceptos').forEach(function (c) {
    if (conceptos[c.tipo]) conceptos[c.tipo].push(c.nombre);
  });
  return { movimientos: movimientos, deudas: deudas, borrados: borrados, conceptos: conceptos };
}

function salidaJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
