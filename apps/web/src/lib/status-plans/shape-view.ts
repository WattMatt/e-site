/**
 * What a status-plan shape looks like, computed from live facts.
 *
 * Nothing here is stored (spec §2): the plan holds geometry + link + type, and
 * colour, hatch, label and area are derived at draw time, so a plan can never
 * lag the tenant schedule. The canvas, the legend and the side panel all read
 * resolveShapeView's output, so they cannot disagree with one another.
 */
import {
  AREA_TYPE_LABEL,
  DB_BLOCK_STATUS_LABEL,
  SCHEMATIC_LEGEND,
  SHOP_STATUS_LABEL,
  TENANT_LEGEND,
  areaCheck,
  areaShapeStyle,
  dbBlockStatus,
  dbBlockStyle,
  hexToRgb01,
  shapeAreaM2,
  shopStatus,
  tenantShapeStyle,
  totalMeasuredM2,
  type AreaCheck,
  type NodeOrderStatus,
  type ShapeStyle,
  type ShopLink,
  type StatusPlanPurpose,
} from '@esite/shared/status-plans'
import type { CanvasShape, PlanNode } from './types'

export interface ShapeView {
  id: string
  style: ShapeStyle
  /** The legend entry this shape counts under (TENANT_LEGEND / SCHEMATIC_LEGEND key). */
  legendKey: string
  overdue: boolean
  statusLabel: string
  /** Drawn at the shape's visual centre. */
  labelLines: string[]
  /** Null without a scale, and always on a schematic. */
  areaM2: number | null
  /** Shop shapes on a tenant layout only. */
  check: AreaCheck | null
  /** A linked shop shape on a tenant layout: the only kind Measured GLA adds up. */
  shopLinked: boolean
  /** The stored outline fails today's checks: drawn dashed red, counted nowhere. */
  invalid: boolean
  /** node_id is set but the board is not live (soft-deleted, or not visible). */
  linkedNodeMissing: boolean
}

export interface ShapeViewContext {
  purpose: StatusPlanPurpose
  nodesById: ReadonlyMap<string, PlanNode>
  shopLinks: Readonly<Record<string, ShopLink>>
  dbOrders: Readonly<Record<string, NodeOrderStatus>>
  today: string
  pixelsPerMeter: number | null
}

const m2 = (v: number): string => `${v.toFixed(1)} m²`

const INVALID_STYLE: ShapeStyle = { fill: null, fillOpacity: 0, stroke: '#dc2626', strokeWidth: 2, dash: [6, 4], hatches: [], strikeLabel: false }

export function resolveShapeView(s: CanvasShape, ctx: ShapeViewContext): ShapeView {
  const node = s.nodeId ? ctx.nodesById.get(s.nodeId) ?? null : null
  const linkedNodeMissing = s.nodeId !== null && node === null

  if (s.invalidReason) {
    return {
      id: s.id,
      style: INVALID_STYLE,
      legendKey: 'invalid',
      overdue: false,
      statusLabel: s.invalidReason,
      labelLines: [node ? node.code : s.detectedTag ?? 'Shape'],
      areaM2: null,
      check: null,
      shopLinked: false,
      invalid: true,
      linkedNodeMissing,
    }
  }

  if (ctx.purpose === 'distribution_schematic') {
    const status = dbBlockStatus(node !== null, node ? ctx.dbOrders[node.id] ?? null : null)
    return {
      id: s.id,
      style: dbBlockStyle(status),
      legendKey: status,
      overdue: false,
      statusLabel: linkedNodeMissing ? 'Board deleted' : DB_BLOCK_STATUS_LABEL[status],
      labelLines: [node ? node.code : s.detectedTag ?? 'Unlinked'],
      areaM2: null,
      check: null,
      shopLinked: false,
      invalid: false,
      linkedNodeMissing,
    }
  }

  const areaM2 = shapeAreaM2(s.points, ctx.pixelsPerMeter)
  const areaLine = areaM2 === null ? [] : [m2(areaM2)]

  if (s.areaType) {
    return {
      id: s.id,
      style: areaShapeStyle(s.areaType),
      legendKey: s.areaType,
      overdue: false,
      statusLabel: AREA_TYPE_LABEL[s.areaType],
      labelLines: [AREA_TYPE_LABEL[s.areaType], ...areaLine],
      areaM2,
      check: null,
      shopLinked: false,
      invalid: false,
      linkedNodeMissing: false,
    }
  }

  const link: ShopLink = node ? ctx.shopLinks[node.id] ?? { state: 'unlinked' } : { state: 'unlinked' }
  const result = shopStatus(link, ctx.today)
  const statusLabel = linkedNodeMissing
    ? 'Board deleted'
    : `${SHOP_STATUS_LABEL[result.status]}${result.overdue ? ' · overdue' : ''}`
  const nameLines = node
    ? [node.shopNumber ?? node.code, node.shopName ?? ''].filter((l) => l !== '')
    : ['Unassigned']

  return {
    id: s.id,
    style: tenantShapeStyle(result),
    legendKey: result.status,
    overdue: result.overdue,
    statusLabel,
    labelLines: [...nameLines, ...areaLine],
    areaM2,
    check: node ? areaCheck(areaM2, node.scheduledM2) : null,
    shopLinked: node !== null,
    invalid: false,
    linkedNodeMissing,
  }
}

