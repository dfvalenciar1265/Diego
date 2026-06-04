import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton, SkeletonList } from '@/components/ui/Skeleton'

export default function CleaningLoading() {
  return (
    <>
      <PageHeader title="Limpieza" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-11 rounded-xl" />        {/* tabs */}
        <Skeleton className="h-3 w-28" />               {/* section label */}
        <SkeletonList count={4} />
      </div>
    </>
  )
}
