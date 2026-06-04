import { Skeleton, SkeletonList } from '@/components/ui/Skeleton'

// Dashboard skeleton — mirrors the real layout (header, KPI grid, sections)
export default function DashboardLoading() {
  return (
    <div className="pb-4">
      {/* Header */}
      <div className="bg-white border-b border-[#e2e8f0] px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="w-9 h-9 rounded-full" />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Sections */}
      <div className="px-4 pt-4 space-y-4">
        <Skeleton className="h-3 w-32" />
        <SkeletonList count={3} />
      </div>
    </div>
  )
}
