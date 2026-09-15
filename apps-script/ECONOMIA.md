# Resumen económico — lo que MonAgric necesita de Bioma

Contraparte de `CUENTAS.md`, escrita desde el lado de MonAgric. Describe **qué
endpoint hace falta** para poder mostrar el estado económico del proyecto
dentro de la app, sin que MonAgric calcule nada.

## El principio, que ya funcionó una vez

**Bioma calcula, MonAgric muestra.** Igual que con las cuentas de sueldos.
MonAgric no suma movimientos, no deriva balances y no guarda nada: pide un
resumen ya hecho y lo dibuja. Si calculara, habría dos verdades sobre la misma
plata y tarde o temprano una de las dos estaría mal.

## Seguridad

Vale lo mismo que para `Cuentas.gs`:

- Un **proyecto de Apps Script aparte**, de solo lectura, sin una línea que
  escriba. La URL de `Code.gs` de bioma-db no entra nunca en MonAgric.
- La dirección va en las **propiedades del script** de MonAgric, no en el
  código: el repositorio es público.
- **La consulta la hace el backend de MonAgric, no el navegador.** El
  teléfono nunca ve la respuesta completa: el servicio de MonAgric filtra
  según quién pregunta y le manda a cada uno solo lo que le corresponde.

Eso último es la diferencia con el planteo de `CUENTAS.md`: el endpoint de
Bioma no puede saber quién pregunta, pero MonAgric sí, porque cada teléfono
tiene una credencial asociada a una persona. Así que **Bioma puede mandar todo
en una sola respuesta** y MonAgric decide qué mostrar. No hacen falta niveles
ni parámetros de permiso del lado de Bioma.

## Cómo se consulta

```
GET <url>     → el resumen completo de la temporada en curso
```

Sin parámetros. Si hace falta una temporada anterior, `?temporada=2025-26`.

Si algo falla, responder `{"api":1,"error":"..."}` en vez de romper: MonAgric
muestra el último resumen bueno con un aviso, nunca una pantalla en blanco.

## Qué necesita devolver

```jsonc
{
  "api": 1,                          // si no viene, MonAgric descarta la respuesta
  "actualizado": "2026-09-12T12:00:00.000Z",
  "moneda": "ARS",
  "temporada": "2026-27",

  "resumen": {
    "ingresos": 4820000,             // de toda la temporada
    "egresos": 3910000,
    "balance": 910000,               // ingresos - egresos
    "disponible": 340000             // caja + banco hoy, o null si no se lleva
  },

  "meses": [                         // del más nuevo al más viejo
    { "mes": "2026-09", "ingresos": 610000, "egresos": 520000,
      "balance": 90000,              // del mes
      "acumulado": 910000 }          // arrastrado desde el inicio de la temporada
  ],

  "ingresosPorConcepto": [           // ordenado de mayor a menor
    { "concepto": "Verduras", "monto": 3200000, "porcentaje": 66.4 }
  ],
  "egresosPorConcepto": [
    { "concepto": "Sueldos", "monto": 1900000, "porcentaje": 48.6 }
  ],

  // El trabajo de la temporada, sin nombres: el logro de haber registrado
  // las horas. Agregado por Bioma a pedido de Martín, sept 2026.
  "horas": {
    "total": 404,
    "porArea": [
      { "area": "Hortícola", "horas": 180, "porcentaje": 44.6,
        "actividades": [ { "actividad": "Cosecha y acondicionado", "horas": 90 } ] }
    ],
    "porActividad": [
      { "actividad": "Cosecha y acondicionado", "horas": 120, "porcentaje": 29.7 }
    ]
  },

  // Para poder cruzar con la sección Cuentas sin volver a pedirla
  "sueldos": { "devengado": 2400000, "pagado": 1900000, "saldo": 500000 }
}
```

**Sobre `horas`:** las actividades van anidadas dentro del área a propósito.
Saber que hubo 40 horas de "Siembras" sirve poco; lo que importa es de qué área
fueron. `porActividad` es el mismo dato aplanado, para cuando se quiere el
ranking sin abrir áreas. Las horas de un área **siempre** son la suma de sus
actividades: si no dieran, hay un error de este lado.

