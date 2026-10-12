import { describe, it, expect } from 'vitest'
import { isPlanId } from './plan-id'

describe('isPlanId', () => {
  it('accepts a uuid in either case', () => {
    expect(isPlanId('9c1a98b5-6ef3-4388-865f-417d3f5d7465')).toBe(true)
    expect(isPlanId('9C1A98B5-6EF3-4388-865F-417D3F5D7465')).toBe(true)
  })
  it.each(['', 'plan-1', '9c1a98b5-6ef3-4388-865f-417d3f5d746', '9c1a98b5-6ef3-4388-865f-417d3f5d7465x', "9c1a98b5-6ef3-4388-865f-417d3f5d7465'--", 'null'])('rejects %j', (s) => {
    expect(isPlanId(s)).toBe(false)
  })
})
