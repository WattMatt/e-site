import { describe, it, expect } from 'vitest'
import { createDiarySchema } from './diary.schema'

const base = {
  projectId: '00000000-0000-0000-0000-000000000001',
  entryDate: '2026-06-24',
  progressNotes: 'Poured the slab on grid B today.',
}

describe('createDiarySchema', () => {
  it('accepts a minimal valid entry and defaults entryType to "progress"', () => {
    const result = createDiarySchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.entryType).toBe('progress')
  })

  it('trims and rejects whitespace-only progress notes', () => {
    const result = createDiarySchema.safeParse({ ...base, progressNotes: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing progressNotes', () => {
    const { progressNotes: _omit, ...rest } = base
    const result = createDiarySchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid projectId', () => {
    const result = createDiarySchema.safeParse({ ...base, projectId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed entryDate (must be yyyy-mm-dd)', () => {
    const result = createDiarySchema.safeParse({ ...base, entryDate: '24-06-2026' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown entryType', () => {
    const result = createDiarySchema.safeParse({ ...base, entryType: 'bogus' })
    expect(result.success).toBe(false)
  })

  it('accepts qualityNotes for the quality entry type', () => {
    const result = createDiarySchema.safeParse({
      ...base,
      entryType: 'quality',
      qualityNotes: 'Concrete cube test passed at 30 MPa.',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.qualityNotes).toBe('Concrete cube test passed at 30 MPa.')
  })

  it('rejects a negative workersOnSite', () => {
    const result = createDiarySchema.safeParse({ ...base, workersOnSite: -3 })
    expect(result.success).toBe(false)
  })
})
