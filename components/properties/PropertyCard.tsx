'use client'
import { useTransition } from 'react'
import Link from 'next/link'
import { togglePropertyActive } from '@/actions/properties'
import { useUserRole } from '@/lib/user-context'
import type { Property } from '@/lib/types'

interface Props {
  property: Property
}

export function PropertyCard({ property }: Props) {
  const [isPending, startTransition] = useTransition()
  const role    = useUserRole()
  const isAdmin = role === 'admin'

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    startTransition(async () => {
      await togglePropertyActive(property.id, !property.active)
    })
  }

  return (
    <Link href={`/properties/${property.id}`}>
      <div
        className={`bg-white rounded-xl border border-[#e2e8f0] p-4
                    shadow-[0_1px_3px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-transform
                    ${!property.active ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#fff5f5] flex items-center
                          justify-center text-xl flex-shrink-0">
            🏠
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-[#0f172a] truncate">{property.name}</p>
              {!property.active && (
                <span className="text-[10px] bg-[#f1f5f9] text-[#94a3b8] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                  Oculto
                </span>
              )}
            </div>
            <p className="text-sm text-[#94a3b8] truncate">{property.address}</p>
          </div>

          {/* Active toggle — admin only */}
          {isAdmin ? (
            <button
              onClick={handleToggle}
              disabled={isPending}
              aria-label={property.active ? 'Ocultar propiedad' : 'Mostrar propiedad'}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0
                          disabled:opacity-50 ${property.active ? 'bg-[#22c55e]' : 'bg-[#cbd5e1]'}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                            ${property.active ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
              />
            </button>
          ) : (
            <span className="text-[#94a3b8] text-lg">›</span>
          )}
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
