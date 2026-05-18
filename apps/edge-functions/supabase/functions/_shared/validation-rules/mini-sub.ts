// Miniature Substation Pre/Post FAT validation rules.
// Template: mini-sub-pre-post-fat (IEC 61439 / IEC 60076-1 / IEC 60502 / SANS 10142-1)
//
// 6 rules evaluated against inspections.responses for this deliverable type.
//
// Field-id sources: mini-sub-pre-post-fat.json (section electrical_testing):
//   test_hv_insulation_resistance  — number, MΩ
//   test_lv_insulation_resistance  — number, MΩ
//   test_turns_ratio               — number (measured)
//   test_turns_ratio_pass_fail     — pass_fail (explicit ±0.5% judgement)
//   test_winding_resistance_hv     — number, Ω (measured only; no declared field in template)
//   test_earth_fault_loop          — number, Ω (Zs at LV incomer)
//   test_hv_withstand              — pass_fail

import type { RuleContext, RuleResult, RuleRunner } from './types.ts'
import { findResponseByFieldId } from './helpers.ts'

const MINI_SUB_RULES: ((ctx: RuleContext) => RuleResult)[] = [
  // SUB-HV-IR-001 — HV insulation resistance >= 1000 MΩ at 5 kV DC
  // Standard: IEC 60502-2 §8.7 (minimum 1000 MΩ for MV cable insulation at 5 kV)
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'test_hv_insulation_resistance', 'hv_insulation_resistance')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'SUB-HV-IR-001',
        sans_clause: 'IEC 60502 §8.7 / IEC 61439 §10.9',
        rule_label: 'HV insulation resistance',
        result: 'insufficient_data',
        threshold: '>= 1000 MΩ',
        failure_reason: 'No HV insulation resistance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'SUB-HV-IR-001',
      sans_clause: 'IEC 60502 §8.7 / IEC 61439 §10.9',
      rule_label: 'HV insulation resistance',
      result: v >= 1000 ? 'pass' : 'fail',
      measured_value: `${v} MΩ`,
      threshold: '>= 1000 MΩ',
      failure_reason: v < 1000 ? `Measured ${v} MΩ below 1000 MΩ minimum (IEC 60502)` : undefined,
    }
  },

  // SUB-LV-IR-001 — LV insulation resistance >= 1.0 MΩ at 500 V DC
  // Standard: SANS 10142-1 §8.7
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'test_lv_insulation_resistance', 'lv_insulation_resistance')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'SUB-LV-IR-001',
        sans_clause: 'SANS 10142-1 §8.7',
        rule_label: 'LV insulation resistance',
        result: 'insufficient_data',
        threshold: '>= 1.0 MΩ',
        failure_reason: 'No LV insulation resistance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'SUB-LV-IR-001',
      sans_clause: 'SANS 10142-1 §8.7',
      rule_label: 'LV insulation resistance',
      result: v >= 1.0 ? 'pass' : 'fail',
      measured_value: `${v} MΩ`,
      threshold: '>= 1.0 MΩ',
      failure_reason: v < 1.0 ? `Measured ${v} MΩ below 1.0 MΩ minimum (SANS 10142-1)` : undefined,
    }
  },

  // SUB-TURNS-RATIO-001 — Transformer turns ratio within ±0.5% of nameplate
  // Standard: IEC 60076-1 §8.6
  //
  // Resolution: the template provides a dedicated `test_turns_ratio_pass_fail` field
  // where the engineer records whether the measured ratio is within ±0.5%.  We read
  // that explicit judgement first.  If absent (pre-certification capture in progress)
  // we fall back to `test_turns_ratio` (the numeric measured value) and report
  // insufficient_data when no nameplate reference is available in the template.
  (ctx) => {
    const passFail = findResponseByFieldId(ctx, 'test_turns_ratio_pass_fail', 'turns_ratio_pass_fail')
    const measured = findResponseByFieldId(ctx, 'test_turns_ratio', 'turns_ratio')

    // Primary: explicit pass_fail judgement by the engineer
    if (passFail && (passFail.pass_state === 'pass' || passFail.pass_state === 'fail')) {
      const isPass = passFail.pass_state === 'pass'
      return {
        rule_code: 'SUB-TURNS-RATIO-001',
        sans_clause: 'IEC 60076-1 §8.6',
        rule_label: 'Transformer turns ratio (±0.5%)',
        result: isPass ? 'pass' : 'fail',
        measured_value: measured?.value_number != null ? `${measured.value_number}:1` : passFail.pass_state,
        threshold: 'within ±0.5% of nameplate ratio',
        failure_reason: isPass ? undefined : 'Measured turns ratio outside ±0.5% of nameplate declared ratio',
      }
    }

    // Fallback: measured numeric present but no explicit pass_fail judgement yet
    if (measured?.value_number != null) {
      return {
        rule_code: 'SUB-TURNS-RATIO-001',
        sans_clause: 'IEC 60076-1 §8.6',
        rule_label: 'Transformer turns ratio (±0.5%)',
        result: 'insufficient_data',
        measured_value: `${measured.value_number}:1`,
        threshold: 'within ±0.5% of nameplate ratio',
        failure_reason: 'Nameplate ratio not recorded — engineer must complete test_turns_ratio_pass_fail field',
      }
    }

    return {
      rule_code: 'SUB-TURNS-RATIO-001',
      sans_clause: 'IEC 60076-1 §8.6',
      rule_label: 'Transformer turns ratio (±0.5%)',
      result: 'insufficient_data',
      threshold: 'within ±0.5% of nameplate ratio',
      failure_reason: 'No turns ratio measurement or pass/fail judgement found',
    }
  },

  // SUB-WINDING-R-001 — HV winding resistance within ±1% of declared value
  // Standard: IEC 60076-1
  //
  // The mini-sub-pre-post-fat template records only the measured winding resistance
  // (test_winding_resistance_hv).  There is no "declared" or "factory baseline" field
  // in the template, so an automated ±1% comparison cannot be made.  When the measured
  // value IS present, the rule is not_applicable (inspection captured; comparison
  // deferred to reviewer against the manufacturer's factory test report).  When the
  // measured value is entirely absent, return insufficient_data.
  (ctx) => {
    const measured = findResponseByFieldId(ctx, 'test_winding_resistance_hv', 'winding_resistance_hv')

    if (!measured || measured.value_number == null) {
      return {
        rule_code: 'SUB-WINDING-R-001',
        sans_clause: 'IEC 60076-1',
        rule_label: 'HV winding resistance (±1% of declared)',
        result: 'insufficient_data',
        threshold: 'within ±1% of manufacturer declared value',
        failure_reason: 'No HV winding resistance measurement found',
      }
    }

    return {
      rule_code: 'SUB-WINDING-R-001',
      sans_clause: 'IEC 60076-1',
      rule_label: 'HV winding resistance (±1% of declared)',
      result: 'not_applicable',
      measured_value: `${measured.value_number} Ω`,
      threshold: 'within ±1% of manufacturer declared value',
      failure_reason: 'Template does not include a declared baseline field — verify manually against manufacturer factory test report',
    }
  },

  // SUB-EARTH-001 — Earth fault loop impedance (Zs) at LV incomer <= 5.0 Ω
  // Standard: SANS 10142-1 §8.9
  //
  // The template uses test_earth_fault_loop (Zs at LV incomer).
  // The 5 Ω limit aligns with the SANS 10142-1 maximum earth-electrode resistance
  // for TT systems.  For TN systems the Zs limit depends on the protective device,
  // but 5 Ω is a conservative cross-system bound appropriate for a FAT rule.
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'test_earth_fault_loop', 'earth_fault_loop', 'earth_fault')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'SUB-EARTH-001',
        sans_clause: 'SANS 10142-1 §8.9',
        rule_label: 'Earth fault loop impedance (Zs)',
        result: 'insufficient_data',
        threshold: '<= 5.0 Ω',
        failure_reason: 'No earth fault loop impedance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'SUB-EARTH-001',
      sans_clause: 'SANS 10142-1 §8.9',
      rule_label: 'Earth fault loop impedance (Zs)',
      result: v <= 5.0 ? 'pass' : 'fail',
      measured_value: `${v} Ω`,
      threshold: '<= 5.0 Ω',
      failure_reason: v > 5.0 ? `Measured Zs ${v} Ω exceeds 5.0 Ω limit` : undefined,
    }
  },

  // SUB-HV-WITHSTAND-001 — HV high-voltage withstand test passed
  // Standard: IEC 61439 §10.9.2
  //
  // Reads test_hv_withstand (pass_fail).  Only 'pass' → pass; 'fail' → fail;
  // anything else (null, not_checked, missing) → insufficient_data.
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'test_hv_withstand', 'hv_withstand')

    if (!r) {
      return {
        rule_code: 'SUB-HV-WITHSTAND-001',
        sans_clause: 'IEC 61439 §10.9.2',
        rule_label: 'HV high-voltage withstand test',
        result: 'insufficient_data',
        threshold: 'pass — no flashover/breakdown at rated withstand voltage',
        failure_reason: 'No HV withstand test result found',
      }
    }

    if (r.pass_state === 'pass') {
      return {
        rule_code: 'SUB-HV-WITHSTAND-001',
        sans_clause: 'IEC 61439 §10.9.2',
        rule_label: 'HV high-voltage withstand test',
        result: 'pass',
        measured_value: 'pass',
        threshold: 'pass — no flashover/breakdown at rated withstand voltage',
      }
    }

    if (r.pass_state === 'fail') {
      return {
        rule_code: 'SUB-HV-WITHSTAND-001',
        sans_clause: 'IEC 61439 §10.9.2',
        rule_label: 'HV high-voltage withstand test',
        result: 'fail',
        measured_value: 'fail',
        threshold: 'pass — no flashover/breakdown at rated withstand voltage',
        failure_reason: r.fail_reason ?? 'HV withstand test failed — flashover or breakdown detected',
      }
    }

    // null, 'not_checked', 'na' — test not yet performed
    return {
      rule_code: 'SUB-HV-WITHSTAND-001',
      sans_clause: 'IEC 61439 §10.9.2',
      rule_label: 'HV high-voltage withstand test',
      result: 'insufficient_data',
      threshold: 'pass — no flashover/breakdown at rated withstand voltage',
      failure_reason: 'HV withstand test has no recorded result',
    }
  },
]

/** Run all 6 Mini-Sub FAT validation rules against the given context. */
export const runMiniSubRules: RuleRunner = (ctx) => MINI_SUB_RULES.map((rule) => rule(ctx))
