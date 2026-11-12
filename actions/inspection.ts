'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/gpt-api/validate'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { readInspection, writeInspection } from '@/lib/gpt-api/inspection'
import { canInspect, inspectionWindow, INSPECTION_PHOTO_BUCKET, INSPECTION_PHOTO_MAX_BYTES, inspectionPhotoExtension, type InspectionWrite } from '@/lib/inspection'
export async function saveInspection(input: InspectionWrite) {
  const member = await getCurrentMember()
  if (!member || !canInspect(member.role)) return { ok: false, error: 'No tienes permiso para registrar la revisión.' }
  const db = await createClient()
  const result = await writeInspection(db, input)
  if (!result.ok) return result
  const verified = await readInspection(db, input.reservation_id)
  revalidatePath('/inspections'); revalidatePath('/'); revalidatePath('/maintenance'); revalidatePath('/tasks')
  const check = verified.state?.checks[input.item]
  if (verified.error || !verified.state || !result.data || verified.state.version < result.data.version
    || verified.state.invalidated_at || verified.state.property_id !== input.property_id
    || verified.state.stay_check_in !== input.stay_check_in || verified.state.stay_check_out !== input.stay_check_out
    || !check || check.actor_id !== member.id || check.result !== input.result || check.note !== input.note.trim()
    || check.photo_path !== (input.photo_path ?? null)) return { ok: false, error: 'El registro fue aceptado, pero no se pudo releer. Actualiza antes de repetir.' }
  return { ...result, data: verified.state }
}
export async function uploadInspectionPhoto(form: FormData) {
  const member = await getCurrentMember()
  const id = String(form.get('reservation_id') ?? '')
  const file = form.get('photo')
  if (!member || !canInspect(member.role) || !isUuid(id) || !(file instanceof File) || !file.size || file.size > INSPECTION_PHOTO_MAX_BYTES)
    return { error: 'Selecciona una imagen JPEG, PNG o WebP de hasta 5 MB.' }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const extension = inspectionPhotoExtension(bytes)
  if (!extension) return { error: 'La foto no tiene un formato de imagen permitido.' }
  const db = await createClient()
  const { data: stay, error: stayError } = await db.from('reservations').select('id,property_id,check_in,check_out,status').eq('id', id).single()
  if (stayError || !stay || !inspectionWindow(stay, todayInBogota())) return { error: 'La llegada cambió o no está dentro del período de revisión.' }
  const path = `${member.id}/${id}/${crypto.randomUUID()}.${extension}`
  const { error } = await db.storage.from(INSPECTION_PHOTO_BUCKET).upload(path, bytes, { upsert: false, contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` })
  return error ? { error: 'No se pudo guardar la foto privada. No se registró la revisión.' } : { path }
}
export async function inspectionPhotoUrl(reservationId: string, item: string) {
  const member = await getCurrentMember()
  if (!member || !canInspect(member.role)) return { error: 'No autorizado.' }
  const db = await createClient()
  const { state, error } = await readInspection(db, reservationId)
  if (error || !state || !Object.prototype.hasOwnProperty.call(state.checks, item)) return { error: 'No hay una foto comprobada.' }
  const check = state.checks[item as keyof typeof state.checks]
  if (!check?.photo_path) return { error: 'No hay foto para este punto.' }
  const { data, error: signedError } = await db.storage.from(INSPECTION_PHOTO_BUCKET).createSignedUrl(check.photo_path, 120)
  return signedError || !data ? { error: 'No se pudo abrir la foto privada.' } : { url: data.signedUrl }
}
