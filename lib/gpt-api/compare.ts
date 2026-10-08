/**
 * Compara las reservas que ChatGPT leyó en Airbnb con las de la app. Pura: no toca la base.
 * Reglas en docs/superpowers/specs/2026-10-08-api-chatgpt-design.md §5.
 */
import { guestNameMatches } from '@/lib/gmail-sync'
import type { ReservationSource, ReservationStatus } from '@/lib/types'
import { shortDate } from './dates'
import { resolveProperty, type PropertyRef } from './properties'
import type { AirbnbReservationInput, CompareInput } from './validate'

export interface AppReservation {
  id: string
  airbnb_code: string | null
  guest_name: string
  property_id: string
  check_in: string
  check_out: string
  guests: number | null
  status: ReservationStatus
  source: ReservationSource
  notes: string | null
}

export type DiffType =
  | 'missing_in_app'
  | 'cancelled_in_airbnb'
  | 'dates_differ'
  | 'guests_differ'
  | 'property_differ'
  | 'not_in_airbnb_list'

export interface StaySnapshot {
  property: string | null
  check_in: string
  check_out: string
  guests: number | null
  status: string
}

export interface Difference {
  types: DiffType[]
  code: string | null
  guest_name: string
  property: string | null
  airbnb: StaySnapshot | null
  app: StaySnapshot | null
  message: string
  /** Reserva de la app donde va la nota; null cuando no hay reserva activa que marcar. */
  reservation_id: string | null
}

export interface Unmatched {
  input: AirbnbReservationInput
  reason: string
}

export interface CompareResult {
  summary: { airbnb: number; app: number; matching: number; differences: number; unmatched: number }
  differences: Difference[]
  unmatched: Unmatched[]
  /** Reservas de la app que coinciden con Airbnb: se les quita una nota de diferencia vieja. */
  matching_ids: string[]
}

type Stay = { check_in: string; check_out: string }

// Airbnb's list may carry the full name or only the first one, and so may the app.
const sameGuest = (a: string, b: string) => guestNameMatches(a, b) || guestNameMatches(b, a)
const overlaps = (a: Stay, b: Stay) => a.check_in < b.check_out && b.check_in < a.check_out
const normCode = (code: string | null) => (code ? code.replace(/\s+/g, '').toUpperCase() : null)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const span = (s: Stay) => `${shortDate(s.check_in)} a ${shortDate(s.check_out)}`

