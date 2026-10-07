/* ============================================================
   Pagos a los trabajadores (objetivo 2 del plan de pagos, 07/10).

   La cuenta de cada persona: lo devengado por sus horas menos lo que se le
   pagó. Es la misma cuenta que arma Cuentas.gs para AMA Producción y la hoja
   "cuentas" de bioma-db; acá se arma con lo que la app ya tiene (db.horas y
   los egresos de sueldos), así anda también sin señal.

   Registrar un pago desde acá guarda lo mismo que Egresos con concepto
   "sueldos": un solo lugar donde vive la plata (la hoja egresos). La
   diferencia es que acá el nombre y el concepto vienen puestos, así que no
   hay cómo cargarlo a nombre de otro ni como honorarios. Egresos sigue
   sirviendo para cargarlos, como siempre.
   ============================================================ */

let cuentaAbierta = '';   // clave del trabajador que se está mirando

/* Todas las cuentas, la que más se le debe arriba. Los nombres se cruzan sin
   mayúsculas ni tildes ("Luqui" = "luqui"). Un pago a un nombre que no tiene
   horas queda en su propia cuenta y se avisa: suele ser un nombre mal escrito
   ("Lucas" por "Luqui"). */
function cuentasTrabajadores() {
  const gente = {};
  const cuenta = (nombre) => {
    const k = clave(nombre);
    return gente[k] || (gente[k] = { k, nombre, horas: 0, devengado: 0, pagado: 0,
                                     pagos: [], meses: {}, conHoras: false });
  };
  (db.horas || []).forEach(h => {
    if (!h.trabajador) return;
    const c = cuenta(h.trabajador);
    c.nombre = h.trabajador;            // el nombre como figura en las horas
    c.conHoras = true;
    c.horas += num(h.horas);
    c.devengado += num(h.devengado);
    const m = c.meses[h.mes] || (c.meses[h.mes] = { horas: 0, devengado: 0 });
    m.horas += num(h.horas);
    m.devengado += num(h.devengado);
  });
  db.movimientos
    .filter(m => m.tipo === 'egreso' && esConceptoSueldo(m.concepto))
    .forEach(m => {
      const c = cuenta(m.persona || '(sin persona)');
      c.pagado += num(m.monto);
      c.pagos.push(m);
    });
  return Object.values(gente).map(c => {
    c.saldo = c.devengado - c.pagado;
    // Una tarifa por persona: el devengado dividido las horas la da exacta.
    c.tarifa = c.horas ? c.devengado / c.horas : 0;
    c.pagos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    c.ultimo = c.pagos[0] ? c.pagos[0].fecha : '';
    c.liquidado = c.devengado ? Math.min(100, c.pagado / c.devengado * 100) : (c.pagado ? 100 : 0);
    return c;
  }).sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre));
}

const horasTxt = h => `${Number(h || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`;
const barraLiq = pct => `<span class="liq-pista"><span class="liq-llena" style="width:${
  Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></span>`;

function renderPagos() {
  const caja = $('#pagos-contenido');
  if (!caja) return;
  // Si se está escribiendo un pago, una sincronización que termina no lo borra.
  if (caja.contains(document.activeElement) && document.activeElement.form) return;

  const cuentas = cuentasTrabajadores();
  if (!cuentas.length) {
    caja.innerHTML = `<p class="empty">Todavía no hay horas registradas.
      Llegan desde AMA Producción con la sincronización.</p>`;
    return;
  }
  const abierta = cuentaAbierta && cuentas.find(c => c.k === cuentaAbierta);
  caja.innerHTML = abierta ? cuentaHTML(abierta) : listaHTML(cuentas);
  engancharPagos(abierta);
}

function listaHTML(cuentas) {
  const tot = cuentas.reduce((s, c) => ({ dev: s.dev + c.devengado, pag: s.pag + c.pagado }), { dev: 0, pag: 0 });
  const pct = tot.dev ? tot.pag / tot.dev * 100 : 0;
  return `
    <div class="kpis">
      <div class="kpi kpi-out"><span class="kpi-label">Devengado</span><span class="kpi-val">${fmt(tot.dev)}</span></div>
      <div class="kpi kpi-in"><span class="kpi-label">Pagado</span><span class="kpi-val">${fmt(tot.pag)}</span></div>
    </div>
    <div class="horas-saldo">
      <span>Pendiente de pagar</span>
      <strong class="${tot.dev - tot.pag > 0 ? 'neg' : ''}">${fmt(tot.dev - tot.pag)}</strong>
    </div>
    <div class="barra-liq">${barraLiq(pct)}<span class="liq-texto">${pct.toFixed(1)}% pagado</span></div>
    <p class="hint" style="margin-top:12px">Tocá a alguien para ver su cuenta y registrarle un pago.</p>
    <ul class="mov-list cuentas-lista">
      ${cuentas.map(c => `<li class="cuenta-fila" data-cuenta="${esc(c.k)}" role="button" tabindex="0">
        <div class="mov-info">
          <div class="mov-concepto">${esc(c.nombre)}${c.conHoras ? '' : ' <span class="alerta">⚠ sin horas</span>'}</div>
          <div class="mov-detalle">${horasTxt(c.horas)}${
            c.tarifa && c.saldo > 0 ? ` · le faltan ${horasTxt(c.saldo / c.tarifa)}` : ''}${
            c.ultimo ? ` · último pago ${fmtFecha(c.ultimo)}` : ' · sin pagos'}</div>
          ${barraLiq(c.liquidado)}
        </div>
        <span class="mov-monto ${c.saldo > 0 ? 'monto-debt' : 'monto-in'}">${fmt(c.saldo)}</span>
      </li>`).join('')}
    </ul>`;
}

