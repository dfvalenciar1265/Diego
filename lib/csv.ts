/**
 * CSV para Excel en español (Colombia).
 *
 * Excel con configuración regional es-CO usa la coma como separador decimal, así que
 * espera `;` entre columnas. Sin el BOM UTF-8 al inicio abre el archivo como ANSI y
 * las tildes salen rotas («Ã¡»). Por eso `toCsv` usa `;`, `\r\n` y antepone el BOM.
 *
 *   const csv = toCsv(['Apto', 'Neto'], [['Palmetto 1001', 1250000]])
 *   downloadCsv(csvFileName('rentabilidad', 2026, 10), csv)
 */

export type CsvCell = string | number | null | undefined

export const CSV_SEPARATOR = ';'
const BOM = '﻿'

/**
 * Números sin separador de miles (Excel los reconoce como número) y con coma decimal.
 * Los no finitos (NaN, Infinity) quedan vacíos en vez de escribir texto basura.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  return String(n).replace('.', ',')
}

/**
 * Texto: se encierra entre comillas si trae separador, comillas, saltos de línea o
 * espacios al borde, y las comillas internas se duplican. Si empieza como fórmula
 * (= + - @, tabulador o retorno) se le antepone un apóstrofo para que Excel no la
 * ejecute: un proveedor escrito como «=HYPERLINK(...)» no debe volverse un enlace.
 */
function formatText(s: string): string {
  let out = s
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`
  if (/[";\r\n]/.test(out) || out !== out.trim()) {
    out = `"${out.replace(/"/g, '""')}"`
  }
  return out
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return formatNumber(value)
  return formatText(value)
}

/** Arma el CSV completo (BOM + encabezados + filas), listo para guardar como archivo. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map(r => r.map(csvCell).join(CSV_SEPARATOR))
  return BOM + lines.join('\r\n') + '\r\n'
}

/** `reporte-rentabilidad-2026-03.csv` */
export function csvFileName(kind: string, year: number, month: number): string {
  return `reporte-${kind}-${year}-${String(month).padStart(2, '0')}.csv`
}

/** Descarga el CSV en el navegador. Solo cliente. */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = fileName
  a.rel      = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari necesita que el enlace siga vivo un instante después del click.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
