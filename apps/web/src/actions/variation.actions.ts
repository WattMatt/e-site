'use server'

/**
 * Project Variations & Remeasures server actions.
 *
 * Shape mirrors valuation.actions.ts exactly:
 *   1. createClient() (cookie/RLS client) — used for the auth + role gate.
 *   2. requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES) — project-scoped
 *      gate (honours per-project role overrides; see migration 00107). Variation
 *      figures are cost data, so reads + draft writes gate on COST_VIEW_ROLES;
 *      delete gates on the broader ORG_WRITE_ROLES.
 *   3. Service-role (RLS-bypassing) reads/writes sit BEHIND the gate, via
 *      createServiceClient().
 *   4. Cross-project guard: every action that takes a voId resolves that VO's
 *      project_id via the service client and refuses ('Not found') if it isn't
 *      this project — done BEFORE any write, so a forged VO id from another
 *      project cannot be touched.
 *   5. { data } | { error } result; revalidatePath after writes.
 *
 * Profiles-RLS lesson: approver/creator display names are resolved via the
 * SERVICE client after the gate — the caller's RLS client only returns their OWN
 * public.profiles row.
 */

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  variationService,
  boqService,
  validateQtyDelta,
  variationLinePatchSchema,
  COST_VIEW_ROLES,
  ORG_WRITE_ROLES,
  type VariationOrder,
  type VariationLine,
  type VariationLinePatch,
} from '@esite/shared'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/variations`, 'page')
}

/** Resolve project → organisation_id so we gate against the *project's* org. */
async function resolveProjectOrg(
  supabase: any,
  projectId: string,
): Promise<{ organisationId: string } | null> {
  const { data } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!data) return null
  return { organisationId: data.organisation_id }
}

/**
 * Cross-project guard: resolve a VO's project_id + status via the SERVICE
 * client. Returns the row, or null if it does not exist / belongs to another
 * project (callers map both to { error: 'Not found' }).
 */
async function resolveVoForGate(
  service: any,
  projectId: string,
  voId: string,
): Promise<{ id: string; status: string; voNo: number } | null> {
  const { data } = await service
    .schema('projects')
    .from('variation_orders')
    .select('id, project_id, status, vo_no')
    .eq('id', voId)
    .maybeSingle()
  if (!data || data.project_id !== projectId) return null
  return { id: data.id, status: data.status, voNo: data.vo_no }
}

// ─── listVariationOrdersAction ───────────────────────────────────────────────

export type ListVariationOrdersResult = { data: { vos: VariationOrder[] } } | { error: string }

export async function listVariationOrdersAction(projectId: string): Promise<ListVariationOrdersResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  try {
    const service = createServiceClient()
    const vos = await variationService.list(service as any, projectId)
    return { data: { vos } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load variation orders' }
  }
}

// ─── getVariationOrderAction ─────────────────────────────────────────────────

export type GetVariationOrderResult =
  | {
      data: {
        vo: VariationOrder
        lines: VariationLine[]
        /** Live Σ value_change over the VO's lines (net_change is only frozen on approve). */
        netChange: number
        approvedByName: string | null
        createdByName: string | null
      }
    }
  | { error: string }

export async function getVariationOrderAction(
  projectId: string,
  voId: string,
): Promise<GetVariationOrderResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  try {
    const service = createServiceClient()
    const result = await variationService.get(service as any, voId)
    // Cross-project guard: the VO must belong to this project.
    if (!result || result.vo.projectId !== projectId) return { error: 'Not found' }

    const { vo, lines } = result

    // Live net change — the stored net_change is only snapshotted on approve.
    const netChange = round2(lines.reduce((s, l) => s + l.valueChange, 0))

    // created_by isn't on the VariationOrder domain type — read it off the row.
    const { data: row } = await (service as any)
      .schema('projects')
      .from('variation_orders')
      .select('created_by')
      .eq('id', voId)
      .maybeSingle()
    const createdById: string | null = row?.created_by ?? null

    // Resolve approver + creator names via the SERVICE client (profiles RLS
    // only returns the caller's own row to the cookie client).
    const ids = [vo.approvedBy, createdById].filter((id): id is string => Boolean(id))
    let approvedByName: string | null = null
    let createdByName: string | null = null
    if (ids.length > 0) {
      const { data: profiles } = await (service as any)
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids)
      const byId = new Map(
        ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
          (p) => [p.id, p.full_name ?? p.email ?? null],
        ),
      )
      approvedByName = vo.approvedBy ? byId.get(vo.approvedBy) ?? null : null
      createdByName = createdById ? byId.get(createdById) ?? null : null
    }

    return { data: { vo, lines, netChange, approvedByName, createdByName } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load variation order' }
  }
}

// ─── createVariationOrderAction ──────────────────────────────────────────────

export type CreateVariationOrderResult = { data: { vo: VariationOrder } } | { error: string }

export async function createVariationOrderAction(
  projectId: string,
  input: { voDate: string; title: string; reason: string | null },
): Promise<CreateVariationOrderResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const { data: { user } } = await supabase.auth.getUser()

  try {
    const service = createServiceClient()

    // A VO adjusts the current BOQ import — refuse if none.
    const current = await boqService.getCurrent(service as any, projectId)
    if (!current) return { error: 'Import a BOQ on the Rates tab first' }

    const vo = await variationService.create(service as any, {
      projectId,
      organisationId: proj.organisationId,
      boqImportId: current.id,
      voDate: input.voDate,
      title: input.title,
      reason: input.reason,
      createdBy: user?.id ?? null,
    })
    bust(projectId)
    return { data: { vo } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Create failed' }
  }
}

// ─── upsertVariationLineAction ───────────────────────────────────────────────

export type UpsertVariationLineResult = { data: { line: VariationLine } } | { error: string }

export async function upsertVariationLineAction(
  projectId: string,
  voId: string,
  patch: VariationLinePatch & { id?: string },
): Promise<UpsertVariationLineResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = variationLinePatchSchema.safeParse(patch)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid variation line' }
  }
  // The patch schema strips unknown keys — carry the update-target id through.
  const lineId = typeof patch.id === 'string' ? patch.id : undefined

  const service = createServiceClient()

  // Cross-project + approved guard (before any write).
  const vo = await resolveVoForGate(service as any, projectId, voId)
  if (!vo) return { error: 'Not found' }
  if (vo.status === 'approved') {
    return { error: 'This variation order is approved and can no longer be edited.' }
  }

  try {
    // Updating an existing line: it must belong to THIS VO.
    if (lineId) {
      const { data: lineRow } = await (service as any)
        .schema('projects')
        .from('variation_lines')
        .select('id, variation_order_id')
        .eq('id', lineId)
        .maybeSingle()
      if (!lineRow || lineRow.variation_order_id !== voId) return { error: 'Not found' }
    }

    if (parsed.data.kind === 'adjust') {
      // Load the target boq item (rates for value_change + quantity for the floor).
      const { data: itemRow } = await (service as any)
        .schema('projects')
        .from('boq_items')
        .select('id, quantity, quantity_mode, amount, supply_rate, install_rate, rate, rate_model')
        .eq('id', parsed.data.boqItemId)
        .maybeSingle()
      if (!itemRow) return { error: 'Not found' }

      // The >= 0 revised-quantity floor: contractQty + approved deltas + this delta.
      const adjustments = await variationService.getApprovedAdjustments(service as any, projectId)
      const priorDeltas = adjustments.get(parsed.data.boqItemId!) ?? []
      const quantity = itemRow.quantity == null ? null : Number(itemRow.quantity)
      if (!validateQtyDelta({ quantity }, priorDeltas, parsed.data.qtyDelta!)) {
        return { error: 'Delta would take the revised quantity below zero' }
      }

      const line = await variationService.upsertLine(
        service as any,
        voId,
        { ...parsed.data, id: lineId },
        {
          supplyRate: itemRow.supply_rate == null ? null : Number(itemRow.supply_rate),
          installRate: itemRow.install_rate == null ? null : Number(itemRow.install_rate),
          rate: itemRow.rate == null ? null : Number(itemRow.rate),
          rateModel: itemRow.rate_model,
        },
      )
      bust(projectId)
      return { data: { line } }
    }

    // kind === 'add' — the target section must belong to this project's current import.
    const { data: sectionRow } = await (service as any)
      .schema('projects')
      .from('boq_sections')
      .select('id, import_id')
      .eq('id', parsed.data.sectionId)
      .maybeSingle()
    const current = await boqService.getCurrent(service as any, projectId)
    if (!sectionRow || !current || sectionRow.import_id !== current.id) {
      return { error: 'Not found' }
    }

    const line = await variationService.upsertLine(service as any, voId, { ...parsed.data, id: lineId })
    bust(projectId)
    return { data: { line } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// ─── deleteVariationLineAction ───────────────────────────────────────────────

export type DeleteVariationLineResult = { data: { deleted: true } } | { error: string }

export async function deleteVariationLineAction(
  projectId: string,
  voId: string,
  lineId: string,
): Promise<DeleteVariationLineResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project + approved guard (before the delete).
  const vo = await resolveVoForGate(service as any, projectId, voId)
  if (!vo) return { error: 'Not found' }
  if (vo.status === 'approved') {
    return { error: 'This variation order is approved and can no longer be edited.' }
  }

  try {
    // The line must belong to THIS VO.
    const { data: lineRow } = await (service as any)
      .schema('projects')
      .from('variation_lines')
      .select('id, variation_order_id')
      .eq('id', lineId)
      .maybeSingle()
    if (!lineRow || lineRow.variation_order_id !== voId) return { error: 'Not found' }

    await variationService.deleteLine(service as any, lineId)
    bust(projectId)
    return { data: { deleted: true } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Delete failed' }
  }
}

// ─── approveVariationOrderAction ─────────────────────────────────────────────

export type ApproveVariationOrderResult = { data: { vo: VariationOrder } } | { error: string }

/**
 * Approve a VO: materialize its `add` lines into boq_items, snapshot
 * net_change, flip status (ordering lives in variationService.approve).
 * Approval changes the revised contract position, so the rates + valuations
 * surfaces are revalidated alongside variations.
 */
export async function approveVariationOrderAction(
  projectId: string,
  voId: string,
): Promise<ApproveVariationOrderResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project + already-approved guard (before any write).
  const vo = await resolveVoForGate(service as any, projectId, voId)
  if (!vo) return { error: 'Not found' }
  if (vo.status === 'approved') {
    return { error: 'This variation order is already approved.' }
  }

  const { data: { user } } = await supabase.auth.getUser()

  try {
    const approved = await variationService.approve(service as any, voId, {
      approvedBy: user?.id ?? null,
    })
    bust(projectId)
    revalidatePath(`/projects/${projectId}/settings/rates`, 'page')
    revalidatePath(`/projects/${projectId}/settings/valuations`, 'page')
    return { data: { vo: approved } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Approve failed' }
  }
}

// ─── deleteVariationOrderAction ──────────────────────────────────────────────

export type DeleteVariationOrderResult = { data: { deleted: true } } | { error: string }

export async function deleteVariationOrderAction(
  projectId: string,
  voId: string,
): Promise<DeleteVariationOrderResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project + approved guard (before the delete).
  const vo = await resolveVoForGate(service as any, projectId, voId)
  if (!vo) return { error: 'Not found' }
  if (vo.status === 'approved') {
    return { error: 'An approved variation order cannot be deleted.' }
  }

  try {
    const { error } = await (service as any)
      .schema('projects')
      .from('variation_orders')
      .delete()
      .eq('id', voId)
    if (error) throw new Error(error.message)
    bust(projectId)
    return { data: { deleted: true } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Delete failed' }
  }
}
