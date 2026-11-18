// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scheduleProgramme } from '../schedule'
import { applyOps, type ProgrammeOp, type ProgrammeState } from '../persistence/ops'
import { activityRow, calendarRow, dependencyRow, programmeRow } from '../persistence/fixtures'
import { rowsToProgrammeInput, type ActivityRow } from '../persistence/rows'
import { MSPDI_NAMESPACE, parseMspdi, parseMspdiText, type MspdiProgramme } from './mspdi-parse'
import { planImport } from './mspdi-plan'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

function ok(result: ReturnType<typeof parseMspdi>): MspdiProgramme {
  if ('error' in result) throw new Error(`expected a programme, got: ${result.error}`)
  return result
}

/** A fresh contractor programme as `create_programme` leaves it: Site + Office, no activities. */
function emptyState(): ProgrammeState {
  return {
    programme: programmeRow({ kind: 'contractor', contractor_label: 'Saxby', project_start: '2026-09-01', default_calendar_id: 'SITE' }),
    calendars: [
      calendarRow('SITE', { name: 'Site', variant: 'site', work_weekdays: [1, 2, 3, 4, 5, 6] }),
      calendarRow('OFFICE', { name: 'Office', variant: 'office' }),
    ],
    exceptions: [],
    activities: [],
    dependencies: [],
    codeTypes: [],
    codeValues: [],
    activityCodes: [],
    fieldUpdateActivityIds: [],
    assignmentActivityIds: [],
    baselineActivityIds: [],
  }
}

function keyMaker(prefix = 'k') {
  let n = 0
  return () => `${prefix}${++n}`
}

const byUid = (s: ProgrammeState, uid: string): ActivityRow => {
  const a = s.activities.find((x) => x.external_uid === uid)
  if (!a) throw new Error(`no activity for UID ${uid}`)
  return a
}
const uidOf = (s: ProgrammeState, id: string | null) => (id === null ? null : s.activities.find((a) => a.id === id)?.external_uid ?? `?${id}`)
const schedule = (s: ProgrammeState) => scheduleProgramme(rowsToProgrammeInput(s))

/** Apply a plan and return the new state (throws on any refusal, which fails the test). */
function importInto(state: ProgrammeState, m: MspdiProgramme, newKey = keyMaker()) {
  const plan = planImport(state, m, newKey)
  return { plan, state: applyOps(state, plan.ops) }
}

const smallXml = fixture('small.xml')
const small = () => ok(parseMspdiText(smallXml))
const wrap = (inner: string, head = '<StartDate>2026-10-05T08:00:00</StartDate>') =>
  `<?xml version="1.0"?><Project xmlns="${MSPDI_NAMESPACE}">${head}${inner}</Project>`
const weekCal = (uid: string, name: string, working: number[]) =>
  `<Calendar><UID>${uid}</UID><Name>${name}</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${
    [1, 2, 3, 4, 5, 6, 7].map((d) => `<WeekDay><DayType>${d}</DayType><DayWorking>${working.includes(d) ? 1 : 0}</DayWorking></WeekDay>`).join('')
  }</WeekDays></Calendar>`
const MON_FRI_XML = weekCal('1', 'Standard', [2, 3, 4, 5, 6])

