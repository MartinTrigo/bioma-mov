/* ============================================================
   Proyección: cuánto podría dar la temporada si se vende lo planificado.

   Cada lado decide lo suyo y acá solo se cruzan:
   · AMA Producción dice QUÉ se plantó, cuánto y con qué rinde (el plan de
     su configuración). Llega por el script de bioma-db, que se lo pide a
     AMA de servidor a servidor: el navegador nunca ve esa dirección.
   · Esta app pone los PRECIOS: la hoja productos, con la lista elegida.

   Nada de esto se guarda en la planilla. Si cambia el plan o un precio, la
   proyección cambia sola: no hay una copia que actualizar.
   ============================================================ */

// Lo último que respondió AMA, para poder mirarlo sin señal. Va aparte del
// estado de la app a propósito: guardarlo con save() encendería el aviso de
// "cambios sin subir", y esto no se sube a ningún lado.
const PROYECCION_KEY = 'bioma-proyeccion';
const API_PROYECCION = 9;

let proyeccion = leerProyeccionGuardada();
let proyeccionPedida = false; // una vez por sesión al entrar; después, el botón
let proyeccionError = '';
let proyeccionCargando = false;

function leerProyeccionGuardada() {
  try { return JSON.parse(localStorage.getItem(PROYECCION_KEY) || 'null'); }
  catch (e) { return null; }
}

// Al entrar a la pestaña. Se pide una sola vez por sesión: dibujar nunca pide
// datos, así no se arma un lazo de pedir → dibujar → pedir.
function entrarProyeccion() {
  renderProyeccion();
  if (!proyeccionPedida) traerProyeccion(false);
}

