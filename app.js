/* ============================================================
   Bioma · Registro de movimientos
   Datos en localStorage. Exporta/importa JSON (respaldo Drive)
   y CSV compatible con planillas.
   ============================================================ */

const STORAGE_KEY = 'bioma-data-v1';

// Conceptos tomados de la planilla original de Google Sheets
const CONCEPTOS_DEFAULT = {
  ingresos: [
    'Bolsones Valen', 'Peninsula', 'Feria Puelo', 'Feria Franca',
    'Barilu', 'EPPA', 'Al Margen', 'Feria SPG', 'CSA',
    'Verdulerías', 'Restaurantes', 'Prestamos', 'Varias'
  ],
  egresos: [
    'Alquiler', 'Luz', 'Internet', 'sueldo marto', 'sueldo naza',
    'sueldo tomi', 'comi valen', 'jornal', 'flete fede', 'flete lucio',
    'tractor', 'papelería', 'semillas', 'fertilizantes', 'riego',
    'herramientas', 'infraestructura', 'fruta fina', 'terceros',
    'comida', 'dulces', 'cuota fundación', 'gírgolas', 'tienda virtual',
    'abono', 'transporte', 'publicidad', 'varios'
  ]
};

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      d.conceptos = d.conceptos || structuredClone(CONCEPTOS_DEFAULT);
      d.movimientos = d.movimientos || [];
      d.deudas = d.deudas || [];
      d.borrados = d.borrados || [];
      return d;
    }
  } catch (e) { console.error('Error al cargar datos', e); }
  return {
    version: 1,
    proyecto: 'bioma',
    movimientos: [], // {id, tipo:'ingreso'|'egreso', fecha, concepto, monto, obs, mod}
    deudas: [],      // {id, fecha, persona, concepto, monto, direccion:'debo'|'nos_deben', estado:'pendiente'|'pagada', mod}
    borrados: [],    // tombstones {id, mod} para propagar eliminaciones al sincronizar
    conceptos: structuredClone(CONCEPTOS_DEFAULT)
  };
}

function save() {
  db.actualizado = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

/* ================= Utilidades ================= */
const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function nombreMes(ym) { // 'YYYY-MM' -> 'julio 2026'
  const [y, m] = ym.split('-');
  return MESES[Number(m) - 1] + ' ' + y;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ================= Tabs ================= */
document.querySelectorAll('.tabbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'resumen') renderResumen();
  });
});

/* ================= Selects de conceptos ================= */
function llenarSelect(select, lista) {
  const actual = select.value;
  select.innerHTML = '';
  lista.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    select.appendChild(o);
  });
  const extra = document.createElement('option');
  extra.value = '__nuevo__';
  extra.textContent = '+ agregar nuevo…';
  select.appendChild(extra);
  if (actual && lista.includes(actual)) select.value = actual;
}

function initConceptos() {
  llenarSelect($('#form-ingreso select[name=concepto]'), db.conceptos.ingresos);
  llenarSelect($('#form-egreso select[name=concepto]'), db.conceptos.egresos);
}

// "+ agregar nuevo…" en los selects
['ingreso', 'egreso'].forEach(tipo => {
  $(`#form-${tipo} select[name=concepto]`).addEventListener('change', e => {
    if (e.target.value !== '__nuevo__') return;
    const nuevo = prompt('Nombre del nuevo concepto:');
    const lista = db.conceptos[tipo + 's'];
    if (nuevo && nuevo.trim()) {
      const limpio = nuevo.trim();
      if (!lista.includes(limpio)) { lista.push(limpio); save(); }
      llenarSelect(e.target, lista);
      e.target.value = limpio;
    } else {
      e.target.value = lista[0] || '';
    }
  });
});

/* ================= Alta de movimientos ================= */
['ingreso', 'egreso'].forEach(tipo => {
  $(`#form-${tipo}`).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    db.movimientos.push({
      id: uid(),
      tipo,
      fecha: f.fecha.value,
      concepto: f.concepto.value,
      monto: Number(f.monto.value),
      obs: f.obs.value.trim(),
      mod: Date.now()
    });
    save();
    f.monto.value = '';
    f.obs.value = '';
    renderLista(tipo);
    toast(tipo === 'ingreso' ? 'Ingreso registrado ✓' : 'Egreso registrado ✓');
    sincronizar(true);
  });
});

