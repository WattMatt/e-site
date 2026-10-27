import { describe, it, expect } from 'vitest';
import {
  evaluateField,
  isFieldVisible,
  evaluateInspection,
  computeDerivedField,
  parseRepeatingGroupKey,
  buildRepeatingGroupKey,
  listRepeatingGroupEntryIndices,
} from './engine';
import type { Field, Section, SubSection, Template, Response } from './types';
import { templateSchema } from './template-schema';

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

  it('a pass_fail ticked Fail is recorded, not failing — even when required', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: false, fail_reason: 'broken' },
      { section_id: 's', field_id: 'b', value_number: 230 },
    ];
    const r = evaluateInspection(template, responses);
    expect(r.overallResult).toBe('pass');
    expect(r.failedFields).toHaveLength(0);
    expect(r.flaggedFields).toContainEqual({ sectionId: 's', fieldId: 'a', reason: 'broken' });
  });

  it('a reading outside pass_when is flagged, not failing', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: true },
      { section_id: 's', field_id: 'b', value_number: 200 },
      { section_id: 's', field_id: 'c', value_bool: false, fail_reason: 'cosmetic' },
    ];
    const r = evaluateInspection(template, responses);
    expect(r.overallResult).toBe('pass');
    expect(r.flaggedFields.map((f) => f.fieldId).sort()).toEqual(['b', 'c']);
  });

  it('missing required answers block (blockingMissing) but are not a verdict', () => {
    const r = evaluateInspection(template, []);
    expect(r.missingRequired).toHaveLength(2);
    expect(r.blockingMissing).toHaveLength(2);
    expect(r.overallResult).toBe('pass');
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
    expect(r.flaggedFields).toHaveLength(1);             // has_x answered no: recorded
    expect(r.flaggedFields[0].fieldId).toBe('has_x');
    expect(r.overallResult).toBe('pass');                // a Fail tick never fails the inspection
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
    expect(r.blockingMissing).toEqual([{ sectionId: 's', fieldId: 'x_value' }]); // blocks submit
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
    expect(r.flaggedFields.some(f => f.fieldId === 'before_photos' && /1 of 3/.test(f.reason))).toBe(true);
    // A photo shortfall never blocks an inspection.
    expect(r.blockingMissing).toHaveLength(0);
    expect(r.missingPhotos).toEqual([{ sectionId: 's', fieldId: 'before_photos', reason: null }]);
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

describe('evaluateInspection — sub-sections', () => {
  // Template with one section that has a direct field AND a subsection with 2 fields.
  const buildTemplate = (
    sectionCond?: Section['conditional_on'],
    subsectionCond?: SubSection['conditional_on'],
  ): Template => ({
    template_id: 'tpl-sub', name: 'Sub', version: '1.0',
    applies_to_node_types: ['board'], deliverable_type: 'coc',
    sections: [
      // Trigger section that holds the conditional driver — always visible
      {
        section_id: 'driver', title: 'Driver', fields: [
          { field_id: 'has_extra', label: 'Has extra?', type: 'pass_fail', required: false },
        ],
      },
      {
        section_id: 's', title: 'S',
        conditional_on: sectionCond,
        fields: [
          { field_id: 'direct_a', label: 'Direct A', type: 'pass_fail', required: true },
        ],
        subsections: [
          {
            subsection_id: 'sub1', title: 'Sub 1',
            conditional_on: subsectionCond,
            fields: [
              { field_id: 'sub_a', label: 'Sub A', type: 'pass_fail', required: true },
              { field_id: 'sub_b', label: 'Sub B', type: 'number', pass_when: '>= 1' },
            ],
          },
        ],
      },
    ],
  });

  it('counts subsection fields in visibleFieldCount when no conditions present', () => {
    const r = evaluateInspection(buildTemplate(), []);
    // 1 driver + 1 direct + 2 subsection = 4 visible
    expect(r.visibleFieldCount).toBe(4);
  });

  it('evaluates a subsection field — required + missing → missingRequired flagged', () => {
    const r = evaluateInspection(buildTemplate(), []);
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'direct_a' });
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'sub_a' });
  });

  it('subsection-level conditional_on hides only that subsection — direct field still visible', () => {
    const cond = { field_id: 'has_extra', equals: true } as const;
    const t = buildTemplate(undefined, cond);
    // has_extra not answered → subsection hidden
    const r = evaluateInspection(t, []);
    expect(r.visibleFieldCount).toBe(2); // driver + direct_a only
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'direct_a' });
    expect(r.missingRequired).not.toContainEqual({ sectionId: 's', fieldId: 'sub_a' });
  });

  it('subsection-level conditional_on reveals subsection when trigger flips on', () => {
    const cond = { field_id: 'has_extra', equals: true } as const;
    const t = buildTemplate(undefined, cond);
    const responses: Response[] = [{ section_id: 'driver', field_id: 'has_extra', value_bool: true }];
    const r = evaluateInspection(t, responses);
    expect(r.visibleFieldCount).toBe(4); // driver + direct + 2 sub
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'sub_a' });
  });

  it('section-level conditional_on hides EVERYTHING in that section (direct + all subsections)', () => {
    const cond = { field_id: 'has_extra', equals: true } as const;
    const t = buildTemplate(cond, undefined);
    const r = evaluateInspection(t, []);
    expect(r.visibleFieldCount).toBe(1); // only driver
    expect(r.missingRequired).toHaveLength(0); // hidden required fields don't count
  });

  it('section-level conditional_on revealed → direct + all subsection fields appear', () => {
    const cond = { field_id: 'has_extra', equals: true } as const;
    const t = buildTemplate(cond, undefined);
    const responses: Response[] = [{ section_id: 'driver', field_id: 'has_extra', value_bool: true }];
    const r = evaluateInspection(t, responses);
    expect(r.visibleFieldCount).toBe(4);
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'direct_a' });
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'sub_a' });
  });

  it('section visibility takes precedence over subsection visibility (parent hides → child hides)', () => {
    // Section-level says has_extra=true required. Subsection-level says always-visible.
    const sectionCond = { field_id: 'has_extra', equals: true } as const;
    const t = buildTemplate(sectionCond, undefined);
    // has_extra=false → section hidden → subsection also hidden
    const responses: Response[] = [{ section_id: 'driver', field_id: 'has_extra', value_bool: false }];
    const r = evaluateInspection(t, responses);
    expect(r.visibleFieldCount).toBe(1); // only driver
  });

  it('evaluateInspection overall pass when all subsection required pass + answered', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'direct_a', value_bool: true },
      { section_id: 's', field_id: 'sub_a', value_bool: true },
    ];
    const r = evaluateInspection(buildTemplate(), responses);
    expect(r.overallResult).toBe('pass');
  });

  it('section with NO direct fields but with subsections — engine iterates subsection fields', () => {
    const t: Template = {
      template_id: 'sub-only', name: 'Sub Only', version: '1.0',
      applies_to_node_types: ['board'], deliverable_type: 'coc',
      sections: [{
        section_id: 's', title: 'S',
        fields: [],
        subsections: [{
          subsection_id: 'ss', title: 'SS',
          fields: [{ field_id: 'only', label: 'Only', type: 'pass_fail', required: true }],
        }],
      }],
    };
    const r = evaluateInspection(t, []);
    expect(r.visibleFieldCount).toBe(1);
    expect(r.missingRequired).toContainEqual({ sectionId: 's', fieldId: 'only' });
  });
});

