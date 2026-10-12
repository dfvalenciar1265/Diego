import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/layout/BottomNav'
import { Sidebar } from '@/components/layout/Sidebar'
import { UserRoleProvider } from '@/lib/user-context'
import { getCurrentMember } from '@/lib/auth'
import type { UserRole } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cached per request — page components reuse this without re-querying
  const member = await getCurrentMember()
  if (!member) redirect('/login')

  const role = (member.role as UserRole) ?? null

  return (
    <UserRoleProvider role={role}>
      <div className="min-h-screen bg-[var(--bg)] md:pl-56">
        <Sidebar />
        {/* Phone: one column above the bottom bar (+ iPhone home-indicator inset).
            md+: the sidebar navigates and pages get the width they need. */}
        <main className="mx-auto w-full max-w-lg md:max-w-6xl pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10 md:px-2">
          {children}
        </main>
        <BottomNav />
      </div>
    </UserRoleProvider>
  )
}
