/**
 * Edge function: validate-coc
 *
 * POST /functions/v1/validate-coc
 *   Body: { certificate_id: string }
 *
 * Loads the certificate + its inspection + template + responses + signatures,
 * runs the 8 SANS 10142-1:2020 rules from rules.ts deterministically, then
 * persists the batch to inspections.coc_validations (DELETE-then-INSERT for
 * idempotent re-runs).
 *
 * Auth: service-role only. The certify action invokes this via
 * `supabase.functions.invoke` which carries the user's bearer JWT, but the
 * INSERT into coc_validations has no `authenticated` policy — so a non-service
 * caller will silently insert zero rows. The certify action holds the
 * service-role key when invoking edge functions, satisfying this.
 *
 * Returns: { certificate_id, results: RuleResult[], summary: { pass, fail, insufficient } }
 */

import { createClient } from '@supabase/supabase-js'
import { RULES, type ResponseRow, type RuleContext } from './rules.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let body: { certificate_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }
  if (!body.certificate_id || typeof body.certificate_id !== 'string') {
    return new Response('certificate_id required', { status: 400, headers: CORS_HEADERS })
  }

  // ----- Load certificate -----
  const { data: cert, error: certErr } = await supabase
    .schema('inspections')
    .from('certificates')
    .select('id, inspection_id')
    .eq('id', body.certificate_id)
    .maybeSingle()
  if (certErr) {
    return new Response(`certificate lookup failed: ${certErr.message}`, { status: 500, headers: CORS_HEADERS })
  }
  if (!cert) {
    return new Response('Certificate not found', { status: 404, headers: CORS_HEADERS })
  }

  // ----- Load inspection -----
  const { data: inspection, error: inspErr } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('*')
    .eq('id', cert.inspection_id)
    .maybeSingle()
  if (inspErr || !inspection) {
    return new Response(`inspection lookup failed: ${inspErr?.message ?? 'not found'}`, {
      status: 500,
      headers: CORS_HEADERS,
    })
  }

  // ----- Load template -----
  const { data: template, error: tmplErr } = await supabase
    .schema('inspections')
    .from('templates')
    .select('schema_json')
    .eq('id', inspection.template_id)
    .maybeSingle()
  if (tmplErr || !template) {
    return new Response(`template lookup failed: ${tmplErr?.message ?? 'not found'}`, {
      status: 500,
      headers: CORS_HEADERS,
    })
  }

  // ----- Load responses + signatures -----
  const [{ data: responses }, { data: signatures }] = await Promise.all([
    supabase
      .schema('inspections')
      .from('responses')
      .select('section_id, field_id, value_bool, value_number, value_text, value_array, value_json, pass_state, fail_reason')
      .eq('inspection_id', cert.inspection_id),
    supabase
      .schema('inspections')
      .from('signatures')
      .select('*')
      .eq('inspection_id', cert.inspection_id),
  ])

  const responseMap = new Map<string, ResponseRow>()
  for (const r of (responses ?? []) as ResponseRow[]) {
    responseMap.set(`${r.section_id}.${r.field_id}`, r)
  }

  // ----- Run rules -----
  const ctx: RuleContext = {
    responses: responseMap,
    template: template.schema_json,
    inspection,
    signatures: signatures ?? [],
  }
  const results = RULES.map((rule) => rule(ctx))

  // ----- Persist (DELETE-then-INSERT for idempotent re-runs) -----
  const { error: delErr } = await supabase
    .schema('inspections')
    .from('coc_validations')
    .delete()
    .eq('certificate_id', body.certificate_id)
  if (delErr) {
    return new Response(`delete prior failed: ${delErr.message}`, { status: 500, headers: CORS_HEADERS })
  }

  const rows = results.map((r) => ({
    certificate_id: body.certificate_id,
    inspection_id: cert.inspection_id,
    rule_code: r.rule_code,
    sans_clause: r.sans_clause,
    rule_label: r.rule_label,
    result: r.result,
    measured_value: r.measured_value ?? null,
    threshold: r.threshold ?? null,
    failure_reason: r.failure_reason ?? null,
  }))
  const { error: insErr } = await supabase
    .schema('inspections')
    .from('coc_validations')
    .insert(rows)
  if (insErr) {
    return new Response(`insert failed: ${insErr.message}`, { status: 500, headers: CORS_HEADERS })
  }

  const summary = {
    pass: results.filter((r) => r.result === 'pass').length,
    fail: results.filter((r) => r.result === 'fail').length,
    insufficient: results.filter((r) => r.result === 'insufficient_data').length,
    not_applicable: results.filter((r) => r.result === 'not_applicable').length,
  }

  return new Response(
    JSON.stringify({ certificate_id: body.certificate_id, results, summary }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  )
})
