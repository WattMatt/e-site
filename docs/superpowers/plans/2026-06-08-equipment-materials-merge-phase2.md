# Equipment & Materials merge — Phase 2 (the unified tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the single board-centric **"Equipment & Materials"** tab the spec describes — one list where the board is the row and its procurement (status, dates, documents) is an expandable detail — at a new route, **not yet wired into the sidebar** so it ships safely alongside the existing two tabs for testing. Phase 3 (a separate plan) does the cutover.

**Architecture:** A new server route `/projects/[id]/equipment-materials` reads board-first (every `structure.nodes` row) and attaches procurement from `node_orders` + docs. A pure `gatherUnifiedBoards()` does the shaping (testable); the page renders collapsible kind-groups of master board rows, each expandable to a detail panel. Documents preview in an **in-app `DocumentPreviewModal`** (D10), not a new tab. Reuses the Part-A helpers (`naturalCompare`, `triggerDownload`) and the existing procurement server actions (`markOrderedAction`, `markReceivedAction`, doc upload).

**Tech Stack:** Next.js 15 App Router (server component page + client subcomponents), `@esite/shared`, vitest + @testing-library/react.

**Branch:** `feat/equipment-materials-unified`, off `main` (`bc77476`, which has Part A + the D9 trigger). Spec: `docs/superpowers/specs/2026-06-08-equipment-materials-merge-design.md` (decisions D1–D10 LOCKED). The spec edit adding D10 is already on this branch.

**Reference components to mirror (do not import — these are the OLD tabs, retired in Phase 3):**
- `apps/web/src/app/(admin)/projects/[id]/materials/page.tsx` — the order read + grouping + RAG/required-by logic.
- `.../materials/_components/{OrderRow,MaterialOrderGroup,OrderDocSlot,ShopDrawingList}.tsx`.
- `.../equipment-schedule/_components/EquipmentTable.tsx` — the add/edit/decommission modals + KindGroup.

---

## File structure (PR-1)

```
apps/web/src/app/(admin)/projects/[id]/equipment-materials/
  page.tsx                         # server: gather data, render groups
  _lib/gather-unified-boards.ts    # PURE: raw rows -> grouped UnifiedBoard[]
  _lib/gather-unified-boards.test.ts
  _components/
    UnifiedBoardGroup.tsx          # collapsible group card (mirror MaterialOrderGroup)
    BoardRow.tsx                   # master row + expandable detail (mirror OrderRow)
    BoardDetail.tsx                # detail panel (equipment line / tenant scope lines)
    DocumentPreviewModal.tsx       # in-app preview (D10) — iframe/img + download
    DocumentPreviewModal.test.tsx
apps/web/src/actions/
  equipment-materials.actions.ts   # getDocumentSignedUrlAction (read-gated, optional download)
```

---

### Task 1: Pure `gatherUnifiedBoards` + types

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards.ts`
- Test: `.../_lib/gather-unified-boards.test.ts`

The page passes already-fetched raw rows (same queries the old `materials/page.tsx` runs — copy them into `page.tsx` in Task 3); this function only shapes them. Keep it pure (no I/O) so it is unit-testable.

- [ ] **Step 1: Write the types + failing test**

```ts
// gather-unified-boards.test.ts
import { describe, it, expect } from 'vitest'
import { gatherUnifiedBoards, type GatherInput } from './gather-unified-boards'

const base: GatherInput = {
  nodes: [
    { id: 'n1', code: 'DB-10', name: null, kind: 'common_area_board', status: 'active', coc_required: true, custom_kind_label: null, shop_name: null, shop_number: null },
    { id: 'n2', code: 'DB-2',  name: null, kind: 'common_area_board', status: 'active', coc_required: false, custom_kind_label: null, shop_name: null, shop_number: null },
    { id: 't1', code: 'DB-24', name: null, kind: 'tenant_db', status: 'active', coc_required: false, custom_kind_label: null, shop_name: 'Woolworths', shop_number: '24' },
  ] as never,
  orders: [
    { id: 'o1', node_id: 'n1', label: 'DB-10', scope_item_type_id: null, status: 'required', ordered_at: null, received_at: null, notes: '' },
    { id: 'o2', node_id: 'n2', label: 'DB-2',  scope_item_type_id: null, status: 'ordered', ordered_at: '2026-02-01', received_at: null, notes: '' },
    { id: 'o3', node_id: 't1', label: 'DB',    scope_item_type_id: 'st-db', status: 'ordered', ordered_at: '2026-02-01', received_at: null, notes: '' },
  ] as never,
  scopeTypeById: new Map([['st-db', { id: 'st-db', key: 'db', label: 'DB' }]]),
  boByNode: new Map(),
  openingDate: null,
  today: '2026-02-15',
  docsByOrder: new Map(),
  drawingsByOrder: new Map(),
}