describe('computeDerivedField', () => {
  const buildTemplate = (): Template => ({
    template_id: 'tpl', name: 'T', version: '1.0',
    applies_to_node_types: ['board'], deliverable_type: 'coc',
    sections: [{
      section_id: 's', title: 'S', fields: [
        { field_id: 'a', label: 'A', type: 'pass_fail', required: true },
        { field_id: 'b', label: 'B', type: 'pass_fail', required: true },
        { field_id: 'c', label: 'C', type: 'pass_fail', required: true },
        { field_id: 'd', label: 'D', type: 'pass_fail', required: true },
      ],
    }],
  });

  it('legacy plain-English formula passes through as the formula string', () => {
    const f: Field = { field_id: 'overall_pass', label: 'Overall', type: 'computed', formula: 'all required pass_fail fields are true' };
    expect(computeDerivedField(f, [])).toBe('all required pass_fail fields are true');
  });

  it('count_visible_answered — 4 visible required fields, 3 answered → returns 3', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: true },
      { section_id: 's', field_id: 'b', value_bool: true },
      { section_id: 's', field_id: 'c', value_bool: false, fail_reason: 'x' },
    ];
    const tpl = buildTemplate();
    const f = { field_id: 'cnt', label: 'Cnt', type: 'computed' as const, formula_kind: 'count_visible_answered' as const };
    expect(computeDerivedField(f, responses, tpl)).toBe(3);
  });

  it('count_failed — 2 fields failing → returns 2', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'a', value_bool: true },
      { section_id: 's', field_id: 'b', value_bool: false, fail_reason: 'x' },
      { section_id: 's', field_id: 'c', value_bool: false, fail_reason: 'y' },
      { section_id: 's', field_id: 'd', value_bool: true },
    ];
    const tpl = buildTemplate();
    const f = { field_id: 'fail', label: 'Failed', type: 'computed' as const, formula_kind: 'count_failed' as const };
    expect(computeDerivedField(f, responses, tpl)).toBe(2);
  });

  it('count_visible total returns the visible count', () => {
    const tpl = buildTemplate();
    const f = { field_id: 'tot', label: 'Total', type: 'computed' as const, formula_kind: 'count_visible' as const };
    expect(computeDerivedField(f, [], tpl)).toBe(4);
  });

  it('unknown formula_kind returns null', () => {
    const tpl = buildTemplate();
    const f = { field_id: 'x', label: 'X', type: 'computed' as const, formula_kind: 'mystery_kind' as unknown as 'count_visible' };
    expect(computeDerivedField(f, [], tpl)).toBe(null);
  });

  it('no formula_kind and no formula string returns null', () => {
    const f: Field = { field_id: 'x', label: 'X', type: 'computed' };
    expect(computeDerivedField(f, [])).toBe(null);
  });
});

