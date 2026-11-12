# Notas preventivas y reportes correctivos vinculados

## Separación de conceptos

Las notas existentes de un preventivo no prueban avería ni revisión pendiente actual. No se extraen ni convierten automáticamente. La fecha del próximo mantenimiento y la última ejecución siguen perteneciendo al preventivo y no cambian al revisar una nota.

La nueva ruta administrativa permite leer el contexto y decidir explícitamente: crear un reporte por comprobar, vincular un correctivo activo existente del mismo apartamento, o documentar por qué no requiere acción. Exige referencia de fuente, motivo, confirmación humana y una copia exacta de los datos revisados para rechazar cambios concurrentes. No es un diagnóstico ni una reparación.

El vínculo se conserva separadamente de la auditoría. Preparación puede mostrar equipo y reporte por comprobar sin recibir costos ni el texto íntegro de notas privadas. El correctivo conserva su propia resolución; no resuelve ni reprograma el preventivo. Las notas nuevas requieren otra revisión explícita; reintentos y referencias repetidas no crean duplicados.

## Publicación y datos

Implementación en rama aislada. La migración de este módulo NO está aplicada a producción. Ningún registro real se ha convertido ni modificado. Los tres aires de Palmetto se mantienen como estaban; solo se probará un caso equivalente sintético. La publicación GitHub pública continúa pendiente, sin nuevas solicitudes ni reintentos.

## Verificación

Verificado con fixtures sintéticos: runner SQL completo, snapshots/duplicados/roles y conservación exacta del preventivo; siete E2E con Auth/Storage locales reales pasan, incluyendo revisión manual, relectura y reporte vinculado visible en preparación. No declarar el caso resuelto en producción solo por existir código o tablas de otros módulos.

Concurrencia real local verificada: dos solicitudes simultáneas de creación para el mismo preventivo con referencias diferentes producen un éxito y un conflicto, un solo correctivo y una revisión; el padre completo sigue idéntico. Script reproducible `scripts/test-preventive-concurrency-local.mjs`, limitado a loopback y sin imprimir credenciales.
