// TDD: Mini-Sub validation rules — tests written BEFORE implementation.
// Run: pnpm --filter @esite/shared test
//
// Template source: mini-sub-pre-post-fat.json
// Rules: IEC 60502 (HV IR) + IEC 60076-1 (turns ratio, winding resistance)
//        + SANS 10142-1 (LV IR, earth fault loop) + IEC 61439 (HV withstand)

import { describe, it, expect } from 'vitest'
import { runMiniSubRules } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/mini-sub'
import type { RuleContext, ResponseRow, RuleResult } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(fields: Record<string, Partial<Omit<ResponseRow, 'section_id' | 'field_id'>>>): RuleContext {
  const responses = new Map<string, ResponseRow>()
  for (const [key, partial] of Object.entries(fields)) {
    const parts = key.split('.')
    const field_id = parts.pop()!
    const section_id = parts.join('.') || 'test'
    responses.set(key, { section_id, field_id, ...partial } as ResponseRow)
  }
  return { responses, template: {}, inspection: { id: 'test', template_id: 'mini-sub-pre-post-fat' } }
}

function findResult(results: RuleResult[], code: string): RuleResult {
  const r = results.find((x) => x.rule_code === code)
  if (!r) throw new Error(`Rule ${code} not found in results`)
  return r
}

// ---------------------------------------------------------------------------
// SUB-HV-IR-001 — HV insulation resistance >= 1000 MΩ at 5 kV
// field_id: test_hv_insulation_resistance
// ---------------------------------------------------------------------------

