/* ============================================================
   Bioma · Gestión económica
   Arranque de la app: pestañas y primer dibujado.

   El código está repartido en js/ por tema:
     util.js  db.js  sincro.js  movimientos.js
     deudas.js  productos.js  resumen.js  respaldo.js
   Este archivo se carga último y los coordina.
   ============================================================ */

/* ================= Pestañas ================= */
const AL_ENTRAR = {
  resumen: () => renderResumen(),
  producto: () => renderProductos()
};

document.querySelectorAll('.tabbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    const al = AL_ENTRAR[btn.dataset.tab];
    if (al) al();
  });
});

/* ================= Init ================= */
function initAll() {
  document.querySelectorAll('input[type=date]').forEach(i => { if (!i.value) i.value = hoy(); });
  initConceptos();
  renderLista('ingreso');
  renderLista('egreso');
  renderDeudas();
  renderProductos();
  renderResumen();
  actualizarSyncInfo();
}

initAll();
configurarDesdeEnlace(); // alta de un dispositivo nuevo con #sync=<URL>
sincronizar(true);       // al abrir, trae los cambios del otro dispositivo

/* ================= Service worker (PWA offline) ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
