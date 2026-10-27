/**
 * The ONE colour table for status plans (spec 2026-10-09 §6). The Konva canvas,
 * the legends and the pdf-lib renderer all read it, so screen and PDF cannot
 * disagree. Widths are image pixels at the scale-2 raster. Colours are #RRGGBB;
 * hexToRgb01 converts them for pdf-lib.
 *
 * Every status is a SOLID colour (owner, 2026-10-14: "the hatched masking needs
 * to be a solid colour and clearly colour coded"): a translucent fill, so the
 * drawing's text under it stays readable, plus a full-strength outline in the
 * same colour. Nothing here hatches any more; ShapeStyle.hatches stays so the
 * renderers keep one shape model, and is always empty.
 */
import { AREA_TYPE_LABEL, AREA_TYPES, type AreaType } from './types'
import { SHOP_STATUS_LABEL, type ShopStatus, type ShopStatusResult } from './shop-status'
import { DB_BLOCK_STATUS_LABEL, type DbBlockStatus } from './db-block-status'
import { compareBoardNames, type FeedBoard } from './feed'

export const COLOURS = {
  complete: '#2E9E4F',
  inProgress: '#F08A24',
  overdue: '#D64545',
  ordered: '#E0A100',
  byTenant: '#5B7FA6',
  noOrder: '#C3C8CE',
  neutral: '#6B7280',
  unlinked: '#9AA0A6',
  decommissioned: '#B8BCC2',
  common: '#8FA9C7',
  plantRoom: '#5F7A99',
  services: '#A9B8C9',
  vacant: '#D9DEE4',
} as const

export const HATCH_SPACING_PX = 14
export const STROKE_PX = 3

export interface HatchSpec {
  angleDeg: number
  spacing: number
  color: string
  width: number
}

export interface ShapeStyle {
  fill: string | null
  fillOpacity: number
  stroke: string
  strokeWidth: number
  dash: readonly number[] | null
  hatches: readonly HatchSpec[]
  strikeLabel: boolean
}

export interface LegendEntry {
  key: string
  label: string
  style: ShapeStyle
}

function style(over: Partial<ShapeStyle>): ShapeStyle {
  return {
    fill: null,
    fillOpacity: 0,
    stroke: COLOURS.neutral,
    strokeWidth: STROKE_PX,
    dash: null,
    hatches: [],
    strikeLabel: false,
    ...over,
  }
}

const TENANT_BASE: Record<ShopStatus, ShapeStyle> = {
  complete: style({ fill: COLOURS.complete, fillOpacity: 0.45, stroke: COLOURS.complete }),
  in_progress: style({ fill: COLOURS.inProgress, fillOpacity: 0.45, stroke: COLOURS.inProgress }),
  decommissioned: style({ fill: COLOURS.decommissioned, fillOpacity: 0.45, stroke: COLOURS.decommissioned, strikeLabel: true }),
  unlinked: style({ fill: COLOURS.unlinked, fillOpacity: 0.35, stroke: COLOURS.unlinked }),
}

const OVERDUE_STYLE: ShapeStyle = style({ fill: COLOURS.overdue, fillOpacity: 0.45, stroke: COLOURS.overdue })

/** Overdue is its own solid red, not a pattern over the in-progress orange. */
export function tenantShapeStyle(r: ShopStatusResult): ShapeStyle {
  if (r.overdue) return { ...OVERDUE_STYLE, strikeLabel: TENANT_BASE[r.status].strikeLabel }
  return TENANT_BASE[r.status]
}

const AREA_FILL: Record<AreaType, string> = {
  common: COLOURS.common,
  plant_room: COLOURS.plantRoom,
  services: COLOURS.services,
  vacant: COLOURS.vacant,
}

export function areaShapeStyle(t: AreaType): ShapeStyle {
  return style({ fill: AREA_FILL[t], fillOpacity: 0.4, stroke: AREA_FILL[t] })
}

/** Fill opacity for line-diagram blocks: the block tables carry text that must stay readable. */
export const DB_BLOCK_FILL_OPACITY = 0.5

const solid = (colour: string): ShapeStyle => style({ fill: colour, fillOpacity: DB_BLOCK_FILL_OPACITY, stroke: colour })

const DB_BLOCK: Record<DbBlockStatus, ShapeStyle> = {
  received: solid(COLOURS.complete),
  ordered: solid(COLOURS.ordered),
  required: solid(COLOURS.overdue),
  by_tenant: solid(COLOURS.byTenant),
  no_order: solid(COLOURS.noOrder),
  unlinked: style({ stroke: COLOURS.unlinked, dash: [10, 6] }),
}

export function dbBlockStyle(s: DbBlockStatus): ShapeStyle {
  return DB_BLOCK[s]
}

/**
 * Floor plan by main board (spec 2026-10-13 §1). Twelve categorical colours that never
 * reuse a status colour and each read against the white label halo (≥ 3:1). A board's
 * colour follows its place in the boards sorted by name, so the same board keeps the
 * same colour on screen, in PDFs and between sessions. A 13th board wraps.
 */
export const MAIN_BOARD_PALETTE = [
  '#1F5FBF', '#C000B0', '#00838F', '#7744BB', '#998800', '#773355',
  '#0022FF', '#DD6699', '#9977FF', '#EE33FF', '#004D40', '#3E2723',
] as const

export function boardColours(boards: readonly FeedBoard[]): Record<string, string> {
  return Object.fromEntries(
    [...boards].sort(compareBoardNames).map((b, i) => [b.id, MAIN_BOARD_PALETTE[i % MAIN_BOARD_PALETTE.length]!]),
  )
}

/** A shop filled with its feeding board's colour. No hatch: overdue is not drawn in this mode. */
export function boardShapeStyle(colour: string, strikeLabel = false): ShapeStyle {
  return style({ fill: colour, fillOpacity: 0.45, stroke: colour, strikeLabel })
}

export const FEED_UNKNOWN_LABEL = 'Feed not in the cable schedule'
/** A linked shop whose supply path reaches no main board. */
export const FEED_UNKNOWN_STYLE: ShapeStyle = style({ fill: COLOURS.unlinked, fillOpacity: 0.35, stroke: COLOURS.neutral, dash: [10, 6] })

export const TENANT_LEGEND: readonly LegendEntry[] = [
  { key: 'complete', label: SHOP_STATUS_LABEL.complete, style: tenantShapeStyle({ status: 'complete', overdue: false }) },
  { key: 'in_progress', label: SHOP_STATUS_LABEL.in_progress, style: tenantShapeStyle({ status: 'in_progress', overdue: false }) },
  { key: 'overdue', label: 'Overdue (past BO date)', style: tenantShapeStyle({ status: 'in_progress', overdue: true }) },
  { key: 'decommissioned', label: SHOP_STATUS_LABEL.decommissioned, style: tenantShapeStyle({ status: 'decommissioned', overdue: false }) },
  { key: 'unlinked', label: SHOP_STATUS_LABEL.unlinked, style: tenantShapeStyle({ status: 'unlinked', overdue: false }) },
  ...AREA_TYPES.map((t) => ({ key: t, label: AREA_TYPE_LABEL[t], style: areaShapeStyle(t) })),
]

const DB_ORDER: DbBlockStatus[] = ['received', 'ordered', 'required', 'by_tenant', 'no_order', 'unlinked']

export const SCHEMATIC_LEGEND: readonly LegendEntry[] = DB_ORDER.map((s) => ({
  key: s,
  label: DB_BLOCK_STATUS_LABEL[s],
  style: dbBlockStyle(s),
}))

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`)
  return { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 }
}
