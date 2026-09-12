# Decisiones y registro de errores

Por qué las cosas son como son, y qué salió mal antes para no repetirlo.
Cada error acá costó tiempo real y en algún caso datos.

---

# Decisiones de fondo

## Por qué una PWA y no una app nativa
Se instala en Android desde el navegador, funciona sin conexión, se edita sin
compilar y se publica con un `git push`. Para dos usuarios en el campo, con
señal intermitente, es lo más simple que funciona.

## Por qué Google Sheets como base de datos
Los datos quedan en el Drive del proyecto, donde el equipo ya trabaja. Se
pueden abrir, filtrar y graficar sin la app. Claude puede leerlos directo.
No hay servidor que mantener ni que pagar. El costo: Apps Script es lento y
tiene cuotas, y las fórmulas dependen del idioma de la planilla.

## Por qué la planilla es la fuente de verdad y no la app
Porque el usuario edita a mano y espera que eso mande. La app es una forma
cómoda de cargar y consultar, no la dueña de los datos. De ahí la regla 1 de
`CLAUDE.md`.

## Precios: una sola cifra por producto
Se carga solo el **precio de chacra**. Comarca (+30%), Bariloche (+50%) y
Verdulerías (−20%) salen de un porcentaje configurable en la hoja `listas`.
Cada producto puede fijar un precio propio en una lista y romper el
porcentaje; se borra la celda y vuelve al automático.
Motivo: actualizar precios en una temporada inflacionaria tiene que costar un
solo número por producto, no cuatro.

## Los movimientos guardan el texto del concepto, no una referencia
Un movimiento dice "Semillas" como texto. Si se renombra el concepto, los
movimientos viejos no cambian solos. Es más simple y sobrevive a que alguien
edite la planilla a mano, pero obliga a normalizar cuando se renombra
(ver el error de los conceptos duplicados).

## El repositorio es público
Decisión del usuario. Consecuencia: la URL del Web App nunca va al código, y
conviene revisar qué datos de negocio se versionan (hoy: la lista de precios
en `productos-inicial.csv`).

---

# Registro de errores

## 1. Dos implementaciones del Apps Script conviviendo
**Qué pasó:** al actualizar el script se usó "Nueva implementación" en vez de
"Administrar implementaciones". Quedaron dos URLs vivas con código distinto.
La vieja no entendía el esquema nuevo, devolvía listas vacías y la app
borraba su copia local creyendo que no había nada. Reapareció una hoja
`movimientos` con datos viejos y la hoja `conceptos` se vació.

**Costo:** varias sesiones de diagnóstico y ~12 días de movimientos perdidos.

**Lección:** el protocolo va versionado (`api: N`) y la app rechaza respuestas
sin ese campo. Al actualizar, siempre "Administrar implementaciones".

## 2. Borrar por ausencia
**Qué pasó:** la app asumía que si un registro no venía en la respuesta, había
que borrarlo. Una respuesta vacía vaciaba el dispositivo.

**Lección:** un registro local solo se borra si el servidor confirma su tumba.
Si la respuesta viene incompleta, los datos locales sobreviven y se reintenta.

## 3. El caché servía versiones viejas de la app
**Qué pasó:** se publicaban correcciones y el teléfono seguía con el código
anterior durante horas. Peor: quedaban versiones mezcladas (un archivo nuevo
y otro viejo), que es lo que después reinyectó los conceptos duplicados.

**Lección:** el service worker pide los archivos con `cache: 'reload'` para
saltear el caché HTTP, y se sube `CACHE` en cada cambio. Para forzar en una
computadora: `Ctrl+Shift+R`.

## 4. Fórmulas en inglés en una planilla en español
**Qué pasó:** el resumen se generó con `,` como separador de argumentos y dio
`#ERROR!`. Después, las funciones de fecha de QUERY dieron `#VALUE!`.

