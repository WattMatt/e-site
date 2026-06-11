'use server'

/**
 * Cable Schedule — revision actions (C1.3 slice).
 *
 * The cable_schedule module organises everything under Revisions
 * (DRAFT|ISSUED|SUPERSEDED). Only one DRAFT may exist per project at a
 * time (partial unique index `one_draft_per_project`). This module
 * handles the lifecycle:
 *
 *   createRevisionAction — open a fresh DRAFT (Rev 0 if none exist, or
 *                          Rev N+1 if cloning from a previous ISSUED)
 *   issueRevisionAction  — flip DRAFT → ISSUED, freeze the snapshot
 *   reopenDraftAction    — start the NEXT revision: clones the latest
 *                          ISSUED into a new DRAFT (sources / boards /
 *                          supplies / cables / cost_lines copied with
 *                          fresh IDs and the new revision_id)
 *
 * All actions are Zod-validated and RLS-trusted.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireRoleForRevision, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'
import { assertMvSignoffComplete } from '@esite/shared'

const uuid = z.string().uuid()

const createSchema = z.object({
  projectId: uuid,
  /** Optional explicit code; defaults to "Rev 0" or "Rev <N+1>" based on existing revisions. */
  code: z.string().trim().max(40).optional(),
  description: z.string().trim().max(400).optional().nullable(),
})

const issueSchema = z.object({
  revisionId: uuid,
  changeNotes: z.string().trim().max(8000).optional().nullable(),
})

