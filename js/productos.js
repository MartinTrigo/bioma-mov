/* ============================================================
   Catálogo de productos y precios.

   Se carga UN solo precio por producto: el de chacra. Los otros tres
   salen de un porcentaje sobre ese (Comarca +30%, Bariloche +50%,
   Verdulerías −20%), configurable en la hoja "listas".

   Si un producto necesita un precio distinto en una lista (por estado
   de la mercadería o por estrategia), se puede fijar a mano: ese valor
   queda escrito y deja de seguir el porcentaje hasta que se borre.
   ============================================================ */

const UNIDADES = ['kg', 'atado', 'unidad', 'bandeja', 'bolsa', 'planta', 'docena'];

function listaPorClave(clave) {
  return db.listas.find(l => l.clave === clave) || { clave, nombre: clave, ajuste: 0 };
}

// ¿El producto tiene un precio escrito a mano para esta lista?
function precioFijado(p, clave) {
  if (clave === 'chacra') return true;
  const v = p[clave];
  return v !== '' && v != null && num(v) > 0;
}

function precioDe(p, clave) {
  const base = num(p.chacra);
  if (clave === 'chacra') return base;
  if (precioFijado(p, clave)) return num(p[clave]);
  return Math.round(base * (1 + num(listaPorClave(clave).ajuste) / 100));
}

function productosOrdenados() {
  const q = ($('#buscar-producto').value || '').trim().toLowerCase();
  return db.productos
    .filter(p => !q || String(p.nombre).toLowerCase().includes(q))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

function renderProductos() {
  const cont = $('#lista-producto');
  const items = productosOrdenados();
  const activos = db.productos.filter(p => p.activo !== false).length;
  const sinPrecio = db.productos.filter(p => !num(p.chacra)).length;

  $('#producto-resumen').innerHTML =
    `<span>${db.productos.length} productos · ${activos} activos</span>` +
    (sinPrecio ? `<span class="alerta">${sinPrecio} sin precio</span>` : '');

  cont.innerHTML = '';
  if (!items.length) {
    cont.innerHTML = '<li class="empty">Sin productos. Tocá «+ Nuevo producto» o cargalos en la planilla.</li>';
    return;
  }

  items.forEach(p => {
    const li = document.createElement('li');
    li.className = 'prod-item' + (p.activo === false ? ' inactivo' : '');
    const precios = db.listas.map(l => {
      const fijado = l.clave !== 'chacra' && precioFijado(p, l.clave);
      return `<span class="prc ${fijado ? 'fijado' : ''}" title="${esc(l.nombre)}${fijado ? ' (precio fijado a mano)' : ''}">
          <span class="prc-lbl">${esc(l.nombre)}</span>
          <span class="prc-val">${num(p.chacra) ? fmt(precioDe(p, l.clave)) : '—'}</span>
        </span>`;
    }).join('');
    li.innerHTML = `
      <div class="prod-cab">
        <span class="prod-nombre">${esc(p.nombre)}</span>
        <span class="prod-unidad">${esc(p.presentacion || p.unidad || '')}</span>
      </div>
      <div class="prod-precios">${precios}</div>`;
    li.addEventListener('click', () => abrirProducto(p.id));
    cont.appendChild(li);
  });
}

/* ================= Alta y edición ================= */

let productoEditando = null;

function abrirProducto(id) {
  productoEditando = id || null;
  const p = id ? db.productos.find(x => x.id === id) : null;
  const f = $('#form-producto');

  llenarSelect(f.unidad, UNIDADES, false);
  f.nombre.value = p ? p.nombre : '';
  f.unidad.value = p && p.unidad ? p.unidad : 'kg';
  f.presentacion.value = p ? (p.presentacion || '') : '';
  f.chacra.value = p && num(p.chacra) ? num(p.chacra) : '';
  f.activo.checked = p ? p.activo !== false : true;

  // Un campo por lista derivada: vacío = sigue el porcentaje
  $('#precios-derivados').innerHTML = db.listas
    .filter(l => l.clave !== 'chacra')
    .map(l => `
      <label>${esc(l.nombre)} <small>(${l.ajuste > 0 ? '+' : ''}${l.ajuste}%)</small>
        <input type="number" inputmode="decimal" step="1" min="0"
               name="precio-${l.clave}" data-clave="${l.clave}"
               placeholder="automático">
      </label>`).join('');
  db.listas.filter(l => l.clave !== 'chacra').forEach(l => {
    const inp = f.querySelector(`[name="precio-${l.clave}"]`);
    if (p && precioFijado(p, l.clave)) inp.value = num(p[l.clave]);
  });

  $('#producto-titulo').textContent = id ? 'Editar producto' : 'Nuevo producto';
  $('#btnBorrarProducto').classList.toggle('hidden', !id);
  actualizarPreviewPrecios();
  $('#modal-producto').classList.remove('hidden');
  f.nombre.focus();
}

// Muestra cómo quedarían los precios mientras se escribe el de chacra
function actualizarPreviewPrecios() {
  const f = $('#form-producto');
  const ficticio = { chacra: num(f.chacra.value) };
  db.listas.filter(l => l.clave !== 'chacra').forEach(l => {
    const inp = f.querySelector(`[name="precio-${l.clave}"]`);
    ficticio[l.clave] = inp.value;
    inp.placeholder = num(f.chacra.value)
      ? 'automático: ' + fmt(Math.round(num(f.chacra.value) * (1 + num(l.ajuste) / 100)))
      : 'automático';
  });
}

$('#form-producto').addEventListener('input', e => {
  if (e.target.name === 'chacra') actualizarPreviewPrecios();
});

$('#form-producto').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  if (!nombre) return;

  const datos = {
    nombre,
    unidad: f.unidad.value,
    presentacion: f.presentacion.value.trim(),
    chacra: num(f.chacra.value),
    activo: f.activo.checked,
    mod: Date.now()
  };
  db.listas.filter(l => l.clave !== 'chacra').forEach(l => {
    const v = f.querySelector(`[name="precio-${l.clave}"]`).value;
    datos[l.clave] = v === '' ? '' : num(v);
  });

  if (productoEditando) {
    const p = db.productos.find(x => x.id === productoEditando);
    Object.assign(p, datos);
  } else {
    db.productos.push(Object.assign({ id: uid() }, datos));
  }
  save();
  cerrarProducto();
  renderProductos();
  toast(productoEditando ? 'Producto actualizado ✓' : 'Producto agregado ✓');
  sincronizar(true);
});

