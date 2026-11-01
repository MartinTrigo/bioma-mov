# Plan de desarrollo

Una fase por vez, verificada antes de pasar a la siguiente. El orden pondera
tres cosas: **riesgo de romper lo que ya funciona**, **valor para la temporada**
y **qué depende de qué**.

---

# Lo próximo · al 31/10/2026

## Comercialización semanal (Fase 4.7) — etapa 1 hecha el 31/10, falta instalar

**Estado al 31/10:** la etapa 1 está hecha y probada con datos simulados
(`apps-script/stock-proveedores/pruebas.html` y `pruebas-servidor.html`, todo
en verde). La planilla de Nati ya existe en Drive. **Falta que Martín instale
los tres scripts** (pasos en `apps-script/stock-proveedores/LEEME.md`):
el de la planilla de Nati (y pasarle el enlace), `Code.gs` de bioma-db con
`STOCK_PROVEEDORES_ID`, y `Code.gs` de AMA Producción. Después, mirar con el
primer viernes de verdad: que los nombres de Productos crucen con el catálogo
(lo que no, sale «no está en Productos») y si a Nati la página le resulta
cómoda.

**Decisión (Martín, 31/10):** la planificación semanal de la venta va
**dentro de AMA Economía**, no en una app nueva. Necesita el catálogo, las
listas de precios, los puntos de venta y las ventas importadas, que ya viven
acá; y la receta del bolsón es lo que la Fase 4 necesita para abrirlo en sus
componentes. Reabrir solo si la comercialización pasa a ser compartida entre
chacras o si planifica alguien que no debe ver la economía de Bioma.

Reemplaza a la planilla «Comecialización bioma26-27» (hojas Stock y
DISTRIBUCION VENTAS) y a «Gestión de Proveedores Bioma», ambas en la carpeta
de comercialización de Drive. Las dos son de la temporada pasada: tienen días
y logística que ya no van.

### La semana, desde la temporada 2026-27

| día | qué pasa |
|---|---|
| **viernes** | se releva el stock: Tica en el campo, Nati con los proveedores |
| **sábado** | se arma la oferta (bolsón, extras, puntos de venta) y se actualiza la tienda |
| lunes | abre la tienda (Whataform) |
| martes noche | cierra la tienda |
| **miércoles** | se cosecha, se pasa el pedido a los proveedores, se preparan pedidos |
| jueves mañana | se termina de preparar |
| jueves mediodía | sale el flete a Bariloche; a la tarde, entregas |

Consecuencias para el diseño:
- **El pedido a proveedores sale de lo vendido, no de lo planificado**: la
  tienda cierra el martes y el miércoles se pide exactamente lo que se vendió.
  El stock que ofrece un proveedor es un **tope** para publicar, no algo que
  haya que colocar.
- **Lo que puede sobrar es lo propio** (cosecha de Tica): el armado tiene que
  empezar por ahí, y el bolsón es lo que lo absorbe.
- El stock de proveedores **no** sale de AMA Producción aunque varios la usen:
  no ofrecen todo lo que tienen. Lo releva Nati.

### Lo que carga Nati (que trabaja con cuaderno) · hecho

Planilla propia «Stock de proveedores · Bioma» (Drive, comercialización) con
una **página adaptable** que sirve su propio Apps Script: en el celular, la
lista de proveedores y al tocar uno sus productos; en la notebook, lado a lado.
Cada producto ya está escrito (nombre, presentación, precio de la última vez):
Nati anota **solo cuánto ofrece**, corrige el precio si cambió, y tiene botones
para llamar o escribir por WhatsApp, «lo mismo que la semana pasada» y «esta
semana no ofrece nada». Nunca escribe nombres de productos. Producto nuevo →
una fila en Productos (lo agrega Martín).

- Planilla propia, no bioma-db: Nati no puede tener la URL de `Code.gs`.
- `Code.gs` la lee con `openById` (`stockProveedores_`, propiedad
  `STOCK_PROVEEDORES_ID`). Contrato: los encabezados de Stock y Consultas.
- Se armó desde «Gestión de Proveedores Bioma»: 25 proveedores, 138 productos.
  «Bioma» quedó afuera (el campo de Tica viene de AMA Producción); «Tika»
  (frutas, Tomi) quedó adentro: revisar si va.
- Instalación, uso y reglas: `apps-script/stock-proveedores/LEEME.md`.

