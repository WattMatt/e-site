import { describe, it, expect } from 'vitest';
import { evaluateField, isFieldVisible, evaluateInspection, computeDerivedField } from './engine';
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

describe('evaluateField — text/dropdown/multi_select with pass_when DSL', () => {
  const textField = (pw?: string): Field => ({ field_id: 't', label: 'T', type: 'text', pass_when: pw });
  const ddField = (pw?: string): Field => ({ field_id: 'd', label: 'D', type: 'dropdown', options: ['a','b','c','d'], pass_when: pw });
  const msField = (pw?: string): Field => ({ field_id: 'm', label: 'M', type: 'multi_select', options: ['a','b','c','d'], pass_when: pw });

  it('in [a, b, c] (unquoted) — match passes, miss fails, empty not_checked', () => {
    const f = ddField('in [a, b, c]');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'a' }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'd' }).passState).toBe('fail');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: '' }).passState).toBe('not_checked');
  });

  it('in ["a","b","c"] (quoted) — same behaviour', () => {
    const f = ddField('in ["a","b","c"]');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'a' }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'd' }).passState).toBe('fail');
  });

  it('in [...] is case-insensitive', () => {
    const f = ddField('in [Red, Green, Blue]');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'red' }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'd', value_text: 'GREEN' }).passState).toBe('pass');
  });

  it('matches /^[A-Z]{3}-\\d+$/ — match passes, miss fails, empty not_checked', () => {
    const f = textField('matches /^[A-Z]{3}-\\d+$/');
    expect(evaluateField(f, { section_id: 's', field_id: 't', value_text: 'ABC-123' }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 't', value_text: 'abc' }).passState).toBe('fail');
    expect(evaluateField(f, { section_id: 's', field_id: 't', value_text: '' }).passState).toBe('not_checked');
  });

  it('matches /.../i case-insensitive flag', () => {
    const f = textField('matches /^[a-z]+$/i');
    expect(evaluateField(f, { section_id: 's', field_id: 't', value_text: 'FOO' }).passState).toBe('pass');
  });

  it('multi_select with in [a,b,c] — all-subset passes, any-outside fails', () => {
    const f = msField('in [a,b,c]');
    expect(evaluateField(f, { section_id: 's', field_id: 'm', value_array: ['a','b'] }).passState).toBe('pass');
    expect(evaluateField(f, { section_id: 's', field_id: 'm', value_array: ['a','d'] }).passState).toBe('fail');
  });

  it('text without pass_when + filled — pass (existing behaviour preserved)', () => {
    expect(evaluateField(textField(), { section_id: 's', field_id: 't', value_text: 'anything' }).passState).toBe('pass');
  });

  it('unparseable text pass_when on filled value — advisory pass', () => {
    expect(evaluateField(textField('gibberish'), { section_id: 's', field_id: 't', value_text: 'whatever' }).passState).toBe('pass');
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

describe('isFieldVisible — extended conditional_on operators', () => {
  it('not_equals: true — value false visible, value true hidden, trigger absent hidden', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'number', conditional_on: { field_id: 'has_x', not_equals: true } };
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'has_x', value_bool: false }])).toBe(true);
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'has_x', value_bool: true }])).toBe(false);
    expect(isFieldVisible(f, [])).toBe(false);
  });

  it('greater_than: 10 — 15 visible, 5 hidden, trigger absent hidden', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'number', conditional_on: { field_id: 'amps', greater_than: 10 } };
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'amps', value_number: 15 }])).toBe(true);
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'amps', value_number: 5 }])).toBe(false);
    expect(isFieldVisible(f, [])).toBe(false);
  });

  it('less_than: 100 — 50 visible, 150 hidden', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'number', conditional_on: { field_id: 'volts', less_than: 100 } };
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'volts', value_number: 50 }])).toBe(true);
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'volts', value_number: 150 }])).toBe(false);
  });

  it('in [a,b] — value a visible, value c hidden', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'number', conditional_on: { field_id: 'kind', in: ['a','b'] } };
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'kind', value_text: 'a' }])).toBe(true);
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'kind', value_text: 'c' }])).toBe(false);
  });

  it('in [1,2,3] numeric — value 2 visible, value 9 hidden', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'number', conditional_on: { field_id: 'count', in: [1, 2, 3] } };
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'count', value_number: 2 }])).toBe(true);
    expect(isFieldVisible(f, [{ section_id: 's', field_id: 'count', value_number: 9 }])).toBe(false);
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

  it('hidden required fields are not flagged as missing', () => {
    // When `has_x` is answered false, the conditional `x_value` field is hidden.
    // A hidden required field should NOT appear in missingRequired (the inspector
    // can't fill it in if it's not visible). `has_x` itself fails (answered no),
    // so overallResult is 'fail' — but for the *right* reason (has_x failed),
    // not because x_value was wrongly required.
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
    expect(r.missingRequired).toHaveLength(0);          // x_value not required (hidden)
    expect(r.visibleFieldCount).toBe(1);                 // only has_x visible
    expect(r.failedFields).toHaveLength(1);              // has_x failed (answered no)
    expect(r.failedFields[0].fieldId).toBe('has_x');
    expect(r.overallResult).toBe('fail');                // because has_x is required+failed
  });

  it('reveals conditional required field when trigger flips on', () => {
    const t2: Template = {
      ...template,
      sections: [{
        section_id: 's', title: 'S', fields: [
          { field_id: 'has_x', label: 'Has X?', type: 'pass_fail', required: true },
          { field_id: 'x_value', label: 'X', type: 'number', required: true, conditional_on: { field_id: 'has_x', equals: true } },
        ],
      }],
    };
    // has_x = true reveals x_value, which is required and missing
    const responses: Response[] = [{ section_id: 's', field_id: 'has_x', value_bool: true }];
    const r = evaluateInspection(t2, responses);
    expect(r.visibleFieldCount).toBe(2);
    expect(r.missingRequired).toEqual([{ sectionId: 's', fieldId: 'x_value' }]);
    expect(r.overallResult).toBe('fail');                // missing required → fail
  });
});

