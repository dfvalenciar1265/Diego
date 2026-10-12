'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUserRole } from '@/lib/user-context'
import { navItemsFor, isActivePath } from './nav-items'

/** Phone navigation. From md up the Sidebar takes over. */
export function BottomNav() {
  const pathname = usePathname()
  const role     = useUserRole()
  const items    = navItemsFor(role).filter(it => !it.desktopOnly)

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--card)] border-t border-[var(--border)] pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {items.map(({ href, short, icon: Icon }) => {
          const isActive = isActivePath(pathname, href)
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
                strokeWidth={isActive ? 2.5 : 1.75}
              />
              <span
                className="text-[10px] font-medium truncate max-w-full"
                style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                {short}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
