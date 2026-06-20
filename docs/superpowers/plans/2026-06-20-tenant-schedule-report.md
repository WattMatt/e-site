# Tenant Schedule Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded "Generate report" capability to the Tenant Schedule — a PDF with a cover, a KPI page, and a paginated shop-summary table — shown in an in-app preview with Save (persist to `projects.reports`) and Download.

**Architecture:** Pure compute module (KPIs + shop rows, fully unit-tested) ← I/O gatherer (reuses the tenant-schedule queries + logo→data-URI) → `@react-pdf/renderer` document (reusing `Cover`/`Section`/`Table` scaffolding) → preview API (stream) + save API (`projects.reports`, mirroring `file-inspection-report.ts`) → a small client button+modal on the page header. **No new migration** — `projects.reports` and the `reports` bucket already exist (migration 00117).

**Tech Stack:** Next.js App Router, TypeScript, `@react-pdf/renderer`, Supabase (service client for privileged reads/writes), Vitest.

**Working tree:** worktree `~/dev/e-site-tsreport`, branch `feat/tenant-schedule-report` (based on `origin/main`). Run commands from `~/dev/e-site-tsreport/apps/web`. Dependencies must be installed first: `cd ~/dev/e-site-tsreport && pnpm install --prefer-offline`.

**Reference files (read before implementing — these are the patterns to mirror):**
- `apps/web/src/lib/reports/generator-report-data.ts` — gatherer + `downloadToDataUri` + `brandingInput` shape
- `apps/web/src/lib/reports/generator-report.tsx` — Document composition (Cover page + content page + Section/Table/KeyValue)
- `apps/web/src/lib/reports/components.tsx` (`Cover`, `pageStyles`), `interior.tsx` (`RunningHeader`, `RunningFooter`, `Section`, `Table`), `branding.ts` (`BrandingInput`/`resolveBranding`)
- `apps/web/src/lib/reports/render-generator.ts` — render entry
- `apps/web/src/lib/reports/generator-report-branding.ts` — `buildGcrBrandingInput`
- `apps/web/src/lib/reports/file-inspection-report.ts` — the `projects.reports` version→upload→insert→supersede pattern
- `apps/web/src/app/api/projects/[id]/generator-cost-recovery/report-preview/route.ts` — preview route
- `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ReportsPanel.tsx` — client generate/preview/download
- `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx` — the queries to reuse

---

### Task 1: Pure compute module + types (TDD)

The novel logic — KPI numbers, per-shop rows, status mapping — lives here as pure functions with no I/O, so it is fully unit-testable.