describe('repeating_group — synthetic field_id helpers', () => {
  it('parseRepeatingGroupKey extracts group / index / sub for a valid synthetic id', () => {
    expect(parseRepeatingGroupKey('snags[0].description')).toEqual({ group: 'snags', index: 0, sub: 'description' });
    expect(parseRepeatingGroupKey('snag_list[12].risk_level')).toEqual({ group: 'snag_list', index: 12, sub: 'risk_level' });
  });
  it('parseRepeatingGroupKey returns null for non-synthetic ids', () => {
    expect(parseRepeatingGroupKey('plain_field')).toBeNull();
    expect(parseRepeatingGroupKey('snags[abc].description')).toBeNull();
    expect(parseRepeatingGroupKey('snags.description')).toBeNull();
  });
  it('buildRepeatingGroupKey roundtrips through parseRepeatingGroupKey', () => {
    const k = buildRepeatingGroupKey('snags', 3, 'photo');
    expect(k).toBe('snags[3].photo');
    expect(parseRepeatingGroupKey(k)).toEqual({ group: 'snags', index: 3, sub: 'photo' });
  });
  it('listRepeatingGroupEntryIndices returns dedup, sorted indices for the matching group only', () => {
    const responses: Response[] = [
      { section_id: 's', field_id: 'snags[2].description', value_text: 'a' },
      { section_id: 's', field_id: 'snags[2].risk_level', value_text: 'low' },
      { section_id: 's', field_id: 'snags[0].description', value_text: 'b' },
      { section_id: 's', field_id: 'other_group[5].x', value_text: 'noise' },
      { section_id: 's', field_id: 'plain', value_text: 'noise' },
    ];
    expect(listRepeatingGroupEntryIndices('snags', responses)).toEqual([0, 2]);
    expect(listRepeatingGroupEntryIndices('other_group', responses)).toEqual([5]);
    expect(listRepeatingGroupEntryIndices('missing', responses)).toEqual([]);
  });
});

