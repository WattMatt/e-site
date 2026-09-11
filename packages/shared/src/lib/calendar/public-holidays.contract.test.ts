import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { listHolidaysNamed } from '../jbcc/sa-public-holidays'

/**
 * Appendix A(h): projects.public_holidays is a MATERIALISATION of
 * listHolidaysNamed(), not a second source. This parses the seeded rows back
 * out of the migration and asserts set equality, per seeded year.
 *
 * Fixture-quality check — what would this have to look like to be able to
 * fail? It reads the real SQL a human could have edited by hand, and compares
 * dates AND names, per year. Editing one row in the migration fails it naming
 * the date; adding a year to calendar_years without seeding its holidays
 * fails it naming the year.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

function calendarMigration(): { file: string; sql: string } {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .find((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes('INSERT INTO projects.public_holidays'))
  if (!file) throw new Error('No migration seeds projects.public_holidays')
  return { file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }
}

describe('projects.public_holidays is a materialisation of listHolidaysNamed', () => {
  const { file, sql } = calendarMigration()

  const seeded = [...sql.matchAll(/\(\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*'((?:[^']|'')*)'\s*\)/g)].map((m) => ({
    d: m[1],
    name: m[2].replace(/''/g, "'"),
  }))

  const years = [...new Set(seeded.map((r) => Number(r.d.slice(0, 4))))].sort()

  it(`${file} seeds at least ten years — the horizon is what stops working_days_between raising in production`, () => {
    expect(years.length).toBeGreaterThanOrEqual(10)
  })

  it(`${file} seeds at least five years beyond today`, () => {
    expect(Math.max(...years)).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 5)
  })

  for (const y of years) {
    it(`${y} matches listHolidaysNamed(${y}) exactly, dates and names`, () => {
      const expected = listHolidaysNamed(y)
        .map((h) => `${h.date.toISOString().slice(0, 10)}|${h.name}`)
        .sort()
      const actual = seeded
        .filter((r) => r.d.startsWith(String(y)))
        .map((r) => `${r.d}|${r.name}`)
        .sort()
      expect(actual).toEqual(expected)
    })
  }

  it('every seeded year is registered in calendar_years', () => {
    const m = sql.match(/INSERT INTO projects\.calendar_years[\s\S]*?generate_series\((\d{4}),\s*(\d{4})\)/)
    expect(m, 'calendar_years is not seeded by generate_series in this migration').not.toBeNull()
    const [lo, hi] = [Number(m![1]), Number(m![2])]
    expect(Math.min(...years)).toBe(lo)
    expect(Math.max(...years)).toBe(hi)
  })
})
