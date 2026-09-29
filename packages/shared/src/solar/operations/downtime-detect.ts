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
