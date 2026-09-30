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

/* ================= La tabla: precio por kg, presentación y precio =================
   Una lista de precios a la vez (Chacra, Comarca, Bariloche, Verdulerías).
   Por producto: el precio por kg en esa lista, la presentación al público
   —cuántos kg lleva la unidad que se ofrece, y se cambia en la tabla misma
   porque va cambiando en la temporada: repollos más grandes, una oferta— y
   el precio de esa unidad, que sale solo de multiplicar los dos.

   "publico" va aparte de "presentacion" a propósito: la presentación
   identifica al producto ("Miel 500 g" y "Miel 1 kg" son dos) y de ella las
   ventas sacan los kilos. Cambiarla por una oferta rompería las dos cosas. */

// Desde esta versión el script de la planilla guarda "publico". Contra uno
// anterior no se deja editar: la próxima sincronización lo borraría.
const API_PUBLICO = 10;
const LISTA_PRODUCTOS_KEY = 'bioma-lista-productos';

function listaElegida() {
  const sel = $('#lista-productos');
  return (sel && sel.value) || 'chacra';
}

/* Lo que se puede pesar aunque se venda por unidad: un atado, una lechuga,
   una bandeja. Un frasco, una botella o un bolsón no: ahí el precio es por
   unidad y no hay kg que valgan. */
const UNIDADES_SIN_PESO = ['frasco', 'botella', 'maple', 'docena'];
const CATEGORIAS_SIN_PESO = ['bolsón', 'elaborado', 'bioinsumo', 'animal'];
function sePuedePesar(p) {
  return clave(p.unidad) === 'kg'
    || (!UNIDADES_SIN_PESO.includes(clave(p.unidad)) && !CATEGORIAS_SIN_PESO.includes(categoriaDe(p)));
}

/* Cuántos kg pesa una unidad de lo que se vende. Primero lo que diga la
   presentación del producto ("atado 100g"); si no dice, lo que se anotó en la
   columna Presentación de la tabla. Así un atado de rúcula sin peso en su
   nombre igual tiene precio por kg —y suma en la Proyección— con solo poner
   cuánto pesa (28/09: la rúcula no sumaba y no había dónde cargarlo). */
function kgPorUnidadDe(p) {
  const peso = pesoUnitarioKg(p);
  if (peso) return peso;
  if (sePuedePesar(p) && num(p.publico) > 0) return num(p.publico);
  return null;
}

// Precio por kg en la lista. Null si el producto no tiene equivalencia en kg
// (un frasco de 10 ml, un maple, o un atado del que no se sabe el peso).
function precioKgDe(p, lista) {
  const peso = kgPorUnidadDe(p);
  if (!peso) return null;
  return precioDe(p, lista) / peso;
}

// Cuántos kg lleva la unidad al público: lo elegido; si no, el peso de su
// presentación (el atado de 100 g); si no, 1 kg.
function kgPublicoDe(p) {
  return num(p.publico) > 0 ? num(p.publico) : (kgPorUnidadDe(p) || 1);
}

// Lo que se le cobra al público por una unidad, en la lista elegida.
function precioPublicoDe(p, lista) {
  const kg = precioKgDe(p, lista);
  if (kg === null) return precioDe(p, lista);
  return Math.round(kg * kgPublicoDe(p));
}

// "0,5 kg", "1 kg", "150 g": como se lee en una lista de precios.
function textoKg(kg) {
  if (kg < 1) return Math.round(kg * 1000) + ' g';
  return String(Math.round(kg * 100) / 100).replace('.', ',') + ' kg';
}

function initListaProductos() {
  const sel = $('#lista-productos');
  if (!sel) return;
  const antes = sel.value || (() => {
    try { return localStorage.getItem(LISTA_PRODUCTOS_KEY) || ''; } catch (e) { return ''; }
  })();
  sel.innerHTML = db.listas.map(l =>
    `<option value="${esc(l.clave)}">${esc(l.nombre)}</option>`).join('');
  if (antes && db.listas.some(l => l.clave === antes)) sel.value = antes;
}

