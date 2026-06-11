import type { InputMethod, Valuation, ValuationLine, ValuationProgressPatch } from '../schemas/valuation.schema'
import { rowToValuation, rowToValuationLine } from './_valuation-mappers'

// The valuation tables live in the `projects` schema, which is not in the
// generated DB types. Cast as `any` at the schema('projects') boundary — the
// same pattern boq.service.ts / project-settings.service.ts use.
type AnyClient = any

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function computeLineValue(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; percentComplete: number | null; qtyComplete: number | null },
): number {
  if (line.inputMethod === 'quantity') {
    const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
    let v = round2(Math.max(0, line.qtyComplete ?? 0) * rate)
    if (item.amount != null) v = Math.min(v, item.amount) // over-measure capped at contract (a Variations concern)
    return v
  }
  // percent | section
  const pct = Math.min(100, Math.max(0, line.percentComplete ?? 0))
  return round2((item.amount ?? 0) * (pct / 100))
}

export function computeCertificate(
  lines: { valueToDate: number }[],
  retentionPct: number,
  previousNet: number,
): { grossToDate: number; retention: number; netToDate: number; previousNet: number; dueExVat: number; vat: number; dueInclVat: number } {
  const grossToDate = round2(lines.reduce((s, l) => s + l.valueToDate, 0))
  const retention = round2(grossToDate * (retentionPct / 100))
  const netToDate = round2(grossToDate - retention)
  const dueExVat = round2(netToDate - previousNet)
  const vat = round2(dueExVat * 0.15)
  const dueInclVat = round2(dueExVat + vat)
  return { grossToDate, retention, netToDate, previousNet, dueExVat, vat, dueInclVat }
}

/** True when a quantity line values more than the contract amount (over-measure → Variations). */
export function isOverMeasure(
  item: { amount: number | null; supplyRate: number | null; installRate: number | null; rate: number | null; rateModel: string },
  line: { inputMethod: InputMethod; qtyComplete: number | null },
): boolean {
  if (line.inputMethod !== 'quantity' || item.amount == null) return false
  const rate = item.rateModel === 'single' ? (item.rate ?? 0) : (item.supplyRate ?? 0) + (item.installRate ?? 0)
  return round2((line.qtyComplete ?? 0) * rate) > item.amount
}

// ─── Service client methods ───────────────────────────────────────────────────

/** The item shape `computeLineValue` needs — the rate fields off a BOQ item. */
type RateItem = {
  amount: number | null
  supplyRate: number | null
  installRate: number | null
  rate: number | null
  rateModel: string
}

