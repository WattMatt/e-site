/**
 * Edge Function: calculate-health-scores
 *
 * Daily cron job that computes a health score for every organisation with at
 * least one active project and appends a snapshot to
 * public.organisation_health_scores.
 *
 * Spec: spec-v2.md §17, strategic-analysis-52-customer-health-scoring-v2.md,
 *       build-action-plan.md Session 3.
 *
 * Phase 1: 2 signals only — login recency (60%) + compliance activity (40%).
 * Keep the math in lockstep with packages/shared/src/services/health.service.ts.
 * If you change the weights or normalisation here, change them there too (and
 * the tests in packages/shared/src/__tests__/health/health.test.ts).
 *
 * Trigger (configured separately — see migration 00025 for the pg_cron snippet):
 *   Schedule: daily at 02:00 SAST (== 00:00 UTC).
 *   Invocation: authenticated POST with the service-role key.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'

// ─── Phase 1 constants (mirror of packages/shared/src/services/health.service.ts)

const WEIGHT_LOGIN      = 0.6
const WEIGHT_COMPLIANCE = 0.4
const LOGIN_WINDOW_DAYS = 30
const COMPLIANCE_MAX    = 10
const COMPLIANCE_WINDOW_DAYS = 30

type Tier = 'green' | 'yellow' | 'orange' | 'red'

interface RawSignals {
  loginRecencyDays: number | null
  complianceCountLast30d: number
}

interface HealthResult {
  score: number
  tier: Tier
  signals: {
    login_recency: { raw: number | null; normalized: number; weight: number; contribution: number }
    compliance_activity: { raw: number; normalized: number; weight: number; contribution: number }
  }
}

function normalizeLoginRecency(days: number | null): number {
  if (days === null || days < 0) return 0
  return Math.max(0, Math.round(100 - (days / LOGIN_WINDOW_DAYS) * 100))
}

function normalizeComplianceActivity(count: number): number {
  if (!Number.isFinite(count) || count < 0) return 0
  return Math.min(100, Math.round((count / COMPLIANCE_MAX) * 100))
}

function tierFromScore(score: number): Tier {
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  if (score >= 20) return 'orange'
  return 'red'
}

function computeHealthScore(raw: RawSignals): HealthResult {
  const loginN = normalizeLoginRecency(raw.loginRecencyDays)
  const complN = normalizeComplianceActivity(raw.complianceCountLast30d)
  const loginC = loginN * WEIGHT_LOGIN
  const complC = complN * WEIGHT_COMPLIANCE
  const score = Math.max(0, Math.min(100, Math.round(loginC + complC)))
  return {
    score,
    tier: tierFromScore(score),
    signals: {
      login_recency:       { raw: raw.loginRecencyDays,         normalized: loginN, weight: WEIGHT_LOGIN,      contribution: Math.round(loginC * 10) / 10 },
      compliance_activity: { raw: raw.complianceCountLast30d,   normalized: complN, weight: WEIGHT_COMPLIANCE, contribution: Math.round(complC * 10) / 10 },
    },
  }
}

// ─── Data fetch ──────────────────────────────────────────────────────────────

async function listOrgsToScore(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  // Any org with at least one active project. Phase 2 can tighten to "paid".
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('status', 'active')
  if (error) throw new Error(`listOrgsToScore: ${error.message}`)
  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ organisation_id: string }>) seen.add(row.organisation_id)
  return Array.from(seen)
}

async function fetchSignals(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  authUserIndex: Map<string, string | null>,
  now: Date,
): Promise<RawSignals> {
  // Most recent login across every active member of the org.
  const { data: members } = await (supabase as any)
    .from('user_organisations')
    .select('user_id')
    .eq('organisation_id', orgId)
    .eq('is_active', true)

  const memberIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)

  let loginRecencyDays: number | null = null
  if (memberIds.length > 0) {
    const timestamps = memberIds
      .map((id) => authUserIndex.get(id))
      .filter((t): t is string => Boolean(t))
      .map((t) => new Date(t).getTime())
      .sort((a, b) => b - a)
    if (timestamps.length > 0) {
      loginRecencyDays = Math.floor((now.getTime() - timestamps[0]) / 86_400_000)
    }
  }

  const windowStart = new Date(now.getTime() - COMPLIANCE_WINDOW_DAYS * 86_400_000).toISOString()
  const { count } = await (supabase as any)
    .schema('compliance')
    .from('coc_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .gte('created_at', windowStart)

  return {
    loginRecencyDays,
    complianceCountLast30d: count ?? 0,
  }
}

// Pull the full auth-users list once per run rather than per-org (N+1 would be
// brutal with 100+ orgs). listUsers is paginated at 1000 per page.
async function buildAuthUserIndex(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, string | null>> {
  const index = new Map<string, string | null>()
  let page = 1
  const perPage = 1000
  for (;;) {
    const { data, error } = await (supabase as any).auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`auth.admin.listUsers: ${error.message}`)
    const users = (data?.users ?? []) as Array<{ id: string; last_sign_in_at: string | null }>
    for (const u of users) index.set(u.id, u.last_sign_in_at)
    if (users.length < perPage) break
    page += 1
    if (page > 100) break // hard safety limit — 100k users
  }
  return index
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  // Accept POST (cron) or GET (manual run-from-dashboard).
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const now = new Date()
  const report = { orgs_scored: 0, errors: [] as Array<{ orgId: string; message: string }> }

  try {
    const [orgIds, authIndex] = await Promise.all([
      listOrgsToScore(supabase),
      buildAuthUserIndex(supabase),
    ])

    for (const orgId of orgIds) {
      try {
        const signals = await fetchSignals(supabase, orgId, authIndex, now)
        const result  = computeHealthScore(signals)
        const { error } = await (supabase as any)
          .from('organisation_health_scores')
          .insert({
            organisation_id: orgId,
            score:           result.score,
            tier:            result.tier,
            signals:         result.signals,
            calculated_at:   now.toISOString(),
          })
        if (error) throw new Error(error.message)
        report.orgs_scored += 1
      } catch (err) {
        report.errors.push({ orgId, message: err instanceof Error ? err.message : String(err) })
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ran_at: now.toISOString(),
        ...report,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`calculate-health-scores fatal: ${message}`)
    return new Response(
      JSON.stringify({ ok: false, error: message, ran_at: now.toISOString() }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
