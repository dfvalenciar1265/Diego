/**
 * "Autorizar" — consentimiento del OAuth 2.1 de Supabase. Supabase manda aquí cuando ChatGPT o
 * Claude piden conectarse al MCP (Authentication → OAuth Server → Authorization Path =
 * /oauth/consent). Sin sesión, proxy.ts lleva al login y el login vuelve aquí.
 */
import { redirect } from 'next/navigation'
import { decideAuthorization } from '@/actions/oauth'
import { createClient } from '@/lib/supabase/server'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🏠</div>
          <p className="text-2xl font-bold text-[var(--text)]">AirAdmin</p>
        </div>
        <div className="bg-[var(--card)] rounded-2xl p-6 shadow-sm border border-[var(--border)]">
          {children}
        </div>
      </div>
    </div>
  )
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams
  if (!authorizationId) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text)]">
          Falta el identificador de la conexión. Vuelve a conectar desde ChatGPT o Claude.
        </p>
      </Shell>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`)
  }

  const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (error || !details) {
    return (
      <Shell>
        <p className="text-sm text-[var(--text)]">
          No pude leer la solicitud de conexión ({error?.message ?? 'sin datos'}). Vuelve a intentarlo desde ChatGPT o Claude.
        </p>
      </Shell>
    )
  }
  // Already approved before for these scopes: straight back to the app that asked
  if ('redirect_url' in details) redirect(details.redirect_url)

  const { data: member } = await supabase
    .from('team_members').select('name, role, active').eq('id', user.id).maybeSingle()
  const isAdmin = member?.role === 'admin' && member.active === true
  const appName = details.client.name || 'Una aplicación'

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-[var(--text)]">Conectar {appName}</h1>
      <p className="text-sm text-[var(--text-muted)] mt-1">
        quiere usar AirAdmin como <strong className="text-[var(--text)]">{member?.name ?? details.user.email}</strong>.
      </p>

      {isAdmin ? (
        <>
          <p className="text-sm font-medium text-[var(--text)] mt-5 mb-2">Podrá:</p>
          <ul className="text-sm text-[var(--text)] space-y-1.5 list-disc pl-5">
            <li>Ver apartamentos, pendientes de mantenimiento y reservas (sin montos ni códigos de acceso).</li>
            <li>Crear pendientes y cambiar su estado, nota y costo.</li>
            <li>Dejar la nota «⚠️ Diferencia con Airbnb» en las reservas que no coinciden.</li>
          </ul>
          <p className="text-xs text-[var(--text-muted)] mt-3">No puede borrar nada.</p>
        </>
      ) : (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-5">
          Solo los administradores de AirAdmin pueden conectar ChatGPT o Claude.
        </p>
      )}

      <form action={decideAuthorization} className="flex gap-3 mt-6">
        <input type="hidden" name="authorization_id" value={details.authorization_id} />
        <button
          type="submit" name="decision" value="deny"
          className="flex-1 rounded-lg border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text)]"
        >
          Rechazar
        </button>
        {isAdmin && (
          <button
            type="submit" name="decision" value="approve"
            className="flex-1 bg-[var(--primary)] text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            Autorizar
          </button>
        )}
      </form>

      <p className="text-xs text-[var(--text-muted)] mt-4">Te devolverá a {hostOf(details.redirect_uri)}.</p>
    </Shell>
  )
}
