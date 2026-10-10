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
     · pagos, cuentas  (SOLO LECTURA: las rehace el script con los egresos
                  de sueldos y la hoja horas; ver escribirCuentasYPagos_)
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
var API = 12; // 9: action 'proyeccion' · 10: presentación al público · 11: escribe por cambios
           // 12: no repite las listas que la app ya tiene (firmas)

/* Cuántos renglones de venta viaja la app. La hoja las guarda todas; el
   teléfono solo necesita las últimas para mostrarlas y poder corregirlas.
   Sin este tope, una temporada entera viajaría en cada sincronización. */
var VENTANA_VENTAS = 300;

var COLUMNAS = {
  ingresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod'],
  /* "persona" va al final (agregarla en el medio correría las columnas ya
     escritas). Se usa al liquidar horas: un egreso con concepto "sueldos"
     dice a quién se le pagó, y con eso sale el saldo de cada trabajador. */
  /* "medio" y "periodo" (07/10) también al final, por lo mismo: se llenan al
     pagar sueldos. Medio: efectivo, transferencia u otro. Periodo: hasta qué
     día cubre las horas ese pago (aaaa-mm-dd). */
  egresos: ['id', 'fecha', 'concepto', 'monto', 'obs', 'mod', 'persona', 'medio', 'periodo'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'direccion', 'estado', 'mod'],
  // Solo se carga el precio de chacra; los otros tres quedan vacíos y los
  // calcula la app con el porcentaje de la hoja "listas". Escribir un valor
  // en comarca/bariloche/verduleria fija ese precio y rompe el porcentaje.
  // "categoria" va al final a propósito: agregarla en el medio correría
  // todas las columnas de las filas ya escritas y las leería mal.
  productos: ['id', 'nombre', 'unidad', 'presentacion', 'chacra',
              'comarca', 'bariloche', 'verduleria', 'activo', 'mod',
              'categoria', 'sku', 'publico'],
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
  egresos: ['id', 'fecha', 'concepto', 'monto', 'observaciones', 'mod', 'persona',
            'medio de pago', 'horas hasta'],
  deudas: ['id', 'fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado', 'mod'],
  productos: ['id', 'producto', 'unidad', 'presentación', 'precio chacra',
              'comarca (fijo)', 'bariloche (fijo)', 'verdulerías (fijo)',
              'activo', 'mod', 'categoría', 'SKU', 'al público (kg)'],
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
    estado.horas = resumirHoras_();
    estado.trabajadores = trabajadores_();
    /* Diagnóstico: qué hojas hay, qué versión de esquema corrió y cuántas
       filas tiene cada cosa. Sin esto no se puede saber desde afuera si el
       código desplegado es el actual, y se diagnostica a ciegas. */
    estado.diag = diagnostico_();
    return salidaJson_(estado);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  /* La proyección no toca ninguna hoja: va antes del candado, así no hace
     esperar a una sincronización ni la espera. */
  try {
    var pedido = JSON.parse(e.postData.contents);
    if (pedido && pedido.action === 'proyeccion') {
      return salidaJson_(proyeccion_(!!pedido.refrescar));
    }
  } catch (err) {
    return salidaJson_({ error: String(err) });
  }

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
  NORMALIZAR_ = [];
  var estado = leerEstado_();
  // Lo cargado a mano en la planilla (sin id, con la fecha como texto) se
  // guarda ya normalizado en su propio renglón: ver persistirNormalizados_.
  var normalizados = persistirNormalizados_();

  var borrados = {};
  estado.borrados.forEach(function (b) { borrados[b.id] = b; });
  var tumbasNuevas = [];
  (entrada.borrados || []).forEach(function (b) {
    if (!b || !b.id) return;
    if (!borrados[b.id]) tumbasNuevas.push(b);
    borrados[b.id] = b;
  });

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

  /* Escritura por cambios (API 11, 01/10). Hasta acá se borraba cada hoja y
     se la volvía a escribir entera en cada sincronización: lento, cada vez
     más con cada venta, y peligroso. Si el script se cortaba entre el borrado
     y la escritura (el límite de 6 minutos de Apps Script, un error de
     Google), la hoja quedaba vacía; movimientos y deudas se recuperaban del
     teléfono, pero las ventas viejas no, porque el teléfono guarda solo las
     últimas 300. Ahora se agrega lo nuevo, se cambia el renglón que tiene un
     mod más nuevo y se borra el que tiene tumba: nunca se vacía una hoja.

     La respuesta no cambia: sigue siendo la fusión de la planilla con lo que
     llegó (fusionar_, arriba), que es justamente lo que queda escrito. */
  var entrantes = entrada.movimientos || [];
  var ing = entrantes.filter(function (m) { return m && m.tipo !== 'egreso'; });
  var egr = entrantes.filter(function (m) { return m && m.tipo === 'egreso'; });
  var cambiosIng = guardarCambios_('ingresos', ing, borrados, modsPorId_(egr));
  var cambiosEgr = guardarCambios_('egresos', egr, borrados, modsPorId_(ing));
  var cambiosMov = cambiosIng + cambiosEgr;
  guardarCambios_('deudas', entrada.deudas || [], borrados, {});
  guardarCambios_('productos', entrada.productos || [], borrados, {});
  guardarCambios_('ventas', entrada.ventas || [], borrados, {});
  agregarBorrados_(tumbasNuevas);
  if (JSON.stringify(conceptos) !== JSON.stringify(estado.conceptos)) escribirConceptos_(conceptos);
  // El flujo y los gráficos solo cambian si cambió algún ingreso o egreso.
  if (cambiosMov || normalizados.ingresos || normalizados.egresos) {
    actualizarFlujo_(movimientos);
    actualizarGraficos_();
  }
  // Un pago nuevo o corregido cambia las cuentas de los trabajadores.
  if (cambiosEgr || normalizados.egresos) escribirCuentasYPagos_();

  // Se devuelve la lista completa de tumbas: la app la necesita para saber
  // qué borrar de su copia local sin tener que confiar ciegamente en que
  // "lo que no vino en la respuesta hay que borrarlo".
  var listaBorrados = Object.keys(borrados).map(function (id) {
    return { id: id, mod: borrados[id].mod };
  });
  var salida = {
    api: API,
    ventasTotal: ventas.length,
    horas: resumirHoras_(),
    trabajadores: trabajadores_(),
    conceptos: conceptos,
    listas: estado.listas,
    firmas: {},
    sinCambios: []
  };
  /* Las listas grandes viajan solo si cambiaron (API 12, 01/10). Antes cada
     sincronización devolvía todo —con tres temporadas, ~450 KB, 350 de ellos
     movimientos— aunque nadie hubiera tocado nada: al abrir la app y después
     de cada cosa guardada, por datos móviles. Ahora va con cada lista su
     firma (firmaDe_); la app la devuelve la vez siguiente, y si la lista da
     la misma firma se contesta "sin cambios" en vez de mandarla.

     La firma mira el renglón entero, no solo el mod: una corrección hecha a
     mano en la planilla no cambia el mod y tiene que llegar igual a la app. */
  /* También se mira cómo estaba cada lista ANTES de este pedido: si la firma
     de la app coincide con esa, nadie más tocó nada desde su última
     sincronización, y lo único nuevo es lo que ella misma mandó, que ya
     tiene. Es el caso más común —guardar algo y sincronizar— y sin esto
     volvía la lista de movimientos entera cada vez. */
  var conocidas = entrada.firmas || {};
  var partes = {
    movimientos: [movimientos, estado.movimientos],
    deudas: [deudas, estado.deudas],
    productos: [productos, estado.productos],
    ventas: [ventas.slice(-VENTANA_VENTAS), estado.ventas.slice(-VENTANA_VENTAS)],
    borrados: [listaBorrados, estado.borrados]
  };
  Object.keys(partes).forEach(function (k) {
    var despues = firmaDe_(partes[k][0], k);
    salida.firmas[k] = despues;
    var suya = conocidas[k];
    if (suya && (suya === despues || suya === firmaDe_(partes[k][1], k))) salida.sinCambios.push(k);
    else salida[k] = partes[k][0];
  });
  return salida;
}

