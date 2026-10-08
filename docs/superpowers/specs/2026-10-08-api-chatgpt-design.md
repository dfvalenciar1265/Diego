# API para ChatGPT — mantenimiento y revisión de reservas
**Fecha:** 2026-10-08
**Estado:** Aprobado por Diego (opción A)
**Rama:** `claude/api-chatgpt-maintenance-f0edba`

---

## 1. Objetivo

Conectar ChatGPT (plan Plus de Diego) con AirAdmin para dos cosas:

1. **Mantenimiento:** crear, consultar y cambiar de estado los pendientes de los apartamentos.
2. **Revisión de reservas:** comparar las reservas que ChatGPT lee en Airbnb con las de la app,
   informar las diferencias y dejar una nota en las reservas afectadas.

**Éxito:** Diego le pega a su GPT la lista que sacó de Airbnb y en una respuesta sabe qué reservas
no coinciden con la app, y cada reserva con diferencia queda marcada en la app. Los pendientes de
mantenimiento se cargan y se cierran desde ChatGPT sin abrir la app.

## 2. Decisiones

| Decisión | Elección | Razón |
|---|---|---|
| Integración | API REST + GPT personalizado con "Acciones" (opción A) | En Plus funciona con certeza. MCP en Plus no tiene escritura confirmada y el modo agente no lo usa |
| Flujo de reservas | Dos pasos: el modo agente lee Airbnb → Diego pega la lista en el GPT | El modo agente no puede usar Acciones de GPT personalizados |
| Diferencias | Informar y dejar nota en la reserva; nunca corregir datos | Una reserva mal cargada mueve limpiezas, preparaciones y plata |
| Mantenimiento | Crear, consultar y cambiar estado (+ nota y costo) | Pedido de Diego. No reasigna personas |
| Autenticación | Una clave `GPT_API_KEY` como Bearer | Es lo que soportan las Acciones de GPT. Rotable cambiando la variable en Vercel |
| Lógica | En `lib/gpt-api/`, rutas delgadas encima | Si OpenAI habilita MCP en Plus o en el modo agente, se agrega otra "puerta" sin rehacer la lógica |
| Nombres de rutas y campos | En inglés, como el resto de la app; descripciones y errores en español | Consistencia con `/api/gmail-sync`; ChatGPT le explica los errores a Diego en español |

Descartadas: servidor MCP (opción B) y las dos a la vez (opción C), por lo dicho arriba.

## 3. Arquitectura

```
ChatGPT modo agente ──(lee Airbnb)──► lista de reservas (texto)
                                          │ Diego la pega
                                          ▼
GPT "AirAdmin" ──Bearer <clave>──► /api/gpt/*  (Next.js, en Vercel)
                                          │ verifica la clave
                                          ▼
                                   lib/gpt-api/  ──► Supabase (cliente de servicio)
```

### Piezas

| Archivo | Responsabilidad |
|---|---|
| `lib/gpt-api/auth.ts` | Verifica `Authorization: Bearer <GPT_API_KEY>` con comparación de tiempo constante. Sin clave configurada → nadie entra |
| `lib/gpt-api/compare.ts` | Lógica **pura** de comparación: empareja y clasifica diferencias. Sin base de datos |
| `lib/gpt-api/notes.ts` | Lógica **pura** para poner, reemplazar y quitar el segmento de nota "⚠️ Diferencia con Airbnb" |
| `lib/gpt-api/maintenance.ts` | Crear, listar y cambiar estado de pendientes con el cliente de servicio |
| `lib/gpt-api/reservations.ts` | Leer reservas del rango y aplicar las notas que devuelve la comparación |
| `lib/gpt-api/validate.ts` | Validación de entradas (fechas, tamaños, enums) con mensajes en español |
| `lib/maintenance-schedule.ts` | Función pura compartida `advanceNextDue(today, intervalMonths)`; la usan la app (`completeScheduledMaintenance`) y el API |
| `app/api/gpt/**/route.ts` | Rutas delgadas: auth → validar → llamar a `lib/gpt-api` → JSON |
| `app/api/gpt/openapi.json/route.ts` | Esquema OpenAPI 3.1 para crear el GPT (público, sin secretos). `servers[0].url` se arma con el dominio de la petición, así no hay que escribir el dominio de Vercel a mano |
| `docs/chatgpt-airadmin.md` | Guía para Diego: crear el GPT, instrucciones del GPT y texto para el modo agente |

