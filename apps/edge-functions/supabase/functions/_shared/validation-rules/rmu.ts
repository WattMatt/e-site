// SANS 60265 / IEC 62271-200 validation rules — RMU snagging deliverable type.
// Applies to templates with template_id matching 'rmu*' (e.g. rmu-snagging).
//
// Field_id mapping (from rmu-snagging.json):
//   sf6_pressure_kpa              — number, section sf6_insulation
//   sf6_minimum_per_nameplate     — number (NOT in template; rule returns not_applicable)
//   earth_electrode_resistance    — number, section earthing
//   mechanical_interlocks         — pass_fail, section interlocks
//   key_interlocks                — pass_fail, section interlocks
//   padlock_provisions            — pass_fail, section interlocks
//   hv_torque_spec                — pass_fail, section cable_terminations
//   hv_boots_intact               — pass_fail, section cable_terminations
//   label_asset_arcflash_voltage  — pass_fail, section labelling
//   label_switch_labelling        — pass_fail, section labelling
//   label_cable_id                — pass_fail, section labelling

import type { RuleContext, RuleResult, RuleRunner } from './types.ts'
import { findResponseByFieldId } from './helpers.ts'

function parseNumeric(s: unknown): number | null {
  if (s == null) return null
  const n = parseFloat(String(s))
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve the pass/fail state of a pass_fail response row.
 * Returns 'pass' | 'fail' | null (null = no recorded result).
 */
function resolvePassFail(ctx: RuleContext, ...patterns: string[]): 'pass' | 'fail' | null | 'missing' {
  const r = findResponseByFieldId(ctx, ...patterns)
  if (!r) return 'missing'
  if (r.pass_state === 'pass') return 'pass'
  if (r.pass_state === 'fail') return 'fail'
  if (r.value_bool === true) return 'pass'
  if (r.value_bool === false) return 'fail'
  return null
}

// ----------------------------------------------------------------------------
// The 5 RMU rules
// ----------------------------------------------------------------------------

const RMU_RULES: ((ctx: RuleContext) => RuleResult)[] = [

  // RMU-SF6-PRESSURE-001 — SF6 gas pressure (manufacturer-specific threshold)
  // The rmu-snagging template captures sf6_pressure_kpa but has no
  // sf6_minimum_per_nameplate field. If only pressure is present this rule
  // returns not_applicable with a "threshold not provided" note.
  // If both fields are present (custom template variant) it evaluates normally.
  (ctx) => {
    const pressureRow = findResponseByFieldId(ctx, 'sf6_pressure_kpa', 'sf6_pressure')
    const pressureVal = pressureRow?.value_number ?? null

    if (pressureVal == null) {
      return {
        rule_code: 'RMU-SF6-PRESSURE-001',
        sans_clause: 'IEC 62271-200 §6.5',
        rule_label: 'SF6 gas pressure',
        result: 'insufficient_data',
        threshold: '>= manufacturer nameplate minimum (kPa)',
        failure_reason: 'No SF6 pressure reading found',
      }
    }

    const minimumRow = findResponseByFieldId(ctx, 'sf6_minimum_per_nameplate', 'sf6_minimum')
    const minimumVal = minimumRow?.value_number ?? null

    if (minimumVal == null) {
      return {
        rule_code: 'RMU-SF6-PRESSURE-001',
        sans_clause: 'IEC 62271-200 §6.5',
        rule_label: 'SF6 gas pressure',
        result: 'not_applicable',
        measured_value: `${pressureVal} kPa`,
        threshold: '>= manufacturer nameplate minimum (kPa)',
        failure_reason:
          'minimum threshold not provided; pressure recorded but cannot be evaluated — enter sf6_minimum_per_nameplate from the unit nameplate',
      }
    }

    return {
      rule_code: 'RMU-SF6-PRESSURE-001',
      sans_clause: 'IEC 62271-200 §6.5',
      rule_label: 'SF6 gas pressure',
      result: pressureVal >= minimumVal ? 'pass' : 'fail',
      measured_value: `${pressureVal} kPa`,
      threshold: `>= ${minimumVal} kPa (nameplate minimum)`,
      failure_reason:
        pressureVal < minimumVal
          ? `Measured ${pressureVal} kPa is below nameplate minimum ${minimumVal} kPa`
          : undefined,
    }
  },

  // RMU-EARTH-001 — Earth electrode resistance <= 5.0 Ω (SANS 10142-1 §8.4)
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'earth_electrode_resistance', 'earth_electrode', 'earth_resistance')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'RMU-EARTH-001',
        sans_clause: '8.4',
        rule_label: 'Earth electrode resistance',
        result: 'insufficient_data',
        threshold: '<= 5 Ω',
        failure_reason: 'No earth electrode resistance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'RMU-EARTH-001',
      sans_clause: '8.4',
      rule_label: 'Earth electrode resistance',
      result: v <= 5.0 ? 'pass' : 'fail',
      measured_value: `${v} Ω`,
      threshold: '<= 5 Ω',
      failure_reason: v > 5.0 ? `Measured ${v} Ω exceeds 5 Ω limit` : undefined,
    }
  },

  // RMU-INTERLOCKS-001 — All mechanical interlocks pass (IEC 62271-200 §6.102)
  // Three fields: mechanical_interlocks, key_interlocks, padlock_provisions
  (ctx) => {
    const checks: Array<{ key: string; label: string }> = [
      { key: 'mechanical_interlocks', label: 'mechanical_interlocks' },
      { key: 'key_interlocks', label: 'key_interlocks' },
      { key: 'padlock_provisions', label: 'padlock_provisions' },
    ]

    const missing: string[] = []
    const failed: string[] = []

    for (const { key, label } of checks) {
      const state = resolvePassFail(ctx, key)
      if (state === 'missing' || state === null) {
        missing.push(label)
      } else if (state === 'fail') {
        failed.push(label)
      }
    }

    if (missing.length > 0) {
      return {
        rule_code: 'RMU-INTERLOCKS-001',
        sans_clause: 'IEC 62271-200 §6.102',
        rule_label: 'Mechanical interlocks',
        result: 'insufficient_data',
        threshold: 'all interlocks pass',
        failure_reason: `Missing interlock checks: ${missing.join(', ')}`,
      }
    }

    if (failed.length > 0) {
      return {
        rule_code: 'RMU-INTERLOCKS-001',
        sans_clause: 'IEC 62271-200 §6.102',
        rule_label: 'Mechanical interlocks',
        result: 'fail',
        threshold: 'all interlocks pass',
        failure_reason: `Failed interlock checks: ${failed.join(', ')}`,
      }
    }

    return {
      rule_code: 'RMU-INTERLOCKS-001',
      sans_clause: 'IEC 62271-200 §6.102',
      rule_label: 'Mechanical interlocks',
      result: 'pass',
      measured_value: '3/3 interlock checks pass',
      threshold: 'all interlocks pass',
    }
  },

  // RMU-CABLE-TERM-001 — Cable termination torque + boots (IEC 62271-200 §6.7)
  // Fields: hv_torque_spec, hv_boots_intact
  (ctx) => {
    const checks: Array<{ key: string; label: string }> = [
      { key: 'hv_torque_spec', label: 'hv_torque_spec' },
      { key: 'hv_boots_intact', label: 'hv_boots_intact' },
    ]

    const missing: string[] = []
    const failed: string[] = []

    for (const { key, label } of checks) {
      const state = resolvePassFail(ctx, key)
      if (state === 'missing' || state === null) {
        missing.push(label)
      } else if (state === 'fail') {
        failed.push(label)
      }
    }

    if (missing.length === checks.length) {
      return {
        rule_code: 'RMU-CABLE-TERM-001',
        sans_clause: 'IEC 62271-200 §6.7',
        rule_label: 'Cable termination torque and boots',
        result: 'insufficient_data',
        threshold: 'torque to spec and boots intact',
        failure_reason: 'No cable termination checks found',
      }
    }

    if (missing.length > 0) {
      return {
        rule_code: 'RMU-CABLE-TERM-001',
        sans_clause: 'IEC 62271-200 §6.7',
        rule_label: 'Cable termination torque and boots',
        result: 'insufficient_data',
        threshold: 'torque to spec and boots intact',
        failure_reason: `Missing termination checks: ${missing.join(', ')}`,
      }
    }

    if (failed.length > 0) {
      return {
        rule_code: 'RMU-CABLE-TERM-001',
        sans_clause: 'IEC 62271-200 §6.7',
        rule_label: 'Cable termination torque and boots',
        result: 'fail',
        threshold: 'torque to spec and boots intact',
        failure_reason: `Failed termination checks: ${failed.join(', ')}`,
      }
    }

    return {
      rule_code: 'RMU-CABLE-TERM-001',
      sans_clause: 'IEC 62271-200 §6.7',
      rule_label: 'Cable termination torque and boots',
      result: 'pass',
      measured_value: '2/2 termination checks pass',
      threshold: 'torque to spec and boots intact',
    }
  },

  // RMU-LABEL-001 — Asset + warning labels present (IEC 62271-1 §5.2)
  // Fields: label_asset_arcflash_voltage, label_switch_labelling, label_cable_id
  (ctx) => {
    const checks: Array<{ key: string; label: string }> = [
      { key: 'label_asset_arcflash_voltage', label: 'label_asset_arcflash_voltage' },
      { key: 'label_switch_labelling', label: 'label_switch_labelling' },
      { key: 'label_cable_id', label: 'label_cable_id' },
    ]

    const missing: string[] = []
    const failed: string[] = []

    for (const { key, label } of checks) {
      const state = resolvePassFail(ctx, key)
      if (state === 'missing' || state === null) {
        missing.push(label)
      } else if (state === 'fail') {
        failed.push(label)
      }
    }

    if (missing.length === checks.length) {
      return {
        rule_code: 'RMU-LABEL-001',
        sans_clause: 'IEC 62271-1 §5.2',
        rule_label: 'Asset and warning labels',
        result: 'insufficient_data',
        threshold: 'all label checks pass',
        failure_reason: 'No label checks found',
      }
    }

    if (missing.length > 0) {
      return {
        rule_code: 'RMU-LABEL-001',
        sans_clause: 'IEC 62271-1 §5.2',
        rule_label: 'Asset and warning labels',
        result: 'insufficient_data',
        threshold: 'all label checks pass',
        failure_reason: `Missing label checks: ${missing.join(', ')}`,
      }
    }

    if (failed.length > 0) {
      return {
        rule_code: 'RMU-LABEL-001',
        sans_clause: 'IEC 62271-1 §5.2',
        rule_label: 'Asset and warning labels',
        result: 'fail',
        threshold: 'all label checks pass',
        failure_reason: `Failed label checks: ${failed.join(', ')}`,
      }
    }

    return {
      rule_code: 'RMU-LABEL-001',
      sans_clause: 'IEC 62271-1 §5.2',
      rule_label: 'Asset and warning labels',
      result: 'pass',
      measured_value: '3/3 label checks pass',
      threshold: 'all label checks pass',
    }
  },
]

/** Run all 5 RMU validation rules against the given context. */
export const runRmuRules: RuleRunner = (ctx) => RMU_RULES.map((rule) => rule(ctx))
