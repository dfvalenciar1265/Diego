'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { IncidenceForm } from './IncidenceForm'
import type { Property } from '@/lib/types'

export function MaintenanceClient({ properties }: { properties: Property[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} style={{ background: '#ff385c' }}
              className="h-11 px-4 text-sm md:h-9" aria-label="Reportar nueva incidencia">
        + Reportar
      </Button>
      <IncidenceForm open={open} onClose={() => setOpen(false)} properties={properties} />
    </>
  )
}
