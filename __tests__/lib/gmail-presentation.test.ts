import { describe, expect, it } from 'vitest'
import { gmailNotice } from '@/lib/gmail-reconciliation/presentation'
describe('paginación y revisión separadas de fallos técnicos', () => {
  it('150 hilos con más páginas es advertencia de continuación, sin certificar éxito', () => {
    expect(gmailNotice({ ok: false, state: 'partial', scan_complete: false, error_code: 'source_incomplete', pending_count: 108 }))
      .toMatchObject({ tone: 'warning', label: 'Por continuar' })
  })
  it('lectura completa con 108 conflictos y 4 grupos repetidos sigue por revisar', () => {
    const result = gmailNotice({ ok: false, state: 'partial', scan_complete: true, error_code: null, pending_count: 108, duplicate_task_groups: 4 })
    expect(result).toMatchObject({ tone: 'warning', label: 'Por revisar' })
    expect(result.message).toContain('108 correos y 4 grupos')
  })
  it.each(['gmail_unavailable','database_error','not_connected'])('mantiene rojo el fallo %s, aunque se leyera el alcance', error_code => {
    expect(gmailNotice({ ok: false, state: 'failed', scan_complete: true, error_code })).toMatchObject({ tone: 'error' })
  })
  it('el turno ocupado y el presupuesto agotado no significan fallo de conexión', () => {
    expect(gmailNotice({ ok: false, state: 'busy' }).label).toBe('En curso')
    expect(gmailNotice({ ok: false, state: 'partial', scan_complete: true, error_code: 'deadline' }).label).toBe('Por continuar')
  })
})
