import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function SettingsLoading() {
  return (
    <div className="max-w-2xl animate-fadeup">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Profile card */}
        <div
          className="animate-fadeup animate-fadeup-1"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden' }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--c-border)' }}>
            <Skeleton width={100} height={14} />
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SkeletonRow columns={2} />
            <SkeletonRow columns={2} />
            <SkeletonRow columns={1} />
          </div>
        </div>

        {/* Organisation card */}
        <div
          className="animate-fadeup animate-fadeup-2"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden' }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--c-border)' }}>
            <Skeleton width={120} height={14} />
            <Skeleton width={160} height={11} style={{ marginTop: 4 }} />
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SkeletonRow columns={2} />
            <SkeletonRow columns={2} />
            <SkeletonRow columns={2} />
          </div>
        </div>

        {/* Danger zone card */}
        <div
          className="animate-fadeup animate-fadeup-3"
          style={{ background: 'var(--c-panel)', border: '1px solid rgba(153,27,27,0.4)', borderRadius: 8, overflow: 'hidden' }}
        >
          <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(153,27,27,0.4)' }}>
            <Skeleton width={90} height={14} />
          </div>
          <div style={{ padding: '20px 24px' }}>
            <Skeleton width={340} height={12} style={{ marginBottom: 8 }} />
            <Skeleton width={280} height={12} style={{ marginBottom: 16 }} />
            <Skeleton width={100} height={30} style={{ borderRadius: 6 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
