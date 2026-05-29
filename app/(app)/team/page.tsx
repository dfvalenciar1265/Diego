import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTeamMembers } from '@/actions/team'
import { PageHeader } from '@/components/layout/PageHeader'
import { TeamMemberCard } from '@/components/team/TeamMemberCard'
import { NewTeamMemberButton } from '@/components/team/NewTeamMemberButton'

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('team_members').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/')

  // Include inactive members so admin can see everyone
  const { data: members } = await supabase
    .from('team_members')
    .select('*')
    .order('name')

  return (
    <>
      <PageHeader
        title="Personas"
        action={<NewTeamMemberButton />}
      />
      <div className="p-4 space-y-3">
        {(members ?? []).map(m => (
          <TeamMemberCard key={m.id} member={m} isSelf={m.id === user.id} />
        ))}
      </div>
    </>
  )
}
