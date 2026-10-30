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

## Despliegue pendiente de aprobación

1. Revisar el PR y aprobar por separado migración y despliegue; no ejecutar desde este trabajo.
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

Esta rama tiene la vista previa automática desactivada mediante `git.deploymentEnabled` en
`vercel.json`, según la [documentación de Vercel](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).
La regla solo afecta `codex/horarios-reserva`; cualquier despliegue requiere aprobación.

Quedan para las siguientes fases, en orden: conciliación de sincronización; etapas de
preparación con incidencias; huéspedes reservados/acordados y cobros; inventario vendible.

## Validación local del 30-oct-2026

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
remotos ni se hicieron despliegues. Los permisos SQL se comprobaron por rol en Postgres local;
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
- Entorno de validación: `vitest.config.ts`, `eslint.config.mjs`; protección de esta rama: `vercel.json`.
