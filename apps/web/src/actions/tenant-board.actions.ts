'use server'

/**
 * tenant-board.actions.ts — create sub-boards / concessions / units under an
 * anchor in the Tenant Schedule. Mirrors equipment.actions.ts: all structure
 * writes go through raw PostgREST (Content-Profile: structure + service key),
 * never supabase-js `.schema('structure').insert()` (which strips service auth).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService, deriveEquipmentNodeOrder } from '@esite/shared'

// ── PostgREST helpers (mirror equipment.actions.ts / tenant-scope.actions.ts) ──

function structureHeaders(serviceKey: string, ret: 'representation' | 'minimal' = 'representation'): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: `return=${ret}`,
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
  ret: 'representation' | 'minimal' = 'representation',
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey, ret),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: ret === 'representation' ? await res.json() : undefined }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey, 'minimal'),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

async function structureDelete(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: structureHeaders(serviceKey, 'minimal'),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ── Guards (mirror equipment.actions.ts) ──

const uuidSchema = z.string().uuid()

async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined; user?: undefined }
  | { error?: undefined; user: object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }
  return { user, orgId: project.organisation_id as string, supabase }
}

async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Node not found or does not belong to this project' }
  return null
}

/** Resolve a tenant_units row's owning project (tenant_units is not in the generated
 *  types, so the structure read is cast — same pattern as the inspections schema). */
async function guardUnitBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: unit } = await (supabase as unknown as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { node_id: string } | null }> } }
      }
    }
  })
    .schema('structure')
    .from('tenant_units')
    .select('node_id')
    .eq('id', unitId)
    .maybeSingle()
  if (!unit) return { error: 'Unit not found' }
  return guardNodeBelongsToProject(supabase, unit.node_id, projectId)
}

function serverEnv(): { serviceKey: string; supabaseUrl: string } | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return null
  return { serviceKey, supabaseUrl }
}

const TENANT_SCHEDULE_PATH = (projectId: string) => `/projects/${projectId}/tenant-schedule`

export type CreateNodeResult = { error: string } | { id: string }

// ── createSubBoardAction ──

const createSubBoardSchema = z.object({
  projectId: uuidSchema,
  parentNodeId: uuidSchema,
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().max(120).optional(),
  breakerRatingA: z.number().positive().nullable().optional(),
  section: z.enum(['NORMAL', 'EMERGENCY', 'MIXED']).nullable().optional(),
  cocRequired: z.boolean().optional(),
})

export async function createSubBoardAction(
  projectId: string,
  parentNodeId: string,
  code: string,
  name: string = '',
  breakerRatingA: number | null = null,
  section: string | null = null,
  cocRequired: boolean = false,
): Promise<CreateNodeResult> {
  const parsed = createSubBoardSchema.safeParse({ projectId, parentNodeId, code, name, breakerRatingA, section, cocRequired })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const parentGuard = await guardNodeBelongsToProject(guard.supabase, parentNodeId, projectId)
  if (parentGuard) return { error: 'Parent board not found in this project' }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const body: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: guard.orgId,
    kind: 'sub_board',
    parent_node_id: parentNodeId,
    code: code.trim(),
    name: name.trim() || null,
    breaker_rating_a: breakerRatingA,
    section,
    coc_required: cocRequired,
    status: 'active',
    created_by: (guard.user as { id?: string }).id ?? null,
  }

  const result = await structurePost(env.supabaseUrl, env.serviceKey, 'nodes', body)
  if (!result.ok) {
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to create sub-board' }
  }

  const nodeId = (result.data as Array<{ id: string }>)[0]?.id ?? ''
  if (nodeId) {
    const orderPayload = deriveEquipmentNodeOrder(nodeId, projectId, guard.orgId, code.trim())
    const orderRes = await structurePost(env.supabaseUrl, env.serviceKey, 'node_orders', orderPayload as unknown as Record<string, unknown>, 'minimal')
    if (!orderRes.ok) {
      revalidatePath(TENANT_SCHEDULE_PATH(projectId))
      return { error: `Sub-board created but order derivation failed: ${orderRes.error}` }
    }
  }

  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { id: nodeId }
}

