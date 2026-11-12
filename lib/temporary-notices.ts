import { isIsoDate } from './gpt-api/dates'
export interface TemporaryNotice {
  id: string; property_id: string; title: string; message: string; expires_on: string;
  locations: string[]; status: 'open' | 'retired'; evidence: string | null; version: number;
  updated_at: string; updated_by: string;
}
export function noticeNeedsReview(notice: Pick<TemporaryNotice, 'status' | 'expires_on'>, today: string) {
  return notice.status === 'open' && notice.expires_on < today
}
export function validateTemporaryNotice(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Datos inválidos.'
  const v = input as Record<string, unknown>
  if (typeof v.property_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.property_id)) return 'Selecciona el apartamento.'
  if (typeof v.title !== 'string' || v.title.trim().length < 3 || v.title.length > 150) return 'Revisa el título.'
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > 2000) return 'Revisa el texto del aviso.'
  if (typeof v.expires_on !== 'string' || !isIsoDate(v.expires_on)) return 'Indica la fecha de revisión.'
  if (!Array.isArray(v.locations) || !v.locations.length || v.locations.length > 20 || v.locations.some(x => typeof x !== 'string' || !x.trim() || x.length > 300)) return 'Indica dónde está publicado (hasta 20 ubicaciones).'
  if (!['open', 'retired'].includes(String(v.status))) return 'Estado inválido.'
  if (v.status === 'retired' && (typeof v.evidence !== 'string' || v.evidence.trim().length < 10 || v.evidence.length > 500)) return 'Describe cómo comprobaste el retiro en todas las ubicaciones.'
  return null
}
