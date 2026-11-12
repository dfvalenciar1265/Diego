# Operación simple: revisión del 12 de noviembre

Rama de trabajo aislada de la versión ya publicada. No modifica ni completa datos operativos existentes.

- Horario principal muestra la hora comunicada del huésped si existe; el modelo conserva ETA y autorización separados. El editor guarda primero la hora avisada. Los conflictos de llegada temprana/salida tardía siguen visibles; no se autoriza una excepción por cambiar la presentación.
- Avisar edificio: gris hasta constar un hecho vigente acreditado, verde con la fecha y hora del hecho. Las observaciones registradas por un asistente se tratan igual que las humanas. No se consideran enviados borradores, resultados inciertos, marcas heredadas sin evidencia ni avisos que requieren revisión. Lecturas fallidas no conservan un verde obsoleto. El historial se conserva en datos y se retira del panel principal.
- Las incidencias muestran lo registrado. No se deducen cantidades ni se inventan compras a partir de un mensaje vago.
- Revisión opcional de salida: administración selecciona explícitamente un correctivo y escribe la comprobación. No se extraen automáticamente notas antiguas. Omitir corresponde a una salida específica y no resuelve el correctivo.
- Reservas directas: sin enlace permanente en Inicio; aviso contextual de las llegadas de mañana, calculado en Colombia. El teléfono es opcional, privado para administración y separado de las reservas de lectura general. Guardarlo no verifica titularidad ni activa un canal de mensajes.

Dos migraciones aditivas de esta revisión requieren validación antes de publicarse. No se realizan backfills, envíos externos, cambios de tarifas ni cambios de reservas durante QA. Las pruebas se ejecutan exclusivamente sobre fixtures sintéticos y Supabase local.
