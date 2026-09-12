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

## La temporada

Bioma no se maneja por año calendario sino **por temporada, que arranca en
julio**. Saberlo cambia cómo se lee cualquier número: comparar enero con
febrero no dice nada si uno es plena cosecha y el otro también, pero comparar
julio con noviembre es comparar dos mundos.

| mes | qué pasa |
|---|---|
| **julio** | planificación de la temporada que empieza |
| **agosto** | primeras siembras |
| set–oct | trasplantes |
| **noviembre** | primeras cosechas |
| nov–**mayo** | cosecha y venta, el grueso del movimiento |
| **junio** | receso de invierno |

Así que "2026-27" va del 1/7/2026 al 30/6/2027. Está en
`MES_INICIO_TEMPORADA` dentro de `Economia.gs`, y es lo único que hay que
cambiar si el corte se corre algún año.

Consecuencias prácticas: los ingresos se concentran en el verano y los
egresos de horas arrancan mucho antes, así que **un balance negativo entre
agosto y octubre es lo normal**, no una alarma. Al mostrar un mes suelto
conviene decir en qué etapa cae.

## El ecosistema

Todo vive en `C:\MARTO\INFORMATICA\` y en GitHub de MartinTrigo:

| Proyecto | Qué hace | Relación con esta app |
|---|---|---|
| **AMA** (antes MonAgric) | Producción: chacras, bancales, siembras, cosechas, objetivos, horas | Carga las horas; muestra las cuentas y el resumen económico que sirve esta app |
| **Bioma/movimientos** | Esta app: economía y comercialización | — |
| **Bioma/registro-horas** | Horas de trabajo de los socios | Los sueldos aparecen como egresos acá |
| **Cocina Viva** | Ventas, stock y consignación de fermentos | **Modelo a imitar**: más madura, misma arquitectura |
| **BioSalud** | (a futuro) | Podría aportar datos algún día |

**AMA = App de Monitoreo Agrícola Agroecológico.** Es el nombre nuevo de
MonAgric (sept 2026). La carpeta y el repositorio siguen llamándose
`MonAgric`: renombrarlos rompería los enlaces. El ecosistema entero se llama
AMA. Se puede leer su código desde acá; pedir acceso a
`C:\MARTO\INFORMATICA\MonAgric` si no está concedido.

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
js/movimientos.js   egresos (los ingresos se cargan desde Ventas)
js/deudas.js        deudas
js/productos.js     catálogo y precios
js/ventas.js        ventas por producto y punto de venta
js/ventas-importar.js  importar la descarga de la tienda virtual
js/resumen.js       resumen mensual
js/respaldo.js      exportar / importar
app.js              arranque y pestañas (se carga ÚLTIMO)
apps-script/Code.gs  el "servidor": vive en la planilla
apps-script/Cuentas.gs  endpoint SOLO LECTURA de cuentas de trabajadores,
                        proyecto de Apps Script APARTE (ver CUENTAS.md)
apps-script/Economia.gs endpoint SOLO LECTURA del resumen económico,
                        otro proyecto APARTE (ver ECONOMIA.md)
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

- **No existe pantalla de Ingresos.** Se eliminó: tener las dos obligaba a
  cargar la misma venta dos veces. Ventas es ahora la única entrada de plata.
- **Cada operación guardada escribe en dos hojas**, atadas por el mismo id:
  `ingresos` (un renglón con el total, de donde salen el resumen y las tablas
  mes a mes) y `ventas` (un renglón por producto, cuando hay detalle).
  Editar o borrar toca las dos a la vez: no pueden divergir.
- **No toda la plata que entra es venta de mercadería**: préstamos, talleres y
  rendimiento financiero no tienen productos. Si no se carga ningún producto,
  el monto se escribe a mano en el mismo formulario. No romper esto.
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

## Horas de trabajo

- **Se cargan en MonAgric**, no acá y no por un formulario de Google.
  MonAgric las envía con su propio Apps Script a la planilla de horas
  (id en `ID_PLANILLA_HORAS` dentro de `Code.gs`), de donde esta app las
  lee. Son **el grueso del costo de la temporada**.
- **Las validaciones de carga van en MonAgric**, que es donde se escriben:
  qué actividades se ofrecen, qué campos son obligatorios. Acá solo se
  leen. No intentar corregir el origen desde este lado.
- El script las lee, las normaliza y las deja en la hoja `horas` de
  bioma-db. Esa hoja **se reescribe entera**: corregir en la planilla de
  origen, nunca acá.
- Las fechas vienen en **tres formatos** (`d/m/aaaa`, `d/m/aa` y
  `d/m/aaaa 12:00:00`) según se carguen por formulario o a mano. Sin
  normalizarlas los meses salen mal. Lo que no se entiende **se descarta y
  se avisa**; no se adivina.
- La tarifa sale de la hoja "Cuenta individual — Nombre" de cada persona,
  así respeta tarifas distintas.
- **No corre en cada sincronización** (leer otra planilla es lento): va con
  el respaldo diario, o a mano con `importarHoras`.
- A la app viajan **agregadas por mes + persona + área**, no los ~400
  registros sueltos.
- **Lo devengado no es un egreso hasta que se paga.** Mientras tanto es
  plata que el proyecto debe. Por eso se muestra aparte del balance y no
  se suma al flujo de fondos.
- **Liquidar = un egreso con concepto `sueldos`** y la persona en la
  columna `persona` de la hoja `egresos`. El saldo de cada trabajador es
  devengado − pagado. Sin la persona no se puede saber a quién se le debe,
  así que la app no deja guardar un egreso de sueldos sin ella.
- Los conceptos `jornal` y `hs jornal` (duplicados entre sí) se unificaron
  en `sueldos`.

## Cuentas de los trabajadores

El camino de los datos tiene tres saltos, y conviene no olvidarlo:

```
MonAgric  →  planilla de horas  →  bioma-db  →  MonAgric
 (carga)      (recibe)              (calcula)    (muestra)
