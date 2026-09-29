/**
 * Layout Summary and BOM (functional spec §6.4). Pure.
 *
 * Every AREA uses the object's OWN pixelsPerMeter snapshot. An object without
 * one (unsaved) uses `fallbackPpm` (the sheet's current scale) when the caller
 * passes it, else it is skipped from metre figures but still counted.
 * A DISTANCE between two objects converts both positions with ONE scale (the
 * array's) — positions share one image space, so mixing scales would move them.
 * Utilisation = module plan area / roof plan area — for a flush array on a
 * pitched roof both are foreshortened the same way, so the ratio is the true one.
 */
import { flatToPts, pointInPolygon, polygonArea, pxToM, vertexMean } from './geometry'
import { stringCheck, type DesignConditions } from './strings'
import { isArrayObject, type ArrayObject, type LayoutObject } from './types'

/** Detour allowance for DC home runs (trays, risers). An estimate, labelled as one. */
export const DC_ROUTING_FACTOR = 1.1

export interface LayoutSummary {
  moduleCount: number
  dcKwp: number
  acKw: number
  dcAcRatio: number | null
  modulesByType: Array<{ label: string; count: number; kwp: number }>
  inverterCount: number
  strings: { total: number; pass: number; warn: number; fail: number }
  roofAreaM2: number
  moduleAreaM2: number
  utilisationPct: number | null
  arraysWithModules: number
  arraysOutsideRoof: string[]
  unstrungModules: number
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp

export function layoutSummary(objects: LayoutObject[], conditions: DesignConditions, fallbackPpm: number | null = null): LayoutSummary {
  const ppmOf = (o: LayoutObject) => o.pixelsPerMeter ?? fallbackPpm
  const arrays = objects.filter(isArrayObject)
  const roofs = objects.filter((o) => o.kind === 'roof')
  const inverters = objects.filter((o) => o.kind === 'inverter')
  const strings = objects.filter((o) => o.kind === 'string')

  const byType = new Map<string, { label: string; count: number; kwp: number }>()
  let moduleCount = 0
  let dcKwp = 0
  let moduleAreaM2 = 0
  for (const a of arrays) {
    const n = a.geometry.modules.length
    moduleCount += n
    const kwp = (n * a.props.module.powerW) / 1000
    dcKwp += kwp
    const label = `${a.props.module.make} ${a.props.module.model}`
    const t = byType.get(label) ?? { label, count: 0, kwp: 0 }
    t.count += n
    t.kwp = round(t.kwp + kwp)
    byType.set(label, t)
    const appm = ppmOf(a)
    if (appm) for (const q of a.geometry.modules) moduleAreaM2 += polygonArea(pxToM(q, appm))
  }

  let roofAreaM2 = 0
  for (const r of roofs) {
    const rppm = ppmOf(r)
    if (rppm && r.kind === 'roof') roofAreaM2 += polygonArea(pxToM(r.geometry.points, rppm))
  }

  const acKw = inverters.reduce((s, o) => s + (o.kind === 'inverter' ? o.props.inverter.acKw : 0), 0)

  const roofPolys = roofs.map((r) => (r.kind === 'roof' ? flatToPts(r.geometry.points) : []))
  const arraysOutsideRoof = arrays
    .filter((a) => a.geometry.modules.some((q) => !roofPolys.some((poly) => pointInPolygon(vertexMean(flatToPts(q)), poly))))
    .map((a) => a.id)

  const arrayById = new Map<string, ArrayObject>(arrays.map((a) => [a.id, a]))
  const inverterById = new Map(inverters.map((o) => [o.id, o]))
  const counts = { total: 0, pass: 0, warn: 0, fail: 0 }
  const perMppt = new Map<string, number>()
  for (const s of strings) if (s.kind === 'string') perMppt.set(`${s.props.inverterId}#${s.props.mppt}`, (perMppt.get(`${s.props.inverterId}#${s.props.mppt}`) ?? 0) + 1)
  const strung = new Set<string>()
  for (const s of strings) {
    if (s.kind !== 'string') continue
    counts.total++
    for (const m of s.props.modules) strung.add(`${m.arrayId}#${m.index}`)
    const inv = inverterById.get(s.props.inverterId)
    const first = s.props.modules[0] ? arrayById.get(s.props.modules[0].arrayId) : undefined
    if (!inv || inv.kind !== 'inverter' || !first || s.props.modules.length === 0) { counts.fail++; continue }
    const r = stringCheck(first.props.module, inv.props.inverter, s.props.modules.length,
      perMppt.get(`${s.props.inverterId}#${s.props.mppt}`) ?? 1, first.props.mounting, conditions)
    if (!r.ok) counts.fail++
    else if (r.checks.some((c) => c.status === 'warn')) counts.warn++
    else counts.pass++
  }
  let unstrungModules = 0
  for (const a of arrays) for (let i = 0; i < a.geometry.modules.length; i++) if (!strung.has(`${a.id}#${i}`)) unstrungModules++

  return {
    moduleCount,
    dcKwp: round(dcKwp),
    acKw: round(acKw),
    dcAcRatio: acKw > 0 ? round(dcKwp / acKw, 9) : null,
    modulesByType: [...byType.values()],
    inverterCount: inverters.length,
    strings: counts,
    roofAreaM2: round(roofAreaM2),
    moduleAreaM2: round(moduleAreaM2),
    utilisationPct: roofAreaM2 > 0 ? (round(moduleAreaM2) / round(roofAreaM2)) * 100 : null,
    arraysWithModules: arrays.filter((a) => a.geometry.modules.length > 0).length,
    arraysOutsideRoof,
    unstrungModules,
  }
}

/** What solar.layouts.summary stores (00212): the list and readiness read it without loading geometry. */
export interface StoredLayoutSummary {
  moduleCount: number
  dcKwp: number
  acKw: number
  arraysWithModules: number
  arrayOutsideRoof: boolean
  stringsFail: number
}

export function storedSummary(s: LayoutSummary): StoredLayoutSummary {
  return {
    moduleCount: s.moduleCount,
    dcKwp: s.dcKwp,
    acKw: s.acKw,
    arraysWithModules: s.arraysWithModules,
    arrayOutsideRoof: s.arraysOutsideRoof.length > 0,
    stringsFail: s.strings.fail,
  }
}

export interface BomRow {
  item: string
  description: string
  quantity: number
  unit: string
}

export function layoutBom(objects: LayoutObject[], summary: LayoutSummary, fallbackPpm: number | null = null): BomRow[] {
  const rows: BomRow[] = summary.modulesByType.map((t) => ({ item: 'Module', description: t.label, quantity: t.count, unit: 'ea' }))
  const invs = new Map<string, number>()
  for (const o of objects) if (o.kind === 'inverter') {
    const label = `${o.props.inverter.make} ${o.props.inverter.model}`
    invs.set(label, (invs.get(label) ?? 0) + 1)
  }
  for (const [label, n] of invs) rows.push({ item: 'Inverter', description: label, quantity: n, unit: 'ea' })

  const arrays = objects.filter(isArrayObject)
  const racked = arrays.filter((a) => a.props.mounting === 'racked').reduce((s, a) => s + a.geometry.modules.length, 0)
  const flushRailM = arrays.filter((a) => a.props.mounting === 'flush')
    .reduce((s, a) => s + a.geometry.modules.length * 2 * ((a.props.orientation === 'portrait' ? a.props.module.widthM : a.props.module.lengthM) + a.props.gapM), 0)
  if (racked > 0) rows.push({ item: 'Mounting', description: 'Racking positions (estimate)', quantity: racked, unit: 'ea' })
  if (flushRailM > 0) rows.push({ item: 'Mounting', description: 'Flush rail, two rails per module row (estimate)', quantity: round(flushRailM, 2), unit: 'm' })

  const arrayById = new Map(arrays.map((a) => [a.id, a]))
  const invById = new Map(objects.filter((o) => o.kind === 'inverter').map((o) => [o.id, o]))
  let dcM = 0
  for (const s of objects) {
    if (s.kind !== 'string') continue
    const inv = invById.get(s.props.inverterId)
    const first = s.props.modules[0] ? arrayById.get(s.props.modules[0].arrayId) : undefined
    const frame = first ? (first.pixelsPerMeter ?? fallbackPpm) : null
    if (!inv || inv.kind !== 'inverter' || !frame) continue
    const pts = s.props.modules.flatMap((m) => {
      const q = arrayById.get(m.arrayId)?.geometry.modules[m.index]
      return q ? [vertexMean(pxToM(q, frame))] : []
    })
    if (pts.length === 0) continue
    const c = vertexMean(pts)
    const ip = { x: inv.geometry.x / frame, y: inv.geometry.y / frame }
    dcM += (Math.abs(c.x - ip.x) + Math.abs(c.y - ip.y)) * 2 * DC_ROUTING_FACTOR
  }
  if (dcM > 0) rows.push({ item: 'DC cable', description: 'String home runs, + and −, Manhattan route × 1.1 (estimate)', quantity: round(dcM, 2), unit: 'm' })
  return rows
}

function csvField(v: string | number): string {
  let s = String(v)
  // A text cell starting with = + - @ (or tab/CR) is run as a formula by
  // spreadsheet apps; module/inverter names are free text (CSV injection).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function bomToCsv(rows: BomRow[]): string {
  const lines = [['Item', 'Description', 'Quantity', 'Unit'], ...rows.map((r) => [r.item, r.description, r.quantity, r.unit])]
  return lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n'
}