describe('pass_fail N/A (SANS checklist support)', () => {
  const naField: Field = { field_id: 'clause', label: 'Clause', type: 'pass_fail', required: true };

  it('evaluateField returns na for an explicit pass_state na', () => {
    const r = evaluateField(naField, { section_id: 's', field_id: 'clause', value_bool: null, pass_state: 'na' });
    expect(r.passState).toBe('na');
  });

  it('a required pass_fail answered N/A counts as answered (not missingRequired) and does not fail', () => {
    const template: Template = {
      template_id: 'na-t', name: 'NA', version: '1.0',
      applies_to_node_types: ['any'], deliverable_type: 'inspection_only',
      sections: [{ section_id: 's', title: 'S', fields: [naField] }],
    };
    const r = evaluateInspection(template, [
      { section_id: 's', field_id: 'clause', value_bool: null, pass_state: 'na' },
    ]);
    expect(r.missingRequired).toHaveLength(0);
    expect(r.failedFields).toHaveLength(0);
    expect(r.overallResult).toBe('pass');
  });
});

describe('evaluateInspection — repeating_group', () => {
  const groupField: Field = {
    field_id: 'snags',
    label: 'Snag list',
    type: 'repeating_group',
    item_label_template: '{{description}} ({{risk_level}})',
    fields: [
      { field_id: 'description', label: 'Description', type: 'textarea', required: true },
      { field_id: 'risk_level', label: 'Risk', type: 'dropdown', options: ['low','medium','high','critical'], required: true },
      { field_id: 'photo', label: 'Photo', type: 'photo' },
    ],
  };
  const baseTemplate: Template = {
    template_id: 'tpl-rg', name: 'RG', version: '1.0',
    applies_to_node_types: ['board'], deliverable_type: 'inspection_only',
    sections: [{ section_id: 'obs', title: 'Observations', fields: [groupField] }],
  };

  it('2 entries each with both required sub-fields answered → overall pass', () => {
    const responses: Response[] = [
      { section_id: 'obs', field_id: 'snags[0].description', value_text: 'Loose terminal' },
      { section_id: 'obs', field_id: 'snags[0].risk_level', value_text: 'medium' },
      { section_id: 'obs', field_id: 'snags[1].description', value_text: 'Damaged label' },
      { section_id: 'obs', field_id: 'snags[1].risk_level', value_text: 'low' },
    ];
    const r = evaluateInspection(baseTemplate, responses);
    expect(r.overallResult).toBe('pass');
    expect(r.missingRequired).toHaveLength(0);
    // 2 entries × 3 visible sub-fields (description, risk_level, photo) = 6 visible.
    // photo sub is type='photo' and (with no attachments arg) is counted as visible
    // via the inner-loop's `visibleFieldCount++` and not flagged because it's optional.
    expect(r.visibleFieldCount).toBe(6);
    expect(r.answeredFieldCount).toBe(4); // 4 text answers; photos optional, none uploaded
  });

  it('min_count: 1 on optional repeating_group + 0 entries → flagged in missingRequired', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 'obs', title: 'Observations', fields: [{ ...groupField, required: false, min_count: 1 }] }],
    };
    const r = evaluateInspection(t, []);
    expect(r.missingRequired).toContainEqual({ sectionId: 'obs', fieldId: 'snags' });
  });

  it('required repeating_group with 0 entries → flagged in missingRequired', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 'obs', title: 'Observations', fields: [{ ...groupField, required: true }] }],
    };
    const r = evaluateInspection(t, []);
    expect(r.missingRequired).toContainEqual({ sectionId: 'obs', fieldId: 'snags' });
    expect(r.blockingMissing).toContainEqual({ sectionId: 'obs', fieldId: 'snags' });
  });

  it('max_count: 2 exceeded → overflow flagged (recorded, not failing)', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{ section_id: 'obs', title: 'Observations', fields: [{ ...groupField, max_count: 2 }] }],
    };
    const responses: Response[] = [
      { section_id: 'obs', field_id: 'snags[0].description', value_text: 'a' },
      { section_id: 'obs', field_id: 'snags[0].risk_level', value_text: 'low' },
      { section_id: 'obs', field_id: 'snags[1].description', value_text: 'b' },
      { section_id: 'obs', field_id: 'snags[1].risk_level', value_text: 'low' },
      { section_id: 'obs', field_id: 'snags[2].description', value_text: 'c' },
      { section_id: 'obs', field_id: 'snags[2].risk_level', value_text: 'low' },
    ];
    const r = evaluateInspection(t, responses);
    expect(r.flaggedFields.some((f) => f.fieldId === 'snags' && /exceeds max_count 2/.test(f.reason))).toBe(true);
    expect(r.overallResult).toBe('pass');
  });

  it('entry with a missing required sub-field → flagged with synthetic field_id', () => {
    const responses: Response[] = [
      { section_id: 'obs', field_id: 'snags[0].description', value_text: 'Loose terminal' },
      // risk_level missing for entry 0
    ];
    const r = evaluateInspection(baseTemplate, responses);
    expect(r.missingRequired).toContainEqual({ sectionId: 'obs', fieldId: 'snags[0].risk_level' });
    expect(r.blockingMissing).toContainEqual({ sectionId: 'obs', fieldId: 'snags[0].risk_level' });
  });

  it('photo sub-field with attachments → matched against synthetic field_id', () => {
    const t: Template = {
      ...baseTemplate,
      sections: [{
        section_id: 'obs', title: 'Observations', fields: [{
          ...groupField,
          fields: [
            { field_id: 'description', label: 'Description', type: 'textarea', required: true },
            { field_id: 'photo', label: 'Photo', type: 'photo', required: true, min_count: 1 },
          ],
        }],
      }],
    };
    const responses: Response[] = [
      { section_id: 'obs', field_id: 'snags[0].description', value_text: 'x' },
    ];
    // No photo attached for entry 0 → required missing flagged with synthetic id
    const r1 = evaluateInspection(t, responses, { photos: [] });
    expect(r1.missingRequired).toContainEqual({ sectionId: 'obs', fieldId: 'snags[0].photo' });

    // Photo attached for entry 0 → no missing
    const r2 = evaluateInspection(t, responses, {
      photos: [{ section_id: 'obs', field_id: 'snags[0].photo' }],
    });
    expect(r2.missingRequired).toHaveLength(0);
    expect(r2.overallResult).toBe('pass');
  });
});

