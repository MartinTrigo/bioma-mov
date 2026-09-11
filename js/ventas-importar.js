/* ============================================================
   Importar una descarga de ventas de la tienda virtual (Whataform).

   El archivo trae tres columnas: SKU, Producto y Cantidad Total.
   Guardar el .xlsx como CSV antes de subirlo (Archivo → Descargar →
   CSV): así no hace falta ninguna librería externa.

   Cómo se reconoce cada producto, en orden:
     1. SKU. Si el producto del catálogo tiene un SKU cargado y el archivo
        lo trae, se usa ese. Es exacto: el nombre publicado puede cambiar
        todo lo que quiera (promociones, variedades, formatos nuevos) que
        igual se reconoce.
     2. Nombre exacto del catálogo ("Acelga · atado 500g").
     3. Equivalencia aprendida: un nombre publicado que ya se resolvió
        antes a mano.
     4. Nada: queda pendiente y lo resuelve la persona. La app NUNCA
        inventa una equivalencia, porque errar acá ensucia el análisis de
        toda la temporada.
   ============================================================ */

let pendienteImportacion = null;

function equivalencias() {
  db.equivalencias = db.equivalencias || {};
  return db.equivalencias;
}

function buscarPorSku(sku) {
  const s = clave(sku);
  if (!s) return null;
  return db.productos.find(p => p.sku && clave(p.sku) === s) || null;
}

function resolverProducto(sku, nombre) {
  const porSku = buscarPorSku(sku);
  if (porSku) return { p: porSku, via: 'sku' };

  const exacto = buscarPorEtiqueta(nombre);
  if (exacto) return { p: exacto, via: 'nombre' };

  const soloNombre = productosVendibles().find(p => clave(p.nombre) === clave(nombre));
  if (soloNombre) return { p: soloNombre, via: 'nombre' };

  const idAprendido = equivalencias()[clave(nombre)];
  if (idAprendido) {
    const p = db.productos.find(x => x.id === idAprendido);
    if (p) return { p, via: 'aprendido' };
  }
  return { p: null, via: 'pendiente' };
}

function leerCsvVentas(texto) {
  const limpio = texto.replace(/^﻿/, '');
  const lineas = limpio.split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) throw new Error('el archivo está vacío');

  const sep = (lineas[0].split(';').length > lineas[0].split(',').length) ? ';' : ',';
  const cab = partirCsv(lineas[0], sep).map(clave);
  const col = nombres => {
    for (const n of nombres) { const i = cab.indexOf(n); if (i > -1) return i; }
    return -1;
  };
  const iSku = col(['sku', 'codigo']);
  const iProd = col(['producto', 'nombre']);
  const iCant = col(['cantidad total', 'cantidad', 'cant']);
  if (iProd < 0 || iCant < 0) {
    throw new Error('faltan las columnas "Producto" y "Cantidad Total"');
  }

  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const c = partirCsv(lineas[i], sep);
    const nombre = (c[iProd] || '').trim();
    const cantidad = num(c[iCant]);
    if (!nombre || !cantidad) continue;
    filas.push({ sku: iSku > -1 ? (c[iSku] || '').trim() : '', nombre, cantidad });
  }
  return filas;
}

$('#btnImportarVentas').addEventListener('click', () => $('#inputVentas').click());

$('#inputVentas').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const filas = leerCsvVentas(String(reader.result));
      if (!filas.length) { toast('El archivo no tiene ventas'); return; }
      pendienteImportacion = filas.map(f => {
        const r = resolverProducto(f.sku, f.nombre);
        return { ...f, prodId: r.p ? r.p.id : '', via: r.via };
      });
      abrirRevision();
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
});

/* ================= Pantalla de revisión ================= */

