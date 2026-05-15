# Cable Schedule Structure Tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Structure panel's flat two-column layout with a feed tree built from the supply graph, and make "+ feed a board" on any node the one obvious way to extend the structure.

**Architecture:** A pure `buildStructureTree` in `@esite/shared` turns sources/boards/supplies into a `{ roots, unfed }` tree. `StructurePanel` is reworked into a recursive tree renderer. A new thin client wrapper `StructureSection` holds the shared "feed-from" state so a tree node's "+ feed a board" can pre-seed the Add-cable form (which also gains an inline "+ new board" option). `page.tsx` builds the tree + per-supply feed summaries and renders the wrapper.

**Tech Stack:** Next.js 15 (App Router; `page.tsx` is a server component, the panels are client components), TypeScript, `vitest` for the pure-function test, CSS-variable styling.

**Spec:** `docs/superpowers/specs/2026-05-15-cable-schedule-structure-tree-design.md`

**Branch:** `feat/powersync` (work on the current branch — no worktree).

---

## Conventions for every task

- All commands run from repo root `/Users/spud/Documents/DEVELOPER/E-SITE CO/esite`.
- **Web typecheck:** `pnpm --filter web exec tsc --noEmit` (the web app's pnpm package name is `web`, **not** `@esite/web`).
- **Known pre-existing typecheck baseline:** the web app has **5 pre-existing errors** from schema drift, in unrelated files — `src/actions/onboarding.actions.ts`, `src/actions/supplier.actions.ts`, `src/app/(admin)/procurement/NewProcurementForm.tsx`, `src/app/(marketplace)/supplier/profile/page.tsx`, `src/app/api/paystack/subaccount/route.ts`. Pass criterion for every task: **no NEW errors beyond these 5**, and zero errors in any file the task touched. Do not fix the 5.
- **Shared package:** `pnpm --filter @esite/shared exec tsc --noEmit` (must stay 0 errors) and `pnpm --filter @esite/shared exec vitest run <path>`.
- When running a command, paste its **literal** output + exit code — do not summarize.
- **Preview note:** the dev server currently cannot reach the Supabase backend (auth "Failed to fetch"). Per-task preview verification is best-effort; if it can't run, say so and rely on typecheck + unit tests.
- Commit messages: `feat(cable-schedule): ...` / `fix(cable-schedule): ...`.
- Do **not** run `git push` (the controller pushes once at the very end).
- There is unrelated pre-existing cruft in the working tree (iCloud `* 2.*` files, `.env*.bak`, etc.). Stage **only** the exact files named in each task with explicit `git add` paths — never `git add -A`.
- Amber/charcoal CSS variables (`--c-amber`, `--c-panel`, `--c-border`, `--c-text-mid`, `--c-text-dim`, `--c-base`, `--c-red`, `--font-mono`) and shared classes (`.data-panel`, `.ob-input`, `.ob-label`, `.btn-primary-amber`) already exist in `apps/web/src/app/globals.css` — reuse them.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `packages/shared/src/services/cable-structure.service.ts` | **New** — pure `buildStructureTree` + the `StructureTreeNode` / `StructureFeedSummary` types |
| `packages/shared/src/services/cable-structure.service.test.ts` | **New** — unit tests for `buildStructureTree` |
| `packages/shared/src/services/index.ts` | + one barrel re-export line |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | `CableForm` gains an optional pre-seedable "From" (`feedFromKey`) + an inline "+ new board…" option on the "To" field |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx` | Reworked from flat two columns into a recursive feed-tree renderer (new `Props`) |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructureSection.tsx` | **New** — thin client wrapper holding the shared `feedFrom` state; renders `StructurePanel` + `AddEntityPanel` |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Builds the tree + per-supply feed summaries; renders `<StructureSection>` |

---

## Task 1: `buildStructureTree` pure function + tests

**Files:**
- Create: `packages/shared/src/services/cable-structure.service.ts`
- Create: `packages/shared/src/services/cable-structure.service.test.ts`
- Modify: `packages/shared/src/services/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/services/cable-structure.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildStructureTree, type StructureFeedSummary } from './cable-structure.service'

// Stub decorators — the graph logic is what's under test.
const summary: StructureFeedSummary = { cableCount: 1, sizeLabel: '1×25mm² Cu', vdPct: 1.2, underRated: false }
const decorate = {
  feedSummaryFor: () => summary,
  blastFor: () => ({ blastSupplies: 0, blastCables: 0 }),
}

describe('buildStructureTree', () => {
  it('nests boards under the source/board that feeds them', () => {
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const boards = [
      { id: 'B1', code: 'MAIN', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'DB-1', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup2', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, boards, supplies, decorate)
    expect(unfed).toEqual([])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.id).toBe('S1')
    expect(roots[0]!.feedSummary).toBeNull()        // sources have no incoming feed
    expect(roots[0]!.children).toHaveLength(1)
    expect(roots[0]!.children[0]!.id).toBe('B1')
    expect(roots[0]!.children[0]!.feedSummary).toEqual(summary)
    expect(roots[0]!.children[0]!.children[0]!.id).toBe('B2')
  })

  it('flags a board fed by two supplies as alsoFedElsewhere on the 2nd occurrence', () => {
    const sources = [
      { id: 'S1', code: 'COUNCIL', type: 'COUNCIL_RMU' },
      { id: 'S2', code: 'STANDBY', type: 'STANDBY' },
    ]
    const boards = [{ id: 'B1', code: 'DB-3', kind: 'SUB_BOARD' }]
    const supplies = [
      { id: 'sup1', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup2', from_source_id: 'S2', from_board_id: null, to_board_id: 'B1' },
    ]
    const { roots } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots[0]!.children[0]!.alsoFedElsewhere).toBe(false)  // 1st occurrence — full
    expect(roots[1]!.children[0]!.alsoFedElsewhere).toBe(true)   // 2nd occurrence — marker
  })

  it('puts a board with no incoming supply in the unfed group, with its own subtree', () => {
    const sources: { id: string; code: string; type: string }[] = []
    const boards = [
      { id: 'B1', code: 'ORPHAN', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'DB-9', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup1', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
    ]
    const { roots, unfed } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots).toEqual([])
    expect(unfed).toHaveLength(1)
    expect(unfed[0]!.id).toBe('B1')
    expect(unfed[0]!.children[0]!.id).toBe('B2')
  })

  it('terminates on a cyclic supply graph instead of recursing forever', () => {
    const sources = [{ id: 'S1', code: 'RMU', type: 'COUNCIL_RMU' }]
    const boards = [
      { id: 'B1', code: 'A', kind: 'MAIN_BOARD' },
      { id: 'B2', code: 'B', kind: 'SUB_BOARD' },
    ]
    const supplies = [
      { id: 'sup0', from_source_id: 'S1', from_board_id: null, to_board_id: 'B1' },
      { id: 'sup1', from_source_id: null, from_board_id: 'B1', to_board_id: 'B2' },
      { id: 'sup2', from_source_id: null, from_board_id: 'B2', to_board_id: 'B1' }, // cycle B2 -> B1
    ]
    // Must return (not hang). B1 under S1 expands B2; B2's B1 child is the cycle — rendered as a leaf marker.
    const { roots } = buildStructureTree(sources, boards, supplies, decorate)
    expect(roots).toHaveLength(1)
    const b1 = roots[0]!.children[0]!
    expect(b1.id).toBe('B1')
    const b2 = b1.children[0]!
    expect(b2.id).toBe('B2')
    expect(b2.children[0]!.id).toBe('B1')
    expect(b2.children[0]!.alsoFedElsewhere).toBe(true) // the cycle back-edge is a leaf marker
    expect(b2.children[0]!.children).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-structure.service.test.ts`
Expected: FAIL — `cable-structure.service.ts` does not exist yet.

- [ ] **Step 3: Implement `cable-structure.service.ts`**

Create `packages/shared/src/services/cable-structure.service.ts`:

```ts
/**
 * Cable Schedule structure tree — pure functions over raw row data.
 *
 * The "structure" of a revision is its supply graph: each `supply` row is a
 * feed edge from a source/board to a board. `buildStructureTree` turns the
 * flat sources/boards/supplies into a forest:
 *   - roots  = every source, with its fed subtree
 *   - unfed  = boards with no incoming supply, each with its own subtree
 *
 * A board fed by more than one supply appears under each feeder; the
 * 2nd-and-later occurrences are flagged `alsoFedElsewhere` and not
 * re-expanded. A visited/expanded guard makes a cyclic graph terminate.
 *
 * No DB access — the per-edge `feedSummary` and the blast-radius counts are
 * supplied by the caller via the `decorate` callbacks, so this stays pure
 * and unit-testable.
 */

export interface StructureFeedSummary {
  /** Number of cables on the feeding supply. */
  cableCount: number
  /** Human label for the feeding cable(s), e.g. "5×300mm² Cu" or "—". */
  sizeLabel: string
  /** Per-supply volt-drop %. */
  vdPct: number
  /** True when the supply's combined capacity is below its design load. */
  underRated: boolean
}

export interface StructureTreeNode {
  id: string
  code: string
  category: 'source' | 'board'
  /** source.type or board.kind */
  nodeType: string
  /** The supply edge feeding this node — null for sources and unfed-board roots. */
  feedSummary: StructureFeedSummary | null
  children: StructureTreeNode[]
  /** True when this is a 2nd-or-later occurrence of a multi-fed board (or a cycle back-edge). */
  alsoFedElsewhere: boolean
  /** Cascade-delete counts for the remove-confirm modal. */
  blastSupplies: number
  blastCables: number
}

interface TreeSource { id: string; code: string; type: string }
interface TreeBoard { id: string; code: string; kind: string }
interface TreeSupply {
  id: string
  from_source_id: string | null
  from_board_id: string | null
  to_board_id: string
}

export function buildStructureTree(
  sources: TreeSource[],
  boards: TreeBoard[],
  supplies: TreeSupply[],
  decorate: {
    feedSummaryFor: (supplyId: string) => StructureFeedSummary | null
    blastFor: (id: string, category: 'source' | 'board') => { blastSupplies: number; blastCables: number }
  },
): { roots: StructureTreeNode[]; unfed: StructureTreeNode[] } {
  const boardById = new Map(boards.map((b) => [b.id, b] as const))

  // supplies grouped by their from-node id (source XOR board)
  const suppliesByFrom = new Map<string, TreeSupply[]>()
  for (const s of supplies) {
    const fromId = s.from_source_id ?? s.from_board_id
    if (!fromId) continue
    const list = suppliesByFrom.get(fromId) ?? []
    list.push(s)
    suppliesByFrom.set(fromId, list)
  }

  const fedBoardIds = new Set(supplies.map((s) => s.to_board_id))
  // boards whose full subtree has already been emitted somewhere in the forest
  const expanded = new Set<string>()

  function build(
    id: string,
    code: string,
    category: 'source' | 'board',
    nodeType: string,
    feedingSupplyId: string | null,
    visiting: Set<string>,
  ): StructureTreeNode {
    // A board already expanded elsewhere, or a cycle back-edge into a node we're
    // currently inside, becomes a leaf marker — no children, flagged.
    const isRepeat = category === 'board' && (expanded.has(id) || visiting.has(id))
    const node: StructureTreeNode = {
      id,
      code,
      category,
      nodeType,
      feedSummary: feedingSupplyId ? decorate.feedSummaryFor(feedingSupplyId) : null,
      children: [],
      alsoFedElsewhere: isRepeat,
      ...decorate.blastFor(id, category),
    }
    if (isRepeat) return node
    if (category === 'board') expanded.add(id)
    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    for (const sup of suppliesByFrom.get(id) ?? []) {
      const child = boardById.get(sup.to_board_id)
      if (!child) continue
      node.children.push(build(child.id, child.code, 'board', child.kind, sup.id, nextVisiting))
    }
    return node
  }

  const roots = sources.map((s) => build(s.id, s.code, 'source', s.type, null, new Set()))

  const unfed: StructureTreeNode[] = []
  for (const b of boards) {
    if (fedBoardIds.has(b.id)) continue // fed → already sits in some subtree
    if (expanded.has(b.id)) continue // defensive — already emitted
    unfed.push(build(b.id, b.code, 'board', b.kind, null, new Set()))
  }

  return { roots, unfed }
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-structure.service.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the barrel export**

In `packages/shared/src/services/index.ts`, add this line immediately after the existing `export * from './cable-calc.service'` line:

```ts
export * from './cable-structure.service'
```

- [ ] **Step 6: Typecheck shared**

Run: `pnpm --filter @esite/shared exec tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/services/cable-structure.service.ts packages/shared/src/services/cable-structure.service.test.ts packages/shared/src/services/index.ts
git commit -m "feat(cable-schedule): buildStructureTree — supply graph to feed tree"
```

---

## Task 2: Add-cable form — pre-seedable "From" + inline "+ new board"

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx`

All changes are in `AddEntityPanel.tsx`. After this task the form behaves exactly as today when the new props aren't passed — the additions are opt-in.

- [ ] **Step 1: Import `addBoardAction` + the board kinds**

The action import currently reads:
```tsx
import {
  findOrCreateSupplyAction,
  addCableAction,
  previewParallelCableSet,
  addParallelCableSetAction,
} from '@/actions/cable-entities.actions'
```
Add `addBoardAction`:
```tsx
import {
  findOrCreateSupplyAction,
  addCableAction,
  previewParallelCableSet,
  addParallelCableSetAction,
  addBoardAction,
} from '@/actions/cable-entities.actions'
```
And add this constant just below the existing `VOLTAGE_DEFAULTS` line (the inline "+ new board" needs a kind picker):
```tsx
const BOARD_KIND_OPTIONS = [
  { value: 'SUB_BOARD', label: 'Sub board' },
  { value: 'MAIN_BOARD', label: 'Main board' },
  { value: 'TRANSFORMER', label: 'Transformer / Minisub' },
  { value: 'CONSUMER_RMU', label: 'Consumer RMU' },
]
```

- [ ] **Step 2: Extend `AddEntityPanel`'s `Props` and pre-seed/open behaviour**

Change the `Props` interface from:
```tsx
interface Props {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
}
```
to:
```tsx
interface Props {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  /** When set (e.g. `source:<id>` / `board:<id>`), the form opens pre-seeded with this "From". */
  feedFromKey?: string | null
  /** Called once the pre-seeded feed has been used (submitted) so the caller can clear it. */
  onFeedConsumed?: () => void
}
```
In the `AddEntityPanel` function, accept the new props and add a `useEffect` that opens the panel when `feedFromKey` becomes set. The component currently destructures `{ revisionId, sources, boards }` and has an `open` state (`useState`) — extend the destructure to `{ revisionId, sources, boards, feedFromKey, onFeedConsumed }`, and add, alongside the existing hooks:
```tsx
  useEffect(() => {
    if (feedFromKey) setOpen(true)
  }, [feedFromKey])
```
Then pass the two new props through to `<CableForm ... />` in the JSX: add `feedFromKey={feedFromKey}` and `onFeedConsumed={onFeedConsumed}` to the existing `<CableForm>` element. Also, in `AddEntityPanel`'s `submit()` success path (where it currently does `setFlash(...)` / `router.refresh()`), call `onFeedConsumed?.()` so a successful submit clears the caller's pre-seed.

- [ ] **Step 3: Extend `CableForm`'s signature + state**

`CableForm`'s parameter type currently is:
```tsx
function CableForm({
  revisionId, sources, boards, pending, onSubmit,
}: {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
}) {
```
Add the two optional props:
```tsx
function CableForm({
  revisionId, sources, boards, pending, onSubmit, feedFromKey, onFeedConsumed,
}: {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
  feedFromKey?: string | null
  onFeedConsumed?: () => void
}) {
```
Add two new state hooks alongside the existing ones (after `const [ohmOverride, setOhmOverride] = useState('')`):
```tsx
  const [newBoardCode, setNewBoardCode] = useState('')
  const [newBoardKind, setNewBoardKind] = useState('SUB_BOARD')
```
And add a `useEffect` (place it after the state hooks, before the existing debounced preview `useEffect`) that applies the pre-seeded "From":
```tsx
  useEffect(() => {
    if (feedFromKey && allFrom.some((o) => o.key === feedFromKey)) {
      setFromKey(feedFromKey)
    }
  }, [feedFromKey])
```

- [ ] **Step 4: Skip the preview for an unsaved new board**

In the existing debounced preview `useEffect`, the early-return guard currently is:
```tsx
    if (!kind || !id || !toBoardId || !loadNum || loadNum <= 0) {
      setPreview(null)
      return
    }
```
Change it to also bail when "To" is the new-board sentinel (a brand-new board has no id to preview against):
```tsx
    if (!kind || !id || !toBoardId || toBoardId === '__new__' || !loadNum || loadNum <= 0) {
      setPreview(null)
      return
    }
```

- [ ] **Step 5: Resolve the "To" board (creating it if new) inside `go()`**

In `go()`, the two `onSubmit(async () => { ... })` closures each reference `toBoardId` directly. Add a shared resolver at the very top of **each** async closure (right after the `if (!kind || !id) return { error: ... }` line), and use its result in place of `toBoardId`.

For the `useSet` branch's closure, after the `if (!kind || !id)` guard, insert:
```tsx
          let resolvedToBoardId = toBoardId
          if (toBoardId === '__new__') {
            const board = await addBoardAction({ revisionId, code: newBoardCode.trim(), kind: newBoardKind as never })
            if (board.error || !board.id) return { error: board.error ?? 'Could not create the board' }
            resolvedToBoardId = board.id
          }
```
and change the `toBoardId` passed to `addParallelCableSetAction` to `resolvedToBoardId`.

For the `else` (single-cable) branch's closure, after the `if (!kind || !id)` guard, insert the **same** block, and change the `toBoardId` passed to `findOrCreateSupplyAction` to `resolvedToBoardId`.

(Note: when "To" is `__new__`, `preview` is `null` — Step 4 — so `useSet` is `false` and the single-cable branch runs. The block is added to both branches anyway so the form is correct regardless.)

- [ ] **Step 6: Add the "+ new board…" option + inline inputs to the "To" field**

The "To (board)" `<Field>` currently is:
```tsx
    <Field label="To (board) *">
      <select className="ob-input" value={toBoardId} onChange={(e) => setToBoardId(e.target.value)}>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
      </select>
    </Field>
```
Replace it with:
```tsx
    <Field label="To (board) *">
      <select className="ob-input" value={toBoardId} onChange={(e) => setToBoardId(e.target.value)}>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        <option value="__new__">+ new board…</option>
      </select>
      {toBoardId === '__new__' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input className="ob-input" style={{ flex: 1 }} value={newBoardCode} maxLength={80}
            placeholder="New board code" onChange={(e) => setNewBoardCode(e.target.value)} />
          <select className="ob-input" value={newBoardKind} onChange={(e) => setNewBoardKind(e.target.value)}>
            {BOARD_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
      )}
    </Field>
```

- [ ] **Step 7: Disable submit when "+ new board" is chosen but unnamed**

The `<SubmitButton>`'s `disabled` prop currently is:
```tsx
      disabled={pending || !fromKey || !toBoardId || !load || !sizeMm2}
```
Change it to also require a non-empty new-board code when the sentinel is selected:
```tsx
      disabled={pending || !fromKey || !toBoardId || !load || !sizeMm2
        || (toBoardId === '__new__' && newBoardCode.trim().length < 1)}
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero in `AddEntityPanel.tsx`.

- [ ] **Step 9: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx"
git commit -m "feat(cable-schedule): Add-cable form — pre-seedable From + inline new-board"
```

---

## Task 3: StructurePanel → feed tree + `StructureSection` wrapper + `page.tsx` wiring

This is the integration task — the `StructurePanel` interface change, the new wrapper, and the `page.tsx` rewiring land together as one coherent commit so the build stays green.

**Files:**
- Modify (rewrite): `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructureSection.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Rewrite `StructurePanel.tsx` as a recursive feed tree**

Replace the **entire** contents of `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx` with:

```tsx
'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { StructureTreeNode } from '@esite/shared'
import {
  addSourceAction, addBoardAction,
  deleteSourceAction, deleteBoardAction,
  renameSourceAction, renameBoardAction,
} from '@/actions/cable-entities.actions'

const SOURCE_TYPES = [
  { value: 'COUNCIL_RMU', label: 'Council RMU' },
  { value: 'UTILITY', label: 'Utility' },
  { value: 'PV', label: 'PV plant' },
  { value: 'STANDBY', label: 'Standby generator' },
]
const BOARD_KINDS = [
  { value: 'CONSUMER_RMU', label: 'Consumer RMU' },
  { value: 'TRANSFORMER', label: 'Transformer / Minisub' },
  { value: 'MAIN_BOARD', label: 'Main board' },
  { value: 'SUB_BOARD', label: 'Sub board' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  [...SOURCE_TYPES, ...BOARD_KINDS].map((t) => [t.value, t.label]),
)

interface Props {
  revisionId: string
  roots: StructureTreeNode[]
  unfed: StructureTreeNode[]
  canEdit: boolean
  /** Emits a CableForm "From" key (`source:<id>` / `board:<id>`) when "+ feed a board" is clicked. */
  onFeedBoard: (fromKey: string) => void
}

export function StructurePanel({ revisionId, roots, unfed, canEdit, onFeedBoard }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState<'source' | 'board' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<StructureTreeNode | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setAdding(null)
      setConfirmDelete(null)
      router.refresh()
    })
  }

  const onRename = (node: StructureTreeNode, code: string) =>
    run(() => node.category === 'source'
      ? renameSourceAction(node.id, code)
      : renameBoardAction(node.id, code))

  const empty = roots.length === 0 && unfed.length === 0

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Structure</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '2px 0 0' }}>
          Where power comes from, and the boards it feeds. Each branch is a cable — use “+ feed a board” to extend it.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 12 }}>✕ {error}</div>
      )}

      {empty ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontStyle: 'italic', margin: '4px 0 0' }}>
          Start here — add where power comes from (a council RMU, generator, etc.), then “+ feed a board” to wire the structure.
        </p>
      ) : (
        <>
          {roots.map((n) => (
            <TreeNode key={n.id} node={n} depth={0} canEdit={canEdit} pending={pending}
              onRename={onRename} onDelete={setConfirmDelete} onFeedBoard={onFeedBoard} />
          ))}
          {unfed.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>
                Unfed — not yet on any feed
              </div>
              {unfed.map((n) => (
                <TreeNode key={n.id} node={n} depth={0} canEdit={canEdit} pending={pending}
                  onRename={onRename} onDelete={setConfirmDelete} onFeedBoard={onFeedBoard} />
              ))}
            </div>
          )}
        </>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setAdding('source')}>+ Add source</button>
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px', background: 'var(--c-panel)',
              border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
            onClick={() => setAdding('board')}>+ Add board (unfed)</button>
        </div>
      )}
      {adding && (
        <AddNodeForm category={adding} revisionId={revisionId} pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(payload) => run(() => adding === 'source'
            ? addSourceAction(payload as never) : addBoardAction(payload as never))} />
      )}

      {confirmDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="structure-del-title"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirmDelete(null) }}
          tabIndex={-1}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="data-panel" style={{ padding: 16, minWidth: 340, maxWidth: 460,
            display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
            <h3 id="structure-del-title" style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Remove {confirmDelete.category}</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>
              Removing <strong>{confirmDelete.code}</strong> ({TYPE_LABEL[confirmDelete.nodeType] ?? confirmDelete.nodeType}) will also
              delete <strong>{confirmDelete.blastSupplies}</strong> suppl{confirmDelete.blastSupplies === 1 ? 'y' : 'ies'} and{' '}
              <strong>{confirmDelete.blastCables}</strong> cable{confirmDelete.blastCables === 1 ? '' : 's'}.
              {confirmDelete.category === 'board' && ' Child boards re-parent to top-level.'} Continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setConfirmDelete(null)} className="btn-primary-amber"
                autoFocus
                style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
                Cancel
              </button>
              <button type="button" disabled={pending} className="btn-primary-amber"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => run(() => confirmDelete.category === 'source'
                  ? deleteSourceAction(confirmDelete.id) : deleteBoardAction(confirmDelete.id))}>
                {pending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TreeNode({
  node, depth, canEdit, pending, onRename, onDelete, onFeedBoard,
}: {
  node: StructureTreeNode
  depth: number
  canEdit: boolean
  pending: boolean
  onRename: (node: StructureTreeNode, code: string) => void
  onDelete: (node: StructureTreeNode) => void
  onFeedBoard: (fromKey: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(node.code)
  const escapeRef = useRef(false)
  useEffect(() => { setCode(node.code) }, [node.code])

  const icon = node.category === 'source' ? '⚡' : '🟦'
  const f = node.feedSummary

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', paddingLeft: depth * 22 }}>
        <span aria-hidden="true">{icon}</span>
        {editing ? (
          <input className="ob-input" value={code} autoFocus style={{ width: 200 }}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => {
              if (escapeRef.current) { escapeRef.current = false; setEditing(false); return }
              setEditing(false)
              const trimmed = code.trim()
              if (trimmed && trimmed !== node.code) onRename(node, trimmed)
              setCode(node.code)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { escapeRef.current = true; setCode(node.code); setEditing(false) }
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }} />
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{node.code}</span>
        )}
        {f && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            ← {f.cableCount > 0 ? f.sizeLabel : 'no cable'}
            {f.vdPct ? ` · ${f.vdPct.toFixed(1)}% VD` : ''}
            {f.underRated && <span style={{ color: 'var(--c-red)', fontWeight: 700 }}> ⚠ under-rated</span>}
          </span>
        )}
        {node.alsoFedElsewhere && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
            ↻ also fed elsewhere
          </span>
        )}
        {canEdit && !editing && !node.alsoFedElsewhere && (
          <>
            <button type="button" onClick={() => onFeedBoard(`${node.category}:${node.id}`)} disabled={pending}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-amber)', fontSize: 11 }}>
              + feed a board
            </button>
            <button type="button" onClick={() => setEditing(true)} disabled={pending}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 11 }}>
              rename
            </button>
            <button type="button" onClick={() => onDelete(node)} disabled={pending}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11 }}>
              remove
            </button>
          </>
        )}
      </div>
      {!node.alsoFedElsewhere && node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} canEdit={canEdit} pending={pending}
          onRename={onRename} onDelete={onDelete} onFeedBoard={onFeedBoard} />
      ))}
    </div>
  )
}