describe('planImport — first import of small.xml', () => {
  const m = small()
  const { plan, state } = importInto(emptyState(), m)

  it('creates one activity per kept task, each carrying its UID', () => {
    const uids = state.activities.map((a) => a.external_uid)
    expect(uids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13', '14'])
    expect(plan.diff.added.map((a) => a.uid)).toEqual(uids)
    expect(plan.diff.added[5]).toEqual({ uid: '6', name: 'Install MB-1' })
    expect(plan.diff).toMatchObject({ changed: [], removed: [], linksRemoved: 0, linksChanged: 0, unchanged: 0, calendarChanged: true })
  })

  it('rebuilds the WBS outline, with sort_order in file order and wbs_code from WBS or OutlineNumber', () => {
    const parents = Object.fromEntries(state.activities.map((a) => [a.external_uid, uidOf(state, a.parent_id)]))
    expect(parents).toEqual({
      1: null, 2: '1', 3: '1', 4: null, 5: '4', 6: '5', 7: '5', 8: '5', 9: '4', 12: null, 13: null, 14: null,
    })
    expect(state.activities.map((a) => a.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(byUid(state, '6').wbs_code).toBe('2.1.1')
    expect(byUid(state, '12').wbs_code).toBe('4')
  })

  it('maps types and durations (0 for summaries and milestones)', () => {
    const t = Object.fromEntries(state.activities.map((a) => [a.external_uid, [a.type, a.original_duration]]))
    expect(t).toEqual({
      1: ['summary', 0], 2: ['task', 2], 3: ['task', 3], 4: ['summary', 0], 5: ['summary', 0], 6: ['task', 5],
      7: ['task', 2.5], 8: ['task', 1.5], 9: ['finish_milestone', 0], 12: ['task', 1], 13: ['task', 3], 14: ['task', 1],
    })
  })

  it('maps constraints, deadline, actuals and % complete', () => {
    expect(byUid(state, '2')).toMatchObject({ actual_start: '2026-10-05', actual_finish: '2026-10-06', percent_complete: 100 })
    expect(byUid(state, '3')).toMatchObject({ constraint_type: 'snet', constraint_date: '2026-10-07', actual_start: '2026-10-07', percent_complete: 50 })
    expect(byUid(state, '9')).toMatchObject({ constraint_type: 'mfo', constraint_date: '2026-11-20', deadline: '2026-11-25' })
  })

  it('creates the links between imported activities with type, lag and unit', () => {
    const links = state.dependencies.map((d) => `${uidOf(state, d.pred_id)}>${uidOf(state, d.succ_id)} ${d.type} ${d.lag} ${d.lag_unit}`)
    expect(links.sort()).toEqual([
      '12>13 FS 26 working_days',
      '13>14 FS 0 working_days',
      '2>3 FS 0 working_days',
      '3>6 SS 1 working_days',
      '6>7 FF 2 elapsed_days',
      '6>8 FS -1 working_days',
      '7>8 SF 50 percent',
      '8>9 FS 0 working_days',
      '9>12 FS 6 working_days',
    ])
    expect(plan.diff.linksAdded).toBe(9)
  })

  it('maps the project calendar to the programme default and the task calendar to the task', () => {
    const def = state.calendars.find((c) => c.id === state.programme.default_calendar_id)
    expect(def).toMatchObject({ name: 'MS Project: Site 6-day', work_weekdays: [1, 2, 3, 4, 5, 6], hours_per_day: 8 })
    const ex = state.exceptions.filter((e) => e.calendar_id === def?.id)
    expect(ex.filter((e) => e.kind === 'non_work')).toHaveLength(20)
    expect(ex.find((e) => e.day === '2026-12-25')).toMatchObject({ kind: 'non_work', label: 'Year-end shutdown' })
    expect(ex.find((e) => e.day === '2026-11-01')).toMatchObject({ kind: 'work', label: 'Sunday catch-up' })
    const std = state.calendars.find((c) => c.id === byUid(state, '3').calendar_id)
    expect(std).toMatchObject({ name: 'MS Project: Standard', work_weekdays: [1, 2, 3, 4, 5] })
    expect(state.exceptions.filter((e) => e.calendar_id === std?.id).map((e) => e.day)).toEqual(['2026-09-24'])
    // The resource calendar is not used by any task, so it is not created.
    expect(state.calendars.map((c) => c.name).sort()).toEqual(['MS Project: Site 6-day', 'MS Project: Standard', 'Office', 'Site'])
  })

  it('sets project_start from the file on a first import; scheduling rules stay msp', () => {
    expect(state.programme.project_start).toBe('2026-10-05')
    expect(state.programme.scheduling_rules).toBe('msp')
    const sp = plan.ops.filter((o) => o.op === 'set_programme')
    expect(sp).toHaveLength(1)
  })

  it('schedules without errors', () => {
    const r = schedule(state)
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('planImport — engine dates match the file for an FS chain', () => {
  const xml = wrap(`<CalendarUID>1</CalendarUID><Calendars>${MON_FRI_XML}</Calendars><Tasks>
    <Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Duration>PT40H0M0S</Duration>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish></Task>
    <Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><Duration>PT24H0M0S</Duration>
      <Start>2026-10-12T08:00:00</Start><Finish>2026-10-14T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>3</UID><Name>C</Name><OutlineLevel>1</OutlineLevel><Duration>PT16H0M0S</Duration>
      <Start>2026-10-20T08:00:00</Start><Finish>2026-10-21T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>14400</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  </Tasks>`)

  it('early start and finish equal the file Start and Finish', () => {
    const m = ok(parseMspdiText(xml))
    const { state } = importInto(emptyState(), m)
    const r = schedule(state)
    expect(r.ok).toBe(true)
    for (const t of m.tasks) {
      const a = byUid(state, t.uid)
      const s = r.activities.get(a.id)
      expect([t.uid, s?.earlyStart, s?.earlyFinish]).toEqual([t.uid, t.start, t.finish])
    }
  })
})

/** small.xml revised: UID 6 renamed, UID 13 removed (12 → 14 directly), 8 → 9 lag changed, UID 15 added. */
function revisedSmall(): string {
  let x = smallXml.replace('<Name>   Install MB-1   </Name>', '<Name>Install MB-1 and glands</Name>')
  x = x.replace(/<Task>\s*<UID>13<\/UID>[\s\S]*?<\/Task>/, '')
  x = x.replace(
    /<PredecessorLink><PredecessorUID>13<\/PredecessorUID>(.*?)<\/PredecessorLink>/,
    '<PredecessorLink><PredecessorUID>12</PredecessorUID>$1</PredecessorLink>',
  )
  x = x.replace(
    '<PredecessorLink><PredecessorUID>8</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag>',
    '<PredecessorLink><PredecessorUID>8</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag>',
  )
  x = x.replace('</Tasks>', `<Task><UID>15</UID><ID>15</ID><Name>Commission</Name><Active>1</Active>
    <OutlineNumber>7</OutlineNumber><OutlineLevel>1</OutlineLevel><Duration>PT16H0M0S</Duration><DurationFormat>7</DurationFormat>
    <PredecessorLink><PredecessorUID>14</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
  </Task></Tasks>`)
  return x
}

/** First import of small.xml, plus E-Site's own work: an activity under "Distribution", a link to it, a field update on UID 13. */
function importedWithEsiteWork(): ProgrammeState {
  const s = importInto(emptyState(), small()).state
  const distribution = byUid(s, '4').id
  s.activities.push(activityRow('ESITE', { parent_id: distribution, name: 'Client walk-through', sort_order: null }))
  s.dependencies.push(dependencyRow('ESITE-LINK', byUid(s, '12').id, 'ESITE'))
  // E-Site's activity also waits on UID 13, which the revision removes.
  s.dependencies.push(dependencyRow('ESITE-LINK-13', byUid(s, '13').id, 'ESITE'))
  // A field update reported on UID 13 in E-Site, and a code a planner gave it.
  s.fieldUpdateActivityIds = [byUid(s, '13').id]
  byUid(s, '13').code = 'E-13'
  return s
}

describe('planImport — re-import of a revised file', () => {
  const before = importedWithEsiteWork()
  const plan = planImport(before, ok(parseMspdiText(revisedSmall())), keyMaker('r'))
  const after = applyOps(before, plan.ops)

  it('gives the exact diff', () => {
    expect(plan.diff).toEqual({
      added: [{ uid: '15', name: 'Commission' }],
      // Removing UID 13 moves Handover up one row; a sort_order move alone is not a change.
      changed: [{ uid: '6', name: 'Install MB-1 and glands', fields: ['name'] }],
      removed: [{ uid: '13', name: 'Cure plinth' }],
      linksAdded: 2, // 12→14, 14→15
      linksRemoved: 2, // 12→13, 13→14
      linksChanged: 1, // 8→9 lag 0 → 2
      calendarChanged: false,
      dataDate: null,
      unchanged: 10,
    })
  })

  it('emits only the ops the change needs', () => {
    const kinds = plan.ops.map((o) => o.op)
    expect(kinds.filter((k) => k === 'upsert_activity')).toHaveLength(3)
    // Handover still gets its new sort_order, even though the diff does not list it.
    expect(plan.ops).toContainEqual({ op: 'upsert_activity', id: byUid(before, '14').id, fields: { sort_order: 11 } })
    const lagChange = plan.ops.filter((o) => o.op === 'upsert_dependency' && o.id !== undefined)
    expect(lagChange).toHaveLength(1)
    expect(kinds.filter((k) => k === 'delete_activity')).toHaveLength(1)
    expect(kinds).not.toContain('set_programme')
    expect(kinds).not.toContain('upsert_calendar')
    const rename = plan.ops.find((o) => o.op === 'upsert_activity' && o.id === byUid(before, '6').id)
    expect(rename).toEqual({ op: 'upsert_activity', id: byUid(before, '6').id, fields: { name: 'Install MB-1 and glands' } })
    const created = plan.ops.find((o) => o.op === 'upsert_activity' && o.key !== undefined)
    expect(created).toMatchObject({ key: 'r1', fields: { external_uid: '15', name: 'Commission', original_duration: 2 } })
  })

  it('tombstones the removed task and keeps its field update', () => {
    const id = byUid(before, '13').id
    expect(plan.ops).toContainEqual({ op: 'delete_activity', id })
    expect(plan.ops.some((o) => o.op === 'upsert_activity' && o.id === id)).toBe(false)
    // Same row, still there, tombstoned, with its E-Site data on it.
    const gone = after.activities.find((a) => a.id === id)
    expect(gone).toMatchObject({ is_tombstoned: true, external_uid: '13', code: 'E-13' })
  })

  it('replaces the links between imported activities to match the file', () => {
    const live = after.dependencies.filter((d) => !d.id.startsWith('ESITE'))
    const links = live.map((d) => `${uidOf(after, d.pred_id)}>${uidOf(after, d.succ_id)} ${d.type} ${d.lag}`)
    expect(links.sort()).toEqual([
      '12>14 FS 0', '14>15 FS 0', '2>3 FS 0', '3>6 SS 1', '6>7 FF 2', '6>8 FS -1', '7>8 SF 50', '8>9 FS 2', '9>12 FS 6',
    ])
  })

  it('leaves the E-Site activity and its link untouched', () => {
    expect(JSON.stringify(plan.ops)).not.toContain('ESITE')
    expect(after.activities.find((a) => a.id === 'ESITE')).toEqual(before.activities.find((a) => a.id === 'ESITE'))
    expect(after.dependencies.find((d) => d.id === 'ESITE-LINK')).toBeDefined()
  })

  it('warns when a removed activity takes a link to an E-Site activity with it', () => {
    expect(after.dependencies.find((d) => d.id === 'ESITE-LINK-13')).toBeUndefined()
    expect(plan.warnings).toContain('"Cure plinth" (UID 13) was removed by the contractor; its link to "Client walk-through" was dropped.')
  })

  it('leaves project_start alone on a re-import', () => {
    const moved = smallXml.replace('<StartDate>2026-10-05T08:00:00</StartDate>', '<StartDate>2026-11-02T08:00:00</StartDate>')
    const p = planImport(before, ok(parseMspdiText(moved)), keyMaker('x'))
    expect(p.ops.some((o) => o.op === 'set_programme')).toBe(false)
  })

  it('schedules without errors', () => {
    expect(schedule(after).ok).toBe(true)
  })

  it('restores a UID that comes back, on the same row', () => {
    const back = planImport(after, small(), keyMaker('b'))
    const gone = after.activities.find((a) => a.external_uid === '13') as ActivityRow
    expect(back.ops).toContainEqual({ op: 'restore_activity', id: gone.id })
    expect(back.diff.added).toEqual([{ uid: '13', name: 'Cure plinth' }])
    expect(back.diff.removed).toEqual([{ uid: '15', name: 'Commission' }])
    const restored = applyOps(after, back.ops)
    expect(restored.activities.find((a) => a.id === gone.id)?.is_tombstoned).toBe(false)
    expect(schedule(restored).ok).toBe(true)
    // 12 → 14 joins two activities that are both still in the file; it goes with a delete_dependency.
    const links = restored.dependencies.filter((d) => !d.id.startsWith('ESITE'))
      .map((d) => `${uidOf(restored, d.pred_id)}>${uidOf(restored, d.succ_id)}`)
    expect(links).not.toContain('12>14')
    expect(links.sort()).toEqual(['12>13', '13>14', '2>3', '3>6', '6>7', '6>8', '7>8', '8>9', '9>12'])
    expect(back.diff.linksRemoved).toBe(2) // 12→14, 14→15
    expect(back.diff.linksChanged).toBe(1) // 8→9 lag back to 0
    expect(back.ops.filter((o) => o.op === 'delete_dependency')).toHaveLength(1)
  })
})

describe('planImport — a removed summary that still holds an E-Site activity', () => {
  it('is kept with a warning instead of being refused', () => {
    const before = importedWithEsiteWork()
    // A file link from Distribution (UID 4) to Snag walk (UID 12), and one from E-Site's activity to Distribution.
    before.dependencies.push(dependencyRow('L4-12', byUid(before, '4').id, byUid(before, '12').id))
    before.dependencies.push(dependencyRow('ESITE-TO-4', 'ESITE', byUid(before, '4').id, { type: 'SS' }))
    // Drop "Distribution" (UID 4) and everything under it.
    let x = smallXml
    for (const uid of ['4', '5', '6', '7', '8', '9']) x = x.replace(new RegExp(`<Task>\\s*<UID>${uid}</UID>[\\s\\S]*?</Task>`), '')
    const plan = planImport(before, ok(parseMspdiText(x)), keyMaker('d'))
    const after = applyOps(before, plan.ops)
    expect(plan.diff.removed.map((r) => r.uid)).toEqual(['5', '6', '7', '8', '9'])
    expect(byUid(after, '4').is_tombstoned).toBe(false)
    for (const uid of ['5', '6', '7', '8', '9']) expect(byUid(after, uid).is_tombstoned).toBe(true)
    expect(plan.warnings).toContain(
      'Task "Distribution" (UID 4) is no longer in the file, but it holds activities added in E-Site, so it was kept. Move them and delete it.',
    )
    expect(after.activities.find((a) => a.id === 'ESITE')?.parent_id).toBe(byUid(after, '4').id)
    // The kept summary loses its link to another imported activity (the file no longer has it)…
    expect(plan.ops).toContainEqual({ op: 'delete_dependency', id: 'L4-12' })
    expect(after.dependencies.find((d) => d.id === 'L4-12')).toBeUndefined()
    // …3>6, 6>7, 6>8, 7>8, 8>9, 9>12 go with the deleted activities, plus 4>12.
    expect(plan.diff.linksRemoved).toBe(7)
    // …but its link to the E-Site activity is E-Site's and stays.
    expect(after.dependencies.find((d) => d.id === 'ESITE-TO-4')).toBeDefined()
    expect(JSON.stringify(plan.ops)).not.toContain('ESITE')
  })
})

describe('planImport — calendars never overwrite E-Site calendars', () => {
  it('a file calendar called "Site" becomes "MS Project: Site" and is reused by that name', () => {
    const xml = wrap(`<CalendarUID>1</CalendarUID><Calendars>${weekCal('1', 'Site', [2, 3, 4, 5, 6])}</Calendars><Tasks>
      <Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration></Task></Tasks>`)
    const m = ok(parseMspdiText(xml))
    const start = emptyState()
    const { state } = importInto(start, m)
    expect(state.calendars.find((c) => c.id === 'SITE')).toEqual(start.calendars.find((c) => c.id === 'SITE'))
    const def = state.calendars.find((c) => c.id === state.programme.default_calendar_id)
    expect(def).toMatchObject({ name: 'MS Project: Site', work_weekdays: [1, 2, 3, 4, 5] })
    const again = planImport(state, m, keyMaker('c'))
    expect(again.ops).toEqual([])
    expect(again.diff.calendarChanged).toBe(false)
  })
})

describe('planImport — identical re-import', () => {
  it('gives no ops and counts every task unchanged', () => {
    const first = importInto(emptyState(), small()).state
    const again = planImport(first, small(), keyMaker('z'))
    expect(again.ops).toEqual([])
    expect(again.diff).toEqual({
      added: [], changed: [], removed: [], linksAdded: 0, linksRemoved: 0, linksChanged: 0, calendarChanged: false, dataDate: null, unchanged: 12,
    })
  })
})

describe('planImport — structure edge cases', () => {
  const xml = wrap(`<CalendarUID>1</CalendarUID><Calendars>${MON_FRI_XML}</Calendars><Tasks>
    <Task><UID>9</UID><Name>Kick-off</Name><OutlineLevel>1</OutlineLevel><Milestone>1</Milestone><Duration>PT0H0M0S</Duration></Task>
    <Task><UID>1</UID><Name>Phase 1</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>2</UID><Name>Old block</Name><OutlineLevel>2</OutlineLevel><Summary>1</Summary><Active>0</Active></Task>
    <Task><UID>3</UID><Name>Kept under the old block</Name><OutlineLevel>3</OutlineLevel><Duration>PT16H0M0S</Duration>
      <PredecessorLink><PredecessorUID>9</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    <Task><UID>4</UID><Name>After phase 1</Name><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  </Tasks>`)
  const m = ok(parseMspdiText(xml))
  const { plan, state } = importInto(emptyState(), m)

  it('keeps a link to a summary (msp rules allow it) and schedules after the summary', () => {
    const toSummary = state.dependencies.find((d) => d.pred_id === byUid(state, '1').id)
    expect(toSummary).toMatchObject({ succ_id: byUid(state, '4').id, type: 'FS' })
    expect(plan.ops.some((o) => o.op === 'upsert_dependency' && o.pred === byUid(state, '1').id.replace(/^key:/, ''))).toBe(true)
    const r = schedule(state)
    expect(r.ok).toBe(true)
    expect(r.activities.get(byUid(state, '4').id)?.earlyStart > (r.activities.get(byUid(state, '3').id)?.earlyFinish ?? '')).toBe(true)
  })

  it('a zero-duration milestone with successors and no predecessors is a start milestone', () => {
    expect(byUid(state, '9').type).toBe('start_milestone')
  })

  it('a task under a skipped inactive summary goes under the nearest active ancestor', () => {
    expect(byUid(state, '3').parent_id).toBe(byUid(state, '1').id)
  })
})

/** n tasks: summaries of 99 tasks each, every task FS-linked to the previous one. Built as a DOM, not a file. */
function syntheticDoc(n: number): Document {
  const doc = document.implementation.createDocument(MSPDI_NAMESPACE, 'Project', null)
  const root = doc.documentElement
  const add = (parent: Element, name: string, text?: string) => {
    const el = doc.createElementNS(MSPDI_NAMESPACE, name)
    if (text !== undefined) el.textContent = text
    parent.appendChild(el)
    return el
  }
  add(root, 'StartDate', '2026-10-05T08:00:00')
  add(root, 'CalendarUID', '1')
  const cals = add(root, 'Calendars')
  const cal = add(cals, 'Calendar')
  add(cal, 'UID', '1'); add(cal, 'Name', 'Standard'); add(cal, 'IsBaseCalendar', '1')
  const tasks = add(root, 'Tasks')
  let prevTask: number | null = null
  for (let uid = 1; uid <= n; uid++) {
    const t = add(tasks, 'Task')
    add(t, 'UID', String(uid))
    add(t, 'Name', `Task ${uid}`)
    const summary = (uid - 1) % 100 === 0
    add(t, 'OutlineLevel', summary ? '1' : '2')
    add(t, 'Summary', summary ? '1' : '0')
    if (!summary) {
      add(t, 'Duration', 'PT16H0M0S')
      if (prevTask !== null) {
        const l = add(t, 'PredecessorLink')
        add(l, 'PredecessorUID', String(prevTask)); add(l, 'Type', '1'); add(l, 'LinkLag', '0'); add(l, 'LagFormat', '7')
      }
      prevTask = uid
    }
  }
  return doc
}

describe('planImport — 5,000 tasks', () => {
  it('plans, applies and schedules (under 3 s with PERF_STRICT)', () => {
    const doc = syntheticDoc(5000)
    const t0 = performance.now()
    const m = ok(parseMspdi(doc))
    const plan = planImport(emptyState(), m, keyMaker())
    const t1 = performance.now()
    const state = applyOps(emptyState(), plan.ops)
    expect(state.activities).toHaveLength(5000)
    expect(state.dependencies).toHaveLength(4949)
    expect(plan.diff.added).toHaveLength(5000)
    expect(schedule(state).ok).toBe(true)
    const again = planImport(state, m, keyMaker('z'))
    expect(again.ops).toEqual([])
    expect(again.diff.unchanged).toBe(5000)
    if (process.env.PERF_STRICT) expect(t1 - t0).toBeLessThan(3000)
  }, 60_000)
})

// Type-level guard: the op list is the persistence op type.
const _typed: (s: ProgrammeState, m: MspdiProgramme) => ProgrammeOp[] = (s, m) => planImport(s, m, keyMaker()).ops
void _typed


// ----------------------------------------------------------------- fix round 1

/** A one-task file (5 days, Mon–Fri) plus a successor, with optional progress and status date. */
function progressFile(o: { actualStart?: string; actualFinish?: string; percent?: number; duration?: string; status?: string } = {}) {
  const head = `<StartDate>2026-10-05T08:00:00</StartDate>${o.status ? `<StatusDate>${o.status}</StatusDate>` : ''}`
  return ok(parseMspdiText(wrap(`<CalendarUID>1</CalendarUID><Calendars>${MON_FRI_XML}</Calendars><Tasks>
    <Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Duration>${o.duration ?? 'PT40H0M0S'}</Duration>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish>
      ${o.actualStart ? `<ActualStart>${o.actualStart}T08:00:00</ActualStart>` : ''}
      ${o.actualFinish ? `<ActualFinish>${o.actualFinish}T17:00:00</ActualFinish>` : ''}
      <PercentComplete>${o.percent ?? 0}</PercentComplete></Task>
    <Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><Duration>PT24H0M0S</Duration>
      <Start>2026-10-12T08:00:00</Start><Finish>2026-10-14T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  </Tasks>`, head)))
}
/** First import, then the progress E-Site recorded on A through a field update: started 05-Oct, 40 %, 1 day left, data date 08-Oct. */
function progressedInEsite(): ProgrammeState {
  const s = importInto(emptyState(), progressFile()).state
  Object.assign(byUid(s, '1'), { actual_start: '2026-10-05', percent_complete: 40, remaining_duration: 1 })
  s.programme.data_date = '2026-10-08'
  s.fieldUpdateActivityIds = [byUid(s, '1').id]
  return s
}

describe('planImport — progress recorded in E-Site (C1)', () => {
  it('a file with no progress never wipes E-Site progress (the reviewer\'s probe)', () => {
    const before = progressedInEsite()
    const plan = planImport(before, progressFile(), keyMaker('p'))
    expect(plan.ops).toEqual([])
    expect(plan.diff.unchanged).toBe(2)
    expect(plan.warnings).toEqual([])
    const after = applyOps(before, plan.ops)
    expect(byUid(after, '1')).toMatchObject({ actual_start: '2026-10-05', percent_complete: 40, remaining_duration: 1 })
    const r = schedule(after)
    expect(r.ok).toBe(true)
    // 1 day left from the data date: A finishes 08-Oct, B runs 09-Oct … 13-Oct.
    expect(r.activities.get(byUid(after, '1').id)?.earlyFinish).toBe('2026-10-08')
    expect(r.activities.get(byUid(after, '2').id)?.earlyStart).toBe('2026-10-09')
  })

  it('progress in the file wins, with a warning naming both values, and the stale remaining duration is cleared', () => {
    const before = progressedInEsite()
    const plan = planImport(before, progressFile({ actualStart: '2026-10-06', percent: 20 }), keyMaker('p'))
    const a = byUid(before, '1')
    expect(plan.ops).toEqual([{
      op: 'upsert_activity', id: a.id, fields: { actual_start: '2026-10-06', percent_complete: 20, remaining_duration: null },
    }])
    expect(plan.warnings).toEqual([
      'Task "A" (UID 1): the contractor\'s file reports actual start 2026-10-06; E-Site had 2026-10-05. The file\'s value was used.',
      'Task "A" (UID 1): the contractor\'s file reports percent complete 20; E-Site had 40. The file\'s value was used.',
      'Task "A" (UID 1): E-Site\'s remaining duration of 1 day was cleared because the file reports progress; it is now worked out from the actual dates.',
    ])
    expect(plan.diff.changed).toEqual([{ uid: '1', name: 'A', fields: ['actual_start', 'percent_complete', 'remaining_duration'] }])
    expect(schedule(applyOps(before, plan.ops)).ok).toBe(true)
  })

  it('a file value equal to E-Site\'s gives no warning; an actual finish from the file completes the task', () => {
    const before = progressedInEsite()
    const plan = planImport(before, progressFile({ actualStart: '2026-10-05', actualFinish: '2026-10-07', percent: 100 }), keyMaker('p'))
    expect(plan.ops).toEqual([{
      op: 'upsert_activity', id: byUid(before, '1').id,
      fields: { actual_finish: '2026-10-07', percent_complete: 100, remaining_duration: null },
    }])
    expect(plan.warnings.filter((w) => w.includes('actual start'))).toEqual([])
  })

  it('a duration change clears a stale remaining duration but keeps the E-Site actuals', () => {
    const before = progressedInEsite()
    const plan = planImport(before, progressFile({ duration: 'PT80H0M0S' }), keyMaker('p'))
    expect(plan.ops).toEqual([{
      op: 'upsert_activity', id: byUid(before, '1').id, fields: { original_duration: 10, remaining_duration: null },
    }])
    expect(plan.warnings).toEqual([
      'Task "A" (UID 1): E-Site\'s remaining duration of 1 day was cleared because the file changed the duration; it is now worked out from the actual dates.',
    ])
    const after = applyOps(before, plan.ops)
    expect(byUid(after, '1')).toMatchObject({ actual_start: '2026-10-05', percent_complete: 40, remaining_duration: null })
    // 10 days from 05-Oct with 3 worked by the data date: 7 left from 08-Oct → finishes 16-Oct.
    expect(schedule(after).activities.get(byUid(after, '1').id)?.earlyFinish).toBe('2026-10-16')
  })

  it('an actual finish kept from E-Site that would precede the file\'s new actual start is dropped, with a warning', () => {
    const before = progressedInEsite()
    Object.assign(byUid(before, '1'), { actual_finish: '2026-10-07', percent_complete: 100, remaining_duration: null })
    const plan = planImport(before, progressFile({ actualStart: '2026-10-08', percent: 50 }), keyMaker('p'))
    const after = applyOps(before, plan.ops)
    expect(byUid(after, '1')).toMatchObject({ actual_start: '2026-10-08', actual_finish: null, percent_complete: 50 })
    expect(plan.warnings).toContain(
      'Task "A" (UID 1): E-Site\'s actual finish 2026-10-07 is before the file\'s actual start 2026-10-08, so it was cleared.',
    )
    expect(plan.warnings.filter((w) => w.includes('finished in E-Site'))).toEqual([])
  })

  it('finished in E-Site but in progress in the file: E-Site\'s finish and 100 % are kept, with a warning (N2)', () => {
    const before = progressedInEsite()
    Object.assign(byUid(before, '1'), { actual_finish: '2026-10-07', percent_complete: 100, remaining_duration: null })
    const plan = planImport(before, progressFile({ actualStart: '2026-10-05', percent: 50 }), keyMaker('p'))
    const after = applyOps(before, plan.ops)
    expect(byUid(after, '1')).toMatchObject({ actual_start: '2026-10-05', actual_finish: '2026-10-07', percent_complete: 100 })
    expect(plan.ops).toEqual([])
    expect(plan.warnings).toEqual([
      'Task "A" (UID 1): finished in E-Site; the contractor\'s file shows it in progress (50 %). E-Site\'s finish was kept.',
    ])
  })
})

describe('planImport — StatusDate becomes the data date (I2)', () => {
  it('sets data_date and shows it in the diff; an identical re-import leaves it', () => {
    const m = progressFile({ actualStart: '2026-10-05', percent: 40, status: '2026-10-07T17:00:00' })
    const { plan, state } = importInto(emptyState(), m)
    expect(state.programme.data_date).toBe('2026-10-08')
    expect(plan.diff.dataDate).toEqual({ from: null, to: '2026-10-08' })
    const again = planImport(state, m, keyMaker('s'))
    expect(again.ops).toEqual([])
    expect(again.diff.dataDate).toBeNull()
  })

  it('a progressed file schedules to its own dates (work not done by the status date moves after it)', () => {
    // A finished 07-Oct; the status date is Mon 12-Oct (end of day), so B (3 days, not started) runs Tue 13 … Thu 15-Oct,
    // as MS Project shows it. Without the data date B would start 08-Oct.
    const m = progressFile({ actualStart: '2026-10-05', actualFinish: '2026-10-07', percent: 100, status: '2026-10-12T17:00:00' })
    const { state } = importInto(emptyState(), m)
    const r = schedule(state)
    expect(r.ok).toBe(true)
    expect(r.activities.get(byUid(state, '1').id)?.earlyFinish).toBe('2026-10-07')
    expect(r.activities.get(byUid(state, '2').id)).toMatchObject({ earlyStart: '2026-10-13', earlyFinish: '2026-10-15' })
  })

  it('a later status date moves the data date and says so', () => {
    const first = importInto(emptyState(), progressFile({ status: '2026-10-07T17:00:00' })).state
    const p = planImport(first, progressFile({ status: '2026-10-14T17:00:00' }), keyMaker('s'))
    expect(p.ops).toContainEqual({ op: 'set_programme', fields: { data_date: '2026-10-15' } })
    expect(p.diff.dataDate).toEqual({ from: '2026-10-08', to: '2026-10-15' })
  })
})

describe('planImport — planner edits on an imported activity before a re-import (I3)', () => {
  it('imported fields follow the file and show in the diff; codes and progress survive', () => {
    const before = importInto(emptyState(), small()).state
    const six = byUid(before, '6')
    Object.assign(six, {
      name: 'Install MB-1 (WM wording)', original_duration: 7, code: 'WM-6',
      actual_start: '2026-10-08', percent_complete: 30, remaining_duration: 4,
    })
    before.codeTypes.push({ id: 'CT', programme_id: 'P', name: 'Area', sort_order: null })
    before.codeValues.push({ id: 'CV', code_type_id: 'CT', programme_id: 'P', value: 'North', description: null, colour: null, organisation_tag: null, user_tag: null })
    before.activityCodes.push({ activity_id: six.id, code_type_id: 'CT', code_value_id: 'CV', programme_id: 'P' })
    before.fieldUpdateActivityIds = [six.id]

    const plan = planImport(before, small(), keyMaker('e'))
    expect(plan.diff.changed).toEqual([
      { uid: '6', name: 'Install MB-1', fields: ['name', 'original_duration', 'remaining_duration'] },
    ])
    const after = applyOps(before, plan.ops)
    expect(byUid(after, '6')).toMatchObject({
      name: 'Install MB-1', original_duration: 5, remaining_duration: null,
      code: 'WM-6', actual_start: '2026-10-08', percent_complete: 30,
    })
    expect(after.activityCodes).toEqual(before.activityCodes)
    expect(schedule(after).ok).toBe(true)
  })
})

describe('planImport — a UID returning under a removed E-Site activity (I4)', () => {
  it('never names the E-Site activity; the UID stays removed with a warning', () => {
    const s = importInto(emptyState(), small()).state
    // A planner moved Snag walk (UID 12) under an E-Site group, then removed both.
    s.activities.push(activityRow('EGROUP', { name: 'WM snag group', type: 'summary', original_duration: 0, is_tombstoned: true }))
    Object.assign(byUid(s, '12'), { parent_id: 'EGROUP', is_tombstoned: true })
    s.dependencies = s.dependencies.filter((d) => d.pred_id !== byUid(s, '12').id && d.succ_id !== byUid(s, '12').id)
    const plan = planImport(s, small(), keyMaker('g'))
    expect(JSON.stringify(plan.ops)).not.toContain('EGROUP')
    expect(plan.ops.some((o) => 'id' in o && o.id === byUid(s, '12').id)).toBe(false)
    expect(plan.warnings).toContain(
      'Task "Snag walk" (UID 12) returned under a removed E-Site activity ("WM snag group"), which an import cannot restore, so it was left removed. Restore "WM snag group" in E-Site and import again.',
    )
    const after = applyOps(s, plan.ops)
    expect(after.activities.find((a) => a.id === 'EGROUP')).toEqual(s.activities.find((a) => a.id === 'EGROUP'))
    expect(byUid(after, '12').is_tombstoned).toBe(true)
    expect(schedule(after).ok).toBe(true)
  })

  it('a returning UID under a removed IMPORTED activity is placed under its file parent; the old parent goes back to removed', () => {
    const s = importInto(emptyState(), small()).state
    // UID 99 used to be a summary holding Snag walk (UID 12); both were removed by an earlier revision.
    s.activities.push(activityRow('OLD99', { name: 'Old phase', type: 'summary', original_duration: 0, external_uid: '99', is_tombstoned: true }))
    Object.assign(byUid(s, '12'), { parent_id: 'OLD99', is_tombstoned: true })
    s.dependencies = s.dependencies.filter((d) => d.pred_id !== byUid(s, '12').id && d.succ_id !== byUid(s, '12').id)
    const plan = planImport(s, small(), keyMaker('g'))
    const after = applyOps(s, plan.ops)
    expect(byUid(after, '12')).toMatchObject({ is_tombstoned: false, parent_id: null })
    expect(after.activities.find((a) => a.id === 'OLD99')?.is_tombstoned).toBe(true)
    expect(plan.diff.added).toEqual([{ uid: '12', name: 'Snag walk' }])
    expect(plan.diff.removed).toEqual([])
  })
})

describe('planImport — minor warnings', () => {
  it('M1: a summary that becomes a task while holding an E-Site activity is flagged', () => {
    const before = importedWithEsiteWork() // ESITE sits under Distribution (UID 4)
    const x = smallXml.replace(
      '<WBS>2</WBS><OutlineNumber>2</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary>',
      '<WBS>2</WBS><OutlineNumber>2</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>0</Summary>',
    ).replace(/<OutlineLevel>(2|3)<\/OutlineLevel>/g, (_m, l) => `<OutlineLevel>${l}</OutlineLevel>`)
    const m = ok(parseMspdiText(x))
    m.tasks = m.tasks.filter((t) => !['5', '6', '7', '8', '9'].includes(t.uid))
    for (const t of m.tasks) t.predecessors = t.predecessors.filter((l) => !['5', '6', '7', '8', '9'].includes(l.uid))
    const plan = planImport(before, m, keyMaker('m'))
    expect(plan.warnings).toContain(
      'Task "Distribution" (UID 4) is no longer a summary in the file, but it holds activities added in E-Site. Move them to a summary.',
    )
  })

  it('M3: E-Site days on an MS Project calendar that the file drops are named', () => {
    const s = importInto(emptyState(), small()).state
    const cal = s.calendars.find((c) => c.name === 'MS Project: Standard') as { id: string }
    s.exceptions.push({ id: 'X', calendar_id: cal.id, day: '2026-10-20', kind: 'non_work', label: 'Strike' })
    const plan = planImport(s, small(), keyMaker('m'))
    expect(plan.warnings).toContain('Calendar "MS Project: Standard": the file does not have 2026-10-20 (Strike), which was added in E-Site; it was removed.')
  })

  it('M4: two file calendars with the same name are both suffixed by UID', () => {
    const xml = wrap(`<CalendarUID>1</CalendarUID><Calendars>${weekCal('1', 'Shift', [2, 3, 4, 5, 6])}${weekCal('2', 'Shift', [2, 3, 4, 5, 6, 7])}</Calendars><Tasks>
      <Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Duration>PT8H0M0S</Duration><CalendarUID>2</CalendarUID></Task></Tasks>`)
    const { state } = importInto(emptyState(), ok(parseMspdiText(xml)))
    expect(state.calendars.map((c) => c.name).filter((n) => n.startsWith('MS Project')).sort())
      .toEqual(['MS Project: Shift (UID 1)', 'MS Project: Shift (UID 2)'])
  })

  it('M6: a start date moved earlier on a re-import is flagged', () => {
    const first = importInto(emptyState(), small()).state
    const earlier = smallXml.replace('<StartDate>2026-10-05T08:00:00</StartDate>', '<StartDate>2026-09-28T08:00:00</StartDate>')
    const plan = planImport(first, ok(parseMspdiText(earlier)), keyMaker('m'))
    expect(plan.warnings).toContain(
      'The file starts on 2026-09-28, before the programme start 2026-10-05. The programme start was not moved; change it in the programme settings if the work really starts earlier.',
    )
  })

  it('M7: a UID that comes back is named as restored', () => {
    const s = importInto(emptyState(), small()).state
    byUid(s, '14').is_tombstoned = true
    s.dependencies = s.dependencies.filter((d) => d.succ_id !== byUid(s, '14').id)
    const plan = planImport(s, small(), keyMaker('m'))
    expect(plan.warnings).toContain('Task "Handover" (UID 14) was removed before and is back in the file; it was restored with its E-Site data.')
  })
})