export async function createRevisionAction(
  input: z.infer<typeof createSchema>,
): Promise<{ id?: string; code?: string; error?: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve org from project for the new row.
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', parsed.data.projectId)
    .single()
  if (projErr || !project) return { error: 'Project not found' }

  // C12: role gate — only engineers can create revisions.
  const roleCheck = await requireRole(
    supabase,
    (project as { organisation_id: string }).organisation_id,
    ROLES_ENGINEER,
  )
  if (!roleCheck.ok) return { error: roleCheck.error }

  // Determine the next revision code. Pulls the existing rev codes and
  // picks the smallest integer N not yet used (so "Rev 0", "Rev 1", "Rev 2"
  // never collide).
  const { data: existing } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('code')
    .eq('project_id', parsed.data.projectId)
  const used = new Set(((existing ?? []) as Array<{ code: string }>).map((r) => r.code))
  let code = parsed.data.code
  if (!code) {
    let n = 0
    while (used.has(`Rev ${n}`)) n++
    code = `Rev ${n}`
  } else if (used.has(code)) {
    return { error: `Revision "${code}" already exists for this project` }
  }

  const { data: row, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .insert({
      project_id: parsed.data.projectId,
      organisation_id: (project as { organisation_id: string }).organisation_id,
      code,
      description: parsed.data.description ?? null,
      status: 'DRAFT',
      created_by: user.id,
    })
    .select('id, code')
    .single()
  if (error || !row) {
    // The one_draft_per_project partial unique catches the "already a
    // draft" case — translate to a nicer message.
    if (error?.code === '23505' || error?.message?.includes('one_draft_per_project')) {
      return { error: 'There is already a DRAFT revision for this project. Issue or discard it before starting another.' }
    }
    return { error: error?.message ?? 'Failed to create revision' }
  }
  const newRevisionId = (row as { id: string }).id

  // ── Seed cost_lines rates (B5-T4 — 2026-05-18) ───────────────────────────
  // Priority order:
  //   1. Project rate_library (authoritative source — wins when present)
  //   2. Previous ISSUED revision on this project (legacy behavior from
  //      6715a58; may carry project-specific overrides we don't want to
  //      propagate by default — so only used when library is empty)
  //   3. Empty → engineer enters rates manually on the cost page
  //
  // Best-effort: any seed failure is non-fatal — the new revision is already
  // created and the engineer can always fall back to manual entry.
  try {
    const orgId = (project as { organisation_id: string }).organisation_id

    // Priority 1: project rate library
    const { data: libraryRates } = await (supabase as any)
      .schema('cable_schedule')
      .from('rate_library')
      .select('size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each')
      .eq('project_id', parsed.data.projectId)

    const libraryEntries = (libraryRates ?? []) as Array<{
      size_mm2: number
      conductor: 'CU' | 'AL'
      supply_rate_per_m: number
      install_rate_per_m: number
      termination_rate_each: number
    }>

    if (libraryEntries.length > 0) {
      const libraryRows = libraryEntries.map((e) => ({
        revision_id: newRevisionId,
        organisation_id: orgId,
        size_mm2: e.size_mm2,
        conductor: e.conductor,
        supply_rate_per_m: e.supply_rate_per_m,
        install_rate_per_m: e.install_rate_per_m,
        termination_rate_each: e.termination_rate_each,
        contingency_pct: null,
        vat_pct: null,
      }))
      // Best-effort insert — duplicate-key errors silenced (race against
      // ensureCostLinesAction firing first on cost-page load).
      await (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .insert(libraryRows)
        .then(() => {})
        .catch(() => {})
    }

    // Priority 2: fall back to previous-revision copy when library is empty.
    // Also runs the VAT-copy step regardless (vat_pct lives on revisions,
    // not in the library).
    const { data: prevIssued } = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id')
      .eq('project_id', parsed.data.projectId)
      .eq('status', 'ISSUED')
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const prev = (prevIssued?.[0] as { id: string } | undefined)?.id
    if (prev && libraryEntries.length === 0) {
      // Try the conductor-aware columns first (post-migration 00061).
      // Tolerant fallback: pre-migration schema lacks `conductor` column.
      let prevRates: Array<{
        size_mm2: number
        conductor?: 'CU' | 'AL'
        supply_rate_per_m: number | null
        install_rate_per_m: number | null
        termination_rate_each: number | null
      }> = []
      const withCond = await (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .select('size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each')
        .eq('revision_id', prev)
        .gt('size_mm2', 0)  // skip the legacy size=0 sentinel
      if (withCond.error) {
        const sizeOnly = await (supabase as any)
          .schema('cable_schedule')
          .from('cost_lines')
          .select('size_mm2, supply_rate_per_m, install_rate_per_m, termination_rate_each')
          .eq('revision_id', prev)
          .gt('size_mm2', 0)
        prevRates = (sizeOnly.data ?? []) as typeof prevRates
      } else {
        prevRates = (withCond.data ?? []) as typeof prevRates
      }
      if (prevRates.length > 0) {
        const clonedRows = prevRates.map((r) => {
          const base: Record<string, unknown> = {
            revision_id: newRevisionId,
            organisation_id: orgId,
            size_mm2: r.size_mm2,
            supply_rate_per_m: r.supply_rate_per_m ?? 0,
            install_rate_per_m: r.install_rate_per_m ?? 0,
            termination_rate_each: r.termination_rate_each ?? 0,
            contingency_pct: null,
            vat_pct: null,
          }
          if (r.conductor) base.conductor = r.conductor
          return base
        })
        // Best-effort insert — duplicate-key errors are silenced (means the
        // user opened the cost page on the new revision before this clone
        // finished, ensureCostLinesAction created the rows first).
        await (supabase as any)
          .schema('cable_schedule')
          .from('cost_lines')
          .insert(clonedRows)
          .then(() => {})
          .catch(() => {})
      }
    }

    // Copy VAT % from previous ISSUED revision regardless of which seed path
    // ran for cost_lines. VAT lives on `revisions.vat_pct` (migration 00060),
    // not in `rate_library`, so library-seeded revisions still benefit from
    // the previous-revision VAT inheritance.
    if (prev) {
      const { data: prevRev } = await (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select('vat_pct')
        .eq('id', prev)
        .maybeSingle()
      if (prevRev && (prevRev as any).vat_pct != null) {
        await (supabase as any)
          .schema('cable_schedule')
          .from('revisions')
          .update({ vat_pct: (prevRev as any).vat_pct })
          .eq('id', newRevisionId)
          .then(() => {})
          .catch(() => {})
      }
    }
  } catch {
    // best-effort; never block revision creation on seed failure
  }

  revalidatePath(`/projects/${parsed.data.projectId}/cables`)
  return { id: newRevisionId, code: (row as { code: string }).code }
}

export async function issueRevisionAction(
  input: z.infer<typeof issueSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = issueSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — only engineers can issue revisions.
  const roleCheck = await requireRoleForRevision(supabase, parsed.data.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  // MV sign-off precondition (spec §9): if this revision carries MV data, the
  // 4-tick Pr.Eng sign-off must be complete before issue. Additive — for
  // cable-only revisions the helper returns ok and behaviour is unchanged.
  const mvGate = await assertMvSignoffComplete(supabase as any, parsed.data.revisionId)
  if (!mvGate.ok) return { error: mvGate.error }

  const { data: rev, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .update({
      status: 'ISSUED',
      issued_at: new Date().toISOString(),
      issued_by: user.id,
      change_notes: parsed.data.changeNotes ?? null,
    })
    .eq('id', parsed.data.revisionId)
    .eq('status', 'DRAFT')              // only DRAFTs can be issued
    .select('id, project_id, code')
    .single()
  if (error || !rev) {
    return { error: error?.message ?? 'Revision was not in DRAFT — cannot issue.' }
  }
  const r = rev as { id: string; project_id: string; code: string }

  // Log the issue as a project-level change_log event so the diff viewer
  // has a marker to anchor on.
  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: r.id,
      organisation_id: ((await (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select('organisation_id')
        .eq('id', r.id)
        .single()).data ?? { organisation_id: null }).organisation_id,
      entity_type: 'revision',
      entity_id: r.id,
      field_name: 'status',
      old_value: 'DRAFT',
      new_value: 'ISSUED',
      reason: parsed.data.changeNotes ?? null,
      changed_by: user.id,
    })

  revalidatePath(`/projects/${r.project_id}/cables`)
  return { ok: true }
}

export async function deleteDraftRevisionAction(
  revisionId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(revisionId).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — only engineers can discard drafts.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  // Only DRAFT revisions can be discarded.
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, project_id, status')
    .eq('id', revisionId)
    .single()
  const r = rev as { id?: string; project_id?: string; status?: string } | null
  if (!r) return { error: 'Revision not found' }
  if (r.status !== 'DRAFT') return { error: 'Only DRAFT revisions can be discarded' }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .delete()
    .eq('id', revisionId)
  if (error) return { error: error.message }

  if (r.project_id) revalidatePath(`/projects/${r.project_id}/cables`)
  return { ok: true }
}

/**
 * Re-seed cost_lines for a DRAFT revision from the project rate_library.
 *
 * Useful when:
 * - A new revision was created before the library was set up
 * - A library entry was added/changed after revision creation
 * - An engineer wants to discard project-specific tweaks
 *
 * Destructive: wipes existing cost_lines on the revision. DRAFT-only.
 * UI wraps in confirm() before calling.
 */
export async function reseedCostLinesFromRateLibraryAction(
  revisionId: string,
): Promise<{ ok: true; seeded: number } | { ok: false; error: string }> {
  if (!uuid.safeParse(revisionId).success) return { ok: false, error: 'Invalid id' }
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — only engineers can re-seed cost lines.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  // Look up revision + project + organisation_id
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, project_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!rev) return { ok: false, error: 'Revision not found' }
  if ((rev as { status: string }).status !== 'DRAFT') {
    return { ok: false, error: 'Re-seeding only allowed on DRAFT revisions' }
  }
  const revRow = rev as { id: string; status: string; project_id: string }

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', revRow.project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found' }
  const orgId = (project as { organisation_id: string }).organisation_id

  // Fetch the project's rate library
  const { data: libraryData } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each')
    .eq('project_id', revRow.project_id)

  const libraryEntries = (libraryData ?? []) as Array<{
    size_mm2: number
    conductor: 'CU' | 'AL'
    supply_rate_per_m: number
    install_rate_per_m: number
    termination_rate_each: number
  }>

  if (libraryEntries.length === 0) {
    return {
      ok: false,
      error: 'Rate library is empty for this project. Set rates first on the project rate library page, then re-seed.',
    }
  }

  // Wipe existing cost_lines
  const { error: deleteErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .delete()
    .eq('revision_id', revisionId)
  if (deleteErr) return { ok: false, error: `Failed to clear existing rates: ${deleteErr.message}` }

  // Insert library rows
  const rows = libraryEntries.map((e) => ({
    revision_id: revisionId,
    organisation_id: orgId,
    size_mm2: e.size_mm2,
    conductor: e.conductor,
    supply_rate_per_m: e.supply_rate_per_m,
    install_rate_per_m: e.install_rate_per_m,
    termination_rate_each: e.termination_rate_each,
    contingency_pct: null,
    vat_pct: null,
  }))

  const { error: insertErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .insert(rows)
  if (insertErr) return { ok: false, error: `Failed to insert library rates: ${insertErr.message}` }

  revalidatePath(`/projects/${revRow.project_id}/cables/${revisionId}/cost`)
  return { ok: true, seeded: libraryEntries.length }
}
