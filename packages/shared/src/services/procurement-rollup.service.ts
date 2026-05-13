/**
 * Procurement rollup queries — feeds the dashboard cards + project-overview
 * "committed spend" panel. Mirrors the sla.service.ts shape: a thin set of
 * org-scoped read helpers returning { count, top: [...] } + a summary
 * function that fans them out in parallel.
 *
 * All queries trust RLS (org members see all of their org's procurement;
 * client_viewers are scoped via the policies on procurement_items and
 * goods_received_notes).
 */

import type { TypedSupabaseClient } from '@esite/db'

export const PROCUREMENT_DEFAULTS = {
  /** Cards show up to this many items inline. */
  TOP_N: 3,
  /** Rolling-window for "Deliveries this week". */
  DELIVERY_WINDOW_DAYS: 7,
} as const

export interface ProcurementSummaryItem {
  id: string
  description: string
  project_id: string
  project_name: string | null
  status: string
  quantity: number | null
  unit: string | null
  quoted_price: number | null
  required_by: string | null
  created_at: string
}

export interface DeliveryItem {
  id: string
  procurement_item_id: string
  description: string | null
  project_id: string
  project_name: string | null
  quantity_received: number
  delivered_at: string
  condition: string
}

export interface ProcurementSummary {
  outstanding: { count: number; top: ProcurementSummaryItem[] }
  quotesPending: { count: number; top: ProcurementSummaryItem[] }
  deliveriesThisWeek: { count: number; top: DeliveryItem[] }
  committedSpend: number
}

interface ProcurementRow {
  id: string
  description: string
  project_id: string
  status: string
  quantity: number | null
  unit: string | null
  quoted_price: number | null
  required_by: string | null
  created_at: string
  selected_quote_id: string | null
  project?: { id: string; name: string } | null
}

interface GRNRow {
  id: string
  procurement_item_id: string
  project_id: string
  quantity_received: number
  delivered_at: string
  condition: string
  procurement_item?: {
    id: string
    description: string
    project?: { id: string; name: string } | null
  } | null
}

