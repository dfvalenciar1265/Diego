/**
 * Ruta interna segura para volver después del login (?next=…). Solo acepta rutas de la propia
 * app ("/oauth/consent?…"); otro dominio, "//evil.com" o "javascript:" → null.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
