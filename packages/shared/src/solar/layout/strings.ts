/**
 * Strings on the layout (functional spec §6.3 "Assign strings", engine §3.3).
 *
 * The check itself is Phase 4a's checkStringSizing (services/solar/pv/
 * string-sizing.ts); this module adapts layout specs to it, orders modules for
 * wiring, and fills MPPT inputs. Pure.
 */
import {
  checkStringSizing,
  recommendedModulesInSeries,
  type StringSizingResult,
} from '../../services/solar/pv/string-sizing'
import { flatToPts, vertexMean, distance } from './geometry'
import { sheetDirection } from './orientation'
import type { LayoutInverterSpec, LayoutModuleSpec, ModuleRef, MountingKind, StringProps } from './types'

export interface DesignConditions {
  tMinC: number
  tAmbMaxC: number
}

function mpptOf(inv: LayoutInverterSpec) {
  return { vDcMax: inv.vDcMax, vMpptMin: inv.vMpptMin, vMpptMax: inv.vMpptMax, iMpptMax: inv.iMpptMax }
}

export function stringCheck(
  module: LayoutModuleSpec, inverter: LayoutInverterSpec, modulesInSeries: number, stringsOnMppt: number,
  mounting: MountingKind, c: DesignConditions,
): StringSizingResult {
  return checkStringSizing({
    module, mppt: mpptOf(inverter), modulesInSeries, stringsInParallel: stringsOnMppt,
    tMinC: c.tMinC, tAmbMaxC: c.tAmbMaxC, mounting,
  })
}

export function recommendedStringLength(
  module: LayoutModuleSpec, inverter: LayoutInverterSpec, mounting: MountingKind, c: DesignConditions,
): number | null {
  return recommendedModulesInSeries({
    module, mppt: mpptOf(inverter), stringsInParallel: 1, tMinC: c.tMinC, tAmbMaxC: c.tAmbMaxC, mounting,
  })
}

export function maxStringsPerMppt(module: LayoutModuleSpec, inverter: LayoutInverterSpec): number {
  return Math.max(0, Math.floor(inverter.iMpptMax / (module.iscStc * 1.25) + 1e-9))
}

/**
 * Wiring order: rows along the facing direction (the row nearest the back of
 * the array first), snaking — even rows left→right across, odd rows back.
 * `quads` are image-pixel quads; returns indices into `quads`.
 */
export function serpentineOrder(quads: number[][], facingSheetDeg: number): number[] {
  if (quads.length === 0) return []
  const vh = sheetDirection(facingSheetDeg)
  const uh = sheetDirection(facingSheetDeg + 90)
  const items = quads.map((q, i) => {
    const pts = flatToPts(q)
    const c = vertexMean(pts)
    return { i, u: c.x * uh.x + c.y * uh.y, v: c.x * vh.x + c.y * vh.y, h: Math.min(distance(pts[0]!, pts[1]!), distance(pts[1]!, pts[2]!)) }
  })
  items.sort((a, b) => a.v - b.v || a.u - b.u)
  const tol = items[0]!.h / 2
  const rows: Array<typeof items> = []
  for (const it of items) {
    const row = rows[rows.length - 1]
    if (row && it.v - row[0]!.v <= tol) row.push(it)
    else rows.push([it])
  }
  return rows.flatMap((row, r) => {
    const sorted = [...row].sort((a, b) => a.u - b.u)
    return (r % 2 === 0 ? sorted : sorted.reverse()).map((x) => x.i)
  })
}

export interface AutoStringInput {
  arrays: Array<{ id: string; quads: number[][]; facingSheetDeg: number }>
  existingStrings: StringProps[]
  inverterId: string
  inverter: LayoutInverterSpec
  module: LayoutModuleSpec
  mounting: MountingKind
  conditions: DesignConditions
}

export interface AutoStringResult {
  stringLength: number
  strings: Array<{ mppt: number; modules: ModuleRef[] }>
  unstrung: ModuleRef[]
  /** Why anything is unstrung, as a sentence; null when everything was strung. */
  reason: string | null
}

export function autoString(i: AutoStringInput): AutoStringResult {
  const n = recommendedStringLength(i.module, i.inverter, i.mounting, i.conditions)
  if (n === null) throw new Error('No string length passes the checks for this module on this inverter.')
  const perMppt = maxStringsPerMppt(i.module, i.inverter)

  const taken = new Set(i.existingStrings.flatMap((s) => s.modules.map((m) => `${m.arrayId}#${m.index}`)))
  const queue: ModuleRef[] = i.arrays.flatMap((a) =>
    serpentineOrder(a.quads, a.facingSheetDeg)
      .map((index) => ({ arrayId: a.id, index }))
      .filter((m) => !taken.has(`${m.arrayId}#${m.index}`)),
  )

  const used = new Map<number, number>()
  for (const s of i.existingStrings) if (s.inverterId === i.inverterId) used.set(s.mppt, (used.get(s.mppt) ?? 0) + 1)
  const nextMppt = (): number | null => {
    for (let m = 1; m <= i.inverter.mppts; m++) if ((used.get(m) ?? 0) < perMppt) return m
    return null
  }

  const strings: AutoStringResult['strings'] = []
  let cursor = 0
  let full = false
  while (queue.length - cursor >= n) {
    const mppt = nextMppt()
    if (mppt === null) { full = true; break }
    strings.push({ mppt, modules: queue.slice(cursor, cursor + n) })
    used.set(mppt, (used.get(mppt) ?? 0) + 1)
    cursor += n
  }
  const unstrung = queue.slice(cursor)
  let reason: string | null = null
  if (full) reason = 'The inverter has no free MPPT input for the remaining modules.'
  else if (unstrung.length > 0) {
    reason = `${unstrung.length} module${unstrung.length === 1 ? ' is' : 's are'} left over — fewer than one string of ${n}.`
  }
  return { stringLength: n, strings, unstrung, reason }
}
