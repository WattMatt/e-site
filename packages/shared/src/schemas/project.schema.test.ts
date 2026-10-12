import { describe, it, expect } from 'vitest'
import { createProjectSchema } from './project.schema'

// What the web New Project form actually submits when the optional fields are
// left alone: react-hook-form sends '' for an untouched <select> / text input
// and NaN for an empty <input type="number" valueAsNumber>.
const blankForm = {
  name: 'Throwaway site',
  description: 'Short description',
  status: 'active' as const,
  address: '',
  city: '',
  province: '',
  startDate: '',
  endDate: '',
  contractValue: Number.NaN,
  clientName: '',
  clientContact: '',
}

describe('createProjectSchema — optional fields left blank', () => {
  it('accepts the form with Province and Contract value both blank', () => {
    const result = createProjectSchema.safeParse(blankForm)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.province).toBeUndefined()
    expect(result.data.contractValue).toBeUndefined()
  })

  it('maps every blank optional text field to undefined, not an empty string', () => {
    const result = createProjectSchema.safeParse(blankForm)
    expect(result.success).toBe(true)
    if (!result.success) return
    for (const key of ['address', 'city', 'clientName', 'clientContact', 'startDate', 'endDate'] as const) {
      expect(result.data[key]).toBeUndefined()
    }
  })

  it('treats a whitespace-only province and a null contract value as blank', () => {
    const result = createProjectSchema.safeParse({ ...blankForm, province: '   ', contractValue: null })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.province).toBeUndefined()
    expect(result.data.contractValue).toBeUndefined()
  })

  it('accepts an omitted Province and Contract value', () => {
    const result = createProjectSchema.safeParse({ name: 'Throwaway site' })
    expect(result.success).toBe(true)
  })

  it('keeps a chosen province and a real contract value, including 0', () => {
    const chosen = createProjectSchema.safeParse({ ...blankForm, province: 'Gauteng', contractValue: 1500000 })
    expect(chosen.success && chosen.data.province).toBe('Gauteng')
    expect(chosen.success && chosen.data.contractValue).toBe(1500000)

    const zero = createProjectSchema.safeParse({ ...blankForm, contractValue: 0 })
    expect(zero.success && zero.data.contractValue).toBe(0)
  })

  it('still rejects a province outside the list and a negative contract value', () => {
    expect(createProjectSchema.safeParse({ ...blankForm, province: 'Atlantis' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ ...blankForm, contractValue: -1 }).success).toBe(false)
  })

  it('still requires the project name', () => {
    expect(createProjectSchema.safeParse({ ...blankForm, name: '' }).success).toBe(false)
  })
})
