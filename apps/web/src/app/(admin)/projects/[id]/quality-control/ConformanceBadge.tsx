import type { QcConformance, QcSeverity } from '@esite/shared'
import { QC_CONFORMANCE_LABELS, QC_SEVERITY_LABELS } from '@esite/shared'

// Presentational conformance chips shared by the entry card (client) and the
// report list (server component). No 'use client' — plain spans render in both.
// The value → CSS-badge mapping is the single source of truth for QC status
// colour, mirroring the PDF's Pass-green / Fail-red / N-A-grey palette.

export const CONFORMANCE_BADGE_CLASS: Record<QcConformance, string> = {
  pass: 'badge badge-green',
  fail: 'badge badge-red',
  na: 'badge badge-muted',
}

// Web has no orange var, so the PDF's amber→orange→red severity ramp maps to
// three distinct web badges: minor (blue/info), major (amber/warning),
// critical (red/danger).
export const SEVERITY_CHIP_CLASS: Record<QcSeverity, string> = {
  minor: 'badge badge-blue',
  major: 'badge badge-amber',
  critical: 'badge badge-red',
}

export function ConformanceBadge({ conformance }: { conformance: QcConformance }) {
  return <span className={CONFORMANCE_BADGE_CLASS[conformance]}>{QC_CONFORMANCE_LABELS[conformance]}</span>
}

export function SeverityChip({ severity }: { severity: QcSeverity }) {
  return <span className={SEVERITY_CHIP_CLASS[severity]}>{QC_SEVERITY_LABELS[severity]}</span>
}

export interface ConformanceCounts {
  pass: number
  fail: number
  na: number
}

/**
 * Compact per-report tally for the list rows — one small badge per non-zero
 * conformance count (e.g. "Pass 4  Fail 1"). Renders nothing when the report
 * has no entries yet, so an empty report stays visually clean.
 */
export function ConformanceTally({ counts }: { counts: ConformanceCounts }) {
  const parts: Array<[QcConformance, number]> = [
    ['pass', counts.pass],
    ['fail', counts.fail],
    ['na', counts.na],
  ]
  const shown = parts.filter(([, n]) => n > 0)
  if (shown.length === 0) return null
  return (
    <span
      style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
      aria-label={`Conformance: ${shown.map(([c, n]) => `${QC_CONFORMANCE_LABELS[c]} ${n}`).join(', ')}`}
    >
      {shown.map(([c, n]) => (
        <span key={c} className={CONFORMANCE_BADGE_CLASS[c]}>
          {QC_CONFORMANCE_LABELS[c]} {n}
        </span>
      ))}
    </span>
  )
}
