/**
 * Turnover tasks = the cleaning (on check-out) and the preparation (day before
 * check-in) that every confirmed reservation needs. Pure helpers so the sync can
 * both create them for new reservations and repair reservations left without them.
 */

export interface TurnoverReservation {
  id: string
  property_id: string
  guest_name: string
  check_in: string    // YYYY-MM-DD
  check_out: string   // YYYY-MM-DD
  tasks?: { type: string }[] | null
}

export interface TurnoverTaskRow {
  property_id: string
  reservation_id: string
  type: 'cleaning' | 'preparation'
  scheduled_for: string
  status: 'pending'
  notes: string
}

// Day before a date (YYYY-MM-DD)
export function dayBefore(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Preparation is the day before check-in, or the check-in day itself for a one-night gap. */
export function prepDateFor(checkIn: string, checkOut: string): string {
  return dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
}

export function cleaningTaskFor(r: TurnoverReservation): TurnoverTaskRow {
  return {
    property_id:    r.property_id,
    reservation_id: r.id,
    type:           'cleaning',
    scheduled_for:  r.check_out,
    status:         'pending',
    notes:          `Limpieza post-estadía — ${r.guest_name}`,
  }
}

export function preparationTaskFor(r: TurnoverReservation, notBefore?: string): TurnoverTaskRow {
  const prep = prepDateFor(r.check_in, r.check_out)
  return {
    property_id:    r.property_id,
    reservation_id: r.id,
    type:           'preparation',
    scheduled_for:  notBefore && prep < notBefore ? notBefore : prep,
    status:         'pending',
    notes:          `Preparación para ${r.guest_name} (check-in ${r.check_in})`,
  }
}

/**
 * Tasks missing from still-relevant confirmed reservations. A reservation whose
 * guest already left needs nothing; one whose guest already arrived only needs
 * its cleaning. A preparation that is late gets scheduled for today, not the past.
 */
export function missingTurnoverTasks(
  reservations: TurnoverReservation[],
  today: string,
): TurnoverTaskRow[] {
  const rows: TurnoverTaskRow[] = []
  for (const r of reservations) {
    if (r.check_out < today) continue
    const types = new Set((r.tasks ?? []).map(t => t.type))
    if (!types.has('cleaning')) rows.push(cleaningTaskFor(r))
    if (!types.has('preparation') && r.check_in >= today) rows.push(preparationTaskFor(r, today))
  }
  return rows
}
