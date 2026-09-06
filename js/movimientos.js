/* ============================================================
   Ingresos y egresos: alta, listado y baja.
   ============================================================ */

function initConceptos() {
  llenarSelect($('#form-ingreso select[name=concepto]'), db.conceptos.ingresos, true);
  llenarSelect($('#form-egreso select[name=concepto]'), db.conceptos.egresos, true);
}

// "+ agregar nuevo…" en los desplegables de concepto
['ingreso', 'egreso'].forEach(tipo => {
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
  });
});

['ingreso', 'egreso'].forEach(tipo => {
  $(`#form-${tipo}`).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    db.movimientos.push({
      id: uid(),
      tipo,
      fecha: f.fecha.value,
      concepto: f.concepto.value,
      monto: num(f.monto.value),
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
        <div class="mov-detalle">${fmtFecha(m.fecha)}${m.obs ? ' · ' + esc(m.obs) : ''}</div>
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

$('#filtro-ingreso').addEventListener('change', () => renderLista('ingreso'));
$('#filtro-egreso').addEventListener('change', () => renderLista('egreso'));
