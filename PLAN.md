# Plan de desarrollo

Una fase por vez, verificada antes de pasar a la siguiente. El orden pondera
tres cosas: **riesgo de romper lo que ya funciona**, **valor para la temporada**
y **qué depende de qué**.

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
2bis. **Endpoint del resumen económico** · hecho, falta implementar.
   `apps-script/Economia.gs`, un tercer proyecto aparte. Balance, mes a mes y
   agregado por concepto, todo pre-calculado. Contrato en `ECONOMIA.md`.
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
