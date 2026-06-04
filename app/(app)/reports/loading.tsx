import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'

export default function ReportsLoading() {
  return (
    <>
      <PageHeader title="Reportes" />
      <div className="p-4 space-y-4">
        <Skeleton className="h-11 rounded-xl" />        {/* tabs */}
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />        {/* chart/table area */}
      </div>
    </>
  )
}
