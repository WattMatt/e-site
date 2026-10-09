'use server'

/**
 * Status plans — the write path (spec 2026-10-09 §7, §9; slice 2).
 *
 * Every action:
 *  - returns { ok, error } and never throws for an expected refusal. Next.js
 *    replaces a thrown message with a generic sentence in production (PR #266).
 *  - gates on requireEffectiveRole(…, ORG_WRITE_ROLES) and reads `.ok`: the
 *    helper returns an OBJECT, so a truthiness check would gate nothing.
 *    The RESTRICTIVE per-verb policies of 00245 are the database backstop.
 *  - never sends organisation_id, created_by or source_file_path on insert:
 *    the slice-1 triggers bind them from the drawing and the session.
 *  - turns a Postgres refusal into a sentence (lib/status-plans/write-errors).
 *
 * Shape writes carry the row's updated_at and are CONDITIONAL on it
 * (`.eq('updated_at', expected)`), so the stale check and the write are one
 * statement. Zero rows back means someone else moved or deleted the shape.
 *
 * Shape actions do NOT call revalidatePath: the canvas page folds each result
 * into its own state, and a revalidation would re-render the page under the
 * canvas and re-mint the drawing's signed URL (the router.refresh() trap).
 *
 * This file exports async functions only ('use server'); types live in
 * lib/status-plans/types.ts.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { AREA_TYPES, SHAPE_KINDS, STATUS_PLAN_PURPOSES, pointsError } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, roundPoints, shapePatchRow, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import { isRenderableDrawing, statusPlansHref } from '@/lib/status-plans/plan-urls'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()
const planName = z.string().trim().min(1, 'Give the plan a name.').max(120, 'Keep the plan name under 120 characters.')

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change status plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Go back to the list and reload.'
const SHAPE_GONE = 'This shape has been deleted by someone else — reload to see the plan.'
const SHAPE_STALE = 'This shape was changed by someone else — reload to see it.'

type Fail = { ok: false; error: string; conflict?: boolean }
const fail = (error: string, conflict?: boolean): Fail => (conflict ? { ok: false, error, conflict } : { ok: false, error })
const invalid = (e: z.ZodError): Fail => fail(e.issues[0]?.message ?? 'That request was not valid.')

async function signedIn(): Promise<any | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

async function mayWrite(supabase: any, projectId: string): Promise<boolean> {
  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  return gate.ok
}

type PlanCtx = { id: string; project_id: string; purpose: string; floor_plan_id: string }

async function planContext(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose, floor_plan_id').eq('id', planId).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

type ShapeCtx = { shape: { id: string; status_plan_id: string; shape: 'polygon' | 'rect' }; plan: PlanCtx }

async function shapeContext(supabase: any, shapeId: string): Promise<ShapeCtx | Fail> {
  const { data: shape } = await supabase.schema('tenants').from('status_plan_shapes')
    .select('id, status_plan_id, shape').eq('id', shapeId).maybeSingle()
  if (!shape) return fail(SHAPE_GONE, true)
  const plan = await planContext(supabase, shape.status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  return { shape, plan }
}

/** A conditional write answered zero rows: moved on, or deleted? */
async function staleOrGone(supabase: any, shapeId: string): Promise<Fail> {
  const { data } = await supabase.schema('tenants').from('status_plan_shapes').select('id').eq('id', shapeId).maybeSingle()
  return data ? fail(SHAPE_STALE, true) : fail(SHAPE_GONE, true)
}

// ── Plans ──────────────────────────────────────────────────────────────────

const createPlanSchema = z.object({
  projectId: uuid,
  floorPlanId: uuid,
  pageIndex: z.number().int().min(1, 'Pages are numbered from 1.').max(500, 'That page number is too high.'),
  purpose: z.enum(STATUS_PLAN_PURPOSES),
  name: planName,
})

export async function createStatusPlanAction(input: z.input<typeof createPlanSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = createPlanSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const { projectId, floorPlanId, pageIndex, purpose, name } = parsed.data
  if (!(await mayWrite(supabase, projectId))) return fail(NOT_ALLOWED)

  const { data: drawing } = await supabase.schema('tenants').from('floor_plans')
    .select('id, project_id, file_path').eq('id', floorPlanId).maybeSingle()
  if (!drawing || drawing.project_id !== projectId) return fail('That drawing is not on this project.')
  if (!isRenderableDrawing(String(drawing.file_path ?? ''))) {
    return fail('A status plan needs a PDF or image drawing (PDF, PNG, JPG, WebP or SVG).')
  }

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .insert({ project_id: projectId, floor_plan_id: floorPlanId, page_index: pageIndex, purpose, name })
    .select('id').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(NOT_ALLOWED)
  revalidatePath(statusPlansHref(projectId))
  return { ok: true, data: { id: data.id as string } }
}

