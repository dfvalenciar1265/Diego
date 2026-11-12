import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getMaintenance } from '@/actions/maintenance'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { MaintenanceClient } from '@/components/maintenance/MaintenanceClient'
import { MaintenanceView } from '@/components/maintenance/MaintenanceView'

export default async function MaintenancePage() {
  const member = await getCurrentMember()
  if (!member) redirect('/logout')

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
      {member.role === 'admin' ? <Link className="mx-4 inline-flex min-h-11 items-center underline" href="/maintenance/review">Revisar notas antiguas de preventivos</Link> : null}
      {member.role === 'admin' ? <Link className="mx-4 inline-flex min-h-11 items-center underline" href="/maintenance/checkout-checks">Revisiones opcionales de salida</Link> : null}
      <MaintenanceView
        issues={issues}
        properties={properties}
        teamMembers={teamMembers}
      />
    </>
  )
}
