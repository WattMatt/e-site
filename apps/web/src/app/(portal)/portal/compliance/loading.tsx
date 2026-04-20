import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function PortalComplianceLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <h1 className="page-title">Compliance Overview</h1>
      </div>
      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} columns={3} />
        ))}
      </div>
    </div>
  )
}
