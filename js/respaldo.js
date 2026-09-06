/* ============================================================
   Respaldo: exportar / importar JSON y exportar CSV.
   ============================================================ */

$('#btnExport').addEventListener('click', () => {
  const nIn = db.movimientos.filter(m => m.tipo === 'ingreso').length;
  const nOut = db.movimientos.filter(m => m.tipo === 'egreso').length;
  $('#stats-line').textContent =
    `${nIn} ingresos · ${nOut} egresos · ${db.deudas.length} deudas · ` +
    `${db.productos.length} productos` +
    (db.actualizado ? ` · último cambio: ${new Date(db.actualizado).toLocaleString('es-AR')}` : '');
  actualizarSyncInfo();
  $('#modal-export').classList.remove('hidden');
});

$('#btnCloseModal').addEventListener('click', () => $('#modal-export').classList.add('hidden'));
$('#modal-export').addEventListener('click', e => {
  if (e.target.id === 'modal-export') $('#modal-export').classList.add('hidden');
});

$('#btnExportJson').addEventListener('click', () => {
  descargar('bioma-datos.json', JSON.stringify(db, null, 2), 'application/json');
  toast('Respaldo JSON descargado — subilo a Drive');
});

$('#btnExportCsv').addEventListener('click', () => {
  const filas = [['tipo', 'fecha', 'concepto', 'monto', 'observaciones']];
  [...db.movimientos]
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .forEach(m => filas.push([m.tipo, m.fecha, m.concepto, m.monto, m.obs]));
  descargar('bioma-movimientos.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('CSV de movimientos descargado');
});

$('#btnExportCsvDeudas').addEventListener('click', () => {
  const filas = [['fecha', 'persona', 'concepto', 'monto', 'tipo', 'estado']];
  db.deudas.forEach(d => filas.push([d.fecha, d.persona, d.concepto, d.monto,
    d.direccion === 'nos_deben' ? 'nos deben' : 'debemos', d.estado]));
  descargar('bioma-deudas.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('CSV de deudas descargado');
});

$('#inputImport').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const datos = JSON.parse(reader.result);
      if (!Array.isArray(datos.movimientos) || !Array.isArray(datos.deudas)) {
        throw new Error('formato inválido');
      }
      const msg = `El respaldo tiene ${datos.movimientos.length} movimientos, ` +
        `${datos.deudas.length} deudas y ${(datos.productos || []).length} productos.\n` +
        '¿Reemplazar los datos actuales?';
      if (!confirm(msg)) return;
      db = normalizar(datos);
      save();
      initAll();
      toast('Respaldo importado ✓');
      $('#modal-export').classList.add('hidden');
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
