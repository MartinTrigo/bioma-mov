# Cuentas de trabajadores — contrato con MonAgric

Este documento describe **qué devuelve el endpoint de cuentas** (`Cuentas.gs`)
para que la pantalla "Cuentas" de MonAgric se pueda programar sin tener que
mirar bioma-db. Es el papel que se pasa de una conversación a la otra.

## Por qué existe

Las horas se cargan en MonAgric, pero **la deuda solo se puede calcular en
bioma-db**, que es el único lugar que tiene los dos lados: lo devengado (horas)
y lo pagado (egresos con concepto `sueldos`). Llevar la cuenta también en la
planilla de horas daría dos verdades sobre la misma plata.

Entonces: **bioma-db calcula, MonAgric muestra.** MonAgric no guarda ni
recalcula nada de esto; lo pide y lo dibuja.

## Seguridad — lo importante

Hay **dos** URLs de Apps Script y no son intercambiables:

| | qué permite | puede ir en MonAgric |
|---|---|---|
| `Code.gs` (bioma-db) | leer **y escribir** toda la economía | **NO. Nunca.** |
| `Cuentas.gs` | leer cuentas de sueldos, nada más | Sí |

`Cuentas.gs` es un **proyecto de Apps Script aparte** (uno tiene un solo
`doGet`) y no contiene una sola línea que escriba. Lo peor que puede hacer
alguien con esa URL es mirar cuentas de sueldos.

Aun así, la URL **no va escrita en el código de MonAgric si su repositorio es
público**: va en su configuración local, como cualquier otra clave.

## Quién ve qué

**Todos ven todo.** La pantalla lista a los integrantes y al tocar uno se abre
su cuenta, sin contraseña por persona. Es una decisión, no un descuido: el
endpoint no puede distinguir quién pregunta, así que prometer privacidad sería
prometer algo que el sistema no puede sostener. En un grupo de seis que se
reparten el trabajo, la cuenta de sueldos abierta es lo coherente con pedir
transparencia.

## Cómo se consulta

```
GET <url>                 → todos los trabajadores + totales del proyecto
GET <url>?persona=Luqui   → solo esa persona (sin acentos ni mayúsculas: da igual)
```

Conviene que **lo pida el Python de MonAgric, no el navegador**: evita
problemas de CORS y permite cachear la respuesta unos minutos. Los datos
cambian cuando se importan horas o se registra un pago, no a cada rato.

Si algo falla, responde `{"api":1,"error":"..."}` en vez de romper. MonAgric
debería mostrar la última respuesta buena y un aviso, nunca una pantalla en
blanco.

## Qué devuelve

```jsonc
{
  "api": 1,                         // si no viene, no usar la respuesta
  "actualizado": "2026-09-11T12:00:00.000Z",
  "moneda": "ARS",
  "trabajadores": [
    {
      "nombre": "Luqui",
      "horas": 23,                  // de toda la temporada
      "devengado": 172500,          // lo que se ganó, en pesos
      "pagado": 80000,              // lo que ya cobró
      "saldo": 92500,               // lo que se le debe (negativo = cobró de más)
      "tarifa": 7500,               // $/hora vigente
      "horasPagadas": 10.67,        // conversión, ver nota
      "horasAdeudadas": 12.33,      // conversión, ver nota
      "liquidado": 46.38,           // % del devengado ya cobrado
      "ultimoPago": "2026-08-20",   // "" si nunca cobró
      "meses": [                    // del más nuevo al más viejo
        {
          "mes": "2026-08",
          "horas": 8,
          "devengado": 60000,
          "areas": [ { "area": "Mantenimiento", "horas": 8 } ]
        }
      ],
      "pagos": [                    // del más nuevo al más viejo
        { "fecha": "2026-08-20", "monto": 30000, "obs": "efectivo" }
      ]
    }
  ],
  "totales": { "horas": 53, "devengado": 472500, "pagado": 95000, "saldo": 377500 },
  "pagosSinPersona": [ { "fecha": "2026-08-25", "monto": 20000, "obs": "" } ]
}
```

Con `?persona=` no vienen `totales` ni `pagosSinPersona`: son del proyecto, y
mostrarlos al lado de una sola cuenta haría creer que son suyos.

### Notas que evitan malentendidos

- **`horasPagadas` y `horasAdeudadas` son una conversión, no un dato.** Los
  pagos se registran en pesos; estas cifras son pesos ÷ tarifa promedio. Si
  alguien cobró con una tarifa vieja, el número es aproximado. Mostrarlas
  como "equivalen a ~12 h" y no como si fueran horas contadas.
- **`saldo` negativo** significa que cobró más de lo devengado (un adelanto).
  Es normal a mitad de temporada, no es un error.
- **Un trabajador puede aparecer sin horas** si cobró un adelanto antes de
  cargar nada. Ahí `horasPagadas` viene en `null`: no hay tarifa con qué
  convertir y no se inventa.
- **`pagosSinPersona`** son pagos de sueldos que quedaron sin nombre en
  bioma-db. No entran en ninguna cuenta: si aparece algo ahí, hay que
  corregirlo en la app de Bioma, no en MonAgric.
- Los nombres se unifican **sin acentos ni mayúsculas**: "Belu" y "Belú" son
  la misma persona. Se muestra la forma que figura en la hoja `horas`.

## La pantalla, tal como se pidió

Sección **Cuentas** en MonAgric:

1. Lista de integrantes, con el saldo al lado (el que más se le debe, arriba).
2. Al tocar uno, su cuenta:
   - horas de cada mes, desglosadas por área
   - horas y pesos ya pagados
   - horas y pesos adeudados
   - lista de pagos con fecha, monto y observación
   - cuánto falta para liquidar (`liquidado` sirve para una barra de progreso)

## Lo que NO hace y no debería hacerse acá

- **No registra pagos.** Un pago se carga en la app de Bioma como egreso con
  concepto `sueldos` y la persona. Si MonAgric permitiera cargarlos, habría
  dos lugares para la misma plata, que es exactamente el problema que esto
  viene a resolver.
- **No corrige horas.** Se corrigen donde se cargan: en MonAgric.
- **No sabe de tarifas.** Salen de la planilla de horas.

## Prompt para arrancar del lado de MonAgric

> En MonAgric quiero una sección nueva "Cuentas": lista de integrantes y, al
> tocar uno, su cuenta de horas y pagos. Los datos no se calculan acá: los
> devuelve un endpoint de solo lectura del proyecto Bioma. El contrato está
> en `C:\MARTO\INFORMATICA\Bioma\movimientos\apps-script\CUENTAS.md`, leelo
> antes de empezar. La URL la consulta el backend de Python (no el navegador)
> y va en la configuración local, no en el código. MonAgric solo muestra: no
> registra pagos ni recalcula saldos.
