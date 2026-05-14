# Cable Schedule UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Cable Schedule entity-management flow self-explanatory — clear schedule entry, one always-visible Structure panel, a progressive Add-cable form, and a length-mode toggle that is either working or honestly disabled.

**Architecture:** Pure front-end change on Next.js 15 App Router pages/components under `apps/web/src/app/(admin)/projects/[id]/cables/`. No server-action, `@esite/shared`, migration, or RLS changes. Each task is one logical commit that leaves the app building and working.

**Tech Stack:** Next.js 15 (App Router, React Server + Client Components), TypeScript, CSS-variable styling (amber/charcoal design system in `globals.css`), `vitest` for the one pure-function unit test.

**Spec:** `docs/superpowers/specs/2026-05-14-cable-schedule-ui-redesign-design.md`

**Branch:** `feat/powersync` (no worktree was created; work on the current branch).

---

## Conventions for every task

- Typecheck command (run from repo root `/Users/spud/Documents/DEVELOPER/E-SITE CO/esite`):
  `pnpm --filter web exec tsc --noEmit` (the web app's pnpm package name is `web`, **not** `@esite/web`).
- **Known pre-existing typecheck baseline:** the web app has **5 pre-existing errors** from schema type drift, unrelated to this redesign — in `src/actions/onboarding.actions.ts`, `src/actions/supplier.actions.ts`, `src/app/(admin)/procurement/NewProcurementForm.tsx`, `src/app/(marketplace)/supplier/profile/page.tsx`, and `src/app/api/paystack/subaccount/route.ts`. The pass criterion for every task is **no NEW errors beyond these 5**, and zero errors in any file the task touched. Do not fix the 5 — they are out of scope.
- Environment note: the shell may run Node 25 while the repo pins Node 22 (an `engines` warning). The warning is harmless; `tsc` and `vitest` still run.
- Preview verification uses the `preview_*` tools (start a dev server, navigate, snapshot/screenshot). Never use raw `curl`/Bash for UI checks.
- Commit messages follow the repo convention: `feat(cable-schedule): ...` / `fix(cable-schedule): ...`.
- Do **not** run `git push`. Commits stay local.
- The amber/charcoal CSS variables (`--c-amber`, `--c-panel`, `--c-border`, `--c-text-mid`, `--c-elevated`, `--c-base`, etc.) and the shared classes (`.data-panel`, `.ob-input`, `.ob-label`, `.btn-primary-amber`, `.badge`) already exist in `apps/web/src/app/globals.css` — reuse them, don't invent new ones.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `apps/web/src/app/(admin)/projects/[id]/cables/RevisionsList.tsx` | Revisions table — whole-row click-to-open, explicit `Open →` affordance, DRAFT accent |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | Schedule grid — `activeLength()` honours `lengthMode`; hosts the `+ Add cable` trigger in its toolbar |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/LengthModeToggle.tsx` | Length-mode segmented control — restyled, disabled-with-tooltip when no confirmed lengths |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx` | **New file** (renamed from `NodesPanel.tsx`) — always-visible two-column Sources/Boards manager with teaching empty states |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | Add-cable inline action — progressive form (primary fields + "More cable detail" expander) |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Editor page — mounts `StructurePanel`, removes the read-only `SourcesPanel`/`BoardsPanel`, passes `hasConfirmedLengths`, regroups header buttons |
| `packages/shared/src/services/cable-calc.service.test.ts` | **New file** — unit coverage for `activeLengthM()` (the canonical length-mode logic the grid mirrors) |

`NodesPanel.tsx` is deleted (renamed to `StructurePanel.tsx`).

---

## Task 1: Revisions list — clear entry affordance

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/RevisionsList.tsx`

- [ ] **Step 1: Add a hovered-row state**

In `RevisionsList`, alongside the existing `useState` hooks (after `const [error, setError] = useState<string | null>(null)`), add:

```tsx
const [hoveredId, setHoveredId] = useState<string | null>(null)
```

- [ ] **Step 2: Make the whole row clickable + accented + hover-highlighted**

Replace the existing `<tr key={r.id} style={{ borderTop: '1px solid var(--c-border)' }}>` opening tag with:

```tsx
<tr
  key={r.id}
  onClick={() => router.push(`/projects/${projectId}/cables/${r.id}`)}
  onMouseEnter={() => setHoveredId(r.id)}
  onMouseLeave={() => setHoveredId(null)}
  style={{
    borderTop: '1px solid var(--c-border)',
    borderLeft: r.status === 'DRAFT' ? '3px solid var(--c-amber)' : '3px solid transparent',
    background: hoveredId === r.id ? 'var(--c-elevated)' : undefined,
    cursor: 'pointer',
  }}
>
```

- [ ] **Step 3: Restyle the code link as an obvious link**

In the first `<Td mono>`, change the `<Link>`'s `style` from `{ color: 'var(--c-text)', fontWeight: 600, textDecoration: 'none' }` to:

```tsx
style={{ color: 'var(--c-amber)', fontWeight: 600, textDecoration: 'none' }}
```

- [ ] **Step 4: Stop action buttons from also opening the row**

In the last `<Td align="right">`, change both button `onClick` handlers to stop propagation. Replace `onClick={() => onIssue(r.id)}` with `onClick={(e) => { e.stopPropagation(); onIssue(r.id) }}` and `onClick={() => onDelete(r.id)}` with `onClick={(e) => { e.stopPropagation(); onDelete(r.id) }}`.

- [ ] **Step 5: Add the explicit `Open →` affordance**

Inside the last `<Td align="right">`, after the existing `<div style={{ display: 'inline-flex', gap: 4 }}>…</div>` that holds the Issue/Discard buttons, add a trailing cue (still inside the same `<Td>`):

```tsx
<span style={{
  marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 11,
  color: hoveredId === r.id ? 'var(--c-amber)' : 'var(--c-text-dim)',
  letterSpacing: '0.04em',
}}>
  Open →
</span>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched.

- [ ] **Step 7: Preview-verify**

Start the dev server with `preview_start`, navigate to a project's cable revisions list (`/projects/<id>/cables`). With `preview_screenshot` confirm: rows highlight on hover, DRAFT rows show the amber left accent, `Open →` is visible. With `preview_click` on a row body (not a button) confirm it navigates to the revision editor. Click an `Issue`/`Discard` button and confirm it does **not** navigate.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/RevisionsList.tsx"
git commit -m "feat(cable-schedule): revisions list — whole-row open + clear affordance"
```

---

## Task 2: Fix the length-mode `activeLength` bug (+ unit test)

The grid's local `activeLength()` (`CableScheduleGrid.tsx:93`) ignores `lengthMode` and hardcodes as-built logic, so the displayed Length column never switches with the mode. The canonical logic lives in `activeLengthM()` in `packages/shared/src/services/cable-calc.service.ts`. This task locks that canonical logic with a test, then makes the grid's local helper mirror it.

**Files:**
- Create: `packages/shared/src/services/cable-calc.service.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`

- [ ] **Step 1: Write the failing test for `activeLengthM`**

Create `packages/shared/src/services/cable-calc.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { activeLengthM, type CableForCalc } from './cable-calc.service'

function cable(over: Partial<CableForCalc>): CableForCalc {
  return {
    id: 'c1',
    supply_id: 's1',
    size_mm2: 25,
    ohm_per_km: 1,
    measured_length_m: 100,
    confirmed_length_m: null,
    length_status: 'MEASURED',
    ...over,
  } as CableForCalc
}

describe('activeLengthM', () => {
  it('design mode always uses measured length', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'CONFIRMED' }), 'design')).toBe(100)
  })

  it('as-built uses confirmed only when length_status is CONFIRMED', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'CONFIRMED' }), 'as-built')).toBe(140)
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'MEASURED' }), 'as-built')).toBe(100)
  })

  it('worst takes the max of measured and confirmed', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140 }), 'worst')).toBe(140)
    expect(activeLengthM(cable({ measured_length_m: 160, confirmed_length_m: 140 }), 'worst')).toBe(160)
  })

  it('all three modes agree when there is no confirmed length', () => {
    const c = cable({ measured_length_m: 100, confirmed_length_m: null, length_status: 'MEASURED' })
    expect(activeLengthM(c, 'design')).toBe(100)
    expect(activeLengthM(c, 'as-built')).toBe(100)
    expect(activeLengthM(c, 'worst')).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts`
Expected: PASS (4 tests). `activeLengthM` already implements this logic correctly — the test documents and locks it. If the `CableForCalc` shape in the test's `cable()` helper does not satisfy the real interface, fix the helper's fields to match `CableForCalc` in `cable-calc.service.ts` until the test compiles and passes.

- [ ] **Step 3: Make the grid's local `activeLength` honour the mode**

In `CableScheduleGrid.tsx`, replace the function at line ~93:

```tsx
function activeLength(r: ScheduleRow): number | null {
  if (r.length_status === 'CONFIRMED' && r.confirmed_length_m != null) return r.confirmed_length_m
  return r.measured_length_m
}
```

with a version that takes the mode and branches identically to `activeLengthM`:

```tsx
function activeLength(r: ScheduleRow, mode: 'design' | 'as-built' | 'worst'): number | null {
  const meas = r.measured_length_m
  const conf = r.confirmed_length_m
  if (mode === 'design') return meas
  if (mode === 'worst') {
    if (meas != null && conf != null) return Math.max(meas, conf)
    return conf ?? meas
  }
  // as-built
  if (r.length_status === 'CONFIRMED' && conf != null) return conf
  return meas
}
```

- [ ] **Step 4: Update the call site**

`activeLength` is called once, at line ~416 (`const len = activeLength(r)`). Change it to `const len = activeLength(r, lengthMode)`. `lengthMode` is already a prop in scope (`Props.lengthMode`). Run `grep -n "activeLength(" CableScheduleGrid.tsx` to confirm there is exactly one call site; if more appear, pass `lengthMode` to each.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/cable-calc.service.test.ts "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx"
git commit -m "fix(cable-schedule): grid Length column honours the length mode"
```

---

## Task 3: Length-mode toggle — segmented control + never-dead disabled state

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/LengthModeToggle.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Add the `hasConfirmedLengths` prop and disabled rendering to the toggle**

Replace the body of `LengthModeToggle.tsx` (keep the `'use client'`, imports, `LengthMode` type, and `MODES` array unchanged) with this component:

```tsx
export function LengthModeToggle({
  basePath,
  current,
  hasConfirmedLengths,
}: {
  basePath: string
  current: LengthMode
  hasConfirmedLengths: boolean
}) {
  const params = useSearchParams()

  function hrefFor(mode: LengthMode): string {
    const sp = new URLSearchParams(params.toString())
    if (mode === 'as-built') sp.delete('view')
    else sp.set('view', mode)
    const qs = sp.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--c-text-dim)',
      }}>
        Lengths
      </span>
      <div
        role="tablist"
        aria-label="Length-source view"
        title={hasConfirmedLengths ? undefined : 'Available once cables have site-confirmed lengths'}
        style={{
          display: 'inline-flex',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          overflow: 'hidden',
          opacity: hasConfirmedLengths ? 1 : 0.5,
        }}
      >
        {MODES.map((m) => {
          const active = current === m.key
          const shared: React.CSSProperties = {
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '7px 14px',
            textDecoration: 'none',
            borderRight: '1px solid var(--c-border)',
            color: active ? '#0D0B09' : 'var(--c-text-mid)',
            background: active ? 'var(--c-amber)' : 'var(--c-panel)',
          }
          if (!hasConfirmedLengths) {
            return (
              <span key={m.key} role="tab" aria-selected={active} aria-disabled="true"
                style={{ ...shared, cursor: 'not-allowed' }}>
                {m.label}
              </span>
            )
          }
          return (
            <Link key={m.key} href={hrefFor(m.key)} role="tab" aria-selected={active}
              title={m.title} scroll={false} style={shared}>
              {m.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Compute and pass `hasConfirmedLengths` from the page**

In `page.tsx`, after the `cables` array is built (`const cables = (cablesRes?.data ?? []) as unknown as CableRow[]`, ~line 148), add:

```tsx
const hasConfirmedLengths = cables.some((c) => c.confirmed_length_m != null)
```

Then update the `<LengthModeToggle .../>` usage in the header (~line 436) to pass the new prop:

```tsx
<LengthModeToggle
  basePath={`/projects/${projectId}/cables/${revisionId}`}
  current={lengthMode}
  hasConfirmedLengths={hasConfirmedLengths}
/>
```

Note: `CableRow extends CableForCalc` — confirm `confirmed_length_m` is reachable on the row type. `CableForCalc` already includes `confirmed_length_m` (used by `activeLengthM`), so this typechecks; if not, add `confirmed_length_m: number | null` to the `CableRow` interface and to the `cables` select list in `page.tsx` (it is already selected at ~line 136).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched.

- [ ] **Step 4: Preview-verify**

With the dev server running, open a revision that has cables but no confirmed lengths. `preview_screenshot`: the toggle shows the `Lengths` label and a dimmed segmented control; `preview_inspect` / hover confirms the `not-allowed` cursor and the tooltip text. Then (if a revision with a confirmed length is available) confirm the toggle is full-opacity and clicking a segment changes the active segment and the Length column.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/LengthModeToggle.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): length-mode toggle — segmented control + disabled-with-reason"
```

---

## Task 4: Structure panel — always-visible Sources/Boards manager

Rework `NodesPanel.tsx` into `StructurePanel.tsx`: always open, two columns (Sources / Boards), prominent add buttons, teaching empty states, "Sources/Boards" vocabulary. Then mount it in `page.tsx` and delete the redundant read-only `SourcesPanel`/`BoardsPanel`.

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx` (renamed from `NodesPanel.tsx`)
- Delete: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Create `StructurePanel.tsx` from `NodesPanel.tsx`**

`git mv` the file:

```bash
git mv "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx"
```

- [ ] **Step 2: Rework the component — always-open, two-column, teaching empty states**

In `StructurePanel.tsx`, keep `PanelNode`, `Props`, `SOURCE_TYPES`, `BOARD_KINDS`, `TYPE_LABEL`, the `NodeRow` component, and the `AddNodeForm` component **unchanged**. Rename the exported component `NodesPanel` → `StructurePanel`. Replace its body: delete the `const [open, setOpen]` state and the early-return collapsed button. The new component renders an always-open panel split into a Sources column and a Boards column. Replace the whole `export function NodesPanel(...) { ... }` with:

```tsx
export function StructurePanel({ revisionId, nodes, canEdit }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState<'source' | 'board' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PanelNode | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const sources = nodes.filter((n) => n.category === 'source')
  const boards = nodes.filter((n) => n.category === 'board')

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

  // Render helper, NOT a nested component — calling it inline avoids a
  // component boundary, so AddNodeForm's local state never remounts.
  const renderColumn = (
    which: 'source' | 'board',
    items: PanelNode[],
    emptyHint: string,
  ) => (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--c-text-mid)',
        }}>
          {which === 'source' ? 'Sources' : 'Boards'} ({items.length})
        </span>
        {canEdit && (
          <button type="button" className="btn-primary-amber"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setAdding(which)}>
            + Add {which}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', fontStyle: 'italic', margin: '4px 0 0' }}>
          {emptyHint}
        </p>
      ) : (
        items.map((n) => (
          <NodeRow key={n.id} node={n} canEdit={canEdit} pending={pending}
            onRename={(code) => run(() => n.category === 'source'
              ? renameSourceAction(n.id, code) : renameBoardAction(n.id, code))}
            onDelete={() => setConfirmDelete(n)} />
        ))
      )}
      {adding === which && (
        <AddNodeForm category={which} revisionId={revisionId} pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(payload) => run(() => which === 'source'
            ? addSourceAction(payload as never) : addBoardAction(payload as never))} />
      )}
    </div>
  )

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Structure</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '2px 0 0' }}>
          Where power comes from, and the boards it feeds. Build this first, then wire up cables below.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 12 }}>✕ {error}</div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {renderColumn('source', sources,
          'Start here — add where power comes from (a council RMU, generator, etc.).')}
        {renderColumn('board', boards,
          'Add the boards power is distributed to (main boards, sub boards, minisubs).')}
      </div>

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
              Removing <strong>{confirmDelete.code}</strong> ({TYPE_LABEL[confirmDelete.nodeType]}) will also
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
```

`useRef` / `useEffect` may no longer be used by the top-level component, but `NodeRow` still imports them — leave the import line `import { useState, useRef, useEffect, useTransition } from 'react'` as-is since `NodeRow` uses `useRef`/`useEffect`. Run typecheck (Step 5) to confirm there are no unused-import errors; if the project's tsconfig flags unused imports, trim only the genuinely-unused ones.

- [ ] **Step 3: Update `page.tsx` — swap the import and mount**

In `page.tsx`, change the import at ~line 17 from:

```tsx
import { NodesPanel, type PanelNode } from './NodesPanel'
```

to:

```tsx
import { StructurePanel, type PanelNode } from './StructurePanel'
```

In the `revision.status === 'DRAFT'` block (~line 456), replace:

```tsx
<NodesPanel revisionId={revision.id} nodes={panelNodes} canEdit={revision.status === 'DRAFT'} />
```

with:

```tsx
<StructurePanel revisionId={revision.id} nodes={panelNodes} canEdit={revision.status === 'DRAFT'} />
```

The `StructurePanel` should render for **all** revision statuses, not just DRAFT — move the `<StructurePanel .../>` line out of the `revision.status === 'DRAFT' && (...)` conditional so an ISSUED revision still shows its structure read-only (the `canEdit` prop already gates the buttons). The `<AddEntityPanel .../>` stays inside the DRAFT-only block. Concretely, the block becomes:

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

- [ ] **Step 4: Remove the redundant read-only panels**

In `page.tsx`, delete the 2-column grid that renders `<SourcesPanel .../>` and `<BoardsPanel .../>` (~lines 444-454):

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
  <SourcesPanel sources={sources} />
  <BoardsPanel boards={boards} />
</div>
```

