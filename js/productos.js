/* ============================================================
   Catálogo de productos y precios.

   Se carga UN solo precio por producto: el de chacra. Los otros tres
   salen de un porcentaje sobre ese (Comarca +30%, Bariloche +50%,
   Verdulerías −20%), configurable en la hoja "listas".

   Si un producto necesita un precio distinto en una lista (por estado
   de la mercadería o por estrategia), se puede fijar a mano: ese valor
   queda escrito y deja de seguir el porcentaje hasta que se borre.
   ============================================================ */

const UNIDADES = ['kg', 'atado', 'unidad', 'bandeja', 'bolsa', 'planta', 'docena',
  'pack', 'frasco', 'botella', 'maple'];

/* Rubros del catálogo. Con ~120 productos, un desplegable sin filtrar es
   inusable: la categoría es lo que hace navegable el catálogo y lo que
   después permite mirar las ventas por rubro.
   "bolsón" es un producto compuesto: se vende como unidad y además se
   abre en lo que lleva adentro (Fase 4). */
const CATEGORIAS = ['hortaliza', 'fruta', 'congelado', 'elaborado',
  'bioinsumo', 'animal', 'bolsón', 'otro'];

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

function categoriaDe(p) {
  return String(p.categoria || 'hortaliza').trim().toLowerCase();
}

function productosOrdenados() {
  const q = clave($('#buscar-producto').value || '');
  const cat = $('#filtro-categoria') ? $('#filtro-categoria').value : '';
  return db.productos
    .filter(p => !cat || categoriaDe(p) === cat)
    .filter(p => !q || clave(p.nombre).includes(q))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

// Rellena el filtro con las categorías que realmente tienen productos
function initFiltroCategorias() {
  const sel = $('#filtro-categoria');
  if (!sel) return;
  const actual = sel.value;
  const cuenta = {};
  db.productos.forEach(p => {
    const c = categoriaDe(p);
    cuenta[c] = (cuenta[c] || 0) + 1;
  });
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  CATEGORIAS.filter(c => cuenta[c]).forEach(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c.charAt(0).toUpperCase() + c.slice(1) + ' (' + cuenta[c] + ')';
    sel.appendChild(o);
  });
  if (actual && [...sel.options].some(o => o.value === actual)) sel.value = actual;
}