describe('evaluateField — non-numeric / non-bool types', () => {
  const baseResp = (fieldId: string) => ({ section_id: 's', field_id: fieldId });

  it('text passes when filled, not_checked when empty', () => {
    const f: Field = { field_id: 't', label: 'T', type: 'text' };
    expect(evaluateField(f, { ...baseResp('t'), value_text: 'hi' }).passState).toBe('pass');
    expect(evaluateField(f, baseResp('t')).passState).toBe('not_checked');
  });

  it('textarea passes when filled', () => {
    const f: Field = { field_id: 't', label: 'T', type: 'textarea' };
    expect(evaluateField(f, { ...baseResp('t'), value_text: 'long' }).passState).toBe('pass');
  });

  it('dropdown passes when selected', () => {
    const f: Field = { field_id: 'd', label: 'D', type: 'dropdown', options: ['a','b'] };
    expect(evaluateField(f, { ...baseResp('d'), value_text: 'a' }).passState).toBe('pass');
  });

  it('date passes when filled', () => {
    const f: Field = { field_id: 'dt', label: 'DT', type: 'date' };
    expect(evaluateField(f, { ...baseResp('dt'), value_text: '2026-05-18' }).passState).toBe('pass');
  });

  it('multi_select passes when any options selected, not_checked when empty array', () => {
    const f: Field = { field_id: 'm', label: 'M', type: 'multi_select', options: ['a','b','c'] };
    expect(evaluateField(f, { ...baseResp('m'), value_array: ['a','b'] }).passState).toBe('pass');
    expect(evaluateField(f, { ...baseResp('m'), value_array: [] }).passState).toBe('not_checked');
    expect(evaluateField(f, baseResp('m')).passState).toBe('not_checked');
  });

  it('photo / signature / file / header / computed return na (pass-state computed elsewhere)', () => {
    for (const type of ['photo','signature','file','header','computed'] as const) {
      const f: Field = { field_id: 'x', label: 'X', type };
      expect(evaluateField(f, baseResp('x')).passState).toBe('na');
    }
  });

  it('number with missing value returns not_checked', () => {
    const f: Field = { field_id: 'n', label: 'N', type: 'number' };
    expect(evaluateField(f, baseResp('n')).passState).toBe('not_checked');
  });

  it('number without pass_when passes when filled (advisory)', () => {
    const f: Field = { field_id: 'n', label: 'N', type: 'number' };
    expect(evaluateField(f, { ...baseResp('n'), value_number: 42 }).passState).toBe('pass');
  });
});

