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

  it('an elapsed duration is converted the same way, with a warning', () => {
    expect(task(p, '13').durationDays).toBe(9) // 72 h × 60 / 480
    expect(p.warnings.some((w) => w.includes('Cure plinth') && /elapsed/i.test(w))).toBe(true)
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
    expect(p.tasks[0].durationDays).toBe(6)
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

  it('a recurring (non-daily) exception is not imported and is warned about', () => {
    const cals =
      '<Calendars><Calendar><UID>1</UID><Name>X</Name><IsBaseCalendar>1</IsBaseCalendar><Exceptions><Exception>' +
      '<TimePeriod><FromDate>2026-01-01T00:00:00</FromDate><ToDate>2030-12-31T23:59:00</ToDate></TimePeriod>' +
      '<Name>New Year</Name><Type>2</Type><DayWorking>0</DayWorking></Exception></Exceptions></Calendar></Calendars>'
    const p = ok(parseMspdi(doc(wrap(cals + oneTask('')))))
    expect(p.calendars[0].exceptions).toEqual([])
    expect(p.warnings.some((w) => w.includes('New Year'))).toBe(true)
  })

  it('nothing from the file is interpreted as markup', () => {
    const p = ok(parseMspdi(doc(wrap(oneTask('').replace('<Name>A</Name>', '<Name>&lt;b&gt;bold&lt;/b&gt;</Name>')))))
    expect(p.tasks[0].name).toBe('<b>bold</b>')
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