function renderProductos() {
  const cont = $('#lista-producto');
  initFiltroCategorias();
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
      <div class="prod-precios">${precios}</div>
      <span class="prod-cat cat-${esc(categoriaDe(p))}">${esc(categoriaDe(p))}</span>`;
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
  llenarSelect(f.categoria, CATEGORIAS, false);
  f.nombre.value = p ? p.nombre : '';
  f.unidad.value = p && p.unidad ? p.unidad : 'kg';
  // Al crear, se propone la categoría que está filtrada en pantalla
  f.categoria.value = p ? categoriaDe(p)
    : (($('#filtro-categoria') && $('#filtro-categoria').value) || 'hortaliza');
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
    categoria: f.categoria.value,
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
$('#filtro-categoria').addEventListener('change', renderProductos);

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

/* ================= Importar catálogo desde CSV =================
   Sirve para la carga inicial y para actualizaciones en bloque hechas
   en una planilla. Se reconoce por el nombre del producto: los que ya
   existen se actualizan, los nuevos se agregan. Nunca borra productos
   ni pisa un precio existente con un valor vacío o cero. */

// Divide una línea de CSV respetando las comillas dobles.
function partirCsv(linea, sep) {
  const out = [];
  let campo = '', dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (dentro) {
      if (c === '"' && linea[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') dentro = false;
      else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === sep) { out.push(campo); campo = ''; }
    else campo += c;
  }
  out.push(campo);
  return out.map(s => s.trim());
}

// Nombre de columna sin acentos ni mayúsculas, para reconocer encabezados
function clave(s) {
  const ACENTOS = new RegExp('[\u0300-\u036f]', 'g');
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(ACENTOS, '');
}

function leerCsvProductos(texto) {
  const limpio = texto.replace(/^﻿/, ''); // marca de orden de bytes
  const lineas = limpio.split(/\r?\n/).filter(l => l.trim());
  if (!lineas.length) throw new Error('el archivo está vacío');

  // Separador: coma o punto y coma, el que más aparezca en el encabezado
  const sep = (lineas[0].split(';').length > lineas[0].split(',').length) ? ';' : ',';
  const cab = partirCsv(lineas[0], sep).map(clave);

  const col = nombres => {
    for (const n of nombres) {
      const i = cab.indexOf(n);
      if (i > -1) return i;
    }
    return -1;
  };
  const iNombre = col(['nombre', 'producto']);
  if (iNombre < 0) throw new Error('no encuentro la columna "nombre" (o "producto")');
  const idx = {
    unidad: col(['unidad']),
    categoria: col(['categoria', 'rubro']),
    presentacion: col(['presentacion']),
    chacra: col(['chacra', 'precio chacra']),
    comarca: col(['comarca', 'comarca (fijo)']),
    bariloche: col(['bariloche', 'bariloche (fijo)']),
    verduleria: col(['verduleria', 'verdulerias', 'verdulerias (fijo)']),
    activo: col(['activo'])
  };

  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const c = partirCsv(lineas[i], sep);
    const nombre = (c[iNombre] || '').trim();
    if (!nombre) continue;
    const val = k => (idx[k] > -1 ? (c[idx[k]] || '').trim() : '');
    filas.push({
      nombre,
      unidad: val('unidad'),
      categoria: val('categoria'),
      presentacion: val('presentacion'),
      chacra: val('chacra'),
      comarca: val('comarca'),
      bariloche: val('bariloche'),
      verduleria: val('verduleria'),
      activo: val('activo')
    });
  }
  return filas;
}

/* Un producto se identifica por nombre + presentación, no solo por nombre:
   "Miel 500 g" y "Miel 1 kg" son dos productos distintos con el mismo
   nombre. Identificarlos solo por el nombre hacía que uno pisara al otro
   al importar. */
function claveProducto(nombre, presentacion) {
  return clave(nombre) + '|' + clave(presentacion || '');
}

function aplicarImportacion(filas) {
  const porClave = {};
  db.productos.forEach(p => { porClave[claveProducto(p.nombre, p.presentacion)] = p; });

  let nuevos = 0, actualizados = 0, sinPrecio = 0;
  filas.forEach(f => {
    const k = claveProducto(f.nombre, f.presentacion);
    const existente = porClave[k];
    const p = existente || { id: uid(), nombre: f.nombre, chacra: 0 };

    if (f.unidad) p.unidad = f.unidad;
    else if (!p.unidad) p.unidad = 'kg';
    if (f.categoria) p.categoria = f.categoria.trim().toLowerCase();
    else if (!p.categoria) p.categoria = 'hortaliza';
    if (f.presentacion) p.presentacion = f.presentacion;
    // Un precio vacío o en cero no pisa lo que ya había cargado
    if (num(f.chacra) > 0) p.chacra = num(f.chacra);
    ['comarca', 'bariloche', 'verduleria'].forEach(k => {
      if (num(f[k]) > 0) p[k] = num(f[k]);
      else if (p[k] === undefined) p[k] = '';
    });
    if (f.activo) p.activo = !/^(no|false|0|inactivo)$/i.test(f.activo);
    else if (p.activo === undefined) p.activo = true;
    p.mod = Date.now();

    if (!num(p.chacra)) sinPrecio++;
    if (existente) { actualizados++; } else {
      db.productos.push(p);
      porClave[claveProducto(p.nombre, p.presentacion)] = p;
      nuevos++;
    }
  });
  return { nuevos, actualizados, sinPrecio };
}

$('#btnImportarProductos').addEventListener('click', () => $('#inputProductos').click());

$('#inputProductos').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const filas = leerCsvProductos(String(reader.result));
      if (!filas.length) { toast('El archivo no tiene productos'); return; }

      const conocidos = new Set(db.productos.map(p => claveProducto(p.nombre, p.presentacion)));
      const aCrear = filas.filter(f => !conocidos.has(claveProducto(f.nombre, f.presentacion))).length;
      const aActualizar = filas.length - aCrear;
      const msg = `El archivo tiene ${filas.length} productos:\n` +
        `· ${aCrear} nuevos\n· ${aActualizar} que ya existen y se actualizan\n\n` +
        'No se borra ningún producto ni se pisan precios con valores vacíos.\n¿Importar?';
      if (!confirm(msg)) return;

      const r = aplicarImportacion(filas);
      save();
      renderProductos();
      toast(`${r.nuevos} nuevos, ${r.actualizados} actualizados ✓`);

      // Importar sin sincronización configurada dejaba el catálogo en un
      // solo equipo sin que nada lo dijera: ahora se avisa fuerte.
      if (!urlSync()) {
        setTimeout(() => alert(
          'Los productos quedaron guardados SOLO en este dispositivo.\n\n' +
          'Para que lleguen a la planilla y a los demás teléfonos, configurá ' +
          'la URL de sincronización en el botón ⭳.'), 300);
        return;
      }
      if (r.sinPrecio) {
        setTimeout(() => toast(`${r.sinPrecio} quedaron sin precio de chacra`), 2400);
      }
      sincronizar(false); // con aviso: importar es demasiado importante para fallar en silencio
    } catch (err) {
      alert('No se pudo leer el archivo: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
});

/* Exportar el catálogo con los cuatro precios ya calculados: sirve para
   imprimir la lista o mandarla por WhatsApp. */
$('#btnExportPrecios').addEventListener('click', () => {
  const cab = ['categoría', 'producto', 'unidad', 'presentación',
    ...db.listas.map(l => l.nombre)];
  const filas = [cab];
  productosOrdenados()
    .filter(p => p.activo !== false && num(p.chacra))
    .forEach(p => filas.push([
      categoriaDe(p), p.nombre, p.unidad, p.presentacion || '',
      ...db.listas.map(l => precioDe(p, l.clave))
    ]));
  if (filas.length === 1) { toast('No hay productos con precio'); return; }
  descargar('bioma-precios.csv', filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('Lista de precios descargada');
});