Then delete the now-unused `SourcesPanel` and `BoardsPanel` function definitions at the bottom of `page.tsx` (~lines 509-574).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched. If it reports `SourceRow` / `BoardRow` as unused (they were only used by the deleted panels) — they are still used by the `sources`/`boards` casts and `panelNodes` build, so they should remain referenced; only remove a type if typecheck explicitly flags it unused.

- [ ] **Step 6: Preview-verify**

With the dev server running, open a DRAFT revision. `preview_screenshot`: the "Structure" panel is visible at the top without any clicking, with Sources and Boards columns and prominent `+ Add source` / `+ Add board` buttons. On an empty revision the teaching empty-state hints show. `preview_click` `+ Add source`, fill the inline form, submit — confirm the source appears in the Sources column. Confirm the old read-only "Sources (N)" / "Boards (N)" panels are gone.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): always-visible Structure panel; drop redundant read-only panels"
```

---

## Task 5: Progressive Add-cable form + repositioning

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Make the cable form progressive**

In `AddEntityPanel.tsx`, in the `CableForm` component, add a local expander state alongside the existing field state hooks:

```tsx
const [showMore, setShowMore] = useState(false)
```

In the returned JSX, keep the `<Grid>` wrapper. Keep these `<Field>`s **always visible** in this order: `From *`, `To (board) *`, `Voltage *`, `Design load (A) *`, `Size (mm²) *`. Move the remaining `<Field>`s — `Section`, `Cores`, `Conductor`, `Insulation`, `Length (m)`, `Install method`, `Depth (mm)`, `Group size`, `Ω/km override` — inside a block that only renders when `showMore` is true. Between the always-visible fields and the `<SubmitButton>`, insert a full-width toggle:

```tsx
<div style={{ gridColumn: '1 / -1' }}>
  <button type="button" onClick={() => setShowMore((v) => !v)}
    style={{ background: 'none', border: 'none', cursor: 'pointer',
      color: 'var(--c-text-mid)', fontSize: 12, fontFamily: 'var(--font-mono)',
      letterSpacing: '0.04em', padding: 0 }}>
    {showMore ? '− Less cable detail' : '+ More cable detail'}
  </button>
