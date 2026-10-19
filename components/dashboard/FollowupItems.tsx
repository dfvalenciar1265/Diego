import type { DueCharge, OpenRequest } from '@/actions/followups'
import { shortDate } from '@/lib/gpt-api/dates'
import { CollectChargeButton, RequestButtons } from './FollowupActions'

const cop = (n: number) => `$${n.toLocaleString('es-CO')}`

/** Cobro adicional pendiente: aparte del precio de la reserva y todavía no recibido. */
export function ChargeLine({ charge, showStay = false }: { charge: DueCharge; showStay?: boolean }) {
  return (
    <div className="rounded-md bg-[#fffbeb] border border-[#fde68a] px-2.5 py-1.5">
      <p className="text-xs font-semibold text-[#92400e]">
        💰 Cobrar {cop(charge.amount)} — {charge.concept}
      </p>
      <p className="text-[11px] text-[#92400e]/80">
        {showStay && <>{charge.property_name} · {charge.guest_name} · </>}
        pendiente, vence {shortDate(charge.due_date)}
      </p>
      {charge.review_reason && <p className="text-[11px] text-[#b91c1c] mt-0.5">⚠️ Revisar: {charge.review_reason}</p>}
      <div className="mt-1"><CollectChargeButton id={charge.id} version={charge.version} /></div>
    </div>
  )
}

const KIND: Record<OpenRequest['kind'], string> = { crib: '🧸 Cuna', beds: '🛏️ Camas', other: '📌 Solicitud' }
// Avisar no es dejar lista: cada estado se dice tal cual.
const STATUS: Record<OpenRequest['status'], { label: string; color: string }> = {
  registered: { label: 'Registrada · sin avisar', color: '#b91c1c' },
  notified:   { label: 'Avisada · falta confirmar que quedó lista', color: '#d97706' },
  ready:      { label: 'Lista ✓ confirmada', color: '#15803d' },
  cancelled:  { label: 'Cancelada', color: '#64748b' },
}

function dueText(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d)
  const time = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(d)
  return `${shortDate(day)} ${time}`
}

export function RequestLine({ request }: { request: OpenRequest }) {
  const status = STATUS[request.status]
  return (
    <div className="py-1">
      <p className="text-xs font-medium text-[#0f172a]">
        {KIND[request.kind]} · {request.property_name}
        <span className="text-[#64748b] font-normal"> · llega {shortDate(request.check_in)} ({request.guest_name})</span>
      </p>
      <p className="text-[11px] text-[#64748b]">{request.description}</p>
      <p className="text-[11px]">
        <span style={{ color: status.color }} className="font-semibold">{status.label}</span>
        <span className="text-[#64748b]"> · límite {dueText(request.due_at)}{request.responsible_name ? ` · ${request.responsible_name}` : ''}</span>
      </p>
      {request.review_reason && <p className="text-[11px] text-[#b91c1c]">⚠️ Revisar: {request.review_reason}</p>}
      <RequestButtons id={request.id} version={request.version} status={request.status} />
    </div>
  )
}
