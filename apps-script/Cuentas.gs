/* ============================================================
   CUENTAS DE TRABAJADORES — endpoint de SOLO LECTURA
   ============================================================

   Qué es
   ------
   Un script SEPARADO del de bioma-db. Responde una sola pregunta:
   "¿cómo viene la cuenta de cada trabajador?" — horas, devengado,
   pagado, saldo y el detalle de los pagos.

   Lo consume MonAgric, para que cada persona pueda seguir su cuenta
   desde la app en vez de un link a una planilla que después se pierde.

   POR QUÉ VA EN UN PROYECTO APARTE
   --------------------------------
   Un proyecto de Apps Script tiene UN solo `doGet`. Si esto viviera
   dentro de Code.gs habría que exponer la misma URL, y esa URL permite
   LEER Y ESCRIBIR toda la economía del proyecto: es la contraseña de
   los datos. Poniéndola dentro de MonAgric, los seis socios quedarían
   con acceso total a las finanzas, y con capacidad de modificarlas.

   Este archivo, en cambio, no tiene una sola línea que escriba nada.
   Lo peor que puede hacer alguien con esta URL es mirar cuentas de
   sueldos. Por eso esta URL sí puede viajar dentro de MonAgric, y la
   de Code.gs NUNCA.

   No mezclar las dos. No agregar acá funciones que escriban.

   CÓMO SE INSTALA
   ---------------
   1. script.google.com → Nuevo proyecto → nombre "Bioma · Cuentas"
   2. Pegar este archivo entero.
   3. Completar ID_BIOMA_DB acá abajo (el id sale de la URL de la
      planilla: .../spreadsheets/d/ESTO_DE_ACA/edit). El id se pega en
      el editor de Apps Script, NO en este archivo del repo.
   4. Ejecutar `probar` una vez: pide permisos y muestra el resultado
      en el registro. Si ahí se ve bien, ya está.
   5. Implementar → Nueva implementación → Aplicación web
      Ejecutar como: yo · Quién tiene acceso: cualquier persona
   6. Esa URL es la que usa MonAgric.
   Para actualizarlo después: Administrar implementaciones → ✏ → Nueva
   versión. Nunca "Nueva implementación" (quedan dos URLs peleando).
   ============================================================ */

var API_CUENTAS = 1;

// Pegar acá el id de bioma-db, en el editor de Apps Script.
var ID_BIOMA_DB = '';

// Un pago a un trabajador es un egreso con este concepto y su nombre
// en la columna "persona". Es el mismo criterio que usa la app.
var CONCEPTOS_PAGO = ['sueldos'];

/* ================= Punto de entrada ================= */

function doGet(e) {
  try {
    var datos = cuentas_();
    var quien = e && e.parameter && e.parameter.persona;
    if (quien) {
      var k = clave_(quien);
      datos.trabajadores = datos.trabajadores.filter(function (t) {
        return clave_(t.nombre) === k;
      });
      /* Los totales son de todo el proyecto: devolverlos junto a una
         sola persona haría creer que son suyos. */
      delete datos.totales;
      delete datos.pagosSinPersona;
    }
    return json_(datos);
  } catch (err) {
    // Nunca romper del lado de MonAgric: siempre un JSON con el motivo.
    return json_({ api: API_CUENTAS, error: String(err) });
  }
}

// Para correr a mano en el editor y ver qué devuelve, sin implementar nada.
function probar() {
  Logger.log(JSON.stringify(cuentas_(), null, 2));
}

/* ================= El cálculo ================= */

