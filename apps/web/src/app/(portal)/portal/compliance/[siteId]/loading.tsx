import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function PortalSiteLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <Skeleton width={220} height={20} />
      </div>
      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} columns={4} />
        ))}
      </div>
    </div>
  )
}
