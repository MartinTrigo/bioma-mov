/* ============================================================
   Ventas: qué producto se vendió, a quién y cuánto.

   Una venta agrupa varios renglones (un remito). En la planilla se
   guarda un renglón por producto —no una hoja por cliente— para poder
   preguntarle cualquier cosa después: cuántos kg de acelga compró
   Península en enero, cuánto choclo salió en la temporada, qué punto de
   venta deja más margen. El detalle de por qué, en PLAN.md.

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
    // nombre + prodId: se elige el nombre y, si hay varias presentaciones,
    // el prodId termina de decidir cuál de ellas es
    lineas: [{ nombre: '', prodId: '', cantidad: '' }]
  };
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

/* ================= Formulario ================= */

function renderFormVenta() {
  if (!borrador) borrador = ventaVacia();
  const f = $('#form-venta');

  llenarSelect(f.cliente, db.conceptos.ingresos, false);
  if (borrador.cliente) f.cliente.value = borrador.cliente;
  else borrador.cliente = f.cliente.value;

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

    const kg = p && num(l.cantidad) ? kgDe(p, l.cantidad) : null;
    const equivale = (kg != null && clave(p.unidad) !== 'kg')
      ? `<span class="r-kg">= ${kg} kg</span>` : '';

    return `
      <div class="renglon" data-i="${i}">
        <div class="renglon-fila">
          <input type="text" class="r-prod" list="lista-productos-venta"
                 placeholder="Buscar producto…" value="${esc(l.nombre)}">
          ${selPres}
          <button type="button" class="r-del" title="Quitar">✕</button>
        </div>
        <div class="renglon-fila renglon-cant">
          <input type="number" class="r-cant" inputmode="decimal" step="0.01" min="0"
                 placeholder="cantidad" value="${esc(l.cantidad)}">
          <span class="r-unidad">${p ? esc(unidadPlural(p, l.cantidad)) : ''}</span>
          ${equivale}
          <span class="r-sub">${p && l.cantidad ? fmt(subtotalDe(l)) : ''}</span>
        </div>
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
    div.querySelector('.r-cant').addEventListener('input', e => {
      const l = borrador.lineas[i];
      l.cantidad = e.target.value;
      const p = l.prodId ? db.productos.find(x => x.id === l.prodId) : null;
      const kg = p && num(l.cantidad) ? kgDe(p, l.cantidad) : null;
      div.querySelector('.r-unidad').textContent = p ? unidadPlural(p, l.cantidad) : '';
      const spanKg = div.querySelector('.r-kg');
      const texto = (kg != null && p && clave(p.unidad) !== 'kg') ? `= ${kg} kg` : '';
      if (spanKg) spanKg.textContent = texto;
      else if (texto) {
        const s = document.createElement('span');
        s.className = 'r-kg'; s.textContent = texto;
        div.querySelector('.renglon-cant').insertBefore(s, div.querySelector('.r-sub'));
      }
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

function recalcularTotal() {
  const total = borrador.lineas.reduce((s, l) => s + (l.prodId ? subtotalDe(l) : 0), 0);
  const n = borrador.lineas.filter(l => l.prodId && num(l.cantidad) > 0).length;
  $('#venta-total').textContent = fmt(total);
  $('#venta-cuenta').textContent = n === 1 ? '1 producto' : `${n} productos`;
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
    borrador[campo] = e.target.value;
    if (campo === 'lista') pintarRenglones(); // cambian todos los precios
  });
});

/* ================= Guardar ================= */

$('#form-venta').addEventListener('submit', e => {
  e.preventDefault();
  const validas = borrador.lineas.filter(l => l.prodId && num(l.cantidad) > 0);
  if (!validas.length) { toast('Agregá al menos un producto con cantidad'); return; }
  if (!borrador.cliente) { toast('Elegí el punto de venta'); return; }

  const idVenta = borrador.venta || uid();
  // Al editar se reemplazan todos los renglones: se sepultan los viejos
  if (borrador.venta) {
    db.ventas.filter(v => v.venta === idVenta).forEach(v => sepultar(v.id));
    db.ventas = db.ventas.filter(v => v.venta !== idVenta);
  }

  const ahora = Date.now();
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
      mod: ahora + i
    });
  });

  save();
  const eraEdicion = !!borrador.venta;
  borrador = ventaVacia();
  renderFormVenta();
  renderUltimasVentas();
  toast(eraEdicion ? 'Venta actualizada ✓' : `Venta registrada · ${validas.length} productos`);
  sincronizar(true);
});

$('#btnCancelarVenta').addEventListener('click', () => {
  borrador = ventaVacia();
  renderFormVenta();
});

/* ================= Últimas ventas ================= */

// Agrupa los renglones sueltos en las operaciones que los originaron
function ventasAgrupadas() {
  const grupos = {};
  db.ventas.forEach(v => {
    const g = grupos[v.venta] || (grupos[v.venta] = {
      id: v.venta, fecha: v.fecha, cliente: v.cliente, lista: v.lista,
      obs: v.obs, origen: v.origen, lineas: [], total: 0, mod: 0
    });
    g.lineas.push(v);
    g.total += num(v.subtotal);
    g.mod = Math.max(g.mod, num(v.mod));
  });
  return Object.values(grupos).sort((a, b) =>
    String(b.fecha).localeCompare(String(a.fecha)) || b.mod - a.mod);
}

function renderUltimasVentas() {
  const ul = $('#lista-venta');
  const grupos = ventasAgrupadas().slice(0, 10);
  const total = db.ventasTotal || db.ventas.length;
  $('#venta-resumen').textContent = total
    ? `${total} renglones registrados` : '';

  ul.innerHTML = '';
  if (!grupos.length) {
    ul.innerHTML = '<li class="empty">Todavía no hay ventas cargadas</li>';
    return;
  }
  grupos.forEach(g => {
    const detalle = g.lineas
      .map(l => `${num(l.cantidad)}× ${l.producto}`).join(', ');
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
  const lineas = db.ventas.filter(v => v.venta === idVenta);
  if (!lineas.length) return;
  const primera = lineas[0];
  borrador = {
    venta: idVenta,
    fecha: primera.fecha,
    cliente: primera.cliente,
    lista: primera.lista || 'chacra',
    obs: primera.obs || '',
    lineas: lineas.map(l => {
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
  const lineas = db.ventas.filter(v => v.venta === idVenta);
  if (!lineas.length) return;
  const total = lineas.reduce((s, l) => s + num(l.subtotal), 0);
  if (!confirm(`¿Eliminar la venta a ${lineas[0].cliente} por ${fmt(total)}?\n` +
    `Son ${lineas.length} renglones.`)) return;
  lineas.forEach(l => sepultar(l.id));
  db.ventas = db.ventas.filter(v => v.venta !== idVenta);
  save();
  if (borrador && borrador.venta === idVenta) { borrador = ventaVacia(); renderFormVenta(); }
  renderUltimasVentas();
  toast('Venta eliminada');
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
