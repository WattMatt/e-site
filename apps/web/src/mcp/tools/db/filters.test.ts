import { it, expect } from 'vitest'
import { applyFilters, filterColumns, FILTER_OPS, type Filter } from './filters'
import { fakeClient } from '../../test/fake-client'

const setup = () => {
  const f = fakeClient()
  return { ...f, q: f.client.schema('projects').from('t').select('*') }
}

it.each([
  ['eq', 5, ['eq', ['c', 5]]], ['neq', 5, ['neq', ['c', 5]]], ['gt', 1, ['gt', ['c', 1]]], ['gte', 1, ['gte', ['c', 1]]],
  ['lt', 1, ['lt', ['c', 1]]], ['lte', 1, ['lte', ['c', 1]]], ['like', 'a%', ['like', ['c', 'a%']]], ['ilike', 'a%', ['ilike', ['c', 'a%']]],
  ['in', [1, 2], ['in', ['c', [1, 2]]]], ['is', null, ['is', ['c', null]]], ['is', true, ['is', ['c', true]]], ['is', false, ['is', ['c', false]]],
  ['cs', ['x'], ['contains', ['c', ['x']]]],
  ['cd', ['x'], ['containedBy', ['c', ['x']]]], ['ov', ['x'], ['overlaps', ['c', ['x']]]], ['fts', 'meter', ['textSearch', ['c', 'meter']]],
  ['not.eq', 5, ['not', ['c', 'eq', 5]]], ['not.in', [1, 2], ['not', ['c', 'in', '(1,2)']]], ['not.is', null, ['not', ['c', 'is', null]]],
] as const)('maps %s %j', (op, value, [method, args]) => {
  const { q, calls } = setup()
  applyFilters(q, [{ column: 'c', op, value }])
  expect(calls.at(-1)).toMatchObject({ path: 'projects.t', method, args })
})

it('coerces the fts value to a string', () => {
  const { q, calls } = setup()
  applyFilters(q, [{ column: 'c', op: 'fts', value: 12 }])
  expect(calls.at(-1)).toMatchObject({ method: 'textSearch', args: ['c', '12'] })
})

it('applies every filter in order and returns the query', () => {
  const { q, calls } = setup()
  const out = applyFilters(q, [{ column: 'a', op: 'eq', value: 1 }, { column: 'b', op: 'gt', value: 2 }])
  expect(out).toBe(q)
  expect(calls.map(c => c.method)).toEqual(['select', 'eq', 'gt'])
})

it('lists exactly the 17 operators', () => expect(FILTER_OPS).toHaveLength(17))

it('refuses an unknown operator with the sentence', () => {
  const { q } = setup()
  expect(() => applyFilters(q, [{ column: 'c', op: 'regex', value: 1 }])).toThrow('Unknown filter operator.')
})

it('refuses in and not.in with a non-array, and is with a string', () => {
  const { q } = setup()
  for (const f of [{ column: 'c', op: 'in', value: 'a' }, { column: 'c', op: 'not.in', value: 1 }, { column: 'c', op: 'is', value: 'null' }] as Filter[]) {
    expect(() => applyFilters(q, [f])).toThrow('Unknown filter operator.')
  }
})

it('refuses a column that is not a plain identifier, before looking at the operator', () => {
  const { q } = setup()
  expect(() => applyFilters(q, [{ column: 'a:b(*)', op: 'eq', value: 1 }])).toThrow('Column names must be plain identifiers.')
  expect(() => applyFilters(q, [{ column: 'a->b', op: 'regex', value: 1 }])).toThrow('Column names must be plain identifiers.')
})

it('quotes not.in string elements that contain reserved characters', () => {
  const { q, calls } = setup()
  applyFilters(q, [{ column: 'c', op: 'not.in', value: ['A,B', 'plain', 3, 'x (y)', 'say "hi"', 'a\\b c'] }])
  expect(calls.at(-1)).toMatchObject({ method: 'not', args: ['c', 'in', '("A,B",plain,3,"x (y)","say \\"hi\\"","a\\\\b c")'] })
})

it('refuses a non-identifier column in filterColumns', () => {
  expect(() => filterColumns([{ column: 'a->b', op: 'eq', value: 1 }])).toThrow('Column names must be plain identifiers.')
  expect(() => filterColumns([{ column: 'Cost', op: 'eq', value: 1 }])).toThrow('Column names must be plain identifiers.')
})

it('lists the filter columns', () => {
  expect(filterColumns([{ column: 'a', op: 'eq', value: 1 }, { column: 'b', op: 'gt', value: 2 }])).toEqual(['a', 'b'])
})
