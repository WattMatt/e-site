/**
 * Verdict audit — re-runs the inspection engine over every inspection in a project database and
 * reports what it decides, next to what is stored. READ-ONLY: SELECTs through the Supabase
 * Management API, nothing is written.
 *
 *   npx tsx scripts/inspections/verdict-audit.ts            # current engine
 *   OLD_ENGINE=/path/to/old/engine.ts npx tsx …            # also show a previous engine's verdict
 *
 * Token: SUPABASE_ACCESS_TOKEN, else the macOS keychain item "Supabase CLI" (as scripts/db/mgmt-api.sh).
 * Project: SUPABASE_PROJECT_REF, default cbskbnvvgcybmfikxgky.
 *
 * Exit code 1 when a CERTIFIED inspection's stored overall_result differs from the engine's —
 * the one disagreement that means a wrong certificate is out there.
 */
import { execSync } from 'node:child_process'
import { evaluateInspection } from '../../packages/shared/src/inspections/engine'
import type { Response, Template } from '../../packages/shared/src/inspections/types'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'

function token(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const raw = execSync('security find-generic-password -s "Supabase CLI" -w').toString().trim()
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString()
    : raw
}

async function query<T>(sql: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error(`query failed: ${JSON.stringify(body).slice(0, 300)}`)
  return body as T[]
}

type Evaluate = (t: Template, r: Response[], a: unknown) => { overallResult: string }

async function main() {
  const oldEval: Evaluate | null = process.env.OLD_ENGINE
    ? ((await import(process.env.OLD_ENGINE)) as { evaluateInspection: Evaluate }).evaluateInspection
    : null

  const inspections = await query<{ id: string; status: string; overall_result: string | null; template: string; schema_json: Template }>(`
    select i.id, i.status, i.overall_result, t.name as template, t.schema_json
      from inspections.inspections i join inspections.templates t on t.id = i.template_id
     order by i.status, t.name`)
  const responses = await query<Response & { inspection_id: string }>(`
    select inspection_id, section_id, field_id, value_bool, value_number, value_text, value_array, pass_state, fail_reason
      from inspections.responses`)
  const photos = await query<{ inspection_id: string; section_id: string; field_id: string }>(
    `select inspection_id, section_id, field_id from inspections.photos`)
  const signatures = await query<{ inspection_id: string; section_id: string | null; field_id: string | null }>(
    `select inspection_id, section_id, field_id from inspections.signatures`)

  const by = <T extends { inspection_id: string }>(rows: T[], id: string) => rows.filter((r) => r.inspection_id === id)

  let certifiedMismatch = 0
  const rows = inspections.map((i) => {
    const att = {
      photos: by(photos, i.id),
      signatures: by(signatures, i.id).map((s) => ({ section_id: s.section_id ?? undefined, field_id: s.field_id ?? undefined })),
    }
    const ev = evaluateInspection(i.schema_json, by(responses, i.id), att)
    const old = oldEval ? oldEval(i.schema_json, by(responses, i.id), att).overallResult : undefined
    if (i.status === 'certified' && i.overall_result !== ev.overallResult) certifiedMismatch++
    return {
      id: i.id.slice(0, 8),
      status: i.status,
      template: i.template.slice(0, 34),
      stored: i.overall_result ?? '-',
      ...(oldEval ? { old_engine: old } : {}),
      new_engine: ev.overallResult,
      fails: ev.failedFields.map((f) => `${f.fieldId}: ${f.reason}`).join('; ') || '-',
      flagged: ev.flaggedFields.length,
      blocking: ev.blockingMissing.length,
      no_photo: ev.missingPhotos.length,
    }
  })

  console.table(rows)
  const changed = oldEval ? rows.filter((r) => 'old_engine' in r && r.old_engine !== r.new_engine) : []
  console.log(`inspections: ${rows.length}; new-engine fails: ${rows.filter((r) => r.new_engine === 'fail').length}` +
    (oldEval ? `; verdict changed vs old engine: ${changed.length}` : '') +
    `; certified with stored result ≠ engine: ${certifiedMismatch}`)
  if (certifiedMismatch > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
