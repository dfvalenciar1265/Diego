import Link from 'next/link'
import type { PreparationView } from '@/lib/preparation'

/** Resumen de lectura: nunca confirma trabajo ni deduce listo de una tarea terminada. */
export function PreparationSummary({ preparation: view }: { preparation: PreparationView }) {
  const state = view.state
  const ready = view.available && Boolean(state?.ready_at) && view.blockers.length === 0
  const urgent = view.issues.some(issue => issue.priority === 'urgent')
  const requestsPending = view.requests.some(request => request.status !== 'ready' || request.review_reason)
  let next = 'Confirmar que está listo para recibir'
  let team = 'Administración o anfitrión'
  let href = '/tasks'
  if (!view.available) {
    next = 'Comprobar los datos de preparación'
  } else if (state?.review_reason) {
    next = 'Revisar el cambio antes de continuar'
  } else if (urgent) {
    next = 'Resolver y verificar la incidencia urgente'
    team = 'Mantenimiento y administración'
    href = '/maintenance'
  } else if (!state?.cleaned_at) {
    next = 'Confirmar la limpieza de esta llegada'
    team = 'Limpieza, anfitrión o administración'
  } else if (!state.checked_at) {
    next = 'Revisar el funcionamiento del apartamento'
    team = 'Limpieza, mantenimiento o administración'
  } else if (requestsPending) {
    next = 'Revisar las solicitudes especiales pendientes'
  } else if (view.blockers.length > 0 || !view.can_confirm) {
    next = 'Revisar los requisitos de esta llegada'
  }
  const progress = view.available ? [
    { label: 'Limpieza', confirmed: Boolean(state?.cleaned_at) },
    { label: 'Revisión', confirmed: Boolean(state?.checked_at) },
    { label: 'Listo', confirmed: ready },
  ] : []
  return <section aria-label="Resumen de preparación" className={`mt-3 rounded-lg border p-3 text-xs ${ready ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
    <p className={`font-semibold ${ready ? 'text-green-800' : 'text-slate-900'}`}>
      {ready ? 'Listo para recibir · confirmado' : view.available ? 'Preparación pendiente' : 'Preparación sin comprobar'}
    </p>
    {progress.length > 0 ? <ul aria-label="Etapas de preparación" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-700">
      {progress.map(step => <li key={step.label}>{step.confirmed ? '✓' : '○'} {step.label}: {step.confirmed ? 'confirmado' : 'pendiente'}</li>)}
    </ul> : null}
    {ready ? <p className="mt-2 text-green-900">Confirmó: {state?.ready_name || 'Nombre no registrado'}. Consulta el historial para ver fecha y procedencia.</p>
      : <>
        <p className="mt-2 font-medium text-slate-900">Próximo paso: {next}.</p>
        <p className="mt-1 text-slate-600">Equipo que puede resolver: {team}. La asignación individual se consulta en Tareas.</p>
        {state?.review_reason ? <p className="mt-1 break-words text-amber-900">{state.review_reason}</p> : null}
        {view.available && !view.can_confirm ? <p className="mt-1 text-slate-600">La confirmación no está habilitada para esta fecha o reserva.</p> : null}
      </>}
    <Link href={href} className="mt-1 inline-flex min-h-11 items-center font-semibold text-slate-900 underline">
      {ready ? 'Consultar preparación' : href === '/maintenance' ? 'Revisar incidencia' : 'Ver preparación y responsables'}
    </Link>
  </section>
}
