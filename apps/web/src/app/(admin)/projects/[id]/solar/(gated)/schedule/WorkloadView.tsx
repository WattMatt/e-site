'use client'
/**
 * Resource workload (spec §14.2): peak concurrent open tasks per owner per
 * week; weeks above the project's threshold (schedule_settings, default 2 —
 * owner decision Q10) are marked, in words as well as colour.
 */
import { addCalendarDays, formatCalendarDate, type OwnerWorkload } from '@esite/shared'
/** Same words as the loader's FORMER_MEMBER (that module is server-only). */
const FORMER_MEMBER_LABEL = 'Former project member'

export interface WorkloadViewProps {
  workload: OwnerWorkload[]
  /** Built client-side from ScheduleData.owners — a Map never crosses the server → client boundary. */
  ownerNames: ReadonlyMap<string, string>
  threshold: number
}

export function WorkloadView({ workload, ownerNames, threshold }: WorkloadViewProps) {
  const weeks = [...new Set(workload.flatMap((o) => o.weeks.map((w) => w.weekStart)))].sort()
  if (weeks.length === 0) return <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>No open tasks to show.</p>
  return (
    <div style={{ fontSize: 11 }}>
      <p style={{ margin: '4px 0', color: 'var(--c-text-dim)' }}>{`Weeks where someone has more than ${threshold} ${threshold === 1 ? 'task' : 'tasks'} at once are marked.`}</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 4 }}>Owner</th>
              {weeks.map((w) => <th key={w} style={{ padding: 4, whiteSpace: 'nowrap' }}>{formatCalendarDate(w).split(' ').slice(0, 2).join(' ')}</th>)}
            </tr>
          </thead>
          <tbody>
            {workload.map((o) => {
              const name = ownerNames.get(o.ownerId) ?? FORMER_MEMBER_LABEL
              const byWeek = new Map(o.weeks.map((w) => [w.weekStart, w]))
              return (
                <tr key={o.ownerId}>
                  <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{name}</td>
                  {weeks.map((w) => {
                    const cell = byWeek.get(w)
                    if (!cell) return <td key={w} />
                    const label = `${name}, week of ${formatCalendarDate(w)}: ${cell.maxConcurrent} at once${cell.overloaded ? ` — more than ${threshold}` : ''}`
                    return (
                      <td key={w} aria-label={label}
                        title={`${cell.taskIds.length} ${cell.taskIds.length === 1 ? 'task' : 'tasks'} between ${formatCalendarDate(w)} and ${formatCalendarDate(addCalendarDays(w, 6))}`}
                        style={{ padding: 4, textAlign: 'center', fontWeight: cell.overloaded ? 700 : 400, background: cell.overloaded ? 'var(--c-red-dim, #fecaca)' : 'var(--c-green-dim, #dcfce7)' }}>
                        {cell.overloaded ? `${cell.maxConcurrent}!` : cell.maxConcurrent}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
