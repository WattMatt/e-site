process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { parseCsvText } from './csv'
import { parseMsProjectXml, isMsProjectXml } from './mspdi'
import { guessImportMapping, mapImportTable, parseLooseDate, parsePredecessors, parseProgress } from './table'
import { validateImportPlan } from './plan'
import { makeWorkCalendar } from '../calendar'

const cal = makeWorkCalendar('calendar')

describe('parseCsvText', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a BOM', () => {
    expect(parseCsvText('﻿Task,Start\r\n"Install, roof A","2026-10-01"\r\n"Line1\nLine2",x\r\n'))
      .toEqual([['Task', 'Start'], ['Install, roof A', '2026-10-01'], ['Line1\nLine2', 'x']])
  })
  it('detects a semicolon delimiter (SA Excel exports)', () => {
    expect(parseCsvText('Task;Start\nA;2026-10-01')).toEqual([['Task', 'Start'], ['A', '2026-10-01']])
  })
  it('keeps escaped quotes and drops trailing blank lines', () => {
    expect(parseCsvText('a\n"say ""hi"""\n\n\n')).toEqual([['a'], ['say "hi"']])
  })
})

describe('parseLooseDate', () => {
  it('reads ISO, day-first SA dates, month names and Excel serials — never month-first', () => {
    expect(parseLooseDate('2026-10-01')).toBe('2026-10-01')
    expect(parseLooseDate('2026-10-01T08:00:00')).toBe('2026-10-01')
    expect(parseLooseDate('01/10/2026')).toBe('2026-10-01')
    expect(parseLooseDate('1.10.2026')).toBe('2026-10-01')
    expect(parseLooseDate('1 Oct 2026')).toBe('2026-10-01')
    expect(parseLooseDate('1 October 2026')).toBe('2026-10-01')
    expect(parseLooseDate('46296')).toBe('2026-10-01')
    expect(parseLooseDate('31/02/2026')).toBeNull()
    expect(parseLooseDate('soon')).toBeNull()
  })
})

describe('cell parsers', () => {
  it('progress as percent, fraction or number', () => {
    expect(parseProgress('50%')).toBe(50)
    expect(parseProgress('0.25')).toBe(25)
    expect(parseProgress('75')).toBe(75)
    expect(parseProgress('')).toBe(0)
    expect(parseProgress('lots')).toBeNull()
  })
  it('predecessors like MS Project', () => {
    expect(parsePredecessors('3FS+2d, 5SS; 7')).toEqual([
      { position: 3, type: 'FS', lagDays: 2 }, { position: 5, type: 'SS', lagDays: 0 }, { position: 7, type: 'FS', lagDays: 0 },
    ])
    expect(parsePredecessors('2FF-1')).toEqual([{ position: 2, type: 'FF', lagDays: -1 }])
    expect(parsePredecessors('')).toEqual([])
    expect(parsePredecessors('after design')).toBeNull()
  })
})

