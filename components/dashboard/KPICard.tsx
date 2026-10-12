interface Props {
  label: string
  value: number | string
  color: string
  subtitle?: string
  icon?: string
}

export function KPICard({ label, value, color, subtitle, icon }: Props) {
  return (
    <div className="rounded-2xl p-3 md:p-4"
         style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
      {icon && <p className="text-base mb-1">{icon}</p>}
      <p className="text-[11px] md:text-xs font-bold uppercase tracking-wide text-[#64748b] leading-tight">{label}</p>
      <p className="text-[28px] md:text-4xl font-bold mt-0.5 leading-none" style={{ color }}>{value}</p>
      {subtitle && <p className="text-[11px] md:text-xs text-[#64748b] mt-1 leading-tight">{subtitle}</p>}
    </div>
  )
}
