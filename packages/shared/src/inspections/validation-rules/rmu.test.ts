import { describe, it, expect } from 'vitest'
import { runRmuRules } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/rmu'
import type { RuleContext, ResponseRow } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(fields: Record<string, number | string | boolean | null>): RuleContext {
  const responses = new Map<string, ResponseRow>()
  for (const [fieldId, val] of Object.entries(fields)) {
    const row: ResponseRow = {
      section_id: 'test',
      field_id: fieldId,
      value_number: typeof val === 'number' ? val : null,
      value_text: typeof val === 'string' ? val : null,
      value_bool: typeof val === 'boolean' ? val : null,
      pass_state:
        typeof val === 'boolean'
          ? val
            ? 'pass'
            : 'fail'
          : val === 'pass' || val === 'fail'
          ? (val as 'pass' | 'fail')
          : null,
    }
    responses.set(`test.${fieldId}`, row)
  }
  return { responses, template: {}, inspection: { id: 'test', template_id: 'rmu-snagging' } }
}

// ---------------------------------------------------------------------------
// RMU-SF6-PRESSURE-001 — SF6 gas pressure (manufacturer-specific threshold)
// Field: sf6_pressure_kpa (number). No sf6_minimum_per_nameplate in template
// → pressure present but no nameplate minimum = not_applicable.
// ---------------------------------------------------------------------------
describe('RMU-SF6-PRESSURE-001 — SF6 gas pressure', () => {
  it('returns insufficient_data when sf6_pressure_kpa is missing', () => {
    const results = runRmuRules(makeCtx({}))
    const r = results.find((x) => x.rule_code === 'RMU-SF6-PRESSURE-001')!
    expect(r.result).toBe('insufficient_data')
  })

  it('returns not_applicable when pressure is present but no nameplate minimum provided', () => {
    const results = runRmuRules(makeCtx({ sf6_pressure_kpa: 140 }))
    const r = results.find((x) => x.rule_code === 'RMU-SF6-PRESSURE-001')!
    expect(r.result).toBe('not_applicable')
    expect(r.measured_value).toBe('140 kPa')
    expect(r.failure_reason).toMatch(/minimum threshold not provided/i)
  })

  it('passes when pressure >= nameplate minimum', () => {
    const results = runRmuRules(
      makeCtx({ sf6_pressure_kpa: 145, sf6_minimum_per_nameplate: 120 }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-SF6-PRESSURE-001')!
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('145 kPa')
    expect(r.threshold).toMatch(/120/)
  })

  it('fails when pressure < nameplate minimum', () => {
    const results = runRmuRules(
      makeCtx({ sf6_pressure_kpa: 100, sf6_minimum_per_nameplate: 120 }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-SF6-PRESSURE-001')!
    expect(r.result).toBe('fail')
    expect(r.measured_value).toBe('100 kPa')
    expect(r.failure_reason).toMatch(/100.*120|below/i)
  })
})

// ---------------------------------------------------------------------------
// RMU-EARTH-001 — Earth electrode resistance <= 5.0 Ω (SANS 10142-1 §8.4)
// Field: earth_electrode_resistance (number)
// ---------------------------------------------------------------------------
describe('RMU-EARTH-001 — earth electrode resistance', () => {
  it('passes at 3.2 Ω', () => {
    const results = runRmuRules(makeCtx({ earth_electrode_resistance: 3.2 }))
    const r = results.find((x) => x.rule_code === 'RMU-EARTH-001')!
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('3.2 Ω')
  })

  it('passes at exactly 5.0 Ω', () => {
    const results = runRmuRules(makeCtx({ earth_electrode_resistance: 5.0 }))
    const r = results.find((x) => x.rule_code === 'RMU-EARTH-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 6.5 Ω', () => {
    const results = runRmuRules(makeCtx({ earth_electrode_resistance: 6.5 }))
    const r = results.find((x) => x.rule_code === 'RMU-EARTH-001')!
    expect(r.result).toBe('fail')
    expect(r.measured_value).toBe('6.5 Ω')
    expect(r.failure_reason).toMatch(/5/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runRmuRules(makeCtx({}))
    const r = results.find((x) => x.rule_code === 'RMU-EARTH-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// RMU-INTERLOCKS-001 — All mechanical interlocks pass
// Fields: mechanical_interlocks, key_interlocks, padlock_provisions (pass_fail)
// ---------------------------------------------------------------------------
describe('RMU-INTERLOCKS-001 — mechanical interlocks', () => {
  it('passes when all three interlocks are pass', () => {
    const results = runRmuRules(
      makeCtx({
        mechanical_interlocks: 'pass',
        key_interlocks: 'pass',
        padlock_provisions: 'pass',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-INTERLOCKS-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when mechanical_interlocks is fail', () => {
    const results = runRmuRules(
      makeCtx({
        mechanical_interlocks: 'fail',
        key_interlocks: 'pass',
        padlock_provisions: 'pass',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-INTERLOCKS-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/mechanical_interlocks/i)
  })

  it('fails when key_interlocks is fail', () => {
    const results = runRmuRules(
      makeCtx({
        mechanical_interlocks: 'pass',
        key_interlocks: 'fail',
        padlock_provisions: 'pass',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-INTERLOCKS-001')!
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when any interlock is missing', () => {
    const results = runRmuRules(
      makeCtx({ mechanical_interlocks: 'pass', key_interlocks: 'pass' }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-INTERLOCKS-001')!
    expect(r.result).toBe('insufficient_data')
    expect(r.failure_reason).toMatch(/padlock_provisions/i)
  })
})

// ---------------------------------------------------------------------------
// RMU-CABLE-TERM-001 — Cable termination torque + boots
// Fields: hv_torque_spec, hv_boots_intact (pass_fail)
// ---------------------------------------------------------------------------
describe('RMU-CABLE-TERM-001 — cable termination torque and boots', () => {
  it('passes when both hv_torque_spec and hv_boots_intact are pass', () => {
    const results = runRmuRules(
      makeCtx({ hv_torque_spec: 'pass', hv_boots_intact: 'pass' }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-CABLE-TERM-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when hv_torque_spec is fail', () => {
    const results = runRmuRules(
      makeCtx({ hv_torque_spec: 'fail', hv_boots_intact: 'pass' }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-CABLE-TERM-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/hv_torque_spec/i)
  })

  it('fails when hv_boots_intact is fail', () => {
    const results = runRmuRules(
      makeCtx({ hv_torque_spec: 'pass', hv_boots_intact: 'fail' }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-CABLE-TERM-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/hv_boots_intact/i)
  })

  it('returns insufficient_data when both are missing', () => {
    const results = runRmuRules(makeCtx({}))
    const r = results.find((x) => x.rule_code === 'RMU-CABLE-TERM-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// RMU-LABEL-001 — Asset + warning labels present
// Fields: label_asset_arcflash_voltage, label_switch_labelling, label_cable_id (pass_fail)
// ---------------------------------------------------------------------------
describe('RMU-LABEL-001 — asset and warning labels', () => {
  it('passes when all three label fields are pass', () => {
    const results = runRmuRules(
      makeCtx({
        label_asset_arcflash_voltage: 'pass',
        label_switch_labelling: 'pass',
        label_cable_id: 'pass',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-LABEL-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when label_asset_arcflash_voltage is fail', () => {
    const results = runRmuRules(
      makeCtx({
        label_asset_arcflash_voltage: 'fail',
        label_switch_labelling: 'pass',
        label_cable_id: 'pass',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-LABEL-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/label_asset_arcflash_voltage/i)
  })

  it('fails when label_cable_id is fail', () => {
    const results = runRmuRules(
      makeCtx({
        label_asset_arcflash_voltage: 'pass',
        label_switch_labelling: 'pass',
        label_cable_id: 'fail',
      }),
    )
    const r = results.find((x) => x.rule_code === 'RMU-LABEL-001')!
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when all label fields are missing', () => {
    const results = runRmuRules(makeCtx({}))
    const r = results.find((x) => x.rule_code === 'RMU-LABEL-001')!
    expect(r.result).toBe('insufficient_data')
  })
})