async function traerProyeccion(refrescar) {
  const url = urlSync();
  if (!url || proyeccionCargando) return;
  proyeccionPedida = true;
  proyeccionCargando = true;
  proyeccionError = '';
  renderProyeccion();
  try {
    let texto;
    try {
      const res = await fetch(url, {
        method: 'POST',
        // sin Content-Type: evita el preflight CORS que Apps Script no soporta
        body: JSON.stringify({ action: 'proyeccion', refrescar: !!refrescar })
      });
      texto = await res.text();
    } catch (e) {
      proyeccionError = 'Sin conexión: se muestra lo último que llegó.';
      return;
    }
    /* Si Apps Script falla antes de llegar al código (un permiso sin aprobar,
       una implementación rota) devuelve una página de Google, no datos. Antes
       eso se leía como "sin conexión" y no había pista de qué pasaba. */
    let r;
    try { r = JSON.parse(texto); } catch (e) {
      const legible = String(texto || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      proyeccionError = 'bioma-db no devolvió la proyección' + (legible ? ': «' + legible + '»' : '.');
      return;
    }
    if (!(r.api >= API_PROYECCION)) {
      proyeccionError = 'El script de bioma-db todavía no sabe pedir la proyección: ' +
        'falta implementar su nueva versión.';
    } else if (r.error) {
      proyeccionError = r.error;
    } else {
      proyeccion = { datos: r.proyeccion, traida: new Date().toISOString() };
      try { localStorage.setItem(PROYECCION_KEY, JSON.stringify(proyeccion)); } catch (e) {}
    }
  } catch (e) {
    proyeccionError = 'Error al leer la proyección: ' + (e && e.message || e);
  } finally {
    proyeccionCargando = false;
    renderProyeccion();
  }
}

/* ================= Cruce de nombres =================
   AMA y el catálogo nombran distinto algunas cosas: "Brocoli" y "Broccoli",
   "Choclos" y "Choclo", "Repollo bco" y "Repollos". Se comparan sin tildes,
   sin letras dobles y en singular; si no, por la primera palabra. Lo que no
   se encuentra queda sin precio y lo dice: nunca se adivina un producto. */
function formaComparable(s) {
  return clave(s).replace(/[^a-zñ ]/g, ' ').replace(/(.)\1+/g, '$1')
    .split(/\s+/).filter(Boolean)
    .map(p => p.length > 3 ? p.replace(/(es|s)$/, '') : p);
}

// Entre varios productos con el mismo nombre ("Mix de hojas" por kg y en pack
// de 250 g) sirve primero el que se vende por kg, después el que dice su peso.
function mejorProducto(lista) {
  const puntaje = p => (p.activo !== false ? 4 : 0) +
    (clave(p.unidad) === 'kg' ? 2 : pesoUnitarioKg(p) != null ? 1 : 0) +
    (num(p.chacra) > 0 ? 1 : 0);
  return lista.slice().sort((a, b) => puntaje(b) - puntaje(a))[0] || null;
}

function productoParaCultivo(cultivo) {
  const buscado = formaComparable(cultivo);
  if (!buscado.length) return null;
  const candidatos = db.productos.filter(p => categoriaDe(p) !== 'bolsón');
  const todo = candidatos.filter(p => formaComparable(p.nombre).join(' ') === buscado.join(' '));
  if (todo.length) return mejorProducto(todo);
  // "Repollo bco" → "repollo": solo si el producto es de una sola palabra, para
  // que "Tomate" no termine con el precio de "Tomate Cherry".
  const primera = candidatos.filter(p => {
    const f = formaComparable(p.nombre);
    return f.length === 1 && f[0] === buscado[0];
  });
  return mejorProducto(primera);
}

/* Precio por kg del producto en la lista elegida. Si se vende por atado y la
   presentación no dice cuánto pesa, no hay manera honesta de pasarlo a kg. */
function precioPorKg(p, lista) {
  if (!p) return { motivo: 'no está en Productos' };
  const precio = precioDe(p, lista);
  if (!precio) return { motivo: 'sin precio cargado' };
  const peso = pesoUnitarioKg(p);
  if (!peso) return { motivo: `se vende por ${p.unidad || 'unidad'} y no dice cuánto pesa` };
  return { valor: precio / peso };
}

/* ================= Dibujo ================= */

function filasProyeccion(lista) {
  const plan = (proyeccion && proyeccion.datos && proyeccion.datos.plan) || [];
  return plan.map(c => {
    const p = productoParaCultivo(c.cultivo);
    const pk = precioPorKg(p, lista);
    return {
      ...c, producto: p, precioKg: pk.valor || 0, motivo: pk.motivo || '',
      subtotal: pk.valor ? Math.round(c.kg * pk.valor) : 0
    };
  });
}

function renderProyeccion() {
  const cont = $('#proyeccion-contenido');
  if (!cont) return;
  const selLista = $('#proyeccion-lista');
  if (!selLista.options.length) {
    selLista.innerHTML = db.listas.map(l =>
      `<option value="${esc(l.clave)}">${esc(l.nombre)}</option>`).join('');
  }
  const lista = selLista.value || 'chacra';
  const orden = $('#proyeccion-orden').value || 'plata';

  const estado = $('#proyeccion-estado');
  const d = proyeccion && proyeccion.datos;
  estado.textContent = proyeccionCargando ? 'Pidiendo el plan a AMA Producción…'
    : proyeccionError ? proyeccionError
    : d ? `${d.nombre} · temporada ${d.temporada} · plan de AMA Producción del ` +
          new Date(proyeccion.traida).toLocaleString('es-AR',
            { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : (urlSync() ? '' : 'Configurá la sincronización para traer el plan.');
  estado.classList.toggle('alerta', !!proyeccionError);

  if (!d) {
    cont.innerHTML = proyeccionCargando ? '' :
      '<p class="empty">Todavía no llegó el plan de AMA Producción.</p>';
    return;
  }

  const filas = filasProyeccion(lista);
  const conPrecio = filas.filter(f => f.precioKg);
  const sinPrecio = filas.filter(f => !f.precioKg);
  const total = conPrecio.reduce((a, f) => a + f.subtotal, 0);
  const kgTotal = filas.reduce((a, f) => a + f.kg, 0);
  const kgSinPrecio = sinPrecio.reduce((a, f) => a + f.kg, 0);
  const m2 = filas.reduce((a, f) => a + f.superficie_m2, 0);

  const ordenes = {
    plata: (a, b) => b.subtotal - a.subtotal || b.kg - a.kg,
    kg: (a, b) => b.kg - a.kg,
    nombre: (a, b) => a.cultivo.localeCompare(b.cultivo, 'es')
  };
  filas.sort(ordenes[orden] || ordenes.plata);

  const kg = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const dec = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });

  const renglones = filas.map(f => {
    const otroNombre = f.producto && clave(f.producto.nombre) !== clave(f.cultivo)
      ? ` · precio de «${esc(f.producto.nombre)}»` : '';
    return `<tr class="${f.precioKg ? '' : 'sin-precio'}">
      <td><b>${esc(f.cultivo)}</b>
        <small>${dec(f.superficie_m2)} m²${f.bancales ? ` · ${dec(f.bancales)} bancales` : ''}
          · ${dec(f.rinde_kg_m2)} kg/m²${f.generaciones ? ` · ${f.generaciones} gen.` : ''}${otroNombre}</small>
        ${f.motivo ? `<small class="motivo">${esc(f.motivo)}</small>` : ''}</td>
      <td class="n">${kg(f.kg)}</td>
      <td class="n">${f.precioKg ? fmt(Math.round(f.precioKg)) : '—'}</td>
      <td class="n"><b>${f.precioKg ? fmt(f.subtotal) : '—'}</b></td>
    </tr>`;
  }).join('');

  const nombreLista = listaPorClave(lista).nombre;
  cont.innerHTML = `
    <div class="kpis">
      <div class="kpi kpi-in"><span class="kpi-label">Potencial de la temporada</span>
        <span class="kpi-val">${fmt(total)}</span></div>
      <div class="kpi kpi-bal"><span class="kpi-label">Kg esperados</span>
        <span class="kpi-val">${kg(kgTotal)} kg</span></div>
      <div class="kpi"><span class="kpi-label">Superficie planificada</span>
        <span class="kpi-val">${kg(m2)} m²</span></div>
      <div class="kpi ${sinPrecio.length ? 'kpi-debt' : ''}"><span class="kpi-label">Cultivos con precio</span>
        <span class="kpi-val">${conPrecio.length} de ${filas.length}</span></div>
    </div>
    <div class="proy-scroll">
      <table class="proy-tabla">
        <thead><tr><th>Cultivo</th><th class="n">Kg</th><th class="n">$/kg</th><th class="n">Subtotal</th></tr></thead>
        <tbody>${renglones}</tbody>
        <tfoot><tr><td>Total potencial</td><td class="n">${kg(kgTotal)}</td><td></td>
          <td class="n">${fmt(total)}</td></tr></tfoot>
      </table>
    </div>
    <p class="hint proy-nota">
      Precios de la lista <b>${esc(nombreLista)}</b>, pasados a kg con la presentación de cada
      producto. Es el techo: no descuenta pérdidas, lo que se consume en la chacra ni lo
      que no se venda.
      ${sinPrecio.length ? `<br><b>${kg(kgSinPrecio)} kg de ${sinPrecio.length} cultivo(s) no suman</b>
        porque les falta el precio o el peso: se completa en Productos.` : ''}
      <br>Los kilos, el rinde y la superficie se cambian en AMA Producción → Plan.
    </p>`;
}

$('#proyeccion-lista').addEventListener('change', renderProyeccion);
$('#proyeccion-orden').addEventListener('change', renderProyeccion);
$('#btnProyeccion').addEventListener('click', () => traerProyeccion(true));
