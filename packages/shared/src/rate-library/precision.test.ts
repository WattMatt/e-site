import { describe, expect, it } from 'vitest'
import sample from './__fixtures__/labelled-sample.json'
import { matchLine } from './match'

interface Row { split: 'both' | 'supply_only' | 'install_only'; set: 'tuning' | 'holdout'; heading: string; description: string; unit: string | null; expected: string | null; firstPassCorrect: boolean }
const rows = sample.rows as Row[]

/** What the matcher auto-confirms for a row: a signature, or null if it would not. */
function predict(r: Row): string | null {
  const out = matchLine({ sectionPath: [r.heading], description: r.description, unit: r.unit,
    supplyRate: r.split === 'install_only' ? null : 10, installRate: r.split === 'supply_only' ? null : 5 })
  return out.kind === 'match' ? out.signature : null
}

describe('matcher precision on the labelled sample', () => {
  it('the recorded first-pass numbers match the labels', () => {
    for (const set of ['tuning', 'holdout'] as const) {
      const s = rows.filter(r => r.set === set)
      const m = sample._measured[set]
      expect(s.length).toBe(m.n)
      expect(s.filter(r => r.firstPassCorrect).length).toBe(m.correct)
    }
  })

  it('every labelled row now matches its label (regression)', () => {
    const wrong = rows.filter(r => predict(r) !== r.expected)
      .map(r => `${r.heading} | ${r.description} | ${r.unit} → got ${predict(r)}, want ${r.expected}`)
    expect(wrong).toEqual([])
  })
})
