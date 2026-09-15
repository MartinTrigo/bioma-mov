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
  renderHoras(periodo);
}

/* ================= Horas de trabajo =================
   Vienen de la planilla de registro de horas (otro formulario) y son el
   grueso del costo de la temporada. Acá se ven por área —en qué se
   trabaja— y por persona —quién hizo qué—, con lo devengado al lado.

   Lo devengado NO es un egreso hasta que se paga: mientras tanto es plata
   que el proyecto debe. Por eso se muestra aparte del balance. */

function renderHoras(periodo) {
  const card = $('#card-horas');
  const horas = db.horas || [];
  if (!horas.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const enPeriodo = h => periodo === 'general' || String(h.mes) === periodo;
  const items = horas.filter(enPeriodo);
  const vista = $('#horas-vista').value;

  const totHoras = items.reduce((s, h) => s + num(h.horas), 0);
  const totPlata = items.reduce((s, h) => s + num(h.devengado), 0);
  /* El saldo se mira siempre sobre TODA la temporada, no sobre el mes
     elegido: lo que se debe no se reinicia cada mes. */
  const devengadoTotal = horas.reduce((s, h) => s + num(h.devengado), 0);
  const pagado = db.movimientos
    .filter(m => m.tipo === 'egreso' && esConceptoSueldo(m.concepto))
    .reduce((s, m) => s + num(m.monto), 0);
  const saldo = devengadoTotal - pagado;

  $('#horas-total').innerHTML = items.length
    ? `<span><strong>${totHoras.toLocaleString('es-AR')}</strong> horas</span>
       <span>devengado <strong>${fmt(totPlata)}</strong></span>`
    : '';
  $('#horas-saldo').innerHTML = devengadoTotal
    ? `<span>Pendiente de liquidar en toda la temporada</span>
       <strong class="${saldo > 0 ? 'neg' : ''}">${fmt(saldo)}</strong>`
    : '';

  if (!items.length) {
    $('#horas-desglose').innerHTML = '<p class="empty">Sin horas en este período</p>';
    return;
  }

  /* Por actividad se muestra "Área · actividad": saber que hubo 30 horas
     de "Planificación" sirve poco; lo que importa es de qué área fueron. */
  const etiqueta = h => {
    if (vista === 'area') return h.area || 'sin área';
    if (vista === 'trabajador') return h.trabajador || 'sin nombre';
    return `${h.area || 'sin área'} · ${h.actividad || 'sin actividad'}`;
  };
  const por = {};
  items.forEach(h => {
    const k = etiqueta(h);
    por[k] = (por[k] || 0) + num(h.horas);
  });
  const filas = Object.entries(por).sort((a, b) => b[1] - a[1]);
  const max = filas[0][1] || 1;

  $('#horas-desglose').innerHTML = filas.map(([nombre, hs]) => {
    const pct = totHoras ? (hs / totHoras * 100) : 0;
    return `<div class="dg-row">
      <span class="dg-name">${esc(nombre)}</span>
      <span class="dg-bar-wrap"><span class="dg-bar horas" style="width:${(hs / max * 100).toFixed(1)}%"></span></span>
      <span class="dg-val">${hs.toLocaleString('es-AR')} h <span class="dg-pct">${pct.toFixed(1)}%</span></span>
    </div>`;
  }).join('');
}

$('#horas-vista').addEventListener('change', renderResumen);

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

/* El gráfico del flujo: barras y dos líneas en el mismo par de ejes.

   - Las BARRAS son el saldo del mes: verdes hacia arriba cuando quedó a
     favor, rojas hacia abajo cuando faltó. Es lo que se quiere ver de un
     vistazo, así que van de fondo, suaves.
   - Las LÍNEAS son lo que entró y lo que salió, mes a mes. Muestran de
     dónde salió ese saldo: un mes puede cerrar en cero moviendo mucho o
     moviendo nada, y eso no es lo mismo.

   Comparten un solo eje a propósito, y no es una comodidad: como el saldo
   es la resta, **la distancia vertical entre las dos líneas es la altura
   de la barra**. Las dos cosas cuentan lo mismo y se refuerzan. El precio
   es que en meses de mucho movimiento y poco saldo la barra queda chica
   al lado de las líneas, pero eso es exactamente el dato.

   SVG a mano, sin librerías: el proyecto no tiene dependencias ni
   compilación, y esto son treinta líneas. */
function graficoFlujo(lista) {
  const ANCHO_MES = 46, ALTO = 150, ARRIBA = 12, ABAJO = 20;
  const util = ALTO - ARRIBA - ABAJO;
  const ancho = Math.max(lista.length * ANCHO_MES, 1);

  // El eje abarca lo más alto que haya y, si algún mes cerró en rojo, baja hasta ahí
  const techo = Math.max(...lista.map(f => Math.max(f.ingresos, f.egresos, f.resultado)), 1);
  const piso = Math.min(0, ...lista.map(f => f.resultado));
  const y = v => ARRIBA + (techo - v) / ((techo - piso) || 1) * util;
  const x = i => i * ANCHO_MES + ANCHO_MES / 2;
  const cero = y(0);

  const barras = lista.map((f, i) => {
    const pos = f.resultado >= 0;
    const alto = Math.abs(cero - y(f.resultado));
    const signo = f.resultado < 0 ? '−' : '';
    return `<g><title>${esc(nombreMes(f.mes))}
entró ${fmt(f.ingresos)} · salió ${fmt(f.egresos)}
saldo ${signo}${fmt(Math.abs(f.resultado))}</title>
      <rect class="fg-barra ${pos ? 'pos' : 'neg'}" x="${x(i) - 11}"
            y="${(pos ? y(f.resultado) : cero).toFixed(1)}"
            width="22" height="${Math.max(alto, 1).toFixed(1)}" rx="2"/></g>`;
  }).join('');

  const linea = (campo, clase) =>
    `<polyline class="fg-linea ${clase}" points="${
      lista.map((f, i) => `${x(i)},${y(f[campo]).toFixed(1)}`).join(' ')}"/>` +
    lista.map((f, i) => `<circle class="fg-punto ${clase}" cx="${x(i)}"
      cy="${y(f[campo]).toFixed(1)}" r="2.5"/>`).join('');

  const etiquetas = lista.map((f, i) =>
    `<text class="fg-lbl" x="${x(i)}" y="${ALTO - 6}" text-anchor="middle"
     >${f.mes.slice(5)}/${f.mes.slice(2, 4)}</text>`).join('');

  return `
    <div class="fg-leyenda">
      <span><i class="m-barra"></i> saldo del mes</span>
      <span><i class="m-in"></i> entró</span>
      <span><i class="m-out"></i> salió</span>
    </div>
    <div class="fg-scroll">
      <svg viewBox="0 0 ${ancho} ${ALTO}" width="${ancho}" height="${ALTO}"
           role="img" aria-label="Flujo de fondos mes a mes">
        <line class="fg-cero" x1="0" y1="${cero.toFixed(1)}" x2="${ancho}" y2="${cero.toFixed(1)}"/>
        ${barras}
        ${linea('egresos', 'out')}
        ${linea('ingresos', 'in')}
        ${etiquetas}
      </svg>
    </div>`;
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

  cont.innerHTML = graficoFlujo(lista);

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
