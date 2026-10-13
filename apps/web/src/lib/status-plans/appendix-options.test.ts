import { describe, it, expect } from 'vitest'
import { statusPlanAppendixOptions, appendixPurposes, appendixQuery } from './appendix-options'

describe('appendix options', () => {
  it('reads ?tenantPlans=1 and ?schematicPlans=1; anything else is off', () => {
    expect(statusPlanAppendixOptions('http://x/r')).toEqual({ tenantLayout: false, schematic: false, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1')).toEqual({ tenantLayout: true, schematic: false, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1&schematicPlans=1')).toEqual({ tenantLayout: true, schematic: true, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=true')).toEqual({ tenantLayout: false, schematic: false, byBoard: false })
  })
  it('purposes in appendix order and a round-trip query', () => {
    expect(appendixPurposes({ tenantLayout: true, schematic: true, byBoard: false })).toEqual(['tenant_layout', 'distribution_schematic'])
    expect(appendixPurposes({ tenantLayout: false, schematic: false, byBoard: false })).toEqual([])
    expect(appendixQuery({ tenantLayout: true, schematic: false, byBoard: false })).toBe('?tenantPlans=1')
    expect(appendixQuery({ tenantLayout: false, schematic: false, byBoard: false })).toBe('')
    expect(statusPlanAppendixOptions(`http://x/r${appendixQuery({ tenantLayout: false, schematic: true, byBoard: false })}`)).toEqual({ tenantLayout: false, schematic: true, byBoard: false })
  })

  it('?boardPlans=1 adds the floor plan by main board; it round-trips', () => {
    expect(statusPlanAppendixOptions('http://x/r?boardPlans=1')).toEqual({ tenantLayout: false, schematic: false, byBoard: true })
    expect(appendixQuery({ tenantLayout: true, schematic: false, byBoard: true })).toBe('?tenantPlans=1&boardPlans=1')
    expect(appendixPurposes({ tenantLayout: false, schematic: false, byBoard: true })).toEqual([])
  })
})
