/**
 * Organisation Health Scoring — Phase 1 (simplified 2-signal model).
 *
 * Spec: SPEC DOCS/spec-v2.md §17, strategic-analysis-52-customer-health-scoring-v2.md.
 * Phase 1 uses login recency (60%) + compliance activity (40%). The full 11-signal
 * model arrives in Phase 2 once we have enough data to calibrate weights.
 *
 * Pure math (normalize/compute/tier) has no Supabase dependency so unit tests
 * can run without mocks. DB helpers (fetchRawSignals, persistScore) wrap the
 * queries the daily cron Edge Function needs.
 */

import type { TypedSupabaseClient } from '@esite/db'

// ─── Phase 1 constants ───────────────────────────────────────────────────────

export const HEALTH_WEIGHTS = {
  loginRecency:       0.6,
  complianceActivity: 0.4,
} as const

// A login within this window is perfect; older than this is 0.
export const LOGIN_RECENCY_WINDOW_DAYS = 30

// Ten or more compliance records in the observation window is perfect; zero is 0.
export const COMPLIANCE_SIGNAL_MAX = 10
export const COMPLIANCE_WINDOW_DAYS = 30

// ─── Types ───────────────────────────────────────────────────────────────────

export type HealthTier = 'green' | 'yellow' | 'orange' | 'red'

export interface RawHealthSignals {
  /** Days since the most recent login of any org member. null = never logged in. */
  loginRecencyDays: number | null
  /** Count of compliance records (COC uploads) in the last COMPLIANCE_WINDOW_DAYS. */
  complianceCountLast30d: number
}

export interface NormalizedSignal {
  raw: number | null
  normalized: number
  weight: number
  contribution: number
}

export interface HealthResult {
  score: number
  tier: HealthTier
  signals: {
    login_recency: NormalizedSignal
    compliance_activity: NormalizedSignal
  }
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Login-recency signal. Inverted normalisation — fresher login = higher score.
 * Formula: max(0, 100 - (days / window) * 100).
 *   0 days → 100, 15 → 50, 30+ → 0. Never logged in (null) → 0.
 */
export function normalizeLoginRecency(daysSinceLogin: number | null): number {
  if (daysSinceLogin === null || daysSinceLogin < 0) return 0
  const pct = (daysSinceLogin / LOGIN_RECENCY_WINDOW_DAYS) * 100
  return Math.max(0, Math.round(100 - pct))
}

/**
 * Compliance-activity signal. Min-max — more uploads = higher score.
 * Formula: min(100, (count / max) * 100).
 *   0 uploads → 0, 5 → 50, 10+ → 100.
 */
export function normalizeComplianceActivity(cocsLast30d: number): number {
  if (!Number.isFinite(cocsLast30d) || cocsLast30d < 0) return 0
  const pct = (cocsLast30d / COMPLIANCE_SIGNAL_MAX) * 100
  return Math.min(100, Math.round(pct))
}

// ─── Tier mapping ────────────────────────────────────────────────────────────

/**
 * Score → tier. Thresholds from spec-v2.md §17 and strategic-analysis-52.
 *   70–100 GREEN  ·  40–69 YELLOW  ·  20–39 ORANGE  ·  0–19 RED.
 */
export function tierFromScore(score: number): HealthTier {
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  if (score >= 20) return 'orange'
  return 'red'
}

// ─── Score composition ───────────────────────────────────────────────────────

export function computeHealthScore(raw: RawHealthSignals): HealthResult {
  const loginNorm = normalizeLoginRecency(raw.loginRecencyDays)
  const complNorm = normalizeComplianceActivity(raw.complianceCountLast30d)

  const loginContribution = loginNorm * HEALTH_WEIGHTS.loginRecency
  const complContribution = complNorm * HEALTH_WEIGHTS.complianceActivity
  const rawScore = loginContribution + complContribution
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))

  return {
    score,
    tier: tierFromScore(score),
    signals: {
      login_recency: {
        raw: raw.loginRecencyDays,
        normalized: loginNorm,
        weight: HEALTH_WEIGHTS.loginRecency,
        contribution: Math.round(loginContribution * 10) / 10,
      },
      compliance_activity: {
        raw: raw.complianceCountLast30d,
        normalized: complNorm,
        weight: HEALTH_WEIGHTS.complianceActivity,
        contribution: Math.round(complContribution * 10) / 10,
      },
    },
  }
}

// ─── DB helpers (used by the Edge Function) ──────────────────────────────────

/**
 * Fetch the two Phase 1 raw signals for a single organisation.
 * Caller is the Edge Function running with the service role, so RLS is bypassed.
 */
export async function fetchRawSignals(
  client: TypedSupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<RawHealthSignals> {
  const windowStart = new Date(now.getTime() - COMPLIANCE_WINDOW_DAYS * 86_400_000).toISOString()

  // Login recency: max(last_sign_in_at) across every auth user tied to this org
  // via user_organisations. We read last_sign_in_at through the admin API
  // because auth.users is not in the public schema.
  const { data: members } = await (client as any)
    .from('user_organisations')
    .select('user_id')
    .eq('organisation_id', orgId)
    .eq('is_active', true)

  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id)

  let loginRecencyDays: number | null = null
  if (userIds.length > 0) {
    // auth.admin.listUsers is paginated; for orgs with <1000 users a single page suffices.
    const { data: users } = await (client as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
    const mostRecent = (users?.users ?? [])
      .filter((u: { id: string; last_sign_in_at: string | null }) => userIds.includes(u.id) && u.last_sign_in_at)
      .map((u: { last_sign_in_at: string }) => new Date(u.last_sign_in_at).getTime())
      .sort((a: number, b: number) => b - a)[0]

    loginRecencyDays = mostRecent
      ? Math.floor((now.getTime() - mostRecent) / 86_400_000)
      : null
  }

  // Compliance activity: COC uploads for this org in the last 30 days.
  const { count } = await (client as any)
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

/**
 * Persist a new snapshot into public.organisation_health_scores. The daily
 * cron appends a new row per org; historical rows are retained for trend
 * calculation (Phase 2).
 */
export async function persistHealthScore(
  client: TypedSupabaseClient,
  orgId: string,
  result: HealthResult,
  calculatedAt: Date = new Date(),
): Promise<void> {
  const { error } = await (client as any)
    .from('organisation_health_scores')
    .insert({
      organisation_id: orgId,
      score: result.score,
      tier: result.tier,
      signals: result.signals,
      calculated_at: calculatedAt.toISOString(),
    })
  if (error) throw new Error(`persistHealthScore(${orgId}): ${error.message}`)
}

/**
 * Return organisations that the health-score cron should process.
 * Phase 1: any organisation with at least one active project (paid or free).
 * Phase 2 may tighten this to "≥1 paid project" once pricing is live.
 */
export async function listOrgsToScore(client: TypedSupabaseClient): Promise<string[]> {
  const { data, error } = await (client as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('status', 'active')
  if (error) throw new Error(`listOrgsToScore: ${error.message}`)
  const unique = new Set<string>()
  for (const row of (data ?? []) as Array<{ organisation_id: string }>) {
    unique.add(row.organisation_id)
  }
  return Array.from(unique)
}

export const healthService = {
  computeHealthScore,
  fetchRawSignals,
  persistHealthScore,
  listOrgsToScore,
  tierFromScore,
  normalizeLoginRecency,
  normalizeComplianceActivity,
}
