import { PageHeader } from '@/components/layout/PageHeader'
import { SkeletonList } from '@/components/ui/Skeleton'

export default function TeamLoading() {
  return (
    <>
      <PageHeader title="Personas" />
      <div className="p-4">
        <SkeletonList count={4} />
      </div>
    </>
  )
}
