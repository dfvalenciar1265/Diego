# Horarios por reserva: criterios de aceptación

Esta fase separa el estándar de operación (entrada 15:00, salida 11:00), la hora estimada
comunicada por el huésped y una excepción autorizada por un administrador activo.

- Cada dato indica reserva, dirección (entrada/salida), estancia, fuente, autor y fecha. En los
  datos heredados no se inventa el autor ni la fecha originales: aparecen como desconocidos.
- La hora operativa es la excepción vigente o el estándar. Una ETA anticipada nunca autoriza
  entrada temprana. Los horarios genéricos de los correos son información de la plataforma,
  no una ETA del huésped ni una autorización.
- App, MCP y Gmail conservan registros separados. Gmail no sustituye un ajuste manual; los
  datos contradictorios quedan visibles y el historial no se borra.
- Repetir una solicitud con la misma clave no duplica. Dos cambios manuales concurrentes que
  parten de la misma versión no se pisan: uno recibe conflicto y debe volver a consultar.
- Solo un administrador activo autoriza excepciones. Gmail solo registra información y ETA
  explícita; el equipo activo puede consultar horarios. Anónimos e inactivos no acceden.
- Cambiar fechas/apartamento o cancelar invalida los horarios anteriores, también si luego se
  vuelve a las fechas originales. Las horas de llegada nunca se usan para la salida.
- Se conserva `HH:MM|nota` como proyección de la excepción autorizada. Los lectores de portada,
  limpieza y MCP conservan sus contratos; se agregan estándar, ETA, procedencia y revisión.
- Las nuevas escrituras usan fecha/hora de Colombia y comprobación atómica en Postgres. Las
  pruebas cubren medianoche en Colombia, duplicados, reintentos, concurrencia real, permisos,
  cancelación y cambios de fecha. Solo datos sintéticos en una base temporal local.

## Vista previa autorizada y producción pendiente de aprobación

1. Revisar el PR mediante la vista previa automática de Vercel, autorizada por Diego el 30-oct-2026.
   La nueva tabla/RPC no existe mientras no se aplique la migración en la base conectada: el build
   no prueba la lectura/escritura autenticada de los nuevos horarios. No aplicar la migración para
   resolver esta limitación sin aprobación expresa.
2. Aplicar la nueva migración una sola vez, después de la base ya aplicada 20261019130000.
3. Desplegar la app y actualizar herramientas del complemento AirAdmin en un chat nuevo.
4. Comprobar lecturas de portada y MCP; cualquier prueba de escritura real requiere aprobación.
5. Recuperación: volver a la versión anterior de la app; conservar tabla e historial. Las notas
   siguen siendo compatibles. No borrar registros ni revertir la migración destructivamente.

## Compatibilidad y alcance de esta entrega

`list_turnovers` conserva `time` y `time_source` para la hora **permitida** y agrega `timing`.
`set_checkin_time` y `set_checkout_time` admiten `kind=estimate|authorization`, `reservation_id`,
`expected_version` y `request_key`. Omitir `kind` mantiene el contrato previo de autorización;
el MCP indica que una ETA siempre debe enviarse con `kind=estimate`.

Gmail solo reconoce una ETA cuando hay una etiqueta explícita (por ejemplo «Hora estimada de
llegada: 09:00»). No se interpreta texto libre ni se convierte el horario genérico de Airbnb en
un permiso. Un correo sin fecha verificable no crea un registro de horario. Los correos de
estancias anteriores se conservan invalidados para revisión y no interrumpen la importación.

La nueva tabla conserva hechos y sus invalidaciones; la versión por reserva también avanza al
cambiar fechas, apartamento o estado, para rechazar formularios abiertos antes del cambio.
Las notas de preparación se guardan sin convertir su hora sugerida en una autorización.

Diego autorizó la vista previa de Vercel para revisar el PR. Se eliminó de `vercel.json` el bloque
`git.deploymentEnabled` que la desactivaba. La migración en Supabase y el merge/despliegue de
producción siguen requiriendo su aprobación expresa.

