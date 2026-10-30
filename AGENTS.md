<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AirAdmin — instrucciones para agentes (Codex, Claude Code y otros)

App interna para operar los apartamentos de Airbnb de Diego en Cartagena: reservas, limpieza,
preparación, mantenimiento, insumos, reportes, cobros adicionales y solicitudes especiales.
Producción: https://diegoprueba.vercel.app (Vercel, proyecto `diegoprueba`) sobre Supabase.
Repositorio: `dfvalenciar1265/Diego`, rama principal `main`.

## Idioma

- Todo lo que se le escribe a Diego va **en español**: respuestas, resúmenes, avisos de estado,
  preguntas, mensajes de commit y descripción de PR. Aunque el código o los logs estén en inglés.
- Textos de la interfaz y errores que ve el usuario o el modelo del MCP: en español.

## Comandos

```bash
npm ci                         # instalar (Node 20+)
npm run dev                    # http://localhost:4000 (necesita .env.local con Supabase)
npx vitest run                 # pruebas unitarias e integración (no necesitan red ni secretos)
npx tsc --noEmit -p .          # tipos
npx eslint                     # lint (hay 6 avisos viejos; no agregar nuevos)
npm run build                  # build de producción
bash scripts/test-migrations.sh  # migraciones + pruebas SQL en Postgres LOCAL temporal
```

- Para el build sin secretos reales:
  `NEXT_PUBLIC_SUPABASE_URL=https://example.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build`.
- `test-migrations.sh` necesita `psql`/`createdb` locales (Postgres.app). Se niega a correr contra
  un host remoto y nunca toca Supabase.
- Antes de decir que algo está listo: pruebas, tipos, lint y build en verde, y revisar el diff.

## Mapa del código

| Dónde | Qué hay |
|---|---|
| `app/(app)/*` | Pantallas (Inicio, Reservas, Limpieza, Tareas, Mantenimiento, Reportes, Equipo…) |
| `actions/*.ts` | Server actions de la app (usan la sesión del usuario: aplica RLS) |
| `components/*` | UI (Tailwind 4, shadcn/base-ui). Mobile-first; escritorio con menú lateral |
| `lib/gpt-api/*` | Servicio común del API de ChatGPT (`/api/gpt/*`) y del MCP: validación, lecturas y escrituras |
| `lib/mcp/*` | Servidor MCP `/api/mcp` (OAuth de Supabase, solo admins activos): herramientas e instrucciones |
| `lib/gmail-sync.ts` | Importa reservas desde los correos de Airbnb (cron diario de Vercel) |
| `lib/calendar-sync`, `lib/public-availability` | iCal de Airbnb y API pública de disponibilidad de Casa Blue |
| `supabase/migrations` | Migraciones SQL. Las 001–004 no reflejan todo el esquema real (ver `scripts/test-migrations.sh`) |
| `__tests__/` | Vitest. `__tests__/helpers/fake-db.ts` = base en memoria que imita PostgREST |
| `e2e/` | Playwright (login y rutas protegidas) |

`lib/gpt-api/service.ts` es el centro: las rutas REST y el MCP solo traducen su resultado. Si se
agrega una herramienta MCP, va ahí, en `lib/mcp/tools.ts` y en `lib/mcp/instructions.ts`, con
pruebas en `__tests__/lib/mcp/tools.test.ts`. No romper los contratos existentes.

## Reglas del negocio que el código ya respeta (no romperlas)

- **Zona horaria America/Bogota.** "Hoy" es el día en Colombia (`todayInBogota()`), nunca UTC.
- **Check-out estándar 11:00** en todos los apartamentos (`lib/checkout.ts`). Otra hora solo si
  alguien la fijó en la app como excepción (tarea de limpieza `"HH:MM|"`). La hora de las notas de
  la reserva o del correo de Airbnb (12pm) NO cuenta. Una ETA del huésped no autoriza nada.
