// SANS 10142-3 / NRS 097-2-1 validation rules — Solar PV deliverable type.
//
// Applies to templates with deliverable_type = 'solar_pv' (or similar):
//   solar-pv-standalone
//
// Repeating-group field_id pattern (string_tests entries):
//   `string_testing.string_tests[<i>].<sub_field_id>`
//
// Rules:
//   SOLAR-STRING-VOC-001  String Voc within ±5% of declared (STC) — SANS 10142-3 / IEC 62548 §12.1
//   SOLAR-STRING-ISC-001  String Isc within ±5% of declared (STC) — SANS 10142-3 / IEC 62548 §12.1
//   SOLAR-DC-IR-001       DC string insulation resistance >= 0.5 MΩ — IEC 62548 §12.3
//   SOLAR-DC-ISO-001      DC isolation switch installed and load-break rated — SANS 10142-3 §7.4
//   SOLAR-EARTH-001       Module frames bonded (equipotential) — SANS 10142-3 §8 / IEC 62548 §8
//   SOLAR-AC-NRS097-001   AC connection compliant per NRS 097-2-1 (anti-islanding) — NRS 097-2-1 §5

import type { RuleContext, RuleResult, RuleRunner } from './types.ts'
import { findResponseByFieldId } from './helpers.ts'

// ---------------------------------------------------------------------------
// Repeating-group helpers
// ---------------------------------------------------------------------------

/** Pattern matching `string_tests[<index>].<sub_field>` in the full map key. */
const STRING_TESTS_RE = /^[^.]+\.string_tests\[(\d+)\]\.([^.]+)$/

/** Collect all sub-field values for each string index. Returns a Map<index, Map<subField, value>>. */
function collectStringEntries(
  ctx: RuleContext,
  subField: string,
): Map<number, number | null> {
  const entries = new Map<number, number | null>()
  for (const [key, row] of ctx.responses.entries()) {
    const m = STRING_TESTS_RE.exec(key)
    if (!m) continue
    const idx = parseInt(m[1], 10)
    const sf = m[2]
    if (sf === subField) {
      entries.set(idx, row.value_number ?? null)
    }
  }
  return entries
}

/**
 * Collect paired sub-field values for each string index.
 * Returns a Map<index, { measured: number|null; declared: number|null }>.
 */
