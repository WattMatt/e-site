'use server'

/**
 * db-legend.actions.ts — server actions for tenant DB legend cards
 * (structure.node_circuits + tenant_details header columns, migration 00169).
 *
 *   - upsertCircuitAction       — insert (no id) or update (id) one circuit row
 *   - deleteCircuitAction       — remove a circuit row
 *   - quickAddWaysAction        — bulk-create N sequentially-numbered spare ways
 *   - updateLegendHeaderAction  — patch the card-header fields on tenant_details
 *
 * Cross-schema write pattern (CLAUDE.md gotcha): supabase-js .schema('structure')
 * writes silently strip the service-role auth header → raw fetch to PostgREST
 * with Content-Profile: structure. Reads via the cookie client are safe.
 * Writes bypass RLS (service role), so guardProjectAccess enforces the
 * ORG_WRITE_ROLES effective-role gate in app code.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, planQuickAddWays, QUICK_ADD_MAX, ORG_WRITE_ROLES } from '@esite/shared'
import type { LegendCircuit } from '@esite/shared'

// ---------------------------------------------------------------------------
// PostgREST helpers (module-local, mirroring tenant-scope.actions.ts)
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string, extraPrefer?: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: extraPrefer ? `${extraPrefer}, return=representation` : 'return=representation',
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: unknown,
  queryString = '',
  extraPrefer?: string,
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  const url = `${supabaseUrl}/rest/v1/${table}${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: structureHeaders(serviceKey, extraPrefer),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, status: res.status, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: await res.json() }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, status: res.status, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
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
    headers: structureHeaders(serviceKey),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Guards (module-local, mirroring tenant-scope.actions.ts)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

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

  // Writes use the service-role key (bypasses RLS) — enforce the write-role
  // gate in app code. requireEffectiveRole honours per-project promotion (00107).
  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: roleGate.error }

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
  if (!node) return { error: 'Node not found' }
  return null
}

// ---------------------------------------------------------------------------
// upsertCircuitAction
// ---------------------------------------------------------------------------

const circuitInputSchema = z.object({
  id: uuidSchema.optional(),
  circuit_no: z.string().trim().min(1, 'Circuit number is required').max(20),
  description: z.string().trim().max(200).nullish(),
  phase: z.enum(['L1', 'L2', 'L3', '3P']).nullish(),
  breaker_rating_a: z.number().positive().max(6300).nullish(),
  poles: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullish(),
  curve: z.enum(['B', 'C', 'D']).nullish(),
  cable_size: z.string().trim().max(60).nullish(),
  is_spare: z.boolean(),
})

export type CircuitInput = z.input<typeof circuitInputSchema>
export type UpsertCircuitResult = { ok: true; circuit: LegendCircuit } | { error: string }

export async function upsertCircuitAction(
  projectId: string,
  nodeId: string,
  input: CircuitInput,
): Promise<UpsertCircuitResult> {
  const ids = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!ids.success) return { error: 'Invalid input' }
  const parsed = circuitInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const { id, ...fields } = parsed.data
  const row = {
    circuit_no: fields.circuit_no,
    description: fields.description ?? null,
    phase: fields.phase ?? null,
    breaker_rating_a: fields.breaker_rating_a ?? null,
    poles: fields.poles ?? null,
    curve: fields.curve ?? null,
    cable_size: fields.cable_size ?? null,
    is_spare: fields.is_spare,
  }

  if (id) {
    // UPDATE — scoped by id AND node_id (defence in depth).
    const res = await structurePatch(
      supabaseUrl,
      serviceKey,
      'node_circuits',
      `id=eq.${id}&node_id=eq.${nodeId}`,
      row,
    )
    if (!res.ok) {
      if (res.status === 409) return { error: `Circuit ${row.circuit_no} already exists on this board` }
      return { error: res.error ?? 'Failed to update circuit' }
    }
    revalidatePath(`/projects/${projectId}/tenant-schedule`)
    // sort_order: 0 here is a placeholder that does NOT reflect the DB row — callers must not use it to reposition rows (the panel only reads `.id`).
    return { ok: true, circuit: { id, node_id: nodeId, sort_order: 0, ...row } as LegendCircuit }
  }

  // INSERT — sort_order continues after the node's current maximum.
  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: Array<{ sort_order: number }> | null }> }
      }
    }
  })
    .schema('structure')
    .from('node_circuits')
    .select('sort_order')
    .eq('node_id', nodeId)
  const maxSort = (existing ?? []).reduce((m, r) => Math.max(m, r.sort_order), 0)

  const res = await structurePost(supabaseUrl, serviceKey, 'node_circuits', {
    node_id: nodeId,
    sort_order: maxSort + 1,
    ...row,
  })
  if (!res.ok) {
    if (res.status === 409) return { error: `Circuit ${row.circuit_no} already exists on this board` }
    return { error: res.error ?? 'Failed to add circuit' }
  }

  const rows = res.data as LegendCircuit[]
  const circuit = rows?.[0]
  if (!circuit) return { error: 'INSERT returned no row' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, circuit }
}

// ---------------------------------------------------------------------------
// deleteCircuitAction
// ---------------------------------------------------------------------------

export type DeleteCircuitResult = { ok: true } | { error: string }

export async function deleteCircuitAction(
  projectId: string,
  nodeId: string,
  circuitId: string,
): Promise<DeleteCircuitResult> {
  const ids = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, circuitId: uuidSchema })
    .safeParse({ projectId, nodeId, circuitId })
  if (!ids.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const res = await structureDelete(
    supabaseUrl,
    serviceKey,
    'node_circuits',
    `id=eq.${circuitId}&node_id=eq.${nodeId}`,
  )
  if (!res.ok) return { error: res.error ?? 'Failed to delete circuit' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// quickAddWaysAction
// ---------------------------------------------------------------------------

export type QuickAddWaysResult = { ok: true; circuits: LegendCircuit[] } | { error: string }

/**
 * Bulk-create `count` sequentially-numbered ways. New rows default to spare
 * (is_spare=true, blank description) so an untouched way still prints honestly
 * as SPARE on the card.
 */
