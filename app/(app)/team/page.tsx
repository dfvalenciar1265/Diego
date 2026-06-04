import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth'
import { PageHeader } from '@/components/layout/PageHeader'
import { TeamMemberCard } from '@/components/team/TeamMemberCard'
import { NewTeamMemberButton } from '@/components/team/NewTeamMemberButton'

export default async function TeamPage() {
  const me = await getCurrentMember()
  if (!me) redirect('/login')
  if (me.role !== 'admin') redirect('/')

  // Include inactive members so admin can see everyone
  const supabase = await createClient()
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
          <TeamMemberCard key={m.id} member={m} isSelf={m.id === me.id} />
        ))}
      </div>
    </>
  )
}