Quedan para las siguientes fases, en orden: conciliación de sincronización; etapas de
preparación con incidencias; huéspedes reservados/acordados y cobros; inventario vendible.

## Validación inicial del 30-oct-2026 (antes de incorporar el PR #18)

| Control | Resultado observado |
|---|---|
| Línea base de `main` actualizado | 370 pruebas correctas, 1 opcional omitida; tipos correctos; lint con 6 avisos previos; build correcto; SQL correcto |
| Suite final, incluyendo HTTP/Postgres local | 412 pruebas correctas en 40 archivos, sin omisiones |
| `npx tsc --noEmit -p .` | Correcto, sin errores |
| `npx eslint` | 0 errores y los mismos 6 avisos previos en `__tests__/lib/types.test.ts` |
| Build con URL `https://example.invalid` y clave `dummy` | Correcto; necesitó acceso a Google Fonts |
| `bash scripts/test-migrations.sh` | Correcto en base temporal local; también ejecutado dentro de la prueba HTTP final |
| Dos conexiones SQL concurrentes | Un ganador y un conflicto 40001, sin sobrescribir |
| Revisión visual | Componentes reales con datos sintéticos y acciones simuladas, aislados de Supabase |
| `git diff --check` | Correcto |

La suite completa con el caso opcional se ejecutó con:

```bash
CASA_BLUE_LOCAL_POSTGRES_TEST=1 CASA_BLUE_LOCAL_POSTGRES_RUNNER=psql npx vitest run
```

Los primeros intentos encontraron dependencias incompletas, copias antiguas de pruebas bajo
`.claude/worktrees` y bloqueos del sandbox para Postgres/Google Fonts. Se instaló el lockfile
con `npm ci`, se excluyó `.claude` de Vitest/ESLint y se repitieron los controles con los accesos
locales/de red necesarios. No se cambió ninguna dependencia del proyecto.

No se verificaron la migración en Supabase, el RPC a través del PostgREST real, la actualización
del complemento MCP ni escrituras desde una sesión real de la app. No se ejecutaron asesores
remotos ni se hicieron despliegues de producción. Los permisos SQL se comprobaron por rol en Postgres local;
la comprobación visual fue sintética, no una sesión autenticada contra producción.

## Archivos por responsabilidad

- Modelo y resolución: `lib/reservation-times.ts`, `lib/clock-time.ts`, `lib/gpt-api/turnovers.ts`.
- Escrituras: `lib/reservation-time-writes.ts`, `actions/reservation-times.ts`, `actions/tasks.ts`,
  `supabase/migrations/20261030131630_reservation_times.sql`.
- Importación: `lib/gmail-times.ts`, `lib/gmail-sync.ts`, `app/api/gmail-sync/route.ts`.
- Lecturas y presentación: `actions/dashboard.ts`, `app/(app)/page.tsx`,
  `components/dashboard/ReservationTimePanel.tsx`, `CheckoutCard.tsx`, `DashboardPrepCard.tsx`,
  `components/cleaning/CleaningView.tsx`, `components/tasks/PrepTaskCard.tsx`.
- MCP: `lib/gpt-api/service.ts`, `lib/gpt-api/validate.ts`, `lib/mcp/tools.ts`, `lib/mcp/instructions.ts`.
- Pruebas: `__tests__/helpers/fake-db.ts`, `__tests__/helpers/timing.ts`, las nuevas pruebas de
  horarios en `__tests__/actions`, `__tests__/components`, `__tests__/lib`, la adaptación de
  `__tests__/lib/gpt-api/turnovers.test.ts`, `scripts/test-reservation-times*.sql`,
  `scripts/test-reservation-times-concurrency.sh`, `scripts/test-migrations.sh`.
- Entorno de validación: `vitest.config.ts`, `eslint.config.mjs`; vista previa de Vercel habilitada
  con su configuración predeterminada en `vercel.json`.

