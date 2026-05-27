/**
 * Gmail sync library — parses Airbnb confirmation emails and returns structured reservations.
 *
 * Gmail OAuth flow: we store a refresh_token in Supabase app_settings.
 * Each sync call exchanges it for a short-lived access_token.
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

// ─── Airbnb room ID → internal property UUID ─────────────────────────────────
// Update this map when adding new properties.
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

async function getMessagePlaintext(
  accessToken: string,
  messageId: string
): Promise<string> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) return ''
  const msg = await res.json() as GmailMessage

  // Try multipart/alternative parts first
  for (const part of msg.payload?.parts ?? []) {
    if (part.mimeType === 'text/plain' && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8')
    }
  }
  // Fallback to top-level body
  const data = msg.payload?.body?.data
  return data ? Buffer.from(data, 'base64').toString('utf-8') : ''
}

// ─── Email parser ─────────────────────────────────────────────────────────────

function parsePlaintext(text: string): Omit<ParsedReservation, 'property_id'> | null {
  // Skip update/cancellation emails
  if (!text.includes('Código de confirmación') && !text.includes('Confirmation code')) return null
  if (text.includes('cancelada') || text.includes('cancelled')) return null

  // Airbnb code
  const codeMatch = text.match(/(?:Código de confirmación|Confirmation code)[:\s]+([A-Z0-9]{8,12})/i)
  if (!codeMatch) return null
  const airbnb_code = codeMatch[1]

  // Guest name (first line pattern or "Ha reservado" pattern)
  const guestMatch =
    text.match(/(?:Huésped|Guest)[:\s]+([^\n]+)/i) ??
    text.match(/([A-Z][a-záéíóú]+(?:\s[A-Z][a-záéíóú]+)+)\s+ha reservado/i)
  if (!guestMatch) return null
  const guest_name = guestMatch[1].trim()

  // Check-in / check-out dates — format: "6 jun. 2026" or "6 de junio de 2026"
  const datePattern = /(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?\s+(?:de\s+)?(\d{4})/gi
  const dates: Date[] = []
  let match: RegExpExecArray | null

  while ((match = datePattern.exec(text)) !== null) {
    const d = parseSpanishDate(match[1], match[2], match[3])
    if (d) dates.push(d)
  }

  if (dates.length < 2) return null
  dates.sort((a, b) => a.getTime() - b.getTime())
  const check_in  = formatDate(dates[0])
  const check_out = formatDate(dates[dates.length - 1])

  // Amount
  const amountMatch = text.match(/(?:Total|Cobro del anfitrión|Host payout)[:\s]+\$?([\d.,]+)/i)
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.'))
    : 0

  // Guests count
  const guestsMatch = text.match(/(\d+)\s+(?:huéspedes?|guests?)/i)
  const guestCount = guestsMatch?.[1] ?? '?'

  // Cancellation policy
  const cancelMatch = text.match(/(?:Política de cancelación|Cancellation policy)[:\s]+([^\n]+)/i)
  const cancelPolicy = cancelMatch ? cancelMatch[1].trim() : 'No especificada'

  // Check-in/out times
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

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getRoomId(text: string): string | null {
  const match = text.match(/airbnb\.com\/rooms\/(\d+)/i)
  return match?.[1] ?? null
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchAirbnbReservations(
  accessToken: string,
  sinceDate: Date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
): Promise<ParsedReservation[]> {
  const yyyy = sinceDate.getFullYear()
  const mm   = String(sinceDate.getMonth() + 1).padStart(2, '0')
  const dd   = String(sinceDate.getDate()).padStart(2, '0')
  const query = `from:automated@airbnb.com subject:confirmación after:${yyyy}/${mm}/${dd}`

  const results: ParsedReservation[] = []
  let pageToken: string | undefined

  do {
    const { threads = [], nextPageToken } = await gmailSearch(accessToken, query, pageToken)
    pageToken = nextPageToken

    for (const thread of threads) {
      // Get messages in thread
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=minimal`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) continue
      const t = await res.json() as { messages?: Array<{ id: string }> }
      const firstMsgId = t.messages?.[0]?.id
      if (!firstMsgId) continue

      const text = await getMessagePlaintext(accessToken, firstMsgId)
      if (!text) continue

      const parsed = parsePlaintext(text)
      if (!parsed) continue

      const roomId = getRoomId(text)
      const property_id = roomId ? ROOM_TO_PROPERTY[roomId] : undefined
      if (!property_id) continue

      results.push({ ...parsed, property_id })
    }
  } while (pageToken)

  return results
}
