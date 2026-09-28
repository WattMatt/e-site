// @vitest-environment node
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { exportScheduleXlsx, XLSX_HEADERS } from './export-xlsx'
import { readXlsxTable } from './read-xlsx'
import { guessImportMapping, mapImportTable, makeWorkCalendar, type ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from './types'

const t = (id: string, over: Partial<ScheduleTaskView>): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-02',
  isMilestone: false, status: 'not_started', awaitingSignOff: false, progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann Smith',
  sortOrder: Number(id), description: '', updatedAt: 'U', segments: [], ...over,
})
const data: ScheduleData = {
  projectId: 'p', projectName: 'KINGSWALK', canEdit: true, currentUserId: 'u1', today: '2026-09-28',
  tasks: [
    t('1', { name: 'Design, roof A', start: '2026-10-01', end: '2026-10-05', status: 'done', progress: 100 }),
    t('2', { name: 'Install', category: 'Installation', zone: 'Roof A', start: '2026-10-06', end: '2026-10-08', status: 'in_progress', progress: 40 }),
    t('3', { name: 'Go live', category: 'Handover', start: '2026-10-12', end: '2026-10-12', isMilestone: true }),
  ],
  links: [{ id: 'd1', predecessorId: '1', successorId: '2', type: 'FS', lagDays: 0 }, { id: 'd2', predecessorId: '2', successorId: '3', type: 'SS', lagDays: 2 }],
  owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
}

describe('exportScheduleXlsx', () => {
  it('round-trips through the importer: names, dates, status, milestones, owners and links survive', async () => {
    const cal = makeWorkCalendar('calendar')
    const rows = await readXlsxTable(await exportScheduleXlsx(data, cal))
    expect(rows[0].slice(0, 14)).toEqual(['#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone', 'Predecessors', 'Notes', 'Colour'])
    expect(rows[0]).toEqual([...XLSX_HEADERS])
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    expect(plan.tasks.map((x) => [x.name, x.start, x.end, x.status, x.isMilestone, x.category, x.zone, x.progress, x.ownerHint, x.colour])).toEqual(
      data.tasks.map((x) => [x.name, x.start, x.end, x.status, x.isMilestone, x.category, x.zone, x.progress, x.ownerName, x.colour]))
    expect(plan.links).toEqual([
      { fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 },
      { fromKey: 'p2', toKey: 'p3', type: 'SS', lagDays: 2 },
    ])
  })
  it('marks the critical path and the float', async () => {
    const rows = await readXlsxTable(await exportScheduleXlsx(data, makeWorkCalendar('calendar')))
    const critical = rows[0].indexOf('Critical')
    const float = rows[0].indexOf('Float (days)')
    // SS+2 from Install lets Go live start 10-08 at the earliest; it is planned 10-12 and ends the
    // programme, so Go live is critical and Design/Install carry 4 days of float. A milestone sits at
    // the END of its day (units: F1=5, F2=8, S3=F3=12, so Install's finish may slip to 12).
    expect(rows.slice(1).map((r) => r[critical])).toEqual(['', '', 'Yes'])
    expect(rows.slice(1).map((r) => r[float])).toEqual(['4', '4', '0'])
  })
  it('writes dates as text, never Excel serials', async () => {
    const rows = await readXlsxTable(await exportScheduleXlsx(data, makeWorkCalendar('calendar')))
    expect(rows[1][4]).toBe('2026-10-01')
    expect(rows[3][5]).toBe('2026-10-12')
  })
})