/* Los campos que entran en la firma de cada lista, en orden fijo: los de la
   hoja. Así un registro da la misma firma armado por la app o leído de la
   planilla, que guardan los mismos datos con otra forma. */
var CAMPOS_FIRMA = {
  movimientos: ['id', 'tipo', 'fecha', 'concepto', 'monto', 'obs', 'persona', 'mod',
                'medio', 'periodo'],
  deudas: COLUMNAS.deudas,
  productos: COLUMNAS.productos,
  ventas: COLUMNAS.ventas,
  borrados: ['id', 'mod']
};

function textoFirma_(v) {
  if (v == null) return '';
  if (v instanceof Date) return normFecha_(v);
  return String(v);
}

/* Una huella de la lista: cantidad y dos sumas de comprobación de 32 bits
   (FNV-1a y djb2) de los campos de cada registro (CAMPOS_FIRMA), combinadas
   sin importar el orden. Que dos listas distintas den la misma firma es tan improbable que no
   se considera; igual, una vez por día la app pide todo sin firmas. */
function firmaDe_(lista, nombre) {
  var campos = CAMPOS_FIRMA[nombre];
  var a = 0, b = 0;
  for (var i = 0; i < lista.length; i++) {
    var o = lista[i] || {};
    var s = campos.map(function (k) { return textoFirma_(o[k]); }).join('');
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var j = 0; j < s.length; j++) {
      var c = s.charCodeAt(j);
      // h1 × 16777619 (el primo de FNV) con sumas y corrimientos: no depende
      // de Math.imul, que el motor viejo de Apps Script podría no tener.
      h1 = (h1 ^ c) >>> 0;
      h1 = (h1 + (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24)) >>> 0;
      h2 = ((h2 << 5) + h2 + c) >>> 0;
    }
    a = (a + h1) >>> 0;
    b = (b ^ h2) >>> 0;
  }
  return lista.length + '.' + a.toString(36) + '.' + b.toString(36);
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

/* El id de un renglón cargado a mano. Antes era la hora más un contador que
   arrancaba en 0 en cada hoja: un ingreso y un egreso cargados a mano y
   leídos en el mismo milisegundo recibían EL MISMO id, y al juntarlos por id
   uno desaparecía de la planilla (encontrado el 01/10 con la planilla
   simulada). Ahora el contador es uno solo para todo el pedido, con algo de
   azar por si dos pedidos caen en el mismo milisegundo. */
var CONTADOR_MANUAL_ = 0;
function idManual_() {
  return 'man' + Date.now().toString(36) + (CONTADOR_MANUAL_++).toString(36) +
    Math.floor(Math.random() * 1296).toString(36);
}

/* ================= Escritura por cambios ================= */

/* Los renglones cargados a mano que el script tuvo que completar al leerlos:
   sin id, sin mod, con la fecha escrita como texto. Antes quedaban bien
   porque la hoja se reescribía entera; ahora cada uno se escribe en su
   lugar. Sin esto, un renglón sin id recibiría un id distinto en cada
   lectura y volvería de los teléfonos como uno nuevo, duplicado. */
var NORMALIZAR_ = [];

function marcarParaNormalizar_(nombre, filaHoja, obj, idOriginal) {
  NORMALIZAR_.push({ nombre: nombre, fila: filaHoja, obj: obj, id: idOriginal });
}

function persistirNormalizados_() {
  var cuantos = {};
  NORMALIZAR_.forEach(function (n) {
    var h = hoja_(n.nombre);
    // Se confirma que el renglón siga siendo el mismo que se leyó.
    if (String(h.getRange(n.fila, 1).getValue() || '').trim() !== n.id) return;
    h.getRange(n.fila, 1, 1, COLUMNAS[n.nombre].length).setValues([aFila_(n.nombre, n.obj)]);
    cuantos[n.nombre] = (cuantos[n.nombre] || 0) + 1;
  });
  NORMALIZAR_ = [];
  return cuantos;
}

// Un registro como renglón de la hoja, igual que lo escribía escribirDatos_.
function aFila_(nombre, o) {
  return COLUMNAS[nombre].map(function (c) {
    var v = o[c];
    if (c === 'fecha') return fechaADate_(v);
    // Como fecha de verdad: escrita como texto, la planilla la convierte sola
    // en unas filas sí y en otras no (ver escribirHoras_).
    if (c === 'periodo') return v ? fechaADate_(v) : '';
    if (c === 'direccion') return v === 'nos_deben' ? 'nos deben' : 'debemos';
    return v == null ? '' : v;
  });
}

function modsPorId_(lista) {
  var out = {};
  lista.forEach(function (o) {
    if (o && o.id && (!out[o.id] || (o.mod || 0) > out[o.id])) out[o.id] = Number(o.mod) || 0;
  });
  return out;
}

/* Lleva a la hoja lo que llegó, sin tocar lo demás.
   · id nuevo → se agrega al final;
   · id que ya está → se reescribe ese renglón solo si lo que llegó tiene un
     mod más nuevo (lo mismo que decide fusionar_);
   · id con tumba → se borra el renglón;
   · `mudados` (id → mod): los que pasaron a la otra hoja (un ingreso que
     ahora es egreso) se sacan de esta si el cambio es más nuevo.
   Si la hoja tenía el mismo id dos veces (un copiar y pegar a mano), queda
   el de mod más nuevo, como hacía la reescritura.
   Antes de escribir o borrar un renglón se confirma que siga teniendo ese id:
   si alguien insertó filas a mano mientras corría, se lo vuelve a buscar.
   Devuelve cuántos renglones cambió. */
function guardarCambios_(nombre, entrantes, borrados, mudados) {
  var h = hoja_(nombre);
  var cols = COLUMNAS[nombre];
  var ancho = cols.length;
  var iMod = cols.indexOf('mod');
  var ultima = h.getLastRow();
  var valores = ultima > 1 ? h.getRange(2, 1, ultima - 1, ancho).getValues() : [];
  var modDe = function (i) { return Number(valores[i][iMod]) || 0; };

  var filaDe = {}, sacar = {}, ultimaConDatos = -1;
  valores.forEach(function (v, i) {
    if (v.some(function (c) { return c !== '' && c != null; })) ultimaConDatos = i;
    var id = String(v[0] || '').trim();
    if (!id) return;
    if (filaDe[id] !== undefined) {               // repetido: queda el más nuevo
      var otra = filaDe[id];
      if (modDe(i) > modDe(otra)) { sacar[otra] = id; filaDe[id] = i; } else { sacar[i] = id; }
      return;
    }
    filaDe[id] = i;
  });
  Object.keys(filaDe).forEach(function (id) {
    var i = filaDe[id];
    if (borrados[id] || (mudados[id] && mudados[id] > modDe(i))) sacar[i] = id;
  });

  var mejor = {};
  entrantes.forEach(function (o) {
    if (!o || !o.id || borrados[o.id]) return;
    var p = mejor[o.id];
    if (!p || (Number(o.mod) || 0) > (Number(p.mod) || 0)) mejor[o.id] = o;
  });

  var nuevas = [], cambios = 0;
  Object.keys(mejor).forEach(function (id) {
    var o = mejor[id], i = filaDe[id];
    if (i === undefined) { nuevas.push(aFila_(nombre, o)); return; }
    if (sacar[i] !== undefined) return;
    if ((Number(o.mod) || 0) <= modDe(i)) return;            // la hoja ya está igual o más nueva
    var fila = filaVigente_(h, i + 2, id);
    if (!fila) { nuevas.push(aFila_(nombre, o)); return; }   // ya no está: se agrega
    h.getRange(fila, 1, 1, ancho).setValues([aFila_(nombre, o)]);
    cambios++;
  });

  // Se borra de abajo hacia arriba, así los números de fila no se corren.
  var borradas = 0;
  Object.keys(sacar).map(Number).sort(function (a, b) { return b - a; }).forEach(function (i) {
    var fila = filaVigente_(h, i + 2, sacar[i]);
    if (fila) { h.deleteRow(fila); borradas++; }
  });
  if (nuevas.length) {
    // Después del último renglón con datos (no de getLastRow, que cuenta
    // también columnas que alguien haya agregado a la derecha).
    var desde = ultimaConDatos + 3 - borradas;
    if (desde < 2) desde = 2;
    asegurarFilas_(h, desde + nuevas.length - 1);
    h.getRange(desde, 1, nuevas.length, ancho).setValues(nuevas);
  }
  if (nuevas.length || cambios) ordenarHoja_(h, nombre);
  return nuevas.length + cambios + borradas;
}