function collectStringPairs(
  ctx: RuleContext,
  measuredField: string,
  declaredField: string,
): Map<number, { measured: number | null; declared: number | null }> {
  // Build a full set of indices first, then populate
  const indicesWithMeasured = new Set<number>()
  const indicesWithDeclared = new Set<number>()

  for (const key of ctx.responses.keys()) {
    const m = STRING_TESTS_RE.exec(key)
    if (!m) continue
    const idx = parseInt(m[1], 10)
    if (m[2] === measuredField) indicesWithMeasured.add(idx)
    if (m[2] === declaredField) indicesWithDeclared.add(idx)
  }

  const allIndices = new Set([...indicesWithMeasured, ...indicesWithDeclared])
  const result = new Map<number, { measured: number | null; declared: number | null }>()

  for (const idx of allIndices) {
    const measuredKey = [...ctx.responses.keys()].find(
      (k) => STRING_TESTS_RE.exec(k)?.[1] === String(idx) && STRING_TESTS_RE.exec(k)?.[2] === measuredField,
    )
    const declaredKey = [...ctx.responses.keys()].find(
      (k) => STRING_TESTS_RE.exec(k)?.[1] === String(idx) && STRING_TESTS_RE.exec(k)?.[2] === declaredField,
    )
    result.set(idx, {
      measured: measuredKey ? (ctx.responses.get(measuredKey)?.value_number ?? null) : null,
      declared: declaredKey ? (ctx.responses.get(declaredKey)?.value_number ?? null) : null,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Shared ±5% string measurement rule factory
// ---------------------------------------------------------------------------

function runStringToleranceRule(
  ctx: RuleContext,
  ruleCode: string,
  sansClause: string,
  ruleLabel: string,
  unit: string,
  measuredField: string,
  declaredField: string,
): RuleResult {
  const pairs = collectStringPairs(ctx, measuredField, declaredField)

  if (pairs.size === 0) {
    return {
      rule_code: ruleCode,
      sans_clause: sansClause,
      rule_label: ruleLabel,
      result: 'insufficient_data',
      threshold: 'within ±5% of declared STC value',
      failure_reason: 'No string test entries recorded',
    }
  }

  // If every entry has no declared value → not_applicable
  const allLackDeclared = [...pairs.values()].every((p) => p.declared == null)
  if (allLackDeclared) {
    return {
      rule_code: ruleCode,
      sans_clause: sansClause,
      rule_label: ruleLabel,
      result: 'not_applicable',
      threshold: 'within ±5% of declared STC value',
      failure_reason: `No declared ${unit} values present — cannot assess tolerance`,
    }
  }

  type StringOutcome = { index: number; deviation: number | null; pass: boolean; note: string }
  const outcomes: StringOutcome[] = []

  for (const [idx, { measured, declared }] of [...pairs.entries()].sort(([a], [b]) => a - b)) {
    if (declared == null) {
      outcomes.push({ index: idx, deviation: null, pass: true, note: 'no declared value — skipped' })
      continue
    }
    if (measured == null) {
      outcomes.push({ index: idx, deviation: null, pass: false, note: 'missing measured value' })
      continue
    }
    const deviation = Math.abs(measured - declared) / Math.abs(declared)
    const pass = deviation <= 0.05
    outcomes.push({
      index: idx,
      deviation,
      pass,
      note: `${measured} ${unit} vs declared ${declared} ${unit} (${(deviation * 100).toFixed(1)}%)`,
    })
  }

  const failures = outcomes.filter((o) => !o.pass)
  const summary = outcomes
    .map((o) => `string_tests[${o.index}]: ${o.note}`)
    .join('; ')

  if (failures.length === 0) {
    return {
      rule_code: ruleCode,
      sans_clause: sansClause,
      rule_label: ruleLabel,
      result: 'pass',
      measured_value: summary,
      threshold: 'within ±5% of declared STC value',
    }
  }

  const failNames = failures.map((f) => `string_tests[${f.index}]`).join(', ')
  return {
    rule_code: ruleCode,
    sans_clause: sansClause,
    rule_label: ruleLabel,
    result: 'fail',
    measured_value: summary,
    threshold: 'within ±5% of declared STC value',
    failure_reason: `${failNames} exceeds ±5% tolerance`,
  }
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

const SOLAR_PV_RULES: ((ctx: RuleContext) => RuleResult)[] = [
  // SOLAR-STRING-VOC-001 — String Voc within ±5% of declared STC value
  (ctx) =>
    runStringToleranceRule(
      ctx,
      'SOLAR-STRING-VOC-001',
      'SANS 10142-3 / IEC 62548 §12.1',
      'String Voc tolerance',
      'V',
      'voc',
      'voc_declared',
    ),

  // SOLAR-STRING-ISC-001 — String Isc within ±5% of declared STC value
  (ctx) =>
    runStringToleranceRule(
      ctx,
      'SOLAR-STRING-ISC-001',
      'SANS 10142-3 / IEC 62548 §12.1',
      'String Isc tolerance',
      'A',
      'isc',
      'isc_declared',
    ),

  // SOLAR-DC-IR-001 — DC string insulation resistance >= 0.5 MΩ per IEC 62548 §12.3
  (ctx) => {
    const entries = collectStringEntries(ctx, 'dc_insulation_mohm')

    if (entries.size === 0) {
      return {
        rule_code: 'SOLAR-DC-IR-001',
        sans_clause: 'IEC 62548 §12.3',
        rule_label: 'DC string insulation resistance',
        result: 'insufficient_data',
        threshold: '>= 0.5 MΩ per string',
        failure_reason: 'No DC insulation resistance readings recorded',
      }
    }

    const failures: Array<{ idx: number; val: number }> = []
    const parts: string[] = []

    for (const [idx, val] of [...entries.entries()].sort(([a], [b]) => a - b)) {
      if (val == null) {
        parts.push(`string_tests[${idx}]: no reading`)
        failures.push({ idx, val: -1 })
      } else {
        parts.push(`string_tests[${idx}]: ${val} MΩ`)
        if (val < 0.5) failures.push({ idx, val })
      }
    }

    const summary = parts.join('; ')

    if (failures.length === 0) {
      return {
        rule_code: 'SOLAR-DC-IR-001',
        sans_clause: 'IEC 62548 §12.3',
        rule_label: 'DC string insulation resistance',
        result: 'pass',
        measured_value: summary,
        threshold: '>= 0.5 MΩ per string',
      }
    }

    const failDetail = failures
      .map((f) => (f.val >= 0 ? `string_tests[${f.idx}] ${f.val} MΩ < 0.5 MΩ` : `string_tests[${f.idx}] no reading`))
      .join('; ')

    return {
      rule_code: 'SOLAR-DC-IR-001',
      sans_clause: 'IEC 62548 §12.3',
      rule_label: 'DC string insulation resistance',
      result: 'fail',
      measured_value: summary,
      threshold: '>= 0.5 MΩ per string',
      failure_reason: failDetail,
    }
  },

  // SOLAR-DC-ISO-001 — DC isolation switch installed and load-break rated
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'dc_isolators_installed', 'dc_isolators')
    if (!r) {
      return {
        rule_code: 'SOLAR-DC-ISO-001',
        sans_clause: 'SANS 10142-3 §7.4',
        rule_label: 'DC isolation switch installed (load-break rated)',
        result: 'insufficient_data',
        threshold: 'pass',
        failure_reason: 'DC isolator check not recorded',
      }
    }
    const isPass = r.pass_state === 'pass' || r.value_bool === true
    return {
      rule_code: 'SOLAR-DC-ISO-001',
      sans_clause: 'SANS 10142-3 §7.4',
      rule_label: 'DC isolation switch installed (load-break rated)',
      result: isPass ? 'pass' : 'fail',
      measured_value: isPass ? 'pass' : 'fail',
      threshold: 'pass',
      failure_reason: isPass ? undefined : r.fail_reason ?? 'DC isolators not installed or not load-break rated',
    }
  },

  // SOLAR-EARTH-001 — Module frames bonded (equipotential)
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'earth_module_frames_bonded', 'module_frames_bonded', 'frames_bonded')
    if (!r) {
      return {
        rule_code: 'SOLAR-EARTH-001',
        sans_clause: 'SANS 10142-3 §8 / IEC 62548 §8',
        rule_label: 'Module frames bonded (equipotential)',
        result: 'insufficient_data',
        threshold: 'pass',
        failure_reason: 'Module frames bonding check not recorded',
      }
    }
    const isPass = r.pass_state === 'pass' || r.value_bool === true
    return {
      rule_code: 'SOLAR-EARTH-001',
      sans_clause: 'SANS 10142-3 §8 / IEC 62548 §8',
      rule_label: 'Module frames bonded (equipotential)',
      result: isPass ? 'pass' : 'fail',
      measured_value: isPass ? 'pass' : 'fail',
      threshold: 'pass',
      failure_reason: isPass ? undefined : r.fail_reason ?? 'Module frames not bonded to equipotential network',
    }
  },

  // SOLAR-AC-NRS097-001 — AC connection compliant per NRS 097-2-1 (anti-islanding)
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'ac_connection_compliant', 'ac_connection_nrs097', 'nrs097')
    if (!r) {
      return {
        rule_code: 'SOLAR-AC-NRS097-001',
        sans_clause: 'NRS 097-2-1 §5',
        rule_label: 'AC connection compliant (NRS 097-2-1 anti-islanding)',
        result: 'insufficient_data',
        threshold: 'pass',
        failure_reason: 'AC connection NRS 097-2-1 compliance check not recorded',
      }
    }
    const isPass = r.pass_state === 'pass' || r.value_bool === true
    return {
      rule_code: 'SOLAR-AC-NRS097-001',
      sans_clause: 'NRS 097-2-1 §5',
      rule_label: 'AC connection compliant (NRS 097-2-1 anti-islanding)',
      result: isPass ? 'pass' : 'fail',
      measured_value: isPass ? 'pass' : 'fail',
      threshold: 'pass',
      failure_reason: isPass ? undefined : r.fail_reason ?? 'AC connection point does not comply with NRS 097-2-1',
    }
  },
]

export const runSolarPvRules: RuleRunner = (ctx) => SOLAR_PV_RULES.map((fn) => fn(ctx))
