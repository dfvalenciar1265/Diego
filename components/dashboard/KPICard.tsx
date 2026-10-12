interface Props {
  label: string
  value: number | string
  color: string
  subtitle?: string
  icon?: string
}

export function KPICard({ label, value, color, subtitle, icon }: Props) {
  return (
    <div className="rounded-2xl p-3"
         style={{ backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
      {icon && <p className="text-base mb-1">{icon}</p>}
      <p className="text-[9px] font-bold uppercase tracking-wider text-[#64748b] leading-tight">{label}</p>
      <p className="text-[28px] font-bold mt-0.5 leading-none" style={{ color }}>{value}</p>
      {subtitle && <p className="text-[10px] text-[#64748b] mt-1 leading-tight">{subtitle}</p>}
    </div>
  )
}
