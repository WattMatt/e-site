/**
 * Auto-detected downtime CANDIDATES (spec §10: "zero output during daylight from the weather file's
 * sun position, not a fixed 06:00–17:30 window"). Daylight = the engine's SPA sun elevation at the
 * interval MIDPOINT is above 5°. Zero = at most 0.5 % of as-built AC kW. A candidate is at least two
 * CONSECUTIVE zero daylight intervals; a missing reading is a data gap and breaks the run — it is
 * never booked as downtime (WM G14). The user confirms a candidate to record it.
 */
import { solarPosition } from '../../services/solar/solar-position/spa'

export interface SeriesPoint { endMs: number; kw: number; intervalMin: number }
export interface SiteLocation { latitude: number; longitude: number; elevationM: number }
export interface TimeWindow { startMs: number; endMs: number }
export interface DowntimeCandidate { startsAt: string; endsAt: string; intervals: number; hours: number }

export const DAYLIGHT_ELEVATION_DEG = 5
export const ZERO_OUTPUT_FRACTION = 0.005
export const MIN_CANDIDATE_INTERVALS = 2

export function sunElevationDeg(ms: number, site: SiteLocation): number {
  return solarPosition(ms, site.latitude, site.longitude, { elevationM: site.elevationM, pressureHpa: 1013.25, temperatureC: 20 }).elevation
}

export function isDaylight(ms: number, site: SiteLocation): boolean {
  return sunElevationDeg(ms, site) > DAYLIGHT_ELEVATION_DEG
}

export function zeroThresholdKw(acKw: number): number {
  return Math.max(ZERO_OUTPUT_FRACTION * acKw, 0.01)
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6

/**
 * The plant's output as ONE series (review B1). 00218's solar_ops_series returns one point per SPAN
 * (end, interval): generation meters on the same interval are summed, meters on different intervals
 * stay separate points with their own span. This folds them onto the coarsest interval's grid, energy
 * weighted by overlap. Within a slot each interval group's kW is its energy over the time IT covers,
 * so a missing reading is a gap and never a zero (WM G14); the groups are then summed. One interval
 * in, the same points out.
 *
 * Known limits (review round 2, accepted): slots are aligned to the Unix epoch, which is SAST-aligned
 * only when the coarse interval divides 120 min (SAST is UTC+2) — true of every logger interval seen
 * (5/10/15/30/60 min). Groups are keyed by INTERVAL, not meter, so one meter holding readings on two
 * channels of different intervals inside one slot (the edge of a re-import the aggregation kept both
 * sides of) is counted in both groups for that slot. Detection only asks whether the plant's kW is at
 * or below the zero threshold, and a double-counted non-zero output is still non-zero, so neither
 * changes a candidate in practice; do not reuse this series for energy totals.
 */
export function plantSeries(points: readonly SeriesPoint[]): SeriesPoint[] {
  const sorted = [...points].sort((a, b) => a.endMs - b.endMs || a.intervalMin - b.intervalMin)
  const intervals = new Set(sorted.map((p) => p.intervalMin))
  if (intervals.size <= 1) return sorted
  const coarse = Math.max(...intervals)
  const slotMs = coarse * 60_000
  const slots = new Map<number, Map<number, { kwMs: number; coveredMs: number }>>()
  for (const p of sorted) {
    const s0 = p.endMs - p.intervalMin * 60_000
    for (let a = Math.floor(s0 / slotMs) * slotMs; a < p.endMs; a += slotMs) {
      const ov = Math.min(p.endMs, a + slotMs) - Math.max(s0, a)
      if (ov <= 0) continue
      const groups = slots.get(a + slotMs) ?? new Map<number, { kwMs: number; coveredMs: number }>()
      const g = groups.get(p.intervalMin) ?? { kwMs: 0, coveredMs: 0 }
      g.kwMs += p.kw * ov
      g.coveredMs += ov
      groups.set(p.intervalMin, g)
      slots.set(a + slotMs, groups)
    }
  }
  return [...slots.entries()].sort((x, y) => x[0] - y[0]).map(([endMs, groups]) => ({
    endMs, intervalMin: coarse, kw: r6([...groups.values()].reduce((s, g) => s + g.kwMs / g.coveredMs, 0)),
  }))
}

export function detectDowntimeCandidates(
  points: readonly SeriesPoint[],
  site: SiteLocation,
  acKw: number,
  recorded: readonly TimeWindow[],
): DowntimeCandidate[] {
  const threshold = zeroThresholdKw(acKw)
  const sorted = [...points].sort((a, b) => a.endMs - b.endMs)
  const out: DowntimeCandidate[] = []
  let run: SeriesPoint[] = []
  const flush = () => {
    if (run.length >= MIN_CANDIDATE_INTERVALS) {
      const startMs = run[0]!.endMs - run[0]!.intervalMin * 60_000
      const endMs = run[run.length - 1]!.endMs
      if (!recorded.some((w) => w.startMs < endMs && startMs < w.endMs)) {
        out.push({
          startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(),
          intervals: run.length, hours: Math.round(((endMs - startMs) / 3_600_000) * 100) / 100,
        })
      }
    }
    run = []
  }
  for (const p of sorted) {
    const midMs = p.endMs - p.intervalMin * 30_000
    if (!(p.kw <= threshold && isDaylight(midMs, site))) {
      flush()
      continue
    }
    const prev = run[run.length - 1]
    if (prev && p.endMs - prev.endMs !== p.intervalMin * 60_000) flush()
    run.push(p)
  }
  flush()
  return out
}
