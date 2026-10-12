/**
 * The ONE colour and hatch table for status plans (spec 2026-10-09 §6). The
 * Konva canvas, the legend and the pdf-lib renderer all read it, so screen and
 * PDF cannot disagree. Widths and spacings are image pixels at the scale-2
 * raster. Colours are #RRGGBB; hexToRgb01 converts them for pdf-lib.
 */
import { AREA_TYPE_LABEL, AREA_TYPES, type AreaType } from './types'
import { SHOP_STATUS_LABEL, type ShopStatus, type ShopStatusResult } from './shop-status'
import { DB_BLOCK_STATUS_LABEL, type DbBlockStatus } from './db-block-status'

export const COLOURS = {
  complete: '#2E9E4F',
  inProgress: '#F08A24',
  overdue: '#D64545',
  ordered: '#E0A100',
  byTenant: '#7D8590',
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

const hatch = (angleDeg: number, color: string): HatchSpec => ({ angleDeg, spacing: HATCH_SPACING_PX, color, width: 2 })

const TENANT_BASE: Record<ShopStatus, ShapeStyle> = {
  complete: style({ fill: COLOURS.complete, fillOpacity: 0.45, stroke: COLOURS.complete }),
  in_progress: style({ fill: COLOURS.inProgress, fillOpacity: 0.45, stroke: COLOURS.inProgress }),
  decommissioned: style({ fill: COLOURS.decommissioned, fillOpacity: 0.45, stroke: COLOURS.decommissioned, strikeLabel: true }),
  unlinked: style({ fill: COLOURS.unlinked, fillOpacity: 0.35, stroke: COLOURS.unlinked }),
}

export function tenantShapeStyle(r: ShopStatusResult): ShapeStyle {
  const base = TENANT_BASE[r.status]
  if (!r.overdue) return base
  return { ...base, stroke: COLOURS.overdue, hatches: [hatch(45, COLOURS.overdue)] }
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

const DB_BLOCK: Record<DbBlockStatus, ShapeStyle> = {
  required: style({ stroke: COLOURS.overdue, strokeWidth: 4 }),
  ordered: style({ stroke: COLOURS.ordered, hatches: [hatch(45, COLOURS.ordered)] }),
  received: style({ fill: COLOURS.complete, fillOpacity: 0.35, stroke: COLOURS.complete }),
  by_tenant: style({ stroke: COLOURS.byTenant, hatches: [hatch(45, COLOURS.byTenant), hatch(135, COLOURS.byTenant)] }),
  no_order: style({ stroke: COLOURS.neutral, strokeWidth: 1.5 }),
  unlinked: style({ stroke: COLOURS.unlinked, strokeWidth: 2, dash: [10, 6] }),
}

export function dbBlockStyle(s: DbBlockStatus): ShapeStyle {
  return DB_BLOCK[s]
}

export const TENANT_LEGEND: readonly LegendEntry[] = [
  { key: 'complete', label: SHOP_STATUS_LABEL.complete, style: tenantShapeStyle({ status: 'complete', overdue: false }) },
  { key: 'in_progress', label: SHOP_STATUS_LABEL.in_progress, style: tenantShapeStyle({ status: 'in_progress', overdue: false }) },
  { key: 'overdue', label: 'Overdue (past BO date)', style: tenantShapeStyle({ status: 'in_progress', overdue: true }) },
  { key: 'decommissioned', label: SHOP_STATUS_LABEL.decommissioned, style: tenantShapeStyle({ status: 'decommissioned', overdue: false }) },
  { key: 'unlinked', label: SHOP_STATUS_LABEL.unlinked, style: tenantShapeStyle({ status: 'unlinked', overdue: false }) },
  ...AREA_TYPES.map((t) => ({ key: t, label: AREA_TYPE_LABEL[t], style: areaShapeStyle(t) })),
]

const DB_ORDER: DbBlockStatus[] = ['required', 'ordered', 'received', 'by_tenant', 'no_order', 'unlinked']

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
