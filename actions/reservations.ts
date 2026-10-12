'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canDo } from '@/lib/permissions'
import { conflictMessage, staysOverlap } from '@/lib/gpt-api/reservation-writes'
import type { Reservation, UserRole } from '@/lib/types'

type ActionResult = { success: boolean; error?: string; warning?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

/** Aviso cuando la reserva quedó guardada pero sus tareas de limpieza/preparación no. */
const TASKS_WARNING =
  'La reserva quedó guardada, pero no se pudieron actualizar sus tareas de limpieza y preparación. ' +
  'Revísalas en Limpieza y Tareas.'

/** Day before a date (YYYY-MM-DD). */
function dayBefore(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function getCallerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('id', user.id)
    .single()
  return (data?.role as UserRole) ?? null
}

/**
 * Revisa que la estadía tenga sentido y no se cruce con otra reserva no cancelada del mismo
 * apartamento (salir y llegar el mismo día no choca). Devuelve el mensaje de error o null.
 * Si no se puede consultar, no deja guardar: mejor reintentar que crear una doble reserva.
 */
async function stayError(
  supabase: Supabase,
  propertyId: string,
  checkIn: string,
  checkOut: string,
  excludeId?: string,
): Promise<string | null> {
  if (!checkIn || !checkOut) return 'Faltan las fechas de check-in y check-out.'
  if (checkOut <= checkIn) {
    return 'La fecha de check-out debe ser posterior a la de check-in (mínimo una noche).'
  }
  if (!propertyId) return 'Elige el apartamento.'

  let query = supabase
    .from('reservations')
    .select('id, guest_name, check_in, check_out')
    .eq('property_id', propertyId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOut)
    .gt('check_out', checkIn)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) {
    console.error('[reservations] no pude revisar cruces de fechas', propertyId, error.message)
    return 'No se pudo revisar si las fechas se cruzan con otra reserva. Reintenta.'
  }

  const stay = { check_in: checkIn, check_out: checkOut }
  const conflicts = ((data ?? []) as { id: string; guest_name: string | null; check_in: string; check_out: string }[])
    .filter(r => r.id !== excludeId && staysOverlap(stay, r))
    .map(r => ({ ...r, guest_name: r.guest_name?.trim() || 'Sin nombre' }))
  if (conflicts.length === 0) return null

  const { data: property } = await supabase
    .from('properties').select('name').eq('id', propertyId).maybeSingle()
  return conflictMessage(property?.name ?? 'El apartamento', conflicts, 'Revisa las fechas antes de guardar.')
}

/**
 * Obtiene reservas. Sin filtro = todas. Con filtro 'YYYY-MM' incluye reservas
 * que se solapan con el mes (check_in < primer día del mes siguiente
 * y check_out >= primer día del mes).
 */
