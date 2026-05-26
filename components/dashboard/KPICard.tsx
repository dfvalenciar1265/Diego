interface Props {
  label: string
  value: number | string
  color: string
  subtitle?: string
  icon?: string
}

export function KPICard({ label, value, color, subtitle, icon }: Props) {
  return (
    <div className="flex-shrink-0 rounded-xl p-4 min-w-[100px]"
         style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
      {icon && <p className="text-xl mb-1">{icon}</p>}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">{label}</p>
      <p className="text-2xl font-bold mt-0.5" style={{ color }}>{value}</p>
      {subtitle && <p className="text-[11px] text-[#94a3b8] mt-0.5">{subtitle}</p>}
    </div>
  )
}
