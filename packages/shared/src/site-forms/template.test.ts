import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { templateSchema } from '../inspections/template-schema';
import type { Field, Section } from '../inspections/types';
import terminationAndMakingSafe from './templates/termination-and-making-safe.json';
import terminationAndMakingSafeV11 from './templates/termination-and-making-safe-v1.1.json';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RAW = readFileSync(
  resolve(__dirname, './templates/termination-and-making-safe.json'),
  'utf8',
);

// The 16 engine sections. §2A, §6A, §8A and §8B get their own engine sections
// because the engine has no sub-section concept for repeating groups, so the
// 14 numbered document sections present as 16 here.
const EXPECTED_SECTION_IDS = [
  'project_site',
  'db_identification',
  'earthing_adequacy',
  'personnel',
  'scope_of_work',
  'circuits_affected',
  'safe_isolation',
  'lock_register',
  'test_instruments',
  'proving_dead',
  'electrical_tests',
  'labelling_reinstatement',
  'photographic_evidence',
  'hazards_defects',
  'handover_status',
  'declarations',
];

const parsed = templateSchema.parse(terminationAndMakingSafe);

function sectionById(id: string): Section {
  const s = parsed.sections.find((x) => x.section_id === id);
  if (!s) throw new Error(`section ${id} not found`);
  return s as Section;
}

function fieldById(sectionId: string, fieldId: string): Field {
  const f = sectionById(sectionId).fields.find((x) => x.field_id === fieldId);
  if (!f) throw new Error(`field ${sectionId}.${fieldId} not found`);
  return f;
}

function subFieldById(sectionId: string, groupId: string, fieldId: string): Field {
  const group = fieldById(sectionId, groupId);
  const f = group.fields?.find((x) => x.field_id === fieldId);
  if (!f) throw new Error(`sub-field ${sectionId}.${groupId}.${fieldId} not found`);
  return f;
}

function walk(fields: Field[]): Field[] {
  return fields.flatMap((f) => [f, ...walk(f.fields ?? [])]);
}

const allFields = parsed.sections.flatMap((s) => walk(s.fields as Field[]));