function cerrarProducto() {
  productoEditando = null;
  $('#modal-producto').classList.add('hidden');
}

$('#btnCerrarProducto').addEventListener('click', cerrarProducto);
$('#modal-producto').addEventListener('click', e => {
  if (e.target.id === 'modal-producto') cerrarProducto();
});
$('#btnNuevoProducto').addEventListener('click', () => abrirProducto(null));
$('#buscar-producto').addEventListener('input', renderProductos);

$('#btnBorrarProducto').addEventListener('click', () => {
  const p = db.productos.find(x => x.id === productoEditando);
  if (!p) return;
  if (!confirm(`¿Eliminar el producto "${p.nombre}"?`)) return;
  db.productos = db.productos.filter(x => x.id !== p.id);
  sepultar(p.id);
  save();
  cerrarProducto();
  renderProductos();
  toast('Producto eliminado');
  sincronizar(true);
});

/* ================= Aumento general ================= */

$('#btnAumentar').addEventListener('click', () => {
  const txt = prompt(
    'Aumentar el precio de chacra de TODOS los productos activos.\n' +
    'Porcentaje (podés poner un número negativo para bajar):', '10');
  if (txt === null) return;
  const pct = num(txt);
  if (!pct) { toast('Porcentaje inválido'); return; }

  const afectados = db.productos.filter(p => p.activo !== false && num(p.chacra) > 0);
  if (!afectados.length) { toast('No hay productos con precio'); return; }
  if (!confirm(`Se van a ajustar ${afectados.length} productos en ${pct > 0 ? '+' : ''}${pct}%.\n¿Confirmás?`)) return;

  afectados.forEach(p => {
    p.chacra = Math.round(num(p.chacra) * (1 + pct / 100));
    p.mod = Date.now();
  });
  save();
  renderProductos();
  toast(`${afectados.length} precios actualizados ✓`);
  sincronizar(true);
});

/* Exportar el catálogo con los cuatro precios ya calculados: sirve para
   imprimir la lista o mandarla por WhatsApp. */
$('#btnExportPrecios').addEventListener('click', () => {
  const cab = ['producto', 'unidad', 'presentación', ...db.listas.map(l => l.nombre)];
  const filas = [cab];
  productosOrdenados()
    .filter(p => p.activo !== false && num(p.chacra))
    .forEach(p => filas.push([
      p.nombre, p.unidad, p.presentacion || '',
      ...db.listas.map(l => precioDe(p, l.clave))
    ]));
  if (filas.length === 1) { toast('No hay productos con precio'); return; }
  descargar('bioma-precios.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('Lista de precios descargada');
});
