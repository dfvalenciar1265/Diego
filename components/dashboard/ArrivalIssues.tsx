import Link from 'next/link'
import type { PreparationView } from '@/lib/preparation'

/** Incidencias y solicitudes de la llegada, sin controles de confirmación de preparación. */
export function ArrivalIssues({ preparation: view }: { preparation: Pick<PreparationView, 'issues' | 'requests' | 'error'> }) {
  if (!view.issues.length && !view.requests.length && !view.error) return null
  return <div className="mt-2 space-y-2 border-t border-[#e2e8f0] pt-2 text-xs">
    {view.issues.length > 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
      <p className="font-semibold text-amber-900">⚠ Incidencias en este apartamento ({view.issues.length})</p>
      <ul className="mt-1 space-y-1 text-amber-950">{view.issues.map(issue => <li key={issue.id}>
        {issue.priority === 'urgent' ? <strong>Urgente · </strong> : null}{issue.title}
      </li>)}</ul>
      <Link href="/maintenance" className="inline-flex min-h-11 items-center font-medium underline">Ver en Mantenimiento</Link>
    </div> : null}
    {view.requests.length > 0 ? <ul className="space-y-1 text-[#475569]">{view.requests.map(q => <li key={q.id}>
      {q.status === 'ready' && !q.review_reason ? '✓' : '⚠'} {q.description} · {q.status === 'ready' && !q.review_reason ? 'lista' : 'pendiente o por revisar'}
    </li>)}</ul> : null}
    {view.error ? <p role="alert" className="text-amber-900">{view.error}</p> : null}
  </div>
}
