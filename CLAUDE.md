# Bioma · Gestión económica — contexto del proyecto

Este archivo se lee solo al abrir el proyecto. Es la memoria: qué es esto,
cómo está hecho, qué se decidió y qué errores ya cometimos.
Antes de proponer cambios, leer también `PLAN.md` (fases) y
`DECISIONES.md` (por qué las cosas son como son + registro de errores).

## Qué es

App de gestión económica del **Proyecto Bioma**, emprendimiento agroecológico
que produce en **Chacra Tica** (Comarca Andina del Paralelo 42).

- **Socios:** Luna, Tomi, Belu, Nati, Luis y Martín.
- **Esta app la usan solo Martín y Luna**, que llevan administración y
  comercialización. Los demás socios están en MonAgric, no acá.
- **App publicada:** <https://martintrigo.github.io/bioma-mov/>
- **Planilla:** `bioma-db` en Drive, carpeta del proyecto.
- **Repositorio: PÚBLICO.** Nunca subir la URL del Web App ni datos reales.

## El ecosistema

Todo vive en `C:\MARTO\INFORMATICA\` y en GitHub de MartinTrigo:

| Proyecto | Qué hace | Relación con esta app |
|---|---|---|
| **MonAgric** | Producción: chacras, bancales, siembras, cosechas, objetivos | Futuro: la cosecha alimenta el stock de Bioma |
| **Bioma/movimientos** | Esta app: economía y comercialización | — |
| **Bioma/registro-horas** | Horas de trabajo de los socios | Los sueldos aparecen como egresos acá |
| **Cocina Viva** | Ventas, stock y consignación de fermentos | **Modelo a imitar**: más madura, misma arquitectura |
| **BioSalud** | (a futuro) | Podría aportar datos algún día |

Cuando haya que resolver algo que Cocina Viva ya resolvió (ventas con detalle,
remitos, consignación, control de acceso), **mirar cómo lo hizo ahí antes de
inventar**: `C:\MARTO\INFORMATICA\Cocina Viva\docs\js\`.

## Arquitectura

PWA en HTML + CSS + JavaScript puro. **Sin frameworks, sin dependencias, sin
compilación.** Se edita un archivo y se recarga.

```
index.html          las pantallas
styles.css          estilo (paleta verde/tierra del logo)
js/util.js          helpers: $, fmt, fechas, esc, toast
js/db.js            estado local (localStorage) y su esquema
js/sincro.js        sincronización con la planilla
js/movimientos.js   ingresos y egresos
js/deudas.js        deudas
js/productos.js     catálogo y precios
js/ventas.js        ventas por producto y punto de venta
js/ventas-importar.js  importar la descarga de la tienda virtual
js/resumen.js       resumen mensual
js/respaldo.js      exportar / importar
app.js              arranque y pestañas (se carga ÚLTIMO)
apps-script/Code.gs  el "servidor": vive en la planilla
```

Los scripts se cargan en ese orden con `<script>` clásicos; no son módulos ES.
Al agregar un archivo nuevo hay que sumarlo a `index.html` **y** a `sw.js`.

**Publicación:** GitHub Pages sirve desde la raíz de `main`. Cada `git push`
publica. Al cambiar archivos hay que subir `CACHE` en `sw.js` (`bioma-vN`).

## Reglas duras (romperlas ya causó problemas reales)

1. **La planilla manda.** La hoja `conceptos` es la única fuente de verdad de
   los conceptos. La app **jamás** sube su lista completa: solo los creados con
   "+ agregar nuevo…". El servidor ignora conceptos de clientes que no envíen
   `cliente: 2`.
2. **Nunca borrar por ausencia.** Un registro local solo se elimina si el
   servidor confirma su tumba (`borrados`). Una respuesta vacía o incompleta
   jamás debe vaciar el dispositivo.
3. **Protocolo versionado.** El servidor responde `api: N` y la app descarta
   toda respuesta sin ese campo. Así una implementación vieja del Apps Script
   no puede corromper los datos.
4. **Al actualizar el Apps Script**: Implementar → **Administrar
   implementaciones** → ✏ → Nueva versión. Nunca "Nueva implementación": crea
   otra URL y quedan dos versiones peleando.
5. **Nada de secretos en el repo.** Es público. La URL del Web App es la
   contraseña de los datos.
6. **Verificar en el navegador antes de publicar.** Levantar
   `python -m http.server 8642` y ejercitar el cambio de verdad, no solo leer
   el código. Los peores errores de este proyecto pasaron por no hacerlo.

## Cómo trabajar acá

```bash
# probar local
python -m http.server 8642      # y abrir http://localhost:8642

