'use server'

/**
 * equipment.actions.ts — server actions for the Equipment Schedule module.
 *
 * Covers:
 *   - createEquipmentNodeAction    — add a new equipment node to a project
 *   - editEquipmentNodeAction      — update code/name/coc_required on an existing node
 *   - decommissionEquipmentNodeAction — set status='decommissioned', store reason in notes
 *   - reactivateEquipmentNodeAction   — set status='active', clear decommission notes
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha):
 *   supabase-js `.schema('structure').from(...).insert()/.update()` silently strips
 *   the service-role auth header → RLS denies. All writes to structure.nodes use
 *   raw fetch to PostgREST with Content-Profile: structure + service-role key.
 *   Reads go through the cookie-authenticated supabase-js client as normal.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import type { EquipmentKind } from '@esite/shared'

// ---------------------------------------------------------------------------
// PostgREST helpers — mirrors tenant-scope.actions.ts pattern exactly
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=representation',
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: await res.json() }
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
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Auth + project-access guard — mirrors tenant-scope.actions.ts
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

/** Returns { user, orgId, supabase } or { error: string } */
async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined }
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

/**
 * Validate that nodeId belongs to projectId.
 * Reads through .schema('structure') SELECT are safe (gotcha applies to writes only).
 */
async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!node) return { error: 'Node not found or does not belong to this project' }
  return null
}

// ---------------------------------------------------------------------------
// Action: createEquipmentNodeAction
// ---------------------------------------------------------------------------

const createEquipmentSchema = z.object({
  projectId: uuidSchema,
  kind: z.enum(['main_board', 'common_area_board', 'rmu', 'mini_sub', 'generator']),
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().max(120).optional(),
  coc_required: z.boolean(),
})

export type CreateEquipmentResult = { error: string } | { id: string }

export async function createEquipmentNodeAction(
  projectId: string,
  kind: EquipmentKind,
  code: string,
  name: string,
  coc_required: boolean,
): Promise<CreateEquipmentResult> {
  const parsed = createEquipmentSchema.safeParse({ projectId, kind, code, name, coc_required })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const body: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: guard.orgId,
    kind,
    code: code.trim(),
    name: name.trim() || null,
    coc_required,
    status: 'active',
    created_by: (guard.user as { id?: string }).id ?? null,
  }

  const result = await structurePost(supabaseUrl, serviceKey, 'nodes', body)
  if (!result.ok) {
    // Friendly message for unique-constraint violation
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to create equipment node' }
  }

  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  const rows = result.data as Array<{ id: string }>
  return { id: rows[0]?.id ?? '' }
}

// ---------------------------------------------------------------------------
// Action: editEquipmentNodeAction
// ---------------------------------------------------------------------------

const editEquipmentSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().max(120).optional(),
  coc_required: z.boolean(),
})

export type EditEquipmentResult = { error: string } | { ok: true }

export async function editEquipmentNodeAction(
  projectId: string,
  nodeId: string,
  code: string,
  name: string,
  coc_required: boolean,
): Promise<EditEquipmentResult> {
  const parsed = editEquipmentSchema.safeParse({ projectId, nodeId, code, name, coc_required })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const result = await structurePatch(supabaseUrl, serviceKey, 'nodes', `id=eq.${nodeId}`, {
    code: code.trim(),
    name: name.trim() || null,
    coc_required,
  })
  if (!result.ok) {
    if (result.error?.includes('unique') || result.error?.includes('duplicate')) {
      return { error: `Code "${code}" is already in use on this project.` }
    }
    return { error: result.error ?? 'Failed to update equipment node' }
  }

  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Action: decommissionEquipmentNodeAction
// ---------------------------------------------------------------------------

const decommissionSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  reason: z.string().max(500).optional(),
})

export type DecommissionEquipmentResult = { error: string } | { ok: true }

export async function decommissionEquipmentNodeAction(
  projectId: string,
  nodeId: string,
  reason?: string,
): Promise<DecommissionEquipmentResult> {
  const parsed = decommissionSchema.safeParse({ projectId, nodeId, reason })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const patch: Record<string, unknown> = { status: 'decommissioned' }
  if (reason && reason.trim()) {
    patch.notes = `[Decommissioned] ${reason.trim()}`
  }

  const result = await structurePatch(supabaseUrl, serviceKey, 'nodes', `id=eq.${nodeId}`, patch)
  if (!result.ok) return { error: result.error ?? 'Failed to decommission node' }

  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Action: reactivateEquipmentNodeAction
// ---------------------------------------------------------------------------

export type ReactivateEquipmentResult = { error: string } | { ok: true }

export async function reactivateEquipmentNodeAction(
  projectId: string,
  nodeId: string,
): Promise<ReactivateEquipmentResult> {
  const parsed = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const result = await structurePatch(supabaseUrl, serviceKey, 'nodes', `id=eq.${nodeId}`, {
    status: 'active',
    notes: null,
  })
  if (!result.ok) return { error: result.error ?? 'Failed to reactivate node' }

  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  return { ok: true }
}
