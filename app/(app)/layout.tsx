import { redirect } from 'next/navigation'
import { BottomNav } from '@/components/layout/BottomNav'
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
      <div className="min-h-screen bg-[var(--bg)]">
        <main className="pb-20 max-w-lg mx-auto">
          {children}
        </main>
        <BottomNav />
      </div>
    </UserRoleProvider>
  )
}
