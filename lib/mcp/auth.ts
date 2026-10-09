/**
 * Verificación del token que ChatGPT (o Claude) manda al MCP. Lo emite el OAuth 2.1 de Supabase
 * cuando alguien aprueba la pantalla "Autorizar". Solo pasan los admin activos del equipo, y se
 * vuelve a comprobar en cada llamada.
 */
import type { AuthInfo } from '@modelcontextprotocol/server'
import { createClient } from '@supabase/supabase-js'
import { serviceDb, type Db } from '@/lib/gpt-api/db'

export interface TeamMemberRef {
  id: string
  name: string
  role: string
  active: boolean
}

export interface TokenClaims {
  sub: string
  role?: string
  exp?: number
  client_id?: unknown
  scope?: unknown
}

/** Arma el AuthInfo si el token es de un usuario que es admin activo; si no, undefined. */
export function buildAuthInfo(token: string, claims: TokenClaims, member: TeamMemberRef | null): AuthInfo | undefined {
  if (claims.role !== 'authenticated') return undefined
  if (!member || member.id !== claims.sub || member.role !== 'admin' || !member.active) return undefined
  return {
    token,
    clientId: typeof claims.client_id === 'string' ? claims.client_id : 'supabase-session',
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    expiresAt: claims.exp,
    extra: { memberId: member.id, memberName: member.name },
  }
}

async function findMember(db: Db, id: string): Promise<TeamMemberRef | null> {
  const { data, error } = await db.from('team_members').select('id, name, role, active').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as TeamMemberRef | null) ?? null
}

/** Para withMcpAuth: undefined = sin acceso (responde 401 con el desafío OAuth). */
export async function verifyMcpToken(_req: Request, token?: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Checks signature (project JWKS) and expiry; with legacy symmetric keys it asks the Auth server.
  const { data, error } = await supabase.auth.getClaims(token)
  if (error || !data) return undefined
  const claims = data.claims as TokenClaims
  return buildAuthInfo(token, claims, await findMember(serviceDb(), claims.sub))
}

/** Quién está usando el MCP (lo dejó verifyMcpToken en el AuthInfo). */
export function memberFromAuth(authInfo: AuthInfo | undefined): { id: string; name: string } | null {
  const id = authInfo?.extra?.memberId
  const name = authInfo?.extra?.memberName
  return typeof id === 'string' && typeof name === 'string' ? { id, name } : null
}
