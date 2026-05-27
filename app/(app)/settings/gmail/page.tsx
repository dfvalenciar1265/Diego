import { getGmailStatus } from '@/actions/gmail'
import { GmailSettingsClient } from '@/components/settings/GmailSettingsClient'
import { PageHeader } from '@/components/layout/PageHeader'

export default async function GmailSettingsPage() {
  const status = await getGmailStatus()

  return (
    <>
      <PageHeader title="Configuración Gmail" />
      <div className="px-4 pb-24 space-y-4">
        <GmailSettingsClient {...status} />
      </div>
    </>
  )
}
