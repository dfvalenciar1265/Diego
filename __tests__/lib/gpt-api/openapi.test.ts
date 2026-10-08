import { describe, it, expect } from 'vitest'
import { buildOpenApi } from '@/lib/gpt-api/openapi'

const spec = buildOpenApi('https://diegoprueba.vercel.app')
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op: op as { operationId: string; description: string } })))

describe('buildOpenApi', () => {
  it('points to the app and asks for the bearer key', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers).toEqual([{ url: 'https://diegoprueba.vercel.app' }])
    expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' })
    expect(spec.security).toEqual([{ bearerAuth: [] }])
  })

  it('documents every route once, each with its own operationId', () => {
    expect(operations.map(o => `${o.method} ${o.path}`).sort()).toEqual([
      'get /api/gpt/maintenance',
      'get /api/gpt/properties',
      'get /api/gpt/reservations',
      'patch /api/gpt/maintenance/{id}',
      'post /api/gpt/maintenance',
      'post /api/gpt/reservations/compare',
    ])
    expect(new Set(operations.map(o => o.op.operationId)).size).toBe(operations.length)
  })

  it('keeps descriptions within the 300 characters GPT actions allow', () => {
    for (const { op } of operations) expect(op.description.length).toBeLessThanOrEqual(300)
  })
})
