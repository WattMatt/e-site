import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function DiaryLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Site Diary</h1>
          <p className="page-subtitle"><Skeleton width={100} height={11} /></p>
        </div>
      </div>

      <div className="data-panel animate-fadeup animate-fadeup-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} columns={3} />
        ))}
      </div>
    </div>
  )
}
