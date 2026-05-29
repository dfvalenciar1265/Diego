import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDashboardKPIs, getTodayCheckOuts } from '@/actions/dashboard'
import { getTasks } from '@/actions/tasks'
import { getLowStockAlerts } from '@/actions/supplies'
import { getPurchaseRequests } from '@/actions/purchases'
import { KPICard } from '@/components/dashboard/KPICard'
import { StockAlert } from '@/components/dashboard/StockAlert'
import { TaskCard } from '@/components/tasks/TaskCard'
import { PrepTaskCard } from '@/components/tasks/PrepTaskCard'
import { ResolvePurchaseButton } from '@/components/dashboard/ResolvePurchaseButton'
import { canDo } from '@/lib/permissions'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { PurchaseRequest, Task } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members').select('*').eq('id', user.id).single()

  // Equipo va directo a sus tareas
  if (member && !canDo(member.role, 'dashboard:view')) {
    redirect('/tasks')
  }

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  const [kpis, todayTasks, stockAlerts, pendingPurchases, checkOuts] = await Promise.all([
    getDashboardKPIs(),
    getTasks({ date: format(new Date(), 'yyyy-MM-dd') }),
    getLowStockAlerts(),
    getPurchaseRequests('pending'),
    getTodayCheckOuts(),
  ])

  // Group today's tasks by type
  const cleaningTasks = todayTasks.filter((t: Task) => t.type === 'cleaning')
  const prepTasks     = todayTasks.filter((t: Task) => t.type === 'preparation')
  const otherTasks    = todayTasks.filter((t: Task) => t.type !== 'cleaning' && t.type !== 'preparation')

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="bg-white border-b border-[#e2e8f0] px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#0f172a]">
              Buenos días, {member?.name?.split(' ')[0] ?? 'Diego'} 👋
            </h1>
            <p className="text-xs text-[#94a3b8] capitalize">{today}</p>
          </div>
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm"
               style={{ background: 'linear-gradient(135deg, #ff385c, #ff6b6b)' }}>
            {member?.name?.[0] ?? 'D'}
          </div>
        </div>
      </div>

      {/* KPIs — hoy, grid 3 columnas iguales */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4">
        <KPICard label="Check-ins"  value={kpis.checkInsToday}
                 color="#ff385c" subtitle="hoy" icon="🏠" />
        <KPICard label="Check-outs" value={kpis.checkOutsToday}
                 color="#22c55e" subtitle="hoy" icon="🚪" />
        <KPICard label="Tareas"     value={kpis.pendingTasks}
                 color="#f97316" subtitle="hoy" icon="✅" />
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Check-out times — quick view for admin to plan cleaning staff */}
        {checkOuts.length > 0 && (
          <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                              shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
              🚪 Check-outs de hoy — horarios
            </p>
            <div className="space-y-2">
              {checkOuts.map(co => (
                <div key={co.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#0f172a] truncate">{co.property_name}</p>
                    <p className="text-xs text-[#94a3b8] truncate">{co.guest_name}</p>
                  </div>
                  <span className="text-sm font-semibold text-[#22c55e] flex-shrink-0 ml-3">
                    {co.check_out_time}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

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
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
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
        {(prepTasks.length > 0 || otherTasks.length > 0) && (
        <section>
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            ✅ Tareas de hoy ({prepTasks.length + otherTasks.length})
          </p>

          <div className="space-y-4">

              {/* Preparación — tarjeta especial con datos de reserva */}
              {prepTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🛏️</span>
                    <span className="text-xs font-semibold text-[#ff385c] uppercase tracking-wide">
                      Preparación ({prepTasks.length})
                    </span>
                    <div className="flex-1 h-px bg-[#ffe4e8]" />
                  </div>
                  <div className="space-y-3">
                    {prepTasks.map((t: Task) => <PrepTaskCard key={t.id} task={t as any} />)}
                  </div>
                </div>
              )}

              {/* Otras */}
              {otherTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">📋</span>
                    <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">
                      Otras ({otherTasks.length})
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
        <p className="text-xs text-[#94a3b8]">{request.property?.name}</p>
      </div>
      <ResolvePurchaseButton id={request.id} />
    </div>
  )
}
