# Bioma · Registro de movimientos

## 👉 Abrir la app

**https://martintrigo.github.io/bioma-mov/**

Funciona en cualquier dispositivo con navegador (notebook, teléfono, tablet).
La primera vez en cada dispositivo hay que pegar la **URL de sincronización**
en el botón ⭳ para que aparezcan los datos (ver más abajo).

---

App para registrar **ingresos, egresos y deudas** del proyecto Bioma, con resúmenes mensuales y generales. Reemplaza la planilla de Google Sheets.

## Arquitectura

- **PWA (Progressive Web App)** en HTML + CSS + JavaScript puro. Sin frameworks,
  sin dependencias, sin build:
  - `index.html` — las pantallas
  - `styles.css` — estilo (paleta verde/tierra del logo)
  - `js/` — un archivo por tema: `util`, `db`, `sincro`, `movimientos`,
    `deudas`, `productos`, `resumen`, `respaldo`
  - `app.js` — arranque y pestañas; se carga último
  - `logo.svg`, `manifest.json`, `sw.js` — instalación y uso sin conexión
- **Datos:** se guardan en el dispositivo (`localStorage`) y se sincronizan con
  la planilla `bioma-db`.

## Precios: una sola cifra por producto

De cada producto se carga **un solo precio, el de chacra**. Los otros tres
salen de un porcentaje sobre ese, configurable en la hoja `listas`:

| Lista | Ajuste | Para qué |
|---|---|---|
| Chacra | base | mayorista en el establecimiento |
| Comarca | +30% | ferias de la Comarca |
| Bariloche | +50% | venta en Bariloche |
| Verdulerías | −20% | reventa a verdulerías |

Si un producto necesita un precio distinto en una lista (por su estado o por
estrategia), se escribe a mano en esa columna y deja de seguir el porcentaje.
Para volver al automático, se borra la celda. En la app esos precios fijados
se ven con fondo tostado.

### Cargar o actualizar el catálogo en bloque

`productos-inicial.csv` tiene el catálogo extraído de la planilla vieja de
comercialización (65 productos, 38 con precio de chacra).

En la pantalla **Productos → Importar catálogo (CSV)** se carga de una. El
archivo se reconoce por el nombre del producto:

- los que ya existen se **actualizan**, los que no, se **agregan**;
- **nunca borra** productos, y un precio vacío o en cero **no pisa** uno ya
  cargado, así que se puede reimportar sin miedo;
- columnas: `nombre, unidad, presentacion, chacra, comarca, bariloche,
  verduleria, activo`. Solo `nombre` es obligatoria; las tres columnas de
  precio derivado se dejan vacías salvo que se quiera fijar ese precio.

También se puede pegar el CSV directamente en la hoja `productos` de la
planilla, desde la columna B (la columna `id` la completa el script).

## Cómo probarla en la PC (solo para desarrollo)

Para usarla normalmente alcanza con el enlace de arriba. Esto es únicamente
para probar cambios locales antes de publicarlos:

```
cd C:\MARTO\INFORMATICA\Bioma\movimientos
python -m http.server 8642
```

y abrir http://localhost:8642 en el navegador. Ojo: esa dirección solo
funciona en la misma máquina y mientras el comando esté corriendo.

## Cómo editarla en VS Code

1. Abrir VS Code → `Archivo > Abrir carpeta` → elegir
   `C:\MARTO\INFORMATICA\Bioma\movimientos`.
2. Abrir la extensión de Claude Code y pedir los cambios que quieras ("agregá un gráfico de torta al resumen", etc.).
3. No hay compilación: guardás el archivo y recargás el navegador.

## Cómo usarla en el teléfono (Android)

Ya está publicada en **GitHub Pages** desde la rama `main` del repositorio
https://github.com/MartinTrigo/bioma-mov — cada `git push` la actualiza sola.

En el teléfono: abrir https://martintrigo.github.io/bioma-mov/ en Chrome →
menú ⋮ → **"Agregar a pantalla de inicio"**. Queda instalada como una app,
con ícono, y funciona sin conexión.

## Sincronización multiusuario con Google Sheets (Drive)

La app puede compartir los datos entre varios dispositivos usando una planilla
de Google como base de datos, mediante el script `apps-script/Code.gs`.

**Configuración (una sola vez, ~5 minutos):**

