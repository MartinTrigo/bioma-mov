/* ============================================================
   Semana: lo que hay para vender esta semana (Fase 4.7, etapa 1 · 31/10).

   El viernes se releva el stock y el sábado se arma la oferta. Esta pestaña
   junta lo del viernes, que viene de dos lados:
   · TICA: el stock relevado en AMA Producción (lo propio, lo que puede sobrar).
   · PROVEEDORES: lo que Nati anotó en su planilla, proveedor por proveedor.
     Es un TOPE para publicar: el miércoles se les pide solo lo vendido.

   Los dos los trae el script de bioma-db (action 'semana'), de servidor a
   servidor: el navegador no ve ni la clave de AMA ni la planilla de Nati.
   Esta app pone los PRECIOS de venta (hoja productos, lista elegida). Nada se
   guarda en la planilla: se cruza al mirar, como la Proyección.

   Las etapas siguientes (armar el bolsón, repartir por punto de venta) salen
   de esta misma lista. Ver PLAN.md, Fase 4.7.
   ============================================================ */

const SEMANA_KEY = 'bioma-semana';           // lo último que llegó, para mirarlo sin señal
const SEMANA_LISTA_KEY = 'bioma-semana-lista';
const API_SEMANA = 13;

let semanaDatos = leerSemanaGuardada();
let semanaPedida = false;
let semanaError = '';
let semanaCargando = false;

function leerSemanaGuardada() {
  try { return JSON.parse(localStorage.getItem(SEMANA_KEY) || 'null'); }
  catch (e) { return null; }
}

function entrarSemana() {
  renderSemana();
  if (!semanaPedida) traerSemana(false);
}

async function traerSemana(refrescar, semana) {
  const url = urlSync();
  if (!url || semanaCargando) return;
  semanaPedida = true;
  semanaCargando = true;
  semanaError = '';
  renderSemana();
  try {
    let texto;
    try {
      const res = await fetch(url, {
        method: 'POST',
        // sin Content-Type: evita el preflight CORS que Apps Script no soporta
        body: JSON.stringify({ action: 'semana', semana: semana || '', refrescar: !!refrescar })
      });
      texto = await res.text();
    } catch (e) {
      semanaError = 'Sin conexión: se muestra lo último que llegó.';
      return;
    }
    let r;
    try { r = JSON.parse(texto); } catch (e) {
      semanaError = 'bioma-db no devolvió el stock de la semana.';
      return;
    }
    if (!(r.api >= API_SEMANA)) {
      semanaError = 'El script de bioma-db todavía no sabe traer el stock de la semana: ' +
        'falta implementar su nueva versión.';
    } else if (r.error) {
      semanaError = r.error;
    } else {
      semanaDatos = { r, traida: new Date().toISOString() };
      try { localStorage.setItem(SEMANA_KEY, JSON.stringify(semanaDatos)); } catch (e) {}
    }
  } catch (e) {
    semanaError = 'Error al leer el stock: ' + (e && e.message || e);
  } finally {
    semanaCargando = false;
    renderSemana();
  }
}

/* ================= Cuentas ================= */

// El viernes de un día: de sábado a miércoles el anterior, el jueves el que viene
// (la misma regla que la planilla de Nati).
function viernesDe(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d, 12);
  f.setDate(f.getDate() + { 5: 0, 6: -1, 0: -2, 1: -3, 2: -4, 3: -5, 4: 1 }[f.getDay()]);
  return isoDe(f);
}
function isoDe(f) {
  return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
}
function masDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  return isoDe(new Date(a, m - 1, d + n, 12));
}
const diaCorto = iso => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

// Cuántos kg es UNA unidad de lo que ofrece un proveedor ("600 g" → 0,6).
function kgDeOferta(x) {
  const u = clave(x.unidad), p = num(x.presentacion) || 1;
  if (u === 'kg') return p;
  if (u === 'g') return p / 1000;
  return null;
}
const SE_CUENTA = ['u', 'unidad', 'atado', 'frasco', 'maple', 'pieza', 'sobre', 'bandeja',
  'docena', 'pack', 'botella', 'bolsa'];

