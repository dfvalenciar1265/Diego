import { timingSafeEqual } from 'node:crypto'

/** Una clave más corta que esto no protege: mejor dejar el API cerrado. */
const MIN_KEY_LENGTH = 32

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string }

/**
 * Verifica `Authorization: Bearer <clave>` contra GPT_API_KEY. Sin clave configurada
 * (o demasiado corta) el API queda cerrado para todos, nunca abierto.
 */
export function checkApiKey(header: string | null, expected: string | undefined): AuthResult {
  if (!expected || expected.length < MIN_KEY_LENGTH) {
    return { ok: false, status: 503, error: 'El API para ChatGPT no está configurado (falta GPT_API_KEY en el servidor).' }
  }
  const given = Buffer.from(header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '')
  const wanted = Buffer.from(expected)
  // timingSafeEqual throws on different lengths, so compare those first.
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, status: 401, error: 'Clave del API inválida o ausente.' }
  }
  return { ok: true }
}
