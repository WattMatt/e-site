'use server'
/**
 * Roof sources (functional spec §3.2 C). Each action re-checks Edit itself
 * (requireSolarLevel redirects a lower level to /solar/locked) and writes
 * through the caller's session: 00211's RLS decides who, roof_sources_bind
 * stamps the drawing anchor and binds the org. Calibration is NOT here — it is
 * calibrateFloorPlanAction (cable-route.actions.ts), role-gated per page.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import { mod360 } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function addDrawingRoofSourceAction(input: { projectId: string; floorPlanId: string; pageIndex: number }):
  Promise<{ ok: true; id: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.floorPlanId !== 'string' || !UUID.test(input.floorPlanId)) return { error: 'Choose a drawing.' }
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 1 || input.pageIndex > 500) return { error: 'The page must be 1 or more.' }
  const { data: study } = await supabase.schema('solar').from('studies').select('id').eq('project_id', input.projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  if (!studyId) return { error: 'Save the site location in Site & Supply first.' }
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .insert({ study_id: studyId, kind: 'drawing', floor_plan_id: input.floorPlanId, page_index: input.pageIndex })
    .select('id')
  if (error) return { error: humanLayoutError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Nothing was added — reload and try again.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_source_added', objectRef: { roofSourceId: id } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id }
}

export async function removeRoofSourceAction(input: { projectId: string; roofSourceId: string }): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!UUID.test(String(input.roofSourceId))) return { error: 'Choose a roof source.' }
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .delete().eq('id', input.roofSourceId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was removed — reload to see the current list.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_source_removed', objectRef: { roofSourceId: input.roofSourceId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function setRoofNorthAction(input: {
  projectId: string; roofSourceId: string; bearingDeg: number; points: number[] | null; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string; bearingDeg: number } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.bearingDeg !== 'number' || !Number.isFinite(input.bearingDeg)) {
    return { error: 'Enter north as degrees clockwise from the top of the sheet.' }
  }
  if (input.points !== null && !(Array.isArray(input.points) && input.points.length === 4 && input.points.every((v) => typeof v === 'number' && Number.isFinite(v)))) {
    return { error: 'North is two points on the sheet.' }
  }
  // Round THEN wrap: 359.996 rounds to 360, which the column (< 360) refuses.
  const bearingDeg = mod360(Math.round(mod360(input.bearingDeg) * 100) / 100)
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .update({ north_bearing_deg: bearingDeg, north_points: input.points })
    .eq('id', input.roofSourceId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt)
    .select('updated_at')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_north_set', objectRef: { roofSourceId: input.roofSourceId, bearingDeg } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]!.updated_at as string, bearingDeg }
}
