'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal, X } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useUserRole } from '@/lib/user-context'
import { navItemsFor, isActivePath, splitMobileNav, type NavItem } from './nav-items'

/**
 * Phone navigation. From md up the Sidebar takes over.
 * Up to 5 destinations fit in the bar; with more, 4 main ones + «Más», which
 * opens a bottom sheet with the rest (full labels).
 */
export function BottomNav() {
  const pathname = usePathname()
  const role     = useUserRole()
  const { primary, more } = splitMobileNav(navItemsFor(role))
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = more.some(it => isActivePath(pathname, it.href))

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--card)] border-t border-[var(--border)] pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {primary.map(item => (
          <BarLink key={item.href} item={item} active={isActivePath(pathname, item.href)} />
        ))}

        {more.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? 'page' : undefined}
            className="flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-2"
          >
            <MoreHorizontal
              size={20}
              style={{ color: moreActive ? 'var(--primary)' : 'var(--text-muted)' }}
              strokeWidth={moreActive ? 2.5 : 1.75}
            />
            <span
              className="text-[11px] font-medium truncate max-w-full"
              style={{ color: moreActive ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              Más
            </span>
          </button>
        )}
      </div>

      {more.length > 0 && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" showCloseButton={false}
                        className="rounded-t-2xl bg-white gap-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between pl-4 pr-1 pt-1">
              <SheetTitle className="text-base font-semibold text-[#0f172a]">Más opciones</SheetTitle>
              <SheetClose
                aria-label="Cerrar"
                className="w-11 h-11 flex items-center justify-center rounded-full text-[#64748b] active:bg-[#f1f5f9]"
              >
                <X size={20} />
              </SheetClose>
            </div>
            <ul className="px-2 pb-2">
              {more.map(({ href, label, icon: Icon }) => {
                const active = isActivePath(pathname, href)
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 min-h-12 px-3 rounded-xl text-[15px]
                        ${active ? 'bg-[#fff1f3] text-[var(--primary)] font-semibold' : 'text-[#0f172a] active:bg-[#f1f5f9]'}`}
                    >
                      <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  )
}

function BarLink({ item: { href, short, icon: Icon }, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-2"
    >
      <Icon
        size={20}
        style={{ color: active ? 'var(--primary)' : 'var(--text-muted)' }}
        strokeWidth={active ? 2.5 : 1.75}
      />
      <span
        className="text-[11px] font-medium truncate max-w-full"
        style={{ color: active ? 'var(--primary)' : 'var(--text-muted)' }}
      >
        {short}
      </span>
    </Link>
  )
}
