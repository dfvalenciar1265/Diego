'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { validateTemporaryNotice, type TemporaryNotice } from '@/lib/temporary-notices'

export async function getTemporaryNotices(): Promise<{ data: TemporaryNotice[]; error?: string }> {
  const member = await getCurrentMember()
  if (!member) return { data: [], error: 'Sesión no disponible.' }
  const db = await createClient()
  const { data, error } = await db.from('temporary_notices').select('*').order('expires_on')
  return error ? { data: [], error: 'No se pudieron consultar los avisos temporales; no se da por comprobada su ausencia.' } : { data: data ?? [] }
}
export async function saveTemporaryNotice(input: unknown, requestKey: string, expectedVersion: number) {
  const member = await getCurrentMember()
  if (member?.role !== 'admin') return { ok: false, error: 'Solo administración puede registrar avisos.' }
  const error = validateTemporaryNotice(input)
  if (error) return { ok: false, error }
  if (!requestKey || requestKey.length > 200 || !Number.isInteger(expectedVersion) || expectedVersion < 0) return { ok: false, error: 'Versión o clave inválida.' }
  const db = await createClient()
  const result = await db.rpc('save_temporary_notice', { p_input: input, p_request_key: requestKey, p_expected_version: expectedVersion })
  if (result.error) return { ok: false, error: 'No se guardó el aviso. Actualiza antes de reintentar.' }
  if (!result.data?.ok) return { ok: false, error: result.data?.error ?? 'Resultado no confirmado.' }
  const read = await db.from('temporary_notices').select('*').eq('id', result.data.data.id).single()
  if (read.error || read.data?.version !== result.data.data.version) return { ok: false, error: 'Guardado recibido, pero la relectura no coincidió. Actualiza antes de repetir.' }
  revalidatePath('/temporary-notices'); revalidatePath('/')
  return { ok: true, data: read.data as TemporaryNotice }
}
