'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calendar, Sparkles, ClipboardList, Wrench, Building2 } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/',            label: 'Inicio',    icon: Home },
  { href: '/calendar',   label: 'Reservas',  icon: Calendar },
  { href: '/cleaning',   label: 'Limpieza',  icon: Sparkles },
  { href: '/tasks',      label: 'Tareas',    icon: ClipboardList },
  { href: '/maintenance',label: 'Mant.',     icon: Wrench },
  { href: '/properties', label: 'Props',     icon: Building2 },
] as const

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--card)] border-t border-[var(--border)] pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
