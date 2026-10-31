/* ============================================================
   Stock de proveedores · Bioma — el script de la planilla de Nati
   (31/10/2026)

   Vive DENTRO de la planilla «Stock de proveedores · Bioma» (Extensiones →
   Apps Script), en un proyecto propio. No es bioma-db: Nati no puede tener la
   dirección de Code.gs, que escribe toda la economía. Lo peor que se puede
   hacer con la dirección de ESTE script es cargar stock de proveedores.

   Sirve una página (Pagina.html) donde Nati anota, los viernes, cuánto ofrece
   cada proveedor para la tienda del lunes. La página se adapta: en el celular
   es una lista de proveedores y, al tocar uno, sus productos; en la notebook
   las dos cosas lado a lado.

   Hojas (las crea `prepararHojas` si faltan):
     Proveedores  uno por fila; Activo = No lo saca de la página
     Productos    lo que ofrece cada proveedor: nombre del catálogo de AMA
                  Economía, presentación + unidad (qué es UNA unidad) y precio
     Stock        lo escribe la página: una fila por semana + producto
     Consultas    lo escribe la página: cómo terminó cada proveedor esa semana

   La semana se nombra por su VIERNES (el día del relevamiento), en texto
   aaaa-mm-dd. Se guarda con formato de texto puesto ANTES de escribir: al
   revés, la planilla la convierte en fecha (pasó en bioma-db con los meses).

   AMA Economía lee esta planilla directo (openById desde bioma-db), así que
   los encabezados de Stock y Consultas son parte del contrato: no cambiarlos
   sin cambiar `stockSemana_` en Code.gs.

   Instalación: ver LEEME.md en esta carpeta.
   ============================================================ */

var TZ = 'America/Argentina/Buenos_Aires';

var HOJAS = {
  proveedores: { nombre: 'Proveedores',
    encabezados: ['Proveedor', 'Rubro', 'Contacto', 'Teléfono', 'Activo', 'Notas'] },
  productos: { nombre: 'Productos',
    encabezados: ['Proveedor', 'Producto', 'Presentación', 'Unidad', 'Precio', 'Activo', 'Notas'] },
  stock: { nombre: 'Stock',
    encabezados: ['Semana', 'Proveedor', 'Producto', 'Presentación', 'Unidad', 'Cantidad', 'Precio', 'Cargado'] },
  consultas: { nombre: 'Consultas',
    encabezados: ['Semana', 'Proveedor', 'Estado', 'Nota', 'Cargado'] }
};

var ESTADOS = ['ofrece', 'no ofrece'];

/* ================= Puntos de entrada ================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Pagina')
    .setTitle('Stock de proveedores · Bioma')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock')
    .addItem('Abrir la página de carga', 'abrirPagina')
    .addItem('Preparar las hojas', 'prepararHojas')
    .addToUi();
}

// Un enlace a la página desde la planilla misma. Sin implementar todavía, avisa.
function abrirPagina() {
  var url = ScriptApp.getService().getUrl();
  var html = url
    ? '<p style="font:15px sans-serif">La página de carga:</p>' +
      '<p style="font:15px sans-serif"><a href="' + url + '" target="_blank">Abrir</a></p>' +
      '<p style="font:13px sans-serif;color:#666">Ese enlace es el que se le pasa a Nati.</p>'
    : '<p style="font:15px sans-serif">Todavía no está implementada: Implementar → ' +
      'Nueva implementación → Aplicación web.</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(360).setHeight(160),
    'Stock de proveedores');
}

// Crea las hojas que falten con sus encabezados. No toca las que ya existen.
function prepararHojas() {
  var libro = SpreadsheetApp.getActive();
  Object.keys(HOJAS).forEach(function (k) {
    var def = HOJAS[k];
    var hoja = libro.getSheetByName(def.nombre);
    if (!hoja) {
      hoja = libro.insertSheet(def.nombre);
      hoja.getRange(1, 1, 1, def.encabezados.length).setValues([def.encabezados]).setFontWeight('bold');
      hoja.setFrozenRows(1);
    }
  });
  ['stock', 'consultas'].forEach(function (k) {
    libro.getSheetByName(HOJAS[k].nombre).getRange('A:A').setNumberFormat('@');
  });
}

/* ================= Lo que pide la página ================= */

/* Todo lo que la página necesita para una semana: los proveedores activos, con
   sus productos, lo que ya se cargó esta semana y lo de la semana anterior (para
   que Nati tenga la referencia, como en el cuaderno). */
