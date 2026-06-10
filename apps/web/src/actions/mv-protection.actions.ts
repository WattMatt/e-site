'use server'

/**
 * Medium-Voltage protection — server actions (spec §7).
 *
 * Every action follows the cable_schedule write shape:
 *   1. Resolve revision → project_id + organisation_id + status (one read of
 *      cable_schedule.revisions), so we gate against the *project's* org.
 *   2. requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES) — honours
 *      per-project role overrides.
 *   3. Refuse writes on a non-DRAFT revision (ISSUED / SUPERSEDED are frozen —
 *      start a new revision), mirroring assertDraft in cable-entities.actions.
 *   4. Delegate to mvProtectionService (validates input with the Zod schemas).
 *   5. revalidatePath the revision workspace; return a discriminated
 *      { data } | { error }.
 *
 * The heavy full-network Z-bus + earth-fault solve runs in the route handler
 * (apps/web/src/app/api/medium-voltage/study/route.ts) to dodge action
 * timeouts. issueMvStudy (the gated DRAFT→ISSUED transition) is Phase 6.
 */

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  mvProtectionService,
  mvSignoffComplete,
  ORG_WRITE_ROLES,
  type MvStudySettingsInput,
  type MvStudySignoffInput,
  type FaultSourceInput,
  type ProtectionDeviceInput,
} from '@esite/shared'

// ─── revision → project / org / status resolution ───────────────────────

interface RevisionContext {
  revisionId: string
  projectId: string
  organisationId: string
}

/**
 * Resolve the revision's project + org and confirm it is writable (DRAFT),
 * then enforce the ORG_WRITE_ROLES gate on the project. Returns the resolved
 * context or an error string — the shape every action branches on.
 */
async function resolveWritableRevision(
  supabase: any,
  revisionId: string,
): Promise<RevisionContext | { error: string }> {
  const { data: rev, error } = await supabase
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, project_id, organisation_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (error || !rev) return { error: 'Revision not found' }
  if (rev.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const guard = await requireEffectiveRole(supabase, rev.project_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  return {
    revisionId: rev.id as string,
    projectId: rev.project_id as string,
    organisationId: rev.organisation_id as string,
  }
}

function bust(projectId: string, revisionId: string): void {
  revalidatePath(`/projects/${projectId}/cables/${revisionId}`)
}

// ─── upsertMvStudySettings ───────────────────────────────────────────────

export async function upsertMvStudySettings(
  input: MvStudySettingsInput,
): Promise<{ data: Awaited<ReturnType<typeof mvProtectionService.upsertMvStudySettings>> } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  try {
    const data = await mvProtectionService.upsertMvStudySettings(
      supabase as any,
      ctx.organisationId,
      input,
    )
    bust(ctx.projectId, ctx.revisionId)
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save study settings' }
  }
}

// ─── upsertFaultSource ───────────────────────────────────────────────────

export async function upsertFaultSource(
  input: FaultSourceInput,
  id?: string,
): Promise<{ data: Awaited<ReturnType<typeof mvProtectionService.upsertFaultSource>> } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  try {
    const data = await mvProtectionService.upsertFaultSource(
      supabase as any,
      ctx.organisationId,
      input,
      id,
    )
    bust(ctx.projectId, ctx.revisionId)
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save fault source' }
  }
}

// ─── upsertProtectionDevice ──────────────────────────────────────────────

export async function upsertProtectionDevice(
  input: ProtectionDeviceInput,
  id?: string,
): Promise<{ data: Awaited<ReturnType<typeof mvProtectionService.upsertProtectionDevice>> } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  const { data: { user } } = await supabase.auth.getUser()

  try {
    const data = await mvProtectionService.upsertProtectionDevice(
      supabase as any,
      ctx.organisationId,
      input,
      { id, createdBy: user?.id ?? null },
    )
    bust(ctx.projectId, ctx.revisionId)
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save protection device' }
  }
}