**Antes de instalar, a pensar con Martín (1/11):** la lista de productos de la
planilla vieja no sirve como lista fija. El stock de casi todos cambia en la
temporada (Humus: quesos, lácteos, fruta congelada y fresca; Foco Verde un
viernes rabanito, otro acelga) y los precios son del año pasado. Solo Los Tres
Clavos es estable (miel, propóleo, polen). Nati tiene que poder **agregar,
quitar y corregir** productos y proveedores desde la página, sin abrir la
planilla. Propuesta (no hecha, esta semana Martín lo hace a la vieja usanza):
1. Arriba, lo ofrecido en las **últimas 4 semanas**, con el precio de la última vez.
2. Plegado, «Otras cosas que alguna vez ofreció» (ahí queda la lista vieja).
3. **+ Agregar producto**: nombre (con sugerencias de los que ya existen, para
   no duplicar «Rabanito»/«Rabanitos»), por kg o por unidad de cuánto, precio.
   Queda en la lista del proveedor.
4. **✏ en cada producto**: cambiar nombre, presentación o unidad, o «Ya no lo
   hace» (Activo = No, no borra la historia).
5. **+ Proveedor nuevo** al pie de la lista.
6. Precios de la temporada pasada marcados **«precio viejo, confirmar»** hasta
   que Nati los toque una vez.
Alternativa más simple: arrancar con la lista vacía y que se arme sola en 2-3
viernes. La pestaña Semana no cambia en ninguno de los dos casos (lo que no
cruce con el catálogo sale «no está en Productos»).

### Por etapas
1. **Stock de la semana** · **hecho (31/10), falta instalar** — pestaña
   «Semana» (`js/semana.js`, action `semana`, API 13): Tica desde AMA
   Producción (`?stockcomercial=1`, misma clave que la proyección) agrupado por
   cultivo, separando lo que no llega al jueves; y cada proveedor con lo que
   ofrece, lo que le pagamos, el precio de venta en la lista elegida, el margen
   (ocre si < 20 %) y la venta posible. Avisa quién falta consultar. Cada lado
   puede fallar sin tapar al otro.
2. **Armado del bolsón** — n.º de bolsones, tocar cultivos, stock final que se
   pone en rojo si no alcanza, precio del bolsón, ingreso posible; extras.
   Sale la lista para cargar en Whataform.
3. **Puntos de venta** — cada uno con su lista de precios y frecuencia
   (necesita la Fase 5, clientes). Sin el bloque «Bari» duplicado.
4. **Miércoles y cierre** — importar las ventas de la tienda, armar el pedido
   de cada proveedor (texto para WhatsApp) y comparar lo planificado con lo
   vendido. Los bolsones se abren en sus componentes (decisión B3).

## Pagos a trabajadores — sistematizar registro y seguimiento

Acordado con Martín el 07/10. Los pagos los registran solo Martín y Luna;
los trabajadores no confirman recibo; las tarifas no cambiaron en la
temporada ($10.000 socios, $7.500 operadores).

### O1. Una sola verdad, fácil de leer · **hecho (07/10)**
Los pagos siguen guardándose SOLO en `egresos` (concepto `sueldos` +
persona), con dos columnas nuevas al final: medio de pago y "horas hasta".
El script arma dos hojas de solo lectura: `pagos` (cada pago por fecha) y
`cuentas` (por trabajador: horas, devengado, pagado, saldo, horas adeudadas,
último pago). Esquema v14. En la app, el formulario de egresos pide medio y
"cubre las horas hasta" al elegir sueldos.

### O2. Pestaña «Pagos» en AMA Economía · **hecho (07/10)**
Lista de trabajadores con su saldo (el que más se le debe arriba); la cuenta
de cada uno (horas por mes, pagos, saldo), igual que en AMA Producción; y
«Registrar pago» desde la cuenta: persona puesta, monto sugerido = saldo,
medio y período; avisa si el pago supera lo adeudado. Guarda el egreso de
sueldos sin poder errar concepto ni nombre. Egresos sigue sirviendo para
cargarlos (pedido de Martín). `js/pagos.js`.

### O3. Lo que ven los trabajadores en AMA Producción · **hecho (07/10)**
`Cuentas.gs` devuelve `medio` y `periodo` en cada pago (contrato en
`CUENTAS.md`) y AMA los muestra: "05/10/26 · Transferencia · cubre hasta el
30/09/26". Los pagos viejos los traen vacíos y se ven como antes. Sin
confirmación de recibo (decidido).

