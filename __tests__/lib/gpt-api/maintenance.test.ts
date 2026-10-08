import { describe, it, expect } from 'vitest'
import { appendMaintenanceNote } from '@/lib/gpt-api/maintenance'

describe('appendMaintenanceNote', () => {
  it('adds a dated ChatGPT line below the existing notes', () => {
    expect(appendMaintenanceNote('Creado por la rutina de reseñas.', 'Turge cambió el sifón', '2026-10-08'))
      .toBe('Creado por la rutina de reseñas.\n[8-oct · ChatGPT] Turge cambió el sifón')
  })

  it('starts the notes when there were none', () => {
    expect(appendMaintenanceNote('', 'Listo', '2026-10-08')).toBe('[8-oct · ChatGPT] Listo')
    expect(appendMaintenanceNote(null, 'Listo', '2026-10-08')).toBe('[8-oct · ChatGPT] Listo')
  })
})
