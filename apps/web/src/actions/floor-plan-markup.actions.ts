'use server'

/**
 * Saved markup layers on a drawing.
 *
 * WHAT WAS MISSING. Until `00205` a markup could not be stored without an RFI:
 * `public.rfi_annotations` is `rfi_id NOT NULL`, so the only Save in the
 * drawing viewer was "Attach to RFI". These five actions give a drawing its own
 * saved, reopenable state, and attaching to an RFI becomes one export of a
 * saved markup rather than the only way to keep work.
 *
 * TWO THINGS THE CLIENT DOES NOT GET TO DECIDE.
 *
 * 1. WHICH FILE THE GEOMETRY BELONGS TO. `file_path` and `source_revision_id`
 *    are read off the drawing row here, never accepted from the caller. They
 *    are the anchor that lets `loadFloorPlanMarkups` tell the viewer "this was
 *    drawn on an older revision of this sheet" — the one thing standing between
 *    a user and markup that has silently slid because cloud-sync adopted a new
 *    file underneath it.
 *
 * 2. WHICH ORG AND PROJECT THE ROW BELONGS TO. Both are bound by the
 *    `floor_plan_markups_bind_parents` trigger from the drawing. A client that
 *    can name its own `organisation_id` against a permissive policy can hand a
 *    row to a foreign org, which is the hole 00200 had to close.
 *
 * Role gating is MARKUP_WRITE_ROLES — the same set the viewer page itself is
 * gated on, so the contractor who is the primary markup author keeps writing.
 * The RESTRICTIVE policy in 00205 is the database backstop, not the only gate.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { MARKUP_WRITE_ROLES } from '@esite/shared'

/** Mirrors `SceneGraph` in MarkupCanvas. Kept structural on purpose: the shape
 *  list is large and evolving, and a strict schema here would reject a scene
 *  the canvas can render — losing the user's work to a validation error. */
const sceneSchema = z.object({
  version: z.number(),
  canvas: z.object({ w: z.number(), h: z.number() }),
  shapes: z.array(z.record(z.string(), z.unknown())),
  pageCount: z.number().optional(),
})

const MAX_NAME = 80

const saveSchema = z.object({
  floorPlanId: z.string().uuid(),
  /** Absent on a first save; present when overwriting an existing layer. */
  markupId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Give this markup a name').max(MAX_NAME),
  scene: sceneSchema,
  /** The row's updated_at as loaded. Absent on a first save. */
  expectedUpdatedAt: z.string().optional(),
})

export type SavedMarkup = {
  id: string
  name: string
  scene: z.infer<typeof sceneSchema>
  filePath: string
  sourceRevisionId: string | null
  updatedAt: string
  updatedBy: string | null
  shapeCount: number
  /** True when the drawing's active file is no longer the one this was drawn
   *  on. The geometry is unchanged; what it sits on top of is not. */
  staleAgainstDrawing: boolean
}

type PlanRow = { id: string; project_id: string; file_path: string; source_revision_id: string | null }

