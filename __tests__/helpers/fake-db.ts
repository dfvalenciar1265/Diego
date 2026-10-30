/** Base en memoria que imita lo que usan las consultas de Supabase (PostgREST) y los triggers de versión. */
import type { Db } from '@/lib/gpt-api/db'

export type Row = Record<string, unknown>
export function fakeDb(tables: Record<string, Row[]>, opts: { failInsertOnce?: string; rpc?: (name: string, args: Record<string, unknown>) => unknown } = {}) {
  let failNext = opts.failInsertOnce
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    let single: 'single' | 'maybe' | null = null
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q },
      lte: (k: string, v: string) => { filters.push(r => String(r[k]) <= v); return q },
      gt: (k: string, v: string) => { filters.push(r => String(r[k]) > v); return q },
      insert: (row: Row) => { op = 'insert'; payload = row; return q },
      update: (row: Row) => { op = 'update'; payload = row; return q },
      single: () => { single = 'single'; return q },
      maybeSingle: () => { single = 'maybe'; return q },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    }
    function run() {
      const rows = tables[table] ?? (tables[table] = [])
      if (op === 'insert') {
        if (failNext === table) {
          // Otra llamada igual se adelantó: la fila existe y el índice único rechaza esta.
          failNext = undefined
          rows.push({ ...payload, id: 'winner', status: payload.kind ? 'registered' : 'pending', version: 1 })
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const row = { id: `00000000-0000-0000-0000-${String(rows.length + 1).padStart(12, '0')}`, status: payload.kind ? 'registered' : 'pending', version: 1, notes: '', review_reason: null, ...payload }
        rows.push(row)
        return { data: row, error: null }
      }
      const hits = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        for (const r of hits) Object.assign(r, payload, { version: (r.version as number) + 1 })
        return { data: hits, error: null }
      }
      if (single) return { data: hits[0] ?? null, error: null }
      return { data: hits, error: null }
    }
    return q
  }
  return { from, rpc: (name: string, args: Record<string, unknown>) => Promise.resolve(opts.rpc?.(name, args) ?? { data: null, error: null }) } as unknown as Db
}

