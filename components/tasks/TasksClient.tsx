'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TaskForm } from './TaskForm'
import type { Property, TeamMember } from '@/lib/types'

interface Props { properties: Property[]; teamMembers: TeamMember[] }

export function TasksClient({ properties, teamMembers }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} style={{ background: '#ff385c' }}>
        + Tarea
      </Button>
      <TaskForm open={open} onClose={() => setOpen(false)}
                properties={properties} teamMembers={teamMembers} />
    </>
  )
}