// The capture page's left rail used to count typed answers only, so a section made of photo
// fields read 0/4 with all four photos uploaded (Shoprite, ZZ status-guard test, 2026-10-12).
describe('evaluateInspection — sectionStats', () => {
  const photoField = (field_id: string, required = true): Field => ({ field_id, label: field_id, type: 'photo', required, min_count: 1, max_count: 1 });
  const template: Template = {
    template_id: 't', name: 'T', version: '1', deliverable_type: 'coc',
    sections: [
      { section_id: 'wiring', title: 'Wiring images', fields: [photoField('a'), photoField('b'), photoField('c'), photoField('d', false)] },
      { section_id: 'obs', title: 'Observations', fields: [{ field_id: 'q', label: 'Q', type: 'dropdown', required: true, options: ['1', '2'] }, { field_id: 'n', label: 'N', type: 'textarea' }] },
    ],
  } as unknown as Template;

  it('counts uploaded photos as answered, section by section', () => {
    const photos = ['a', 'b', 'c', 'd'].map((field_id) => ({ section_id: 'wiring', field_id }));
    const r = evaluateInspection(template, [{ section_id: 'obs', field_id: 'q', value_text: '2' }], { photos });
    expect(r.sectionStats.wiring).toEqual({ answered: 4, total: 4, missing: 0 });
    expect(r.sectionStats.obs).toEqual({ answered: 1, total: 2, missing: 0 });
  });

  it('counts what blocks submit, only in its own section; missing photos never block', () => {
    const r = evaluateInspection(template, [], { photos: [{ section_id: 'wiring', field_id: 'a' }, { section_id: 'obs', field_id: 'b' }] });
    expect(r.sectionStats.wiring).toEqual({ answered: 1, total: 4, missing: 0 });
    expect(r.missingPhotos.map((m) => m.fieldId)).toEqual(['b', 'c']);
    expect(r.sectionStats.obs).toEqual({ answered: 0, total: 2, missing: 1 });
  });

  it('section totals add up to the inspection totals', () => {
    const photos = [{ section_id: 'wiring', field_id: 'c' }];
    const r = evaluateInspection(template, [{ section_id: 'obs', field_id: 'n', value_text: 'x' }], { photos });
    const sum = Object.values(r.sectionStats).reduce((a, s) => ({ answered: a.answered + s.answered, total: a.total + s.total, missing: a.missing + s.missing }), { answered: 0, total: 0, missing: 0 });
    expect(sum).toEqual({ answered: r.answeredFieldCount, total: r.visibleFieldCount, missing: r.blockingMissing.length });
  });
});

