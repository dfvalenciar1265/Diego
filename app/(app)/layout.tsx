import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/layout/BottomNav'
import { UserRoleProvider } from '@/lib/user-context'
import type { UserRole } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch role once here — shared via context to all client components
  const { data: member } = await supabase
    .from('team_members')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (member?.role as UserRole) ?? null

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
