import { describe, expect, it } from 'vitest'
import { noticeNeedsReview, validateTemporaryNotice } from '@/lib/temporary-notices'
const valid = { property_id: '11111111-1111-4111-8111-111111111111', title: 'Piscina Sintética', message: 'Cierre de prueba', expires_on: '2026-11-11', locations: ['Manual ES', 'Manual EN'], status: 'open' }
describe('avisos temporales', () => {
  it('no retira automáticamente al vencer ni declara disponible el servicio', () => {
    expect(noticeNeedsReview({ status: 'open', expires_on: '2026-11-11' }, '2026-11-12')).toBe(true)
    expect(noticeNeedsReview({ status: 'open', expires_on: '2026-11-11' }, '2026-11-11')).toBe(false)
    expect(noticeNeedsReview({ status: 'retired', expires_on: '2026-11-11' }, '2026-11-12')).toBe(false)
  })
  it('exige ubicaciones, texto y fecha válidos', () => {
    expect(validateTemporaryNotice(valid)).toBeNull()
    expect(validateTemporaryNotice({ ...valid, locations: [] })).not.toBeNull()
    expect(validateTemporaryNotice({ ...valid, expires_on: '2026-02-30' })).not.toBeNull()
  })
  it('retirar exige evidencia', () => {
    expect(validateTemporaryNotice({ ...valid, status: 'retired' })).not.toBeNull()
    expect(validateTemporaryNotice({ ...valid, status: 'retired', evidence: 'Verificadas ambas ubicaciones con datos sintéticos' })).toBeNull()
  })
})
