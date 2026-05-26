import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMaintenance } from '@/actions/maintenance'
import { getProperties } from '@/actions/properties'
import { IncidenceCard } from '@/components/maintenance/IncidenceCard'
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

  const open = issues.filter(i => i.status !== 'resolved')
  const resolved = issues.filter(i => i.status === 'resolved')

  return (
    <>
      <PageHeader title="Mantenimiento"
        action={<MaintenanceClient properties={properties} />} />
      <div className="p-4 space-y-4">
        {open.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">
              Abiertas ({open.length})
            </p>
            <div className="space-y-3">
              {open.map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}
        {resolved.length > 0 && (
          <section>
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">
              Resueltas
            </p>
            <div className="space-y-3 opacity-60">
              {resolved.slice(0, 5).map(i => <IncidenceCard key={i.id} issue={i} />)}
            </div>
          </section>
        )}
        {issues.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔧</p>
            <p className="text-[#94a3b8]">Sin incidencias activas</p>
          </div>
        )}
      </div>
    </>
  )
}
