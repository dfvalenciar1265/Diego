import { PageHeader } from '@/components/layout/PageHeader'

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="p-4">
        <p className="text-[var(--text-muted)] text-sm">Cargando dashboard…</p>
      </div>
    </>
  )
}