/* La fila donde está hoy el renglón con ese id: la esperada si sigue ahí,
   y si no se lo busca. 0 si ya no está. */
function filaVigente_(h, filaEsperada, id) {
  if (filaEsperada <= h.getLastRow() &&
      String(h.getRange(filaEsperada, 1).getValue() || '').trim() === id) return filaEsperada;
  var n = h.getLastRow();
  if (n < 2) return 0;
  var ids = h.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) return i + 2;
  }
  return 0;
}

/* El mismo orden que dejaba la reescritura: por fecha (los productos, por
   nombre). Lo hace la planilla, renglones enteros, incluidas las columnas
   que alguien haya agregado a la derecha. */
function ordenarHoja_(h, nombre) {
  var n = h.getLastRow();
  if (n < 3) return;
  var cols = COLUMNAS[nombre];
  var clave = cols.indexOf(nombre === 'productos' ? 'nombre' : 'fecha') + 1;
  if (clave < 1) return;
  var orden = [{ column: clave, ascending: true }];
  var iMod = cols.indexOf('mod') + 1;
  if (iMod > 0) orden.push({ column: iMod, ascending: true });
  h.getRange(2, 1, n - 1, Math.max(h.getLastColumn(), cols.length)).sort(orden);
}

// Las tumbas nuevas, al final de la hoja oculta: las que ya estaban no se tocan.
function agregarBorrados_(lista) {
  if (!lista.length) return;
  var h = hoja_('borrados');
  var filas = lista.map(function (b) { return [b.id, Number(b.mod) || Date.now()]; });
  var desde = h.getLastRow() + 1;
  asegurarFilas_(h, desde + filas.length - 1);
  h.getRange(desde, 1, filas.length, 2).setValues(filas);
}

/* Una hoja tiene una cantidad fija de filas (1000 al crearla) y escribir más
   allá da error. La reescritura de antes reusaba las que había; agregar al
   final puede pasarse, así que primero se agregan las que falten. */
