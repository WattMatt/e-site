import { describe, it, expect } from 'vitest';
import { evaluateField, isFieldVisible, evaluateInspection } from './engine';
import type { Field, Template, Response } from './types';

const passFailField: Field = { field_id: 'x', label: 'X', type: 'pass_fail', required: true };
const numberField: Field = { field_id: 'ir', label: 'IR', type: 'number', unit: 'MΩ', pass_when: '>= 1', required: true };

describe('evaluateField — pass_fail', () => {
  it('passes when value_bool=true', () => {
    expect(evaluateField(passFailField, { section_id: 's', field_id: 'x', value_bool: true }).passState).toBe('pass');
  });
  it('fails when value_bool=false', () => {
    const r = evaluateField(passFailField, { section_id: 's', field_id: 'x', value_bool: false, fail_reason: 'bent' });
    expect(r.passState).toBe('fail');
    expect(r.reason).toBe('bent');
  });
  it('not_checked when value missing', () => {
    expect(evaluateField(passFailField, { section_id: 's', field_id: 'x' }).passState).toBe('not_checked');
  });
});

describe('evaluateField — number with pass_when', () => {
  it('passes when >= threshold', () => {
    expect(evaluateField(numberField, { section_id: 's', field_id: 'ir', value_number: 1.5 }).passState).toBe('pass');
  });
  it('fails when < threshold', () => {
    expect(evaluateField(numberField, { section_id: 's', field_id: 'ir', value_number: 0.5 }).passState).toBe('fail');
  });
  it('handles between A and B (inclusive)', () => {
    const f: Field = { ...numberField, pass_when: 'between 0.5 and 2' };
    expect(evaluateField(f, { section_id: 's', field_id: 'ir', value_number: 0.5 }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'ir', value_number: 2 }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'ir', value_number: 0.4 }).passState).toBe('fail');
  });
  it('handles each comparator (>= > <= < = !=)', () => {
    const cases: [string, number, 'pass'|'fail'][] = [
      ['> 0', 1, 'pass'], ['> 0', 0, 'fail'],
      ['< 5', 4, 'pass'], ['< 5', 5, 'fail'],
      ['= 3', 3, 'pass'], ['= 3', 3.1, 'fail'],
      ['!= 0', 1, 'pass'], ['!= 0', 0, 'fail'],
    ];
    for (const [pw, val, expected] of cases) {
      expect(evaluateField({ ...numberField, pass_when: pw }, { section_id: 's', field_id: 'ir', value_number: val }).passState, `${pw} with ${val}`).toBe(expected);
    }
  });
  it('treats unparseable pass_when as advisory (passes if filled)', () => {
    expect(evaluateField({ ...numberField, pass_when: 'gibberish' }, { section_id: 's', field_id: 'ir', value_number: 42 }).passState).toBe('pass');
  });
});

describe('isFieldVisible — conditional_on', () => {
  const trigger: Field = { field_id: 'has_rcd', label: 'Has RCD?', type: 'pass_fail' };
  const dependent: Field = { field_id: 'rcd_trip_ms', label: 'RCD trip', type: 'number', conditional_on: { field_id: 'has_rcd', equals: true } };

  it('visible when trigger matches', () => {
    const responses: Response[] = [{ section_id: 's', field_id: 'has_rcd', value_bool: true }];
    expect(isFieldVisible(dependent, responses)).toBe(true);
  });
  it('hidden when trigger does not match', () => {
    const responses: Response[] = [{ section_id: 's', field_id: 'has_rcd', value_bool: false }];
    expect(isFieldVisible(dependent, responses)).toBe(false);
  });
  it('hidden when trigger absent', () => {
    expect(isFieldVisible(dependent, [])).toBe(false);
  });
  it('always visible when no conditional_on', () => {
    expect(isFieldVisible(trigger, [])).toBe(true);
  });
});

describe('evaluateInspection', () => {
  const template: Template = {
    template_id: 'test', name: 'Test', version: '1.0',
    applies_to_node_types: ['board'], deliverable_type: 'coc',
    sections: [{
      section_id: 's', title: 'S', fields: [
        { field_id: 'a', label: 'A', type: 'pass_fail', required: true },
        { field_id: 'b', label: 'B', type: 'number', unit: 'V', pass_when: '>= 220', required: true },
        { field_id: 'c', label: 'C', type: 'pass_fail' },
      ],
    }],
  };

  it('overall pass when all required pass + no optional fail', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: true },
      { section_id: 's', field_id: 'b', value_number: 230 },
    ];
    const r = evaluateInspection(template, responses);
    expect(r.overallResult).toBe('pass');
    expect(r.missingRequired).toHaveLength(0);
    expect(r.failedFields).toHaveLength(0);
  });

  it('overall fail when a required field fails', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: false, fail_reason: 'broken' },
      { section_id: 's', field_id: 'b', value_number: 230 },
    ];
    const r = evaluateInspection(template, responses);
    expect(r.overallResult).toBe('fail');
    expect(r.failedFields).toContainEqual({ sectionId: 's', fieldId: 'a', reason: 'broken' });
  });

  it('conditional_pass when required all pass but optional field failed', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: true },
      { section_id: 's', field_id: 'b', value_number: 230 },
      { section_id: 's', field_id: 'c', value_bool: false, fail_reason: 'cosmetic' },
    ];
    expect(evaluateInspection(template, responses).overallResult).toBe('conditional_pass');
  });

  it('flags missing required fields', () => {
    const r = evaluateInspection(template, []);
    expect(r.missingRequired).toHaveLength(2);
    expect(r.overallResult).toBe('fail');
  });

  it('does not require hidden fields', () => {
    const t2: Template = {
      ...template,
      sections: [{
        section_id: 's', title: 'S', fields: [
          { field_id: 'has_x', label: 'Has X?', type: 'pass_fail', required: true },
          { field_id: 'x_value', label: 'X', type: 'number', required: true, conditional_on: { field_id: 'has_x', equals: true } },
        ],
      }],
    };
    const responses: Response[] = [{ section_id: 's', field_id: 'has_x', value_bool: false }];
    const r = evaluateInspection(t2, responses);
    expect(r.missingRequired).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });
});
