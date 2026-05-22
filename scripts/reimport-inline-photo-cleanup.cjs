/*
 * Re-import the 12 inspection templates that had their generic per-section
 * "Photos" fields stripped (the inline-per-entry-photo-capture cleanup,
 * commit d41da1a). In-place schema_json UPDATE on the active rows, matched
 * by (organisation_id, template_id, version). The immutability trigger is
 * disabled for the batch; everything runs in one transaction so a mid-batch
 * failure rolls back cleanly.
 *
 * RUN ORDER: only after the web code (feat/esite-structure) is deployed to
 * production — otherwise the 12 templates briefly have neither the section
 * photo bucket nor the new inline strips.
 *
 * Pre-checked safe (2026-05-22): 0 certified inspections on these templates,
 * 0 photos captured into the section buckets, JSON versions match the active
 * DB rows.
 *
 * Usage:  SUPABASE_PAT="sbp_..." node scripts/reimport-inline-photo-cleanup.js
 *   (PAT: keychain — security find-generic-password -s "Supabase CLI" -w)
 */
const { readFileSync } = require('fs');
const { join } = require('path');

const PROJECT_REF = 'cbskbnvvgcybmfikxgky';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const PAT = process.env.SUPABASE_PAT;
if (!PAT) throw new Error('SUPABASE_PAT not set');

// Cleaned templates live in SPEC DOCS/inspection-templates/ (outside the repo).
const TEMPLATE_DIR = join(__dirname, '..', '..', 'SPEC DOCS', 'inspection-templates');
const FILES = [
  'electrical-meter-nrs057.json',
  'fat-report.json',
  'generator-fat.json',
  'generator-installation-nrs048.json',
  'lv-coc.json',
  'lv-emb-inspection.json',
  'mini-sub-pre-post-fat.json',
  'rmu-snagging.json',
  'site-drawing-inspection.json',
  'site-summary-report.json',
  'solar-pv-standalone.json',
  'standard-progress-report.json',
];

async function dbQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  );
  return { status: res.status, body: await res.text() };
}

// Pick a dollar-quote tag that does not collide with the content.
function dollarTag(content, hint) {
  let tag = `$${hint}$`;
  let n = 0;
  while (content.includes(tag)) {
    n++;
    tag = `$${hint}${n}$`;
  }
  return tag;
}

async function main() {
  const rows = FILES.map((file) => {
    const parsed = JSON.parse(readFileSync(join(TEMPLATE_DIR, file), 'utf8'));
    return {
      file,
      template_id: parsed.template_id,
      version: parsed.version,
      json: JSON.stringify(parsed),
    };
  });

  const parts = ['BEGIN;', 'ALTER TABLE inspections.templates DISABLE TRIGGER USER;'];
  for (const r of rows) {
    const tag = dollarTag(r.json, 'tpl');
    parts.push(
      `UPDATE inspections.templates SET schema_json = ${tag}${r.json}${tag}::jsonb, ` +
        `updated_at = NOW() WHERE organisation_id = '${ORG_ID}' ` +
        `AND template_id = '${r.template_id}' AND version = '${r.version}';`,
    );
  }
  parts.push('ALTER TABLE inspections.templates ENABLE TRIGGER USER;', 'COMMIT;');

  console.log(`Re-importing ${rows.length} templates (in-place UPDATE)...`);
  const result = await dbQuery(parts.join('\n'));
  console.log(`  batch HTTP ${result.status}`);
  console.log(`  ${result.body.slice(0, 300)}`);
  if (result.status !== 200 && result.status !== 201) {
    console.error('BATCH FAILED — transaction rolled back, no changes applied.');
    process.exit(1);
  }

  const ids = rows.map((r) => `'${r.template_id}'`).join(',');
  const verify = await dbQuery(
    `SELECT template_id, version, is_active,
       (SELECT count(*) FROM jsonb_path_query(schema_json,
          '$.sections[*].fields[*] ? (@.type == "photo")')) AS section_photo_fields,
       (schema_json::text LIKE '%Photographic evidence for this section%') AS still_has_generic
     FROM inspections.templates
     WHERE organisation_id = '${ORG_ID}' AND template_id IN (${ids}) AND is_active = true
     ORDER BY template_id;`,
  );
  console.log(`\nVerify HTTP ${verify.status}:`);
  console.log(verify.body);

  try {
    const vrows = JSON.parse(verify.body);
    const bad = vrows.filter((v) => v.still_has_generic);
    console.log(
      bad.length === 0
        ? `\n✓ All ${vrows.length} active templates clean — no generic per-section photo fields remain.`
        : `\n✗ ${bad.length} template(s) still contain the generic field: ${bad.map((b) => b.template_id).join(', ')}`,
    );
  } catch {
    /* verify body not JSON — HTTP status above is the signal */
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
