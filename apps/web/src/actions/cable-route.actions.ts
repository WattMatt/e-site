'use server'

/**
 * Cable route measurement — trace a run on a calibrated drawing, then assign
 * the length to the schedule.
 *
 * Two deliberate separations run through this file.
 *
 * 1. MEASURING IS NOT ASSIGNING. `saveSupplyRouteAction` records a route and
 *    touches no cable. `applyRouteToScheduleAction` is what writes
 *    `measured_length_m`. KINGSWALK already holds 162 hand-entered lengths, and
 *    a traced route there is a second opinion; a second opinion that silently
 *    replaces the first is worse than no tool at all. The apply step reports the
 *    existing value and refuses to overwrite it without `confirmOverwrite`.
 *
 * 2. THE CLIENT SENDS GEOMETRY, THE SERVER DECIDES LENGTH. The browser sends
 *    pixel points and the drawing it traced them on. It does NOT send metres,
 *    and its calibration figure is ignored: the server reads
 *    `tenants.floor_plans.pixels_per_meter` itself and computes the length from
 *    that. A length that a client could assert is a length anyone with the page
 *    open could assert, and this one ends up on an issued schedule.
 *
 * Role gating mirrors `cable-length.actions.ts` exactly — the same coarse
 * `requireRoleForRevision` gate plus the same `ROLE_CAPS[role].editMeasured`
 * capability — because this writes the same column by a different route. If one
 * of the two ever grants more than the other, the tighter one is decorative.
 */

import { revalidatePath } from 'next/cache'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { lookupCableRole, ROLE_CAPS } from '@/lib/cable-schedule/roles'
import { requireRoleForRevision, ROLES_ENGINEER_AND_FIELD } from '@/lib/cable-schedule/require-role'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  ORG_WRITE_ROLES,
  segmentLengthM,
  routeTotalM,
  validateRoutePoints,
  derivePixelsPerMeter,
  sheetLegendRows,
  polylineLengthPx,
  roundMetres,
} from '@esite/shared'

const uuid = z.string().uuid()

/** A polyline traced on one sheet. Metres are absent on purpose — see the header. */
const segmentSchema = z.object({
  floorPlanId: uuid,
  pageIndex: z.number().int().min(1).default(1),
  /** Flat [x1,y1,x2,y2,…] in the drawing's backing-canvas pixel space. */
  points: z.array(z.number()).min(4).max(2000),
})

const saveRouteSchema = z.object({
  supplyId: uuid,
  riseM: z.number().nonnegative().max(1000).default(0),
  dropM: z.number().nonnegative().max(1000).default(0),
  notes: z.string().max(2000).optional().nullable(),
  /** Ordered along the run. Replacing the list replaces the whole route. */
  segments: z.array(segmentSchema).max(50),
  /**
   * The route's `updated_at` the caller last saw. When supplied and the stored
   * value differs, the save is refused: two people editing the same run must
   * not silently overwrite each other (last write wins was the first cut).
   */
  expectedUpdatedAt: z.string().optional().nullable(),
})

type SupplyCtx = {
  revisionId: string
  projectId: string
  organisationId: string
}

/**
 * Resolve a supply to its revision, project and org, and refuse anything that
 * is not a DRAFT. ISSUED revisions are frozen by database trigger as well
 * (00168 §3b covers `supply_routes` via its `revision_id`); this is the
 * friendly half of the same rule, so the user gets a sentence instead of a
 * constraint violation.
 */
async function loadSupplyContext(
  supabase: any,
  supplyId: string,
): Promise<SupplyCtx | { error: string }> {
  const { data: row, error } = await supabase
    .schema('cable_schedule')
    .from('supplies')
    .select('id, revision_id, organisation_id, revision:revisions!revision_id(id, status, project_id)')
    .eq('id', supplyId)
    .single()
  if (error || !row) return { error: 'Cable run not found' }
  const r = row as any
  if (r.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to measure runs.' }
  }
  return {
    revisionId: r.revision_id as string,
    projectId: r.revision.project_id as string,
    organisationId: r.organisation_id as string,
  }
}

/** The coarse + fine role gate that `cable-length.actions.ts` applies. */
async function gate(supabase: any, userId: string, ctx: SupplyCtx): Promise<string | null> {
  const roleCheck = await requireRoleForRevision(supabase, ctx.revisionId, ROLES_ENGINEER_AND_FIELD)
  if (!roleCheck.ok) return roleCheck.error
  const role = await lookupCableRole(supabase, userId, ctx.organisationId)
  if (!ROLE_CAPS[role].editMeasured) {
    return `Your role (${role}) cannot measure cable runs.`
  }
  return null
}

/** A segment as persisted — what the sheet draws and edits. */
export interface SavedSegment {
  id: string
  seq: number
  floorPlanId: string
  floorPlanName: string
  pageIndex: number
  points: number[]
  pixelsPerMeter: number
  lengthM: number
}

export interface SaveRouteResult {
  ok?: true
  error?: string
  /** Metres the server computed. The caller displays this, never its own figure. */
  tracedM?: number
  totalM?: number
  /** The route's segments as now stored, ids included, in path order. */
  segments?: SavedSegment[]
  /** The route's updated_at after this save — send it back as expectedUpdatedAt. */
  updatedAt?: string
  /** Set when the save was refused because someone else saved first. */
  conflict?: { updatedAt: string }
  /** Drawings that had no calibration — the caller must calibrate these first. */
  uncalibratedPlanIds?: string[]
}

/**
 * Record (or replace) a run's route.
 *
 * Segments are replaced wholesale rather than patched. A route is a single
 * traced idea and a partial update would leave a run whose sheets no longer
 * join up, which is harder to spot than a route that is simply wrong.
 */
