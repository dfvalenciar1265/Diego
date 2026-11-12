# Checklist físico de llegadas (cambio local, sin desplegar)

`/inspections` lista las llegadas confirmadas de hoy y mañana en Colombia. Desde Preparación se abre cada reserva. Cinco puntos: aires/controles, luces, agua, ropa de cama/toallas y utensilios. Cada registro exige una acción explícita y conserva autor autenticado, fecha del servidor, observación, versión y evidencia privada opcional. Problema y «no aplica» requieren justificación. Nunca marca automáticamente limpieza, funcionamiento o «Listo».

Una incidencia crea un correctivo de Mantenimiento, no un preventivo programado, y queda visible en la preparación de próximas llegadas mediante el flujo existente de incidencias abiertas. Repetir el mismo punto reutiliza su incidencia aún abierta. Marcar revisado no resuelve mantenimiento. Aires/agua/luces se priorizan como urgentes; ropa/utensilios normales. Las fotografías no se copian a `photo_url` público: quedan en `inspection-evidence`, bucket privado, con enlaces temporales de dos minutos, accesibles solo al equipo activo. No fotografiar personas, documentos ni claves.

Solo se registra la víspera o el día de llegada, con reserva confirmada y sin otra estancia vigente. Una ETA no habilita esta función ni autoriza ingreso anticipado. Cambiar propiedad, fechas o estado invalida la revisión; otra ocupación intermedia también. El historial se conserva. La interfaz comprueba nuevamente cada escritura. Claves idempotentes y versiones previenen repetición/sobrescritura. Un fallo de carga no registra la revisión. Una foto subida antes de un fallo posterior puede quedar huérfana privada: no se elimina automáticamente ni se afirma que el punto quedó guardado.

## Instalación y comprobación

Pendiente aprobación de despliegue y ejecución real de migración `20261112023000_arrival_inspections.sql`. Requiere esquema Storage real y migraciones de preparación previas. No ejecutar el stub en Supabase: `scripts/test-inspection-storage-before.sql` es exclusivamente para la base efímera local del runner. Pruebas SQL: `scripts/test-arrival-inspection.sql`. Pruebas UI/modelo: `__tests__/components/InspectionChecklistPanel.test.tsx`, `__tests__/lib/inspection.test.ts`.

Antes de producción: prueba con cuenta limpieza y cuenta inactiva, dos sesiones concurrentes, imagen real desde móvil, confirmar relectura y URL expirada, validar invalidación/visibilidad de incidencia en próxima llegada. No se han subido imágenes ni escrito datos reales durante implementación.

El formulario admite JPEG/PNG/WebP de hasta 5 MB, verifica firma de bytes, no acepta SVG. Los bytes no se transforman: pueden contener metadatos EXIF y siguen siendo privados. Recuperación segura: retirar ruta/acciones sin borrar historial, incidencias ni bucket. Este módulo no programa mensajes ni modifica reservas.

Las escrituras bloquean las reservas del apartamento y usan comparación de versión. Una edición simultánea que tome filas en distinto orden puede provocar un deadlock PostgreSQL: la transacción se revierte íntegra y se debe releer/reintentar, nunca forzar sobrescritura. No se afirma ausencia de conflictos entre todos los escritores existentes.

## Verificación ejecutada: Storage/Auth local real

12-nov-2026: `scripts/test-inspection-storage-local.mjs` pasó contra Supabase local en 127.0.0.1:54321, sin stubs Auth/Storage. Se crearon solo usuarios/propiedad/reserva sintéticos. PNG de un píxel: carga y descarga con limpieza activa; lectura pública/anon/inactiva y escritura en carpeta ajena denegadas; tamaño superior a 5 MB y MIME SVG rechazados; RPC conserva foto privada y actor y se relee; URL firmada accesible antes de caducidad y denegada a +4s con TTL2s. Ningún secreto se imprime. El script valida host/puerto local antes de crear fixtures; los conserva en stack aislado.

Ejecutar con `AIRADMIN_LOCAL_STATUS_LOG` apuntando al archivo privado de estado del stack (última línea JSON de Supabase). Esta prueba cubre API real de Storage y RPC, no por sí sola el formulario móvil o firma de bytes de la server action. No equivale a despliegue ni prueba en producción.
