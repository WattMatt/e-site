/**
 * Edge function: validate-inspection
 *
 * POST /functions/v1/validate-inspection
 *   Body: { inspection_id: string }          — current pipeline (projects.reports era)
 *      or { certificate_id: string }         — legacy (inspections.certificates rows)
 *
 * Loads the inspection + template + responses + signatures, dispatches to the
 * appropriate rule-set based on the inspection's template_id, then persists
 * the batch to inspections.coc_validations (DELETE-then-INSERT keyed on
 * inspection_id for idempotent re-runs; certificate_id is a nullable legacy
 * column since migration 00159).
 *
 * If no rule-set is registered for the template_id, returns 200 with a
 * "no validation rules for this template" message — callers treat this as a no-op.
 *
 * Auth: a service-role bearer is trusted outright. Any other caller must
 * (a) be able to SELECT the target inspection under RLS, and (b) hold a
 * validation-write capability: assigned verifier (is_inspection_verifier)
 * or PM+ (user_can_verify). certifyInspectionAction invokes this with the
 * verifier's session, which qualifies. Read-only visibility (e.g. a
 * client_viewer on a certified inspection) is NOT enough to rewrite the
 * validation audit. Writes to coc_validations always run under the
 * function's internal service-role client (the table has no authenticated
 * write policy).
 *
 * Returns: { inspection_id, certificate_id, template_id, results: RuleResult[],
 *            summary: { pass, fail, insufficient, not_applicable } }
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

  let body: { inspection_id?: string; certificate_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }
  if (
    (!body.inspection_id || typeof body.inspection_id !== 'string') &&
    (!body.certificate_id || typeof body.certificate_id !== 'string')
  ) {
    return new Response('inspection_id or certificate_id required', { status: 400, headers: CORS_HEADERS })
  }

  // ----- Resolve inspection id (legacy path goes via the certificate row) -----
  let inspectionId: string
  let certificateId: string | null = null
  if (body.inspection_id) {
    inspectionId = body.inspection_id
  } else {
    const { data: cert, error: certErr } = await supabase
      .schema('inspections')
      .from('certificates')
      .select('id, inspection_id')
      .eq('id', body.certificate_id!)
      .maybeSingle()
    if (certErr) {
      return new Response(`certificate lookup failed: ${certErr.message}`, { status: 500, headers: CORS_HEADERS })
    }
    if (!cert) {
      // Same body as the no-visibility 404 below — a caller must not be able
      // to distinguish "certificate id doesn't exist" from "no access".
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }
    inspectionId = cert.inspection_id as string
    certificateId = cert.id as string
  }

  // ----- Caller authorization. A service-role bearer is trusted outright
  // (certify-era invocations and ops tooling). Anyone else needs RLS
  // visibility of the inspection (404 otherwise — no cross-org probing) AND
  // a validation-write capability: assigned verifier or PM+ (403 otherwise).
  // Bare read access must not suffice: a client_viewer can SELECT certified
  // inspections but must never rewrite the standards-validation audit. -----
  const authHeader = req.headers.get('Authorization') ?? ''
  const isServiceCaller =
    authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`
  if (!isServiceCaller) {
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } },
    )
    const { data: visible, error: visErr } = await callerClient
      .schema('inspections')
      .from('inspections')
      .select('id, project_id')
      .eq('id', inspectionId)
      .maybeSingle()
    if (visErr) {
      return new Response(`access check failed: ${visErr.message}`, { status: 500, headers: CORS_HEADERS })
    }
    if (!visible) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }

    const [verifierRes, pmRes] = await Promise.all([
      callerClient.schema('inspections').rpc('is_inspection_verifier', { _inspection_id: inspectionId }),
      callerClient.schema('inspections').rpc('user_can_verify', { _project_id: visible.project_id }),
    ])
    if (verifierRes.error || pmRes.error) {
      return new Response(
        `capability check failed: ${verifierRes.error?.message ?? pmRes.error?.message}`,
        { status: 500, headers: CORS_HEADERS },
      )
    }
    if (verifierRes.data !== true && pmRes.data !== true) {
      return new Response('Not allowed to run validation for this inspection', {
        status: 403,
        headers: CORS_HEADERS,
      })
    }
  }

  // ----- Load inspection -----
  const { data: inspection, error: inspErr } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
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
      .eq('inspection_id', inspectionId),
    supabase
      .schema('inspections')
      .from('signatures')
      .select('*')
      .eq('inspection_id', inspectionId),
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

  // ----- Persist (DELETE-then-INSERT for idempotent re-runs). Keyed on
  // inspection_id so legacy certificate-keyed batches are superseded too. -----
  const { error: delErr } = await supabase
    .schema('inspections')
    .from('coc_validations')
    .delete()
    .eq('inspection_id', inspectionId)
  if (delErr) {
    return new Response(`delete prior failed: ${delErr.message}`, { status: 500, headers: CORS_HEADERS })
  }

  const rows = results.map((r) => ({
    certificate_id: certificateId,
    inspection_id: inspectionId,
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
    JSON.stringify({
      inspection_id: inspectionId,
      certificate_id: certificateId,
      template_id: inspection.template_id,
      results,
      summary,
    }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  )
})