export async function saveSupplyRouteAction(
  input: z.infer<typeof saveRouteSchema>,
): Promise<SaveRouteResult> {
  const parsed = saveRouteSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { supplyId, riseM, dropM, notes, segments, expectedUpdatedAt } = parsed.data

  for (const s of segments) {
    const err = validateRoutePoints(s.points)
    if (err) return { error: err }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadSupplyContext(supabase, supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const denied = await gate(supabase, user.id, ctx)
  if (denied) return { error: denied }

  // Calibration is read from the drawings, never taken from the caller.
  // Concurrency: refuse to overwrite a route someone else saved since the
  // caller loaded it. The token is the route's updated_at, trigger-maintained.
  if (expectedUpdatedAt) {
    const { data: existing } = await (supabase as any)
      .schema('cable_schedule')
      .from('supply_routes')
      .select('id, updated_at')
      .eq('supply_id', supplyId)
      .maybeSingle()
    if (existing?.updated_at && new Date(existing.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      const when = new Date(existing.updated_at).toLocaleString('en-ZA', { hour12: false })
      return {
        error: `This route was saved by someone else at ${when}, after you loaded it. Reload the drawing to see the latest before changing it.`,
        conflict: { updatedAt: existing.updated_at as string },
      }
    }
  }

  // The scale for each (drawing, page) a segment sits on. A page other than 1
  // needs its own scale (00199); page 1 falls back to the drawing's. The
  // caller's idea of the scale is never consulted.
  const planIds = [...new Set(segments.map((s) => s.floorPlanId))]
  const { data: plans, error: planErr } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, project_id, pixels_per_meter')
    .in('id', planIds)
  if (planErr) return { error: planErr.message }
  const planById = new Map<string, { name: string; project_id: string; ppm: number | null }>(
    ((plans ?? []) as any[]).map((p) => [p.id, { name: p.name ?? 'Drawing', project_id: p.project_id, ppm: p.pixels_per_meter == null ? null : Number(p.pixels_per_meter) }]),
  )
  const { data: pageScaleRows } = await (supabase as any)
    .schema('tenants')
    .from('floor_plan_page_scales')
    .select('floor_plan_id, page_index, pixels_per_meter')
    .in('floor_plan_id', planIds)
  const pageScale = new Map<string, number>(
    ((pageScaleRows ?? []) as any[]).map((r) => [`${r.floor_plan_id}#${r.page_index}`, Number(r.pixels_per_meter)]),
  )
  const scaleFor = (planId: string, pageIndex: number): number | null =>
    pageScale.get(`${planId}#${pageIndex}`) ?? (pageIndex === 1 ? (planById.get(planId)?.ppm ?? null) : null)

  for (const s of segments) {
    const plan = planById.get(s.floorPlanId)
    if (!plan) return { error: 'One of the drawings on this route was not found.' }
    if (plan.project_id !== ctx.projectId) return { error: 'A drawing on this route is not part of this project.' }
  }
  const uncalibrated = segments
    .filter((s) => !(scaleFor(s.floorPlanId, s.pageIndex)! > 0))
    .map((s) => ({ planId: s.floorPlanId, page: s.pageIndex }))
  if (uncalibrated.length > 0) {
    const first = uncalibrated[0]
    const name = planById.get(first.planId)?.name ?? 'the drawing'
    return {
      error: first.page > 1
        ? `Page ${first.page} of ${name} has no scale yet — calibrate that page before saving.`
        : `${name} has no scale yet — calibrate it before saving.`,
      uncalibratedPlanIds: [...new Set(uncalibrated.map((u) => u.planId))],
    }
  }

  let rows: Array<Record<string, unknown> & { length_m: number }>
  let totalM: number
  let tracedM: number
  try {
    rows = segments.map((s, i) => {
      const plan = planById.get(s.floorPlanId)!
      const ppm = scaleFor(s.floorPlanId, s.pageIndex)!
      return {
        seq: i + 1,
        floor_plan_id: s.floorPlanId,
        floor_plan_name: plan.name,
        page_index: s.pageIndex,
        points: s.points,
        pixels_per_meter: ppm,
        length_m: segmentLengthM(s.points, ppm),
        organisation_id: ctx.organisationId,
      }
    })
    totalM = routeTotalM({ segments: rows, riseM, dropM })
    tracedM = routeTotalM({ segments: rows, riseM: 0, dropM: 0 })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not measure this route.' }
  }

  const { data: route, error: routeErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .upsert(
      {
        supply_id: supplyId,
        revision_id: ctx.revisionId,
        organisation_id: ctx.organisationId,
        rise_m: riseM,
        drop_m: dropM,
        notes: notes ?? null,
        measured_by: user.id,
        measured_at: new Date().toISOString(),
      },
      // ⚠ merge-duplicates must ride as a Prefer HEADER, which supabase-js does
      // when onConflict is given this way. Asserting only on the query string is
      // what let this class through twice before (PR #143, PR #142).
      { onConflict: 'supply_id', ignoreDuplicates: false },
    )
    .select('id, updated_at')
    .single()
  if (routeErr || !route) return { error: routeErr?.message ?? 'Could not save route' }

  // Replace the segment list.
  const { error: delErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('route_segments')
    .delete()
    .eq('route_id', route.id)
  if (delErr) return { error: delErr.message }

  let saved: SavedSegment[] = []
  if (rows.length > 0) {
    const { data: inserted, error: insErr } = await (supabase as any)
      .schema('cable_schedule')
      .from('route_segments')
      .insert(rows.map((r) => ({ ...r, route_id: route.id })))
      .select('id, seq, floor_plan_id, floor_plan_name, page_index, points, pixels_per_meter, length_m')
    if (insErr) return { error: insErr.message }
    saved = ((inserted ?? []) as any[])
      .map((g) => ({
        id: g.id as string,
        seq: Number(g.seq),
        floorPlanId: g.floor_plan_id as string,
        floorPlanName: (g.floor_plan_name ?? 'Drawing') as string,
        pageIndex: Number(g.page_index),
        points: (g.points ?? []) as number[],
        pixelsPerMeter: Number(g.pixels_per_meter),
        lengthM: Number(g.length_m),
      }))
      .sort((x, y) => x.seq - y.seq)
  }

  // The trail: one history row per save, holding the whole list as stored.
  await (supabase as any)
    .schema('cable_schedule')
    .from('route_history')
    .insert({
      route_id: route.id,
      supply_id: supplyId,
      revision_id: ctx.revisionId,
      organisation_id: ctx.organisationId,
      rise_m: riseM,
      drop_m: dropM,
      snapshot: rows.map((r, i) => ({ ...r, id: saved[i]?.id ?? null })),
      reason: 'save',
      saved_by: user.id,
    })

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  await emitProductEvent({
    actorId: user.id,
    projectId: ctx.projectId,
    event: 'cable_route_leg_saved',
    properties: { supply_id: supplyId, revision_id: ctx.revisionId, legs: saved.length, traced_m: tracedM, total_m: totalM },
  })
  return { ok: true, tracedM, totalM, segments: saved, updatedAt: (route.updated_at as string) ?? undefined }
}

export interface ApplyRouteResult {
  ok?: true
  error?: string
  /** Set when an existing length would be replaced and confirmOverwrite was not given. */
  needsConfirmation?: {
    existingM: number
    proposedM: number
    strands: number
    /**
     * Every DISTINCT length currently on the run's strands. Nothing forces
     * parallels to agree, and showing one strand's figure while overwriting
     * several is the kind of confirmation that is worse than none — the user
     * approves a number they were shown and loses ones they were not.
     */
    existingValuesM: number[]
  }
  appliedM?: number
  strands?: number
}

/**
 * Write a measured route's total onto every strand of its supply.
 *
 * Parallels share a route, and the grid already treats `measured_length_m` as a
 * run-shared field (CableScheduleGrid.tsx:318), so all strands get the same
 * figure. `measured_length_method` becomes 'SCALE_RULE' — a value the schema has
 * allowed since 00051 and which nothing has ever written, because until now
 * there was no scale rule in the product.
 */
export async function applyRouteToScheduleAction(input: {
  supplyId: string
  confirmOverwrite?: boolean
}): Promise<ApplyRouteResult> {
  const parsed = z.object({ supplyId: uuid, confirmOverwrite: z.boolean().default(false) })
    .safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { supplyId, confirmOverwrite } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadSupplyContext(supabase, supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const denied = await gate(supabase, user.id, ctx)
  if (denied) return { error: denied }

  const { data: route, error: rErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, total_length_m, traced_length_m')
    .eq('supply_id', supplyId)
    .maybeSingle()
  if (rErr) return { error: rErr.message }
  if (!route) return { error: 'This run has no measured route yet.' }

  const proposedM = Number(route.total_length_m)
  if (!(proposedM > 0)) return { error: 'This route measures zero — trace it before applying.' }

  const { data: cables, error: cErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('id, measured_length_m, confirmed_length_m, length_status')
    .eq('supply_id', supplyId)
  if (cErr) return { error: cErr.message }
  const strands = (cables ?? []) as any[]
  if (strands.length === 0) return { error: 'This run has no cables to apply a length to.' }

  // The overwrite gate. An existing length is somebody's work.
  const existing = strands
    .map((c) => (c.measured_length_m == null ? null : Number(c.measured_length_m)))
    .filter((v): v is number => v != null)
  if (existing.length > 0 && !confirmOverwrite) {
    const differs = existing.some((v) => Math.abs(v - proposedM) > 0.005)
    if (differs) {
      const distinct = [...new Set(existing)].sort((a, b) => a - b)
      return {
        needsConfirmation: {
          existingM: distinct[0],
          proposedM,
          strands: strands.length,
          existingValuesM: distinct,
        },
      }
    }
  }

  const nowIso = new Date().toISOString()
  const { error: upErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({
      measured_length_m: proposedM,
      measured_length_by: user.id,
      measured_length_at: nowIso,
      measured_length_method: 'SCALE_RULE',
      // Nothing here touches confirmed_length_m. The site-confirmation half of
      // the workflow has never been used in production and this is the
      // designer's measurement, not a site verification.
    })
    .eq('supply_id', supplyId)
  if (upErr) return { error: upErr.message }

  // Status: promote UNMEASURED → MEASURED and leave everything else alone —
  // the same rule the grid applies to a typed length. The first cut set
  // MEASURED unconditionally, which would have demoted a site-CONFIRMED strand
  // back to the designer's figure and flipped as-built volt-drop with it.
  const { error: stErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .update({ length_status: 'MEASURED' })
    .eq('supply_id', supplyId)
    .eq('length_status', 'UNMEASURED')
  if (stErr) return { error: stErr.message }

  // One change_log row per strand, matching updateMeasuredLengthAction's shape
  // so the two paths read identically in an audit.
  // ⚠ The audit row's error is NOT discarded. The comment below says the two
  // write paths must read identically in an audit; cables updated with no
  // change_log row is a worse outcome than a failed apply, because it is
  // invisible. The lengths are already written at this point, so this reports
  // rather than rolls back — but it reports.
  const { error: logErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert(
      strands.map((c) => ({
        revision_id: ctx.revisionId,
        organisation_id: ctx.organisationId,
        entity_type: 'cable',
        entity_id: c.id,
        field_name: 'measured_length_m',
        old_value: c.measured_length_m == null ? null : Number(c.measured_length_m),
        new_value: proposedM,
        changed_by: user.id,
      })),
    )

  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  if (logErr) {
    return {
      error:
        `The length was applied to ${strands.length} strand${strands.length === 1 ? '' : 's'}, ` +
        `but the change could not be written to the audit log (${logErr.message}). ` +
        `Tell an administrator before issuing this revision.`,
    }
  }
  await emitProductEvent({
    actorId: user.id,
    projectId: ctx.projectId,
    event: 'cable_route_assigned',
    properties: { supply_id: supplyId, revision_id: ctx.revisionId, applied_m: proposedM, strands: strands.length },
  })
  return { ok: true, appliedM: proposedM, strands: strands.length }
}

/**
 * Calibrate a drawing from a line across a known distance.
 *
 * This exists as a server action because calibration is used on two drawings
 * out of 389 — it has to be offered inside the measuring flow rather than as a
 * prerequisite someone is assumed to have done. Writing it here also gives it a
 * role gate and an audit trail, which the existing client-side write in
 * MarkupCanvas has neither of.
 */
export async function calibrateFloorPlanAction(input: {
  floorPlanId: string
  points: number[]
  realMetres: number
  pageIndex?: number
}): Promise<{ ok?: true; error?: string; pixelsPerMeter?: number }> {
  const parsed = z.object({
    floorPlanId: uuid,
    points: z.array(z.number()).min(4).max(4),
    realMetres: z.number().positive().max(10000),
    /** Which PDF page the two points were picked on. */
    pageIndex: z.number().int().min(1).default(1),
  }).safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // ⚠ This gate is the point of the action existing, and it was missing on the
  // first cut of this file while the comment above already claimed it was here.
  // Calibration is not a private scratch value: it is a property of the drawing
  // that every route on that sheet is measured against, and changing it makes
  // every existing segment stale. A directly-invocable server action that
  // rewrites it needs the same write role as the schedule itself.
  const { data: plan, error: planErr } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, project_id, organisation_id')
    .eq('id', parsed.data.floorPlanId)
    .maybeSingle()
  if (planErr) return { error: planErr.message }
  if (!plan) return { error: 'Drawing not found' }

  // `requireEffectiveRole` resolves to a RESULT OBJECT ({ ok: false, error } |
  // { ok: true, role }), never a boolean — so `if (!allowed)` is always false and
  // the gate above it is dead code. Read `.ok`, as every other call site does.
  const roleGate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
  if (!roleGate.ok) {
    return { error: 'You do not have permission to set the scale on this drawing.' }
  }

  let ppm: number
  try {
    ppm = derivePixelsPerMeter(parsed.data.points, parsed.data.realMetres)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not calibrate' }
  }

  if (parsed.data.pageIndex > 1) {
    // A page other than 1 has its own scale (00199); the drawing-level scale
    // stays the page-1 default and what the markup measure tool reads.
    const { error } = await (supabase as any)
      .schema('tenants')
      .from('floor_plan_page_scales')
      .upsert(
        {
          floor_plan_id: parsed.data.floorPlanId,
          page_index: parsed.data.pageIndex,
          organisation_id: plan.organisation_id ?? '00000000-0000-0000-0000-000000000000', // the trigger binds the real one
          pixels_per_meter: ppm,
          calibration_points: parsed.data.points,
          calibration_metres: parsed.data.realMetres,
          calibrated_by: user.id,
          calibrated_at: new Date().toISOString(),
        },
        { onConflict: 'floor_plan_id,page_index', ignoreDuplicates: false },
      )
    if (error) return { error: error.message }
    revalidatePath(`/projects/${plan.project_id}`)
    return { ok: true, pixelsPerMeter: ppm }
  }

  const { error } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .update({
      pixels_per_meter: ppm,
      calibrated_at: new Date().toISOString(),
      calibrated_by: user.id,
      // Where the scale was taken, so the sheet can SHOW it (00198). A bare
      // px/m figure tells nobody whether it was set across a 5 m door or a
      // 5 m car — and the difference is every length on the schedule.
      calibration_points: parsed.data.points,
      calibration_metres: parsed.data.realMetres,
      calibration_page_index: parsed.data.pageIndex,
    })
    .eq('id', parsed.data.floorPlanId)
  if (error) return { error: error.message }

  // The page that triggered this reads pixels_per_meter server-side, so without
  // this the drawing it just calibrated would still render as uncalibrated.
  revalidatePath(`/projects/${plan.project_id}`)
  return { ok: true, pixelsPerMeter: ppm }
}

/** Remove a run's route entirely, returning it to the unmeasured worklist. */
export async function deleteSupplyRouteAction(input: {
  supplyId: string
}): Promise<{ ok?: true; error?: string }> {
  const parsed = z.object({ supplyId: uuid }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const ctx = await loadSupplyContext(supabase, parsed.data.supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const denied = await gate(supabase, user.id, ctx)
  if (denied) return { error: denied }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .delete()
    .eq('supply_id', parsed.data.supplyId)
  if (error) return { error: error.message }

  // Deleting the route deliberately does NOT clear measured_length_m. The
  // length was applied as a deliberate act and stands until someone changes it
  // deliberately; removing the drawing evidence is not the same statement as
  // "this run has no length".
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT A SHEET — the drawing with its routes and a legend, kept as a report.
// ─────────────────────────────────────────────────────────────────────────────

const exportSheetSchema = z.object({
  floorPlanId: uuid,
  revisionId: uuid,
  pageIndex: z.number().int().min(1).default(1),
  /** The sheet as rasterised by the browser at native resolution, routes drawn. */
  jpegBase64: z.string().min(100).max(9_500_000),
  note: z.string().max(500).optional().nullable(),
})

export interface ExportSheetResult {
  ok?: true
  error?: string
  reportId?: string
  version?: number
  runs?: number
}

const A3_LANDSCAPE: [number, number] = [1190.55, 841.89]
const A4_PORTRAIT: [number, number] = [595.28, 841.89]

/**
 * Save the sheet the measurer is looking at — drawing, routes, per-edge
 * lengths and the calibration line as the browser drew them — as a versioned
 * PDF in `projects.reports`, with a legend page rendered from the route tables.
 *
 * The image comes from the browser because the drawing is rasterised there
 * (pdf.js) and the routes are drawn there (Konva); re-doing both in Node would
 * be a second renderer that could disagree with the first. The LEGEND does
 * not: it is computed here from `route_segments`, so the numbers on page 2
 * are the stored ones, never something the client could have edited.
 *
 * Reads of the saved artefact are open to every project role (see
 * report-kind-access.ts); writing one needs the schedule's write role.
 */
export async function exportRouteSheetAction(
  input: z.infer<typeof exportSheetSchema>,
): Promise<ExportSheetResult> {
  const parsed = exportSheetSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { floorPlanId, revisionId, pageIndex, jpegBase64, note } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: plan } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, project_id, organisation_id, pixels_per_meter, calibration_metres')
    .eq('id', floorPlanId)
    .maybeSingle()
  if (!plan) return { error: 'Drawing not found' }

  const roleGate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: 'You do not have permission to export cable routes.' }

  const { data: revision } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, project_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!revision || revision.project_id !== plan.project_id) return { error: 'Revision not found on this project' }
  // Separate read: the revision lives in cable_schedule and the project in
  // projects, and PostgREST will not embed across schemas — an embed here
  // returned nothing and read as "revision not found" on production.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('name, code')
    .eq('id', plan.project_id)
    .maybeSingle()

  // Every route on the revision, every segment of those routes, and the codes
  // that name the runs. The legend needs all sheets to say "continues on
  // another sheet" honestly, not just the one being exported.
  const { data: routes } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .select('id, supply_id, total_length_m')
    .eq('revision_id', revisionId)
  const routeRows = ((routes ?? []) as any[])
  const routeIds = routeRows.map((r) => r.id)
  const { data: segs } = routeIds.length
    ? await (supabase as any)
        .schema('cable_schedule')
        .from('route_segments')
        .select('route_id, floor_plan_id, page_index, length_m')
        .in('route_id', routeIds)
    : { data: [] }
  const supplyOfRoute = new Map<string, string>(routeRows.map((r) => [r.id, r.supply_id]))
  const { data: supplies } = routeRows.length
    ? await (supabase as any)
        .schema('cable_schedule')
        .from('supplies')
        .select('id, from_node_id, to_node_id')
        .in('id', routeRows.map((r) => r.supply_id))
    : { data: [] }
  const supplyRows = ((supplies ?? []) as any[])
  const nodeIds = [...new Set(supplyRows.flatMap((x) => [x.from_node_id, x.to_node_id]).filter(Boolean))] as string[]
  const { data: nodes } = nodeIds.length
    ? await (supabase as any).schema('structure').from('nodes').select('id, code').in('id', nodeIds)
    : { data: [] }
  const codeOf = new Map<string, string>(((nodes ?? []) as any[]).map((n) => [n.id, n.code as string]))
  const labelOf = new Map<string, string>(
    supplyRows.map((x) => [
      x.id,
      `${x.from_node_id ? (codeOf.get(x.from_node_id) ?? '—') : 'Source'} → ${x.to_node_id ? (codeOf.get(x.to_node_id) ?? '—') : '—'}`,
    ]),
  )

  const legend = sheetLegendRows(
    { floorPlanId, pageIndex },
    routeRows.map((r) => ({ supplyId: r.supply_id, label: labelOf.get(r.supply_id) ?? 'run', totalM: Number(r.total_length_m) })),
    ((segs ?? []) as any[]).map((g) => ({
      supplyId: supplyOfRoute.get(g.route_id) ?? '',
      floorPlanId: g.floor_plan_id,
      pageIndex: Number(g.page_index),
      lengthM: Number(g.length_m),
    })),
  )
  if (legend.length === 0) return { error: 'Nothing is traced on this page of the drawing yet.' }

  // ── The PDF ──
  const today = new Date().toISOString().slice(0, 10)
  // Project names in this dataset already carry their number — "(P89.7) DE
  // POORT" — so prefixing the code again printed "(PDP) (P89.7) DE POORT".
  const projectName = project?.name ?? ''
  // The scale printed on the sheet is THIS page's (00199): page 1 is the
  // drawing's own, any later page has its own row or is uncalibrated. Printing
  // page 1's figure on a page-3 export would issue a wrong number.
  let sheetPpm: number | null = plan.pixels_per_meter == null ? null : Number(plan.pixels_per_meter)
  let sheetCalM: number | null = plan.calibration_metres == null ? null : Number(plan.calibration_metres)
  if (pageIndex > 1) {
    const { data: ps } = await (supabase as any)
      .schema('tenants')
      .from('floor_plan_page_scales')
      .select('pixels_per_meter, calibration_metres')
      .eq('floor_plan_id', floorPlanId)
      .eq('page_index', pageIndex)
      .maybeSingle()
    sheetPpm = ps?.pixels_per_meter == null ? null : Number(ps.pixels_per_meter)
    sheetCalM = ps?.calibration_metres == null ? null : Number(ps.calibration_metres)
  }
  const scaleLine = sheetPpm
    ? `scale ${sheetPpm.toFixed(1)} px/m${sheetCalM ? ` (set across ${sheetCalM.toFixed(2)} m)` : ''}`
    : 'uncalibrated'
  const T = (t: string) => winAnsiSafe(t)

  let pdfBytes: Uint8Array
  try {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    // Hand pdf-lib the base64 string: it decodes it itself, in its own realm.
    // A Node Buffer here fails pdf-lib's `instanceof Uint8Array` under a jsdom
    // test realm and surfaces as "SOI not found" — a fixture-shaped error for
    // what is a runtime-shaped cause.
    const jpg = await doc.embedJpg(jpegBase64)

    // Page 1 — the sheet.
    const p1 = doc.addPage(A3_LANDSCAPE)
    const [W, H] = A3_LANDSCAPE
    const margin = 28
    const headerH = 54
    p1.drawText(T(`Cable routes — ${plan.name}${pageIndex > 1 ? ` (page ${pageIndex})` : ''}`), { x: margin, y: H - margin - 14, size: 15, font: bold })
    p1.drawText(T(`${projectName} · ${revision.code} · ${scaleLine} · ${today}`), { x: margin, y: H - margin - 32, size: 9.5, font, color: rgb(0.35, 0.35, 0.35) })
    const boxW = W - margin * 2
    const boxH = H - margin * 2 - headerH
    const k = Math.min(boxW / jpg.width, boxH / jpg.height)
    const drawW = jpg.width * k
    const drawH = jpg.height * k
    p1.drawImage(jpg, { x: margin + (boxW - drawW) / 2, y: margin + (boxH - drawH) / 2, width: drawW, height: drawH })
    p1.drawText(T(`${legend.length} run${legend.length === 1 ? '' : 's'} on this sheet — legend on the next page. Lengths are the horizontal route only; rise and drop are added in the schedule.`), { x: margin, y: 12, size: 8, font, color: rgb(0.4, 0.4, 0.4) })

    // Page 2+ — the legend, from the route tables.
    const rowH = 15
    const cols = [
      { title: 'Run', x: 32, w: 200 },
      { title: 'Legs here', x: 236, w: 60, align: 'right' as const },
      { title: 'On this sheet (m)', x: 300, w: 95, align: 'right' as const },
      { title: 'Run total (m)', x: 400, w: 85, align: 'right' as const },
      { title: '', x: 492, w: 90 },
    ]
    const perPage = Math.floor((A4_PORTRAIT[1] - 120) / rowH)
    for (let start = 0; start < legend.length; start += perPage) {
      const page = doc.addPage(A4_PORTRAIT)
      const [, ph] = A4_PORTRAIT
      let y = ph - 40
      page.drawText(T(`Cable routes on ${plan.name}${pageIndex > 1 ? ` (page ${pageIndex})` : ''} — legend`), { x: 32, y, size: 12, font: bold })
      y -= 16
      page.drawText(T(`${projectName} · ${revision.code} · ${today}`), { x: 32, y, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) })
      y -= 24
      for (const c of cols) {
        const tw = bold.widthOfTextAtSize(T(c.title), 8.5)
        page.drawText(T(c.title), { x: c.align === 'right' ? c.x + c.w - tw : c.x, y, size: 8.5, font: bold })
      }
      y -= 6
      page.drawLine({ start: { x: 32, y }, end: { x: 582, y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) })
      y -= rowH
      for (const row of legend.slice(start, start + perPage)) {
        const cells = [
          row.label,
          String(row.legsHere),
          row.onSheetM.toFixed(2),
          row.totalM.toFixed(2),
          row.continuesElsewhere ? 'continues on another sheet' : '',
        ]
        cells.forEach((cell, i) => {
          const c = cols[i]
          const txt = T(cell)
          const tw = font.widthOfTextAtSize(txt, 9)
          page.drawText(txt, { x: c.align === 'right' ? c.x + c.w - tw : c.x, y, size: 9, font, color: i === 4 ? rgb(0.55, 0.35, 0.05) : rgb(0, 0, 0) })
        })
        y -= rowH
      }
      page.drawText(T('Lengths are the horizontal route traced on the drawing. Rise and drop are added per run in the cable schedule; the schedule holds the figure that is issued.'), { x: 32, y: 24, size: 7.5, font, color: rgb(0.4, 0.4, 0.4) })
    }
    pdfBytes = await doc.save()
  } catch (e) {
    return { error: e instanceof Error ? `PDF render failed: ${e.message}` : 'PDF render failed' }
  }

  // ── Persist as the next version for this sheet ──
  const service = createServiceClient() as any
  const { data: prior } = await service
    .schema('projects').from('reports')
    .select('id, version')
    .eq('project_id', plan.project_id).eq('kind', 'cable_route_sheet').eq('source_id', floorPlanId).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version: number = prior ? Number(prior.version) + 1 : 1
  const storagePath = `${plan.organisation_id}/${plan.project_id}/cable-route-sheets/${floorPlanId}-p${pageIndex}-v${version}.pdf`
  const { error: upErr } = await service.storage.from('reports')
    .upload(storagePath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  const onSheetM = legend.reduce((n, r) => n + r.onSheetM, 0)
  const { data: report, error: insErr } = await service
    .schema('projects').from('reports')
    .insert({
      organisation_id: plan.organisation_id,
      project_id: plan.project_id,
      kind: 'cable_route_sheet',
      source_table: 'tenants.floor_plans',
      source_id: floorPlanId,
      title: `Cable routes — ${plan.name}${pageIndex > 1 ? ` (page ${pageIndex})` : ''}`,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBytes.length,
      status: 'issued',
      version,
      // What the saved-reports panel prints beside the version. The page is in
      // the title and the revision on the legend page; both read as counts here.
      summary: { runs: legend.length, legsHere: legend.reduce((n, r) => n + r.legsHere, 0), onSheetM: Math.round(onSheetM * 100) / 100 },
      note: note ?? null,
      generated_by: user.id,
    })
    .select('id').single()
  if (insErr || !report) {
    await service.storage.from('reports').remove([storagePath])
    return { error: `Failed to save report: ${insErr?.message ?? 'unknown'}` }
  }
  if (prior) {
    await service.schema('projects').from('reports')
      .update({ status: 'superseded', superseded_by: report.id })
      .eq('id', prior.id)
  }

  revalidatePath(`/projects/${plan.project_id}/cables/${revisionId}/measure`)
  await emitProductEvent({
    actorId: user.id,
    projectId: plan.project_id,
    event: 'cable_route_sheet_exported',
    properties: { floor_plan_id: floorPlanId, revision_id: revisionId, page_index: pageIndex, runs: legend.length, version },
  })
  return { ok: true, reportId: report.id as string, version, runs: legend.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY — restore a prior state of the route (server-side undo, itself logged)
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteHistoryEntry {
  id: string
  savedAt: string
  savedBy: string
  reason: 'save' | 'restore' | 'remeasure'
  legs: number
  tracedM: number
  riseM: number
  dropM: number
}

/** The saves of a run, newest first. */
export async function listRouteHistoryAction(input: { supplyId: string }): Promise<{ entries?: RouteHistoryEntry[]; error?: string }> {
  const parsed = z.object({ supplyId: uuid }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('route_history')
    .select('id, saved_at, saved_by, reason, rise_m, drop_m, snapshot')
    .eq('supply_id', parsed.data.supplyId)
    .order('saved_at', { ascending: false })
    .limit(50)
  if (error) return { error: error.message }
  return {
    entries: ((data ?? []) as any[]).map((h) => {
      const snap = Array.isArray(h.snapshot) ? (h.snapshot as any[]) : []
      return {
        id: h.id,
        savedAt: h.saved_at,
        savedBy: h.saved_by,
        reason: h.reason,
        legs: snap.length,
        tracedM: roundMetres(snap.reduce((n, g) => n + Number(g.length_m ?? 0), 0)),
        riseM: Number(h.rise_m),
        dropM: Number(h.drop_m),
      }
    }),
  }
}

/**
 * Put the route back to how it was at one history row — geometry, scale-at-
 * the-time and lengths verbatim (nothing is re-measured), rise and drop too.
 * Writes a NEW history row with reason 'restore'; the trail is never rewritten.
 */
export async function restoreRouteHistoryAction(input: { supplyId: string; historyId: string }): Promise<SaveRouteResult> {
  const parsed = z.object({ supplyId: uuid, historyId: uuid }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const ctx = await loadSupplyContext(supabase, parsed.data.supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const gateErr = await gate(supabase, user.id, ctx)
  if (gateErr) return { error: gateErr }

  const { data: h } = await (supabase as any)
    .schema('cable_schedule')
    .from('route_history')
    .select('id, route_id, supply_id, rise_m, drop_m, snapshot')
    .eq('id', parsed.data.historyId)
    .eq('supply_id', parsed.data.supplyId)
    .maybeSingle()
  if (!h) return { error: 'That history entry was not found for this run.' }
  const snap = (Array.isArray(h.snapshot) ? (h.snapshot as any[]) : []).map((g, i) => ({
    seq: i + 1,
    floor_plan_id: g.floor_plan_id,
    floor_plan_name: g.floor_plan_name ?? 'Drawing',
    page_index: Number(g.page_index ?? 1),
    points: g.points,
    pixels_per_meter: Number(g.pixels_per_meter),
    length_m: Number(g.length_m),
    organisation_id: ctx.organisationId,
  }))
  for (const g of snap) {
    const err = validateRoutePoints(g.points)
    if (err || !(g.pixels_per_meter > 0)) return { error: 'That history entry holds a leg that can no longer be restored.' }
  }

  const { data: route, error: routeErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('supply_routes')
    .update({ rise_m: Number(h.rise_m), drop_m: Number(h.drop_m), measured_by: user.id, measured_at: new Date().toISOString() })
    .eq('id', h.route_id)
    .select('id, updated_at')
    .single()
  if (routeErr || !route) return { error: routeErr?.message ?? 'Could not restore' }
  const { error: delErr } = await (supabase as any).schema('cable_schedule').from('route_segments').delete().eq('route_id', h.route_id)
  if (delErr) return { error: delErr.message }
  let saved: SavedSegment[] = []
  if (snap.length > 0) {
    const { data: inserted, error: insErr } = await (supabase as any)
      .schema('cable_schedule')
      .from('route_segments')
      .insert(snap.map((r) => ({ ...r, route_id: h.route_id })))
      .select('id, seq, floor_plan_id, floor_plan_name, page_index, points, pixels_per_meter, length_m')
    if (insErr) return { error: insErr.message }
    saved = ((inserted ?? []) as any[]).map((g) => ({
      id: g.id, seq: Number(g.seq), floorPlanId: g.floor_plan_id, floorPlanName: g.floor_plan_name ?? 'Drawing',
      pageIndex: Number(g.page_index), points: (g.points ?? []) as number[], pixelsPerMeter: Number(g.pixels_per_meter), lengthM: Number(g.length_m),
    })).sort((x, y) => x.seq - y.seq)
  }
  await (supabase as any).schema('cable_schedule').from('route_history').insert({
    route_id: h.route_id, supply_id: parsed.data.supplyId, revision_id: ctx.revisionId, organisation_id: ctx.organisationId,
    rise_m: Number(h.rise_m), drop_m: Number(h.drop_m), snapshot: snap, reason: 'restore', saved_by: user.id,
  })
  const tracedM = roundMetres(snap.reduce((n, g) => n + g.length_m, 0))
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true, tracedM, totalM: roundMetres(tracedM + Number(h.rise_m) + Number(h.drop_m)), segments: saved, updatedAt: route.updated_at }
}

// ─────────────────────────────────────────────────────────────────────────────
// RE-MEASURE — after a sheet is rescaled, re-derive the flagged legs' lengths
// from their stored points and the sheet's CURRENT scale. Explicit, logged.
// ─────────────────────────────────────────────────────────────────────────────

export interface RemeasureResult {
  ok?: true
  error?: string
  legs?: Array<{ id: string; seq: number; beforeM: number; afterM: number; beforePpm: number; afterPpm: number }>
  /** Set on a dry run: nothing was written. */
  preview?: true
}

export async function remeasureRouteLegsAction(input: {
  supplyId: string
  floorPlanId: string
  pageIndex: number
  dryRun?: boolean
}): Promise<RemeasureResult> {
  const parsed = z.object({ supplyId: uuid, floorPlanId: uuid, pageIndex: z.number().int().min(1), dryRun: z.boolean().optional() }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const ctx = await loadSupplyContext(supabase, parsed.data.supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const gateErr = await gate(supabase, user.id, ctx)
  if (gateErr) return { error: gateErr }

  const { data: plan } = await (supabase as any).schema('tenants').from('floor_plans').select('id, pixels_per_meter').eq('id', parsed.data.floorPlanId).maybeSingle()
  if (!plan) return { error: 'Drawing not found' }
  const { data: ps } = await (supabase as any).schema('tenants').from('floor_plan_page_scales').select('pixels_per_meter').eq('floor_plan_id', parsed.data.floorPlanId).eq('page_index', parsed.data.pageIndex).maybeSingle()
  const currentPpm: number | null = ps?.pixels_per_meter != null ? Number(ps.pixels_per_meter) : parsed.data.pageIndex === 1 && plan.pixels_per_meter != null ? Number(plan.pixels_per_meter) : null
  if (!(currentPpm && currentPpm > 0)) return { error: 'This page has no scale to re-measure against.' }

  const { data: route } = await (supabase as any).schema('cable_schedule').from('supply_routes').select('id, rise_m, drop_m').eq('supply_id', parsed.data.supplyId).maybeSingle()
  if (!route) return { error: 'This run has no route.' }
  const { data: segs } = await (supabase as any)
    .schema('cable_schedule').from('route_segments')
    .select('id, seq, points, pixels_per_meter, length_m, floor_plan_id, floor_plan_name, page_index')
    .eq('route_id', route.id).order('seq')
  const all = ((segs ?? []) as any[])
  const stale = all.filter((g) => g.floor_plan_id === parsed.data.floorPlanId && Number(g.page_index) === parsed.data.pageIndex && Math.abs(Number(g.pixels_per_meter) - currentPpm) > 1e-6)
  const legs = stale.map((g) => ({
    id: g.id as string, seq: Number(g.seq),
    beforeM: Number(g.length_m), afterM: roundMetres(polylineLengthPx(g.points as number[]) / currentPpm),
    beforePpm: Number(g.pixels_per_meter), afterPpm: currentPpm,
  }))
  if (parsed.data.dryRun) return { ok: true, preview: true, legs }
  if (legs.length === 0) return { ok: true, legs: [] }

  for (const l of legs) {
    const { error } = await (supabase as any).schema('cable_schedule').from('route_segments')
      .update({ pixels_per_meter: l.afterPpm, length_m: l.afterM }).eq('id', l.id)
    if (error) return { error: error.message }
  }
  await (supabase as any).schema('cable_schedule').from('route_history').insert({
    route_id: route.id, supply_id: parsed.data.supplyId, revision_id: ctx.revisionId, organisation_id: ctx.organisationId,
    rise_m: Number(route.rise_m), drop_m: Number(route.drop_m),
    snapshot: all.map((g) => { const l = legs.find((x) => x.id === g.id); return l ? { ...g, pixels_per_meter: l.afterPpm, length_m: l.afterM } : g }),
    reason: 'remeasure', saved_by: user.id,
  })
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true, legs }
}

// ─────────────────────────────────────────────────────────────────────────────
// REVERT — put the schedule back to the length it held before the last Assign.
// ─────────────────────────────────────────────────────────────────────────────

export async function revertRouteAssignmentAction(input: { supplyId: string }): Promise<{ ok?: true; error?: string; revertedToM?: number | null; strands?: number }> {
  const parsed = z.object({ supplyId: uuid }).safeParse(input)
  if (!parsed.success) return { error: 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const ctx = await loadSupplyContext(supabase, parsed.data.supplyId)
  if ('error' in ctx) return { error: ctx.error }
  const gateErr = await gate(supabase, user.id, ctx)
  if (gateErr) return { error: gateErr }

  const { data: strandsRaw } = await (supabase as any).schema('cable_schedule').from('cables')
    .select('id, measured_length_m, length_status').eq('supply_id', parsed.data.supplyId)
  const strands = ((strandsRaw ?? []) as any[])
  if (strands.length === 0) return { error: 'No strands on this run.' }
  const { data: logs } = await (supabase as any).schema('cable_schedule').from('change_log')
    .select('entity_id, old_value, new_value, changed_at')
    .in('entity_id', strands.map((c) => c.id)).eq('field_name', 'measured_length_m')
    .order('changed_at', { ascending: false })
  const latest = new Map<string, { old_value: number | null }>()
  for (const l of ((logs ?? []) as any[])) if (!latest.has(l.entity_id)) latest.set(l.entity_id, { old_value: l.old_value == null ? null : Number(l.old_value) })
  if (latest.size === 0) return { error: 'Nothing to revert — no assignment has been recorded for this run.' }

  let revertedTo: number | null = null
  for (const c of strands) {
    const prior = latest.get(c.id)
    if (!prior) continue
    revertedTo = prior.old_value
    const { error } = await (supabase as any).schema('cable_schedule').from('cables').update({
      measured_length_m: prior.old_value,
      measured_length_method: prior.old_value == null ? null : 'MANUAL',
      measured_length_by: null,
      measured_length_at: null,
      ...(prior.old_value == null ? { length_status: 'UNMEASURED' } : {}),
    }).eq('id', c.id)
    if (error) return { error: error.message }
  }
  await (supabase as any).schema('cable_schedule').from('change_log').insert(
    strands.filter((c) => latest.has(c.id)).map((c) => ({
      revision_id: ctx.revisionId, organisation_id: ctx.organisationId, entity_type: 'cable', entity_id: c.id,
      field_name: 'measured_length_m', old_value: c.measured_length_m == null ? null : Number(c.measured_length_m),
      new_value: latest.get(c.id)!.old_value, reason: 'Reverted the traced-route assignment', changed_by: user.id,
    })),
  )
  revalidatePath(`/projects/${ctx.projectId}/cables/${ctx.revisionId}`)
  return { ok: true, revertedToM: revertedTo, strands: latest.size }
}
