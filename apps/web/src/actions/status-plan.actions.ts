'use server'

/**
 * Tenant plans — the shape write path (spec 2026-10-09 §7, §9; 2026-10-12 §5).
 *
 * Every action:
 *  - returns { ok, error } and never throws for an expected refusal. Next.js
 *    replaces a thrown message with a generic sentence in production (PR #266).
 *  - gates on requireEffectiveRole(…, ORG_WRITE_ROLES) and reads `.ok`: the
 *    helper returns an OBJECT, so a truthiness check would gate nothing.
 *    The RESTRICTIVE per-verb policies of 00245 are the database backstop.
 *  - never sends organisation_id or created_by: the triggers bind them.
 *  - turns a Postgres refusal into a sentence (lib/status-plans/write-errors).
 *
 * A shape is created on a SHEET; the plan is read from the sheet on the server,
 * and the 00249 trigger refuses a sheet of another plan. Shape writes carry the
 * row's updated_at and are CONDITIONAL on it (`.eq('updated_at', expected)`), so
 * the stale check and the write are one statement. Zero rows back means
 * someone else moved or deleted the shape.
 *
 * Shape actions do NOT call revalidatePath: the canvas page folds each result
 * into its own state, and a revalidation would re-render the page under the
 * canvas and re-mint the sheet's signed URL (the router.refresh() trap).
 *
 * Plans are created by the first upload (tenant-plan-sheets.actions.ts); sheet
 * edits live there too. This file exports async functions only.
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { AREA_TYPES, DETECTED_TAG_MAX, SHAPE_KINDS, SHAPE_SOURCES, pointsError } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, roundPoints, shapePatchRow, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'That sheet no longer exists. Reload the page.'
const SHAPE_GONE = 'This shape has been deleted by someone else — reload to see the plan.'
const SHAPE_STALE = 'This shape was changed by someone else — reload to see it.'
const AREA_FLOOR_ONLY = 'Area types are for the floor plan only.'

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

type PlanCtx = { id: string; project_id: string; purpose: string }

async function planContext(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose').eq('id', planId).maybeSingle()
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

const createShapeSchema = z
  .object({
    sheetId: uuid,
    shape: z.enum(SHAPE_KINDS),
    points: z.array(z.number()),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
    /** Where the outline came from: a detected label's outline is 'detected'. */
    source: z.enum(SHAPE_SOURCES).optional(),
    /** The label text a detected outline was read from (status_plan_shapes_tag_length). */
    detectedTag: z.string().trim().max(DETECTED_TAG_MAX).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })

export async function createStatusPlanShapeAction(input: z.input<typeof createShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = createShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { sheetId, shape, nodeId, areaType, source, detectedTag } = parsed.data
  const points = roundPoints(parsed.data.points)
  const bad = pointsError(shape, points)
  if (bad) return fail(bad)

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
    .select('id, status_plan_id').eq('id', sheetId).maybeSingle()
  if (!sheet) return fail(SHEET_GONE)
  const plan = await planContext(supabase, sheet.status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)
  if (areaType && plan.purpose !== 'tenant_layout') return fail(AREA_FLOOR_ONLY)

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .insert({ status_plan_id: plan.id, sheet_id: sheetId, shape, points, node_id: nodeId ?? null, area_type: areaType ?? null, source: source ?? 'manual', detected_tag: detectedTag || null })
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
  if (areaType && ctx.plan.purpose !== 'tenant_layout') return fail(AREA_FLOOR_ONLY)

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
