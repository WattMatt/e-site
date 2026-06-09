import type { BoqItem, BoqImport, BoqSection } from '../schemas/boq.schema'
import type { SectionKind, QuantityMode, RateModel } from '../schemas/boq.schema'
import {
  rowToBoqImport,
  rowToBoqSection,
  rowToBoqItem,
  boqItemToRow,
} from './_boq-mappers'

// The boq tables are in the `projects` schema, which is not in the generated
// DB types. Cast as `any` at the schema('projects') boundary — the same pattern
// used by project-settings.service.ts and other non-generated-schema services.
type AnyClient = any

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ─── Pure functions ───────────────────────────────────────────────────────────

/**
 * Write-time amount rule — the single source of truth for computing an item's
 * amount from its rates and quantity.
 *
 * - rate_only (quantityMode): no computable amount → null
 * - amount_only (rateModel): stored amount is authoritative → return it
 * - supply_install: qty × (supplyRate + installRate), null rates treated as 0
 * - single: qty × rate
 * - If the required rate(s) are null (excluding supply_install where null=0) → null
 */
export function computeItemAmount(item: BoqItem): number | null {
  if (item.quantityMode === 'rate_only') return null
  if (item.rateModel === 'amount_only') return item.amount ?? null
  if (item.quantity === null) return null

  if (item.rateModel === 'supply_install') {
    const supply = item.supplyRate ?? 0
    const install = item.installRate ?? 0
    return round2(item.quantity * (supply + install))
  }

  // single
  if (item.rate === null) return null
  return round2(item.quantity * item.rate)
}

/**
 * Roll stored leaf `amount`s up the section tree.
 * - null amounts count as 0
 * - parent total = sum of its children's totals
 * - no infinite recursion (visits each node once)
 */
export function computeRollups(sections: BoqSection[], items: BoqItem[]): Map<string, number> {
  // Build children map: parentId → childId[]
  const childrenOf = new Map<string, string[]>()
  for (const s of sections) {
    if (s.parentSectionId) {
      const list = childrenOf.get(s.parentSectionId)
      if (list) list.push(s.id)
      else childrenOf.set(s.parentSectionId, [s.id])
    }
  }

  // Direct item sums per section (stored amount, null → 0)
  const directItemSum = new Map<string, number>()
  for (const it of items) {
    directItemSum.set(it.sectionId, (directItemSum.get(it.sectionId) ?? 0) + (it.amount ?? 0))
  }

  const totals = new Map<string, number>()

  const visit = (id: string): number => {
    if (totals.has(id)) return totals.get(id)!
    let sum = directItemSum.get(id) ?? 0
    for (const childId of childrenOf.get(id) ?? []) {
      sum += visit(childId)
    }
    sum = round2(sum)
    totals.set(id, sum)
    return sum
  }

  for (const s of sections) visit(s.id)
  return totals
}

// ─── Service client methods ───────────────────────────────────────────────────

