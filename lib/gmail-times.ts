/** Solo etiquetas explícitas de ETA son estimaciones. Check-in/Check-out genéricos son horarios de plataforma. */
import type { Db } from './gpt-api/db'
import { parseClockTime } from './clock-time'
import type { TimeDirection, TimeKind } from './reservation-times'
export interface EmailTimeFact { direction: TimeDirection; kind: Exclude<TimeKind, 'authorization'>; time: string }
export interface EmailTimes {
  reference: string
  observed_at: string
  facts: EmailTimeFact[]
}
export function parseEmailTimeFacts(text: string): EmailTimeFact[] {
  const labels: [TimeDirection, EmailTimeFact['kind'], RegExp][] = [
    ['checkin', 'estimate', /(?:^|\n)\s*(?:Hora estimada de llegada|Estimated arrival time|ETA llegada):\s*([^\n|]+)/i],
    ['checkout', 'estimate', /(?:^|\n)\s*(?:Hora estimada de salida|Estimated departure time|ETA salida):\s*([^\n|]+)/i],
    ['checkin', 'platform', /(?:^|\n)\s*Check-in:\s*([^\n|]+)/i],
    ['checkout', 'platform', /(?:^|\n)\s*Check-out:\s*([^\n|]+)/i],
  ]
  return labels.flatMap(([direction, kind, pattern]) => {
    const value = text.match(pattern)?.[1]
    const time = value ? parseClockTime(value) : null
    return time ? [{ direction, kind, time }] : []
  })
}
export async function importEmailTimes(db: Db, r: { id: string; check_in: string; check_out: string }, email: EmailTimes) {
  for (const fact of email.facts) {
    const { error } = await db.rpc('record_reservation_time', {
      p_reservation_id: r.id, p_direction: fact.direction, p_kind: fact.kind, p_time: fact.time,
      p_expected_version: null, p_request_key: `${email.reference}:${fact.direction}:${fact.kind}`,
      p_source: 'gmail', p_actor_id: null, p_observed_at: email.observed_at,
      p_stay_check_in: r.check_in, p_stay_check_out: r.check_out,
    })
    if (error) throw new Error('No se pudieron conciliar los horarios del correo; requiere revisión.')
  }
}
