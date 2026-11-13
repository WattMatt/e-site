'use server'

/**
 * Link the shape that contains a detected SHOP label to its tenant, and undo
 * that (floor-plan label detection, spec 2026-10-21).
 *
 * Same rules as status-plan-realign.actions.ts: { ok, error } and never a
 * throw; the requireEffectiveRole(…, ORG_WRITE_ROLES) gate read through `.ok`
 * on the project of the SHEET's plan; the RESTRICTIVE write policies of 00245
 * are the database backstop; no revalidatePath (the panel folds the result in).
 * Only `node_id` and `detected_tag` are written: a link never moves an outline
 * and never changes how the shape was made (`source` stays as it was).
 *
 * ALL OR NOTHING, WITHOUT A TRANSACTION (no migration is allowed for this
 * feature), by compensation:
 *  1. every shape is read first; any that is gone, on another sheet, an area,
 *     already linked (link only) or whose updated_at is not the one the browser
 *     planned against refuses the whole request before the first write;
 *  2. each write is conditional (`.eq('updated_at', expected)`), so a change
 *     that lands between the read and the write answers zero rows;
 *  3. on the first zero or error, every shape this request already changed is
 *     put back to what the read saw, each conditional on the updated_at its
 *     write returned. A put-back beaten by another writer is COUNTED and its
 *     shape id reported, never hidden. This is compensation, not isolation.
 * The database allows one shape per (plan, board) (partial unique index); a
 * collision on the way answers 23505 and is reported with the label's tag.
 *
 * Only async functions are exported from this file ('use server').
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { DETECTED_TAG_MAX, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_LINKS = 500
/** Ids per `.in()` read: keeps the request URL short. */
const READ_CHUNK = 100
/** Conditional updates in flight at once. */
const WRITE_CHUNK = 10

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'That sheet no longer exists. Reload the page.'
const NOT_FLOOR_PLAN = 'This sheet is not a floor plan.'
const WRONG_SHEET = 'One of these shapes is not on this sheet. Reload the page.'

type Fail = { ok: false; error: string; conflict?: boolean }

const uuid = z.string().uuid()

const linkInput = z.object({
  sheetId: uuid,
  links: z
    .array(z.object({
      shapeId: uuid,
      nodeId: uuid,
      detectedTag: z.string().trim().max(DETECTED_TAG_MAX).nullable(),
      expectedUpdatedAt: z.string().min(1),
    }))
    .min(1)
    .max(MAX_LINKS),
})

const unlinkInput = z.object({
  sheetId: uuid,
  unlinks: z
    .array(z.object({ shapeId: uuid, expectedUpdatedAt: z.string().min(1) }))
    .min(1)
    .max(MAX_LINKS),
})

interface Stored {
  id: string
  sheet_id: string
  node_id: string | null
  area_type: string | null
  detected_tag: string | null
  updated_at: string
}

interface Change {
  shapeId: string
  expectedUpdatedAt: string
  /** The columns this request writes. */
  patch: { node_id: string | null; detected_tag: string | null }
  /** The tag named in the sentence when this write collides with another shape. */
  tag: string | null
}

interface Verb {
  /** 'linked' | 'unlinked', for "Nothing was …". */
  done: string
  /** A shape that is already linked is not a candidate to link. */
  mustBeFree: boolean
  /** An area is not a shop: linking one would break the shop-or-area rule. */
  refuseAreas: boolean
}

const UNKNOWN_SHOP = 'That shop'

