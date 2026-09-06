/* ============================================================
   Utilidades compartidas por todos los módulos.
   Se carga primero: no depende de ningún otro archivo.
   ============================================================ */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const fmt = n => '$' + Number(n || 0).toLocaleString('es-AR',
  { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Convierte a número tolerando texto, vacío y formato con separadores.
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  const limpio = (s.indexOf(',') > -1 && s.lastIndexOf(',') > s.lastIndexOf('.'))
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/,/g, '');
  return Number(limpio) || 0;
}

function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function fmtFecha(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return d ? `${d}/${m}/${y.slice(2)}` : String(iso || '');
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function nombreMes(ym) { // 'YYYY-MM' -> 'julio 2026'
  const [y, m] = ym.split('-');
  return MESES[Number(m) - 1] + ' ' + y;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function descargar(nombre, contenido, mime) {
  const blob = new Blob([contenido], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Rellena un <select> con una lista de textos, conservando la selección.
function llenarSelect(select, lista, conNuevo) {
  const actual = select.value;
  select.innerHTML = '';
  lista.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    select.appendChild(o);
  });
  if (conNuevo) {
    const extra = document.createElement('option');
    extra.value = '__nuevo__';
    extra.textContent = '+ agregar nuevo…';
    select.appendChild(extra);
  }
  if (actual && lista.includes(actual)) select.value = actual;
}
