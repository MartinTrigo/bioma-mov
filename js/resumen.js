/* ============================================================
   Resumen mensual y general.
   ============================================================ */

function mesesConDatos() {
  const set = new Set(db.movimientos.map(m => String(m.fecha).slice(0, 7)));
  (db.horas || []).forEach(h => set.add(String(h.mes)));
  set.add(hoy().slice(0, 7));
  return [...set].filter(Boolean).sort().reverse();
}

/* La temporada arranca en julio: "2026-27" va del 1/7/2026 al 30/6/2027.
   Es la unidad en la que se piensa la produccion —julio se planifica, agosto
   se siembra, noviembre entra la primera plata— asi que comparar dos meses
   sueltos dice poco y comparar temporadas dice todo. */
const MES_INICIO_TEMPORADA = 7;

function temporadaDe(ym) {
  const a = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7));
  const inicio = m >= MES_INICIO_TEMPORADA ? a : a - 1;
  return inicio + '-' + String((inicio + 1) % 100).padStart(2, '0');
}

function temporadasConDatos() {
  return [...new Set(mesesConDatos().map(temporadaDe))].sort().reverse();
}

function initResumenSelector() {
  const sel = $('#resumen-periodo');
  const actual = sel.value;
  sel.innerHTML = '';
  /* La temporada en curso va primera y es lo que se muestra al abrir. Antes
     arrancaba en el mes actual: en septiembre eso mostraba una rebanada y el
     resumen parecia mas pobre de lo que es. */
  temporadasConDatos().forEach(t => {
    const o = document.createElement('option');
    o.value = 'temp:' + t;
    o.textContent = 'Temporada ' + t;
    sel.appendChild(o);
  });
  sel.insertAdjacentHTML('beforeend', '<option value="general">General (todo)</option>');
  mesesConDatos().forEach(ym => {
    const o = document.createElement('option');
    o.value = ym;
    o.textContent = nombreMes(ym);
    sel.appendChild(o);
  });
  const porDefecto = 'temp:' + temporadaDe(hoy().slice(0, 7));
  sel.value = actual && [...sel.options].some(o => o.value === actual)
    ? actual
    : ([...sel.options].some(o => o.value === porDefecto) ? porDefecto : 'general');
}

/* Devuelve la funcion que decide si algo cae en el periodo elegido, sea una
   temporada, un mes o todo. Se usa igual para movimientos, horas y ventas. */
function filtroDePeriodo(periodo) {
  if (periodo === 'general') return () => true;
  if (String(periodo).startsWith('temp:')) {
    const t = String(periodo).slice(5);
    return ym => ym && temporadaDe(ym) === t;
  }
  return ym => String(ym || '').startsWith(periodo);
}

/* En que etapa del ciclo cae el mes. Sin esto, un balance negativo de
   septiembre se lee como una alarma cuando es lo esperable: las ventas recien
   empiezan en noviembre y las horas y los insumos se gastan desde julio. */
const ETAPAS_TEMPORADA = {
  7: 'julio: se planifica la temporada. Todavía no hay nada para vender, así que lo que entra suele ser préstamos.',
  8: 'agosto: primeras siembras. Se gasta en insumos y horas; las ventas no empiezan todavía.',
  9: 'septiembre: almácigos y primeros trasplantes. Un balance negativo en esta etapa es lo esperable.',
  10: 'octubre: trasplantes. Sigue siendo mes de gasto más que de ingreso.',
  11: 'noviembre: primeras cosechas, empiezan a entrar las ventas.',
  12: 'diciembre: cosecha y venta en marcha.',
  1: 'enero: plena cosecha, el mes fuerte de ingresos.',
  2: 'febrero: plena cosecha.',
  3: 'marzo: cosecha y venta.',
  4: 'abril: últimas cosechas de la temporada.',
  5: 'mayo: cierre de la temporada de venta.',
  6: 'junio: receso de invierno.',
};

function renderResumen() {
  initResumenSelector();
  const periodo = $('#resumen-periodo').value;
  const cae = filtroDePeriodo(periodo);
  const enPeriodo = m => cae(String(m.fecha || '').slice(0, 7));

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

  renderDetalle(periodo, ingresos, egresos, totIn, totOut);
  renderFlujo();
  renderDesglose('#desglose-ingresos', ingresos, totIn, false);
  renderDesglose('#desglose-egresos', egresos, totOut, true);
  renderVentas(periodo);
  renderHoras(periodo);
}

/* Lo que no cabe en un indicador pero se pregunta siempre: cuantos meses
   lleva el periodo, cuanto se mueve por mes, y cuanto del egreso son sueldos.
   Ese ultimo numero es el que ordena las decisiones de un colectivo. */