export interface LegendSummary {
  /** Every legend key for the purpose, zero included. Overdue counts on top of its base status. */
  counts: Record<string, number>
  /** Measured GLA: linked shop shapes only (an area-type shape keeps its own m² on its label). */
  totalM2: number
  /** Linked shop shapes with no measurable area (no page scale). */
  unmeasured: number
}

export function legendSummary(views: ReadonlyArray<ShapeView>, purpose: StatusPlanPurpose): LegendSummary {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  const counts: Record<string, number> = Object.fromEntries(legend.map((e) => [e.key, 0]))
  for (const v of views) {
    if (v.invalid) continue
    counts[v.legendKey] = (counts[v.legendKey] ?? 0) + 1
    if (v.overdue) counts.overdue = (counts.overdue ?? 0) + 1
  }
  if (purpose !== 'tenant_layout') return { counts, totalM2: 0, unmeasured: 0 }
  const { totalM2, unmeasured } = totalMeasuredM2(views.filter((v) => v.shopLinked).map((v) => v.areaM2))
  return { counts, totalM2, unmeasured }
}

export interface AttentionItem {
  shapeId: string
  label: string
  reason: string
}

/** Shapes a person should look at: a deleted board, or an area that differs from the schedule. */
export function needsAttention(
  shapes: ReadonlyArray<CanvasShape>,
  views: Readonly<Record<string, ShapeView>>,
): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const s of shapes) {
    const v = views[s.id]
    if (!v) continue
    const label = v.labelLines[0] ?? 'Shape'
    if (v.invalid) {
      out.push({ shapeId: s.id, label, reason: s.invalidReason ?? 'Outline needs redrawing' })
    } else if (v.linkedNodeMissing) {
      out.push({ shapeId: s.id, label, reason: 'The board this shape was linked to has been deleted. Link another or leave it unassigned.' })
    } else if (v.check?.state === 'differs' && v.check.measuredM2 !== null && v.check.scheduledM2 !== null) {
      const pct = v.check.deltaPct ?? 0
      out.push({
        shapeId: s.id,
        label,
        reason: `Area differs: ${m2(v.check.measuredM2)} measured, ${m2(v.check.scheduledM2)} scheduled (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)`,
      })
    }
  }
  return out
}

/** The fill as a CSS / Konva colour with the style's opacity applied. */
export function fillRgba(style: ShapeStyle): string {
  if (!style.fill) return 'transparent'
  const { r, g, b } = hexToRgb01(style.fill)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${style.fillOpacity})`
}

/** A legend swatch approximating the canvas style in CSS. */
export function swatchCss(style: ShapeStyle): Record<string, string> {
  const css: Record<string, string> = {
    backgroundColor: fillRgba(style),
    border: `2px ${style.dash ? 'dashed' : 'solid'} ${style.stroke}`,
  }
  if (style.hatches.length > 0) {
    css.backgroundImage = style.hatches
      .map((h) => `repeating-linear-gradient(${90 - h.angleDeg}deg, ${h.color} 0 1.5px, transparent 1.5px 6px)`)
      .join(', ')
  }
  return css
}
