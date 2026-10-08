// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkApiKey } from '@/lib/gpt-api/auth'

const KEY = 'test-key-0123456789-abcdefghijklmnopqrstuvwxyz'

describe('checkApiKey', () => {
  it('keeps the API closed when no usable key is configured', () => {
    expect(checkApiKey(`Bearer ${KEY}`, undefined)).toMatchObject({ ok: false, status: 503 })
    expect(checkApiKey('Bearer short', 'short')).toMatchObject({ ok: false, status: 503 })
  })

  it('rejects missing or wrong keys', () => {
    expect(checkApiKey(null, KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey('Bearer nope', KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey(KEY, KEY)).toMatchObject({ ok: false, status: 401 })
    expect(checkApiKey(`Bearer ${KEY}x`, KEY)).toMatchObject({ ok: false, status: 401 })
  })

  it('lets the right key in', () => {
    expect(checkApiKey(`Bearer ${KEY}`, KEY)).toEqual({ ok: true })
    expect(checkApiKey(`bearer ${KEY}`, KEY)).toEqual({ ok: true })
  })
})
