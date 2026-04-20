import type { CSSProperties } from 'react'

// Loading-state placeholder primitive. Amber-tinted pulse over the warm-dark
// panel token. Paired with the @keyframes skeleton-pulse rule added to
// globals.css.
//
// Usage:
//   <Skeleton width="60%" height={16} />
//   <SkeletonCard lines={3} />
//   <SkeletonRow columns={4} />

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number
  style?: CSSProperties
  /** Animation intensity — 'subtle' for body content, 'strong' for single hero skeletons. */
  intensity?: 'subtle' | 'strong'
}

export function Skeleton({ width = '100%', height = 14, radius = 4, style, intensity = 'subtle' }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: radius,
        background: intensity === 'strong'
          ? 'linear-gradient(90deg, var(--c-panel) 0%, var(--c-elevated) 50%, var(--c-panel) 100%)'
          : 'var(--c-panel)',
        backgroundSize: intensity === 'strong' ? '200% 100%' : undefined,
        animation: intensity === 'strong'
          ? 'skeleton-shimmer 1.4s ease-in-out infinite'
          : 'skeleton-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  )
}

// ─── Variants ────────────────────────────────────────────────────────────────

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Skeleton width="40%" height={11} />
      <Skeleton width="70%" height={24} style={{ marginBottom: 4 }} />
      {Array.from({ length: Math.max(0, lines - 1) }).map((_, i) => (
        <Skeleton key={i} width={`${80 - i * 10}%`} height={12} />
      ))}
    </div>
  )
}

export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 16,
        padding: '12px 0',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} width={i === 0 ? '70%' : '45%'} height={14} />
      ))}
    </div>
  )
}

export function SkeletonKpi() {
  // Matches the size of .kpi-card so layout doesn't jump on load.
  return (
    <div
      aria-hidden="true"
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: '18px 18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 92,
      }}
    >
      <Skeleton width="55%" height={10} />
      <Skeleton width="35%" height={28} />
    </div>
  )
}
