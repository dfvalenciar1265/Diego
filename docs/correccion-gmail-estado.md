# Corrección de la continuación y del estado de Gmail

31 de octubre de 2026. Cambio propuesto; la nueva migración no está aplicada en producción.

## Diagnóstico comprobado

Las capturas de las 7:00 de Colombia muestran una lectura parcial de un año de correos, no un fallo confirmado de conexión. El botón manual pedía 365 días por defecto. El importador limita cada ejecución a tres páginas y persiste el cursor; la interfaz trataba esa pausa como un error rojo.

La consulta de producción, de solo lectura, confirmó que el cron de las 7:15 terminó ese alcance (`scan_complete=true`, sin `error_code`). Los pendientes pasaron de 108 a 150 mientras avanzaba la revisión histórica. Son recibos de correos con discrepancias o errores para revisar, no un conteo de reservas faltantes. Persistían cuatro grupos de tareas duplicadas. No se revisaron sus contenidos ni se resolvieron automáticamente.

Además, `gmail_sync_begin` buscaba cualquier corrida incompleta: podía retomar un ancestro aunque una continuación posterior ya hubiera terminado la lectura. La nueva función consulta primero la última corrida de la conexión.

## Criterios de aceptación

- El botón normal y el cron usan un alcance incremental; revisar un número concreto de días requiere un parámetro explícito. Una conexión nueva conserva el bootstrap de siete días.
- Una cadena sin terminar conserva alcance, raíz, padre y cursor. Una cadena terminada no revive un cursor de su ancestro. Los reintentos y el bloqueo entre trabajadores se conservan.
- La paginación muestra «Por continuar». Una lectura terminada con discrepancias muestra «Por revisar». Los fallos técnicos siguen siendo errores. Ningún parcial recibe la marca verde de éxito.
- El calendario enlaza a conciliación sin poner mensajes largos dentro del encabezado móvil. Los pendientes, los alcances y las tareas repetidas permanecen visibles.
- Iniciar una corrida no modifica reservas ni tareas. Se mantienen los permisos existentes; no se amplía el acceso.

## Archivos

- `lib/gmail-reconciliation/{runner,types,presentation}.ts`: alcance incremental y resultado común para la API y las pantallas.
- `app/api/gmail-sync/route.ts`: diferencia entre omitir `days` y pedir historial explícitamente; conserva los estados HTTP.
- `components/calendar/GmailSyncButton.tsx`, `components/settings/Gmail{Reconciliation,SettingsClient}.tsx`: avisos y presentación móvil.
- `supabase/migrations/20261031120552_gmail_sync_continuation.sql`: reemplaza únicamente `gmail_sync_begin`, sin backfill ni borrados. Incluye recuperación.
- Pruebas en `__tests__/components/GmailReconciliation.test.tsx`, `__tests__/lib/gmail-{access,reconciliation,presentation}.test.ts`, `scripts/test-gmail-continuation.sql` y `scripts/test-migrations.sh`.

## Verificación realizada

- `npx vitest run`: 542 pruebas aprobadas y una omitida. La omitida es la prueba HTTP opcional de disponibilidad con Postgres; no forma parte de esta corrección.
- `npx tsc --noEmit -p .`: sin errores.
- `npx eslint`: cero errores y los seis avisos anteriores de tipos no utilizados.
- Build con URL y clave ficticias: correcto.
- `bash scripts/test-migrations.sh`: correcto en Postgres local temporal, incluidos los dos trabajadores concurrentes, permisos, duplicados, reintentos, conservación de datos y continuación sin ancestros obsoletos. La suite existente de fechas, cancelaciones y horarios también pasó.
- Revisión del diff y `git diff --check`: correctas. Se conservan fuera del cambio las modificaciones personales del árbol de trabajo.
- Componentes reales en una vista local aislada, acciones simuladas y datos sintéticos: móvil de 393 y 320 píxeles y escritorio de 1120. Sin desbordamiento horizontal; encabezado de 57 píxeles. Se verificaron continuación, revisión y fallo técnico.

## Límites y pendientes

No se ejecutó el nuevo importador contra Gmail real ni se aplicó la migración en Supabase. No se verificó el cambio publicado, ni en un iPhone físico. No se enviaron correos de prueba, no se modificaron reservas o tareas reales y no se marcaron pendientes como revisados. Las observaciones de producción corresponden a los horarios indicados; el cron autorizado continúa independientemente.

El cambio conserva la continuación histórica en curso: hasta terminarla no abre un alcance más reciente. La demora seguirá visible cuando corresponda. Los 150 pendientes y cuatro grupos de tareas requieren una revisión aparte con evidencia; esta corrección no los descarta ni decide qué dato operativo debe ganar.

## Despliegue, solo después del sí de Diego

1. Confirmar el historial de migraciones aplicado. Las versiones históricas remotas difieren de algunos nombres del repositorio: no ejecutar un `db push` indiscriminado.
2. Aplicar únicamente `20261031120552_gmail_sync_continuation.sql` en Supabase antes de publicar el código que envía `p_days=null`.
3. Mergear el PR aprobado y comprobar que el despliegue automático de Vercel termine correctamente. La vista previa del PR no demuestra la aplicación de la migración.
4. Verificar mediante lecturas que las siguientes ejecuciones automáticas avanzan el alcance tras completar la cadena y que no reviven su cursor ancestral; comprobar los avisos y los permisos en móvil. Conservar los pendientes para revisión, sin forzar una importación manual real como prueba.
5. Para recuperación, seguir el encabezado de la migración y revertir el código con aprobación. No reaplicar migraciones antiguas completas ni eliminar historial, recibos, pendientes o reservas.
