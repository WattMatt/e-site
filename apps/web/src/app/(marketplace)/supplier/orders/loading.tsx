import { Skeleton } from '@/components/ui/Skeleton'

export default function SupplierOrdersLoading() {
  return (
    <div className="animate-fadeup">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <Skeleton width={70} height={22} style={{ marginBottom: 6 }} />
          <Skeleton width={60} height={13} />
        </div>
      </div>

      <div className="space-y-3 animate-fadeup animate-fadeup-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Skeleton width={72} height={18} style={{ borderRadius: 999 }} />
                <Skeleton width={100} height={18} />
              </div>
              <Skeleton width={200} height={14} />
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <Skeleton width={70} height={16} style={{ marginBottom: 4 }} />
              <Skeleton width={54} height={13} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
