# Bioma · Registro de movimientos

App para registrar **ingresos, egresos y deudas** del proyecto Bioma, con resúmenes mensuales y generales. Reemplaza la planilla de Google Sheets.

## Arquitectura

- **PWA (Progressive Web App)** en HTML + CSS + JavaScript puro. Sin frameworks, sin dependencias, sin build. Un archivo de cada tipo:
  - `index.html` — estructura y pantallas (Ingresos / Egresos / Deudas / Resumen)
  - `styles.css` — estilo (paleta verde/tierra del logo)
  - `app.js` — toda la lógica y los datos
  - `logo.svg` — logo vectorial
  - `manifest.json` + `sw.js` — instalación en Android y funcionamiento sin conexión
- **Datos:** se guardan en el propio dispositivo (`localStorage`). Los conceptos de ingresos (puntos de venta) y egresos vienen de la validación de datos de la planilla original, y se pueden agregar nuevos desde la propia app ("+ agregar nuevo…").

## Cómo probarla en la PC

```
cd C:\MonAgro\bioma
python -m http.server 8642
```

y abrir http://localhost:8642 en el navegador.

## Cómo editarla en VS Code

1. Abrir VS Code → `Archivo > Abrir carpeta` → elegir `C:\MonAgro` (o `C:\MonAgro\bioma`).
2. Abrir la extensión de Claude Code y pedir los cambios que quieras ("agregá un gráfico de torta al resumen", etc.).
3. No hay compilación: guardás el archivo y recargás el navegador.

## Cómo usarla en el teléfono (Android)

La forma más simple y gratuita es publicarla en **GitHub Pages** o **Netlify Drop**:

- **Netlify Drop** (lo más rápido): entrar a https://app.netlify.com/drop y arrastrar la carpeta `bioma`. Te da una URL pública en segundos.
- **GitHub Pages:** subir la carpeta a un repositorio y activar Pages en Settings.

Luego, en el teléfono: abrir la URL en Chrome → menú ⋮ → **"Agregar a pantalla de inicio"**. Queda instalada como una app, con ícono, y funciona sin conexión.

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
resuelven a favor del cambio más reciente. Los datos quedan visibles en la
planilla `bioma-db` (hojas: movimientos, deudas, conceptos) y Claude puede
leerlos directamente desde Drive.

**Respaldo manual:** el botón ⭳ también permite exportar/importar JSON y
exportar CSV de movimientos y deudas, compatibles con Google Sheets.

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
