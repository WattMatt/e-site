// SANS 10142-1:2020 validation rules — from INSPECTION_TEMPLATES_CATALOGUE.md Part 4
//
// Each rule maps a response field (or set of fields) to a deterministic
// pass / fail / not_applicable / insufficient_data outcome. The matching is
// heuristic (substring on field_id) because production templates use varying
// field-naming conventions — the catalogue describes the shape but not the
// exact naming convention any single template will land on.
//
// Strict-empirical principle: numeric thresholds operate ONLY on
// `value_number`. A text "OK" or "PASS" on its own does NOT satisfy a
// numeric SANS rule — those flow through POL-001 / pass_fail responses.

export interface ResponseRow {
  section_id: string
  field_id: string
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value_json?: any
  pass_state?: 'pass' | 'fail' | 'na' | 'not_checked' | null
  fail_reason?: string | null
}

export interface RuleContext {
  /** keyed by `${section_id}.${field_id}` */
  responses: Map<string, ResponseRow>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inspection: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signatures?: any[]
}

export interface RuleResult {
  rule_code: string
  sans_clause: string
  rule_label: string
  result: 'pass' | 'fail' | 'not_applicable' | 'insufficient_data'
  measured_value?: string
  threshold?: string
  failure_reason?: string
}

// ----------------------------------------------------------------------------
// Zs lookup table — Type B MCB @ 0.4 s disconnection (catalogue Part 4)
// Type C = 2× base; Type D = 3× base.
// ----------------------------------------------------------------------------

const ZS_TYPE_B: Record<number, number> = {
  6: 7.66, 10: 4.59, 16: 2.87, 20: 2.30, 25: 1.84, 32: 1.44,
  40: 1.15, 50: 0.92, 63: 0.73, 80: 0.57, 100: 0.46,
}

