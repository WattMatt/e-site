import { Skeleton } from '@/components/ui/Skeleton'

export default function SupplierCatalogueLoading() {
  return (
    <div className="animate-fadeup">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <Skeleton width={90} height={22} style={{ marginBottom: 6 }} />
          <Skeleton width={160} height={13} />
        </div>
        <Skeleton width={88} height={36} style={{ borderRadius: 8 }} />
      </div>

      <div className="space-y-6 animate-fadeup animate-fadeup-1">
        {Array.from({ length: 2 }).map((_, gi) => (
          <div key={gi}>
            <Skeleton width={80} height={11} style={{ marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: gi === 0 ? 4 : 3 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    padding: 16,
                    background: 'var(--c-panel)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Skeleton width={120} height={14} />
                      <Skeleton width={50} height={12} />
                    </div>
                    <Skeleton width={180} height={12} />
                    <div style={{ display: 'flex', gap: 16 }}>
                      <Skeleton width={40} height={11} />
                      <Skeleton width={50} height={11} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <Skeleton width={64} height={16} style={{ marginBottom: 4 }} />
                      <Skeleton width={44} height={12} />
                    </div>
                    <Skeleton width={40} height={24} style={{ borderRadius: 6 }} />
                    <Skeleton width={38} height={30} style={{ borderRadius: 8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