function asegurarFilas_(h, hasta) {
  var hay = h.getMaxRows();
  if (hasta > hay) h.insertRowsAfter(hay, hasta - hay + 100);
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
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    obj.nombre = String(obj.nombre || '').trim();
    if (!obj.nombre) continue; // fila vacía o decorativa

    var idLeido = String(obj.id || '').trim();
    var faltaba = !idLeido || !Number(obj.mod);
    obj.id = idLeido || idManual_();
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
    /* Cuántos kg lleva la unidad que se ofrece al público: 0,5 · 1 · 2,5.
       Cambia en la temporada (repollos más grandes, una oferta), por eso va
       aparte de "presentacion", que identifica al producto y de la que las
       ventas sacan los kilos. Vacío = 1 kg, o el peso del atado. */
    var kgPublico = normMonto_(obj.publico);
    obj.publico = kgPublico > 0 ? kgPublico : '';
    if (faltaba) marcarParaNormalizar_('productos', i + 1, obj, idLeido);
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
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    obj.producto = String(obj.producto || '').trim();
    var fechaEraTexto = !(obj.fecha instanceof Date);
    obj.fecha = normFecha_(obj.fecha);
    obj.cantidad = normMonto_(obj.cantidad);
    if (!obj.producto || (!obj.fecha && !obj.cantidad)) continue;
    if (!obj.fecha) obj.fecha = normFecha_(new Date());

    var idLeido = String(obj.id || '').trim();
    var faltaba = !idLeido || !Number(obj.mod) || fechaEraTexto;
    obj.id = idLeido || idManual_();
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
    if (faltaba) marcarParaNormalizar_('ventas', i + 1, obj, idLeido);
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
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var vacia = v.every(function (c) { return c === '' || c == null; });
    if (vacia) continue;
    var obj = {};
    for (var j = 0; j < cols.length; j++) obj[cols[j]] = v[j];

    var idLeido = String(obj.id || '').trim();
    var faltaba = !idLeido || !Number(obj.mod) || !(obj.fecha instanceof Date) || typeof obj.monto !== 'number';
    obj.id = idLeido || idManual_();
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
      if (tipo === 'egreso') {
        obj.medio = String(obj.medio || '').trim();
        // "Hasta qué día cubre": siempre aaaa-mm-dd, aunque se escriba a mano.
        obj.periodo = obj.periodo ? normFecha_(obj.periodo) : '';
      }
    } else {
      obj.persona = String(obj.persona || '').trim() || 'sin nombre';
      obj.concepto = String(obj.concepto || '');
      obj.direccion = normDireccion_(obj.direccion);
      obj.estado = normEstado_(obj.estado);
    }
    if (faltaba) marcarParaNormalizar_(nombre, i + 1, obj, idLeido);
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
  /* Cada paso corre una sola vez: si la planilla está en una versión
     anterior. Antes se comparaba de a pares ("ni v11 ni v12"), y con la
     planilla ya en v12 casi todos los pasos viejos volvían a correr en CADA
     sincronización: migrarV2_, rearmar la hoja resumen y sus gráficos,
     reestilizar productos y ventas. Encontrado el 28/09. */
  var n = Number(String(version || '').replace(/^v/, '')) || 0;
  if (n < 2) migrarV2_();
  // v5 agrega el catálogo de productos y las listas de precios
  if (n < 5) leerListas_(); // crea y siembra la hoja "listas" si no existía
  // v6 suma a "resumen" las tablas mes a mes y el flujo de fondos
  if (n < 6) repararResumen_();
  // v7 y v8 agregan la categoría y el SKU a los productos
  if (n < 8) estilizarProductos_();
  /* v9 rehace los encabezados de ventas. Al sumar la columna "kg" los datos
     pasaron a escribirse con ella, pero el encabezado seguía siendo el
     anterior: la columna de kilos decía "precio". */
  if (n < 9) estilizarVentas_();
  // v10 rearma la hoja resumen con el diseño compacto
  if (n < 10) { escribirResumen_(); props.deleteProperty('graficos'); }
  /* v11 suma las tablas de horas al resumen; v12 da a los egresos la columna
     "persona" (para liquidar horas) y unifica los conceptos en "sueldos". */
  if (n < 12) {
    estilizarHojaDatos_('egresos', COLOR.tierra, COLOR.tierraClaro);
    escribirResumenHoras_();
  }
  // v13: los productos ganan la presentación al público (kg por unidad)
  if (n < 13) {
    estilizarProductos_();
    props.setProperty('esquema', 'v13');
  }
  /* v14 (07/10): los pagos de sueldos dicen el medio y hasta qué día cubren,
     y aparecen las hojas "pagos" y "cuentas" para leer las liquidaciones. */
  if (n < 14) {
    columnasDePago_();
    escribirCuentasYPagos_();
    props.setProperty('esquema', 'v14');
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
  var iPublico = cols.indexOf('publico') + 1;
  h.getRange(2, iPublico, 499).setNumberFormat('0.###');
  h.setColumnWidth(iPublico, 120);
  h.getRange(1, iPublico).setNote('Cuántos kg lleva la unidad que se vende al público ' +
    '(0,5 · 1 · 2,5). Vacío = 1 kg, o el peso del atado. El precio de esa ' +
    'unidad lo calcula la app con el precio por kg de cada lista.');

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

/* Encabezado de bloque: una barra de color con el título.

   Se deshacen las combinaciones antes de combinar: clearContent() no las
   borra, así que una tabla anterior dejaba celdas combinadas de otro
   ancho y merge() fallaba. Al fallar acá se abortaba toda la función y
   las tablas quedaban vacías, sin título y sin ningún mensaje. */
function bloque_(h, celda, texto, color, ancho) {
  var r = h.getRange(celda);
  var barra = h.getRange(r.getRow(), r.getColumn(), 1, Math.max(ancho, 1));
  try { barra.breakApart(); } catch (e) { /* no estaba combinada */ }
  barra.merge().setValue(texto)
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
  /* Se limpian los gráficos de TODAS las hojas candidatas, no solo de la
     elegida: una versión anterior creó una hoja "gráficos" aparte de la
     "gráficas" del usuario, y quedaron dos con gráficos rotos. Así la que
     sobra queda vacía y se ve que se puede borrar. */
  NOMBRES_GRAFICOS.forEach(function (nombre) {
    var otra = ss.getSheetByName(nombre);
    if (otra) otra.getCharts().forEach(function (c) { otra.removeChart(c); });
  });

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
/* El mes de la hoja "horas" como "aaaa-mm", aunque la planilla lo haya
   convertido en fecha (ver escribirHoras_). Leído a ciegas con String(),
   una fecha daba "Thu Oct 01 2026 00:00:00 GMT-0300…". */
function mesTexto_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(v || '').trim().slice(0, 7);
}

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

/* Tarifa de cada trabajador. NO todos cobran lo mismo: los encargados
   tienen una tarifa distinta a la de los socios. Dar por sentado que
   todos cobran igual daba una diferencia de $50.000 sobre el total.

   La hoja "Configuración — Trabajadores y tarifas" es la fuente
   autorizada. Si no está, se caen a las hojas "Cuenta individual". */
function tarifasPorTrabajador_(libro) {
  var tarifas = {};

  /* Se busca por CONTENIDO, no por el nombre de la hoja: buscar una hoja
     llamada "Configuración" no encontró nada y todos quedaron con la
     tarifa por defecto, inflando el devengado en $50.000.

     Sirve cualquier tabla con un encabezado que diga "trabajador" y otra
     columna que diga "tarifa": debajo, nombre y número.

     "Config" se mira primero: es la fuente (07/10; «Resumen General de
     Horas» tiene una copia por fórmula y antes ganaba por estar adelante).
     "Cambios de tarifa" se saltea: también dice trabajador y tarifa, pero
     son las tarifas viejas, no las de hoy. */
  var hojas = libro.getSheets().filter(function (h) {
    return h.getName() !== HOJA_CAMBIOS_TARIFA;
  });
  hojas.sort(function (a, b) {
    return (b.getName() === 'Config' ? 1 : 0) - (a.getName() === 'Config' ? 1 : 0);
  });
  hojas.forEach(function (h) {
    var v = h.getDataRange().getValues();
    for (var i = 0; i < v.length && i < 40; i++) {
      var colNombre = -1, colTarifa = -1;
      for (var c = 0; c < v[i].length; c++) {
        var celda = normClave_(v[i][c]);
        if (celda.indexOf('trabajador') > -1 && colNombre < 0) colNombre = c;
        if (celda.indexOf('tarifa') > -1 && colTarifa < 0) colTarifa = c;
      }
      /* Tienen que ser columnas distintas: si no, un título como
         "Configuración — Trabajadores y tarifas" se confunde con el
         encabezado, y como se corta en la primera coincidencia nunca se
         llega a la tabla de verdad. */
      if (colNombre < 0 || colTarifa < 0 || colNombre === colTarifa) continue;
      // Encontrado el encabezado: se leen las filas de abajo
      for (var j = i + 1; j < v.length; j++) {
        var quien = String(v[j][colNombre] || '').trim();
        var tarifa = normMonto_(v[j][colTarifa]);
        if (quien && tarifa > 0 && !tarifas[normClave_(quien)]) {
          tarifas[normClave_(quien)] = tarifa;
        }
      }
      break; // una tabla de tarifas por hoja alcanza
    }
  });

  // Las hojas "Cuenta individual" tienen la tarifa en vertical
  libro.getSheets().forEach(function (h) {
    if (h.getName().toLowerCase().indexOf('cuenta individual') < 0) return;
    var v = h.getRange(1, 1, 8, 2).getValues();
    var quien = '', tarifa = 0;
    for (var i = 0; i < v.length; i++) {
      var etiqueta = normClave_(v[i][0]);
      if (etiqueta.indexOf('trabajador') > -1) quien = String(v[i][1]).trim();
      if (etiqueta.indexOf('tarifa') > -1) tarifa = normMonto_(v[i][1]);
    }
    if (quien && tarifa && !tarifas[normClave_(quien)]) {
      tarifas[normClave_(quien)] = tarifa;
    }
  });

  return tarifas;
}

/* ================= Quiénes cobran sueldo (07/10, objetivo 6) =================
   La lista del equipo sale de Config de la planilla de horas: nombre con
   tarifa. Es la oficial (AMA la usa para las horas) y viaja a la app para
   que el pago se ELIJA de ella, nunca se escriba: "Lucas" por "Luqui" abrió
   una cuenta aparte. Las filas genéricas "Operador 10/11/12" son lugares
   libres, no personas: quedan afuera hasta que tengan un nombre.
   Se guarda en las propiedades del documento al importar las horas (de
   madrugada): leer la otra planilla en cada sincronización es lento. */
function trabajadoresDeConfig_(libro) {
  var h = libro.getSheetByName('Config');
  if (!h) return [];
  var v = h.getDataRange().getValues();
  for (var i = 0; i < v.length && i < 40; i++) {
    var colNombre = -1, colTarifa = -1;
    for (var c = 0; c < v[i].length; c++) {
      var celda = normClave_(v[i][c]);
      if (celda.indexOf('trabajador') > -1 && colNombre < 0) colNombre = c;
      if (celda.indexOf('tarifa') > -1 && colTarifa < 0) colTarifa = c;
    }
    // Como en tarifasPorTrabajador_: el título no es el encabezado.
    if (colNombre < 0 || colTarifa < 0 || colNombre === colTarifa) continue;
    var out = [], vistos = {};
    for (var j = i + 1; j < v.length; j++) {
      var quien = String(v[j][colNombre] || '').trim();
      // Sin tarifa no es una persona: es la nota de abajo de la tabla.
      if (!quien || !(normMonto_(v[j][colTarifa]) > 0)) continue;
      if (/^operador\s*\d+$/i.test(quien)) continue;
      if (vistos[normClave_(quien)]) continue;
      vistos[normClave_(quien)] = true;
      out.push(quien);
    }
    return out;
  }
  return [];
}

function trabajadores_() {
  try {
    var t = JSON.parse(PropertiesService.getDocumentProperties().getProperty('trabajadores') || '[]');
    return Array.isArray(t) ? t : [];
  } catch (e) { return []; }
}

/* ================= Tarifas con fecha (07/10, objetivo 5) =================
   Antes, cada importación valuaba TODAS las horas con la tarifa de hoy: un
   aumento reescribía lo devengado de la temporada entera, y las deudas de
   meses ya cerrados crecían solas.

   Ahora cada hora se paga con la tarifa vigente EL DÍA QUE SE TRABAJÓ:
     · Config sigue diciendo la tarifa de hoy. Ahí se cambia, como siempre.
     · La hoja "Cambios de tarifa" (planilla de horas) guarda cada aumento:
       trabajador · desde · tarifa anterior · tarifa nueva · nota.
       "Desde" es el primer día con la tarifa nueva.
     · Una hora anterior al primer cambio de alguien se paga con la "tarifa
       anterior" de ese cambio; entre dos cambios, con la anterior del
       siguiente; después del último, con la de Config.
   Si se cambia Config y no se anota el cambio, pasa lo de antes (se
   recalcula todo con la nueva): el aviso de la importación lo dice. */
var HOJA_CAMBIOS_TARIFA = 'Cambios de tarifa';
var CABECERA_CAMBIOS_TARIFA = ['Trabajador', 'Desde', 'Tarifa anterior ($/h)',
                               'Tarifa nueva ($/h)', 'Nota'];

// "Desde" puede venir como fecha de la planilla, d/m/aaaa o aaaa-mm-dd.
function fechaDesde_(v) {
  var s = String(v || '').trim();
  if (!(v instanceof Date) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return fechaHoras_(v);
}

/* Los cambios de cada persona, del más viejo al más nuevo, y los avisos de
   lo que no cierra. Una fila incompleta NO se usa a medias: se avisa y se
   ignora, porque una tarifa inventada es peor que una que falta. */
function cambiosDeTarifa_(libro, vigentes) {
  var por = {}, avisos = [], n = 0;
  var h = libro.getSheetByName(HOJA_CAMBIOS_TARIFA);
  if (!h || h.getLastRow() < 2) return { por: por, avisos: avisos, n: 0 };

  var v = h.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    var quien = String(v[i][0] || '').trim();
    if (!quien && !v[i][1] && !v[i][2]) continue;          // fila vacía
    var desde = fechaDesde_(v[i][1]);
    var anterior = normMonto_(v[i][2]);
    var nueva = normMonto_(v[i][3]);
    var fila = 'fila ' + (i + 1);
    if (!quien || !desde || !(anterior > 0)) {
      avisos.push(fila + ': falta el trabajador, la fecha "desde" o la tarifa anterior (no se usó)');
      continue;
    }
    var k = normClave_(quien);
    if (!vigentes[k]) avisos.push(fila + ': ' + quien + ' no está en Config');
    (por[k] = por[k] || []).push({ desde: desde, anterior: anterior, nueva: nueva, fila: fila });
    n++;
  }

  Object.keys(por).forEach(function (k) {
    var lista = por[k].sort(function (a, b) { return a.desde.localeCompare(b.desde); });
    for (var j = 0; j < lista.length; j++) {
      var siguiente = lista[j + 1];
      // Lo que rige después de este cambio: la anterior del siguiente o Config.
      var despues = siguiente ? siguiente.anterior : vigentes[k];
      if (lista[j].nueva && despues && lista[j].nueva !== despues) {
        avisos.push(lista[j].fila + ': dice que desde el ' + lista[j].desde + ' cobra $' +
          lista[j].nueva + ', pero ' + (siguiente ? 'el cambio siguiente dice que cobraba $'
          : 'Config dice $') + despues);
      }
    }
  });
  return { por: por, avisos: avisos, n: n };
}

// La tarifa de un día: la "anterior" del primer cambio que todavía no había
// empezado ese día, o la de hoy si ya pasaron todos.
function tarifaDelDia_(vigente, cambios, fecha) {
  for (var i = 0; i < (cambios || []).length; i++) {
    if (fecha < cambios[i].desde) return cambios[i].anterior;
  }
  return vigente;
}

/* Crea la hoja "Cambios de tarifa" en la planilla de horas, vacía y con
   las instrucciones. Se ejecuta A MANO una vez; si ya existe no la toca. */
function prepararCambiosDeTarifa() {
  var libro = SpreadsheetApp.openById(ID_PLANILLA_HORAS);
  if (libro.getSheetByName(HOJA_CAMBIOS_TARIFA)) {
    Logger.log('La hoja "' + HOJA_CAMBIOS_TARIFA + '" ya existe: no se tocó.');
    return;
  }
  var h = libro.insertSheet(HOJA_CAMBIOS_TARIFA);
  h.getRange(1, 1, 1, CABECERA_CAMBIOS_TARIFA.length).setValues([CABECERA_CAMBIOS_TARIFA])
    .setFontWeight('bold').setBackground('#fce8b2');
  h.setFrozenRows(1);
  h.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  h.getRange('C:D').setNumberFormat('"$"#,##0');
  h.setColumnWidth(1, 120);
  h.setColumnWidth(5, 280);
  h.getRange(1, 1).setNote(
    'Cuando cambia la tarifa de alguien:\n' +
    '1) En Config, poné la tarifa NUEVA (como siempre).\n' +
    '2) Acá, una fila: trabajador, desde qué día rige la nueva, cuánto ' +
    'cobraba antes y la nueva.\n' +
    'Así las horas anteriores se siguen pagando con la tarifa vieja. ' +
    'Sin esta fila, el aumento se aplica a toda la temporada.');
  Logger.log('Hoja "' + HOJA_CAMBIOS_TARIFA + '" creada en la planilla de horas.');
}

/* Para cada texto escrito de varias formas ("Frutícola" / "Fruticola"),
   elige una sola: la que más veces aparece. Empate, la primera.
   Devuelve un mapa forma-normalizada -> forma elegida. */
function formasCanonicas_(valores, columnas) {
  var cuenta = {};
  for (var i = 1; i < valores.length; i++) {
    for (var c = 0; c < columnas.length; c++) {
      if (columnas[c] < 0) continue;
      var texto = String(valores[i][columnas[c]] || '').trim();
      if (!texto) continue;
      var k = normClave_(texto);
      if (!cuenta[k]) cuenta[k] = {};
      cuenta[k][texto] = (cuenta[k][texto] || 0) + 1;
    }
  }
  var canon = {};
  Object.keys(cuenta).forEach(function (k) {
    var mejor = '', veces = -1;
    Object.keys(cuenta[k]).forEach(function (forma) {
      if (cuenta[k][forma] > veces) { veces = cuenta[k][forma]; mejor = forma; }
    });
    canon[k] = mejor;
  });
  return canon;
}

/* NOTA: las horas NO se cargan por un formulario de Google, se cargan
   desde MonAgric, que las envía con su propio Apps Script. Hubo acá una
   función que marcaba campos obligatorios en un formulario vinculado:
   se quitó porque no correspondía y podía romper el envío de MonAgric.
   Las validaciones de carga van en MonAgric, no acá. */

/* La hoja donde AMA escribe las horas, buscada por NOMBRE (07/10). Antes
   era "la primera hoja": mover una pestaña bastaba para importar otra cosa
   sin aviso, y la planilla tiene también «Registro Horas», «Resumen
   General» y «Config». Es el mismo criterio que usa el Code.gs de AMA. */
function hojaDeRespuestas_(libro) {
  var hojas = libro.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (hojas[i].getName().indexOf('Respuestas de formulario') === 0) return hojas[i];
  }
  return hojas[0];
}