describe('SUB-HV-IR-001 — HV insulation resistance', () => {
  it('passes when reading >= 1000 MΩ', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_insulation_resistance': { value_number: 1200 },
    })
    const results = runMiniSubRules(ctx)
    const r = findResult(results, 'SUB-HV-IR-001')
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('1200 MΩ')
    expect(r.threshold).toContain('1000')
  })

  it('passes at exactly 1000 MΩ boundary', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_insulation_resistance': { value_number: 1000 },
    })
    const results = runMiniSubRules(ctx)
    expect(findResult(results, 'SUB-HV-IR-001').result).toBe('pass')
  })

  it('fails when reading < 1000 MΩ', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_insulation_resistance': { value_number: 500 },
    })
    const results = runMiniSubRules(ctx)
    const r = findResult(results, 'SUB-HV-IR-001')
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toBeTruthy()
  })

  it('returns insufficient_data when field is missing', () => {
    const ctx = makeCtx({})
    const results = runMiniSubRules(ctx)
    expect(findResult(results, 'SUB-HV-IR-001').result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SUB-LV-IR-001 — LV insulation resistance >= 1.0 MΩ at 500 V
// field_id: test_lv_insulation_resistance
// ---------------------------------------------------------------------------

describe('SUB-LV-IR-001 — LV insulation resistance', () => {
  it('passes when reading >= 1.0 MΩ', () => {
    const ctx = makeCtx({
      'electrical_testing.test_lv_insulation_resistance': { value_number: 50 },
    })
    const results = runMiniSubRules(ctx)
    const r = findResult(results, 'SUB-LV-IR-001')
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('50 MΩ')
    expect(r.threshold).toContain('1.0')
  })

  it('passes at exactly 1.0 MΩ boundary', () => {
    const ctx = makeCtx({
      'electrical_testing.test_lv_insulation_resistance': { value_number: 1.0 },
    })
    expect(findResult(runMiniSubRules(ctx), 'SUB-LV-IR-001').result).toBe('pass')
  })

  it('fails when reading < 1.0 MΩ', () => {
    const ctx = makeCtx({
      'electrical_testing.test_lv_insulation_resistance': { value_number: 0.8 },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-LV-IR-001')
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toBeTruthy()
  })

  it('returns insufficient_data when field is missing', () => {
    const ctx = makeCtx({})
    expect(findResult(runMiniSubRules(ctx), 'SUB-LV-IR-001').result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SUB-TURNS-RATIO-001 — Transformer turns ratio within ±0.5% of nameplate
// field_ids: test_turns_ratio (measured), test_turns_ratio_pass_fail (explicit pass_fail)
// Rule: read explicit pass_fail field; if absent fall back to numeric comparison if
//       both measured and nameplate present.
// ---------------------------------------------------------------------------

describe('SUB-TURNS-RATIO-001 — Transformer turns ratio', () => {
  it('passes when explicit pass_fail field = pass', () => {
    const ctx = makeCtx({
      'electrical_testing.test_turns_ratio': { value_number: 11000 / 400 },
      'electrical_testing.test_turns_ratio_pass_fail': { pass_state: 'pass' },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-TURNS-RATIO-001')
    expect(r.result).toBe('pass')
  })

  it('fails when explicit pass_fail field = fail', () => {
    const ctx = makeCtx({
      'electrical_testing.test_turns_ratio': { value_number: 30 },
      'electrical_testing.test_turns_ratio_pass_fail': { pass_state: 'fail' },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-TURNS-RATIO-001')
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when both measured and pass_fail fields are missing', () => {
    const ctx = makeCtx({})
    expect(findResult(runMiniSubRules(ctx), 'SUB-TURNS-RATIO-001').result).toBe('insufficient_data')
  })

  it('returns insufficient_data when measured value missing (no pass_fail either)', () => {
    const ctx = makeCtx({
      'electrical_testing.test_turns_ratio_pass_fail': { pass_state: null },
    })
    expect(findResult(runMiniSubRules(ctx), 'SUB-TURNS-RATIO-001').result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SUB-WINDING-R-001 — HV winding resistance within ±1% of declared
// field_id: test_winding_resistance_hv (measured number, Ω)
// The mini-sub template has no "declared" winding resistance field.
// → not_applicable when no declared baseline can be found.
// ---------------------------------------------------------------------------

describe('SUB-WINDING-R-001 — HV winding resistance', () => {
  it('returns not_applicable when no declared baseline is available in the template', () => {
    const ctx = makeCtx({
      'electrical_testing.test_winding_resistance_hv': { value_number: 12.5 },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-WINDING-R-001')
    expect(r.result).toBe('not_applicable')
    expect(r.failure_reason ?? r.threshold).toBeTruthy()
  })

  it('returns insufficient_data when measured field is missing entirely', () => {
    const ctx = makeCtx({})
    const r = findResult(runMiniSubRules(ctx), 'SUB-WINDING-R-001')
    // No measured value at all → cannot determine compliance
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SUB-EARTH-001 — Earth fault loop impedance (Zs) <= 5.0 Ω
// field_id: test_earth_fault_loop
// ---------------------------------------------------------------------------

describe('SUB-EARTH-001 — Earth fault loop impedance', () => {
  it('passes when Zs <= 5.0 Ω', () => {
    const ctx = makeCtx({
      'electrical_testing.test_earth_fault_loop': { value_number: 0.8 },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-EARTH-001')
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('0.8 Ω')
    expect(r.threshold).toContain('5')
  })

  it('passes at exactly 5.0 Ω boundary', () => {
    const ctx = makeCtx({
      'electrical_testing.test_earth_fault_loop': { value_number: 5.0 },
    })
    expect(findResult(runMiniSubRules(ctx), 'SUB-EARTH-001').result).toBe('pass')
  })

  it('fails when Zs > 5.0 Ω', () => {
    const ctx = makeCtx({
      'electrical_testing.test_earth_fault_loop': { value_number: 7.2 },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-EARTH-001')
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toContain('7.2')
  })

  it('returns insufficient_data when field is missing', () => {
    const ctx = makeCtx({})
    expect(findResult(runMiniSubRules(ctx), 'SUB-EARTH-001').result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SUB-HV-WITHSTAND-001 — HV high-voltage withstand test passed
// field_id: test_hv_withstand (pass_fail)
// ---------------------------------------------------------------------------

describe('SUB-HV-WITHSTAND-001 — HV withstand test', () => {
  it('passes when pass_fail = pass', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_withstand': { pass_state: 'pass' },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-HV-WITHSTAND-001')
    expect(r.result).toBe('pass')
  })

  it('fails when pass_fail = fail', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_withstand': { pass_state: 'fail' },
    })
    const r = findResult(runMiniSubRules(ctx), 'SUB-HV-WITHSTAND-001')
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toBeTruthy()
  })

  it('returns insufficient_data when field is missing', () => {
    const ctx = makeCtx({})
    expect(findResult(runMiniSubRules(ctx), 'SUB-HV-WITHSTAND-001').result).toBe('insufficient_data')
  })

  it('returns insufficient_data when pass_state is null/not_checked', () => {
    const ctx = makeCtx({
      'electrical_testing.test_hv_withstand': { pass_state: 'not_checked' },
    })
    expect(findResult(runMiniSubRules(ctx), 'SUB-HV-WITHSTAND-001').result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// Structural: runMiniSubRules always returns exactly 6 results
// ---------------------------------------------------------------------------

describe('runMiniSubRules — structural', () => {
  it('always returns 6 rule results', () => {
    const ctx = makeCtx({})
    const results = runMiniSubRules(ctx)
    expect(results).toHaveLength(6)
    const codes = results.map((r) => r.rule_code)
    expect(codes).toContain('SUB-HV-IR-001')
    expect(codes).toContain('SUB-LV-IR-001')
    expect(codes).toContain('SUB-TURNS-RATIO-001')
    expect(codes).toContain('SUB-WINDING-R-001')
    expect(codes).toContain('SUB-EARTH-001')
    expect(codes).toContain('SUB-HV-WITHSTAND-001')
  })
})
