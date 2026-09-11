/* ============================================================
   Ventas: TODO lo que entra de plata.

   Esta pantalla reemplazó a la de "Ingresos": tener las dos obligaba a
   cargar la misma venta dos veces. Cada operación guardada escribe en
   dos lugares:

     · la hoja `ingresos`  → un renglón con el total. Es la plata que
       entró, y de ahí salen el resumen y las tablas mes a mes.
     · la hoja `ventas`    → un renglón por producto, cuando hay detalle.
       Es lo que permite preguntar cuántos kg de acelga compró Península
       en enero.

   Las dos quedan atadas por el mismo id, así editar o borrar toca las
   dos a la vez y no pueden divergir.

   No toda la plata que entra es una venta de mercadería: préstamos,
   talleres o rendimiento financiero no tienen productos. Por eso, si no
   se carga ningún producto, el monto se escribe a mano.

   La app guarda solo los últimos renglones (VENTANA_VENTAS); la planilla
   los conserva todos.
   ============================================================ */

let borrador = null;

function ventaVacia() {
  return {
    venta: null,                 // id de la venta si se está editando
    fecha: hoy(),
    cliente: '',
    lista: 'chacra',
    obs: '',
    monto: '',   // solo se usa cuando no hay productos cargados
    // nombre + prodId: se elige el nombre y, si hay varias presentaciones,
    // el prodId termina de decidir cuál de ellas es
    lineas: [{ nombre: '', prodId: '', cantidad: '' }]
  };
}

// Los renglones que llegaron a tener producto y cantidad
function lineasValidas() {
  return borrador.lineas.filter(l => l.prodId && num(l.cantidad) > 0);
}

/* ================= Catálogo disponible ================= */

// Etiqueta única por producto (nombre + presentación). Se usa donde hace
// falta distinguir dos presentaciones del mismo producto, NO en el buscador
// de la venta: ahí se elige por nombre y la presentación va aparte.
function etiquetaProducto(p) {
  return p.presentacion ? `${p.nombre} · ${p.presentacion}` : p.nombre;
}

function productosVendibles() {
  return db.productos
    .filter(p => p.activo !== false)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

// Nombres sin repetir: lo que se ve en el desplegable del renglón
function nombresProductos() {
  const vistos = new Set();
  const out = [];
  productosVendibles().forEach(p => {
    const k = clave(p.nombre);
    if (!vistos.has(k)) { vistos.add(k); out.push(p.nombre); }
  });
  return out;
}

// Las presentaciones que existen para un nombre (Miel: 500 g y 1 kg)
function presentacionesDe(nombre) {
  return productosVendibles().filter(p => clave(p.nombre) === clave(nombre));
}

function buscarPorEtiqueta(texto) {
  const t = clave(texto);
  return productosVendibles().find(p => clave(etiquetaProducto(p)) === t) || null;
}

/* Cuántos kg pesa una unidad del producto.
   · Si se vende por kg, una unidad es un kg.
   · Si no, se saca de la presentación: "500 g", "atado 500g", "pack 250g".
   · Si la presentación no dice peso (10 ml, maple x30), devuelve null: no se
     inventa, simplemente no hay equivalencia en kg. */
function pesoUnitarioKg(p) {
  if (!p) return null;
  if (clave(p.unidad) === 'kg') return 1;
  const m = String(p.presentacion || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gr|grs|gramos)\b/i);
  if (!m) return null;
  const n = num(m[1]);
  return /^k/i.test(m[2]) ? n : n / 1000;
}

function kgDe(p, cantidad) {
  const peso = pesoUnitarioKg(p);
  return peso == null ? null : Math.round(peso * num(cantidad) * 1000) / 1000;
}

// Cómo se llama lo que se está contando: "kg", "frascos", "atados"…
function unidadPlural(p, cantidad) {
  if (!p) return '';
  const u = String(p.unidad || 'unidad');
  if (clave(u) === 'kg') return 'kg';
  return num(cantidad) === 1 ? u : (u.endsWith('s') ? u : u + 's');
}

