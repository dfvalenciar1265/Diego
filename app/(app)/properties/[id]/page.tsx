import { notFound } from 'next/navigation'
import { getProperty } from '@/actions/properties'
import { PageHeader } from '@/components/layout/PageHeader'
import { EditPropertyButton } from '@/components/properties/EditPropertyButton'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const property = await getProperty(id)
  if (!property) notFound()

  return (
    <>
      <PageHeader title={property.name} action={<EditPropertyButton property={property} />} />
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 space-y-3">
          {property.address && (
            <div>
              <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wide">Dirección</p>
              <p className="text-sm text-[#0f172a] mt-0.5">{property.address}</p>
            </div>
          )}
          {property.access_code && (
            <div>
              <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wide">Código de acceso</p>
              <p className="text-sm font-mono bg-[#f8fafc] border border-[#e2e8f0] rounded px-3 py-1.5 mt-0.5 inline-block">
                {property.access_code}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wide">Capacidad</p>
            <p className="text-sm text-[#0f172a] mt-0.5">{property.capacity} personas</p>
          </div>
          {property.instructions && (
            <div>
              <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wide">Instrucciones</p>
              <p className="text-sm text-[#0f172a] mt-0.5 whitespace-pre-wrap">{property.instructions}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