- **Cobros adicionales** (`reservation_charges`) van aparte del precio de la reserva y del
  desembolso de Airbnb. Pendiente ≠ cobrado: cobrado exige fecha real y confirmación/comprobante.
  Nunca sumarlos a `reservations.amount`.
- **Solicitudes especiales** (`special_requests`: cuna, camas…): registrada → avisada → lista.
  Avisar no es dejarla lista; lista exige quién confirmó.
- Cobros y solicitudes: historial por trigger (`followup_history`), `version` para concurrencia
  optimista (actualizar con `WHERE version = la leída`; si no coincide, conflicto y devolver el
  estado actual), sin borrados, estados finales, deduplicación por índice único y `review_reason`
  cuando la reserva cambia de fechas o se cancela.
- **Cancelar una reserva** = `status = 'cancelled'` (nunca borrarla, si no la sincronización de
  Gmail la vuelve a importar).
- Una reserva que no aparece en una consulta **no** se da por cancelada ni se recrea sola.
- Notas: solo se agregan, nunca se reemplazan. Las notas de reserva no llevan `|` (separa las horas).
- Bloqueos no cuentan como ocupación. Montos en COP. El personal de limpieza no ve montos.
- Roles (`lib/permissions.ts`): admin, cleaning, maintenance, anfitrion.

## Seguridad y producción (obligatorio)

- **Nunca** aplicar migraciones en Supabase, mergear, desplegar ni escribir datos reales sin la
  aprobación explícita de Diego en el chat. Las migraciones se prueban antes con
  `scripts/test-migrations.sh` y llevan en su encabezado el procedimiento de recuperación.
- **Nunca** modificar reservas reales, enviar mensajes a huéspedes o equipo, ni cambiar precios,
  promociones, disponibilidad o anuncios de Airbnb sin aprobación.
- **Nunca** poner secretos en código, pruebas, logs, docs, commits ni en el chat. `.env*` está en
  `.gitignore`; usar `node --env-file=.env.local` cuando haga falta leer, sin imprimir valores.
- Pruebas siempre con datos sintéticos (nombres "… Sintético", correos `@example.test`).
- Conservar los cambios que el desarrollador ya tenga en el árbol de trabajo.
- Leer la base de producción para verificar está permitido; escribir, no (salvo pedido explícito).

## Git y GitHub

- Cuenta de GitHub: **siempre `info-softop`** (`gh auth status` debe mostrarla activa). No cambiar
  a otra cuenta para salir del paso; si falta permiso, avisar a Diego.
- Trabajar en una rama, nunca directo en `main`. Commits y PR en español, pequeños y descriptivos.
- El PR describe qué cambia, pruebas ejecutadas con resultados reales, lo que no se verificó y los
  pasos de despliegue. No declarar terminado lo que no se verificó.
- Vercel crea un deploy de vista previa por PR y despliega `main` a producción al mergear.

## Cómo trabajar

1. Inspeccionar lo existente (código, migraciones, pruebas, MCP) y definir criterios de aceptación.
2. Cambio mínimo compatible, reutilizando `lib/gpt-api/*` y los componentes existentes.
3. Pruebas: unitarias, de servicio con `fake-db`, SQL en `scripts/test-*.sql` si toca la base.
   Cubrir duplicados, reintentos, concurrencia, permisos, cancelaciones, cambios de fecha y zona horaria.
4. Pruebas + tipos + lint + build. Revisar el diff y repetir hasta cumplir.
5. Entregar: qué cambió, archivos, pruebas y resultados reales, limitaciones, pendientes y despliegue.

Pendientes conocidos: hora estimada del huésped separada de la autorizada; conciliación de la
sincronización; preparación (limpieza terminada / revisión / listo) con incidencias por llegada;
huéspedes reservados vs. acordados; inventario realmente vendible; sync de Gmail varias veces al
día (requiere Vercel Pro o GitHub Actions); RLS por rol (`docs/seguridad/rls-por-rol.propuesta.sql`, sin aplicar).