function renderProductos() {
  const cont = $('#lista-producto');
  initFiltroCategorias();
  initListaProductos();
  const lista = listaElegida();
  const items = productosOrdenados();
  const activos = db.productos.filter(p => p.activo !== false).length;
  const sinPrecio = db.productos.filter(p => !num(p.chacra)).length;
  const editable = (db.apiServidor || 0) >= API_PUBLICO;

  $('#producto-resumen').innerHTML =
    `<span>${db.productos.length} productos · ${activos} activos</span>` +
    (sinPrecio ? `<span class="alerta">${sinPrecio} sin precio</span>` : '') +
    (editable ? '' : `<span class="alerta">La presentación se podrá cambiar cuando se actualice
      el script de la planilla</span>`);

  if (!items.length) {
    cont.innerHTML = '<p class="empty">Sin productos. Tocá «+ Nuevo» o cargalos en la planilla.</p>';
    return;
  }

  const filas = items.map(p => {
    const pk = precioKgDe(p, lista);
    const conPrecio = num(p.chacra) > 0;
    const fijado = lista !== 'chacra' && precioFijado(p, lista);
    // Lo que no se puede pesar (un frasco) va por unidad. Lo que sí, lleva el
    // casillero: en un atado sin peso conocido, ahí se anota cuánto pesa.
    const sinPeso = pk === null && sePuedePesar(p);
    const presentacion = !sePuedePesar(p)
      ? `<span class="prod-por">por ${esc(p.unidad || 'unidad')}</span>`
      : `<input type="text" inputmode="decimal" class="prod-kg${sinPeso ? ' falta' : ''}" data-publico="${esc(p.id)}"
           value="${num(p.publico) > 0 ? String(num(p.publico)).replace('.', ',') : ''}"
           placeholder="${sinPeso ? '¿kg?' : String(kgPublicoDe(p)).replace('.', ',')}"
           title="${sinPeso ? `¿Cuánto pesa un ${esc(p.unidad || 'unidad')}? En kg: 0,15`
             : 'Cuántos kg lleva la unidad al público'}"${editable ? '' : ' disabled'}><span class="prod-u">kg</span>`;
    return `<tr class="${p.activo === false ? 'inactivo' : ''}">
      <td class="prod-nom" data-editar="${esc(p.id)}" title="Editar el producto">
        <b>${esc(p.nombre)}</b>
        <small>${esc([categoriaDe(p), p.presentacion || p.unidad].filter(Boolean).join(' · '))}</small>
      </td>
      <td class="n${fijado ? ' fijado' : ''}" title="${fijado ? 'Precio fijado a mano en esta lista' : ''}">${
        !conPrecio ? '—' : pk === null ? '—' : fmt(Math.round(pk))}</td>
      <td class="prod-pres">${presentacion}</td>
      <td class="n"><b data-precio="${esc(p.id)}">${conPrecio ? fmt(precioPublicoDe(p, lista)) : '—'}</b></td>
    </tr>`;
  }).join('');

  cont.innerHTML = `<table class="prod-tabla">
    <thead><tr><th>Producto</th><th class="n">$/kg</th><th>Presentación</th><th class="n">Precio</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>`;

  cont.querySelectorAll('[data-editar]').forEach(td =>
    td.addEventListener('click', () => abrirProducto(td.dataset.editar)));
  cont.querySelectorAll('[data-publico]').forEach(inp => {
    inp.addEventListener('change', () => cambiarPublico(inp));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
}

/* Cambiar la presentación en la tabla misma. Se guarda en el dispositivo al
   instante y se sube a la planilla un rato después: cambiar diez productos
   seguidos no son diez sincronizaciones. */
let subirPresentaciones = null;
function cambiarPublico(inp) {
  const p = db.productos.find(x => x.id === inp.dataset.publico);
  if (!p) return;
  const txt = inp.value.trim();
  const kg = txt === '' ? '' : num(txt);
  if (txt !== '' && !(kg > 0 && kg <= 100)) {
    toast('La presentación va en kg: 0,5 · 1 · 2,5');
    inp.value = num(p.publico) > 0 ? String(num(p.publico)).replace('.', ',') : '';
    return;
  }
  p.publico = kg;
  p.mod = Date.now();
  save();
  // En un atado sin peso, lo que se anotó define el precio por kg: se redibuja
  // la tabla entera. En el resto alcanza con el precio de la fila.
  if (!pesoUnitarioKg(p) && clave(p.unidad) !== 'kg') { renderProductos(); }
  else {
    const b = document.querySelector(`[data-precio="${CSS.escape(p.id)}"]`);
    if (b && num(p.chacra) > 0) b.textContent = fmt(precioPublicoDe(p, listaElegida()));
    inp.placeholder = String(kgPublicoDe(p)).replace('.', ',');
  }
  clearTimeout(subirPresentaciones);
  subirPresentaciones = setTimeout(() => sincronizar(true), 2500);
}

$('#lista-productos').addEventListener('change', () => {
  try { localStorage.setItem(LISTA_PRODUCTOS_KEY, listaElegida()); } catch (e) {}
  renderProductos();
});

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
  f.sku.value = p ? (p.sku || '') : '';
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
    sku: f.sku.value.trim(),
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
    sku: col(['sku', 'codigo']),
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
      sku: val('sku'),
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
    if (f.sku) p.sku = f.sku.trim();
    else if (p.sku === undefined) p.sku = '';
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

/* Descargar y compartir la lista que se está mirando: la lista de precios
   elegida y el filtro de categoría y de búsqueda que haya puestos. Solo los
   activos con precio: una lista para el público no lleva "sin precio". */
function productosParaLista() {
  return productosOrdenados().filter(p => p.activo !== false && num(p.chacra) > 0);
}

$('#btnExportPrecios').addEventListener('click', () => {
  const lista = listaElegida();
  const nombreLista = listaPorClave(lista).nombre;
  const filas = [['categoría', 'producto', `precio por kg (${nombreLista})`,
    'presentación', `precio (${nombreLista})`]];
  productosParaLista().forEach(p => {
    const pk = precioKgDe(p, lista);
    filas.push([categoriaDe(p), p.nombre, pk === null ? '' : Math.round(pk),
      pk === null ? `por ${p.unidad || 'unidad'}` : textoKg(kgPublicoDe(p)),
      precioPublicoDe(p, lista)]);
  });
  if (filas.length === 1) { toast('No hay productos con precio'); return; }
  descargar(`precios-${clave(nombreLista).replace(/\s+/g, '-')}-${hoy()}.csv`,
    filas.map(f => f.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast('Lista de precios descargada');
});

// Como texto, para WhatsApp: un renglón por producto, agrupado por categoría.
function textoListaPrecios() {
  const lista = listaElegida();
  const productos = productosParaLista();
  if (!productos.length) return '';
  const porCat = {};
  productos.forEach(p => { (porCat[categoriaDe(p)] = porCat[categoriaDe(p)] || []).push(p); });
  const partes = [`*Lista de precios · ${listaPorClave(lista).nombre}*`, fmtFecha(hoy()), ''];
  const cats = [...CATEGORIAS.filter(c => porCat[c]),
    ...Object.keys(porCat).filter(c => !CATEGORIAS.includes(c))];
  cats.forEach(c => {
    partes.push(`_${c.charAt(0).toUpperCase() + c.slice(1)}_`);
    porCat[c].forEach(p => {
      const pk = precioKgDe(p, lista);
      const que = pk === null ? (p.presentacion || p.unidad || '') : textoKg(kgPublicoDe(p));
      partes.push(`• ${p.nombre}${que ? ` (${que})` : ''}: ${fmt(precioPublicoDe(p, lista))}`);
    });
    partes.push('');
  });
  return partes.join('\n').trim();
}

$('#btnCompartirPrecios').addEventListener('click', async () => {
  const texto = textoListaPrecios();
  if (!texto) { toast('No hay productos con precio'); return; }
  // En el teléfono abre el menú de compartir (WhatsApp, mail…). En la
  // computadora, donde casi nunca está, se copia para pegar.
  if (navigator.share) {
    try { await navigator.share({ title: 'Lista de precios', text: texto }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(texto);
    toast('Lista copiada: pegala en WhatsApp');
  } catch (e) {
    prompt('Copiá la lista:', texto);
  }
});