export function compareReservations(
  input: CompareInput,
  appRows: AppReservation[],
  properties: PropertyRef[],
): CompareResult {
  const nameOf = (id: string) => properties.find(p => p.id === id)?.name ?? null
  const snapshot = (r: AppReservation): StaySnapshot => ({
    property: nameOf(r.property_id), check_in: r.check_in, check_out: r.check_out, guests: r.guests, status: r.status,
  })

  // Blocks and direct bookings are reservations made outside Airbnb: they never show up there.
  const app = appRows.filter(r => r.source === 'airbnb' && r.status !== 'blocked')
  const byCode = new Map<string, AppReservation>()
  for (const r of app) {
    const code = normCode(r.airbnb_code)
    if (code) byCode.set(code, r)
  }

  const used = new Set<string>()        // app bookings already paired with an Airbnb one
  const ambiguous = new Set<string>()   // candidates of an unmatched entry: not "missing from Airbnb"
  const differences: Difference[] = []
  const unmatched: Unmatched[] = []
  const matchingIds: string[] = []
  let matching = 0

  for (const item of input.reservations) {
    const code = normCode(item.code)
    const property = resolveProperty(item.property, properties)
    const airbnb: StaySnapshot = {
      property: property?.name ?? item.property,
      check_in: item.check_in, check_out: item.check_out, guests: item.guests, status: item.status,
    }

    let match = code ? byCode.get(code) : undefined
    const matchedByCode = match !== undefined
    if (match && used.has(match.id)) {
      unmatched.push({ input: item, reason: `El código ${code} vino repetido en la lista` })
      continue
    }

    if (!match && property) {
      const candidates = app.filter(r =>
        !used.has(r.id) &&
        r.property_id === property.id &&
        (!code || !r.airbnb_code) &&      // a booking with another code is another booking
        sameGuest(r.guest_name, item.guest_name) &&
        overlaps(r, item))
      if (candidates.length > 1) {
        for (const c of candidates) ambiguous.add(c.id)
        unmatched.push({
          input: item,
          reason: `Hay ${candidates.length} reservas de ${item.guest_name} en ${property.name} que se cruzan con esas fechas`,
        })
        continue
      }
      match = candidates[0]
    } else if (!match && !code) {
      unmatched.push({ input: item, reason: `No reconozco el apartamento «${item.property}»` })
      continue
    }

    if (match) used.add(match.id)

    const report = (types: DiffType[], message: string, target: AppReservation | undefined) =>
      differences.push({
        types, code: code ?? normCode(match?.airbnb_code ?? null), guest_name: item.guest_name,
        property: property?.name ?? (match ? nameOf(match.property_id) : null),
        airbnb, app: match ? snapshot(match) : null, message,
        reservation_id: target?.id ?? null,
      })

    // Not active in the app (absent or cancelled there)
    if (!match || match.status === 'cancelled') {
      if (item.status === 'confirmed') {
        report(['missing_in_app'], match
          ? `Confirmada en Airbnb (${span(item)}) pero en la app figura cancelada`
          : `Confirmada en Airbnb (${span(item)}) pero no existe en la app; corre la sincronización de Gmail para importarla`,
          undefined)
      } else {
        matching++
        if (match) matchingIds.push(match.id)
      }
      continue
    }

    if (item.status === 'cancelled') {
      report(['cancelled_in_airbnb'], 'Cancelada en Airbnb; en la app sigue confirmada', match)
      continue
    }

    const types: DiffType[] = []
    const parts: string[] = []
    if (item.check_in !== match.check_in || item.check_out !== match.check_out) {
      types.push('dates_differ')
      if (item.check_in !== match.check_in) {
        parts.push(`llegada ${shortDate(item.check_in)} en Airbnb, ${shortDate(match.check_in)} en la app`)
      }
      if (item.check_out !== match.check_out) {
        parts.push(`salida ${shortDate(item.check_out)} en Airbnb, ${shortDate(match.check_out)} en la app`)
      }
    }
    if (item.guests != null && match.guests != null && item.guests !== match.guests) {
      types.push('guests_differ')
      parts.push(`${item.guests} huéspedes en Airbnb, ${match.guests} en la app`)
    }
    if (matchedByCode && property && property.id !== match.property_id) {
      types.push('property_differ')
      parts.push(`en Airbnb está en ${property.name}, en la app en ${nameOf(match.property_id) ?? 'otro apartamento'}`)
    }

    if (types.length === 0) {
      matching++
      matchingIds.push(match.id)
    } else {
      report(types, capitalize(parts.join('; ')), match)
    }
  }

  // Confirmed app bookings with nights inside the range that Airbnb's list didn't include.
  const inRange = app.filter(r => r.status === 'confirmed' && r.check_in <= input.to && r.check_out > input.from)
  for (const r of inRange) {
    if (used.has(r.id) || ambiguous.has(r.id)) continue
    differences.push({
      types: ['not_in_airbnb_list'], code: r.airbnb_code, guest_name: r.guest_name,
      property: nameOf(r.property_id), airbnb: null, app: snapshot(r),
      message: `No apareció en la lista de Airbnb (${span(r)}); verificar si se canceló o si faltó leerla`,
      reservation_id: r.id,
    })
  }

  return {
    summary: {
      airbnb: input.reservations.length,
      app: inRange.length,
      matching,
      differences: differences.length,
      unmatched: unmatched.length,
    },
    differences,
    unmatched,
    matching_ids: matchingIds,
  }
}
