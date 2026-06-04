import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'

export default function CalendarLoading() {
  return (
    <>
      <PageHeader title="Calendario de reservas" />
      <div className="p-4 space-y-3">
        {/* Month nav */}
        <div className="flex items-center justify-between">
          <Skeleton className="w-9 h-9 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="w-9 h-9 rounded-full" />
        </div>
        {/* Grid rows */}
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    </>
  )
}
