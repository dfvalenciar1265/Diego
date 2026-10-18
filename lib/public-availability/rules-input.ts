/**
 * Archivo de reglas por apartamento que Diego llena y revisa (scripts/availability-rules.mjs).
 *
 * Nada tiene valor por defecto: la plantilla trae "PENDIENTE" en cada campo y una fila solo se
 * puede verificar cuando todos están contestados. `null` es una respuesta explícita ("sin
 * límite" / "cualquier día"), no un hueco. Sin imports con alias: lo carga Node directamente.
 */
export const PENDING = 'PENDIENTE'

export interface RulesRow {
  property_id: string
  min_nights: number
  max_nights: number | null
  date_overrides: DateOverrideRow[]
  advance_notice_hours: number
  booking_window_days: number | null
  preparation_nights: number
  same_day_turnover: boolean
  turnover_hours: number | null
  check_in_days: number[] | null
  check_out_days: number[] | null
  check_in_time: string
  check_out_time: string
  source_note: string
}

export interface DateOverrideRow {
  from: string
  to: string
  min_nights?: number
  max_nights?: number | null
  advance_notice_hours?: number
  check_in_days?: number[] | null
  check_out_days?: number[] | null
}

const FIELDS = [
  'min_nights', 'max_nights', 'date_overrides', 'advance_notice_hours', 'booking_window_days', 'preparation_nights',
  'same_day_turnover', 'turnover_hours', 'check_in_days', 'check_out_days', 'check_in_time', 'check_out_time', 'source_note',
] as const

export type UnitRef = { slug: string; propertyId: string }

/** Plantilla para los apartamentos dados: todo PENDIENTE. */
export function rulesTemplate(units: readonly UnitRef[]) {
  return {
    _ayuda: [
      'Copia cada valor de Airbnb (Calendario > Disponibilidad y Ajustes del anuncio). Nada se rellena solo.',
      'null = sin límite / cualquier día. Días: 0=domingo … 6=sábado. Horas: "HH:MM".',
      'date_overrides: ajustes por fecha de llegada, p. ej. {"from":"2026-12-15","to":"2027-01-10","min_nights":3}.',
      'source_note: de dónde salió el dato y cuándo se revisó.',
    ],
    apartamentos: units.map(u => ({ slug: u.slug, ...Object.fromEntries(FIELDS.map(f => [f, PENDING])) })),
  }
}

const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const isDays = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.length <= 7 && v.every(d => isInt(d, 0, 6)) && new Set(v).size === v.length

function checkOverride(o: unknown, i: number, errors: string[]): DateOverrideRow | null {
  const at = `date_overrides[${i}]`
  if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`${at}: debe ser un objeto`); return null }
  const x = o as Record<string, unknown>
  const allowed = new Set(['from', 'to', 'min_nights', 'max_nights', 'advance_notice_hours', 'check_in_days', 'check_out_days'])
  for (const k of Object.keys(x)) if (!allowed.has(k)) errors.push(`${at}: campo no admitido "${k}"`)
  if (!isDate(x.from) || !isDate(x.to) || x.to < x.from) errors.push(`${at}: from/to deben ser fechas YYYY-MM-DD con to >= from`)
  if ('min_nights' in x && !isInt(x.min_nights, 1, 365)) errors.push(`${at}: min_nights entre 1 y 365`)
  if ('max_nights' in x && x.max_nights !== null && !isInt(x.max_nights, 1, 365)) errors.push(`${at}: max_nights entre 1 y 365 o null`)
  if ('advance_notice_hours' in x && !isInt(x.advance_notice_hours, 0, 24 * 30)) errors.push(`${at}: advance_notice_hours entre 0 y 720`)
  for (const k of ['check_in_days', 'check_out_days'] as const) {
    if (k in x && x[k] !== null && !isDays(x[k])) errors.push(`${at}: ${k} debe ser null o una lista de días 0–6`)
  }
  if (Object.keys(x).length <= 2) errors.push(`${at}: no cambia ninguna regla`)
  return x as unknown as DateOverrideRow
}

