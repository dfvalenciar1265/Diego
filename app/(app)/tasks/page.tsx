import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTasks } from '@/actions/tasks'
import { getProperties } from '@/actions/properties'
import { TaskCard } from '@/components/tasks/TaskCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { TasksClient } from '@/components/tasks/TasksClient'

export default async function TasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: member } = await supabase
    .from('team_members').select('*').eq('id', user!.id).single()

  // Admin ve todas. Equipo ve solo las suyas.
  const filters = member?.role !== 'admin' ? { assignedTo: user!.id } : {}
  const [tasks, properties] = await Promise.all([
    getTasks(filters),
    getProperties(),
  ])

  const { data: teamMembers } = await supabase
    .from('team_members').select('*').eq('active', true)

  return (
    <>
      <PageHeader
        title={member?.role === 'admin' ? 'Todas las tareas' : 'Mis tareas'}
        action={member?.role === 'admin' ? (
          <TasksClient properties={properties} teamMembers={teamMembers ?? []} />
        ) : null}
      />
      <div className="p-4 space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-[#94a3b8]">No hay tareas pendientes</p>
          </div>
        ) : (
          tasks.map(t => <TaskCard key={t.id} task={t} />)
        )}
      </div>
    </>
  )
}
