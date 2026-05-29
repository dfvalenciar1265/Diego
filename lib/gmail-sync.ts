/**
 * Gmail sync library — parses Airbnb emails (both "confirmada" and "actualizada")
 * and returns structured data for the sync route.
 *
 * Airbnb now sends HTML-only emails (no text/plain MIME part).  The helpers
 * below strip HTML to readable text so the same regex parsers work on both
 * old plaintext and new HTML-only emails.
 */

export interface ParsedReservation {
  airbnb_code: string
  property_id: string
  guest_name: string
  check_in: string   // YYYY-MM-DD
  check_out: string  // YYYY-MM-DD
  amount: number
  guests: number | null
  notes: string
  source: 'airbnb'
  status: 'confirmed'
}

/** From "Reservación actualizada" emails — no dates available */
export interface UpdatedReservationFlag {
  airbnb_code: string
  guest_name: string
}

/**
 * From "[Guest] quiere hacer un cambio en su reservación" emails.
 * These don't include the confirmation code, only the guest name, property
 * name, and what changed (guest count, dates, etc.).
 */
export interface ChangeRequestFlag {
  guest_name:        string   // first name extracted from subject / body
  property_name:     string   // e.g. "Palmetto 1001 · Apartamento moderno..."
  change_description: string  // human-readable summary of what changed
  alteration_url:    string   // deep-link to approve/reject in Airbnb
}

export interface SyncEmailResult {
  confirmed: ParsedReservation[]
  updated: UpdatedReservationFlag[]
  cancelled: string[]           // airbnb_codes to cancel
  change_requests: ChangeRequestFlag[]
  threads_fetched: number
  skipped_no_room: number
  d_empty_text: number
  d_not_airbnb: number
  d_parse_fail: number
  d_fail_code: number
  d_fail_guest: number
  d_fail_dates: number
}

// ─── Airbnb room ID → internal property UUID ─────────────────────────────────
const ROOM_TO_PROPERTY: Record<string, string> = {
  '890750079011887303': '6a878ed2-148b-4078-9f66-90aab3e76b19', // Tocahagua 708
  '775247629009003378': '66a7c1ee-2117-4178-890e-181cd904778c', // Tocahagua 1208
  '53952963':           '097d3266-e9d6-4ed0-a403-6dd051c5d042', // Palmetto 1001
  '772410685942787007': '823591d2-e4a9-4893-bd01-f1394a38545d', // Marina Rey 1104
  '857001462739188238': 'b73c70dd-204b-42f1-a1e1-674de53eca84', // Conquistador 1821
  '675576989308773376': '4b10f347-cf1b-4b89-81b6-b73c41d697a3', // Apto 1303
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

/**
 * Strips HTML to readable plain text.
 * - Inserts newlines at block-level closing tags (p, div, td, tr, h1-h6, li, br)
 * - Preserves href URLs inline so URL-based parsers still work
 * - Decodes common HTML entities
 */
function stripHtml(html: string): string {
  return html
    // Keep href URLs as plain text (update emails extract the code from the URL)
    .replace(/href="([^"]+)"/gi, 'href="$1" $1 ')
    // Newline at block-level closing tags
    .replace(/<\/(?:p|div|td|tr|h[1-6]|li)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, ' ')
    // Normalise whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Recursively searches a MIME part tree for the first part of the given type.
 * Returns the decoded UTF-8 string, or null if not found.
 */
function findMimePart(parts: GmailMessagePart[], mimeType: string): string | null {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body.data) {
      // Gmail uses base64url; convert to standard base64 before decoding
      const b64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/')
      return Buffer.from(b64, 'base64').toString('utf-8')
    }
    if (part.mimeType?.startsWith('multipart/') && part.parts) {
      const found = findMimePart(part.parts, mimeType)
      if (found) return found
    }
  }
  return null
}

// ─── Google OAuth token exchange ─────────────────────────────────────────────

