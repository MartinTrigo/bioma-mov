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

  renderFlujo();
  renderDesglose('#desglose-ingresos', ingresos, totIn, false);
  renderDesglose('#desglose-egresos', egresos, totOut, true);
}

/* ================= Flujo de fondos mes a mes =================
   El mismo dato que la hoja "resumen" de la planilla, pero acá se puede
   mirar desde el teléfono. Barras hacia arriba lo que entró, hacia abajo
   lo que salió, con el saldo del mes y el acumulado de la temporada.
   No usa ninguna librería: son divs con altura proporcional. */

function flujoPorMes() {
  const meses = {};
  db.movimientos.forEach(m => {
    const k = String(m.fecha || '').slice(0, 7);
    if (k.length !== 7) return;
    const f = meses[k] || (meses[k] = { mes: k, ingresos: 0, egresos: 0 });
    if (m.tipo === 'ingreso') f.ingresos += num(m.monto);
    else f.egresos += num(m.monto);
  });
  const lista = Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes));
  let acum = 0;
  lista.forEach(f => {
    f.resultado = f.ingresos - f.egresos;
    acum += f.resultado;
    f.acumulado = acum;
  });
  return lista;
}

function renderFlujo() {
  const lista = flujoPorMes();
  const cont = $('#flujo-grafico');
  const tabla = $('#flujo-tabla');
  if (!lista.length) {
    cont.innerHTML = '';
    tabla.innerHTML = '<p class="empty">Todavía no hay movimientos</p>';
    return;
  }

  // Las barras se miden contra el mes más grande, para que se comparen entre sí
  const max = Math.max(...lista.map(f => Math.max(f.ingresos, f.egresos))) || 1;
  cont.innerHTML = lista.map(f => `
    <div class="fg-mes" title="${esc(nombreMes(f.mes))}">
      <div class="fg-barras">
        <span class="fg-in" style="height:${(f.ingresos / max * 100).toFixed(1)}%"
              title="Ingresos ${fmt(f.ingresos)}"></span>
        <span class="fg-out" style="height:${(f.egresos / max * 100).toFixed(1)}%"
              title="Egresos ${fmt(f.egresos)}"></span>
      </div>
      <span class="fg-lbl">${f.mes.slice(5)}/${f.mes.slice(2, 4)}</span>
    </div>`).join('');

  tabla.innerHTML = `
    <table class="tabla-flujo">
      <tr><th>mes</th><th>entró</th><th>salió</th><th>saldo</th><th>acum.</th></tr>
      ${lista.slice().reverse().map(f => `
        <tr>
          <td>${esc(nombreMes(f.mes).slice(0, 3))} ${f.mes.slice(2, 4)}</td>
          <td class="num in">${fmt(f.ingresos)}</td>
          <td class="num out">${fmt(f.egresos)}</td>
          <td class="num ${f.resultado < 0 ? 'neg' : 'pos'}">${f.resultado < 0 ? '−' : ''}${fmt(Math.abs(f.resultado))}</td>
          <td class="num ${f.acumulado < 0 ? 'neg' : ''}">${f.acumulado < 0 ? '−' : ''}${fmt(Math.abs(f.acumulado))}</td>
        </tr>`).join('')}
    </table>`;
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
