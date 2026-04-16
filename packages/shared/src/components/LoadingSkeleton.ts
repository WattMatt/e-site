/**
 * LoadingSkeleton — skeleton shape configs for consistent loading states.
 * Platform-agnostic metadata; each platform renders its own animated skeleton.
 */

export interface SkeletonShape {
  type: 'rect' | 'circle' | 'text'
  width?: string | number   // CSS string for web, number (dp) for native
  height?: string | number
  borderRadius?: number
  lines?: number            // for type='text'
  lineHeight?: number
}

export interface SkeletonConfig {
  shapes: SkeletonShape[]
}

/** Common skeleton layouts */
export const SKELETONS = {
  /** Single list row: avatar + two lines of text */
  listRow: {
    shapes: [
      { type: 'circle' as const, width: 40, height: 40 },
      { type: 'text' as const, width: '60%', lines: 1, lineHeight: 16, height: 16 },
      { type: 'text' as const, width: '40%', lines: 1, lineHeight: 12, height: 12 },
    ],
  },

  /** KPI card */
  kpiCard: {
    shapes: [
      { type: 'text' as const, width: '50%', height: 12 },
      { type: 'rect' as const, width: '70%', height: 32, borderRadius: 4 },
    ],
  },

  /** Full-width card with title + body */
  card: {
    shapes: [
      { type: 'text' as const, width: '55%', height: 16 },
      { type: 'text' as const, width: '100%', height: 12 },
      { type: 'text' as const, width: '80%', height: 12 },
    ],
  },

  /** Supplier/product tile */
  supplierTile: {
    shapes: [
      { type: 'rect' as const, width: '100%', height: 80, borderRadius: 12 },
      { type: 'text' as const, width: '60%', height: 16, lineHeight: 16 },
      { type: 'text' as const, width: '40%', height: 12, lineHeight: 12 },
    ],
  },

  /** Table row */
  tableRow: {
    shapes: [
      { type: 'text' as const, width: '30%', height: 14 },
      { type: 'text' as const, width: '25%', height: 14 },
      { type: 'rect' as const, width: 60, height: 22, borderRadius: 999 },
    ],
  },
} satisfies Record<string, SkeletonConfig>

export type SkeletonKey = keyof typeof SKELETONS

export function getSkeleton(key: SkeletonKey): SkeletonConfig {
  return SKELETONS[key]
}