export async function getAccessToken(refreshToken: string): Promise<string> {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token refresh failed: ${err}`)
  }
  const { access_token } = await res.json() as { access_token: string }
  return access_token
}

// ─── Gmail API helpers ────────────────────────────────────────────────────────

interface GmailThread { id: string }

interface GmailMessagePart {
  mimeType: string
  body: { data?: string }
  parts?: GmailMessagePart[]   // present for multipart/* parts
}

interface GmailMessage {
  payload?: {
    headers?: Array<{ name: string; value: string }>
    mimeType?: string
    parts?: GmailMessagePart[]
    body?: { data?: string }
  }
}

async function gmailSearch(
  accessToken: string,
  query: string,
  pageToken?: string
): Promise<{ threads: GmailThread[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: '50' })
  if (pageToken) params.set('pageToken', pageToken)
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`Gmail search failed: ${await res.text()}`)
  return res.json() as Promise<{ threads: GmailThread[]; nextPageToken?: string }>
}

/**
 * Fetches a message's readable body.
 *
 * Priority:
 *   1. text/plain MIME part  (older Airbnb emails)
 *   2. text/html MIME part stripped to plain text  (current Airbnb emails)
 *   3. Top-level body field (HTML stripped if needed)
 *
 * The email Subject header is prepended so parsers can extract the full
 * guest name from "Reservación confirmada: Nombre Apellido llega el X".
 */
export async function getMessagePlaintext(
  accessToken: string,
  messageId: string
): Promise<string> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return ''
  const msg = await res.json() as GmailMessage

  // Extract subject so parsers can get the full guest name from it
  const subject =
    msg.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value ?? ''

  const parts = msg.payload?.parts ?? []
  let body = ''

  const plain = findMimePart(parts, 'text/plain')
  if (plain) {
    body = plain
  } else {
    const html = findMimePart(parts, 'text/html')
    if (html) {
      body = stripHtml(html)
    } else {
      // Fallback: top-level body (may be HTML)
      const data = msg.payload?.body?.data
      if (data) {
        const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(b64, 'base64').toString('utf-8')
        body = decoded.trimStart().startsWith('<') ? stripHtml(decoded) : decoded
      }
    }
  }

  // Prepend subject line so guest-name regex can use it
  return subject ? `Subject: ${subject}\n\n${body}` : body
}

/** Fetches first message ID from a thread */
async function getFirstMessageId(accessToken: string, threadId: string): Promise<string | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=minimal`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return null
  const t = await res.json() as { messages?: Array<{ id: string }> }
  return t.messages?.[0]?.id ?? null
}

// ─── Date utilities ───────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
}

