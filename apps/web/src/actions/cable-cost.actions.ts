'use server'

/**
 * Cable cost summary — server actions.
 *
 * Per spec §9 the cost summary is per-size lines with editable supply +
 * install rates and a per-cable-end termination rate, plus
 * contingency % + VAT % on the revision. Length totals are recomputed
 * from the imported cables — never typed by hand.
 *
 * On a fresh revision there are no cost_lines until the user opens the
 * cost page; ensureCostLinesAction creates blank rows for every size
 * present in the revision's cables so the engineer has somewhere to type.
 *
 * Phase-1 simplification: contingency + VAT live on a special "size = 0"
 * cost_lines row keyed by size_mm2 = 0. That keeps the schema flat
 * (one table) at the cost of a small bit of indirection in the UI.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRoleForRevision, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

const uuid = z.string().uuid()
const RATES_HEADER_SIZE = 0          // sentinel row for revision-level rates

export async function ensureCostLinesAction(
  revisionId: string,
): Promise<{ created?: number; error?: string }> {
  if (!uuid.safeParse(revisionId).success) return { error: 'Invalid revision id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — only engineers can ensure cost lines.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, organisation_id, project_id, status')
    .eq('id', revisionId)
    .single()
  if (!rev) return { error: 'Revision not found' }
  if ((rev as any).status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — cost lines are read-only.' }
  }
  const r = rev as { id: string; organisation_id: string; project_id: string }

  // Distinct (size, conductor) tuples from cables in the revision.
  // Pre-migration-00061 schema only has `size_mm2` keyed UNIQUE — tolerant
  // fallback below ensures the action works either side of that migration.
  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('size_mm2, conductor')
    .eq('revision_id', revisionId)
  type Tuple = { size: number; conductor: 'CU' | 'AL' }
  const tuples = new Map<string, Tuple>()
  for (const c of (cables ?? []) as Array<{ size_mm2: number; conductor: 'CU' | 'AL' }>) {
    const size = Number(c.size_mm2)
    if (size <= 0) continue
    const conductor: 'CU' | 'AL' = c.conductor === 'AL' ? 'AL' : 'CU'
    tuples.set(`${size}|${conductor}`, { size, conductor })
  }
  // VAT moved off the sentinel row to revisions.vat_pct (migration 00060).
  // Contingency removed entirely (2026-05-17).

  // Existing cost lines — read both size_mm2 + conductor. Pre-migration
  // -00061 schema doesn't have conductor; fallback to size-only matching
  // (treat existing rows as 'CU' implicitly, matching the migration backfill).
  let have: Set<string>
  const withConductor = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .select('size_mm2, conductor')
    .eq('revision_id', revisionId)
  if (withConductor.error) {
    // Pre-migration schema — fall back to size-only and treat all as CU.
    const sizeOnly = await (supabase as any)
      .schema('cable_schedule')
      .from('cost_lines')
      .select('size_mm2')
      .eq('revision_id', revisionId)
    have = new Set(((sizeOnly.data ?? []) as Array<{ size_mm2: number }>).map((e) => `${Number(e.size_mm2)}|CU`))
  } else {
    have = new Set(((withConductor.data ?? []) as Array<{ size_mm2: number; conductor: 'CU' | 'AL' }>)
      .map((e) => `${Number(e.size_mm2)}|${e.conductor === 'AL' ? 'AL' : 'CU'}`))
  }

  const missing = [...tuples.values()].filter((t) => !have.has(`${t.size}|${t.conductor}`))
  if (missing.length === 0) return { created: 0 }

  // Pre-migration-00061: schema has no conductor column. Insert without
  // it (the old UNIQUE on (revision, size) will block dup CU+AL pairs
  // anyway, so we collapse to size-only insert in the legacy branch).
  const preMigration = !!withConductor.error
  const rows = preMigration
    ? Array.from(new Set(missing.map((t) => t.size))).map((size) => ({
        revision_id: revisionId,
        organisation_id: r.organisation_id,
        size_mm2: size,
        supply_rate_per_m: 0,
        install_rate_per_m: 0,
        termination_rate_each: 0,
        contingency_pct: null,
        vat_pct: null,
      }))
    : missing.map((t) => ({
        revision_id: revisionId,
        organisation_id: r.organisation_id,
        size_mm2: t.size,
        conductor: t.conductor,
        supply_rate_per_m: 0,
        install_rate_per_m: 0,
        termination_rate_each: 0,
        contingency_pct: null,
        vat_pct: null,
      }))
  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .insert(rows)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${r.project_id}/cables/${revisionId}/cost`)
  return { created: rows.length }
}

const updateRateSchema = z.object({
  id: uuid,
  supplyRatePerM: z.number().nonnegative().optional(),
  installRatePerM: z.number().nonnegative().optional(),
  terminationRateEach: z.number().nonnegative().optional(),
  // contingencyPct removed 2026-05-17 — net contracts have no contingency.
  // vatPct removed 2026-05-18 — VAT moved to revisions.vat_pct (migration
  //   00060). DB columns on cost_lines kept for archived revisions; new
  //   writes never set either.
})

export async function updateCostLineAction(
  input: z.infer<typeof updateRateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateRateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — only engineers can edit rates. Resolve revisionId
  // from the cost_line being updated.
  const { data: costLine } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .select('revision_id')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!costLine) return { error: 'Cost line not found' }
  const roleCheck = await requireRoleForRevision(
    supabase,
    (costLine as { revision_id: string }).revision_id,
    ROLES_ENGINEER,
  )
  if (!roleCheck.ok) return { error: roleCheck.error }

  const patch: Record<string, unknown> = {}
  if (parsed.data.supplyRatePerM !== undefined)       patch.supply_rate_per_m = parsed.data.supplyRatePerM
  if (parsed.data.installRatePerM !== undefined)      patch.install_rate_per_m = parsed.data.installRatePerM
  if (parsed.data.terminationRateEach !== undefined)  patch.termination_rate_each = parsed.data.terminationRateEach

  const { data, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .update(patch)
    .eq('id', parsed.data.id)
    .select('revision_id, revision:revisions!revision_id(project_id, status)')
    .single()
  if (error) return { error: error.message }
  const d = data as any
  if (d?.revision?.status !== 'DRAFT') return { error: 'Revision is ISSUED — locked.' }
  if (d?.revision?.project_id) {
    revalidatePath(`/projects/${d.revision.project_id}/cables/${d.revision_id}/cost`)
  }
  return { ok: true }
}

// ─── Revision-level VAT % ───────────────────────────────────────────
// VAT lives on `cable_schedule.revisions.vat_pct` per migration 00060.
// Replaces the previous sentinel-cost_lines pattern that was always
// broken by CHECK (size_mm2 > 0). Range 0–100; 15 is the SA default.

const updateRevisionVatSchema = z.object({
  revisionId: uuid,
  vatPct: z.number().min(0).max(100),
})

// ─── C10: Bulk paste rates ──────────────────────────────────────────
// Engineers receive supplier price lists as Excel/CSV (size + conductor
// + rates). Bulk paste avoids typing each row individually on the cost
// page. Upsert via PostgREST onConflict (revision_id, size_mm2, conductor).
// DRAFT-only.

const bulkPasteEntrySchema = z.object({
  size_mm2: z.number().positive(),
  conductor: z.enum(['CU', 'AL']),
  supply_rate_per_m: z.number().nonnegative(),
  install_rate_per_m: z.number().nonnegative(),
  termination_rate_each: z.number().nonnegative(),
})

const bulkPasteSchema = z.object({
  revisionId: uuid,
  entries: z.array(bulkPasteEntrySchema).min(1).max(200),
})

export async function bulkPasteCostLinesAction(
  input: z.infer<typeof bulkPasteSchema>,
): Promise<{ ok: true; upserted: number } | { ok: false; error: string }> {
  const parsed = bulkPasteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — only engineers can bulk-paste rates.
  const roleCheck = await requireRoleForRevision(supabase, parsed.data.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, organisation_id, project_id, status')
    .eq('id', parsed.data.revisionId)
    .single()
  if (!rev) return { ok: false, error: 'Revision not found' }
  if ((rev as any).status !== 'DRAFT') {
    return { ok: false, error: 'Revision is ISSUED — cost lines are read-only.' }
  }
  const r = rev as { id: string; organisation_id: string; project_id: string }

  // Deduplicate within the paste payload itself (last entry wins).
  const byKey = new Map<string, z.infer<typeof bulkPasteEntrySchema>>()
  for (const e of parsed.data.entries) {
    byKey.set(`${e.size_mm2}|${e.conductor}`, e)
  }
  const rows = Array.from(byKey.values()).map((e) => ({
    revision_id: parsed.data.revisionId,
    organisation_id: r.organisation_id,
    size_mm2: e.size_mm2,
    conductor: e.conductor,
    supply_rate_per_m: e.supply_rate_per_m,
    install_rate_per_m: e.install_rate_per_m,
    termination_rate_each: e.termination_rate_each,
  }))

  // Try conductor-aware upsert first (post-migration 00061).
  const primary = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .upsert(rows, { onConflict: 'revision_id,size_mm2,conductor' })

  if (primary.error) {
    // Pre-migration-00061 fallback: no conductor column / no compound
    // UNIQUE. Collapse to size-only and re-upsert. CU entries win over AL
    // (we have no way to keep both without the column).
    if (primary.error.code === '42703' || primary.error.code === '42P10') {
      const collapsed = new Map<number, typeof rows[number]>()
      for (const row of rows) {
        // Prefer CU when both present at the same size in legacy mode.
        const existing = collapsed.get(row.size_mm2)
        if (!existing || (existing.conductor === 'AL' && row.conductor === 'CU')) {
          collapsed.set(row.size_mm2, row)
        }
      }
      const legacyRows = Array.from(collapsed.values()).map(({ conductor: _drop, ...rest }) => rest)
      const retry = await (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .upsert(legacyRows, { onConflict: 'revision_id,size_mm2' })
      if (retry.error) return { ok: false, error: retry.error.message }
      revalidatePath(`/projects/${r.project_id}/cables/${parsed.data.revisionId}/cost`)
      return { ok: true, upserted: legacyRows.length }
    }
    return { ok: false, error: primary.error.message }
  }

  revalidatePath(`/projects/${r.project_id}/cables/${parsed.data.revisionId}/cost`)
  return { ok: true, upserted: rows.length }
}

export async function updateRevisionVatAction(
  input: z.infer<typeof updateRevisionVatSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateRevisionVatSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — only engineers can edit VAT.
  const roleCheck = await requireRoleForRevision(supabase, parsed.data.revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { error: roleCheck.error }

  // DRAFT-only gate (consistent with the rest of cost editing).
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, project_id')
    .eq('id', parsed.data.revisionId)
    .single()
  if (!rev) return { error: 'Revision not found' }
  if ((rev as any).status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — VAT is read-only.' }
  }

  const { error } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .update({ vat_pct: parsed.data.vatPct })
    .eq('id', parsed.data.revisionId)
  if (error) {
    // Common pre-migration error: column doesn't exist yet.
    return {
      error: error.code === '42703'
        ? 'VAT migration 00060 not yet applied. Run it in Supabase Studio SQL Editor.'
        : error.message,
    }
  }

  const r = rev as { project_id: string }
  revalidatePath(`/projects/${r.project_id}/cables/${parsed.data.revisionId}/cost`)
  return { ok: true }
}