# ver el estado real de la planilla (sin tocar nada)
curl -sL "<URL del Web App>" | python -m json.tool
```

La URL del Web App **no está en el repo**. Pedírsela al usuario, o sacarla de
la app: botón ⭳ → campo "URL de sincronización".

## Decisiones ya tomadas sobre lo que viene

No volver a discutirlas salvo que el usuario las reabra (detalle en `PLAN.md`):

- **Ventas**: una hoja `ventas` por temporada, un renglón por producto vendido.
  No una hoja por cliente. La app no se baja todas las ventas: manda las nuevas
  y se trae resúmenes.
- **Carga**: a mano en el celular para feria y verdulerías; importando el
  archivo de **Whataform** (la tienda virtual) para los núcleos.
- **Nombres**: Whataform entrega nombres publicados que cambian cada semana
  (181 variantes vistas). Hace falta una hoja `equivalencias` que la app va
  aprendiendo; nunca inventar una equivalencia.
- **Bolsones**: se registran como unidad vendida **y** abiertos en sus
  componentes, marcados para no sumar dos veces.
- **Nombre de la app**: "Bioma · Gestión Económica" es lo que se ve. La
  dirección sigue siendo `bioma-mov` a propósito: cambiarla obliga a
  reinstalar la app en cada teléfono.

## Estado actual

Hechas las fases 0 a 4 (carga): movimientos, deudas, catálogo de ~100
productos con categorías y 4 listas de precio, **ventas por producto y punto
de venta** con importador de la tienda virtual, resumen con tablas mes a mes,
sincronización blindada y respaldos diarios.

**Lo más importante que falta**, en orden: cargar los SKU en Whataform (hace
confiable el importador), los bolsones abiertos en componentes, y la
planificación semanal (Fase 4.7). Todo en `PLAN.md`.

## Ventas: lo que hay que saber

- Una hoja `ventas`, **un renglón por producto vendido**. `venta` agrupa los
  renglones de una misma operación; `origen` dice si vino a mano, de una
  planilla, o de abrir un bolsón (esos no se suman al facturado).
- La app guarda y manda solo los **últimos 300 renglones**; la planilla los
  conserva todos. No romper ese tope sin pensar.
- La venta guarda el **nombre** del producto, no su id: sobrevive a que el
  producto se renombre o se borre del catálogo.
- En el renglón se **elige por nombre** ("Acelga", "Miel"), nunca
  "Acelga · 1 kg". La presentación aparece en un selector aparte y **solo
  cuando el producto tiene más de una**. Al lado de la cantidad se muestra la
  unidad que corresponde según la hoja `productos` (kg, frascos, atados) y,
  si la presentación dice peso, el equivalente en kg.
- La columna **`kg` se guarda calculada** (cantidad × peso de la
  presentación), no se deduce al analizar: es la métrica que se quiere mirar y
  no debe cambiar si mañana cambia la presentación del producto. Queda vacía
  cuando no hay peso (10 ml, maple x30).
- El importador reconoce por **SKU → nombre → equivalencia aprendida**, y lo
  que no reconoce lo deja pendiente. **Nunca inventar una equivalencia**: un
  error acá ensucia el análisis de toda la temporada.
