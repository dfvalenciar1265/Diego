import { describe, it, expect } from 'vitest'
import {
  parseConfirmationEmail,
  parseCancellationEmail,
  parseUpdateEmail,
  parseChangeRequestEmail,
  mapWithConcurrency,
} from '@/lib/gmail-sync'

// ── Fixture builders ──────────────────────────────────────────────────────────

/** A minimal but valid "Reservación confirmada" email body. */
function confirmationFixture(opts: {
  code?: string
  guest?: string
  checkIn?: string   // e.g. "6 jun. 2026"
  checkOut?: string  // e.g. "10 jun. 2026"
  amount?: string    // raw "GANAS $X" value, e.g. "1,220,000"
  guests?: string
} = {}): string {
  const {
    code = 'HMABC12345',
    guest = 'Maria Garcia',
    checkIn = '6 jun. 2026',
    checkOut = '10 jun. 2026',
    amount = '1,220,000',
    guests = '2',
  } = opts
  return [
    `Subject: Reservación confirmada: ${guest} llega el 6 jun`,
    '',
    `Código de confirmación: ${code}`,
    `Huésped: ${guest}`,
    `Llegada: ${checkIn}`,
    `Salida: ${checkOut}`,
    `GANAS $${amount}`,
    `${guests} huéspedes`,
    `https://www.airbnb.com.co/rooms/12345678`,
  ].join('\n')
}

// ── parseConfirmationEmail ─────────────────────────────────────────────────────

describe('parseConfirmationEmail', () => {
  it('extracts the core fields from a valid confirmation', () => {
    const r = parseConfirmationEmail(confirmationFixture())
    expect(r).not.toBeNull()
    expect(r!.airbnb_code).toBe('HMABC12345')
    expect(r!.guest_name).toBe('Maria Garcia')
    expect(r!.check_in).toBe('2026-06-06')
    expect(r!.check_out).toBe('2026-06-10')
    expect(r!.guests).toBe(2)
    expect(r!.source).toBe('airbnb')
    expect(r!.status).toBe('confirmed')
  })

  it('returns null for non-confirmation text', () => {
    expect(parseConfirmationEmail('hola mundo, esto no es un correo de airbnb')).toBeNull()
  })

  it('does NOT parse a cancellation email as a confirmation (false-positive guard)', () => {
    const cancel = [
      'Subject: Cancelada: reservación HMABC12345 del 2 – 4 de jun de 2026',
      '',
      'Código de confirmación: HMABC12345',
      'Estas fechas están disponibles para otros huéspedes',
    ].join('\n')
    expect(parseConfirmationEmail(cancel)).toBeNull()
  })

  describe('COP amount parsing (host payout)', () => {
    const cases: Array<[string, number]> = [
      ['1,221,443.11', 1221443],  // US multi-comma + decimal
      ['1,220,000',    1220000],  // US multi-comma thousands
      ['992,851.85',   992852],   // US single-comma + dot (X,XXX.XX)
      ['1.220.000',    1220000],  // EU multi-dot thousands
      ['335.352,59',   335352.59],// EU X.XXX,XX
      ['509,73',       509.73],   // EU decimal
    ]
    for (const [raw, expected] of cases) {
      it(`parses "${raw}" → ${expected}`, () => {
        const r = parseConfirmationEmail(confirmationFixture({ amount: raw }))
        expect(r).not.toBeNull()
        expect(r!.amount).toBeCloseTo(expected, 2)
      })
    }
  })

  it('parses the HTML short date format with year inference', () => {
    const body = [
      'Subject: Reservación confirmada: Juan Perez llega el 26 may',
      '',
      'Código de confirmación: HMXYZ98765',
      'Huésped: Juan Perez',
      'mar, 26 may',
      'sáb, 30 may',
      'GANAS $500,000',
    ].join('\n')
    const r = parseConfirmationEmail(body)
    expect(r).not.toBeNull()
    // both dates land in the same (inferred) year, check_in < check_out
    expect(r!.check_in < r!.check_out).toBe(true)
    expect(r!.check_in.endsWith('-05-26')).toBe(true)
    expect(r!.check_out.endsWith('-05-30')).toBe(true)
  })

  it('stores only times + cancellation in notes (no guests/code)', () => {
    const r = parseConfirmationEmail(confirmationFixture())
    expect(r!.notes).toContain('Check-in:')
    expect(r!.notes).toContain('Check-out:')
    expect(r!.notes).toContain('Cancelación:')
    expect(r!.notes).not.toContain('Huéspedes:')
    expect(r!.notes).not.toContain('Código:')
  })

  it('returns null when no confirmation code is present', () => {
    const noCode = confirmationFixture().replace(/Código de confirmación: \w+/, 'Código de confirmación:')
    expect(parseConfirmationEmail(noCode)).toBeNull()
  })
})

