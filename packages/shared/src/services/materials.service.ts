/**
 * Materials service — pure-TS stage-derivation helpers + an enrich query
 * function that powers the new unified /materials tab (merge of /schedule
 * and /procurement per the materials-tab-merge buildplan).
 *
 * Architectural principle (load-bearing): we derive the 5-stage primary
 * stage at read-time by joining engineer_equipment_schedule × procurement_items
 * × procurement_quotes × shop_drawings × goods_received_notes × supplier_invoices.
 * No cached `primary_stage` column on the BOM table — the
 * `engineer_equipment_schedule.status` enum is too coarse to map onto the
 * 5 stages directly (no quote/invoice signal). Trade: 1 nested SELECT per
 * page load; acceptable until projects hit hundreds of items.
 *
 * Stage rule: pay > deliver > order > quote > plan. Highest-numbered
 * stage with activity wins.
 *
 * Reusable from web (server components). Mobile gets URL rewrites only
 * in Phase 1 — full mobile screens land in a separate plan.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const STAGES = ['plan', 'quote', 'order', 'deliver', 'pay'] as const
export type Stage = typeof STAGES[number]

export type EnrichedItem = {
  // engineer_equipment_schedule columns (the BOM row)
  id: string
  organisation_id: string
  item_code: string | null
  description: string
  quantity: number
  unit: string | null
  estimated_unit_cost: number | null
  currency: string
  status: 'open' | 'partially_ordered' | 'fully_ordered' | 'fully_delivered' | 'cancelled'
  shop_drawing_required: boolean
  procurement_items: Array<{
    id: string
    organisation_id: string
    description: string
    quantity: number | null
    unit: string | null
    status: 'draft' | 'sent' | 'quoted' | 'approved' | 'fulfilled' | 'cancelled'
    po_number: string | null
    quoted_price: number | null
    selected_quote_id: string | null
    photo_paths: string[]
    procurement_quotes: Array<{
      id: string
      supplier_id: string | null
      supplier_name: string | null
      quoted_price: number
      currency: string
      is_selected: boolean
      received_at: string
    }>
    shop_drawings: Array<{ id: string; status: 'pending_review' | 'approved' | 'revise_and_resubmit' | 'rejected' }>
    goods_received_notes: Array<{
      id: string
      delivered_at: string
      quantity_received: number
      condition: 'complete' | 'partial' | 'damaged'
    }>
    supplier_invoices: Array<{
      id: string
      invoice_number: string
      amount: number
      status: 'received' | 'approved' | 'paid' | 'disputed'
      paid_at: string | null
    }>
  }>
}

/**
 * Primary stage for an enriched schedule item.
 * Rule: highest-numbered stage with activity wins. No activity → plan.
 */
export function primaryStage(item: EnrichedItem): Stage {
  const pis = item.procurement_items ?? []
  if (pis.length === 0) return 'plan'

  const allInvoices = pis.flatMap(p => p.supplier_invoices)
  const allGrns = pis.flatMap(p => p.goods_received_notes)
  const allQuotes = pis.flatMap(p => p.procurement_quotes)

  if (allInvoices.length > 0) return 'pay'
  if (allGrns.length > 0) return 'deliver'
  if (pis.some(p => p.status === 'approved')) return 'order'
  if (allQuotes.length > 0) return 'quote'
  if (pis.some(p => p.status === 'sent' || p.status === 'quoted' || p.status === 'draft')) return 'quote'
  return 'plan'
}

/**
 * Secondary stages — items active in more than one stage simultaneously.
 * Returns only stages OTHER than the primary.
 */
export function secondaryStages(item: EnrichedItem): Stage[] {
  const primary = primaryStage(item)
  const stages = new Set<Stage>()
  const pis = item.procurement_items ?? []

  // Item with PO (or further) but also has an outstanding (non-selected) quote
  if (
    pis.flatMap(p => p.procurement_quotes).some(q => !q.is_selected) &&
    primary !== 'quote' &&
    primary !== 'plan'
  ) {
    stages.add('quote')
  }
  // Pay-stage item with delivery still incomplete (sum(GRN) < pi.quantity)
  if (primary === 'pay') {
    const stillDelivering = pis.some(p => {
      const received = p.goods_received_notes.reduce((s, g) => s + (g.quantity_received ?? 0), 0)
      return p.quantity != null && received < p.quantity
    })
    if (stillDelivering) stages.add('deliver')
  }
  return [...stages]
}

/**
 * Load all schedule items for a project with procurement joins, in one query.
 * Caller passes a user-scoped Supabase client; RLS handles org-scoping.
 *
 * Throws on PostgREST error so callers can surface it; the alternative
 * (returning []) silently masks query failures and was rejected.
 */
export async function enrichScheduleItems(
  supabase: SupabaseClient,
  projectId: string,
): Promise<EnrichedItem[]> {
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('engineer_equipment_schedule')
    .select(`
      id, organisation_id, item_code, description, quantity, unit, estimated_unit_cost, currency,
      status, shop_drawing_required,
      procurement_items (
        id, organisation_id, description, quantity, unit, status, po_number, quoted_price,
        selected_quote_id, photo_paths,
        procurement_quotes ( id, supplier_id, supplier_name, quoted_price, currency, is_selected, received_at ),
        shop_drawings ( id, status ),
        goods_received_notes ( id, delivered_at, quantity_received, condition ),
        supplier_invoices ( id, invoice_number, amount, status, paid_at )
      )
    `)
    .eq('project_id', projectId)
    .order('item_code', { ascending: true })

  if (error) throw error
  return (data ?? []) as EnrichedItem[]
}

/**
 * Counts per stage. Total equals items.length (each item has exactly one primary stage).
 */
export function getStageCounts(items: EnrichedItem[]): Record<Stage, number> {
  const counts: Record<Stage, number> = { plan: 0, quote: 0, order: 0, deliver: 0, pay: 0 }
  for (const item of items) counts[primaryStage(item)]++
  return counts
}

/**
 * Filter enriched items to only those with this primary stage. Used by stage pages.
 */
export function itemsForStage(items: EnrichedItem[], stage: Stage): EnrichedItem[] {
  return items.filter(i => primaryStage(i) === stage)
}
