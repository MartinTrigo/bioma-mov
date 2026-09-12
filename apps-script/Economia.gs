/* ============================================================
   RESUMEN ECONÓMICO — endpoint de SOLO LECTURA
   ============================================================

   Qué es
   ------
   El segundo endpoint de consulta de bioma-db. Devuelve el estado
   económico de la temporada ya masticado: balance, mes a mes, y en qué
   entra y en qué se va la plata. Lo muestra MonAgric.

   Contrato: `apps-script/ECONOMIA.md` (copia de lo que pidió MonAgric).
   Hermano de `Cuentas.gs`, que hace lo mismo con los sueldos.

   POR QUÉ VA EN UN PROYECTO APARTE
   --------------------------------
   Un proyecto de Apps Script tiene UN solo `doGet`, así que cada
   endpoint necesita el suyo. Y la URL de `Code.gs` permite LEER Y
   ESCRIBIR toda la economía: es la contraseña de los datos, y no puede
   viajar dentro de MonAgric.

   Este archivo no tiene una sola línea que escriba nada. Lo peor que
   puede hacer alguien con esta URL es mirar totales. No agregar acá
   funciones que escriban, y no mezclarlo con Cuentas.gs.

   Hay repetición de herramientas con Cuentas.gs (leerHoja_, texto_,
   numero_...). Es a propósito: son proyectos separados y no comparten
   código. Preferimos treinta líneas duplicadas antes que una biblioteca
   común, que ataría los dos endpoints a la vez.

   CÓMO SE INSTALA
   ---------------
   Igual que Cuentas.gs:
   1. script.google.com → Nuevo proyecto → "Bioma · Economía"
   2. Pegar este archivo entero (Ctrl+A en el editor antes de pegar).
   3. Completar ID_BIOMA_DB: sale de la URL de la planilla abierta en
      Drive, docs.google.com/spreadsheets/d/ESTO/edit — NO es el id del
      proyecto de Apps Script ni el de la implementación.
   4. Ejecutar `probar` una vez (pide permisos y muestra el resultado).
   5. Implementar → Nueva implementación → Aplicación web
      Ejecutar como: yo · Quién tiene acceso: **cualquier usuario**
      (si dice "con una cuenta de Google" devuelve la pantalla de login)
   Para actualizarlo: Administrar implementaciones → ✏ → Nueva versión.
   ============================================================ */

var API_ECONOMIA = 1;

// Pegar acá el id de bioma-db, en el editor de Apps Script.
var ID_BIOMA_DB = '';

/* La temporada agrícola no arranca en enero. Acá empieza en JULIO: la
   temporada "2026-27" va del 1/7/2026 al 30/6/2027. Bioma no registra
   esto en ninguna parte, así que es una convención de este archivo: si
   el corte real es otro, se cambia este número y nada más. */
var MES_INICIO_TEMPORADA = 7;

// Un pago de sueldos es un egreso con este concepto (igual que en Cuentas.gs)
var CONCEPTOS_PAGO = ['sueldos'];

/* ================= Punto de entrada ================= */

function doGet(e) {
  try {
    var pedida = e && e.parameter && e.parameter.temporada;
    return json_(economia_(pedida));
  } catch (err) {
    // Nunca romper del lado de MonAgric: siempre un JSON con el motivo.
    return json_({ api: API_ECONOMIA, error: String(err && err.message || err) });
  }
}

// Para correr a mano en el editor y ver qué devuelve, sin implementar nada.
function probar() {
  Logger.log(JSON.stringify(economia_(), null, 2));
}

/* ================= El cálculo ================= */

function economia_(temporadaPedida) {
  var libro = abrir_();
  var temporada = temporadaPedida || temporadaDe_(hoyISO_());
  var rango = rangoTemporada_(temporada);

  var ingresos = movimientos_(libro, 'ingresos', rango);
  var egresos = movimientos_(libro, 'egresos', rango);

  var totIn = suma_(ingresos);
  var totOut = suma_(egresos);

  return {
    api: API_ECONOMIA,
    actualizado: new Date().toISOString(),
    moneda: 'ARS',
    temporada: temporada,

    resumen: {
      ingresos: totIn,
      egresos: totOut,
      balance: totIn - totOut,
      /* Bioma no lleva caja ni banco: no hay de dónde sacar el saldo
         disponible. null y no 0, que significaría "no queda plata". */
      disponible: null
    },

    meses: porMes_(ingresos, egresos),
    ingresosPorConcepto: porConcepto_(ingresos, totIn),
    egresosPorConcepto: porConcepto_(egresos, totOut),
    /* El trabajo de la temporada, sin nombres: en qué se trabajó y cuánto.
       Es el logro de haber registrado las horas, y se comparte con todo el
       equipo. Quién hizo cada hora va por Cuentas.gs, que tiene el filtro. */
    horas: horas_(libro, rango),
    sueldos: sueldos_(libro, egresos, rango)
  };
}

