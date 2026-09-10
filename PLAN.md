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

## Fase 3 — Catálogo completo · **falta** · prioridad alta
Hoy el catálogo tiene solo hortalizas (65 productos). Faltan las otras
categorías que Bioma comercializa, y que están en la planilla de
comercialización 26-27:

- **Fruta fresca**: frutilla, cereza, frambuesa, manzana, mora, ciruela
- **Fruta congelada (IQF)**: cereza, corinto, frambuesa, frutilla, grosella,
  moras, pulpas, mix
- **Elaborados**: miel, kimchi, chucrut, pickles, jugos, mermeladas, dulce de
  leche, quesos, pastas, harina, vinagre
- **Bioinsumos**: bioesencial, MML

Se agrega el campo **categoría** a los productos, para poder filtrar y para que
los resúmenes de venta se puedan agrupar por rubro. Es requisito de la Fase 4:
sin categorías, un desplegable de 120 productos es inusable.

## Fase 4 — Remitos por cliente · **falta** · prioridad alta
El objetivo grande: saber **cuántos kg de cada producto se vendieron en cada
punto de venta**.

Pantalla de carga: fecha, cliente, y una lista de renglones donde cada uno
tiene producto (con buscador), cantidad, presentación (la del producto, o
modificable), subtotal en kg/unidades y subtotal en $. Botón para agregar
renglones. Guardar, imprimir/compartir el remito, y editar lo cargado.
Abajo, las últimas 10 entradas con lápiz y tacho.

### Cómo se guardan los datos — decisión

Se propuso **una hoja por cliente** con los productos en filas o en columnas.
**La recomendación es no hacerlo así**, por tres motivos:

1. Con ~120 productos y ~10 clientes, agregar un producto obliga a tocar todas
   las hojas. Es la clase de estructura que se rompe sola.
2. Sumar "cuántos kg de kale se vendieron en total" obliga a leer todas las
   hojas y sumarlas a mano.
3. Es lo que ya complicaba la planilla vieja de comercialización.

En su lugar: **una sola hoja `ventas`, un renglón por producto vendido**.

```
id | remito | fecha | cliente | producto | cantidad | unidad |
presentacion | kg_total | precio | subtotal | obs | mod
```

Con eso, la vista que se pidió (productos contra fechas, para un cliente) sale
como **tabla dinámica** en una hoja aparte, sin duplicar datos: se elige el
cliente en un filtro y los productos quedan en las filas y los meses en las
columnas. Y además se puede responder cualquier otra pregunta: qué producto
rinde más, qué punto de venta compra qué, cómo evoluciona un precio.

Es el mismo modelo que usa Cocina Viva para sus ventas, que ya lleva un año
funcionando.

### Antes de empezar la Fase 4
Necesita la Fase 3 (catálogo completo con categorías) y una definición de
**clientes/puntos de venta como entidad** (hoy son solo texto en la lista de
conceptos de ingresos).

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
