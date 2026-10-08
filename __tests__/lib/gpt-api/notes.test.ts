import { describe, it, expect } from 'vitest'
import { setDiffNote, clearDiffNote } from '@/lib/gpt-api/notes'

const BASE = 'Check-in: 3:00 PM | Check-out: 11:00 AM'
const TODAY = '2026-10-08'

describe('setDiffNote', () => {
  it('adds the mark after the existing notes', () => {
    expect(setDiffNote(BASE, 'Salida 13-oct en Airbnb, 12-oct en la app', TODAY)).toBe(
      'Check-in: 3:00 PM | Check-out: 11:00 AM | ⚠️ Diferencia con Airbnb (8-oct): Salida 13-oct en Airbnb, 12-oct en la app',
    )
  })

  it('replaces an earlier mark instead of piling up', () => {
    const first = setDiffNote(BASE, 'uno', '2026-10-01')
    expect(setDiffNote(first, 'dos', TODAY)).toBe(`${BASE} | ⚠️ Diferencia con Airbnb (8-oct): dos`)
  })

  it('keeps the check-in and check-out times readable for the home and cleaning screens', () => {
    const notes = setDiffNote(BASE, 'Llegada 9-oct en Airbnb, 10-oct en la app', TODAY)
    expect(notes.match(/Check-out:\s*([^|]+)/i)?.[1].trim()).toBe('11:00 AM')
    expect(notes.match(/Check-in:\s*([^|]+)/i)?.[1].trim()).toBe('3:00 PM')
  })

  it('neutralizes a | inside the message', () => {
    const notes = setDiffNote(BASE, 'a | b', TODAY)
    expect(notes).toBe(`${BASE} | ⚠️ Diferencia con Airbnb (8-oct): a / b`)
    expect(clearDiffNote(notes)).toBe(BASE)
  })

  it('works on empty notes', () => {
    expect(setDiffNote('', 'x', TODAY)).toBe('⚠️ Diferencia con Airbnb (8-oct): x')
    expect(setDiffNote(null, 'x', TODAY)).toBe('⚠️ Diferencia con Airbnb (8-oct): x')
  })
})

describe('clearDiffNote', () => {
  it('gives back the original notes', () => {
    expect(clearDiffNote(setDiffNote(BASE, 'x', TODAY))).toBe(BASE)
    expect(clearDiffNote(setDiffNote('', 'x', TODAY))).toBe('')
  })

  it('removes a mark in the middle', () => {
    expect(clearDiffNote('A | ⚠️ Diferencia con Airbnb (1-oct): x | B')).toBe('A | B')
  })

  it('leaves the Gmail sync mark alone', () => {
    const gmail = `${BASE} | ⚠️ Fechas actualizadas — verificar en Airbnb`
    const marked = setDiffNote(gmail, 'x', TODAY)
    expect(marked).toContain('⚠️ Fechas actualizadas')
    expect(clearDiffNote(marked)).toBe(gmail)
  })

  it('does nothing when there is no mark', () => {
    expect(clearDiffNote(BASE)).toBe(BASE)
    expect(clearDiffNote(null)).toBe('')
  })
})