function renderDetalle(periodo, ingresos, egresos, totIn, totOut) {
  const meses = new Set([...ingresos, ...egresos]
    .map(m => String(m.fecha || '').slice(0, 7)).filter(x => x.length === 7));
  const n = meses.size || 1;
  const sueldos = egresos
    .filter(m => esConceptoSueldo(m.concepto))
    .reduce((s, m) => s + num(m.monto), 0);

  const partes = [];
  if (n > 1) {
    partes.push(`<span>${n} meses con movimiento</span>`);
    // Redondeado: en un promedio los centavos son ruido.
    partes.push(`<span>entra <strong>${fmt(Math.round(totIn / n))}</strong> por mes</span>`);
    partes.push(`<span>sale <strong>${fmt(Math.round(totOut / n))}</strong> por mes</span>`);
  }
  if (totOut) {
    partes.push(`<span>sueldos: <strong>${(sueldos / totOut * 100).toFixed(1)}%</strong> del egreso</span>`);
  }
  $('#resumen-detalle').innerHTML = partes.join('');

  // La etapa solo tiene sentido mirando un mes o la temporada en curso.
  const mes = String(periodo).startsWith('temp:')
    ? Number(hoy().slice(5, 7))
    : (periodo === 'general' ? 0 : Number(String(periodo).slice(5, 7)));
  $('#resumen-etapa').textContent = ETAPAS_TEMPORADA[mes] || '';
}

/* ================= Que se vendio =================
   El dato que solo esta acá: cada venta guarda un renglon por producto, con
   su plata y sus kilos. Ni la planilla de horas ni AMA pueden mostrar esto.

   Los kilos van al lado de la plata porque cuentan cosas distintas: un mes
   puede facturar bien vendiendo poco de algo caro, y eso se planifica de otra
   manera que vender mucho barato. */
function renderVentas(periodo) {
  const card = $('#card-ventas');
  const todas = db.ventas || [];
  if (!todas.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const cae = filtroDePeriodo(periodo);
  /* Un bolson abierto en sus componentes no se suma: ya se conto como unidad
     vendida. Todavia no existe en la carga, pero la guarda va puesta. */
  const items = todas.filter(v =>
    cae(String(v.fecha || '').slice(0, 7)) && v.origen !== 'bolson-abierto');

  const plata = items.reduce((s, v) => s + num(v.subtotal), 0);
  const kilos = items.reduce((s, v) => s + num(v.kg), 0);
  $('#ventas-total').innerHTML = items.length
    ? `<span><strong>${fmt(plata)}</strong> facturado</span>
       ${kilos ? `<span><strong>${kilos.toLocaleString('es-AR',
         { maximumFractionDigits: 1 })}</strong> kg</span>` : ''}
       <span>${items.length} ${items.length === 1 ? 'renglón' : 'renglones'}</span>`
    : '';

  if (!items.length) {
    $('#ventas-desglose').innerHTML = '<p class="empty">Sin ventas en este período</p>';
    return;
  }

  const vista = $('#ventas-vista').value;
  const categoriaDe = nombre => {
    const p = (db.productos || []).find(x => x.nombre === nombre);
    return (p && p.categoria) || 'sin categoría';
  };
  const etiqueta = v => {
    if (vista === 'cliente') return v.cliente || 'sin punto de venta';
    if (vista === 'categoria') return categoriaDe(v.producto);
    return v.producto || 'sin producto';
  };

  const por = {};
  items.forEach(v => {
    const k = etiqueta(v);
    const f = por[k] || (por[k] = { plata: 0, kg: 0 });
    f.plata += num(v.subtotal);
    f.kg += num(v.kg);
  });
  const filas = Object.entries(por).sort((a, b) => b[1].plata - a[1].plata);
  const max = filas[0][1].plata || 1;

  $('#ventas-desglose').innerHTML = filas.map(([nombre, f]) => {
    const pct = plata ? (f.plata / plata * 100) : 0;
    return `<div class="dg-row">
      <span class="dg-name">${esc(nombre)}</span>
      <span class="dg-bar-wrap"><span class="dg-bar" style="width:${(f.plata / max * 100).toFixed(1)}%"></span></span>
      <span class="dg-val">${fmt(f.plata)} <span class="dg-pct">${pct.toFixed(1)}%${
        f.kg ? ' · ' + f.kg.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' kg' : ''
      }</span></span>
    </div>`;
  }).join('');
}

$('#ventas-vista').addEventListener('change', renderResumen);

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

  const cae = filtroDePeriodo(periodo);
  const enPeriodo = h => cae(String(h.mes));
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
  const liquidado = devengadoTotal ? (pagado / devengadoTotal * 100) : 0;
  $('#horas-saldo').innerHTML = devengadoTotal
    ? `<span>Pendiente de liquidar en toda la temporada</span>
       <strong class="${saldo > 0 ? 'neg' : ''}">${fmt(saldo)}</strong>`
    : '';
  /* La proporcion dice mas que el monto: deber $4.000.000 con el 5% liquidado
     y deberlos con el 80% son dos situaciones distintas. */
  $('#horas-barra').innerHTML = devengadoTotal
    ? `<span class="liq-pista"><span class="liq-llena" style="width:${
         Math.max(0, Math.min(100, liquidado)).toFixed(1)}%"></span></span>
       <span class="liq-texto">${liquidado.toFixed(1)}% pagado · ${
         fmt(pagado)} de ${fmt(devengadoTotal)}</span>`
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