/* Lo que se muestra al lado de la cantidad, en una sola línea y lo más
   corto posible: son muchos renglones por venta y cada uno tiene que
   entrar en el ancho de un teléfono.
     · vendido por kg      → "kg"
     · con peso derivable  → "frascos · 1,5 kg"
     · sin peso (10 ml)    → "frascos" */
function textoUnidad(p, cantidad) {
  if (!p) return '';
  const u = unidadPlural(p, cantidad);
  if (u === 'kg') return 'kg';
  const kg = num(cantidad) ? kgDe(p, cantidad) : null;
  if (kg == null) return esc(u);
  return `${esc(u)} <b>${String(kg).replace('.', ',')} kg</b>`;
}

/* ================= Formulario ================= */

function renderFormVenta() {
  if (!borrador) borrador = ventaVacia();
  const f = $('#form-venta');

  // Con "+ agregar nuevo…": los puntos de venta se dan de alta desde acá,
  // como se hacía en la pantalla de ingresos que esta reemplazó
  llenarSelect(f.cliente, db.conceptos.ingresos, true);
  if (borrador.cliente) f.cliente.value = borrador.cliente;
  else borrador.cliente = f.cliente.value;
  $('#venta-monto').value = borrador.monto || '';

  f.lista.innerHTML = db.listas
    .map(l => `<option value="${esc(l.clave)}">${esc(l.nombre)}</option>`).join('');
  f.lista.value = borrador.lista;
  f.fecha.value = borrador.fecha;
  f.obs.value = borrador.obs;

  /* El buscador es un datalist: al tocarlo abre la lista completa y al
     escribir la filtra, igual en el teléfono que en la computadora.
     Muestra SOLO el nombre del producto ("Acelga", "Aceite esencial"):
     la presentación se elige aparte, y únicamente cuando hay más de una. */
  $('#lista-productos-venta').innerHTML = nombresProductos()
    .map(n => `<option value="${esc(n)}">`).join('');

  $('#venta-titulo').textContent = borrador.venta ? 'Editar venta' : 'Nueva venta';
  $('#btnCancelarVenta').classList.toggle('hidden', !borrador.venta);
  pintarRenglones();
}

function pintarRenglones() {
  $('#venta-renglones').innerHTML = borrador.lineas.map((l, i) => {
    const p = l.prodId ? db.productos.find(x => x.id === l.prodId) : null;
    const opciones = l.nombre ? presentacionesDe(l.nombre) : [];
    // El selector de presentación aparece solo cuando hay más de una
    const selPres = opciones.length > 1 ? `
        <select class="r-pres">
          ${opciones.map(o => `<option value="${o.id}" ${o.id === l.prodId ? 'selected' : ''}
            >${esc(o.presentacion || 'sin presentación')}</option>`).join('')}
        </select>` : '';

    return `
      <div class="renglon" data-i="${i}">
        <input type="text" class="r-prod" list="lista-productos-venta"
               placeholder="Buscar producto…" value="${esc(l.nombre)}">
        ${selPres}
        <input type="number" class="r-cant" inputmode="decimal" step="0.01" min="0"
               placeholder="0" value="${esc(l.cantidad)}">
        <span class="r-unidad">${textoUnidad(p, l.cantidad)}</span>
        <span class="r-sub">${p && l.cantidad ? fmt(subtotalDe(l)) : ''}</span>
        <button type="button" class="r-del" title="Quitar">✕</button>
      </div>`;
  }).join('');

  $$('#venta-renglones .renglon').forEach(div => {
    const i = Number(div.dataset.i);

    div.querySelector('.r-prod').addEventListener('change', e => {
      const texto = e.target.value.trim();
      const opciones = presentacionesDe(texto);
      if (!opciones.length && texto) {
        toast('Ese producto no está en el catálogo');
        e.target.value = borrador.lineas[i].nombre;
        return;
      }
      borrador.lineas[i].nombre = opciones.length ? opciones[0].nombre : '';
      // Con una sola presentación queda elegida sola; con varias, la primera
      borrador.lineas[i].prodId = opciones.length ? opciones[0].id : '';
      pintarRenglones();
    });

    const pres = div.querySelector('.r-pres');
    if (pres) pres.addEventListener('change', e => {
      borrador.lineas[i].prodId = e.target.value;
      pintarRenglones();
    });

    /* Al tipear la cantidad se actualizan solo los textos de ese renglón.
       Repintar la lista entera perdería el foco en mitad del número. */
    /* Al tipear la cantidad se actualizan solo los textos de ese renglón.
       Repintar la lista entera perdería el foco en mitad del número. */
    div.querySelector('.r-cant').addEventListener('input', e => {
      const l = borrador.lineas[i];
      l.cantidad = e.target.value;
      const p = l.prodId ? db.productos.find(x => x.id === l.prodId) : null;
      div.querySelector('.r-unidad').innerHTML = textoUnidad(p, l.cantidad);
      div.querySelector('.r-sub').textContent = p && l.cantidad ? fmt(subtotalDe(l)) : '';
      recalcularTotal();
    });

    div.querySelector('.r-del').addEventListener('click', () => {
      borrador.lineas.splice(i, 1);
      if (!borrador.lineas.length) borrador.lineas.push({ nombre: '', prodId: '', cantidad: '' });
      pintarRenglones();
    });
  });
  recalcularTotal();
}