// ── createConcessionAction ──

const createConcessionSchema = z.object({
  projectId: uuidSchema,
  parentNodeId: uuidSchema,
  shopNumber: z.string().min(1, 'Shop number is required').max(50),
  shopName: z.string().max(120).optional(),
  code: z.string().min(1, 'Code is required').max(50),
})

export async function createConcessionAction(
  projectId: string,
  parentNodeId: string,
  shopNumber: string,
  shopName: string = '',
  code: string = '',
): Promise<CreateNodeResult> {
  const parsed = createConcessionSchema.safeParse({ projectId, parentNodeId, shopNumber, shopName, code })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const parentGuard = await guardNodeBelongsToProject(guard.supabase, parentNodeId, projectId)
  if (parentGuard) return { error: 'Parent (anchor) not found in this project' }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const body: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: guard.orgId,
    kind: 'tenant_db',
    parent_node_id: parentNodeId,
    shop_number: shopNumber.trim(),
    shop_name: shopName.trim() || null,
    code: code.trim(),
    status: 'active',
    created_by: (guard.user as { id?: string }).id ?? null,
  }

  const result = await structurePost(env.supabaseUrl, env.serviceKey, 'nodes', body)
  if (!result.ok) {
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to create concession' }
  }

  const nodeId = (result.data as Array<{ id: string }>)[0]?.id ?? ''
  if (nodeId) {
    const detailsRes = await structurePost(env.supabaseUrl, env.serviceKey, 'tenant_details', { node_id: nodeId }, 'minimal')
    if (!detailsRes.ok) {
      revalidatePath(TENANT_SCHEDULE_PATH(projectId))
      return { error: `Concession created but tenant-details init failed: ${detailsRes.error}` }
    }
  }

  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { id: nodeId }
}

// ── tenant_units CRUD ──

export type UnitResult = { error: string } | { ok: true }

const addUnitSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  shopNumber: z.string().max(50).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
})

export async function addTenantUnitAction(
  projectId: string,
  nodeId: string,
  shopNumber: string | null = null,
  areaM2: number | null = null,
): Promise<UnitResult> {
  const parsed = addUnitSchema.safeParse({ projectId, nodeId, shopNumber, areaM2 })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const nodeGuard = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeGuard) return { error: nodeGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structurePost(
    env.supabaseUrl,
    env.serviceKey,
    'tenant_units',
    { node_id: nodeId, shop_number: shopNumber?.trim() || null, area_m2: areaM2 },
    'minimal',
  )
  if (!res.ok) return { error: res.error ?? 'Failed to add unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}

const updateUnitSchema = z.object({
  projectId: uuidSchema,
  unitId: uuidSchema,
  shopNumber: z.string().max(50).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
})

export async function updateTenantUnitAction(
  projectId: string,
  unitId: string,
  shopNumber: string | null = null,
  areaM2: number | null = null,
): Promise<UnitResult> {
  const parsed = updateUnitSchema.safeParse({ projectId, unitId, shopNumber, areaM2 })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const unitGuard = await guardUnitBelongsToProject(guard.supabase, unitId, projectId)
  if (unitGuard) return { error: unitGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structurePatch(env.supabaseUrl, env.serviceKey, 'tenant_units', `id=eq.${unitId}`, {
    shop_number: shopNumber?.trim() || null,
    area_m2: areaM2,
  })
  if (!res.ok) return { error: res.error ?? 'Failed to update unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}

export async function deleteTenantUnitAction(projectId: string, unitId: string): Promise<UnitResult> {
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(unitId).success) {
    return { error: 'Invalid input' }
  }
  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }
  const unitGuard = await guardUnitBelongsToProject(guard.supabase, unitId, projectId)
  if (unitGuard) return { error: unitGuard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const res = await structureDelete(env.supabaseUrl, env.serviceKey, 'tenant_units', `id=eq.${unitId}`)
  if (!res.ok) return { error: res.error ?? 'Failed to delete unit' }
  revalidatePath(TENANT_SCHEDULE_PATH(projectId))
  return { ok: true }
}
