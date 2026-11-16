import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scheduleProgramme } from './schedule'
import type { CalendarDate, ProgrammeInput } from './types'

/** The golden fixture format (P4 reuses it for real MS Project and P6 files). See goldens/README.md. */
interface GoldenFixture {
  name: string
  source: 'hand' | 'msp' | 'p6'
  notes: string
  input: ProgrammeInput
  expected: Record<string, { es: CalendarDate; ef: CalendarDate; ls: CalendarDate; lf: CalendarDate; tf: number }>
}

const dir = join(__dirname, 'goldens')
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()

describe('golden fixtures', () => {
  it('finds the hand fixtures', () => {
    expect(files).toEqual(expect.arrayContaining(['hand-progress-retained.json', 'hand-textbook-cpm.json']))
  })

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture | GoldenFixture[]
    for (const fx of Array.isArray(raw) ? raw : [raw]) {
      it(`${file}: ${fx.name}`, () => {
        const r = scheduleProgramme(fx.input)
        expect(r.ok).toBe(true)
        const actual: GoldenFixture['expected'] = {}
        for (const id of Object.keys(fx.expected)) {
          const a = r.activities.get(id)
          expect(a, `activity ${id}`).toBeDefined()
          actual[id] = { es: a!.earlyStart, ef: a!.earlyFinish, ls: a!.lateStart, lf: a!.lateFinish, tf: a!.totalFloat }
        }
        expect(actual).toEqual(fx.expected)
      })
    }
  }
})
