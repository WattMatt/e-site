import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function HealthLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Health</h1>
          <p className="page-subtitle"><Skeleton width={140} height={11} /></p>
        </div>
      </div>
      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} columns={4} />
        ))}
      </div>
    </div>
  )
}
