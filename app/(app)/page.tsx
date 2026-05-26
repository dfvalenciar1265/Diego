import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDashboardKPIs, getWeekOccupancy } from '@/actions/dashboard'
import { getTasks } from '@/actions/tasks'
import { getLowStockAlerts } from '@/actions/supplies'
import { getPurchaseRequests } from '@/actions/purchases'
import { KPICard } from '@/components/dashboard/KPICard'
import { OccupancyBar } from '@/components/dashboard/OccupancyBar'
import { StockAlert } from '@/components/dashboard/StockAlert'
import { TaskCard } from '@/components/tasks/TaskCard'
import { ResolvePurchaseButton } from '@/components/dashboard/ResolvePurchaseButton'
import { canDo } from '@/lib/permissions'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { PurchaseRequest } from '@/lib/types'

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

  const [kpis, occupancy, todayTasks, stockAlerts, pendingPurchases] = await Promise.all([
    getDashboardKPIs(),
    getWeekOccupancy(),
    getTasks({ date: format(new Date(), 'yyyy-MM-dd') }),
    getLowStockAlerts(),
    getPurchaseRequests('pending'),
  ])

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

      {/* KPIs — scroll horizontal */}
      <div className="flex gap-3 px-4 pt-4 overflow-x-auto pb-1 scrollbar-none">
        <KPICard label="Check-ins" value={kpis.checkInsToday}
                 color="#ff385c" subtitle="hoy" icon="🏠" />
        <KPICard label="Check-outs" value={kpis.checkOutsToday}
                 color="#22c55e" subtitle="hoy" icon="🚪" />
        <KPICard label="Tareas" value={kpis.pendingTasks}
                 color="#f97316" subtitle="pendientes" icon="✅" />
        <KPICard label="Ingresos" value={`$${Math.round(kpis.monthlyRevenue / 1000)}k`}
                 color="#6366f1" subtitle="este mes" icon="💰" />
      </div>

      <div className="px-4 pt-4 space-y-4">

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

        {/* Ocupación de la semana */}
        <section className="bg-white border border-[#e2e8f0] rounded-xl p-4
                            shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            📅 Ocupación esta semana
          </p>
          <div className="space-y-2">
            {occupancy.map(o => (
              <OccupancyBar key={o.property.id} name={o.property.name}
                            occupied={o.daysOccupied} total={o.totalDays} />
            ))}
          </div>
        </section>

        {/* Tareas de hoy */}
        <section>
          <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-3">
            ✅ Tareas de hoy ({todayTasks.length})
          </p>
          {todayTasks.length === 0 ? (
            <p className="text-sm text-[#94a3b8] text-center py-4">Sin tareas para hoy 🎉</p>
          ) : (
            <div className="space-y-3">
              {todayTasks.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          )}
        </section>
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
