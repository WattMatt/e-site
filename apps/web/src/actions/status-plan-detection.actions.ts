'use server'

/**
 * Accept detected DB blocks onto a distribution-schematic status plan
 * (spec 2026-10-09 §5, slice 3).
 *
 * Same rules as status-plan.actions.ts:
 *  - returns { ok, error } and never throws for an expected refusal (Next.js
 *    redacts thrown server-action messages in production);
 *  - gates on requireEffectiveRole(…, ORG_WRITE_ROLES) and reads `.ok`;
 *    the RESTRICTIVE INSERT policy on status_plan_shapes (00245) is the
 *    database backstop;
 *  - never sends organisation_id, project_id or created_by (triggers bind them);
 *  - no revalidatePath: the workspace folds the returned shapes into its state.
 *
 * Every block is checked with pointsError BEFORE any database call, so a
 * degenerate detected box (zero area) is refused with a sentence instead of
 * reaching the CHECK. The insert is one statement, so it is all-or-nothing.
 *
 * Only async functions are exported from this file ('use server').
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { DETECTED_TAG_MAX, pointsError, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import { acceptErrorSentence } from '@/lib/status-plans/detection-errors'
import { SHAPE_COLUMNS, roundPoints, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_BATCH = 500
const UNREADABLE = 'These blocks could not be read. Run detection again.'
const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change status plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Go back to the list and reload.'

const blockSchema = z.object({
  points: z.array(z.number().finite()).length(8),
  nodeId: z.string().uuid().nullable(),
  detectedTag: z.string().trim().max(DETECTED_TAG_MAX).nullable(),
})
const inputSchema = z.object({
  planId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1).max(MAX_BATCH),
})

export async function acceptDetectedBlocksAction(
  input: z.input<typeof inputSchema>,
): Promise<ActionResult<CanvasShape[]>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: UNREADABLE }
  const blocks = parsed.data.blocks.map((b) => ({ ...b, points: roundPoints(b.points), detectedTag: b.detectedTag || null }))
  for (const b of blocks) {
    const bad = pointsError('rect', b.points)
    if (bad) return { ok: false, error: `${b.detectedTag ?? 'A block'}: ${bad} Nothing was added.` }
  }
  const nodeIds = blocks.flatMap((b) => (b.nodeId ? [b.nodeId] : []))
  if (new Set(nodeIds).size !== nodeIds.length) {
    return { ok: false, error: 'Two of these blocks are linked to the same board. A board can appear once on a plan.' }
  }

  const supabase: any = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: SIGNED_OUT }

  const { data: plan } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose').eq('id', parsed.data.planId).maybeSingle()
  if (!plan) return { ok: false, error: PLAN_GONE }
  if (plan.purpose !== 'distribution_schematic') {
    return { ok: false, error: 'Block detection is only for distribution schematic plans.' }
  }

  const gate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { ok: false, error: NOT_ALLOWED }

  const rows = blocks.map((b) => ({
    status_plan_id: parsed.data.planId,
    shape: 'rect' as const,
    points: b.points,
    node_id: b.nodeId,
    area_type: null,
    detected_tag: b.detectedTag,
    source: 'detected' as const,
  }))
  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .insert(rows).select(SHAPE_COLUMNS)
  if (error) return { ok: false, error: acceptErrorSentence(error) }
  const saved = (data ?? []) as StatusPlanShapeRow[]
  if (saved.length !== rows.length) {
    return { ok: false, error: 'The blocks may not all have been saved. Reload the page to see the plan.' }
  }
  return { ok: true, data: saved.map(toCanvasShape) }
}
