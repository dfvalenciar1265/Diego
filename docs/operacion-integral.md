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

## Prepublicación pendiente comprobada

El 12-11-2026 se comprobó que no existe una rama de desarrollo de Supabase para AirAdmin. Ni el Mac ni la computadora cloud cuentan con Docker/Podman o stack Supabase local. No se debe conectar esta versión a datos de producción para simular pruebas.

Camino de publicación:
1. Preparar Auth/DB/Storage aislados (stack local o rama de desarrollo con costo autorizado si corresponde), sin copiar huéspedes reales.
2. Aplicar base y las cuatro migraciones nuevas; crear miembros y reservas sintéticos con roles admin, limpieza y tercero sin acceso.
3. Probar inicio de sesión real, guardado/relectura, foto JPG/PNG/WebP privada hasta 5 MB, rechazo de formatos/tamaño, URL firmada con vencimiento, denegación anónima y de usuarios inactivos, cambios/cancelaciones y dobles guardados.
4. Revisar móvil/escritorio autenticados; confirmar que borradores no disparan mensajes y que cron/proveedores no se conectan al entorno de prueba.
5. Comparar migraciones reales con repositorio y garantizar copia/recuperación no destructiva. Publicar migraciones antes de interfaz, hacer smoke test por roles y conservar historial ante rollback.

No se ha creado una rama facturable ni se ha publicado esta versión. Los permisos para trabajar en mejoras no sustituyen aceptación de costos adicionales ni resolver las comprobaciones pendientes.

QA visual adicional: harness local con componentes reales, datos sintéticos y acciones bloqueadas; Chromium headless a 390×844 y 1440×1000. Sin errores JS ni desbordamiento horizontal en estados cerrados/desplegados. Se corrigieron el enlace al checklist en Inicio y los saltos de línea del placeholder. No sustituye prueba E2E con Auth/Storage reales.


## Avance de validación real y publicación

Docker oficial ya instalado con modalidad gratuita confirmada. Supabase local real con puertos127.0.0.1 ejecutó pruebas Auth/Storage y E2E con datos sintéticos; detalles en `e2e-operacion-local.md` y `checklist-llegadas.md`. El bloqueo de infraestructura inicial quedó resuelto. Diego autorizó publicar tras verificación. No se activarán envíos externos automáticos.

El historial de migraciones remoto tiene versiones distintas al repositorio para funcionalidades antiguas. No utilizar `db push` indiscriminado: comparar esquema y aplicar exclusivamente cuatro migraciones nuevas. Rollback de aplicación conservando tablas/historial/bucket; la función original de avisos se conserva como `manage_without_observations`. La observación histórica no cambia ni falsifica las fechas de avisos preparados.

Preflight remoto12-nov-2026 (solo lectura antes de publicación): dependencias, constraints, firmas de funciones y grants Storage compatibles; tablas nuevas y bucket no existentes. Advisories previos de vista SECURITY DEFINER `article_feedback_summary`, funciones y configuración se mantienen fuera de alcance, no son correcciones incluidas. Riesgos de deadlock se gestionan como error transaccional/relectura, nunca sobrescritura forzada. Capturar despliegue anterior como punto de retorno antes de publicación.
