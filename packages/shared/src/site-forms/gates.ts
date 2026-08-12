/**
 * Submit gates for site forms.
 *
 * These encode genuine legal and standards constraints that a paper form cannot
 * enforce. They are deliberately a pure function over already-loaded data: no
 * I/O, no clock access (the date of work is passed in), so they are cheap to
 * unit-test exhaustively and can run identically on the server, in the capture
 * UI, and in any future mobile client.
 *
 * Authority for each gate is cited in its message, because these messages are
 * read by electricians and engineers who need to know which rule stopped them.
 * Where SANS material is informative rather than binding (notably Annex M's
 * registration-scope matrix), the message cites the binding text -- the
 * Electrical Installation Regulations, 2009 -- instead.
 */

export interface GateIssue {
  /** Stable machine code; the UI keys deep-links and tests key assertions on this. */
  code: string
  /** Human-readable, cites its authority. Shown verbatim to the user. */
  message: string
  /** Section the user must return to in order to clear the issue. */
  sectionId: string
}

export interface GateInstrument {
  label: string
  /** ISO date (YYYY-MM-DD), or null when not recorded. */
  calibrationDue: string | null
}

export interface GateDefect {
  /** One of C1 | C2 | C3 | FI. */
  classification: string
}

export interface GateInput {
  /** Response values keyed `${sectionId}:${fieldId}`. */
  responses: Record<string, unknown>
  instruments: GateInstrument[]
  defects: GateDefect[]
  /** ISO date (YYYY-MM-DD) the work was carried out. */
  workDate: string
}

/** SANS 10142-1 8.6.8 — insulation resistance must be at least 1,0 MOhm. */
const MIN_INSULATION_RESISTANCE_MOHM = 1.0

/** Handover states that mean the board was left live in whole or in part. */
const ENERGISED_STATES = new Set(['energised_returned_to_service', 'partially_energised'])

function value(input: GateInput, sectionId: string, fieldId: string): unknown {
  return input.responses[`${sectionId}:${fieldId}`]
}

/** True for an affirmative answer, whether stored as a boolean or a pass_state. */
function isAffirmative(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'pass' || s === 'yes' || s === 'true'
  }
  return false
}

function isNonBlank(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    // Accept the comma decimal separator used throughout SA electrical practice.
    const n = Number(v.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * ISO date strings compare correctly lexicographically, so no Date parsing --
 * which also keeps this free of timezone surprises.
 */
function isBefore(a: string, b: string): boolean {
  return a < b
}

/** Minimal shape of a stored response row, matching `field.form_responses`. */
export interface GateResponseRow {
  section_id: string
  field_id: string
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
}

/** `<group>[<index>].<sub>` — the engine's synthetic repeating-group response id. */
const RG_KEY = /^([a-z0-9_]+)\[(\d+)\]\.([a-z0-9_]+)$/

function firstDefined(r: GateResponseRow): unknown {
  if (r.value_bool !== undefined && r.value_bool !== null) return r.value_bool
  if (r.value_number !== undefined && r.value_number !== null) return r.value_number
  if (r.value_array !== undefined && r.value_array !== null) return r.value_array
  if (r.value_text !== undefined && r.value_text !== null) return r.value_text
  return undefined
}

/**
 * Turn stored responses into gate input.
 *
 * Kept here, beside the gates themselves, so the server action and the capture
 * UI cannot compute gates from differently-shaped data and disagree about
 * whether a form may be submitted.
 *
 * Repeating-group rows arrive under synthetic ids, so instruments and defects
 * are reassembled by entry index rather than read as flat fields.
 */
export function buildGateInput(
  responses: GateResponseRow[],
  fallbackWorkDate: string,
): GateInput {
  const flat: Record<string, unknown> = {}
  const instrumentRows = new Map<number, Record<string, unknown>>()
  const defectRows = new Map<number, Record<string, unknown>>()

  for (const r of responses) {
    const m = r.field_id.match(RG_KEY)
    if (!m) {
      flat[`${r.section_id}:${r.field_id}`] = firstDefined(r)
      continue
    }
    const [, group, idxRaw, sub] = m
    const idx = parseInt(idxRaw, 10)
    const bucket =
      group === 'instruments' ? instrumentRows : group === 'defect_register' ? defectRows : null
    if (!bucket) continue
    const entry = bucket.get(idx) ?? {}
    entry[sub] = firstDefined(r)
    bucket.set(idx, entry)
  }

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null

  const instruments: GateInstrument[] = [...instrumentRows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, e]) => ({
      label:
        [str(e.make), str(e.model)].filter(Boolean).join(' ') ||
        str(e.instrument_function) ||
        `Instrument ${idx + 1}`,
      calibrationDue: str(e.calibration_due_date),
    }))

  // A row with content but no grade is KEPT, deliberately. Dropping it would
  // let "live 400 V conductor exposed behind the gland plate" submit clean
  // with c1Count = 0, because the C1 -> reg 9(3) gate depends on a dropdown
  // nothing forces the user to set. An ungraded defect is its own gate issue.
  const defects: GateDefect[] = [...defectRows.values()]
    .filter((e) => Object.values(e).some((v) => str(v) !== null || typeof v === 'number'))
    .map((e) => ({ classification: str(e.classification) ?? '' }))

  const workDate = str(flat['personnel:date_of_work']) ?? fallbackWorkDate

  return { responses: flat, instruments, defects, workDate }
}

