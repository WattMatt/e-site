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

  // ── Seed cost_lines rates from latest ISSUED revision (B6 — 2026-05-18) ─
  // If an ISSUED revision exists on this project, copy its cost_lines rates
  // forward. Engineer doesn't have to re-type 17 sizes × 2 conductors on
  // every new revision. Best-effort: any failure is non-fatal — the new
  // revision is already created.
  try {
    const { data: prevIssued } = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id')
      .eq('project_id', parsed.data.projectId)
      .eq('status', 'ISSUED')
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const prev = (prevIssued?.[0] as { id: string } | undefined)?.id
    if (prev) {
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
        const orgId = (project as { organisation_id: string }).organisation_id
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
      // Also copy VAT % across if the column exists (migration 00060).
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
