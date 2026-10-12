import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Cookie holding the one-time `state` of the Gmail OAuth round-trip. */
export const GMAIL_STATE_COOKIE = 'gmail_oauth_state'

export function newOAuthState(): string {
  return randomBytes(24).toString('base64url')
}

/** Constant-time check that Google sent back the `state` this browser started with. */
export function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}