export function zsLimit(rating: number, type: 'B' | 'C' | 'D' = 'B'): number | null {
  const base = ZS_TYPE_B[rating]
  if (base == null) return null
  return type === 'B' ? base : type === 'C' ? base * 2 : base * 3
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Find a response whose field_id contains any of the given substrings (case-insensitive). */
function findResponseByFieldId(ctx: RuleContext, ...patterns: string[]): ResponseRow | null {
  for (const [key, value] of ctx.responses.entries()) {
    const fieldId = key.split('.').pop() ?? ''
    const lc = fieldId.toLowerCase()
    if (patterns.some((p) => lc.includes(p.toLowerCase()))) return value
  }
  return null
}

// ----------------------------------------------------------------------------
// The 8 rules (catalogue Part 4 — table verbatim, in declared order)
// ----------------------------------------------------------------------------

export const RULES: ((ctx: RuleContext) => RuleResult)[] = [
  // EARTH-001 — Earth-electrode resistance <= 5 Ω
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'earth_electrode', 'earth_pit_resistance', 'earth_resistance')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'EARTH-001',
        sans_clause: '8.4',
        rule_label: 'Earth-electrode resistance',
        result: 'insufficient_data',
        threshold: '<= 5 Ω',
        failure_reason: 'No earth-electrode resistance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'EARTH-001',
      sans_clause: '8.4',
      rule_label: 'Earth-electrode resistance',
      result: v <= 5 ? 'pass' : 'fail',
      measured_value: `${v} Ω`,
      threshold: '<= 5 Ω',
      failure_reason: v > 5 ? `Measured ${v} Ω exceeds 5 Ω limit` : undefined,
    }
  },

  // LOOP-001 — Earth-loop impedance per circuit <= Zs(breaker class)
  (ctx) => {
    const loopReading = findResponseByFieldId(ctx, 'earth_loop_impedance', 'loop_impedance', 'zs')
    if (!loopReading || loopReading.value_number == null) {
      return {
        rule_code: 'LOOP-001',
        sans_clause: '8.5',
        rule_label: 'Earth-loop impedance',
        result: 'insufficient_data',
        threshold: '<= Zs(breaker)',
        failure_reason: 'No earth-loop impedance reading found',
      }
    }
    const breakerRating =
      findResponseByFieldId(ctx, 'breaker_rating', 'main_switch_rating')?.value_number ?? 32
    const breakerTypeRaw =
      findResponseByFieldId(ctx, 'breaker_type')?.value_text ?? 'B'
    const breakerType = (breakerTypeRaw.trim().toUpperCase()[0] ?? 'B') as 'B' | 'C' | 'D'
    const safeType: 'B' | 'C' | 'D' = breakerType === 'C' || breakerType === 'D' ? breakerType : 'B'
    const limit = zsLimit(breakerRating, safeType) ?? 0.5
    const v = loopReading.value_number
    return {
      rule_code: 'LOOP-001',
      sans_clause: '8.5',
      rule_label: 'Earth-loop impedance',
      result: v <= limit ? 'pass' : 'fail',
      measured_value: `${v} Ω`,
      threshold: `<= ${limit} Ω (Type ${safeType} ${breakerRating} A)`,
      failure_reason: v > limit ? `Measured ${v} Ω exceeds Zs limit ${limit} Ω` : undefined,
    }
  },

  // INSUL-001 — Insulation resistance >= 1.0 MΩ at 500 V
  (ctx) => {
    const r = findResponseByFieldId(
      ctx,
      'insulation_resistance',
      'ir_phase_to_earth',
      'ir_phase_to_phase',
      'ir_neutral',
    )
    if (!r || r.value_number == null) {
      return {
        rule_code: 'INSUL-001',
        sans_clause: '8.6',
        rule_label: 'Insulation resistance',
        result: 'insufficient_data',
        threshold: '>= 1.0 MΩ',
        failure_reason: 'No insulation resistance reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'INSUL-001',
      sans_clause: '8.6',
      rule_label: 'Insulation resistance',
      result: v >= 1.0 ? 'pass' : 'fail',
      measured_value: `${v} MΩ`,
      threshold: '>= 1.0 MΩ',
      failure_reason: v < 1.0 ? `Measured ${v} MΩ below 1.0 MΩ minimum` : undefined,
    }
  },

  // RCD-001 — 1× trip: 0-300 ms; 5× trip: <= 40 ms
  (ctx) => {
    const trip1x = findResponseByFieldId(ctx, 'rcd_trip_1x', 'rcd_trip_time')?.value_number
    const trip5x = findResponseByFieldId(ctx, 'rcd_trip_5x', 'rcd_trip_time_5x')?.value_number
    if (trip1x == null && trip5x == null) {
      return {
        rule_code: 'RCD-001',
        sans_clause: '8.8',
        rule_label: 'RCD trip times',
        result: 'insufficient_data',
        threshold: '1×: 0-300 ms · 5×: <= 40 ms',
        failure_reason: 'No RCD trip-time readings found',
      }
    }
    const fail1 = trip1x != null && (trip1x < 0 || trip1x > 300)
    const fail5 = trip5x != null && trip5x > 40
    const result = fail1 || fail5 ? 'fail' : 'pass'
    const measured = `1×: ${trip1x ?? 'n/a'} ms, 5×: ${trip5x ?? 'n/a'} ms`
    const reason =
      (fail1 ? `1× trip ${trip1x} ms outside 0-300 ms` : '') +
      (fail5 ? ` · 5× trip ${trip5x} ms exceeds 40 ms` : '')
    return {
      rule_code: 'RCD-001',
      sans_clause: '8.8',
      rule_label: 'RCD trip times',
      result,
      measured_value: measured,
      threshold: '1×: 0-300 ms · 5×: <= 40 ms',
      failure_reason: reason.trim() || undefined,
    }
  },

  // PSCC-001 — Prospective short-circuit current >= 1 kA
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'prospective_short', 'pscc', 'short_circuit_current')
    if (!r || r.value_number == null) {
      return {
        rule_code: 'PSCC-001',
        sans_clause: '8.3',
        rule_label: 'Prospective short-circuit current',
        result: 'insufficient_data',
        threshold: '>= 1 kA',
        failure_reason: 'No prospective short-circuit current reading found',
      }
    }
    const v = r.value_number
    return {
      rule_code: 'PSCC-001',
      sans_clause: '8.3',
      rule_label: 'Prospective short-circuit current',
      result: v >= 1 ? 'pass' : 'fail',
      measured_value: `${v} kA`,
      threshold: '>= 1 kA',
      failure_reason: v < 1 ? `Measured ${v} kA below 1 kA minimum` : undefined,
    }
  },

  // POL-001 — Polarity & continuity (pass_fail per circuit)
  (ctx) => {
    const r = findResponseByFieldId(ctx, 'polarity', 'continuity')
    if (!r) {
      return {
        rule_code: 'POL-001',
        sans_clause: '8.7',
        rule_label: 'Polarity & continuity',
        result: 'insufficient_data',
        threshold: 'pass per circuit',
        failure_reason: 'No polarity/continuity check found',
      }
    }
    // Prefer pass_state (the canonical pass_fail signal) over value_bool.
    let isPass: boolean | null = null
    if (r.pass_state === 'pass') isPass = true
    else if (r.pass_state === 'fail') isPass = false
    else if (r.value_bool === true) isPass = true
    else if (r.value_bool === false) isPass = false

    if (isPass == null) {
      return {
        rule_code: 'POL-001',
        sans_clause: '8.7',
        rule_label: 'Polarity & continuity',
        result: 'insufficient_data',
        threshold: 'pass per circuit',
        failure_reason: 'Polarity/continuity check has no recorded result',
      }
    }
    return {
      rule_code: 'POL-001',
      sans_clause: '8.7',
      rule_label: 'Polarity & continuity',
      result: isPass ? 'pass' : 'fail',
      measured_value: isPass ? 'pass' : 'fail',
      threshold: 'pass per circuit',
      failure_reason: isPass ? undefined : r.fail_reason ?? 'Polarity/continuity check failed',
    }
  },

  // REG-001 — Registered person reg# present
  (ctx) => {
    // Check responses first (templates may embed a registration_number field);
    // fall back to the signatures table (where signatory metadata lives in v1).
    let regNo = findResponseByFieldId(ctx, 'registration_number', 'reg_number')?.value_text ?? null
    if (!regNo && Array.isArray(ctx.signatures)) {
      for (const sig of ctx.signatures) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candidate = (sig?.registration_number ?? sig?.reg_number) as string | undefined
        if (candidate && candidate.trim()) {
          regNo = candidate.trim()
          break
        }
      }
    }
    if (!regNo || !regNo.trim()) {
      return {
        rule_code: 'REG-001',
        sans_clause: 'Issuer competency',
        rule_label: 'Registered person reg #',
        result: 'fail',
        threshold: 'reg# present + format match',
        failure_reason: 'No registered-person reg # found on certificate',
      }
    }
    return {
      rule_code: 'REG-001',
      sans_clause: 'Issuer competency',
      rule_label: 'Registered person reg #',
      result: 'pass',
      measured_value: regNo.trim(),
      threshold: 'reg# present',
    }
  },

  // CERT-INCOMPLETE-001 — All mandatory fields populated
  (ctx) => {
    const requiredFields: string[] = []
    for (const s of ctx.template?.sections ?? []) {
      for (const f of s.fields ?? []) {
        if (f.required && f.type !== 'header' && f.type !== 'computed') {
          requiredFields.push(`${s.section_id}.${f.field_id}`)
        }
      }
    }
    const unanswered = requiredFields.filter((key) => {
      const r = ctx.responses.get(key)
      if (!r) return true
      return (
        r.value_bool == null &&
        r.value_number == null &&
        !r.value_text &&
        !(r.value_array && r.value_array.length)
      )
    })
    if (unanswered.length === 0) {
      return {
        rule_code: 'CERT-INCOMPLETE-001',
        sans_clause: 'Form completeness',
        rule_label: 'All mandatory fields populated',
        result: 'pass',
        measured_value: `${requiredFields.length} required fields, all answered`,
        threshold: 'count(empty) == 0',
      }
    }
    return {
      rule_code: 'CERT-INCOMPLETE-001',
      sans_clause: 'Form completeness',
      rule_label: 'All mandatory fields populated',
      result: 'fail',
      measured_value: `${unanswered.length} of ${requiredFields.length} required fields missing`,
      threshold: 'count(empty) == 0',
      failure_reason: `Missing: ${unanswered.slice(0, 5).join(', ')}${
        unanswered.length > 5 ? '...' : ''
      }`,
    }
  },
]
