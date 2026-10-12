import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { canDo } from '@/lib/permissions'
import { getProperties } from '@/actions/properties'
import { getTeamMembers } from '@/actions/team'
import { PropertyCard } from '@/components/properties/PropertyCard'
import { StaffSection } from '@/components/properties/StaffSection'
import { PageHeader } from '@/components/layout/PageHeader'
import { AddPropertyButton } from '@/components/properties/AddPropertyButton'

export default async function PropertiesPage() {
  // Same rule as the menu: apartments, staff and access codes are admin-only
  const member = await getCurrentMember()
  if (!member) redirect('/logout')
  if (!canDo(member.role, 'properties:edit')) redirect('/')

  const [properties, staff] = await Promise.all([
    getProperties(),
    getTeamMembers(),   // all roles: admin + cleaning + anfitrion + maintenance
  ])

  return (
    <>
      <PageHeader title="Mis apartamentos" action={<AddPropertyButton />} />
      <div className="p-4 space-y-3">
        {properties.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🏠</p>
            <p className="text-[#64748b]">Aún no tienes apartamentos</p>
          </div>
        ) : (
          <div className="card-grid">
            {properties.map(p => <PropertyCard key={p.id} property={p} />)}
          </div>
        )}

        {/* Personal por roles */}
        <StaffSection staff={staff} />
      </div>
    </>
  )
}
