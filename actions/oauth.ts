'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Aprueba o rechaza la conexión que pidió ChatGPT o Claude y devuelve al usuario a esa app.
 * Al aprobar se vuelve a comprobar que sea admin activo: la pantalla solo esconde el botón.
 */
export async function decideAuthorization(formData: FormData): Promise<void> {
  const authorizationId = String(formData.get('authorization_id') ?? '')
  const approve = formData.get('decision') === 'approve'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !authorizationId) redirect('/login')

  if (approve) {
    const { data: member } = await supabase
      .from('team_members').select('role, active').eq('id', user.id).maybeSingle()
    if (member?.role !== 'admin' || member.active !== true) {
      throw new Error('Solo los administradores de AirAdmin pueden autorizar conexiones.')
    }
  }

  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
  if (error || !data) {
    throw new Error(`No se pudo ${approve ? 'autorizar' : 'rechazar'} la conexión: ${error?.message ?? 'sin datos'}`)
  }
  redirect(data.redirect_url)
}