## Revisión contra AGENTS.md después del PR #18

- Se incorporó `origin/main` en `codex/horarios-reserva` y se releyeron `AGENTS.md` y `docs/codex.md`.
- Se conserva el centro de servicio en `lib/gpt-api/service.ts` y los nombres de herramientas MCP;
  los esquemas e instrucciones explican ETA frente a autorización. No se agregan herramientas.
- Se conserva la salida estándar 11:00, America/Bogota, separación de montos, estados e historial
  de cobros/solicitudes, y cancelación sin borrar la reserva. Las notas de reserva no se sustituyen.
- La única sustitución de prefijos de tareas es la proyección compatible `HH:MM|nota`: conserva
  la nota de preparación, registra el hecho y requiere un administrador para autorizar una hora.
- La migración incluye recuperación y se prueba exclusivamente con `bash scripts/test-migrations.sh`
  en una base temporal de Postgres local. No se aplicó en Supabase.
- Se mantienen las pruebas con `fake-db`, SQL sintético, reintentos, concurrencia, permisos,
  cancelación, cambios de estancia y zona horaria. Los resultados de la nueva ejecución se
  registran en el PR; no se da por verificado el funcionamiento autenticado de la vista previa.
- Se corrigió la prueba de reintento del panel para esperar a que el botón vuelva a estar habilitado
  antes del segundo clic. No se ampliaron timeouts ni se modificó la lógica de horarios de la app.
- GitHub usa `info-softop`; los cambios personales previos permanecen fuera del PR. Se habilitó la vista previa
  solicitada; no autoriza merge ni migración.

## Revalidación después de incorporar el PR #18

| Control | Resultado real de esta revisión |
|---|---|
| `git pull origin main` en `codex/horarios-reserva` | Incorporó `d3e0dd5` (PR #18) sin conflictos; se releyeron las instrucciones completas |
| `npx vitest run --maxWorkers=1 --bail=1` | 411 pruebas correctas, 1 opcional omitida; 39 archivos correctos y 1 opcional omitido |
| `npx tsc --noEmit -p .` después del build | Correcto, sin errores |
| `npx eslint` | 0 errores y los mismos 6 avisos previos de `__tests__/lib/types.test.ts` |
| Build con URL `https://example.invalid` y clave ficticia `dummy` | Correcto; generó las 28 páginas |
| `bash scripts/test-migrations.sh` | Correcto; solo base temporal de Postgres local, incluidos permisos y concurrencia real |
| Pruebas focalizadas de navegación y panel | 3/3 en cada archivo |
| Vista previa | Vercel marcó `f78af7c` como `SUCCESS` y su comentario automático indicó `Ready` |
| Diff | Revisado; comprobación de espacios correcta |

En el primer intento paralelo, Vitest terminó con 410 pruebas correctas, un timeout de 5 segundos
en `BottomNav` y una prueba opcional omitida. Tipos coincidió con la regeneración de `.next/types`
del build y encontró archivos transitorios ausentes; lint se interrumpió para reducir la carga.
Se pasó a controles secuenciales. Durante la revisión de la prueba de reintentos del panel se
agregó la espera al botón habilitado antes del segundo clic. La ejecución final completa pasó
con los límites originales de tiempo; no se cambiaron la lógica de la app ni los timeouts.

La prueba opcional omitida es la integración HTTP/Postgres de disponibilidad de Casa Blue,
que requiere activación explícita. En esta revisión la migración se probó únicamente con el
script SQL local solicitado; la ejecución inicial anterior del caso HTTP figura por separado.

No apliqué `20261030131630_reservation_times.sql` en Supabase ni consulté su historial remoto.
La vista previa no verifica la migración, el RPC por PostgREST, las sesiones autenticadas ni las
escrituras reales de horarios. El conector de Vercel respondió 403 para este equipo; el estado
`Ready` y la URL se comprobaron mediante las publicaciones automáticas de Vercel en GitHub.
