'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

interface RateLibraryEntry {
  id: string
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
 * Fetch all rate-library entries for an organisation.
 *
 * RLS gates the read — non-members see an empty array. Sorted by size
 * ascending, then conductor alphabetical (AL before CU at same size).
 */
export async function listRateLibraryAction(
  organisationId: string,
): Promise<{ ok: true; entries: RateLibraryEntry[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('id, organisation_id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each, notes, updated_at, updated_by')
    .eq('organisation_id', organisationId)
    .order('size_mm2', { ascending: true })
    .order('conductor', { ascending: true })

  if (error) return { ok: false, error: `Failed to load rate library: ${error.message}` }
  return { ok: true, entries: (data ?? []) as RateLibraryEntry[] }
}

/**
 * Bulk upsert rate-library entries.
 *
 * - Each entry validated: size_mm2 > 0, conductor in ('CU','AL'), all
 *   rates >= 0
 * - Per-row UPSERT via PostgREST upsert(onConflict: 'organisation_id,size_mm2,conductor')
 *   so inserts and updates flow through the same path
 * - updated_at + updated_by set automatically on every write
 * - RLS enforces role gating (owner/admin/project_manager only)
 */
export async function upsertRateLibraryEntriesAction(
  organisationId: string,
  entries: UpsertInput[],
): Promise<{ ok: true; upserted: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — defense-in-depth alongside RLS policies (migration 00063).
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
    .upsert(rows, { onConflict: 'organisation_id,size_mm2,conductor' })
    .select('id')

  if (error) return { ok: false, error: `Upsert failed: ${error.message}` }

  revalidatePath('/settings/cable-schedule/rates')
  return { ok: true, upserted: (data ?? []).length }
}

/**
 * Delete a single rate-library entry by id.
 *
 * RLS enforces role gating. Engineers can prune stale rows (e.g. a
 * cable size their firm no longer stocks). Existing cost_lines on
 * revisions are NOT affected — those are per-revision snapshots.
 */
export async function deleteRateLibraryEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — resolve org from the row, then check.
  const { data: row } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('organisation_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { ok: false, error: 'Rate-library entry not found' }
  const roleCheck = await requireRole(
    supabase,
    (row as { organisation_id: string }).organisation_id,
    ROLES_ENGINEER,
  )
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .delete()
    .eq('id', id)

  if (error) return { ok: false, error: `Delete failed: ${error.message}` }

  revalidatePath('/settings/cable-schedule/rates')
  return { ok: true }
}
