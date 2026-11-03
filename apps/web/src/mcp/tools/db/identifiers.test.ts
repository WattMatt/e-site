import { it, expect } from 'vitest'
import { assertIdent, assertIdents } from './identifiers'
import { assertExposedSchema, EXPOSED_SCHEMAS } from './exposed-schemas'

it.each(['shop_number', '_x1', 'a'])('accepts %s', n => expect(assertIdent(n)).toBe(n))
it.each(['Shop', 'a.b', 'a b', 'a->b', '*', '', 42, undefined, null, 'a:b(*)', '1a'])('refuses %j', n => {
  expect(() => assertIdent(n)).toThrow('Column names must be plain identifiers.')
})
it('checks a list and refuses it whole on one bad name', () => {
  expect(assertIdents(['a', 'b_2'])).toEqual(['a', 'b_2'])
  expect(() => assertIdents(['a', 'B'])).toThrow('Column names must be plain identifiers.')
})

it('lists the 14 exposed schemas', () => {
  expect([...EXPOSED_SCHEMAS]).toEqual(['public', 'projects', 'inspections', 'field', 'tenants', 'suppliers', 'billing', 'marketplace', 'cable_schedule', 'structure', 'gcr', 'solar', 'tariffs', 'whatsapp'])
})
it('accepts an exposed schema and refuses anything else', () => {
  expect(() => assertExposedSchema('solar')).not.toThrow()
  for (const s of ['auth', 'storage', 'Public', '']) {
    expect(() => assertExposedSchema(s)).toThrow('That schema is not exposed; call esite_db_schemas for the list.')
  }
})
