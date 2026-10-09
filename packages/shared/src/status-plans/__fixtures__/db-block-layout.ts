/**
 * Invented DB-block layouts for detector tests. NOTHING here comes from a
 * client drawing: the repo is public. Tags, names, ratings, cables and serials
 * are made up and chosen not to resemble any real sheet.
 *
 * Geometry mimics a schematic table: text height H, rows PITCH apart, values
 * in a column VALUE_DX right of the label column's left edge.
 */
import type { ImageTextItem } from '../text-space'

export const H = 10
export const PITCH = 16
export const VALUE_DX = 50
const CHAR_W = 6

export const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'] as const
export type Values = readonly [string, string, string, string, string, string, string]

export const ALPHA: Values = ['DB-71', 'ALPHA STORE', '412.50m2', '250A TP', '4C 95mm2 CU', 'ZX-0001', '250/5A']
export const BRAVO: Values = ['DB-72', 'BRAVO SHOP', '96.00m2', '60A TP', '4C 16mm2 CU', 'ZX-0002', '']
export const CHARLIE: Values = ['DB-90/91', 'CHARLIE HALL', '880.10m2', '400A TP', '4C 185mm2 AL', 'ZX-0003', '400/5A']
export const DELTA_NO_TAG: Values = ['', 'DELTA KIOSK', '12.00m2', '20A SP', '3C 6mm2 CU', '', '']

export function textAt(str: string, x: number, baseline: number, h = H): ImageTextItem {
  return { str, x, baseline, top: baseline - h, width: str.length * CHAR_W * (h / H), height: h }
}

export interface BlockSpec {
  x: number
  /** Baseline of the NO: row. */
  y: number
  values: Values
  h?: number
  /** Leave this row's label out (0 = NO:, 6 = CT:). */
  omitLabel?: number
  /** Move one row's label sideways by dx. */
  shiftLabel?: { row: number; dx: number }
}

export function blockItems(spec: BlockSpec): ImageTextItem[] {
  const h = spec.h ?? H
  const k = h / H
  const out: ImageTextItem[] = []
  LABELS.forEach((label, row) => {
    const baseline = spec.y + row * PITCH * k
    if (spec.omitLabel !== row) {
      const dx = spec.shiftLabel?.row === row ? spec.shiftLabel.dx : 0
      out.push(textAt(label, spec.x + dx, baseline, h))
    }
    const v = spec.values[row]
    if (v) out.push(textAt(v, spec.x + VALUE_DX * k, baseline, h))
  })
  return out
}

/**
 * The same runs as pdf.js would report them on a /Rotate 90 page viewed at
 * scale 2 (viewport transform [0, 2, 2, 0, 0, 0] for a viewBox at the origin):
 * raster x = 2·userY, raster baseline = 2·userX, text drawn turned +90°.
 */
export function toRotated90UserSpace(items: readonly ImageTextItem[]) {
  return items.map((i) => ({
    str: i.str,
    transform: [0, i.height / 2, -i.height / 2, 0, i.baseline / 2, i.x / 2],
    width: i.width / 2,
    height: i.height / 2,
  }))
}
