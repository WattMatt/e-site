/** Fixed hex so PNG export matches the screen; chosen to read on light and dark themes. */
export const SERIES_COLOURS = ['#2563eb', '#d97706', '#0d9488', '#7c3aed', '#dc2626', '#64748b'] as const
export const AXIS_TEXT = '#64748b'
export const GRID = '#94a3b8'
export const GAP_FILL = '#94a3b8'
/** Sequential ramp for heatmaps (low → high). */
export const HEAT_LOW: [number, number, number] = [254, 243, 199]
export const HEAT_HIGH: [number, number, number] = [180, 83, 9]
export const HEAT_NULL = '#e2e8f0'

export function heatColour(t: number): string {
  const c = HEAT_LOW.map((lo, i) => Math.round(lo + (HEAT_HIGH[i] - lo) * Math.max(0, Math.min(1, t))))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
