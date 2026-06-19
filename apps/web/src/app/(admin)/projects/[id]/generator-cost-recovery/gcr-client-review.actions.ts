'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { dispatchNotification, dispatchEmail } from '@/lib/notifications'
import {
  ORG_WRITE_ROLES,
  COST_VIEW_ROLES,
  mapDbToEngineInput,
  buildGeneratorCostRecovery,
  toClientReviewPayload,
  type ClientBankInput,
  type GcrChangeRequestField,
  type GcrChangeRequestRow,
} from '@esite/shared'
import { loadGcrConfigAction } from './gcr.actions'

// ─── Shared helpers ───────────────────────────────────────────────────────────

const GCR_PATH = (projectId: string) =>
  `/projects/${projectId}/generator-cost-recovery`

type ActionResult = { ok: true } | { error: string }

/**
 * Coerce a numeric change-request value (area, manual kW) for the accept path.
 * null passes through (means "clear the field"). Non-finite, NaN, or negative
 * input is rejected so garbage never reaches the DB as NaN. Returns the parsed
 * number or `{ error }`.
 */
function parseNonNegativeNumber(
  raw: string | null,
): { value: number | null } | { error: string } {
  if (raw === null) return { value: null }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return { error: 'Proposed value must be a non-negative number.' }
  }
  return { value: n }
}

/**
 * Resolve organisation_id from projects.projects, mirroring gcr.actions.ts.
 */
async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  return (data as { organisation_id?: string } | null)?.organisation_id ?? null
}

// ─── publishGcrForClientReviewAction ─────────────────────────────────────────

/**
 * Freeze the current engine model into an immutable, outputs-only snapshot row
 * in gcr.review_snapshots. The stored payload is the toClientReviewPayload()
 * projection — contractor cost inputs are physically absent. Gate: ORG_WRITE_ROLES.
 */
