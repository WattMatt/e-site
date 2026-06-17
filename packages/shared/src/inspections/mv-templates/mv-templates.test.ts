import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { templateSchema } from '../template-schema';
import { MV_TEMPLATES } from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe('seed migration matches canonical JSON', () => {
  // 5 levels up from packages/shared/src/inspections/mv-templates/ to the repo root.
  const migrationPath = resolve(
    __dirname,
    '../../../../../apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql',
  );
  const sql = readFileSync(migrationPath, 'utf8');
  const blocks = [...sql.matchAll(/\$json\$(.*?)\$json\$/gs)].map((m) => m[1]);
  const byId = new Map(MV_TEMPLATES.map((t) => [t.template_id, t]));

  it('embeds exactly five schema_json blocks', () => {
    expect(blocks).toHaveLength(5);
  });

  for (const block of blocks) {
    const parsed = JSON.parse(block) as { template_id: string };
    it(`${parsed.template_id} seed block is valid and matches the canonical template`, () => {
      expect(() => templateSchema.parse(parsed)).not.toThrow();
      expect(parsed).toEqual(byId.get(parsed.template_id));
    });
  }
});
