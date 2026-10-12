import { describe, it, expect, vi, afterEach } from 'vitest'
import { toCsv, csvCell, csvFileName, downloadCsv } from '@/lib/csv'

const BOM = '﻿'

describe('csvCell', () => {
  it('deja el texto simple tal cual', () => {
    expect(csvCell('Palmetto 1001')).toBe('Palmetto 1001')
  })

  it('las comas no obligan a usar comillas (el separador es ;)', () => {
    expect(csvCell('Ecopetrol, gas')).toBe('Ecopetrol, gas')
  })

  it('encierra entre comillas el texto con punto y coma', () => {
    expect(csvCell('agua; luz')).toBe('"agua; luz"')
  })

  it('duplica las comillas internas', () => {
    expect(csvCell('Tienda "La 14"')).toBe('"Tienda ""La 14"""')
  })

  it('encierra los saltos de línea', () => {
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"')
  })

  it('conserva espacios al borde encerrándolos', () => {
    expect(csvCell(' Apto ')).toBe('" Apto "')
  })

  it('neutraliza texto que parece fórmula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+57 300')).toBe("'+57 300")
    expect(csvCell('-abc')).toBe("'-abc")
    expect(csvCell('@user')).toBe("'@user")
  })

  it('números sin miles y con coma decimal', () => {
    expect(csvCell(1250000)).toBe('1250000')
    expect(csvCell(-45000)).toBe('-45000')
    expect(csvCell(0.125)).toBe('0,125')
    expect(csvCell(0)).toBe('0')
  })

  it('vacío para null, undefined y no finitos', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(Infinity)).toBe('')
  })
})

describe('toCsv', () => {
  it('antepone el BOM, separa con ; y termina las líneas con CRLF', () => {
    const csv = toCsv(['Apto', 'Neto'], [['Palmetto 1001', 1250000], ['Tocahagua 708', -3000]])
    expect(csv).toBe(`${BOM}Apto;Neto\r\nPalmetto 1001;1250000\r\nTocahagua 708;-3000\r\n`)
  })

  it('sin filas devuelve solo los encabezados', () => {
    expect(toCsv(['A', 'B'], [])).toBe(`${BOM}A;B\r\n`)
  })

  it('escapa encabezados y celdas, y respeta celdas vacías', () => {
    const csv = toCsv(['Notas; extra', 'Valor'], [['dijo "hola"', null]])
    expect(csv).toBe(`${BOM}"Notas; extra";Valor\r\n"dijo ""hola""";\r\n`)
  })

  it('mantiene tildes y eñes', () => {
    expect(toCsv(['Año', 'Línea'], [['Bogotá', 'Peña']])).toContain('Año;Línea\r\nBogotá;Peña')
  })
})

describe('csvFileName', () => {
  it('rellena el mes con cero', () => {
    expect(csvFileName('rentabilidad', 2026, 3)).toBe('reporte-rentabilidad-2026-03.csv')
    expect(csvFileName('gastos', 2026, 12)).toBe('reporte-gastos-2026-12.csv')
  })
})

describe('downloadCsv', () => {
  afterEach(() => vi.restoreAllMocks())

  it('crea un enlace con el nombre del archivo y lo pulsa', () => {
    const createURL = vi.fn(() => 'blob:fake')
    const revokeURL = vi.fn()
    Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: revokeURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('reporte-x-2026-01.csv', toCsv(['A'], [[1]]))

    expect(createURL).toHaveBeenCalledOnce()
    const blob = (createURL.mock.calls[0] as unknown as [Blob])[0]
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('reporte-x-2026-01.csv')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
