import { format, parseISO, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'

export type BuildingContact = { method: 'whatsapp' | 'email'; targets: string[] }

/**
 * Building/porter contact per apartment, for the guest-entry authorization.
 * Keys MUST match property names in the DB exactly. WhatsApp numbers are stored
 * in wa.me form (country code + number, no + or spaces).
 */
export const BUILDING_CONTACTS: Record<string, BuildingContact> = {
  'Marina Rey 1104':   { method: 'whatsapp', targets: ['573053591169'] },
  'Tocahagua 1208':    { method: 'whatsapp', targets: ['573117135074'] },
  'Tocahagua 708':     { method: 'whatsapp', targets: ['573117135074'] },
  'Apto 1303':         { method: 'whatsapp', targets: ['573014401513'] },                       // "Torres 1303"
  'Conquistador 1821': { method: 'email',    targets: ['Reservas.edificioelconquistador@gmail.com'] },
  'Palmetto 1001':     { method: 'whatsapp', targets: ['573054500773', '573218905525'] },
}

export interface GuestNotifyData {
  apartment: string
  guestName: string
  checkIn:   string   // YYYY-MM-DD
  checkOut:  string   // YYYY-MM-DD
  guests:    number | null
}

export interface GuestNotification {
  whatsappText: string
  emailSubject: string
  emailBody:    string
}

const longDate  = (iso: string) => format(parseISO(iso), "d 'de' MMMM 'de' yyyy", { locale: es })
const shortDate = (iso: string) => format(parseISO(iso), 'd MMM', { locale: es })
const nightsBetween = (ci: string, co: string) => Math.max(0, differenceInDays(parseISO(co), parseISO(ci)))

/** Builds both message variants (WhatsApp short + formal email) from a reservation. */
export function buildGuestNotification(d: GuestNotifyData): GuestNotification {
  const nights = nightsBetween(d.checkIn, d.checkOut)
  const guestsCount = `${d.guests ?? '—'}`

  const whatsappText =
`Hola 👋 Les confirmamos el ingreso de huéspedes a *${d.apartment}*:

👤 ${d.guestName}
👥 ${guestsCount} huéspedes
📅 ${shortDate(d.checkIn)} → ${shortDate(d.checkOut)} (${nights} noches)

Autorizado por Casa Blue ☀️ ¡Gracias!`

  const emailSubject = `Autorización de ingreso de huéspedes - ${d.apartment}`

  const emailBody =
`Estimados,

Por medio de la presente, autorizo el ingreso y estadía de los siguientes huéspedes al ${d.apartment}, del ${longDate(d.checkIn)} al ${longDate(d.checkOut)}:

Huésped: ${d.guestName}
N.º de huéspedes: ${guestsCount}
Total: ${nights} noches

Agradecemos su colaboración con el ingreso de los huéspedes.

Cordialmente,
☀️ Casa Blue`

  return { whatsappText, emailSubject, emailBody }
}

/** wa.me deep link with the message pre-filled (user taps Send). */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}

/** mailto link with subject + body pre-filled (opens the mail app; user taps Send). */
export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
