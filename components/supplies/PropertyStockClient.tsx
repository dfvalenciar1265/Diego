'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PurchaseRequestForm } from './PurchaseRequestForm'
import type { Property, Supply } from '@/lib/types'

interface Props { propertyId: string; properties: Property[]; supplies: Supply[] }

export function PropertyStockClient({ propertyId, properties, supplies }: Props) {
  const [requestOpen, setRequestOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}
              aria-label="Solicitar compra de insumo"
              className="text-xs border-[#ff385c] text-[#ff385c]">
        + Solicitar
      </Button>
      <PurchaseRequestForm
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        properties={properties}
        supplies={supplies}
        defaultPropertyId={propertyId}
      />
    </>
  )
}
