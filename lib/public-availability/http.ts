/**
 * Piezas HTTP del endpoint público: CORS, cabeceras y límite de tráfico.
 *
 * CORS solo decide qué sitios pueden leer la respuesta desde el navegador; no vuelve privado el
 * endpoint (cualquiera puede llamarlo con curl). Por eso la respuesta nunca lleva datos privados.
 */
export const PRODUCTION_ORIGINS = ['https://casabluecartagena.com']

const splitOrigins = (raw: string | undefined) =>
  (raw ?? '').split(',').map(s => s.trim()).filter(s => /^https?:\/\/[^/\s]+$/.test(s))

/**
 * Orígenes permitidos: el de producción, los confirmados en CASA_BLUE_CORS_ORIGINS (solo https) y,
 * fuera de producción, los de desarrollo en CASA_BLUE_CORS_DEV_ORIGINS (p. ej. http://localhost:4321).
 */
export function allowedOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  const origins = new Set(PRODUCTION_ORIGINS)
  for (const o of splitOrigins(env.CASA_BLUE_CORS_ORIGINS)) if (o.startsWith('https://')) origins.add(o)
  if (env.NODE_ENV !== 'production') for (const o of splitOrigins(env.CASA_BLUE_CORS_DEV_ORIGINS)) origins.add(o)
  return origins
}

export function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

export const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

/**
 * Límite de tráfico por IP en ventana fija. Vive en la memoria de cada instancia del servidor: frena
 * ráfagas de un mismo cliente, pero no es un límite global entre instancias (para eso, el firewall
 * de Vercel). `max` por IP y `globalMax` para toda la instancia por ventana.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private global = { count: 0, resetAt: 0 }

  constructor(private readonly max = 30, private readonly windowMs = 60_000, private readonly globalMax = 600) {}

  /** null si pasa; si no, los segundos que debe esperar. */
  take(key: string, now: number): number | null {
    if (now >= this.global.resetAt) this.global = { count: 0, resetAt: now + this.windowMs }
    if (this.global.count >= this.globalMax) return Math.ceil((this.global.resetAt - now) / 1000)

    let entry = this.hits.get(key)
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    if (entry.count >= this.max) return Math.ceil((entry.resetAt - now) / 1000)
    entry.count++
    this.global.count++
    if (this.hits.size > 10_000) this.sweep(now)
    return null
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k)
  }
}

/** IP del cliente según el proxy de Vercel (primer valor de x-forwarded-for). */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Rechaza la promesa si tarda más de `ms`, abortando la consulta en curso. */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('timeout'))
    }, ms)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}
