/* ============================================================
   Egresos: alta, listado y baja.

   Los ingresos se cargan desde la pantalla de Ventas, que escribe el
   renglón de ingreso y —si hay productos— su detalle. Tener dos
   pantallas obligaba a cargar la misma venta dos veces.
   ============================================================ */

/* Conceptos que liquidan horas registradas: al elegirlos hay que decir a
   quién se le paga, porque de ahí sale el saldo pendiente de cada persona. */
const CONCEPTOS_SUELDO = ['sueldos'];

/* `honorarios` también pide el nombre, pero sin obligar: es plata para
   alguien de afuera —un tallerista, un gasista— que no tiene horas
   registradas ni cuenta. Sirve saber a quién se le pagó; no arma ninguna
   cuenta, porque Cuentas.gs solo mira los egresos de `sueldos`.
   No sumar `honorarios` a CONCEPTOS_SUELDO: ensuciaría las liquidaciones
   con pagos a gente que nunca registró una hora. */
const CONCEPTOS_CON_PERSONA = CONCEPTOS_SUELDO.concat(['honorarios']);

function esConceptoSueldo(c) {
  return CONCEPTOS_SUELDO.includes(clave(c));
}

function pidePersona(c) {
  return CONCEPTOS_CON_PERSONA.includes(clave(c));
}

/* Nombres seguros (07/10, objetivo 6). Un sueldo a "Lucas" cuando en las
   horas figura "Luqui" no da error: abre una cuenta aparte, con el pago de un
   lado y la deuda del otro. Por eso el nombre se ELIGE entre quienes tienen
   horas, escrito como figura en ellas. "Otra persona" queda para un
   adelanto a alguien que todavía no cargó, y pregunta antes. */
const OTRA_PERSONA = '__otra__';

function trabajadoresConHoras() {
  const vistos = {};
  (db.horas || []).forEach(h => {
    if (h.trabajador && !vistos[clave(h.trabajador)]) vistos[clave(h.trabajador)] = h.trabajador;
  });
  return Object.values(vistos).sort((a, b) => a.localeCompare(b, 'es'));
}

function llenarTrabajadores() {
  const sel = $('#form-egreso select[name=trabajador]');
  const actual = sel.value;
  const gente = trabajadoresConHoras();
  // Un adelanto ya aceptado, todavía sin guardar: no se pierde al redibujar.
  const extra = actual && actual !== OTRA_PERSONA && !gente.includes(actual) ? [actual] : [];
  sel.innerHTML = '<option value="">— elegí a quién —</option>' +
    gente.concat(extra).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') +
    `<option value="${OTRA_PERSONA}">Otra persona (adelanto)…</option>`;
  sel.value = actual === OTRA_PERSONA ? '' : actual;
}

function initConceptos() {
  llenarSelect($('#form-egreso select[name=concepto]'), db.conceptos.egresos, true);
  llenarTrabajadores();
  mostrarPersona();
}

function mostrarPersona() {
  const f = $('#form-egreso');
  const sueldo = esConceptoSueldo(f.concepto.value);
  $('#label-persona').classList.toggle('hidden', !pidePersona(f.concepto.value));
  // Medio y "hasta qué día cubre": solo para sueldos (hoja "pagos").
  $('#datos-pago').classList.toggle('hidden', !sueldo);
  // Sueldos: lista de quienes tienen horas. Honorarios: texto libre, porque
  // es alguien de afuera y sugerirle "Tomi" sería empujar al error.
  f.trabajador.classList.toggle('hidden', !sueldo);
  f.persona.classList.toggle('hidden', sueldo);
}

// Un adelanto a alguien sin horas: el nombre se escribe, pero a conciencia.
$('#form-egreso select[name=trabajador]').addEventListener('change', e => {
  const sel = e.target;
  if (sel.value !== OTRA_PERSONA) return;
  const nombre = (prompt('Nombre de quien cobra, exactamente como lo va a usar al cargar sus horas en AMA:') || '').trim();
  sel.value = '';
  if (!nombre) return;
  const ya = trabajadoresConHoras().find(n => clave(n) === clave(nombre));
  if (ya) { sel.value = ya; toast(`${ya} ya tiene horas: quedó elegido de la lista`); return; }
  if (!confirm(`Nadie llamado «${nombre}» tiene horas registradas.\n\n` +
      `Si en AMA figura con otro nombre (pasó con «Lucas» por «Luqui»), el pago va a quedar en ` +
      `una cuenta aparte y su deuda no va a bajar.\n\n¿Es un adelanto a alguien que todavía no cargó horas?`)) return;
  const o = document.createElement('option');
  o.value = nombre; o.textContent = nombre + ' (sin horas)';
  sel.insertBefore(o, sel.lastElementChild);
  sel.value = nombre;
});

