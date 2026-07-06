import { describe, it, expect } from 'vitest'
import { groupRunsBySectionConductor } from './export-util'
import type { ExportPayload } from './export-payload'

const run = (section: string | null, conductor: 'CU' | 'AL', id: string) =>
  ({ supply_id: id, section, conductor }) as unknown as ExportPayload['runs'][number]

describe('groupRunsBySectionConductor', () => {
  it('orders NORMAL before EMERGENCY before null, CU before AL', () => {
    const groups = groupRunsBySectionConductor([
      run(null, 'AL', 'e'),
      run('EMERGENCY', 'CU', 'c'),
      run('NORMAL', 'AL', 'b'),
      run('NORMAL', 'CU', 'a'),
      run('EMERGENCY', 'AL', 'd'),
    ])
    expect(groups.map((g) => `${g.section ?? '-'}|${g.conductor}`)).toEqual([
      'NORMAL|CU', 'NORMAL|AL', 'EMERGENCY|CU', 'EMERGENCY|AL', '-|AL',
    ])
  })
  it('keeps runs together within their bucket, preserving input order', () => {
    const groups = groupRunsBySectionConductor([
      run('NORMAL', 'CU', 'x1'),
      run('NORMAL', 'CU', 'x2'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].runs.map((r) => r.supply_id)).toEqual(['x1', 'x2'])
  })
  it('normalises unknown sections to null', () => {
    const groups = groupRunsBySectionConductor([run('WEIRD', 'CU', 'z')])
    expect(groups[0].section).toBeNull()
  })
})
