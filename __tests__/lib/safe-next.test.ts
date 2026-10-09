import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/safe-next'

describe('safeNextPath', () => {
  it('keeps internal paths with their query', () => {
    expect(safeNextPath('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc')
    expect(safeNextPath('/calendar')).toBe('/calendar')
  })

  it('rejects anything that could leave the app', () => {
    expect(safeNextPath('https://evil.com')).toBeNull()
    expect(safeNextPath('//evil.com')).toBeNull()
    expect(safeNextPath('/\\evil.com')).toBeNull()
    expect(safeNextPath('javascript:alert(1)')).toBeNull()
  })

  it('returns null when there is nothing', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })
})