async function applyChanges(sheetId: string, changes: Change[], verb: Verb): Promise<ActionResult<CanvasShape[]>> {
  const nothing = `Nothing was ${verb.done}.`
  const changed = (n: number, tail: string): Fail => ({
    ok: false,
    error: `Someone changed ${n} of these shapes — reload and try again. ${tail}`,
    conflict: true,
  })

  try {
    const supabase: any = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: SIGNED_OUT }

    const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
      .select('id, status_plan_id').eq('id', sheetId).maybeSingle()
    if (!sheet) return { ok: false, error: SHEET_GONE }
    const { data: plan } = await supabase.schema('tenants').from('status_plans')
      .select('id, project_id, purpose').eq('id', sheet.status_plan_id).maybeSingle()
    if (!plan) return { ok: false, error: PLAN_GONE }
    if (plan.purpose !== 'tenant_layout') return { ok: false, error: NOT_FLOOR_PLAN }
    const gate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
    if (!gate.ok) return { ok: false, error: NOT_ALLOWED }

    // 1. Read every shape; refuse the lot on any mismatch.
    const stored = new Map<string, Stored>()
    for (let i = 0; i < changes.length; i += READ_CHUNK) {
      const ids = changes.slice(i, i + READ_CHUNK).map((c) => c.shapeId)
      const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
        .select('id, sheet_id, node_id, area_type, detected_tag, updated_at').in('id', ids)
      if (error) return { ok: false, error: statusPlanWriteError(error, 'shape') }
      for (const r of (data ?? []) as Stored[]) stored.set(r.id, r)
    }
    for (const c of changes) {
      const s = stored.get(c.shapeId)
      if (s && s.sheet_id !== sheetId) return { ok: false, error: WRONG_SHEET }
    }
    if (verb.refuseAreas && changes.some((c) => stored.get(c.shapeId)?.area_type)) {
      return { ok: false, error: `An area cannot be linked to a shop. ${nothing}` }
    }
    const stale = changes.filter((c) => {
      const s = stored.get(c.shapeId)
      return !s || s.updated_at !== c.expectedUpdatedAt || (verb.mustBeFree && s.node_id !== null)
    }).length
    if (stale > 0) return changed(stale, nothing)

    // 2. Conditional writes; 3. put back on the first refusal.
    const update = (id: string, patch: Change['patch'], expected: string) =>
      supabase.schema('tenants').from('status_plan_shapes')
        .update(patch)
        .eq('id', id)
        .eq('updated_at', expected)
        .select(SHAPE_COLUMNS)
        .maybeSingle()

    const done: Array<{ id: string; before: Change['patch']; row: StatusPlanShapeRow }> = []
    let refused = 0
    let failure: { error: { code?: string; message?: string }; tag: string | null } | null = null

    for (let i = 0; i < changes.length && refused === 0 && !failure; i += WRITE_CHUNK) {
      const chunk = changes.slice(i, i + WRITE_CHUNK)
      const answers = await Promise.all(chunk.map((c) => update(c.shapeId, c.patch, c.expectedUpdatedAt)))
      answers.forEach((a: { data: StatusPlanShapeRow | null; error: any }, k: number) => {
        const c = chunk[k]!
        if (a.error) failure ??= { error: a.error, tag: c.tag }
        else if (!a.data) refused++
        else {
          const before = stored.get(c.shapeId)!
          done.push({ id: c.shapeId, before: { node_id: before.node_id, detected_tag: before.detected_tag }, row: a.data })
        }
      })
    }
    if (refused === 0 && !failure) return { ok: true, data: done.map((d) => toCanvasShape(d.row)) }

    const stuck: string[] = []
    for (let i = 0; i < done.length; i += WRITE_CHUNK) {
      const chunk = done.slice(i, i + WRITE_CHUNK)
      const answers = await Promise.all(chunk.map((d) => update(d.id, d.before, d.row.updated_at)))
      answers.forEach((a: { data: unknown; error: unknown }, k: number) => {
        if (a.error || !a.data) stuck.push(chunk[k]!.id)
      })
    }
    const tail = stuck.length === 0 ? nothing : `${stuck.length} could not be put back: ${stuck.join(', ')}.`
    if (refused > 0) return changed(refused, tail)

    const f = failure!
    const collided = f.error.code === '23505'
    const sentence = collided
      ? `${f.tag ? `SHOP ${f.tag}` : UNKNOWN_SHOP} is already linked to another shape on this plan.`
      : statusPlanWriteError(f.error, 'shape')
    return { ok: false, error: `${sentence} ${tail}`, ...(collided || stuck.length > 0 ? { conflict: true } : {}) }
  } catch {
    return { ok: false, error: 'The server did not answer. Reload to see where the shops are linked.' }
  }
}

export async function linkShapesByLabelAction(
  input: z.input<typeof linkInput>,
): Promise<ActionResult<CanvasShape[]>> {
  const parsed = linkInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'These links could not be read. Run the detection again.' }
  const { sheetId, links } = parsed.data
  if (new Set(links.map((l) => l.shapeId)).size !== links.length) {
    return { ok: false, error: 'The same shape is listed twice. Run the detection again.' }
  }
  if (new Set(links.map((l) => l.nodeId)).size !== links.length) {
    return { ok: false, error: 'The same shop is listed twice. Run the detection again.' }
  }
  return applyChanges(
    sheetId,
    links.map((l) => ({
      shapeId: l.shapeId,
      expectedUpdatedAt: l.expectedUpdatedAt,
      patch: { node_id: l.nodeId, detected_tag: l.detectedTag || null },
      tag: l.detectedTag || null,
    })),
    { done: 'linked', mustBeFree: true, refuseAreas: true },
  )
}

export async function unlinkShapesAction(
  input: z.input<typeof unlinkInput>,
): Promise<ActionResult<CanvasShape[]>> {
  const parsed = unlinkInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'These shapes could not be read. Reload and try again.' }
  const { sheetId, unlinks } = parsed.data
  if (new Set(unlinks.map((u) => u.shapeId)).size !== unlinks.length) {
    return { ok: false, error: 'The same shape is listed twice. Reload and try again.' }
  }
  return applyChanges(
    sheetId,
    unlinks.map((u) => ({
      shapeId: u.shapeId,
      expectedUpdatedAt: u.expectedUpdatedAt,
      patch: { node_id: null, detected_tag: null },
      tag: null,
    })),
    { done: 'unlinked', mustBeFree: false, refuseAreas: false },
  )
}
