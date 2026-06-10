import type { Valuation, ValuationLine } from '../schemas/valuation.schema'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function rowToValuationLine(r: Record<string, unknown>): ValuationLine {
  return {
    id: r.id as string,
    valuationId: r.valuation_id as string,
    boqItemId: r.boq_item_id as string,
    inputMethod: r.input_method as ValuationLine['inputMethod'],
    percentComplete: num(r.percent_complete),
    qtyComplete: num(r.qty_complete),
    valueToDate: num(r.value_to_date) as number,
  }
}

export function rowToValuation(r: Record<string, unknown>): Valuation {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    organisationId: r.organisation_id as string,
    boqImportId: r.boq_import_id as string,
    valuationNo: Number(r.valuation_no),
    valuationDate: r.valuation_date as string,
    status: r.status as Valuation['status'],
    retentionPct: num(r.retention_pct) as number,
    grossToDate: num(r.gross_to_date),
    retentionAmount: num(r.retention_amount),
    netToDate: num(r.net_to_date),
    previousNet: num(r.previous_net),
    dueExVat: num(r.due_ex_vat),
    vatAmount: num(r.vat_amount),
    dueInclVat: num(r.due_incl_vat),
    reportId: (r.report_id as string) ?? null,
    notes: (r.notes as string) ?? null,
    certifiedBy: (r.certified_by as string) ?? null,
    certifiedAt: (r.certified_at as string) ?? null,
  }
}

// Partial domain → snake_case row (only defined keys), for progress UPDATEs.
export function valuationLineToRow(
  patch: Partial<Pick<ValuationLine, 'inputMethod' | 'percentComplete' | 'qtyComplete' | 'valueToDate'>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.inputMethod !== undefined) out.input_method = patch.inputMethod
  if (patch.percentComplete !== undefined) out.percent_complete = patch.percentComplete
  if (patch.qtyComplete !== undefined) out.qty_complete = patch.qtyComplete
  if (patch.valueToDate !== undefined) out.value_to_date = patch.valueToDate
  return out
}