function precioLinea(l) {
  const p = db.productos.find(x => x.id === l.prodId);
  return p ? precioDe(p, borrador.lista) : 0;
}

function subtotalDe(l) {
  return Math.round(num(l.cantidad) * precioLinea(l));
}

/* Con productos, el total lo calcula la app y el campo de monto se
   esconde. Sin productos, se escribe a mano: es la forma de cargar un
   préstamo o un taller sin necesitar una pantalla aparte. */
function recalcularTotal() {
  const validas = lineasValidas();
  const conProductos = validas.length > 0;
  const total = borrador.lineas.reduce((s, l) => s + (l.prodId ? subtotalDe(l) : 0), 0);

  $('#venta-total').classList.toggle('hidden', !conProductos);
  $('#venta-monto').classList.toggle('hidden', conProductos);
  $('#venta-total').textContent = fmt(total);
  $('#venta-cuenta').textContent = conProductos
    ? (validas.length === 1 ? '1 producto' : `${validas.length} productos`)
    : 'Sin productos — escribí el monto';
}

// Lo que se va a guardar como ingreso: calculado o escrito a mano
function totalOperacion() {
  const validas = lineasValidas();
  if (validas.length) return validas.reduce((s, l) => s + subtotalDe(l), 0);
  return num($('#venta-monto').value);
}

$('#btnAgregarRenglon').addEventListener('click', () => {
  borrador.lineas.push({ nombre: '', prodId: '', cantidad: '' });
  pintarRenglones();
  // Foco en el renglón nuevo, para poder encadenar la carga sin tocar nada
  const ultimos = $$('#venta-renglones .r-prod');
  if (ultimos.length) ultimos[ultimos.length - 1].focus();
});

['fecha', 'cliente', 'lista', 'obs'].forEach(campo => {
  $('#form-venta')[campo].addEventListener('change', e => {
    // Alta de un punto de venta nuevo sin salir de la pantalla
    if (campo === 'cliente' && e.target.value === '__nuevo__') {
      const nuevo = prompt('Nombre del nuevo punto de venta:');
      const lista = db.conceptos.ingresos;
      if (nuevo && nuevo.trim()) {
        const limpio = nuevo.trim();
        if (!lista.includes(limpio)) {
          lista.push(limpio);
          db.conceptosNuevos.ingresos.push(limpio);
          save();
          sincronizar(true);
        }
        borrador.cliente = limpio;
      } else {
        borrador.cliente = lista[0] || '';
      }
      renderFormVenta();
      return;
    }
    borrador[campo] = e.target.value;
    if (campo === 'lista') pintarRenglones(); // cambian todos los precios
  });
});

$('#venta-monto').addEventListener('input', e => { borrador.monto = e.target.value; });

/* ================= Guardar ================= */