export function evaluateSubmitGates(input: GateInput): GateIssue[] {
  const issues: GateIssue[] = []

  // ── 1. Insulation resistance before energising (SANS 10142-1 8.6.8) ────────
  const asLeft = value(input, 'handover_status', 'as_left_status')
  if (typeof asLeft === 'string' && ENERGISED_STATES.has(asLeft)) {
    const ir = asNumber(value(input, 'electrical_tests', 'insulation_resistance'))
    const justified = isNonBlank(value(input, 'electrical_tests', 'ir_note2_justification'))
    const adequate = ir !== null && ir >= MIN_INSULATION_RESISTANCE_MOHM

    if (!adequate && !justified) {
      issues.push({
        code: 'ir_required_before_energising',
        sectionId: 'electrical_tests',
        message:
          `A board may not be recorded as energised without an insulation-resistance reading of at least ` +
          `${MIN_INSULATION_RESISTANCE_MOHM.toFixed(1).replace('.', ',')} MOhm (SANS 10142-1 clause 8.6.8). ` +
          `Record the reading, or state the clause 8.6.8 NOTE 2 justification if the circuit could not be isolated.`,
      })
    }
  }

  // ── 2. Instrument calibration ─────────────────────────────────────────────
  // Note: SANS states an accuracy requirement rather than a calibration-interval
  // one. Calibration currency is a WM and client requirement, enforced here.
  const expired = input.instruments.filter(
    (i) => i.calibrationDue !== null && isBefore(i.calibrationDue, input.workDate),
  )
  if (expired.length > 0) {
    issues.push({
      code: 'instrument_out_of_calibration',
      sectionId: 'test_instruments',
      message:
        `These instruments were past their calibration due date on the date of work ` +
        `(${input.workDate}): ${expired.map((i) => `${i.label} (due ${i.calibrationDue})`).join('; ')}. ` +
        `Readings taken with an out-of-calibration instrument cannot support this record.`,
    })
  }

  // Fail closed on a missing date. Treating absence as "fine" made the gate
  // opt-out by omission: leaving the field blank silenced the one rule whose
  // own message says readings from an out-of-calibration instrument cannot
  // support this record.
  const undated = input.instruments.filter((i) => i.calibrationDue === null)
  if (undated.length > 0) {
    issues.push({
      code: 'instrument_calibration_unknown',
      sectionId: 'test_instruments',
      message:
        `No calibration due date is recorded for: ${undated.map((i) => i.label).join('; ')}. ` +
        `Calibration currency cannot be confirmed, so these readings cannot support this record.`,
    })
  }

  // ── 3. Prove - test - prove (the whole safety argument of the form) ────────
  const proveSteps = [
    value(input, 'safe_isolation', 'indicator_proved_before'),
    value(input, 'safe_isolation', 'tested_dead'),
    value(input, 'safe_isolation', 'indicator_proved_after'),
  ]
  if (!proveSteps.every(isAffirmative)) {
    issues.push({
      code: 'prove_test_prove_incomplete',
      sectionId: 'safe_isolation',
      message:
        'The prove-test-prove sequence is incomplete. The voltage indicator must be proved on a known ' +
        'source, the conductors tested dead at the point of work, and the indicator re-proved on the ' +
        'known source immediately afterwards. All three steps must be recorded as passed.',
    })
  }

  // ── 4. Defects: every recorded defect must carry a grade ──────────────────
  // The C1 gate below keys on the classification dropdown, so an ungraded
  // defect row would silently bypass the reg 9(3) duties no matter how
  // dangerous its description.
  const ungraded = input.defects.filter((d) => d.classification.trim() === '').length
  if (ungraded > 0) {
    issues.push({
      code: 'defect_unclassified',
      sectionId: 'hazards_defects',
      message:
        `${ungraded} recorded defect${ungraded === 1 ? ' has' : 's have'} no classification. ` +
        `Grade each one C1 (danger present), C2 (potentially dangerous), C3 (improvement ` +
        `recommended) or FI (further investigation required) — an ungraded defect cannot be ` +
        `acted on, and a C1 carries statutory duties under regulation 9(3).`,
    })
  }

  // ── 4b. C1 immediate danger triggers EIR reg 9(3) duties ──────────────────
  if (input.defects.some((d) => d.classification.trim().toUpperCase() === 'C1')) {
    const disconnected = isAffirmative(value(input, 'hazards_defects', 'supply_disconnected'))
    const notified = isAffirmative(value(input, 'hazards_defects', 'chief_inspector_notified'))
    if (!disconnected || !notified) {
      issues.push({
        code: 'c1_requires_reg_9_3',
        sectionId: 'hazards_defects',
        message:
          'A C1 defect means immediate danger is present. Regulation 9(3) of the Electrical Installation ' +
          'Regulations, 2009 requires that the supply to the affected part be disconnected and that the ' +
          'chief inspector be notified. Both must be recorded before this form can be submitted.',
      })
    }
  }

  // ── 5. Registration scope ─────────────────────────────────────────────────
  const category = value(input, 'personnel', 'registered_person_category')

  if (
    isAffirmative(value(input, 'db_identification', 'specialised_installation')) &&
    category !== 'master_installation_electrician'
  ) {
    issues.push({
      code: 'specialised_requires_mie',
      sectionId: 'personnel',
      message:
        'This board is recorded as part of a specialised installation. Under the definitions in ' +
        'regulation 1 of the Electrical Installation Regulations, 2009, only a master installation ' +
        'electrician may take responsibility for a specialised installation.',
    })
  }

  const phases = value(input, 'db_identification', 'phases')
  if (category === 'electrical_tester_single_phase' && typeof phases === 'string' && phases !== '1') {
    issues.push({
      code: 'tester_scope_exceeded',
      sectionId: 'personnel',
      message:
        `This installation is recorded as ${phases}-phase. An electrical tester for single phase is ` +
        'defined in regulation 1 of the Electrical Installation Regulations, 2009 by reference to a ' +
        'single-phase supply at the point of control, so this work falls outside that registration.',
    })
  }

  const contractorExpiry = value(input, 'personnel', 'contractor_registration_expiry')
  if (typeof contractorExpiry === 'string' && contractorExpiry.trim() !== '') {
    if (isBefore(contractorExpiry.trim(), input.workDate)) {
      issues.push({
        code: 'contractor_registration_expired',
        sectionId: 'personnel',
        message:
          `The electrical contractor's registration expired on ${contractorExpiry}, before the date of ` +
          `work (${input.workDate}). Registration as an electrical contractor is annual under regulation 6 ` +
          'of the Electrical Installation Regulations, 2009.',
      })
    }
  }

  return issues
}
