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

const uuid = z.string().uuid()
const RATES_HEADER_SIZE = 0          // sentinel row for revision-level rates

export async function ensureCostLinesAction(
  revisionId: string,
): Promise<{ created?: number; error?: string }> {
  if (!uuid.safeParse(revisionId).success) return { error: 'Invalid revision id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

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

  // Distinct sizes from cables in the revision
  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('size_mm2')
    .eq('revision_id', revisionId)
  const sizes = new Set<number>()
  for (const c of (cables ?? []) as Array<{ size_mm2: number }>) {
    sizes.add(Number(c.size_mm2))
  }
  sizes.add(RATES_HEADER_SIZE)         // ensure header row exists

  // Existing cost line sizes
  const { data: existing } = await (supabase as any)
    .schema('cable_schedule')
    .from('cost_lines')
    .select('size_mm2')
    .eq('revision_id', revisionId)
  const have = new Set(((existing ?? []) as Array<{ size_mm2: number }>).map((e) => Number(e.size_mm2)))

  const missing = [...sizes].filter((s) => !have.has(s))
  if (missing.length === 0) return { created: 0 }

  const rows = missing.map((size) => ({
    revision_id: revisionId,
    organisation_id: r.organisation_id,
    size_mm2: size,
    supply_rate_per_m: 0,
    install_rate_per_m: 0,
    termination_rate_each: 0,
    // contingency_pct intentionally NULL on new rows (2026-05-17 removal).
    // VAT default 15% on the sentinel header row only.
    contingency_pct: null,
    vat_pct: size === RATES_HEADER_SIZE ? 15 : null,
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
  // DB column kept (archived revisions). New writes never set it.
  vatPct: z.number().nonnegative().optional(),
})

export async function updateCostLineAction(
  input: z.infer<typeof updateRateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateRateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const patch: Record<string, unknown> = {}
  if (parsed.data.supplyRatePerM !== undefined)       patch.supply_rate_per_m = parsed.data.supplyRatePerM
  if (parsed.data.installRatePerM !== undefined)      patch.install_rate_per_m = parsed.data.installRatePerM
  if (parsed.data.terminationRateEach !== undefined)  patch.termination_rate_each = parsed.data.terminationRateEach
  if (parsed.data.vatPct !== undefined)               patch.vat_pct = parsed.data.vatPct

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
