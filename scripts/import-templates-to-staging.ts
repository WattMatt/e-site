import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_REF = 'cbskbnvvgcybmfikxgky';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001'; // WM-Consulting
const PAT = process.env.SUPABASE_PAT;
if (!PAT) throw new Error('SUPABASE_PAT not set');

const templateDir = '/Users/spud/Documents/DEVELOPER/E-SITE CO/SPEC DOCS/inspection-templates';

// Derived from existing template patterns: board/source/any + relevant subtypes
const nodeMapping: Record<string, { applies_to_node_types: string[]; node_subtypes: string[] | null }> = {
  'electrical-meter-nrs057':       { applies_to_node_types: ['board', 'any'],          node_subtypes: ['meter', 'main_board', 'distribution_board'] },
  'lv-line-shop-board-audit':      { applies_to_node_types: ['board'],                 node_subtypes: ['main_board', 'distribution_board', 'sub_board'] },
  'standard-progress-report':      { applies_to_node_types: ['any'],                   node_subtypes: null },
  'solar-pv-standalone':           { applies_to_node_types: ['source', 'any'],         node_subtypes: ['solar_pv', 'inverter'] },
  'site-drawing-inspection':       { applies_to_node_types: ['any'],                   node_subtypes: null },
  'generator-installation-nrs048': { applies_to_node_types: ['source'],                node_subtypes: ['generator', 'ats'] },
  'line-shop-handover':            { applies_to_node_types: ['board', 'source', 'any'], node_subtypes: ['main_board', 'distribution_board', 'sub_board'] },
  'site-summary-report':           { applies_to_node_types: ['any'],                   node_subtypes: null },
  'mini-sub-pre-post-fat':         { applies_to_node_types: ['source', 'any'],         node_subtypes: ['substation', 'mv_switchgear'] },
  'rmu-snagging':                  { applies_to_node_types: ['source', 'any'],         node_subtypes: ['rmu', 'mv_switchgear'] },
  'generator-fat':                 { applies_to_node_types: ['source'],                node_subtypes: ['generator', 'ats'] },
};

const newTemplates = Object.keys(nodeMapping).map(id => `${id}.json`);

async function query(sql: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

for (const file of newTemplates) {
  const json = readFileSync(join(templateDir, file), 'utf8');
  const template = JSON.parse(json);
  const nodes = nodeMapping[template.template_id];

  // PostgreSQL dollar-quoting with a unique tag per row to handle any content
  const tag = `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const appliesToArr = `ARRAY[${nodes.applies_to_node_types.map(v => `'${v}'`).join(', ')}]::text[]`;
  const nodeSubtypesVal = nodes.node_subtypes
    ? `ARRAY[${nodes.node_subtypes.map(v => `'${v}'`).join(', ')}]::text[]`
    : 'NULL';

  const sql = `
    INSERT INTO inspections.templates (
      organisation_id, template_id, version, name, deliverable_type,
      applies_to_node_types, node_subtypes, sans_reference, schema_json, is_active
    ) VALUES (
      '${ORG_ID}',
      '${template.template_id}',
      '${template.version}',
      $${tag}$${template.name}$${tag}$,
      '${template.deliverable_type}',
      ${appliesToArr},
      ${nodeSubtypesVal},
      ${template.sans_reference ? `$${tag}$${template.sans_reference}$${tag}$` : 'NULL'},
      $${tag}$${JSON.stringify(template)}$${tag}$::jsonb,
      true
    )
    ON CONFLICT (organisation_id, template_id, version) DO NOTHING
    RETURNING id, template_id, name;
  `;
  const result = await query(sql);
  console.log(`${file}: HTTP ${result.status} — ${result.body.slice(0, 300)}`);
}
