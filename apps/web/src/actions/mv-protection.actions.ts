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
import { hasMvAccess } from '@/lib/mv-access'
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

/**
 * The R2 000/user/yr Medium-Voltage entitlement check (spec §7 paywall).
 *
 * ⚠ This is deliberately NOT folded into resolveWritableRevision. That helper
 * is shared with overrideFaultLevel, which is called from FaultLevelEditor in
 * the FREE cable-schedule workspace on every DRAFT revision and is the only
 * writer of revisions.fault_level_ka — the source value the LV schedule's
 * short-circuit check consumes. Gating the shared helper would silently break
 * short-circuit checking for every LV user, with no error anywhere.
 *
 * ⚠ It also deliberately does not use requireMvAccess: that calls Next's
 * redirect(), which throws NEXT_REDIRECT — the wrong semantics for an action
 * whose contract is { data } | { error }. hasMvAccess fails closed on error.
 *
 * Divergence from the house pattern, recorded on purpose: the sibling paid
 * feature (Generator Cost-Recovery) gates the REPORT and leaves data entry
 * open. MV gates data entry because the paid artefact is not a document — it
 * is the Z-bus fault solve and the register that feeds it, and fault_results
 * are cached in the database where a page gate cannot reach them at all (see
 * the RESTRICTIVE read policy in migration 00191). docs/rbac-matrix.md records
 * both conditions.
 */
async function requireMvSubscription(supabase: any): Promise<{ error: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (!(await hasMvAccess(user.id, supabase))) {
    return { error: 'Medium-Voltage subscription required' }
  }
  return null
}

function bust(projectId: string, revisionId: string): void {
  revalidatePath(`/projects/${projectId}/medium-voltage/${revisionId}`)
  // overrideFaultLevel writes revisions.fault_level_ka, which the cables
  // workspace reads (shortCircuitCheck source value) — keep busting it too.
  revalidatePath(`/projects/${projectId}/cables/${revisionId}`)
}

// ─── upsertMvStudySettings ───────────────────────────────────────────────

export async function upsertMvStudySettings(
  input: MvStudySettingsInput,
): Promise<{ data: Awaited<ReturnType<typeof mvProtectionService.upsertMvStudySettings>> } | { error: string }> {
  const supabase = await createClient()
  const ctx = await resolveWritableRevision(supabase, input.revisionId)
  if ('error' in ctx) return { error: ctx.error }

  const locked = await requireMvSubscription(supabase)
  if (locked) return locked

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

  const locked = await requireMvSubscription(supabase)
  if (locked) return locked

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

  const locked = await requireMvSubscription(supabase)
  if (locked) return locked

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

  const locked = await requireMvSubscription(supabase)
  if (locked) return locked

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
