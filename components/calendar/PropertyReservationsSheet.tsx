'use client'
import { differenceInDays, parseISO, format } from 'date-fns'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useUserRole } from '@/lib/user-context'
import type { Property, Reservation } from '@/lib/types'

const SRC: Record<string, { label: string; color: string }> = {
  airbnb: { label: 'Airbnb', color: '#ff385c' },
  direct: { label: 'Directa', color: '#6366f1' },
}
const BLOCKED = { label: 'Bloqueado', color: '#94a3b8' }

const fmtCOP = (n: number) => `$${n.toLocaleString('es-CO')}`
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  const months = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10)]}`
}

interface Props {
  property: Property | null
  reservations: Reservation[]
  onClose: () => void
  /** Called when a row is tapped (admins only) — opens the reservation to edit. */
  onSelect: (r: Reservation) => void
}

/** Bottom sheet listing all reservations of one apartment (upcoming first, then past). */
export function PropertyReservationsSheet({ property, reservations, onClose, onSelect }: Props) {
  const role           = useUserRole()
  const canSeeFinances = role === 'admin' || role === 'maintenance'
  const canEdit        = role === 'admin'

  const today    = format(new Date(), 'yyyy-MM-dd')
  const sorted   = [...reservations].sort((a, b) => a.check_in.localeCompare(b.check_in))
  const upcoming = sorted.filter(r => r.check_out >= today)
  const past     = sorted.filter(r => r.check_out < today).reverse()

  return (
    <Sheet open={property != null} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl"
        style={{ maxHeight: '85dvh', overflowY: 'auto', padding: '1rem 1rem env(safe-area-inset-bottom,1rem)' }}
      >
        <SheetHeader className="mb-3">
          <SheetTitle>{property?.name ?? ''}</SheetTitle>
        </SheetHeader>

        {reservations.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm text-[#94a3b8]">Sin reservas para este apartamento</p>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {upcoming.length > 0 && (
              <Section title={`Próximas y actuales (${upcoming.length})`}>
                {upcoming.map(r => (
                  <Row key={r.id} r={r} canEdit={canEdit} canSeeFinances={canSeeFinances} onSelect={onSelect} />
                ))}
              </Section>
            )}
            {past.length > 0 && (
              <Section title={`Pasadas (${past.length})`}>
                {past.map(r => (
                  <Row key={r.id} r={r} canEdit={canEdit} canSeeFinances={canSeeFinances} onSelect={onSelect} dim />
                ))}
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wide mb-2 px-1">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Row({
  r, canEdit, canSeeFinances, onSelect, dim = false,
}: {
  r: Reservation
  canEdit: boolean
  canSeeFinances: boolean
  onSelect: (r: Reservation) => void
  dim?: boolean
}) {
  const blocked = r.status === 'blocked'
  const src     = blocked ? BLOCKED : (SRC[r.source] ?? SRC.direct)
  const nights  = Math.max(0, differenceInDays(parseISO(r.check_out), parseISO(r.check_in)))

  return (
    <button
      onClick={() => canEdit && onSelect(r)}
      disabled={!canEdit}
      className={`w-full text-left flex items-stretch gap-3 bg-white border border-[#e2e8f0] rounded-xl px-3 py-2.5
                  ${canEdit ? 'active:opacity-70' : ''} ${dim ? 'opacity-70' : ''}`}
    >
      <span className="w-1 rounded-full shrink-0" style={{ background: src.color }} />
      <div className="flex-1 min-w-0 py-0.5">
        <p className="text-sm font-semibold text-[#0f172a] truncate">
          {blocked ? '🚫 Bloqueado' : (r.guest_name || '—')}
        </p>
        <p className="text-[11px] text-[#94a3b8]">
          {shortDate(r.check_in)} → {shortDate(r.check_out)} · {nights}n · {src.label}
        </p>
      </div>
      {canSeeFinances && !blocked && r.amount > 0 && (
        <span className="text-xs font-semibold text-[#16a34a] shrink-0 self-center">{fmtCOP(r.amount)}</span>
      )}
      {canEdit && <span className="text-[#cbd5e1] shrink-0 self-center">›</span>}
    </button>
  )
}
