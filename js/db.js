/* ============================================================
   Estado local de la app (localStorage) y su esquema.
   Todo lo que se sincroniza con la planilla vive acá.
   ============================================================ */

const STORAGE_KEY = 'bioma-data-v1';

// Conceptos iniciales, tomados de la planilla original. Una vez sincronizada
// la app, manda la hoja "conceptos" de la planilla.
const CONCEPTOS_DEFAULT = {
  ingresos: [
    'Bolsones Valen', 'Peninsula', 'Feria Puelo', 'Feria Franca',
    'Barilu', 'EPPA', 'Al Margen', 'Feria SPG', 'CSA',
    'Verdulerías', 'Restaurantes', 'Prestamos', 'Varias'
  ],
  egresos: [
    'Alquiler', 'Luz', 'Internet', 'sueldo marto', 'sueldo tomi',
    'comi valen', 'jornal', 'flete', 'tractor', 'papelería', 'semillas',
    'fertilizantes', 'riego', 'herramientas', 'infraestructura',
    'fruta fina', 'terceros', 'comida', 'dulces', 'cuota fundación',
    'gírgolas', 'tienda virtual', 'abono', 'transporte', 'publicidad',
    'varios'
  ]
};

/* Las cuatro listas de precios de Bioma. "chacra" es la base y las demás
   se calculan como un porcentaje sobre ella; cada producto puede además
   fijar un precio propio para una lista y romper el porcentaje.
   Los porcentajes se pueden cambiar desde la hoja "listas". */
const LISTAS_DEFAULT = [
  { clave: 'chacra', nombre: 'Chacra', ajuste: 0 },
  { clave: 'comarca', nombre: 'Comarca', ajuste: 30 },
  { clave: 'bariloche', nombre: 'Bariloche', ajuste: 50 },
  { clave: 'verduleria', nombre: 'Verdulerías', ajuste: -20 }
];

let db = load();

function estadoInicial() {
  return {
    version: 2,
    proyecto: 'bioma',
    // {id, tipo:'ingreso'|'egreso', fecha, concepto, monto, obs, mod}
    movimientos: [],
    // {id, fecha, persona, concepto, monto, direccion:'debo'|'nos_deben',
    //  estado:'pendiente'|'saldada', mod}
    deudas: [],
    // {id, nombre, unidad, presentacion, chacra, comarca, bariloche,
    //  verduleria, activo, mod} — precios vacíos = calculados por porcentaje
    productos: [],
    listas: structuredClone(LISTAS_DEFAULT),
    // tumbas {id, mod}: propagan las eliminaciones entre dispositivos
    borrados: [],
    conceptos: structuredClone(CONCEPTOS_DEFAULT),
    conceptosNuevos: { ingresos: [], egresos: [] }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizar(JSON.parse(raw));
  } catch (e) {
    console.error('Error al cargar datos', e);
  }
  return estadoInicial();
}

// Completa lo que falte para que una copia vieja del estado siga sirviendo.
function normalizar(d) {
  const base = estadoInicial();
  d.movimientos = d.movimientos || [];
  d.deudas = d.deudas || [];
  d.productos = d.productos || [];
  d.borrados = d.borrados || [];
  d.conceptos = d.conceptos || base.conceptos;
  d.conceptosNuevos = d.conceptosNuevos || { ingresos: [], egresos: [] };
  d.listas = (d.listas && d.listas.length) ? d.listas : base.listas;
  // "pagada" fue el nombre viejo del estado de una deuda saldada
  d.deudas.forEach(x => { if (x.estado === 'pagada') x.estado = 'saldada'; });
  return d;
}

function save() {
  db.actualizado = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    console.error('No se pudo guardar', e);
    toast('No se pudo guardar en el dispositivo');
  }
}

// Marca un registro como eliminado para que la baja viaje a los demás
// dispositivos en la próxima sincronización.
function sepultar(id) {
  db.borrados.push({ id, mod: Date.now() });
}