function parseSpanishDate(day: string, month: string, year: string): Date | null {
  const m = MONTH_MAP[month.toLowerCase()]
  if (!m) return null
  return new Date(Number(year), m - 1, Number(day))
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * When HTML-stripped emails omit the year, infer it:
 *   - Month ≥ current month → current year  (upcoming)
 *   - Month < current month by ≤ 3 → current year  (recent past)
 *   - Month < current month by > 3 → next year  (far-future booking)
 */
function inferReservationYear(month: number): number {
  const now = new Date()
  const currentYear  = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  if (month >= currentMonth) return currentYear
  return currentMonth - month > 3 ? currentYear + 1 : currentYear
}

function getRoomId(text: string): string | null {
  return text.match(/airbnb\.com(?:\.co)?\/rooms\/(\d+)/i)?.[1] ?? null
}

// ─── Email parsers ────────────────────────────────────────────────────────────

// Internal step-failure counters — populated by parseConfirmationEmail, consumed by fetchAirbnbEmails.
// Not exported; only mutated within a single call stack (not concurrent-safe, but good enough for
// debug diagnostics in this single-tenant app).
let _stepCounters = { failCode: 0, failGuest: 0, failDates: 0 }

/**
 * Parses a "Reservación confirmada" email body (plaintext OR HTML-stripped).
 * Returns null if the email can't be parsed or is a cancellation.
 */
export function parseConfirmationEmail(text: string): Omit<ParsedReservation, 'property_id'> | null {
  // Case-insensitive guard — Airbnb now sends ALL-CAPS headers ("CÓDIGO DE CONFIRMACIÓN")
  const textLc = text.toLowerCase()
  if (!textLc.includes('código de confirmación') && !textLc.includes('confirmation code')) return null

  // Skip actual cancellation emails — these are handled by parseCancellationEmail().
  // IMPORTANT: Do NOT use a broad .includes('cancelada') — every confirmation email's
  // cancellation-policy section says "noches canceladas" which would false-positive here.
  // Only match phrases that appear exclusively in cancellation notification emails.
  const isCancelled =
    /^subject:\s*cancelada:/im.test(text) ||          // Airbnb subject line format
    /reservaci[oó]n\s+cancelada\b/i.test(text) ||
    /booking\s+cancell/i.test(text) ||
    /\bha\s+cancelado\s+su\s+reserva/i.test(text) ||
    /your\s+reservation\s+has\s+been\s+cancell/i.test(text) ||
    /estas\s+fechas\s+est[aá]n\s+disponibles/i.test(text)
  if (isCancelled) return null

  // ── Airbnb confirmation code ──────────────────────────────────────────────
  // Old plaintext: "Código de confirmación: HMXXXXXX"
  // New HTML:      "Código de confirmación\nHMXXXXXX" (code on next line)
  const codeMatch =
    text.match(/(?:Código de confirmación|Confirmation code)[:\s]+([A-Z0-9]{8,12})/i) ??
    text.match(/(?:Código de confirmación|Confirmation code)\s*\n\s*([A-Z0-9]{8,12})/i)
  if (!codeMatch) { _stepCounters.failCode++; return null }
  const airbnb_code = codeMatch[1]

  // ── Guest name ────────────────────────────────────────────────────────────
  // Priority order (most reliable → least):
  //   1. Subject line: "Reservación confirmada: Nombre Apellido llega el X"
  //      (most reliable — full name, always present)
  //   2. Plaintext label: "Huésped: Nombre" or "Guest: Nombre"
  //      (require colon so "EL HUÉSPED PAGÓ" doesn't match as "name = PAGÓ")
  //   3. Body: "Nombre Apellido ha reservado"
  const guestMatch =
    text.match(/(?:Reservaci[oó]n\s+confirmada|Nueva\s+reservaci[oó]n)[:\s!*]+([A-ZÁÉÍÓÚÑa-záéíóúñ][^\n:]+?)\s+llega/i) ??
    text.match(/(?:Huésped|Guest):\s*([^\n]+)/i) ??
    text.match(/([A-Z][a-záéíóúñ]+(?:\s[A-Z][a-záéíóúñ]+)+)\s+ha reservado/i)
  if (!guestMatch) { _stepCounters.failGuest++; return null }
  const guest_name = guestMatch[1].trim()

  // ── Dates ─────────────────────────────────────────────────────────────────
  // Format 1 (plaintext): "6 jun. 2026" or "6 de junio de 2026"
  // Format 2 (HTML-stripped): "mar, 26 may" or "jue, 28 may" (no year → infer)
  const dates: Date[] = []
  let match: RegExpExecArray | null

  const fullDatePattern = /(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)\.?\s+(?:de\s+)?(\d{4})/gi
  while ((match = fullDatePattern.exec(text)) !== null) {
    const d = parseSpanishDate(match[1], match[2], match[3])
    if (d) dates.push(d)
  }

  if (dates.length < 2) {
    // Try HTML short format: "día-semana, DD MMM"
    dates.length = 0
    const shortDatePattern =
      /(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun)[,.]?\s*(\d{1,2})\s+([a-záéíóúñ]+)/gi
    while ((match = shortDatePattern.exec(text)) !== null) {
      const m = MONTH_MAP[match[2].toLowerCase()]
      if (!m) continue
      const year = inferReservationYear(m)
      dates.push(new Date(year, m - 1, Number(match[1])))
    }
  }

  if (dates.length < 2) { _stepCounters.failDates++; return null }
  dates.sort((a, b) => a.getTime() - b.getTime())
  const check_in  = toISODate(dates[0])
  const check_out = toISODate(dates[dates.length - 1])

  // ── Amount (host payout) ──────────────────────────────────────────────────
  // Prefer "GANAS $X" (net host payout after Airbnb fees) in the new email format.
  // Fallback to "Total" or "Cobro al/del anfitrión" for older format.
  const amountMatch =
    text.match(/GANAS\s+\$?([\d.,]+)/i) ??
    text.match(/(?:Total|Cobro\s+(?:del|al)\s+anfitri[oó]n|Host\s+payout)[^\d$\n]*(?:\n[^\d$\n]*)?\$?([\d.,]+)/i)

  // Parse COP amount — handle all separator conventions:
  //   1,221,443.11   (US multi-comma: comma=thou, dot=dec)  → 1221443
  //   1,220,000      (US multi-comma: comma=thou)            → 1220000
  //   992,851.85     (US single-comma + dot: X,XXX.XX)      → 992852
  //   1.220.000      (EU multi-dot: dot=thou)                → 1220000
  //   335.352,59     (EU: X.XXX,XX → dot=thou, comma=dec)   → 335352.59
  //   509,73         (EU decimal: comma=dec, 2 digits)       → 509.73
  const amount = (() => {
    if (!amountMatch) return 0
    const raw = amountMatch[1]
    const commas = (raw.match(/,/g) ?? []).length
    const dots   = (raw.match(/\./g) ?? []).length

    // Multiple commas → US thousands separators: 1,221,443.11 or 1,220,000
    if (commas > 1) {
      return Math.round(parseFloat(raw.replace(/,/g, ''))) || 0
    }
    // Multiple dots → EU thousands separators: 1.220.000
    if (dots > 1) {
      return parseInt(raw.replace(/[.,]/g, ''), 10) || 0
    }
    // Single comma followed by exactly 3 digits then dot or end → US thousands
    // e.g. 992,851.85 or 509,733
    if (/,\d{3}(\.|$)/.test(raw)) {
      return Math.round(parseFloat(raw.replace(/,/g, ''))) || 0
    }
    // Single dot followed by exactly 3 digits then comma or end → EU thousands
    // e.g. 335.352,59
    if (/\.\d{3}(,|$)/.test(raw)) {
      return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0
    }
    // Ambiguous or simple decimal: 509,73 (EU) → 509.73
    return parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0
  })()

  // ── Guest count ───────────────────────────────────────────────────────────
  // Try multiple patterns: "2 huéspedes", "Viajeros: 2", "Adultos: 2 niños: 1"
  const guestsMatch =
    text.match(/(\d+)\s+(?:huéspedes?|guests?|viajeros?)/i) ??
    text.match(/(?:viajeros?|huéspedes?|guests?)[:\s]+(\d+)/i) ??
    text.match(/(?:adultos?)[:\s]+(\d+)/i)
  const guests: number | null = guestsMatch ? parseInt(guestsMatch[1], 10) : null

  // ── Cancellation policy ───────────────────────────────────────────────────
  const cancelMatch = text.match(/(?:Política de cancelación|Cancellation policy)[:\s]+([^\n]+)/i)
  const cancelPolicy = cancelMatch ? cancelMatch[1].trim() : 'No especificada'

  // ── Times — extracted from email for prepopulating task cards ────────────
  const ciTimeMatch = text.match(/(?:Check-in|Llegada)[:\s\n]+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i)
  const coTimeMatch = text.match(/(?:Check-out|Salida)[:\s\n]+(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i)

  // Notes: only store times (used by task cards) + cancellation policy.
  // Guests/code are now dedicated columns; times are needed for CleaningView/PrepTaskCard.
  const notes = [
    ciTimeMatch ? `Check-in: ${ciTimeMatch[1]}` : 'Check-in: 3pm',
    coTimeMatch ? `Check-out: ${coTimeMatch[1]}` : 'Check-out: 12pm',
    `Cancelación: ${cancelPolicy}`,
  ].join(' | ')

  return { airbnb_code, guest_name, check_in, check_out, amount, guests, notes, source: 'airbnb', status: 'confirmed' }
}

/**
 * Parses a "Reservación cancelada" email and extracts the confirmation code.
 * Returns the airbnb_code to cancel, or null if not a cancellation email.
 */
export function parseCancellationEmail(text: string): string | null {
  // Primary: Airbnb's actual format — "Subject: Cancelada: reservación HMXXXX del…"
  const subjectCodeMatch = text.match(/^subject:\s*cancelada:\s*reservaci[oó]n\s+([A-Z0-9]{6,12})\b/im)
  if (subjectCodeMatch) return subjectCodeMatch[1].toUpperCase()

  // Fallback patterns (body text or other formats)
  const codeMatch =
    text.match(/[Cc]ódigo de confirmación[:\s\n]+([A-Z0-9]{8,12})/i) ??
    text.match(/[Cc]onfirmation [Cc]ode[:\s\n]+([A-Z0-9]{8,12})/i) ??
    text.match(/reservations\/details\/([A-Z0-9]{8,12})/i) ??
    text.match(/\b(HM[A-Z0-9]{6,10})\b/)
  return codeMatch ? codeMatch[1].toUpperCase() : null
}

/**
 * Parses a "Reservación actualizada" email body (plaintext OR HTML-stripped).
 * These emails don't contain dates — only the code (in the URL) and guest name.
 */
export function parseUpdateEmail(text: string): UpdatedReservationFlag | null {
  const textLc = text.toLowerCase()
  if (!textLc.includes('actualizó la reservación') && !textLc.includes('se actualizó')) return null

  // Code from the "Accede al itinerario" URL (preserved by stripHtml via href extraction)
  const codeMatch = text.match(/reservations\/details\/([A-Z0-9]{8,12})/i)
  if (!codeMatch) return null
  const airbnb_code = codeMatch[1]

  // Guest name: "SE ACTUALIZÓ LA RESERVACIÓN CON [Name]"
  const nameMatch = text.match(/(?:SE ACTUALIZÓ|se actualizó|actualizó)\s+la\s+reservaci[oó]n\s+con\s+([^\n]+)/i)
  const guest_name = nameMatch ? nameMatch[1].trim().split(/\s{2,}/)[0] : 'Desconocido'

  return { airbnb_code, guest_name }
}

/**
 * Parses a "[Guest] quiere hacer un cambio en su reservación" email.
 * These emails have no confirmation code — the host must act via Airbnb.
 */
export function parseChangeRequestEmail(text: string): ChangeRequestFlag | null {
  const textLc = text.toLowerCase()
  if (!textLc.includes('quiere hacer un cambio') && !textLc.includes('wants to make a change')) return null

  // ── Guest name ─────────────────────────────────────────────────────────
  // Subject: "Judah quiere hacer un cambio en su reservación"
  const nameMatch =
    text.match(/Subject:\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][^\n]+?)\s+quiere\s+hacer\s+un\s+cambio/i) ??
    text.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)\s+QUIERE\s+HACER\s+UN\s+CAMBIO/m) ??
    text.match(/([A-ZÁÉÍÓÚÑa-záéíóúñ][^\n]+?)\s+quiere\s+hacer\s+un\s+cambio/i)
  const guest_name = nameMatch ? nameMatch[1].trim() : 'Desconocido'

  // ── Property name ───────────────────────────────────────────────────────
  // After the city line ("Cartagena\nPalmetto 1001 · …")
  const propMatch = text.match(
    /(?:Cartagena|Medell[ií]n|Bogot[aá]|Barranquilla|Santa\s+Marta)[^\n]*\n+([^\n]+)/i
  )
  const property_name = propMatch ? propMatch[1].trim() : ''

  // ── What changed ────────────────────────────────────────────────────────
  // Guest-count change: "Huéspedes originales\n1 huésped\nHuéspedes solicitados\n3 huéspedes"
  // Date change: "Fechas originales\nlun, 2 jun – jue, 5 jun\nFechas solicitadas\nmar, 3 jun – vie, 6 jun"
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  function nextNonEmpty(keyword: RegExp): string {
    const i = lines.findIndex(l => keyword.test(l))
    return i >= 0 && i + 1 < lines.length ? lines[i + 1] : ''
  }

  const origGuests = nextNonEmpty(/hu[eé]spedes?\s+originales/i)
  const reqGuests  = nextNonEmpty(/hu[eé]spedes?\s+solicitados/i)
  const origDates  = nextNonEmpty(/fechas?\s+originales/i)
  const reqDates   = nextNonEmpty(/fechas?\s+solicitadas/i)

  let change_description = ''
  if (origGuests && reqGuests)   change_description += `Huéspedes: ${origGuests} → ${reqGuests}`
  if (origDates  && reqDates)    change_description += `${change_description ? ' | ' : ''}Fechas: ${origDates} → ${reqDates}`
  if (!change_description)       change_description = 'Ver solicitud en Airbnb'

  // ── Deep-link to approve/reject ─────────────────────────────────────────
  const urlMatch = text.match(/airbnb\.com(?:\.co)?\/reservation\/alteration\/(\d+)/i)
  const alteration_url = urlMatch
    ? `https://www.airbnb.com.co/reservation/alteration/${urlMatch[1]}`
    : 'https://www.airbnb.com.co/hosting/reservations'

  return { guest_name, property_name, change_description, alteration_url }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches and parses all Airbnb emails (both confirmadas and actualizadas)
 * from Gmail for the last `sinceDate` period.
 */
