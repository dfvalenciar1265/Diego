import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getProperties } from '@/actions/properties'
import { getTemporaryNotices } from '@/actions/temporary-notices'
import { todayInBogota } from '@/lib/gpt-api/dates'
import { TemporaryNotices } from '@/components/temporary-notices/TemporaryNotices'
export default async function TemporaryNoticesPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/logout')
  const [result, properties] = await Promise.all([getTemporaryNotices(), getProperties()])
  return <><h1 className="text-xl font-bold p-4">Avisos temporales</h1>{result.error ? <p role="alert" className="p-4">{result.error}</p> : <TemporaryNotices notices={result.data} properties={properties.map(p => ({ id: p.id, name: p.name }))} today={todayInBogota()} admin={member.role === 'admin'} />}</>
}
