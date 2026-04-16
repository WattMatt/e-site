'use client'

import type { SkeletonKey } from '../LoadingSkeleton'
import { SKELETONS } from '../LoadingSkeleton'

interface Props {
  skeleton?: SkeletonKey
  /** Number of rows to repeat */
  count?: number
  className?: string
}

function SkeletonBlock({ width, height, borderRadius = 6 }: { width: string | number; height: string | number; borderRadius?: number }) {
  const w = typeof width === 'number' ? `${width}px` : width
  const h = typeof height === 'number' ? `${height}px` : height
  return (
    <div
      className="animate-pulse bg-slate-700 rounded"
      style={{ width: w, height: h, borderRadius }}
    />
  )
}

export function SkeletonLoader({ skeleton = 'listRow', count = 3, className = '' }: Props) {
  const config = SKELETONS[skeleton]

  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4 border-b border-slate-800 last:border-0">
          {config.shapes.map((shape, j) => (
            <SkeletonBlock
              key={j}
              width={shape.width ?? '100%'}
              height={shape.height ?? 16}
              borderRadius={shape.type === 'circle' ? 999 : (shape.borderRadius ?? 6)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Inline skeleton pulse for a single line */
export function SkeletonLine({ width = '60%', height = 14 }: { width?: string; height?: number }) {
  return (
    <div
      className="animate-pulse bg-slate-700 rounded"
      style={{ width, height }}
    />
  )
}
