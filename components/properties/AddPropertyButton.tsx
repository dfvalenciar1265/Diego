'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyForm } from './PropertyForm'
import { useUserRole } from '@/lib/user-context'
import { canDo } from '@/lib/permissions'

export function AddPropertyButton() {
  const [open, setOpen] = useState(false)
  const role = useUserRole()
  if (!role || !canDo(role, 'properties:edit')) return null
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}
              style={{ background: '#ff385c' }} className="text-white">
        + Nuevo
      </Button>
      <PropertyForm open={open} onClose={() => setOpen(false)} />
    </>
  )
}
