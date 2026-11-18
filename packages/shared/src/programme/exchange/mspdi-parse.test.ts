// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MSPDI_NAMESPACE,
  parseMspdi,
  parseMspdiText,
  type MspdiProgramme,
  type MspdiTask,
} from './mspdi-parse'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

function ok(result: ReturnType<typeof parseMspdi>): MspdiProgramme {
  if ('error' in result) throw new Error(`expected a programme, got: ${result.error}`)
  return result
}
function task(p: MspdiProgramme, uid: string): MspdiTask {
  const t = p.tasks.find((x) => x.uid === uid)
  if (!t) throw new Error(`task ${uid} not found`)
  return t
}
const doc = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
/** Minimal MSPDI wrapper for edge cases. */
const wrap = (inner: string, head = '<StartDate>2026-10-05T08:00:00</StartDate>', ns = ` xmlns="${MSPDI_NAMESPACE}"`) =>
  `<?xml version="1.0"?><Project${ns}>${head}${inner}</Project>`
const oneTask = (body: string) =>
  `<Tasks><Task><UID>1</UID><ID>1</ID><Name>A</Name><OutlineLevel>1</OutlineLevel>${body}</Task></Tasks>`

describe('parseMspdi — small.xml', () => {
  const p = ok(parseMspdiText(fixture('small.xml')))

  it('the fixture really starts with a UTF-8 BOM (and parseMspdiText strips it)', () => {
    expect(fixture('small.xml').charCodeAt(0)).toBe(0xfeff)
  })

  it('also parses from a DOM Document built by the caller', () => {
    const text = fixture('small.xml').replace(/^\uFEFF/, '')
    const direct = ok(parseMspdi(doc(text)))
    expect(direct.tasks.map((t) => t.uid)).toEqual(p.tasks.map((t) => t.uid))
  })

  it('project header: trimmed title, start date, units', () => {
    expect(p.name).toBe('Saxby Electrical Programme')
    expect(p.startDate).toBe('2026-10-05')
    expect(p.minutesPerDay).toBe(480)
    expect(p.daysPerWeek).toBe(6) // MinutesPerWeek 2880 / MinutesPerDay 480
    expect(p.daysPerMonth).toBe(26)
  })

  it('skips the project summary (UID 0), inactive and null tasks, and counts them', () => {
    expect(p.tasks.map((t) => t.uid)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '12', '13', '14'])
    expect(p.skipped).toEqual({ inactive: 1, nulls: 1 })
  })

  it('outline: level, WBS, outline number, summary flag', () => {
    expect(task(p, '1')).toMatchObject({ outlineLevel: 1, wbs: '1', outlineNumber: '1', summary: true })
    expect(task(p, '5')).toMatchObject({ outlineLevel: 2, wbs: '2.1', outlineNumber: '2.1', summary: true })
    expect(task(p, '6')).toMatchObject({ outlineLevel: 3, wbs: '2.1.1', outlineNumber: '2.1.1', summary: false })
    expect(task(p, '12')).toMatchObject({ wbs: null, outlineNumber: '4' })
  })

  it('names are trimmed', () => {
    expect(task(p, '6').name).toBe('Install MB-1')
  })

  it('durations: PT hours / MinutesPerDay, 2 dp', () => {
    expect(task(p, '2').durationDays).toBe(2)
    expect(task(p, '3').durationDays).toBe(3)
    expect(task(p, '6').durationDays).toBe(5)
    expect(task(p, '7').durationDays).toBe(2.5)
    expect(task(p, '8').durationDays).toBe(1.5)
    expect(task(p, '9').durationDays).toBe(0)
  })

  it('an elapsed duration is hours / 24 calendar days, used as working days, with a warning', () => {
    expect(task(p, '13').durationDays).toBe(3) // 72 h / 24
    expect(p.warnings).toContain('Task "Cure plinth" (UID 13): elapsed duration of 3 days imported as 3 working days.')
  })

  it('milestone: zero-duration milestone kept; a milestone flag with duration is ignored with a warning', () => {
    expect(task(p, '9').milestone).toBe(true)
    expect(task(p, '14').milestone).toBe(false)
    expect(task(p, '14').durationDays).toBe(1)
    expect(p.warnings.some((w) => w.includes('Handover') && /milestone/i.test(w))).toBe(true)
    expect(task(p, '2').milestone).toBe(false)
  })

  it('task dates: date part of Start / Finish', () => {
    expect(task(p, '2')).toMatchObject({ start: '2026-10-05', finish: '2026-10-06' })
    expect(task(p, '7')).toMatchObject({ start: null, finish: null })
  })

  it('constraints: ASAP → null, SNET and MFO with dates', () => {
    expect(task(p, '2').constraint).toBeNull()
    expect(task(p, '7').constraint).toBeNull() // absent
    expect(task(p, '3').constraint).toEqual({ type: 'snet', date: '2026-10-07' })
    expect(task(p, '9').constraint).toEqual({ type: 'mfo', date: '2026-11-20' })
  })

  it('deadline', () => {
    expect(task(p, '9').deadline).toBe('2026-11-25')
    expect(task(p, '2').deadline).toBeNull()
  })

  it('actuals and % complete', () => {
    expect(task(p, '2')).toMatchObject({ actualStart: '2026-10-05', actualFinish: '2026-10-06', percentComplete: 100 })
    expect(task(p, '3')).toMatchObject({ actualStart: '2026-10-07', actualFinish: null, percentComplete: 50 })
    expect(task(p, '7').percentComplete).toBe(0)
  })

  it('task calendar: -1 → null, otherwise the UID', () => {
    expect(task(p, '2').calendarUid).toBeNull()
    expect(task(p, '3').calendarUid).toBe('2')
    expect(task(p, '6').calendarUid).toBeNull()
  })

  it('baseline dates come from Baseline Number 0 only', () => {
    expect(task(p, '2')).toMatchObject({ baselineStart: '2026-10-05', baselineFinish: '2026-10-06' })
    expect(task(p, '6')).toMatchObject({ baselineStart: '2026-10-08', baselineFinish: '2026-10-12' })
    expect(task(p, '7')).toMatchObject({ baselineStart: null, baselineFinish: null })
  })

  it('link types: 0 FF, 1 FS, 2 SF, 3 SS', () => {
    expect(task(p, '3').predecessors).toEqual([{ uid: '2', type: 'FS', lag: 0, lagUnit: 'working_days' }])
    expect(task(p, '6').predecessors[0]).toMatchObject({ uid: '3', type: 'SS' })
    expect(task(p, '7').predecessors[0]).toMatchObject({ uid: '6', type: 'FF' })
    expect(task(p, '8').predecessors[0]).toMatchObject({ uid: '7', type: 'SF' })
  })

  it('lag: hours → working days (LinkLag is tenths of a minute)', () => {
    expect(task(p, '6').predecessors[0]).toMatchObject({ lag: 1, lagUnit: 'working_days' })
  })

  it('lag: elapsed days → elapsed_days', () => {
    expect(task(p, '7').predecessors[0]).toMatchObject({ lag: 2, lagUnit: 'elapsed_days' })
  })

  it('lag: percent → percent', () => {
    expect(task(p, '8').predecessors[0]).toMatchObject({ lag: 50, lagUnit: 'percent' })
  })

  it('lag: negative (lead) in days', () => {
    expect(task(p, '8').predecessors[1]).toEqual({ uid: '6', type: 'FS', lag: -1, lagUnit: 'working_days' })
  })

  it('lag: weeks use the file week, months use DaysPerMonth', () => {
    expect(task(p, '12').predecessors[0]).toMatchObject({ lag: 6, lagUnit: 'working_days' })
    expect(task(p, '13').predecessors[0]).toMatchObject({ lag: 26, lagUnit: 'working_days' })
  })

  it('a link from a skipped task is dropped with a warning', () => {
    expect(task(p, '14').predecessors).toEqual([{ uid: '13', type: 'FS', lag: 0, lagUnit: 'working_days' }])
    expect(p.warnings.some((w) => w.includes('Handover') && w.includes('10'))).toBe(true)
  })

  it('project calendar: the file CalendarUID, base calendars only', () => {
    expect(p.projectCalendarUid).toBe('1')
  })

  it('calendar 1: Sun=1 mapping to ISO weekdays, 2007+ exceptions (old copies ignored)', () => {
    const cal = p.calendars.find((c) => c.uid === '1')!
    expect(cal).toMatchObject({ name: 'Site 6-day', isBase: true, workWeekdays: [1, 2, 3, 4, 5, 6] })
    expect(cal.exceptions).toEqual([
      { from: '2026-12-16', to: '2027-01-04', working: false, name: 'Year-end shutdown' },
      { from: '2026-11-01', to: '2026-11-01', working: true, name: 'Sunday catch-up' },
    ])
  })

  it('calendar 2: pre-2007 DayType 0 exceptions', () => {
    const cal = p.calendars.find((c) => c.uid === '2')!
    expect(cal.workWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(cal.exceptions).toEqual([{ from: '2026-09-24', to: '2026-09-24', working: false, name: '' }])
  })

  it('calendar 3: resource calendar is listed as not base and inherits its base week', () => {
    const cal = p.calendars.find((c) => c.uid === '3')!
    expect(cal).toMatchObject({ isBase: false, workWeekdays: [1, 2, 3, 4, 5, 6] })
  })
})

