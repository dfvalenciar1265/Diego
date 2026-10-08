/**
 * Esquema OpenAPI 3.1 que se importa al crear el GPT "AirAdmin" (Acciones). El servidor sale del
 * dominio de la petición, así sirve igual en producción y en local. No lleva secretos.
 */
const json = (schema: object) => ({ 'application/json': { schema } })
const ok = (description: string, schema: object) => ({ description, content: json(schema) })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const ERROR = { $ref: '#/components/responses/Error' }

const date = { type: 'string', format: 'date' }
const nullable = (type: string) => ({ type: [type, 'null'] })

export function buildOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AirAdmin para ChatGPT',
      version: '1.0.0',
      description: 'Pendientes de mantenimiento y revisión de reservas de los apartamentos Airbnb de Diego.',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/gpt/properties': {
        get: {
          operationId: 'listProperties',
          summary: 'Apartamentos',
          description: 'Lista los apartamentos activos con su nombre exacto en la app. Úsalo para traducir cualquier nombre que diga Diego antes de crear pendientes o comparar reservas.',
          responses: {
            '200': ok('Apartamentos', {
              type: 'object',
              properties: { properties: { type: 'array', items: ref('Property') } },
              required: ['properties'],
            }),
            '401': ERROR,
          },
        },
      },
      '/api/gpt/maintenance': {
        get: {
          operationId: 'listMaintenance',
          summary: 'Consultar pendientes',
          description: 'Pendientes de mantenimiento, más recientes primero (máx. 100). Por defecto solo abiertos y en progreso. Consúltalo antes de decir que algo está roto o arreglado.',
          parameters: [
            { name: 'property', in: 'query', required: false, description: 'Nombre del apartamento', schema: { type: 'string' } },
            {
              name: 'status', in: 'query', required: false, description: 'active = abiertos + en progreso',
              schema: { type: 'string', enum: ['active', 'open', 'in_progress', 'resolved'], default: 'active' },
            },
          ],
          responses: {
            '200': ok('Pendientes', {
              type: 'object',
              properties: { count: { type: 'integer' }, issues: { type: 'array', items: ref('MaintenanceIssue') } },
              required: ['count', 'issues'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
        post: {
          operationId: 'createMaintenance',
          summary: 'Crear pendiente',
          description: 'Crea un pendiente reportado por Diego y sin asignar. Si ya hay uno abierto con el mismo título en ese apartamento, no duplica: devuelve created=false y el existente.',
          requestBody: { required: true, content: json(ref('NewMaintenance')) },
          responses: {
            '201': ok('Creado', ref('CreateMaintenanceResult')),
            '200': ok('Ya existía', ref('CreateMaintenanceResult')),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/maintenance/{id}': {
        patch: {
          operationId: 'updateMaintenance',
          summary: 'Cambiar estado de un pendiente',
          description: 'Cambia el estado, agrega una nota con fecha o registra el costo. En preventivos recurrentes, "resolved" no lo cierra: anota hoy como última vez y avanza la próxima fecha (scheduled_done=true).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: json(ref('MaintenancePatch')) },
          responses: {
            '200': ok('Actualizado', {
              type: 'object',
              properties: { issue: ref('MaintenanceIssue'), scheduled_done: { type: 'boolean' } },
              required: ['issue', 'scheduled_done'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/reservations': {
        get: {
          operationId: 'listReservations',
          summary: 'Reservas de la app',
          description: 'Reservas de la app con noches dentro del rango (por defecto, de hoy a 60 días; máximo 120). Incluye bloqueos y reservas directas. No trae montos.',
          parameters: [
            { name: 'from', in: 'query', required: false, schema: date },
            { name: 'to', in: 'query', required: false, schema: date },
            { name: 'property', in: 'query', required: false, description: 'Nombre del apartamento', schema: { type: 'string' } },
          ],
          responses: {
            '200': ok('Reservas', {
              type: 'object',
              properties: {
                from: date, to: date, count: { type: 'integer' },
                reservations: { type: 'array', items: ref('Reservation') },
              },
              required: ['from', 'to', 'count', 'reservations'],
            }),
            '400': ERROR, '401': ERROR, '404': ERROR,
          },
        },
      },
      '/api/gpt/reservations/compare': {
        post: {
          operationId: 'compareReservations',
          summary: 'Comparar con Airbnb',
          description: 'Compara la lista leída en Airbnb con la app. Devuelve las diferencias y deja la nota "⚠️ Diferencia con Airbnb" en las reservas afectadas (no si dry_run=true). Nunca cambia fechas ni datos.',
          requestBody: { required: true, content: json(ref('CompareRequest')) },
          responses: { '200': ok('Resultado', ref('CompareResult')), '400': ERROR, '401': ERROR },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      responses: {
        Error: {
          description: 'Error con el motivo en español',
          content: json({ type: 'object', properties: { error: { type: 'string' } }, required: ['error'] }),
        },
      },
      schemas: {
        Property: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
        MaintenanceIssue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            property: nullable('string'),
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['urgent', 'normal', 'scheduled'] },
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
            notes: { type: 'string' },
            cost: nullable('number'),
            created_at: { type: 'string' },
            resolved_at: nullable('string'),
            next_due: nullable('string'),
            last_done: nullable('string'),
            interval_months: nullable('integer'),
          },
        },
        NewMaintenance: {
          type: 'object',
          properties: {
            property: { type: 'string', description: 'Nombre exacto del apartamento (listProperties)' },
            title: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 1000 },
            priority: {
              type: 'string', enum: ['urgent', 'normal', 'scheduled'],
              description: 'urgent = afecta la estadía; normal = desgaste; scheduled = fotos o ficha',
            },
          },
          required: ['property', 'title', 'priority'],
        },
        CreateMaintenanceResult: {
          type: 'object',
          properties: { created: { type: 'boolean' }, issue: ref('MaintenanceIssue') },
          required: ['created', 'issue'],
        },
        MaintenancePatch: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
            note: { type: 'string', maxLength: 1000, description: 'Se agrega al final de las notas, con la fecha' },
            cost: { type: 'number', minimum: 0, description: 'Costo en pesos colombianos' },
          },
        },
        Reservation: {
          type: 'object',
          properties: {
            airbnb_code: nullable('string'),
            guest_name: { type: 'string' },
            property: nullable('string'),
            check_in: date,
            check_out: date,
            guests: nullable('integer'),
            status: { type: 'string', enum: ['confirmed', 'blocked', 'cancelled'] },
            source: { type: 'string', enum: ['airbnb', 'direct'] },
            notes: nullable('string'),
          },
        },
        AirbnbReservation: {
          type: 'object',
          properties: {
            code: { type: ['string', 'null'], description: 'Código de confirmación HM…' },
            guest_name: { type: 'string' },
            property: { type: 'string', description: 'Nombre del apartamento en la app' },
            check_in: date,
            check_out: date,
            guests: { type: ['integer', 'null'], minimum: 1 },
            status: { type: 'string', enum: ['confirmed', 'cancelled'], default: 'confirmed' },
          },
          required: ['guest_name', 'property', 'check_in', 'check_out'],
        },
        CompareRequest: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            dry_run: { type: 'boolean', default: false, description: 'true = solo mirar, sin dejar notas en la app' },
            reservations: { type: 'array', items: ref('AirbnbReservation'), minItems: 1, maxItems: 300 },
          },
          required: ['from', 'to', 'reservations'],
        },
        Stay: {
          type: ['object', 'null'],
          properties: {
            property: nullable('string'), check_in: date, check_out: date,
            guests: nullable('integer'), status: { type: 'string' },
          },
        },
        Difference: {
          type: 'object',
          properties: {
            types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['missing_in_app', 'cancelled_in_airbnb', 'dates_differ', 'guests_differ', 'property_differ', 'not_in_airbnb_list'],
              },
            },
            code: nullable('string'),
            guest_name: { type: 'string' },
            property: nullable('string'),
            airbnb: ref('Stay'),
            app: ref('Stay'),
            message: { type: 'string' },
            reservation_id: nullable('string'),
            noted: { type: 'boolean', description: 'true si quedó la nota en la reserva de la app' },
          },
        },
        CompareResult: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            dry_run: { type: 'boolean' },
            summary: {
              type: 'object',
              properties: {
                airbnb: { type: 'integer' }, app: { type: 'integer' }, matching: { type: 'integer' },
                differences: { type: 'integer' }, unmatched: { type: 'integer' },
              },
            },
            differences: { type: 'array', items: ref('Difference') },
            unmatched: {
              type: 'array',
              items: {
                type: 'object',
                properties: { input: ref('AirbnbReservation'), reason: { type: 'string' } },
              },
            },
            notes_cleared: { type: 'integer' },
          },
        },
      },
    },
  }
}
