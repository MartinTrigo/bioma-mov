/* ============================================================
   Bioma · Gestión económica
   Arranque de la app: pestañas y primer dibujado.

   El código está repartido en js/ por tema:
     util.js  db.js  sincro.js  movimientos.js
     deudas.js  productos.js  resumen.js  pagos.js  respaldo.js
   Este archivo se carga último y los coordina.
   ============================================================ */

/* ================= Pestañas ================= */
const AL_ENTRAR = {
  resumen: () => renderResumen(),
  proyeccion: () => entrarProyeccion(),
  producto: () => renderProductos(),
  venta: () => renderUltimasVentas(),
  pagos: () => renderPagos()
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

/* ================= Apariencia (10/10) =================
   ◐ pasa por: como el teléfono → clara → oscura. Queda guardada en este
   dispositivo (bioma_tema) y la lee también index.html antes de dibujar. */
const TEMAS = ['', 'claro', 'oscuro'];
const NOMBRE_TEMA = { '': 'como el teléfono', claro: 'clara', oscuro: 'oscura' };
const COLOR_BARRA = { claro: '#A33A55', oscuro: '#24141A' };
function aplicarTema(tema) {
  const html = document.documentElement;
  if (tema === 'claro' || tema === 'oscuro') html.dataset.tema = tema;
  else delete html.dataset.tema;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const propio = (m.media || '').includes('dark') ? COLOR_BARRA.oscuro : COLOR_BARRA.claro;
    m.content = COLOR_BARRA[tema] || propio;
  });
}
function temaGuardado() {
  try { return localStorage.getItem('bioma_tema') || ''; } catch (e) { return ''; }
}
$('#btnTema').addEventListener('click', () => {
  const siguiente = TEMAS[(TEMAS.indexOf(temaGuardado()) + 1) % TEMAS.length];
  try { localStorage.setItem('bioma_tema', siguiente); } catch (e) { /* sin almacenamiento: vale hasta cerrar */ }
  aplicarTema(siguiente);
  toast(`Apariencia ${NOMBRE_TEMA[siguiente]}`);
});
aplicarTema(temaGuardado());

/* ================= Init ================= */
function initAll() {
  document.querySelectorAll('input[type=date]').forEach(i => { if (!i.value) i.value = hoy(); });
  initConceptos();
  renderLista('egreso');
  renderDeudas();
  renderProductos();
  renderFormVenta();
  renderUltimasVentas();
  renderResumen();
  renderPagos();
  actualizarSyncInfo();
}

initAll();
configurarDesdeEnlace(); // alta de un dispositivo nuevo con #sync=<URL>
sincronizar(true);       // al abrir, trae los cambios del otro dispositivo

/* ================= Service worker (PWA offline) ================= */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
