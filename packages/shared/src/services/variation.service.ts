import type { BoqItem } from '../schemas/boq.schema'
import type { VariationLine, VariationLinePatch, VariationOrder } from '../schemas/variation.schema'
import { rowToVariationLine, rowToVariationOrder, variationLineToRow } from './_variation-mappers'

// The variation tables live in the `projects` schema, which is not in the
// generated DB types. Cast as `any` at the schema('projects') boundary — the
// same pattern valuation.service.ts / boq.service.ts use.
type AnyClient = any

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type RateFields = Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>
const effectiveRate = (f: RateFields): number =>
  f.rateModel === 'single' ? (f.rate ?? 0) : (f.supplyRate ?? 0) + (f.installRate ?? 0)

/** Money effect of one variation line. adjust => delta x the ITEM's contract rate; add => qty x the LINE's own rate. */
export function computeLineChange(
  line: Pick<VariationLine, 'kind' | 'qtyDelta' | 'quantity' | 'rateModel' | 'supplyRate' | 'installRate' | 'rate'>,
  item?: Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>,
): number {
  if (line.kind === 'adjust') {
    if (!item) throw new Error('adjust line requires its boq item')
    return round2((line.qtyDelta ?? 0) * effectiveRate(item))
  }
  return round2((line.quantity ?? 0) * effectiveRate({ rateModel: line.rateModel ?? 'supply_install', supplyRate: line.supplyRate, installRate: line.installRate, rate: line.rate }))
}

/** The >= 0 revised-quantity floor: contractQty + priorDeltas + newDelta >= 0. */
export function validateQtyDelta(
  item: Pick<BoqItem, 'quantity'>,
  priorApprovedDeltas: number[],
  newDelta: number,
): boolean {
  const base = (item.quantity ?? 0) + priorApprovedDeltas.reduce((s, d) => s + d, 0)
  return base + newDelta >= -1e-9
}

/** Revised position of one contract item under its approved qty deltas. */
export function computeRevisedItem(
  item: Pick<BoqItem, 'quantity' | 'amount' | 'supplyRate' | 'installRate' | 'rate' | 'rateModel' | 'quantityMode'>,
  approvedDeltas: number[],
): { revisedQty: number | null; revisedAmount: number | null } {
  if (item.rateModel === 'amount_only') return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const deltaSum = approvedDeltas.reduce((s, d) => s + d, 0)
  if (approvedDeltas.length === 0) return { revisedQty: item.quantity ?? null, revisedAmount: item.amount ?? null }
  const revisedQty = round2((item.quantity ?? 0) + deltaSum)
  return { revisedQty, revisedAmount: round2(revisedQty * effectiveRate(item)) }
}

/** Revised rollups: computeRollups over revised amounts (adjustmentsByItem: boq_item_id -> approved deltas). */
export function computeRevisedAmounts(
  items: BoqItem[],
  adjustmentsByItem: Map<string, number[]>,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const it of items) out.set(it.id, computeRevisedItem(it, adjustmentsByItem.get(it.id) ?? []).revisedAmount)
  return out
}

// ─── Service client methods ───────────────────────────────────────────────────

/**
 * Page through a PostgREST-capped (~1000-row) read. Mirrors
 * valuationService — line reads MUST paginate.
 */
const PAGE = 1000
async function fetchAllRows(build: () => AnyClient): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Record<string, unknown>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