function importarHoras() {
  var libro = SpreadsheetApp.openById(ID_PLANILLA_HORAS);
  var origen = hojaDeRespuestas_(libro);
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
  var cambios = cambiosDeTarifa_(libro, tarifas);
  /* La lista del equipo para elegir a quién se le paga. Si Config no se
     pudo leer, se conserva la anterior: una lista vacía dejaría a la app
     sin a quién pagarle. */
  var equipo = trabajadoresDeConfig_(libro);
  if (equipo.length) {
    PropertiesService.getDocumentProperties().setProperty('trabajadores', JSON.stringify(equipo));
  }
  /* Las áreas y los nombres se escriben a mano en un formulario: tarde o
     temprano aparece "Fruticola" sin tilde junto a "Frutícola", o "marto"
     junto a "Marto", y los totales se parten en dos. Ya nos pasó con los
     conceptos. Se unifican antes de guardar: gana la forma más usada. */
  var canon = formasCanonicas_(valores, [iArea, iQuien]);
  var unificar = function (texto) {
    return canon[normClave_(texto)] || String(texto || '').trim();
  };

  var filas = [], sinFecha = 0, sinArea = 0, sinActividad = 0;
  for (var i = 1; i < valores.length; i++) {
    var f = valores[i];
    var quien = unificar(f[iQuien]);
    var horas = normMonto_(f[iHoras]);
    if (!quien || !horas) continue;

    var fecha = fechaHoras_(f[iFecha]);
    if (!fecha) { sinFecha++; continue; }   // sin fecha no se puede imputar al mes
    var area = iArea > -1 ? unificar(f[iArea]) : '';
    if (!area) { area = 'sin área'; sinArea++; }

    var actividad = iAct > -1 ? unificar(f[iAct]) : '';
    if (!actividad) { actividad = 'sin actividad'; sinActividad++; }

    // La tarifa del día trabajado, no la de hoy (ver cambiosDeTarifa_)
    var k = normClave_(quien);
    var tarifa = tarifaDelDia_(tarifas[k] || TARIFA_POR_DEFECTO, cambios.por[k], fecha);
    filas.push([
      fecha, fecha.slice(0, 7), quien, horas,
      actividad,
      area,
      tarifa,
      horas * tarifa,
      iObs > -1 ? String(f[iObs] || '').trim() : ''
    ]);
  }

  filas.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  escribirHoras_(filas);
  escribirResumenHoras_();
  // Horas nuevas cambian lo devengado de cada uno.
  escribirCuentasYPagos_();

  var devengado = 0;
  filas.forEach(function (f) { devengado += f[7]; });
  var conTarifa = Object.keys(tarifas).length;

  var aviso = filas.length + ' registros importados · $' +
    Math.round(devengado).toLocaleString('es-AR') + ' devengados';
  aviso += ' · tarifas encontradas para ' + conTarifa + ' personas';
  aviso += equipo.length ? ' · equipo para pagos: ' + equipo.join(', ')
                         : ' · ⚠ no se pudo leer el equipo de Config (quedó la lista anterior)';
  if (!conTarifa) {
    aviso += ' (¡ninguna! se usó $' + TARIFA_POR_DEFECTO + ' para todos)';
  }
  if (cambios.n) aviso += ' · ' + cambios.n + ' cambios de tarifa aplicados por fecha';
  if (cambios.avisos.length) {
    aviso += ' · ⚠ CAMBIOS DE TARIFA: ' + cambios.avisos.join(' / ');
  }
  if (sinFecha) aviso += ' · ' + sinFecha + ' sin fecha entendible (quedaron afuera)';
  if (sinArea) aviso += ' · ⚠ ' + sinArea + ' SIN ÁREA';
  if (sinActividad) aviso += ' · ⚠ ' + sinActividad + ' SIN ACTIVIDAD';
  if (!sinArea && !sinActividad) aviso += ' · todos con área y actividad ✓';

  // Se escribe en el registro: ejecutada a mano, el valor devuelto no se ve
  Logger.log(aviso);
  Logger.log('Tarifas: ' + JSON.stringify(tarifas));
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
    var mes = mesTexto_(v[i][1]);
    var quien = String(v[i][2] || '');
    var act = String(v[i][4] || '').trim() || 'sin actividad';
    var area = String(v[i][5] || '');
    if (!mes || !quien) continue;
    var k = mes + '|' + quien + '|' + area + '|' + act;
    if (!acum[k]) {
      acum[k] = { mes: mes, trabajador: quien, area: area, actividad: act, horas: 0, devengado: 0 };
    }
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
    /* Fecha y mes como TEXTO, y el formato va ANTES de escribir. Al revés,
       la planilla convertía "2026-10" en una fecha en las filas nuevas (las
       que pasaban del largo de la importación anterior, que conservaban el
       formato viejo), el resumen económico las descartaba por no caer en la
       temporada y en la cuenta de Tomi aparecía un mes llamado
       "Thu Oct 01 2026…" (07/10: 8 horas que faltaban). */
    h.getRange(2, 1, filas.length, 2).setNumberFormat('@');
    h.getRange(2, 1, filas.length, 9).setValues(filas);
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

/* Tablas de horas en la hoja "resumen".

   Las calcula el script y escribe los números, en vez de dejar fórmulas
   QUERY. Ya es la tercera vez que un QUERY falla en esta planilla (las
   fórmulas en inglés, el flujo de fondos, y ahora estas) y el modo de
   fallar siempre es el peor: la tabla queda vacía sin decir por qué, y
   hay que descubrirlo preguntando. Los datos ya están leídos acá: que
   los escriba.

   Lo único que queda como fórmula es lo pagado (SUMIFS sobre egresos) y
   el saldo, porque tienen que cambiar solos cuando se registra un pago.
   ============================================================ */
function escribirResumenHoras_() {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName('resumen');
  if (!h) return;
  var datos = leerHojaHoras_();

  /* breakApart además de clearContent: las combinaciones sobreviven al
     borrado y hacen fallar el merge de la tabla siguiente. */
  var zona = h.getRange('A100:N175');
  try { zona.breakApart(); } catch (e) { /* nada combinado */ }
  zona.clearContent();

  pivotHoras_(h, 'A100', 'HORAS POR TRABAJADOR · MES A MES', datos, 'trabajador');
  pivotHoras_(h, 'A120', 'HORAS POR ÁREA · MES A MES', datos, 'area');
  areaYActividad_(h, 'A140', datos);
  liquidacionHoras_(h, datos);
}

// Los renglones de la hoja "horas", ya normalizados por importarHoras
function leerHojaHoras_() {
  var h = SpreadsheetApp.getActive().getSheetByName('horas');
  if (!h || h.getLastRow() < 2) return [];
  var v = h.getRange(2, 1, h.getLastRow() - 1, 8).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (!v[i][2]) continue;
    out.push({
      mes: mesTexto_(v[i][1]),
      trabajador: String(v[i][2] || ''),
      horas: Number(v[i][3]) || 0,
      actividad: String(v[i][4] || '').trim() || 'sin actividad',
      area: String(v[i][5] || 'sin área'),
      tarifa: Number(v[i][6]) || 0,
      devengado: Number(v[i][7]) || 0
    });
  }
  return out;
}

