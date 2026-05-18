import { describe, it, expect } from 'vitest';
import { evaluateField } from './engine';
import type { Field } from './types';

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