**Lección:** las fórmulas que escribe el script usan `;` y `\` (matrices), y se
evitan las funciones de fecha de QUERY agrupando por `TEXT(fecha;"yyyy-mm")`.

## 5. Conceptos duplicados que resucitaban
**Qué pasó:** la lista por defecto del código (en minúsculas) se metía en la
planilla por dos caminos: las versiones viejas de la app subían su lista
completa en cada sincronización, y había una "reparación automática" que
reponía la lista local si la planilla volvía vacía. Resultado: `Semillas` y
`semillas` conviviendo, con los totales del resumen partidos en dos, y las
correcciones hechas a mano se deshacían solas.

**Costo:** 22 movimientos con el concepto partido; el resumen mentía.

**Lección:** la app nunca sube listas completas; el servidor ignora conceptos
de clientes viejos (`cliente: 2`) y une ignorando mayúsculas y acentos.
Se eliminó la "reparación automática": intentar arreglar solo lo que parece
roto puede ser peor que no hacer nada.

## 6. Guardar en silencio lo que no se sincronizó
**Qué pasó:** se importaron 65 productos en la notebook, el mensaje dijo
"65 productos ✓" y quedaron solo en ese navegador. Nada indicaba que no habían
llegado a la planilla. El celular no los veía y parecía un error nuevo.

**Lección:** hay un punto naranja sobre el botón ↻ mientras haya cambios sin
subir, y las operaciones importantes avisan si no pudieron sincronizar.
Ninguna acción que toque datos debe fallar en silencio.

## 7. El almacenamiento del teléfono se vació solo
**Qué pasó:** Android descartó los datos locales de la app y con ellos la URL
de sincronización. La app quedó vacía y pareció pérdida de datos, cuando todo
estaba a salvo en la planilla.

**Lección:** se pide `navigator.storage.persist()` y hay un aviso visible
cuando falta la configuración, con acceso directo a cargarla.

## 8. Sembrar un catálogo sin mirar lo que ya había
**Qué pasó:** al completar el catálogo con frutas y elaborados, se agregaron
`Cereza`, `Frutilla`, `Frambuesa`, `Ciruela` y `Manzana roja` como productos
nuevos, sin ver que esos productos **ya estaban en la lista** —mal clasificados
como hortalizas, que era el error a corregir, pero con los precios reales que
el proyecto venía usando. Quedaron pares del mismo producto con precios
distintos.

Además, la lista original traía frutas metidas entre las hortalizas (ciruela,
durazno, frutilla, limón, pelón), heredado de la planilla vieja.

**Lección:** antes de sembrar datos, **cruzar con lo que ya existe** y mostrar
los choques en vez de resolverlos por las buenas. Y los archivos semilla
(`productos-inicial.csv`) dejan de ser válidos apenas el usuario empieza a
curar la lista: reimportarlos resucita lo borrado.

## 9. Dos pantallas para la misma plata
**Qué pasó:** al agregar Ventas quedaron dos entradas de ingresos: la pantalla
vieja escribía en la hoja `ingresos` y la nueva en `ventas`. La misma venta
había que cargarla dos veces, o el resumen quedaba incompleto.

**Lección:** cuando una funcionalidad nueva se superpone con una vieja, hay que
decidir cuál manda **antes** de publicarla, no después. Se unificó en Ventas,
que escribe las dos hojas atadas por el mismo id.

**Lo que casi sale mal:** el primer impulso fue borrar la pantalla de ingresos
sin más. Al mirar los datos reales apareció que los 8 ingresos cargados eran
préstamos, talleres y "varias" —ninguno era venta de productos—, y que la lista
de conceptos incluye "rendimiento financiero". Borrar sin mirar habría dejado
al proyecto sin forma de registrar un préstamo. Por eso el formulario acepta un
monto a mano cuando no hay productos.

---

# Reglas de trabajo que salieron de todo esto

1. Antes de publicar, **ejercitar el cambio en el navegador**, no solo leerlo.
2. Ante un problema, **mirar los datos reales primero** (la planilla, el
   endpoint), no teorizar sobre el código.
3. Las defensas van **en el servidor**, que es el único punto que no depende
   de qué versión tenga cada teléfono.
4. Preferir **no hacer nada** antes que una reparación automática que adivine.
5. Cambios grandes: una fase por vez, verificada, antes de la siguiente.

## 10. Borrar la hoja "resumen" para repararla
**Qué pasó:** `repararResumen_` borraba la hoja y la volvía a crear para
corregir sus fórmulas. El usuario había armado gráficos apuntando a esa hoja:
al morir la hoja, los gráficos perdieron su referencia y quedaron rotos.

**Lección:** la hoja `resumen` es del usuario, no del script. Se crea si no
existe y **nunca se destruye**; las correcciones se aplican celda por celda.
Vale para cualquier hoja: borrar y recrear es cómodo para el script y
destructivo para lo que la persona construyó encima.

**De paso:** los gráficos ahora los arma el script (`actualizarGraficos_`) en
la hoja `gráficos`, y les ajusta el rango cuando aparecen meses o conceptos
nuevos. Se rehacen solo cuando cambia la cantidad de datos.

## 11. Cambiar columnas sin rehacer el encabezado
**Qué pasó:** se agregó la columna `kg` a la hoja `ventas`. Los datos pasaron a
escribirse con ella, pero el encabezado seguía siendo el anterior porque
`estilizarVentas_` solo corre al migrar el esquema. Resultado: la columna de
kilos decía "precio", y la hoja mentía sobre su propio contenido.

**Lección:** tocar `COLUMNAS` obliga a subir el esquema para que se reescriban
los encabezados. Si no, los datos y sus títulos quedan corridos.

## 12. Leer la planilla por el encabezado visible, creyendo que era el nombre interno
**Qué pasó:** los dos endpoints de consulta (`Cuentas.gs`, `Economia.gs`) leen
las hojas **por nombre de columna** y no por posición, justamente por la
lección del error 11. Pero bioma-db tiene dos listas distintas: `COLUMNAS`
—los nombres internos— y `ENCABEZADOS` —las etiquetas que ve una persona—. No
son iguales:

| interno | encabezado en la hoja |
|---|---|
| `concepto` (en `ingresos`) | **punto de venta** |
| `obs` | **observaciones** |

Pedir `f['concepto']` sobre la hoja `ingresos` devolvía `undefined`, y el
resumen económico mostraba **"sin concepto — 100%"**: todos los ingresos de la
temporada apilados en una categoría inventada. No era un error visible: era un
número que parecía un dato. El mismo problema dejaba vacía la observación de
cada pago en `Cuentas.gs`, que nadie había notado porque todavía no hay pagos
a trabajadores.

**Por qué no lo atraparon las pruebas:** los datos inventados del banco de
pruebas usaban los encabezados que yo **suponía** (`concepto`, `obs`), no los
que la planilla tiene de verdad. 42 verificaciones en verde y el error intacto.
Una prueba que inventa su propio esquema no prueba nada: prueba que el código
es consistente consigo mismo.

**Lección, doble:**
1. Los datos de prueba tienen que copiar los **encabezados reales** de
   `ENCABEZADOS`, no una versión idealizada. Están en `Code.gs`: leerlos.
2. Cuando una columna esperada no aparece, **gritar**. `movimientos_` ahora
   corta con un error que nombra los encabezados que sí encontró. Un dato
   faltante que se dibuja como categoría es peor que una pantalla de error,
   porque no se sospecha.

Los alias viven en `CANONICO`, en cada endpoint. Al renombrar una columna en
la planilla hay que agregarlo ahí.

## 13. El id de la planilla dentro del código, que cada actualización borraba
**Qué pasó:** los endpoints guardaban el id de bioma-db en una constante del
archivo (`var ID_BIOMA_DB = ''`). En el repo va vacía, porque no es del repo.
Así que cada vez que Martín pegaba una versión nueva del archivo **le borraba
el id que había puesto a mano**, y el endpoint contestaba "falta completar
ID_BIOMA_DB". Pasó en la primera actualización, con los dos a la vez.

Lo peor del diseño es que el error aparecía *después* de implementar, con el
paso ya dado por hecho: "ya actualicé ambos archivos".

**Lección:** la configuración no va en el código que se reemplaza. Va en las
**propiedades del script**, que sobreviven a que se pegue una versión nueva.
Se pone una vez con `configurar()` y no se vuelve a tocar. Es lo que ya hacía
MonAgric con las URLs (`CUENTAS_URLS`), y había que copiarlo.

La constante quedó como respaldo, vacía a propósito, y una prueba verifica que
**estando vacía el endpoint funciona igual**: si mañana alguien vuelve a
depender de ella, la prueba lo dice.
