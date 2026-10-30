const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** "10am", "3:30 pm", "12 p.m.", "15:30" → "HH:MM"; null si no es una hora válida. */
export function parseClockTime(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/)
  if (ampm) {
    let h = Number(ampm[1])
    const m = ampm[2] ? Number(ampm[2]) : 0
    if (h < 1 || h > 12 || m > 59) return null
    if (ampm[3] === 'p' && h !== 12) h += 12
    if (ampm[3] === 'a' && h === 12) h = 0
    return hhmm(h, m)
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = Number(h24[1])
    const m = Number(h24[2])
    return h <= 23 && m <= 59 ? hhmm(h, m) : null
  }
  return null
}
