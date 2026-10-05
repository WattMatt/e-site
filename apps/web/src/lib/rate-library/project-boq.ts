// No 'server-only' import: no secret here (the caller passes the client).
/**
 * A project's CURRENT imported BOQ (projects.boq_*, 00122) as rate-library
 * ingest lines, each carrying its section path and boq_item id.
 *
 * Read with the service client BEHIND a project role gate (the same shape as
 * boq.actions.ts): boq_* RLS admits every project member, and the app narrows
 * cost data to COST_VIEW_ROLES.
 */
import type { IngestLine, QuantityMode } from '@esite/shared'
import type { AnyClient } from './data'

export interface ProjectBoq {
  importId: string
  sourceFilename: string | null
  importedAt: string
  totalExVat: number | null
  lines: (IngestLine & { boqItemId: string; origin: string | null; rateModel: string })[]
}

const PAGE = 1000

async function all<T>(build: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await build(a, a + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

export async function loadProjectBoq(service: AnyClient, projectId: string): Promise<ProjectBoq | null> {
  const db = service.schema('projects')
  const { data: imp, error } = await db.from('boq_imports')
    .select('id, source_filename, imported_at, total_ex_vat').eq('project_id', projectId).eq('is_current', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!imp) return null

  const sections = await all<{ id: string; parent_section_id: string | null; title: string }>((a, b) =>
    db.from('boq_sections').select('id, parent_section_id, title').eq('import_id', imp.id).order('id').range(a, b))
  const byId = new Map(sections.map(s => [s.id, s]))
  const pathOf = (id: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parent_section_id ? byId.get(cur.parent_section_id) : undefined) {
      seen.add(cur.id); out.unshift(cur.title)
    }
    return out
  }
  const ids = sections.map(s => s.id)
  const items: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    items.push(...await all<Record<string, unknown>>((a, b) => db.from('boq_items')
      .select('id, section_id, code, description, unit, quantity, quantity_mode, rate_model, supply_rate, install_rate, rate, amount, sort_order, origin')
      .in('section_id', part).order('section_id').order('sort_order').order('id').range(a, b)))
  }
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    importId: imp.id, sourceFilename: imp.source_filename ?? null, importedAt: imp.imported_at, totalExVat: num(imp.total_ex_vat),
    lines: items.map(it => ({
      boqItemId: String(it.id), origin: (it.origin as string) ?? null, rateModel: String(it.rate_model),
      sheet: null, rowRef: `boq_item:${it.id}`, code: (it.code as string) ?? null, sectionPath: pathOf(String(it.section_id)),
      description: String(it.description), unit: (it.unit as string) ?? null, quantity: num(it.quantity),
      supplyRate: num(it.supply_rate), installRate: num(it.install_rate), rate: num(it.rate), amount: num(it.amount),
      quantityMode: (it.quantity_mode as QuantityMode) ?? null,
    })),
  }
}