// "+ agregar nuevo…" en los desplegables de concepto
['egreso'].forEach(tipo => {
  $(`#form-${tipo} select[name=concepto]`).addEventListener('change', e => {
    if (e.target.value !== '__nuevo__') return;
    const lista = db.conceptos[tipo + 's'];
    const nuevo = prompt('Nombre del nuevo concepto:');
    if (nuevo && nuevo.trim()) {
      const limpio = nuevo.trim();
      if (!lista.includes(limpio)) {
        lista.push(limpio);
        db.conceptosNuevos[tipo + 's'].push(limpio);
        save();
        sincronizar(true);
      }
      llenarSelect(e.target, lista, true);
      e.target.value = limpio;
    } else {
      e.target.value = lista[0] || '';
    }
    mostrarPersona();
  });
});

$('#form-egreso select[name=concepto]').addEventListener('change', mostrarPersona);

['egreso'].forEach(tipo => {
  $(`#form-${tipo}`).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const esSueldo = esConceptoSueldo(f.concepto.value);
    if (esSueldo && (!f.trabajador.value || f.trabajador.value === OTRA_PERSONA)) {
      toast('Elegí a quién se le paga');
      f.trabajador.focus();
      return;
    }
    db.movimientos.push({
      id: uid(),
      tipo,
      fecha: f.fecha.value,
      concepto: f.concepto.value,
      monto: num(f.monto.value),
      obs: f.obs.value.trim(),
      persona: esSueldo ? f.trabajador.value
        : pidePersona(f.concepto.value) ? f.persona.value.trim() : '',
      medio: esSueldo ? f.medio.value : '',
      periodo: esSueldo ? f.periodo.value : '',
      mod: Date.now()
    });
    save();
    f.monto.value = '';
    f.obs.value = '';
    f.persona.value = '';
    f.trabajador.value = '';
    llenarTrabajadores();   // saca el adelanto recién usado de la lista
    f.medio.value = '';
    f.periodo.value = '';
    renderLista(tipo);
    toast(tipo === 'ingreso' ? 'Ingreso registrado ✓' : 'Egreso registrado ✓');
    sincronizar(true);
  });
});

function renderLista(tipo) {
  const ul = $('#lista-' + tipo);
  const filtro = $('#filtro-' + tipo).value; // 'YYYY-MM' o ''
  let items = db.movimientos.filter(m => m.tipo === tipo);
  if (filtro) items = items.filter(m => String(m.fecha).startsWith(filtro));
  items.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) ||
    String(b.id).localeCompare(String(a.id)));
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
        <div class="mov-detalle">${fmtFecha(m.fecha)}${
          m.persona ? ' · ' + esc(m.persona) : ''}${
          m.medio ? ' · ' + esc(m.medio.toLowerCase()) : ''}${
          m.periodo ? ' · horas hasta ' + fmtFecha(m.periodo) : ''}${
          m.obs ? ' · ' + esc(m.obs) : ''}</div>
      </div>
      <span class="mov-monto ${tipo === 'ingreso' ? 'monto-in' : 'monto-out'}">${tipo === 'ingreso' ? '+' : '−'}${fmt(m.monto)}</span>
      <button class="mov-del" title="Eliminar">✕</button>`;
    li.querySelector('.mov-del').addEventListener('click', () => borrarMovimiento(m.id, tipo));
    ul.appendChild(li);
  });
}

function borrarMovimiento(id, tipo) {
  const m = db.movimientos.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar ${m.tipo} de ${fmt(m.monto)} (${m.concepto})?`)) return;
  db.movimientos = db.movimientos.filter(x => x.id !== id);
  sepultar(id);
  save();
  renderLista(tipo);
  toast('Movimiento eliminado');
  sincronizar(true);
}

$('#filtro-egreso').addEventListener('change', () => renderLista('egreso'));