/* Los movimientos de una hoja dentro de la temporada. Solo lo que hace
   falta para agregar: fecha, concepto y monto. Nada más sale de acá. */
function movimientos_(libro, hoja, rango) {
  return leerHoja_(libro, hoja).map(function (f) {
    return {
      fecha: fecha_(f['fecha']),
      concepto: texto_(f['concepto']) || 'sin concepto',
      monto: numero_(f['monto'])
    };
  }).filter(function (m) {
    return m.fecha >= rango.desde && m.fecha <= rango.hasta && m.monto;
  });
}

function suma_(lista) {
  return redondear_(lista.reduce(function (s, m) { return s + m.monto; }, 0));
}

/* Mes a mes, del más nuevo al más viejo. Solo los meses con movimiento:
   inventar los vacíos sería decidir del lado de Bioma cómo se dibuja. */
function porMes_(ingresos, egresos) {
  var acum = {};
  function sumar(lista, campo) {
    lista.forEach(function (m) {
      var k = m.fecha.slice(0, 7);
      var f = acum[k] || (acum[k] = { mes: k, ingresos: 0, egresos: 0, balance: 0 });
      f[campo] += m.monto;
    });
  }
  sumar(ingresos, 'ingresos');
  sumar(egresos, 'egresos');

  return Object.keys(acum).sort().reverse().map(function (k) {
    var f = acum[k];
    f.ingresos = redondear_(f.ingresos);
    f.egresos = redondear_(f.egresos);
    f.balance = redondear_(f.ingresos - f.egresos);
    return f;
  });
}

/* Agrupado por concepto, de mayor a menor, con el porcentaje ya hecho.
   El porcentaje viaja calculado a propósito: si MonAgric dividiera por
   su cuenta, tarde o temprano su número y el nuestro diferirían. */
function porConcepto_(lista, total) {
  var acum = {}, nombre = {};
  lista.forEach(function (m) {
    /* Se agrupa sin acentos ni mayúsculas ("Sueldos" y "sueldos" son lo
       mismo) pero se muestra tal como se escribe en bioma-db, para que
       la app y la planilla digan la misma palabra. */
    var k = clave_(m.concepto);
    if (!(k in acum)) { acum[k] = 0; nombre[k] = m.concepto; }
    acum[k] += m.monto;
  });
  return Object.keys(acum).sort(function (a, b) { return acum[b] - acum[a]; })
    .map(function (k) {
      return {
        concepto: nombre[k],
        monto: redondear_(acum[k]),
        porcentaje: total ? Math.round(acum[k] / total * 1000) / 10 : 0
      };
    });
}

/* Las horas de la temporada por área, y dentro de cada área por
   actividad. Saber que hubo 40 horas de "Siembras" sirve poco; lo que
   importa es de qué área fueron. Es el mismo criterio que usa la hoja
   "resumen" y la pantalla de la app.

   Acá NO viaja ningún nombre. Es a propósito: este endpoint lo ve todo
   el equipo, y quién trabajó cuántas horas es asunto del otro. */
function horas_(libro, rango) {
  var desde = rango.desde.slice(0, 7), hasta = rango.hasta.slice(0, 7);
  var areas = {}, nombreArea = {}, actividades = {}, porAct = {}, nombreAct = {};
  var total = 0;

  leerHoja_(libro, 'horas').forEach(function (f) {
    var mes = texto_(f['mes']);
    if (!(mes >= desde && mes <= hasta)) return;
    var hs = numero_(f['horas']);
    if (!hs) return;
    total += hs;

    var a = texto_(f['área']) || 'sin área';
    var ka = clave_(a);
    if (!(ka in areas)) { areas[ka] = 0; nombreArea[ka] = a; actividades[ka] = {}; }
    areas[ka] += hs;

    var t = texto_(f['actividad']) || 'sin actividad';
    var kt = clave_(t);
    actividades[ka][kt] = (actividades[ka][kt] || 0) + hs;
    if (!(kt in porAct)) { porAct[kt] = 0; nombreAct[kt] = t; }
    porAct[kt] += hs;
  });

  function pct(n) { return total ? Math.round(n / total * 1000) / 10 : 0; }
  function mayorPrimero(o) {
    return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; });
  }

  return {
    total: redondear_(total),
    porArea: mayorPrimero(areas).map(function (ka) {
      var dentro = actividades[ka];
      return {
        area: nombreArea[ka],
        horas: redondear_(areas[ka]),
        porcentaje: pct(areas[ka]),
        actividades: mayorPrimero(dentro).map(function (kt) {
          return { actividad: nombreAct[kt], horas: redondear_(dentro[kt]) };
        })
      };
    }),
    porActividad: mayorPrimero(porAct).map(function (kt) {
      return {
        actividad: nombreAct[kt],
        horas: redondear_(porAct[kt]),
        porcentaje: pct(porAct[kt])
      };
    })
  };
}

