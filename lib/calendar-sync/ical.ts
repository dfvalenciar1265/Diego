/**
 * Lector estricto de la exportación iCal de un anuncio de Airbnb. Solo extrae lo que ocupa noches:
 * UID, primera noche, día de salida y si es reserva o bloqueo. Nunca devuelve SUMMARY ni
 * DESCRIPTION (traen código de reserva y parte del teléfono del huésped).
 *
 * Es estricto a propósito: un archivo raro (sin cierre, sin PRODID de Airbnb, fechas con hora,
 * UID repetido con otras fechas) invalida el calendario entero. Una corrida con un calendario
 * inválido no se certifica.
 */
export interface CalendarEvent {
  uid: string
  start: string   // YYYY-MM-DD, primera noche
  end: string     // YYYY-MM-DD, día de salida
  kind: 'reserved' | 'blocked'
}

export type ParseResult = { ok: true; events: CalendarEvent[] } | { ok: false; error: string }

/** Une las líneas plegadas (RFC 5545: una línea que empieza con espacio o tab continúa la anterior). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

interface Prop { name: string; params: string; value: string }

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  const head = line.slice(0, colon)
  const semi = head.indexOf(';')
  return {
    name: (semi === -1 ? head : head.slice(0, semi)).toUpperCase(),
    params: semi === -1 ? '' : head.slice(semi + 1).toUpperCase(),
    value: line.slice(colon + 1),
  }
}

/** DTSTART/DTEND de día completo ("20261110" o VALUE=DATE) → "2026-11-10"; con hora → null. */
function parseDate(p: Prop): string | null {
  if (!/^\d{8}$/.test(p.value)) return null
  if (p.params && !/(^|;)VALUE=DATE($|;)/.test(p.params)) return null
  const iso = `${p.value.slice(0, 4)}-${p.value.slice(4, 6)}-${p.value.slice(6, 8)}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

function kindOf(summary: string): CalendarEvent['kind'] {
  return /^\s*reserv/i.test(summary) ? 'reserved' : 'blocked'
}

export function parseAirbnbIcal(text: string): ParseResult {
  const lines = unfold(text).map(l => l.trimEnd()).filter(l => l !== '')
  if (lines[0]?.toUpperCase() !== 'BEGIN:VCALENDAR') return { ok: false, error: 'no empieza con BEGIN:VCALENDAR' }
  if (lines[lines.length - 1]?.toUpperCase() !== 'END:VCALENDAR') return { ok: false, error: 'archivo incompleto (sin END:VCALENDAR)' }

  const prodid = lines.map(parseLine).find(p => p?.name === 'PRODID')
  if (!prodid || !/airbnb/i.test(prodid.value)) return { ok: false, error: 'no es una exportación de Airbnb (PRODID)' }

  const byUid = new Map<string, CalendarEvent>()
  let current: Prop[] | null = null

  for (const line of lines) {
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      if (current) return { ok: false, error: 'VEVENT anidado' }
      current = []
      continue
    }
    if (upper === 'END:VEVENT') {
      if (!current) return { ok: false, error: 'END:VEVENT sin BEGIN' }
      const props = current
      const get = (n: string) => props.find(p => p.name === n)
      const status = get('STATUS')?.value.toUpperCase()
      const uid = get('UID')?.value.trim()
      const dtStart = get('DTSTART')
      const dtEnd = get('DTEND')
      current = null
      if (status === 'CANCELLED') continue
      if (!uid) return { ok: false, error: 'evento sin UID' }
      if (!dtStart || !dtEnd) return { ok: false, error: 'evento sin DTSTART/DTEND' }
      const start = parseDate(dtStart)
      const end = parseDate(dtEnd)
      if (!start || !end) return { ok: false, error: 'fecha no reconocida (se esperan días completos)' }
      if (end <= start) return { ok: false, error: 'evento con salida no posterior a la llegada' }
      const event: CalendarEvent = { uid, start, end, kind: kindOf(get('SUMMARY')?.value ?? '') }
      const prev = byUid.get(uid)
      if (prev && (prev.start !== start || prev.end !== end)) return { ok: false, error: 'UID repetido con fechas distintas' }
      byUid.set(uid, event)
      continue
    }
    if (current) {
      const p = parseLine(line)
      if (p) current.push(p)
    }
  }
  if (current) return { ok: false, error: 'VEVENT sin cerrar' }

  const events = [...byUid.values()].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))
  return { ok: true, events }
}