$('#form-deuda').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  db.deudas.push({
    id: uid(),
    fecha: f.fecha.value,
    persona: f.persona.value.trim(),
    concepto: f.concepto.value.trim(),
    monto: Number(f.monto.value),
    direccion: f.direccion.value,
    estado: 'pendiente',
    mod: Date.now()
  });
  save();
  f.monto.value = ''; f.persona.value = ''; f.concepto.value = '';
  renderDeudas();
  toast('Deuda registrada ✓');
  sincronizar(true);
});

/* ================= Listas ================= */
function renderLista(tipo) {
  const ul = $('#lista-' + tipo);
  const filtro = $('#filtro-' + tipo).value; // 'YYYY-MM' o ''
  let items = db.movimientos.filter(m => m.tipo === tipo);
  if (filtro) items = items.filter(m => m.fecha.startsWith(filtro));
  items.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
  if (!filtro) items = items.slice(0, 30);

  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li class="empty">Sin movimientos registrados</li>';
    return;
  }
  items.forEach(m => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-concepto">${esc(m.concepto)}</div>
        <div class="mov-detalle">${fmtFecha(m.fecha)}${m.obs ? ' · ' + esc(m.obs) : ''}</div>
      </div>
      <span class="mov-monto ${tipo === 'ingreso' ? 'monto-in' : 'monto-out'}">${tipo === 'ingreso' ? '+' : '−'}${fmt(m.monto)}</span>
      <button class="mov-del" title="Eliminar" data-id="${m.id}">✕</button>`;
    li.querySelector('.mov-del').addEventListener('click', () => borrarMovimiento(m.id, tipo));
    ul.appendChild(li);
  });
}

function borrarMovimiento(id, tipo) {
  const m = db.movimientos.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar ${m.tipo} de ${fmt(m.monto)} (${m.concepto})?`)) return;
  db.movimientos = db.movimientos.filter(x => x.id !== id);
  db.borrados.push({ id, mod: Date.now() });
  save();
  renderLista(tipo);
  toast('Movimiento eliminado');
  sincronizar(true);
}

