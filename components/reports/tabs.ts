/** Pestañas de Reportes. El valor va en la URL como `?tab=<key>`. */
export const REPORT_TABS = [
  { key: 'profitability',  icon: '📈', label: 'Renta'    },
  { key: 'income',         icon: '💵', label: 'Ingresos' },
  { key: 'cleaning_costs', icon: '🧹', label: 'Costos'   },
  { key: 'employee',       icon: '👤', label: 'Empleada' },
  { key: 'admin',          icon: '🏢', label: 'Admin'    },
  { key: 'expenses',       icon: '💰', label: 'Gastos'   },
] as const

export type ReportTab = (typeof REPORT_TABS)[number]['key']

const KEYS = new Set<string>(REPORT_TABS.map(t => t.key))

/** Valor de `?tab=` → pestaña válida; cualquier otra cosa cae en Rentabilidad. */
export function parseReportTab(value: string | string[] | null | undefined): ReportTab {
  const v = Array.isArray(value) ? value[0] : value
  return v && KEYS.has(v) ? (v as ReportTab) : 'profitability'
}
