import { describe, it, expect } from 'vitest'
import { gcrChangeRequestInputSchema, gcrChangeRequestBatchSchema } from './gcr.schemas'

const NODE_ID = '00000000-0000-0000-0000-0000000000bb'

describe('gcr.schemas', () => {
  it('accepts a valid change request', () => {
    const parsed = gcrChangeRequestInputSchema.parse({
      nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: 'we generate our own',
    })
    expect(parsed.field).toBe('participation')
  })

  it('accepts nulls for value/comment fields', () => {
    const parsed = gcrChangeRequestInputSchema.parse({
      nodeId: NODE_ID, field: 'area', oldValue: null, newValue: null, comment: null,
    })
    expect(parsed.newValue).toBeNull()
  })

  it('rejects an unknown field', () => {
    expect(() =>
      gcrChangeRequestInputSchema.parse({
        nodeId: NODE_ID, field: 'monthly', oldValue: null, newValue: '1', comment: null,
      } as never),
    ).toThrow()
  })

  it('rejects a non-uuid nodeId', () => {
    expect(() =>
      gcrChangeRequestInputSchema.parse({
        nodeId: 'not-a-uuid', field: 'zone', oldValue: null, newValue: 'z1', comment: null,
      }),
    ).toThrow()
  })

  it('batch schema rejects an empty array', () => {
    expect(() => gcrChangeRequestBatchSchema.parse([])).toThrow()
  })

  it('batch schema accepts a non-empty array', () => {
    const parsed = gcrChangeRequestBatchSchema.parse([
      { nodeId: NODE_ID, field: 'category', oldValue: null, newValue: 'restaurant', comment: null },
    ])
    expect(parsed).toHaveLength(1)
  })
})
