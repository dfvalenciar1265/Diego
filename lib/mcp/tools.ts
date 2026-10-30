/**
 * Herramientas del MCP de AirAdmin: las 6 del GPT, las horas de salida y llegada, las reservas
 * (crear, modificar, cancelar) y sus cobros adicionales y solicitudes especiales, sobre lib/gpt-api/service.ts.
 * Las de solo lectura van con readOnlyHint; ChatGPT confirma con el usuario las demás.
 * Los esquemas describen los tipos; la validación con mensajes en español la hace el servicio.
 */
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { serviceDb } from '@/lib/gpt-api/db'
import {
  compareReservationsTool, createMaintenanceTool, listMaintenanceTool, listReservationsTool,
  propertiesTool, setCheckinTimeTool, setCheckoutTimeTool, turnoversTool, updateMaintenanceTool,
  cancelReservationTool, createReservationTool, updateReservationTool, type ServiceResult,
  listFollowupsTool, createChargeTool, updateChargeTool, createSpecialRequestTool, updateSpecialRequestTool,
  setArrivalPreparationTool,
} from '@/lib/gpt-api/service'
import type { Actor } from '@/lib/gpt-api/followups'
import { memberFromAuth } from './auth'

const READ = { readOnlyHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

const date = z.string().describe('Fecha AAAA-MM-DD')
const airbnbReservation = z.object({
  code: z.string().nullable().optional().describe('Código de confirmación HM…'),
  guest_name: z.string(),
  property: z.string().describe('Nombre del apartamento en la app (list_properties)'),
  check_in: date,
  check_out: date,
  guests: z.number().int().nullable().optional(),
  status: z.enum(['confirmed', 'cancelled']).optional(),
})
const timeChange = z.object({
  kind: z.enum(['estimate', 'authorization']).optional().describe('estimate = ETA comunicada; authorization = excepción aprobada expresamente. Por compatibilidad, si se omite significa authorization.'),
  expected_version: z.number().int().nonnegative().optional().describe('timing.version de list_turnovers; enviarlo para evitar sobrescribir cambios'),
  request_key: z.string().optional().describe('Clave estable para reintentar exactamente la misma operación'),
  reservation_id: z.string().optional().describe('Reserva exacta de timing.reservation_id en list_turnovers'),
  property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
  time: z.string().describe('Hora, por ejemplo 10am, 3:30 pm o 15:30'),
  date: date.optional().describe('Fecha AAAA-MM-DD; por defecto hoy, hasta 30 días adelante'),
  guest_name: z.string().optional().describe('Solo si ese día hay más de una reserva en el apartamento'),
})

function actorFrom(authInfo: Parameters<typeof memberFromAuth>[0]): Actor | null {
  const member = memberFromAuth(authInfo)
  return member ? { id: member.id, via: 'mcp' } : null
}

/** Resultado del servicio → resultado de herramienta MCP (errores con isError, en español). */
export function toToolResult(result: ServiceResult): CallToolResult {
  if (!result.ok) {
    const current = result.current === undefined ? '' : `\nEstado actual: ${JSON.stringify(result.current)}`
    return { content: [{ type: 'text', text: result.error + current }], isError: true }
  }
  const data = result.data as Record<string, unknown>
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
}

async function run(fn: () => Promise<ServiceResult>): Promise<CallToolResult> {
  try {
    return toToolResult(await fn())
  } catch (err) {
    console.error('[mcp]', err instanceof Error ? err.message : err)
    return {
      content: [{
        type: 'text',
        text: 'Error interno del servidor; el resultado es incierto. Si era un cambio, consulta el estado (list_followups, list_reservations…) antes de repetirlo. El detalle quedó en los registros de Vercel.',
      }],
      isError: true,
    }
  }
}

export function registerTools(server: McpServer) {
  server.registerTool('list_properties', {
    title: 'Apartamentos',
    description: 'Lista los apartamentos activos con su nombre exacto en la app. Úsalo para traducir cualquier nombre antes de crear pendientes o comparar reservas.',
    annotations: READ,
  }, () => run(() => propertiesTool(serviceDb())))

  server.registerTool('list_maintenance', {
    title: 'Consultar pendientes',
    description: 'Pendientes de mantenimiento, más recientes primero (máx. 100). Por defecto solo abiertos y en progreso. Consúltalo antes de decir que algo está roto o arreglado.',
    inputSchema: z.object({
      property: z.string().optional().describe('Nombre del apartamento'),
      status: z.enum(['active', 'open', 'in_progress', 'resolved']).optional().describe('active = abiertos + en progreso'),
    }),
    annotations: READ,
  }, ({ property, status }) => run(() => listMaintenanceTool(serviceDb(), { property, status })))

  server.registerTool('create_maintenance', {
    title: 'Crear pendiente',
    description: 'Crea un pendiente de mantenimiento sin asignar, reportado por quien está conectado. Si ya hay uno abierto con el mismo título en ese apartamento, no duplica: devuelve created=false y el existente.',
    inputSchema: z.object({
      property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(['urgent', 'normal', 'scheduled']).describe('urgent = afecta la estadía; normal = desgaste; scheduled = fotos o ficha'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (args, ctx) => run(() => createMaintenanceTool(serviceDb(), args, memberFromAuth(ctx.http?.authInfo)?.id)))

  server.registerTool('update_maintenance', {
    title: 'Cambiar estado de un pendiente',
    description: 'Cambia el estado, agrega una nota con fecha o registra el costo. En preventivos recurrentes, "resolved" no lo cierra: anota hoy como última vez y avanza la próxima fecha (scheduled_done=true).',
    inputSchema: z.object({
      id: z.string().describe('id del pendiente (de list_maintenance)'),
      status: z.enum(['open', 'in_progress', 'resolved']).optional(),
      note: z.string().optional().describe('Se agrega al final de las notas, con la fecha'),
      cost: z.number().optional().describe('Costo en pesos colombianos'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, ({ id, ...patch }) => run(() => updateMaintenanceTool(serviceDb(), id, patch, todayInBogota())))

  server.registerTool('list_reservations', {
    title: 'Reservas de la app',
    description: 'Reservas de la app con noches dentro del rango (por defecto, de hoy a 60 días; máximo 120). Incluye bloqueos y reservas directas. No trae montos.',
    inputSchema: z.object({
      from: date.optional(),
      to: date.optional(),
      property: z.string().optional().describe('Nombre del apartamento'),
    }),
    annotations: READ,
  }, (query) => run(() => listReservationsTool(serviceDb(), query, todayInBogota(), { includeAmount: true })))

  server.registerTool('compare_reservations', {
    title: 'Comparar con Airbnb',
    description: 'Compara la lista leída en Airbnb con la app. Devuelve las diferencias y deja la nota "⚠️ Diferencia con Airbnb" en las reservas afectadas (no si dry_run=true). Nunca cambia fechas ni datos.',
    inputSchema: z.object({
      from: date,
      to: date,
      dry_run: z.boolean().optional().describe('true = solo mirar, sin dejar notas en la app'),
      reservations: z.array(airbnbReservation).describe('Una entrada por reserva leída en Airbnb'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (body) => run(() => compareReservationsTool(serviceDb(), body, todayInBogota())))

  server.registerTool('list_turnovers', {
    title: 'Salidas y llegadas del día',
    description: 'Salidas (check-out) y llegadas (check-in) de un día con su hora actual, como "Salidas de hoy" y "Preparación hoy" de la app. Salida: estándar 11:00 (America/Bogota) salvo excepción fijada en la app (time_source=app). Llegada estándar 15:00 salvo excepción autorizada. timing separa standard, estimate, authorization, platform, history y review; una ETA no autoriza entrada temprana. Cada salida trae sus cobros pendientes (pending_charges) y cada llegada sus solicitudes especiales; other_charges_due = cobros que vencen ese día de otras reservas. Por defecto hoy.',
    inputSchema: z.object({
      date: date.optional().describe('Fecha AAAA-MM-DD; por defecto hoy, hasta 30 días adelante'),
    }),
    annotations: READ,
  }, ({ date: day }) => run(() => turnoversTool(serviceDb(), { date: day }, todayInBogota())))

  server.registerTool('set_arrival_preparation', {
    title: 'Confirmar preparación de una llegada',
    description: 'Confirma por separado limpieza terminada, revisión de funcionamiento o listo para recibir. No modifica tareas ni resuelve incidencias. Consulta primero preparation de list_turnovers y exige confirmación real de quien lo revisó; una tarea terminada o un aviso no certifican la llegada. Reabrir exige motivo y retira las etapas posteriores. Solo el día anterior o el día de llegada en Colombia. Requiere versión y clave estable de reintento.',
    inputSchema: z.object({
      reservation_id: z.string(), step: z.enum(['cleaning', 'functioning', 'ready']), confirmed: z.boolean(),
      expected_version: z.number().int().nonnegative().describe('preparation.state.version o 0 si no hay registro'),
      request_key: z.string().describe('Clave estable para reintentar exactamente la misma confirmación'),
      stay_check_in: date, stay_check_out: date,
      reason: z.string().max(500).optional().describe('Motivo obligatorio al reabrir'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (body, ctx) => run(() => setArrivalPreparationTool(serviceDb(), body, actorFrom(ctx.http?.authInfo))))

  server.registerTool('set_checkout_time', {
    title: 'Cambiar hora de salida',
    description: 'Registra una ETA (kind=estimate) o una excepción expresamente autorizada (kind=authorization) de salida del huésped que sale ese día del apartamento. Solo la excepción autorizada queda en la tarea de limpieza; la ETA se guarda por separado. Por defecto hoy.',
    inputSchema: timeChange,
    annotations: { ...WRITE, idempotentHint: true },
  }, (body, ctx) => run(() => setCheckoutTimeTool(serviceDb(), body, todayInBogota(), actorFrom(ctx.http?.authInfo))))

  server.registerTool('set_checkin_time', {
    title: 'Cambiar hora de llegada (preparación)',
    description: 'Registra una ETA (kind=estimate) o una excepción expresamente autorizada (kind=authorization) de llegada del huésped que llega ese día al apartamento, la que usa el equipo para la preparación. Solo la excepción autorizada queda en la tarea de preparación conservando su nota; la ETA se guarda por separado. Por defecto hoy.',
    inputSchema: timeChange,
    annotations: { ...WRITE, idempotentHint: true },
  }, (body, ctx) => run(() => setCheckinTimeTool(serviceDb(), body, todayInBogota(), actorFrom(ctx.http?.authInfo))))

  server.registerTool('create_reservation', {
    title: 'Crear reserva',
    description: 'Crea una reserva directa o de Airbnb con sus tareas de limpieza y preparación, como el formulario de la app. Airbnb exige el código HM…; no crea si el código ya existe ni si se cruza con otra reserva del apartamento.',
    inputSchema: z.object({
      property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
      source: z.enum(['direct', 'airbnb']).describe('direct = reserva directa; airbnb = de Airbnb'),
      guest_name: z.string(),
      check_in: date,
      check_out: date,
      guests: z.number().int().optional(),
      amount: z.number().optional().describe('Monto total en pesos colombianos'),
      code: z.string().optional().describe('Código de confirmación HM… (obligatorio si source = airbnb)'),
      note: z.string().optional().describe('Nota que se agrega a la reserva'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body, ctx) => run(() =>
    createReservationTool(serviceDb(), body, todayInBogota(), memberFromAuth(ctx.http?.authInfo)?.name)))

  server.registerTool('update_reservation', {
    title: 'Modificar reserva',
    description: 'Cambia el huésped, el número de huéspedes, las fechas o el monto de una reserva, o le agrega una nota (no reemplaza las notas). Si cambian las fechas mueve sus tareas. No cambia el apartamento: para eso cancela y crea de nuevo.',
    inputSchema: z.object({
      id: z.string().describe('id de la reserva (de list_reservations o create_reservation)'),
      guest_name: z.string().optional(),
      guests: z.number().int().nullable().optional(),
      check_in: date.optional(),
      check_out: date.optional(),
      amount: z.number().optional().describe('Monto total en pesos colombianos'),
      note: z.string().optional().describe('Nota que se agrega al final'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body) => run(() => updateReservationTool(serviceDb(), body, todayInBogota())))

  server.registerTool('cancel_reservation', {
    title: 'Cancelar (borrar) reserva',
    description: 'Cancela una reserva como "Eliminar" en la app: queda cancelada y se borran sus tareas de limpieza y preparación. No la borra del todo, para que la sincronización de Gmail no la vuelva a importar.',
    inputSchema: z.object({
      id: z.string().describe('id de la reserva (de list_reservations)'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, (body) => run(() => cancelReservationTool(serviceDb(), body)))
  server.registerTool('list_followups', {
    title: 'Cobros y solicitudes de reservas',
    description: 'Cobros adicionales (aparte del precio de la reserva) y solicitudes especiales (cuna, camas…) de una reserva o de las reservas con noches en un rango (por defecto, de hoy a 60 días). Trae la version de cada uno, que piden los cambios. totals separa pendiente de cobrado.',
    inputSchema: z.object({
      reservation_id: z.string().optional().describe('id de la reserva (de list_reservations)'),
      from: date.optional(),
      to: date.optional(),
      property: z.string().optional().describe('Nombre del apartamento'),
    }),
    annotations: READ,
  }, (query) => run(() => listFollowupsTool(serviceDb(), query, todayInBogota())))

  server.registerTool('create_charge', {
    title: 'Registrar cobro adicional',
    description: 'Registra un cobro adicional de una reserva en COP (persona extra, adicional acordado…), aparte del precio de la reserva: no cambia el monto de la reserva ni cuenta como ingreso hasta marcarlo cobrado. Si ya hay uno con el mismo concepto y fecha, no duplica: devuelve created=false y el existente.',
    inputSchema: z.object({
      reservation_id: z.string().describe('id de la reserva (de list_reservations)'),
      concept: z.string(),
      amount: z.number().describe('Monto en pesos colombianos'),
      due_date: date.optional().describe('Fecha prevista de cobro; por defecto, el día de salida'),
      notes: z.string().optional(),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (body, ctx) => run(() => createChargeTool(serviceDb(), body, actorFrom(ctx.http?.authInfo))))

  server.registerTool('update_charge', {
    title: 'Actualizar cobro adicional',
    description: 'Marca un cobro como cobrado (exige confirmation: referencia o comprobante; collected_on = fecha real, por defecto hoy) o anulado (void_reason), corrige monto, concepto o fecha, agrega una nota o lo da por revisado (reviewed=true). Cobrado y anulado son finales. Exige expected_version (de list_followups): si cambió, no aplica nada y devuelve el estado actual.',
    inputSchema: z.object({
      id: z.string().describe('id del cobro (de list_followups)'),
      expected_version: z.number().int(),
      status: z.enum(['pending', 'collected', 'void']).optional(),
      confirmation: z.string().optional(),
      collected_on: date.optional(),
      void_reason: z.string().optional(),
      amount: z.number().optional(),
      concept: z.string().optional(),
      due_date: date.optional(),
      note: z.string().optional().describe('Se agrega al final de las notas, con la fecha'),
      reviewed: z.boolean().optional().describe('true = ya se revisó tras un cambio o cancelación de la reserva'),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body, ctx) => run(() => updateChargeTool(serviceDb(), body, actorFrom(ctx.http?.authInfo), todayInBogota())))

  server.registerTool('create_special_request', {
    title: 'Registrar solicitud especial',
    description: 'Registra una solicitud de una reserva (crib = cuna, beds = preparación de camas, other) con fecha y hora límite en Colombia y responsable opcional. Queda "registered": no avisa a nadie ni envía mensajes. No duplica: si ya existe, devuelve created=false y la existente.',
    inputSchema: z.object({
      reservation_id: z.string().describe('id de la reserva (de list_reservations)'),
      kind: z.enum(['crib', 'beds', 'other']),
      description: z.string(),
      due_date: date.describe('Fecha límite para tenerla lista'),
      due_time: z.string().optional().describe('Hora límite HH:MM (24 h, Colombia); por defecto 09:00'),
      responsible: z.string().optional().describe('Nombre de quien debe hacerla (equipo de la app)'),
    }),
    annotations: { ...WRITE, idempotentHint: true },
  }, (body, ctx) => run(() => createSpecialRequestTool(serviceDb(), body, actorFrom(ctx.http?.authInfo))))

  server.registerTool('update_special_request', {
    title: 'Actualizar solicitud especial',
    description: 'notified = ya se avisó (notified_note: a quién y por dónde; no significa que esté lista). ready = quedó hecha y alguien lo confirmó (ready_confirmation). cancelled exige cancel_reason. También cambia el responsable o la da por revisada (reviewed=true). Lista y cancelada son finales. No envía mensajes. Exige expected_version (de list_followups).',
    inputSchema: z.object({
      id: z.string().describe('id de la solicitud (de list_followups)'),
      expected_version: z.number().int(),
      status: z.enum(['notified', 'ready', 'cancelled']).optional(),
      notified_note: z.string().optional(),
      ready_confirmation: z.string().optional(),
      cancel_reason: z.string().optional(),
      responsible: z.string().optional(),
      reviewed: z.boolean().optional(),
    }),
    annotations: { ...WRITE, idempotentHint: false },
  }, (body, ctx) => run(() => updateSpecialRequestTool(serviceDb(), body, actorFrom(ctx.http?.authInfo))))
}
