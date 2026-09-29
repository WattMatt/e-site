'use client'
/** Programme roll-up (spec §14.2). Empty values show '—', never NaN. */
import { GANTT_STATUSES, GANTT_STATUS_LABELS, type DurationMode, type ScheduleStats } from '@esite/shared'

export interface StatsPanelProps {
  stats: ScheduleStats
  mode: DurationMode
  violations: number
  cycle: string[] | null
}

export function StatsPanel({ stats, mode, violations, cycle }: StatsPanelProps) {
  const unit = mode === 'working' ? 'working days' : 'calendar days'
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : `${v}%`)
  const days = (v: number | null) => (v === null || !Number.isFinite(v) || v === 0 ? '—' : `${v} ${unit}`)
  const items: Array<[string, string]> = [
    ['Overall completion', pct(stats.completionPct)],
    ['Average progress (weighted by duration)', pct(stats.weightedProgressPct)],
    ['Programme duration', days(stats.programmeDays)],
    ['Critical path', days(stats.criticalPathDays)],
    ['Tasks', String(stats.taskCount)],
    ['Milestones', String(stats.milestoneCount)],
    ...GANTT_STATUSES.map((s) => [GANTT_STATUS_LABELS[s], String(stats.byStatus[s])] as [string, string]),
  ]
  return (
    <section aria-label="Programme statistics" style={{ fontSize: 12 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, margin: 0 }}>
        {items.map(([k, v]) => (
          <div key={k}><dt style={{ color: 'var(--c-text-dim)' }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>
        ))}
      </dl>
      {violations > 0 && (
        <p role="alert" style={{ color: 'var(--c-red)' }}>{`${violations} ${violations === 1 ? 'link is' : 'links are'} broken by the planned dates (their tasks are on the critical path with negative float).`}</p>
      )}
      {cycle && <p role="alert" style={{ color: 'var(--c-red)' }}>Some tasks depend on each other in a loop, so no critical path can be worked out.</p>}
    </section>
  )
}
