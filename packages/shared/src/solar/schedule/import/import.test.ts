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
  it('maps synonyms, including the # column predecessors refer to', () => {
    const m = guessImportMapping(rows[0])
    expect(m).toMatchObject({ id: 0, name: 1, category: 2, zone: 3, start: 4, end: 5, duration: 6, owner: 7, progress: 8, status: 9, milestone: 10, predecessors: 11, notes: 12, colour: 13 })
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

describe('predecessors resolve against the # column, not row position', () => {
  const header = ['#', 'Task', 'Start', 'End', 'Predecessors']
  const exported = [
    header,
    ['1', 'Survey', '2026-10-01', '2026-10-02', ''],
    ['2', 'Design', '2026-10-05', '2026-10-09', '1FS'],
    ['3', 'Unrelated', '2026-10-01', '2026-10-01', ''],
    ['4', 'Install', '2026-10-12', '2026-10-16', '2FS+2d'],
  ]
  const linksByName = (rows: string[][]) => {
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    const name = new Map(plan.tasks.map((t) => [t.key, t.name]))
    return plan.links.map((l) => [name.get(l.fromKey), name.get(l.toKey), l.type, l.lagDays])
  }
  it('sorting rows and deleting an unrelated one in Excel does not re-point any link', () => {
    const before = linksByName(exported)
    expect(before).toEqual([['Survey', 'Design', 'FS', 0], ['Design', 'Install', 'FS', 2]])
    // Install moved to the top, Survey and Design swapped, "Unrelated" deleted.
    const edited = [header, exported[4], exported[2], exported[1]]
    expect(linksByName(edited)).toEqual(expect.arrayContaining(before))
    expect(linksByName(edited)).toHaveLength(2)
  })
  it('a # used twice is an issue, and a link to it is not guessed', () => {
    const dup = [header, ['1', 'A', '2026-10-01', '2026-10-01', ''], ['1', 'B', '2026-10-02', '2026-10-02', ''], ['2', 'C', '2026-10-03', '2026-10-03', '1']]
    const { plan, issues } = mapImportTable(dup, guessImportMapping(dup[0]), cal)
    expect(issues).toEqual([
      { row: 3, message: 'Row 3: # 1 is also used on row 2. Give every row its own number.' },
      { row: 4, message: 'Row 4: predecessor 1 is used by more than one row, so the link cannot be placed.' },
    ])
    expect(plan.links).toEqual([])
  })
  it('only "#", "Task ID" or "Task No" is auto-mapped as the id column; a generic ID/No/Row column is not', () => {
    for (const h of ['#', 'Task ID', 'task id', 'TASK NO', 'Task No.']) expect(guessImportMapping([h, 'Task']).id).toBe(0)
    for (const h of ['ID', 'id', 'No', 'No.', 'Row']) expect(guessImportMapping([h, 'Task']).id).toBeNull()
  })
  it('a generic "ID" text column does not break row-position predecessors', () => {
    const rows = [['ID', 'Task', 'Start', 'End', 'Predecessors'],
      ['INV-A', 'Survey', '2026-10-01', '2026-10-02', ''],
      ['INV-B', 'Design', '2026-10-05', '2026-10-09', '1FS']]
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    expect(plan.links).toEqual([{ fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 }])
  })
  it('the id column can still be mapped by hand', () => {
    const rows = [['ID', 'Task', 'Start', 'End', 'Predecessors'],
      ['7', 'Survey', '2026-10-01', '2026-10-02', ''],
      ['9', 'Design', '2026-10-05', '2026-10-09', '7FS']]
    const { plan, issues } = mapImportTable(rows, { ...guessImportMapping(rows[0]), id: 0 }, cal)
    expect(issues).toEqual([])
    expect(plan.links).toEqual([{ fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 }])
  })
  it('"03" and "3" are the same number (a zero-padded # column still links)', () => {
    const rows = [header, ['01', 'Survey', '2026-10-01', '2026-10-02', ''], ['03', 'Design', '2026-10-05', '2026-10-09', '1FS'],
      ['4.0', 'Install', '2026-10-12', '2026-10-16', '3FS']]
    expect(linksByName(rows)).toEqual([['Survey', 'Design', 'FS', 0], ['Design', 'Install', 'FS', 0]])
    const dup = [header, ['3', 'A', '2026-10-01', '2026-10-01', ''], ['03', 'B', '2026-10-02', '2026-10-02', '']]
    expect(mapImportTable(dup, guessImportMapping(dup[0]), cal).issues)
      .toEqual([{ row: 3, message: 'Row 3: # 3 is also used on row 2. Give every row its own number.' }])
  })
  it('an unknown # is reported', () => {
    const bad = [header, ['5', 'A', '2026-10-01', '2026-10-01', ''], ['6', 'B', '2026-10-02', '2026-10-02', '1']]
    expect(mapImportTable(bad, guessImportMapping(bad[0]), cal).issues)
      .toEqual([{ row: 3, message: 'Row 3: predecessor 1 is not a task in this file.' }])
  })
  it('with no # column, predecessors fall back to row position', () => {
    const noId = exported.map((r) => r.slice(1))
    expect(linksByName(noId)).toEqual([['Survey', 'Design', 'FS', 0], ['Design', 'Install', 'FS', 2]])
  })
})

describe('validateImportPlan — lag range', () => {
  const t = (key: string, name: string) => ({ key, sourceRow: null, name, category: '', zone: '', start: '2026-10-01', end: '2026-10-02', isMilestone: false, progress: 0, status: 'not_started' as const, colour: null, ownerHint: null, description: '', segments: [] })
  it('a lag outside ±365 days (the database CHECK) is a sentence, and ±365 is fine', () => {
    const plan = (lagDays: number) => ({ tasks: [t('a', 'Design'), t('b', 'Install')], links: [{ fromKey: 'a', toKey: 'b', type: 'FS' as const, lagDays }] })
    expect(validateImportPlan(plan(400))).toEqual([{ row: null, message: 'The link from "Design" to "Install" has a lag of 400 days; a lag must be between -365 and 365 days.' }])
    expect(validateImportPlan(plan(-366))).toHaveLength(1)
    expect(validateImportPlan(plan(365))).toEqual([])
    expect(validateImportPlan(plan(-365))).toEqual([])
  })
})
