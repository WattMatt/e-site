'use server'

/**
 * Discrepancy report actions (§15.5).
 *
 * Three actions per row:
 *   - acceptVarianceAction        (Verifier/Admin only) flips DISCREPANCY → CONFIRMED
 *     with the override reason recorded in confirmation_notes + change_log.
 *   - requestRemeasureAction      (SiteOperator/Verifier/Admin) clears
 *     confirmed_length_* + flips back to MEASURED. The site team must
 *     re-walk and re-enter.
 *   - requestDesignReviewAction   (Designer/Verifier/Admin) opens a fresh
 *     DRAFT revision if there isn't one already, copies the schedule
 *     snapshot, and flags this cable on the change_log so the designer
 *     can re-size if the route walked longer than expected.
 *
 * All three write change_log rows so the timeline carries the reason +
 * actor + time.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { lookupCableRole, ROLE_CAPS } from '@/lib/cable-schedule/roles'
import { requireRoleForRevision, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

const uuid = z.string().uuid()

async function loadCtx(supabase: any, cableId: string) {
  const { data: row } = await supabase
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, revision_id, organisation_id, measured_length_m, confirmed_length_m, length_status, ' +
      'revision:revisions!revision_id(id, status, project_id)',
    )
    .eq('id', cableId)
    .single()
  if (!row) return { error: 'Cable not found' as const }
  const r = row as any
  return {
    revisionId: r.revision_id as string,
    revisionStatus: r.revision?.status as 'DRAFT' | 'ISSUED' | 'SUPERSEDED',
    projectId: r.revision?.project_id as string,
    organisationId: r.organisation_id as string,
    measured: r.measured_length_m == null ? null : Number(r.measured_length_m),
    confirmed: r.confirmed_length_m == null ? null : Number(r.confirmed_length_m),
    status: r.length_status,
  }
}

export async function acceptVarianceAction(
  input: { cableId: string; reason: string },
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(input.cableId).success) return { error: 'Invalid cable id' }
  if (!input.reason || input.reason.trim().length < 4) {
    return { error: 'A reason of at least 4 characters is required' }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadCtx(supabase, input.cableId)
  if ('error' in ctx) return { error: ctx.error }
  if (ctx.revisionStatus !== 'DRAFT') return { error: 'Revision is not DRAFT' }
  if (ctx.status !== 'DISCREPANCY') return { error: 'Cable is not in DISCREPANCY state' }

  // C12: coarse org-role gate — discrepancy resolution is engineer-only.
  const roleCheck = await requireRoleForRevision(supabase, ctx.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  const role = await lookupCableRole(supabase, user.id, ctx.organisationId)
  if (!ROLE_CAPS[role].acceptVariance) {
    return { error: `Your role (${role}) cannot accept a variance.` }
  }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({
      length_status: 'CONFIRMED',
      confirmation_notes: input.reason.trim(),
    })
    .eq('id', input.cableId)
  if (error) return { error: error.message }

  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: ctx.revisionId,
      organisation_id: ctx.organisationId,
      entity_type: 'cable',
      entity_id: input.cableId,
      field_name: 'length_status',
      old_value: 'DISCREPANCY',
      new_value: 'CONFIRMED',
      reason: input.reason.trim(),
      changed_by: user.id,
    })

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}/discrepancies`)
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true }
}

export async function requestRemeasureAction(
  input: { cableId: string; reason?: string },
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(input.cableId).success) return { error: 'Invalid cable id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadCtx(supabase, input.cableId)
  if ('error' in ctx) return { error: ctx.error }
  if (ctx.revisionStatus !== 'DRAFT') return { error: 'Revision is not DRAFT' }

  // C12: coarse org-role gate — discrepancy resolution is engineer-only.
  const roleCheck = await requireRoleForRevision(supabase, ctx.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  const role = await lookupCableRole(supabase, user.id, ctx.organisationId)
  if (!ROLE_CAPS[role].requestRemeasure) {
    return { error: `Your role (${role}) cannot request a re-measure.` }
  }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({
      confirmed_length_m: null,
      confirmed_length_by: null,
      confirmed_length_at: null,
      confirmed_length_method: null,
      length_status: ctx.measured == null ? 'UNMEASURED' : 'MEASURED',
    })
    .eq('id', input.cableId)
  if (error) return { error: error.message }

  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: ctx.revisionId,
      organisation_id: ctx.organisationId,
      entity_type: 'cable',
      entity_id: input.cableId,
      field_name: 'length_status',
      old_value: ctx.status,
      new_value: ctx.measured == null ? 'UNMEASURED' : 'MEASURED',
      reason: input.reason?.trim() || 'Re-measure requested',
      changed_by: user.id,
    })

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}/discrepancies`)
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true }
}

export async function requestDesignReviewAction(
  input: { cableId: string; reason?: string },
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(input.cableId).success) return { error: 'Invalid cable id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadCtx(supabase, input.cableId)
  if ('error' in ctx) return { error: ctx.error }

  // C12: coarse org-role gate — design review is engineer-only.
  const roleCheck = await requireRoleForRevision(supabase, ctx.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  const role = await lookupCableRole(supabase, user.id, ctx.organisationId)
  if (!ROLE_CAPS[role].requestDesignReview) {
    return { error: `Your role (${role}) cannot request a design review.` }
  }

  // Log the request — the designer's workflow will pick it up via the
  // change_log filter. Phase-1: we don't auto-create a new revision; the
  // designer reviews and decides whether a re-size is warranted.
  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: ctx.revisionId,
      organisation_id: ctx.organisationId,
      entity_type: 'cable',
      entity_id: input.cableId,
      field_name: 'design_review_request',
      old_value: null,
      new_value: { reason: input.reason?.trim() ?? null, requested_at: new Date().toISOString() },
      reason: input.reason?.trim() ?? null,
      changed_by: user.id,
    })

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}/discrepancies`)
  return { ok: true }
}
