import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton'

export default function TasksLoading() {
  return (
    <>
      <PageHeader title="Tareas" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-11 rounded-xl" />        {/* filter */}
        <Skeleton className="h-11 rounded-xl" />        {/* tabs */}
        <SkeletonList count={4} />
      </div>
    </>
  )
}