function renderDeudas() {
  const ul = $('#lista-deuda');
  const filtro = $('#filtro-deuda').value;
  let items = [...db.deudas];
  if (filtro !== 'todas') items = items.filter(d => d.estado === filtro);
  items.sort((a, b) => b.fecha.localeCompare(a.fecha));

  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li class="empty">Sin deudas en esta vista</li>';
  }
  items.forEach(d => {
    const li = document.createElement('li');
    const dir = d.direccion === 'nos_deben' ? 'nos debe' : 'le debemos';
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-concepto">${esc(d.persona)} <small style="color:var(--gris);font-weight:400">(${dir})</small></div>
        <div class="mov-detalle">${fmtFecha(d.fecha)} · ${esc(d.concepto)}</div>
      </div>
      <span class="mov-monto ${d.direccion === 'nos_deben' ? 'monto-in' : 'monto-debt'}">${fmt(d.monto)}</span>
      <button class="mov-check ${d.estado === 'pagada' ? 'pagada' : ''}" data-id="${d.id}">
        ${d.estado === 'pagada' ? 'Pagada ✓' : 'Pendiente'}</button>
      <button class="mov-del" title="Eliminar" data-id="${d.id}">✕</button>`;
    li.querySelector('.mov-check').addEventListener('click', () => {
      d.estado = d.estado === 'pagada' ? 'pendiente' : 'pagada';
      d.mod = Date.now();
      save();
      renderDeudas();
      sincronizar(true);
    });
    li.querySelector('.mov-del').addEventListener('click', () => {
      if (!confirm(`¿Eliminar deuda de ${esc(d.persona)} por ${fmt(d.monto)}?`)) return;
      db.deudas = db.deudas.filter(x => x.id !== d.id);
      db.borrados.push({ id: d.id, mod: Date.now() });
      save();
      renderDeudas();
      toast('Deuda eliminada');
      sincronizar(true);
    });
    ul.appendChild(li);
  });

  // Totales
  const pend = db.deudas.filter(d => d.estado === 'pendiente');
  const debemos = pend.filter(d => d.direccion !== 'nos_deben').reduce((s, d) => s + d.monto, 0);
  const nosDeben = pend.filter(d => d.direccion === 'nos_deben').reduce((s, d) => s + d.monto, 0);
  $('#deuda-totales').innerHTML = `
    <div><span class="dr-label">Debemos</span><span class="dr-val" style="color:var(--rojo)">${fmt(debemos)}</span></div>
    <div><span class="dr-label">Nos deben</span><span class="dr-val" style="color:var(--verde-oscuro)">${fmt(nosDeben)}</span></div>
    <div><span class="dr-label">Neto</span><span class="dr-val">${fmt(nosDeben - debemos)}</span></div>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ================= Resumen ================= */
function mesesConDatos() {
  const set = new Set(db.movimientos.map(m => m.fecha.slice(0, 7)));
  set.add(hoy().slice(0, 7));
  return [...set].sort().reverse();
}

function initResumenSelector() {
  const sel = $('#resumen-periodo');
  const actual = sel.value;
  sel.innerHTML = '<option value="general">General (todo)</option>';
  mesesConDatos().forEach(ym => {
    const o = document.createElement('option');
    o.value = ym;
    o.textContent = nombreMes(ym);
    sel.appendChild(o);
  });
  sel.value = actual && [...sel.options].some(o => o.value === actual) ? actual : hoy().slice(0, 7);
}

function renderResumen() {
  initResumenSelector();
  const periodo = $('#resumen-periodo').value;
  const enPeriodo = m => periodo === 'general' || m.fecha.startsWith(periodo);

  const ingresos = db.movimientos.filter(m => m.tipo === 'ingreso' && enPeriodo(m));
  const egresos = db.movimientos.filter(m => m.tipo === 'egreso' && enPeriodo(m));
  const totIn = ingresos.reduce((s, m) => s + m.monto, 0);
  const totOut = egresos.reduce((s, m) => s + m.monto, 0);
  const balance = totIn - totOut;
  const deudaPend = db.deudas.filter(d => d.estado === 'pendiente' && d.direccion !== 'nos_deben')
    .reduce((s, d) => s + d.monto, 0);

  $('#kpi-ingresos').textContent = fmt(totIn);
  $('#kpi-egresos').textContent = fmt(totOut);
  const kb = $('#kpi-balance');
  kb.textContent = (balance < 0 ? '−' : '') + fmt(Math.abs(balance));
  kb.classList.toggle('neg', balance < 0);
  $('#kpi-deuda').textContent = fmt(deudaPend);

  renderDesglose('#desglose-ingresos', ingresos, totIn, false);
  renderDesglose('#desglose-egresos', egresos, totOut, true);
}

function renderDesglose(sel, items, total, esEgreso) {
  const cont = $(sel);
  if (!items.length) {
    cont.innerHTML = '<p class="empty">Sin datos en este período</p>';
    return;
  }
  const porConcepto = {};
  items.forEach(m => { porConcepto[m.concepto] = (porConcepto[m.concepto] || 0) + m.monto; });
  const filas = Object.entries(porConcepto).sort((a, b) => b[1] - a[1]);
  const max = filas[0][1];

  cont.innerHTML = filas.map(([nombre, monto]) => {
    const pct = total ? (monto / total * 100) : 0;
    return `<div class="dg-row">
      <span class="dg-name">${esc(nombre)}</span>
      <span class="dg-bar-wrap"><span class="dg-bar ${esEgreso ? 'out' : ''}" style="width:${(monto / max * 100).toFixed(1)}%"></span></span>
      <span class="dg-val">${fmt(monto)} <span class="dg-pct">${pct.toFixed(1)}%</span></span>
    </div>`;
  }).join('');
}

$('#resumen-periodo').addEventListener('change', renderResumen);

/* ================= Export / Import ================= */
$('#btnExport').addEventListener('click', () => {
  const nIn = db.movimientos.filter(m => m.tipo === 'ingreso').length;
  const nOut = db.movimientos.filter(m => m.tipo === 'egreso').length;
  $('#stats-line').textContent =
    `${nIn} ingresos · ${nOut} egresos · ${db.deudas.length} deudas registradas` +
    (db.actualizado ? ` · último cambio: ${new Date(db.actualizado).toLocaleString('es-AR')}` : '');
  actualizarSyncInfo();
  $('#modal-export').classList.remove('hidden');
});
$('#btnCloseModal').addEventListener('click', () => $('#modal-export').classList.add('hidden'));
$('#modal-export').addEventListener('click', e => {
  if (e.target.id === 'modal-export') $('#modal-export').classList.add('hidden');
});

function descargar(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#btnExportJson').addEventListener('click', () => {
  descargar('bioma-datos.json', JSON.stringify(db, null, 2), 'application/json');
  toast('Respaldo JSON descargado — subilo a Drive');
});

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

$('#btnExportCsv').addEventListener('click', () => {
  const filas = [['tipo', 'fecha', 'concepto', 'monto', 'observaciones']];
  [...db.movimientos]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .forEach(m => filas.push([m.tipo, m.fecha, m.concepto, m.monto, m.obs]));
  descargar('bioma-movimientos.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('CSV de movimientos descargado');
});

$('#btnExportCsvDeudas').addEventListener('click', () => {
  const filas = [['fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado']];
  db.deudas.forEach(d => filas.push([d.fecha, d.persona, d.concepto, d.monto,
    d.direccion === 'nos_deben' ? 'nos deben' : 'debemos', d.estado]));
  descargar('bioma-deudas.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('CSV de deudas descargado');
});

$('#inputImport').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const datos = JSON.parse(reader.result);
      if (!Array.isArray(datos.movimientos) || !Array.isArray(datos.deudas)) {
        throw new Error('formato inválido');
      }
      if (!confirm(`El respaldo tiene ${datos.movimientos.length} movimientos y ${datos.deudas.length} deudas.\n¿Reemplazar los datos actuales?`)) return;
      db = datos;
      db.conceptos = db.conceptos || structuredClone(CONCEPTOS_DEFAULT);
      save();
      initAll();
      toast('Respaldo importado ✓');
      $('#modal-export').classList.add('hidden');
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ================= Filtros ================= */
$('#filtro-ingreso').addEventListener('change', () => renderLista('ingreso'));
$('#filtro-egreso').addEventListener('change', () => renderLista('egreso'));
$('#filtro-deuda').addEventListener('change', renderDeudas);

/* ================= Sincronización con Google Sheets =================
   La app envía todo el estado local al Web App de Google Apps Script
   (archivo apps-script/Code.gs). El script fusiona con lo que hay en la
   planilla (gana la versión con `mod` más reciente, los tombstones de
   `borrados` propagan eliminaciones) y devuelve el estado consolidado. */

const SYNC_URL_KEY = 'bioma-sync-url';
let sincronizando = false;

function urlSync() { return localStorage.getItem(SYNC_URL_KEY) || ''; }

async function sincronizar(silencioso) {
  const url = urlSync();
  if (!url || sincronizando) return;
  sincronizando = true;
  setSyncEstado('⟳');
  const inicio = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      // sin Content-Type: evita el preflight CORS que Apps Script no soporta
      body: JSON.stringify({
        action: 'sync',
        movimientos: db.movimientos,
        deudas: db.deudas,
        borrados: db.borrados,
        conceptos: db.conceptos
      })
    });
    const remoto = await res.json();
    if (remoto.error) throw new Error(remoto.error);

    // Conservar lo creado localmente mientras viajaba la petición
    const idsRemotos = new Set([
      ...remoto.movimientos.map(m => m.id),
      ...remoto.deudas.map(d => d.id)
    ]);
    const nuevosLocales = m => !idsRemotos.has(m.id) && m.mod && m.mod > inicio;

    db.movimientos = [...remoto.movimientos, ...db.movimientos.filter(nuevosLocales)];
    db.deudas = [...remoto.deudas, ...db.deudas.filter(nuevosLocales)];
    db.conceptos = remoto.conceptos || db.conceptos;
    db.borrados = db.borrados.filter(b => b.mod > inicio);
    db.ultimaSync = new Date().toISOString();
    save();
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

function setSyncEstado(simbolo) {
  const b = $('#btnSync');
  if (!b) return;
  b.dataset.estado = simbolo;
  b.textContent = simbolo === '⟳' ? '⟳' : '↻';
  b.classList.toggle('sync-error', simbolo === '!');
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

function actualizarSyncInfo() {
  $('#sync-url').value = urlSync();
  $('#sync-status').textContent = urlSync()
    ? (db.ultimaSync ? 'Última sincronización: ' + new Date(db.ultimaSync).toLocaleString('es-AR') : 'Configurada, aún sin sincronizar')
    : 'Sin configurar — los datos solo viven en este dispositivo';
}

/* ================= Init ================= */
function initAll() {
  document.querySelectorAll('input[type=date]').forEach(i => { if (!i.value) i.value = hoy(); });
  initConceptos();
  renderLista('ingreso');
  renderLista('egreso');
  renderDeudas();
  renderResumen();
  actualizarSyncInfo();
}
initAll();
sincronizar(true); // al abrir, trae los cambios de los demás dispositivos

/* ================= Service worker (PWA offline) ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
