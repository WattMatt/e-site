import { describe, it, expect } from 'vitest'
import { runGeneratorFatRules } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/generator-fat'
import type { RuleContext, ResponseRow } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/types'

function makeCtx(fields: Record<string, number | string | null>): RuleContext {
  const responses = new Map<string, ResponseRow>()
  for (const [fieldId, val] of Object.entries(fields)) {
    const row: ResponseRow = {
      section_id: 'test',
      field_id: fieldId,
      value_number: typeof val === 'number' ? val : null,
      value_text: typeof val === 'string' ? val : null,
    }
    responses.set(`test.${fieldId}`, row)
  }
  return { responses, template: {}, inspection: { id: 'test', template_id: 'generator-fat' } }
}

// ---------------------------------------------------------------------------
// GEN-VOLT-NL-001 — No-load output voltage (207–253 V, 230 V ±10%, NRS 048)
// ---------------------------------------------------------------------------
describe('GEN-VOLT-NL-001 — no-load voltage', () => {
  it('passes at 232 V (within 230 ±10%)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_voltage_no_load: 232 }))
    const r = results.find(x => x.rule_code === 'GEN-VOLT-NL-001')!
    expect(r.result).toBe('pass')
    expect(r.measured_value).toBe('232 V')
  })

  it('fails at 200 V (below 207 V)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_voltage_no_load: 200 }))
    const r = results.find(x => x.rule_code === 'GEN-VOLT-NL-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/207/)
  })

  it('fails at 260 V (above 253 V)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_voltage_no_load: 260 }))
    const r = results.find(x => x.rule_code === 'GEN-VOLT-NL-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/253/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-VOLT-NL-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-FREQ-NL-001 — No-load output frequency (49.5–50.5 Hz)
// ---------------------------------------------------------------------------
describe('GEN-FREQ-NL-001 — no-load frequency', () => {
  it('passes at 50.0 Hz', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_frequency_no_load: 50.0 }))
    const r = results.find(x => x.rule_code === 'GEN-FREQ-NL-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 49.0 Hz (below 49.5)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_frequency_no_load: 49.0 }))
    const r = results.find(x => x.rule_code === 'GEN-FREQ-NL-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/49\.5/)
  })

  it('fails at 51.0 Hz (above 50.5)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_frequency_no_load: 51.0 }))
    const r = results.find(x => x.rule_code === 'GEN-FREQ-NL-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/50\.5/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-FREQ-NL-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-THD-001 — THD-V at full load (<= 5.0%, IEEE 519)
// ---------------------------------------------------------------------------
describe('GEN-THD-001 — total harmonic distortion', () => {
  it('passes at 3.5%', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_thd_full_load: 3.5 }))
    const r = results.find(x => x.rule_code === 'GEN-THD-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 6.0% (above 5.0%)', () => {
    const results = runGeneratorFatRules(makeCtx({ elec_thd_full_load: 6.0 }))
    const r = results.find(x => x.rule_code === 'GEN-THD-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/5\.0/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-THD-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-ATS-MAINS-GEN-001 — ATS mains→gen changeover (<= 15 s)
// ---------------------------------------------------------------------------
describe('GEN-ATS-MAINS-GEN-001 — ATS mains to gen changeover', () => {
  it('passes at 12 s', () => {
    const results = runGeneratorFatRules(makeCtx({ ats_mains_to_gen_time: 12 }))
    const r = results.find(x => x.rule_code === 'GEN-ATS-MAINS-GEN-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 20 s (above 15 s)', () => {
    const results = runGeneratorFatRules(makeCtx({ ats_mains_to_gen_time: 20 }))
    const r = results.find(x => x.rule_code === 'GEN-ATS-MAINS-GEN-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/15/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-ATS-MAINS-GEN-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-ATS-GEN-MAINS-001 — ATS gen→mains changeover (<= 15 s)
// ---------------------------------------------------------------------------
describe('GEN-ATS-GEN-MAINS-001 — ATS gen to mains changeover', () => {
  it('passes at 8 s', () => {
    const results = runGeneratorFatRules(makeCtx({ ats_gen_to_mains_time: 8 }))
    const r = results.find(x => x.rule_code === 'GEN-ATS-GEN-MAINS-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 18 s (above 15 s)', () => {
    const results = runGeneratorFatRules(makeCtx({ ats_gen_to_mains_time: 18 }))
    const r = results.find(x => x.rule_code === 'GEN-ATS-GEN-MAINS-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/15/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-ATS-GEN-MAINS-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-OIL-PRESS-001 — Oil pressure at idle (>= 2.0 bar)
// ---------------------------------------------------------------------------
describe('GEN-OIL-PRESS-001 — oil pressure at idle', () => {
  it('passes at 3.5 bar', () => {
    const results = runGeneratorFatRules(makeCtx({ engine_oil_pressure_idle: 3.5 }))
    const r = results.find(x => x.rule_code === 'GEN-OIL-PRESS-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 1.5 bar (below 2.0 bar)', () => {
    const results = runGeneratorFatRules(makeCtx({ engine_oil_pressure_idle: 1.5 }))
    const r = results.find(x => x.rule_code === 'GEN-OIL-PRESS-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/2\.0/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-OIL-PRESS-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// GEN-COOLANT-TEMP-001 — Coolant temperature at full load (<= 95°C)
// ---------------------------------------------------------------------------
describe('GEN-COOLANT-TEMP-001 — coolant temperature at full load', () => {
  it('passes at 88°C', () => {
    const results = runGeneratorFatRules(makeCtx({ engine_coolant_temp_full_load: 88 }))
    const r = results.find(x => x.rule_code === 'GEN-COOLANT-TEMP-001')!
    expect(r.result).toBe('pass')
  })

  it('fails at 100°C (above 95°C)', () => {
    const results = runGeneratorFatRules(makeCtx({ engine_coolant_temp_full_load: 100 }))
    const r = results.find(x => x.rule_code === 'GEN-COOLANT-TEMP-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/95/)
  })

  it('returns insufficient_data when missing', () => {
    const results = runGeneratorFatRules(makeCtx({}))
    const r = results.find(x => x.rule_code === 'GEN-COOLANT-TEMP-001')!
    expect(r.result).toBe('insufficient_data')
  })
})
