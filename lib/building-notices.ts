import { buildGuestNotification, mailtoLink, waLink } from './building-contacts'
import { isIsoDate } from './gpt-api/dates'

export type NoticeStatus = 'prepared' | 'uncertain' | 'sent' | 'delivered' | 'received'
export type NoticeAction = 'uncertain' | 'sent' | 'delivered' | 'received' | 'reviewed'
export interface BuildingRecipient {
  id: string
  property_id: string
  channel: 'whatsapp' | 'email'
  address: string
  version: number
  verified_at: string | null
  verified_by: string | null
  verification_evidence: string | null
}
export interface NoticeSnapshot {
  template_version: 1
  property_id: string
  apartment: string
  guest_name: string
  guests: number | null
  check_in: string
  check_out: string
  recipient_id: string
  channel: 'whatsapp' | 'email'
  address: string
  recipient_version: number
}
export interface BuildingNotice {
  id: string
  reservation_id: string
  recipient_id: string
  content_version: number
  snapshot: NoticeSnapshot
  status: NoticeStatus
  version: number
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  received_at: string | null
  review_reason: string | null
}
export interface BuildingNoticeEvent {
  id: string
  notice_id: string | null
  recipient_id: string
  action: string
  author: string
  source: string
  at: string
  occurred_at: string | null
  evidence: string | null
}
export interface BuildingNoticeObservation {
  id: string
  reservation_id: string
  recipient_id: string
  snapshot: NoticeSnapshot
  status: 'sent' | 'delivered' | 'received'
  occurred_at: string
  recorded_at: string
  actor_id: string
  author: string
  evidence: string
  reference: string
  version: number
  invalidated_at?: string | null
}
export interface BuildingNoticeView {
  reservation: { id: string; property_id: string; guest_name: string; guests: number | null; check_in: string; check_out: string; status: string }
  property: string
  recipients: BuildingRecipient[]
  observations?: BuildingNoticeObservation[]
  notices: BuildingNotice[]
  history: BuildingNoticeEvent[]
  legacy_marks: { task_id: string; at: string }[]
  blockers: string[]
}
export const NOTICE_LABELS: Record<NoticeStatus, string> = {
  prepared: 'Preparado', uncertain: 'Resultado incierto', sent: 'Envío registrado',
  delivered: 'Entrega acreditada', received: 'Recepción confirmada',
}
export const NOTICE_HISTORY_LABELS: Record<string, string> = {
  historical_invalidated: 'Evidencia histórica no vigente por cambios',
  historical_sent: 'Envío histórico acreditado', historical_delivered: 'Entrega histórica acreditada', historical_received: 'Recepción histórica acreditada',
  candidate_imported: 'Contacto anterior pendiente de verificar', recipient_verified: 'Destinatario verificado',
  prepared: 'Borrador preparado', prepared_reused: 'Borrador consultado de nuevo',
  uncertain: 'Resultado incierto', sent: 'Envío registrado', delivered: 'Entrega acreditada',
  received: 'Recepción confirmada', reviewed: 'Vigencia revisada', invalidated: 'Requiere revisión por cambios',
}
export const NOTICE_SOURCE_LABELS: Record<string, string> = {
  app: 'AirAdmin', mcp: 'Asistente conectado', system: 'Actualización de datos', legacy_code: 'Configuración anterior',
}
export function noticeSnapshot(view: BuildingNoticeView, recipient: BuildingRecipient): NoticeSnapshot {
  const r = view.reservation
  return { template_version: 1, property_id: r.property_id, apartment: view.property, guest_name: r.guest_name,
    guests: r.guests, check_in: r.check_in, check_out: r.check_out,
    recipient_id: recipient.id, channel: recipient.channel, address: recipient.address, recipient_version: recipient.version }
}
export function noticeBlockers(view: Pick<BuildingNoticeView, 'reservation' | 'property'>): string[] {
  const r = view.reservation
  const reasons: string[] = []
  if (r.status !== 'confirmed') reasons.push('La reserva no está confirmada.')
  if (!view.property.trim() || !r.guest_name?.trim() || r.guest_name.trim() === '—') reasons.push('Falta el apartamento o el titular.')
  if (!Number.isInteger(r.guests) || (r.guests ?? 0) < 1) reasons.push('Falta confirmar el número de huéspedes.')
  if (!isIsoDate(r.check_in) || !isIsoDate(r.check_out) || r.check_out <= r.check_in) reasons.push('Revisa las fechas de entrada y salida.')
  if (/[\r\n\u0000-\u001f]/.test(r.guest_name + view.property)) reasons.push('El titular o apartamento contiene caracteres inválidos.')
  return reasons
}
export function sameSnapshot(a: NoticeSnapshot, b: NoticeSnapshot): boolean {
  return (Object.keys(a) as (keyof NoticeSnapshot)[]).every(k => a[k] === b[k])
    && Object.keys(a).length === Object.keys(b).length
}
export function noticeMessage(snapshot: NoticeSnapshot) {
  return buildGuestNotification({ apartment: snapshot.apartment, guestName: snapshot.guest_name,
    guests: snapshot.guests, checkIn: snapshot.check_in, checkOut: snapshot.check_out })
}
/** Una observación acredita solo el contenido y destinatario exactos que se comprobaron. */
export function currentBuildingObservation(view: BuildingNoticeView, recipient: BuildingRecipient) {
  return view.observations?.find(o => !o.invalidated_at && o.recipient_id === recipient.id && sameSnapshot(o.snapshot, noticeSnapshot(view, recipient)))
}
/** El enlace se ofrece únicamente para un borrador vigente y un destinatario verificado. */
export function noticeDraftLink(view: BuildingNoticeView, recipient: BuildingRecipient, notice: BuildingNotice): string | null {
  if (currentBuildingObservation(view, recipient) || view.blockers.length || !recipient.verified_at || notice.status !== 'prepared' || notice.review_reason
    || !sameSnapshot(notice.snapshot, noticeSnapshot(view, recipient))) return null
  const message = noticeMessage(notice.snapshot)
  return recipient.channel === 'whatsapp' ? waLink(recipient.address, message.whatsappText)
    : mailtoLink(recipient.address, message.emailSubject, message.emailBody)
}
export function bogotaDateTimeLocal(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const value = (key: string) => parts.find(p => p.type === key)!.value
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}