function AddNodeForm({
  category, revisionId, pending, onCancel, onSubmit,
}: {
  category: 'source' | 'board'
  revisionId: string
  pending: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const types = category === 'source' ? SOURCE_TYPES : BOARD_KINDS
  const [code, setCode] = useState('')
  const [nodeType, setNodeType] = useState(types[0].value)
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--c-border)', borderRadius: 6,
      display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Code *</label>
        <input className="ob-input" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder={category === 'source' ? 'COUNCIL RMU 1' : 'MAIN BOARD 1'} maxLength={80} />
      </div>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Type *</label>
        <select className="ob-input" value={nodeType} onChange={(e) => setNodeType(e.target.value)}>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <button type="button" onClick={onCancel} className="btn-primary-amber"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
        Cancel
      </button>
      <button type="button" disabled={pending || code.trim().length < 1} className="btn-primary-amber"
        onClick={() => onSubmit(category === 'source'
          ? { revisionId, code: code.trim(), type: nodeType }
          : { revisionId, code: code.trim(), kind: nodeType })}>
        {pending ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}
```

(Note: the exported `PanelNode` interface is removed — `StructureTreeNode` from `@esite/shared` replaces it. `page.tsx` is the only consumer and is rewired in Step 3.)

- [ ] **Step 2: Create the `StructureSection.tsx` wrapper**

Create `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructureSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { StructureTreeNode } from '@esite/shared'
import { StructurePanel } from './StructurePanel'
import { AddEntityPanel } from './AddEntityPanel'
import { type NodeOption } from './CableScheduleGrid'

interface Props {
  revisionId: string
  roots: StructureTreeNode[]
  unfed: StructureTreeNode[]
  canEdit: boolean
  sources: NodeOption[]
  boards: NodeOption[]
}

/**
 * Thin client wrapper that holds the shared "feed-from" state: clicking
 * "+ feed a board" on a tree node in StructurePanel pre-seeds the Add-cable
 * form's "From". page.tsx is a server component and can't hold this state.
 */
export function StructureSection({ revisionId, roots, unfed, canEdit, sources, boards }: Props) {
  const [feedFrom, setFeedFrom] = useState<string | null>(null)
  return (
    <>
      <StructurePanel
        revisionId={revisionId}
        roots={roots}
        unfed={unfed}
        canEdit={canEdit}
        onFeedBoard={(fromKey) => setFeedFrom(fromKey)}
      />
      {canEdit && (
        <AddEntityPanel
          revisionId={revisionId}
          sources={sources}
          boards={boards}
          feedFromKey={feedFrom}
          onFeedConsumed={() => setFeedFrom(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Rewire `page.tsx`**

In `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`:

(a) **Imports.** The component imports currently are:
```tsx
import { CableScheduleGrid, type ScheduleRow } from './CableScheduleGrid'
import { AddEntityPanel } from './AddEntityPanel'
import { type NodeOption } from './CableScheduleGrid'
import { StructurePanel, type PanelNode } from './StructurePanel'
```
Change them to:
```tsx
import { CableScheduleGrid, type ScheduleRow } from './CableScheduleGrid'
import { type NodeOption } from './CableScheduleGrid'
import { StructureSection } from './StructureSection'
```
(`AddEntityPanel` and `StructurePanel` are no longer imported directly — `StructureSection` owns them. `PanelNode` is gone.)

And in the `@esite/shared` import block, add `buildStructureTree` and the two types — change:
```tsx
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  supplyParallelCapacity,
  type CableForCalc,
  type SupplyForCalc,
  changedCableIds,
  type DiffableCable,
} from '@esite/shared'
```
to:
```tsx
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  supplyParallelCapacity,
  buildStructureTree,
  type StructureFeedSummary,
  type CableForCalc,
  type SupplyForCalc,
  changedCableIds,
  type DiffableCable,
} from '@esite/shared'
```

(b) **Replace the `panelNodes` build with the tree build.** The current block is:
```tsx
const panelNodes: PanelNode[] = [
  ...sources.map((s) => ({
    id: s.id, code: s.code, category: 'source' as const, nodeType: s.type,
    ...blastFor(s.id, 'source'),
  })),
  ...boards.map((b) => ({
    id: b.id, code: b.code, category: 'board' as const, nodeType: b.kind,
    ...blastFor(b.id, 'board'),
  })),
]
```
The `blastFor` function just above it stays. This task also needs `capacityBySupply`, `cableCountBySupply`, and `supplyVdById` — those are computed *lower down* in the file (in the "Per-supply combined parallel capacity" block). The tree build must come *after* those maps exist. **Delete the `panelNodes` block entirely** and instead, immediately after the `supplyVdById` loop (the last of the per-supply maps), add:
```tsx
  // Per-supply feed summary for the structure tree's edge labels.
  const cablesBySupply = new Map<string, CableRow[]>()
  for (const c of cables) {
    const list = cablesBySupply.get(c.supply_id) ?? []
    list.push(c)
    cablesBySupply.set(c.supply_id, list)
  }
  const feedSummaryBySupply = new Map<string, StructureFeedSummary>()
  for (const sup of supplies) {
    const supCables = cablesBySupply.get(sup.id) ?? []
    const first = supCables[0]
    const allSame = supCables.length > 0 && supCables.every(
      (c) => c.size_mm2 === first!.size_mm2 && c.conductor === first!.conductor,
    )
    const sizeLabel = supCables.length === 0
      ? '—'
      : allSame
        ? `${supCables.length}×${first!.size_mm2}mm² ${first!.conductor === 'CU' ? 'Cu' : 'Al'}`
        : `${supCables.length} cables (mixed)`
    feedSummaryBySupply.set(sup.id, {
      cableCount: supCables.length,
      sizeLabel,
      vdPct: supplyVdById.get(sup.id) ?? 0,
      underRated: sup.design_load_a != null
        && (capacityBySupply.get(sup.id) ?? 0) < sup.design_load_a,
    })
  }

  const { roots: structureRoots, unfed: structureUnfed } = buildStructureTree(
    sources.map((s) => ({ id: s.id, code: s.code, type: s.type })),
    boards.map((b) => ({ id: b.id, code: b.code, kind: b.kind })),
    supplies.map((s) => ({
      id: s.id, from_source_id: s.from_source_id, from_board_id: s.from_board_id, to_board_id: s.to_board_id,
    })),
    {
      feedSummaryFor: (id) => feedSummaryBySupply.get(id) ?? null,
      blastFor,
    },
  )
```

(c) **Replace the render.** The current JSX block is:
```tsx
<StructurePanel revisionId={revision.id} nodes={panelNodes} canEdit={revision.status === 'DRAFT'} />
{revision.status === 'DRAFT' && (
  <AddEntityPanel
    revisionId={revision.id}
    sources={sources.map<NodeOption>((s) => ({ id: s.id, code: s.code, kind: 'source' }))}
    boards={boards.map<NodeOption>((b) => ({ id: b.id, code: b.code, kind: 'board' }))}
  />
)}
```
Replace it with:
```tsx
<StructureSection
  revisionId={revision.id}
  roots={structureRoots}
  unfed={structureUnfed}
  canEdit={revision.status === 'DRAFT'}
  sources={sources.map<NodeOption>((s) => ({ id: s.id, code: s.code, kind: 'source' }))}
  boards={boards.map<NodeOption>((b) => ({ id: b.id, code: b.code, kind: 'board' }))}
/>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero in `StructurePanel.tsx`, `StructureSection.tsx`, or `page.tsx`. If `blastFor` is reported as referenced-before-declaration (it sits above the old `panelNodes` block; the new tree build sits lower) — `blastFor` is a function declaration so it is hoisted within `RevisionDetailPage` and is callable from the new lower block; no move needed. If tsc disagrees, move the `blastFor` function declaration up to just before the new tree-build block.

- [ ] **Step 5: Preview-verify (best-effort)**

Per the Conventions preview note. If the dev server can authenticate: open a DRAFT revision — the Structure panel shows a feed tree (sources at root, boards nested under their feeder, edge labels, an "Unfed" group if any); "+ feed a board" on a node opens the Add-cable form with "From" pre-set; the "To" field has a "+ new board…" option. If the dev server can't reach Supabase, report DONE_WITH_CONCERNS noting preview was skipped.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructureSection.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): Structure panel becomes a feed tree with inline build"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typechecks**

Run: `pnpm --filter @esite/shared exec tsc --noEmit` — expect exit 0, no output.
Run: `pnpm --filter web exec tsc --noEmit` — expect only the 5 known pre-existing errors, none in any file this plan touched.

- [ ] **Step 2: Run the shared unit tests**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-structure.service.test.ts`
Expected: PASS — 4 tests.
Run: `pnpm --filter @esite/shared exec vitest run` — expect the whole shared suite green (the cable-calc tests from prior work plus the new cable-structure tests).

- [ ] **Step 3: Consistency scan**

Run `grep -rn "PanelNode\|panelNodes" "apps/web/src/app/(admin)/projects/[id]/cables/"` — expect no matches (all replaced by the tree). Run `grep -rn "buildStructureTree\|StructureSection\|onFeedBoard\|feedFromKey" "apps/web/src/app/(admin)/projects/[id]/cables/" packages/shared/src/services/` — confirm each symbol is defined once and referenced where expected.

- [ ] **Step 4: Preview walkthrough (best-effort)**

If the dev server can authenticate: full walkthrough — the tree renders the feed hierarchy; "+ feed a board" → pre-seeded Add-cable form → submit adds a branch; "+ new board" creates a board inline; an unfed board shows in the Unfed group; rename/remove still work with the blast-radius confirm. If the dev env can't reach Supabase, note that the walkthrough is deferred and verification rests on Steps 1–3.

---

## Self-review notes

**Spec coverage:** Spec §3 Section 1 (the pure tree builder) → Task 1. Section 2 (StructurePanel becomes a recursive tree) → Task 3 Step 1. Section 3 (the "+ feed a board" build flow + the inline "+ new board") → Task 2 (the form's pre-seed + inline new-board) + Task 3 Steps 1–2 (the tree's "+ feed a board" emit + the wrapper that carries it). Section 4 (`page.tsx` wiring) → Task 3 Step 3. The integration point the spec deferred "for the plan to resolve" is resolved as a thin client wrapper (`StructureSection`) — chosen because `page.tsx` is a server component and cannot pass an interactive callback to a client component. Spec §6 (testing) → Task 1 TDD + Task 4.

**Type consistency:** `StructureTreeNode` / `StructureFeedSummary` are defined in Task 1's `cable-structure.service.ts`, exported via the barrel, and consumed by `StructurePanel` (Task 3 Step 1), `StructureSection` (Step 2), and `page.tsx` (Step 3). `buildStructureTree`'s `decorate` param shape (`feedSummaryFor`, `blastFor`) matches what `page.tsx` passes in Task 3 Step 3 — `blastFor`'s existing signature `(id, category) => { blastSupplies, blastCables }` already matches. `StructurePanel`'s new `Props` (`roots`, `unfed`, `onFeedBoard`) match what `StructureSection` passes; `AddEntityPanel`'s new optional `feedFromKey` / `onFeedConsumed` (Task 2) match what `StructureSection` passes (Task 3 Step 2). The `fromKey` format `source:<id>` / `board:<id>` emitted by `TreeNode.onFeedBoard` matches `CableForm`'s existing `allFrom` key format.

**No placeholders:** every code step shows complete code; commands have exact expected output; the 5-error typecheck baseline is defined in Conventions and referenced consistently.

**Deferred (out of scope, per spec §7):** `parent_board_id` cleanup; drag-to-re-parent; the auto-parallel optimistic-UI ambiguity. Also noted: when "To" is a brand-new board, the auto-parallel live readout is skipped (no board id to preview against) and the single-cable path runs — adding parallels to a freshly-created board is a follow-up action, acceptable for v1.