**Sobre `meses`:** de ahí sale el flujo mes a mes completo, tabla y gráfico, sin
ningún campo aparte. Cada elemento trae ingresos, egresos, balance del mes y
**acumulado** de la temporada, del más nuevo al más viejo.

El `acumulado` viaja calculado aunque se pudiera sumar del otro lado: si AMA lo
arrastrara por su cuenta, habría dos acumulados de la misma plata. Ojo con una
trampa: se arrastra **del mes más viejo al más nuevo**, pero la lista viene al
revés. El primer elemento del arreglo es el mes actual y su `acumulado` es el
balance de toda la temporada.

**El gráfico que se quiere** (así quedó en la app de Bioma): **tres series en
un mismo par de ejes**.

- **Barras** = `balance` del mes. Verdes hacia arriba, rojas hacia abajo. Van
  de fondo y translúcidas, para que las líneas se lean por encima.
- **Línea verde** = `ingresos` mes a mes.
- **Línea marrón** = `egresos` mes a mes.

No son dos columnas de ingresos y egresos: la barra es la **diferencia**. Lo
que se busca ver de un vistazo es en qué meses el proyecto ganó y en cuáles
perdió, y además de dónde salió ese saldo — un mes puede cerrar en cero
moviendo mucho o moviendo nada, y no es lo mismo.

**Comparten un solo eje a propósito.** Como el saldo es la resta, la distancia
vertical entre las dos líneas *es* la altura de la barra: las dos cosas cuentan
lo mismo y se refuerzan. Donde la línea verde cruza por debajo de la marrón, la
barra se pone roja sola. El precio es que en meses de mucho movimiento y poco
saldo la barra queda chica, pero eso es exactamente el dato.

La receta está en `graficoFlujo()` de `js/resumen.js` y en las clases `.fg-*`
de `styles.css`: SVG escrito a mano, sin librerías, unas treinta líneas. El eje
llega hasta el mayor de los tres valores y baja hasta el saldo más negativo, si
hay alguno. Ancho fijo por mes con scroll horizontal, para que una temporada
entera no apriete las barras hasta volverlas indistinguibles.

### Lo que hace que esto sea usable

- **Todo pre-calculado.** Porcentajes incluidos. MonAgric no divide ni suma:
  si tiene que hacer cuentas, en algún momento van a diferir de las de Bioma.
- **Nada de movimientos sueltos.** No mandar la lista de ventas ni de gastos
  uno por uno. Es mucho volumen, expone detalle que no hace falta para un
  resumen, y lo que se quiere ver es el agregado.
- **Arreglos vacíos, no `null`**, cuando no hay datos. Un `[]` se dibuja como
  "todavía no hay nada"; un `null` es una excepción esperando pasar.
- **`disponible` puede ser `null`** si el proyecto no lleva caja. MonAgric
  oculta esa cifra en vez de mostrar cero, que significaría otra cosa.
- **Los conceptos, como se escriben en bioma-db.** MonAgric no los traduce ni
  los agrupa: los muestra tal cual, así lo que se ve en la app y lo que se ve
  en la planilla son la misma palabra.

## Qué va a hacer MonAgric con esto

Dentro de la sección **Cuentas**, una tarjeta con el estado del proyecto:
balance de la temporada, el mes en curso, y en qué se va la plata.

Quién lo ve lo decide MonAgric por propiedad, igual que las cuentas ajenas.
La idea es que los socios vean el resumen completo y el resto vea, si acaso,
una versión reducida. Eso se resuelve de este lado y no cambia el contrato.

## Lo que NO debería hacer este endpoint

- **No registrar nada.** Ningún ingreso, ningún egreso, ningún ajuste. Eso se
  carga en bioma-mov, que es su lugar.
- **No repetir las cuentas de sueldos.** Para eso está `Cuentas.gs`. Acá solo
  el total agregado, para poder mostrar cuánto pesan los sueldos en el egreso.
- **No exponer datos de personas.** Nombres, tarifas y pagos individuales
  viajan por el otro endpoint, que ya tiene su filtro.
