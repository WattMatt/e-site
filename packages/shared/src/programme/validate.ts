import { isCalendarDate } from '../lib/dates/calendar-date'
import { ISSUE_SEVERITY } from './types'
import type { IssueCode, ProgrammeInput, ScheduleIssue } from './types'

function issue(code: IssueCode, message: string, activityIds: string[] = [], dependencyIds: string[] = []): ScheduleIssue {
  return { code, severity: ISSUE_SEVERITY[code], activityIds, dependencyIds, message }
}

/** Structural checks on a programme input. Does not look for dependency cycles (normalise does, after expansion). */
export function validateProgramme(input: ProgrammeInput): ScheduleIssue[] {
  const issues: ScheduleIssue[] = []
  const byId = new Map(input.activities.map(a => [a.id, a]))
  const calendarIds = new Set(input.calendars.map(c => c.id))

  // Programme-level dates and calendar.
  if (!isCalendarDate(input.projectStart)) {
    issues.push(issue('invalid_date', `Project start "${String(input.projectStart)}" is not a valid date.`))
  }
  if (input.dataDate !== null && !isCalendarDate(input.dataDate)) {
    issues.push(issue('invalid_date', `Data date "${String(input.dataDate)}" is not a valid date.`))
  }
  if (!calendarIds.has(input.defaultCalendarId)) {
    issues.push(issue('unknown_calendar', `Default calendar "${input.defaultCalendarId}" does not exist.`))
  }
  const dataDate = input.dataDate !== null && isCalendarDate(input.dataDate) ? input.dataDate : null

  // Per-activity checks.
  for (const a of input.activities) {
    if (a.calendarId !== null && !calendarIds.has(a.calendarId)) {
      issues.push(issue('unknown_calendar', `Activity ${a.id} uses unknown calendar "${a.calendarId}".`, [a.id]))
    }
    const dates: Array<[string, string | null]> = [
      ['constraint date', a.constraint?.date ?? null],
      ['deadline', a.deadline],
      ['actual start', a.actualStart],
      ['actual finish', a.actualFinish],
      ['fixed start', a.fixed?.start ?? null],
      ['fixed finish', a.fixed?.finish ?? null],
    ]
    for (const [label, value] of dates) {
      if (value !== null && !isCalendarDate(value)) {
        issues.push(issue('invalid_date', `Activity ${a.id} has an invalid ${label} "${String(value)}".`, [a.id]))
      }
    }
    if ((a.type === 'start_milestone' || a.type === 'finish_milestone') && a.originalDuration !== 0) {
      issues.push(issue('milestone_has_duration', `Milestone ${a.id} has a duration of ${a.originalDuration}; it must be 0.`, [a.id]))
    }
    if (a.constraint && a.constraint.type !== 'alap' && a.constraint.date === null) {
      issues.push(issue('constraint_date_missing', `Activity ${a.id} has a ${a.constraint.type} constraint without a date.`, [a.id]))
    }
    if (a.type === 'module_summary' && a.fixed === null) {
      issues.push(issue('fixed_dates_missing', `Module summary ${a.id} has no fixed start and finish.`, [a.id]))
    }
    if (a.actualStart !== null && a.actualFinish !== null
      && isCalendarDate(a.actualStart) && isCalendarDate(a.actualFinish) && a.actualFinish < a.actualStart) {
      issues.push(issue('actual_finish_before_start', `Activity ${a.id} finished (${a.actualFinish}) before it started (${a.actualStart}).`, [a.id]))
    }
    if (dataDate !== null) {
      const after = [a.actualStart, a.actualFinish].filter((d): d is string => d !== null && isCalendarDate(d) && d > dataDate)
      if (after.length > 0) {
        issues.push(issue('actual_after_data_date', `Activity ${a.id} has an actual date after the data date ${dataDate}.`, [a.id]))
      }
    }
    if (a.parentId !== null && !byId.has(a.parentId)) {
      issues.push(issue('missing_parent', `Activity ${a.id} has parent "${a.parentId}", which does not exist.`, [a.id]))
    }
  }

  // Parent loops: one issue per loop.
  const reported = new Set<string>()
  for (const a of input.activities) {
    const seen: string[] = []
    const index = new Map<string, number>()
    let cur: string | null = a.id
    while (cur !== null && byId.has(cur) && !index.has(cur)) {
      index.set(cur, seen.length)
      seen.push(cur)
      cur = byId.get(cur)!.parentId
    }
    if (cur !== null && index.has(cur)) {
      const loop = seen.slice(index.get(cur)!)
      const key = [...loop].sort().join('|')
      if (!reported.has(key)) {
        reported.add(key)
        issues.push(issue('parent_cycle', `Parent hierarchy loops: ${[...loop, loop[0]].join(' → ')}.`, loop))
      }
    }
  }

  // Dependencies.
  const seenLinks = new Set<string>()
  for (const d of input.dependencies) {
    const predKnown = byId.has(d.predId)
    const succKnown = byId.has(d.succId)
    if (!predKnown || !succKnown) {
      const missing = [!predKnown ? d.predId : null, !succKnown ? d.succId : null].filter((x): x is string => x !== null)
      issues.push(issue('unknown_activity', `Link ${d.id} refers to unknown activity ${missing.join(', ')}.`, missing, [d.id]))
      continue
    }
    if (d.predId === d.succId) {
      issues.push(issue('self_link', `Link ${d.id} joins activity ${d.predId} to itself.`, [d.predId], [d.id]))
      continue
    }
    const key = `${d.predId}\u0000${d.succId}\u0000${d.type}`
    if (seenLinks.has(key)) {
      issues.push(issue('duplicate_link', `Link ${d.id} repeats ${d.predId} ${d.type} ${d.succId}; it is ignored.`, [d.predId, d.succId], [d.id]))
    } else {
      seenLinks.add(key)
    }
    if (input.options.rules === 'p6') {
      const touching = [d.predId, d.succId].filter(id => byId.get(id)!.type === 'summary')
      if (touching.length > 0) {
        issues.push(issue('summary_link_p6', `Link ${d.id} touches summary ${touching.join(', ')}; P6 rules do not allow it.`, touching, [d.id]))
      }
    }
  }

  return issues
}
