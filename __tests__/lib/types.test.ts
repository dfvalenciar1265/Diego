import { describe, it, expectTypeOf } from 'vitest'
import type { UserRole, Property, Reservation, Task, MaintenanceIssue,
              Supply, PropertySupply, PurchaseRequest, TeamMember } from '@/lib/types'

describe('Domain types', () => {
  it('UserRole includes the three valid roles', () => {
    const role: UserRole = 'admin'
    expectTypeOf(role).toMatchTypeOf<'admin' | 'cleaning' | 'maintenance'>()
  })

  it('Task status is a union of valid states', () => {
    const status: Task['status'] = 'pending'
    expectTypeOf(status).toMatchTypeOf<'pending' | 'in_progress' | 'done'>()
  })

  it('MaintenanceIssue priority is a union of valid values', () => {
    const priority: MaintenanceIssue['priority'] = 'urgent'
    expectTypeOf(priority).toMatchTypeOf<'urgent' | 'normal' | 'scheduled'>()
  })
})
