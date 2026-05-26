import type { Property } from '@/lib/types'
import Link from 'next/link'

interface Props {
  property: Property
}

export function PropertyCard({ property }: Props) {
  return (
    <Link href={`/properties/${property.id}`}>
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-4
                      shadow-[0_1px_3px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-transform">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#fff5f5] flex items-center
                          justify-center text-xl flex-shrink-0">
            🏠
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#0f172a] truncate">{property.name}</p>
            <p className="text-sm text-[#94a3b8] truncate">{property.address}</p>
          </div>
          <span className="text-[#94a3b8] text-lg">›</span>
        </div>
        {property.access_code && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-[#94a3b8]">Acceso:</span>
            <span className="text-xs font-mono bg-[#f8fafc] border border-[#e2e8f0]
                             rounded px-2 py-0.5 text-[#0f172a]">
              {property.access_code}
            </span>
          </div>
        )}
      </div>
    </Link>
  )
}
