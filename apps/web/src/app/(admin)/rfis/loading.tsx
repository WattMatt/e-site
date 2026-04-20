import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function RfisLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFIs</h1>
          <p className="page-subtitle"><Skeleton width={70} height={11} /></p>
        </div>
      </div>

      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} columns={5} />
        ))}
      </div>
    </div>
  )
}