### O4. Limpiar lo viejo de la planilla de horas · **hecho (07/10)**
Martín borró Pagado / Saldo y renombró la hoja a «Resumen General de Horas»
(sin #N/A, verificado). O3 implementado y verificado en vivo: el pago de
Luqui llega con medio y período.
«Registro de pagos realizados» ya se había borrado el 23/09. Quedan cuatro
hojas: «Respuestas de formulario 1» (el buzón, oculta), «Registro Horas»
(espejo por fórmula, la única visible), «Resumen General» y «Config»
(ocultas).
- Hecho: `importarHoras` busca la hoja «Respuestas de formulario» por
  nombre (`hojaDeRespuestas_`). Antes tomaba la primera hoja: mover una
  pestaña importaba otra cosa sin aviso.
- Falta, a mano (Martín): en «Resumen General» borrar las columnas E
  (Pagado: `SUMAR.SI` sobre una hoja «Pagos» que ya no existe → #N/A) y F
  (Saldo = D − E); título → "Resumen general de horas" con la nota "Pagos y
  saldos: AMA → Cuentas, o bioma-db → cuentas". Volver a ocultarla.
- Ojo: su tabla de áreas es una lista fija y no tiene «Comunicación»
  (área propia de Tica, 2 h el 07/10): suma 575 h contra 577. Agregar la
  fila o aceptar que esa tabla es aproximada; la cuenta buena está en AMA
  Economía.
- Su columna B (tarifa) es `=Config!B…`: la tarifa sigue teniendo una sola
  fuente. `tarifasPorTrabajador_` lee la primera tabla trabajador/tarifa que
  encuentra, que hoy es esta copia; da lo mismo mientras sea fórmula.

### O5. Tarifas con fecha de vigencia · **hecho (07/10)**
Antes `importarHoras` valuaba TODAS las horas con la tarifa actual: un
aumento reescribía el devengado del pasado. Ahora cada hora se paga con la
tarifa vigente el día que se trabajó (`tarifaDelDia_`):
- **Config** sigue diciendo la tarifa de HOY; ahí se cambia, como siempre.
- La hoja **«Cambios de tarifa»** (planilla de horas) anota cada aumento:
  trabajador · desde · tarifa anterior · tarifa nueva · nota. La crea
  `prepararCambiosDeTarifa()`, a mano, una vez.
- Lo anterior al primer cambio va con su "tarifa anterior"; entre dos
  cambios, con la anterior del siguiente; después del último, con Config.
- La importación avisa (⚠ CAMBIOS DE TARIFA) si una fila está incompleta
  (no se usa), si el nombre no está en Config o si la "nueva" no coincide
  con lo que rige después.
- Si se cambia Config sin anotar el cambio, pasa lo de antes: se recalcula
  la temporada entera con la nueva.
- `tarifasPorTrabajador_` mira primero Config y saltea «Cambios de tarifa».
- La hoja `cuentas` pasa pesos a horas con la tarifa real (devengado ÷
  horas), como Cuentas.gs. En Pagos, con dos tarifas en la temporada se lee
  "~$8.250/h promedio".

### O6. Nombres seguros · **hecho (07/10, lista de Config el 10/10)**
En Egresos → sueldos el nombre se ELIGE de una lista, nunca se escribe
(`trabajadoresParaPagar`): el equipo de **Config de la planilla de horas**
(nombre con tarifa, sin las filas genéricas «Operador 10/11/12») más quien
tenga horas y ya no esté en Config (se le puede deber). La lista la guarda
`importarHoras` en las propiedades del documento (`trabajadores_()`) y viaja
en cada sincronización; vacía no pisa la que tiene el teléfono. Alguien
nuevo: se suma a Config y aparece al día siguiente (o al correr
`importarHoras`). Honorarios sigue con texto libre (gente de afuera). En
Pagos, una cuenta que no tiene horas ni está en Config («⚠ no está en el
equipo») no ofrece registrar más pagos. Es un parche hasta migrar a
identificadores por persona (pendiente en todo AMA).

## Datos, revisados el 07/10
- Planificación en Hortícola: 100 h de julio y agosto. Martín lo confirmó.
- El 91,4 % de los ingresos de la temporada son préstamos: coherente con la
  etapa (todavía no hay cosecha).

## Y lo que sigue después, por valor
Fase 4.5 (análisis de ventas) y los SKU en Whataform. Ver más abajo.

---

# Hecho

## Fase 0 — Cimientos · **hecha**
El archivo único se repartió en `js/` por tema. Sin cambios visibles, pero cada
tema se toca por separado. Se mantuvo la publicación desde la raíz para no
romper la app ya instalada en los teléfonos.

## Fase 1 — Productos y precios · **hecha**
Catálogo con nombre, unidad, presentación y **un** precio de chacra. Comarca,
Bariloche y Verdulerías salen de un porcentaje configurable. Buscador, aumento
general por porcentaje, importación y exportación en CSV.

## Blindaje de la sincronización · **hecho**
Protocolo versionado (`api`), fusión que nunca borra por ausencia, rechazo de
implementaciones viejas, aviso de cambios sin subir, alta de dispositivos por
enlace. Los detalles y el motivo de cada uno, en `DECISIONES.md`.

## Respaldos diarios · **hecho**
Copia completa de la planilla por día en `respaldos bioma-db`, 30 días.
Se activa ejecutando `instalarRespaldoDiario` una vez.

## Fase 2 — Conceptos nuevos y tablas mes a mes · **hecha**
- Conceptos agregados: `pago deuda`, `impuestos`, `comisión billetera`
  (egresos) y `rendimiento financiero` (ingresos).
- En la hoja `resumen`, tres tablas nuevas: **ingresos por punto de venta mes a
  mes**, **egresos por concepto mes a mes** y **flujo de fondos mensual**
  (ingresos − egresos, con acumulado).

---

# Lo que sigue

## Fase 3 — Catálogo completo · **hecha**
El catálogo pasó de 65 a **118 productos**, con un campo **categoría** que lo
hace navegable: hortaliza (65), elaborado (28), congelado (12), fruta (6),
bioinsumo (3), bolsón (3) y animal (1). Filtro por categoría en la pantalla y
etiqueta de rubro en cada producto.

Un producto se identifica por **nombre + presentación**, no solo por el nombre:
"Miel 500 g" y "Miel 1 kg" son productos distintos. Antes el importador los
pisaba entre sí.

Varios elaborados (chucrut, kimchi, pickles) son **de Cocina Viva**: Bioma los
revende. Es el primer punto de contacto real entre las dos apps del ecosistema.

## Fase 4 — Ventas por producto y punto de venta · **carga hecha**
Permite responder *"¿cuántos kg de acelga vendió Península en enero?"*.

**Hecho:**
- Hoja `ventas` (esquema v8, API 7): un renglón por producto vendido, con
  `venta` agrupando los de una misma operación y `origen` diciendo de dónde
  salió (manual, planilla o el bolsón que lo contiene).
- Pantalla **Ventas**: fecha, punto de venta, lista de precios y renglones con
  buscador de producto (datalist nativo, anda igual en el teléfono).
  El precio sale solo de la lista elegida. Total en vivo.
  Últimas 10 ventas con lápiz y tacho. Compartir remito por WhatsApp.
- **Ventana de 300 renglones**: la app solo guarda y manda los últimos; la
  planilla los conserva todos. Sin esto, una temporada entera viajaría en cada
  sincronización.
- **Importador de la tienda virtual** listo, con tres niveles de
  reconocimiento: **SKU** (exacto, aguanta cualquier cambio de nombre), nombre
  del catálogo, y equivalencia aprendida. Lo que no reconoce queda pendiente y
  lo resuelve la persona; lo resuelto se recuerda. La app nunca inventa una
  equivalencia.
- Campo **SKU** en los productos, y columna SKU en la hoja.

**Falta:**
- **Cargar los SKU en Whataform** y en el catálogo. Es lo que convierte el
  importador en algo confiable: mientras no existan, cada nombre nuevo hay que
  resolverlo a mano.
- Los archivos de Whataform vienen en `.xlsx`; hay que guardarlos como CSV
  antes de importar. Leer `.xlsx` directo exigiría una librería externa y
  rompería la regla de no tener dependencias.
- **Las equivalencias aprendidas viven solo en el dispositivo**, no en la
  planilla. Con dos teléfonos, cada uno aprende por su lado. Pasarlas a una
  hoja `equivalencias` cuando el importador entre en uso real.
- **Bolsones**: falta la hoja `bolsones` con la receta de cada semana y la
  lógica que abre el bolsón en sus componentes (decisión B3). Depende de la
  Fase 4.7, que es de donde sale la composición.
- Al sincronizar se reescribe la hoja `ventas` entera. Con miles de renglones
  se va a poner lento; habrá que pasar a escritura incremental.

## Fase 4.5 — Análisis de ventas · **falta**
Tablas dinámicas armadas en la planilla (kg por producto y mes, por punto de
venta, por rubro) y una pantalla de resumen de ventas en la app alimentada por
agregados, no por la tabla completa.

Pensado para **escritorio** (gráficos, tablas, catálogo) manteniendo el celular
para cargar y consultar rápido.

## Fase 4.7 — Planificación semanal y distribución · **falta** · el pedido más ambicioso
Es la tarea más difícil de la gestión comercial, hoy resuelta a mano en la
planilla de comercialización (hojas `stock` y `distribución ventas`):

1. **Censo de campo**: se anotan unidades y formato de lo que hay, y sale el
   total de kg disponibles por variedad.
2. **Armado del bolsón de la semana** según esa disponibilidad, con su precio.
3. **Asignación a cada punto de venta**: bolsones núcleos, Barilu, Feria Puelo,
   Al Margen… y la columna `sckf` (stock final) mostrando cuánto queda. **Si se
   pone en rojo o negativo, no alcanza la verdura.**
4. Al cierre, **comparar lo planificado con lo que realmente se vendió** y
   ajustar la próxima semana.

Automatizar esto —o al menos hacerlo visible— es lo que más trabajo ahorraría.
Además deja al sistema sabiendo de antemano **qué lleva el bolsón de la semana
y qué se asignó a cada punto de venta**, que es justo lo que la Fase 4 necesita
para explotar los bolsones sin cargar la receta a mano.

Depende de las fases 4 y 6 (stock). Es la culminación natural del proyecto.

## Fase 4.8 — Cuentas de los trabajadores · **paso 1 y 2 hechos**
Que cada trabajador pueda seguir su cuenta desde MonAgric, en vez de un link a
una planilla que después no encuentra.

1. **La cuenta vive en bioma-db** · hecho. Es el único lugar con los dos lados:
   devengado (horas) y pagado (egresos `sueldos` con persona). El detalle de
   pagos ya estaba: fecha, monto y observación en la hoja `egresos`.
2. **Endpoint de consulta** · hecho e implementado. `apps-script/Cuentas.gs`,
   proyecto de Apps Script **aparte** y de solo lectura. Verificado contra
   bioma-db: 404 h, $3.990.000, ocho trabajadores.
2bis. **Endpoint del resumen económico** · hecho e implementado.
   `apps-script/Economia.gs`, un tercer proyecto aparte. Balance, mes a mes,
   agregado por concepto y horas por área y actividad, todo pre-calculado.
   Contrato en `ECONOMIA.md`. Verificado contra bioma-db, y los números
   coinciden con los de `Cuentas.gs`: 404 h y $3.990.000 por las dos puertas.
3. **Pantalla "Cuentas" en MonAgric** · falta, va en la otra conversación.
   Lista de integrantes → cuenta de cada uno: horas por mes desglosadas por
   área, horas y pesos pagados, adeudados, y la lista de pagos. Contrato en
   `apps-script/CUENTAS.md`.
4. **Jubilar la hoja "Registro de pagos realizados"** de la planilla de horas,
   para que haya una sola contabilidad. Recién cuando el punto 3 funcione.

La planilla de horas **no se elimina**: sigue siendo el buzón donde MonAgric
escribe y de donde lee la lista de trabajadores. Deja de llevar cuentas, nada
más.

## Fase 5 — Clientes y puntos de venta · **falta** · prioridad media
Hoja `clientes`: nombre, tipo (feria, verdulería, núcleo, restaurante), lista
de precios que le corresponde, día de entrega habitual. Hoy los puntos de venta
son texto suelto en `conceptos`; al pasar a entidad, cada venta sabe qué lista
de precios aplicar sola.

## Fase 6 — Stock · **falta** · prioridad media
Qué hay disponible para ofrecer. Entra por cosecha, sale por venta o merma.
Depende de las fases 3 y 4: sin catálogo completo y sin ventas con detalle, el
stock no tiene de dónde descontar.

## Fase 7 — Enlace con MonAgric · **falta** · prioridad baja por ahora
Importar cosechas y objetivos de MonAgric para contrastar
**objetivo vs cosechado vs vendido**. Es el paso que cierra el círculo entre
producción y comercialización. Conviene hacerlo cuando las fases 4 y 6 estén
asentadas.

## Fase 8 — Costos y márgenes · **falta** · cuando haya datos
Requiere costos por cultivo, que todavía no existen. Mientras tanto hay un
atajo útil: MonAgric ya guarda superficie y rinde, así que se puede calcular
**ingreso por m²** de cada cultivo sin costear nada.

---

# Ideas registradas, sin fecha

- Reventa de productos de terceros con su margen (Humus, huevos, Foco Verde).
  Está modelado en la planilla vieja y es plata significativa.
- Calendario semanal de entregas por punto de venta.
- Comparación de precios contra la competencia.
- Control de acceso, si algún día la usa más gente que Martín y Luna.
