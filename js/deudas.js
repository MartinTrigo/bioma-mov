/* ============================================================
   Deudas: lo que debemos y lo que nos deben.
   ============================================================ */

$('#form-deuda').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  db.deudas.push({
    id: uid(),
    fecha: f.fecha.value,
    persona: f.persona.value.trim(),
    concepto: f.concepto.value.trim(),
    monto: num(f.monto.value),
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

function renderDeudas() {
  const ul = $('#lista-deuda');
  const filtro = $('#filtro-deuda').value;
  let items = [...db.deudas];
  if (filtro !== 'todas') items = items.filter(d => d.estado === filtro);
  items.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  ul.innerHTML = '';
  if (!items.length) ul.innerHTML = '<li class="empty">Sin deudas en esta vista</li>';

  items.forEach(d => {
    const li = document.createElement('li');
    const dir = d.direccion === 'nos_deben' ? 'nos debe' : 'le debemos';
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-concepto">${esc(d.persona)} <small style="color:var(--gris);font-weight:400">(${dir})</small></div>
        <div class="mov-detalle">${fmtFecha(d.fecha)} · ${esc(d.concepto)}</div>
      </div>
      <span class="mov-monto ${d.direccion === 'nos_deben' ? 'monto-in' : 'monto-debt'}">${fmt(d.monto)}</span>
      <button class="mov-check ${d.estado === 'saldada' ? 'pagada' : ''}">
        ${d.estado === 'saldada' ? 'Saldada ✓' : 'Pendiente'}</button>
      <button class="mov-del" title="Eliminar">✕</button>`;

    li.querySelector('.mov-check').addEventListener('click', () => {
      d.estado = d.estado === 'saldada' ? 'pendiente' : 'saldada';
      d.mod = Date.now();
      save();
      renderDeudas();
      sincronizar(true);
    });
    li.querySelector('.mov-del').addEventListener('click', () => {
      if (!confirm(`¿Eliminar deuda de ${d.persona} por ${fmt(d.monto)}?`)) return;
      db.deudas = db.deudas.filter(x => x.id !== d.id);
      sepultar(d.id);
      save();
      renderDeudas();
      toast('Deuda eliminada');
      sincronizar(true);
    });
    ul.appendChild(li);
  });

  const pend = db.deudas.filter(d => d.estado === 'pendiente');
  const debemos = pend.filter(d => d.direccion !== 'nos_deben').reduce((s, d) => s + num(d.monto), 0);
  const nosDeben = pend.filter(d => d.direccion === 'nos_deben').reduce((s, d) => s + num(d.monto), 0);
  $('#deuda-totales').innerHTML = `
    <div><span class="dr-label">Debemos</span><span class="dr-val" style="color:var(--rojo)">${fmt(debemos)}</span></div>
    <div><span class="dr-label">Nos deben</span><span class="dr-val" style="color:var(--verde-oscuro)">${fmt(nosDeben)}</span></div>
    <div><span class="dr-label">Neto</span><span class="dr-val">${fmt(nosDeben - debemos)}</span></div>`;
}

$('#filtro-deuda').addEventListener('change', renderDeudas);
