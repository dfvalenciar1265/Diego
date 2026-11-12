# Operación integral: entrega local, sin publicación

- Los avisos al edificio de PR #28 se reutilizan; no hay un segundo registro de envíos.
- Avisos temporales: registro interno de texto, apartamento, ubicaciones y último día vigente. Al día siguiente muestra revisión pendiente en Inicio; no se elimina automáticamente ni se da por reabierto un servicio. Retiro exige evidencia de todas las ubicaciones. No se modifica Airbnb.
- No se ejecutan mensajes externos ni se configuran cron/proveedores. La planificación de reservas directas queda en modo revisión.
- Migraciones nuevas solo para prueba local; no ejecutar `db push` contra producción. Antes de publicar: pruebas unitarias, tipos, lint, build, SQL con permisos/concurrencia y revisión móvil, más aprobación explícita de migraciones y despliegue.
- Recuperación no destructiva: retirar la UI de esta versión, conservar tablas e historial, no borrar registros ni revertir datos operativos.

## Entrega incluida

- Inicio presenta siguiente acción, equipo capaz de resolver y confirmaciones reales. No inventa responsable asignado ni marca listo por inferencia.
- Horarios separan llegada estimada, horario habitual y excepción autorizada. No convierten una ETA en permiso.
- Checklist por llegada con cinco puntos, notas, autor/fecha, control de versión y fotos privadas. Un problema genera/reutiliza una incidencia correctiva; marcar revisado no la resuelve ni confirma preparación. Ver `checklist-llegadas.md`.
- Reservas directas: cuatro etapas persistidas en borrador, trazabilidad y revisión al cambiar la reserva. Sin contactos, textos o tiempos inventados y sin entrega automática. Ver `mensajes-directos.md`.

## Validación y límites

Pruebas locales con datos sintéticos; no se ha accedido a producción ni cargado fotos de huéspedes. Las políticas Storage se prueban con una interfaz SQL local mínima; falta ensayo integrado del almacenamiento privado real. Falta revisión visual autenticada completa y decisión de publicación. Los nuevos módulos requieren sus migraciones antes de habilitar su interfaz en producción. Los borradores no acreditan envío, entrega ni lectura.
