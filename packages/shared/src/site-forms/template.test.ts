import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { templateSchema } from '../inspections/template-schema';
import type { Field, Section } from '../inspections/types';
import terminationAndMakingSafe from './templates/termination-and-making-safe.json';

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
