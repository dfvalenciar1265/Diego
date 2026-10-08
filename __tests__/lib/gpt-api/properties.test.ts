import { describe, it, expect } from 'vitest'
import { resolveProperty, normalizeText } from '@/lib/gpt-api/properties'

const PROPS = [
  { id: 'p708', name: 'Tocahagua 708' },
  { id: 'p1208', name: 'Tocahagua 1208' },
  { id: 'p1001', name: 'Palmetto 1001' },
  // real id of Cartagena Beach Crespo 1214 (its Airbnb aliases live in lib/gmail-sync.ts)
  { id: '2be6deec-8061-453e-b1ae-ce0bd177fadd', name: 'Cartagena Beach Crespo 1214' },
]

describe('normalizeText', () => {
  it('drops accents, case and extra spaces', () => {
    expect(normalizeText('  Ángel   del MAR ')).toBe('angel del mar')
  })
})

describe('resolveProperty', () => {
  it('finds the apartment by its app name, ignoring case and accents', () => {
    expect(resolveProperty('pálmetto 1001', PROPS)?.id).toBe('p1001')
    expect(resolveProperty('TOCAHAGUA 708 · Vista al mar', PROPS)?.id).toBe('p708')
  })

  it('does not confuse Tocahagua 708 with 1208', () => {
    expect(resolveProperty('Tocahagua 1208', PROPS)?.id).toBe('p1208')
  })

  it('falls back to the Airbnb listing aliases', () => {
    expect(resolveProperty('Loft Moderno vista Mar en Cartagena Ángel del Mar', PROPS)?.id)
      .toBe('2be6deec-8061-453e-b1ae-ce0bd177fadd')
  })

  it('returns null for an unknown apartment', () => {
    expect(resolveProperty('Casa Toro', PROPS)).toBeNull()
    expect(resolveProperty('', PROPS)).toBeNull()
  })
})
