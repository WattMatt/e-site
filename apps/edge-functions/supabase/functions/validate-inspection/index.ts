/**
 * Edge function: validate-inspection
 *
 * POST /functions/v1/validate-inspection
 *   Body: { certificate_id: string }
 *
 * Loads the certificate + its inspection + template + responses + signatures,
 * dispatches to the appropriate rule-set based on the inspection's template_id,
 * then persists the batch to inspections.coc_validations (DELETE-then-INSERT for
 * idempotent re-runs).
 *
 * If no rule-set is registered for the template_id, returns 200 with a
 * "no validation rules for this template" message — callers treat this as a no-op.
 *
 * Auth: service-role only. The certify action invokes this via
 * `supabase.functions.invoke` which carries the user's bearer JWT, but the
 * INSERT into coc_validations has no `authenticated` policy — so a non-service
 * caller will silently insert zero rows. The certify action holds the
 * service-role key when invoking edge functions, satisfying this.
 *
 * Returns: { certificate_id, template_id, results: RuleResult[], summary: { pass, fail, insufficient, not_applicable } }
 *       or: { ok: true, message: string, template_id: string }  — when no rules registered
 */

import { createClient } from '@supabase/supabase-js'
import type { RuleRunner, ResponseRow, RuleContext } from '../_shared/validation-rules/types.ts'
import { runCocRules } from '../_shared/validation-rules/coc.ts'
import { runGeneratorFatRules } from '../_shared/validation-rules/generator-fat.ts'
import { runRmuRules } from '../_shared/validation-rules/rmu.ts'
import { runMiniSubRules } from '../_shared/validation-rules/mini-sub.ts'
import { runSolarPvRules } from '../_shared/validation-rules/solar-pv.ts'

// ---------------------------------------------------------------------------
// Dispatcher map — template_id → RuleRunner
// Phase 3.2–3.5 rule runners are added here once their modules land.
// ---------------------------------------------------------------------------

const RULE_RUNNERS: Record<string, RuleRunner> = {
  // COC deliverable — 8 SANS 10142-1 rules
  'electrical-meter-nrs057':   runCocRules,
  'lv-coc':                    runCocRules,
  'lv-db-inspection':          runCocRules,
  'lv-emb-inspection':         runCocRules,
  'lv-line-shop-board-audit':  runCocRules,

  // Phase 3.2 — Generator FAT
  'generator-fat':         runGeneratorFatRules,

  // Phase 3.3 — RMU snagging
  'rmu-snagging':          runRmuRules,

  // Phase 3.4 — Mini-sub inspection + pre/post FAT
  'mini-sub-inspection':   runMiniSubRules,
  'mini-sub-pre-post-fat': runMiniSubRules,

  // Phase 3.5 — Solar PV standalone
  'solar-pv-standalone':   runSolarPvRules,
}

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

  // ----- Dispatch — return early if no rules registered for this template -----
  const runner: RuleRunner | undefined = RULE_RUNNERS[inspection.template_id as string]
  if (!runner) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: 'No validation rules registered for this template',
        template_id: inspection.template_id,
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
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

  // ----- Run rule-set via dispatcher -----
  const ctx: RuleContext = {
    responses: responseMap,
    template: template.schema_json,
    inspection,
    signatures: signatures ?? [],
  }
  const results = runner(ctx)

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
    JSON.stringify({ certificate_id: body.certificate_id, template_id: inspection.template_id, results, summary }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  )
})