/** Open items still waiting on a PO (status in draft|sent|quoted). */
export async function getOutstandingProcurement(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<ProcurementSummary['outstanding']> {
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select(
      'id, description, project_id, status, quantity, unit, quoted_price, ' +
      'required_by, created_at, selected_quote_id, ' +
      'project:projects!project_id(id, name)',
    )
    .eq('organisation_id', orgId)
    .in('status', ['draft', 'sent', 'quoted'])
    .order('required_by', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return { count: 0, top: [] }
  const rows = (data ?? []) as unknown as ProcurementRow[]
  return {
    count: rows.length,
    top: rows.slice(0, PROCUREMENT_DEFAULTS.TOP_N).map(toSummaryItem),
  }
}

/** Items at status 'draft' or 'sent' that have no winning quote yet — PM
 *  needs to either chase a supplier or pick a winner. */
export async function getQuotesPending(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<ProcurementSummary['quotesPending']> {
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select(
      'id, description, project_id, status, quantity, unit, quoted_price, ' +
      'required_by, created_at, selected_quote_id, ' +
      'project:projects!project_id(id, name)',
    )
    .eq('organisation_id', orgId)
    .in('status', ['draft', 'sent'])
    .is('selected_quote_id', null)
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return { count: 0, top: [] }
  const rows = (data ?? []) as unknown as ProcurementRow[]
  return {
    count: rows.length,
    top: rows.slice(0, PROCUREMENT_DEFAULTS.TOP_N).map(toSummaryItem),
  }
}

/** GRNs with delivered_at in the rolling 7-day window. */
export async function getDeliveriesThisWeek(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<ProcurementSummary['deliveriesThisWeek']> {
  const since = new Date()
  since.setDate(since.getDate() - PROCUREMENT_DEFAULTS.DELIVERY_WINDOW_DAYS)
  const sinceIso = since.toISOString().slice(0, 10)
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('goods_received_notes')
    .select(
      'id, procurement_item_id, project_id, quantity_received, delivered_at, condition, ' +
      'procurement_item:procurement_items!procurement_item_id(' +
      '  id, description, project:projects!project_id(id, name)' +
      ')',
    )
    .eq('organisation_id', orgId)
    .gte('delivered_at', sinceIso)
    .order('delivered_at', { ascending: false })
    .limit(50)
  if (error) return { count: 0, top: [] }
  const rows = (data ?? []) as unknown as GRNRow[]
  return {
    count: rows.length,
    top: rows.slice(0, PROCUREMENT_DEFAULTS.TOP_N).map((g) => ({
      id: g.id,
      procurement_item_id: g.procurement_item_id,
      description: g.procurement_item?.description ?? null,
      project_id: g.project_id,
      project_name: g.procurement_item?.project?.name ?? null,
      quantity_received: Number(g.quantity_received),
      delivered_at: g.delivered_at,
      condition: g.condition,
    })),
  }
}

/** Org-wide committed spend = SUM(quantity * quoted_price) for items at
 *  status approved or fulfilled. */
export async function getCommittedSpend(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<number> {
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('procurement_items')
    .select('quantity, quoted_price, status')
    .eq('organisation_id', orgId)
    .in('status', ['approved', 'fulfilled'])
  if (error) return 0
  return ((data ?? []) as Array<{ quantity: number | null; quoted_price: number | null }>)
    .reduce((s, r) => s + Number(r.quantity ?? 0) * Number(r.quoted_price ?? 0), 0)
}

/** Project-scoped committed spend — feeds the project overview budget bar. */
export async function getProjectCommittedSpend(
  supabase: TypedSupabaseClient,
  projectId: string,
): Promise<{
  committed: number
  ordered: number
  delivered: number
  scheduledValue: number
}> {
  const [piRes, schedRes] = await Promise.all([
    (supabase as any)
      .schema('projects')
      .from('procurement_items')
      .select('quantity, quoted_price, status')
      .eq('project_id', projectId),
    (supabase as any)
      .schema('projects')
      .from('engineer_equipment_schedule')
      .select('quantity, estimated_unit_cost')
      .eq('project_id', projectId)
      .neq('status', 'cancelled'),
  ])
  const items = ((piRes?.data ?? []) as Array<{
    quantity: number | null
    quoted_price: number | null
    status: string
  }>)
  let committed = 0, ordered = 0, delivered = 0
  for (const r of items) {
    const v = Number(r.quantity ?? 0) * Number(r.quoted_price ?? 0)
    if (r.status === 'approved') { committed += v; ordered += v }
    else if (r.status === 'fulfilled') { committed += v; ordered += v; delivered += v }
    else if (r.status === 'quoted') { committed += v }
  }
  const scheduledValue = ((schedRes?.data ?? []) as Array<{
    quantity: number
    estimated_unit_cost: number | null
  }>).reduce((s, r) => s + Number(r.quantity) * Number(r.estimated_unit_cost ?? 0), 0)
  return { committed, ordered, delivered, scheduledValue }
}

export async function getProcurementSummary(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<ProcurementSummary> {
  const [outstanding, quotesPending, deliveriesThisWeek, committedSpend] = await Promise.all([
    getOutstandingProcurement(supabase, orgId),
    getQuotesPending(supabase, orgId),
    getDeliveriesThisWeek(supabase, orgId),
    getCommittedSpend(supabase, orgId),
  ])
  return { outstanding, quotesPending, deliveriesThisWeek, committedSpend }
}

function toSummaryItem(r: ProcurementRow): ProcurementSummaryItem {
  return {
    id: r.id,
    description: r.description,
    project_id: r.project_id,
    project_name: r.project?.name ?? null,
    status: r.status,
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit: r.unit,
    quoted_price: r.quoted_price == null ? null : Number(r.quoted_price),
    required_by: r.required_by,
    created_at: r.created_at,
  }
}
