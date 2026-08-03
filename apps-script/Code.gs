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

var COLUMNAS = {
  ingresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  egresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'direccion', 'estado', 'mod'],
  borrados: ['id', 'mod']
};

var ENCABEZADOS = {
  ingresos: ['id', 'fecha', 'punto de venta', 'monto', 'observaciones', 'mod'],
  egresos: ['id', 'fecha', 'concepto', 'monto', 'observaciones', 'mod'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado', 'mod'],
  borrados: ['id', 'mod'],
  conceptos: ['ingresos', 'egresos']
};

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
    return salidaJson_(leerEstado_());
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

  // La hoja "conceptos" es la fuente de verdad; la app solo aporta
  // los agregados con "+ agregar nuevo…", que se anexan al final.
  var conceptos = {
    ingresos: unir_(estado.conceptos.ingresos, (entrada.conceptos || {}).ingresos),
    egresos: unir_(estado.conceptos.egresos, (entrada.conceptos || {}).egresos)
  };

  escribirDatos_('ingresos', movimientos.filter(function (m) { return m.tipo !== 'egreso'; }));
  escribirDatos_('egresos', movimientos.filter(function (m) { return m.tipo === 'egreso'; }));
  escribirDatos_('deudas', deudas);
  escribirBorrados_(borrados);
  escribirConceptos_(conceptos);

  return { movimientos: movimientos, deudas: deudas, conceptos: conceptos, borrados: [] };
}

function fusionar_(remotos, locales, borrados) {
  var porId = {};
  remotos.concat(locales).forEach(function (item) {
    if (!item || !item.id || borrados[item.id]) return;
    var previo = porId[item.id];
    if (!previo || (item.mod || 0) > (previo.mod || 0)) porId[item.id] = item;
  });
  return Object.keys(porId).map(function (id) { return porId[id]; })
    .sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
}

function unir_(a, b) {
  var visto = {}, out = [];
  (a || []).concat(b || []).forEach(function (x) {
    if (x && !visto[x]) { visto[x] = true; out.push(x); }
  });
  return out;
}

/* ================= Lectura ================= */

function leerEstado_() {
  var movimientos = leerDatos_('ingresos', 'ingreso').concat(leerDatos_('egresos', 'egreso'));
  return {
    movimientos: movimientos,
    deudas: leerDatos_('deudas', null),
    borrados: leerBorrados_(),
    conceptos: leerConceptos_()
  };
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
  if (props.getProperty('esquema') === 'v2') return;
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

  props.setProperty('esquema', 'v2');
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

  h.getRange('A3:B7').setValues([
    ['Ingresos totales', '=SUM(ingresos!D2:D)'],
    ['Egresos totales', '=SUM(egresos!D2:D)'],
    ['Balance', '=B3-B4'],
    ['Debemos (pendiente)', '=SUMIFS(deudas!E2:E,deudas!G2:G,"pendiente",deudas!F2:F,"debemos")'],
    ['Nos deben (pendiente)', '=SUMIFS(deudas!E2:E,deudas!G2:G,"pendiente",deudas!F2:F,"nos deben")']
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

  h.getRange('A10').setFormula('=QUERY(ingresos!C2:D,"select C, sum(D) where C is not null group by C order by sum(D) desc label C \'punto de venta\', sum(D) \'total\'",0)');
  h.getRange('D10').setFormula('=QUERY(egresos!C2:D,"select C, sum(D) where C is not null group by C order by sum(D) desc label C \'concepto\', sum(D) \'total\'",0)');
  h.getRange('G10').setFormula('=QUERY({ARRAYFORMULA(IF(ingresos!B2:B="","",TEXT(ingresos!B2:B,"yyyy-mm"))),ingresos!D2:D},"select Col1, sum(Col2) where Col1<>\'\' group by Col1 order by Col1 desc label Col1 \'mes\', sum(Col2) \'total\'",0)');
  h.getRange('J10').setFormula('=QUERY({ARRAYFORMULA(IF(egresos!B2:B="","",TEXT(egresos!B2:B,"yyyy-mm"))),egresos!D2:D},"select Col1, sum(Col2) where Col1<>\'\' group by Col1 order by Col1 desc label Col1 \'mes\', sum(Col2) \'total\'",0)');
  h.getRange('M10').setFormula('=QUERY(deudas!C2:G,"select C, sum(E) where G=\'pendiente\' and C is not null group by C order by sum(E) desc label C \'persona\', sum(E) \'pendiente\'",0)');

  ['B10:B', 'E10:E', 'H10:H', 'K10:K', 'N10:N'].forEach(function (r) {
    h.getRange(r).setNumberFormat('"$"#,##0');
  });
  ['A', 'D', 'G', 'J', 'M'].forEach(function (c) {
    h.setColumnWidth(h.getRange(c + '1').getColumn(), 170);
  });
}

/* ================= Salida ================= */

function salidaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
