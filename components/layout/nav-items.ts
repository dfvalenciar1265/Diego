import { Home, Calendar, Sparkles, ClipboardList, Wrench, Building2, BarChart2, Users, Mail } from 'lucide-react'
import type { ComponentType } from 'react'
import { canDo, type Action } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'

export type NavItem = {
  href: string
  label: string        // full name (sidebar)
  short: string        // fits under an icon in the bottom bar
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>
  requires?: Action    // shown only if the role has this permission
  adminOnly?: boolean  // shown only to admins
  desktopOnly?: boolean // too secondary for the 7-slot bottom bar
  group: 'ops' | 'admin'
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/',               label: 'Inicio',        short: 'Inicio',   icon: Home,          requires: 'dashboard:view', group: 'ops' },
  { href: '/calendar',       label: 'Reservas',      short: 'Reservas', icon: Calendar,      requires: 'reservations:view', group: 'ops' },
  { href: '/cleaning',       label: 'Limpieza',      short: 'Limpieza', icon: Sparkles,      group: 'ops' },
  { href: '/tasks',          label: 'Tareas',        short: 'Tareas',   icon: ClipboardList, group: 'ops' },
  { href: '/maintenance',    label: 'Mantenimiento', short: 'Mant.',    icon: Wrench,        group: 'ops' },
  { href: '/properties',     label: 'Apartamentos',  short: 'Aptos',    icon: Building2,     requires: 'properties:edit', group: 'admin' },
  { href: '/reports',        label: 'Reportes',      short: 'Reportes', icon: BarChart2,     adminOnly: true, group: 'admin' },
  { href: '/team',           label: 'Personas',      short: 'Personas', icon: Users,         adminOnly: true, desktopOnly: true, group: 'admin' },
  { href: '/settings/gmail', label: 'Gmail',         short: 'Gmail',    icon: Mail,          adminOnly: true, desktopOnly: true, group: 'admin' },
]

export function navItemsFor(role: UserRole | null): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter(it => {
    if (it.adminOnly) return role === 'admin'
    if (it.requires)  return canDo(role, it.requires)
    return true
  })
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}
