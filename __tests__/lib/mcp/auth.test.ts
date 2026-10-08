import { describe, it, expect } from 'vitest'
import { buildAuthInfo, memberFromAuth } from '@/lib/mcp/auth'

const ADMIN = { id: 'u1', name: 'Diego', role: 'admin', active: true }
const CLAIMS = { sub: 'u1', role: 'authenticated', exp: 2_000_000_000, client_id: 'chatgpt-client', scope: 'openid email profile' }

describe('buildAuthInfo', () => {
  it('lets an active admin in, with who they are', () => {
    expect(buildAuthInfo('tok', CLAIMS, ADMIN)).toEqual({
      token: 'tok',
      clientId: 'chatgpt-client',
      scopes: ['openid', 'email', 'profile'],
      expiresAt: 2_000_000_000,
      extra: { memberId: 'u1', memberName: 'Diego' },
    })
  })

  it('keeps out anyone who is not an active admin', () => {
    expect(buildAuthInfo('tok', CLAIMS, null)).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, role: 'cleaning' })).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, active: false })).toBeUndefined()
    expect(buildAuthInfo('tok', CLAIMS, { ...ADMIN, id: 'someone-else' })).toBeUndefined()
  })

  it('rejects tokens that are not a signed-in user', () => {
    expect(buildAuthInfo('tok', { ...CLAIMS, role: 'anon' }, ADMIN)).toBeUndefined()
    expect(buildAuthInfo('tok', { ...CLAIMS, role: 'service_role' }, ADMIN)).toBeUndefined()
  })

  it('copes with tokens without client_id or scope', () => {
    const info = buildAuthInfo('tok', { sub: 'u1', role: 'authenticated', exp: 1 }, ADMIN)
    expect(info?.clientId).toBe('supabase-session')
    expect(info?.scopes).toEqual([])
  })
})

describe('memberFromAuth', () => {
  it('reads who is connected', () => {
    expect(memberFromAuth(buildAuthInfo('tok', CLAIMS, ADMIN))).toEqual({ id: 'u1', name: 'Diego' })
    expect(memberFromAuth(undefined)).toBeNull()
  })
})