export async function getReservations(month?: string): Promise<Reservation[]> {
  const supabase = await createClient()
  let query = supabase
    .from('reservations')
    .select('*')
    .neq('status', 'cancelled')   // never show cancelled reservations
    .order('check_in')
  if (month) {
    const [year, mon] = month.split('-').map(Number)
    const nextMonthYear = mon === 12 ? year + 1 : year
    const nextMonth = `${nextMonthYear}-${String(mon === 12 ? 1 : mon + 1).padStart(2, '0')}-01`
    query = query
      .gte('check_out', `${month}-01`)
      .lt('check_in', nextMonth)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createReservation(
  formData: FormData
): Promise<ActionResult> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const guestsRaw = formData.get('guests') as string
  const propertyId = formData.get('property_id') as string
  const guestName  = formData.get('guest_name') as string
  const checkIn    = formData.get('check_in') as string
  const checkOut   = formData.get('check_out') as string
  const status     = (formData.get('status') as string) || 'confirmed'
  // Airbnb confirmation code — lets cancellation emails match this reservation later
  const airbnbCode = ((formData.get('airbnb_code') as string) || '').trim().toUpperCase() || null

  const invalid = await stayError(supabase, propertyId, checkIn, checkOut)
  if (invalid) return { success: false, error: invalid }

  const { data: inserted, error } = await supabase.from('reservations').insert({
    property_id: propertyId,
    source: formData.get('source') as string,
    guest_name: guestName,
    check_in: checkIn,
    check_out: checkOut,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    airbnb_code: airbnbCode,
    status,
  }).select('id').single()
  if (error || !inserted) return { success: false, error: error?.message ?? 'Error al crear' }

  // Auto-create cleaning + preparation tasks (same as the Gmail sync does),
  // so manually-added reservations show up in Limpieza and Preparación.
  let warning: string | undefined
  if (status === 'confirmed' && checkIn && checkOut) {
    const prepDate = dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
    const { error: taskError } = await supabase.from('tasks').insert([
      {
        property_id: propertyId,
        reservation_id: inserted.id,
        type: 'cleaning',
        scheduled_for: checkOut,
        status: 'pending',
        notes: `Limpieza post-estadía — ${guestName}`,
      },
      {
        property_id: propertyId,
        reservation_id: inserted.id,
        type: 'preparation',
        scheduled_for: prepDate,
        status: 'pending',
        notes: `Preparación para ${guestName} (check-in ${checkIn})`,
      },
    ])
    if (taskError) {
      console.error('[reservations] no pude crear las tareas de la reserva', inserted.id, taskError.message)
      warning = TASKS_WARNING
    }
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true, warning }
}

export async function updateReservation(
  id: string, formData: FormData
): Promise<ActionResult> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const guestsRaw = formData.get('guests') as string
  const airbnbCode = ((formData.get('airbnb_code') as string) || '').trim().toUpperCase() || null
  const checkIn  = formData.get('check_in') as string
  const checkOut = formData.get('check_out') as string

  // The apartment isn't editable here, so the cross-check uses the stored one.
  const { data: current, error: currentError } = await supabase
    .from('reservations').select('property_id, check_in, check_out, status').eq('id', id).maybeSingle()
  if (currentError) return { success: false, error: currentError.message }
  if (!current) return { success: false, error: 'Reserva no encontrada' }
  // Dates are always validated; overlaps only when they move (and the stay still occupies
  // the apartment), so fixing a note on an old overlapping record isn't blocked.
  const datesMoved = checkIn !== current.check_in || checkOut !== current.check_out
  const badDates = !checkIn || !checkOut || checkOut <= checkIn
  if (badDates || (datesMoved && current.status !== 'cancelled')) {
    const invalid = await stayError(supabase, current.property_id, checkIn, checkOut, id)
    if (invalid) return { success: false, error: invalid }
  }

  const { error } = await supabase.from('reservations').update({
    guest_name: formData.get('guest_name') as string,
    check_in: checkIn,
    check_out: checkOut,
    amount: Number(formData.get('amount')) || 0,
    guests: guestsRaw ? Math.max(1, parseInt(guestsRaw, 10)) : null,
    notes: formData.get('notes') as string,
    source: formData.get('source') as string,
    airbnb_code: airbnbCode,
  }).eq('id', id)
  if (error) return { success: false, error: error.message }

  // Keep the linked turnover tasks in sync with the (possibly edited) dates:
  // the cleaning is due on check-out, the preparation the day before check-in.
  // Without this, moving a reservation's dates strands its cleaning on the old
  // day — which, among other things, hides the check-out time editor on the home.
  const warning = await moveLinkedTasks(supabase, id, checkIn, checkOut)

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true, warning }
}

/**
 * Cleaning on check-out, preparation the day before check-in. Returns a warning (and logs)
 * if a move failed — the reservation itself is already saved.
 */
async function moveLinkedTasks(
  supabase: Supabase, id: string, checkIn: string, checkOut: string,
): Promise<string | undefined> {
  const prepDate = dayBefore(checkIn) >= checkOut ? checkIn : dayBefore(checkIn)
  const [cleaning, preparation] = await Promise.all([
    supabase.from('tasks').update({ scheduled_for: checkOut })
      .eq('reservation_id', id).eq('type', 'cleaning'),
    supabase.from('tasks').update({ scheduled_for: prepDate })
      .eq('reservation_id', id).eq('type', 'preparation'),
  ])
  const failed = cleaning.error ?? preparation.error
  if (!failed) return undefined
  console.error('[reservations] no pude mover las tareas de la reserva', id, failed.message)
  return TASKS_WARNING
}

/**
 * Reservations whose guest-requested change was accepted in Airbnb and is
 * waiting to be applied here (one tap). Ordered by check-in.
 */
