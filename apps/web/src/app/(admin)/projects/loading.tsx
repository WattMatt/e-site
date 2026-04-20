import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function ProjectsLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle"><Skeleton width={80} height={11} /></p>
        </div>
      </div>

      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} columns={4} />
        ))}
      </div>
    </div>
  )
}
