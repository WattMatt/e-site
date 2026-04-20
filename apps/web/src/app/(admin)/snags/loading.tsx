import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

// Loading UI for /snags. Mirrors the 6-KPI row + list layout in page.tsx.

export default function SnagsLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Snags</h1>
          <p className="page-subtitle"><Skeleton width={60} height={11} /></p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--c-surface)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              padding: '14px 12px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <Skeleton width={32} height={24} />
            <Skeleton width="70%" height={10} />
          </div>
        ))}
      </div>

      <div className="data-panel">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} columns={5} />
        ))}
      </div>
    </div>
  )
}
