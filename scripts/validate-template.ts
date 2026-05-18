import { readFileSync } from 'fs';
import { templateSchema } from '../packages/shared/src/inspections/template-schema';

const path = process.argv[2];
if (!path) {
  console.error('Usage: tsx scripts/validate-template.ts <path/to/template.json>');
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(path, 'utf8'));
const result = templateSchema.safeParse(parsed);
if (!result.success) {
  console.error('✗ Invalid:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

const sectionCount = parsed.sections.length;
const fieldCount = parsed.sections.reduce(
  (acc: number, s: { fields: unknown[]; subsections?: { fields: unknown[] }[] }) => {
    const sectionFields = s.fields?.length ?? 0;
    const subsectionFields = (s.subsections ?? []).reduce(
      (sacc: number, sub: { fields: unknown[] }) => sacc + (sub.fields?.length ?? 0),
      0,
    );
    return acc + sectionFields + subsectionFields;
  },
  0,
);
const photoFields = JSON.stringify(parsed).match(/"type":\s*"photo"/g)?.length ?? 0;
const measurementFields =
  JSON.stringify(parsed).match(/"type":\s*"number"[^}]*"unit"/g)?.length ?? 0;

console.log(`✓ Valid template: ${parsed.template_id} v${parsed.version}`);
console.log(`  ${sectionCount} sections, ${fieldCount} total fields`);
console.log(`  Photo fields: ${photoFields} | Measurement fields with units: ${measurementFields}`);
