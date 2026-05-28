'use client'

interface Props {
  page:     number
  total:    number         // total number of pages
  onChange: (p: number) => void
  accent?:  string         // override colour (default: #6366f1)
}

/** Shared prev/next pagination bar. Renders nothing if there is only one page. */
export function Pagination({ page, total, onChange, accent = '#6366f1' }: Props) {
  if (total <= 1) return null
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="text-sm font-medium disabled:text-[#c4c9d4] active:opacity-70 transition-opacity"
        style={{ color: page === 1 ? undefined : accent }}
      >
        ‹ Anterior
      </button>
      <span className="text-xs text-[#94a3b8]">{page} / {total}</span>
      <button
        onClick={() => onChange(Math.min(total, page + 1))}
        disabled={page === total}
        className="text-sm font-medium disabled:text-[#c4c9d4] active:opacity-70 transition-opacity"
        style={{ color: page === total ? undefined : accent }}
      >
        Siguiente ›
      </button>
    </div>
  )
}

/** Client-side pagination helper: returns a slice of `items` for the current page. */
export function paginate<T>(items: T[], page: number, pageSize = 5): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize)
}

/** Returns the total number of pages given a list length and page size. */
export function pageCount(total: number, pageSize = 5): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