function datos(semanaPedida) {
  var semana = esSemana_(semanaPedida) ? semanaPedida : semanaDe_(hoy_());
  var anterior = sumarDias_(semana, -7);

  var provs = leer_(HOJAS.proveedores).filter(activo_);
  var prods = leer_(HOJAS.productos).filter(activo_);

  var esta = {}, previa = {};
  leer_(HOJAS.stock).forEach(function (f) {
    var s = textoFecha_(f['Semana']);
    if (s === semana) esta[claveFila_(f)] = f;
    else if (s === anterior) previa[claveFila_(f)] = f;
  });
  var consultas = {};
  leer_(HOJAS.consultas).forEach(function (f) {
    if (textoFecha_(f['Semana']) === semana) consultas[clave_(f['Proveedor'])] = f;
  });

  return {
    semana: semana,
    anterior: anterior,
    hoy: hoy_(),
    proveedores: provs.map(function (p) {
      var c = consultas[clave_(p['Proveedor'])];
      return {
        nombre: texto_(p['Proveedor']),
        rubro: texto_(p['Rubro']),
        contacto: texto_(p['Contacto']),
        telefono: texto_(p['Teléfono']),
        notas: texto_(p['Notas']),
        estado: c ? texto_(c['Estado']) : '',
        nota: c ? texto_(c['Nota']) : '',
        productos: prods.filter(function (x) { return clave_(x['Proveedor']) === clave_(p['Proveedor']); })
          .map(function (x) {
            var k = claveFila_(x);
            var e = esta[k], a = previa[k];
            return {
              producto: texto_(x['Producto']),
              presentacion: numeroOVacio_(x['Presentación']),
              unidad: texto_(x['Unidad']),
              // El precio de esta semana si ya se cargó; si no, el de la lista.
              precio: e && numeroOVacio_(e['Precio']) !== '' ? numeroOVacio_(e['Precio'])
                                                               : numeroOVacio_(x['Precio']),
              cantidad: e ? numeroOVacio_(e['Cantidad']) : '',
              anterior: a ? numeroOVacio_(a['Cantidad']) : ''
            };
          })
      };
    })
  };
}

/* Guarda lo de UN proveedor para una semana. Pedido:
     { semana, proveedor, estado: 'ofrece' | 'no ofrece', nota,
       filas: [{ producto, presentacion, unidad, cantidad, precio }] }
   Cada producto tiene UNA fila por semana: volver a guardar la corrige, no
   suma otra. Un casillero vacío no escribe nada nuevo, pero si esa semana ya
   tenía cantidad, la deja en 0 (Nati la borró: ya no lo ofrece).
   Un precio distinto al de la lista también corrige la lista (hoja Productos):
   es el precio que el proveedor pide ahora, y así aparece la semana que viene. */
function guardar(pedido) {
  pedido = pedido || {};
  var semana = pedido.semana;
  if (!esSemana_(semana)) throw new Error('La semana tiene que ser un viernes (aaaa-mm-dd).');
  var estado = ESTADOS.indexOf(pedido.estado) >= 0 ? pedido.estado : 'ofrece';
  var provs = leer_(HOJAS.proveedores);
  var prov = provs.filter(function (p) { return clave_(p['Proveedor']) === clave_(pedido.proveedor); })[0];
  if (!prov) throw new Error('No existe el proveedor «' + pedido.proveedor + '» en la hoja Proveedores.');
  var nombre = texto_(prov['Proveedor']);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ahora = new Date();
    var filas = (pedido.filas || []).map(function (f) {
      return {
        'Proveedor': nombre, 'Producto': texto_(f.producto),
        'Presentación': numeroOVacio_(f.presentacion), 'Unidad': texto_(f.unidad),
        'Cantidad': estado === 'no ofrece' ? 0 : numeroOVacio_(f.cantidad),
        'Precio': numeroOVacio_(f.precio)
      };
    }).filter(function (f) { return f['Producto']; });

    // --- Stock: corregir lo que ya estaba, agregar lo nuevo ---
    var hs = hoja_(HOJAS.stock);
    var col = columnas_(hs, HOJAS.stock);
    var existentes = leerConFila_(hs, HOJAS.stock);
    var donde = {};
    existentes.forEach(function (f) {
      if (textoFecha_(f['Semana']) === semana) donde[claveFila_(f)] = f._fila;
    });
    var nuevas = [];
    filas.forEach(function (f) {
      var fila = donde[claveFila_(f)];
      if (fila) {
        // Ya estaba: la cantidad y el precio se corrigen, vacío pasa a 0.
        hs.getRange(fila, col['Cantidad']).setValue(f['Cantidad'] === '' ? 0 : f['Cantidad']);
        hs.getRange(fila, col['Precio']).setValue(f['Precio']);
        hs.getRange(fila, col['Cargado']).setValue(ahora);
      } else if (f['Cantidad'] !== '' && f['Cantidad'] > 0) {
        nuevas.push(HOJAS.stock.encabezados.map(function (c) {
          return c === 'Semana' ? semana : c === 'Cargado' ? ahora : f[c];
        }));
      }
    });
    agregar_(hs, nuevas);

    // --- Productos: el precio nuevo queda en la lista ---
    var hp = hoja_(HOJAS.productos);
    var colp = columnas_(hp, HOJAS.productos);
    var prods = leerConFila_(hp, HOJAS.productos);
    filas.forEach(function (f) {
      if (f['Precio'] === '' || !(f['Precio'] > 0)) return;
      var p = prods.filter(function (x) { return claveFila_(x) === claveFila_(f); })[0];
      if (p && numeroOVacio_(p['Precio']) !== f['Precio']) {
        hp.getRange(p._fila, colp['Precio']).setValue(f['Precio']);
      }
    });

    // --- Consultas: una fila por proveedor y semana ---
    var hc = hoja_(HOJAS.consultas);
    var colc = columnas_(hc, HOJAS.consultas);
    var c = leerConFila_(hc, HOJAS.consultas).filter(function (x) {
      return textoFecha_(x['Semana']) === semana && clave_(x['Proveedor']) === clave_(nombre);
    })[0];
    var nota = texto_(pedido.nota).slice(0, 500);
    if (c) {
      hc.getRange(c._fila, colc['Estado']).setValue(estado);
      hc.getRange(c._fila, colc['Nota']).setValue(nota);
      hc.getRange(c._fila, colc['Cargado']).setValue(ahora);
    } else {
      agregar_(hc, [HOJAS.consultas.encabezados.map(function (k) {
        return { 'Semana': semana, 'Proveedor': nombre, 'Estado': estado, 'Nota': nota, 'Cargado': ahora }[k];
      })]);
    }
  } finally {
    lock.releaseLock();
  }
  return datos(semana);
}

