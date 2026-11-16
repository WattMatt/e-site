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

/**
 * Fixtures whose hand working the engine does not yet reproduce, by `${file}: ${name}`. Each runs as `it.fails`:
 * it stays visible, and it turns red the moment the engine is fixed, so the entry must then be removed. The
 * expected values are NEVER edited to match the engine.
 */
const KNOWN_ENGINE_DEFECTS: Record<string, string> = {
  'hand-progress-retained.json: Out of sequence (Task 6), retained logic':
    'backwardPass limits an FS predecessor by the in-progress successor\'s late start, which is pinned to its actual '
    + 'start in the past (03-03): A gets lf 03-02, tf −9 instead of lf 03-13, tf 0 (README).',
  'hand-progress-retained.json: Out of sequence (Task 6), progress override':
    'same cause: A gets lf 03-02, tf −9; under progress override the A→B link should not constrain A at all (README).',
}

const dir = join(__dirname, 'goldens')
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()

describe('golden fixtures', () => {
  it('finds the hand fixtures', () => {
    expect(files).toEqual(expect.arrayContaining(['hand-progress-retained.json', 'hand-textbook-cpm.json']))
  })

  it('every known engine defect names a fixture that exists', () => {
    const titles = files.flatMap(file => {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture | GoldenFixture[]
      return (Array.isArray(raw) ? raw : [raw]).map(fx => `${file}: ${fx.name}`)
    })
    expect(titles).toEqual(expect.arrayContaining(Object.keys(KNOWN_ENGINE_DEFECTS)))
  })

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture | GoldenFixture[]
    for (const fx of Array.isArray(raw) ? raw : [raw]) {
      const title = `${file}: ${fx.name}`
      const test = title in KNOWN_ENGINE_DEFECTS ? it.fails : it
      test(title, () => {
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
