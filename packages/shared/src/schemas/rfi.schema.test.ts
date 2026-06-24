import { describe, it, expect } from 'vitest'
import { createRfiSchema } from './rfi.schema'

const base = {
  projectId: '00000000-0000-0000-0000-000000000001',
  subject: 'Test subject',
  description: 'A description long enough to pass the min length rule.',
  priority: 'medium' as const,
}

describe('createRfiSchema — assignedTo', () => {
  it('coerces the empty-string "Unassigned" option to undefined (does not reject it)', () => {
    // The web form's default <option value="">Unassigned</option> submits ''.
    // Before the fix this failed z.string().uuid() with "Invalid uuid".
    const result = createRfiSchema.safeParse({ ...base, assignedTo: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.assignedTo).toBeUndefined()
  })

  it('accepts a valid uuid assignee', () => {
    const uuid = '00000000-0000-0000-0000-0000000000aa'
    const result = createRfiSchema.safeParse({ ...base, assignedTo: uuid })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.assignedTo).toBe(uuid)
  })

  it('still rejects a non-empty, non-uuid assignee', () => {
    const result = createRfiSchema.safeParse({ ...base, assignedTo: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('accepts an omitted assignee', () => {
    const result = createRfiSchema.safeParse({ ...base })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.assignedTo).toBeUndefined()
  })
})