describe('parseMspdi — defaults and edge cases', () => {
  it('defaults: MinutesPerDay 480, week 5 days, month 20 days', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Duration>PT12H0M0S</Duration>')))))
    expect(p.minutesPerDay).toBe(480)
    expect(p.daysPerWeek).toBe(5)
    expect(p.daysPerMonth).toBe(20)
    expect(p.tasks[0].durationDays).toBe(1.5)
  })

  it("uses the file's own MinutesPerDay", () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Duration>PT12H0M0S</Duration>'), '<StartDate>2026-10-05T08:00:00</StartDate><MinutesPerDay>600</MinutesPerDay>'))))
    expect(p.minutesPerDay).toBe(600)
    expect(p.tasks[0].durationDays).toBe(1.2)
  })

  it('rounds durations to 2 dp and reads minutes and seconds', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Duration>PT1H20M0S</Duration>')))))
    expect(p.tasks[0].durationDays).toBe(0.17) // 80 / 480 = 0.1666…
  })

  it('an unreadable duration becomes 0 with a warning', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Duration>forty hours</Duration>')))))
    expect(p.tasks[0].durationDays).toBe(0)
    expect(p.warnings.some((w) => /duration/i.test(w))).toBe(true)
  })

  it('estimated duration formats (+32) are read like their plain format', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Duration>PT48H0M0S</Duration><DurationFormat>40</DurationFormat>')))))
    expect(p.tasks[0].durationDays).toBe(2) // 40 = 8 (ed) + 32 → 48 h / 24
    expect(p.warnings.some((w) => /elapsed/i.test(w))).toBe(true)
  })

  it('every constraint code maps', () => {
    const codes: Array<[number, string | null]> = [
      [0, null], [1, 'alap'], [2, 'mso'], [3, 'mfo'], [4, 'snet'], [5, 'snlt'], [6, 'fnet'], [7, 'fnlt'],
    ]
    for (const [code, type] of codes) {
      const date = code >= 2 ? '<ConstraintDate>2026-10-09T08:00:00</ConstraintDate>' : ''
      const p = ok(parseMspdi(doc(wrap(oneTask(`<ConstraintType>${code}</ConstraintType>${date}`)))))
      if (type === null) expect(p.tasks[0].constraint).toBeNull()
      else expect(p.tasks[0].constraint).toEqual({ type, date: code >= 2 ? '2026-10-09' : null })
    }
  })

  it('every lag format maps to its unit', () => {
    const cases: Array<[number, number, number, string]> = [
      // [LagFormat, LinkLag, lag, unit]
      [3, 4800, 1, 'working_days'], // m
      [4, 14400, 1, 'elapsed_days'], // em
      [5, 4800, 1, 'working_days'], // h
      [6, 14400, 1, 'elapsed_days'], // eh
      [7, 4800, 1, 'working_days'], // d
      [8, 14400, 1, 'elapsed_days'], // ed
      [9, 24000, 5, 'working_days'], // w (default 2400 min week)
      [10, 100800, 7, 'elapsed_days'], // ew
      [11, 96000, 20, 'working_days'], // mo (default 20 days)
      [12, 432000, 30, 'elapsed_days'], // emo
      [19, 250, 25, 'percent'], // %
      [20, 250, 25, 'percent'], // e%
      [39, 4800, 1, 'working_days'], // d? (estimated)
    ]
    for (const [fmt, linkLag, lag, unit] of cases) {
      const xml = wrap(
        `<Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel></Task>` +
          `<Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><PredecessorLink><PredecessorUID>1</PredecessorUID>` +
          `<Type>1</Type><LinkLag>${linkLag}</LinkLag><LagFormat>${fmt}</LagFormat></PredecessorLink></Task></Tasks>`,
      )
      const p = ok(parseMspdi(doc(xml)))
      expect({ fmt, ...p.tasks[1].predecessors[0] }).toEqual({ fmt, uid: '1', type: 'FS', lag, lagUnit: unit })
    }
  })

  it('a link without Type is FS; an unknown LagFormat is working days with a warning', () => {
    const xml = wrap(
      `<Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel></Task>` +
        `<Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><PredecessorLink><PredecessorUID>1</PredecessorUID>` +
        `<LinkLag>4800</LinkLag><LagFormat>99</LagFormat></PredecessorLink></Task></Tasks>`,
    )
    const p = ok(parseMspdi(doc(xml)))
    expect(p.tasks[1].predecessors[0]).toEqual({ uid: '1', type: 'FS', lag: 1, lagUnit: 'working_days' })
    expect(p.warnings.some((w) => /lag format/i.test(w))).toBe(true)
  })

  it('a link to a UID not in the file is dropped with a warning', () => {
    const xml = wrap(oneTask('<PredecessorLink><PredecessorUID>42</PredecessorUID><Type>1</Type></PredecessorLink>'))
    const p = ok(parseMspdi(doc(xml)))
    expect(p.tasks[0].predecessors).toEqual([])
    expect(p.warnings.some((w) => w.includes('42'))).toBe(true)
  })

  it('a Project element without a namespace is accepted with a warning', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask(''), undefined, ''))))
    expect(p.tasks).toHaveLength(1)
    expect(p.warnings.some((w) => /namespace/i.test(w))).toBe(true)
  })

  it('a missing StartDate falls back to the earliest task start, with a warning', () => {
    const xml = wrap(
      `<Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Start>2026-11-02T08:00:00</Start></Task>` +
        `<Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-12T08:00:00</Start></Task></Tasks>`,
      '',
    )
    const p = ok(parseMspdi(doc(xml)))
    expect(p.startDate).toBe('2026-10-12')
    expect(p.warnings.some((w) => /start date/i.test(w))).toBe(true)
  })

  it('a project CalendarUID naming a resource calendar falls back to the first base calendar', () => {
    const cals =
      '<Calendars><Calendar><UID>5</UID><Name>Res</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>6</BaseCalendarUID></Calendar>' +
      '<Calendar><UID>6</UID><Name>Std</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar></Calendars>'
    const p = ok(parseMspdi(doc(wrap(cals + oneTask(''), '<StartDate>2026-10-05T08:00:00</StartDate><CalendarUID>5</CalendarUID>'))))
    expect(p.projectCalendarUid).toBe('6')
    expect(p.warnings.some((w) => /calendar/i.test(w))).toBe(true)
  })

  it('no calendars at all → projectCalendarUid null; a base calendar without WeekDays works Mon–Fri', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('')))))
    expect(p.projectCalendarUid).toBeNull()
    const q = ok(parseMspdi(doc(wrap('<Calendars><Calendar><UID>1</UID><Name>X</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar></Calendars>' + oneTask(''), '<StartDate>2026-10-05T08:00:00</StartDate><CalendarUID>1</CalendarUID>'))))
    expect(q.calendars[0].workWeekdays).toEqual([1, 2, 3, 4, 5])
    expect(q.projectCalendarUid).toBe('1')
  })

  it('a yearly exception without Month/MonthDay takes them from its FromDate', () => {
    const cals =
      '<Calendars><Calendar><UID>1</UID><Name>X</Name><IsBaseCalendar>1</IsBaseCalendar><Exceptions><Exception>' +
      '<TimePeriod><FromDate>2026-01-01T00:00:00</FromDate><ToDate>2030-12-31T23:59:00</ToDate></TimePeriod>' +
      '<Name>New Year</Name><Type>2</Type><DayWorking>0</DayWorking></Exception></Exceptions></Calendar></Calendars>'
    const p = ok(parseMspdi(doc(wrap(cals + oneTask('')))))
    expect(p.calendars[0].exceptions.map((e) => e.from)).toEqual(['2026-01-01', '2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01'])
    expect(p.warnings.some((w) => w.includes('New Year'))).toBe(false)
  })
})

