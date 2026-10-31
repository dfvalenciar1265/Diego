import { todayInBogota, hourInBogota, addDays } from '@/lib/gpt-api/dates'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth'
import { getTodayCheckOuts } from '@/actions/dashboard'
import { getTeamMembers } from '@/actions/team'
import { getTasks } from '@/actions/tasks'
import { getMaintenance } from '@/actions/maintenance'
import { getAcceptedChanges } from '@/actions/reservations'
import { getTodayFollowups } from '@/actions/followups'
import { ChargeLine, RequestLine } from '@/components/dashboard/FollowupItems'
import { PendingChangeCard } from '@/components/dashboard/PendingChangeCard'
import { getLowStockAlerts } from '@/actions/supplies'
import { getPurchaseRequests } from '@/actions/purchases'
import { KPICard } from '@/components/dashboard/KPICard'
import { StockAlert } from '@/components/dashboard/StockAlert'
import { TaskCard } from '@/components/tasks/TaskCard'
import { CheckoutCard } from '@/components/dashboard/CheckoutCard'
import { DashboardPrepCard } from '@/components/dashboard/DashboardPrepCard'
import { preparationArrivals, preparationViews } from '@/lib/gpt-api/preparation'
import { RefreshButton } from '@/components/dashboard/RefreshButton'
import { ResolvePurchaseButton } from '@/components/dashboard/ResolvePurchaseButton'
import { canDo } from '@/lib/permissions'
import { canOperateCheckoutCleaning } from '@/lib/checkout-cleaning'
import { dashboardSummary } from '@/lib/dashboard-summary'
import { PendingMaintenance, type OpenMaintenance } from '@/components/dashboard/PendingMaintenance'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { PurchaseRequest, Task } from '@/lib/types'