/* Cuánto pesan los sueldos, sin nombres. El detalle por persona viaja
   por el otro endpoint (Cuentas.gs), que para eso está. */
function sueldos_(libro, egresos, rango) {
  var pagado = egresos.filter(function (m) {
    return CONCEPTOS_PAGO.indexOf(clave_(m.concepto)) >= 0;
  }).reduce(function (s, m) { return s + m.monto; }, 0);

  var desde = rango.desde.slice(0, 7), hasta = rango.hasta.slice(0, 7);
  var devengado = leerHoja_(libro, 'horas').reduce(function (s, f) {
    var mes = texto_(f['mes']);
    return (mes >= desde && mes <= hasta) ? s + numero_(f['devengado $']) : s;
  }, 0);

  return {
    devengado: redondear_(devengado),
    pagado: redondear_(pagado),
    /* Lo que se debe. No entra en el balance: lo devengado no es un
       egreso hasta que se paga. */
    saldo: redondear_(devengado - pagado)
  };
}

/* ================= Temporadas ================= */

function temporadaDe_(iso) {
  var a = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  var inicio = m >= MES_INICIO_TEMPORADA ? a : a - 1;
  return inicio + '-' + String((inicio + 1) % 100 + 100).slice(1);
}

// "2026-27" -> del 1 de julio de 2026 al 30 de junio de 2027
function rangoTemporada_(etiqueta) {
  var a = Number(String(etiqueta).slice(0, 4));
  if (!a) throw new Error('Temporada mal escrita: "' + etiqueta + '". Va como "2026-27".');
  var fin = MES_INICIO_TEMPORADA === 1 ? a : a + 1;
  var mesFin = MES_INICIO_TEMPORADA === 1 ? 12 : MES_INICIO_TEMPORADA - 1;
  return {
    desde: a + '-' + dos_(MES_INICIO_TEMPORADA) + '-01',
    /* El 31 aunque junio tenga 30: las fechas se comparan como texto y
       "2027-06-31" es el tope del mes sin tener que saber cuántos días
       tiene. No es una fecha que se muestre en ningún lado. */
    hasta: fin + '-' + dos_(mesFin) + '-31'
  };
}

function hoyISO_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ================= Lectura de las hojas =================
   Por NOMBRE de columna, no por posición: agregar una columna en la
   planilla ya rompió cosas antes (error 11 de DECISIONES.md). */

function abrir_() {
  if (!ID_BIOMA_DB) {
    throw new Error('Falta completar ID_BIOMA_DB con el id de la planilla bioma-db.');
  }
  try {
    return SpreadsheetApp.openById(ID_BIOMA_DB);
  } catch (e) {
    throw new Error('No se pudo abrir la planilla con ese id. Ojo: no es el ' +
      'id del proyecto de Apps Script (script.google.com/home/projects/...), ' +
      'sino el de bioma-db abierta en Drive: docs.google.com/spreadsheets/' +
      'd/ACA_VA_EL_ID/edit. Detalle: ' + e.message);
  }
}

function leerHoja_(libro, nombre) {
  var h = libro.getSheetByName(nombre);
  if (!h || h.getLastRow() < 2) return [];
  var v = h.getDataRange().getValues();
  var cab = v[0].map(function (c) { return texto_(c).toLowerCase(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {};
    for (var j = 0; j < cab.length; j++) if (cab[j]) o[cab[j]] = v[i][j];
    out.push(o);
  }
  return out;
}

/* ================= Herramientas ================= */

// Sin mayúsculas ni acentos, para agrupar sin duplicar
function clave_(s) {
  return texto_(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function texto_(v) {
  return v == null ? '' : String(v).trim();
}

function numero_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(texto_(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Siempre aaaa-mm-dd, venga como texto o como fecha de la planilla
function fecha_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = texto_(v);
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    var a = m[3].length === 2 ? '20' + m[3] : m[3];
    return a + '-' + dos_(m[2]) + '-' + dos_(m[1]);
  }
  return s.slice(0, 10);
}

function dos_(n) {
  return ('0' + n).slice(-2);
}

function redondear_(n) {
  return Math.round(n * 100) / 100;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
