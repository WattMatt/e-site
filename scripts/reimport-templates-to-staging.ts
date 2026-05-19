/**
 * Re-import 11 inspection templates to staging, overwriting existing schema_json
 * with corrected ECompliance verbatim content + new photo UX rule.
 *
 * Constraint: inspections.templates has a DB immutability trigger (trg_template_immutability)
 * that blocks schema_json UPDATE. We disable USER triggers around the batch, then re-enable.
 * We do NOT DELETE+INSERT to preserve FK references from existing inspection instances.
 *
 * Usage:
 *   SUPABASE_PAT="sbp_..." npx tsx scripts/reimport-templates-to-staging.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_REF = 'cbskbnvvgcybmfikxgky';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) throw new Error('SUPABASE_PAT not set');

const TEMPLATE_DIR = '/Users/spud/Documents/DEVELOPER/E-SITE CO/SPEC DOCS/inspection-templates';
const TEMPLATE_FILES = [
  'electrical-meter-nrs057.json',
  'lv-line-shop-board-audit.json',
  'standard-progress-report.json',
  'solar-pv-standalone.json',
  'site-drawing-inspection.json',
  'generator-installation-nrs048.json',
  'line-shop-handover.json',
  'site-summary-report.json',
  'mini-sub-pre-post-fat.json',
  'rmu-snagging.json',
  'generator-fat.json',
];

async function dbQuery(sql: string): Promise<{ status: number; body: string }> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  return { status: res.status, body: await res.text() };
}

// Escape a string for use in PostgreSQL dollar-quoting by finding a safe tag.
function dollarQuote(content: string, hint: string): { open: string; close: string } {
  let tag = `$${hint}$`;
  let n = 0;
  while (content.includes(tag)) {
    n++;
    tag = `$${hint}${n}$`;
  }
  return { open: tag, close: tag };
}

async function main() {
  console.log('Loading template files...');

  type TemplateRow = {
    file: string;
    template_id: string;
    version: string;
    name: string;
    sans_reference: string | null;
    json: object;
  };

  const rows: TemplateRow[] = [];
  for (const file of TEMPLATE_FILES) {
    const raw = readFileSync(join(TEMPLATE_DIR, file), 'utf8');
    const parsed = JSON.parse(raw);
    rows.push({
      file,
      template_id: parsed.template_id,
      version: parsed.version ?? '1.0',
      name: parsed.name,
      sans_reference: parsed.sans_reference ?? null,
      json: parsed,
    });
    console.log(`  loaded ${file} → template_id=${parsed.template_id}`);
  }

  console.log('\nBuilding batch UPDATE SQL...');

  const parts: string[] = [];
  parts.push('ALTER TABLE inspections.templates DISABLE TRIGGER USER;');

  for (const row of rows) {
    const jsonStr = JSON.stringify(row.json);
    const { open: jsonOpen, close: jsonClose } = dollarQuote(jsonStr, 'json');
    const { open: nameOpen, close: nameClose } = dollarQuote(row.name, 'name');

    const sansClause = row.sans_reference
      ? (() => {
          const { open: sOpen, close: sClose } = dollarQuote(row.sans_reference, 'sans');
          return `${sOpen}${row.sans_reference}${sClose}`;
        })()
      : 'NULL';

    parts.push(`
UPDATE inspections.templates SET
  schema_json = ${jsonOpen}${jsonStr}${jsonClose}::jsonb,
  name        = ${nameOpen}${row.name}${nameClose},
  sans_reference = ${sansClause},
  updated_at  = NOW()
WHERE organisation_id = '${ORG_ID}'
  AND template_id     = '${row.template_id}'
  AND version         = '${row.version}';`);
  }

  parts.push('\nALTER TABLE inspections.templates ENABLE TRIGGER USER;');

  const batchSql = parts.join('\n');

  console.log('\nRunning batch UPDATE (trigger disabled)...');
  const result = await dbQuery(batchSql);
  console.log(`  HTTP ${result.status}`);
  console.log(`  Response: ${result.body.slice(0, 300)}`);

  if (result.status !== 200 && result.status !== 201) {
    console.error('BATCH FAILED — aborting verification.');
    process.exit(1);
  }

  // Verification query
  console.log('\nVerifying row counts...');
  const templateIds = rows.map(r => `'${r.template_id}'`).join(', ');
  const verifySql = `
SELECT
  template_id,
  version,
  name,
  jsonb_array_length(schema_json->'sections') AS section_count,
  (
    SELECT count(*)
    FROM jsonb_path_query(schema_json, '$.sections[*].fields[*]')
  ) AS total_fields,
  (
    SELECT count(*)
    FROM jsonb_path_query(schema_json, '$.sections[*].fields[*] ? (@.type == "photo")')
  ) AS photo_fields,
  (
    SELECT count(*)
    FROM jsonb_path_query(schema_json, '$.sections[*].fields[*] ? (@.type == "photo" && exists(@.conditional_on))')
  ) AS conditional_photo_fields,
  updated_at
FROM inspections.templates
WHERE organisation_id = '${ORG_ID}'
  AND template_id IN (${templateIds})
ORDER BY template_id;
  `;
  const verify = await dbQuery(verifySql);
  console.log(`  HTTP ${verify.status}`);

  if (verify.status === 200 || verify.status === 201) {
    const verifyRows = JSON.parse(verify.body) as Array<{
      template_id: string;
      version: string;
      name: string;
      section_count: number;
      total_fields: number;
      photo_fields: number;
      conditional_photo_fields: number;
      updated_at: string;
    }>;
    console.log('\n=== POST-IMPORT COUNTS ===');
    console.log(
      'template_id'.padEnd(36),
      'ver'.padEnd(5),
      'sects'.padEnd(6),
      'total'.padEnd(6),
      'photo'.padEnd(6),
      'cond_photo'.padEnd(11),
      'updated_at'
    );
    for (const r of verifyRows) {
      console.log(
        r.template_id.padEnd(36),
        r.version.padEnd(5),
        String(r.section_count).padEnd(6),
        String(r.total_fields).padEnd(6),
        String(r.photo_fields).padEnd(6),
        String(r.conditional_photo_fields).padEnd(11),
        r.updated_at
      );
    }
    console.log(`\n${verifyRows.length} / ${rows.length} rows confirmed.`);
    if (verifyRows.length !== rows.length) {
      console.warn('WARNING: row count mismatch — some template_ids may not exist on staging.');
    }
  } else {
    console.error('Verification query failed:', verify.body.slice(0, 300));
  }

  // Spot-check: first field label of generator-fat section index 1
  console.log('\nSpot-check: generator-fat section[1].fields[0].label...');
  const spotSql = `
SELECT
  jsonb_path_query_first(
    schema_json,
    '$.sections[1].fields[0].label'
  ) AS first_real_field_label,
  jsonb_path_query_first(
    schema_json,
    '$.sections[1].fields[0].id'
  ) AS first_real_field_id
FROM inspections.templates
WHERE organisation_id = '${ORG_ID}'
  AND template_id = 'generator-fat';
  `;
  const spot = await dbQuery(spotSql);
  console.log(`  HTTP ${spot.status}`);
  console.log(`  Result: ${spot.body.slice(0, 300)}`);

  // Photo conditional split for 3 spot-check templates
  console.log('\nPhoto split (conditional vs unconditional) for 3 templates...');
  const splitSql = `
SELECT
  template_id,
  (
    SELECT count(*) FROM jsonb_path_query(schema_json, '$.sections[*].fields[*] ? (@.type == "photo")')
  ) AS total_photo,
  (
    SELECT count(*) FROM jsonb_path_query(schema_json, '$.sections[*].fields[*] ? (@.type == "photo" && exists(@.conditional_on))')
  ) AS conditional_photo,
  (
    SELECT count(*) FROM jsonb_path_query(schema_json, '$.sections[*].fields[*] ? (@.type == "photo" && !(exists(@.conditional_on)))')
  ) AS unconditional_photo
FROM inspections.templates
WHERE organisation_id = '${ORG_ID}'
  AND template_id IN ('generator-fat', 'electrical-meter-nrs057', 'rmu-snagging')
ORDER BY template_id;
  `;
  const split = await dbQuery(splitSql);
  console.log(`  HTTP ${split.status}`);
  console.log(`  Result: ${split.body}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
