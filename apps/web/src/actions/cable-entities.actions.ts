'use server'

/**
 * Cable schedule — entity CRUD (sources / boards / supplies / cables).
 *
 * RLS gates every write at the org level (migration 00051 + 00052).
 * App-side enforces "DRAFT-only writes": ISSUED revisions are read-only.
 * Issuing locks the snapshot — the next revision starts as a fresh DRAFT
 * via the existing cable-revision.actions.
 *
 * Cable inserts auto-fill Ω/km + base rating from the bundled SANS
 * library (or per-project override) when conductor + insulation + size
 * + cores resolve to a known table. Manual Ω/km override is honoured —
 * `manual_override = TRUE` lets the schedule grid show the ⚑ pen flag.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { lookupCableProperties, lookupDeratingFactors, deratedRating } from '@esite/shared'

const uuid = z.string().uuid()

// ─── helpers ─────────────────────────────────────────────────────────

async function assertDraft(
  supabase: any,
  revisionId: string,
): Promise<{ orgId: string; projectId: string } | { error: string }> {
  const { data: rev, error } = await supabase
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, organisation_id, project_id')
    .eq('id', revisionId)
    .single()
  if (error || !rev) return { error: 'Revision not found' }
  if (rev.status !== 'DRAFT') return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  return { orgId: rev.organisation_id, projectId: rev.project_id }
}

// ─── sources ─────────────────────────────────────────────────────────

const sourceSchema = z.object({
  revisionId: uuid,
  code: z.string().trim().min(1).max(80),
  type: z.enum(['MINISUB','STANDBY','PV','UTILITY','RMU']),
  ratingKva: z.number().positive().optional().nullable(),
  voltageV: z.number().positive().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function addSourceAction(
  input: z.infer<typeof sourceSchema>,
): Promise<{ id?: string; error?: string }> {
  const parsed = sourceSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('sources')
    .insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      code: parsed.data.code,
      type: parsed.data.type,
      rating_kva: parsed.data.ratingKva ?? null,
      voltage_v: parsed.data.voltageV ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${parsed.data.revisionId}`)
  return { id: (data as { id: string }).id }
}

export async function deleteSourceAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: src } = await (supabase as any)
    .schema('cable_schedule')
    .from('sources')
    .select('revision_id')
    .eq('id', id)
    .single()
  const revId = (src as { revision_id?: string } | null)?.revision_id
  if (!revId) return { error: 'Source not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('sources')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── boards ──────────────────────────────────────────────────────────

const boardSchema = z.object({
  revisionId: uuid,
  code: z.string().trim().min(1).max(80),
  tenantName: z.string().trim().max(200).optional().nullable(),
  breakerRatingA: z.number().positive().optional().nullable(),
  poleConfig: z.enum(['SP','TP']).optional().nullable(),
  section: z.enum(['NORMAL','EMERGENCY','MIXED']).optional().nullable(),
  parentBoardId: uuid.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function addBoardAction(
  input: z.infer<typeof boardSchema>,
): Promise<{ id?: string; error?: string }> {
  const parsed = boardSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('boards')
    .insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      code: parsed.data.code,
      tenant_name: parsed.data.tenantName ?? null,
      breaker_rating_a: parsed.data.breakerRatingA ?? null,
      pole_config: parsed.data.poleConfig ?? null,
      section: parsed.data.section ?? null,
      parent_board_id: parsed.data.parentBoardId ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${parsed.data.revisionId}`)
  return { id: (data as { id: string }).id }
}

export async function deleteBoardAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: b } = await (supabase as any)
    .schema('cable_schedule')
    .from('boards')
    .select('revision_id')
    .eq('id', id)
    .single()
  const revId = (b as { revision_id?: string } | null)?.revision_id
  if (!revId) return { error: 'Board not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('boards')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── supplies ────────────────────────────────────────────────────────

const supplySchema = z.object({
  revisionId: uuid,
  fromSourceId: uuid.optional().nullable(),
  fromBoardId: uuid.optional().nullable(),
  toBoardId: uuid,
  voltageV: z.number().positive(),
  designLoadA: z.number().positive(),
  section: z.enum(['NORMAL','EMERGENCY']).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).refine(
  (d) => (d.fromSourceId ? 1 : 0) + (d.fromBoardId ? 1 : 0) === 1,
  { message: 'Pick exactly one origin: a source OR a board' },
)

export async function addSupplyAction(
  input: z.infer<typeof supplySchema>,
): Promise<{ id?: string; error?: string }> {
  const parsed = supplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      from_source_id: parsed.data.fromSourceId ?? null,
      from_board_id: parsed.data.fromBoardId ?? null,
      to_board_id: parsed.data.toBoardId,
      voltage_v: parsed.data.voltageV,
      design_load_a: parsed.data.designLoadA,
      section: parsed.data.section ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${parsed.data.revisionId}`)
  return { id: (data as { id: string }).id }
}

export async function deleteSupplyAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: s } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('revision_id')
    .eq('id', id)
    .single()
  const revId = (s as { revision_id?: string } | null)?.revision_id
  if (!revId) return { error: 'Supply not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── cables ──────────────────────────────────────────────────────────

const cableSchema = z.object({
  supplyId: uuid,
  cableNo: z.number().int().positive().optional(),
  sizeMm2: z.number().positive(),
  cores: z.enum(['3','3+E','4']),
  conductor: z.enum(['CU','AL']),
  insulation: z.enum(['PVC','XLPE','PILC']),
  armour: z.enum(['SWA','UNARMOURED']).optional().nullable(),
  measuredLengthM: z.number().nonnegative().optional().nullable(),
  installationMethod: z.enum(['DIRECT_IN_GROUND','DUCT','LADDER','TRAY','CLIPPED']).optional().nullable(),
  depthMm: z.number().int().positive().optional().nullable(),
  groupedWith: z.number().int().positive().default(1),
  ambientTempC: z.number().default(30),
  thermalResistivityKmw: z.number().default(1.0),
  // Manual override of ohm_per_km — leave null to use the SANS lookup.
  ohmPerKmOverride: z.number().positive().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export async function addCableAction(
  input: z.infer<typeof cableSchema>,
): Promise<{ id?: string; cableNo?: number; error?: string }> {
  const parsed = cableSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  // Find revision via the supply
  const { data: sup, error: supErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, revision_id, organisation_id')
    .eq('id', parsed.data.supplyId)
    .single()
  if (supErr || !sup) return { error: 'Supply not found' }
  const s = sup as { id: string; revision_id: string; organisation_id: string }
  const guard = await assertDraft(supabase, s.revision_id)
  if ('error' in guard) return { error: guard.error }

  // Next cable_no within supply
  const { data: existing } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('cable_no')
    .eq('supply_id', s.id)
    .order('cable_no', { ascending: false })
    .limit(1)
  const nextCableNo = parsed.data.cableNo
    ?? (((existing?.[0] as { cable_no?: number } | undefined)?.cable_no ?? 0) + 1)

  // SANS lookup for ohm_per_km + base rating + derate factors
  const props = await lookupCableProperties(supabase as any, {
    conductor: parsed.data.conductor,
    insulation: parsed.data.insulation,
    cores: parsed.data.cores,
    size_mm2: parsed.data.sizeMm2,
    projectId: guard.projectId,
  })

  const manualOverride = parsed.data.ohmPerKmOverride != null
  const ohmPerKm = manualOverride
    ? parsed.data.ohmPerKmOverride!
    : props?.ac_resistance ?? props?.dc_resistance ?? null

  // Resolve base rating from installation_method
  const baseRating =
    parsed.data.installationMethod === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
    : parsed.data.installationMethod === 'DUCT'           ? props?.rating_in_duct
    : props?.rating_in_air

  const derate = await lookupDeratingFactors(supabase as any, {
    depth_mm: parsed.data.depthMm ?? 500,
    thermal_resistivity_kmw: parsed.data.thermalResistivityKmw,
    grouped_with: parsed.data.groupedWith,
    ambient_c: parsed.data.ambientTempC,
    insulation: parsed.data.insulation,
  })

  const deratedA = deratedRating(baseRating ?? null, {
    depth: derate.depth,
    thermal: derate.thermal,
    grouping: derate.grouping,
    temperature: derate.temperature,
  })

  // Resolve standard from insulation
  const standard =
    parsed.data.insulation === 'XLPE' ? 'SANS 1507-4'
    : parsed.data.insulation === 'PVC' ? 'SANS 1507-3'
    : 'SANS 97'

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .insert({
      supply_id: s.id,
      revision_id: s.revision_id,
      organisation_id: s.organisation_id,
      cable_no: nextCableNo,
      size_mm2: parsed.data.sizeMm2,
      cores: parsed.data.cores,
      conductor: parsed.data.conductor,
      insulation: parsed.data.insulation,
      armour: parsed.data.armour ?? 'SWA',
      standard,
      measured_length_m: parsed.data.measuredLengthM ?? null,
      length_status: parsed.data.measuredLengthM != null ? 'MEASURED' : 'UNMEASURED',
      installation_method: parsed.data.installationMethod ?? null,
      depth_mm: parsed.data.depthMm ?? null,
      grouped_with: parsed.data.groupedWith,
      ambient_temp_c: parsed.data.ambientTempC,
      thermal_resistivity_kmw: parsed.data.thermalResistivityKmw,
      ohm_per_km: ohmPerKm,
      derate_depth: derate.depth,
      derate_thermal: derate.thermal,
      derate_grouping: derate.grouping,
      derate_temp: derate.temperature,
      derated_current_rating_a: deratedA,
      manual_override: manualOverride,
      notes: parsed.data.notes ?? null,
    })
    .select('id, cable_no')
    .single()
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${s.revision_id}`)
  return {
    id: (data as { id: string }).id,
    cableNo: (data as { cable_no: number }).cable_no,
  }
}

export async function addParallelCableAction(
  supplyId: string,
): Promise<{ id?: string; cableNo?: number; error?: string }> {
  if (!uuid.safeParse(supplyId).success) return { error: 'Invalid supply id' }
  const supabase = await createClient()
  // Clone the lowest-numbered cable in the supply
  const { data: src } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('size_mm2, cores, conductor, insulation, armour, measured_length_m, installation_method, depth_mm, grouped_with, ambient_temp_c, thermal_resistivity_kmw, notes')
    .eq('supply_id', supplyId)
    .order('cable_no', { ascending: true })
    .limit(1)
    .single()
  if (!src) return { error: 'No existing cable to clone — add one first' }
  const c = src as any
  return addCableAction({
    supplyId,
    sizeMm2: Number(c.size_mm2),
    cores: c.cores,
    conductor: c.conductor,
    insulation: c.insulation,
    armour: c.armour,
    measuredLengthM: c.measured_length_m == null ? null : Number(c.measured_length_m),
    installationMethod: c.installation_method,
    depthMm: c.depth_mm == null ? null : Number(c.depth_mm),
    groupedWith: c.grouped_with,
    ambientTempC: Number(c.ambient_temp_c),
    thermalResistivityKmw: Number(c.thermal_resistivity_kmw),
    notes: c.notes,
  })
}

export async function deleteCableAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: c } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('revision_id')
    .eq('id', id)
    .single()
  const revId = (c as { revision_id?: string } | null)?.revision_id
  if (!revId) return { error: 'Cable not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}
