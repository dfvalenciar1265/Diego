# Conciliación de Gmail y sincronización frecuente

PR apilado sobre `codex/horarios-reserva` (PR #19). No mergear ni aplicar migraciones sin
aprobación de Diego. La vista previa está autorizada; no se ejecutan sincronizaciones reales.

## Criterios de aceptación

- Programar Gmail cada 15 minutos en Vercel Pro. Mostrar por separado conexión, último intento,
  última lectura completa, alcance, correo por leer, conflictos, errores y cancelaciones explícitas.
- Una corrida incompleta o sin correo nuevo no significa «todo al día». Una reserva ausente
  de una consulta nunca se cancela. Solo una notificación explícita con código confirma cancelación.
- Exclusión entre cron y botón manual, con caducidad y comprobación del propietario de la corrida
  en cada escritura. Un trabajador vencido no escribe después de que otro haya tomado el turno.
- Gmail no sustituye cambios manuales posteriores, ni mueve fechas o dinero existentes por una
  discrepancia. Las contradicciones se conservan para revisión, ligadas al mensaje y a la reserva.
  El estado anterior a la migración queda protegido desde un corte inicial conservador: los correos
  históricos que pretendan alterarlo requieren revisión; no se inventa la fecha del ajuste anterior.
- La misma notificación no duplica reservas, tareas ni efectos. La cancelación conserva la reserva.
- Errores HTTP, páginas incompletas o fallos SQL quedan registrados y no certifican una importación
  correcta. Las lecturas largas continúan mediante un cursor de paginación (no es credencial).
- Guardar solo datos estructurados necesarios para conciliación, nunca cuerpos de correos,
  credenciales, cabeceras de autenticación ni errores crudos del proveedor.
- Los pendientes pueden revisarse con constancia de quién/cuándo/por qué, sin cambiar la reserva.
- Solo administradores activos disparan la importación o revisan pendientes. El cron exige secreto
  no vacío; el botón llama al mismo servicio del servidor, sin reenviar secretos a otra URL.
- Pruebas sintéticas con `fake-db` y SQL local: duplicados, reintentos, trabajadores simultáneos y
  vencidos, permisos, cambios de fecha/manuales, cancelación y medianoche en America/Bogota.

## Despliegue y recuperación (pendientes de aprobación)

1. Revisar y aprobar primero el PR #19 y su migración; este PR depende de esa base.
2. Antes de la nueva migración, comprobar que no haya tareas duplicadas por reserva/tipo y que
   no siga ejecutándose una sincronización de la versión anterior. No borrar datos para forzarla.
3. Aplicar solo la nueva migración aprobada. No repetir migraciones ya aplicadas.
4. Autorizar merge/despliegue. El cron frecuente se activa en producción al desplegar el `vercel.json`.
5. Comprobar alcance, permisos, última lectura y pendientes. Las pruebas reales de escritura
   requieren autorización explícita; la vista previa no equivale a esta validación.
6. Recuperación: desactivar el cron frecuente y volver a la versión anterior de la app con aprobación;
   conservar las tablas e historial. No borrar pendientes ni retirar restricciones destructivamente.

## Entrada inmediata y doble comprobación

Diego quiere que cada reserva, modificación o cancelación entre apenas llegue su correo, y que
exista otra comprobación de que AirAdmin la registró. La propuesta para la siguiente entrega es:

1. Gmail envía una notificación mediante `watch` y Google Cloud Pub/Sub; el servidor lee el cambio
   y lo entrega al mismo importador. La notificación solo indica que hay cambios, no contiene la reserva.
2. El cron cada 15 minutos funciona como respaldo y recupera huecos o notificaciones perdidas.
3. Matías/Dot puede vigilar discrepancias o importaciones demoradas. Debe consultar los recibos del
   importador y no crear otra reserva por su cuenta. Dos lectores de Gmail comparten la misma fuente;
   una comprobación independiente de Airbnb requeriría contrastar el dato con Airbnb/iCal.

**Esta entrega implementa la conciliación y el respaldo periódico.** No implementa todavía `watch`,
Pub/Sub, un receptor de notificaciones, el monitor de Matías ni mensajes automáticos. No se ha
registrado ninguna suscripción ni activado una automatización externa. La programación de 15 minutos
es la propuesta que queda en el PR; producción conserva su programación anterior hasta aprobación.

Referencia de la propuesta: [notificaciones de Gmail](https://developers.google.com/workspace/gmail/api/guides/push).
Google requiere renovar `watch` y recomienda hacerlo diariamente. También advierte que pueden
perderse o demorarse notificaciones; por eso se conserva la comprobación periódica.

## Archivos y verificación del 30-oct-2026

- Importación común y estado: `lib/gmail-reconciliation/{runner,status,types,config}.ts`.
- Lectura Gmail paginada: `lib/gmail-sync.ts`; entrada cron: `app/api/gmail-sync/route.ts`;
  botones y permisos: `actions/gmail.ts`.
- Presentación: `components/settings/GmailReconciliation.tsx`, `GmailSettingsClient.tsx` y
  `components/calendar/GmailSyncButton.tsx`.
- Persistencia: `supabase/migrations/20261030153122_gmail_reconciliation.sql`.
- Pruebas: `__tests__/lib/gmail-reconciliation.test.ts`, `gmail-access.test.ts`,
  `__tests__/components/GmailReconciliation.test.tsx`, `__tests__/helpers/fake-db.ts`,
  `scripts/test-gmail-reconciliation.sql` y `scripts/test-gmail-concurrency.sh`.
- Frecuencia: `vercel.json`, sin ningún bloqueo `git.deploymentEnabled`.

| Comprobación | Resultado real |
|---|---|
| Vitest completo con integración HTTP/Postgres local habilitada | 446 correctas en 43 archivos, sin omisiones |
| Tipos: `npx tsc --noEmit -p .` | Correcto |
| Lint: `npx eslint` | 0 errores; los 6 avisos previos de `__tests__/lib/types.test.ts` |
| Build con URL `https://example.invalid` y clave `dummy` | Correcto, 28 páginas |
| `bash scripts/test-migrations.sh` | Correcto, solo Postgres local temporal |
| SQL con dos conexiones Gmail simultáneas | Una admitida y otra ocupada; un solo trabajador |
| Revisión visual | Componente real en una vista local con datos sintéticos y acciones simuladas |
| Acceso Vercel | Lectura del equipo autorizada y correcta; no se verificó la facturación |
| Diff | Revisado, sin errores de espacios |

La suite completa se ejecutó con `CASA_BLUE_LOCAL_POSTGRES_TEST=1 CASA_BLUE_LOCAL_POSTGRES_RUNNER=psql npx vitest run --maxWorkers=1`.
Los tipos detectaron inicialmente un error de tipado del fixture nuevo; se corrigió antes del cierre.
La vista aislada necesitó corregir sus alias de React; no cambió la configuración de la app.

No se probaron Gmail real, los RPC por PostgREST/Supabase, el cron en producción, cuotas/latencia
reales, ni una sesión autenticada de la app contra las tablas nuevas. No se verificó en producción
si hay tareas duplicadas que bloquearían el índice único: el paso previo al despliegue debe comprobarlo.
Las dos migraciones nuevas están pendientes: **no se aplicó ninguna en Supabase**. No hubo merge,
despliegue de producción, sincronización real ni mensajes al equipo o a huéspedes.