function abrirRevision() {
  const f = $('#form-venta');
  $('#rev-fecha').value = borrador && borrador.fecha ? borrador.fecha : hoy();
  llenarSelect($('#rev-cliente'), db.conceptos.ingresos, false);
  if (f.cliente.value) $('#rev-cliente').value = f.cliente.value;
  $('#rev-lista').innerHTML = db.listas
    .map(l => `<option value="${esc(l.clave)}">${esc(l.nombre)}</option>`).join('');
  pintarRevision();
  $('#modal-importar').classList.remove('hidden');
}

function pintarRevision() {
  const reconocidos = pendienteImportacion.filter(x => x.prodId).length;
  const pendientes = pendienteImportacion.length - reconocidos;
  $('#rev-resumen').innerHTML =
    `<strong>${pendienteImportacion.length}</strong> productos en el archivo · ` +
    `${reconocidos} reconocidos` +
    (pendientes ? ` · <span class="alerta">${pendientes} sin resolver</span>` : '');

  const opciones = productosVendibles()
    .map(p => `<option value="${p.id}">${esc(etiquetaProducto(p))}</option>`).join('');

  $('#rev-filas').innerHTML = pendienteImportacion.map((x, i) => `
    <div class="rev-fila ${x.prodId ? '' : 'sin-resolver'}">
      <div class="rev-origen">
        <span class="rev-nombre">${esc(x.nombre)}</span>
        <span class="rev-cant">${x.cantidad}</span>
      </div>
      <select class="rev-select" data-i="${i}">
        <option value="">— elegir producto —</option>
        ${opciones}
      </select>
      <span class="rev-via">${x.prodId ? viaTexto(x.via) : 'sin reconocer'}</span>
    </div>`).join('');

  $$('#rev-filas .rev-select').forEach(sel => {
    const i = Number(sel.dataset.i);
    sel.value = pendienteImportacion[i].prodId || '';
    sel.addEventListener('change', e => {
      pendienteImportacion[i].prodId = e.target.value;
      pendienteImportacion[i].via = e.target.value ? 'manual' : 'pendiente';
      pintarRevision();
    });
  });
}

function viaTexto(via) {
  return { sku: 'por SKU', nombre: 'por nombre',
    aprendido: 'aprendido', manual: 'elegido' }[via] || via;
}

$('#btnCerrarImportar').addEventListener('click', () => {
  pendienteImportacion = null;
  $('#modal-importar').classList.add('hidden');
});

$('#btnConfirmarImportar').addEventListener('click', () => {
  const validas = pendienteImportacion.filter(x => x.prodId);
  if (!validas.length) { toast('No hay ningún producto reconocido'); return; }
  const sinResolver = pendienteImportacion.length - validas.length;
  if (sinResolver && !confirm(
    `${sinResolver} producto(s) quedaron sin resolver y NO se van a importar.\n` +
    '¿Importar el resto igual?')) return;

  const fecha = $('#rev-fecha').value || hoy();
  const cliente = $('#rev-cliente').value;
  const lista = $('#rev-lista').value;
  const idVenta = uid();
  const ahora = Date.now();

  validas.forEach((x, i) => {
    const p = db.productos.find(y => y.id === x.prodId);
    const precio = precioDe(p, lista);
    // Lo resuelto a mano se recuerda: la próxima vez entra solo
    if (x.via === 'manual') equivalencias()[clave(x.nombre)] = p.id;
    db.ventas.push({
      id: uid(), venta: idVenta, fecha, cliente, lista,
      producto: p.nombre, presentacion: p.presentacion || '',
      unidad: p.unidad || 'unidad', cantidad: x.cantidad,
      kg: kgDe(p, x.cantidad),
      precio, subtotal: Math.round(x.cantidad * precio),
      origen: 'planilla', obs: x.nombre, mod: ahora + i
    });
  });

  save();
  pendienteImportacion = null;
  $('#modal-importar').classList.add('hidden');
  renderUltimasVentas();
  toast(`${validas.length} productos importados ✓`);
  sincronizar(true);
});