$('#form-venta').addEventListener('submit', e => {
  e.preventDefault();
  if (!borrador.cliente) { toast('Elegí el punto de venta'); return; }
  const validas = lineasValidas();
  const total = totalOperacion();
  if (!validas.length && !total) {
    toast('Agregá productos o escribí el monto');
    return;
  }

  const idVenta = borrador.venta || uid();
  const ahora = Date.now();

  // Al editar se reemplaza todo lo anterior de esa operación
  if (borrador.venta) {
    db.ventas.filter(v => v.venta === idVenta).forEach(v => sepultar(v.id));
    db.ventas = db.ventas.filter(v => v.venta !== idVenta);
  }

  // 1) El ingreso: un solo renglón con el total. Comparte el id con la
  //    venta, así las dos hojas quedan atadas y no pueden divergir.
  const previo = db.movimientos.find(m => m.id === idVenta);
  const ingreso = {
    id: idVenta,
    tipo: 'ingreso',
    fecha: borrador.fecha,
    concepto: borrador.cliente,
    monto: total,
    obs: borrador.obs || (validas.length ? `${validas.length} productos` : ''),
    mod: ahora
  };
  if (previo) Object.assign(previo, ingreso);
  else db.movimientos.push(ingreso);

  // 2) El detalle por producto, si lo hay
  validas.forEach((l, i) => {
    const p = db.productos.find(x => x.id === l.prodId);
    db.ventas.push({
      id: uid(),
      venta: idVenta,
      fecha: borrador.fecha,
      cliente: borrador.cliente,
      lista: borrador.lista,
      producto: p.nombre,
      presentacion: p.presentacion || '',
      unidad: p.unidad || 'unidad',
      cantidad: num(l.cantidad),
      // Guardado, no calculado después: es LA métrica que se quiere analizar
      // (cuántos kg de acelga se vendieron), y la presentación del producto
      // puede cambiar más adelante sin que esta venta deba cambiar con ella.
      kg: kgDe(p, l.cantidad),
      precio: precioLinea(l),
      subtotal: subtotalDe(l),
      origen: 'manual',
      obs: borrador.obs,
      mod: ahora + i + 1
    });
  });

  save();
  const eraEdicion = !!borrador.venta;
  borrador = ventaVacia();
  renderFormVenta();
  renderUltimasVentas();
  renderResumen();
  toast(eraEdicion ? 'Actualizado ✓'
    : (validas.length ? `Venta registrada · ${validas.length} productos` : 'Ingreso registrado ✓'));
  sincronizar(true);
});

$('#btnCancelarVenta').addEventListener('click', () => {
  borrador = ventaVacia();
  renderFormVenta();
});

/* ================= Últimas ventas ================= */

// Los renglones de detalle de una operación
function lineasDe(idVenta) {
  return db.ventas.filter(v => v.venta === idVenta);
}

/* La lista muestra TODOS los ingresos, tengan detalle de productos o no.
   Se recorre la hoja de ingresos (que los tiene a todos) y se le suma el
   detalle cuando existe. Los ingresos viejos, cargados antes de que la
   pantalla se unificara, aparecen igual y se pueden editar. */
