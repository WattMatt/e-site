// @vitest-environment node
/**
 * The TOU hours the Tariff tab shows must be the hours a case run prices. Two calendar queries
 * drifted once: the case run read only the pinned licensee's calendar (any row overlapping the
 * reference year) while the tab fell back to Eskom's flagged assumed_eskom — so the tab showed
 * hours the run then refused. This reads the SOURCE of every Solar lib and refuses any but
 * calendar-loader.ts that queries the calendar tables, and pins each entry point to the loader.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOLAR = join(__dirname, '..')
const LOADER = 'tariff/calendar-loader.ts'
const ENTRY_POINTS = ['cases/tariff.ts', 'tariff/effective-tariff.ts', 'tariff/load-tariff-tab.ts']
const CALENDAR_TABLES = ["from('tou_calendar')", "from('tou_window')", "from('holiday_rule')"]

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : []
  })
}

describe('the TOU calendar has one source', () => {
  it('only calendar-loader.ts queries the calendar tables', () => {
    const offenders = files(SOLAR)
      .map((p) => relative(SOLAR, p))
      .filter((f) => f !== LOADER && CALENDAR_TABLES.some((t) => strip(readFileSync(join(SOLAR, f), 'utf8')).includes(t)))
    expect(offenders).toEqual([])
  })
  for (const f of ENTRY_POINTS) {
    it(`${f} resolves the calendar through loadStudyCalendar`, () => {
      expect(strip(readFileSync(join(SOLAR, f), 'utf8'))).toMatch(/loadStudyCalendar\(/)
    })
  }
})
