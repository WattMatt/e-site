'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

interface RateLibraryEntry {
  id: string
  project_id: string
  organisation_id: string
  size_mm2: number
  conductor: 'CU' | 'AL'
  supply_rate_per_m: number
  install_rate_per_m: number
  termination_rate_each: number
  notes: string | null
  updated_at: string
  updated_by: string | null
}

interface UpsertInput {
  // id present when updating an existing row; absent when inserting a new one
  id?: string
  size_mm2: number
  conductor: 'CU' | 'AL'
  supply_rate_per_m: number
  install_rate_per_m: number
  termination_rate_each: number
  notes?: string | null
}

/**
 * Fetch all rate-library entries for a project.
 *
 * The rate library is per-project (migration 00092 — re-scoped from the
 * old firm-wide model). RLS gates the read. Sorted by size ascending,
 * then conductor alphabetical (AL before CU at the same size).
 */
export async function listRateLibraryAction(
  projectId: string,
): Promise<{ ok: true; entries: RateLibraryEntry[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('id, project_id, organisation_id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each, notes, updated_at, updated_by')
    .eq('project_id', projectId)
    .order('size_mm2', { ascending: true })
    .order('conductor', { ascending: true })

  if (error) return { ok: false, error: `Failed to load rate library: ${error.message}` }
  return { ok: true, entries: (data ?? []) as RateLibraryEntry[] }
}

/**
 * Bulk upsert rate-library entries for a project.
 *
 * - Each entry validated: size_mm2 > 0, conductor in ('CU','AL'), all
 *   rates >= 0
 * - UPSERT via PostgREST upsert(onConflict: 'project_id,size_mm2,conductor')
 *   so inserts and updates flow through the same path
 * - updated_at + updated_by set automatically on every write
 * - organisation_id is resolved from the project and stored denormalised
 *   (the RLS policies key off it — see migrations 00063 + 00092)
 * - requireRole + RLS restrict writes to owner/admin/project_manager
 */
export async function upsertRateLibraryEntriesAction(
  projectId: string,
  entries: UpsertInput[],
): Promise<{ ok: true; upserted: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // Resolve the project's organisation — needed for the role gate and for
  // the denormalised organisation_id column the RLS policies read.
  const { data: projRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  const organisationId = (projRow as { organisation_id?: string } | null)?.organisation_id
  if (!organisationId) return { ok: false, error: 'Project not found' }

  // C12: role gate — defense-in-depth alongside the RLS policies.
  const roleCheck = await requireRole(supabase, organisationId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  // Validate
  for (const e of entries) {
    if (!(e.size_mm2 > 0)) {
      return { ok: false, error: `Size must be > 0 (got ${e.size_mm2})` }
    }
    if (e.conductor !== 'CU' && e.conductor !== 'AL') {
      return { ok: false, error: `Conductor must be CU or AL (got ${e.conductor})` }
    }
    if (e.supply_rate_per_m < 0 || e.install_rate_per_m < 0 || e.termination_rate_each < 0) {
      return { ok: false, error: 'Rates must be >= 0' }
    }
  }

  // Build upsert payload
  const now = new Date().toISOString()
  const rows = entries.map((e) => ({
    ...(e.id ? { id: e.id } : {}),
    project_id: projectId,
    organisation_id: organisationId,
    size_mm2: e.size_mm2,
    conductor: e.conductor,
    supply_rate_per_m: e.supply_rate_per_m,
    install_rate_per_m: e.install_rate_per_m,
    termination_rate_each: e.termination_rate_each,
    notes: e.notes ?? null,
    updated_at: now,
    updated_by: user.id,
  }))

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .upsert(rows, { onConflict: 'project_id,size_mm2,conductor' })
    .select('id')

  if (error) return { ok: false, error: `Upsert failed: ${error.message}` }

  revalidatePath(`/projects/${projectId}/cables/rates`)
  return { ok: true, upserted: (data ?? []).length }
}

/**
 * Delete a single rate-library entry by id.
 *
 * requireRole + RLS enforce role gating. Existing cost_lines on revisions
 * are NOT affected — those are per-revision snapshots.
 */
export async function deleteRateLibraryEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // Resolve org + project from the row, then role-gate.
  const { data: row } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('organisation_id, project_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { ok: false, error: 'Rate-library entry not found' }
  const r = row as { organisation_id: string; project_id: string }
  const roleCheck = await requireRole(supabase, r.organisation_id, ROLES_ENGINEER)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .delete()
    .eq('id', id)

  if (error) return { ok: false, error: `Delete failed: ${error.message}` }

  revalidatePath(`/projects/${r.project_id}/cables/rates`)
  return { ok: true }
}