async function loadPlan(supabase: any, floorPlanId: string): Promise<PlanRow | { error: string }> {
  const { data, error } = await supabase
    .schema('tenants')
    .from('floor_plans')
    .select('id, project_id, file_path, source_revision_id')
    .eq('id', floorPlanId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Drawing not found' }
  return data as PlanRow
}

// ───────────────────────────────────────────────────────────────────────────
// Read
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every saved markup on a drawing, newest first. Read through the caller's own
 * session so RLS is the gate; no service client is involved.
 */
export async function listFloorPlanMarkupsAction(
  input: { floorPlanId: string },
): Promise<{ markups?: SavedMarkup[]; error?: string }> {
  const parsed = z.object({ floorPlanId: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const plan = await loadPlan(supabase, parsed.data.floorPlanId)
  if ('error' in plan) return { error: plan.error }

  const { data, error } = await (supabase as any)
    .schema('tenants')
    .from('floor_plan_markups')
    .select('id, name, scene, file_path, source_revision_id, updated_at, updated_by')
    .eq('floor_plan_id', parsed.data.floorPlanId)
    .order('updated_at', { ascending: false })
  if (error) return { error: error.message }

  return { markups: (data ?? []).map((r: any) => toSavedMarkup(r, plan)) }
}

function toSavedMarkup(row: any, plan: PlanRow): SavedMarkup {
  const shapes = Array.isArray(row.scene?.shapes) ? row.scene.shapes : []
  return {
    id: row.id,
    name: row.name,
    scene: row.scene,
    filePath: row.file_path,
    sourceRevisionId: row.source_revision_id ?? null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
    shapeCount: shapes.length,
    // Compare the FILE, not the revision id: a drawing uploaded directly has no
    // revision id at all, and two different files never share a storage path.
    staleAgainstDrawing: row.file_path !== plan.file_path,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Write
// ───────────────────────────────────────────────────────────────────────────

export type SaveMarkupResult = {
  markup?: SavedMarkup
  error?: string
  conflict?: { updatedAt: string; name: string }
}

/**
 * Create a named markup layer, or overwrite one the caller already holds.
 *
 * A stale write is REFUSED, never merged — two people drawing on the same sheet
 * produce two scenes, and silently keeping the later one loses the earlier
 * one's work with no trace. The caller is told who saved and when, and reloads.
 */
export async function saveFloorPlanMarkupAction(input: unknown): Promise<SaveMarkupResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { floorPlanId, markupId, name, scene, expectedUpdatedAt } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const plan = await loadPlan(supabase, floorPlanId)
  if ('error' in plan) return { error: plan.error }

  const gate = await requireEffectiveRole(supabase as any, plan.project_id, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: 'You do not have permission to save markup on this drawing.' }

  if (markupId && expectedUpdatedAt) {
    const { data: existing } = await (supabase as any)
      .schema('tenants')
      .from('floor_plan_markups')
      .select('updated_at, name')
      .eq('id', markupId)
      .maybeSingle()
    if (existing?.updated_at && new Date(existing.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      const when = new Date(existing.updated_at).toLocaleString('en-ZA', { hour12: false })
      return {
        error: `"${existing.name}" was saved by someone else at ${when}, after you opened it. Reload the drawing to see their version before saving yours.`,
        conflict: { updatedAt: existing.updated_at as string, name: existing.name as string },
      }
    }
  }

  // organisation_id and project_id are deliberately absent: the bind trigger
  // fills them from the drawing. file_path is stamped from the drawing as it
  // is RIGHT NOW, which is what makes the staleness check meaningful later.
  const row = {
    floor_plan_id: floorPlanId,
    name,
    scene,
    file_path: plan.file_path,
    source_revision_id: plan.source_revision_id,
    updated_by: user.id,
  }

  const q = (supabase as any).schema('tenants').from('floor_plan_markups')
  const res = markupId
    ? await q.update(row).eq('id', markupId).select('id, name, scene, file_path, source_revision_id, updated_at, updated_by').maybeSingle()
    : await q.insert({ ...row, created_by: user.id }).select('id, name, scene, file_path, source_revision_id, updated_at, updated_by').maybeSingle()

  if (res.error) {
    // 23505 is the (floor_plan_id, name) unique constraint. Say what to do
    // about it rather than surfacing a constraint name.
    if (res.error.code === '23505') {
      return { error: `This drawing already has a markup called "${name}". Pick another name, or open that one and save over it.` }
    }
    return { error: res.error.message }
  }
  if (!res.data) {
    // RLS returned zero rows rather than an error: the row moved, or the
    // caller's role no longer admits the write.
    return { error: 'Nothing was saved. The markup may have been deleted, or your access to this project may have changed.' }
  }

  revalidatePath(`/projects/${plan.project_id}/floor-plans/${floorPlanId}`)
  return { markup: toSavedMarkup(res.data, plan) }
}

export async function renameFloorPlanMarkupAction(
  input: { markupId: string; name: string },
): Promise<{ ok?: true; error?: string }> {
  const parsed = z
    .object({ markupId: z.string().uuid(), name: z.string().trim().min(1, 'Give this markup a name').max(MAX_NAME) })
    .safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await markupContext(supabase, parsed.data.markupId)
  if ('error' in ctx) return { error: ctx.error }

  const gate = await requireEffectiveRole(supabase as any, ctx.projectId, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: 'You do not have permission to change markup on this drawing.' }

  const { data, error } = await (supabase as any)
    .schema('tenants')
    .from('floor_plan_markups')
    .update({ name: parsed.data.name, updated_by: user.id })
    .eq('id', parsed.data.markupId)
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') return { error: `This drawing already has a markup called "${parsed.data.name}".` }
    return { error: error.message }
  }
  if (!data) return { error: 'Nothing was changed. The markup may have been deleted.' }

  revalidatePath(`/projects/${ctx.projectId}/floor-plans/${ctx.floorPlanId}`)
  return { ok: true }
}

export async function deleteFloorPlanMarkupAction(
  input: { markupId: string },
): Promise<{ ok?: true; error?: string }> {
  const parsed = z.object({ markupId: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await markupContext(supabase, parsed.data.markupId)
  if ('error' in ctx) return { error: ctx.error }

  const gate = await requireEffectiveRole(supabase as any, ctx.projectId, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: 'You do not have permission to delete markup on this drawing.' }

  const { data, error } = await (supabase as any)
    .schema('tenants')
    .from('floor_plan_markups')
    .delete()
    .eq('id', parsed.data.markupId)
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Nothing was deleted. The markup may already be gone.' }

  revalidatePath(`/projects/${ctx.projectId}/floor-plans/${ctx.floorPlanId}`)
  return { ok: true }
}

async function markupContext(
  supabase: any,
  markupId: string,
): Promise<{ projectId: string; floorPlanId: string } | { error: string }> {
  const { data, error } = await supabase
    .schema('tenants')
    .from('floor_plan_markups')
    .select('project_id, floor_plan_id')
    .eq('id', markupId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Markup not found' }
  return { projectId: data.project_id, floorPlanId: data.floor_plan_id }
}