export async function getAcceptedChanges(): Promise<Reservation[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('reservations')
    .select('*, property:properties(name)')
    .eq('status', 'confirmed')
    .not('pending_change', 'is', null)
    .order('check_in')
  // accepted_at lives inside the jsonb — filter in JS so the query stays simple
  return (data ?? []).filter(r => (r.pending_change as { accepted_at?: string | null } | null)?.accepted_at)
}

/** Applies the accepted change (guests and/or dates) and clears it. */
export async function applyReservationChange(
  id: string
): Promise<ActionResult> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()

  const { data: res } = await supabase
    .from('reservations').select('id, property_id, check_in, check_out, guests, pending_change').eq('id', id).single()
  if (!res) return { success: false, error: 'Reserva no encontrada' }

  const pc = res.pending_change as {
    guests_to?: number | null; check_in_to?: string | null; check_out_to?: string | null
    accepted_at?: string | null
  } | null
  if (!pc?.accepted_at) return { success: false, error: 'Este cambio aún no fue aceptado en Airbnb' }

  const checkIn  = pc.check_in_to  ?? res.check_in
  const checkOut = pc.check_out_to ?? res.check_out
  const update: Record<string, unknown> = { pending_change: null }
  if (pc.guests_to != null)   update.guests    = pc.guests_to
  if (pc.check_in_to)         update.check_in  = checkIn
  if (pc.check_out_to)        update.check_out = checkOut

  // Airbnb already accepted it, so the new dates are real: apply them even if they
  // collide, but say so loudly — a collision here is an actual double booking.
  const datesMoved = !!(pc.check_in_to || pc.check_out_to)
  const clash = datesMoved
    ? await stayError(supabase, res.property_id, checkIn, checkOut, id)
    : null

  const { error } = await supabase.from('reservations').update(update).eq('id', id)
  if (error) return { success: false, error: error.message }

  // Dates moved → keep the turnover tasks in sync (same rule as updateReservation)
  const taskWarning = datesMoved
    ? await moveLinkedTasks(supabase, id, checkIn, checkOut)
    : undefined
  const warning = [clash && `Ojo, posible doble reserva: ${clash}`, taskWarning]
    .filter(Boolean).join(' ') || undefined

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/cleaning')
  return { success: true, warning }
}

/** Dismisses the pending change without touching the reservation. */
export async function dismissReservationChange(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('reservations').update({ pending_change: null }).eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/')
  revalidatePath('/calendar')
  return { success: true }
}

export async function deleteReservation(
  id: string
): Promise<ActionResult> {
  const role = await getCallerRole()
  if (!role || !canDo(role, 'reservations:edit')) {
    return { success: false, error: 'No autorizado' }
  }
  const supabase = await createClient()

  // Fetch the reservation first to get guest_name and property_id for orphan cleanup
  const { data: reservation } = await supabase
    .from('reservations')
    .select('guest_name, property_id')
    .eq('id', id)
    .single()

  // Soft-delete: mark as cancelled instead of physically deleting.
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', id)
  if (error) return { success: false, error: error.message }

  // Delete ALL tasks linked to this reservation (any status — done tasks also removed)
  let warning: string | undefined
  const { error: taskError } = await supabase
    .from('tasks')
    .delete()
    .eq('reservation_id', id)
  if (taskError) {
    console.error('[reservations] no pude borrar las tareas de la reserva cancelada', id, taskError.message)
    warning = 'La reserva quedó cancelada, pero no se pudieron borrar sus tareas de limpieza y preparación. ' +
      'Bórralas a mano en Limpieza y Tareas.'
  }

  // Also delete orphan tasks (reservation_id = null) for same property + guest name
  // These appear when auto-task creation runs before the reservation_id FK is set
  if (reservation?.guest_name && reservation?.property_id) {
    const { error: orphanError } = await supabase
      .from('tasks')
      .delete()
      .is('reservation_id', null)
      .eq('property_id', reservation.property_id)
      .ilike('notes', `%${reservation.guest_name}%`)
    if (orphanError) console.error('[reservations] no pude borrar tareas huérfanas', id, orphanError.message)
  }

  revalidatePath('/calendar')
  revalidatePath('/')
  revalidatePath('/tasks')
  revalidatePath('/cleaning')
  return { success: true, warning }
}