export async function quickAddWaysAction(
  projectId: string,
  nodeId: string,
  count: number,
): Promise<QuickAddWaysResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, count: z.number().int().min(1).max(QUICK_ADD_MAX) })
    .safeParse({ projectId, nodeId, count })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Existing numbers + sort_order — cookie-client read (RLS-gated).
  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => PromiseLike<{ data: Array<{ circuit_no: string; sort_order: number }> | null }>
        }
      }
    }
  })
    .schema('structure')
    .from('node_circuits')
    .select('circuit_no, sort_order')
    .eq('node_id', nodeId)

  const rows = existing ?? []
  const numbers = planQuickAddWays(rows.map((r) => r.circuit_no), count)
  const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)

  const payload = numbers.map((circuit_no, i) => ({
    node_id: nodeId,
    circuit_no,
    is_spare: true,
    sort_order: maxSort + 1 + i,
  }))

  // Concurrent quick-adds on the same board can 409 on UNIQUE(node_id, circuit_no); the whole batch aborts with a retryable message — a deliberate, weaker guard than tenant-scope.actions.ts's ignore-duplicates pattern (single-editor UI, no data loss).
  const res = await structurePost(supabaseUrl, serviceKey, 'node_circuits', payload)
  if (!res.ok) {
    if (res.status === 409) return { error: 'Some of the generated circuit numbers already exist — renumber or delete the clashing ways first' }
    return { error: res.error ?? 'Failed to add ways' }
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, circuits: (res.data as LegendCircuit[]) ?? [] }
}

// ---------------------------------------------------------------------------
// updateLegendHeaderAction
// ---------------------------------------------------------------------------

const legendHeaderSchema = z
  .object({
    db_location: z.string().trim().max(120).nullish(),
    db_fed_from: z.string().trim().max(120).nullish(),
    db_earth_leakage_ma: z.number().positive().max(10000).nullish(),
    legend_card_size: z.enum(['A4', 'A5']).optional(),
  })
  .strip() // unknown keys silently dropped — never forwarded to the DB

export type LegendHeaderPatch = z.input<typeof legendHeaderSchema>
export type UpdateLegendHeaderResult = { ok: true } | { error: string }

/**
 * Upsert the card-header fields on tenant_details. PostgREST only turns this
 * into an ON CONFLICT upsert when `Prefer: resolution=merge-duplicates` is
 * sent — `on_conflict=node_id` alone just names the conflict target and does
 * NOT enable upsert, so without the header this 409s on every tenant that
 * already has a tenant_details row (i.e. nearly all of them). The payload
 * stays partial so untouched tenant_details columns (scope_status etc.) are
 * preserved on merge — same pattern as setScopeNotRequiredAction.
 */
export async function updateLegendHeaderAction(
  projectId: string,
  nodeId: string,
  patch: LegendHeaderPatch,
): Promise<UpdateLegendHeaderResult> {
  const ids = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!ids.success) return { error: 'Invalid input' }
  const parsed = legendHeaderSchema.safeParse(patch)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  // Drop undefined keys so the upsert only touches supplied fields.
  const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (Object.keys(fields).length === 0) return { error: 'Nothing to update' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const res = await structurePost(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    { node_id: nodeId, ...fields },
    'on_conflict=node_id',
    'resolution=merge-duplicates',
  )
  if (!res.ok) return { error: res.error ?? 'Failed to update legend details' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}
