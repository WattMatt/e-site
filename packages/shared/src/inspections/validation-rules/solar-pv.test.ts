import { describe, it, expect } from 'vitest'
import { runSolarPvRules } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/solar-pv'
import type { RuleContext, ResponseRow } from '../../../../../apps/edge-functions/supabase/functions/_shared/validation-rules/types'

// ---------------------------------------------------------------------------
// Test context builder
// ---------------------------------------------------------------------------

/**
 * Build a RuleContext from a flat field map.
 * Keys must be fully qualified: `${section_id}.${field_id}`.
 * Values: number → value_number; 'pass'|'fail' → pass_state + value_bool;
 *         other strings → value_text.
 */
function makeCtx(fields: Record<string, number | 'pass' | 'fail' | string | null>): RuleContext {
  const responses = new Map<string, ResponseRow>()
  for (const [key, val] of Object.entries(fields)) {
    const parts = key.split('.')
    const field_id = parts.slice(1).join('.')
    const section_id = parts[0]
    let row: ResponseRow = { section_id, field_id, value_number: null }
    if (val === 'pass') {
      row = { ...row, pass_state: 'pass', value_bool: true }
    } else if (val === 'fail') {
      row = { ...row, pass_state: 'fail', value_bool: false }
    } else if (typeof val === 'number') {
      row = { ...row, value_number: val }
    } else if (typeof val === 'string') {
      row = { ...row, value_text: val }
    }
    responses.set(key, row)
  }
  return { responses, template: {}, inspection: { id: 'test', template_id: 'solar-pv-standalone' } }
}

/** Build repeating-group entries for string_tests. Each entry: { voc?, isc?, dc_insulation_mohm?, voc_declared?, isc_declared? } */
function makeStringCtx(
  strings: Array<{
    voc?: number
    isc?: number
    dc_insulation_mohm?: number
    voc_declared?: number
    isc_declared?: number
  }>,
): RuleContext {
  const fields: Record<string, number | string | null> = {}
  strings.forEach((s, i) => {
    if (s.voc !== undefined) fields[`string_testing.string_tests[${i}].voc`] = s.voc
    if (s.isc !== undefined) fields[`string_testing.string_tests[${i}].isc`] = s.isc
    if (s.dc_insulation_mohm !== undefined) fields[`string_testing.string_tests[${i}].dc_insulation_mohm`] = s.dc_insulation_mohm
    if (s.voc_declared !== undefined) fields[`string_testing.string_tests[${i}].voc_declared`] = s.voc_declared
    if (s.isc_declared !== undefined) fields[`string_testing.string_tests[${i}].isc_declared`] = s.isc_declared
  })
  return makeCtx(fields)
}

