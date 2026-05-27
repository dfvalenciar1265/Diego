/**
 * Gmail sync library — parses Airbnb emails (both "confirmada" and "actualizada")
 * and returns structured data for the sync route.
 */

export interface ParsedReservation {
  airbnb_code: string
  property_id: string
  guest_name: string
  check_in: string   // YYYY-MM-DD
  check_out: string  // YYYY-MM-DD
  amount: number
  notes: string
  source: 'airbnb'
  status: 'confirmed'
}

/** From "Reservación actualizada" emails — no dates available */
export interface UpdatedReservationFlag {
  airbnb_code: string
  guest_name: string
}

export interface SyncEmailResult {
  confirmed: ParsedReservation[]
  updated: UpdatedReservationFlag[]
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
interface GmailMessagePart { mimeType: string; body: { data?: string } }
interface GmailMessage {
  payload?: {
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

  for (const part of msg.payload?.parts ?? []) {
    if (part.mimeType === 'text/plain' && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8')
    }
  }
  const data = msg.payload?.body?.data
  return data ? Buffer.from(data, 'base64').toString('utf-8') : ''
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

// ─── Email parsers ────────────────────────────────────────────────────────────

/**
 * Parses a "Reservación confirmada" plaintext body.
 * Returns null if the email can't be parsed or is a cancellation.
 */
export function parseConfirmationEmail(text: string): Omit<ParsedReservation, 'property_id'> | null {
  if (!text.includes('Código de confirmación') && !text.includes('Confirmation code')) return null
  if (text.includes('cancelada') || text.includes('cancelled')) return null

  // Airbnb code
  const codeMatch = text.match(/(?:Código de confirmación|Confirmation code)[:\s]+([A-Z0-9]{8,12})/i)
  if (!codeMatch) return null
  const airbnb_code = codeMatch[1]

  // Guest name
  const guestMatch =
    text.match(/(?:Huésped|Guest)[:\s]+([^\n]+)/i) ??
    text.match(/([A-Z][a-záéíóúñ]+(?:\s[A-Z][a-záéíóúñ]+)+)\s+ha reservado/i)
  if (!guestMatch) return null
  const guest_name = guestMatch[1].trim()

  // Dates — format: "6 jun. 2026" or "6 de junio de 2026"
  const datePattern = /(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)\.?\s+(?:de\s+)?(\d{4})/gi
  const dates: Date[] = []
  let match: RegExpExecArray | null

  while ((match = datePattern.exec(text)) !== null) {
    const d = parseSpanishDate(match[1], match[2], match[3])
    if (d) dates.push(d)
  }

  if (dates.length < 2) return null
  dates.sort((a, b) => a.getTime() - b.getTime())
  const check_in  = toISODate(dates[0])
  const check_out = toISODate(dates[dates.length - 1])

  // Amount
  const amountMatch = text.match(/(?:Total|Cobro del anfitrión|Host payout)[:\s]+\$?([\d.,]+)/i)
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.'))
    : 0

  // Guest count
  const guestsMatch = text.match(/(\d+)\s+(?:huéspedes?|guests?)/i)
  const guestCount = guestsMatch?.[1] ?? '?'

  // Cancellation policy
  const cancelMatch = text.match(/(?:Política de cancelación|Cancellation policy)[:\s]+([^\n]+)/i)
  const cancelPolicy = cancelMatch ? cancelMatch[1].trim() : 'No especificada'

  // Times
  const ciTimeMatch = text.match(/(?:Check-in|Llegada)[:\s]+(\d{1,2}(?::\d{2})?\s*[ap]m)/i)
  const coTimeMatch = text.match(/(?:Check-out|Salida)[:\s]+(\d{1,2}(?::\d{2})?\s*[ap]m)/i)

  const notes = [
    `Huéspedes: ${guestCount}`,
    `Cancelación: ${cancelPolicy}`,
    `Código: ${airbnb_code}`,
    ciTimeMatch ? `Check-in: ${ciTimeMatch[1]}` : 'Check-in: 3pm',
    coTimeMatch ? `Check-out: ${coTimeMatch[1]}` : 'Check-out: 12pm',
  ].join(' | ')

  return { airbnb_code, guest_name, check_in, check_out, amount, notes, source: 'airbnb', status: 'confirmed' }
}

/**
 * Parses a "Reservación actualizada" plaintext body.
 * These emails don't contain dates — only the code (in the URL) and guest name.
 */
export function parseUpdateEmail(text: string): UpdatedReservationFlag | null {
  if (!text.includes('SE ACTUALIZÓ') && !text.includes('actualizó la reservación')) return null

  // Code from the "Accede al itinerario" URL
  const codeMatch = text.match(/reservations\/details\/([A-Z0-9]{8,12})/i)
  if (!codeMatch) return null
  const airbnb_code = codeMatch[1]

  // Guest name from "SE ACTUALIZÓ LA RESERVACIÓN CON [NAME]"
  const nameMatch = text.match(/SE ACTUALIZÓ LA RESERVACIÓN CON ([^\n]+)/i)
  const guest_name = nameMatch ? nameMatch[1].trim() : 'Desconocido'

  return { airbnb_code, guest_name }
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

function getRoomId(text: string): string | null {
  return text.match(/airbnb\.com(?:\.co)?\/rooms\/(\d+)/i)?.[1] ?? null
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

  const confirmed: ParsedReservation[] = []
  const updated: UpdatedReservationFlag[] = []

  // Search for both types simultaneously with OR
  const query = `from:automated@airbnb.com {subject:confirmación subject:actualizada} ${dateFilter}`

  let pageToken: string | undefined
  do {
    const { threads = [], nextPageToken } = await gmailSearch(accessToken, query, pageToken)
    pageToken = nextPageToken

    for (const thread of threads) {
      const msgId = await getFirstMessageId(accessToken, thread.id)
      if (!msgId) continue

      const text = await getMessagePlaintext(accessToken, msgId)
      if (!text) continue

      // Determine email type by content
      if (text.includes('SE ACTUALIZÓ') || text.includes('actualizó la reservación')) {
        // "Reservación actualizada" — extract code for flagging
        const flag = parseUpdateEmail(text)
        if (flag) updated.push(flag)
      } else {
        // "Reservación confirmada" — parse fully
        const parsed = parseConfirmationEmail(text)
        if (!parsed) continue

        const roomId = getRoomId(text)
        const property_id = roomId ? ROOM_TO_PROPERTY[roomId] : undefined
        if (!property_id) continue

        confirmed.push({ ...parsed, property_id })
      }
    }
  } while (pageToken)

  return { confirmed, updated }
}

/**
 * Given an airbnb_code from an "actualizada" email, searches Gmail for the
 * original confirmation email and parses it. Returns null if not found.
 *
 * Used when an "actualizada" arrives for a reservation not yet in the DB.
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

    // Must be a confirmation email containing this exact code
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
