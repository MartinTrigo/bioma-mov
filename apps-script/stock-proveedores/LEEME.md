# Stock de proveedores · la planilla de Nati

Nati anota los viernes qué ofrece cada proveedor para la tienda del lunes. AMA
Economía lo lee en la pestaña **Semana**, junto con el stock de Tica que viene
de AMA Producción.

```
Nati (página)  →  planilla «Stock de proveedores · Bioma»  →  bioma-db (Code.gs)  →  AMA Economía › Semana
AMA Producción (Stock de Tica)  ─────────────────────────────→  bioma-db (Code.gs)  ↗
```

- **La planilla** está en Drive, carpeta de comercialización: «Stock de
  proveedores · Bioma». Hojas: Léeme, Proveedores, Productos, Stock, Consultas.
  Se armó el 31/10 desde «Gestión de Proveedores Bioma» (25 proveedores, 138
  productos). «Bioma» quedó afuera: el campo de Tica llega por AMA Producción.
- **La página** (`Pagina.html`) la sirve `StockProveedores.gs`, un proyecto de
  Apps Script **dentro de esa planilla**. No es bioma-db: Nati no puede tener
  la dirección de `Code.gs`, que escribe toda la economía.
- **Pruebas**: `pruebas.html` corre el script real contra una planilla
  simulada y muestra la página. Con el servidor de `economia` (puerto 8642):
  `/apps-script/stock-proveedores/pruebas.html`. Tiene que dar todo en verde.

## Instalar (una vez)

### 1. El script de la planilla de Nati
1. Abrir la planilla → **Extensiones → Apps Script**.
2. Reemplazar el contenido de `Código.gs` por el de `StockProveedores.gs`.
3. **+ → HTML**, llamarlo `Pagina` (sin .html) y pegar `Pagina.html`.
4. ⚙ Configuración del proyecto → Zona horaria: **(GMT-03:00) Buenos Aires**.
5. Guardar. Elegir la función `prepararHojas` → **Ejecutar** y aprobar los
   permisos (pone en texto la columna Semana; no borra nada).
6. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **yo**
   - Quién tiene acceso: **Cualquier usuario** (o «cualquier usuario con
     cuenta de Google» si Nati entra con la suya: también anda, porque es una
     página y no datos sueltos).
7. Copiar la URL `/exec` y pasársela a Nati. En el celular: abrirla en Chrome →
   ⋮ → **Agregar a la pantalla principal**. En la notebook, un marcador.

Al cambiar el script después: **Administrar implementaciones → ✏ → Nueva
versión**. Nunca otra «Nueva implementación»: cambia la URL que tiene Nati.

### 2. bioma-db (Code.gs de Economía)
1. Pegar el `Code.gs` nuevo (API 13) en el proyecto de bioma-db.
2. ⚙ → Propiedades del script → agregar **`STOCK_PROVEEDORES_ID`** = el id de
   la planilla de Nati (lo que está entre `/d/` y `/edit` en su dirección).
3. Ejecutar `probarSemana` y aprobar el permiso nuevo (abrir otra planilla).
4. **Nueva versión** de la implementación (aprobar un permiso no alcanza: ver
   «Proyección» en `economia/CLAUDE.md`).

### 3. AMA Producción (Code.gs de Producción)
Pegar su `Code.gs` nuevo (`?stockcomercial=1`) y **Nueva versión**. Usa la
misma clave que la proyección: no hay que tocar propiedades.

## Cómo se usa

- **Nati, el viernes**: abre la página, toca un proveedor, lo llama o le
  escribe (los botones están ahí), anota cuánto ofrece de cada cosa y
  **Guardar**. Si no ofrece nada: **Esta semana no ofrece nada**. La barra de
  arriba dice cuántos van. «Poner lo mismo que la semana pasada» copia los
  números de la semana anterior para corregir.
- **Martín, el sábado**: AMA Economía → **Semana**.
- **Producto nuevo o proveedor nuevo**: una fila en Productos o Proveedores.
  El nombre del producto, **igual al del catálogo de AMA Economía** (si no, en
  Semana sale «no está en Productos»). Activo = No lo saca sin borrar nada.
- **Precio**: si Nati cambia un precio, queda también en Productos para la
  semana siguiente.

## Reglas

- Stock y Consultas las escribe la página. No editarlas a mano; si hace falta
  corregir algo, mejor desde la página (guardar de nuevo corrige, no duplica).
- La semana se llama por su **viernes**. De sábado a miércoles la página carga
  el viernes anterior; el jueves, ya el siguiente.
- Los encabezados de Stock y Consultas son el contrato con `Code.gs`
  (`stockProveedores_`): renombrar uno rompe la pestaña Semana, que avisa cuál.
