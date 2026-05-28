import type { UserRole } from './types'

type Action =
  | 'dashboard:view'
  | 'reservations:view'
  | 'reservations:edit'
  | 'tasks:view_own'
  | 'tasks:view_all'
  | 'tasks:create'
  | 'tasks:update_status'
  | 'maintenance:report'
  | 'maintenance:manage'
  | 'properties:view'
  | 'properties:edit'
  | 'supplies:view'
  | 'supplies:update_stock'
  | 'purchases:create'
  | 'purchases:resolve'
  | 'team:manage'
  | 'finances:view'   // amounts, revenue, payouts — hidden from cleaning staff

const ROLE_PERMISSIONS: Record<UserRole, Action[]> = {
  admin: [
    'dashboard:view',
    'reservations:view', 'reservations:edit',
    'tasks:view_own', 'tasks:view_all', 'tasks:create', 'tasks:update_status',
    'maintenance:report', 'maintenance:manage',
    'properties:view', 'properties:edit',
    'supplies:view', 'supplies:update_stock',
    'purchases:create', 'purchases:resolve',
    'team:manage',
    'finances:view',
  ],
  cleaning: [
    'reservations:view',
    'tasks:view_own', 'tasks:view_all', 'tasks:update_status',
    'maintenance:report',
    'properties:view',
    'supplies:view', 'supplies:update_stock',
    'purchases:create',
    // NOTE: no 'finances:view' — amounts/revenue are hidden for cleaning staff
  ],
  maintenance: [
    'reservations:view',
    'tasks:view_own', 'tasks:update_status',
    'maintenance:report', 'maintenance:manage',
    'properties:view',
    'supplies:view',
    'purchases:create',
    'finances:view',
  ],
  anfitrion: [
    'dashboard:view',
    'reservations:view',
    'tasks:view_own', 'tasks:view_all', 'tasks:update_status',
    'maintenance:report',
    'properties:view',
    'supplies:view',
    'purchases:create',
  ],
}

export function canDo(role: UserRole, action: Action): boolean {
  return ROLE_PERMISSIONS[role].includes(action)
}

export function getHomeRoute(role: UserRole): string {
  if (role === 'admin') return '/'
  return '/tasks'
}
