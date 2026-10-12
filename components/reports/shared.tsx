'use client'
/**
 * Piezas compartidas de los reportes: navegador de mes/quincena, botón «Exportar CSV»
 * y la tabla de escritorio (md+) con fila de totales. En móvil cada reporte sigue
 * mostrando sus tarjetas; la tabla solo aparece desde md.
 */
import type { ReactNode } from 'react'
import { downloadCsv, csvFileName, toCsv, type CsvCell } from '@/lib/csv'
import { toast } from '@/components/ui/feedback'

export const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

/** `$1.250.000` · `−$45.000` (signo menos tipográfico, igual que en Rentabilidad). */
export function fmtCOP(n: number): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(n).toLocaleString('es-CO')}`
}

// ─── Navegador de periodo ─────────────────────────────────────────────────────

interface PeriodNavProps {
  title:        string
  subtitle:     string
  pending?:     boolean
  onPrev:       () => void
  onNext:       () => void
  nextDisabled: boolean
  prevLabel?:   string
  nextLabel?:   string
  accent?:      string
}

export function PeriodNav({
  title, subtitle, pending, onPrev, onNext, nextDisabled,
  prevLabel = 'Mes anterior', nextLabel = 'Mes siguiente', accent = '#6366f1',
}: PeriodNavProps) {
  const arrow = 'w-11 h-11 shrink-0 flex items-center justify-center rounded-lg font-bold text-xl ' +
                'active:opacity-60 hover:bg-[#f8fafc] disabled:text-[#cbd5e1] disabled:hover:bg-transparent'
  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-[#e2e8f0] px-2 py-1.5 shadow-sm">
      <button type="button" onClick={onPrev} aria-label={prevLabel} className={arrow} style={{ color: accent }}>
        <span aria-hidden>‹</span>
      </button>
      <div className="text-center min-w-0" aria-live="polite">
        <p className="text-sm font-bold text-[#0f172a] capitalize">{pending ? '…' : title}</p>
        <p className="text-[11px] text-[#64748b] uppercase tracking-wide">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label={nextLabel}
        className={arrow}
        style={nextDisabled ? undefined : { color: accent }}
      >
        <span aria-hidden>›</span>
      </button>
    </div>
  )
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────

interface ExportCsvButtonProps {
  /** Parte del nombre del archivo: reporte-<kind>-<yyyy-mm>.csv */
  kind:    string
  year:    number
  month:   number
  headers: string[]
  rows:    CsvCell[][]
  /** Fila final opcional (totales), se agrega después de las filas. */
  totals?: CsvCell[]
  disabled?: boolean
}

export function ExportCsvButton({ kind, year, month, headers, rows, totals, disabled }: ExportCsvButtonProps) {
  const empty = rows.length === 0

  function handleExport() {
    try {
      const fileName = csvFileName(kind, year, month)
      downloadCsv(fileName, toCsv(headers, totals ? [...rows, totals] : rows))
      toast.success(`Descargado ${fileName}`)
    } catch {
      toast.error('No se pudo generar el archivo, reintenta')
    }
  }

  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={handleExport}
        disabled={disabled || empty}
        title={empty ? 'No hay datos para exportar en este periodo' : undefined}
        className="h-11 px-4 rounded-xl border border-[#e2e8f0] bg-white text-sm font-medium text-[#0f172a]
                   shadow-sm flex items-center gap-2 hover:bg-[#f8fafc] active:opacity-60
                   disabled:opacity-50 disabled:hover:bg-white"
      >
        <span aria-hidden>⬇️</span> Exportar CSV
      </button>
    </div>
  )
}

// ─── Tabla de escritorio ──────────────────────────────────────────────────────

export interface Column<T> {
  header: string
  /** Montos y conteos a la derecha. */
  numeric?: boolean
  cell:   (row: T) => ReactNode
  /** Celda de la fila de totales (vacía si se omite). */
  total?: ReactNode
}

interface ReportTableProps<T> {
  caption:     string
  columns:     Column<T>[]
  rows:        T[]
  rowKey:      (row: T) => string
  totalLabel?: string
  /** Color del texto de la fila de totales y su fondo/borde. */
  totalTone?:  { text: string; bg: string; border: string }
}

export function ReportTable<T>({
  caption, columns, rows, rowKey, totalLabel = 'Total',
  totalTone = { text: '#0f172a', bg: '#f8fafc', border: '#e2e8f0' },
}: ReportTableProps<T>) {
  const align = (c: Column<T>) => (c.numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left')
  return (
    <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-[#e2e8f0] shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
            {columns.map(c => (
              <th key={c.header} scope="col"
                  className={`px-4 py-2.5 text-[11px] font-bold text-[#64748b] uppercase tracking-wide ${align(c)}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={`border-b border-[#f1f5f9] ${i % 2 ? 'bg-[#fafafa]' : 'bg-white'} hover:bg-[#f1f5f9]`}>
              {columns.map((c, j) => j === 0 ? (
                <th key={c.header} scope="row" className="px-4 py-2.5 text-left font-semibold text-[#0f172a]">
                  {c.cell(r)}
                </th>
              ) : (
                <td key={c.header} className={`px-4 py-2.5 text-[#0f172a] ${align(c)}`}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: totalTone.bg, borderTop: `1px solid ${totalTone.border}`, color: totalTone.text }}>
            {columns.map((c, j) => j === 0 ? (
              <th key={c.header} scope="row" className="px-4 py-2.5 text-left font-bold">{totalLabel}</th>
            ) : (
              <td key={c.header} className={`px-4 py-2.5 font-bold ${align(c)}`}>{c.total ?? ''}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Monto para celda de tabla: «—» si es cero, rojo si es negativo. */
export function Money({ value, tone }: { value: number; tone?: string }) {
  if (value === 0) return <span className="text-[#64748b]">—</span>
  const color = value < 0 ? '#ef4444' : tone
  return <span style={color ? { color } : undefined}>{fmtCOP(value)}</span>
}