function ingresosAgrupados() {
  return db.movimientos
    .filter(m => m.tipo === 'ingreso')
    .map(m => ({
      id: m.id, fecha: m.fecha, cliente: m.concepto, obs: m.obs,
      total: num(m.monto), lineas: lineasDe(m.id), mod: num(m.mod)
    }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.mod - a.mod);
}

// Se conserva para el remito: solo las operaciones que sí tienen productos
function ventasAgrupadas() {
  return ingresosAgrupados().filter(g => g.lineas.length);
}

function renderUltimasVentas() {
  const ul = $('#lista-venta');
  const grupos = ingresosAgrupados();
  const conDetalle = grupos.filter(g => g.lineas.length).length;
  $('#venta-resumen').textContent = grupos.length
    ? `${grupos.length} ingresos · ${conDetalle} con detalle` : '';

  ul.innerHTML = '';
  if (!grupos.length) {
    ul.innerHTML = '<li class="empty">Todavía no hay ventas cargadas</li>';
    return;
  }
  grupos.slice(0, 10).forEach(g => {
    const detalle = g.lineas.length
      ? g.lineas.map(l => `${num(l.cantidad)}× ${l.producto}`).join(', ')
      : (g.obs || 'sin detalle de productos');
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-concepto">${esc(g.cliente)}</div>
        <div class="mov-detalle">${fmtFecha(g.fecha)} · ${esc(detalle)}</div>
      </div>
      <span class="mov-monto monto-in">${fmt(g.total)}</span>
      <button class="mov-edit" title="Editar">✎</button>
      <button class="mov-del" title="Eliminar">✕</button>`;
    li.querySelector('.mov-edit').addEventListener('click', () => editarVenta(g.id));
    li.querySelector('.mov-del').addEventListener('click', () => borrarVenta(g.id));
    ul.appendChild(li);
  });
}

function editarVenta(idVenta) {
  const mov = db.movimientos.find(m => m.id === idVenta && m.tipo === 'ingreso');
  if (!mov) return;
  const lineas = lineasDe(idVenta);
  borrador = {
    venta: idVenta,
    fecha: mov.fecha,
    cliente: mov.concepto,
    lista: lineas.length ? (lineas[0].lista || 'chacra') : 'chacra',
    obs: mov.obs || '',
    // Sin detalle de productos se edita el monto directo
    monto: lineas.length ? '' : String(num(mov.monto)),
    lineas: !lineas.length ? [{ nombre: '', prodId: '', cantidad: '' }] : lineas.map(l => {
      // Se busca por nombre + presentación: el id del producto no se guarda
      // en la venta a propósito, para que la venta sobreviva aunque después
      // se borre o se renombre el producto.
      const p = db.productos.find(x =>
        clave(x.nombre) === clave(l.producto) &&
        clave(x.presentacion || '') === clave(l.presentacion || ''));
      return {
        nombre: p ? p.nombre : l.producto,
        prodId: p ? p.id : '',
        cantidad: String(l.cantidad)
      };
    })
  };
  renderFormVenta();
  $('#form-venta').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const faltan = borrador.lineas.filter(l => !l.prodId).length;
  if (faltan) toast(`${faltan} producto(s) ya no están en el catálogo`);
}

function borrarVenta(idVenta) {
  const mov = db.movimientos.find(m => m.id === idVenta && m.tipo === 'ingreso');
  if (!mov) return;
  const lineas = lineasDe(idVenta);
  const cuantos = lineas.length ? `\nSon ${lineas.length} renglones de productos.` : '';
  if (!confirm(`¿Eliminar el ingreso de ${mov.concepto} por ${fmt(mov.monto)}?${cuantos}`)) return;

  // Se borra en los dos lados a la vez: el ingreso y su detalle
  sepultar(mov.id);
  db.movimientos = db.movimientos.filter(m => m.id !== idVenta);
  lineas.forEach(l => sepultar(l.id));
  db.ventas = db.ventas.filter(v => v.venta !== idVenta);

  save();
  if (borrador && borrador.venta === idVenta) { borrador = ventaVacia(); renderFormVenta(); }
  renderUltimasVentas();
  renderResumen();
  toast('Eliminado');
  sincronizar(true);
}

/* ================= Compartir el remito ================= */

function textoRemito(g) {
  const lineas = g.lineas.map(l => {
    const pres = l.presentacion ? ` (${l.presentacion})` : '';
    return `· ${num(l.cantidad)} × ${l.producto}${pres} — ${fmt(l.subtotal)}`;
  });
  return `BIOMA · ${g.cliente}\n${fmtFecha(g.fecha)}\n\n` +
    lineas.join('\n') + `\n\nTOTAL: ${fmt(g.total)}`;
}

$('#btnRemito').addEventListener('click', async () => {
  const g = ventasAgrupadas()[0];
  if (!g) { toast('No hay ninguna venta para compartir'); return; }
  const texto = textoRemito(g);
  try {
    if (navigator.share) await navigator.share({ text: texto });
    else { await navigator.clipboard.writeText(texto); toast('Remito copiado'); }
  } catch (e) {
    prompt('Copiá el remito:', texto);
  }
});
