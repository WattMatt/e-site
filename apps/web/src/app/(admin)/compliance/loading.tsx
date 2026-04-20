import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function ComplianceLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compliance</h1>
          <p className="page-subtitle"><Skeleton width={90} height={11} /></p>
        </div>
      </div>

      {/* Project selector placeholder */}
      <div
        className="animate-fadeup animate-fadeup-1"
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}
      >
        <Skeleton width={180} height={13} />
      </div>

      <div className="data-panel animate-fadeup animate-fadeup-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} columns={3} />
        ))}
      </div>
    </div>
  )
}