```

- **bioma-db calcula, MonAgric muestra.** La deuda solo se puede calcular
  acá, que es el único lugar con los dos lados: devengado (horas) y pagado
  (egresos `sueldos`). Llevarla también en la planilla de horas daría dos
  verdades sobre la misma plata. Por eso la hoja "Registro de pagos
  realizados" de esa planilla se jubila.
- **Los pagos se cargan solo en esta app.** MonAgric no registra pagos ni
  recalcula saldos: los pide y los dibuja.
- La consulta va por un **proyecto de Apps Script aparte**
  (`Cuentas.gs`), de solo lectura. Un proyecto tiene un solo `doGet`, así
  que no puede convivir con `Code.gs`; y la URL de `Code.gs` permite
  escribir toda la economía, de modo que **no puede ir dentro de MonAgric**.
  La de `Cuentas.gs` sí: lo peor que se puede hacer con ella es mirar
  cuentas de sueldos.
- **Quién ve qué lo decide AMA, no este lado.** Acá viaja todo en una sola
  respuesta porque el endpoint no puede saber quién pregunta; AMA sí, porque
  cada teléfono tiene una credencial asociada a una persona. Los socios ven
  las cuentas del equipo y cada trabajador la suya (hoy Juanfra y Luqui).
  Está implementado en AMA con dos propiedades de script: `CUENTAS_URLS` y
  `CUENTAS_VEN_TODO`.
- **La regla dura que sostiene todo eso:** la consulta la hace el **servidor**
  de AMA con `UrlFetchApp`, nunca el navegador. Si el teléfono pidiera la URL
  directo, cualquiera vería las cuentas de todos y el filtro no serviría de
  nada. Lo mismo vale para `Economia.gs`.
- El contrato completo (qué devuelve, qué no hace, cómo se instala) está en
  `apps-script/CUENTAS.md`. Es el papel que se pasa a la conversación de AMA.

### Los endpoints de consulta

Son **tres proyectos de Apps Script distintos**, no tres archivos de uno:
cada proyecto tiene un solo `doGet`.

| script | qué devuelve | contrato | puede ir en MonAgric |
|---|---|---|---|
| `Code.gs` | todo, y **escribe** | — | **NO. Nunca.** |
| `Cuentas.gs` | cuentas de trabajadores | `CUENTAS.md` | sí |
| `Economia.gs` | resumen económico agregado | `ECONOMIA.md` | sí |

Los dos de consulta comparten forma: solo lectura, `api: 1`, responden
`{"api":1,"error":"..."}` en vez de romper, y **repiten** sus herramientas
(`leerHoja_`, `texto_`, `numero_`…) a propósito: son proyectos separados y
una biblioteca común los ataría entre sí.

- `Economia.gs` **no manda movimientos sueltos ni nombres**: solo agregados
  por mes y por concepto, con los porcentajes ya calculados. Si MonAgric
  hiciera las cuentas, en algún momento diferirían de las de acá.
- `Economia.gs` también manda **las horas por área y actividad** (sin
  nombres): es el logro de haber registrado las horas y se comparte con todo
  el equipo. Las actividades van anidadas dentro del área a propósito: saber
  que hubo 40 horas de "Siembras" sirve poco; importa de qué área fueron.
- El **gráfico de flujo ingresos–egresos** sale de `meses`, que ya trae
  ingresos, egresos y balance de cada uno. No hace falta un campo aparte.
- **La temporada empieza en julio** (`MES_INICIO_TEMPORADA`). Ver la sección
  "La temporada" más arriba. bioma-db no registra temporadas en ninguna parte:
  es una convención de `Economia.gs`.
- Al implementar, **"Quién tiene acceso" va en "Cualquier usuario"**. Si
  queda en "cualquier usuario con una cuenta de Google", el endpoint
  devuelve la pantalla de login en vez del JSON.
