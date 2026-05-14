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
import { lookupCableRole, ROLE_CAPS } from '@/lib/cable-schedule/roles'

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

/** Records a deletion in change_log. Best-effort — never blocks the delete. */
async function logDeletion(
  supabase: any,
  args: {
    revisionId: string
    organisationId: string
    entityType: 'source' | 'board' | 'supply' | 'cable'
    entityId: string
    label: string
    userId: string | null
  },
): Promise<void> {
  try {
    await supabase.schema('cable_schedule').from('change_log').insert({
      revision_id: args.revisionId,
      organisation_id: args.organisationId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      field_name: 'deleted',
      old_value: args.label,
      new_value: null,
      changed_by: args.userId,
    })
  } catch {
    // best-effort — a logging failure must never surface to the caller
  }
}

// ─── sources ─────────────────────────────────────────────────────────

const sourceSchema = z.object({
  revisionId: uuid,
  code: z.string().trim().min(1).max(80),
  type: z.enum(['COUNCIL_RMU','UTILITY','PV','STANDBY']),
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
  const { data: { user } } = await supabase.auth.getUser()
  const { data: src } = await (supabase as any)
    .schema('cable_schedule')
    .from('sources')
    .select('revision_id, organisation_id, code')
    .eq('id', id)
    .single()
  const source = src as { revision_id?: string; organisation_id?: string; code?: string } | null
  const revId = source?.revision_id
  if (!revId) return { error: 'Source not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('sources')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  await logDeletion(supabase, {
    revisionId: revId,
    organisationId: source!.organisation_id!,
    entityType: 'source',
    entityId: id,
    label: `Source "${source!.code ?? '?'}"`,
    userId: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── boards ──────────────────────────────────────────────────────────

const boardSchema = z.object({
  revisionId: uuid,
  code: z.string().trim().min(1).max(80),
  kind: z.enum(['CONSUMER_RMU','TRANSFORMER','MAIN_BOARD','SUB_BOARD']).optional().nullable(),
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
      kind: parsed.data.kind ?? null,
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
  const { data: { user } } = await supabase.auth.getUser()
  const { data: b } = await (supabase as any)
    .schema('cable_schedule')
    .from('boards')
    .select('revision_id, organisation_id, code')
    .eq('id', id)
    .single()
  const board = b as { revision_id?: string; organisation_id?: string; code?: string } | null
  const revId = board?.revision_id
  if (!revId) return { error: 'Board not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('boards')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  await logDeletion(supabase, {
    revisionId: revId,
    organisationId: board!.organisation_id!,
    entityType: 'board',
    entityId: id,
    label: `Board "${board!.code ?? '?'}"`,
    userId: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── supplies ────────────────────────────────────────────────────────

export async function deleteSupplyAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: s } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('revision_id, organisation_id, voltage_v, design_load_a')
    .eq('id', id)
    .single()
  const supply = s as {
    revision_id?: string
    organisation_id?: string
    voltage_v?: number | null
    design_load_a?: number | null
  } | null
  const revId = supply?.revision_id
  if (!revId) return { error: 'Supply not found' }
  const guard = await assertDraft(supabase, revId)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  await logDeletion(supabase, {
    revisionId: revId,
    organisationId: supply!.organisation_id!,
    entityType: 'supply',
    entityId: id,
    label: `Supply ${supply!.voltage_v ?? '?'}V / ${supply!.design_load_a ?? '?'}A`,
    userId: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${revId}`)
  return { ok: true }
}

// ─── supply updates (C12) ────────────────────────────────────────────

const updateSupplySchema = z.object({
  supplyId: uuid,
  voltageV: z.number().positive().optional(),
  designLoadA: z.number().positive().optional(),
  section: z.enum(['NORMAL', 'EMERGENCY']).nullable().optional(),
})

export async function updateSupplyAction(
  input: z.infer<typeof updateSupplySchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateSupplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: sup } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select(
      'id, revision_id, organisation_id, voltage_v, design_load_a, section, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.supplyId)
    .single()
  if (!sup) return { error: 'Supply not found' }
  const s = sup as any
  if (s.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, s.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  const patch: Record<string, unknown> = {}
  const events: Array<Record<string, unknown>> = []
  const log = (field: string, oldV: unknown, newV: unknown) => {
    if (oldV === newV) return
    patch[field] = newV
    events.push({
      revision_id: s.revision_id, organisation_id: s.organisation_id,
      entity_type: 'supply', entity_id: s.id, field_name: field,
      old_value: oldV, new_value: newV, changed_by: user.id,
    })
  }
  if (parsed.data.voltageV !== undefined) log('voltage_v', Number(s.voltage_v), parsed.data.voltageV)
  if (parsed.data.designLoadA !== undefined) log('design_load_a', Number(s.design_load_a), parsed.data.designLoadA)
  if (parsed.data.section !== undefined) log('section', s.section, parsed.data.section)
  if (events.length === 0) return { ok: true }

  const { error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .update(patch).eq('id', s.id)
  if (error) return { error: error.message }

  await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  revalidatePath(`/projects/${s.revision.project_id}/cables/${s.revision_id}`)
  return { ok: true }
}

// ─── find-or-create supply (implicit supply for CableForm) ──────────

const findOrCreateSupplySchema = z.object({
  revisionId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid,
  voltageV: z.number().positive(),
  designLoadA: z.number().positive(),
  section: z.enum(['NORMAL', 'EMERGENCY']).nullable().optional(),
})

export async function findOrCreateSupplyAction(
  input: z.infer<typeof findOrCreateSupplySchema>,
): Promise<{ supplyId?: string; error?: string }> {
  const parsed = findOrCreateSupplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  // Existing supply for this (from, to) pair?
  let q = (supabase as any).schema('cable_schedule').from('supplies')
    .select('id').eq('revision_id', parsed.data.revisionId)
    .eq('to_board_id', parsed.data.toBoardId)
  q = parsed.data.fromSourceId
    ? q.eq('from_source_id', parsed.data.fromSourceId)
    : q.eq('from_board_id', parsed.data.fromBoardId)
  const { data: existing, error: findErr } = await q.maybeSingle()
  if (findErr) {
    return { error: `Could not look up existing supply: ${findErr.message}` }
  }
  if (existing) return { supplyId: (existing as { id: string }).id }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      from_source_id: parsed.data.fromSourceId ?? null,
      from_board_id: parsed.data.fromBoardId ?? null,
      to_board_id: parsed.data.toBoardId,
      voltage_v: parsed.data.voltageV,
      design_load_a: parsed.data.designLoadA,
      section: parsed.data.section ?? null,
    })
    .select('id').single()
  if (error) return { error: error.message }
  return { supplyId: (data as { id: string }).id }
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

export async function deleteCableAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: c } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('revision_id, organisation_id, cable_no, supply_id')
    .eq('id', id)
    .single()
  const cable = c as { revision_id?: string; organisation_id?: string; cable_no?: number; supply_id?: string } | null
  if (!cable?.revision_id) return { error: 'Cable not found' }
  const guard = await assertDraft(supabase, cable.revision_id)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  await logDeletion(supabase, {
    revisionId: cable.revision_id,
    organisationId: cable.organisation_id!,
    entityType: 'cable',
    entityId: id,
    label: `Cable #${cable.cable_no ?? '?'}`,
    userId: user?.id ?? null,
  })
  // If that was the last cable on the supply, the run is now empty — remove it.
  if (cable.supply_id) {
    const { data: remaining } = await (supabase as any)
      .schema('cable_schedule').from('cables')
      .select('id').eq('supply_id', cable.supply_id).limit(1)
    if (!remaining || remaining.length === 0) {
      const { data: sup } = await (supabase as any)
        .schema('cable_schedule').from('supplies')
        .select('voltage_v, design_load_a').eq('id', cable.supply_id).single()
      const { error: supDelErr } = await (supabase as any)
        .schema('cable_schedule').from('supplies').delete().eq('id', cable.supply_id)
      // Only log the supply removal if the delete actually succeeded — an
      // FK / RLS / concurrent-insert failure must not be recorded as a deletion.
      if (!supDelErr) {
        await logDeletion(supabase, {
          revisionId: cable.revision_id,
          organisationId: cable.organisation_id!,
          entityType: 'supply',
          entityId: cable.supply_id,
          label: `Supply ${(sup as any)?.voltage_v ?? '?'}V / ${(sup as any)?.design_load_a ?? '?'}A (auto-removed: empty)`,
          userId: user?.id ?? null,
        })
      }
    }
  }
  revalidatePath(`/projects/${guard.projectId}/cables/${cable.revision_id}`)
  return { ok: true }
}

// ─── cable updates (C12) ─────────────────────────────────────────────

const updateCableSchema = z.object({
  cableId: uuid,
  sizeMm2: z.number().positive().optional(),
  cores: z.enum(['3', '3+E', '4']).optional(),
  conductor: z.enum(['CU', 'AL']).optional(),
  insulation: z.enum(['PVC', 'XLPE', 'PILC']).optional(),
  armour: z.enum(['SWA', 'UNARMOURED']).nullable().optional(),
  installationMethod: z.enum(['DIRECT_IN_GROUND', 'DUCT', 'LADDER', 'TRAY', 'CLIPPED']).nullable().optional(),
  depthMm: z.number().int().positive().nullable().optional(),
  groupedWith: z.number().int().positive().optional(),
  ambientTempC: z.number().optional(),
  measuredLengthM: z.number().nonnegative().nullable().optional(),
  ohmPerKmOverride: z.number().positive().nullable().optional(),
  tagOverride: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(
  (d) => {
    const sansSent = ['sizeMm2','cores','conductor','insulation','installationMethod','depthMm','groupedWith','ambientTempC']
      .some((f) => (d as Record<string, unknown>)[f] !== undefined)
    return !(sansSent && d.ohmPerKmOverride !== undefined)
  },
  { message: 'Cannot change a SANS-affecting field and the Ω/km override in the same call' },
)

// Note: thermal_resistivity_kmw also affects derating but is intentionally NOT
// editable in C12 (per spec §6.1) — recompute reads it from the existing row.
// fields whose change forces a SANS + derating re-lookup
const SANS_FIELDS = [
  'sizeMm2', 'cores', 'conductor', 'insulation',
  'installationMethod', 'depthMm', 'groupedWith', 'ambientTempC',
] as const

export async function updateCableAction(
  input: z.infer<typeof updateCableSchema>,
): Promise<{
  ok?: true
  error?: string
  recomputed?: { ohm_per_km: number | null; derated_current_rating_a: number | null }
}> {
  const parsed = updateCableSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: row } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, revision_id, organisation_id, size_mm2, cores, conductor, insulation, armour, ' +
      'installation_method, depth_mm, grouped_with, ambient_temp_c, thermal_resistivity_kmw, ' +
      'measured_length_m, measured_length_method, length_status, ohm_per_km, manual_override, tag_override, notes, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.cableId)
    .single()
  if (!row) return { error: 'Cable not found' }
  const c = row as any
  if (c.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, c.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  // Effective new values (input value if provided, else current).
  const next = {
    sizeMm2: parsed.data.sizeMm2 ?? Number(c.size_mm2),
    cores: parsed.data.cores ?? c.cores,
    conductor: parsed.data.conductor ?? c.conductor,
    insulation: parsed.data.insulation ?? c.insulation,
    installationMethod: parsed.data.installationMethod !== undefined
      ? parsed.data.installationMethod : c.installation_method,
    depthMm: parsed.data.depthMm !== undefined ? parsed.data.depthMm : c.depth_mm,
    groupedWith: parsed.data.groupedWith ?? Number(c.grouped_with ?? 1),
    ambientTempC: parsed.data.ambientTempC ?? Number(c.ambient_temp_c ?? 30),
  }

  const sansChanged = SANS_FIELDS.some((f) => parsed.data[f] !== undefined)

  const patch: Record<string, unknown> = {}
  const events: Array<Record<string, unknown>> = []
  const log = (field: string, oldV: unknown, newV: unknown) => {
    if (oldV === newV) return
    patch[field] = newV
    events.push({
      revision_id: c.revision_id, organisation_id: c.organisation_id,
      entity_type: 'cable', entity_id: c.id, field_name: field,
      old_value: oldV, new_value: newV, changed_by: user.id,
    })
  }

  if (parsed.data.sizeMm2 !== undefined) log('size_mm2', Number(c.size_mm2), parsed.data.sizeMm2)
  if (parsed.data.cores !== undefined) log('cores', c.cores, parsed.data.cores)
  if (parsed.data.conductor !== undefined) log('conductor', c.conductor, parsed.data.conductor)
  if (parsed.data.insulation !== undefined) log('insulation', c.insulation, parsed.data.insulation)
  if (parsed.data.armour !== undefined) log('armour', c.armour, parsed.data.armour)
  if (parsed.data.installationMethod !== undefined) log('installation_method', c.installation_method, parsed.data.installationMethod)
  if (parsed.data.depthMm !== undefined) log('depth_mm', c.depth_mm == null ? null : Number(c.depth_mm), parsed.data.depthMm)
  if (parsed.data.groupedWith !== undefined) log('grouped_with', Number(c.grouped_with ?? 1), parsed.data.groupedWith)
  if (parsed.data.ambientTempC !== undefined) log('ambient_temp_c', Number(c.ambient_temp_c ?? 30), parsed.data.ambientTempC)
  if (parsed.data.tagOverride !== undefined) log('tag_override', c.tag_override, parsed.data.tagOverride)
  if (parsed.data.notes !== undefined) log('notes', c.notes, parsed.data.notes)
  if (parsed.data.measuredLengthM !== undefined) {
    log('measured_length_m', c.measured_length_m == null ? null : Number(c.measured_length_m), parsed.data.measuredLengthM)
    // keep the status machine honest for the simple inline-cell path
    const newMethod = parsed.data.measuredLengthM != null ? 'MANUAL' : null
    log('measured_length_method', c.measured_length_method, newMethod)
    const newStatus = parsed.data.measuredLengthM != null
      ? (c.length_status === 'UNMEASURED' ? 'MEASURED' : c.length_status)
      : (c.length_status === 'MEASURED' ? 'UNMEASURED' : c.length_status)
    if (newStatus !== c.length_status) log('length_status', c.length_status, newStatus)
  }

  // Manual Ω/km override. A SANS-affecting change always clears the override.
  let recomputed: { ohm_per_km: number | null; derated_current_rating_a: number | null } | undefined
  if (sansChanged) {
    const props = await lookupCableProperties(supabase as any, {
      conductor: next.conductor, insulation: next.insulation,
      cores: next.cores, size_mm2: next.sizeMm2, projectId: c.revision.project_id,
    })
    const ohm = props?.ac_resistance ?? props?.dc_resistance ?? null
    // LADDER / TRAY / CLIPPED all fall through to the in-air rating (matches addCableAction).
    const baseRating =
      next.installationMethod === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
      : next.installationMethod === 'DUCT' ? props?.rating_in_duct
      : props?.rating_in_air
    const derate = await lookupDeratingFactors(supabase as any, {
      depth_mm: next.depthMm ?? 500,
      thermal_resistivity_kmw: Number(c.thermal_resistivity_kmw ?? 1.0),
      grouped_with: next.groupedWith,
      ambient_c: next.ambientTempC,
      insulation: next.insulation,
    })
    const deratedA = deratedRating(baseRating ?? null, {
      depth: derate.depth, thermal: derate.thermal,
      grouping: derate.grouping, temperature: derate.temperature,
    })
    log('ohm_per_km', c.ohm_per_km == null ? null : Number(c.ohm_per_km), ohm)
    patch.derate_depth = derate.depth
    patch.derate_thermal = derate.thermal
    patch.derate_grouping = derate.grouping
    patch.derate_temp = derate.temperature
    patch.derated_current_rating_a = deratedA
    patch.manual_override = false
    if (c.manual_override) log('manual_override', true, false)
    recomputed = { ohm_per_km: ohm, derated_current_rating_a: deratedA }
  } else if (parsed.data.ohmPerKmOverride !== undefined) {
    const ov = parsed.data.ohmPerKmOverride
    log('ohm_per_km', c.ohm_per_km == null ? null : Number(c.ohm_per_km), ov)
    patch.manual_override = ov != null
    if (!!c.manual_override !== (ov != null)) log('manual_override', !!c.manual_override, ov != null)
    // derated_current_rating_a stays null here = "unchanged"; the override doesn't
    // affect the derated rating. The caller treats null as "keep your cached value".
    recomputed = { ohm_per_km: ov, derated_current_rating_a: null }
  }

  if (events.length === 0 && Object.keys(patch).length === 0) return { ok: true }

  const { error } = await (supabase as any)
    .schema('cable_schedule').from('cables')
    .update(patch).eq('id', c.id)
  if (error) return { error: error.message }

  if (events.length > 0) {
    await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  }
  revalidatePath(`/projects/${c.revision.project_id}/cables/${c.revision_id}`)
  return { ok: true, recomputed }
}

// ─── re-pointing a run (C12) ─────────────────────────────────────────

const repointSchema = z.object({
  supplyId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid.optional(),
})

export async function repointSupplyAction(
  input: z.infer<typeof repointSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = repointSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: sup } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select(
      'id, revision_id, organisation_id, from_source_id, from_board_id, to_board_id, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.supplyId)
    .single()
  if (!sup) return { error: 'Supply not found' }
  const s = sup as any
  if (s.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, s.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  // Effective new origin/destination
  const nextFromSource = parsed.data.fromSourceId !== undefined ? parsed.data.fromSourceId : s.from_source_id
  const nextFromBoard = parsed.data.fromBoardId !== undefined ? parsed.data.fromBoardId : s.from_board_id
  const nextTo = parsed.data.toBoardId ?? s.to_board_id

  // XOR: exactly one origin
  if ((nextFromSource ? 1 : 0) + (nextFromBoard ? 1 : 0) !== 1) {
    return { error: 'Pick exactly one origin: a source OR a board.' }
  }
  if (!nextTo) return { error: 'A destination board is required.' }

  const patch = {
    from_source_id: nextFromSource ?? null,
    from_board_id: nextFromBoard ?? null,
    to_board_id: nextTo,
  }
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .update(patch).eq('id', s.id)
  if (error) return { error: error.message }

  const events: Array<Record<string, unknown>> = []
  const baseEvent = {
    revision_id: s.revision_id, organisation_id: s.organisation_id,
    entity_type: 'supply', entity_id: s.id, changed_by: user.id,
  }
  if ((s.from_source_id ?? null) !== patch.from_source_id) {
    events.push({ ...baseEvent, field_name: 'from_source_id', old_value: s.from_source_id, new_value: patch.from_source_id })
  }
  if ((s.from_board_id ?? null) !== patch.from_board_id) {
    events.push({ ...baseEvent, field_name: 'from_board_id', old_value: s.from_board_id, new_value: patch.from_board_id })
  }
  if (s.to_board_id !== patch.to_board_id) {
    events.push({ ...baseEvent, field_name: 'to_board_id', old_value: s.to_board_id, new_value: patch.to_board_id })
  }
  if (events.length > 0) {
    await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  }
  revalidatePath(`/projects/${s.revision.project_id}/cables/${s.revision_id}`)
  return { ok: true }
}

// ─── rename actions (C12 — NodesPanel) ──────────────────────────────

const renameSchema = z.object({ id: uuid, code: z.string().trim().min(1).max(80) })

export async function renameSourceAction(id: string, code: string): Promise<{ ok?: true; error?: string }> {
  const parsed = renameSchema.safeParse({ id, code })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: src } = await (supabase as any)
    .schema('cable_schedule').from('sources')
    .select('revision_id, organisation_id, code').eq('id', id).single()
  const s = src as { revision_id?: string; organisation_id?: string; code?: string } | null
  if (!s?.revision_id) return { error: 'Source not found' }
  const guard = await assertDraft(supabase, s.revision_id)
  if ('error' in guard) return { error: guard.error }
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('sources').update({ code: parsed.data.code }).eq('id', id)
  if (error) return { error: error.message }
  await (supabase as any).schema('cable_schedule').from('change_log').insert({
    revision_id: s.revision_id, organisation_id: s.organisation_id,
    entity_type: 'source', entity_id: id, field_name: 'code',
    old_value: s.code, new_value: parsed.data.code, changed_by: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${s.revision_id}`)
  return { ok: true }
}

export async function renameBoardAction(id: string, code: string): Promise<{ ok?: true; error?: string }> {
  const parsed = renameSchema.safeParse({ id, code })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: brd } = await (supabase as any)
    .schema('cable_schedule').from('boards')
    .select('revision_id, organisation_id, code').eq('id', id).single()
  const b = brd as { revision_id?: string; organisation_id?: string; code?: string } | null
  if (!b?.revision_id) return { error: 'Board not found' }
  const guard = await assertDraft(supabase, b.revision_id)
  if ('error' in guard) return { error: guard.error }
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('boards').update({ code: parsed.data.code }).eq('id', id)
  if (error) return { error: error.message }
  await (supabase as any).schema('cable_schedule').from('change_log').insert({
    revision_id: b.revision_id, organisation_id: b.organisation_id,
    entity_type: 'board', entity_id: id, field_name: 'code',
    old_value: b.code, new_value: parsed.data.code, changed_by: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${b.revision_id}`)
  return { ok: true }
}
