import { describe, expect, it } from 'vitest'
import type { Template } from '../inspections/types'
import { flowFieldKeys } from './flow-builder'
import { mapFlowReply } from './reply-mapper'
import miniSub from './__fixtures__/mini-sub-inspection-report.json'

const MINI = miniSub as unknown as Template
const key = (fid: string, role: 'value' | 'fail_reason' = 'value') =>
  flowFieldKeys(MINI).find((k) => k.fieldId === fid && k.role === role)!.key

describe('mapFlowReply', () => {
  it('maps every Flow answer type onto the engine response shape', () => {
    const out = mapFlowReply(MINI, {
      flow_token: 'tok',
      [key('enclosure_integrity')]: 'pass',
      [key('plinth_condition')]: 'fail',
      [key('plinth_condition', 'fail_reason')]: 'Cracked on the north side',
      [key('perimeter_fence')]: 'na',
      [key('corrosion_level')]: 'light',
      [key('max_winding_temp')]: '72,5',
      [key('last_service_date')]: '2026-03-14',
      [key('sld_availability_notes')]: 'On the door',
    })
    expect(out.errors).toEqual([])
    const r = (fid: string) => out.responses.find((x) => x.field_id === fid)
    expect(r('enclosure_integrity')).toMatchObject({ section_id: 'visual_structural_checks', value_bool: true, pass_state: 'pass', fail_reason: null })
    expect(r('plinth_condition')).toMatchObject({ value_bool: false, pass_state: 'fail', fail_reason: 'Cracked on the north side' })
    expect(r('perimeter_fence')).toMatchObject({ value_bool: null, pass_state: 'na' })
    expect(r('corrosion_level')).toMatchObject({ value_text: 'light' })
    expect(r('max_winding_temp')).toMatchObject({ value_number: 72.5 })
    expect(r('last_service_date')).toMatchObject({ value_text: '2026-03-14' })
    expect(r('sld_availability_notes')).toMatchObject({ value_text: 'On the door' })
    expect(out.responses).toHaveLength(7)
  })

  it('drops a fail reason given with a pass, and treats blanks as unanswered', () => {
    const out = mapFlowReply(MINI, {
      [key('enclosure_integrity')]: 'pass',
      [key('enclosure_integrity', 'fail_reason')]: 'ignored',
      [key('sld_availability_notes')]: '   ',
      [key('max_winding_temp')]: '',
    })
    expect(out.responses).toEqual([
      expect.objectContaining({ field_id: 'enclosure_integrity', fail_reason: null }),
    ])
  })

  it('refuses values the template does not allow, field by field', () => {
    const out = mapFlowReply(MINI, {
      [key('enclosure_integrity')]: 'maybe',
      [key('corrosion_level')]: 'rusty',
      [key('max_winding_temp')]: 'hot',
      [key('last_service_date')]: '14/03/2026',
      [key('fire_extinguisher_in_date')]: 'pass',
    })
    expect(out.errors.map((e) => e.fieldId).sort()).toEqual(['corrosion_level', 'enclosure_integrity', 'last_service_date', 'max_winding_temp'])
    expect(out.responses.map((r) => r.field_id)).toEqual(['fire_extinguisher_in_date'])
  })

  it('ignores keys it did not issue instead of writing them anywhere', () => {
    const out = mapFlowReply(MINI, { flow_token: 't', injected_field: 'x', [key('enclosure_integrity')]: 'pass' })
    expect(out.responses.map((r) => r.field_id)).toEqual(['enclosure_integrity'])
    expect(out.unknownKeys).toEqual(['injected_field'])
  })

  it('caps free text at 4000 characters so one reply cannot flood a response row', () => {
    const out = mapFlowReply(MINI, { [key('sld_availability_notes')]: 'x'.repeat(5000) })
    expect(out.responses[0].value_text).toHaveLength(4000)
  })
})