`proxy.ts` ya deja pasar `/api/*` sin redirigir al login; no hay que tocarlo.

## 4. Rutas

Todas (salvo `openapi.json`) exigen `Authorization: Bearer <GPT_API_KEY>`. Sin clave o con clave
incorrecta → `401`. Si `GPT_API_KEY` no está configurada en el servidor → `503`.

### `GET /api/gpt/properties`
Apartamentos activos: `id`, `name`. Para que el GPT use el nombre exacto de la app.
Nunca devuelve `access_code`, `instructions` ni `address`.

### `GET /api/gpt/maintenance?property=&status=`
- `property` (opcional): nombre del apartamento (se compara sin tildes ni mayúsculas).
- `status` (opcional): `open` | `in_progress` | `resolved` | `active` (por defecto `active` = abiertos + en progreso).
- Devuelve: `id`, `property`, `title`, `description`, `priority`, `status`, `notes`, `cost`,
  `created_at`, `resolved_at`, `next_due`, `last_done`, `interval_months`. Máximo 100, más recientes primero.

### `POST /api/gpt/maintenance`
Cuerpo: `{ property, title, description?, priority }` con `priority` ∈ `urgent | normal | scheduled`.
- Queda `reported_by` = Diego (miembro admin con nombre "Diego", igual que `scripts/review-maintenance.mjs`),
  sin asignar, `notes` = "Creado desde ChatGPT."
- **No duplica:** si ya existe uno `open` o `in_progress` con el mismo título (sin distinguir mayúsculas)
  en ese apartamento, no crea y devuelve `{ created: false, existing: {...} }`.
- Respuesta: `{ created: true, issue: {...} }`.

### `PATCH /api/gpt/maintenance/{id}`
Cuerpo: `{ status?, note?, cost? }` (al menos uno).
- `status` ∈ `open | in_progress | resolved`. `resolved` pone `resolved_at` = ahora; otro estado lo deja en `null`
  (igual que `updateMaintenanceStatus`).
- `note` se **agrega** al final de `notes` como `[8-oct · ChatGPT] <texto>` (no reemplaza lo que había).
- `cost`: número ≥ 0.
- **Preventivos recurrentes** (`interval_months > 0`): `status: resolved` NO los resuelve. Hace lo mismo
  que el botón "Hecho": `last_done` = hoy y `next_due` = `advanceNextDue(hoy, interval_months)`; el estado
  no cambia. La respuesta lo dice: `{ scheduled_done: true, next_due }`.
- No cambia `assigned_to`, `title`, `priority` ni `property_id`.
- Id inexistente → `404`.

### `GET /api/gpt/reservations?from=&to=&property=`
Reservas de la app con noches dentro del rango (`check_in <= to` y `check_out > from`; por defecto de hoy a 60 días), de todos los estados
y orígenes, para que el GPT pueda consultarlas. Devuelve: `airbnb_code`, `guest_name`, `property`,
`check_in`, `check_out`, `guests`, `status`, `source`, `notes`. **Nunca** `amount`.

### `POST /api/gpt/reservations/compare`
Cuerpo:
```json
{
  "from": "2026-10-08",
  "to": "2026-12-07",
  "reservations": [
    { "code": "HMABC12345", "guest_name": "Laura", "property": "Palmetto 1001",
      "check_in": "2026-10-10", "check_out": "2026-10-13", "guests": 2, "status": "confirmed" }
  ]
}
```
- `code`, `guests` opcionales; `status` ∈ `confirmed | cancelled` (por defecto `confirmed`).
- `dry_run: true` (opcional) = solo mirar: devuelve las diferencias sin dejar ni quitar notas.
- Lista vacía → `400` ("La lista de Airbnb llegó vacía; no comparo para no marcar todo como faltante").
- Rango máximo 120 días; máximo 300 reservas; `check_out > check_in`.

Respuesta:
```json
{
  "summary": { "airbnb": 14, "app": 13, "matching": 11, "differences": 3, "unmatched": 0 },
  "differences": [
    { "types": ["dates_differ"], "code": "HMABC12345", "guest_name": "Laura",
      "property": "Palmetto 1001",
      "airbnb": { "check_in": "2026-10-10", "check_out": "2026-10-13" },
      "app":    { "check_in": "2026-10-10", "check_out": "2026-10-12" },
      "message": "Salida 13-oct en Airbnb, 12-oct en la app",
      "noted": true }
  ],
  "unmatched": [ { "input": {...}, "reason": "Hay 2 reservas de Laura en Palmetto 1001 que se cruzan" } ],
  "notes_cleared": 1
}
```

