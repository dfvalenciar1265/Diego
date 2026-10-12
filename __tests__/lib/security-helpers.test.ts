import { describe, it, expect } from 'vitest'
import { escapeLike } from '@/lib/like'
import { newOAuthState, stateMatches } from '@/lib/oauth-state'

describe('escapeLike', () => {
  it('turns LIKE wildcards into literal characters', () => {
    expect(escapeLike('Dieg%')).toBe('Dieg\\%')
    expect(escapeLike('_')).toBe('\\_')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('leaves normal names untouched', () => {
    expect(escapeLike('María José')).toBe('María José')
  })
})

describe('OAuth state', () => {
  it('accepts only the exact state this browser started with', () => {
    const s = newOAuthState()
    expect(stateMatches(s, s)).toBe(true)
    expect(stateMatches(s, s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A'))).toBe(false)
  })

  it('rejects a missing cookie or a missing state', () => {
    expect(stateMatches(undefined, 'x')).toBe(false)
    expect(stateMatches('x', null)).toBe(false)
    expect(stateMatches('abc', 'abcd')).toBe(false)
  })

  it('is random each time', () => {
    expect(newOAuthState()).not.toBe(newOAuthState())
  })
})