// ---------------------------------------------------------------------------
// SOLAR-STRING-VOC-001 — String Voc within ±5% of declared
// ---------------------------------------------------------------------------
describe('SOLAR-STRING-VOC-001 — string Voc within ±5% of declared', () => {
  it('passes when all strings are within ±5% (2 strings)', () => {
    const ctx = makeStringCtx([
      { voc: 38.0, voc_declared: 38.5 }, // 1.3% deviation — pass
      { voc: 39.0, voc_declared: 38.5 }, // 1.3% deviation — pass
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-VOC-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when any string exceeds ±5% (string [1] at 8% off)', () => {
    const ctx = makeStringCtx([
      { voc: 38.0, voc_declared: 38.5 }, // within tolerance
      { voc: 35.0, voc_declared: 38.5 }, // ~9.1% deviation — fail
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-VOC-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/string_tests\[1\]/)
  })

  it('returns insufficient_data when zero strings recorded', () => {
    const ctx = makeStringCtx([])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-VOC-001')!
    expect(r.result).toBe('insufficient_data')
  })

  it('returns not_applicable when string has voc but no voc_declared', () => {
    const ctx = makeStringCtx([
      { voc: 38.0 }, // no declared value
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-VOC-001')!
    expect(r.result).toBe('not_applicable')
  })
})

// ---------------------------------------------------------------------------
// SOLAR-STRING-ISC-001 — String Isc within ±5% of declared
// ---------------------------------------------------------------------------
describe('SOLAR-STRING-ISC-001 — string Isc within ±5% of declared', () => {
  it('passes when all strings are within ±5% (2 strings)', () => {
    const ctx = makeStringCtx([
      { isc: 9.8, isc_declared: 10.0 },  // 2% deviation — pass
      { isc: 10.1, isc_declared: 10.0 }, // 1% deviation — pass
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-ISC-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when any string exceeds ±5% (string [1] at ~11% off)', () => {
    const ctx = makeStringCtx([
      { isc: 9.8, isc_declared: 10.0 }, // within tolerance
      { isc: 8.9, isc_declared: 10.0 }, // 11% deviation — fail
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-ISC-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/string_tests\[1\]/)
  })

  it('returns insufficient_data when zero strings recorded', () => {
    const ctx = makeStringCtx([])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-ISC-001')!
    expect(r.result).toBe('insufficient_data')
  })

  it('returns not_applicable when string has isc but no isc_declared', () => {
    const ctx = makeStringCtx([
      { isc: 9.8 }, // no declared value
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-STRING-ISC-001')!
    expect(r.result).toBe('not_applicable')
  })
})

// ---------------------------------------------------------------------------
// SOLAR-DC-IR-001 — DC string insulation resistance >= 0.5 MΩ
// ---------------------------------------------------------------------------
describe('SOLAR-DC-IR-001 — DC insulation resistance >= 0.5 MΩ', () => {
  it('passes when all strings >= 0.5 MΩ', () => {
    const ctx = makeStringCtx([
      { dc_insulation_mohm: 1.2 },
      { dc_insulation_mohm: 0.8 },
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-IR-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when any string < 0.5 MΩ', () => {
    const ctx = makeStringCtx([
      { dc_insulation_mohm: 1.0 },
      { dc_insulation_mohm: 0.3 }, // below threshold
    ])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-IR-001')!
    expect(r.result).toBe('fail')
    expect(r.failure_reason).toMatch(/0\.3/)
  })

  it('returns insufficient_data when zero strings recorded', () => {
    const ctx = makeStringCtx([])
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-IR-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SOLAR-DC-ISO-001 — DC isolation switch operates
// ---------------------------------------------------------------------------
describe('SOLAR-DC-ISO-001 — DC isolators installed (load-break rated)', () => {
  it('passes when dc_isolators_installed = pass', () => {
    const ctx = makeCtx({ 'dc_wiring.dc_isolators_installed': 'pass' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-ISO-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when dc_isolators_installed = fail', () => {
    const ctx = makeCtx({ 'dc_wiring.dc_isolators_installed': 'fail' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-ISO-001')!
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when field absent', () => {
    const ctx = makeCtx({})
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-DC-ISO-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SOLAR-EARTH-001 — Module frames bonded (equipotential)
// ---------------------------------------------------------------------------
describe('SOLAR-EARTH-001 — module frames bonded (equipotential)', () => {
  it('passes when earth_module_frames_bonded = pass', () => {
    const ctx = makeCtx({ 'earthing.earth_module_frames_bonded': 'pass' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-EARTH-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when earth_module_frames_bonded = fail', () => {
    const ctx = makeCtx({ 'earthing.earth_module_frames_bonded': 'fail' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-EARTH-001')!
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when field absent', () => {
    const ctx = makeCtx({})
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-EARTH-001')!
    expect(r.result).toBe('insufficient_data')
  })
})

// ---------------------------------------------------------------------------
// SOLAR-AC-NRS097-001 — AC connection compliant per NRS 097-2-1
// ---------------------------------------------------------------------------
describe('SOLAR-AC-NRS097-001 — AC connection point compliant (NRS 097-2-1 anti-islanding)', () => {
  it('passes when ac_connection_compliant = pass', () => {
    const ctx = makeCtx({ 'ac_side.ac_connection_compliant': 'pass' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-AC-NRS097-001')!
    expect(r.result).toBe('pass')
  })

  it('fails when ac_connection_compliant = fail', () => {
    const ctx = makeCtx({ 'ac_side.ac_connection_compliant': 'fail' })
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-AC-NRS097-001')!
    expect(r.result).toBe('fail')
  })

  it('returns insufficient_data when field absent', () => {
    const ctx = makeCtx({})
    const r = runSolarPvRules(ctx).find(x => x.rule_code === 'SOLAR-AC-NRS097-001')!
    expect(r.result).toBe('insufficient_data')
  })
})