export async function renameStatusPlanAction(input: { planId: string; name: string }): Promise<ActionResult<{ name: string; updatedAt: string }>> {
  const parsed = z.object({ planId: uuid, name: planName }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .update({ name: parsed.data.name }).eq('id', plan.id).select('name, updated_at').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  revalidatePath(statusPlansHref(plan.project_id))
  return { ok: true, data: { name: data.name as string, updatedAt: data.updated_at as string } }
}

export async function deleteStatusPlanAction(input: { planId: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ planId: uuid }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  // Shapes go with the plan (ON DELETE CASCADE).
  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .delete().eq('id', plan.id).select('id').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  revalidatePath(statusPlansHref(plan.project_id))
  return { ok: true, data: { id: plan.id } }
}

/**
 * "The drawing changed; I have checked the shapes": move the plan's anchor to
 * the drawing's CURRENT file. The file is read here, never taken from the
 * client, and the slice-1 trigger refuses any other value.
 */
export async function reanchorStatusPlanAction(input: { planId: string }): Promise<ActionResult<{ sourceFilePath: string }>> {
  const parsed = z.object({ planId: uuid }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const { data: drawing } = await supabase.schema('tenants').from('floor_plans')
    .select('file_path').eq('id', plan.floor_plan_id).maybeSingle()
  if (!drawing?.file_path) return fail('That drawing no longer exists, or you cannot see it.')

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .update({ source_file_path: drawing.file_path }).eq('id', plan.id).select('source_file_path').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  return { ok: true, data: { sourceFilePath: data.source_file_path as string } }
}

// ── Shapes ─────────────────────────────────────────────────────────────────

const createShapeSchema = z
  .object({
    planId: uuid,
    shape: z.enum(SHAPE_KINDS),
    points: z.array(z.number()),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })

export async function createStatusPlanShapeAction(input: z.input<typeof createShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = createShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { planId, shape, nodeId, areaType } = parsed.data
  const points = roundPoints(parsed.data.points)
  const bad = pointsError(shape, points)
  if (bad) return fail(bad)

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)
  if (areaType && plan.purpose !== 'tenant_layout') return fail('Area types are for tenant layout plans only.')

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .insert({ status_plan_id: planId, shape, points, node_id: nodeId ?? null, area_type: areaType ?? null, source: 'manual' })
    .select(SHAPE_COLUMNS).maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return fail(NOT_ALLOWED)
  return { ok: true, data: toCanvasShape(data) }
}

const updateShapeSchema = z
  .object({
    shapeId: uuid,
    expectedUpdatedAt: z.string().min(1),
    points: z.array(z.number()).optional(),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })
  .refine((v) => v.points !== undefined || v.nodeId !== undefined || v.areaType !== undefined, { message: 'Nothing to change.' })

export async function updateStatusPlanShapeAction(input: z.input<typeof updateShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = updateShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { shapeId, expectedUpdatedAt, nodeId, areaType } = parsed.data

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await shapeContext(supabase, shapeId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  let points: number[] | undefined
  if (parsed.data.points !== undefined) {
    points = roundPoints(parsed.data.points)
    const bad = pointsError(ctx.shape.shape, points)
    if (bad) return fail(bad)
  }
  if (areaType && ctx.plan.purpose !== 'tenant_layout') return fail('Area types are for tenant layout plans only.')

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .update(shapePatchRow({ points, nodeId, areaType }))
    .eq('id', shapeId)
    .eq('updated_at', expectedUpdatedAt)
    .select(SHAPE_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return staleOrGone(supabase, shapeId)
  return { ok: true, data: toCanvasShape(data) }
}

export async function deleteStatusPlanShapeAction(input: { shapeId: string; expectedUpdatedAt: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ shapeId: uuid, expectedUpdatedAt: z.string().min(1) }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await shapeContext(supabase, parsed.data.shapeId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .delete()
    .eq('id', parsed.data.shapeId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select('id')
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return staleOrGone(supabase, parsed.data.shapeId)
  return { ok: true, data: { id: parsed.data.shapeId } }
}
