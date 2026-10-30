'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { gmailSyncDb, runGmailSync } from '@/lib/gmail-reconciliation/runner'
import { readGmailStatus, type GmailStatus } from '@/lib/gmail-reconciliation/status'
export type { SyncResult } from '@/lib/gmail-reconciliation/types'

/** El botón y el cron ejecutan el mismo servicio; nunca se reenvía un secreto a NEXT_PUBLIC_APP_URL. */
export async function syncGmail() {
  const member=await getCurrentMember()
  if (!member || member.role!=='admin') return { ok:false as const,state:'unavailable' as const,error:'Solo administradores activos pueden importar Gmail.' }
  const result=await runGmailSync({via:'manual',actorId:member.id},{db:gmailSyncDb()})
  for (const path of ['/','/calendar','/cleaning','/tasks','/settings/gmail']) revalidatePath(path)
  return result
}
export async function getGmailStatus(): Promise<GmailStatus> {
  const member=await getCurrentMember()
  if (!member || member.role!=='admin') throw new Error('Solo administradores activos pueden consultar conciliación de Gmail.')
  return readGmailStatus(gmailSyncDb())
}
export async function reviewGmailIssue(id:string,version:number,note:string) {
  const member=await getCurrentMember()
  if (!member || member.role!=='admin') return {success:false,error:'Solo administradores activos pueden revisar pendientes.'}
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(version) || version<1 || typeof note!=='string' || note.trim().length<3 || note.length>500) {
    return {success:false,error:'Indica el pendiente, su versión y una nota de revisión de 3 a 500 caracteres.'}
  }
  const db=await createClient()
  const {error}=await db.rpc('gmail_sync_review',{p_id:id,p_version:version,p_note:note})
  if (error) return {success:false,error:error.code==='40001'?'El pendiente cambió. Actualiza y revisa antes de repetir.':'No se pudo registrar la revisión.'}
  revalidatePath('/settings/gmail')
  return {success:true}
}
