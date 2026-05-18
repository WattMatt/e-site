// Generator FAT validation rules — ISO 8528-5 / IEEE 519 / NRS 048
// Applies to templates with deliverable_type = 'factory_test' and template_id = 'generator-fat'.
//
// 7 rules covering no-load voltage, no-load frequency, THD, ATS changeover (both directions),
// oil pressure at idle, and coolant temperature at full load.
//
// Field_id substrings used (matched against actual generator-fat.json field_ids):
//   'elec_voltage_no_load'    → electrical_testing.elec_voltage_no_load
//   'elec_frequency_no_load'  → electrical_testing.elec_frequency_no_load
//   'elec_thd_full_load'      → electrical_testing.elec_thd_full_load
//   'ats_mains_to_gen_time'   → ats.ats_mains_to_gen_time
//   'ats_gen_to_mains_time'   → ats.ats_gen_to_mains_time
//   'engine_oil_pressure_idle'     → engine_testing.engine_oil_pressure_idle
//   'engine_coolant_temp_full_load' → engine_testing.engine_coolant_temp_full_load

import type { RuleContext, RuleResult, RuleRunner } from './types.ts'
import { findResponseByFieldId } from './helpers.ts'

function parseNumeric(row: ReturnType<typeof findResponseByFieldId>): number | null {
  if (row == null) return null
  if (row.value_number != null) return row.value_number
  // Fall back to value_text for string-encoded numbers (e.g. from mobile capture)
  if (row.value_text != null && row.value_text.trim() !== '') {
    const n = parseFloat(row.value_text)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const GEN_FAT_RULES: ((ctx: RuleContext) => RuleResult)[] = [
  // GEN-VOLT-NL-001 — No-load output voltage 207–253 V (230 V ±10%, NRS 048)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'elec_voltage_no_load')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-VOLT-NL-001',
        sans_clause: 'NRS 048',
        rule_label: 'No-load output voltage',
        result: 'insufficient_data',
        threshold: '207 V ≤ V ≤ 253 V (230 V ±10%)',
        failure_reason: 'No-load output voltage response missing',
      }
    }
    if (v < 207 || v > 253) {
      return {
        rule_code: 'GEN-VOLT-NL-001',
        sans_clause: 'NRS 048',
        rule_label: 'No-load output voltage',
        result: 'fail',
        measured_value: `${v} V`,
        threshold: '207 V ≤ V ≤ 253 V (230 V ±10%)',
        failure_reason: `Measured ${v} V is outside the ±10% band; required 207–253 V per NRS 048`,
      }
    }
    return {
      rule_code: 'GEN-VOLT-NL-001',
      sans_clause: 'NRS 048',
      rule_label: 'No-load output voltage',
      result: 'pass',
      measured_value: `${v} V`,
      threshold: '207 V ≤ V ≤ 253 V (230 V ±10%)',
    }
  },

  // GEN-FREQ-NL-001 — No-load output frequency 49.5–50.5 Hz (NRS 048)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'elec_frequency_no_load')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-FREQ-NL-001',
        sans_clause: 'NRS 048',
        rule_label: 'No-load output frequency',
        result: 'insufficient_data',
        threshold: '49.5 Hz ≤ f ≤ 50.5 Hz',
        failure_reason: 'No-load output frequency response missing',
      }
    }
    if (v < 49.5 || v > 50.5) {
      return {
        rule_code: 'GEN-FREQ-NL-001',
        sans_clause: 'NRS 048',
        rule_label: 'No-load output frequency',
        result: 'fail',
        measured_value: `${v} Hz`,
        threshold: '49.5 Hz ≤ f ≤ 50.5 Hz',
        failure_reason: `Measured ${v} Hz is outside the ±1% band; required 49.5–50.5 Hz per NRS 048`,
      }
    }
    return {
      rule_code: 'GEN-FREQ-NL-001',
      sans_clause: 'NRS 048',
      rule_label: 'No-load output frequency',
      result: 'pass',
      measured_value: `${v} Hz`,
      threshold: '49.5 Hz ≤ f ≤ 50.5 Hz',
    }
  },

  // GEN-THD-001 — Total harmonic distortion at full load <= 5.0% (IEEE 519 §5.1)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'elec_thd_full_load')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-THD-001',
        sans_clause: 'IEEE 519 §5.1',
        rule_label: 'Total harmonic distortion at full load',
        result: 'insufficient_data',
        threshold: '<= 5.0% THD-V',
        failure_reason: 'THD full-load response missing',
      }
    }
    if (v > 5.0) {
      return {
        rule_code: 'GEN-THD-001',
        sans_clause: 'IEEE 519 §5.1',
        rule_label: 'Total harmonic distortion at full load',
        result: 'fail',
        measured_value: `${v}%`,
        threshold: '<= 5.0% THD-V',
        failure_reason: `Measured THD-V ${v}% exceeds 5.0% limit per IEEE 519`,
      }
    }
    return {
      rule_code: 'GEN-THD-001',
      sans_clause: 'IEEE 519 §5.1',
      rule_label: 'Total harmonic distortion at full load',
      result: 'pass',
      measured_value: `${v}%`,
      threshold: '<= 5.0% THD-V',
    }
  },

  // GEN-ATS-MAINS-GEN-001 — ATS mains→gen changeover <= 15 s (ISO 8528-5 §11.1 / NRS 048-9)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'ats_mains_to_gen_time')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-ATS-MAINS-GEN-001',
        sans_clause: 'ISO 8528-5 §11.1',
        rule_label: 'ATS mains-to-gen changeover time',
        result: 'insufficient_data',
        threshold: '<= 15 s',
        failure_reason: 'ATS mains-to-gen changeover time response missing',
      }
    }
    if (v > 15) {
      return {
        rule_code: 'GEN-ATS-MAINS-GEN-001',
        sans_clause: 'ISO 8528-5 §11.1',
        rule_label: 'ATS mains-to-gen changeover time',
        result: 'fail',
        measured_value: `${v} s`,
        threshold: '<= 15 s',
        failure_reason: `Measured changeover time ${v} s exceeds 15 s limit per NRS 048-9`,
      }
    }
    return {
      rule_code: 'GEN-ATS-MAINS-GEN-001',
      sans_clause: 'ISO 8528-5 §11.1',
      rule_label: 'ATS mains-to-gen changeover time',
      result: 'pass',
      measured_value: `${v} s`,
      threshold: '<= 15 s',
    }
  },

  // GEN-ATS-GEN-MAINS-001 — ATS gen→mains changeover <= 15 s (ISO 8528-5 §11.2)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'ats_gen_to_mains_time')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-ATS-GEN-MAINS-001',
        sans_clause: 'ISO 8528-5 §11.2',
        rule_label: 'ATS gen-to-mains changeover time',
        result: 'insufficient_data',
        threshold: '<= 15 s',
        failure_reason: 'ATS gen-to-mains changeover time response missing',
      }
    }
    if (v > 15) {
      return {
        rule_code: 'GEN-ATS-GEN-MAINS-001',
        sans_clause: 'ISO 8528-5 §11.2',
        rule_label: 'ATS gen-to-mains changeover time',
        result: 'fail',
        measured_value: `${v} s`,
        threshold: '<= 15 s',
        failure_reason: `Measured return-to-mains time ${v} s exceeds 15 s limit per ISO 8528-5`,
      }
    }
    return {
      rule_code: 'GEN-ATS-GEN-MAINS-001',
      sans_clause: 'ISO 8528-5 §11.2',
      rule_label: 'ATS gen-to-mains changeover time',
      result: 'pass',
      measured_value: `${v} s`,
      threshold: '<= 15 s',
    }
  },

  // GEN-OIL-PRESS-001 — Oil pressure at idle >= 2.0 bar (ISO 8528-5 §7.3.1)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'engine_oil_pressure_idle')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-OIL-PRESS-001',
        sans_clause: 'ISO 8528-5 §7.3.1',
        rule_label: 'Oil pressure at idle',
        result: 'insufficient_data',
        threshold: '>= 2.0 bar',
        failure_reason: 'Oil pressure at idle response missing',
      }
    }
    if (v < 2.0) {
      return {
        rule_code: 'GEN-OIL-PRESS-001',
        sans_clause: 'ISO 8528-5 §7.3.1',
        rule_label: 'Oil pressure at idle',
        result: 'fail',
        measured_value: `${v} bar`,
        threshold: '>= 2.0 bar',
        failure_reason: `Measured oil pressure ${v} bar is below the 2.0 bar minimum per ISO 8528-5`,
      }
    }
    return {
      rule_code: 'GEN-OIL-PRESS-001',
      sans_clause: 'ISO 8528-5 §7.3.1',
      rule_label: 'Oil pressure at idle',
      result: 'pass',
      measured_value: `${v} bar`,
      threshold: '>= 2.0 bar',
    }
  },

  // GEN-COOLANT-TEMP-001 — Coolant temperature at full load <= 95°C (ISO 8528-5 §7.3.2)
  (ctx) => {
    const row = findResponseByFieldId(ctx, 'engine_coolant_temp_full_load')
    const v = parseNumeric(row)
    if (v === null) {
      return {
        rule_code: 'GEN-COOLANT-TEMP-001',
        sans_clause: 'ISO 8528-5 §7.3.2',
        rule_label: 'Coolant temperature at full load',
        result: 'insufficient_data',
        threshold: '<= 95°C',
        failure_reason: 'Coolant temperature at full load response missing',
      }
    }
    if (v > 95) {
      return {
        rule_code: 'GEN-COOLANT-TEMP-001',
        sans_clause: 'ISO 8528-5 §7.3.2',
        rule_label: 'Coolant temperature at full load',
        result: 'fail',
        measured_value: `${v}°C`,
        threshold: '<= 95°C',
        failure_reason: `Measured coolant temperature ${v}°C exceeds 95°C limit per ISO 8528-5`,
      }
    }
    return {
      rule_code: 'GEN-COOLANT-TEMP-001',
      sans_clause: 'ISO 8528-5 §7.3.2',
      rule_label: 'Coolant temperature at full load',
      result: 'pass',
      measured_value: `${v}°C`,
      threshold: '<= 95°C',
    }
  },
]

/** Run all 7 Generator FAT rules against the given context. */
export const runGeneratorFatRules: RuleRunner = (ctx) => GEN_FAT_RULES.map((rule) => rule(ctx))
