/**
 * SHOP label detection on a tenant floor plan (spec 2026-10-21).
 *
 * Input: upright text runs already in image space (text-space.ts).
 * Output: one label per `SHOP nn` run, with the tenant name and the m² figure
 * printed beside it when there is one. Pure: it finds labels and says nothing
 * about which tenant or which shape they belong to.
 *
 * A duplicate tag is two labels that normalise to the same key. Both stay in
 * `labels`; `duplicates` counts them so the review panel can say so, and
 * nothing is dropped or merged silently.
 */
import type { Box, Pt } from './geometry'
import { isTagShaped, normaliseTag, stripLeadingZeros } from './match-nodes'
import type { ImageTextItem } from './text-space'

/** `SHOP 92A`, `Shop 10a`, `SHOP K04`, `SHOP 20/21`. Group 1 is the tag as printed. */
export const SHOP_LABEL_RE = /^SHOP\s*([0-9A-Z][0-9A-Z/.-]*)$/i

/** A name or an m² figure belongs to a label when its centre is within this many image pixels of the label's centre. */
export const NEAR_PX = 120

/** The word on its own, the first half of a label split across two runs. */
const SHOP_WORD_RE = /^SHOP$/i
/** What the second half of a split label looks like. */
const TAG_ONLY_RE = /^[0-9A-Z][0-9A-Z/.-]*$/i
/** The join tolerances: the tag's baseline within this × the SHOP run's height … */
const JOIN_BASELINE = 0.35
/** … and its left edge within this × that height of the SHOP run's right edge. */
const JOIN_GAP = 1

export interface DetectedShopLabel {
  /** As printed ('92A', '10a'), without the word SHOP. */
  tag: string
  /** The label's text, image pixels. */
  box: Box
  /** Centre of `box`. */
  anchor: Pt
  /** The nearest text that reads as a name, or null. */
  name: string | null
  /** The nearest m² figure, or null. */
  drawingAreaM2: number | null
}

export interface ShopLabelResult {
  labels: DetectedShopLabel[]
  /** normaliseTag(tag) (leading zeros dropped) → how many labels carry it, for every tag seen more than once. */
  duplicates: Record<string, number>
  /** How many text runs were read. */
  textItemCount: number
}

const AREA_RE = /^(\d[\d,]*(?:\.\d+)?)\s*m[²2]$/i

/** '31.67 m²', '2,825 m2', '28 m²' → the number; anything else (including a bare 'm²' or '340 mm') → null. */
export function parseAreaM2(str: string): number | null {
  const m = AREA_RE.exec(str.trim())
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function shopTag(str: string): string | null {
  const m = SHOP_LABEL_RE.exec(str.trim())
  // "SHOPFRONT" fits the regex; a tag must also read like a tag.
  return m && isTagShaped(m[1]) ? m[1] : null
}

function boxOf(items: readonly ImageTextItem[]): Box {
  return {
    minX: Math.min(...items.map((i) => i.x)),
    minY: Math.min(...items.map((i) => i.top)),
    maxX: Math.max(...items.map((i) => i.x + i.width)),
    maxY: Math.max(...items.map((i) => i.baseline)),
  }
}

interface RawLabel {
  tag: string
  box: Box
  anchor: Pt
}

/** A SHOP run followed on its baseline by a tag-shaped run, the way a split run would sit. */
function joinedTag(shop: ImageTextItem, items: readonly ImageTextItem[], taken: ReadonlySet<ImageTextItem>): ImageTextItem | null {
  const right = shop.x + shop.width
  let best: ImageTextItem | null = null
  let bestGap = Infinity
  for (const c of items) {
    if (c === shop || taken.has(c) || !TAG_ONLY_RE.test(c.str) || !isTagShaped(c.str)) continue
    if (Math.abs(c.baseline - shop.baseline) > JOIN_BASELINE * shop.height) continue
    const gap = c.x - right
    if (gap < -shop.height || gap > JOIN_GAP * shop.height) continue
    if (Math.abs(gap) < bestGap) { best = c; bestGap = Math.abs(gap) }
  }
  return best
}

export function detectShopLabels(items: readonly ImageTextItem[]): ShopLabelResult {
  const raw: RawLabel[] = []
  /** Runs that are part of a label: never a name or an area. */
  const used = new Set<ImageTextItem>()

  for (const it of items) {
    if (used.has(it)) continue
    const tag = shopTag(it.str)
    if (tag !== null) {
      const box = boxOf([it])
      used.add(it)
      raw.push({ tag, box, anchor: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } })
    }
  }
  for (const it of items) {
    if (used.has(it) || !SHOP_WORD_RE.test(it.str.trim())) continue
    const part = joinedTag(it, items, used)
    if (!part) continue
    used.add(it)
    used.add(part)
    const box = boxOf([it, part])
    raw.push({ tag: part.str.trim(), box, anchor: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } })
  }

  const labels: DetectedShopLabel[] = raw.map((l) => {
    let name: { str: string; d: number } | null = null
    let area: { v: number; d: number } | null = null
    for (const it of items) {
      if (used.has(it) || SHOP_WORD_RE.test(it.str.trim())) continue
      const d = Math.hypot(it.x + it.width / 2 - l.anchor.x, it.top + it.height / 2 - l.anchor.y)
      if (d > NEAR_PX) continue
      const v = parseAreaM2(it.str)
      if (v !== null) {
        if (!area || d < area.d) area = { v, d }
      } else if (/\p{L}/u.test(it.str)) {
        if (!name || d < name.d) name = { str: it.str.trim(), d }
      }
    }
    return { tag: l.tag, box: l.box, anchor: l.anchor, name: name ? name.str : null, drawingAreaM2: area ? area.v : null }
  })

  const counts = new Map<string, number>()
  for (const l of labels) {
    const key = stripLeadingZeros(normaliseTag(l.tag))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const duplicates: Record<string, number> = {}
  for (const [key, n] of counts) if (n > 1) duplicates[key] = n

  return { labels, duplicates, textItemCount: items.length }
}
