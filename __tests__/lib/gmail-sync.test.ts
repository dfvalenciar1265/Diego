import { describe, it, expect } from 'vitest'
import {
  parseConfirmationEmail,
  parseCancellationEmail,
  parseUpdateEmail,
  parseChangeRequestEmail,
  mapWithConcurrency,
  inferReservationYear,
  guestNameMatches,
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
    // The year is inferred from when the email was sent. Without that date the parser
    // falls back to today, and from 3–6 June each year "26 may" would land a year later.
    const r = parseConfirmationEmail(body, new Date('2026-05-10T15:00:00Z'))
    expect(r).not.toBeNull()
    expect(r!.check_in).toBe('2026-05-26')
    expect(r!.check_out).toBe('2026-05-30')
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

  // Regression: Airbnb writes September as "sept." — the only Spanish month
  // abbreviated with 4 letters. MONTH_MAP only knew "sep", so every reservation
  // touching September failed to parse and the email was dropped without a trace.
  describe('September abbreviations', () => {
    it('parses "sept." in the full-date format', () => {
      const r = parseConfirmationEmail(confirmationFixture({
        checkIn: '12 sept. 2026', checkOut: '15 sept. 2026',
      }))
      expect(r).not.toBeNull()
      expect(r!.check_in).toBe('2026-09-12')
      expect(r!.check_out).toBe('2026-09-15')
    })

    it('parses "sept" in the HTML short-date format', () => {
      const body = [
        'Subject: Reservación confirmada: Dora Reyes llega el 30 sept.',
        '',
        'Código de confirmación: HMT39YMMKW',
        'Huésped: Dora Reyes',
        'mié, 30 sept',
        'vie, 2 oct',
        'GANAS $660,585.84',
      ].join('\n')
      // Sent before the stay, as real confirmations are. Relying on today's date made this
      // fail from 8 Oct 2026: "30 sept" fell behind the 7-day floor and moved to 2027.
      const r = parseConfirmationEmail(body, new Date('2026-09-20T15:00:00Z'))
      expect(r).not.toBeNull()
      expect(r!.check_in).toBe('2026-09-30')
      expect(r!.check_out).toBe('2026-10-02')
    })

    it('still parses the "sep" and "septiembre" spellings', () => {
      for (const [ci, co] of [['1 sep. 2026', '3 sep. 2026'],
                              ['1 de septiembre de 2026', '3 de septiembre de 2026']]) {
        const r = parseConfirmationEmail(confirmationFixture({ checkIn: ci, checkOut: co }))
        expect(r!.check_in).toBe('2026-09-01')
        expect(r!.check_out).toBe('2026-09-03')
      }
    })
  })
})

// ── Year inference (emails without a year) ─────────────────────────────────────

// Regression: the year used to be inferred from TODAY, so importing an Oct-2025
// confirmation ("llega el 1 oct") in May 2026 created a phantom 1–4 oct 2026 stay
// in Apto 1303 — and a phantom cleaning — over a real booking.
describe('inferReservationYear', () => {
  it('uses the year the email was sent, not the current one', () => {
    expect(inferReservationYear(10, 1, new Date('2025-10-01T17:49:22Z'))).toBe(2025)
    expect(inferReservationYear(12, 6, new Date('2025-11-30T04:29:28Z'))).toBe(2025)
  })

  it('rolls into the next year for stays after New Year', () => {
    expect(inferReservationYear(1, 2, new Date('2026-09-17T12:00:00Z'))).toBe(2027)
  })

  it('keeps a same-week stay in the same year', () => {
    expect(inferReservationYear(9, 28, new Date('2026-09-30T12:00:00Z'))).toBe(2026)
  })
})

describe('parseConfirmationEmail with the email date', () => {
  it('places a short-format stay in the year the email was sent', () => {
    const body = [
      'Subject: Reservación confirmada: Ana Pérez llega el 1 oct.',
      '',
      'Código de confirmación: HMOLD12345',
      'Huésped: Ana Pérez',
      'mié, 1 oct',
      'sáb, 4 oct',
      'GANAS $1,008,071.00',
    ].join('\n')
    const r = parseConfirmationEmail(body, new Date('2025-10-01T17:49:22Z'))
    expect(r!.check_in).toBe('2025-10-01')
    expect(r!.check_out).toBe('2025-10-04')
  })
})

// ── guestNameMatches ───────────────────────────────────────────────────────────

describe('guestNameMatches', () => {
  it('matches the first name(s) the email uses, accents and case aside', () => {
    expect(guestNameMatches('Santiago Calderón Vargas', 'SANTIAGO')).toBe(true)
    expect(guestNameMatches('Maria Fernanda Vargas Salazar', 'María Fernanda')).toBe(true)
    expect(guestNameMatches('Eddie Williams', 'Eddie')).toBe(true)
  })

  // Regression: a substring match attached old requests to the wrong guests.
  it('does not match a longer name that merely starts the same', () => {
    expect(guestNameMatches('Carlos Niño', 'Carl')).toBe(false)
    expect(guestNameMatches('Alexandra Marin', 'Alex')).toBe(false)
    expect(guestNameMatches('Juan Sebastian Palacio Mosquera', 'Sebastian')).toBe(false)
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

  // Regression: Airbnb's current format ("14 de nov de 2026 - 17 de nov de 2026",
  // whitespace-only lines after the city) left the new dates and the apartment empty,
  // so an accepted date change could never be applied.
  it('reads dates written as "14 de nov de 2026" and the apartment after blank lines', () => {
    const text = [
      'Subject: Santi quiere hacer un cambio en su reservación',
      'SANTI QUIERE HACER UN CAMBIO EN SU RESERVACIÓN',
      '   SANTI',
      '   ',
      '   Cartagena',
      '   ',
      '   Palmetto 1001 · Apartamento moderno, frente al mar en',
      'FECHAS ORIGINALES',
      '',
      '14 de nov de 2026 - 17 de nov de 2026',
      '',
      'FECHAS SOLICITADAS',
      '',
      '20 de nov de 2026 - 23 de nov de 2026',
      'https://www.airbnb.com.co/reservation/alteration/1766340639610329503',
    ].join('\r\n')   // the real emails come with CRLF line endings
    const sent = new Date('2026-09-03T02:03:33Z')
    const r = parseChangeRequestEmail(text, sent)
    expect(r!.property_name).toContain('Palmetto 1001')
    expect(r!.check_in_from).toBe('2026-11-14')
    expect(r!.check_out_from).toBe('2026-11-17')
    expect(r!.check_in_to).toBe('2026-11-20')
    expect(r!.check_out_to).toBe('2026-11-23')
    expect(r!.email_date).toBe(sent.toISOString())
  })

  it('still reads the short "lun, 2 jun – jue, 5 jun" format, year from the email', () => {
    const text = [
      'Subject: Judah quiere hacer un cambio en su reservación',
      'Fechas originales',
      'lun, 29 dic – jue, 1 ene',
      'Fechas solicitadas',
      'mar, 30 dic – vie, 2 ene',
    ].join('\n')
    const r = parseChangeRequestEmail(text, new Date('2026-10-10T12:00:00Z'))
    expect(r!.check_in_to).toBe('2026-12-30')
    expect(r!.check_out_to).toBe('2027-01-02')
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