export async function publishGcrForClientReviewAction(
  projectId: string,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const config = await loadGcrConfigAction(projectId)
  if ('error' in config) return { error: config.error }

  const input = mapDbToEngineInput(config)
  const model = buildGeneratorCostRecovery(input)

  // Per-bank inputs: each zone's generator sizes + the tenant load assigned to
  // that zone (resolved via assignments → node → allocation by shop_number).
  const banks: ClientBankInput[] = config.zones.map((z) => {
    const generatorSizes = config.generators
      .filter((g) => g.zone_id === z.id)
      .map((g) => g.generator_size ?? '')

    const assignedNodeIds = new Set(
      config.assignments.filter((a) => a.zone_id === z.id).map((a) => a.node_id),
    )
    const assignedShopNumbers = new Set(
      config.tenants
        .filter((t) => assignedNodeIds.has(t.id))
        .map((t) => t.shop_number),
    )
    const assignedLoadKw = model.allocations
      .filter((alloc) => assignedShopNumbers.has(alloc.shopNumber))
      .reduce((sum, alloc) => sum + alloc.loadingKw, 0)

    return { zoneName: z.zone_name, generatorSizes, assignedLoadKw }
  })

  const payload = toClientReviewPayload(model, banks)

  const { data: userData } = await supabase.auth.getUser()
  const { error } = await (supabase as any)
    .schema('gcr')
    .from('review_snapshots')
    .insert({
      project_id: projectId,
      organisation_id: orgId,
      payload,
      published_for_client_at: new Date().toISOString(),
      created_by: userData?.user?.id ?? null,
    })

  if (error) return { error: error.message ?? 'Failed to publish review snapshot' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── manageClientSiteAccessAction ────────────────────────────────────────────

/**
 * Grant or revoke a client's per-site review access. Grant requires the client
 * to already have an account (Phase-1 invite) — we never create one here.
 * Gate: ORG_WRITE_ROLES.
 */
export async function manageClientSiteAccessAction(
  projectId: string,
  clientId: string,
  op: 'grant' | 'revoke',
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  if (op === 'grant') {
    // Require the client to already have an account (Phase-1 invite flow).
    const svc = createServiceClient() as any
    const { data: profile } = await svc
      .from('profiles')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!profile) {
      return { error: 'No client account for that user — invite them first' }
    }

    const { data: userData } = await supabase.auth.getUser()
    const { error } = await (supabase as any)
      .from('client_site_grants')
      .insert({
        user_id: clientId,
        project_id: projectId,
        organisation_id: orgId,
        granted_by: userData?.user?.id ?? null,
      })
    // A duplicate grant is a no-op, not an error.
    if (error && !/duplicate key/i.test(error.message ?? '')) {
      return { error: error.message ?? 'Failed to grant access' }
    }
  } else {
    const { error } = await (supabase as any)
      .from('client_site_grants')
      .delete()
      .eq('user_id', clientId)
      .eq('project_id', projectId)
    if (error) return { error: error.message ?? 'Failed to revoke access' }
  }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── listClientSiteAccessAction ──────────────────────────────────────────────

export interface ClientSiteAccessRow {
  user_id: string
  email: string | null
  full_name: string | null
}

/** List clients currently granted review access to this project. */
export async function listClientSiteAccessAction(
  projectId: string,
): Promise<ClientSiteAccessRow[] | { error: string }> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .from('client_site_grants')
    .select('user_id, profiles:user_id (email, full_name)')
    .eq('project_id', projectId)
  if (error) return { error: error.message }

  return ((data ?? []) as any[]).map((r) => ({
    user_id: r.user_id,
    email: r.profiles?.email ?? null,
    full_name: r.profiles?.full_name ?? null,
  }))
}

// ─── getLatestClientReviewPublishAction ──────────────────────────────────────

/**
 * Read the timestamp of the latest published review snapshot for this project so
 * the admin panel can show "Last published …". Returns { publishedAt: null }
 * when nothing has been published yet. Gate: COST_VIEW_ROLES (read).
 */
export async function getLatestClientReviewPublishAction(
  projectId: string,
): Promise<{ publishedAt: string | null } | { error: string }> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .from('review_snapshots')
    .select('published_for_client_at')
    .eq('project_id', projectId)
    .order('published_for_client_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { error: error.message }

  return { publishedAt: data?.published_for_client_at ?? null }
}

// ─── resolveClientByEmailAction ──────────────────────────────────────────────

/**
 * Resolve a client's email to their profile id so the admin can grant access by
 * email (the UI never asks an admin to type a UUID). Surfaces the same
 * "invite them first" error as the grant path when no account exists, so the
 * panel can show one consistent message. Read-only lookup via the service
 * client (an admin may not otherwise see a profile outside their org).
 * Gate: ORG_WRITE_ROLES (this is a grant precursor).
 */
export async function resolveClientByEmailAction(
  projectId: string,
  email: string,
): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const normalised = email.trim().toLowerCase()
  if (!normalised) return { error: 'Enter a client email address' }

  const svc = createServiceClient() as any
  const { data: profile, error } = await svc
    .from('profiles')
    .select('id')
    .ilike('email', normalised)
    .maybeSingle()
  if (error) return { error: error.message ?? 'Failed to look up client' }
  if (!profile) {
    return { error: 'No client account for that email — invite them first' }
  }

  return { userId: profile.id as string }
}

// ─── listGcrChangeRequestsAction ─────────────────────────────────────────────

/** List change requests for the admin queue (newest first). */
export async function listGcrChangeRequestsAction(
  projectId: string,
): Promise<GcrChangeRequestRow[] | { error: string }> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .from('change_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }

  return (data ?? []) as GcrChangeRequestRow[]
}

// ─── actionGcrChangeRequestAction ────────────────────────────────────────────

export interface ActionRequestArgs {
  decision: 'accept' | 'decline' | 'reply'
  /** Reason (decline) or message (reply). */
  reply?: string
}

/**
 * Map a captured-proposal field to the bulk_save_tenant_assignments RPC params.
 * Mirrors gcr.actions.ts:bulkSaveTenantAssignmentsAction so the live write path
 * is identical: zone/manual_kw → gcr.tenant_assignments; participation/category
 * → structure.nodes. 'area' is NOT covered here (handled by a direct update).
 */
function bulkParamsFor(
  field: GcrChangeRequestField,
  projectId: string,
  nodeId: string,
  newValue: string | null,
) {
  const base = {
    p_project_id: projectId,
    p_node_ids: [nodeId],
    p_set_zone: false,
    p_zone_id: null as string | null,
    p_set_participation: false,
    p_participation: null as string | null,
    p_set_category: false,
    p_shop_category: null as string | null,
    p_set_manual_kw: false,
    p_manual_kw: null as number | null,
  }
  switch (field) {
    case 'zone':
      return { ...base, p_set_zone: true, p_zone_id: newValue }
    case 'participation':
      return { ...base, p_set_participation: true, p_participation: newValue }
    case 'category':
      return { ...base, p_set_category: true, p_shop_category: newValue }
    case 'manual_kw_override':
      return { ...base, p_set_manual_kw: true, p_manual_kw: newValue === null ? null : Number(newValue) }
    default:
      return base
  }
}

