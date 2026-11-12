# Comprobaciones opcionales de salida

Cambio local aditivo: `20261112112942_checkout_optional_checks.sql`. No backfill, no clasificación por palabras clave, no importación de notas, no avisos externos.

Un administrador entra desde Mantenimiento en `/maintenance/checkout-checks`, selecciona un correctivo abierto existente y escribe una instrucción concreta. Por ejemplo «Contar los platos disponibles»; no se infieren cantidades. Los preventivos y resueltos no son elegibles. Solo los avisos seleccionados aparecen en la salida del mismo apartamento.

Limpieza, anfitrión o administrador pueden omitir el aviso solo en la fecha de salida confirmada, indicando motivo. Se guarda actor, fecha del servidor y snapshots de estancia/fuente. La omisión limpia la tarjeta de esa salida, no resuelve mantenimiento, no confirma inventario ni completa tareas. Otra estancia o cambio de fechas/fuente no hereda la omisión.

La fuente conserva campos seguros y un fingerprint de descripción/notas, sin exponer esos textos ni costos al formulario. Cambio de contenido pide revisar el aviso; no inventa otra instrucción. Reporte resuelto no se muestra. Las operaciones tienen clave idempotente, bloqueo de fuente/reserva y relectura. Las tablas son solo lectura para equipo activo; RPC verifica roles. Un fallo de lectura se informa sin bloquear limpieza. No se muestra una tarjeta vacía ni loading permanente.

Pruebas locales: SQL `scripts/test-checkout-checks.sql`, modelo/UI `checkout-checks.test.ts` y `CheckoutOptionalChecks.test.tsx`, E2E `checkout-checks.spec.ts` con Supabase/Auth reales locales. Migración aplicada exclusivamente al stack local. Recuperación: retirar UI conservando tablas y trazabilidad; no borrar historial ni alterar incidencias.

Límite: primer corte no ofrece editar o retirar selección manual; si el reporte cambia se indica revisión pendiente. Puede seleccionarse explícitamente una comprobación nueva a partir del estado actual: la selección más reciente del reporte sustituye visualmente a la anterior, conservando ambas como historial. No hay resolución automática ni comunicación con huéspedes.
