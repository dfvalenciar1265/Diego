/** Resolución única para portada y MCP. Las estimaciones informan; solo las autorizaciones cambian el horario operativo. */
import { STANDARD_CHECKOUT } from './checkout'
import { parseClockTime } from './clock-time'

export type TimeDirection = 'checkin' | 'checkout'
export type TimeKind = 'estimate' | 'authorization' | 'platform'
export interface TimeEvent {
  id: string
  reservation_id: string
  direction: TimeDirection
  kind: TimeKind
  time: string | null
  stay_check_in: string
  stay_check_out: string
  property_id: string
  source: 'app' | 'mcp' | 'gmail' | 'legacy'
  request_key: string
  actor_id: string | null
  author: string
  observed_at: string | null
  recorded_at: string
  version: number
  task_id: string | null
  invalidated_at: string | null
}
export interface TimeFact {
  time: string
  source: string
  author: string
  observed_at: string | null
  recorded_at: string | null
  reservation_id: string
  service_date: string
}
export interface ReservationTiming {
  reservation_id: string
  direction: TimeDirection
  version: number
  standard: TimeFact
  estimate: TimeFact | null
  authorization: TimeFact | null
  platform: TimeFact | null
  effective_time: string
  review: string[]
  history: TimeEvent[]
}
export interface TimingReservation {
  id: string
  property_id: string
  check_in: string
  check_out: string
  status?: string
  notes?: string | null
  time_version?: number
  time_events?: TimeEvent[] | null
}

export const STANDARD_CHECKIN = '15:00'
export const validTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export const annotationTime = (notes: string | null | undefined): string | null => {
  const value = notes?.match(/^(\d{2}:\d{2})\|/)?.[1]
  return validTime(value) ? value : null
}
export const annotationNote = (notes: string | null | undefined): string => {
  const text = (notes ?? '').replace(/^\d{2}:\d{2}\|/, '')
  return text.startsWith('Preparación para') ? '' : text
}

export function resolveReservationTiming(
  r: TimingReservation, direction: TimeDirection, legacyTask?: { id: string; notes: string | null; scheduled_for?: string },
): ReservationTiming {
  const date = direction === 'checkin' ? r.check_in : r.check_out
  const history = (r.time_events ?? []).filter(e => e.direction === direction && e.reservation_id === r.id)
    .sort((a, b) => b.version - a.version)
  const review: string[] = []
  const fact = (e: TimeEvent | undefined): TimeFact | null => e?.time && validTime(e.time) ? {
    time: e.time, source: e.source, author: e.author, observed_at: e.observed_at,
    recorded_at: e.recorded_at, reservation_id: r.id, service_date: date,
  } : null
  const active = history.filter(e => !e.invalidated_at && e.stay_check_in === r.check_in
    && e.stay_check_out === r.check_out && e.property_id === r.property_id && (!r.status || r.status === 'confirmed'))
  if (history.some(e => !active.includes(e))) review.push('Hay horarios de una estancia modificada o cancelada; requieren nueva confirmación.')
  const latest = (kind: TimeKind) => active.find(e => e.kind === kind)
  const manualEstimate = active.find(e => e.kind === 'estimate' && e.source !== 'gmail')
  const emailEstimate = active.filter(e => e.kind === 'estimate' && e.source === 'gmail')
    .sort((a, b) => (b.observed_at ?? '').localeCompare(a.observed_at ?? '') || b.version - a.version)[0]
  const estimate = fact(manualEstimate ?? emailEstimate)
  let authorization = fact(latest('authorization'))
  const standard: TimeFact = {
    time: direction === 'checkin' ? STANDARD_CHECKIN : STANDARD_CHECKOUT,
    source: 'operation_policy', author: 'Política operativa de AirAdmin', observed_at: null, recorded_at: null,
    reservation_id: r.id, service_date: date,
  }
  // Compatibilidad con notas antiguas; nunca usar notas de llegada como salida ni como ETA.
  const taskDate = legacyTask?.scheduled_for
  const taskDateValid = !taskDate || (direction === 'checkout' ? taskDate === r.check_out
    : taskDate >= new Date(Date.parse(`${r.check_in}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) && taskDate <= r.check_in)
  if (legacyTask && annotationTime(legacyTask.notes) && !taskDateValid) review.push('La hora de la tarea corresponde a otra fecha; no se usa.')
  if (!history.length && legacyTask && taskDateValid && (!r.status || r.status === 'confirmed')) {
    const time = annotationTime(legacyTask.notes)
    if (time) authorization = { ...standard, time, source: 'legacy', author: 'Autor original desconocido' }
  }
  let platform = fact(active.filter(e => e.kind === 'platform').sort((a, b) => (b.observed_at ?? '').localeCompare(a.observed_at ?? '') || b.version - a.version)[0])
  if (!platform && !history.length) {
    const label = direction === 'checkin' ? 'Check-in' : 'Check-out'
    const raw = r.notes?.match(new RegExp(`(?:^|\\|)\\s*${label}:\\s*([^|]+)`, 'i'))?.[1]
    const time = raw ? parseClockTime(raw) : null
    if (time) platform = { ...standard, time, source: 'legacy_reservation_notes', author: 'Origen original desconocido' }
  }
  if (authorization?.source === 'legacy') review.push('Excepción heredada: autor y fecha originales desconocidos.')
  if (!active.some(e => e.kind === 'authorization' && e.source !== 'legacy')
    && new Set(active.filter(e => e.kind === 'authorization').map(e => e.time)).size > 1) {
    authorization = null
    review.push('Hay excepciones heredadas contradictorias; se mantiene el horario estándar hasta revisión.')
  }
  if (manualEstimate && emailEstimate && manualEstimate.time !== emailEstimate.time) {
    review.push('La ETA del correo contradice el ajuste manual; se conserva el ajuste manual.')
  }
  if (platform && platform.time !== standard.time) review.push('El horario del correo difiere del estándar; no constituye autorización.')
  if (estimate && direction === 'checkin' && estimate.time < (authorization?.time ?? standard.time)) {
    review.push('La ETA es anterior a la entrada permitida; no autoriza check-in temprano.')
  }
  if (estimate && direction === 'checkout' && estimate.time > (authorization?.time ?? standard.time)) {
    review.push('La salida estimada supera la hora permitida; requiere autorización.')
  }
  return {
    reservation_id: r.id, direction, version: r.time_version ?? Math.max(0, ...(r.time_events ?? []).filter(e => e.reservation_id === r.id).map(e => e.version)),
    standard, estimate, authorization, platform, effective_time: authorization?.time ?? standard.time, review, history,
  }
}