/**
 * Action a client change request. ACCEPT auto-applies the proposed value to the
 * LIVE schedule (mirroring the admin save path exactly), then notifies the
 * client. DECLINE records the reason. REPLY sets admin_reply without changing
 * status. Gate: ORG_WRITE_ROLES.
 */
export async function actionGcrChangeRequestAction(
  projectId: string,
  requestId: string,
  args: ActionRequestArgs,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: req } = await (supabase as any)
    .schema('gcr')
    .from('change_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return { error: 'Request not found' }
  if (req.project_id !== projectId) {
    return { error: 'Request does not belong to this project' }
  }

  // Idempotency: accept/decline may run exactly once, while the request is open.
  // A second click (or a stale queue) must not re-apply the change to the live
  // schedule or fire a duplicate client notification. REPLY stays allowed — it
  // never changes status and admins may reply more than once.
  if (
    (args.decision === 'accept' || args.decision === 'decline') &&
    req.status !== 'open'
  ) {
    return { error: 'This request has already been actioned.' }
  }

  const { data: userData } = await supabase.auth.getUser()
  const adminId = userData?.user?.id ?? null
  const now = new Date().toISOString()

  // ACCEPT auto-applies to the live schedule.
  if (args.decision === 'accept') {
    if (req.field === 'area') {
      // 'area' is a structure.nodes facet not covered by the bulk RPC.
      const parsed = parseNonNegativeNumber(req.new_value)
      if ('error' in parsed) return { error: parsed.error }
      const { error } = await (supabase as any)
        .schema('structure')
        .from('nodes')
        .update({ shop_area_m2: parsed.value })
        .eq('id', req.node_id)
        .eq('project_id', projectId)
      if (error) return { error: error.message ?? 'Failed to apply area change' }
    } else {
      // Guard the only other numeric field before it reaches bulkParamsFor's
      // bare Number() coercion (else a non-numeric value lands as NaN).
      if (req.field === 'manual_kw_override') {
        const parsed = parseNonNegativeNumber(req.new_value)
        if ('error' in parsed) return { error: parsed.error }
      }
      const params = bulkParamsFor(
        req.field as GcrChangeRequestField,
        projectId,
        req.node_id,
        req.new_value,
      )
      const { error } = await (supabase as any)
        .schema('gcr')
        .rpc('bulk_save_tenant_assignments', params)
      if (error) return { error: error.message ?? 'Failed to apply change' }
    }
  }

  const status =
    args.decision === 'accept' ? 'accepted'
    : args.decision === 'decline' ? 'declined'
    : req.status

  const { error: updErr } = await (supabase as any)
    .schema('gcr')
    .from('change_requests')
    .update({
      status,
      admin_reply: args.reply ?? req.admin_reply,
      actioned_by: adminId,
      actioned_at: args.decision === 'reply' ? req.actioned_at : now,
      updated_at: now,
    })
    .eq('id', requestId)
  if (updErr) return { error: updErr.message ?? 'Failed to update request' }

  // Notify the client — in-app (best-effort) + branded email (guaranteed).
  await dispatchNotification({
    userIds: [req.client_id],
    title: `Your GCR request was ${status}`,
    body: args.reply
      ? args.reply
      : `Your request to change ${req.field} on the cost-recovery schedule was ${status}.`,
    route: `/portal/sites/${projectId}/gcr`,
    type: 'gcr_change_request_actioned',
    entityType: 'gcr_change_request',
    entityId: requestId,
  })

  // Branded client email (best-effort — never blocks the action).
  try {
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('email')
      .eq('id', req.client_id)
      .maybeSingle()
    const to = profile?.email as string | undefined
    if (to) {
      // Service-role dispatch: send-email rejects this non-public type for the
      // cookie client (403). dispatchEmail uses the service key, never throws.
      await dispatchEmail('gcr-request-actioned', {
        to,
        projectId,
        status,
        field: req.field,
        reply: args.reply ?? null,
      })
    }
  } catch {
    /* email is best-effort */
  }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}
