import { describe, it, expect } from 'vitest';
import { evaluateInspection } from './engine';
import { describeMissing } from './missing';
import type { Template } from './types';

// Shaped on Main DB 1.1 and Rage (ZZ status-guard test, 2026-10-12).
const template = {
  template_id: 't', name: 'T', version: '1', deliverable_type: 'inspection_only',
  sections: [
    { section_id: 'control', title: 'Control voltage checks', fields: [
      { field_id: 'battery_voltage', label: 'Battery voltage', type: 'number', required: true, pass_when: 'between 46 and 54' },
    ] },
    { section_id: 'protection', title: 'Circuit protection', fields: [
      { field_id: 'board_interior_photos', label: 'Board interior photos', type: 'photo', required: true, min_count: 3 },
    ] },
    { section_id: 'obs', title: 'Observations', fields: [
      { field_id: 'inspector_signature', label: 'Inspector signature', type: 'signature', required: true },
      { field_id: 'circuits', label: 'Circuits', type: 'repeating_group', fields: [{ field_id: 'rating', label: 'Rating', type: 'number', required: true }] },
    ] },
  ],
} as unknown as Template;

describe('describeMissing', () => {
  it('names each gap, where it is and what completes it', () => {
    // A photo on the reading (inline capture) is not its value; 1 of 3 board photos; no signature.
    const attachments = {
      photos: [{ section_id: 'control', field_id: 'battery_voltage' }, { section_id: 'protection', field_id: 'board_interior_photos' }],
      signatures: [],
    };
    const responses = [{ section_id: 'obs', field_id: 'circuits[0].note', value_text: 'x' }];
    const ev = evaluateInspection(template, responses, attachments);
    expect(describeMissing(template, ev.missingRequired, attachments)).toEqual([
      { sectionId: 'control', fieldId: 'battery_voltage', sectionTitle: 'Control voltage checks', label: 'Battery voltage', need: 'Enter a value' },
      { sectionId: 'protection', fieldId: 'board_interior_photos', sectionTitle: 'Circuit protection', label: 'Board interior photos', need: '1 of 3 photos added' },
      { sectionId: 'obs', fieldId: 'inspector_signature', sectionTitle: 'Observations', label: 'Inspector signature', need: 'Sign' },
      { sectionId: 'obs', fieldId: 'circuits[0].rating', sectionTitle: 'Observations', label: 'Circuits #1 · Rating', need: 'Enter a value' },
    ]);
  });

  it('nothing missing, nothing listed', () => {
    expect(describeMissing(template, [])).toEqual([]);
  });
});