function cuentas_() {
  if (!ID_BIOMA_DB) {
    throw new Error('Falta completar ID_BIOMA_DB con el id de la planilla bioma-db.');
  }
  /* El error de Google acá ("Illegal spreadsheet id") no dice cuál es el
     id correcto, y el del proyecto de Apps Script se parece bastante como
     para confundirse. */
  var libro;
  try {
    libro = SpreadsheetApp.openById(ID_BIOMA_DB);
  } catch (e) {
    throw new Error('No se pudo abrir la planilla con ese id. Ojo: no es el ' +
      'id del proyecto de Apps Script (script.google.com/home/projects/...), ' +
      'sino el de bioma-db abierta en Drive: docs.google.com/spreadsheets/' +
      'd/ACA_VA_EL_ID/edit. Detalle: ' + e.message);
  }

  var gente = {};       // clave normalizada -> cuenta en construcción
  var sinPersona = [];  // pagos que no se pudieron atribuir a nadie
  var horas = leerHoja_(libro, 'horas');
  var egresos = leerHoja_(libro, 'egresos');

  /* --- Lo devengado: sale de la hoja "horas" --- */
  horas.forEach(function (f) {
    var nombre = texto_(f['trabajador']);
    if (!nombre) return;
    var t = cuenta_(gente, nombre);
    var hs = numero_(f['horas']);
    var dev = numero_(f['devengado $']);
    var tar = numero_(f['tarifa $/h']);

    t.horas += hs;
    t.devengado += dev;
    if (tar) t.tarifa = tar;   // se queda con la última vista: la vigente

    var mes = texto_(f['mes']);
    if (!mes) return;
    var m = t._meses[mes] || (t._meses[mes] =
      { mes: mes, horas: 0, devengado: 0, _areas: {} });
    m.horas += hs;
    m.devengado += dev;
    var area = texto_(f['área']) || 'sin área';
    m._areas[area] = (m._areas[area] || 0) + hs;
  });

  /* --- Lo pagado: egresos con concepto "sueldos" --- */
  egresos.forEach(function (f) {
    if (CONCEPTOS_PAGO.indexOf(clave_(f['concepto'])) < 0) return;
    var nombre = texto_(f['persona']);
    /* Un pago sin persona no se puede atribuir. No se descarta en
       silencio: se informa aparte, porque es plata que salió y alguien
       tiene que corregirlo en la app. */
    if (!nombre) { sinPersona.push(pago_(f)); return; }
    cuenta_(gente, nombre).pagos.push(pago_(f));
  });

  /* --- Cierre de cada cuenta --- */
  var lista = Object.keys(gente).map(function (k) {
    var t = gente[k];

    t.pagos.sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
    t.pagado = t.pagos.reduce(function (s, p) { return s + p.monto; }, 0);
    t.saldo = t.devengado - t.pagado;
    t.ultimoPago = t.pagos.length ? t.pagos[0].fecha : '';

    /* La tarifa declarada puede no existir (filas viejas). El promedio
       real —devengado dividido horas— siempre está, y es el que hay que
       usar para traducir pesos a horas. */
    if (!t.tarifa && t.horas) t.tarifa = Math.round(t.devengado / t.horas);
    var tarifaReal = t.horas ? t.devengado / t.horas : 0;

    /* Horas pagadas y adeudadas: el trabajador piensa en horas, no en
       pesos. Es una conversión, no un dato registrado: si alguien cobró
       con una tarifa distinta a la de hoy, el número es aproximado. */
    t.horasPagadas = tarifaReal ? redondear_(t.pagado / tarifaReal) : null;
    t.horasAdeudadas = tarifaReal ? redondear_(t.saldo / tarifaReal) : null;
    t.liquidado = t.devengado ? redondear_(t.pagado / t.devengado * 100) : 0;

    t.meses = Object.keys(t._meses).sort().reverse().map(function (m) {
      var mes = t._meses[m];
      mes.areas = Object.keys(mes._areas).sort(function (a, b) {
        return mes._areas[b] - mes._areas[a];
      }).map(function (a) { return { area: a, horas: redondear_(mes._areas[a]) }; });
      delete mes._areas;
      mes.horas = redondear_(mes.horas);
      return mes;
    });
    delete t._meses;
    t.horas = redondear_(t.horas);
    return t;
  });

  // El que más se le debe, primero: es lo que hay que mirar
  lista.sort(function (a, b) { return b.saldo - a.saldo; });

  var totales = lista.reduce(function (s, t) {
    s.horas += t.horas; s.devengado += t.devengado;
    s.pagado += t.pagado; s.saldo += t.saldo;
    return s;
  }, { horas: 0, devengado: 0, pagado: 0, saldo: 0 });
  totales.horas = redondear_(totales.horas);

  return {
    api: API_CUENTAS,
    actualizado: new Date().toISOString(),
    moneda: 'ARS',
    trabajadores: lista,
    totales: totales,
    /* Pagos de sueldos sin nombre: no entran en ninguna cuenta. Que se
       vean es la única forma de que se corrijan. */
    pagosSinPersona: sinPersona
  };
}

function cuenta_(gente, nombre) {
  var k = clave_(nombre);
  if (!gente[k]) {
    gente[k] = {
      nombre: nombre, horas: 0, devengado: 0, pagado: 0, saldo: 0,
      tarifa: 0, pagos: [], _meses: {}
    };
  }
  return gente[k];
}

function pago_(f) {
  return {
    fecha: fecha_(f['fecha']),
    monto: numero_(f['monto']),
    obs: texto_(f['obs'])
  };
}

/* ================= Lectura de las hojas =================
   Por NOMBRE de columna, no por posición: agregar una columna en la
   planilla ya rompió cosas antes (error 11 de DECISIONES.md). */

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

// Sin mayúsculas ni acentos: "Frutícola" y "fruticola" son lo mismo,
// y "Luqui " con espacio también. Ya nos duplicó conceptos una vez.
function clave_(s) {
  return texto_(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
    return a + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return s.slice(0, 10);
}

function redondear_(n) {
  return Math.round(n * 100) / 100;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