## 5. Reglas de comparación (`lib/gpt-api/compare.ts`)

**Reservas de la app que se cargan:** las que se cruzan con el rango ampliado 30 días a cada lado (por si las
fechas cambiaron mucho) más las que tienen alguno de los códigos de la lista. "Se cruza con el rango" = tiene
noches dentro: `check_in <= to` y `check_out > from`.

**Reservas de la app que entran a la comparación:** `source = 'airbnb'`, que se cruzan con `[from, to]`, en estado
`confirmed` o `cancelled` (las canceladas sirven para emparejar, no para reportar "no apareció").
Quedan fuera los bloqueos (`status = 'blocked'`) y las reservas directas (`source = 'direct'`): son
reservas directas y no aparecen como reservas en Airbnb.

**Resolución del apartamento** del lado de Airbnb: nombre de la app contenido en el texto, sin tildes ni
mayúsculas; si no, `resolvePropertyId` (alias como "Loft Moderno … Ángel del Mar" → Cartagena Beach 1214).
Si no se resuelve, se compara igual por código y se reporta el apartamento como desconocido.

**Emparejamiento**, en orden:
1. Por código: `code` = `airbnb_code` (sin distinguir mayúsculas ni espacios).
2. Sin código: mismo apartamento + `guestNameMatches(app.guest_name, airbnb.guest_name)` + fechas que se
   cruzan, entre las reservas de la app aún no emparejadas. Solo si hay **exactamente un** candidato;
   si hay 0 → se trata como "falta en la app"; si hay más de 1 → va a `unmatched` con el motivo.

**Tipos de diferencia** (una reserva puede tener varias: van todas en `types` y juntas en un solo `message`):

| `type` | Condición | Nota en la app |
|---|---|---|
| `missing_in_app` | Airbnb `confirmed` y en la app no existe, o existe `cancelled` | No (no hay reserva activa que marcar). El mensaje sugiere correr la sincronización de Gmail |
| `cancelled_in_airbnb` | Airbnb `cancelled` y la app `confirmed` | Sí |
| `dates_differ` | `check_in` o `check_out` distintos | Sí |
| `guests_differ` | Ambos lados traen huéspedes y son distintos | Sí |
| `property_differ` | Emparejada por código, apartamento resuelto y distinto | Sí |
| `not_in_airbnb_list` | App `confirmed` dentro del rango y no emparejada con ninguna de la lista | Sí, con "verificar" |

Airbnb `cancelled` y la app `cancelled` (o inexistente) → coincide, no se reporta.
Las diferencias de nombre (tildes, apellidos, mayúsculas) no se reportan.

**"Hoy"** en el API (fecha de las notas y `last_done`) es la fecha en Colombia (`America/Bogota`),
no la de UTC: desde las 7 p. m. de Colombia, en UTC ya es el día siguiente. `resolved_at` se sigue
guardando como fecha y hora ISO, igual que en la app.

## 6. Nota en la reserva (`lib/gpt-api/notes.ts`)

- Segmento: ` | ⚠️ Diferencia con Airbnb (8-oct): <mensaje>`. El mensaje nunca contiene `|`
  (se reemplaza por `/`), para no romper la lectura de `Check-in:` / `Check-out:` que hacen
  `actions/dashboard.ts`, `DashboardPrepCard` y `CleaningView` con `[^|]+`.
- `setDiffNote(notes, message, date)`: quita cualquier segmento previo de "⚠️ Diferencia con Airbnb" y agrega el nuevo.
- `clearDiffNote(notes)`: quita el segmento si existe; el resto de las notas queda idéntico.
- En cada comparación:
  - reservas de la app con diferencia → `setDiffNote`;
  - reservas de la app emparejadas y sin diferencia → `clearDiffNote` (cuenta en `notes_cleared`).
- Solo se escribe si la nota cambia (no hay escrituras inútiles).
- Nunca se tocan otros campos de la reserva ni sus tareas. La nota de la sincronización de Gmail
  ("⚠️ Fechas actualizadas — verificar en Airbnb") no se toca.
- Diego puede borrar la nota a mano en el formulario de la reserva.

## 7. Seguridad

