import { describe, it, expect } from 'vitest'
import { statusPlanAppendixOptions, appendixPurposes, appendixQuery } from './appendix-options'

describe('appendix options', () => {
  it('reads ?tenantPlans=1 and ?schematicPlans=1; anything else is off', () => {
    expect(statusPlanAppendixOptions('http://x/r')).toEqual({ tenantLayout: false, schematic: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1')).toEqual({ tenantLayout: true, schematic: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1&schematicPlans=1')).toEqual({ tenantLayout: true, schematic: true })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=true')).toEqual({ tenantLayout: false, schematic: false })
  })
  it('purposes in appendix order and a round-trip query', () => {
    expect(appendixPurposes({ tenantLayout: true, schematic: true })).toEqual(['tenant_layout', 'distribution_schematic'])
    expect(appendixPurposes({ tenantLayout: false, schematic: false })).toEqual([])
    expect(appendixQuery({ tenantLayout: true, schematic: false })).toBe('?tenantPlans=1')
    expect(appendixQuery({ tenantLayout: false, schematic: false })).toBe('')
    expect(statusPlanAppendixOptions(`http://x/r${appendixQuery({ tenantLayout: false, schematic: true })}`)).toEqual({ tenantLayout: false, schematic: true })
  })
})
