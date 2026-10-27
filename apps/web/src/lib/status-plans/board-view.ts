/**
 * "Floor plan by main board" (spec 2026-10-13 §1): a resolved ShapeView re-coloured by
 * the board that feeds its shop. Applied ON TOP of resolveShapeView, so labels, areas,
 * area checks and "needs attention" are the same in both modes; only colour, legend
 * key and status line change. Area shapes keep their neutral colours; unlinked and
 * invalid shapes are untouched. Shared by the canvas and the PDF renderer input.
 */
import {
  AREA_TYPES, AREA_TYPE_LABEL, FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE, SHOP_STATUS_LABEL,
  areaShapeStyle, boardShapeStyle, tenantShapeStyle,
  type LegendEntry, type ShapeStyle,
} from '@esite/shared/status-plans'
import type { ShapeView } from './shape-view'
import type { PlanFeed } from './types'

export type PlanFeedOk = Extract<PlanFeed, { state: 'ok' }>

export const FEED_UNKNOWN_KEY = 'feed_unknown'
export const boardKey = (boardId: string): string => `board:${boardId}`

export function boardView(v: ShapeView, nodeId: string | null, feed: PlanFeedOk): ShapeView {
  if (v.invalid || !v.shopLinked || !nodeId) return v
  const strike = v.style.strikeLabel
  const match = feed.byNode[nodeId] ?? null
  const board = match ? feed.boards.find((b) => b.id === match.boardId) : undefined
  if (!match || !board) {
    return {
      ...v,
      style: { ...FEED_UNKNOWN_STYLE, strikeLabel: strike },
      legendKey: FEED_UNKNOWN_KEY,
      overdue: false,
      statusLabel: FEED_UNKNOWN_LABEL,
      feedAlso: [],
    }
  }
  const also = match.also
    .map((id) => feed.boards.find((b) => b.id === id)?.name)
    .filter((n): n is string => typeof n === 'string')
  return {
    ...v,
    style: boardShapeStyle(board.colour, strike),
    legendKey: boardKey(board.id),
    overdue: false,
    statusLabel: `Fed from ${board.name}`,
    feedAlso: also,
  }
}

export interface BoardLegendRow {
  key: string
  label: string
  style: ShapeStyle
  count: number
  /** Measured GLA of the linked shops in this row; null when none is measured. */
  m2: number | null
}

/** Boards (feed order), then no-feed, unassigned and the area types. Invalid outlines count nowhere. */
export function boardLegendRows(views: readonly ShapeView[], feed: PlanFeedOk): BoardLegendRow[] {
  const acc = new Map<string, { count: number; m2: number; measured: number }>()
  for (const v of views) {
    if (v.invalid) continue
    const a = acc.get(v.legendKey) ?? { count: 0, m2: 0, measured: 0 }
    a.count++
    if (v.shopLinked && v.areaM2 !== null) {
      a.m2 += v.areaM2
      a.measured++
    }
    acc.set(v.legendKey, a)
  }
  const row = (key: string, label: string, style: ShapeStyle): BoardLegendRow => {
    const a = acc.get(key)
    return { key, label, style, count: a?.count ?? 0, m2: a && a.measured > 0 ? a.m2 : null }
  }
  return [
    ...feed.boards.map((b) => row(boardKey(b.id), b.name, boardShapeStyle(b.colour))),
    row(FEED_UNKNOWN_KEY, FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE),
    row('unlinked', SHOP_STATUS_LABEL.unlinked, tenantShapeStyle({ status: 'unlinked', overdue: false })),
    ...AREA_TYPES.map((t) => row(t, AREA_TYPE_LABEL[t], areaShapeStyle(t))),
  ]
}

/** The rows as the PDF renderer's legend: the measured area rides in the label. */
export function boardLegendEntries(rows: readonly BoardLegendRow[]): { legend: LegendEntry[]; counts: Record<string, number> } {
  return {
    legend: rows.map((r) => ({ key: r.key, label: r.m2 === null ? r.label : `${r.label} (${r.m2.toFixed(1)} m²)`, style: r.style })),
    counts: Object.fromEntries(rows.map((r) => [r.key, r.count])),
  }
}
