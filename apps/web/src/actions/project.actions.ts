'use server'

/**
 * Project lifecycle server actions.
 *
 * Today this owns:
 *   - createProjectAction: validates input, enforces the per-tier project
 *     limit (free=1, starter=5, professional=∞), seeds project_members,
 *     fires the conversion-prompt edge function. Returns either
 *     { projectId } or { error, code: 'paywall', currentCount, limit, tier }.
 *
 * Server-side enforcement is the canonical gate. The /projects/new page
 * also does a server-render check up front so users hit the paywall card
 * BEFORE filling out the form, but that's UX — the action is the truth.
 *
 * Mobile: when the mobile project create flow lands, point it at this
 * server action via the same /api proxy pattern used for notifications.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { createProjectSchema, type CreateProjectInput, PLANS, type PlanTier } from '@esite/shared'

export interface ProjectGateInfo {
  tier: PlanTier
  currentCount: number
  limit: number          // -1 means unlimited
  status: string         // subscription status
}

export type CreateProjectResult =
  | { projectId: string }
  | { error: string; code?: 'paywall'; gate?: ProjectGateInfo }

/**
 * Server-side gate: returns null if the org can create another project,
 * otherwise returns gate info describing why they're blocked. Reused by
 * the /projects/new page to render the paywall pre-flight instead of
 * making the user fill out a form just to hit a 403.
 */
export async function checkProjectQuota(orgId: string): Promise<ProjectGateInfo | null> {
  const supabase = await createClient()

  // Fetch subscription tier + current active project count in parallel.
  const [subRes, projectsRes] = await Promise.all([
    (supabase as any)
      .schema('billing')
      .from('subscriptions')
      .select('tier, status')
      .eq('organisation_id', orgId)
      .maybeSingle(),
    (supabase as any)
      .schema('projects')
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .neq('status', 'cancelled'),
  ])

  // Defensive default: an org without a billing row is treated as free.
  // (Should only happen for orgs created before the seeding logic landed.)
  const tier: PlanTier = (subRes.data?.tier ?? 'free') as PlanTier
  const status: string = subRes.data?.status ?? 'active'
  const plan = PLANS[tier]
  const limit = plan.limits.projects ?? -1
  const currentCount = projectsRes.count ?? 0

  // -1 means unlimited (professional / enterprise tiers).
  if (limit === -1) return null
  if (currentCount < limit) return null

  return { tier, currentCount, limit, status }
}

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: membership, error: memErr } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (memErr || !membership) return { error: 'No active organisation membership' }
  const orgId = membership.organisation_id

  // Tier-limit gate (canonical enforcement).
  const gate = await checkProjectQuota(orgId)
  if (gate) {
    return {
      error: `Your ${PLANS[gate.tier].name} plan allows ${gate.limit} project${gate.limit === 1 ? '' : 's'}. Upgrade to add another.`,
      code: 'paywall',
      gate,
    }
  }

  const i = parsed.data
  const { data: project, error: insertErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .insert({
      organisation_id: orgId,
      created_by: user.id,
      name: i.name,
      description: i.description ?? null,
      address: i.address ?? null,
      city: i.city ?? null,
      province: i.province ?? null,
      status: i.status,
      start_date: i.startDate || null,
      end_date: i.endDate || null,
      contract_value: i.contractValue ?? null,
      client_name: i.clientName ?? null,
      client_contact: i.clientContact ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !project) {
    return { error: insertErr?.message ?? 'Failed to create project' }
  }

  // Add the creator as PM (matches existing /projects/new behaviour).
  await (supabase as any)
    .schema('projects')
    .from('project_members')
    .insert({
      project_id: project.id,
      user_id: user.id,
      organisation_id: orgId,
      role: 'project_manager',
    })

  await trackServer(user.id, ANALYTICS_EVENTS.PROJECT_CREATED, {
    project_id: project.id,
    org_id: orgId,
    source: 'standalone',
  })

  // Best-effort conversion-prompt nudge (mirrors the previous client-side call).
  void supabase.functions
    .invoke('conversion-prompt', { body: { projectId: project.id, organisationId: orgId } })
    .catch(() => {})

  revalidatePath('/projects')
  revalidatePath('/dashboard')
  return { projectId: project.id }
}
