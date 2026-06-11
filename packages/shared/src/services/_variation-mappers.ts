import type { VariationOrder, VariationLine } from '../schemas/variation.schema'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function rowToVariationOrder(r: Record<string, unknown>): VariationOrder {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    organisationId: r.organisation_id as string,
    boqImportId: r.boq_import_id as string,
    voNo: Number(r.vo_no),
    voDate: r.vo_date as string,
    title: r.title as string,
    reason: (r.reason as string) ?? null,
    status: r.status as VariationOrder['status'],
    netChange: num(r.net_change),
    approvedBy: (r.approved_by as string) ?? null,
    approvedAt: (r.approved_at as string) ?? null,
  }
}

export function rowToVariationLine(r: Record<string, unknown>): VariationLine {
  return {
    id: r.id as string,
    variationOrderId: r.variation_order_id as string,
    kind: r.kind as VariationLine['kind'],
    boqItemId: (r.boq_item_id as string) ?? null,
    qtyDelta: num(r.qty_delta),
    sectionId: (r.section_id as string) ?? null,
    code: (r.code as string) ?? null,
    description: (r.description as string) ?? null,
    unit: (r.unit as string) ?? null,
    quantity: num(r.quantity),
    rateModel: (r.rate_model as VariationLine['rateModel']) ?? null,
    supplyRate: num(r.supply_rate),
    installRate: num(r.install_rate),
    rate: num(r.rate),
    valueChange: num(r.value_change) as number,
    materializedItemId: (r.materialized_item_id as string) ?? null,
  }
}

// Partial domain → snake_case row (only defined keys), for line UPDATEs.
export function variationLineToRow(
  patch: Partial<
    Pick<
      VariationLine,
      | 'kind'
      | 'boqItemId'
      | 'qtyDelta'
      | 'sectionId'
      | 'code'
      | 'description'
      | 'unit'
      | 'quantity'
      | 'rateModel'
      | 'supplyRate'
      | 'installRate'
      | 'rate'
      | 'valueChange'
      | 'materializedItemId'
    >
  >,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.kind !== undefined) out.kind = patch.kind
  if (patch.boqItemId !== undefined) out.boq_item_id = patch.boqItemId
  if (patch.qtyDelta !== undefined) out.qty_delta = patch.qtyDelta
  if (patch.sectionId !== undefined) out.section_id = patch.sectionId
  if (patch.code !== undefined) out.code = patch.code
  if (patch.description !== undefined) out.description = patch.description
  if (patch.unit !== undefined) out.unit = patch.unit
  if (patch.quantity !== undefined) out.quantity = patch.quantity
  if (patch.rateModel !== undefined) out.rate_model = patch.rateModel
  if (patch.supplyRate !== undefined) out.supply_rate = patch.supplyRate
  if (patch.installRate !== undefined) out.install_rate = patch.installRate
  if (patch.rate !== undefined) out.rate = patch.rate
  if (patch.valueChange !== undefined) out.value_change = patch.valueChange
  if (patch.materializedItemId !== undefined) out.materialized_item_id = patch.materializedItemId
  return out
}