function cuentaHTML(c) {
  const meses = Object.keys(c.meses).sort().reverse();
  const sugerido = c.saldo > 0 ? Math.round(c.saldo) : '';
  return `
    <button type="button" class="btn-ghost volver-cuentas">← Todas las cuentas</button>
    <h3 class="cuenta-nombre">${esc(c.nombre)}</h3>
    ${c.conHoras ? '' : `<p class="hint"><span class="alerta">⚠ Este nombre no tiene horas registradas.</span>
      Puede ser un pago cargado con otro nombre: corregilo en Egresos.</p>`}
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">Horas${c.tarifa ? ` · ${fmt(c.tarifa)}/h` : ''}</span><span class="kpi-val">${horasTxt(c.horas)}</span></div>
      <div class="kpi kpi-out"><span class="kpi-label">Devengado</span><span class="kpi-val">${fmt(c.devengado)}</span></div>
      <div class="kpi kpi-in"><span class="kpi-label">Pagado</span><span class="kpi-val">${fmt(c.pagado)}</span></div>
      <div class="kpi kpi-debt"><span class="kpi-label">Se le debe</span><span class="kpi-val ${c.saldo > 0 ? 'neg' : ''}">${fmt(c.saldo)}</span></div>
    </div>
    <div class="barra-liq">${barraLiq(c.liquidado)}<span class="liq-texto">${c.liquidado.toFixed(1)}% pagado${
      c.tarifa && c.saldo > 0 ? ` · faltan ${horasTxt(c.saldo / c.tarifa)}` : ''}</span></div>

    <form id="form-pago" class="form pago-form" autocomplete="off">
      <h3>Registrar pago</h3>
      <div class="row">
        <label>Fecha <input type="date" name="fecha" value="${hoy()}" required></label>
        <label>Monto ($) <input type="number" name="monto" inputmode="decimal" step="0.01" min="0.01"
               value="${sugerido}" required></label>
      </div>
      <div class="row">
        <label>Medio de pago
          <select name="medio">
            <option value="">—</option><option>Efectivo</option><option>Transferencia</option><option>Otro</option>
          </select>
        </label>
        <label>Cubre las horas hasta <input type="date" name="periodo" value="${hoy()}"></label>
      </div>
      <label>Observaciones <input type="text" name="obs" placeholder="detalle (opcional)"></label>
      <button type="submit" class="btn btn-out">Registrar pago a ${esc(c.nombre)}</button>
      <p class="hint" style="margin-top:8px">Queda como egreso de sueldos, igual que si se cargara en Egresos.</p>
    </form>

    <h3>Pagos <small class="hint">${c.pagos.length}</small></h3>
    ${c.pagos.length ? `<ul class="mov-list">${c.pagos.map(p => `<li>
        <div class="mov-info">
          <div class="mov-concepto">${fmtFecha(p.fecha)}</div>
          <div class="mov-detalle">${[p.medio ? esc(p.medio.toLowerCase()) : '',
            p.periodo ? 'horas hasta ' + fmtFecha(p.periodo) : '', p.obs ? esc(p.obs) : '']
            .filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <span class="mov-monto monto-out">${fmt(p.monto)}</span>
        <button class="mov-del" data-borrar-pago="${esc(p.id)}" title="Eliminar">✕</button>
      </li>`).join('')}</ul>` : '<p class="empty">Todavía no se le pagó nada.</p>'}

    <h3>Horas por mes</h3>
    ${meses.length ? `<ul class="mov-list">${meses.map(m => `<li>
        <div class="mov-info"><div class="mov-concepto">${nombreMes(m)}</div>
          <div class="mov-detalle">${horasTxt(c.meses[m].horas)}</div></div>
        <span class="mov-monto">${fmt(c.meses[m].devengado)}</span>
      </li>`).join('')}</ul>` : '<p class="empty">Sin horas registradas.</p>'}`;
}

function engancharPagos(abierta) {
  $$('#pagos-contenido [data-cuenta]').forEach(li => {
    const abrir = () => { cuentaAbierta = li.dataset.cuenta; renderPagos(); window.scrollTo(0, 0); };
    li.addEventListener('click', abrir);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(); });
  });
  const volver = $('#pagos-contenido .volver-cuentas');
  if (volver) volver.addEventListener('click', () => { cuentaAbierta = ''; renderPagos(); });
  $$('#pagos-contenido [data-borrar-pago]').forEach(b => b.addEventListener('click', () => {
    borrarMovimiento(b.dataset.borrarPago, 'egreso');
    renderPagos();
  }));

  const f = $('#form-pago');
  if (!f || !abierta) return;
  f.addEventListener('submit', e => {
    e.preventDefault();
    const monto = num(f.monto.value);
    if (!(monto > 0)) { toast('Poné el monto'); return; }
    // Un adelanto es posible, pero que sea a propósito.
    if (monto > abierta.saldo + 0.5 &&
        !confirm(`El pago (${fmt(monto)}) es más de lo que se le debe (${fmt(abierta.saldo)}). ¿Registrarlo igual?`)) return;
    db.movimientos.push({
      id: uid(), tipo: 'egreso', fecha: f.fecha.value, concepto: 'sueldos',
      monto, obs: f.obs.value.trim(), persona: abierta.nombre,
      medio: f.medio.value, periodo: f.periodo.value, mod: Date.now()
    });
    save();
    // Sale del formulario: si no, renderPagos cree que se sigue escribiendo.
    if (document.activeElement) document.activeElement.blur();
    renderLista('egreso');
    renderPagos();
    toast(`Pago a ${abierta.nombre} registrado ✓`);
    sincronizar(true);
  });
}
