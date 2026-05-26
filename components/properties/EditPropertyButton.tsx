'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyForm } from './PropertyForm'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'
import type { Property } from '@/lib/types'

interface Props {
  property: Property
}

export function EditPropertyButton({ property }: Props) {
  const [open, setOpen] = useState(false)
  const { member } = useCurrentUser()
  if (!member || !canDo(member.role, 'properties:edit')) return null
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Editar
      </Button>
      <PropertyForm open={open} onClose={() => setOpen(false)} property={property} />
    </>
  )
}
