'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calendar, Sparkles, ClipboardList, Wrench, Building2, BarChart2 } from 'lucide-react'
import type { ComponentType } from 'react'
import { useUserRole } from '@/lib/user-context'
import { canDo, type Action } from '@/lib/permissions'

type NavItem = {
  href: string
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>
  requires?: Action      // shown only if the role has this permission
  adminOnly?: boolean    // shown only to admins
}

const NAV_ITEMS: NavItem[] = [
  { href: '/',            label: 'Inicio',    icon: Home,          requires: 'dashboard:view' },
  { href: '/calendar',    label: 'Reservas',  icon: Calendar,      requires: 'reservations:view' },
  { href: '/cleaning',    label: 'Limpieza',  icon: Sparkles },
  { href: '/tasks',       label: 'Tareas',    icon: ClipboardList },
  { href: '/maintenance', label: 'Mant.',     icon: Wrench },
  { href: '/properties',  label: 'Props',     icon: Building2,     requires: 'properties:edit' }, // admin only
  { href: '/reports',     label: 'Reportes',  icon: BarChart2,     adminOnly: true },
]

export function BottomNav() {
  const pathname = usePathname()
  const role     = useUserRole()

  const items = NAV_ITEMS.filter(it => {
    if (!role) return false
    if (it.adminOnly) return role === 'admin'
    if (it.requires)  return canDo(role, it.requires)
    return true
  })

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--card)] border-t border-[var(--border)] pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {items.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className="flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-2"
            >
              <Icon
                size={20}
                style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}
                strokeWidth={isActive ? 2.5 : 1.5}
              />
              <span
                className="text-[9px] font-medium truncate"
                style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