/* Una tabla con los meses en las columnas y las personas (o las áreas)
   en las filas, más una columna de total. */
function pivotHoras_(h, celda, titulo, datos, campo) {
  var r = h.getRange(celda);
  var fila0 = r.getRow(), col0 = r.getColumn();

  if (!datos.length) {
    bloque_(h, celda, titulo, COLOR.tierra, 3);
    h.getRange(fila0 + 1, col0).setValue('Todavía no hay horas importadas');
    return;
  }

  var meses = {}, claves = {}, celdas = {};
  datos.forEach(function (d) {
    if (!d.mes) return;
    meses[d.mes] = true;
    claves[d[campo]] = (claves[d[campo]] || 0) + d.horas;
    celdas[d[campo] + '|' + d.mes] = (celdas[d[campo] + '|' + d.mes] || 0) + d.horas;
  });
  var listaMeses = Object.keys(meses).sort();
  // De mayor a menor: lo que más horas se lleva, arriba
  var listaClaves = Object.keys(claves).sort(function (a, b) { return claves[b] - claves[a]; });

  bloque_(h, celda, titulo, COLOR.tierra, listaMeses.length + 2);

  var tabla = [[campo === 'area' ? 'área' : 'trabajador'].concat(listaMeses).concat(['TOTAL'])];
  listaClaves.forEach(function (k) {
    var fila = [k];
    listaMeses.forEach(function (m) { fila.push(celdas[k + '|' + m] || ''); });
    fila.push(claves[k]);
    tabla.push(fila);
  });
  var totales = ['TOTAL'];
  listaMeses.forEach(function (m) {
    var s = 0;
    listaClaves.forEach(function (k) { s += celdas[k + '|' + m] || 0; });
    totales.push(s);
  });
  totales.push(datos.reduce(function (s, d) { return s + d.horas; }, 0));
  tabla.push(totales);

  h.getRange(fila0 + 1, col0, tabla.length, tabla[0].length)
    .setValues(tabla).setNumberFormat('#,##0.##');
  h.getRange(fila0 + 1, col0, 1, tabla[0].length)
    .setFontWeight('bold').setBackground(COLOR.tierraClaro);
  h.getRange(fila0 + tabla.length, col0, 1, tabla[0].length).setFontWeight('bold');
}

/* Horas abiertas por actividad dentro de cada área: no alcanza saber que
   hay 156 horas hortícolas, hace falta saber cuántas fueron de siembra,
   de trasplante o de cosecha. El área va en negrita con su total y
   debajo, indentadas, sus actividades ordenadas de mayor a menor. */