// ─── The verdict rule (2026-10-27) ─────────────────────────────────────────
// Only a visible rating of Poor, or a visible answer that is one of its field's fail_values
// (e.g. snag risk high/critical), fails an inspection. Everything else is a record.
describe('evaluateInspection — verdict rule', () => {
  const snags: Field = {
    field_id: 'snag_list', label: 'Snags', type: 'repeating_group',
    fields: [
      { field_id: 'description', label: 'Description', type: 'textarea' },
      { field_id: 'risk_level', label: 'Risk', type: 'dropdown', options: ['low', 'medium', 'high', 'critical'], fail_values: ['high', 'critical'] },
    ],
  };
  const t: Template = {
    template_id: 't', name: 'T', version: '1', applies_to_node_types: ['any'], deliverable_type: 'inspection_only',
    sections: [{
      section_id: 's', title: 'S', fields: [
        { field_id: 'enclosure', label: 'Enclosure condition', type: 'rating', required: true },
        { field_id: 'labelled', label: 'Labelled', type: 'pass_fail', required: true },
        { field_id: 'has_gen', label: 'Generator?', type: 'pass_fail' },
        { field_id: 'gen_rating', label: 'Generator condition', type: 'rating', conditional_on: { field_id: 'has_gen', equals: true } },
        { field_id: 'board_photo', label: 'Board photo', type: 'photo', required: true },
        snags,
      ],
    }],
  };
  const base: Response[] = [
    { section_id: 's', field_id: 'enclosure', value_text: 'good' },
    { section_id: 's', field_id: 'labelled', value_bool: true },
  ];
  const photo = { photos: [{ section_id: 's', field_id: 'board_photo' }] };

  it('Good/Fair ratings and passing ticks → pass', () => {
    expect(evaluateInspection(t, base, photo).overallResult).toBe('pass');
    const fair = [{ ...base[0], value_text: 'fair' }, base[1]];
    expect(evaluateInspection(t, fair, photo).overallResult).toBe('pass');
  });

  it('a Poor rating fails', () => {
    const r = evaluateInspection(t, [{ ...base[0], value_text: 'poor' }, base[1]], photo);
    expect(r.overallResult).toBe('fail');
    expect(r.failedFields).toEqual([{ sectionId: 's', fieldId: 'enclosure', reason: 'rated Poor' }]);
  });

  it('a Poor rating on a HIDDEN field is ignored', () => {
    const r = evaluateInspection(t, [...base, { section_id: 's', field_id: 'gen_rating', value_text: 'poor' }], photo);
    expect(r.overallResult).toBe('pass');
  });

  it('a Fail tick is recorded only', () => {
    const r = evaluateInspection(t, [base[0], { ...base[1], value_bool: false }], photo);
    expect(r.overallResult).toBe('pass');
    expect(r.flaggedFields.map((f) => f.fieldId)).toEqual(['labelled']);
  });

  it.each([['high', 'fail'], ['critical', 'fail'], ['medium', 'pass'], ['low', 'pass']])(
    'a snag of risk %s → %s', (risk, expected) => {
      const r = evaluateInspection(t, [
        ...base,
        { section_id: 's', field_id: 'snag_list[0].description', value_text: 'Loose gland' },
        { section_id: 's', field_id: 'snag_list[0].risk_level', value_text: risk },
      ], photo);
      expect(r.overallResult).toBe(expected);
      if (expected === 'fail') expect(r.failedFields[0].fieldId).toBe('snag_list[0].risk_level');
    },
  );

  it('fail_values match case-insensitively', () => {
    const r = evaluateInspection(t, [...base, { section_id: 's', field_id: 'snag_list[2].risk_level', value_text: 'Critical' }], photo);
    expect(r.overallResult).toBe('fail');
  });

  it('a missing required photo never blocks or fails; its reason is carried', () => {
    const none = evaluateInspection(t, base, { photos: [] });
    expect(none.overallResult).toBe('pass');
    expect(none.blockingMissing).toHaveLength(0);
    expect(none.missingRequired).toEqual([{ sectionId: 's', fieldId: 'board_photo' }]); // site forms still see it
    expect(none.missingPhotos).toEqual([{ sectionId: 's', fieldId: 'board_photo', reason: null }]);
    const withReason = evaluateInspection(t, [...base, { section_id: 's', field_id: 'board_photo', value_text: ' Board locked ' }], { photos: [] });
    expect(withReason.missingPhotos[0].reason).toBe('Board locked');
  });

  it('a repeating-group sub-field condition reads its sibling in the same entry', () => {
    const g: Template = {
      ...t,
      sections: [{ section_id: 's', title: 'S', fields: [{
        field_id: 'items', label: 'Items', type: 'repeating_group',
        fields: [
          { field_id: 'kind', label: 'Kind', type: 'dropdown', options: ['cable', 'breaker'] },
          { field_id: 'condition', label: 'Breaker condition', type: 'rating', required: true, conditional_on: { field_id: 'kind', equals: 'breaker' } },
        ],
      }] }],
    };
    const r = evaluateInspection(g, [
      { section_id: 's', field_id: 'items[0].kind', value_text: 'cable' },
      { section_id: 's', field_id: 'items[0].condition', value_text: 'poor' }, // hidden in entry 0
      { section_id: 's', field_id: 'items[1].kind', value_text: 'breaker' },   // condition required + missing
    ], {});
    expect(r.overallResult).toBe('pass');
    expect(r.blockingMissing).toEqual([{ sectionId: 's', fieldId: 'items[1].condition' }]);
  });

  it('N/A on a required repeating-group sub-field counts as answered', () => {
    const g: Template = {
      ...t,
      sections: [{ section_id: 's', title: 'S', fields: [{
        field_id: 'items', label: 'Items', type: 'repeating_group',
        fields: [{ field_id: 'ok', label: 'OK', type: 'pass_fail', required: true }],
      }] }],
    };
    const r = evaluateInspection(g, [{ section_id: 's', field_id: 'items[0].ok', pass_state: 'na' }], {});
    expect(r.blockingMissing).toHaveLength(0);
  });
});

