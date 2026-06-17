import { describe, it, expect } from 'vitest';
import { templateSchema } from '../template-schema';
import { MV_TEMPLATES } from './index';

describe('MV templates validate against templateSchema', () => {
  for (const t of MV_TEMPLATES) {
    it(`${t.template_id} is a valid template`, () => {
      expect(() => templateSchema.parse(t)).not.toThrow();
    });
  }

  it('there are exactly five MV templates with unique ids', () => {
    const ids = MV_TEMPLATES.map((t) => t.template_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
});