1. En la carpeta de Drive del proyecto
   (https://drive.google.com/drive/folders/1Ra2Zt2ERXl15D7L8qXSw_1bigkW4Jzrp)
   crear una **planilla de Google nueva** llamada por ej. `bioma-db`.
2. En la planilla: **Extensiones → Apps Script**. Borrar el contenido de
   `Código.gs` y pegar todo el contenido de `apps-script/Code.gs`. Guardar.
3. **Implementar → Nueva implementación → ⚙ → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
4. Autorizar los permisos cuando lo pida y **copiar la URL** que termina en `/exec`.
5. En la app: botón **⭳** → pegar la URL en "URL de sincronización" →
   **Guardar y sincronizar**. Repetir este paso 5 en cada teléfono/PC que use la app.

**Cómo funciona:** cada alta/edición/borrado se sincroniza automáticamente
(y también al abrir la app, o al tocar ↻). Si no hay conexión, los datos quedan
en el dispositivo y se suben en la próxima sincronización. Los conflictos se
resuelven a favor del cambio más reciente.

**Estructura de la planilla `bioma-db`** (el script solo administra estas
hojas; cualquier otra hoja agregada a mano no se toca):

- `resumen` — fórmulas vivas: totales, balance, desglose por concepto, por mes
  y deuda pendiente por persona. Se crea una sola vez; se puede personalizar.
- `ingresos` / `egresos` — una fila por movimiento. Se pueden agregar filas a
  mano: basta fecha, concepto y monto; el script normaliza fechas (`3/8/2026`)
  y montos (`$1.234,50`) y genera los campos técnicos en la próxima sincronización.
- `deudas` — con validación desplegable en `tipo` (debemos / nos deben) y
  `estado` (pendiente / saldada).
- `conceptos` — dos columnas (ingresos | egresos). Es la fuente de verdad:
  renombrar, borrar u ordenar acá se refleja en la app.
- `borrados` y `backup_movimientos` — hojas técnicas ocultas.

**Respaldo manual:** el botón ⭳ también permite exportar/importar JSON y
exportar CSV de movimientos y deudas, compatibles con Google Sheets.

## Respaldos automáticos

El script guarda **una copia completa de la planilla por día** en una carpeta
`respaldos bioma-db`, al lado de la original en Drive, y conserva los últimos
30 días.

**Activarlo** (una sola vez): en Extensiones → Apps Script, elegir la función
`instalarRespaldoDiario` en el desplegable de arriba y tocar **Ejecutar**. Pide
autorización para Drive, porque tiene que crear la copia. Deja hecha la primera
copia en el momento y programa el resto para las 3 de la mañana.

**Restaurar**: abrir la copia del día que sirva y copiar de ahí las hojas o
filas que hagan falta. La planilla en uso nunca se toca sola.

**Ver qué hay**: ejecutar `listarRespaldos` desde el mismo editor.

Aparte de esto, Google guarda su propio historial (Archivo → Historial de
versiones), y desde la app el botón ⭳ exporta un JSON con todo.

## Reglas de los conceptos

La hoja `conceptos` es la única fuente de verdad. Para que no se repita el
problema de los conceptos duplicados:

- La app **nunca** sube su lista completa: solo los que se crean con
  "+ agregar nuevo…". Editar, borrar u ordenar se hace en la planilla.
- El servidor **ignora los conceptos que manden versiones viejas de la app**
  (las que sí subían la lista entera y reponían lo borrado). Se reconocen
  porque no envían `cliente: 2`.
- Al unir listas se ignoran mayúsculas y acentos, así `Semillas` y `semillas`
  no pueden convivir partiendo los totales del resumen.

## Modelo de datos (`bioma-datos.json`)

```json
{
  "movimientos": [
    { "id": "...", "tipo": "ingreso|egreso", "fecha": "2026-07-17",
      "concepto": "Feria Puelo", "monto": 15000, "obs": "detalle" }
  ],
  "deudas": [
    { "id": "...", "fecha": "2026-07-16", "persona": "marto",
      "concepto": "semillas de nabo", "monto": 28000,
      "direccion": "debo|nos_deben", "estado": "pendiente|pagada" }
  ],
  "conceptos": { "ingresos": ["..."], "egresos": ["..."] }
}
```