describe('templateSchema — fail_values', () => {
  const tpl = (field: Record<string, unknown>) => ({
    template_id: 't', name: 'T', version: '1.0', applies_to_node_types: ['any'], deliverable_type: 'inspection_only',
    sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'f', label: 'F', ...field }] }],
  });
  it('accepts fail_values that are options of a dropdown', () => {
    expect(templateSchema.safeParse(tpl({ type: 'dropdown', options: ['low', 'high'], fail_values: ['high'] })).success).toBe(true);
  });
  it('rejects fail_values that are not options', () => {
    expect(templateSchema.safeParse(tpl({ type: 'dropdown', options: ['low'], fail_values: ['severe'] })).success).toBe(false);
  });
  it('rejects fail_values on a non-choice field', () => {
    expect(templateSchema.safeParse(tpl({ type: 'text', fail_values: ['x'] })).success).toBe(false);
  });
  it('accepts a rating field', () => {
    expect(templateSchema.safeParse(tpl({ type: 'rating' })).success).toBe(true);
  });
});

// ─── Assessed photo items (LV Line Shop, 2026-10-27) ─────────────────────────
// A photo field with `assess` is judged Pass / Fail / N/A with a comment; Fail fails the
// inspection; on a required item the result is required, the photo never is.
describe('evaluateInspection — assessed photo items', () => {
  const t: Template = {
    template_id: 't', name: 'T', version: '1.0', applies_to_node_types: ['any'], deliverable_type: 'coc',
    sections: [{ section_id: 'w', title: 'Wiring', fields: [
      { field_id: 'glanding', label: 'Glanding', type: 'photo', required: true, min_count: 1, assess: true },
      { field_id: 'board', label: 'Board', type: 'photo', required: true, min_count: 1 },
    ] }],
  };
  const photos = { photos: [{ section_id: 'w', field_id: 'glanding' }, { section_id: 'w', field_id: 'board' }] };

  it('a Fail on an assessed item fails the inspection, with its comment as the reason', () => {
    const r = evaluateInspection(t, [{ section_id: 'w', field_id: 'glanding', value_bool: false, pass_state: 'fail', value_text: 'gland missing, left side' }], photos);
    expect(r.overallResult).toBe('fail');
    expect(r.failedFields).toEqual([{ sectionId: 'w', fieldId: 'glanding', reason: 'marked Fail: gland missing, left side' }]);
  });

  it('Pass and N/A pass', () => {
    for (const pass_state of ['pass', 'na'] as const) {
      const r = evaluateInspection(t, [{ section_id: 'w', field_id: 'glanding', pass_state, value_bool: pass_state === 'pass' ? true : null }], photos);
      expect(r.overallResult).toBe('pass');
      expect(r.blockingMissing).toEqual([]);
    }
  });

  it('a required item without a result blocks submit, even with a photo; the photo itself never blocks', () => {
    const r = evaluateInspection(t, [], photos);
    expect(r.blockingMissing).toEqual([{ sectionId: 'w', fieldId: 'glanding', kind: 'result' }]);
    const noPhotos = evaluateInspection(t, [{ section_id: 'w', field_id: 'glanding', pass_state: 'na', value_text: 'no access' }], { photos: [] });
    expect(noPhotos.blockingMissing).toEqual([]);
    expect(noPhotos.missingPhotos.map((m) => m.fieldId)).toEqual(['glanding', 'board']);
    expect(noPhotos.missingPhotos[0].reason).toBe('no access');
  });

  it('text typed as a reason is not a result: only the marked Fail fails', () => {
    const r = evaluateInspection(t, [{ section_id: 'w', field_id: 'glanding', value_text: 'fail' }], { photos: [] });
    expect(r.overallResult).toBe('pass');
    expect(r.blockingMissing).toEqual([{ sectionId: 'w', fieldId: 'glanding', kind: 'result' }]);
  });

  it('an unassessed photo is never judged', () => {
    const r = evaluateInspection(t, [
      { section_id: 'w', field_id: 'glanding', pass_state: 'pass', value_bool: true },
      { section_id: 'w', field_id: 'board', pass_state: 'fail', value_bool: false },
    ], photos);
    expect(r.overallResult).toBe('pass');
  });

  it('the schema allows assess only on photo fields', () => {
    const tpl = (field: Record<string, unknown>) => ({ ...t, sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'f', label: 'F', ...field }] }] });
    expect(templateSchema.safeParse(tpl({ type: 'photo', assess: true })).success).toBe(true);
    expect(templateSchema.safeParse(tpl({ type: 'text', assess: true })).success).toBe(false);
  });
});
