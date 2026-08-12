import { describe, it, expect } from 'vitest'
import { evaluateSubmitGates, type GateInput } from './gates'

const base: GateInput = {
  responses: {},
  instruments: [],
  defects: [],
  workDate: '2026-08-12',
}

const codes = (i: GateInput) => evaluateSubmitGates(i).map((x) => x.code)

// ─── Gate 1: insulation resistance before energising ─────────────────────────
// SANS 10142-1 8.6.8, with the NOTE 2 exception for circuits that could not be
// isolated.
describe('gate: energising requires an insulation-resistance reading', () => {
  it('blocks energising with no IR reading and no 8.6.8 NOTE 2 justification', () => {
    expect(
      codes({
        ...base,
        responses: { 'handover_status:as_left_status': 'energised_returned_to_service' },
      }),
    ).toContain('ir_required_before_energising')
  })

  it('blocks partial energising on the same basis', () => {
    expect(
      codes({
        ...base,
        responses: { 'handover_status:as_left_status': 'partially_energised' },
      }),
    ).toContain('ir_required_before_energising')
  })

  it('allows energising with an IR reading of 1,0 MOhm or more', () => {
    expect(
      codes({
        ...base,
        responses: {
          'handover_status:as_left_status': 'energised_returned_to_service',
          'electrical_tests:insulation_resistance': 2.5,
        },
      }),
    ).not.toContain('ir_required_before_energising')
  })

  it('blocks a reading below 1,0 MOhm with no justification', () => {
    expect(
      codes({
        ...base,
        responses: {
          'handover_status:as_left_status': 'energised_returned_to_service',
          'electrical_tests:insulation_resistance': 0.4,
        },
      }),
    ).toContain('ir_required_before_energising')
  })

  it('allows a reading below 1,0 MOhm with an explicit 8.6.8 NOTE 2 justification', () => {
    expect(
      codes({
        ...base,
        responses: {
          'handover_status:as_left_status': 'energised_returned_to_service',
          'electrical_tests:insulation_resistance': 0.4,
          'electrical_tests:ir_note2_justification':
            'Circuit could not be isolated; tested live per 8.6.8 NOTE 2.',
        },
      }),
    ).not.toContain('ir_required_before_energising')
  })

  it('does not require an IR reading when the board is left de-energised', () => {
    expect(
      codes({
        ...base,
        responses: { 'handover_status:as_left_status': 'made_safe_de_energised' },
      }),
    ).not.toContain('ir_required_before_energising')
  })

  it('ignores a whitespace-only justification', () => {
    expect(
      codes({
        ...base,
        responses: {
          'handover_status:as_left_status': 'energised_returned_to_service',
          'electrical_tests:ir_note2_justification': '   ',
        },
      }),
    ).toContain('ir_required_before_energising')
  })
})

// ─── Gate 2: instrument calibration ──────────────────────────────────────────
describe('gate: instrument calibration', () => {
  it('blocks when an instrument is past its calibration due date', () => {
    expect(
      codes({ ...base, instruments: [{ label: 'Fluke 1663', calibrationDue: '2026-01-01' }] }),
    ).toContain('instrument_out_of_calibration')
  })

  it('passes when calibration is current', () => {
    expect(
      codes({ ...base, instruments: [{ label: 'Fluke 1663', calibrationDue: '2027-01-01' }] }),
    ).not.toContain('instrument_out_of_calibration')
  })

  it('treats the due date as inclusive', () => {
    expect(
      codes({ ...base, instruments: [{ label: 'Fluke 1663', calibrationDue: '2026-08-12' }] }),
    ).not.toContain('instrument_out_of_calibration')
  })

  it('names the offending instrument in the message', () => {
    const issues = evaluateSubmitGates({
      ...base,
      instruments: [{ label: 'Megger MFT1741', calibrationDue: '2025-03-01' }],
    })
    const issue = issues.find((i) => i.code === 'instrument_out_of_calibration')
    expect(issue?.message).toContain('Megger MFT1741')
  })

  it('does not block on an instrument with no recorded due date', () => {
    // Absence is caught by the template's own required-field validation, not here.
    expect(
      codes({ ...base, instruments: [{ label: 'Unknown', calibrationDue: null }] }),
    ).not.toContain('instrument_out_of_calibration')
  })
})

// ─── Gate 3: prove - test - prove ────────────────────────────────────────────
describe('gate: prove-test-prove', () => {
  it('blocks when the re-prove step is missing', () => {
    expect(
      codes({
        ...base,
        responses: {
          'safe_isolation:indicator_proved_before': 'pass',
          'safe_isolation:tested_dead': 'pass',
        },
      }),
    ).toContain('prove_test_prove_incomplete')
  })

  it('blocks when nothing has been recorded at all', () => {
    expect(codes(base)).toContain('prove_test_prove_incomplete')
  })

  it('blocks when a step is recorded as a fail', () => {
    expect(
      codes({
        ...base,
        responses: {
          'safe_isolation:indicator_proved_before': 'pass',
          'safe_isolation:tested_dead': 'fail',
          'safe_isolation:indicator_proved_after': 'pass',
        },
      }),
    ).toContain('prove_test_prove_incomplete')
  })

  it('passes when all three steps are recorded as passes', () => {
    expect(
      codes({
        ...base,
        responses: {
          'safe_isolation:indicator_proved_before': 'pass',
          'safe_isolation:tested_dead': 'pass',
          'safe_isolation:indicator_proved_after': 'pass',
        },
      }),
    ).not.toContain('prove_test_prove_incomplete')
  })
})