export const variationService = {
  /** All variation orders for a project, ordered by vo_no. */
  async list(client: AnyClient, projectId: string): Promise<VariationOrder[]> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('variation_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('vo_no')
    if (error) throw new Error(error.message)
    return ((data ?? []) as Record<string, unknown>[]).map(rowToVariationOrder)
  },

  /** A VO plus all its lines (paginated), or null if not found. */
  async get(
    client: AnyClient,
    voId: string,
  ): Promise<{ vo: VariationOrder; lines: VariationLine[] } | null> {
    const db = (client as AnyClient).schema('projects')

    const { data: voRow, error: ve } = await db
      .from('variation_orders')
      .select('*')
      .eq('id', voId)
      .maybeSingle()
    if (ve) throw new Error(ve.message)
    if (!voRow) return null

    const lineRows = await fetchAllRows(() =>
      db.from('variation_lines').select('*').eq('variation_order_id', voId).order('id'),
    )

    return { vo: rowToVariationOrder(voRow), lines: lineRows.map(rowToVariationLine) }
  },

  /**
   * Insert a new VO (the DB trigger assigns vo_no). VOs are independent —
   * NO carry-forward.
   */
  async create(
    client: AnyClient,
    args: {
      projectId: string
      organisationId: string
      boqImportId: string
      voDate: string
      title: string
      reason: string | null
      createdBy: string | null
    },
  ): Promise<VariationOrder> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('variation_orders')
      .insert({
        project_id: args.projectId,
        organisation_id: args.organisationId,
        boq_import_id: args.boqImportId,
        vo_date: args.voDate,
        title: args.title,
        reason: args.reason,
        created_by: args.createdBy,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return rowToVariationOrder(data)
  },

  /**
   * Insert or update a variation line — value_change is recomputed via the
   * pure computeLineChange (adjust needs the target item's rates). Lines have
   * no natural conflict key: `patch.id` present = UPDATE, else INSERT. The
   * patch is the COMPLETE logical line (the schema's kind refinements enforce
   * it), so every field is written — absent ones as null.
   */
  async upsertLine(
    client: AnyClient,
    voId: string,
    patch: VariationLinePatch & { id?: string },
    item?: Pick<BoqItem, 'supplyRate' | 'installRate' | 'rate' | 'rateModel'>,
  ): Promise<VariationLine> {
    const db = (client as AnyClient).schema('projects')
    const valueChange = computeLineChange(
      {
        kind: patch.kind,
        qtyDelta: patch.qtyDelta ?? null,
        quantity: patch.quantity ?? null,
        rateModel: patch.rateModel ?? null,
        supplyRate: patch.supplyRate ?? null,
        installRate: patch.installRate ?? null,
        rate: patch.rate ?? null,
      },
      item,
    )
    const row = variationLineToRow({
      kind: patch.kind,
      boqItemId: patch.boqItemId ?? null,
      qtyDelta: patch.qtyDelta ?? null,
      sectionId: patch.sectionId ?? null,
      code: patch.code ?? null,
      description: patch.description ?? null,
      unit: patch.unit ?? null,
      quantity: patch.quantity ?? null,
      rateModel: patch.rateModel ?? null,
      supplyRate: patch.supplyRate ?? null,
      installRate: patch.installRate ?? null,
      rate: patch.rate ?? null,
      valueChange,
    })

    const query = patch.id
      ? db.from('variation_lines').update(row).eq('id', patch.id)
      : db.from('variation_lines').insert({ variation_order_id: voId, ...row })
    const { data, error } = await query.select().single()
    if (error) throw new Error(error.message)
    return rowToVariationLine(data)
  },

  /** Delete a variation line. */
  async deleteLine(client: AnyClient, lineId: string): Promise<void> {
    const { error } = await (client as AnyClient)
      .schema('projects')
      .from('variation_lines')
      .delete()
      .eq('id', lineId)
    if (error) throw new Error(error.message)
  },

  /**
   * Approved qty deltas per boq_item_id for a project — every `adjust` line
   * whose VO is `approved`. Feeds validateQtyDelta / computeRevisedItem.
   */
  async getApprovedAdjustments(client: AnyClient, projectId: string): Promise<Map<string, number[]>> {
    const db = (client as AnyClient).schema('projects')
    const rows = await fetchAllRows(() =>
      db
        .from('variation_lines')
        .select('boq_item_id, qty_delta, variation_orders!inner(project_id, status)')
        .eq('variation_orders.project_id', projectId)
        .eq('variation_orders.status', 'approved')
        .eq('kind', 'adjust')
        .order('id'),
    )
    const out = new Map<string, number[]>()
    for (const r of rows) {
      const itemId = r.boq_item_id as string | null
      if (!itemId) continue
      const deltas = out.get(itemId) ?? []
      deltas.push(Number(r.qty_delta ?? 0))
      out.set(itemId, deltas)
    }
    return out
  },

  /**
   * Approve a VO — ordering matters so a mid-way failure leaves a retryable
   * draft: (1) read the VO's `add` lines WHERE materialized_item_id IS NULL
   * (already-materialized lines are skipped → idempotent retry); (2) for each,
   * insert its boq_items row (origin='variation', amount = value_change,
   * sort_order appended within the section) then stamp the line's
   * materialized_item_id; (3) snapshot net_change = Σ ALL lines' value_change;
   * (4) LAST flip status='approved'.
   */
  async approve(client: AnyClient, voId: string, args: { approvedBy: string | null }): Promise<VariationOrder> {
    const db = (client as AnyClient).schema('projects')

    // 1. Un-materialized add lines.
    const pendingRows = await fetchAllRows(() =>
      db
        .from('variation_lines')
        .select('*')
        .eq('variation_order_id', voId)
        .eq('kind', 'add')
        .is('materialized_item_id', null)
        .order('id'),
    )

    // 2. Materialize each into boq_items, then stamp the line.
    for (const raw of pendingRows) {
      const line = rowToVariationLine(raw)

      const { data: maxRow, error: me } = await db
        .from('boq_items')
        .select('sort_order')
        .eq('section_id', line.sectionId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (me) throw new Error(me.message)
      const sortOrder = Number(maxRow?.sort_order ?? 0) + 1

      const { data: itemRow, error: ie } = await db
        .from('boq_items')
        .insert({
          section_id: line.sectionId,
          code: line.code,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          quantity_mode: 'measured',
          rate_model: line.rateModel,
          supply_rate: line.supplyRate,
          install_rate: line.installRate,
          rate: line.rate,
          amount: line.valueChange,
          origin: 'variation',
          variation_line_id: line.id,
          sort_order: sortOrder,
        })
        .select()
        .single()
      if (ie) throw new Error(ie.message)

      const { error: ue } = await db
        .from('variation_lines')
        .update({ materialized_item_id: itemRow.id })
        .eq('id', line.id)
      if (ue) throw new Error(ue.message)
    }

    // 3. net_change = Σ ALL the VO's lines' value_change.
    const allLines = await fetchAllRows(() =>
      db.from('variation_lines').select('value_change').eq('variation_order_id', voId).order('id'),
    )
    const netChange = round2(allLines.reduce((s, l) => s + Number(l.value_change ?? 0), 0))

    // 4. LAST: flip the status.
    const { data, error } = await db
      .from('variation_orders')
      .update({
        status: 'approved',
        net_change: netChange,
        approved_by: args.approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq('id', voId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return rowToVariationOrder(data)
  },
}
