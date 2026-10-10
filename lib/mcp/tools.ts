/**
 * Herramientas del MCP de AirAdmin: las 6 del GPT más las horas de salida y llegada, sobre
 * lib/gpt-api/service.ts.
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
  type ServiceResult,
} from '@/lib/gpt-api/service'
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
  property: z.string().describe('Nombre exacto del apartamento (list_properties)'),
  time: z.string().describe('Hora, por ejemplo 10am, 3:30 pm o 15:30'),
  date: date.optional().describe('Fecha AAAA-MM-DD; por defecto hoy, hasta 30 días adelante'),
  guest_name: z.string().optional().describe('Solo si ese día hay más de una reserva en el apartamento'),
})

/** Resultado del servicio → resultado de herramienta MCP (errores con isError, en español). */
export function toToolResult(result: ServiceResult): CallToolResult {
  if (!result.ok) return { content: [{ type: 'text', text: result.error }], isError: true }
  const data = result.data as Record<string, unknown>
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
}

async function run(fn: () => Promise<ServiceResult>): Promise<CallToolResult> {
  try {
    return toToolResult(await fn())
  } catch (err) {
    console.error('[mcp]', err instanceof Error ? err.message : err)
    return {
      content: [{ type: 'text', text: 'Error interno del servidor. El detalle quedó en los registros de Vercel.' }],
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
  }, (query) => run(() => listReservationsTool(serviceDb(), query, todayInBogota())))

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
    description: 'Salidas (check-out) y llegadas (check-in) de un día con su hora actual, como "Salidas de hoy" y "Preparación hoy" de la app. time_source: app = la fijó alguien en la app; reservation = la del correo de Airbnb; default = 12:00 salida / 15:00 llegada. Por defecto hoy.',
    inputSchema: z.object({
      date: date.optional().describe('Fecha AAAA-MM-DD; por defecto hoy, hasta 30 días adelante'),
    }),
    annotations: READ,
  }, ({ date: day }) => run(() => turnoversTool(serviceDb(), { date: day }, todayInBogota())))

  server.registerTool('set_checkout_time', {
    title: 'Cambiar hora de salida',
    description: 'Cambia la hora de salida (check-out) del huésped que sale ese día del apartamento. Queda en la tarea de limpieza, igual que el lápiz de "Salidas de hoy". Por defecto hoy.',
    inputSchema: timeChange,
    annotations: { ...WRITE, idempotentHint: true },
  }, (body) => run(() => setCheckoutTimeTool(serviceDb(), body, todayInBogota())))

  server.registerTool('set_checkin_time', {
    title: 'Cambiar hora de llegada (preparación)',
    description: 'Cambia la hora de llegada (check-in) del huésped que llega ese día al apartamento, la que usa el equipo para la preparación. Queda en la tarea de preparación conservando su nota, igual que el lápiz de "Preparación hoy". Por defecto hoy.',
    inputSchema: timeChange,
    annotations: { ...WRITE, idempotentHint: true },
  }, (body) => run(() => setCheckinTimeTool(serviceDb(), body, todayInBogota())))
}
