import type { BoqItem, BoqSection, BoqImport } from '../schemas/boq.schema'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function rowToBoqItem(r: Record<string, unknown>): BoqItem {
  return {
    id: r.id as string,
    sectionId: r.section_id as string,
    code: (r.code as string) ?? null,
    description: r.description as string,
    unit: (r.unit as string) ?? null,
    quantity: num(r.quantity),
    quantityMode: r.quantity_mode as BoqItem['quantityMode'],
    rateModel: r.rate_model as BoqItem['rateModel'],
    supplyRate: num(r.supply_rate),
    installRate: num(r.install_rate),
    rate: num(r.rate),
    amount: num(r.amount),
    sortOrder: Number(r.sort_order ?? 0),
  }
}

export function rowToBoqSection(r: Record<string, unknown>): BoqSection {
  return {
    id: r.id as string,
    importId: r.import_id as string,
    parentSectionId: (r.parent_section_id as string) ?? null,
    kind: r.kind as BoqSection['kind'],
    code: (r.code as string) ?? null,
    title: r.title as string,
    sortOrder: Number(r.sort_order ?? 0),
    nodeId: (r.node_id as string) ?? null,
  }
}

export function rowToBoqImport(r: Record<string, unknown>): BoqImport {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    organisationId: r.organisation_id as string,
    sourceFilename: r.source_filename as string,
    storagePath: (r.storage_path as string) ?? null,
    importedBy: (r.imported_by as string) ?? null,
    importedAt: r.imported_at as string,
    totalExVat: num(r.total_ex_vat),
    vatAmount: num(r.vat_amount),
    totalInclVat: num(r.total_incl_vat),
    lineItemCount: Number(r.line_item_count ?? 0),
    isCurrent: Boolean(r.is_current),
  }
}

// Partial domain → snake_case row (only defined keys), for rate-edit UPDATEs.
export function boqItemToRow(patch: Partial<BoqItem>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.supplyRate !== undefined) out.supply_rate = patch.supplyRate
  if (patch.installRate !== undefined) out.install_rate = patch.installRate
  if (patch.rate !== undefined) out.rate = patch.rate
  if (patch.amount !== undefined) out.amount = patch.amount
  return out
}