describe('evaluateInspection — photo/signature min_count', () => {
  const baseTemplate: Template = {
    template_id: 'tpl-photos', name: 'Photos', version: '1.0',
    applies_to_node_types: ['board'], deliverable_type: 'coc',
    sections: [{
      section_id: 's', title: 'S', fields: [
        { field_id: 'before_photos', label: 'Before photos', type: 'photo', required: true, min_count: 3 },
      ],
    }],
  };

  it('flags required photo with min_count: 3 when only 1 uploaded', () => {
    const attachments = { photos: [{ section_id: 's', field_id: 'before_photos' }] };
    const r = evaluateInspection(baseTemplate, [], attachments);
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'before_photos' });
    expect(r.failedFields.some(f => f.fieldId === 'before_photos' && /1 of 3/.test(f.reason))).toBe(true);
  });

  it('passes required photo with min_count: 3 when 3 uploaded', () => {
    const attachments = {
      photos: [
        { section_id: 's', field_id: 'before_photos' },
        { section_id: 's', field_id: 'before_photos' },
        { section_id: 's', field_id: 'before_photos' },
      ],
    };
    const r = evaluateInspection(baseTemplate, [], attachments);
    expect(r.missingRequired).toHaveLength(0);
    expect(r.failedFields).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });

  it('treats required photo without min_count as min_count: 1 — 0 uploaded flags missing', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'one_photo', label: 'One', type: 'photo', required: true }] }],
    };
    const r = evaluateInspection(t, [], { photos: [] });
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'one_photo' });
  });

  it('required photo without min_count + 1 uploaded passes', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'one_photo', label: 'One', type: 'photo', required: true }] }],
    };
    const r = evaluateInspection(t, [], { photos: [{ section_id: 's', field_id: 'one_photo' }] });
    expect(r.missingRequired).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });

  it('optional photo with 0 uploaded — not in missingRequired', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'extra', label: 'Extra', type: 'photo' }] }],
    };
    const r = evaluateInspection(t, [], { photos: [] });
    expect(r.missingRequired).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });

  it('backwards-compat: omitting attachments arg → photos not validated', () => {
    const r = evaluateInspection(baseTemplate, []);
    expect(r.missingRequired).toHaveLength(0); // legacy behaviour preserved
    expect(r.overallResult).toBe('pass');
  });

  it('required signature missing → flagged as missingRequired', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'inspector_sig', label: 'Inspector', type: 'signature', required: true }] }],
    };
    const r = evaluateInspection(t, [], { photos: [], signatures: [] });
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'inspector_sig' });
  });

  it('required signature satisfied by 1 entry', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'inspector_sig', label: 'Inspector', type: 'signature', required: true }] }],
    };
    const r = evaluateInspection(t, [], { signatures: [{ section_id: 's', field_id: 'inspector_sig' }] });
    expect(r.missingRequired).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });
});

describe('computeDerivedField', () => {
  it('returns null for plain-English formula (v1 stub — wire later)', () => {
    const f: Field = { field_id: 'overall_pass', label: 'Overall', type: 'computed', formula: 'all required pass_fail fields are true' };
    expect(computeDerivedField(f, [])).toBe(null);
  });
});