</div>
{showMore && (
  <>
    {/* the 9 moved <Field> elements go here, unchanged */}
  </>
)}
```

The `<SubmitButton>` stays last and unchanged. All field state, defaults, and the `go()` submit handler are unchanged — `go()` already reads every field's state regardless of whether it is currently mounted, and every "more detail" field has a sensible default, so a cable can be added without expanding the section.

- [ ] **Step 2: Update the empty-state copy**

In `CableForm`, replace the early-return empty-state paragraph:

```tsx
<p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
  Add at least one source AND one board via the Nodes panel before placing a cable.
</p>
```

with:

```tsx
<p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
  Add at least one source and one board in the Structure panel above before placing a cable.
</p>
```

- [ ] **Step 3: Update the grid empty-state copy in `page.tsx`**

In `page.tsx`, in the `cables.length === 0` branch (~lines 467-488), replace the helper text inside `data-panel-empty` with copy that matches the new names:

```tsx
⚡ No cables in this revision yet.
<div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 6 }}>
  Build your <strong>Structure</strong> above (sources and boards), then use{' '}
  <strong>+ Add cable</strong> to start the schedule. Cable rows auto-fill Ω/km +
  base rating from the bundled SANS library. To bulk-load from an existing
  workbook, use <strong>⬆ Import Excel</strong> from the revisions list.