// ─── Gate 4: C1 immediate danger triggers EIR reg 9(3) duties ────────────────
describe('gate: C1 immediate danger', () => {
  it('blocks when a C1 defect exists without disconnection and notification', () => {
    expect(codes({ ...base, defects: [{ classification: 'C1' }] })).toContain(
      'c1_requires_reg_9_3',
    )
  })

  it('blocks when only one of the two duties is recorded', () => {
    expect(
      codes({
        ...base,
        defects: [{ classification: 'C1' }],
        responses: { 'hazards_defects:supply_disconnected': 'pass' },
      }),
    ).toContain('c1_requires_reg_9_3')
  })

  it('passes when both reg 9(3) duties are recorded', () => {
    expect(
      codes({
        ...base,
        defects: [{ classification: 'C1' }],
        responses: {
          'hazards_defects:supply_disconnected': 'pass',
          'hazards_defects:chief_inspector_notified': true,
        },
      }),
    ).not.toContain('c1_requires_reg_9_3')
  })

  it('does not fire for C2, C3 or FI defects', () => {
    expect(
      codes({
        ...base,
        defects: [{ classification: 'C2' }, { classification: 'C3' }, { classification: 'FI' }],
      }),
    ).not.toContain('c1_requires_reg_9_3')
  })

  it('cites regulation 9(3) in the message', () => {
    const issue = evaluateSubmitGates({
      ...base,
      defects: [{ classification: 'C1' }],
    }).find((i) => i.code === 'c1_requires_reg_9_3')
    expect(issue?.message).toContain('9(3)')
  })
})

// ─── Gate 5: registration scope ──────────────────────────────────────────────
describe('gate: registration scope', () => {
  it('blocks a specialised installation without a master installation electrician', () => {
    expect(
      codes({
        ...base,
        responses: {
          'db_identification:specialised_installation': true,
          'personnel:registered_person_category': 'installation_electrician',
        },
      }),
    ).toContain('specialised_requires_mie')
  })

  it('allows a specialised installation with a master installation electrician', () => {
    expect(
      codes({
        ...base,
        responses: {
          'db_identification:specialised_installation': true,
          'personnel:registered_person_category': 'master_installation_electrician',
        },
      }),
    ).not.toContain('specialised_requires_mie')
  })

  it('blocks a single-phase tester on a multi-phase installation', () => {
    expect(
      codes({
        ...base,
        responses: {
          'db_identification:phases': '3',
          'personnel:registered_person_category': 'electrical_tester_single_phase',
        },
      }),
    ).toContain('tester_scope_exceeded')
  })

  it('allows a single-phase tester on a single-phase installation', () => {
    expect(
      codes({
        ...base,
        responses: {
          'db_identification:phases': '1',
          'personnel:registered_person_category': 'electrical_tester_single_phase',
        },
      }),
    ).not.toContain('tester_scope_exceeded')
  })

  it('words the tester message against the binding EIR definition, not the informative Annex M', () => {
    const issue = evaluateSubmitGates({
      ...base,
      responses: {
        'db_identification:phases': '3',
        'personnel:registered_person_category': 'electrical_tester_single_phase',
      },
    }).find((i) => i.code === 'tester_scope_exceeded')
    // SANS Annex M is informative; the binding text is the EIR reg 1 definition.
    expect(issue?.message).toContain('Electrical Installation Regulations')
    expect(issue?.message).not.toContain('Annex M requires')
  })

  it('blocks when contractor registration expired before the date of work', () => {
    expect(
      codes({
        ...base,
        workDate: '2026-08-12',
        responses: { 'personnel:contractor_registration_expiry': '2026-06-30' },
      }),
    ).toContain('contractor_registration_expired')
  })

  it('allows current contractor registration', () => {
    expect(
      codes({
        ...base,
        workDate: '2026-08-12',
        responses: { 'personnel:contractor_registration_expiry': '2027-06-30' },
      }),
    ).not.toContain('contractor_registration_expired')
  })
})

// ─── Shape ───────────────────────────────────────────────────────────────────
describe('gate result shape', () => {
  it('returns an empty array for a fully compliant form', () => {
    expect(
      evaluateSubmitGates({
        ...base,
        responses: {
          'handover_status:as_left_status': 'made_safe_de_energised',
          'safe_isolation:indicator_proved_before': 'pass',
          'safe_isolation:tested_dead': 'pass',
          'safe_isolation:indicator_proved_after': 'pass',
        },
      }),
    ).toEqual([])
  })

  it('tags every issue with the section it belongs to', () => {
    const issues = evaluateSubmitGates(base)
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(i.sectionId).toBeTruthy()
      expect(i.message).toBeTruthy()
    }
  })
})
