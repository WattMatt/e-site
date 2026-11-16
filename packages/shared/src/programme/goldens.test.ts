import { describe, expect, it } from 'vitest'
import { loadGoldenFixtures, type GoldenFixture } from './goldens/fixture'
import { scheduleProgramme } from './schedule'

const fixtures = loadGoldenFixtures()

describe('golden fixtures', () => {
  it('finds the hand fixtures', () => {
    expect(fixtures.map(f => f.file)).toEqual(expect.arrayContaining(['hand-progress-retained.json', 'hand-textbook-cpm.json']))
  })

  for (const { file, fixture: fx } of fixtures) {
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
})
