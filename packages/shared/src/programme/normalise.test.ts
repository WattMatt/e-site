import { describe, expect, it } from 'vitest'
import { findCycle, normaliseProgramme } from './normalise'
import { act, dep, prog } from './test-fixtures'
import type { ProgrammeInput } from './types'

describe('findCycle', () => {
  it('returns a rotation of the loop with the first id repeated', () => {
    const c = findCycle(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']])!
    expect(c).toHaveLength(4)
    expect(c[0]).toBe(c[3])
    expect([...c.slice(0, 3)].sort()).toEqual(['A', 'B', 'C'])
    const edges = new Set(['A>B', 'B>C', 'C>A'])
    for (let i = 0; i < 3; i++) expect(edges.has(`${c[i]}>${c[i + 1]}`)).toBe(true)
  })
  it('finds nothing in a DAG', () => {
    expect(findCycle(['A', 'B', 'C'], [['A', 'B'], ['A', 'C'], ['B', 'C']])).toBeNull()
  })
  it('finds a cycle that is not reachable from the first node', () => {
    expect(findCycle(['X', 'A', 'B'], [['A', 'B'], ['B', 'A']])).toHaveLength(3)
  })
})

describe('normaliseProgramme', () => {
  it('returns null and the issues when validation has an error', () => {
    const r = normaliseProgramme(prog([act('A')], [dep('L', 'A', 'Z')]))
    expect(r.value).toBeNull()
    expect(r.issues.map(i => i.code)).toEqual(['unknown_activity'])
  })

  it('reports a dependency cycle with its path and links', () => {
    const r = normaliseProgramme(prog([act('A'), act('B'), act('C')], [dep('L1', 'A', 'B'), dep('L2', 'B', 'C'), dep('L3', 'C', 'A')]))
    expect(r.value).toBeNull()
    const i = r.issues.find(x => x.code === 'cycle')!
    expect(i.severity).toBe('error')
    expect(i.activityIds).toHaveLength(4)
    expect(i.activityIds[0]).toBe(i.activityIds[3])
    expect([...i.dependencyIds].sort()).toEqual(['L1', 'L2', 'L3'])
  })

  it('drops a duplicate link, keeps the warning, and still returns a value', () => {
    const r = normaliseProgramme(prog([act('A'), act('B')], [dep('L1', 'A', 'B'), dep('L2', 'A', 'B')]))
    expect(r.value!.links.map(l => l.id)).toEqual(['L1'])
    expect(r.issues.map(i => i.code)).toEqual(['duplicate_link'])
  })

  const summaryProg = (links: ReturnType<typeof dep>[], extra: ProgrammeInput['options']['rules'] = 'msp'): ProgrammeInput => {
    const p = prog(
      [act('X'), act('S', { type: 'summary' }), act('A', { parentId: 'S' }), act('B', { parentId: 'S' }), act('Y')],
      links,
    )
    return { ...p, options: { ...p.options, rules: extra } }
  }

  it('expands a link into a summary to each leaf descendant, keeping the source id', () => {
    const r = normaliseProgramme(summaryProg([dep('L', 'X', 'S')]))
    expect(r.value!.links.map(l => [l.id, l.predId, l.succId])).toEqual([['L', 'X', 'A'], ['L', 'X', 'B']])
    expect(r.value!.predsOf.get('A')!.map(l => l.predId)).toEqual(['X'])
    expect(r.value!.succsOf.get('X')!.map(l => l.succId)).toEqual(['A', 'B'])
  })

  it('expands a link out of a summary from each leaf descendant', () => {
    const r = normaliseProgramme(summaryProg([dep('L', 'S', 'Y')]))
    expect(r.value!.links.map(l => [l.predId, l.succId])).toEqual([['A', 'Y'], ['B', 'Y']])
  })

  it('expands summary to summary into the product, through nested summaries', () => {
    const p = prog([
      act('S1', { type: 'summary' }), act('A', { parentId: 'S1' }),
      act('S2', { type: 'summary' }), act('T', { type: 'summary', parentId: 'S2' }), act('B', { parentId: 'T' }), act('C', { parentId: 'S2' }),
    ], [dep('L', 'S1', 'S2')])
    const r = normaliseProgramme(p)
    expect(r.value!.links.map(l => [l.predId, l.succId]).sort()).toEqual([['A', 'B'], ['A', 'C']])
  })

  it('the same summary input under p6 is refused', () => {
    const r = normaliseProgramme(summaryProg([dep('L', 'X', 'S')], 'p6'))
    expect(r.value).toBeNull()
    expect(r.issues.map(i => i.code)).toContain('summary_link_p6')
  })

  it('a link from a summary to its own child is caught as a cycle after expansion', () => {
    const r = normaliseProgramme(summaryProg([dep('L', 'S', 'A')]))
    expect(r.value).toBeNull()
    expect(r.issues.map(i => i.code)).toContain('cycle')
  })

  it('leaves exclude summaries and are topologically ordered', () => {
    const p = prog(
      [act('D'), act('C'), act('S', { type: 'summary' }), act('B', { parentId: 'S' }), act('A'), act('M', { type: 'module_summary', fixed: { start: '2026-03-02', finish: '2026-03-06' } })],
      [dep('L1', 'A', 'B'), dep('L2', 'B', 'C'), dep('L3', 'C', 'D'), dep('L4', 'M', 'A')],
    )
    const v = normaliseProgramme(p).value!
    const ids = v.leaves.map(a => a.id)
    expect(ids).not.toContain('S')
    expect(ids).toContain('M')
    expect(ids).toHaveLength(5)
    for (const l of v.links) expect(ids.indexOf(l.predId)).toBeLessThan(ids.indexOf(l.succId))
  })

  it('summaries are post-order and childrenOf lists direct children', () => {
    const p = prog([
      act('Top', { type: 'summary' }), act('Mid', { type: 'summary', parentId: 'Top' }), act('A', { parentId: 'Mid' }),
      act('B', { parentId: 'Top' }), act('Other', { type: 'summary' }), act('C', { parentId: 'Other' }),
    ])
    const v = normaliseProgramme(p).value!
    expect(v.summaries.map(s => s.id)).toEqual(['Mid', 'Top', 'Other'])
    expect(v.childrenOf.get('Top')).toEqual(['Mid', 'B'])
    expect(v.childrenOf.get('Mid')).toEqual(['A'])
  })

  it('level_of_effort activities are leaves', () => {
    const v = normaliseProgramme(prog([act('L', { type: 'level_of_effort' }), act('A')])).value!
    expect(v.leaves.map(a => a.id).sort()).toEqual(['A', 'L'])
  })
})
