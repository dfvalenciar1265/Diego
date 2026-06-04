import { PageHeader } from '@/components/layout/PageHeader'
import { SkeletonList } from '@/components/ui/Skeleton'

export default function MaintenanceLoading() {
  return (
    <>
      <PageHeader title="Mantenimiento" />
      <div className="p-4">
        <SkeletonList count={4} />
      </div>
    </>
  )
}
