import { it, expect } from 'vitest'
import { isWriteDenied, assertWritable, WRITE_DENYLIST } from './denylist'

it('matches a schema.* entry against every table in that schema', () => {
  expect(isWriteDenied('billing', 'invoices')).toBe(true)
  expect(isWriteDenied('billing', 'anything_new')).toBe(true)
})
it('matches concrete entries and leaves siblings open', () => {
  expect(isWriteDenied('projects', 'tender_submissions')).toBe(true)
  expect(isWriteDenied('projects', 'tender_estimate_lines')).toBe(false)
  expect(isWriteDenied('public', 'profiles')).toBe(true)
  expect(isWriteDenied('tenants', 'profiles')).toBe(false)
  expect(isWriteDenied('marketplace', 'orders')).toBe(true)
  expect(isWriteDenied('marketplace', 'suppliers')).toBe(false)
})
it('throws the sentence for a denied table and passes a writable one', () => {
  expect(() => assertWritable('structure', 'scope_item_types')).toThrow('This table is managed in the app, not through Claude.')
  expect(() => assertWritable('structure', 'nodes')).not.toThrow()
})
it('refuses the writable view over profiles (public.metric_accounts)', () => {
  expect(() => assertWritable('public', 'metric_accounts')).toThrow('This table is managed in the app, not through Claude.')
})
it('has the 17 entries from the spec plus the metric_accounts view, one reason each', () => {
  expect(WRITE_DENYLIST).toHaveLength(18)
  for (const e of WRITE_DENYLIST) expect(e.reason.length).toBeGreaterThan(10)
})