/**
 * Page through a PostgREST-capped (~1000-row) read. Mirrors boqService.getTree
 * — a valuation can carry thousands of lines, so every line read MUST paginate.
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

export const valuationService = {
  /** All valuations for a project, ordered by valuation_no. */
  async list(client: AnyClient, projectId: string): Promise<Valuation[]> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('valuations')
      .select('*')
      .eq('project_id', projectId)
      .order('valuation_no')
    if (error) throw new Error(error.message)
    return ((data ?? []) as Record<string, unknown>[]).map(rowToValuation)
  },

  /** A valuation plus all its lines (paginated), or null if not found. */
  async get(
    client: AnyClient,
    valuationId: string,
  ): Promise<{ valuation: Valuation; lines: ValuationLine[] } | null> {
    const db = (client as AnyClient).schema('projects')

    const { data: valRow, error: ve } = await db
      .from('valuations')
      .select('*')
      .eq('id', valuationId)
      .maybeSingle()
    if (ve) throw new Error(ve.message)
    if (!valRow) return null

    const lineRows = await fetchAllRows(() =>
      db.from('valuation_lines').select('*').eq('valuation_id', valuationId).order('id'),
    )

    return {
      valuation: rowToValuation(valRow),
      lines: lineRows.map(rowToValuationLine),
    }
  },

  /**
   * Insert a new valuation (the DB trigger assigns valuation_no), then
   * carry-forward: copy the previous valuation's lines (valuation_no − 1)
   * against the new valuation id, preserving every progress field. The first
   * valuation has no previous, so nothing is carried.
   */
  async create(
    client: AnyClient,
    args: {
      projectId: string
      organisationId: string
      boqImportId: string
      valuationDate: string
      retentionPct: number
      createdBy: string | null
    },
  ): Promise<Valuation> {
    const db = (client as AnyClient).schema('projects')

    // 1. Insert — valuation_no defaults to 0 and the trigger overwrites it.
    const { data: valRow, error: ie } = await db
      .from('valuations')
      .insert({
        project_id: args.projectId,
        organisation_id: args.organisationId,
        boq_import_id: args.boqImportId,
        valuation_date: args.valuationDate,
        retention_pct: args.retentionPct,
        created_by: args.createdBy,
      })
      .select()
      .single()
    if (ie) throw new Error(ie.message)
    const valuation = rowToValuation(valRow)

    // 2. Carry forward the previous valuation's lines.
    if (valuation.valuationNo > 1) {
      const { data: prev, error: pe } = await db
        .from('valuations')
        .select('id')
        .eq('project_id', args.projectId)
        .eq('valuation_no', valuation.valuationNo - 1)
        .maybeSingle()
      if (pe) throw new Error(pe.message)

      if (prev) {
        const prevLines = await fetchAllRows(() =>
          db.from('valuation_lines').select('*').eq('valuation_id', prev.id).order('id'),
        )
        if (prevLines.length > 0) {
          const carried = prevLines.map((l) => ({
            valuation_id: valuation.id,
            boq_item_id: l.boq_item_id,
            input_method: l.input_method,
            percent_complete: l.percent_complete === null || l.percent_complete === undefined ? null : Number(l.percent_complete),
            qty_complete: l.qty_complete === null || l.qty_complete === undefined ? null : Number(l.qty_complete),
            value_to_date: Number(l.value_to_date),
          }))
          const { error: ce } = await db.from('valuation_lines').insert(carried)
          if (ce) throw new Error(ce.message)
        }
      }
    }

    return valuation
  },

  /**
   * Upsert a progress line — recomputes value_to_date via the pure
   * computeLineValue, then upserts on (valuation_id, boq_item_id).
   */
  async upsertLine(
    client: AnyClient,
    valuationId: string,
    patch: ValuationProgressPatch,
    item: RateItem,
  ): Promise<ValuationLine> {
    const db = (client as AnyClient).schema('projects')
    const valueToDate = computeLineValue(item, {
      inputMethod: patch.inputMethod,
      percentComplete: patch.percentComplete ?? null,
      qtyComplete: patch.qtyComplete ?? null,
    })
    const { data, error } = await db
      .from('valuation_lines')
      .upsert(
        {
          valuation_id: valuationId,
          boq_item_id: patch.boqItemId,
          input_method: patch.inputMethod,
          percent_complete: patch.percentComplete ?? null,
          qty_complete: patch.qtyComplete ?? null,
          value_to_date: valueToDate,
        },
        { onConflict: 'valuation_id,boq_item_id' },
      )
      .select()
      .single()
    if (error) throw new Error(error.message)
    return rowToValuationLine(data)
  },

  /**
   * Set every item under a section to a `section`-method line at the given
   * percent. value_to_date for each is computed via computeLineValue.
   */
  async setSectionPercent(
    client: AnyClient,
    valuationId: string,
    items: Array<{ boqItemId: string; item: RateItem }>,
    percent: number,
  ): Promise<void> {
    const db = (client as AnyClient).schema('projects')
    if (items.length === 0) return
    const rows = items.map(({ boqItemId, item }) => ({
      valuation_id: valuationId,
      boq_item_id: boqItemId,
      input_method: 'section' as const,
      percent_complete: percent,
      qty_complete: null,
      value_to_date: computeLineValue(item, {
        inputMethod: 'section',
        percentComplete: percent,
        qtyComplete: null,
      }),
    }))
    const { error } = await db
      .from('valuation_lines')
      .upsert(rows, { onConflict: 'valuation_id,boq_item_id' })
    if (error) throw new Error(error.message)
  },

  /**
   * Freeze the certificate figures onto the valuation row and mark it certified.
   */
  async certify(
    client: AnyClient,
    valuationId: string,
    args: {
      certifiedBy: string | null
      reportId: string | null
      figures: {
        grossToDate: number
        retention: number
        netToDate: number
        previousNet: number
        dueExVat: number
        vat: number
        dueInclVat: number
      }
    },
  ): Promise<Valuation> {
    const db = (client as AnyClient).schema('projects')
    const f = args.figures
    const { data, error } = await db
      .from('valuations')
      .update({
        status: 'certified',
        gross_to_date: f.grossToDate,
        retention_amount: f.retention,
        net_to_date: f.netToDate,
        previous_net: f.previousNet,
        due_ex_vat: f.dueExVat,
        vat_amount: f.vat,
        due_incl_vat: f.dueInclVat,
        certified_by: args.certifiedBy,
        certified_at: new Date().toISOString(),
        report_id: args.reportId,
      })
      .eq('id', valuationId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return rowToValuation(data)
  },

  /**
   * The prior CERTIFIED valuation's net_to_date for this project (the highest
   * valuation_no below `valuationNo` that is certified), or 0 if none.
   */
  async getPreviousNet(client: AnyClient, projectId: string, valuationNo: number): Promise<number> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('valuations')
      .select('net_to_date')
      .eq('project_id', projectId)
      .eq('status', 'certified')
      .lt('valuation_no', valuationNo)
      .order('valuation_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || data.net_to_date === null || data.net_to_date === undefined) return 0
    return Number(data.net_to_date)
  },
}