**Files:**
- Create: `apps/web/src/lib/reports/tenant-schedule-report-compute.ts`
- Test: `apps/web/src/lib/reports/tenant-schedule-report-compute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tenant-schedule-report-compute.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeReportModel, orderStateLabel, type ComputeInput } from './tenant-schedule-report-compute'

const base: ComputeInput = {
  activeNodes: [
    { id: 'n1', shopNumber: 'L01', shopName: 'Woolworths', glaM2: 1240 },
    { id: 'n2', shopNumber: 'L02', shopName: 'Mr Price', glaM2: 480 },
    { id: 'n3', shopNumber: 'L03', shopName: 'Clicks', glaM2: 320 },
  ],
  decommissionedCount: 1,
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([
    ['n1', { scopeReceived: true, layoutIssued: true }],
    ['n2', { scopeReceived: false, layoutIssued: true }],
    ['n3', { scopeReceived: true, layoutIssued: false }],
  ]),
  orderStatusByNodeScope: new Map([
    ['n1:tdb', 'ordered'], ['n1:tlt', 'received'],
    ['n2:tdb', 'by_tenant'], ['n2:tlt', 'by_tenant'],
    ['n3:tdb', 'required'], // n3 has no lights order row
  ]),
  boByNode: new Map([
    ['n1', { effectiveDate: '2026-08-15' }],
    ['n2', { effectiveDate: '2026-05-01' }], // overdue (before today)
    ['n3', { effectiveDate: null }],          // no date
  ]),
  today: '2026-06-20',
}

describe('orderStateLabel', () => {
  it('maps statuses to display labels and null to dash', () => {
    expect(orderStateLabel('by_tenant')).toBe('By tenant')
    expect(orderStateLabel('required')).toBe('Required')
    expect(orderStateLabel('ordered')).toBe('Ordered')
    expect(orderStateLabel('received')).toBe('Received')
    expect(orderStateLabel(null)).toBe('—')
  })
})

describe('computeReportModel', () => {
  const { kpis, shopRows } = computeReportModel(base)

  it('builds one row per active shop, sorted by shop number, with DB/Lights states', () => {
    expect(shopRows.map((r) => r.shopNumber)).toEqual(['L01', 'L02', 'L03'])
    expect(shopRows[0]).toMatchObject({ tenantName: 'Woolworths', db: 'ordered', lights: 'received', layoutIssued: true, boOverdue: false })
    expect(shopRows[2]).toMatchObject({ db: 'required', lights: null, layoutIssued: false })
  })

  it('counts shops & GLA (active + decommissioned)', () => {
    expect(kpis.activeShops).toBe(3)
    expect(kpis.decommissionedShops).toBe(1)
    expect(kpis.totalShops).toBe(4)
    expect(kpis.totalGlaM2).toBe(2040)
  })

  it('computes scope & layout completion percentages over active shops', () => {
    expect(kpis.scopeReceivedPct).toBe(67) // 2 of 3
    expect(kpis.layoutsIssuedPct).toBe(67) // 2 of 3
  })

  it('computes landlord-to-order vs ordered for boards & lights', () => {
    // boards: n1 ordered, n2 by_tenant, n3 required → landlord 2 (n1,n3), ordered 1 (n1)
    expect(kpis.boards).toEqual({ landlord: 2, ordered: 1 })
    // lights: n1 received, n2 by_tenant, n3 none → landlord 1 (n1), ordered 1 (n1)
    expect(kpis.lights).toEqual({ landlord: 1, ordered: 1 })
    // by_tenant across boards+lights: n2 db + n2 lights = 2
    expect(kpis.byTenantCount).toBe(2)
  })

  it('buckets BO dates into upcoming / overdue / no-date', () => {
    expect(kpis.bo).toEqual({ upcoming: 1, overdue: 1, noDate: 1 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/dev/e-site-tsreport/apps/web && npx vitest run src/lib/reports/tenant-schedule-report-compute.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write the compute module**

Create `tenant-schedule-report-compute.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/dev/e-site-tsreport/apps/web && npx vitest run src/lib/reports/tenant-schedule-report-compute.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-tsreport
git add apps/web/src/lib/reports/tenant-schedule-report-compute.ts apps/web/src/lib/reports/tenant-schedule-report-compute.test.ts
git commit -m "feat(tenant-schedule): pure compute for report KPIs + shop rows"
```

---

### Task 2: Data gatherer (I/O) + branding input

Reads the schedule data (reusing the page's queries), downloads logos, and calls the pure compute.

**Files:**
- Create: `apps/web/src/lib/reports/tenant-schedule-report-data.ts`

- [ ] **Step 1: Write the gatherer**

Create `tenant-schedule-report-data.ts`. (Mirrors `generator-report-data.ts`: cookie client for the gate, service client for privileged reads + logo downloads.)

```ts
/**
 * gatherTenantScheduleReportData — I/O seam for the tenant schedule report.
 * Cookie client gates project access; service client does the privileged reads
 * and logo downloads. Pure number-crunching is delegated to the compute module.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService, listNodes, computeBoDate } from '@esite/shared'
import {
  computeReportModel,
  type ComputeInput,
  type OrderStatus,
  type ReportKpis,
  type ShopRow,
} from './tenant-schedule-report-compute'

const LOGO_BUCKET = 'report-logos'
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

export interface TenantScheduleReportData {
  projectName: string
  kpis: ReportKpis
  shopRows: ShopRow[]
  brandingInput: {
    orgName: string
    orgLogoDataUri: string | null
    orgAccent: string | null
    projectAccent: string | null
    clientLogoDataUri: string | null
    projectMarkDataUri: string | null
    projectSubtitle: string
  }
}

/** Download from a bucket → `data:<mime>;base64,…` URI, or null. */
async function downloadToDataUri(service: AnyService, bucket: string, storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function gatherTenantScheduleReportData(projectId: string): Promise<TenantScheduleReportData> {
  // 1. Gate via the RLS-aware cookie client (throws if no access / not found).
  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) throw new Error('Project not found')
  const orgId = project.organisation_id as string
  const openingDate: string | null = (project as { opening_date?: string | null }).opening_date ?? null

  // 2. Service client for privileged reads (RLS bypassed — caller is gated above).
  const service = createServiceClient()

  // 3. Tenant nodes (active + decommissioned carry a `status`).
  const allNodes = await listNodes(service as never, projectId, { kind: 'tenant_db' })
  const activeNodesRaw = allNodes.filter((n) => (n as { status?: string }).status !== 'decommissioned')
  const decommissionedCount = allNodes.length - activeNodesRaw.length
  const nodeIds = activeNodesRaw.map((n) => n.id)

  // 4. Parallel reads: scope types, tenant_details (scope/layout + BO), node_orders, project/org logo rows.
  const [typesRes, detailsRes, ordersRes, projRes] = await Promise.all([
    (service as any).schema('structure').from('scope_item_types')
      .select('id, key').eq('organisation_id', orgId),
    nodeIds.length
      ? (service as any).schema('structure').from('tenant_details')
          .select('node_id, scope_status, layout_status, bo_period_days, bo_date_override').in('node_id', nodeIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? (service as any).schema('structure').from('node_orders')
          .select('node_id, scope_item_type_id, status').in('node_id', nodeIds).not('scope_item_type_id', 'is', null)
      : Promise.resolve({ data: [] }),
    (service as any).schema('projects').from('projects')
      .select('name, client_logo_url, project_logo_url, report_accent_color').eq('id', projectId).maybeSingle(),
  ])

  const types = (typesRes.data ?? []) as Array<{ id: string; key: string }>
  const scopeTypeIdByKey = {
    db: types.find((t) => t.key === 'db')?.id ?? null,
    lighting: types.find((t) => t.key === 'lighting')?.id ?? null,
  }

  const detailsByNode: ComputeInput['detailsByNode'] = new Map()
  const boByNode: ComputeInput['boByNode'] = new Map()
  for (const d of (detailsRes.data ?? []) as Array<{
    node_id: string; scope_status: string | null; layout_status: string | null
    bo_period_days: number | null; bo_date_override: string | null
  }>) {
    detailsByNode.set(d.node_id, {
      scopeReceived: d.scope_status === 'received',
      layoutIssued: d.layout_status === 'issued',
    })
    boByNode.set(d.node_id, {
      effectiveDate: computeBoDate(openingDate, d.bo_period_days ?? null, d.bo_date_override ?? null),
    })
  }

  const orderStatusByNodeScope: ComputeInput['orderStatusByNodeScope'] = new Map()
  for (const o of (ordersRes.data ?? []) as Array<{ node_id: string; scope_item_type_id: string; status: OrderStatus }>) {
    orderStatusByNodeScope.set(`${o.node_id}:${o.scope_item_type_id}`, o.status)
  }

  const proj = projRes.data as {
    name: string | null; client_logo_url: string | null; project_logo_url: string | null; report_accent_color: string | null
  } | null

  // 5. Org row + logos.
  const { data: orgData } = await (service as any).from('organisations')
    .select('name, logo_url, report_accent_color').eq('id', orgId).maybeSingle()
  const org = orgData as { name: string | null; logo_url: string | null; report_accent_color: string | null } | null

  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    proj?.client_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.client_logo_url) : Promise.resolve(null),
    proj?.project_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.project_logo_url) : Promise.resolve(null),
  ])

  // 6. Compute + assemble.
  const { kpis, shopRows } = computeReportModel({
    activeNodes: activeNodesRaw.map((n) => ({
      id: n.id,
      shopNumber: (n as { shop_number?: string | null }).shop_number ?? (n as { code?: string }).code ?? '—',
      shopName: (n as { shop_name?: string | null }).shop_name ?? '—',
      glaM2: (n as { shop_area_m2?: number | null }).shop_area_m2 ?? null,
    })),
    decommissionedCount,
    scopeTypeIdByKey,
    detailsByNode,
    orderStatusByNodeScope,
    boByNode,
    today: new Date().toISOString().slice(0, 10),
  })

  const projectName = (proj?.name as string | null) ?? (project.name as string) ?? '—'
  return {
    projectName,
    kpis,
    shopRows,
    brandingInput: {
      orgName: (org?.name as string | null) ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: (org?.report_accent_color as string | null) ?? null,
      projectAccent: (proj?.report_accent_color as string | null) ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: 'Tenant coordination',
    },
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/dev/e-site-tsreport/apps/web && pnpm type-check`
Expected: PASS. If `listNodes`'s row type doesn't expose `shop_number`/`shop_name`/`shop_area_m2`/`status` directly, the `as`-casts above absorb it; confirm no errors. (If `listNodes` is found to NOT include decommissioned nodes, the active/total split still holds — `decommissionedCount` simply becomes 0; note it in the commit.)

- [ ] **Step 3: Commit**

```bash
cd ~/dev/e-site-tsreport
git add apps/web/src/lib/reports/tenant-schedule-report-data.ts
git commit -m "feat(tenant-schedule): report data gatherer (queries + logos + compute)"
```

---

### Task 3: Branding input + render entry + the PDF document

**Files:**
- Create: `apps/web/src/lib/reports/tenant-schedule-report-branding.ts`
- Create: `apps/web/src/lib/reports/tenant-schedule-report.tsx`
- Create: `apps/web/src/lib/reports/render-tenant-schedule.ts`
- Test: `apps/web/src/lib/reports/render-tenant-schedule.render.test.ts`

- [ ] **Step 1: Branding builder** — create `tenant-schedule-report-branding.ts` (mirrors `buildGcrBrandingInput`):

```ts
import type { BrandingInput } from './branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'

export function buildTenantScheduleBrandingInput(data: TenantScheduleReportData, date: string): BrandingInput {
  const b = data.brandingInput
  return {
    org: { name: b.orgName, logoSrc: b.orgLogoDataUri ?? undefined, accent: b.orgAccent },
    project: {
      name: data.projectName,
      clientLogoSrc: b.clientLogoDataUri ?? undefined,
      projectMarkSrc: b.projectMarkDataUri ?? undefined,
      accent: b.projectAccent,
      subtitle: b.projectSubtitle || undefined,
    },
    contractor: null,
    title: 'Tenant Schedule Report',
    kicker: 'TENANT SCHEDULE',
    date,
  }
}
```

- [ ] **Step 2: The document** — create `tenant-schedule-report.tsx`. Composes the cover, a KPI page (local `StatCard`/`StatGroup`), and the shop summary `Section` + `Table`.

```tsx
// No 'use client' — rendered server-side to PDF only.
import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from './branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import { orderStateLabel, type ShopRow } from './tenant-schedule-report-compute'
import { Cover, pageStyles as s } from './components'
import { RunningHeader, RunningFooter, Section, Table } from './interior'

const ss = StyleSheet.create({
  groupHeading: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: 118, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#F5F5F4', borderRadius: 4 },
  cardLabel: { fontSize: 8, color: '#6B7280', marginBottom: 3 },
  cardValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111827' },
  cardSub: { fontSize: 7, color: '#9CA3AF', marginTop: 2 },
})

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={ss.card}>
      <Text style={ss.cardLabel}>{label}</Text>
      <Text style={ss.cardValue}>{value}</Text>
      {sub ? <Text style={ss.cardSub}>{sub}</Text> : null}
    </View>
  )
}