/* ================= Herramientas =================
   Se leen las hojas por ENCABEZADO, no por posición: si Martín agrega o mueve
   una columna en Proveedores o Productos, nada se rompe. */

function hoja_(def) {
  var h = SpreadsheetApp.getActive().getSheetByName(def.nombre);
  if (!h) throw new Error('Falta la hoja «' + def.nombre + '»: menú Stock → Preparar las hojas.');
  return h;
}

// Número de columna (desde 1) de cada encabezado esperado.
function columnas_(hoja, def) {
  var ultima = Math.max(hoja.getLastColumn(), 1);
  var cab = hoja.getRange(1, 1, 1, ultima).getValues()[0].map(clave_);
  var col = {};
  def.encabezados.forEach(function (e) {
    var i = cab.indexOf(clave_(e));
    if (i < 0) throw new Error('A la hoja «' + def.nombre + '» le falta la columna «' + e + '».');
    col[e] = i + 1;
  });
  return col;
}

function leerConFila_(hoja, def) {
  var col = columnas_(hoja, def);
  var n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  var ancho = Math.max(hoja.getLastColumn(), 1);
  return hoja.getRange(2, 1, n, ancho).getValues().map(function (v, i) {
    var o = { _fila: i + 2 };
    def.encabezados.forEach(function (e) { o[e] = v[col[e] - 1]; });
    return o;
  });
}

function leer_(def) {
  var h = SpreadsheetApp.getActive().getSheetByName(def.nombre);
  return h ? leerConFila_(h, def).filter(function (o) {
    return def.encabezados.some(function (e) { return texto_(o[e]) !== ''; });
  }) : [];
}

// Agrega filas al final, con la columna Semana en texto ANTES de escribir.
function agregar_(hoja, filas) {
  if (!filas.length) return;
  var desde = hoja.getLastRow() + 1;
  if (desde + filas.length - 1 > hoja.getMaxRows()) {
    hoja.insertRowsAfter(hoja.getMaxRows(), filas.length + 50);
  }
  hoja.getRange(desde, 1, filas.length, 1).setNumberFormat('@');
  hoja.getRange(desde, 1, filas.length, filas[0].length).setValues(filas);
}

function activo_(o) { return clave_(o['Activo']) !== 'no' && texto_(o['Proveedor']) !== ''; }

function texto_(v) { return v == null ? '' : String(v).trim(); }

// Sin tildes ni mayúsculas ni espacios de más: "Acelga " y "acelga" son lo mismo.
function clave_(v) {
  return texto_(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

function numeroOVacio_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return v;
  var n = Number(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return isNaN(n) || String(v).trim() === '' ? '' : n;
}

// Un producto de un proveedor: "Miel 500 g" y "Miel 1 kg" son dos.
function claveFila_(o) {
  return [clave_(o['Proveedor']), clave_(o['Producto']),
          String(numeroOVacio_(o['Presentación'])), clave_(o['Unidad'])].join('|');
}

function textoFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return texto_(v);
}

function hoy_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function aFecha_(t) {
  var p = t.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12); // al mediodía: el horario de verano no lo corre de día
}

function sumarDias_(t, n) {
  var d = aFecha_(t);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* El viernes al que pertenece un día. El relevamiento es el viernes, pero se
   termina el sábado y alguna llamada se adelanta el jueves: de sábado a
   miércoles cuenta el viernes anterior; el jueves, ya el que viene. */
function semanaDe_(t) {
  var dia = aFecha_(t).getDay(); // 0 domingo … 5 viernes
  var corrimiento = { 5: 0, 6: -1, 0: -2, 1: -3, 2: -4, 3: -5, 4: 1 }[dia];
  return sumarDias_(t, corrimiento);
}

function esSemana_(t) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(t || '')) && aFecha_(t).getDay() === 5;
}
