'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PropertyForm } from './PropertyForm'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { canDo } from '@/lib/permissions'

export function AddPropertyButton() {
  const [open, setOpen] = useState(false)
  const { member } = useCurrentUser()
  if (!member || !canDo(member.role, 'properties:edit')) return null
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
