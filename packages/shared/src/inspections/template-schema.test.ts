import { describe, it, expect } from 'vitest';
import { templateSchema } from './template-schema';

const validTemplate = {
  template_id: 'lv-board-coc',
  name: 'LV Board COC',
  version: '1.0',
  applies_to_node_types: ['board'],
  deliverable_type: 'coc',
  sections: [{
    section_id: 'visual',
    title: 'Visual',
    fields: [{ field_id: 'labelling_ok', label: 'Labelling OK', type: 'pass_fail', required: true }],
  }],
};

describe('templateSchema', () => {
  it('accepts a minimal valid template', () => {
    expect(() => templateSchema.parse(validTemplate)).not.toThrow();
  });
  it('rejects non-kebab template_id', () => {
    expect(() => templateSchema.parse({ ...validTemplate, template_id: 'LV_Board' })).toThrow(/kebab-case/);
  });
  it('rejects non-snake field_id', () => {
    const t = { ...validTemplate, sections: [{ ...validTemplate.sections[0], fields: [{ ...validTemplate.sections[0].fields[0], field_id: 'Labelling-OK' }] }] };
    expect(() => templateSchema.parse(t)).toThrow(/snake_case/);
  });
  it('rejects invalid semver-ish version', () => {
    expect(() => templateSchema.parse({ ...validTemplate, version: 'one' })).toThrow();
  });
  it('rejects empty sections array', () => {
    expect(() => templateSchema.parse({ ...validTemplate, sections: [] })).toThrow();
  });
  it('accepts repeating_group with non-empty fields[]', () => {
    const t = {
      ...validTemplate,
      sections: [{
        section_id: 'obs', title: 'Observations',
        fields: [{
          field_id: 'snags', label: 'Snag list', type: 'repeating_group',
          fields: [
            { field_id: 'description', label: 'Description', type: 'textarea', required: true },
            { field_id: 'risk_level', label: 'Risk', type: 'dropdown', options: ['low','high'] },
          ],
        }],
      }],
    };
    expect(() => templateSchema.parse(t)).not.toThrow();
  });
  it('rejects repeating_group with missing fields[]', () => {
    const t = {
      ...validTemplate,
      sections: [{
        section_id: 'obs', title: 'Observations',
        fields: [{ field_id: 'snags', label: 'Snags', type: 'repeating_group' }],
      }],
    };
    expect(() => templateSchema.parse(t)).toThrow(/repeating_group requires/);
  });
  it('rejects repeating_group with empty fields[]', () => {
    const t = {
      ...validTemplate,
      sections: [{
        section_id: 'obs', title: 'Observations',
        fields: [{ field_id: 'snags', label: 'Snags', type: 'repeating_group', fields: [] }],
      }],
    };
    expect(() => templateSchema.parse(t)).toThrow();
  });
  it('rejects nested repeating_group inside a repeating_group', () => {
    const t = {
      ...validTemplate,
      sections: [{
        section_id: 'obs', title: 'Observations',
        fields: [{
          field_id: 'snags', label: 'Snags', type: 'repeating_group',
          fields: [{
            field_id: 'inner', label: 'Inner', type: 'repeating_group',
            fields: [{ field_id: 'x', label: 'X', type: 'text' }],
          }],
        }],
      }],
    };
    expect(() => templateSchema.parse(t)).toThrow(/repeating_group/);
  });
});
