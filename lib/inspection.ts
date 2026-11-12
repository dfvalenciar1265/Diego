/** Revisión física por llegada. No confirma automáticamente limpieza ni apartamento listo. */
import { addDays } from './gpt-api/dates'
import type { UserRole } from './types'
export const INSPECTION_ITEMS = [
  { key: 'air', label: 'Aires y controles', hint: 'Probar enfriamiento y regulación en sala y habitaciones; indicar lo que no aplica.' },
  { key: 'lights', label: 'Luces', hint: 'Probar interruptores y luminarias.' },
  { key: 'water', label: 'Agua', hint: 'Probar grifos, ducha y desagües; revisar fugas.' },
  { key: 'linen', label: 'Ropa de cama y toallas', hint: 'Comprobar limpieza, estado y cantidad para la llegada.' },
  { key: 'utensils', label: 'Utensilios', hint: 'Comprobar vajilla y utensilios necesarios para el grupo.' },
] as const
export type InspectionItem = typeof INSPECTION_ITEMS[number]['key']
export type InspectionResult = 'checked' | 'issue' | 'not_applicable'
export interface InspectionCheck {
  result: InspectionResult; note: string; actor_id: string; author: string; at: string
  photo_path: string | null; maintenance_id: string | null
}
export interface InspectionState {
  reservation_id: string; property_id: string; stay_check_in: string; stay_check_out: string
  version: number; invalidated_at: string | null; checks: Partial<Record<InspectionItem, InspectionCheck>>
}
export interface InspectionStay { id: string; property_id: string; check_in: string; check_out: string; status: string }
export interface InspectionWrite {
  reservation_id: string; property_id: string; stay_check_in: string; stay_check_out: string
  item: InspectionItem; result: InspectionResult; note: string; photo_path?: string | null
  expected_version: number; request_key: string
}
export const canInspect = (role: UserRole) => ['admin', 'anfitrion', 'cleaning', 'maintenance'].includes(role)
export const inspectionCurrent = (state: InspectionState | null, stay: InspectionStay) => Boolean(state && !state.invalidated_at
  && state.property_id === stay.property_id && state.stay_check_in === stay.check_in && state.stay_check_out === stay.check_out && stay.status === 'confirmed')
export function inspectionWindow(stay: InspectionStay, today: string) {
  return stay.status === 'confirmed' && today >= addDays(stay.check_in, -1) && today <= stay.check_in
}
export function inspectionProgress(state: InspectionState | null, stay: InspectionStay) {
  const checks = inspectionCurrent(state, stay) ? state!.checks : {}
  return { checked: INSPECTION_ITEMS.filter(i => checks[i.key]).length, problems: INSPECTION_ITEMS.filter(i => checks[i.key]?.result === 'issue').length, total: INSPECTION_ITEMS.length }
}
export const INSPECTION_PHOTO_BUCKET = 'inspection-evidence'
export const INSPECTION_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export function inspectionPhotoExtension(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'png'
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'webp'
  return null
}