- **Clave:** `GPT_API_KEY` (32 bytes aleatorios en base64url) en Vercel (Production) y en `.env.local`
  para pruebas. Comparación con `crypto.timingSafeEqual`. Sin variable configurada → `503` siempre.
- **Cliente de servicio** (salta RLS) solo en el servidor. Escrituras permitidas, y nada más:
  - `maintenance`: insertar; actualizar `status`, `resolved_at`, `notes`, `cost`, `last_done`, `next_due`.
  - `reservations`: actualizar `notes`.
- **Nunca se devuelven:** `access_code`, `instructions`, `address`, `amount`, correos ni teléfonos.
- **No hay borrados** en ninguna ruta.
- **GPT privado** ("Solo yo"), no publicado en la tienda de GPT. ChatGPT pide permiso antes de llamar
  acciones que escriben.
- **Validación:** fechas `AAAA-MM-DD` válidas; textos con largo máximo (título 120, descripción y nota 1000,
  nombre 100); enums cerrados; cuerpo JSON inválido → `400`. Errores en español: `{ error: "..." }`.
- **Rotación:** cambiar `GPT_API_KEY` en Vercel y en el GPT; la vieja deja de servir al redeploy.
- Sin límite de frecuencia por ahora (un solo usuario, clave secreta). Se agrega si aparece abuso.

## 8. Guía para Diego (`docs/chatgpt-airadmin.md`)

1. Crear el GPT: ChatGPT → Explorar GPT → Crear → Configurar → nombre "AirAdmin", visibilidad "Solo yo".
2. Pegar las **instrucciones del GPT** (incluidas en la guía): idioma español; usar siempre los nombres
   de `/properties`; prioridades urgent/normal/scheduled con los criterios del contexto compartido;
   confirmar con Diego antes de crear o cerrar pendientes; mostrar las diferencias en tabla; nunca
   inventar arreglos.
3. Acciones → Importar desde URL → `https://diegoprueba.vercel.app/api/gpt/openapi.json` (dominio de producción).
4. Autenticación → Clave de API → Bearer → pegar la clave.
5. **Texto para el modo agente** (incluido en la guía): entrar a Airbnb → Hoy → Reservaciones, rango de
   fechas, y devolver la lista en un bloque con columnas fijas (código, huésped, anuncio, llegada, salida,
   huéspedes, estado) que el GPT convierte al formato de `compare`.

## 9. Pruebas

**Unitarias (Vitest, `__tests__/lib/gpt-api/`):**
- `compare`: emparejamiento por código; por nombre sin código; candidato ambiguo → `unmatched`;
  cada tipo de diferencia; varias diferencias en una reserva; bloqueos y directas excluidos;
  canceladas en ambos lados no se reportan; apartamento por alias.
- `notes`: poner, reemplazar y quitar el segmento; `|` dentro del mensaje se neutraliza; después de
  poner la nota, `Check-out:\s*([^|]+)` sigue devolviendo la misma hora; quitar deja el texto original.
- `auth`: sin variable → 503; sin encabezado / clave incorrecta / largo distinto → 401; correcta → pasa.
- `validate`: fechas inválidas, rango > 120 días, lista vacía, > 300 ítems, enums fuera de lista.
- `advanceNextDue`: con intervalo, sin intervalo, fin de mes.

**Manual local:** `npm run dev` y `curl` a cada ruta con la clave de `.env.local` (con y sin clave);
crear un pendiente de prueba y luego dejarlo resuelto; comparar una lista con una diferencia
conocida y revisar la nota en la app.

**Antes del PR:** `npx vitest run`, `npm run lint`, `npm run build`.

## 10. Entrega

- PR a `main` desde esta rama con la cuenta `info-softop`.
- Claude genera la clave y se la pasa a Diego. Cargarla en Vercel lo hace Diego, o Claude por la línea
  de comandos de Vercel con el "sí" de Diego.
- Después del deploy: Diego crea el GPT siguiendo la guía; primera prueba con una consulta de mantenimiento
  y una comparación de los próximos 30 días.

## 11. Fuera de alcance

- Servidor MCP (se puede agregar después sobre `lib/gpt-api/`).
- Corregir reservas automáticamente, importar las faltantes o disparar la sincronización de Gmail desde el API.
- Subir fotos a los pendientes desde ChatGPT.
- Reasignar pendientes o borrar cualquier dato.
- Comparar montos.
