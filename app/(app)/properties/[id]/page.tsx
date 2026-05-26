import { notFound } from 'next/navigation'
import { getProperty, getProperties } from '@/actions/properties'
import { getPropertySupplies, getAllSupplies } from '@/actions/supplies'
import { PageHeader } from '@/components/layout/PageHeader'
import { EditPropertyButton } from '@/components/properties/EditPropertyButton'
import { StockItem } from '@/components/supplies/StockItem'
import { PropertyStockClient } from '@/components/supplies/PropertyStockClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const [property, stockItems, allSupplies, allProperties] = await Promise.all([
    getProperty(id),
    getPropertySupplies(id),
    getAllSupplies(),
    getProperties(),
  ])

  if (!property) notFound()

  return (
    <>
      <PageHeader title={property.name} action={<EditPropertyButton property={property} />} />
      <div className="p-4 space-y-4">
        {/* Info del apto */}
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

        {/* Stock de insumos */}
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                        shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#0f172a]">📦 Insumos</h2>
            <PropertyStockClient
              propertyId={id}
              properties={allProperties}
              supplies={allSupplies}
            />
          </div>
          {stockItems.length === 0 ? (
            <p className="text-sm text-[#94a3b8] text-center py-4">
              Sin insumos registrados
            </p>
          ) : (
            stockItems.map(item => <StockItem key={item.id} item={item} />)
          )}
        </div>
      </div>
    </>
  )
}