// ─── overrideFaultLevel (computed-with-override + provenance) ─────────────
//
// Decision #3: the engine writes per-node fault_results; revisions.fault_level_ka
// is the *source* prospective value the existing shortCircuitCheck() consumes.
// This action lets an engineer override that single source value with an explicit
// reason. Provenance is recorded in change_log (the audit substance — there is no
// dedicated provenance column on revisions, and migrations are frozen).

export async function overrideFaultLevel(input: {
  revisionId: string
  faultLevelKa: number | null
  reason?: string | null
}): Promise<{ data: { faultLevelKa: number | null } } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  if (input.faultLevelKa != null && !(input.faultLevelKa >= 0)) {
    return { error: 'Fault level must be a non-negative number' }
  }

  const { data: { user } } = await supabase.auth.getUser()

  // Read the prior value for the audit trail.
  const { data: prior } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('fault_level_ka')
    .eq('id', ctx.revisionId)
    .maybeSingle()
  const oldValue = (prior as { fault_level_ka?: number | null } | null)?.fault_level_ka ?? null

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .update({ fault_level_ka: input.faultLevelKa })
    .eq('id', ctx.revisionId)
  if (error) return { error: error.message }

  // Provenance: best-effort change_log entry (matches the cable-entities audit
  // pattern — a logging failure never surfaces to the caller).
  try {
    await (supabase as any)
      .schema('cable_schedule')
      .from('change_log')
      .insert({
        revision_id: ctx.revisionId,
        organisation_id: ctx.organisationId,
        entity_type: 'revision',
        entity_id: ctx.revisionId,
        field_name: 'fault_level_ka',
        old_value: oldValue,
        new_value: input.faultLevelKa,
        reason: input.reason ?? 'Engineer override of computed fault level',
        changed_by: user?.id ?? null,
      })
  } catch {
    // best-effort audit only
  }

  bust(ctx.projectId, ctx.revisionId)
  return { data: { faultLevelKa: input.faultLevelKa } }
}

// ─── upsertMvStudySignoff (§9 gated-issue evidence) ──────────────────────
//
// Captures the 4-tick Pr.Eng sign-off (spec §9). There is NO separate MV issue
// action: the study is a facet of the same revision, so the sign-off is a
// PRECONDITION enforced additively in issueRevisionAction (assertMvSignoffComplete).
// When the saved record satisfies every gate, this action stamps signed_off_by
// (the acting user) + signed_off_at (now); otherwise the stamp is cleared to
// null so a later edit that breaks the gate doesn't leave a stale signature.

export async function upsertMvStudySignoff(
  input: MvStudySignoffInput,
): Promise<{ data: Awaited<ReturnType<typeof mvProtectionService.upsertMvStudySignoff>> } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  const { data: { user } } = await supabase.auth.getUser()

  // The form sends the full record, so completeness of the row-as-saved is
  // judged on the incoming input (mvSignoffComplete reads only the gate fields).
  const { complete } = mvSignoffComplete({
    id: '', organisationId: ctx.organisationId, revisionId: ctx.revisionId,
    prEngName: input.prEngName ?? null,
    prEngEcsaReg: input.prEngEcsaReg ?? null,
    curveManualRev: input.curveManualRev ?? null,
    sourceDataConfirmed: input.sourceDataConfirmed ?? false,
    validationPackRef: input.validationPackRef ?? null,
    signedOffBy: null, signedOffAt: null, createdAt: '', updatedAt: '',
  })

  try {
    const data = await mvProtectionService.upsertMvStudySignoff(
      supabase as any,
      ctx.revisionId,
      ctx.organisationId,
      input,
      complete
        ? { signedOffBy: user?.id ?? null, signedOffAt: new Date().toISOString() }
        : { signedOffBy: null, signedOffAt: null },
    )
    bust(ctx.projectId, ctx.revisionId)
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save sign-off' }
  }
}
