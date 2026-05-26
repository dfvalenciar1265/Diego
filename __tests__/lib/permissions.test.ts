import { describe, it, expect } from 'vitest'
import { canDo } from '@/lib/permissions'

describe('canDo permissions', () => {
  describe('admin', () => {
    it('can view full dashboard', () => expect(canDo('admin', 'dashboard:view')).toBe(true))
    it('can edit reservations', () => expect(canDo('admin', 'reservations:edit')).toBe(true))
    it('can manage team', () => expect(canDo('admin', 'team:manage')).toBe(true))
    it('can edit properties', () => expect(canDo('admin', 'properties:edit')).toBe(true))
    it('can resolve maintenance', () => expect(canDo('admin', 'maintenance:manage')).toBe(true))
  })

  describe('cleaning', () => {
    it('cannot view full dashboard', () => expect(canDo('cleaning', 'dashboard:view')).toBe(false))
    it('can view own tasks', () => expect(canDo('cleaning', 'tasks:view_own')).toBe(true))
    it('can update task status', () => expect(canDo('cleaning', 'tasks:update_status')).toBe(true))
    it('can update stock', () => expect(canDo('cleaning', 'supplies:update_stock')).toBe(true))
    it('can report maintenance', () => expect(canDo('cleaning', 'maintenance:report')).toBe(true))
    it('cannot manage maintenance', () => expect(canDo('cleaning', 'maintenance:manage')).toBe(false))
    it('cannot edit properties', () => expect(canDo('cleaning', 'properties:edit')).toBe(false))
  })

  describe('maintenance', () => {
    it('cannot view full dashboard', () => expect(canDo('maintenance', 'dashboard:view')).toBe(false))
    it('can view own tasks', () => expect(canDo('maintenance', 'tasks:view_own')).toBe(true))
    it('can manage own maintenance issues', () => expect(canDo('maintenance', 'maintenance:manage')).toBe(true))
    it('can report maintenance', () => expect(canDo('maintenance', 'maintenance:report')).toBe(true))
    it('cannot update stock', () => expect(canDo('maintenance', 'supplies:update_stock')).toBe(false))
    it('cannot edit reservations', () => expect(canDo('maintenance', 'reservations:edit')).toBe(false))
  })
})