export async function fetchAirbnbEmails(
  accessToken: string,
  sinceDate: Date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
): Promise<SyncEmailResult> {
  const yyyy = sinceDate.getFullYear()
  const mm   = String(sinceDate.getMonth() + 1).padStart(2, '0')
  const dd   = String(sinceDate.getDate()).padStart(2, '0')
  const dateFilter = `after:${yyyy}/${mm}/${dd}`

  const confirmed: ParsedReservation[]    = []
  const updated:   UpdatedReservationFlag[] = []
  const cancelled: string[]               = []
  const change_requests: ChangeRequestFlag[] = []
  let threadsFetched = 0
  let skippedNoRoom = 0
  let dEmptyText = 0
  let dNotAirbnb = 0
  let dParseFail = 0
  // Reset step-level counters for this run
  _stepCounters = { failCode: 0, failGuest: 0, failDates: 0 }

  // Broad search: all emails from Airbnb's automated sender.
  // Subject filters miss HTML-only emails with different wording; content parsing filters.
  const query = `from:automated@airbnb.com ${dateFilter}`

  let pageToken: string | undefined
  do {
    const { threads = [], nextPageToken } = await gmailSearch(accessToken, query, pageToken)
    pageToken = nextPageToken
    threadsFetched += threads.length

    for (const thread of threads) {
      const msgId = await getFirstMessageId(accessToken, thread.id)
      if (!msgId) continue

      const text = await getMessagePlaintext(accessToken, msgId)
      if (!text) { dEmptyText++; continue }

      // Determine email type by content (case-insensitive — Airbnb uses ALL CAPS in some formats)
      const textLc = text.toLowerCase()
      const isUpdate        = textLc.includes('actualizó la reservación') || textLc.includes('se actualizó')
      const isConfirm       = textLc.includes('código de confirmación') || textLc.includes('confirmation code')
      const isChangeRequest = textLc.includes('quiere hacer un cambio') || textLc.includes('wants to make a change')
      // Airbnb cancellation emails have "Cancelada:" in the Subject line
      // and "Estas fechas están disponibles" in the body — NOT "reservación cancelada"
      const isCancellation  =
        /^subject:\s*cancelada:/im.test(text) ||           // "Cancelada: reservación HMXXXX"
        /reservaci[oó]n\s+cancelada\b/i.test(text) ||
        /booking\s+cancell/i.test(text) ||
        /\bha\s+cancelado\s+su\s+reserva/i.test(text) ||
        /your\s+reservation\s+has\s+been\s+cancell/i.test(text) ||
        /estas\s+fechas\s+est[aá]n\s+disponibles/i.test(text)  // body text of cancellation

      if (!isUpdate && !isConfirm && !isChangeRequest && !isCancellation) { dNotAirbnb++; continue }

      if (isCancellation) {
        const code = parseCancellationEmail(text)
        if (code) cancelled.push(code)
        continue
      }

      if (isUpdate) {
        const flag = parseUpdateEmail(text)
        if (flag) updated.push(flag)
      } else if (isChangeRequest) {
        const req = parseChangeRequestEmail(text)
        if (req) change_requests.push(req)
      } else {
        const parsed = parseConfirmationEmail(text)
        if (!parsed) { dParseFail++; continue }

        const roomId = getRoomId(text)
        const property_id = roomId ? ROOM_TO_PROPERTY[roomId] : undefined
        if (!property_id) { skippedNoRoom++; continue }

        confirmed.push({ ...parsed, property_id })
      }
    }
  } while (pageToken)

  return {
    confirmed, updated, cancelled, change_requests,
    threads_fetched: threadsFetched,
    skipped_no_room: skippedNoRoom,
    d_empty_text: dEmptyText,
    d_not_airbnb: dNotAirbnb,
    d_parse_fail: dParseFail,
    d_fail_code: _stepCounters.failCode,
    d_fail_guest: _stepCounters.failGuest,
    d_fail_dates: _stepCounters.failDates,
  }
}

/**
 * Given an airbnb_code from an "actualizada" email, searches Gmail for the
 * original confirmation email and parses it. Returns null if not found.
 */
export async function fetchConfirmationByCode(
  accessToken: string,
  code: string
): Promise<ParsedReservation | null> {
  const query = `from:automated@airbnb.com ${code}`
  const { threads = [] } = await gmailSearch(accessToken, query)

  for (const thread of threads) {
    const msgId = await getFirstMessageId(accessToken, thread.id)
    if (!msgId) continue
    const text = await getMessagePlaintext(accessToken, msgId)
    if (!text) continue

    if (!text.includes(code)) continue
    if (text.includes('SE ACTUALIZÓ') || text.includes('actualizó')) continue

    const parsed = parseConfirmationEmail(text)
    if (!parsed || parsed.airbnb_code !== code) continue

    const roomId = getRoomId(text)
    const property_id = roomId ? ROOM_TO_PROPERTY[roomId] : undefined
    if (!property_id) return null

    return { ...parsed, property_id }
  }
  return null
}
