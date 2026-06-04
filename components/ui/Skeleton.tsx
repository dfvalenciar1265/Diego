import type { CSSProperties } from 'react'

/** A single shimmering placeholder block. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[#e2e8f0] ${className}`}
      style={style}
    />
  )
}

/** A card-shaped skeleton matching the app's list rows. */
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full flex-shrink-0" />
      </div>
    </div>
  )
}

/** A vertical stack of N skeleton cards. */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
