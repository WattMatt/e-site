'use server'

/**
 * Re-align line-diagram blocks onto their tables' drawn borders
 * (owner ask 2026-10-14; the plan comes from @esite/shared realign-shapes.ts).
 *
 * Same rules as status-plan.actions.ts: { ok, error } and never a throw; the
 * requireEffectiveRole(…, ORG_WRITE_ROLES) gate read through `.ok`, on the
 * project of the SHEET's plan; the RESTRICTIVE UPDATE policy of 00245 is the
 * database backstop; no revalidatePath (the workspace folds the result in).
 * Only `points` is written — a re-align never touches a board link.
 *
 * ALL OR NOTHING, WITHOUT A TRANSACTION. No migration is allowed for this
 * feature, so there is no RPC to wrap the moves in one statement. Instead:
 *  1. every shape is read first; any whose updated_at is not the one the
 *     browser planned against (or that is gone, on another sheet, or not a
 *     rectangle) refuses the whole request before the first write;
 *  2. each move is a conditional update (`.eq('updated_at', expected)`), so a
 *     change that lands between the read and the write answers zero rows;
 *  3. on the first such zero, every block this request already moved is put
 *     back, each conditional on the updated_at its move returned. A put-back
 *     that is itself beaten by another writer is COUNTED and reported — never
 *     hidden. This is compensation, not isolation: for the moments between a
 *     move and its put-back, other readers can see the moved block.
 * Undo is this same call with the previous points and the new updated_at.
 *
 * Only async functions are exported from this file ('use server').
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { pointsError, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, roundPoints, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_MOVES = 500
/** Ids per `.in()` read: keeps the request URL short. */
const READ_CHUNK = 100
/** Conditional updates in flight at once. */
const WRITE_CHUNK = 10

const UNREADABLE = 'These blocks could not be read. Run the re-align again.'
const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'That sheet no longer exists. Reload the page.'

type Fail = { ok: false; error: string; conflict?: boolean }

const changed = (n: number, tail: string): Fail => ({
  ok: false,
  error: `Someone changed ${n} of these blocks — reload and try again. ${tail}`,
  conflict: true,
})
const NOTHING_MOVED = 'Nothing was moved.'

const inputSchema = z.object({
  sheetId: z.string().uuid(),
  moves: z
    .array(z.object({
      shapeId: z.string().uuid(),
      expectedUpdatedAt: z.string().min(1),
      points: z.array(z.number().finite()).length(8),
    }))
    .min(1)
    .max(MAX_MOVES),
})

interface Stored { id: string; sheet_id: string; shape: string; points: number[]; updated_at: string }

export async function realignShapesAction(
  input: z.input<typeof inputSchema>,
): Promise<ActionResult<CanvasShape[]>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: UNREADABLE }
  const { sheetId } = parsed.data
  const moves = parsed.data.moves.map((m) => ({ ...m, points: roundPoints(m.points) }))
  if (new Set(moves.map((m) => m.shapeId)).size !== moves.length) {
    return { ok: false, error: 'The same block is listed twice. Run the re-align again.' }
  }
  for (const m of moves) {
    const bad = pointsError('rect', m.points)
    if (bad) return { ok: false, error: `${bad} ${NOTHING_MOVED}` }
  }

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
    if (plan.purpose !== 'distribution_schematic') {
      return { ok: false, error: 'Re-aligning blocks is only for the line diagram.' }
    }
    const gate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
    if (!gate.ok) return { ok: false, error: NOT_ALLOWED }

    // 1. Read every shape; refuse the lot on any mismatch.
    const stored = new Map<string, Stored>()
    for (let i = 0; i < moves.length; i += READ_CHUNK) {
      const ids = moves.slice(i, i + READ_CHUNK).map((m) => m.shapeId)
      const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
        .select('id, sheet_id, shape, points, updated_at').in('id', ids)
      if (error) return { ok: false, error: statusPlanWriteError(error, 'shape') }
      for (const r of (data ?? []) as Stored[]) stored.set(r.id, r)
    }
    for (const m of moves) {
      const s = stored.get(m.shapeId)
      if (s && s.sheet_id !== sheetId) return { ok: false, error: 'One of these blocks is not on this sheet. Reload the page.' }
      if (s && s.shape !== 'rect') return { ok: false, error: `Only rectangles can be re-aligned. ${NOTHING_MOVED}` }
    }
    const stale = moves.filter((m) => stored.get(m.shapeId)?.updated_at !== m.expectedUpdatedAt).length
    if (stale > 0) return changed(stale, NOTHING_MOVED)

    // 2. Conditional moves; 3. put back on the first refusal.
    const done: Array<{ id: string; before: number[]; row: StatusPlanShapeRow }> = []
    let refused = 0
    let failure: string | null = null
    const update = (id: string, points: number[], expected: string) =>
      supabase.schema('tenants').from('status_plan_shapes')
        .update({ points })
        .eq('id', id)
        .eq('updated_at', expected)
        .select(SHAPE_COLUMNS)
        .maybeSingle()

    for (let i = 0; i < moves.length && refused === 0 && !failure; i += WRITE_CHUNK) {
      const chunk = moves.slice(i, i + WRITE_CHUNK)
      const answers = await Promise.all(chunk.map((m) => update(m.shapeId, m.points, m.expectedUpdatedAt)))
      answers.forEach((a: { data: StatusPlanShapeRow | null; error: any }, k: number) => {
        const m = chunk[k]!
        if (a.error) failure ??= statusPlanWriteError(a.error, 'shape')
        else if (!a.data) refused++
        else done.push({ id: m.shapeId, before: roundPoints(stored.get(m.shapeId)!.points), row: a.data })
      })
    }
    if (refused === 0 && !failure) return { ok: true, data: done.map((d) => toCanvasShape(d.row)) }

    let stuck = 0
    for (let i = 0; i < done.length; i += WRITE_CHUNK) {
      const chunk = done.slice(i, i + WRITE_CHUNK)
      const answers = await Promise.all(chunk.map((d) => update(d.id, d.before, d.row.updated_at)))
      for (const a of answers as Array<{ data: unknown; error: unknown }>) if (a.error || !a.data) stuck++
    }
    const tail = stuck === 0
      ? NOTHING_MOVED
      : `${stuck} ${stuck === 1 ? 'block that had already moved' : 'blocks that had already moved'} could not be put back; reload to see the plan.`
    if (refused > 0) return changed(refused, tail)
    return { ok: false, error: stuck === 0 ? `${failure} ${NOTHING_MOVED}` : `${failure} ${tail}`, conflict: stuck > 0 }
  } catch {
    return { ok: false, error: 'The server did not answer. Reload to see where the blocks are.' }
  }
}