describe('guessImportMapping + mapImportTable', () => {
  const rows = [
    ['#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone', 'Predecessors', 'Notes', 'Colour'],
    ['1', 'Design', 'Design', '', '2026-10-01', '2026-10-05', '', 'ann@example.com', '100%', '', '', '', 'First', '#EF4444'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2', 'Install', 'Installation', 'Roof A', '06/10/2026', '', '3', 'Bob', '', 'in progress', '', '1FS', '', ''],
    ['3', 'Go live', 'Handover', '', '2026-10-12', '', '', '', '', '', 'yes', '2FS+1d', '', ''],
  ]
  it('maps synonyms, ignores the # column', () => {
    const m = guessImportMapping(rows[0])
    expect(m).toMatchObject({ name: 1, category: 2, zone: 3, start: 4, end: 5, duration: 6, owner: 7, progress: 8, status: 9, milestone: 10, predecessors: 11, notes: 12, colour: 13 })
  })
  it('builds a valid plan: duration → end, progress 100 → done, milestone, links by position', () => {
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    expect(plan.tasks.map((t) => [t.key, t.name, t.start, t.end, t.status, t.isMilestone])).toEqual([
      ['p1', 'Design', '2026-10-01', '2026-10-05', 'done', false],
      ['p2', 'Install', '2026-10-06', '2026-10-08', 'in_progress', false],
      ['p3', 'Go live', '2026-10-12', '2026-10-12', 'not_started', true],
    ])
    expect(plan.tasks[0]).toMatchObject({ colour: '#ef4444', ownerHint: 'ann@example.com', description: 'First', progress: 100, sourceRow: 2 })
    expect(plan.links).toEqual([
      { fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 },
      { fromKey: 'p2', toKey: 'p3', type: 'FS', lagDays: 1 },
    ])
    expect(validateImportPlan(plan)).toEqual([])
  })
  it('reports bad rows by spreadsheet row, and a missing name mapping', () => {
    const bad = [['Task', 'Start', 'End', 'Predecessors'], ['A', 'someday', '', ''], ['B', '2026-10-05', '2026-10-01', '9']]
    const { issues } = mapImportTable(bad, guessImportMapping(bad[0]), cal)
    expect(issues).toEqual([
      { row: 2, message: 'Row 2: "someday" is not a date. Use 2026-10-01 or 01/10/2026.' },
      { row: 3, message: 'Row 3: predecessor 9 is not a task in this file.' },
    ])
    expect(mapImportTable(bad, { ...guessImportMapping(bad[0]), name: null }, cal).issues)
      .toEqual([{ row: null, message: 'Choose which column holds the task name.' }])
  })
  it('validateImportPlan finds a loop created by predecessors', () => {
    const loop = [['Task', 'Start', 'End', 'Predecessors'], ['A', '2026-10-01', '2026-10-02', '2'], ['B', '2026-10-03', '2026-10-04', '1']]
    const { plan } = mapImportTable(loop, guessImportMapping(loop[0]), cal)
    // A's predecessor is B (link p2→p1) and B's is A (p1→p2); the loop is reported in link direction.
    expect(validateImportPlan(plan)).toEqual([{ row: null, message: 'These tasks depend on each other in a loop: B → A → B.' }])
  })
})

const MSPDI = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
 <Tasks>
  <Task><UID>0</UID><ID>0</ID><Name>Project summary</Name><Summary>1</Summary><OutlineLevel>0</OutlineLevel></Task>
  <Task><UID>1</UID><ID>1</ID><Name>Design &amp; approvals</Name><Summary>1</Summary><OutlineLevel>1</OutlineLevel></Task>
  <Task><UID>2</UID><ID>2</ID><Name>Detailed design</Name><OutlineLevel>2</OutlineLevel><Start>2026-10-01T08:00:00</Start><Finish>2026-10-05T17:00:00</Finish><PercentComplete>40</PercentComplete><Notes>Ω check</Notes></Task>
  <Task><UID>3</UID><ID>3</ID><Name>SSEG submitted</Name><OutlineLevel>2</OutlineLevel><Start>2026-10-06T08:00:00</Start><Finish>2026-10-06T08:00:00</Finish><Milestone>1</Milestone>
   <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  <Task><UID>4</UID><ID>4</ID><Name>Install</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-07T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish><PercentComplete>100</PercentComplete>
   <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>3</Type></PredecessorLink>
   <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
 </Tasks>
</Project>`

describe('parseMsProjectXml', () => {
  it('detects MSPDI', () => {
    expect(isMsProjectXml(MSPDI)).toBe(true)
    expect(isMsProjectXml('Task,Start')).toBe(false)
  })
  it('skips summaries, keeps outline names as category, maps link types and lag, never shifts dates', () => {
    const { plan, issues } = parseMsProjectXml(MSPDI)
    expect(plan.tasks.map((t) => [t.key, t.name, t.category, t.start, t.end, t.isMilestone, t.status, t.progress])).toEqual([
      ['uid:2', 'Detailed design', 'Design & approvals', '2026-10-01', '2026-10-05', false, 'in_progress', 40],
      ['uid:3', 'SSEG submitted', 'Design & approvals', '2026-10-06', '2026-10-06', true, 'not_started', 0],
      ['uid:4', 'Install', '', '2026-10-07', '2026-10-09', false, 'done', 100],
    ])
    expect(plan.tasks[0].description).toBe('Ω check')
    expect(plan.links).toEqual([
      { fromKey: 'uid:2', toKey: 'uid:3', type: 'FS', lagDays: 2 },
      { fromKey: 'uid:2', toKey: 'uid:4', type: 'SS', lagDays: 0 },
    ])
    expect(issues).toEqual([{ row: null, message: '"Install" depends on a summary task in Project; that link was left out.' }])
    expect(validateImportPlan(plan)).toEqual([])
  })
})