/** Valida un apartamento del archivo. Devuelve la fila lista para guardar o la lista de errores. */
export function validateUnitRules(raw: Record<string, unknown>, propertyId: string): { ok: true; row: RulesRow } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const pending = FIELDS.filter(f => !(f in raw) || raw[f] === PENDING)
  if (pending.length > 0) errors.push(`sin contestar: ${pending.join(', ')}`)
  const extra = Object.keys(raw).filter(k => k !== 'slug' && !(FIELDS as readonly string[]).includes(k))
  if (extra.length > 0) errors.push(`campos no admitidos: ${extra.join(', ')}`)

  const v = raw as Record<(typeof FIELDS)[number], unknown>
  if (!pending.includes('min_nights') && !isInt(v.min_nights, 1, 365)) errors.push('min_nights: entero entre 1 y 365')
  if (!pending.includes('max_nights') && v.max_nights !== null && !(isInt(v.max_nights, 1, 365) && (!isInt(v.min_nights, 1, 365) || (v.max_nights as number) >= (v.min_nights as number)))) {
    errors.push('max_nights: null o entero >= min_nights')
  }
  if (!pending.includes('advance_notice_hours') && !isInt(v.advance_notice_hours, 0, 720)) errors.push('advance_notice_hours: entero entre 0 y 720')
  if (!pending.includes('booking_window_days') && v.booking_window_days !== null && !isInt(v.booking_window_days, 0, 1095)) errors.push('booking_window_days: null o entero entre 0 y 1095')
  if (!pending.includes('preparation_nights') && !isInt(v.preparation_nights, 0, 7)) errors.push('preparation_nights: entero entre 0 y 7')
  if (!pending.includes('same_day_turnover') && typeof v.same_day_turnover !== 'boolean') errors.push('same_day_turnover: true o false')
  if (!pending.includes('turnover_hours') && v.turnover_hours !== null && !(typeof v.turnover_hours === 'number' && v.turnover_hours >= 0 && v.turnover_hours <= 24)) errors.push('turnover_hours: null o número entre 0 y 24')
  for (const k of ['check_in_days', 'check_out_days'] as const) {
    if (!pending.includes(k) && v[k] !== null && !isDays(v[k])) errors.push(`${k}: null o lista de días 0–6 sin repetir`)
  }
  for (const k of ['check_in_time', 'check_out_time'] as const) {
    if (!pending.includes(k) && !isTime(v[k])) errors.push(`${k}: hora "HH:MM"`)
  }
  if (!pending.includes('source_note') && (typeof v.source_note !== 'string' || v.source_note.trim().length < 5)) errors.push('source_note: indica de dónde salió el dato')
  let overrides: DateOverrideRow[] = []
  if (!pending.includes('date_overrides')) {
    if (!Array.isArray(v.date_overrides)) errors.push('date_overrides: lista (puede ser [])')
    else overrides = v.date_overrides.map((o, i) => checkOverride(o, i, errors)).filter((o): o is DateOverrideRow => o !== null)
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    row: {
      property_id: propertyId,
      min_nights: v.min_nights as number,
      max_nights: v.max_nights as number | null,
      date_overrides: overrides,
      advance_notice_hours: v.advance_notice_hours as number,
      booking_window_days: v.booking_window_days as number | null,
      preparation_nights: v.preparation_nights as number,
      same_day_turnover: v.same_day_turnover as boolean,
      turnover_hours: v.turnover_hours as number | null,
      check_in_days: v.check_in_days as number[] | null,
      check_out_days: v.check_out_days as number[] | null,
      check_in_time: v.check_in_time as string,
      check_out_time: v.check_out_time as string,
      source_note: (v.source_note as string).trim(),
    },
  }
}

/** Valida el archivo completo contra el catálogo: cada apartamento una vez, sin slugs desconocidos. */
export function validateRulesFile(file: unknown, units: readonly UnitRef[]) {
  const results: Array<{ slug: string; ok: true; row: RulesRow } | { slug: string; ok: false; errors: string[] }> = []
  const list = (file as { apartamentos?: unknown })?.apartamentos
  if (!Array.isArray(list)) return { fileErrors: ['falta la lista "apartamentos"'], results }
  const fileErrors: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const slug = (item as { slug?: unknown })?.slug
    const unit = units.find(u => u.slug === slug)
    if (typeof slug !== 'string' || !unit) { fileErrors.push(`slug desconocido: ${String(slug)}`); continue }
    if (seen.has(slug)) { fileErrors.push(`slug repetido: ${slug}`); continue }
    seen.add(slug)
    results.push({ slug, ...validateUnitRules(item as Record<string, unknown>, unit.propertyId) })
  }
  return { fileErrors, results }
}
