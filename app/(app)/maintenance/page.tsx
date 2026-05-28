import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMaintenance } from '@/actions/maintenance'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { MaintenanceClient } from '@/components/maintenance/MaintenanceClient'
import { MaintenanceView } from '@/components/maintenance/MaintenanceView'

export default async function MaintenancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [issues, properties, teamMembers] = await Promise.all([
    getMaintenance(),
    getProperties(),      // all properties, including inactive
    getTeamMembers(),
  ])

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        action={<MaintenanceClient properties={properties} />}
      />
      <MaintenanceView
        issues={issues}
        properties={properties}
        teamMembers={teamMembers}
      />
    </>
  )
}