describe('gatherUnifiedBoards', () => {
  it('groups equipment boards by kind, natural-sorted (DB-2 before DB-10)', () => {
    const groups = gatherUnifiedBoards(base)
    const ca = groups.find((g) => g.key === 'common_area_board')!
    expect(ca.boards.map((b) => b.code)).toEqual(['DB-2', 'DB-10'])
  })

  it('puts tenant_db boards in the Tenant / Shop group with a scope rollup', () => {
    const groups = gatherUnifiedBoards(base)
    const tn = groups.find((g) => g.key === 'tenant_db')!
    expect(tn.label).toBe('Tenant / Shop Boards')
    const b = tn.boards[0]
    expect(b.type).toBe('tenant')
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].scopeLabel).toBe('DB')
  })

  it('equipment board carries exactly one procurement line + a status summary', () => {
    const groups = gatherUnifiedBoards(base)
    const b = groups.find((g) => g.key === 'common_area_board')!.boards[0]
    expect(b.type).toBe('equipment')
    expect(b.lines).toHaveLength(1)
    expect(b.summary.status).toBe('required')
  })

  it('hides decommissioned boards by default, includes them when asked', () => {
    const input = { ...base, nodes: [{ ...(base.nodes as any)[0], status: 'decommissioned' }, ...(base.nodes as any).slice(1)] as never }
    expect(gatherUnifiedBoards(input).find((g) => g.key === 'common_area_board')?.boards.length ?? 0).toBe(0)
    expect(gatherUnifiedBoards(input, { showDecommissioned: true }).find((g) => g.key === 'common_area_board')!.boards.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter web exec vitest run src/app/\(admin\)/projects/\[id\]/equipment-materials/_lib/gather-unified-boards.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `gather-unified-boards.ts`**

Full implementation. Types first, then the function. `computeOrderRequiredBy` / `computeRagStatus` come from `@esite/shared` (used as in the old page); `naturalCompare` from `@/lib/natural-compare`. Equipment kinds + group order/labels mirror the spec §5.

```ts
import { computeOrderRequiredBy, computeRagStatus, EQUIPMENT_KINDS } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import type { OrderDoc } from '@/app/(admin)/projects/[id]/materials/_components/OrderDocSlot' // type-only; safe to import a type
import type { ShopDrawing } from '@/app/(admin)/projects/[id]/materials/_components/ShopDrawingList'

export type ProcStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

export interface RawNode {
  id: string; code: string; name: string | null; kind: string; status: string
  coc_required: boolean; custom_kind_label: string | null; shop_name: string | null; shop_number: string | null
}
export interface RawOrder {
  id: string; node_id: string; label: string; scope_item_type_id: string | null
  status: ProcStatus; ordered_at: string | null; received_at: string | null; notes: string
}
export interface ProcLine {
  orderId: string; scopeLabel: string | null   // null = the equipment line
  status: ProcStatus; ordered_at: string | null; received_at: string | null
  required_by: string | null; rag: 'red' | 'amber' | 'green' | 'neutral'
  documents: { quote: OrderDoc | null; order_instruction: OrderDoc | null }
  shopDrawings: ShopDrawing[]
}
export interface UnifiedBoard {
  nodeId: string; code: string; name: string | null; kind: string
  type: 'equipment' | 'tenant'; cocRequired: boolean; status: 'active' | 'decommissioned'
  lines: ProcLine[]
  summary: { status: ProcStatus | 'none'; rollup: string | null; requiredBy: string | null; rag: ProcLine['rag'] }
}
export interface UnifiedGroup { key: string; label: string; boards: UnifiedBoard[] }

export interface GatherInput {
  nodes: RawNode[]; orders: RawOrder[]
  scopeTypeById: Map<string, { id: string; key: string; label: string }>
  boByNode: Map<string, { boPeriodDays: number | null; boDateOverride: string | null }>
  openingDate: string | null; today: string
  docsByOrder: Map<string, ProcLine['documents']>
  drawingsByOrder: Map<string, ShopDrawing[]>
}

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: null, order_instruction: null })

const GROUP_LABEL: Record<string, string> = {
  rmu: 'Ring Main Units (RMU)', mini_sub: 'Mini-Substations', generator: 'Generators',
  main_board: 'Main Boards', common_area_board: 'Common Area Boards',
  common_area_lighting: 'Common Area Lighting', tenant_db: 'Tenant / Shop Boards',
}
// built-in display order; custom groups append after, tenant_db last
const GROUP_ORDER = ['rmu', 'mini_sub', 'generator', 'main_board', 'common_area_board', 'common_area_lighting']

export function gatherUnifiedBoards(
  input: GatherInput,
  opts: { showDecommissioned?: boolean } = {},
): UnifiedGroup[] {
  const { nodes, orders, scopeTypeById, boByNode, openingDate, today, docsByOrder, drawingsByOrder } = input
  const ordersByNode = new Map<string, RawOrder[]>()
  for (const o of orders) {
    const list = ordersByNode.get(o.node_id) ?? []
    list.push(o); ordersByNode.set(o.node_id, list)
  }

  const toLine = (o: RawOrder, isTenant: boolean): ProcLine => {
    const bo = isTenant ? boByNode.get(o.node_id) ?? { boPeriodDays: null, boDateOverride: null } : null
    const requiredBy = computeOrderRequiredBy({ openingDate, tenant: bo })
    return {
      orderId: o.id,
      scopeLabel: o.scope_item_type_id ? scopeTypeById.get(o.scope_item_type_id)?.label ?? '—' : null,
      status: o.status, ordered_at: o.ordered_at, received_at: o.received_at,
      required_by: requiredBy, rag: computeRagStatus(requiredBy, o.status, today),
      documents: docsByOrder.get(o.id) ?? EMPTY_DOCS(),
      shopDrawings: drawingsByOrder.get(o.id) ?? [],
    }
  }

  const ROLL = { received: '✓', ordered: '◐', required: '○', by_tenant: '·' } as const
  const byKey = new Map<string, UnifiedBoard[]>()
  const customLabel = new Map<string, string>()

  for (const n of nodes) {
    if (!opts.showDecommissioned && n.status !== 'active') continue
    const isTenant = n.kind === 'tenant_db'
    const lines = (ordersByNode.get(n.id) ?? []).map((o) => toLine(o, isTenant))
    let summary: UnifiedBoard['summary']
    if (isTenant) {
      const rollup = lines.length
        ? lines.map((l) => `${l.scopeLabel} ${ROLL[l.status]}`).join(' · ')
        : null
      const worst = lines.find((l) => l.rag === 'red') ?? lines.find((l) => l.rag === 'amber') ?? lines[0]
      summary = { status: lines[0]?.status ?? 'none', rollup, requiredBy: worst?.required_by ?? null, rag: worst?.rag ?? 'neutral' }
    } else {
      const l = lines[0]
      summary = { status: l?.status ?? 'none', rollup: null, requiredBy: l?.required_by ?? null, rag: l?.rag ?? 'neutral' }
    }
    const board: UnifiedBoard = {
      nodeId: n.id, code: n.code, name: n.name ?? n.shop_name ?? null, kind: n.kind,
      type: isTenant ? 'tenant' : 'equipment', cocRequired: n.coc_required,
      status: n.status === 'decommissioned' ? 'decommissioned' : 'active', lines, summary,
    }
    const key = n.kind === 'custom' ? `custom:${n.custom_kind_label ?? 'Custom'}` : n.kind
    if (n.kind === 'custom') customLabel.set(key, n.custom_kind_label ?? 'Custom')
    const arr = byKey.get(key) ?? []; arr.push(board); byKey.set(key, arr)
  }

  for (const arr of byKey.values()) arr.sort((a, b) => naturalCompare(a.code, b.code))

  const customKeys = [...byKey.keys()].filter((k) => k.startsWith('custom:')).sort((a, b) => a.localeCompare(b))
  const orderedKeys = [...GROUP_ORDER, ...customKeys, 'tenant_db']
  return orderedKeys
    .filter((k) => (byKey.get(k)?.length ?? 0) > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k] ?? customLabel.get(k) ?? 'Custom', boards: byKey.get(k)! }))
}
```

- [ ] **Step 4: Run tests, verify PASS** — same vitest command → 4 passing.
- [ ] **Step 5: Commit** — `git add … && git commit -m "feat(equipment-materials): pure gatherUnifiedBoards + tests"`

---

### Task 2: `DocumentPreviewModal` (in-app preview, D10)

**Files:**
- Create: `.../equipment-materials/_components/DocumentPreviewModal.tsx`
- Create: `apps/web/src/actions/equipment-materials.actions.ts` (a read-gated signed-URL action; mirror `getRevisionSignedUrlAction` in `tenant-documents.actions.ts` — `guardProjectRead` + `createSignedUrl(path, 300, downloadName ? {download} : undefined)`).
- Test: `.../equipment-materials/_components/DocumentPreviewModal.test.tsx`

- [ ] **Step 1: Write the failing test** — assert the modal: fetches the signed URL on open, renders an `<iframe>` for a `.pdf` (and `<img>` for an image), shows a Download button, and calls `onClose`.

```tsx
// DocumentPreviewModal.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DocumentPreviewModal } from './DocumentPreviewModal'

afterEach(() => vi.restoreAllMocks())

it('fetches the signed URL and renders a PDF in an iframe', async () => {
  const getUrl = vi.fn().mockResolvedValue({ url: 'https://signed.example/q.pdf' })
  render(<DocumentPreviewModal fileName="quote.pdf" fetchUrl={getUrl} onClose={() => {}} />)
  await waitFor(() => expect(getUrl).toHaveBeenCalled())
  await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy())
})

it('calls onClose when the close button is clicked', async () => {
  const onClose = vi.fn()
  render(<DocumentPreviewModal fileName="q.pdf" fetchUrl={async () => ({ url: 'https://x/q.pdf' })} onClose={onClose} />)
  await waitFor(() => screen.getByLabelText('Close preview'))
  fireEvent.click(screen.getByLabelText('Close preview'))
  expect(onClose).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run, verify FAIL** (module missing).
- [ ] **Step 3: Implement the modal** — a `createPortal` dialog (mirror the modal pattern in `EquipmentTable.tsx`'s `DecommissionModal`). Props: `{ fileName: string; fetchUrl: () => Promise<{url:string}|{error:string}>; onClose: () => void }`. On mount, `await fetchUrl()`; on success store the URL. Render by extension: `.pdf` → `<iframe src={url} style={{width:'100%',height:'80vh'}}>`; image (`.png/.jpg/.jpeg/.gif/.webp`) → `<img src={url}>`; else a "Download to view" message. A Download button (uses `triggerDownload` from `@/lib/file-open` with a download-variant URL — fetch with `downloadName`). A close button `aria-label="Close preview"` + backdrop-click + Esc. Error state shows the message.
- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit.**

---

### Task 3: The route + server page

**Files:**
- Create: `.../equipment-materials/page.tsx`

- [ ] **Step 1:** Copy the data-fetching block from `materials/page.tsx` verbatim (project, `listNodes`, `boByNode`, `scopeItemTypes`, the `node_orders` query **but WITHOUT the `.neq('status','by_tenant')`** — the unified tab shows tenant `by_tenant` lines too — `node_order_documents`, `node_order_shop_drawings`), building `docsByOrder` / `drawingsByOrder` exactly as there. Then call `gatherUnifiedBoards({...})`. Read `?status=` + `?showDecommissioned=` searchParams. Render `<UnifiedBoardGroup>` per group. `export const dynamic = 'force-dynamic'`. Gate: same access as the old pages (any active member can view — `createClient` + `projectService.getById` + `notFound()`; per-row write gating lives in the existing actions).
- [ ] **Step 2:** Apply the status filter (`?status=required|ordered|received`) by filtering each board's `lines`/visibility (a board shows if any line matches; equipment summary status matches). Default shows all.
- [ ] **Step 3: Verify the page compiles** — `pnpm --filter web type-check`. (No unit test for the server component; the gatherer is tested in Task 1.)
- [ ] **Step 4: Commit.**

---

### Task 4: Client UI — `UnifiedBoardGroup` + `BoardRow` + `BoardDetail`

**Files:** the three `_components/*.tsx`.

- [ ] **Step 1: `UnifiedBoardGroup`** — mirror `MaterialOrderGroup` (collapsible `<Card>` with a chevron header + count). Props `{ group: UnifiedGroup; projectId: string }`. Renders a table whose rows are `<BoardRow>`. Columns: Code · Name · Procurement · Required by · COC · Manage.
- [ ] **Step 2: `BoardRow`** — mirror `OrderRow`. A master `<tr>` (click toggles a `useState` `expanded`) rendering: code, name, the procurement summary (equipment → a status `<Badge>`; tenant → the `summary.rollup` text), required-by RAG dot, COC badge, and Manage (equipment → `Edit`/`Decommission` opening the same modals as `EquipmentTable` — extract/reuse them; tenant → a `Tenant Schedule ↗` `<Link>` to `/projects/[id]/tenant-schedule`). When expanded, a full-width `<tr>` renders `<BoardDetail>`.
- [ ] **Step 3: `BoardDetail`** — renders each `ProcLine`: status `<Badge>` + the advance action (`Mark ordered`/`Mark received` via the existing `markOrderedAction`/`markReceivedAction` from `@/actions/node-order.actions`, gated to non-synthetic real `orderId`); dates; and the documents. Documents reuse the **upload** path of `OrderDocSlot` but the **filename click opens `<DocumentPreviewModal>`** (not a new tab) + a `↓` download. For tenant boards, list the scope lines and the `Tenant Schedule` deep-link. Keep `synthetic`/orderless handling: a board with no line renders a read-only "Required — no order yet" (matches the Part-A harden; should not occur post-trigger).
- [ ] **Step 4: Verify** — `pnpm --filter web type-check`; `pnpm --filter web exec vitest run` (full suite green, incl. Tasks 1–2 tests); `pnpm --filter web build` (the route compiles).
- [ ] **Step 5: Commit.**

---

### Task 5: Manual deploy-verify note (no nav yet)

- [ ] The route is **not linked in the sidebar** (Phase 3 does that), so it ships invisibly. After merge, verify on prod by visiting `/<id>/equipment-materials` directly for Kings Walk: groups render, natural sort, a board expands, a document previews in the modal + downloads. Then open the Phase 3 plan for cutover.

---

## Self-review (against spec)

- D1/D3 master-detail board-centric — Tasks 3–4. D2 all boards (equipment + tenant rollup) — Task 1 groups both. D4 classification — inherited (kind-based groups; tenant_db → Tenant/Shop). D5 existence-driven — Task 1 iterates `nodes`. D6 natural sort — Task 1 `naturalCompare`. **D10 in-app preview — Task 2 + Task 4 Step 3.** D8 name — page header. Procurement actions reuse existing server actions (no new write paths → RBAC unchanged). The `by_tenant` lines that the old Materials hid are now shown (spec §4 tenant rollup) — Task 3 Step 1 drops the `.neq`.
- Tenant board management stays in Tenant Schedule (deep-link only) — Task 4 Step 2.

## PR-2 (Phase 3 — separate plan): cutover
Sidebar → one "Equipment & Materials" entry (remove the two old links); `redirect()` from `/equipment-schedule` and `/materials` to the new route; retire the old `page.tsx`s + their now-unused components once parity is confirmed on prod; update `docs/rbac-matrix.md` for the new route. Done as its own plan after PR-1 is verified on prod.
