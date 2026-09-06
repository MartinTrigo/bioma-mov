/* ============================================================
   Resumen mensual y general.
   ============================================================ */

function mesesConDatos() {
  const set = new Set(db.movimientos.map(m => String(m.fecha).slice(0, 7)));
  set.add(hoy().slice(0, 7));
  return [...set].filter(Boolean).sort().reverse();
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
  sel.value = actual && [...sel.options].some(o => o.value === actual)
    ? actual : hoy().slice(0, 7);
}

function renderResumen() {
  initResumenSelector();
  const periodo = $('#resumen-periodo').value;
  const enPeriodo = m => periodo === 'general' || String(m.fecha).startsWith(periodo);

  const ingresos = db.movimientos.filter(m => m.tipo === 'ingreso' && enPeriodo(m));
  const egresos = db.movimientos.filter(m => m.tipo === 'egreso' && enPeriodo(m));
  const totIn = ingresos.reduce((s, m) => s + num(m.monto), 0);
  const totOut = egresos.reduce((s, m) => s + num(m.monto), 0);
  const balance = totIn - totOut;
  const deudaPend = db.deudas
    .filter(d => d.estado === 'pendiente' && d.direccion !== 'nos_deben')
    .reduce((s, d) => s + num(d.monto), 0);

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
  items.forEach(m => {
    porConcepto[m.concepto] = (porConcepto[m.concepto] || 0) + num(m.monto);
  });
  const filas = Object.entries(porConcepto).sort((a, b) => b[1] - a[1]);
  const max = filas[0][1] || 1;

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
