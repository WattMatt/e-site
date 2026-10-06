/**
 * Build, and optionally publish, the WhatsApp Flow for one inspection template row (E4).
 * =========================================================================
 * The form service only sends a Flow when whatsapp.flows holds a row for the template row AND
 * that row's flow_json_sha256 equals what this builder produces now. This script is how that row
 * gets there. Template rows are immutable, so a Flow is per template ROW (one version).
 *
 * DRY RUN is the default: reads the template, checks it can be a Flow, writes the Flow JSON to
 * ./flow-<template_id>-v<version>.json and prints its SHA-256. Nothing is sent to Meta and nothing
 * is written to the database.
 *
 *   npx tsx apps/web/scripts/publish-inspection-flow.ts --template <inspections.templates.id>
 *
 * --publish creates the Flow on the WhatsApp Business Account (Flows API) and records it in
 * whatsapp.flows. Add --status published to publish it on Meta (default: draft, which can be sent
 * to test numbers with mode=draft). THIS IS AN OWNER ACTION: it configures the Meta account.
 *
 *   npx tsx apps/web/scripts/publish-inspection-flow.ts --template <id> --publish [--status published]
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY; with --publish also
 * WHATSAPP_TOKEN (a system-user token with whatsapp_business_management) and WHATSAPP_WABA_ID.
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { FLOW_JSON_VERSION, buildInspectionFlow, flowCapability } from '../../../packages/shared/src/whatsapp-forms/flow-builder'
import type { Template } from '../../../packages/shared/src/inspections/types'

const GRAPH = 'https://graph.facebook.com/v23.0'

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

async function graph(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || json.error) throw new Error(`Meta ${path}: HTTP ${res.status} ${JSON.stringify(json.error ?? json)}`)
  return json
}

async function main() {
  const templateRowId = arg('template')
  const publish = process.argv.includes('--publish')
  const status = (arg('status') ?? 'draft') as 'draft' | 'published'
  if (!templateRowId || !/^[0-9a-f-]{36}$/i.test(templateRowId)) throw new Error('--template <inspections.templates.id> is required')
  if (!['draft', 'published'].includes(status)) throw new Error('--status must be draft or published')

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  const sb = createClient(url, key)

  const { data: row, error } = await sb.schema('inspections').from('templates')
    .select('id, template_id, version, name, schema_json').eq('id', templateRowId).maybeSingle()
  if (error || !row) throw new Error(`template row ${templateRowId} not found${error ? `: ${error.message}` : ''}`)
  const template = row.schema_json as Template

  const cap = flowCapability(template)
  if (!cap.ok) throw new Error(`"${row.name}" cannot be a Flow:\n  - ${cap.reasons.join('\n  - ')}\nIt will be filled in on the web through a signed link.`)

  const json = JSON.stringify(buildInspectionFlow(template))
  const sha = createHash('sha256').update(json).digest('hex')
  const file = `flow-${row.template_id}-v${row.version}.json`
  writeFileSync(file, JSON.stringify(JSON.parse(json), null, 2) + '\n')
  console.log(`template   ${row.name} v${row.version} (${row.id})`)
  console.log(`screens    ${JSON.parse(json).screens.length}, Flow JSON ${FLOW_JSON_VERSION}`)
  console.log(`photos     ${cap.photoFields.map((f) => f.fieldId).join(', ') || 'none'} (sent in chat)`)
  console.log(`signatures ${cap.signatureFields.map((f) => f.fieldId).join(', ') || 'none'} (signed on the web)`)
  console.log(`not asked  ${cap.skippedFields.map((f) => f.fieldId).join(', ') || 'none'}`)
  console.log(`wrote      ${file}`)
  console.log(`sha256     ${sha}`)

  if (!publish) {
    console.log('\nDry run: nothing sent to Meta, nothing written. Add --publish to create the Flow.')
    return
  }
  const waba = process.env.WHATSAPP_WABA_ID
  if (!process.env.WHATSAPP_TOKEN || !waba) throw new Error('--publish needs WHATSAPP_TOKEN and WHATSAPP_WABA_ID')

  const created = await graph(`${waba}/flows`, {
    name: `E-Site ${row.name} v${row.version}`.slice(0, 200), categories: ['OTHER'], flow_json: json,
  })
  const flowId = String(created.id)
  console.log(`created    Flow ${flowId} (draft)${created.validation_errors ? ` validation: ${JSON.stringify(created.validation_errors)}` : ''}`)
  if (status === 'published') {
    await graph(`${flowId}/publish`, {})
    console.log(`published  Flow ${flowId}`)
  }
  const { error: upErr } = await sb.schema('whatsapp').from('flows').upsert({
    template_row_id: row.id, meta_flow_id: flowId, flow_json_sha256: sha, builder_version: FLOW_JSON_VERSION, status,
    published_at: status === 'published' ? new Date().toISOString() : null,
  }, { onConflict: 'template_row_id' })
  if (upErr) throw new Error(`recording the Flow failed: ${upErr.message}`)
  const { data: back } = await sb.schema('whatsapp').from('flows').select('meta_flow_id, status, flow_json_sha256')
    .eq('template_row_id', row.id).maybeSingle()
  if (back?.flow_json_sha256 !== sha || back?.meta_flow_id !== flowId) throw new Error('whatsapp.flows did not read back as written')
  console.log(`recorded   whatsapp.flows ${row.id} -> ${flowId} (${status})`)
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