function areaYActividad_(h, celda, datos) {
  var r = h.getRange(celda);
  var fila0 = r.getRow(), col0 = r.getColumn();

  if (!datos.length) {
    bloque_(h, celda, 'HORAS POR ÁREA Y ACTIVIDAD', COLOR.tierra, 3);
    h.getRange(fila0 + 1, col0).setValue('Todavía no hay horas importadas');
    return;
  }

  var meses = {}, porArea = {}, porPar = {}, totArea = {};
  datos.forEach(function (d) {
    if (d.mes) meses[d.mes] = true;
    var act = d.actividad || 'sin actividad';
    totArea[d.area] = (totArea[d.area] || 0) + d.horas;
    if (!porArea[d.area]) porArea[d.area] = {};
    porArea[d.area][act] = (porArea[d.area][act] || 0) + d.horas;
    porPar[d.area + '|' + act + '|' + d.mes] = (porPar[d.area + '|' + act + '|' + d.mes] || 0) + d.horas;
    porPar[d.area + '||' + d.mes] = (porPar[d.area + '||' + d.mes] || 0) + d.horas;
  });
  var lm = Object.keys(meses).sort();
  var areas = Object.keys(totArea).sort(function (a, b) { return totArea[b] - totArea[a]; });

  bloque_(h, celda, 'HORAS POR ÁREA Y ACTIVIDAD', COLOR.tierra, lm.length + 2);

  var tabla = [['área / actividad'].concat(lm).concat(['TOTAL'])];
  var negritas = [0];
  areas.forEach(function (a) {
    var fila = [a];
    lm.forEach(function (m) { fila.push(porPar[a + '||' + m] || ''); });
    fila.push(totArea[a]);
    negritas.push(tabla.length);
    tabla.push(fila);

    var acts = Object.keys(porArea[a]).sort(function (x, y) {
      return porArea[a][y] - porArea[a][x];
    });
    acts.forEach(function (act) {
      var f = ['    ' + act];   // indentada, para que se lea la jerarquía
      lm.forEach(function (m) { f.push(porPar[a + '|' + act + '|' + m] || ''); });
      f.push(porArea[a][act]);
      tabla.push(f);
    });
  });

  h.getRange(fila0 + 1, col0, tabla.length, tabla[0].length)
    .setValues(tabla).setNumberFormat('#,##0.##');
  h.getRange(fila0 + 1, col0, 1, tabla[0].length)
    .setFontWeight('bold').setBackground(COLOR.tierraClaro);
  negritas.forEach(function (i) {
    if (i === 0) return;
    h.getRange(fila0 + 1 + i, col0, 1, tabla[0].length).setFontWeight('bold');
  });
}

/* Cuánto se le debe a cada persona: lo devengado sale de las horas, lo
   pagado de los egresos con concepto "sueldos" a su nombre. */
function liquidacionHoras_(h, datos) {
  bloque_(h, 'J100', 'A LIQUIDAR POR TRABAJADOR', COLOR.rojo, 5);
  if (!datos.length) {
    h.getRange('J101').setValue('Todavía no hay horas importadas');
    return;
  }

  var horas = {}, devengado = {};
  datos.forEach(function (d) {
    horas[d.trabajador] = (horas[d.trabajador] || 0) + d.horas;
    devengado[d.trabajador] = (devengado[d.trabajador] || 0) + d.devengado;
  });
  var gente = Object.keys(devengado).sort(function (a, b) {
    return devengado[b] - devengado[a];
  });

  h.getRange('J101:N101')
    .setValues([['trabajador', 'horas', 'devengado', 'pagado', 'saldo']])
    .setFontWeight('bold').setBackground(COLOR.verdeClaro);

  var filas = [];
  for (var i = 0; i < gente.length; i++) {
    var n = 102 + i;
    filas.push([
      gente[i], horas[gente[i]], devengado[gente[i]],
      // Vivo: cambia solo cuando se registra un pago en la app
      '=SUMIFS(egresos!$D$2:$D$2000;egresos!$C$2:$C$2000;"sueldos";' +
        'egresos!$G$2:$G$2000;$J' + n + ')',
      '=L' + n + '-M' + n
    ]);
  }
  h.getRange(102, 10, filas.length, 5).setValues(filas);
  h.getRange(102, 11, filas.length, 1).setNumberFormat('#,##0.##');
  h.getRange(102, 12, filas.length, 3).setNumberFormat('"$"#,##0');
}

/* ================= Pagos y cuentas de los trabajadores =================
   Los pagos de sueldos se guardan en UN solo lugar: la hoja "egresos", con
   concepto "sueldos" y la persona. Ahí se cargan y ahí se corrigen.

   Para leerlos, el script arma dos hojas de SOLO LECTURA, que rehace cada
   vez que cambia un egreso y cada vez que se importan las horas:
     · "pagos":   cada pago, por fecha, con medio y hasta qué día cubre.
     · "cuentas": una fila por trabajador: horas, devengado, pagado, saldo.
   Son la misma cuenta que calcula Cuentas.gs para AMA Producción (devengado
   de la hoja "horas" menos los egresos de sueldos), puesta a la vista en la
   planilla. Si se las editara, la próxima vez se pisan: corregir en egresos.
   Una contabilidad, no dos (07/10). */

var CONCEPTOS_SUELDO_ = ['sueldos'];

// Los encabezados nuevos de egresos y el formato de "hasta qué día cubre".
function columnasDePago_() {
  var h = hoja_('egresos');
  var cols = COLUMNAS.egresos;
  h.getRange(1, 1, 1, cols.length).setValues([ENCABEZADOS.egresos])
    .setBackground(COLOR.tierra).setFontColor(COLOR.blanco).setFontWeight('bold');
  h.getRange(2, cols.indexOf('periodo') + 1, 999).setNumberFormat('dd/mm/yyyy');
}

// Los egresos de sueldos, leídos tal cual están en la hoja.
function pagosDeSueldo_() {
  var h = hoja_('egresos');
  var cols = COLUMNAS.egresos;
  if (h.getLastRow() < 2) return [];
  var v = h.getRange(2, 1, h.getLastRow() - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var o = {};
    cols.forEach(function (c, j) { o[c] = v[i][j]; });
    if (CONCEPTOS_SUELDO_.indexOf(normClave_(o.concepto)) < 0) continue;
    var monto = normMonto_(o.monto);
    if (!monto) continue;
    out.push({
      id: String(o.id || '').trim(), fecha: normFecha_(o.fecha), monto: monto,
      persona: String(o.persona || '').trim(), medio: String(o.medio || '').trim(),
      periodo: o.periodo ? normFecha_(o.periodo) : '', obs: String(o.obs || '').trim()
    });
  }
  return out.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
}

/* Una hoja de solo lectura: se vacía y se escribe entera. El formato va
   ANTES que los valores (ver escribirHoras_). */
function hojaDeLectura_(nombre, encabezados, filas, formatos, nota, color) {
  var ss = SpreadsheetApp.getActive();
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  h.clear();
  h.setTabColor(color);
  h.setFrozenRows(1);
  h.getRange(1, 1, 1, encabezados.length).setValues([encabezados])
    .setBackground(color).setFontColor(COLOR.blanco).setFontWeight('bold');
  h.getRange(1, 1).setNote(nota);
  if (filas.length) {
    Object.keys(formatos).forEach(function (col) {
      h.getRange(2, Number(col), filas.length, 1).setNumberFormat(formatos[col]);
    });
    h.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
  }
  return h;
}