// ── parseCancellationEmail ─────────────────────────────────────────────────────

describe('parseCancellationEmail', () => {
  it('extracts the code from the Airbnb subject-line format', () => {
    const text = 'Subject: Cancelada: reservación HMSWK98CMD del 2 – 4 de jun de 2026\n\nEstas fechas están disponibles'
    expect(parseCancellationEmail(text)).toBe('HMSWK98CMD')
  })

  it('falls back to an HM-code anywhere in the body', () => {
    const text = 'Tu reservación HMABC12345 ha sido cancelada'
    expect(parseCancellationEmail(text)).toBe('HMABC12345')
  })

  it('uppercases the extracted code', () => {
    const text = 'Subject: Cancelada: reservación hmabc12345 del 2 jun'
    expect(parseCancellationEmail(text)).toBe('HMABC12345')
  })
})

// ── parseUpdateEmail ───────────────────────────────────────────────────────────

describe('parseUpdateEmail', () => {
  it('extracts code and guest from an update email', () => {
    const text = [
      'SE ACTUALIZÓ LA RESERVACIÓN CON Carlos Ruiz',
      'Accede al itinerario: https://www.airbnb.com/reservations/details/HMUPD45678',
    ].join('\n')
    const r = parseUpdateEmail(text)
    expect(r).not.toBeNull()
    expect(r!.airbnb_code).toBe('HMUPD45678')
    expect(r!.guest_name).toContain('Carlos')
  })

  it('returns null when the email is not an update', () => {
    expect(parseUpdateEmail('un correo cualquiera')).toBeNull()
  })
})

// ── parseChangeRequestEmail ────────────────────────────────────────────────────

describe('parseChangeRequestEmail', () => {
  it('extracts guest name and alteration link from a change request', () => {
    const text = [
      'Subject: Judah quiere hacer un cambio en su reservación',
      '',
      'Cartagena',
      'Palmetto 1001 · 2 huéspedes',
      'Huéspedes originales',
      '1 huésped',
      'Huéspedes solicitados',
      '3 huéspedes',
      'https://www.airbnb.com.co/reservation/alteration/987654321',
    ].join('\n')
    const r = parseChangeRequestEmail(text)
    expect(r).not.toBeNull()
    expect(r!.guest_name).toBe('Judah')
    expect(r!.change_description).toContain('Huéspedes')
    expect(r!.alteration_url).toContain('/reservation/alteration/987654321')
  })

  it('returns null when the email is not a change request', () => {
    expect(parseChangeRequestEmail('correo normal')).toBeNull()
  })
})

// ── mapWithConcurrency (sync performance core) ─────────────────────────────────

describe('mapWithConcurrency', () => {
  it('processes every item and preserves input order', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const out = await mapWithConcurrency(items, 10, async n => n * 2)
    expect(out).toHaveLength(50)
    expect(out).toEqual(items.map(n => n * 2))
  })

  it('never runs more than `limit` tasks at once', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 30 }, (_, i) => i)
    await mapWithConcurrency(items, 5, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1)  // actually ran concurrently
  })

  it('handles an empty list without error', async () => {
    expect(await mapWithConcurrency([], 10, async x => x)).toEqual([])
  })
})
