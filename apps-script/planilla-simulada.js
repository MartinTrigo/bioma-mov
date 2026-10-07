/* Planilla simulada para probar Code.gs sin tocar bioma-db.
   La usan apps-script/pruebas-servidor.html y las pruebas de la app.
   No se publica como parte de la app (no está en sw.js) y no tiene datos reales. */

/* ============ La planilla simulada ============
   Imita lo que Code.gs usa de Google Sheets: hojas como tablas de valores,
   rangos que leen y escriben, borrar filas, ordenar. Cuenta las escrituras,
   que es lo que dice si el script reescribe todo o solo lo que cambió. */
let ESCRITURAS = 0;
const vacio = (c) => c === '' || c == null;

class Hoja {
  // Como Sheets: una cantidad fija de filas; escribir más allá da error.
  constructor(nombre) { this.nombre = nombre; this.datos = []; this.maxFilas = 1000; }
  getMaxRows() { return Math.max(this.maxFilas, this.datos.length); }
  insertRowsAfter(_, n) { this.maxFilas = this.getMaxRows() + n; }
  getName() { return this.nombre; }
  getLastRow() {
    for (let i = this.datos.length - 1; i >= 0; i--) if ((this.datos[i] || []).some((c) => !vacio(c))) return i + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.datos.forEach((f) => f.forEach((c, j) => { if (!vacio(c)) m = Math.max(m, j + 1); }));
    return m;
  }
  getRange(f, c, nf = 1, nc = 1) {
    if (typeof f === 'string') return new Rango(this, 1, 1, 1, 1);   // notación A1: no se usa en la sincronización
    if (f + nf - 1 > this.getMaxRows()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Rango(this, f, c, nf, nc);
  }
  getDataRange() { return new Rango(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(fila) { ESCRITURAS++; this.datos.splice(this.getLastRow(), 0, fila.slice()); }
  deleteRow(f) { ESCRITURAS++; this.datos.splice(f - 1, 1); }
  getCharts() { return []; } removeChart() {} insertChart() {}
  newChart() { const b = { setChartType: () => b, addRange: () => b, setPosition: () => b, setOption: () => b, build: () => ({}) }; return b; }
  setTabColor() { return this; } setFrozenRows() { return this; } setColumnWidth() { return this; }
  setRowHeight() { return this; } hideSheet() { return this; } clear() { ESCRITURAS++; this.datos = []; }
  celda(f, c) { return ((this.datos[f - 1] || [])[c - 1]); }
  poner(f, c, v) { while (this.datos.length < f) this.datos.push([]); const fila = this.datos[f - 1]; while (fila.length < c) fila.push(''); fila[c - 1] = v; }
}
class Rango {
  constructor(h, f, c, nf, nc) { Object.assign(this, { h, f, c, nf, nc }); }
  getRow() { return this.f; } getColumn() { return this.c; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nf; i++) {
      const fila = [];
      for (let j = 0; j < this.nc; j++) { const v = this.h.celda(this.f + i, this.c + j); fila.push(v === undefined ? '' : v); }
      out.push(fila);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    ESCRITURAS++;
    if (v.length !== this.nf || v.some((f) => f.length !== this.nc)) throw new Error(`setValues: el tamaño no coincide (${this.nf}×${this.nc})`);
    v.forEach((fila, i) => fila.forEach((x, j) => this.h.poner(this.f + i, this.c + j, x)));
    return this;
  }
  setValue(x) { ESCRITURAS++; this.h.poner(this.f, this.c, x); return this; }
  clearContent() { ESCRITURAS++; for (let i = 0; i < this.nf; i++) for (let j = 0; j < this.nc; j++) if (this.h.datos[this.f - 1 + i]) this.h.poner(this.f + i, this.c + j, ''); return this; }
  getFormula() { return ''; }
  sort(spec) {
    ESCRITURAS++;
    const specs = (Array.isArray(spec) ? spec : [spec]).map((s) => (typeof s === 'number' ? { column: s, ascending: true } : s));
    const filas = this.getValues();
    const clave = (v) => (v instanceof Date ? v.getTime() : v);
    filas.sort((a, b) => {
      const va = a.every(vacio), vb = b.every(vacio);
      if (va !== vb) return va ? 1 : -1;                 // los vacíos al final, como Sheets
      for (const s of specs) {
        const x = clave(a[s.column - this.c]), y = clave(b[s.column - this.c]);
        if (vacio(x) !== vacio(y)) return vacio(x) ? 1 : -1;
        if (x < y) return s.ascending === false ? 1 : -1;
        if (x > y) return s.ascending === false ? -1 : 1;
      }
      return 0;
    });
    filas.forEach((fila, i) => fila.forEach((x, j) => this.h.poner(this.f + i, this.c + j, x)));
    return this;
  }
}
// Todo lo de formato: no hace nada y se puede encadenar.
['setNumberFormat', 'setFontWeight', 'setBackground', 'setFontColor', 'setFontSize', 'merge', 'breakApart',
 'setHorizontalAlignment', 'setVerticalAlignment', 'setNote', 'setWrap', 'setBorder', 'setDataValidation',
 'setNumberFormats', 'setFontStyle'].forEach((m) => { Rango.prototype[m] = function () { return this; }; });

let PLANILLA;
function nuevaPlanilla(hojas) {
  PLANILLA = { hojas: {} };
  Object.entries(hojas).forEach(([n, filas]) => {
    const h = new Hoja(n); h.datos = filas.map((f) => f.slice()); PLANILLA.hojas[n] = h;
  });
}
const PROPS = {};
window.SpreadsheetApp = {
  getActive: () => ({
    getSheetByName: (n) => PLANILLA.hojas[n] || null,
    insertSheet: (n) => (PLANILLA.hojas[n] = new Hoja(n)),
    getSheets: () => Object.values(PLANILLA.hojas),
    deleteSheet: (h) => { delete PLANILLA.hojas[h.getName()]; },
  }),
};
window.SpreadsheetApp.getActiveSpreadsheet = window.SpreadsheetApp.getActive;
window.PropertiesService = {
  getDocumentProperties: () => ({ getProperty: (k) => PROPS[k] ?? null, setProperty: (k, v) => { PROPS[k] = v; }, deleteProperty: (k) => { delete PROPS[k]; } }),
  getScriptProperties: () => ({ getProperty: () => null }),
};
window.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
window.Session = { getScriptTimeZone: () => 'America/Argentina/Buenos_Aires' };
window.Utilities = {
  // Los dos formatos que usa Code.gs: el día entero y el mes solo.
  formatDate: (d, _tz, patron) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${
    patron === 'yyyy-MM' ? '' : `-${String(d.getDate()).padStart(2, '0')}`}`,
};
window.ContentService = { createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: 'json' } };
window.Charts = { ChartType: {} };