describe('parseMspdi — fix round 1', () => {
  const tasks2 = (a: string, b: string) =>
    `<Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel>${a}</Task>` +
    `<Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel>${b}</Task></Tasks>`

  // ---------------------------------------------------------------- I-4 booleans
  it('booleans accept true/false in any case', () => {
    const cals =
      '<Calendars><Calendar><UID>1</UID><Name>C</Name><IsBaseCalendar>True</IsBaseCalendar><WeekDays>' +
      '<WeekDay><DayType>2</DayType><DayWorking>FALSE</DayWorking></WeekDay>' +
      '<WeekDay><DayType>7</DayType><DayWorking>true</DayWorking></WeekDay></WeekDays></Calendar></Calendars>'
    const xml = wrap(
      cals +
        '<Tasks>' +
        '<Task><UID>1</UID><Name>S</Name><OutlineLevel>1</OutlineLevel><Summary>true</Summary></Task>' +
        '<Task><UID>2</UID><Name>M</Name><OutlineLevel>2</OutlineLevel><Milestone>TRUE</Milestone><Duration>PT0H0M0S</Duration>' +
        '<PredecessorLink><PredecessorUID>3</PredecessorUID><CrossProject>true</CrossProject></PredecessorLink></Task>' +
        '<Task><UID>3</UID><Name>Gone</Name><OutlineLevel>2</OutlineLevel><Active>False</Active></Task>' +
        '<Task><UID>4</UID><IsNull>true</IsNull></Task>' +
        '<Task><UID>5</UID><Name>Kept</Name><OutlineLevel>2</OutlineLevel><Active>true</Active><IsNull>false</IsNull><Summary>0</Summary></Task>' +
        '</Tasks>',
      '<StartDate>2026-10-05T08:00:00</StartDate><CalendarUID>1</CalendarUID>',
    )
    const p = ok(parseMspdi(doc(xml)))
    expect(p.tasks.map((t) => t.uid)).toEqual(['1', '2', '5'])
    expect(p.skipped).toEqual({ inactive: 1, nulls: 1 })
    expect(task(p, '1').summary).toBe(true)
    expect(task(p, '2').milestone).toBe(true)
    expect(task(p, '2').predecessors).toEqual([])
    expect(p.warnings.some((w) => /another project/.test(w))).toBe(true)
    expect(p.calendars[0]).toMatchObject({ isBase: true, workWeekdays: [2, 3, 4, 5, 6] })
    expect(p.projectCalendarUid).toBe('1')
  })

  // ---------------------------------------------------------------- I-3 manual
  it('a manually scheduled task is pinned with MSO at its Start, with a warning', () => {
    const xml = wrap(
      '<Tasks><Task><UID>20</UID><Name>Long-lead switchgear</Name><OutlineLevel>1</OutlineLevel><Manual>1</Manual>' +
        '<Start>2027-02-01T08:00:00</Start><Duration>PT0H0M0S</Duration><ConstraintType>0</ConstraintType></Task>' +
        '<Task><UID>21</UID><Name>Auto</Name><OutlineLevel>1</OutlineLevel><Manual>0</Manual><Start>2027-02-01T08:00:00</Start></Task></Tasks>',
    )
    const p = ok(parseMspdi(doc(xml)))
    expect(task(p, '20')).toMatchObject({ manual: true, constraint: { type: 'mso', date: '2027-02-01' } })
    expect(task(p, '21')).toMatchObject({ manual: false, constraint: null })
    expect(p.warnings).toContain(
      'Task "Long-lead switchgear" (UID 20) is manually scheduled in MS Project; it is pinned to start on 2027-02-01.',
    )
  })

  it('a manual task without a start is not pinned and is warned about', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<Manual>true</Manual>')))))
    expect(p.tasks[0]).toMatchObject({ manual: true, constraint: null })
    expect(p.warnings.some((w) => /manually scheduled/.test(w) && /no start/.test(w))).toBe(true)
  })

  // ---------------------------------------------------------------- I-2 recurring exceptions
  const exceptionXml = (body: string, name = 'Holiday', working = 0) =>
    '<Calendars><Calendar><UID>1</UID><Name>Cal</Name><IsBaseCalendar>1</IsBaseCalendar><Exceptions><Exception>' +
    `${body}<Name>${name}</Name><DayWorking>${working}</DayWorking></Exception></Exceptions></Calendar></Calendars>`
  const period = (from: string, to?: string) =>
    `<TimePeriod><FromDate>${from}T00:00:00</FromDate>${to ? `<ToDate>${to}T23:59:00</ToDate>` : ''}</TimePeriod>`
  /** Dates of the expanded exception; the project starts 2026-10-05, so the window is 2025-10-05 … 2031-10-05. */
  const datesOf = (body: string, working = 0) => {
    const p = ok(parseMspdi(doc(wrap(exceptionXml(body, 'Holiday', working) + oneTask('')))))
    const ex = p.calendars[0].exceptions
    for (const e of ex) expect(e.from).toBe(e.to)
    return { dates: ex.map((e) => e.from), ex, warnings: p.warnings }
  }

  it('yearly by date (Type 2) with an end date', () => {
    const { dates, ex } = datesOf(
      `<EnteredByOccurrences>0</EnteredByOccurrences>${period('2026-04-27', '2030-04-27')}<Occurrences>5</Occurrences>` +
        '<Type>2</Type><Month>3</Month><MonthDay>27</MonthDay>',
    )
    expect(dates).toEqual(['2026-04-27', '2027-04-27', '2028-04-27', '2029-04-27', '2030-04-27'])
    expect(ex[0]).toEqual({ from: '2026-04-27', to: '2026-04-27', working: false, name: 'Holiday' })
  })

  it('yearly by date is clipped to start − 1 year … start + 5 years', () => {
    const { dates } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2020-12-25', '2039-12-25')}<Occurrences>20</Occurrences>` +
        '<Type>2</Type><Month>11</Month><MonthDay>25</MonthDay>',
    )
    expect(dates).toEqual(['2025-12-25', '2026-12-25', '2027-12-25', '2028-12-25', '2029-12-25', '2030-12-25'])
  })

  it('yearly by position (Type 3): first Monday of August, by occurrences', () => {
    const { dates } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2027-01-01')}<Occurrences>2</Occurrences>` +
        '<Type>3</Type><Month>7</Month><MonthPosition>0</MonthPosition><MonthItem>4</MonthItem>',
    )
    expect(dates).toEqual(['2027-08-02', '2028-08-07'])
  })

  it('monthly by day (Type 4) every 2 months', () => {
    const { dates } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2026-11-01')}<Occurrences>3</Occurrences>` +
        '<Type>4</Type><Period>2</Period><MonthDay>15</MonthDay>',
    )
    expect(dates).toEqual(['2026-11-15', '2027-01-15', '2027-03-15'])
  })

  it('monthly by position (Type 5): last Friday', () => {
    const { dates } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2026-10-01')}<Occurrences>3</Occurrences>` +
        '<Type>5</Type><Period>1</Period><MonthPosition>4</MonthPosition><MonthItem>8</MonthItem>',
    )
    expect(dates).toEqual(['2026-10-30', '2026-11-27', '2026-12-25'])
  })

  it('weekly (Type 6): every second Saturday, as working days', () => {
    const { dates, ex } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2026-10-03')}<Occurrences>3</Occurrences>` +
        '<Type>6</Type><Period>2</Period><DaysOfWeek>64</DaysOfWeek>',
      1,
    )
    expect(dates).toEqual(['2026-10-03', '2026-10-17', '2026-10-31'])
    expect(ex.every((e) => e.working)).toBe(true)
  })

  it('daily (Type 1) every second day, by occurrences', () => {
    const { dates } = datesOf(
      `<EnteredByOccurrences>1</EnteredByOccurrences>${period('2026-10-05')}<Occurrences>3</Occurrences>` +
        '<Type>1</Type><Period>2</Period>',
    )
    expect(dates).toEqual(['2026-10-05', '2026-10-07', '2026-10-09'])
  })

  it('a recurrence that cannot be read is refused with a warning', () => {
    for (const body of [
      `${period('2026-01-01', '2027-01-01')}<Type>9</Type>`,
      `${period('2026-01-01', '2027-01-01')}<Type>5</Type><MonthPosition>0</MonthPosition><MonthItem>1</MonthItem>`,
      `${period('2026-01-01', '2027-01-01')}<Type>6</Type><DaysOfWeek>0</DaysOfWeek>`,
    ]) {
      const p = ok(parseMspdi(doc(wrap(exceptionXml(body, 'Odd') + oneTask('')))))
      expect(p.calendars[0].exceptions).toEqual([])
      expect(p.warnings.some((w) => w.includes('"Odd"'))).toBe(true)
    }
  })

  // ---------------------------------------------------------------- minors
  it('M-2: a dated constraint without a date is dropped with a warning', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<ConstraintType>2</ConstraintType>')))))
    expect(p.tasks[0].constraint).toBeNull()
    expect(p.warnings.some((w) => /constraint/i.test(w) && /no date/.test(w))).toBe(true)
  })

  it('M-3: a finish-type date at exactly 00:00 is the end of the previous day', () => {
    const p = ok(
      parseMspdi(
        doc(
          wrap(
            oneTask(
              '<Start>2026-10-12T00:00:00</Start><Finish>2026-10-17T00:00:00</Finish><ActualFinish>2026-10-17T00:00:00</ActualFinish>' +
                '<Deadline>2026-11-01T00:00:00</Deadline><ConstraintType>3</ConstraintType><ConstraintDate>2026-11-01T00:00:00</ConstraintDate>' +
                '<Baseline><Number>0</Number><Start>2026-10-12T00:00:00</Start><Finish>2026-10-17T00:00:00</Finish></Baseline>',
            ),
          ),
        ),
      ),
    )
    expect(p.tasks[0]).toMatchObject({
      start: '2026-10-12',
      finish: '2026-10-16',
      actualFinish: '2026-10-16',
      deadline: '2026-10-31',
      constraint: { type: 'mfo', date: '2026-10-31' },
      baselineStart: '2026-10-12',
      baselineFinish: '2026-10-16',
    })
    const q = ok(parseMspdi(doc(wrap(oneTask('<Finish>2026-10-17T08:00:00</Finish><ConstraintType>2</ConstraintType><ConstraintDate>2026-10-12T00:00:00</ConstraintDate>')))))
    expect(q.tasks[0].finish).toBe('2026-10-17')
    expect(q.tasks[0].constraint).toEqual({ type: 'mso', date: '2026-10-12' }) // start-type: unchanged
  })

  it('M-4: an external task is skipped with a warning, and links from it are dropped', () => {
    const p = ok(parseMspdi(doc(wrap(tasks2('<ExternalTask>1</ExternalTask>', '<PredecessorLink><PredecessorUID>1</PredecessorUID></PredecessorLink>')))))
    expect(p.tasks.map((t) => t.uid)).toEqual(['2'])
    expect(p.tasks[0].predecessors).toEqual([])
    expect(p.warnings.some((w) => /external/i.test(w) && w.includes('UID 1'))).toBe(true)
  })

  it('M-6: a task calendar that is not in the file becomes null with a warning', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('<CalendarUID>99</CalendarUID>')))))
    expect(p.tasks[0].calendarUid).toBeNull()
    expect(p.warnings.some((w) => w.includes('99') && /calendar/i.test(w))).toBe(true)
  })

  it('M-1: an active task under an inactive summary is kept with a warning', () => {
    const xml = wrap(
      '<Tasks><Task><UID>1</UID><Name>Old phase</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Active>0</Active></Task>' +
        '<Task><UID>2</UID><Name>Orphan</Name><OutlineLevel>2</OutlineLevel></Task>' +
        '<Task><UID>3</UID><Name>Next</Name><OutlineLevel>1</OutlineLevel></Task></Tasks>',
    )
    const p = ok(parseMspdi(doc(xml)))
    expect(p.tasks.map((t) => t.uid)).toEqual(['2', '3'])
    expect(p.warnings.filter((w) => /inactive summary/.test(w))).toHaveLength(1)
    expect(p.warnings.some((w) => w.includes('Orphan') && /inactive summary/.test(w))).toBe(true)
  })

  it('M-7: unknown link type, missing PredecessorUID, calendar base cycle, MinutesPerDay 0', () => {
    const p = ok(
      parseMspdi(
        doc(
          wrap(
            tasks2('', '<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>7</Type></PredecessorLink><PredecessorLink><Type>1</Type></PredecessorLink>'),
          ),
        ),
      ),
    )
    expect(task(p, '2').predecessors).toEqual([{ uid: '1', type: 'FS', lag: 0, lagUnit: 'working_days' }])
    expect(p.warnings.some((w) => /link type 7/.test(w))).toBe(true)
    expect(p.warnings.some((w) => /without a predecessor UID/.test(w))).toBe(true)

    const cyc =
      '<Calendars><Calendar><UID>1</UID><Name>A</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>2</BaseCalendarUID>' +
      '<WeekDays><WeekDay><DayType>7</DayType><DayWorking>1</DayWorking></WeekDay></WeekDays></Calendar>' +
      '<Calendar><UID>2</UID><Name>B</Name><IsBaseCalendar>0</IsBaseCalendar><BaseCalendarUID>1</BaseCalendarUID></Calendar></Calendars>'
    const c = ok(parseMspdi(doc(wrap(cyc + oneTask('')))))
    expect(c.calendars.find((x) => x.uid === '1')!.workWeekdays).toEqual([1, 2, 3, 4, 5, 6])

    const z = ok(parseMspdi(doc(wrap(oneTask('<Duration>PT8H0M0S</Duration>'), '<StartDate>2026-10-05T08:00:00</StartDate><MinutesPerDay>0</MinutesPerDay>'))))
    expect(z.minutesPerDay).toBe(480)
    expect(z.tasks[0].durationDays).toBe(1)
    expect(z.warnings.some((w) => /MinutesPerDay/.test(w))).toBe(true)
  })
})