/* A cuánto se vende UNA unidad de lo ofrecido, con la lista elegida. Por kg si
   los dos lados dicen su peso; si no, por unidad cuando los dos se cuentan
   (un maple es un maple). Si no hay manera honesta de compararlos, null. */
function ventaPorUnidad(x, prod, lista) {
  if (!prod) return null;
  const kg = kgDeOferta(x);
  const pk = precioPorKg(prod, lista);
  if (kg && pk.valor) return kg * pk.valor;
  if (SE_CUENTA.includes(clave(x.unidad)) && (num(x.presentacion) || 1) === 1 &&
      clave(prod.unidad) !== 'kg' && precioDe(prod, lista) > 0) return precioDe(prod, lista);
  return null;
}

function porUnidadTexto(x) {
  const p = num(x.presentacion) || 1, u = x.unidad || 'u';
  if (p === 1) return u === 'u' ? 'unidad' : u;
  return `${String(p).replace('.', ',')} ${u}`;
}

/* Tica: los registros vienen por lugar (bancal, cámara); para planificar
   sirve por cultivo. Se suma por cultivo + variedad. */
function ticaPorCultivo(tica, jueves) {
  const grupos = {};
  (tica && tica.vigente || []).forEach(o => {
    const k = clave(o.cultivo) + '|' + clave(o.variedad);
    const g = grupos[k] || (grupos[k] = { cultivo: o.cultivo, variedad: o.variedad || '', kg: 0,
      unidades: {}, lugares: 0, disponible: o.disponible || o.fecha, sinKg: false });
    g.lugares++;
    if (num(o.kg) > 0) g.kg += num(o.kg);
    else if (num(o.cantidad) > 0) {
      g.sinKg = true;
      g.unidades[o.formato || 'u'] = (g.unidades[o.formato || 'u'] || 0) + num(o.cantidad);
    }
    if ((o.disponible || '') < g.disponible) g.disponible = o.disponible;
  });
  return Object.values(grupos).map(g => ({ ...g, ahora: !jueves || g.disponible <= jueves }));
}

/* ================= Dibujo ================= */

