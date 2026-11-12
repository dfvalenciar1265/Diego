# Directas: aviso contextual y contacto privado

Cambios preparados en rama, migración únicamente aplicada al stack local sintético. No despliegue ni migración de producción por este trabajo.

Inicio no conserva enlace permanente a mensajes directos. Solo administración ve un aviso cuando hay reservas directas confirmadas que entran mañana calendario en America/Bogota. Excluye hoy, fechas posteriores, canceladas, bloqueos y Airbnb. El corte nocturno del panel no desplaza este cálculo otro día. La página de mensajes acepta fecha del aviso y filtra las llegadas.

Crear/editar directa permite teléfono opcional con prefijo internacional explícito. No se infiere país. Se guarda separado en direct_reservation_contacts: administración activa únicamente, RLS y sin DML directo. No se añade a notes ni a las consultas generales de reservas. El campo nunca verifica por sí mismo el destinatario, ni copia automáticamente el número a borradores, ni autoriza envíos. No hay proveedor ni automatización de envío.

Cada guardado usa versión esperada y clave de reintento; historial privado conserva cambios. Borrar el valor es una actualización auditada, no borrado físico. Relectura compara teléfono, versión, actor y fecha. El componente está asociado a la reserva cargada y no reutiliza un teléfono al cambiar de reserva. Una reserva guardada cuyo contacto falla se comunica como éxito parcial, con ID y aviso persistente; no deja repetir Crear/Guardar desde el mismo formulario, sino cerrar y editar la reserva existente.

El service_role no tiene SELECT ni EXECUTE del contacto: es intencional. El asistente MCP no dispone de esta ruta aún. La ampliación de acceso requiere revisión separada. Usuarios limpieza, mantenimiento y anfitrión no ven el teléfono ni pueden usar el RPC.

Pruebas: unidad cálculo de mañana y validación/relectura, regresiones de reservas, scripts/test-direct-contact-local.mjs con dos sesiones concurrentes (un éxito y un conflicto), RLS/DML/replay/borrado lógico y reserva original intacta. e2e-operation/direct-contact.spec.ts verifica formulario real crear/editar y privacidad. Caso adicional de conflicto parcial queda incluido en corrida final del coordinador.