describe('parseMspdi — errors', () => {
  const err = (name: string) => {
    const r = parseMspdiText(fixture(name))
    if (!('error' in r)) throw new Error('expected an error')
    return r.error
  }

  it('not well-formed XML', () => {
    expect(err('bad-not-xml.xml')).toMatch(/File → Save As → XML Format/)
  })
  it('wrong root element', () => {
    expect(err('bad-wrong-root.xml')).toMatch(/File → Save As → XML Format/)
  })
  it('wrong namespace', () => {
    expect(err('bad-wrong-namespace.xml')).toMatch(/File → Save As → XML Format/)
  })
  it('binary (an .mpp read as text)', () => {
    const r = parseMspdiText('ÐÏ\u0011à¡±\u001aá\u0000\u0000')
    expect('error' in r && r.error).toMatch(/File → Save As → XML Format/)
  })
  it('no tasks after skipping the summary and null rows', () => {
    expect(err('bad-no-tasks.xml')).toMatch(/no tasks/i)
  })
  it('a duplicate UID names the UID', () => {
    expect(err('bad-duplicate-uid.xml')).toMatch(/UID 7/)
  })
})

describe('parseMspdi — StatusDate', () => {
  const at = (status: string | null) => {
    const head = `<StartDate>2026-10-05T08:00:00</StartDate>${status === null ? '' : `<StatusDate>${status}</StatusDate>`}`
    return ok(parseMspdi(doc(wrap(oneTask('<Duration>PT8H0M0S</Duration>'), head)))).statusDate
  }
  it('is null when the file has none', () => expect(at(null)).toBeNull())
  it('an end-of-day status date (afternoon) means remaining work starts the next day', () => {
    expect(at('2026-10-07T17:00:00')).toBe('2026-10-08')
  })
  it('a start-of-day status date (morning or midnight) means remaining work starts that day', () => {
    expect(at('2026-10-07T08:00:00')).toBe('2026-10-07')
    expect(at('2026-10-07T00:00:00')).toBe('2026-10-07')
  })
  it('an unreadable status date is ignored', () => expect(at('NA')).toBeNull())
})