function renderSemana() {
  const cont = $('#semana-contenido');
  if (!cont) return;
  const selLista = $('#semana-lista');
  if (!selLista.options.length) {
    selLista.innerHTML = db.listas.map(l => `<option value="${esc(l.clave)}">${esc(l.nombre)}</option>`).join('');
    let guardada = '';
    try { guardada = localStorage.getItem(SEMANA_LISTA_KEY) || ''; } catch (e) {}
    const bari = db.listas.find(l => /bari/i.test(l.clave + l.nombre));
    selLista.value = db.listas.some(l => l.clave === guardada) ? guardada : (bari ? bari.clave : 'chacra');
  }
  const lista = selLista.value || 'chacra';

  const r = semanaDatos && semanaDatos.r;
  const prov = r && r.proveedores;
  const semana = (prov && prov.semana) || viernesDe(hoy());
  const jueves = masDias(semana, 6);

  // Selector de semana: las que tienen algo cargado.
  const selSem = $('#semana-semana');
  const semanas = (prov && prov.semanas && prov.semanas.length) ? prov.semanas : [semana];
  selSem.innerHTML = semanas.map(s => `<option value="${s}">viernes ${diaCorto(s)}</option>`).join('');
  selSem.value = semana;

  const estado = $('#semana-estado');
  estado.textContent = semanaCargando ? 'Pidiendo el stock de la semana…'
    : semanaError ? semanaError
    : r ? `Para la tienda del lunes ${diaCorto(masDias(semana, 3))} · entrega el jueves ${diaCorto(jueves)} · traído el ` +
          new Date(semanaDatos.traida).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : (urlSync() ? '' : 'Configurá la sincronización para traer el stock.');
  estado.classList.toggle('alerta', !!semanaError);

  if (!r) {
    cont.innerHTML = semanaCargando ? '' : '<p class="empty">Todavía no llegó el stock de la semana.</p>';
    return;
  }

  const kg = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const cant = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });

  /* ---- Tica ---- */
  let ticaHtml, ticaVenta = 0, ticaKg = 0;
  if (r.ticaError) {
    ticaHtml = `<p class="hint alerta">${esc(r.ticaError)}</p>`;
  } else {
    const filas = ticaPorCultivo(r.tica, jueves).map(g => {
      const p = productoParaCultivo(g.cultivo);
      const pk = precioPorKg(p, lista);
      let venta = 0;
      if (g.kg && pk.valor) venta += g.kg * pk.valor;
      // Lo que se relevó contado (lechugas, atados): por unidad si el producto se vende así.
      if (g.sinKg && p && clave(p.unidad) !== 'kg') {
        Object.values(g.unidades).forEach(n => { venta += n * precioDe(p, lista); });
      }
      return { ...g, producto: p, venta: Math.round(venta), motivo: p ? '' : 'no está en Productos' };
    }).sort((a, b) => (b.ahora - a.ahora) || (b.venta - a.venta) || (b.kg - a.kg));
    const ahora = filas.filter(f => f.ahora), despues = filas.filter(f => !f.ahora);
    ticaVenta = ahora.reduce((a, f) => a + f.venta, 0);
    ticaKg = ahora.reduce((a, f) => a + f.kg, 0);
    const renglon = f => `<tr class="${f.venta ? '' : 'sin-precio'}">
        <td><b>${esc(f.cultivo)}</b>${f.variedad ? ` <small class="en-linea">${esc(f.variedad)}</small>` : ''}
          <small>${f.lugares} ${f.lugares === 1 ? 'lugar' : 'lugares'}${f.disponible > semana ? ` · desde el ${diaCorto(f.disponible)}` : ''}</small>
          ${f.motivo ? `<small class="motivo">${esc(f.motivo)}</small>` : ''}</td>
        <td class="n">${[f.kg ? kg(f.kg) + ' kg' : '']
          .concat(Object.entries(f.unidades).map(([u, n]) => `${cant(n)} ${esc(u)}`)).filter(Boolean).join('<br>')}</td>
        <td class="n"><b>${f.venta ? fmt(f.venta) : '—'}</b></td>
      </tr>`;
    ticaHtml = filas.length ? `
      <div class="proy-scroll"><table class="proy-tabla">
        <thead><tr><th>Cultivo</th><th class="n">Hay</th><th class="n">Venta posible</th></tr></thead>
        <tbody>${ahora.map(renglon).join('') ||
          '<tr><td colspan="3" class="empty">Nada listo para esta semana.</td></tr>'}</tbody>
      </table></div>
      ${despues.length ? `<details class="sem-despues"><summary>${despues.length} cultivo(s) todavía no están para el jueves ${diaCorto(jueves)}</summary>
        <div class="proy-scroll"><table class="proy-tabla"><tbody>${despues.map(renglon).join('')}</tbody></table></div></details>` : ''}`
      : '<p class="empty">AMA Producción no tiene stock relevado de Tica.</p>';
  }

  /* ---- Proveedores ---- */
  let provHtml, provVenta = 0, provCosto = 0, ofrecidos = 0, consultados = 0, total = 0, faltan = [];
  if (r.proveedoresError) {
    provHtml = `<p class="hint alerta">${esc(r.proveedoresError)}</p>`;
  } else {
    total = prov.proveedores.length;
    consultados = prov.proveedores.filter(p => p.estado || p.productos.length).length;
    faltan = prov.sinConsultar || [];
    const bloques = prov.proveedores.filter(p => p.estado || p.productos.length).map(p => {
      const filas = p.productos.map(x => {
        const prod = productoParaCultivo(x.producto);
        const vu = ventaPorUnidad(x, prod, lista);
        const costo = num(x.precio) * x.cantidad;
        const venta = vu ? Math.round(vu * x.cantidad) : 0;
        ofrecidos++;
        provCosto += costo;
        if (venta) provVenta += venta;
        const margen = venta && num(x.precio) ? Math.round(100 * (vu - num(x.precio)) / vu) : null;
        const motivo = !prod ? 'no está en Productos'
          : !vu ? 'no se puede pasar a la presentación del catálogo' : '';
        return `<tr class="${venta ? '' : 'sin-precio'}">
          <td><b>${esc(x.producto)}</b><small>${cant(x.cantidad)} × ${esc(porUnidadTexto(x))}${
            x.precio !== '' ? ` · le pagamos ${fmt(x.precio)}` : ''}</small>
            ${motivo ? `<small class="motivo">${esc(motivo)}</small>` : ''}</td>
          <td class="n">${vu ? fmt(Math.round(vu)) : '—'}</td>
          <td class="n ${margen != null && margen < 20 ? 'sem-bajo' : ''}">${margen != null ? margen + '%' : '—'}</td>
          <td class="n"><b>${venta ? fmt(venta) : '—'}</b></td>
        </tr>`;
      }).join('');
      const chip = p.estado === 'no ofrece' ? '<span class="sem-chip nada">no ofrece</span>'
        : '<span class="sem-chip listo">ofrece</span>';
      return `<tbody class="sem-prov">
        <tr class="sem-prov-cab"><td colspan="4"><b>${esc(p.nombre)}</b> ${chip}
          ${p.nota ? `<small class="sem-nota">«${esc(p.nota)}»</small>` : ''}</td></tr>
        ${filas}</tbody>`;
    }).join('');
    provHtml = `
      ${faltan.length ? `<p class="hint alerta">Falta consultar: ${faltan.map(esc).join(', ')}.</p>` : ''}
      ${bloques ? `<div class="proy-scroll"><table class="proy-tabla sem-tabla">
        <thead><tr><th>Producto</th><th class="n">Venta c/u</th><th class="n">Margen</th><th class="n">Venta posible</th></tr></thead>
        ${bloques}</table></div>` : '<p class="empty">Nati todavía no cargó ningún proveedor esta semana.</p>'}`;
  }

  const nombreLista = listaPorClave(lista).nombre;
  cont.innerHTML = `
    <div class="kpis">
      <div class="kpi kpi-in"><span class="kpi-label">Venta posible (${esc(nombreLista)})</span>
        <span class="kpi-val">${fmt(ticaVenta + provVenta)}</span></div>
      <div class="kpi kpi-bal"><span class="kpi-label">Tica, listo para el jueves</span>
        <span class="kpi-val">${kg(ticaKg)} kg</span></div>
      <div class="kpi ${faltan.length ? 'kpi-debt' : ''}"><span class="kpi-label">Proveedores consultados</span>
        <span class="kpi-val">${consultados} de ${total}</span></div>
      <div class="kpi kpi-out"><span class="kpi-label">Si se vende todo, a proveedores</span>
        <span class="kpi-val">${fmt(provCosto)}</span></div>
    </div>
    <h3 class="sem-titulo">Tica · lo propio</h3>
    <p class="hint">Lo que puede sobrar: el bolsón arranca por acá.</p>
    ${ticaHtml}
    <h3 class="sem-titulo">Proveedores · ${ofrecidos} producto(s)</h3>
    <p class="hint">Es un tope para publicar: el miércoles se les pide solo lo vendido.</p>
    ${provHtml}
    <p class="hint proy-nota">
      Precios de venta de la lista <b>${esc(nombreLista)}</b> (Productos), pasados a la presentación
      que ofrece cada uno. Lo que no está en Productos o no se puede comparar queda sin precio y lo dice.
      El margen sale en ocre si es menor al 20 %.
    </p>`;
}

$('#semana-lista').addEventListener('change', () => {
  try { localStorage.setItem(SEMANA_LISTA_KEY, $('#semana-lista').value); } catch (e) {}
  renderSemana();
});
$('#semana-semana').addEventListener('change', () => traerSemana(false, $('#semana-semana').value));
// Actualizar: mirando la última semana, pide "la última" (puede haber empezado
// otra); mirando una vieja, esa misma.
$('#btnSemana').addEventListener('click', () => {
  const p = semanaDatos && semanaDatos.r && semanaDatos.r.proveedores;
  traerSemana(true, p && p.semanas && p.semana !== p.semanas[0] ? p.semana : '');
});
