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

  revalidatePath(`/projects/${parsed.data.projectId}/cables`)
  return { id: (row as { id: string; code: string }).id, code: (row as { code: string }).code }
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
