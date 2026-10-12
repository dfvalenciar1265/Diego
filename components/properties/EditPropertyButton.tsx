'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyForm } from './PropertyForm'
import { useUserRole } from '@/lib/user-context'
import { canDo } from '@/lib/permissions'
import type { Property } from '@/lib/types'

interface Props {
  property: Property
}

export function EditPropertyButton({ property }: Props) {
  const [open, setOpen] = useState(false)
  const role = useUserRole()
  if (!role || !canDo(role, 'properties:edit')) return null
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Editar
      </Button>
      <PropertyForm open={open} onClose={() => setOpen(false)} property={property} />
    </>
  )
}
