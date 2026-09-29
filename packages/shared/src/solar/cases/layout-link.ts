/**
 * A case built "From layout" (functional spec §7.1, 4b open question Q5 — resolved by the
 * integration merge that brought Phase 5's layouts and 00219's cases.layout_id FK).
 *
 * The layout decides the PV SIZE (DC from the placed modules, AC from the placed inverters) and
 * the BILL OF MATERIALS. Everything else on the case (tilt, azimuth, losses, battery, weather)
 * stays a case input. Sizes are computed by the server from the layout's own objects — never
 * from the client or the stored summary JSON, which a direct PostgREST write could set.
 */
import type { BomRow } from '../layout/summary'
import type { CapexLine, CaseFinanceConfig } from './finance-config'

export function caseSizeFromLayout(s: { moduleCount: number; dcKwp: number; acKw: number }):
  { ok: true; dcKwp: number; acKw: number } | { ok: false; error: string } {
  if (!(s.moduleCount > 0) || !(s.dcKwp > 0)) return { ok: false, error: 'This layout has no modules yet — place modules on it first.' }
  if (!(s.acKw > 0)) return { ok: false, error: 'This layout has no inverter yet — add one on the Layout tab first.' }
  return { ok: true, dcKwp: s.dcKwp, acKw: s.acKw }
}

const CATEGORY: Record<string, CapexLine['category']> = {
  Module: 'modules', Inverter: 'inverters', Mounting: 'mounting', 'DC cable': 'dc_bos',
}
const UNIT: Record<string, CapexLine['unit']> = { ea: 'item', m: 'm' }

/**
 * "Import BOM from layout" (spec §8): replaces the lines it made last time (source 'layout_bom')
 * and keeps every other line. The BOM has quantities, not prices: a re-import keeps the rate the
 * user typed on a line with the same category + description; a new line starts at R0.
 */
export function importLayoutBom(fin: CaseFinanceConfig, rows: readonly BomRow[]): CaseFinanceConfig {
  const priorRate = new Map(fin.capex.filter((l) => l.source === 'layout_bom').map((l) => [`${l.category}|${l.description}`, l.rateZar]))
  const lines: CapexLine[] = rows.map((r, i) => {
    const category = CATEGORY[r.item] ?? 'dc_bos'
    const description = r.description.slice(0, 200)
    return {
      id: `bom-${i}`, category, description, qty: r.quantity, unit: UNIT[r.unit] ?? 'item',
      rateZar: priorRate.get(`${category}|${description}`) ?? 0, qualifies12b: true, source: 'layout_bom',
    }
  })
  return { ...fin, capex: [...fin.capex.filter((l) => l.source !== 'layout_bom'), ...lines] }
}
