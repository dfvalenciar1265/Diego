# Planificación de mensajes de reservas directas

Ruta administrativa `/direct-messages`. No envía mensajes, no instala cron, no tiene proveedor ni registra entregas. La programación es una fecha/hora propuesta de un borrador, no una promesa de envío automático. Confirmación, registro, llegada y salida tienen identidad única por reserva/etapa.

- Solo administradores activos pueden leer o guardar. RLS bloquea personal de limpieza; escrituras pasan por RPC con identidad comprobada, versión esperada e idempotencia por actor/clave.
- Canal empieza pendiente; contacto y texto vacíos. No se deducen contactos ni se inventan plantillas aprobadas. Cada apartamento requiere revisión humana del contenido. Guardar no valida un contacto ni autoriza transmitirlo.
- Hora explícita de Colombia; sugerencias son fechas de revisión, nunca autorización de entrada/salida. Confirmación no inventa una hora. Fechas pasadas no causan envíos retroactivos.
- Solo reservas directas confirmadas y completas; bloqueos no cuentan. Cambios de fechas, apartamento, huéspedes, titular, origen o estado invalidan el borrador, conservan su snapshot e historial; cancelar lo cancela. Restaurar valores antiguos no revalida automáticamente.
- Reserva bloqueada durante guardado y versión esperada evitan sobrescrituras. Un reintento idéntico no crea otra etapa. Si la reserva o el borrador cambió, exige revisar. Relectura de identidad y versión antes de confirmar guardado.
- Lectura de máximo 200 reservas futuras/vigentes falla explícitamente si el conjunto excede límite: no se presenta cobertura parcial como completa.

## Validación local

`npx vitest run __tests__/lib/direct-messages/plans.test.ts __tests__/components/DirectMessagePlanner.test.tsx --maxWorkers=1` (12 pruebas).

`npx tsc --noEmit` y ESLint focal sin errores. SQL de datos sintéticos en `scripts/test-direct-message-drafts.sql`, incluido por el coordinador en el runner local. La migración no se aplicó a producción. No afirmar que una migración escrita equivale a persistencia desplegada.

## Antes de habilitar envíos reales

Acordar proveedor/canal, destinatarios verificados y consentimiento, plantillas por apartamento, horarios y autorización de envío; diseñar cola, cancelación, revisiones, idempotencia en proveedor y recibos. Esta versión no implementa ninguno de esos envíos. No desplegar como sistema de mensajes automático.
