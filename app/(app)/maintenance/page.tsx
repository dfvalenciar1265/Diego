import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMaintenance } from '@/actions/maintenance'
import { getProperties } from '@/actions/properties'
import { IncidenceCard } from '@/components/maintenance/IncidenceCard'
import { ScheduledCard } from '@/components/maintenance/ScheduledCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { MaintenanceClient } from '@/components/maintenance/MaintenanceClient'

export default async function MaintenancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()

  const [issues, properties] = await Promise.all([
    getMaintenance(),
    getProperties(),
  ])

  // ── Split scheduled vs reactive ────────────────────────────────────────────
  const scheduled = issues.filter(i => i.priority === 'scheduled' && i.status !== 'resolved')
    .sort((a, b) => {
      // Sort by next date extracted from description
      const getNext = (desc: string) => desc.match(/next:([^|]+)/)?.[1] ?? '9999'
      return getNext(a.description).localeCompare(getNext(b.description))
    })

  const incidences = issues.filter(i => i.priority !== 'scheduled')
  const open       = incidences.filter(i => i.status !== 'resolved')
  const resolved   = incidences.filter(i => i.status === 'resolved')

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        action={<MaintenanceClient properties={properties} />}
      />
      <div className="p-4 space-y-5">

        {/* ── Mantenimientos programados ────────────────────────────── */}
        {scheduled.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🗓️</span>
              <span className="text-xs font-semibold text-[#6366f1] uppercase tracking-wide">
                Mantenimientos programados ({scheduled.length})
              </span>
              <div className="flex-1 h-px bg-[#e0e7ff]" />
            </div>
            <div className="space-y-3">
              {scheduled.map(i => <ScheduledCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}

        {/* ── Incidencias activas ────────────────────────────────────── */}
        {open.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🔧</span>
              <span className="text-xs font-semibold text-[#ef4444] uppercase tracking-wide">
                Incidencias abiertas ({open.length})
              </span>
              <div className="flex-1 h-px bg-[#fee2e2]" />
            </div>
            <div className="space-y-3">
              {open.map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}

        {/* ── Incidencias resueltas ──────────────────────────────────── */}
        {resolved.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">✅</span>
              <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide">
                Resueltas
              </span>
              <div className="flex-1 h-px bg-[#e2e8f0]" />
            </div>
            <div className="space-y-3 opacity-60">
              {resolved.slice(0, 5).map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}

        {/* ── Empty state ────────────────────────────────────────────── */}
        {scheduled.length === 0 && issues.filter(i => i.priority !== 'scheduled').length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔧</p>
            <p className="text-[#94a3b8]">Sin incidencias activas</p>
          </div>
        )}
      </div>
    </>
  )
}
