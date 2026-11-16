import { describe, expect, it } from 'vitest'
import { scheduleProgramme } from './schedule'
import { randomProgramme } from './test-utils/random-programme'

const BUDGET_MS = 200
const RUNS = 5

describe('performance budget', () => {
  it(`schedules 5,000 activities / 10,000 links with a median of ${RUNS} runs under ${BUDGET_MS} ms`, () => {
    const input = randomProgramme(1, { activities: 5000, links: 10000, allowConstraints: false })
    expect(input.activities).toHaveLength(5000)
    expect(input.dependencies).toHaveLength(10000)

    const times: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      const r = scheduleProgramme(input)
      times.push(performance.now() - t0)
      expect(r.ok).toBe(true)
      expect(r.activities.size).toBe(5000)
    }
    const median = [...times].sort((a, b) => a - b)[Math.floor(RUNS / 2)]
    expect(median, `median ${median.toFixed(1)} ms of [${times.map(t => t.toFixed(1)).join(', ')}]`).toBeLessThan(BUDGET_MS)
  })
})
