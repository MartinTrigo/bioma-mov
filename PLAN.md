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

## Fase 4 — Ventas por producto y punto de venta · **falta** · prioridad alta
El objetivo grande: poder responder *"¿cuántos kg de acelga vendió Península en
enero?"*, *"¿cuánto choclo se vendió en toda la temporada?"*. No se trata de
hacer remitos (aunque de paso salgan): se trata de **decidir con datos**.

### Dónde se guardan — decidido
Una sola hoja **`ventas`** por temporada (`ventas 26-27`), **un renglón por
producto vendido**:

```
id | remito | fecha | cliente | producto | presentacion | cantidad |
kg_total | precio | subtotal | origen | bolson_ref | obs | mod
```

Se descartó la idea de una hoja por cliente con productos en filas o columnas:
con ~118 productos y ~10 clientes, agregar un producto obligaría a tocar todas
las hojas, y sumar un total exigiría leerlas todas. La vista "productos contra
fechas para un cliente" sale como **tabla dinámica** sobre esta hoja, sin
duplicar nada.

**La app no se baja todas las ventas.** Manda las nuevas y se trae resúmenes.
Con ~6.000 renglones por temporada, bajarlas enteras en cada sincronización
rompería el celular. Requiere un endpoint que **solo agrega**, distinto del
mecanismo de estado completo que usan movimientos y deudas.

### Cómo se cargan — decidido (A3)
Dos caminos, según el caso:

1. **A mano en el celular**, para feria y verdulerías: elegir cliente, agregar
   renglones con buscador de producto, cantidad y presentación. Guardar,
   imprimir/compartir, editar. Abajo las últimas 10 cargas con lápiz y tacho.
2. **Importando el archivo de la tienda virtual (Whataform)**, para los
   núcleos: 70-80 productos por semana, imposible a mano.

### El problema difícil: los nombres
Whataform entrega los nombres **como están publicados**, y cambian cada semana:
`Acelga Arco Iris (x500g)`, `Acelga x 500g`, `Albahaca 30%OFF! x200g`,
`Papas Blanca OFF!!! x5Kg`. En 15 listas aparecieron **181 nombres distintos**
para unos pocos productos reales.

Solución: una hoja **`equivalencias`** que traduce nombre publicado →
producto del catálogo + presentación. La primera vez que aparece un nombre
nuevo, la app pregunta y lo aprende; después lo reconoce solo. La app nunca
inventa una equivalencia: si no la sabe, la deja pendiente y avisa.

### Los bolsones — decidido (B3)
Los bolsones son el grueso de la venta de núcleos y **esconden los kilos** de
lo que llevan adentro. Se registran **de las dos formas**:

- como **unidad vendida** (40 bolsones a tal precio), para la venta comercial;
- **abiertos en sus componentes**, para que los kilos de acelga, cebolla y
  brócoli aparezcan en el análisis. Los renglones que salen de un bolsón se
  marcan en `origen` y apuntan al bolsón en `bolson_ref`, así nunca se suman
  dos veces.

La composición cambia todas las semanas y **ya existe** en el generador de
listas (hoja con la columna `Bolson`). Hace falta una hoja
**`bolsones`** con la receta de cada semana: fecha, bolsón, producto,
cantidad.

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