export const boqService = {
  /**
   * Returns the current (is_current=true) import for a project, or null if
   * none exists.
   */
  async getCurrent(client: AnyClient, projectId: string): Promise<BoqImport | null> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('boq_imports')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return rowToBoqImport(data)
  },

  /**
   * Returns all sections and items for a given import.
   */
  async getTree(
    client: AnyClient,
    importId: string,
  ): Promise<{ sections: BoqSection[]; items: BoqItem[] }> {
    const db = (client as AnyClient).schema('projects')

    const { data: sectionRows, error: se } = await db
      .from('boq_sections')
      .select('*')
      .eq('import_id', importId)
      .order('sort_order')
    if (se) throw new Error(se.message)

    const { data: itemRows, error: ie } = await db
      .from('boq_items')
      .select('*')
      .in(
        'section_id',
        (sectionRows ?? []).map((r: Record<string, unknown>) => r.id),
      )
      .order('sort_order')
    if (ie) throw new Error(ie.message)

    return {
      sections: (sectionRows ?? []).map(rowToBoqSection),
      items: (itemRows ?? []).map(rowToBoqItem),
    }
  },

  /**
   * REPLACE semantics: demote prior current import, insert the new one,
   * insert sections in depth order (parents before children, resolving
   * tempId → uuid), then chunk-insert items.
   */
  async persistImport(
    client: AnyClient,
    args: {
      projectId: string
      organisationId: string
      sourceFilename: string
      storagePath: string | null
      importedBy: string | null
      totals: { exVat: number | null; vat: number | null; inclVat: number | null }
      sections: Array<{
        tempId: string
        parentTempId: string | null
        kind: SectionKind
        code: string | null
        title: string
        sortOrder: number
      }>
      items: Array<{
        sectionTempId: string
        code: string | null
        description: string
        unit: string | null
        quantity: number | null
        quantityMode: QuantityMode
        rateModel: RateModel
        supplyRate: number | null
        installRate: number | null
        rate: number | null
        amount: number | null
        sortOrder: number
      }>
    },
  ): Promise<BoqImport> {
    const db = (client as AnyClient).schema('projects')

    // 1. Demote prior current import (ignore error — may not exist)
    await db
      .from('boq_imports')
      .update({ is_current: false })
      .eq('project_id', args.projectId)
      .eq('is_current', true)

    // 2. Insert the new import
    const { data: imp, error: ie } = await db
      .from('boq_imports')
      .insert({
        project_id: args.projectId,
        organisation_id: args.organisationId,
        source_filename: args.sourceFilename,
        storage_path: args.storagePath,
        imported_by: args.importedBy,
        is_current: true,
        total_ex_vat: args.totals.exVat,
        vat_amount: args.totals.vat,
        total_incl_vat: args.totals.inclVat,
        line_item_count: args.items.length,
      })
      .select()
      .single()
    if (ie) throw new Error(ie.message)

    // 3. Insert sections ordered by tree depth (roots first) so parent FKs resolve
    const idMap = new Map<string, string>()

    const depthOf = (tempId: string): number => {
      const s = args.sections.find((x) => x.tempId === tempId)
      if (!s || !s.parentTempId) return 0
      return 1 + depthOf(s.parentTempId)
    }

    const ordered = [...args.sections].sort((a, b) => depthOf(a.tempId) - depthOf(b.tempId))

    for (const s of ordered) {
      const { data: secRow, error: se } = await db
        .from('boq_sections')
        .insert({
          import_id: imp.id,
          parent_section_id: s.parentTempId ? idMap.get(s.parentTempId) ?? null : null,
          kind: s.kind,
          code: s.code,
          title: s.title,
          sort_order: s.sortOrder,
        })
        .select('id')
        .single()
      if (se) throw new Error(se.message)
      idMap.set(s.tempId, secRow.id)
    }

    // 4. Insert items in chunks of 500
    const itemRows = args.items.map((it) => ({
      section_id: idMap.get(it.sectionTempId) ?? null,
      code: it.code,
      description: it.description,
      unit: it.unit,
      quantity: it.quantity,
      quantity_mode: it.quantityMode,
      rate_model: it.rateModel,
      supply_rate: it.supplyRate,
      install_rate: it.installRate,
      rate: it.rate,
      amount: it.amount,
      sort_order: it.sortOrder,
    }))

    for (let i = 0; i < itemRows.length; i += 500) {
      const { error: batchErr } = await db
        .from('boq_items')
        .insert(itemRows.slice(i, i + 500))
      if (batchErr) throw new Error(batchErr.message)
    }

    return rowToBoqImport(imp)
  },

  /**
   * Updates specific rate fields on a BOQ item, recomputes the amount via
   * `computeItemAmount`, and persists both.
   */
  async updateItemRate(
    client: AnyClient,
    itemId: string,
    patch: { supplyRate?: number | null; installRate?: number | null; rate?: number | null },
  ): Promise<BoqItem> {
    const db = (client as AnyClient).schema('projects')

    // Fetch the current item
    const { data: current, error: fe } = await db
      .from('boq_items')
      .select('*')
      .eq('id', itemId)
      .single()
    if (fe) throw new Error(fe.message)

    const merged = rowToBoqItem({ ...current, ...boqItemToRow(patch) })
    const amount = computeItemAmount(merged)

    const updatePayload = { ...boqItemToRow(patch), amount }

    const { data: updated, error: ue } = await db
      .from('boq_items')
      .update(updatePayload)
      .eq('id', itemId)
      .select()
      .single()
    if (ue) throw new Error(ue.message)

    return rowToBoqItem(updated)
  },

  /**
   * Promotes a different import to is_current, demoting the previous one.
   */
  async setCurrent(client: AnyClient, importId: string): Promise<void> {
    const db = (client as AnyClient).schema('projects')

    // Fetch the import to get project_id
    const { data: imp, error: fe } = await db
      .from('boq_imports')
      .select('project_id')
      .eq('id', importId)
      .single()
    if (fe) throw new Error(fe.message)

    // Demote all current imports for the project
    await db
      .from('boq_imports')
      .update({ is_current: false })
      .eq('project_id', imp.project_id)
      .eq('is_current', true)

    // Promote the target
    const { error: ue } = await db
      .from('boq_imports')
      .update({ is_current: true })
      .eq('id', importId)
    if (ue) throw new Error(ue.message)
  },
}
