# Avisos a edificios

El administrador prepara un mensaje mínimo para una llegada y lo envía manualmente en
WhatsApp o correo. Abrir esa aplicación **no registra un envío**. AirAdmin conserva después
la comprobación humana, separando envío, entrega y recepción.

## Criterios de aceptación

- Consultar por día de Colombia, reserva o UUID estable del apartamento; mostrar titular,
  huéspedes, fechas, destinatario/canal, borrador, estados e historial.
- Previsualizar sin persistencia; preparar solo con reserva confirmada, datos completos y
  contacto comprobado expresamente por un administrador activo.
- Separar preparado, resultado incierto, envío registrado, entrega acreditada y recepción
  confirmada. Los tres últimos requieren evidencia específica y fecha real con zona horaria.
- No ofrecer otro enlace de envío cuando el resultado es incierto o ya está registrado.
- Conservar marcas antiguas como antecedentes sin evidencia, sin borrarlas ni convertirlas
  en confirmaciones. Otra versión tras un antecedente exige explicación de revisión.
- Detectar cambios de titular, huéspedes, estancia, apartamento o cancelación; conservar el
  contenido anterior y sus pruebas. Una vuelta a los datos anteriores tampoco borra la revisión.
- No duplicar contenido por reserva/destinatario; reintentar el mismo payload con la misma
  clave; devolver conflicto al usar una versión antigua o cambiar el payload de esa clave.
- Ningún rol distinto de administrador activo puede consultar estos registros ni escribirlos.
  No hay envío automático, nuevos permisos OAuth ni acceso público a datos de huéspedes.

## Uso en Inicio

En la llegada, abrir **Aviso al edificio** y elegir el destinatario. No hay selección automática.
Los contactos anteriores entran como candidatos sin verificar; Palmetto mantiene dos opciones
independientes y Crespo no recibe ningún contacto supuesto. La asociación usa UUID, no nombres.

Comprobar el contacto y explicar cómo se verificó. Revisar el texto, preparar el borrador y abrir
la aplicación correspondiente. Después de enviar manualmente, registrar el resultado que se
pueda acreditar, con evidencia y hora de Colombia. Si no se sabe si salió, registrar **No sé si
se envió**, consultar el resultado y resolverlo antes de otro intento. Un comprobante de entrega
o la respuesta del destinatario son pasos distintos de la confirmación humana de envío.

El registro nunca solicita documentos, datos de menores, claves de acceso ni pagos. Usar solo
una referencia verificable; conservar comprobantes sensibles fuera de este campo de texto.

## MCP existente

Todas las herramientas reutilizan el mismo servicio y vuelven a comprobar al administrador:

| Herramienta | Resultado |
| --- | --- |
| `list_building_notices` | Llegadas por fecha/reserva/apartamento, candidatos, avisos e historial |
| `preview_building_notice` | `snapshot`, texto propuesto y bloqueos, sin escritura ni envío |
| `verify_building_recipient` | Verificación expresa del candidato con evidencia y versión esperada |
| `prepare_building_notice` | Borrador deduplicado a partir del `snapshot` leído |
| `record_building_notice` | Hecho comprobado, evidencia, fecha, versión esperada y clave estable |

Las escrituras requieren `request_key`. Conservarla junto al payload completo ante una respuesta
incierta; consultar el estado antes de repetir. No reutilizarla para otra operación. `record` exige
`confirmed: true`, `expected_version`, `occurred_at` ISO con desplazamiento horario y evidencia
de 10–500 caracteres. Para la app, `-05:00` es Colombia. La hora introducida por el operador tiene
precisión de minutos; SQL acepta el minuto de creación del borrador, nunca un minuto anterior ni
una fecha futura.

| Acción | Evidencia (`evidence_kind`) |
| --- | --- |
| `uncertain` | `uncertain_result` |
| `sent` | `operator_confirmation` o `message_reference` |
| `delivered` | `delivery_receipt` |
| `received` | `recipient_acknowledgment` |
| `reviewed` | `review`, solo con el mismo contenido actual; conserva el estado |

La plantilla 1 se conserva para reconstruir el contenido histórico. Cualquier cambio futuro de
texto debe introducir otra versión de plantilla y mantener el renderizado de la anterior.
`setBuildingNotified` conserva su firma para clientes viejos, pero rechaza registrar o borrar
marcas sin el nuevo procedimiento. Es necesario actualizar Inicio en esos clientes.

## Seguridad y comprobación

Migración `20261108150541_building_notices.sql`: tres tablas con RLS de lectura exclusiva para
administradores, sin DML directo para `authenticated` o `service_role`. La escritura pasa por un
RPC público `SECURITY INVOKER` y un escritor privado con identidad validada y `search_path` vacío.
Bloquea la reserva y las filas afectadas, aplica versión esperada y conserva historial inmutable.
No actualiza reservas ni tareas. No interpreta ni ejecuta enlaces recibidos como evidencia.

Pruebas: Vitest con `fake-db`, acciones de servidor, adaptadores MCP y componente; SQL local con
roles reales, invariantes y reintentos; dos conexiones simultáneas para deduplicación, conflicto,
reintento idéntico, cambio de fechas y cancelación. Revisar además 320/393 px con datos sintéticos.
Las pruebas de interfaz sustituyen las acciones por respuestas sintéticas; no acreditan entrega
real de mensajes ni sustituyen la lectura posterior de producción.

## Publicación y recuperación

1. Pruebas, tipos, lint, build y `bash scripts/test-migrations.sh` en Postgres local temporal.
2. Con la autorización de Diego, comprobar versión productiva, esquema y huellas de tareas,
   reservas y marcas históricas; aplicar **solo** la migración nueva mediante Supabase.
3. Confirmar tablas/políticas/permisos y candidatos sin verificar. Ningún aviso se crea al migrar.
4. Integrar el PR probado con `info-softop`; verificar commit, despliegue de Vercel y dominio.
5. Leer Inicio autenticado y MCP si hay sesión disponible, sin verificar contactos, preparar avisos
   ni enviar mensajes reales como prueba. Distinguir las comprobaciones locales de las productivas.

Si hay un problema, conservar tablas, candidatos, marcas e historial. No volver a habilitar el
botón antiguo que marcaba el envío al abrir. Corregir o retirar la entrada al flujo con un PR;
no borrar historial ni restaurar datos de reservas/tareas. Cualquier reversión productiva necesita
la autorización aplicable de Diego. La verificación operativa de cada contacto y el envío humano
siguen siendo responsabilidad del administrador.
