# MCP de AirAdmin: crear, modificar y cancelar reservas
**Fecha:** 2026-10-11
**Estado:** Aprobado por Diego ("sí, apruebo, hazlo de corrido hasta producción")
**Rama:** `claude/mcp-reservas`
**Antecedentes:** `2026-10-08-api-chatgpt-design.md` (el API solo informaba diferencias) y
`2026-10-08-mcp-airadmin-design.md` (servidor MCP con OAuth de Supabase).

## 1. Qué cambia y por qué

Diego quiere crear, modificar y "borrar" reservas desde ChatGPT. Hasta ahora el MCP solo
leía reservas y dejaba la nota "⚠️ Diferencia con Airbnb". Decisiones de Diego (11-oct):

| Pregunta | Decisión |
|---|---|
| ¿Qué reservas? | Directas **y** de Airbnb (las de Airbnb exigen el código HM…) |
| ¿Montos? | Poner **y** ver: crear/modificar con monto; las consultas devuelven el monto |

## 2. Herramientas MCP

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `create_reservation` | escritura | Crea la reserva (estado `confirmed`) y sus tareas de limpieza y preparación |
| `update_reservation` | escritura | Cambia `guest_name`, `guests`, `check_in`, `check_out`, `amount`, o agrega `note`; si cambian las fechas mueve las tareas |
| `cancel_reservation` | **destructiva** | Como "Eliminar" de la app: `status = cancelled` y borra sus tareas |
| `list_reservations` (existe) | lectura | Ahora devuelve también `id` y `amount` |

`update_reservation` y `cancel_reservation` identifican la reserva por su `id` (de
`list_reservations` o del resultado de `create_reservation`).

## 3. Reglas

- **Sin dobles reservas:** no se crea ni se mueve una reserva que se cruce con otra no cancelada
  del mismo apartamento (`check_in < otra.check_out` y `otra.check_in < check_out`; salir y
  llegar el mismo día no choca). El error dice con quién choca.
- **Airbnb:** `code` obligatorio (8–12 letras/números, se normaliza a mayúsculas sin espacios).
  Si el código ya existe en la app (en cualquier estado) no se crea otra: se informa la existente
  con su `id`. Así la sincronización de Gmail nunca duplica. En reservas directas el código se ignora.
- **Tareas:** las de `lib/turnover-tasks.ts`, las mismas que usa la sincronización:
  - crear → `missingTurnoverTasks` (sin tareas si la estadía ya terminó; preparación solo si el
    huésped aún no llega, nunca en el pasado);
  - mover fechas → limpieza al nuevo `check_out`; preparación a `preparationTaskFor(r, hoy)` solo
    si la llegada es hoy o después; se crean las que falten de una estadía vigente confirmada;
  - cancelar → se borran todas sus tareas (como la app). No se hace la limpieza de tareas
    huérfanas por nombre que hace la app (podía borrar tareas de otro huésped homónimo).
- **Notas:** solo se agregan al final con " | " (sin "|" dentro), para no romper las horas
  "Check-in: … | Check-out: …" que leen la portada y Limpieza. Una reserva creada desde ChatGPT
  empieza con "Creada desde ChatGPT por <quien está conectado> (11-oct)".
- **No se cambia:** el apartamento ni el origen (como el formulario de la app). Para mover a un
  huésped: cancelar y crear.
- **Reserva cancelada:** no se modifica (se crea de nuevo); cancelarla otra vez responde
  `already_cancelled: true` sin escribir.
- **Validación (español):** fechas reales, salida > llegada, máximo 120 noches; huéspedes 1–50;
  monto número ≥ 0 en pesos (máx. 1.000.000.000); textos con largo máximo.
- Después de escribir se refrescan `/calendar`, `/`, `/cleaning`, `/tasks`.

## 4. Piezas

| Archivo | Cambio |
|---|---|
| `lib/gpt-api/reservation-writes.ts` (nuevo) | Puras: `staysOverlap`, `appendReservationNote`, `creationNotes`, `conflictMessage`, `toReservationOut`. DB: `findReservationById`, `findReservationByCode`, `reservationConflicts`, `insertReservation`, `updateReservationRow`, `cancelReservationRow` |
| `lib/gpt-api/validate.ts` | `checkStay`, `parseNewReservation`, `parseReservationPatch`, `parseReservationId` |
| `lib/gpt-api/service.ts` | `createReservationTool`, `updateReservationTool`, `cancelReservationTool`; `listReservationsTool` devuelve `id` y `amount` |
| `lib/gpt-api/reservations.ts`, `compare.ts` | `amount` en la consulta y en `AppReservation` (opcional) |
| `lib/mcp/tools.ts`, `instructions.ts` | 3 herramientas nuevas e instrucciones (resumen y "sí" antes de escribir) |

El API REST del GPT viejo (`/api/gpt/reservations`) también pasa a devolver `id` y `amount`
(comparte `listReservationsTool`); se retira el 11-dic-2026.

## 5. Pruebas

- Unitarias: validaciones nuevas; `staysOverlap` (incluye salida = llegada); notas; mensaje de
  choque; `toReservationOut`; registro de herramientas (lectura / escritura / destructiva).
- `tsc`, `eslint`, `npm run build`.
- Lectura contra la base real (`list_reservations` con `id` y `amount`; búsqueda de choques).
- Producción: "Actualizar herramientas" en el complemento de ChatGPT y consulta de solo lectura.
  Crear/modificar/cancelar en vivo: Diego, con una reserva real, o una de prueba con su permiso.
