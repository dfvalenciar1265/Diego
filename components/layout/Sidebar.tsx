'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUserRole } from '@/lib/user-context'
import { navItemsFor, isActivePath, type NavItem } from './nav-items'

/** Desktop/tablet navigation (md and up). Phones use BottomNav. */
export function Sidebar() {
  const pathname = usePathname()
  const role     = useUserRole()
  const items    = navItemsFor(role)
  const ops      = items.filter(it => it.group === 'ops')
  const admin    = items.filter(it => it.group === 'admin')

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-56 flex-col
                      bg-[var(--card)] border-r border-[var(--border)]">
      <div className="h-14 flex items-center gap-2 px-5 border-b border-[var(--border)]">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #ff385c, #ff6b6b)' }}>
          A
        </span>
        <span className="font-semibold text-[var(--text)]">AirAdmin</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-5">
        <NavGroup items={ops} pathname={pathname} />
        {admin.length > 0 && (
          <NavGroup title="Administración" items={admin} pathname={pathname} />
        )}
      </nav>
    </aside>
  )
}

function NavGroup({ title, items, pathname }: { title?: string; items: NavItem[]; pathname: string }) {
  return (
    <div>
      {title && (
        <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const isActive = isActivePath(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 h-10 px-3 rounded-lg text-sm transition-colors
                  ${isActive
                    ? 'bg-[#fff1f3] text-[var(--primary)] font-semibold'
                    : 'text-[var(--text)] hover:bg-[var(--bg)]'}`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