describe('termination-and-making-safe template', () => {
  it('validates against templateSchema', () => {
    expect(() => templateSchema.parse(terminationAndMakingSafe)).not.toThrow();
  });

  it('carries the required top-level identity', () => {
    expect(parsed.template_id).toBe('termination-and-making-safe');
    expect(parsed.name).toBe('Termination and Making Safe');
    expect(parsed.version).toBe('1.0');
    expect(parsed.applies_to_node_types).toEqual(['board', 'any']);
    expect(parsed.sans_reference).toBe('SANS 10142-1');
  });

  it('is inspection_only — this form is never a certificate of compliance', () => {
    expect(parsed.deliverable_type).toBe('inspection_only');
    expect(parsed.deliverable_type).not.toBe('coc');
  });

  it('has the 16 engine sections in order', () => {
    expect(parsed.sections.map((s) => s.section_id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it('has globally unique field ids', () => {
    const ids = allFields.map((f) => f.field_id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('field ids downstream code depends on', () => {
  it('alternative_supplies is a required multi_select', () => {
    const f = fieldById('db_identification', 'alternative_supplies');
    expect(f.type).toBe('multi_select');
    expect(f.required).toBe(true);
  });

  it('specialised_installation and phases are present and required', () => {
    expect(fieldById('db_identification', 'specialised_installation').type).toBe('pass_fail');
    expect(fieldById('db_identification', 'specialised_installation').required).toBe(true);
    const phases = fieldById('db_identification', 'phases');
    expect(phases.type).toBe('dropdown');
    expect(phases.required).toBe(true);
    expect(phases.options).toEqual(['1', '2', '3']);
  });

  it('registered_person_category offers the three EIR registration categories', () => {
    const f = fieldById('personnel', 'registered_person_category');
    expect(f.type).toBe('dropdown');
    expect(f.options).toEqual(
      expect.arrayContaining([
        'master_installation_electrician',
        'installation_electrician',
        'electrical_tester_single_phase',
      ]),
    );
  });

  it('contractor_registration_expiry is a date', () => {
    expect(fieldById('personnel', 'contractor_registration_expiry').type).toBe('date');
  });

  it('carries the prove — test — prove sequence, all required pass_fail', () => {
    for (const id of ['indicator_proved_before', 'tested_dead', 'indicator_proved_after']) {
      const f = fieldById('safe_isolation', id);
      expect(f.type).toBe('pass_fail');
      expect(f.required).toBe(true);
    }
  });

  it('circuits_affected is a repeating group with min_count 1 and the agreed label template', () => {
    const f = fieldById('circuits_affected', 'circuits');
    expect(f.type).toBe('repeating_group');
    expect(f.min_count).toBe(1);
    expect(f.item_label_template).toBe('Way {{way_no}} — {{circuit_ref}}');
  });

  it('electrical_tests carries insulation resistance in MΩ plus the NOTE 2 justification', () => {
    const ir = fieldById('electrical_tests', 'insulation_resistance');
    expect(ir.type).toBe('number');
    expect(ir.unit).toBe('MΩ');
    expect(fieldById('electrical_tests', 'ir_note2_justification').type).toBe('textarea');
  });

  it('hazards_defects carries the reg 9(3) fields and a C1/C2/C3/FI defect register', () => {
    expect(fieldById('hazards_defects', 'supply_disconnected').type).toBe('pass_fail');
    expect(fieldById('hazards_defects', 'chief_inspector_notified').type).toBe('pass_fail');
    const register = fieldById('hazards_defects', 'defect_register');
    expect(register.type).toBe('repeating_group');
    const classification = subFieldById('hazards_defects', 'defect_register', 'classification');
    expect(classification.type).toBe('dropdown');
    expect(classification.options).toEqual(['C1', 'C2', 'C3', 'FI']);
  });

  it('as_left_status offers the six agreed states', () => {
    const f = fieldById('handover_status', 'as_left_status');
    expect(f.type).toBe('dropdown');
    expect(f.options).toEqual([
      'made_safe_de_energised',
      'energised_returned_to_service',
      'left_isolated_lock_wm',
      'left_isolated_lock_client',
      'partially_energised',
      'decommissioned_removed',
    ]);
  });
});

describe('scope restrictions agreed for v1', () => {
  it('electrical_tests is restricted to the four agreed tests', () => {
    const ids = sectionById('electrical_tests').fields.map((f) => f.field_id);
    expect(ids).toContain('insulation_resistance');
    expect(ids).toContain('insulation_test_voltage');
    expect(ids).toContain('earth_continuity_conductor_resistance');
    expect(ids).toContain('bonding_continuity');
    expect(ids).toContain('polarity');
    // The other twelve SANS 8.6 test rows are deliberately omitted.
    for (const omitted of [
      'ring_circuit_continuity',
      'earth_fault_loop_impedance',
      'neutral_loop_impedance',
      'prospective_short_circuit_current',
      'elevated_neutral_voltage',
      'electrode_earth_resistance',
      'voltage_no_load',
      'voltage_on_load',
      'voltage_at_available_load',
      'earth_leakage_tripping_current_measured',
      'earth_leakage_test_button',
      'phase_rotation',
      'switching_devices',
    ]) {
      expect(ids).not.toContain(omitted);
    }
  });

  it('never describes itself as a certificate of compliance', () => {
    const declarations = sectionById('declarations');
    const disclaimer = declarations.fields[0];
    expect(disclaimer.type).toBe('header');
    expect(disclaimer.label).toMatch(/is not a Certificate of Compliance/i);
  });

  it('does not offer non-compliant termination or securing methods', () => {
    expect(RAW.toLowerCase()).not.toContain('taped up');
    expect(RAW.toLowerCase()).not.toContain('switch left off');
  });

  it('has no nested repeating groups', () => {
    const groups = allFields.filter((f) => f.type === 'repeating_group');
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.fields?.some((f) => f.type === 'repeating_group')).toBe(false);
    }
  });
});

// The engine flattens repeating-group entries into synthetic response ids of the
// form `<group>[<i>].<sub>`, but `checkCondition` resolves `conditional_on` by
// matching a bare `field_id` against stored responses. A sub-field conditional
// therefore never finds its trigger, and neither `evaluateInspection` nor
// `RepeatingGroupField` calls `isFieldVisible` for sub-fields at all -- so the
// declaration is silently ignored and the field always renders.
//
// Rather than ship a declaration the engine does not honour, sub-field
// conditions are stated in `help_text`. These tests pin that decision.
describe('engine conditional-resolution limits', () => {
  const groups = allFields.filter((f) => f.type === 'repeating_group');

  it('declares no conditional_on on any repeating-group sub-field', () => {
    const offenders: string[] = [];
    for (const g of groups) {
      for (const sub of g.fields ?? []) {
        if ((sub as { conditional_on?: unknown }).conditional_on) {
          offenders.push(`${g.field_id}[].${sub.field_id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never makes a top-level field conditional on a repeating-group sub-field', () => {
    const subIds = new Set(groups.flatMap((g) => (g.fields ?? []).map((s) => s.field_id)));
    const offenders = allFields
      .filter((f) => f.conditional_on && subIds.has(f.conditional_on.field_id))
      .map((f) => `${f.field_id} -> ${f.conditional_on!.field_id}`);
    // Such a field would be permanently hidden, silently collecting nothing.
    expect(offenders).toEqual([]);
  });

  it('resolves every conditional_on to a real top-level field', () => {
    const topIds = new Set(allFields.map((f) => f.field_id));
    const broken = allFields
      .filter((f) => f.conditional_on && !topIds.has(f.conditional_on.field_id))
      .map((f) => `${f.field_id} -> ${f.conditional_on!.field_id}`);
    expect(broken).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// v1.1 — required only where South African law or SANS demands it.
//
// v1.0 demanded ~234 answers for a six-circuit job. Every borrowed good-practice
// item (BS 7671, AS/NZS 3000, HSG85, Watercare) STAYS ON THE FORM; it simply
// stops being `required`. `field.form_templates.schema_json` is immutable by DB
// trigger and v1.0 is live, so this is a new version rather than an edit.
//
// The tests below pin two things a future edit must not quietly undo:
//   1. the exact required set, section by section, and
//   2. that no field_id, section_id or option token from v1.0 was renamed or
//      removed -- the prefill map, the submit gates and the signature-block map
//      all key on those strings.
// ---------------------------------------------------------------------------

const parsedV11 = templateSchema.parse(terminationAndMakingSafeV11);

function sectionByIdV11(id: string): Section {
  const s = parsedV11.sections.find((x) => x.section_id === id);
  if (!s) throw new Error(`v1.1 section ${id} not found`);
  return s as Section;
}

function fieldByIdV11(sectionId: string, fieldId: string): Field {
  const f = sectionByIdV11(sectionId).fields.find((x) => x.field_id === fieldId);
  if (!f) throw new Error(`v1.1 field ${sectionId}.${fieldId} not found`);
  return f;
}

function subFieldsV11(sectionId: string, groupId: string): Field[] {
  const group = fieldByIdV11(sectionId, groupId);
  if (!group.fields?.length) throw new Error(`v1.1 group ${groupId} has no sub-fields`);
  return group.fields;
}

/** field_ids of the required fields directly on a section, in template order. */
function requiredIdsV11(sectionId: string): string[] {
  return sectionByIdV11(sectionId)
    .fields.filter((f) => f.required === true)
    .map((f) => f.field_id);
}

const allFieldsV11 = parsedV11.sections.flatMap((s) => walk(s.fields as Field[]));

// Top-level required count per section. db_identification is 12 = the 10
// identification fields the registration-scope and isolation gates read, plus
// the two as-found photos (board open, existing legend card) that are the only
// evidence of what was BELIEVED to be where. scope_of_work is 4 + the new
// `work_type`; hazards_defects is 5 + the new `hazard_sweep_completed`.
const EXPECTED_REQUIRED_COUNTS: Record<string, number> = {
  project_site: 7,
  db_identification: 12,
  earthing_adequacy: 3,
  personnel: 9,
  scope_of_work: 5,
  circuits_affected: 1,
  safe_isolation: 15,
  lock_register: 1,
  test_instruments: 1,
  proving_dead: 4,
  electrical_tests: 0,
  labelling_reinstatement: 4,
  photographic_evidence: 2,
  hazards_defects: 6,
  handover_status: 3,
  declarations: 6,
};

const WORK_TYPE_OPTIONS = [
  'make_safe_leave_dead',
  'terminate_and_re_energise',
  'board_modification',
  'temporary_supply',
  'decommission_remove',
  'isolation_for_third_party',
  'other',
];

// The 17-item pre-work hazard sweep (§11A). All optional in v1.1, replaced by a
// single required confirmation; kept on the form as the detailed checklist.
const HAZARD_SWEEP_ITEM_IDS = [
  'hs_disconnection_planned_and_tagged',
  'hs_no_bare_conductor_contact',
  'hs_breakers_off_locked_tagged',
  'hs_locking_device_on_individual_circuit',
  'hs_auxiliary_and_alternative_supplies_dead',
  'hs_power_cables_tested_and_isolated',
  'hs_live_cables_in_work_zones_isolated',
  'hs_temporary_cabling_tagged',
  'hs_danger_tags_at_all_points',
  'hs_cabling_tested_in_ceilings_and_cavities',
  'hs_in_use_cabling_labelled',
  'hs_power_to_demolition_areas_disconnected',
  'hs_power_to_offices_and_partitions_isolated',
  'hs_lighting_and_emergency_lighting_isolated',
  'hs_all_demolition_areas_isolated',
  'hs_borrowed_neutrals_checked',
  'hs_backfeed_prevented_heaters_shutters',
];

describe('termination-and-making-safe v1.1', () => {
  it('validates against templateSchema', () => {
    expect(() => templateSchema.parse(terminationAndMakingSafeV11)).not.toThrow();
  });

  it('is version 1.1 of the same template, with the same identity', () => {
    expect(parsedV11.version).toBe('1.1');
    expect(parsedV11.template_id).toBe('termination-and-making-safe');
    expect(parsedV11.name).toBe('Termination and Making Safe');
    expect(parsedV11.applies_to_node_types).toEqual(['board', 'any']);
    expect(parsedV11.sans_reference).toBe('SANS 10142-1');
    expect(parsedV11.deliverable_type).toBe('inspection_only');
  });

  it('keeps the 16 engine sections in the same order', () => {
    expect(parsedV11.sections.map((s) => s.section_id)).toEqual(EXPECTED_SECTION_IDS);
  });

  it('has globally unique field ids', () => {
    const ids = allFieldsV11.map((f) => f.field_id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('deletes nothing — every v1.0 field survives', () => {
    const before = allFields.map((f) => f.field_id);
    const after = new Set(allFieldsV11.map((f) => f.field_id));
    expect(before.filter((id) => !after.has(id))).toEqual([]);
    // v1.1 adds exactly the two new fields and nothing else.
    const added = [...after].filter((id) => !before.includes(id)).sort();
    expect(added).toEqual(['hazard_sweep_completed', 'work_type']);
  });
});

describe('v1.1 required set — law and SANS only', () => {
  it('matches the agreed required count in every section', () => {
    const actual: Record<string, number> = {};
    for (const s of parsedV11.sections) {
      actual[s.section_id] = s.fields.filter((f) => f.required === true).length;
    }
    expect(actual).toEqual(EXPECTED_REQUIRED_COUNTS);
  });

  it('never marks a header or computed field required', () => {
    const offenders = allFieldsV11
      .filter((f) => f.required === true && (f.type === 'header' || f.type === 'computed'))
      .map((f) => f.field_id);
    expect(offenders).toEqual([]);
  });

  // Pinned by field_id, not just by count: a future edit that swaps one legally
  // mandated field for another would keep the count and still be wrong.
  it('pins the exact db_identification required set', () => {
    expect(requiredIdsV11('db_identification').sort()).toEqual(
      [
        'above_1kv',
        'alternative_supplies',
        'db_description',
        'db_fed_from',
        'db_location',
        'db_reference',
        'nominal_voltage',
        'phases',
        'photo_db_open_as_found',
        'photo_existing_legend_card',
        'specialised_installation',
        'supply_system',
      ].sort(),
    );
  });

  it('pins the exact safe_isolation required set', () => {
    expect(requiredIdsV11('safe_isolation').sort()).toEqual(
      [
        'point_of_isolation_under_control',
        'all_sources_identified',
        'alternative_supply_isolated',
        'circuit_de_energised',
        'all_required_poles_isolated',
        'isolating_device_secured',
        'securing_method',
        'caution_notice_posted',
        'indicator_proved_before',
        'tested_dead',
        'indicator_proved_after',
        'stored_energy_discharged',
        'prevention_of_re_energisation',
        'safe_isolation_confirmed',
        'photo_lock_and_notice',
      ].sort(),
    );
  });

  it('keeps the prove — test — prove sequence required', () => {
    for (const id of ['indicator_proved_before', 'tested_dead', 'indicator_proved_after']) {
      const f = fieldByIdV11('safe_isolation', id);
      expect(f.type).toBe('pass_fail');
      expect(f.required).toBe(true);
    }
  });

  it('requires exactly six circuit sub-fields — the 13xN tax is the biggest win', () => {
    const required = subFieldsV11('circuits_affected', 'circuits')
      .filter((f) => f.required === true)
      .map((f) => f.field_id);
    expect(required.sort()).toEqual(
      [
        'circuit_ref',
        'description_as_verified',
        'action_taken',
        'conductor_labelled_dead',
        'proved_dead_at_point_of_work',
        'photo_circuit_termination',
      ].sort(),
    );
  });

  it('requires four lock-register sub-fields, including second-person verification', () => {
    const required = subFieldsV11('lock_register', 'lock_entries')
      .filter((f) => f.required === true)
      .map((f) => f.field_id);
    expect(required.sort()).toEqual(
      ['isolation_point', 'isolation_method', 'applied_by', 'verified_by'].sort(),
    );
  });

  it('requires five instrument sub-fields, including the calibration date a gate reads', () => {
    const required = subFieldsV11('test_instruments', 'instruments')
      .filter((f) => f.required === true)
      .map((f) => f.field_id);
    expect(required.sort()).toEqual(
      ['instrument_function', 'make', 'model', 'serial_number', 'calibration_due_date'].sort(),
    );
  });

  it('requires the reg 9(3) C1 pair, which the submit gate already enforces', () => {
    expect(fieldByIdV11('hazards_defects', 'supply_disconnected').required).toBe(true);
    expect(fieldByIdV11('hazards_defects', 'chief_inspector_notified').required).toBe(true);
    // Both stay gated on a C1 finding, so they only bind when one exists.
    for (const id of ['supply_disconnected', 'chief_inspector_notified']) {
      expect(fieldByIdV11('hazards_defects', id).conditional_on).toEqual({
        field_id: 'immediate_danger_present',
        equals: true,
      });
    }
  });

  it('keeps both liability shields required', () => {
    expect(fieldByIdV11('hazards_defects', 'extent_and_limitations').required).toBe(true);
    expect(fieldByIdV11('hazards_defects', 'parts_not_covered').required).toBe(true);
  });

  it('keeps the pre-existing-damage record required — the contractor’s defence', () => {
    const f = fieldByIdV11('earthing_adequacy', 'pre_existing_damage_noted');
    expect(f.type).toBe('textarea');
    expect(f.required).toBe(true);
  });

  it('requires only the electrician and registered-person declarations', () => {
    expect(requiredIdsV11('declarations').sort()).toEqual(
      [
        'electrician_declaration_name',
        'electrician_declaration_signature',
        'registered_person_declaration_name',
        'registered_person_certificate_no',
        'registered_person_declaration_type',
        'registered_person_declaration_signature',
      ].sort(),
    );
  });

  it('requires exactly three signatures — v1.0 demanded seven blocks', () => {
    const sigs = allFieldsV11.filter((f) => f.type === 'signature');
    expect(sigs.filter((f) => f.required === true).map((f) => f.field_id).sort()).toEqual([
      'electrician_declaration_signature',
      'registered_person_declaration_signature',
      'safe_isolation_confirmed',
    ]);
    // All seven signature blocks remain on the form, just not all mandatory.
    expect(sigs.length).toBe(7);
  });

  it('requires six photo slots — v1.0 demanded sixteen', () => {
    // photo_circuit_termination is a repeating-group sub-field, so it is one
    // definition here but one capture per circuit on site.
    const photos = allFieldsV11
      .filter((f) => f.type === 'photo' && f.required === true)
      .map((f) => f.field_id);
    expect(photos.sort()).toEqual(
      [
        'photo_db_open_as_found',
        'photo_existing_legend_card',
        'photo_lock_and_notice',
        'photo_circuit_termination',
        'photo_db_open_as_left',
        'photo_db_closed_as_left',
      ].sort(),
    );
    // §10 keeps only the as-left pair; the rest of it duplicates §2 and §6.
    expect(requiredIdsV11('photographic_evidence').sort()).toEqual([
      'photo_db_closed_as_left',
      'photo_db_open_as_left',
    ]);
  });
});

describe('v1.1 hazard sweep — one confirmation, checklist retained', () => {
  it('adds a required hazard_sweep_completed immediately before the 17 items', () => {
    const f = fieldByIdV11('hazards_defects', 'hazard_sweep_completed');
    expect(f.type).toBe('pass_fail');
    expect(f.required).toBe(true);

    const ids = sectionByIdV11('hazards_defects').fields.map((x) => x.field_id);
    expect(ids.indexOf('hazard_sweep_completed')).toBe(
      ids.indexOf('hs_disconnection_planned_and_tagged') - 1,
    );
  });

  it('keeps all 17 sweep items on the form, none of them required', () => {
    const ids = sectionByIdV11('hazards_defects').fields.map((x) => x.field_id);
    for (const id of HAZARD_SWEEP_ITEM_IDS) {
      expect(ids).toContain(id);
      expect(fieldByIdV11('hazards_defects', id).required).toBeUndefined();
    }
    expect(HAZARD_SWEEP_ITEM_IDS.length).toBe(17);
  });

  it('explains on the first item that they back the single confirmation', () => {
    const first = fieldByIdV11('hazards_defects', 'hs_disconnection_planned_and_tagged');
    expect(first.help_text).toMatch(/hazard sweep/i);
    expect(first.help_text).toMatch(/optional/i);
  });

  it('makes the two hazard-sweep signature blocks optional', () => {
    for (const id of ['hazard_sweep_technician_signature', 'hazard_sweep_supervisor_signature']) {
      const f = fieldByIdV11('hazards_defects', id);
      expect(f.type).toBe('signature');
      expect(f.required).toBeUndefined();
    }
  });
});

describe('v1.1 work_type and section conditionals', () => {
  it('adds work_type immediately after nature_of_work', () => {
    const ids = sectionByIdV11('scope_of_work').fields.map((f) => f.field_id);
    expect(ids.indexOf('work_type')).toBe(ids.indexOf('nature_of_work') + 1);
  });

  // `checkCondition` resolves equals/in against `value_text` / `value_number`
  // and never against `value_array`, so a multi_select trigger can never match.
  // work_type MUST stay single-select or both section conditionals go dead.
  it('is a required single-select dropdown, not a multi_select', () => {
    const f = fieldByIdV11('scope_of_work', 'work_type');
    expect(f.type).toBe('dropdown');
    expect(f.type).not.toBe('multi_select');
    expect(f.required).toBe(true);
    expect(f.help_text).toBeTruthy();
  });

  it('offers exactly the seven agreed work-type tokens', () => {
    expect(fieldByIdV11('scope_of_work', 'work_type').options).toEqual(WORK_TYPE_OPTIONS);
  });

  it('shows electrical_tests only for the three re-energising work types', () => {
    expect(sectionByIdV11('electrical_tests').conditional_on).toEqual({
      field_id: 'work_type',
      in: ['terminate_and_re_energise', 'board_modification', 'temporary_supply'],
    });
  });

  it('hides labelling_reinstatement when the board is decommissioned and removed', () => {
    expect(sectionByIdV11('labelling_reinstatement').conditional_on).toEqual({
      field_id: 'work_type',
      not_equals: 'decommission_remove',
    });
  });

  it('gates no other section — isolation, circuits and declarations always apply', () => {
    const gated = parsedV11.sections
      .filter((s) => (s as Section).conditional_on)
      .map((s) => s.section_id);
    expect(gated.sort()).toEqual(['electrical_tests', 'labelling_reinstatement']);
  });

  it('references only real work_type tokens in both section conditionals', () => {
    const options = new Set(fieldByIdV11('scope_of_work', 'work_type').options ?? []);
    for (const s of parsedV11.sections) {
      const cond = (s as Section).conditional_on;
      if (!cond) continue;
      expect(cond.field_id).toBe('work_type');
      const targets =
        'in' in cond ? cond.in : 'not_equals' in cond ? [cond.not_equals] : [cond];
      for (const t of targets as unknown[]) {
        expect(options.has(String(t))).toBe(true);
      }
    }
  });
});

// Downstream code -- the prefill map, the submit gates, the signature-block map,
// the PDF renderer -- keys on these exact strings. A rename is a silent break:
// the field still renders, but nothing prefills it and no gate ever sees it.
describe('v1.1 renames or removes nothing from v1.0', () => {
  function optionTokens(fields: Field[], acc: Set<string> = new Set()): Set<string> {
    for (const f of fields) {
      for (const o of f.options ?? []) acc.add(`${f.field_id}:${o}`);
      if (f.fields?.length) optionTokens(f.fields, acc);
    }
    return acc;
  }

  it('keeps every v1.0 section_id', () => {
    const after = new Set(parsedV11.sections.map((s) => s.section_id));
    const missing = parsed.sections.map((s) => s.section_id).filter((id) => !after.has(id));
    expect(missing).toEqual([]);
  });

  it('keeps every v1.0 field_id, at every depth', () => {
    const after = new Set(allFieldsV11.map((f) => f.field_id));
    const missing = allFields.map((f) => f.field_id).filter((id) => !after.has(id));
    expect(missing).toEqual([]);
  });

  it('keeps every v1.0 dropdown / multi_select option token, on the same field', () => {
    const before = optionTokens(parsed.sections.flatMap((s) => s.fields as Field[]));
    const after = optionTokens(parsedV11.sections.flatMap((s) => s.fields as Field[]));
    const missing = [...before].filter((t) => !after.has(t));
    expect(missing).toEqual([]);
  });

  it('keeps every v1.0 field on the same section and in the same relative order', () => {
    for (const before of parsed.sections) {
      const after = sectionByIdV11(before.section_id);
      const beforeIds = before.fields.map((f) => f.field_id);
      const afterIds = after.fields.map((f) => f.field_id).filter((id) => beforeIds.includes(id));
      expect(afterIds).toEqual(beforeIds);
    }
  });

  it('keeps every v1.0 field type and conditional_on unchanged', () => {
    const byId = new Map(allFieldsV11.map((f) => [f.field_id, f]));
    for (const before of allFields) {
      const after = byId.get(before.field_id)!;
      expect(`${before.field_id}:${after.type}`).toBe(`${before.field_id}:${before.type}`);
      expect(after.conditional_on).toEqual(before.conditional_on);
    }
  });

  it('keeps every signature field the signature-block map points at', () => {
    const sigIds = new Set(
      allFieldsV11.filter((f) => f.type === 'signature').map((f) => f.field_id),
    );
    for (const id of [
      'safe_isolation_confirmed',
      'hazard_sweep_technician_signature',
      'hazard_sweep_supervisor_signature',
      'electrician_declaration_signature',
      'registered_person_declaration_signature',
      'supervisor_signature',
      'client_signature',
    ]) {
      expect(sigIds.has(id)).toBe(true);
    }
  });

  it('holds the v1.1 engine invariants the v1.0 tests pin', () => {
    const groups = allFieldsV11.filter((f) => f.type === 'repeating_group');
    expect(groups.length).toBeGreaterThan(0);

    const subConditionals: string[] = [];
    for (const g of groups) {
      for (const sub of g.fields ?? []) {
        expect(sub.type).not.toBe('repeating_group');
        if ((sub as { conditional_on?: unknown }).conditional_on) {
          subConditionals.push(`${g.field_id}[].${sub.field_id}`);
        }
      }
    }
    expect(subConditionals).toEqual([]);

    const topIds = new Set(allFieldsV11.map((f) => f.field_id));
    const subIds = new Set(groups.flatMap((g) => (g.fields ?? []).map((s) => s.field_id)));
    const broken = allFieldsV11
      .filter((f) => f.conditional_on)
      .filter((f) => !topIds.has(f.conditional_on!.field_id) || subIds.has(f.conditional_on!.field_id))
      .map((f) => `${f.field_id} -> ${f.conditional_on!.field_id}`);
    expect(broken).toEqual([]);
  });
});
