/**
 * The per-channel import report: coverage, gap runs, and the parser's own flags counted —
 * spikes (quality 4), large negatives (3), conflicting duplicates (5) and status-flagged slots (6) —
 * plus the file-level counts the parser reports (exact duplicates dropped, unparseable rows,
 * irregular steps). No second outlier rule: the parser's artefact detection is the one rule.
 */
import { isUsable, QUALITY } from '../meter-data/types'
import type { StoredChannel } from './channel'
import { localLabel } from './analyse'

export interface GapRun { from: string; to: string; minutes: number }
export interface ImportQuality {
  slots: number
  usable: number
  coveragePct: number
  first: string
  last: string
  gapRuns: number
  longestGapMin: number
  /** The five longest gaps, longest first. */
  gaps: GapRun[]
  spikes: number
  negatives: number
  conflictingDuplicates: number
  statusFlagged: number
  exactDuplicates: number
  unparseableRows: number
  irregularSteps: number
}

export function importQuality(c: StoredChannel, parser: { duplicates?: number; unparseableRows?: number; irregularSteps?: number } = {}): ImportQuality {
  const step = c.intervalMin * 60_000
  let usable = 0, spikes = 0, negatives = 0, conflictingDuplicates = 0, statusFlagged = 0
  const runs: Array<{ start: number; len: number }> = []
  let open: { start: number; len: number } | null = null
  for (let i = 0; i < c.values.length; i++) {
    const r = { value: c.values[i], quality: c.quality[i] as never }
    const q = c.quality[i]
    if (q === QUALITY.SPIKE) spikes++
    if (q === QUALITY.NEGATIVE && (c.values[i] ?? 0) < 0) negatives++
    if (q === QUALITY.DUPLICATE) conflictingDuplicates++
    if (q === QUALITY.STATUS) statusFlagged++
    if (isUsable(r)) {
      usable++
      if (open) runs.push(open)
      open = null
    } else if (open) open.len++
    else open = { start: i, len: 1 }
  }
  if (open) runs.push(open)
  const slots = c.values.length
  const gaps = [...runs].sort((a, b) => b.len - a.len || a.start - b.start).slice(0, 5).map((g) => ({
    from: localLabel(c.firstTsEnd + g.start * step - step),
    to: localLabel(c.firstTsEnd + (g.start + g.len - 1) * step),
    minutes: g.len * c.intervalMin,
  }))
  return {
    slots,
    usable,
    coveragePct: slots ? (usable / slots) * 100 : 0,
    first: localLabel(c.firstTsEnd),
    last: localLabel(c.firstTsEnd + (slots - 1) * step),
    gapRuns: runs.length,
    longestGapMin: runs.reduce((m, g) => Math.max(m, g.len), 0) * c.intervalMin,
    gaps,
    spikes, negatives, conflictingDuplicates, statusFlagged,
    exactDuplicates: parser.duplicates ?? 0,
    unparseableRows: parser.unparseableRows ?? 0,
    irregularSteps: parser.irregularSteps ?? 0,
  }
}