function escribirCuentasYPagos_() {
  var pagos = pagosDeSueldo_();
  var horas = leerHojaHoras_();
  var NOTA = 'Esta hoja la arma el script y se rehace sola: no editarla, los ' +
    'cambios se pierden. Los pagos se cargan y se corrigen en AMA Economía ' +
    '(Egresos, concepto "sueldos"), que los guarda en la hoja egresos.';

  /* --- pagos, del más viejo al más nuevo --- */
  hojaDeLectura_('pagos',
    ['fecha', 'trabajador', 'monto', 'medio de pago', 'horas hasta', 'observaciones', 'id'],
    pagos.map(function (p) {
      return [fechaADate_(p.fecha), p.persona || '(sin persona)', p.monto, p.medio,
              p.periodo ? fechaADate_(p.periodo) : '', p.obs, p.id];
    }),
    { 1: 'dd/mm/yyyy', 3: '"$"#,##0', 5: 'dd/mm/yyyy', 7: '@' },
    NOTA, COLOR.verde);

  /* --- cuentas: una fila por persona, la que más se le debe arriba --- */
  var gente = {};
  var cuenta = function (nombre) {
    var k = normClave_(nombre);
    return gente[k] || (gente[k] = { nombre: nombre, tarifa: 0, horas: 0, devengado: 0,
                                     pagado: 0, ultimo: '', pagos: 0 });
  };
  horas.forEach(function (d) {
    var c = cuenta(d.trabajador);
    c.nombre = d.trabajador;          // el nombre como figura en las horas
    c.horas += d.horas;
    c.devengado += d.devengado;
    if (d.tarifa) c.tarifa = d.tarifa;
  });
  pagos.forEach(function (p) {
    var c = cuenta(p.persona || '(sin persona)');
    c.pagado += p.monto;
    c.pagos++;
    if (p.fecha > c.ultimo) c.ultimo = p.fecha;
  });
  var lista = Object.keys(gente).map(function (k) { return gente[k]; })
    .sort(function (a, b) { return (b.devengado - b.pagado) - (a.devengado - a.pagado); });
  var tot = { horas: 0, devengado: 0, pagado: 0 };
  var filas = lista.map(function (c) {
    var saldo = c.devengado - c.pagado;
    tot.horas += c.horas; tot.devengado += c.devengado; tot.pagado += c.pagado;
    /* "tarifa $/h" es la de hoy (la última hora importada). Para pasar
       pesos a horas se usa la real, devengado ÷ horas: con un aumento en la
       temporada, las horas pagadas con la de hoy no darían el total. Igual
       que Cuentas.gs. */
    var real = c.horas ? c.devengado / c.horas : 0;
    return [c.nombre, c.tarifa || '', c.horas, c.devengado, c.pagado, saldo,
            real ? c.pagado / real : '', real ? saldo / real : '',
            c.ultimo ? fechaADate_(c.ultimo) : '', c.pagos];
  });
  filas.push(['TOTAL', '', tot.horas, tot.devengado, tot.pagado, tot.devengado - tot.pagado,
              '', '', '', pagos.length]);
  var h = hojaDeLectura_('cuentas',
    ['trabajador', 'tarifa $/h', 'horas', 'devengado', 'pagado', 'saldo',
     'horas pagadas', 'horas adeudadas', 'último pago', 'pagos'],
    filas,
    { 2: '"$"#,##0', 3: '#,##0.##', 4: '"$"#,##0', 5: '"$"#,##0', 6: '"$"#,##0',
      7: '#,##0.##', 8: '#,##0.##', 9: 'dd/mm/yyyy', 10: '0' },
    NOTA, COLOR.rojo);
  h.getRange(filas.length + 1, 1, 1, 10).setFontWeight('bold');
}

/* Para correr a mano desde el editor, si hiciera falta rehacerlas. */
function actualizarCuentas() {
  escribirCuentasYPagos_();
  return 'Hojas "pagos" y "cuentas" actualizadas';
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

/* ================= Proyección: lo que AMA Producción planificó ================= *

   Producción decide qué se planta, cuánto y con qué rinde; acá se deciden los
   precios. Este script le pregunta a AMA su plan y la app lo cruza con la
   hoja productos. Nada de eso se guarda en la planilla: si se copiara, el
   día que cambie el plan habría dos verdades.

   El pedido lo hace ESTE servidor con UrlFetchApp, nunca el navegador. Así la
   clave queda en las propiedades del script y no viaja a ningún teléfono.

   Propiedades del script (Configuración del proyecto → Propiedades):
     AMA_URL               la dirección /exec del servicio de AMA
     AMA_PROYECCION_TOKEN  la clave que genera tools/token_proyeccion.py
     AMA_CHACRA            opcional; "tica" si no está

   La primera vez hay que correr probarProyeccion() a mano desde el editor:
   este script nunca había llamado a una dirección de afuera, y Apps Script no
   lo deja hasta que alguien aprueba ese permiso. */

function proyeccion_(refrescar) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('AMA_URL') || '';
  var token = props.getProperty('AMA_PROYECCION_TOKEN') || '';
  var chacra = props.getProperty('AMA_CHACRA') || 'tica';
  if (!url || !token) {
    return { api: API, error: 'Falta conectar con AMA Producción: las propiedades ' +
      'AMA_URL y AMA_PROYECCION_TOKEN del script de bioma-db.' };
  }
  // Ya pasó que se pegara solo el identificador (AKfycb…): Apps Script lo toma
  // como un nombre de sitio y el error que devuelve trae la clave a la vista.
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url.trim())) {
    return { api: API, error: 'La propiedad AMA_URL de bioma-db no es una dirección completa: ' +
      'tiene que empezar con https://script.google.com/macros/s/ y terminar en /exec.' };
  }
  url = url.trim();

  // Unos minutos de caché: el plan cambia cuando alguien planifica, no a cada
  // rato. El botón "Actualizar" de la app la saltea.
  var cache = CacheService.getScriptCache();
  var guardado = refrescar ? null : cache.get('proyeccion_ama');
  if (guardado) return { api: API, proyeccion: JSON.parse(guardado) };

  var r;
  try {
    r = UrlFetchApp.fetch(url + '?proyeccion=1&chacra=' + encodeURIComponent(chacra) +
      '&token=' + encodeURIComponent(token.trim()), { muteHttpExceptions: true, followRedirects: true });
  } catch (e) {
    // El mensaje de Apps Script repite la dirección con la clave: no se muestra.
    return { api: API, error: 'No se pudo llegar a AMA Producción. Revisar AMA_URL.' };
  }
  var datos;
  try { datos = JSON.parse(r.getContentText()); } catch (e) { datos = null; }
  if (!datos || datos.api !== 1 || !datos.plan) {
    return { api: API, error: (datos && datos.error) ? 'AMA respondió: ' + datos.error
      : 'AMA respondió algo que no es la proyección (¿falta implementar su nueva versión?).' };
  }
  cache.put('proyeccion_ama', JSON.stringify(datos), 600);
  return { api: API, proyeccion: datos };
}

// Ejecutar a mano UNA vez: aprueba el permiso de pedidos externos y deja en
// el registro qué respondió AMA.
function probarProyeccion() {
  var r = proyeccion_(true);
  if (r.error) { Logger.log(r.error); return; }
  var p = r.proyeccion;
  Logger.log('AMA respondió: ' + p.nombre + ' · temporada ' + p.temporada + ' · ' +
             p.plan.length + ' cultivos');
  p.plan.forEach(function (c) {
    Logger.log('  ' + c.cultivo + ': ' + c.superficie_m2 + ' m², ' + c.kg + ' kg');
  });
}

/* ================= Salida ================= */

/* Radiografía de la planilla, para poder diagnosticar sin adivinar:
   versión de código, esquema aplicado, hojas existentes y su tamaño. */
function diagnostico_() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getDocumentProperties();
  var hojas = ss.getSheets().map(function (h) {
    return h.getName() + ' (' + Math.max(h.getLastRow() - 1, 0) + ' filas' +
      (h.getCharts().length ? ', ' + h.getCharts().length + ' gráficos' : '') + ')';
  });
  var res = ss.getSheetByName('resumen');
  return {
    version: 'v' + API,
    esquema: props.getProperty('esquema') || '(sin migrar)',
    hojas: hojas,
    filaDelFlujo: res ? filaDelFlujo_(res) : 0,
    firmaGraficos: props.getProperty('graficos') || '(nunca se armaron)'
  };
}

function salidaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