function StatGroup({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={[ss.groupHeading, { color: accent }]}>{title}</Text>
      <View style={ss.cardRow}>{children}</View>
    </View>
  )
}

const shopCell = (r: ShopRow): string[] => [
  r.shopNumber,
  r.tenantName,
  r.glaM2 != null ? r.glaM2.toLocaleString('en-ZA') : '—',
  orderStateLabel(r.db),
  orderStateLabel(r.lights),
  r.layoutIssued ? 'Issued' : 'Not issued',
  r.boDate ? (r.boOverdue ? `${r.boDate} (overdue)` : r.boDate) : '—',
]

export interface TenantScheduleReportDocumentProps {
  data: TenantScheduleReportData
  branding: ResolvedBranding
}

export function TenantScheduleReportDocument({ data, branding }: TenantScheduleReportDocumentProps) {
  const { accent, issuer, title } = branding
  const { kpis, shopRows } = data

  return (
    <Document title="Tenant Schedule Report" producer="e-site.live">
      {/* Page 1 — cover (provides its own fixed footer) */}
      <Page size="A4" style={s.page}>
        <Cover resolved={branding} />
      </Page>

      {/* Page 2 — KPI snapshot */}
      <Page size="A4" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Project KPIs" accent={accent}>
          <StatGroup title="Shops & GLA" accent={accent}>
            <StatCard label="Total shops" value={String(kpis.totalShops)} />
            <StatCard label="Active" value={String(kpis.activeShops)} />
            <StatCard label="Decommissioned" value={String(kpis.decommissionedShops)} />
            <StatCard label="Total GLA" value={`${kpis.totalGlaM2.toLocaleString('en-ZA')} m²`} />
          </StatGroup>

          <StatGroup title="Scope & layout completion" accent={accent}>
            <StatCard label="Scope received" value={`${kpis.scopeReceivedPct}%`} />
            <StatCard label="Layouts issued" value={`${kpis.layoutsIssuedPct}%`} />
          </StatGroup>

          <StatGroup title="Landlord procurement — boards & lights" accent={accent}>
            <StatCard label="Boards ordered" value={`${kpis.boards.ordered} / ${kpis.boards.landlord}`} sub="ordered / landlord to order" />
            <StatCard label="Lights ordered" value={`${kpis.lights.ordered} / ${kpis.lights.landlord}`} sub="ordered / landlord to order" />
            <StatCard label="By tenant" value={String(kpis.byTenantCount)} sub="boards + lights tenant-supplied" />
          </StatGroup>

          <StatGroup title="BO readiness" accent={accent}>
            <StatCard label="Upcoming" value={String(kpis.bo.upcoming)} />
            <StatCard label="Overdue" value={String(kpis.bo.overdue)} />
            <StatCard label="No date set" value={String(kpis.bo.noDate)} />
          </StatGroup>
        </Section>
      </Page>

      {/* Page 3+ — shop summary table */}
      <Page size="A4" style={s.page}>
        <RunningHeader issuerLogoDataUri={issuer.logoSrc ?? null} title={title} accent={accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={title} accent={accent} />

        <Section title="Shop summary" accent={accent}>
          <Table
            columns={['Shop', 'Tenant', 'GLA m²', 'DB', 'Lights', 'Layout', 'BO date']}
            rows={shopRows.length > 0 ? shopRows.map(shopCell) : [['—', 'No active shops', '—', '—', '—', '—', '—']]}
            repeatHeader
            unbreakableRows
            align={['left', 'left', 'right', 'left', 'left', 'left', 'left']}
          />
        </Section>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 3: Render entry** — create `render-tenant-schedule.ts`:

```ts
// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { TenantScheduleReportDocument } from './tenant-schedule-report'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import type { ResolvedBranding } from './branding'

export async function renderTenantScheduleReport(
  data: TenantScheduleReportData,
  branding: ResolvedBranding,
): Promise<Buffer> {
  const element = React.createElement(
    TenantScheduleReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
```

- [ ] **Step 4: Write the render test** — create `render-tenant-schedule.render.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderTenantScheduleReport } from './render-tenant-schedule'
import { resolveBranding } from './branding'
import { buildTenantScheduleBrandingInput } from './tenant-schedule-report-branding'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'

const baseData: TenantScheduleReportData = {
  projectName: 'Princess Mkabayi, Vryheid',
  kpis: {
    totalShops: 4, activeShops: 3, decommissionedShops: 1, totalGlaM2: 2040,
    scopeReceivedPct: 67, layoutsIssuedPct: 67,
    boards: { landlord: 2, ordered: 1 }, lights: { landlord: 1, ordered: 1 },
    byTenantCount: 2, bo: { upcoming: 1, overdue: 1, noDate: 1 },
  },
  shopRows: [
    { shopNumber: 'L01', tenantName: 'Woolworths', glaM2: 1240, db: 'ordered', lights: 'received', layoutIssued: true, boDate: '2026-08-15', boOverdue: false },
    { shopNumber: 'L02', tenantName: 'Mr Price', glaM2: 480, db: 'by_tenant', lights: 'by_tenant', layoutIssued: true, boDate: '2026-05-01', boOverdue: true },
  ],
  brandingInput: {
    orgName: 'Watson Mattheus', orgLogoDataUri: null, orgAccent: null, projectAccent: null,
    clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: 'Tenant coordination',
  },
}

function render(data: TenantScheduleReportData) {
  return renderTenantScheduleReport(data, resolveBranding(buildTenantScheduleBrandingInput(data, '2026-06-20')))
}

describe('renderTenantScheduleReport', () => {
  it('returns a Buffer starting with the PDF magic bytes', async () => {
    const buf = await render(baseData)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('renders with no shops and with missing GLA / BO dates', async () => {
    const empty = { ...baseData, kpis: { ...baseData.kpis, activeShops: 0, totalShops: 1 }, shopRows: [] }
    expect((await render(empty)).slice(0, 5).toString('ascii')).toBe('%PDF-')
    const sparse = {
      ...baseData,
      shopRows: [{ shopNumber: 'X1', tenantName: 'Vacant', glaM2: null, db: null, lights: null, layoutIssued: false, boDate: null, boOverdue: false }],
    }
    expect((await render(sparse)).slice(0, 5).toString('ascii')).toBe('%PDF-')
  })
})
```

- [ ] **Step 5: Run the render test**

Run: `cd ~/dev/e-site-tsreport/apps/web && npx vitest run src/lib/reports/render-tenant-schedule.render.test.ts`
Expected: PASS — all three render to `%PDF-`. If `react-pdf` complains about the `Table` row shape, confirm every `rows` entry is a `string[]` of length 7 (the column count).

- [ ] **Step 6: Type-check + commit**

```bash
cd ~/dev/e-site-tsreport/apps/web && pnpm type-check
cd ~/dev/e-site-tsreport
git add apps/web/src/lib/reports/tenant-schedule-report-branding.ts apps/web/src/lib/reports/tenant-schedule-report.tsx apps/web/src/lib/reports/render-tenant-schedule.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts
git commit -m "feat(tenant-schedule): branded report document + render entry + render test"
```

---

### Task 4: Preview API route (stream inline PDF)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.ts`

- [ ] **Step 1: Write the route** (mirrors the GCR preview route, minus the seat gate — tenant schedule needs only project access, which `gatherTenantScheduleReportData` enforces):

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let data: Awaited<ReturnType<typeof gatherTenantScheduleReportData>>
  try {
    data = await gatherTenantScheduleReportData(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    console.error('[tenant-schedule-report-preview] gather error', err)
    return NextResponse.json({ error: 'Failed to load tenant schedule data' }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildTenantScheduleBrandingInput(data, today))

  let pdf: Buffer
  try {
    pdf = await renderTenantScheduleReport(data, branding)
  } catch (err) {
    console.error('[tenant-schedule-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="tenant-schedule.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd ~/dev/e-site-tsreport/apps/web && pnpm type-check
cd ~/dev/e-site-tsreport
git add "apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.ts"
git commit -m "feat(tenant-schedule): report preview API (stream inline PDF)"
```

---

### Task 5: Save API route (persist to projects.reports)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.ts`

- [ ] **Step 1: Write the route** (mirrors the version→upload→insert→supersede pattern in `file-inspection-report.ts`, keyed by `project_id` + `kind='tenant_schedule'`):

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { gatherTenantScheduleReportData } from '@/lib/reports/tenant-schedule-report-data'
import { resolveBranding } from '@/lib/reports/branding'
import { buildTenantScheduleBrandingInput } from '@/lib/reports/tenant-schedule-report-branding'
import { renderTenantScheduleReport } from '@/lib/reports/render-tenant-schedule'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REPORTS_BUCKET = 'reports'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Gather (enforces project access) + render.
  let data: Awaited<ReturnType<typeof gatherTenantScheduleReportData>>
  try {
    data = await gatherTenantScheduleReportData(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    return NextResponse.json({ error: 'Failed to load tenant schedule data' }, { status: 500 })
  }
  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildTenantScheduleBrandingInput(data, today))
  let pdf: Buffer
  try {
    pdf = await renderTenantScheduleReport(data, branding)
  } catch {
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Org id (for storage path + the row).
  const { data: projRow } = await service.schema('projects').from('projects')
    .select('organisation_id').eq('id', id).maybeSingle()
  const orgId = (projRow as { organisation_id: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Next version among issued tenant_schedule reports for this project.
  const { data: priorRow } = await service.schema('projects').from('reports')
    .select('id, version').eq('project_id', id).eq('kind', 'tenant_schedule').eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // Upload, then insert the row.
  const storagePath = `${orgId}/${id}/tenant-schedule-v${newVersion}.pdf`
  const { error: upErr } = await service.storage.from(REPORTS_BUCKET)
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

  const brandingSnapshot = {
    accent: branding.accent,
    issuer: (branding.issuer as { wordmark?: string }).wordmark ? { wordmark: (branding.issuer as { wordmark?: string }).wordmark } : { hasLogo: true },
    kicker: branding.kicker,
    projectLine: branding.projectLine,
  }

  const { data: newReport, error: insErr } = await service.schema('projects').from('reports')
    .insert({
      organisation_id: orgId,
      project_id: id,
      kind: 'tenant_schedule',
      title: 'Tenant Schedule Report',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdf.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: user.id,
    })
    .select('id, version').single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return NextResponse.json({ error: `Failed to save report: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }, { status: 500 })
  }
  const reportId = (newReport as { id: string }).id

  // Supersede prior issued rows for this project's tenant schedule.
  await service.schema('projects').from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('project_id', id).eq('kind', 'tenant_schedule').eq('status', 'issued').neq('id', reportId)

  return NextResponse.json({ reportId, version: newVersion }, { status: 201 })
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd ~/dev/e-site-tsreport/apps/web && pnpm type-check
cd ~/dev/e-site-tsreport
git add "apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.ts"
git commit -m "feat(tenant-schedule): save report API (projects.reports, versioned)"
```

---

### Task 6: Client button + modal, wired into the page header

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx` (header)

- [ ] **Step 1: Create the client component** (self-contained: a button that opens a contained modal with the preview iframe + Save + Download; mirrors the GCR draft-preview/download approach):

```tsx
'use client'

/**
 * TenantScheduleReportButton — generate the tenant schedule report, preview it
 * inline (iframe of the streaming preview route), then Save (persist to
 * projects.reports) or Download (the streamed PDF). Self-contained modal.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'

export function TenantScheduleReportButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const previewUrl = `/api/projects/${projectId}/tenant-schedule/report-preview`

  function download() {
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = 'tenant-schedule-report.pdf'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/tenant-schedule/reports`, { method: 'POST' })
      if (res.status === 201) { setSaved(true); return }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Save failed (HTTP ${res.status})`)
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => { setOpen(true); setSaved(false); setError(null) }}>
        Generate report
      </Button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>Tenant Schedule Report</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
                {saved && <span style={{ fontSize: 12, color: 'var(--c-green)' }}>Saved to project ✓</span>}
                <Button variant="ghost" size="sm" onClick={download} style={{ fontSize: 12 }}>Download</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || saved} isLoading={saving} style={{ fontSize: 12 }}>
                  {saved ? 'Saved' : 'Save to project'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>Close</Button>
              </div>
            </div>
            <iframe title="Tenant Schedule Report preview" src={previewUrl} style={{ flex: 1, border: 'none', background: '#fff' }} />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
```

- [ ] **Step 2: Wire it into the page header**

In `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`:

(a) Add the import near the other `_components` imports:
```tsx
import { TenantScheduleReportButton } from './_components/TenantScheduleReportButton'
```

(b) In the `page-header` block, the header currently ends with `<ImportFlow projectId={projectId} />`. Wrap the two controls so both sit on the right:
```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TenantScheduleReportButton projectId={projectId} />
          <ImportFlow projectId={projectId} />
        </div>
```
(Replace the bare `<ImportFlow projectId={projectId} />` line with the wrapped version above. Leave everything else unchanged.)

- [ ] **Step 3: Type-check + lint**

Run: `cd ~/dev/e-site-tsreport/apps/web && pnpm type-check && pnpm lint`
Expected: PASS (no new errors in the two touched files). If `react-dom`'s `createPortal` import is flagged, confirm `react-dom` is already a dependency (it is — the existing `DocumentPreviewModal` uses it).

- [ ] **Step 4: Commit**

```bash
cd ~/dev/e-site-tsreport
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx" \
        "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx"
git commit -m "feat(tenant-schedule): Generate report button + preview/save/download modal"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Full static checks + tests**

Run:
```bash
cd ~/dev/e-site-tsreport/apps/web
pnpm type-check && pnpm lint && pnpm test
```
Expected: type-check clean; lint clean (no new errors in touched files); vitest all pass, including `tenant-schedule-report-compute.test.ts` and `render-tenant-schedule.render.test.ts`.

- [ ] **Step 2: Manual smoke (after deploy, or locally with the dev server)**

On a project's Tenant Schedule, click **Generate report** → the modal shows the branded PDF (cover → KPI page → shop summary). Verify: KPI numbers match the on-screen schedule; DB/Lights columns show Ordered/By tenant/Required/Received correctly; overdue BO dates are flagged. Click **Download** → the PDF downloads. Click **Save to project** → returns 201 (a `projects.reports` row with `kind='tenant_schedule'` is created; re-saving increments `version` and supersedes the prior).

- [ ] **Step 3: Finish the branch**

Invoke the **superpowers:finishing-a-development-branch** skill to integrate `feat/tenant-schedule-report`.

---

## Self-Review (completed while writing this plan)

**Spec coverage:**
- Cover page → Task 3 (`Cover` reused). KPI page with all four groups incl. landlord boards/lights → Task 1 (compute) + Task 3 (render). Shop summary with DB/Lights columns + overdue flag, no breakdown table → Task 1 + Task 3. Data mapping (landlord = not by-tenant; ordered = ordered+received; DB/Lights via scope-type keys `db`/`lighting`) → Task 1, verified by unit tests. Preview/Save/Download → Tasks 4, 5, 6. Persist to `projects.reports`, versioned, no new migration → Task 5. Tests → Tasks 1 & 3, plus Task 7. Active-only tables, decommissioned counted → Task 1 (`activeNodes` vs `decommissionedCount`).

**Placeholder scan:** none. Every code step is complete. The only flagged uncertainty is the exact `listNodes` row field names (Task 2 Step 2) — absorbed by casts with a stated fallback, not a placeholder.

**Type consistency:** `OrderStatus`, `ShopRow`, `ReportKpis`, `ComputeInput` are defined in Task 1 and consumed unchanged in Tasks 2 & 3. `TenantScheduleReportData` is defined in Task 2 and used identically in Tasks 3, 4, 5. `buildTenantScheduleBrandingInput` / `renderTenantScheduleReport` / `gatherTenantScheduleReportData` names match across Tasks 2–6. Route paths (`/api/projects/[id]/tenant-schedule/report-preview` and `/reports`) match between Tasks 4/5 and the client in Task 6.
```