export default async function DashboardPage() {
  // Cached per request — no duplicate auth round-trip with the layout
  const member = await getCurrentMember()
  if (!member) redirect('/logout')

  // Equipo va directo a sus tareas
  if (!canDo(member.role, 'dashboard:view')) {
    redirect('/tasks')
  }

  const now      = new Date()
  // The server runs in UTC: "today" and the greeting must follow Colombia's clock
  const todayISO = todayInBogota(now)
  const today    = format(new Date(todayISO + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })
  const hour     = hourInBogota(now)
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  // All dashboard data fetched concurrently (no waterfall)
  const supabase = await createClient()
  const [arrivals, todayTasks, stockAlerts, pendingPurchases, checkOuts, maintenanceAll, acceptedChanges, followups, people] = await Promise.all([
    preparationArrivals(supabase, todayISO),
    getTasks({ date: todayISO, type: 'other' }),
    getLowStockAlerts(),
    getPurchaseRequests('pending'),
    getTodayCheckOuts(todayISO),
    getMaintenance(),
    getAcceptedChanges(),
    getTodayFollowups(),
    member.role === 'admin' || member.role === 'anfitrion' ? getTeamMembers() : Promise.resolve([]),
  ])

  // Cobros adicionales: los de quien sale hoy van con su salida; el resto (vencidos u otros) aparte.
  const showCharges = canDo(member.role, 'finances:view')
  const charges = showCharges ? followups.charges : []
  const checkoutIds = new Set(checkOuts.map(co => co.id))
  const otherCharges = charges.filter(c => !checkoutIds.has(c.reservation_id))

  // Unresolved REPORTED incidences surfaced on the home so an urgent report isn't
  // siloed in the Mantenimiento tab. Excludes 'scheduled' (preventive/recurring —
  // that's a planning list, not an alert, and lives in its own section). Urgent first.
  const priorityRank: Record<string, number> = { urgent: 0, normal: 1 }
  const openMaintenance = (maintenanceAll as OpenMaintenance[])
    .filter(m => m.status !== 'resolved' && m.priority !== 'scheduled')
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9))

  const prepArrivals = arrivals.filter(r => r.status === 'confirmed' && r.check_in >= todayISO && r.check_in <= addDays(todayISO, 1))
  const preparationById = await preparationViews(supabase, prepArrivals, todayISO)

  // Other tasks scheduled for today (cleaning shown in its own section)
  const otherTasks = todayTasks.filter((t: Task) => t.type !== 'cleaning' && t.type !== 'preparation' && t.scheduled_for === todayISO)
  const kpis = dashboardSummary(todayISO, prepArrivals, checkOuts, preparationById, otherTasks)
  const cleaners = people.filter(p => canOperateCheckoutCleaning(p.role)).map(p => ({ id: p.id, name: p.name }))

  return (
    <div className="pb-4">
      {/* Header — phone: white bar; md+: page title over the content (the sidebar is the bar) */}
      <header className="bg-white border-b border-[#e2e8f0] px-4 pt-4 pb-3
                         md:bg-transparent md:border-0 md:pt-8 md:pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold text-[#0f172a] truncate">
              {greeting}, {member.name?.split(' ')[0] ?? 'Diego'} 👋
            </h1>
            <p className="text-xs md:text-sm text-[#64748b] first-letter:uppercase md:mt-0.5">{today}</p>
          </div>
          <div className="flex items-center gap-1 md:gap-2 shrink-0">
            <RefreshButton />
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center font-bold text-white text-sm"
                 style={{ background: 'linear-gradient(135deg, #ff385c, #ff6b6b)' }}
                 aria-hidden="true">
              {member?.name?.[0] ?? 'D'}
            </div>
          </div>
        </div>
      </header>

      {/* KPIs — hoy, grid 3 columnas iguales */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 px-4 pt-4">
        <KPICard label="Llegadas"  value={kpis.arrivalsToday}
                 color="#ff385c" subtitle="hoy" icon="🏠" />
        <KPICard label="Salidas" value={kpis.departuresToday}
                 color="#22c55e" subtitle="hoy" icon="🚪" />
        <KPICard label="Pendientes" value={kpis.pendingWork}
                 color="#f97316" subtitle="para hoy" icon="✅" />
      </div>
      <p className="px-4 pt-2 text-[11px] text-[#64748b]">Pendientes: limpiezas de hoy, preparación de llegadas de hoy y mañana, y otras tareas sin terminar.
        {kpis.unchecked ? ' Incluye trabajos que requieren comprobar sus datos.' : ''}</p>

      {/* Phone: stacked. lg+: two balanced columns, same reading order (CSS columns) */}
      <div className="px-4 pt-4 space-y-4 lg:space-y-0 lg:columns-2 lg:gap-4 [&>*]:break-inside-avoid lg:[&>*]:mb-4">

        {/* Check-out times — quick view for admin to plan cleaning staff */}
        {checkOuts.length > 0 && (
          <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                              shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-3">
              🚪 Salidas de hoy
            </p>
            <div className="space-y-2.5">
              {checkOuts.map(co => (
                <div key={co.id} className="space-y-1.5">
                  <CheckoutCard co={co} role={member.role} memberId={member.id} people={cleaners} />
                  {charges.filter(c => c.reservation_id === co.id).map(c => <ChargeLine key={c.id} charge={c} />)}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Cobros adicionales pendientes que no son de una salida de hoy (vencidos o de otras reservas) */}
        {otherCharges.length > 0 && (
          <section className="bg-white border border-[#fde68a] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#d97706] uppercase tracking-wide mb-3">
              💰 Cobros adicionales pendientes ({otherCharges.length})
            </p>
            <div className="space-y-1.5">
              {otherCharges.map(c => <ChargeLine key={c.id} charge={c} showStay />)}
            </div>
          </section>
        )}

        {/* Solicitudes especiales (cuna, camas…) que vencen hasta mañana o llegan hoy */}
        {followups.requests.length > 0 && (
          <section className="bg-white border border-[#e2e8f0] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-2">
              🧸 Solicitudes especiales ({followups.requests.length})
            </p>
            <div className="divide-y divide-[#f1f5f9]">
              {followups.requests.map(q => <RequestLine key={q.id} request={q} />)}
            </div>
          </section>
        )}

        {/* Cambios de reserva aceptados en Airbnb, esperando aplicarse acá */}
        {acceptedChanges.length > 0 && (
          <section className="bg-[#eff6ff] border border-[#bfdbfe] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#1d4ed8] uppercase tracking-wide mb-3">
              🔄 Cambios de reserva por aplicar ({acceptedChanges.length})
            </p>
            <div className="space-y-2">
              {acceptedChanges.map(r => (
                <PendingChangeCard key={r.id} reservation={r} />
              ))}
            </div>
          </section>
        )}

        {/* Mantenimiento pendiente — urgentes arriba, con enlace a la pantalla completa */}
        <PendingMaintenance issues={openMaintenance} />

        {/* Alertas de stock */}
        {stockAlerts.length > 0 && (
          <section className="bg-[#fffbeb] border border-[#fde68a] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#d97706] uppercase tracking-wide mb-2">
              📦 Stock bajo ({stockAlerts.length})
            </p>
            {stockAlerts.map(a => <StockAlert key={a.id} item={a} />)}
          </section>
        )}

        {/* Solicitudes de compra pendientes */}
        {pendingPurchases.length > 0 && (
          <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                              shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wide mb-3">
              🛒 Compras pendientes ({pendingPurchases.length})
            </p>
            <div className="space-y-2">
              {pendingPurchases.map(req => (
                <PurchaseRequestItem key={req.id} request={req} />
              ))}
            </div>
          </section>
        )}

        {/* Tareas de hoy — solo preparación y otras (limpieza va en su propia sección) */}
        {(prepArrivals.length > 0 || otherTasks.length > 0) && (
        <section>
          <div className="space-y-4">

              {/* Preparación de las llegadas de hoy y mañana: una tarjeta por reserva */}
              {prepArrivals.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🛏️</span>
                    <span className="text-xs font-semibold text-[#ff385c] uppercase tracking-wide">
                      Preparación · hoy y mañana ({prepArrivals.length})
                    </span>
                    <div className="flex-1 h-px bg-[#ffe4e8]" />
                  </div>
                  <div className="space-y-2">
                    {prepArrivals.map(arrival => <DashboardPrepCard key={arrival.id} arrival={arrival} preparation={preparationById[arrival.id]} role={member.role} />)}
                  </div>
                </div>
              )}

              {/* Otras */}
              {otherTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">📋</span>
                    <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wide">
                      Otras tareas de hoy ({otherTasks.length})
                    </span>
                    <div className="flex-1 h-px bg-[#e2e8f0]" />
                  </div>
                  <div className="space-y-3">
                    {otherTasks.map((t: Task) => <TaskCard key={t.id} task={t} />)}
                  </div>
                </div>
              )}

          </div>
        </section>
        )}

      </div>
    </div>
  )
}

function PurchaseRequestItem({ request }: { request: PurchaseRequest & { property?: { name: string } } }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#0f172a] truncate">{request.description}</p>
        <p className="text-xs text-[#64748b]">{request.property?.name}</p>
      </div>
      <ResolvePurchaseButton id={request.id} description={request.description} />
    </div>
  )
}
