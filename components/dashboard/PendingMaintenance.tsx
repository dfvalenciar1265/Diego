import Link from 'next/link'
import type { MaintenanceIssue } from '@/lib/types'

export type OpenMaintenance = MaintenanceIssue & { property?: { name: string } | null }
export function PendingMaintenance({ issues }: { issues: OpenMaintenance[] }) {
  if (!issues.length) return null
  const urgent = issues.filter(i => i.priority === 'urgent').length
  return <details className="group rounded-xl border border-[#e2e8f0] bg-white px-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
    <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-2 py-3 text-xs font-semibold text-[#64748b] [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="transition-transform group-open:rotate-90">▸</span>
      <span className="min-w-0 flex-1">🔧 Mantenimiento pendiente ({issues.length})</span>
      {urgent > 0 ? <span className="rounded bg-red-50 px-2 py-1 text-red-700">{urgent} urgente{urgent === 1 ? '' : 's'}</span> : null}
    </summary>
    <ul className="space-y-1.5 border-t border-[#e2e8f0] pt-2">
      {issues.map(issue => <li key={issue.id} className="flex items-start gap-2.5 py-1">
        <span aria-hidden="true" className={`mt-1 w-2 h-2 rounded-full shrink-0 ${issue.priority === 'urgent' ? 'bg-red-500' : 'bg-orange-500'}`} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs font-medium text-[#0f172a]">{issue.title}</p>
          <p className="break-words text-[11px] text-[#64748b]">{issue.property?.name ?? '—'} · {issue.priority === 'urgent' ? 'Urgente' : 'Normal'}{issue.status === 'in_progress' ? ' · en curso' : ''}</p>
        </div>
      </li>)}
    </ul>
    <Link href="/maintenance" className="inline-flex min-h-11 items-center text-xs font-semibold text-[#6366f1]">Ver en Mantenimiento →</Link>
  </details>
}
