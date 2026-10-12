import { describe, it, expect } from 'vitest'
import { acceptErrorSentence } from './detection-errors'

describe('acceptErrorSentence (bulk accept of detected blocks)', () => {
  it('a duplicate board says the list is stale', () => {
    expect(acceptErrorSentence({ code: '23505', message: 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"' }))
      .toBe('One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.')
  })

  it('other refusals reuse the status-plan sentence and say nothing was added', () => {
    expect(acceptErrorSentence({ code: '23514', message: 'board is not on this project' }))
      .toBe('That board is not on this project. Nothing was added; run detection again.')
    expect(acceptErrorSentence({ code: '23514', message: 'board has been deleted' }))
      .toBe('That board has been deleted. Pick another, or leave the shape unassigned. Nothing was added; run detection again.')
    expect(acceptErrorSentence({ code: '42501', message: 'new row violates row-level security policy' }))
      .toBe('Only an owner, admin or project manager can change status plans on this project. Nothing was added; run detection again.')
  })

  it('anything else is a generic sentence, never the raw database message', () => {
    const s = acceptErrorSentence({ code: 'XX000', message: 'internal: relation tenants.status_plan_shapes' })
    expect(s).toBe('The shape could not be saved. Reload and try again. Nothing was added; run detection again.')
    expect(s).not.toContain('tenants.')
    expect(acceptErrorSentence({})).toBe(s)
  })
})
