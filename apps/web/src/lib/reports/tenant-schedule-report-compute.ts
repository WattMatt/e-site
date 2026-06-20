/**
 * Pure compute for the Tenant Schedule Report — no I/O. Turns shaped schedule
 * data into the KPI numbers and per-shop rows the PDF renders. Fully unit-tested.
 */

export type OrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

const ORDER_LABEL: Record<OrderStatus, string> = {
  by_tenant: 'By tenant',
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
}

/** Cell label for a DB/Lights order state; null (no order row) → em dash. */
export function orderStateLabel(status: OrderStatus | null): string {
  return status ? ORDER_LABEL[status] : '—'
}

export interface ComputeInput {
  activeNodes: Array<{ id: string; shopNumber: string; shopName: string; glaM2: number | null }>
  decommissionedCount: number
  scopeTypeIdByKey: { db: string | null; lighting: string | null }
  detailsByNode: Map<string, { scopeReceived: boolean; layoutIssued: boolean }>
  /** key `${nodeId}:${scopeTypeId}` → order status */
  orderStatusByNodeScope: Map<string, OrderStatus>
  boByNode: Map<string, { effectiveDate: string | null }>
  today: string
}

export interface ShopRow {
  shopNumber: string
  tenantName: string
  glaM2: number | null
  db: OrderStatus | null
  lights: OrderStatus | null
  layoutIssued: boolean
  boDate: string | null
  boOverdue: boolean
}

export interface ReportKpis {
  totalShops: number
  activeShops: number
  decommissionedShops: number
  totalGlaM2: number
  scopeReceivedPct: number
  layoutsIssuedPct: number
  boards: { landlord: number; ordered: number }
  lights: { landlord: number; ordered: number }
  byTenantCount: number
  bo: { upcoming: number; overdue: number; noDate: number }
}

const LANDLORD = new Set<OrderStatus>(['required', 'ordered', 'received'])
const ORDERED = new Set<OrderStatus>(['ordered', 'received'])

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

export function computeReportModel(input: ComputeInput): { kpis: ReportKpis; shopRows: ShopRow[] } {
  const { activeNodes, decommissionedCount, scopeTypeIdByKey, detailsByNode, orderStatusByNodeScope, boByNode, today } = input

  const stateFor = (nodeId: string, scopeTypeId: string | null): OrderStatus | null =>
    scopeTypeId ? orderStatusByNodeScope.get(`${nodeId}:${scopeTypeId}`) ?? null : null

  const shopRows: ShopRow[] = activeNodes
    .map((n) => {
      const det = detailsByNode.get(n.id)
      const boDate = boByNode.get(n.id)?.effectiveDate ?? null
      return {
        shopNumber: n.shopNumber,
        tenantName: n.shopName,
        glaM2: n.glaM2,
        db: stateFor(n.id, scopeTypeIdByKey.db),
        lights: stateFor(n.id, scopeTypeIdByKey.lighting),
        layoutIssued: det?.layoutIssued ?? false,
        boDate,
        boOverdue: boDate ? boDate < today : false,
      }
    })
    .sort((a, b) => a.shopNumber.localeCompare(b.shopNumber, undefined, { numeric: true, sensitivity: 'base' }))

  const activeShops = activeNodes.length
  const totalGlaM2 = activeNodes.reduce((sum, n) => sum + (n.glaM2 ?? 0), 0)
  const scopeReceived = activeNodes.filter((n) => detailsByNode.get(n.id)?.scopeReceived).length
  const layoutsIssued = activeNodes.filter((n) => detailsByNode.get(n.id)?.layoutIssued).length

  const tally = (states: Array<OrderStatus | null>) => ({
    landlord: states.filter((s): s is OrderStatus => s !== null && LANDLORD.has(s)).length,
    ordered: states.filter((s): s is OrderStatus => s !== null && ORDERED.has(s)).length,
  })
  const boards = tally(shopRows.map((r) => r.db))
  const lights = tally(shopRows.map((r) => r.lights))
  const byTenantCount =
    shopRows.filter((r) => r.db === 'by_tenant').length + shopRows.filter((r) => r.lights === 'by_tenant').length

  const bo = { upcoming: 0, overdue: 0, noDate: 0 }
  for (const r of shopRows) {
    if (!r.boDate) bo.noDate += 1
    else if (r.boOverdue) bo.overdue += 1
    else bo.upcoming += 1
  }

  return {
    kpis: {
      totalShops: activeShops + decommissionedCount,
      activeShops,
      decommissionedShops: decommissionedCount,
      totalGlaM2,
      scopeReceivedPct: pct(scopeReceived, activeShops),
      layoutsIssuedPct: pct(layoutsIssued, activeShops),
      boards,
      lights,
      byTenantCount,
      bo,
    },
    shopRows,
  }
}
