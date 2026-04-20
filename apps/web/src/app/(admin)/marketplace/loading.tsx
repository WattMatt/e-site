import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function MarketplaceLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Supplier Marketplace</h1>
          <p className="page-subtitle"><Skeleton width={220} height={11} /></p>
        </div>
        <Skeleton width={96} height={36} style={{ borderRadius: 6 }} />
      </div>

      {/* Search row */}
      <div
        className="animate-fadeup animate-fadeup-1"
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <Skeleton width={300} height={36} style={{ borderRadius: 6, flex: 1, maxWidth: 500 }} />
        <Skeleton width={70} height={36} style={{ borderRadius: 6 }} />
      </div>

      {/* Category pills */}
      <div
        className="animate-fadeup animate-fadeup-1"
        style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={60 + i * 8} height={28} style={{ borderRadius: 16 }} />
        ))}
      </div>

      {/* Supplier card grid */}
      <div
        className="animate-fadeup animate-fadeup-2"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Skeleton width={140} height={14} />
              <Skeleton width={52} height={18} style={{ borderRadius: 12 }} />
            </div>
            <Skeleton width={80} height={11} />
            <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
              <Skeleton width={56} height={18} style={{ borderRadius: 2 }} />
              <Skeleton width={48} height={18} style={{ borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