</div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched.

- [ ] **Step 5: Preview-verify**

With the dev server running, open a DRAFT revision that has at least one source and one board. `preview_click` `+ Add cable` to open the panel. `preview_screenshot`: only From / To / Voltage / Design load / Size are shown, plus a `+ More cable detail` toggle. Fill From, To, Design load and submit — confirm a cable is added without ever expanding "More cable detail". Then `preview_click` `+ More cable detail` and confirm the other nine fields appear. On a revision with no sources/boards, confirm the empty-state copy references "the Structure panel above".

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): progressive Add-cable form + refreshed empty-state copy"
```

---

## Task 6: Header & button consistency

Converge the buttons on the touched screens onto the shared `Button` component and group the editor header logically. `Button` (`apps/web/src/components/ui/Button.tsx`) takes `variant` (`primary` | `secondary` | `ghost` | `danger`), `size` (`sm` | `md` | `lg`), `isLoading`, and standard button attributes; it renders a `<button>`. For navigation links, keep `<Link>` but style it to match `secondary` (the existing header already does this via inline styles — just make the styling consistent).

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Group and normalise the editor header buttons**

In `page.tsx`, the header `<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>` (~line 386) contains four `<Link>` nav buttons (`🏷 Tag schedule`, `💰 Cost summary`, `🔀 Diff`, `📐 Discrepancies`), the `<LengthModeToggle>`, and `<ExportMenu>`. Group them into two sub-groups with a consistent shared link style. Define one style constant above the `return` (near `revLetter`, ~line 269):

```tsx
const headerNavLinkStyle: React.CSSProperties = {
  background: 'var(--c-panel)',
  border: '1px solid var(--c-border)',
  color: 'var(--c-text-mid)',
  borderRadius: 6,
  padding: '9px 16px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}
```

Then replace the four nav `<Link>`s' individual `className`/`style` props with `style={headerNavLinkStyle}` (drop the `className="btn-primary-amber"` from each — it was being overridden anyway), and wrap them in a sub-group div, with the toggle + export in a second sub-group:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
  <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
    <Link href={`/projects/${projectId}/cables/${revisionId}/tags`} style={headerNavLinkStyle}>🏷 Tag schedule</Link>
    <Link href={`/projects/${projectId}/cables/${revisionId}/cost`} style={headerNavLinkStyle}>💰 Cost summary</Link>
    <Link href={`/projects/${projectId}/cables/${revisionId}/diff`} style={headerNavLinkStyle}
      title={priorIssued ? `Diff against ${priorIssued.code}` : 'No prior issued revision to diff against'}>🔀 Diff</Link>
    <Link href={`/projects/${projectId}/cables/${revisionId}/discrepancies`} style={headerNavLinkStyle}>📐 Discrepancies</Link>
  </div>
  <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <LengthModeToggle
      basePath={`/projects/${projectId}/cables/${revisionId}`}
      current={lengthMode}
      hasConfirmedLengths={hasConfirmedLengths}
    />
    <ExportMenu projectId={projectId} revisionId={revisionId} />
  </div>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing schema-drift errors listed in Conventions may appear, and zero errors in any file this task touched.

- [ ] **Step 3: Preview-verify**

With the dev server running, open a revision. `preview_screenshot`: the four nav buttons are visually consistent (same padding, border, colour) and grouped together; the length toggle + export sit as a separate group. Confirm each nav button still navigates.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): consistent, grouped editor header buttons"
```

---

## Task 7: Final verification & cleanup

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Then: `pnpm --filter @esite/shared exec tsc --noEmit`
Expected: both exit 0, no output.

- [ ] **Step 2: Run the shared unit test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Orphan scan**

Run `grep -rn "NodesPanel" "apps/web/src/app/(admin)/projects/[id]/cables/"` — expected: no matches (all references renamed to `StructurePanel`). Run `grep -rn "SourcesPanel\|BoardsPanel" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"` — expected: no matches. If either prints a line, fix the dangling reference.

- [ ] **Step 4: Full preview walkthrough of the three original pain points**

With the dev server running:
1. **Entry:** from `/projects/<id>/cables`, hover a row (highlight), see `Open →`, click the row body — lands in the editor.
2. **Structure:** on an empty DRAFT revision, the "Structure" panel is visible immediately with teaching empty states; add a source and a board via the inline forms; open `+ Add cable`, add a cable using only the primary fields.
3. **Toggle:** on a revision with no confirmed lengths, the length toggle is dimmed with the "Available once cables have site-confirmed lengths" tooltip; it is not a dead-feeling control.

Capture a `preview_screenshot` of the reworked editor as proof.

- [ ] **Step 5: Final commit (only if Steps 1-3 surfaced fixes)**

If any fix was needed in Steps 1-3, commit it:

```bash
git add -A
git commit -m "fix(cable-schedule): post-redesign verification cleanup"
```

If nothing needed fixing, skip this step.

---

## Self-review notes

**Spec coverage:** Section 1 → Task 1. Section 2 → Task 4. Section 3 → Task 5. Section 4 → Tasks 2 (the `activeLength` bug) + 3 (toggle redesign + disabled state). Section 5 → Task 6 (buttons) + the vocabulary changes woven through Tasks 4 and 5. Verification (spec §6) → Task 7. All five spec sections are covered.

**Vocabulary:** "Sources" / "Boards" / "+ Add source" / "+ Add board" / "Structure" used consistently in Tasks 4 and 5; "Nodes" / "Origin node" / "Distribution node" removed.

**Type consistency:** `StructurePanel` keeps the existing `Props` / `PanelNode` interfaces and the `NodeRow` / `AddNodeForm` children unchanged; `page.tsx` imports `StructurePanel` + `PanelNode` from the renamed file. `LengthModeToggle` gains `hasConfirmedLengths: boolean`, supplied by `page.tsx` from `cables.some(c => c.confirmed_length_m != null)`. `activeLength(r, mode)` in the grid matches the call site updated in Task 2 Step 4.

**Deferred (out of scope, per spec §7):** `window.prompt`/`confirm()` in `RevisionsList`; repo-wide button convergence.
