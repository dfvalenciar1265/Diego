import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth'
import { getGmailStatus } from '@/actions/gmail'
import { GmailSettingsClient } from '@/components/settings/GmailSettingsClient'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function GmailSettingsPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/logout')
  if (member.role !== 'admin') redirect('/')

  const status = await getGmailStatus()

  return (
    <>
      <PageHeader title="Configuración Gmail" />
      <div className="px-4 pb-24 space-y-4 md:max-w-2xl">
        <GmailSettingsClient {...status} />
      </div>
    </>
  )
}
