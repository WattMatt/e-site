import { Skeleton, SkeletonRow } from '@/components/ui/Skeleton'

export default function SupplierProfileLoading() {
  return (
    <div className="max-w-2xl space-y-8 animate-fadeup">
      {/* Heading */}
      <div>
        <Skeleton width={160} height={22} style={{ marginBottom: 6 }} />
        <Skeleton width={120} height={13} />
      </div>

      {/* Profile form card */}
      <div
        className="animate-fadeup animate-fadeup-1"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '24px' }}
      >
        <Skeleton width={140} height={14} style={{ marginBottom: 20 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SkeletonRow columns={2} />
          <SkeletonRow columns={2} />
          <SkeletonRow columns={1} />
          <SkeletonRow columns={2} />
          <Skeleton width={110} height={36} style={{ borderRadius: 6, marginTop: 4 }} />
        </div>
      </div>

      {/* Paystack card */}
      <div
        className="animate-fadeup animate-fadeup-2"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 12, padding: '24px' }}
      >
        <Skeleton width={180} height={14} style={{ marginBottom: 8 }} />
        <Skeleton width={280} height={12} style={{ marginBottom: 20 }} />
        <Skeleton width={140} height={36} style={{ borderRadius: 6 }} />
      </div>
    </div>
  )
}
