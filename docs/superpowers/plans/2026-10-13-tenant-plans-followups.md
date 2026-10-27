# Tenant Plans Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four follow-ups after PR #282: (1) colour the tenant floor plan by the main board that feeds each shop, (2) a **Show** button that zooms the canvas to a block or shape, (3) PDF annotations (Bluebeam markups, stamps, clouds) survive Export sheet / report appendix / portal PDFs, and (4) retire the unused `tenants.floor_plan_zones` table.

**Architecture:** Phases 1–3 are app code only and do not depend on the migration. Phase 1 adds a pure feed walker (`feedingMainBoard` / `feedsFor`) and a 12-colour board palette to `@esite/shared/status-plans`, a loader that reads the project's chosen cable-schedule revision through the caller's session (`lib/status-plans/feed-graph.ts`), a pure view layer (`board-view.ts`) that re-colours a resolved `ShapeView`, a **Colour by: Status | Main board** switch mirrored to `?colour=board`, a board legend, and `colourBy` through Export sheet and a third report-appendix option. Phase 2 adds `fitToBox` to the shared sheet viewport and a `focus` prop on the status-plan canvas. Phase 3 flattens each drawn annotation's normal appearance stream into the embedded page, using pure §12.5.5 helpers and a pdf-lib adapter, with a byte-identity regression for pages without annotations. Phase 4 removes the `floor_plan_zones` lookup from `cloud-sync-project` (deployed FIRST), drops the table from the site-scope manifest, edits 00238's `@verify` block, removes the generated types, and adds migration `00251_retire_floor_plan_zones.sql` with a step-0 guard.

**Tech Stack:** Postgres 17 (Supabase), PostgREST RLS; Next.js 15 App Router, React 19, Konva; pdf-lib 1.17.1; pdfjs-dist 5.7.284; TypeScript; vitest (`web`, `@esite/shared`, `@esite/db`); Deno edge function (`cloud-sync-project`); pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-13-tenant-plans-followups-design.md`. Builds on `docs/superpowers/plans/2026-10-12-tenant-plans-relocation.md` (PR #282, migration 00249).

**Out of scope for implementers:** applying the migration, deploying the edge function, merging. Phase 5 ends with the branch green locally and the migration dry-run against production (red first, guard proof, coverage, sweep). The **Deploy runbook** at the end is for the owner / release session only.

---

## Rules this plan follows (read once before Task 1.1)

These come from `CLAUDE.md`; each was paid for by a real incident.

1. **Every migration ≥ `00185` carries a `-- @verify:begin … -- @verify:end` block** (`apps/web/src/lib/migration-verify-block.contract.test.ts`). Directives only inside the block; no em dash inside a `sql:` payload (#194).
2. **When a migration drops an object an earlier `@verify` block names, edit that earlier block in the same PR** and prove it by evaluating the old directives under the new state (`scripts/db/emit-verify-sweep.ts`). Here: `00238_site_scoped_access.sql` line 124, `-- policy: site_scope ON tenants.floor_plan_zones RESTRICTIVE` (Task 4.2, Task 5.1 Step 7). No other block names the table (`grep -rn floor_plan_zones apps/edge-functions/supabase/migrations` finds only 00006, 00009 and 00238).
3. **`isAnnotated()` fails closed.** The edge function must be deployed WITHOUT the `floor_plan_zones` lookup BEFORE 00251 is applied (runbook R2), or every drawing reads as annotated and auto-adopt stops platform-wide.
4. **Site tables live in `packages/db/src/site-scope/manifest.ts`**; `scripts/db/site-scope/site_scoped_access.sql` is regenerated with `npx tsx scripts/db/site-scope/emit.ts`, never hand-edited; `scripts/db/assert-site-scope-coverage.sql` must stay green.
5. **`'use server'` files export async functions only.** Nothing in this plan adds to an actions file.
6. **Server actions return `{ ok, error }`** (unchanged here).
7. **Page → client component props are JSON only** (`page-props.contract.test.ts`, `jsonUnsafePath` in `load-plan-page.test.ts`). The new `feed` prop is plain objects and strings; colour mode is a string.
8. **`readAll` for anything that can pass 1 000 rows** (supplies can).
9. **Every string pdf-lib draws goes through `winAnsiSafe`** (the renderer already does this for labels, titles and legend entries; board names flow through the same paths).
10. **Run all three suites** (`web`, `@esite/shared`, `@esite/db`) before calling anything green.
11. **Migration number is claimed at apply time.** Ledger head `00249`; PR #281 holds `00250`; this plan writes `00251_retire_floor_plan_zones.sql`. Tests find it by pattern, never by number. Task 5.1 Step 1 and the runbook re-check.
12. **Worktree hygiene:** `pnpm install` in this worktree; never symlink another worktree's `node_modules`. Tests and builds run with `TMPDIR` on the SSD.

Shell setup used by every command below:

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
export TMPDIR="/Volumes/Extreme SSD/tmp"
mkdir -p "$TMPDIR"
```

Commit messages end with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## File structure

**Create**

| Path | Responsibility |
|---|---|
| `packages/shared/src/status-plans/feed.ts` (+ `.test.ts`) | `feedingMainBoard`, `feedsFor`, `compareBoardNames`, `FEED_MAX_HOPS` — pure upstream walk |
| `apps/web/src/lib/status-plans/feed-graph.ts` (+ `.test.ts`) | `pickFeedRevision`, `loadProjectFeedGraph` (caller's session, `readAll`), `planFeedFrom` |
| `apps/web/src/lib/status-plans/board-view.ts` (+ `.test.ts`) | `boardView`, `boardLegendRows`, `boardLegendEntries` |
| `apps/web/src/lib/status-plans/focus.ts` (+ `.test.ts`) | Pulse timing for "Show" |
| `apps/web/src/lib/status-plans/annotation-appearance.ts` (+ `.test.ts`) | Pure: which annotations draw, `/AS` pick, §12.5.5 matrix |
| `apps/web/src/lib/status-plans/annotation-flatten.ts` | pdf-lib adapter: read a copied page's `/Annots` into `{ ref, matrix }` |
| `apps/web/src/lib/status-plans/annotation-flatten.test.ts` | Byte-level tests on generated PDFs, all four rotations |
| `apps/web/src/lib/status-plans/render-plan-page.baseline.test.ts` | No-annotation output is byte-identical to before Phase 3 |
| `apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql` | Step-0 guard, `DROP TABLE`, `@verify` |
| `scripts/db/assert-floor-plan-zones-retired.sql` | Behavioural assertions for the post-00251 state |

**Modify**

| Path | Change |
|---|---|
| `packages/shared/src/status-plans/palette.ts` (+ test), `index.ts`, `index.test.ts` | `MAIN_BOARD_PALETTE`, `boardColours`, `boardShapeStyle`, `FEED_UNKNOWN_*`; export `feed` |
| `apps/web/src/lib/status-plans/types.ts` | `ColourBy`, `PlanFeed`, `PlanFeedBoard`; `StatusPlanPageProps.feed` / `.initialColourBy` |
| `apps/web/src/lib/status-plans/plan-urls.ts` (+ test) | `parseColourBy`; `tenantPlanHref(..., { colour })` |
| `apps/web/src/lib/status-plans/shape-view.ts` | `ShapeView.feedAlso?` |
| `apps/web/src/lib/status-plans/load-plan-page.ts` (+ test) | Feed for floor plans; `colourBy` arg |
| `apps/web/src/lib/status-plans/plan-render-data.ts` (+ test) | `colourBy: 'board'` |
| `apps/web/src/lib/status-plans/appendix-options.ts` (+ test), `report-appendix.ts` (+ test) | `?boardPlans=1` |
| `apps/web/src/lib/status-plans/render-plan-page.ts` | Draw annotation appearances |
| `apps/web/src/lib/sheet/viewport-math.ts` (+ test), `use-sheet-viewport.ts` | `fitToBox` |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/{StatusPlanWorkspace,StatusPlanCanvas,PlanLegend,ShapePanel,ExportSheetButton}.tsx` (+ tests) | Colour switch, board legend, Show, focus, export colour |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/DetectBlocksPanel.test.tsx` | Show buttons |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/{floor-plan,line-diagram}/page.tsx` | `?colour=`; Export sheet moves into the workspace |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx` (+ test) | "Floor plan by main board" checkbox |
| `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts` (+ test) | `?colour=board` |
| `docs/rbac-matrix.md` | Export sheet on both tools; `?boardPlans=1`; feed read |
| `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` | `isAnnotated()` drops the zones lookup |
| `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` | Zones exempted with a reason; exemption proven true |
| `packages/db/src/site-scope/manifest.ts` | Zones line removed |
| `scripts/db/site-scope/site_scoped_access.sql` | Regenerated |
| `apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql` | `@verify` block loses one directive (block only) |
| `packages/db/src/types.ts` | `floor_plan_zones` removed |

---

## Phase 1 — Colour the floor plan by feeding main board

### Task 1.1: The feed walker (`@esite/shared/status-plans/feed.ts`)

**Files:**
- Create: `packages/shared/src/status-plans/feed.ts`
- Create: `packages/shared/src/status-plans/feed.test.ts`
- Modify: `packages/shared/src/status-plans/index.ts`, `packages/shared/src/status-plans/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/status-plans/feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FEED_MAX_HOPS, compareBoardNames, feedingMainBoard, feedsFor, type FeedBoard, type FeedEdge } from './feed'

const e = (from: string, to: string): FeedEdge => ({ from, to })
const MB = (id: string, name: string): FeedBoard => ({ id, name })

describe('feedingMainBoard', () => {
  it('walks upstream through a sub-board to the main board', () => {
    const edges = [e('mb1', 'sb1'), e('sb1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 1.1')], 'db1')).toEqual({ boardId: 'mb1', also: [], hops: 2 })
  })

  it('the nearest board wins over a farther one', () => {
    const edges = [e('mb2', 'x'), e('x', 'db1'), e('mb1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 9.9'), MB('mb2', 'MB 1.1')], 'db1')?.boardId).toBe('mb1')
  })

  it('a tie at the same hop goes to the first board by name (numeric-aware); the rest are "also"', () => {
    const edges = [e('m101', 'db1'), e('m21', 'db1'), e('m20', 'db1')]
    const boards = [MB('m101', 'MB 10.1'), MB('m21', 'MB 2.1'), MB('m20', 'MB 2.0')]
    expect(feedingMainBoard(edges, boards, 'db1')).toEqual({ boardId: 'm20', also: ['m21', 'm101'], hops: 1 })
  })

  it('never walks downstream', () => {
    // db1 feeds mb1 (nonsense, but possible data): walking UP from db1 finds nothing.
    expect(feedingMainBoard([e('db1', 'mb1')], [MB('mb1', 'MB 1.1')], 'db1')).toBeNull()
  })

  it('is cycle-safe and answers null when no board is reachable', () => {
    const edges = [e('a', 'b'), e('b', 'a'), e('b', 'db1'), e('db1', 'db1')]
    expect(feedingMainBoard(edges, [MB('mb1', 'MB 1.1')], 'db1')).toBeNull()
  })

  it(`stops after ${FEED_MAX_HOPS} hops`, () => {
    const chain = (n: number) => {
      const ids = ['mb', ...Array.from({ length: n - 1 }, (_, i) => `n${i}`), 'db']
      return ids.slice(1).map((to, i) => e(ids[i]!, to))
    }
    expect(FEED_MAX_HOPS).toBe(12)
    expect(feedingMainBoard(chain(12), [MB('mb', 'MB 1')], 'db')?.hops).toBe(12)
    expect(feedingMainBoard(chain(13), [MB('mb', 'MB 1')], 'db')).toBeNull()
  })

  it('ignores duplicate edges and an unknown start', () => {
    expect(feedingMainBoard([e('mb1', 'db1'), e('mb1', 'db1')], [MB('mb1', 'MB 1.1')], 'db1')).toEqual({ boardId: 'mb1', also: [], hops: 1 })
    expect(feedingMainBoard([e('mb1', 'db1')], [MB('mb1', 'MB 1.1')], 'nope')).toBeNull()
  })
})

describe('feedsFor', () => {
  it('answers every id with the same result as feedingMainBoard', () => {
    const edges = [e('mb1', 'sb'), e('sb', 'db1'), e('mb2', 'db2')]
    const boards = [MB('mb1', 'MB 1.1'), MB('mb2', 'MB 2.1')]
    const out = feedsFor(edges, boards, ['db1', 'db2', 'db3'])
    expect(out).toEqual({
      db1: feedingMainBoard(edges, boards, 'db1'),
      db2: feedingMainBoard(edges, boards, 'db2'),
      db3: null,
    })
    expect(out.db1?.boardId).toBe('mb1')
  })
})

describe('compareBoardNames', () => {
  it('sorts numerically, case-insensitively, then by id', () => {
    const sorted = [MB('c', 'MB 10.1'), MB('b', 'mb 2.1'), MB('a', 'MB 2.1')].sort(compareBoardNames)
    expect(sorted.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/feed.test.ts
```

Expected: FAIL, `Failed to resolve import "./feed"`.

- [ ] **Step 3: Write the walker**

Create `packages/shared/src/status-plans/feed.ts`:

```ts
/**
 * Which main board feeds a shop (spec 2026-10-13 §1). Pure.
 *
 * structure.nodes.parent_node_id is NULL for every node (measured 2026-10-13), so the
 * feed path comes from the cable schedule: each supply is an edge from_node_id →
 * to_node_id. Walking UPSTREAM from a tenant DB, breadth-first, the first hop that
 * reaches a main board decides it. Several boards at that hop: the first by name
 * (compareBoardNames) wins and the others are reported as `also` ("Also fed from").
 * At most FEED_MAX_HOPS hops; a visited set makes cycles harmless.
 */

export const FEED_MAX_HOPS = 12

/** One supply: from_node_id → to_node_id. */
export interface FeedEdge {
  from: string
  to: string
}

/** A main board: its node id and the name shown in the legend. */
export interface FeedBoard {
  id: string
  name: string
}

export interface FeedMatch {
  boardId: string
  /** Other main boards at the same distance, by name. */
  also: string[]
  /** Supplies walked; 0 when the node is itself a main board. */
  hops: number
}

/** "MB 2.1" before "MB 10.1"; case-insensitive; id breaks a tie so the order is total. */
export function compareBoardNames(a: FeedBoard, b: FeedBoard): number {
  return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function upstreamIndex(edges: readonly FeedEdge[]): Map<string, string[]> {
  const up = new Map<string, string[]>()
  for (const edge of edges) {
    if (!edge.from || !edge.to || edge.from === edge.to) continue
    const list = up.get(edge.to)
    if (!list) up.set(edge.to, [edge.from])
    else if (!list.includes(edge.from)) list.push(edge.from)
  }
  return up
}

function walk(
  up: ReadonlyMap<string, readonly string[]>,
  boards: ReadonlyMap<string, FeedBoard>,
  start: string,
  maxHops: number,
): FeedMatch | null {
  if (boards.has(start)) return { boardId: start, also: [], hops: 0 }
  const seen = new Set<string>([start])
  let frontier = [start]
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const parent of up.get(node) ?? []) {
        if (seen.has(parent)) continue
        seen.add(parent)
        next.push(parent)
      }
    }
    const found = next.flatMap((id) => {
      const b = boards.get(id)
      return b ? [b] : []
    }).sort(compareBoardNames)
    if (found.length > 0) return { boardId: found[0]!.id, also: found.slice(1).map((b) => b.id), hops: hop }
    frontier = next
  }
  return null
}

/** The nearest main board upstream of `nodeId`, or null when none is within maxHops. */
export function feedingMainBoard(
  edges: readonly FeedEdge[],
  boards: readonly FeedBoard[],
  nodeId: string,
  maxHops: number = FEED_MAX_HOPS,
): FeedMatch | null {
  return walk(upstreamIndex(edges), new Map(boards.map((b) => [b.id, b])), nodeId, maxHops)
}

/** feedingMainBoard for many nodes, building the index once. */
export function feedsFor(
  edges: readonly FeedEdge[],
  boards: readonly FeedBoard[],
  nodeIds: readonly string[],
  maxHops: number = FEED_MAX_HOPS,
): Record<string, FeedMatch | null> {
  const up = upstreamIndex(edges)
  const byId = new Map(boards.map((b) => [b.id, b]))
  return Object.fromEntries(nodeIds.map((id) => [id, walk(up, byId, id, maxHops)]))
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/status-plans/index.ts`, after `export * from './detect-review'` add:

```ts
export * from './feed'
```

In `packages/shared/src/status-plans/index.test.ts`, add a case at the end of the `describe`:

```ts
  it('exports the main-board surface (follow-ups 2026-10-13)', () => {
    for (const name of ['feedingMainBoard', 'feedsFor', 'compareBoardNames']) {
      expect(typeof (sp as Record<string, unknown>)[name], name).toBe('function')
    }
    expect(sp.FEED_MAX_HOPS).toBe(12)
  })
```

- [ ] **Step 5: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/feed.test.ts src/status-plans/index.test.ts
```

Expected: PASS (feed: 9 tests; index: 4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/feed.ts packages/shared/src/status-plans/feed.test.ts packages/shared/src/status-plans/index.ts packages/shared/src/status-plans/index.test.ts
git commit -m "feat(status-plans): feedingMainBoard walks supplies upstream to the nearest main board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.2: The main-board palette

**Files:**
- Modify: `packages/shared/src/status-plans/palette.ts`
- Modify: `packages/shared/src/status-plans/palette.test.ts`
- Modify: `packages/shared/src/status-plans/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/status-plans/palette.test.ts`:

```ts
import { MAIN_BOARD_PALETTE, boardColours, boardShapeStyle, FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE } from './palette'

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb01(hex)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)
const rgbDistance = (a: string, b: string) => {
  const x = hexToRgb01(a)
  const y = hexToRgb01(b)
  return 255 * Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b)
}

describe('main-board palette', () => {
  it('has 12 distinct #RRGGBB colours', () => {
    expect(MAIN_BOARD_PALETTE).toHaveLength(12)
    expect(new Set(MAIN_BOARD_PALETTE).size).toBe(12)
    for (const c of MAIN_BOARD_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })
  it('never looks like a status colour (green complete, orange in progress, red overdue)', () => {
    for (const c of MAIN_BOARD_PALETTE) {
      for (const s of [COLOURS.complete, COLOURS.inProgress, COLOURS.overdue]) {
        expect(rgbDistance(c, s), `${c} vs ${s}`).toBeGreaterThanOrEqual(80)
      }
    }
  })
  it('stays clear of every other plan colour, and of each other', () => {
    for (const c of MAIN_BOARD_PALETTE) {
      for (const o of Object.values(COLOURS)) expect(rgbDistance(c, o), `${c} vs ${o}`).toBeGreaterThanOrEqual(60)
    }
    for (let i = 0; i < MAIN_BOARD_PALETTE.length; i++) {
      for (let j = i + 1; j < MAIN_BOARD_PALETTE.length; j++) {
        expect(rgbDistance(MAIN_BOARD_PALETTE[i]!, MAIN_BOARD_PALETTE[j]!)).toBeGreaterThanOrEqual(60)
      }
    }
  })
  it('each colour reads against the white label halo (contrast ≥ 3:1)', () => {
    for (const c of MAIN_BOARD_PALETTE) expect(contrastWithWhite(c), c).toBeGreaterThanOrEqual(3)
  })
  it('assigns colours by sorted board name, whatever order the boards arrive in; the 13th wraps', () => {
    const a = boardColours([{ id: 'b', name: 'MB 2.1' }, { id: 'a', name: 'MB 1.1' }])
    const b = boardColours([{ id: 'a', name: 'MB 1.1' }, { id: 'b', name: 'MB 2.1' }])
    expect(a).toEqual(b)
    expect(a).toEqual({ a: MAIN_BOARD_PALETTE[0], b: MAIN_BOARD_PALETTE[1] })
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, name: `MB ${i + 1}` }))
    expect(boardColours(many).m12).toBe(MAIN_BOARD_PALETTE[0])
  })
  it('a board-coloured shop is a plain translucent fill: no hatch, no dash', () => {
    const s = boardShapeStyle('#1F5FBF')
    expect(s).toMatchObject({ fill: '#1F5FBF', stroke: '#1F5FBF', hatches: [], dash: null, strikeLabel: false })
    expect(s.fillOpacity).toBeGreaterThan(0)
    expect(boardShapeStyle('#1F5FBF', true).strikeLabel).toBe(true)
  })
  it('a shop with no feed is grey and dashed, never a board colour', () => {
    expect(FEED_UNKNOWN_LABEL).toBe('Feed not in the cable schedule')
    expect(FEED_UNKNOWN_STYLE.dash).toEqual([10, 6])
    expect(MAIN_BOARD_PALETTE as readonly string[]).not.toContain(FEED_UNKNOWN_STYLE.fill)
  })
})
```

In `index.test.ts`, extend the `'exports the main-board surface'` name list to:

```ts
    for (const name of ['feedingMainBoard', 'feedsFor', 'compareBoardNames', 'boardColours', 'boardShapeStyle']) {
```

and add `expect(sp.MAIN_BOARD_PALETTE).toHaveLength(12)` after the `FEED_MAX_HOPS` line.

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/palette.test.ts src/status-plans/index.test.ts
```

Expected: FAIL — `MAIN_BOARD_PALETTE` is undefined (`Cannot read properties of undefined (reading 'length')` / `expected undefined to have a length of 12`).

- [ ] **Step 3: Add the palette**

In `packages/shared/src/status-plans/palette.ts`, add to the imports:

```ts
import { compareBoardNames, type FeedBoard } from './feed'
```

and insert after `export function dbBlockStyle(…) { … }`:

```ts
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
```

(`style()` is declared above `dbBlockStyle`, so this block may use it. `feed.ts` imports nothing, so there is no cycle.)

- [ ] **Step 4: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans
```

Expected: PASS (every file in the folder). Measured when choosing the colours: nearest status colour 83, nearest other plan colour 68, nearest pair 68, lowest contrast 3.20.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/palette.ts packages/shared/src/status-plans/palette.test.ts packages/shared/src/status-plans/index.test.ts
git commit -m "feat(status-plans): twelve main-board colours, assigned by sorted board name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.3: Web types and the `?colour=` URL

**Files:**
- Modify: `apps/web/src/lib/status-plans/types.ts`
- Modify: `apps/web/src/lib/status-plans/plan-urls.ts`
- Modify: `apps/web/src/lib/status-plans/plan-urls.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/status-plans/plan-urls.test.ts` (and add `parseColourBy` to its import from `./plan-urls`):

```ts
describe('colour mode in the URL', () => {
  it('?colour=board is the only way into board mode; anything else is status', () => {
    expect(parseColourBy('board')).toBe('board')
    expect(parseColourBy('status')).toBe('status')
    expect(parseColourBy('BOARD')).toBe('status')
    expect(parseColourBy(undefined)).toBe('status')
    expect(parseColourBy(null)).toBe('status')
  })
  it('tenantPlanHref carries colour=board after sheet and shape, and drops status', () => {
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 's1', shape: 'x', colour: 'board' }))
      .toBe('/projects/p1/tenant-schedule/floor-plan?sheet=s1&shape=x&colour=board')
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 's1', colour: 'status' }))
      .toBe('/projects/p1/tenant-schedule/floor-plan?sheet=s1')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-urls.test.ts
```

Expected: FAIL, `parseColourBy is not a function`.

- [ ] **Step 3: Add the types**

In `apps/web/src/lib/status-plans/types.ts`, after the `PreparedUpload` interface, add:

```ts
/** How the floor plan colours its shops: by progress (default) or by the main board that feeds them. */
export type ColourBy = 'status' | 'board'

/** A main board in the floor plan's board mode, with its fixed colour. */
export interface PlanFeedBoard {
  id: string
  name: string
  colour: string
}

/**
 * The feed graph as the floor plan needs it (spec 2026-10-13 §1), computed on the server.
 * `byNode` answers every tenant DB on the plan: its board and the others at the same
 * distance, or null when no supply path reaches a main board.
 */
export type PlanFeed =
  | {
      state: 'ok'
      /** The cable schedule revision the feed was read from, e.g. "Rev 2". */
      revisionCode: string
      /** Sorted by name; colours follow that order. */
      boards: PlanFeedBoard[]
      byNode: Record<string, { boardId: string; also: string[] } | null>
    }
  | {
      state: 'unavailable'
      /** The sentence the floor plan shows, e.g. "Main board view unavailable — …". */
      reason: string
      /** The same reason as a "not included" fragment for PDFs. */
      omission: string
    }
```

- [ ] **Step 4: Add the URL helpers**

In `apps/web/src/lib/status-plans/plan-urls.ts`, add after the first import:

```ts
import type { ColourBy } from './types'
```

replace `tenantPlanHref` with:

```ts
/** A tenant plan, optionally on one sheet, with one shape selected, and in board mode (?sheet= &shape= &colour=board). */
export function tenantPlanHref(
  projectId: string,
  purpose: StatusPlanPurpose,
  opts: { sheet?: string | null; shape?: string | null; colour?: ColourBy | null } = {},
): string {
  const base = `${tenantScheduleHref(projectId)}/${TENANT_PLAN_SEGMENT[purpose]}`
  const q = new URLSearchParams()
  if (opts.sheet) q.set('sheet', opts.sheet)
  if (opts.shape) q.set('shape', opts.shape)
  if (opts.colour === 'board') q.set('colour', 'board')
  const s = q.toString().replace(/\+/g, '%20')
  return s ? `${base}?${s}` : base
}

/** ?colour=board → board mode; anything else (absent, misspelt) → status. */
export function parseColourBy(v: string | null | undefined): ColourBy {
  return v === 'board' ? 'board' : 'status'
}
```

- [ ] **Step 5: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-urls.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/types.ts apps/web/src/lib/status-plans/plan-urls.ts apps/web/src/lib/status-plans/plan-urls.test.ts
git commit -m "feat(tenant-plans): ColourBy, PlanFeed and ?colour=board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.4: `loadProjectFeedGraph` — the feed through the caller's session

**Files:**
- Create: `apps/web/src/lib/status-plans/feed-graph.ts`
- Create: `apps/web/src/lib/status-plans/feed-graph.test.ts`

The revision rule: the latest `ISSUED` revision (by `issued_at`, then `created_at`), else the latest revision by `created_at` whatever its status. `cable_schedule.revisions.status` is upper case: `CHECK (status IN ('DRAFT', 'ISSUED', 'SUPERSEDED'))` (00051).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/status-plans/feed-graph.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MAIN_BOARD_PALETTE } from '@esite/shared/status-plans'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { loadProjectFeedGraph, pickFeedRevision, planFeedFrom, type RevisionRow } from './feed-graph'

const rev = (id: string, status: string, issued: string | null, created: string): RevisionRow =>
  ({ id, code: id.toUpperCase(), status, issued_at: issued, created_at: created })

describe('pickFeedRevision', () => {
  it('the latest ISSUED revision, even when a newer DRAFT exists', () => {
    const rows = [
      rev('r1', 'SUPERSEDED', '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      rev('r2', 'ISSUED', '2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      rev('r3', 'DRAFT', null, '2026-10-01T00:00:00Z'),
    ]
    expect(pickFeedRevision(rows)?.id).toBe('r2')
  })
  it('an ISSUED row without issued_at sorts after one with it', () => {
    const rows = [rev('a', 'ISSUED', null, '2026-09-01T00:00:00Z'), rev('b', 'ISSUED', '2026-06-01T00:00:00Z', '2026-05-01T00:00:00Z')]
    expect(pickFeedRevision(rows)?.id).toBe('b')
  })
  it('no ISSUED revision: the newest by created_at, whatever its status', () => {
    const rows = [rev('a', 'SUPERSEDED', null, '2026-01-01T00:00:00Z'), rev('b', 'DRAFT', null, '2026-03-01T00:00:00Z')]
    expect(pickFeedRevision(rows)?.id).toBe('b')
  })
  it('none at all: null', () => {
    expect(pickFeedRevision([])).toBeNull()
  })
})

describe('loadProjectFeedGraph', () => {
  const revisions = [rev('rev-1', 'SUPERSEDED', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), rev('rev-2', 'ISSUED', '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z')]

  it('reads the chosen revision\'s supplies (paged) and the project\'s live main boards', async () => {
    const { client, calls } = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ data: [
        { id: 's1', from_node_id: 'mb', to_node_id: 'db1' },
        { id: 's2', from_node_id: null, to_node_id: 'mb' },     // fed from a source: no edge
        { id: 's3', from_node_id: 'mb', to_node_id: null },
      ] }],
      'structure.nodes:select': [{ data: [
        { id: 'mb', kind: 'main_board', code: 'MB-1.1', name: 'MAIN BOARD 1.1' },
        { id: 'mb2', kind: 'main_board', code: null, name: 'MAIN BOARD 2.1' },
        { id: 'db1', kind: 'tenant_db', code: 'DB-1', name: null },   // a fake that ignores the kind filter must not make it a board
      ] }],
    }))
    const g = await loadProjectFeedGraph(client, 'p1')
    expect(g).toEqual({
      ok: true, revisionId: 'rev-2', revisionCode: 'REV-2',
      edges: [{ from: 'mb', to: 'db1' }],
      boards: [{ id: 'mb', name: 'MB-1.1' }, { id: 'mb2', name: 'MAIN BOARD 2.1' }],
    })
    expect(opsOf(calls, 'cable_schedule.revisions')).toContainEqual(['eq', ['project_id', 'p1']])
    const sup = opsOf(calls, 'cable_schedule.supplies')
    expect(sup).toContainEqual(['eq', ['revision_id', 'rev-2']])
    expect(sup).toContainEqual(['order', ['id']])
    expect(sup).toContainEqual(['range', [0, 999]])
    const nodes = opsOf(calls, 'structure.nodes')
    expect(nodes).toContainEqual(['eq', ['project_id', 'p1']])
    expect(nodes).toContainEqual(['eq', ['kind', 'main_board']])
    expect(nodes).toContainEqual(['is', ['deleted_at', null]])
  })

  it('pages supplies past the 1 000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, from_node_id: 'mb', to_node_id: `d${i}` }))
    const { client, calls } = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ data: page1 }, { data: [{ id: 's1000', from_node_id: 'mb', to_node_id: 'd1000' }] }],
      'structure.nodes:select': [{ data: [{ id: 'mb', kind: 'main_board', code: 'MB', name: null }] }],
    }))
    const g = await loadProjectFeedGraph(client, 'p1')
    expect(g.ok && g.edges.length).toBe(1001)
    expect(calls.filter((c) => c.table === 'cable_schedule.supplies')).toHaveLength(2)
  })

  it('no revision: says so and reads no supplies', async () => {
    const { client, calls } = fakeClient(queued({ 'cable_schedule.revisions:select': [{ data: [] }] }))
    expect(await loadProjectFeedGraph(client, 'p1')).toEqual({ ok: false, reason: 'no_revision' })
    expect(calls.map((c) => c.table)).not.toContain('cable_schedule.supplies')
  })

  it('any read error is "unreadable", never an empty graph', async () => {
    const revErr = fakeClient(queued({ 'cable_schedule.revisions:select': [{ error: { message: 'permission denied' } }] }))
    expect(await loadProjectFeedGraph(revErr.client, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
    const supErr = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ error: { message: 'timeout' } }],
      'structure.nodes:select': [{ data: [] }],
    }))
    expect(await loadProjectFeedGraph(supErr.client, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
    const thrown = { schema: () => { throw new Error('boom') } }
    expect(await loadProjectFeedGraph(thrown, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('planFeedFrom', () => {
  it('colours the boards by sorted name and answers every node', () => {
    const feed = planFeedFrom({
      ok: true, revisionId: 'r', revisionCode: 'Rev 2',
      edges: [{ from: 'mb2', to: 'db1' }, { from: 'mb1', to: 'db1' }, { from: 'mb1', to: 'db2' }],
      boards: [{ id: 'mb2', name: 'MB 2.1' }, { id: 'mb1', name: 'MB 1.1' }],
    }, ['db1', 'db2', 'db3'])
    expect(feed).toEqual({
      state: 'ok',
      revisionCode: 'Rev 2',
      boards: [{ id: 'mb1', name: 'MB 1.1', colour: MAIN_BOARD_PALETTE[0] }, { id: 'mb2', name: 'MB 2.1', colour: MAIN_BOARD_PALETTE[1] }],
      byNode: { db1: { boardId: 'mb1', also: ['mb2'] }, db2: { boardId: 'mb1', also: [] }, db3: null },
    })
  })
  it('a failed read, no revision or no main boards is "unavailable" with a sentence — never every shop grey', () => {
    expect(planFeedFrom({ ok: false, reason: 'unreadable' }, ['db1'])).toEqual({
      state: 'unavailable',
      reason: 'Main board view unavailable — the cable schedule could not be read.',
      omission: 'the cable schedule could not be read',
    })
    expect(planFeedFrom({ ok: false, reason: 'no_revision' }, ['db1'])).toMatchObject({ state: 'unavailable', omission: 'the project has no cable schedule yet' })
    expect(planFeedFrom({ ok: true, revisionId: 'r', revisionCode: 'Rev 1', edges: [], boards: [] }, ['db1']))
      .toMatchObject({ state: 'unavailable', omission: 'the cable schedule has no main boards' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/feed-graph.test.ts
```

Expected: FAIL, `Failed to resolve import "./feed-graph"`.

- [ ] **Step 3: Write the loader**

Create `apps/web/src/lib/status-plans/feed-graph.ts`:

```ts
/**
 * The feed graph for "Floor plan by main board" (spec 2026-10-13 §1).
 *
 * structure.nodes.parent_node_id is NULL everywhere, so the feed path is the cable
 * schedule's supplies (from_node_id → to_node_id) in ONE revision: the latest ISSUED,
 * else the latest by created_at. Read through the CALLER's session — RLS and site scope
 * on cable_schedule are the gate; a role that cannot see the schedule gets "unavailable",
 * never a picture of every shop in grey. Supplies are paged (readAll): a schedule can
 * pass PostgREST's 1 000-row cap. Never throws.
 */
import {
  boardColours, compareBoardNames, feedsFor,
  type FeedBoard, type FeedEdge,
} from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'
import type { PlanFeed } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RevisionRow {
  id: string
  code: string
  status: string
  issued_at: string | null
  created_at: string
}

export type FeedGraph =
  | { ok: true; revisionId: string; revisionCode: string; edges: FeedEdge[]; boards: FeedBoard[] }
  | { ok: false; reason: 'no_revision' | 'unreadable' }

type Unavailable = 'no_revision' | 'unreadable' | 'no_boards'

const FEED_UNAVAILABLE: Record<Unavailable, string> = {
  unreadable: 'Main board view unavailable — the cable schedule could not be read.',
  no_revision: 'Main board view unavailable — this project has no cable schedule yet.',
  no_boards: 'Main board view unavailable — the cable schedule has no main boards.',
}
const FEED_OMISSION: Record<Unavailable, string> = {
  unreadable: 'the cable schedule could not be read',
  no_revision: 'the project has no cable schedule yet',
  no_boards: 'the cable schedule has no main boards',
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

/** Latest ISSUED (issued_at, then created_at; a missing issued_at last), else the newest revision. */
export function pickFeedRevision(rows: readonly RevisionRow[]): RevisionRow | null {
  const issued = rows
    .filter((r) => r.status === 'ISSUED')
    .sort((a, b) => desc(a.issued_at ?? '', b.issued_at ?? '') || desc(a.created_at, b.created_at))
  if (issued[0]) return issued[0]
  return [...rows].sort((a, b) => desc(a.created_at, b.created_at))[0] ?? null
}

/** What the legend calls a main board: its code, else its name. */
function boardName(n: { code: string | null; name: string | null }): string {
  return n.code?.trim() || n.name?.trim() || 'Main board'
}

export async function loadProjectFeedGraph(client: unknown, projectId: string): Promise<FeedGraph> {
  const db = client as any
  try {
    const { data: revs, error: revErr } = await db.schema('cable_schedule').from('revisions')
      .select('id, code, status, issued_at, created_at').eq('project_id', projectId)
    if (revErr) return { ok: false, reason: 'unreadable' }
    const rev = pickFeedRevision((revs ?? []) as RevisionRow[])
    if (!rev) return { ok: false, reason: 'no_revision' }

    const [supplies, nodes] = await Promise.all([
      readAll<{ id: string; from_node_id: string | null; to_node_id: string | null }>((from, to) =>
        db.schema('cable_schedule').from('supplies').select('id, from_node_id, to_node_id')
          .eq('revision_id', rev.id).order('id').range(from, to)),
      readAll<{ id: string; kind: string; code: string | null; name: string | null }>((from, to) =>
        db.schema('structure').from('nodes').select('id, kind, code, name')
          .eq('project_id', projectId).eq('kind', 'main_board').is('deleted_at', null).order('id').range(from, to)),
    ])
    if ('error' in supplies || 'error' in nodes) return { ok: false, reason: 'unreadable' }

    const edges: FeedEdge[] = supplies.data
      .filter((s) => s.from_node_id && s.to_node_id)
      .map((s) => ({ from: s.from_node_id!, to: s.to_node_id! }))
    const boards: FeedBoard[] = nodes.data
      .filter((n) => n.kind === 'main_board')
      .map((n) => ({ id: n.id, name: boardName(n) }))
    return { ok: true, revisionId: rev.id, revisionCode: rev.code, edges, boards }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** The graph as the floor plan and the PDFs use it: board colours fixed, every node answered. */
export function planFeedFrom(g: FeedGraph, nodeIds: readonly string[]): PlanFeed {
  const reason: Unavailable | null = !g.ok ? g.reason : g.boards.length === 0 ? 'no_boards' : null
  if (reason || !g.ok) {
    const r = reason ?? 'unreadable'
    return { state: 'unavailable', reason: FEED_UNAVAILABLE[r], omission: FEED_OMISSION[r] }
  }
  const colours = boardColours(g.boards)
  const matches = feedsFor(g.edges, g.boards, nodeIds)
  return {
    state: 'ok',
    revisionCode: g.revisionCode,
    boards: [...g.boards].sort(compareBoardNames).map((b) => ({ id: b.id, name: b.name, colour: colours[b.id]! })),
    byNode: Object.fromEntries(nodeIds.map((id) => {
      const m = matches[id]
      return [id, m ? { boardId: m.boardId, also: m.also } : null]
    })),
  }
}
```

- [ ] **Step 4: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/feed-graph.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/feed-graph.ts apps/web/src/lib/status-plans/feed-graph.test.ts
git commit -m "feat(tenant-plans): load the feed graph from the chosen cable schedule revision

Read through the caller's session and paged; a failed read, no revision
or no main boards is 'unavailable', never a plan of grey shops.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.5: `board-view.ts` — re-colour a resolved shape, and the board legend

**Files:**
- Modify: `apps/web/src/lib/status-plans/shape-view.ts`
- Create: `apps/web/src/lib/status-plans/board-view.ts`
- Create: `apps/web/src/lib/status-plans/board-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/status-plans/board-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE, areaShapeStyle, boardShapeStyle, tenantShapeStyle,
} from '@esite/shared/status-plans'
import { resolveShapeView, type ShapeViewContext } from './shape-view'
import { boardLegendEntries, boardLegendRows, boardView, FEED_UNKNOWN_KEY } from './board-view'
import type { CanvasShape, PlanFeed, PlanNode } from './types'

const node = (id: string, decommissioned = false): PlanNode =>
  ({ id, code: `DB-${id}`, kind: 'tenant_db', shopNumber: id.toUpperCase(), shopName: `Shop ${id}`, scheduledM2: 50, decommissioned })
const shape = (id: string, over: Partial<CanvasShape> = {}): CanvasShape => ({
  id, sheetId: 'sh1', shape: 'rect', points: [0, 0, 200, 0, 200, 100, 0, 100], nodeId: null, areaType: null,
  detectedTag: null, source: 'manual', updatedAt: 't', ...over,
})
const NODES = [node('a'), node('b'), node('c', true)]
const ctx: ShapeViewContext = {
  purpose: 'tenant_layout',
  nodesById: new Map(NODES.map((n) => [n.id, n])),
  shopLinks: {
    a: { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: null, lights: null, boDate: '2026-01-01' } },
    b: { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: null, lights: null, boDate: null } },
    c: { state: 'decommissioned' },
  },
  dbOrders: {},
  today: '2026-10-13',
  pixelsPerMeter: 20, // 200 × 100 px = 10 m × 5 m = 50 m²
}
const FEED: Extract<PlanFeed, { state: 'ok' }> = {
  state: 'ok',
  revisionCode: 'Rev 2',
  boards: [{ id: 'mb1', name: 'MB 1.1', colour: '#1F5FBF' }, { id: 'mb2', name: 'MB 2.1', colour: '#C000B0' }],
  byNode: { a: { boardId: 'mb1', also: ['mb2'] }, b: null, c: { boardId: 'mb2', also: [] } },
}
const view = (s: CanvasShape) => boardView(resolveShapeView(s, ctx), s.nodeId, FEED)

describe('boardView', () => {
  it('a linked shop takes its board colour; overdue and its hatch are dropped; "also" names the others', () => {
    const before = resolveShapeView(shape('s1', { nodeId: 'a' }), ctx)
    expect(before.overdue).toBe(true)
    const v = view(shape('s1', { nodeId: 'a' }))
    expect(v.style).toEqual(boardShapeStyle('#1F5FBF'))
    expect(v).toMatchObject({ legendKey: 'board:mb1', overdue: false, statusLabel: 'Fed from MB 1.1', feedAlso: ['MB 2.1'] })
    expect(v.labelLines).toEqual(before.labelLines)
    expect(v.areaM2).toBe(before.areaM2)
  })
  it('a shop with no path is grey and says so', () => {
    const v = view(shape('s2', { nodeId: 'b' }))
    expect(v.style).toEqual(FEED_UNKNOWN_STYLE)
    expect(v).toMatchObject({ legendKey: FEED_UNKNOWN_KEY, statusLabel: FEED_UNKNOWN_LABEL, feedAlso: [] })
  })
  it('a decommissioned shop keeps its struck-through label', () => {
    expect(view(shape('s3', { nodeId: 'c' })).style).toEqual(boardShapeStyle('#C000B0', true))
  })
  it('area shapes, unlinked shapes and invalid outlines are unchanged', () => {
    for (const s of [shape('s4', { areaType: 'common' }), shape('s5'), shape('s6', { nodeId: 'a', invalidReason: 'crosses itself', points: [] })]) {
      expect(view(s)).toEqual(resolveShapeView(s, ctx))
    }
    expect(view(shape('s4', { areaType: 'common' })).style).toEqual(areaShapeStyle('common'))
    expect(view(shape('s5')).style).toEqual(tenantShapeStyle({ status: 'unlinked', overdue: false }))
  })
})

describe('boardLegendRows', () => {
  const shapes = [
    shape('s1', { nodeId: 'a' }), shape('s2', { nodeId: 'b' }), shape('s3', { nodeId: 'c' }),
    shape('s4', { areaType: 'common' }), shape('s5'), shape('s6', { nodeId: 'a', invalidReason: 'x', points: [] }),
  ]
  const rows = boardLegendRows(shapes.map(view), FEED)
  it('one row per board in the feed\'s order, then no-feed, unassigned and the area types', () => {
    expect(rows.map((r) => r.key)).toEqual(['board:mb1', 'board:mb2', FEED_UNKNOWN_KEY, 'unlinked', 'common', 'plant_room', 'services', 'vacant'])
  })
  it('counts shapes (invalid ones never) and measures each board\'s shops', () => {
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1, 1, 1, 0, 0, 0])
    expect(rows[0]).toMatchObject({ label: 'MB 1.1', m2: 50, style: boardShapeStyle('#1F5FBF') })
    expect(rows[2]!.m2).toBe(50)
    expect(rows[3]!.m2).toBeNull() // unlinked shapes are never measured GLA
    expect(rows[4]!.m2).toBeNull()
  })
  it('as PDF legend entries: the area goes into the label, counts by key', () => {
    const { legend, counts } = boardLegendEntries(rows)
    expect(legend[0]).toEqual({ key: 'board:mb1', label: 'MB 1.1 (50.0 m²)', style: boardShapeStyle('#1F5FBF') })
    expect(legend[3]!.label).toBe('Unassigned')
    expect(counts).toMatchObject({ 'board:mb1': 1, 'board:mb2': 1, [FEED_UNKNOWN_KEY]: 1, common: 1, vacant: 0 })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/board-view.test.ts
```

Expected: FAIL, `Failed to resolve import "./board-view"`.

- [ ] **Step 3: Let a view carry "Also fed from"**

In `apps/web/src/lib/status-plans/shape-view.ts`, add to `interface ShapeView` after `linkedNodeMissing: boolean`:

```ts
  /** Board mode only: other main boards at the same distance ("Also fed from …"). */
  feedAlso?: string[]
```

- [ ] **Step 4: Write `board-view.ts`**

Create `apps/web/src/lib/status-plans/board-view.ts`:

```ts
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
```

- [ ] **Step 5: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/board-view.test.ts src/lib/status-plans/shape-view.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/shape-view.ts apps/web/src/lib/status-plans/board-view.ts apps/web/src/lib/status-plans/board-view.test.ts
git commit -m "feat(tenant-plans): board view re-colours a resolved shop shape and builds the board legend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.6: The floor plan page loads the feed and opens in the URL's colour mode

**Files:**
- Modify: `apps/web/src/lib/status-plans/types.ts`
- Modify: `apps/web/src/lib/status-plans/load-plan-page.ts`
- Modify: `apps/web/src/lib/status-plans/load-plan-page.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx` (props helper only)

The feed is loaded on EVERY floor plan request (one small revisions query, the supplies, the main boards), so switching modes on screen is instant and needs no navigation; the choice is mirrored to `?colour=board` with `history.replaceState`, like `?sheet=` and `?shape=`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/status-plans/load-plan-page.test.ts`:

1. Extend the hoisted mocks and add a module mock directly after the existing three `vi.mock` lines:

```ts
const { feedGraphMock } = vi.hoisted(() => ({ feedGraphMock: vi.fn() }))
vi.mock('@/lib/status-plans/feed-graph', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/feed-graph')>('@/lib/status-plans/feed-graph')
  return { ...actual, loadProjectFeedGraph: (...a: unknown[]) => feedGraphMock(...a) }
})
```

2. Add `import { MAIN_BOARD_PALETTE } from '@esite/shared/status-plans'` to the imports.

3. In `beforeEach`, add:

```ts
  feedGraphMock.mockResolvedValue({ ok: false, reason: 'no_revision' })
```

4. Add these cases inside `describe('loadTenantPlanPage', …)`:

```ts
  it('a floor plan carries the feed for its tenant DBs; ?colour=board opens in board mode', async () => {
    feedGraphMock.mockResolvedValue({
      ok: true, revisionId: 'rev-2', revisionCode: 'Rev 2',
      edges: [{ from: 'mb', to: 'n1' }], boards: [{ id: 'mb', name: 'MB-1.1' }],
    })
    const { client } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args({ colourBy: 'board' }))
    if (data?.kind !== 'plan') throw new Error('expected a plan')
    expect(feedGraphMock).toHaveBeenCalledWith(client, 'p1')
    expect(data.props.initialColourBy).toBe('board')
    expect(data.props.feed).toEqual({
      state: 'ok', revisionCode: 'Rev 2',
      boards: [{ id: 'mb', name: 'MB-1.1', colour: MAIN_BOARD_PALETTE[0] }],
      byNode: { n1: { boardId: 'mb', also: [] } },
    })
    expect(jsonUnsafePath(data.props)).toBeNull()
  })

  it('without ?colour= the floor plan opens on status; an unreadable feed is carried, not thrown', async () => {
    feedGraphMock.mockResolvedValue({ ok: false, reason: 'unreadable' })
    const { client } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args())
    if (data?.kind !== 'plan') throw new Error('expected a plan')
    expect(data.props.initialColourBy).toBe('status')
    expect(data.props.feed).toMatchObject({ state: 'unavailable', reason: 'Main board view unavailable — the cable schedule could not be read.' })
  })

  it('a line diagram reads no feed and is always status', async () => {
    const { client } = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: { ...PLAN_ROW, purpose: 'distribution_schematic' } }] })))
    const data = await loadTenantPlanPage(client, args({ purpose: 'distribution_schematic', colourBy: 'board' }))
    if (data?.kind !== 'plan') throw new Error('expected a plan')
    expect(feedGraphMock).not.toHaveBeenCalled()
    expect(data.props.feed).toBeNull()
    expect(data.props.initialColourBy).toBe('status')
  })
```

In `StatusPlanWorkspace.test.tsx`, in the `props()` helper's returned object add, after `initialShapeId: null,`:

```ts
    feed: null,
    initialColourBy: 'status',
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/load-plan-page.test.ts
```

Expected: FAIL — `expected undefined to be 'board'` (no `initialColourBy` yet) and `feedGraphMock` not called.

- [ ] **Step 3: Add the props**

In `apps/web/src/lib/status-plans/types.ts`, inside `interface StatusPlanPageProps`, after `initialShapeId: string | null`, add:

```ts
  /** Floor plan only (null on a line diagram): the feed graph for "Colour by: Main board". */
  feed: PlanFeed | null
  /** From ?colour=; always 'status' on a line diagram. */
  initialColourBy: ColourBy
```

- [ ] **Step 4: Load the feed**

In `apps/web/src/lib/status-plans/load-plan-page.ts`:

1. Add imports:

```ts
import { loadProjectFeedGraph, planFeedFrom } from './feed-graph'
```

and change the types import to:

```ts
import type { CanvasShape, ColourBy, PlanFeed, PlanNode, SheetSummary, StatusPlanPageProps, TenantPlanEmptyProps } from './types'
```

2. In `interface PlanPageRaw`, after `requestedShapeId: string | null`, add:

```ts
  feed: PlanFeed | null
  colourBy: ColourBy
```

3. In `buildStatusPlanPageProps`'s returned object, after `initialShapeId: …,` add:

```ts
    feed: raw.feed,
    initialColourBy: raw.plan.purpose === 'tenant_layout' ? raw.colourBy : 'status',
```

4. Change the loader's `args` type to:

```ts
  args: {
    projectId: string
    purpose: StatusPlanPurpose
    requestedSheetId: string | null
    requestedShapeId: string | null
    /** ?colour= on the floor plan. */
    colourBy?: ColourBy
  },
```

5. Replace the block

```ts
  let shopLinks: Record<string, ShopLink> = {}
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (plan.purpose === 'tenant_layout') {
    const facts = await loadTenantShopFacts(client, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries(nodes.map((n) => [n.id, shopLinkFor(facts, n.id)]))
  } else {
```

with

```ts
  let shopLinks: Record<string, ShopLink> = {}
  let dbOrders: Record<string, NodeOrderStatus> = {}
  let feed: PlanFeed | null = null
  if (plan.purpose === 'tenant_layout') {
    const facts = await loadTenantShopFacts(client, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries(nodes.map((n) => [n.id, shopLinkFor(facts, n.id)]))
    // Read as the caller (RLS on cable_schedule); never throws — a failure is carried as 'unavailable'.
    feed = planFeedFrom(await loadProjectFeedGraph(client, args.projectId), nodes.map((n) => n.id))
  } else {
```

6. In the final `buildStatusPlanPageProps({ … })` call, after `requestedShapeId: args.requestedShapeId,` add:

```ts
      feed,
      colourBy: args.colourBy ?? 'status',
```

- [ ] **Step 5: The floor plan route passes `?colour=`**

In `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx`:

- change the `tenantScheduleHref` import line to `import { parseColourBy, tenantScheduleHref } from '@/lib/status-plans/plan-urls'`;
- change `searchParams` to `searchParams: Promise<{ sheet?: string; shape?: string; colour?: string }>` and its doc comment to `/** ?sheet= picks the sheet; ?shape= selects a shape (the tenant schedule's "On plan" link); ?colour=board opens "Colour by: Main board". */`;
- replace the destructure and loader call with:

```tsx
  const { sheet, shape, colour } = await searchParams
  const supabase = await createClient()
  const data = await loadTenantPlanPage(supabase, {
    projectId, purpose: 'tenant_layout', requestedSheetId: sheet ?? null, requestedShapeId: shape ?? null,
    colourBy: parseColourBy(colour),
  })
```

The page still spreads `data.props` into the workspace and adds nothing (`page-props.contract.test.ts`).

- [ ] **Step 6: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/load-plan-page.test.ts src/lib/status-plans/page-props.contract.test.ts "src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
```

Expected: PASS; type-check exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/status-plans/types.ts apps/web/src/lib/status-plans/load-plan-page.ts apps/web/src/lib/status-plans/load-plan-page.test.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx"
git commit -m "feat(tenant-plans): the floor plan page loads the feed graph and honours ?colour=board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.7: Colour by: Status | Main board — switch, legend, side panel

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.tsx` (+ `PlanLegend.test.tsx`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShapePanel.tsx` (+ `ShapePanel.test.tsx`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx` (+ `StatusPlanWorkspace.test.tsx`)

- [ ] **Step 1: Write the failing tests**

Append to `PlanLegend.test.tsx` inside `describe('PlanLegend', …)`:

```tsx
  it('board mode lists each main board with its count and measured area, then the rest', () => {
    const style = { fill: '#1F5FBF', fillOpacity: 0.45, stroke: '#1F5FBF', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }
    const rows = [
      { key: 'board:mb1', label: 'MB 1.1', style, count: 2, m2: 120 },
      { key: 'feed_unknown', label: 'Feed not in the cable schedule', style, count: 1, m2: null },
    ]
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[]} onSelectShape={vi.fn()} board={{ rows, planRows: null, revisionCode: 'Rev 2' }} />)
    expect(legendRow('MB 1.1')).toContain('120.0 m²')
    expect(legendRow('MB 1.1')!.endsWith('2')).toBe(true)
    expect(legendRow('Feed not in the cable schedule')).toBe('Feed not in the cable schedule1')
    expect(screen.queryByText('Complete')).toBeNull()
    expect(screen.getByText(/from cable schedule Rev 2/)).toBeTruthy()
  })
```

Append to `ShapePanel.test.tsx` inside `describe('ShapePanel', …)`:

```tsx
  it('board mode says which board feeds the shop and which others are as near', () => {
    const base = props()
    render(<ShapePanel {...props({ view: { ...base.view!, statusLabel: 'Fed from MB 1.1', feedAlso: ['MB 2.1'] } })} />)
    expect(screen.getByText('Fed from MB 1.1')).toBeTruthy()
    expect(screen.getByText('Also fed from MB 2.1')).toBeTruthy()
  })
```

Append to `StatusPlanWorkspace.test.tsx` inside `describe('StatusPlanWorkspace', …)`:

```tsx
  const FEED_OK = {
    state: 'ok' as const, revisionCode: 'Rev 2',
    boards: [{ id: 'mb1', name: 'MB 1.1', colour: '#1F5FBF' }],
    byNode: { n1: { boardId: 'mb1', also: [] } },
  }

  it('Colour by: Main board re-colours the legend and mirrors ?colour=board', () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed: FEED_OK })} />)
    expect(legendRow('Complete')).toBe('Complete1')
    fireEvent.click(screen.getByRole('button', { name: 'Colour by main board' }))
    expect(legendRow('MB 1.1')!.endsWith('1')).toBe(true)
    expect(screen.queryByText('Complete')).toBeNull()
    expect(String(replace.mock.calls.at(-1)![2])).toContain('colour=board')
    fireEvent.click(screen.getByRole('button', { name: 'Colour by status' }))
    expect(legendRow('Complete')).toBe('Complete1')
    expect(String(replace.mock.calls.at(-1)![2])).not.toContain('colour=')
  })

  it('opens in board mode from ?colour=board', () => {
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed: FEED_OK, initialColourBy: 'board' })} />)
    expect((screen.getByRole('button', { name: 'Colour by main board' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect(legendRow('MB 1.1')).toBeTruthy()
  })

  it('an unreadable cable schedule says so in board mode and keeps the status colours', () => {
    const feed = { state: 'unavailable' as const, reason: 'Main board view unavailable — the cable schedule could not be read.', omission: 'x' }
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed, initialColourBy: 'board' })} />)
    expect(screen.getByText(/Main board view unavailable — the cable schedule could not be read\./)).toBeTruthy()
    expect(legendRow('Complete')).toBe('Complete1')
  })

  it('a line diagram has no colour switch', () => {
    render(<StatusPlanWorkspace {...schematic()} />)
    expect(screen.queryByRole('button', { name: 'Colour by main board' })).toBeNull()
  })
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.test.tsx" "src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShapePanel.test.tsx" "src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx"
```

Expected: FAIL — `Unable to find … text "MB 1.1"`, `Unable to find … text "Also fed from MB 2.1"`, `Unable to find an accessible element with the role "button" and name "Colour by main board"`.

- [ ] **Step 3: PlanLegend renders board rows**

In `PlanLegend.tsx`:

1. Add to the imports:

```ts
import type { BoardLegendRow } from '@/lib/status-plans/board-view'
```

2. Add to `PlanLegendProps`:

```ts
  /** Board mode: these rows replace the status entries. */
  board?: { rows: BoardLegendRow[]; planRows: BoardLegendRow[] | null; revisionCode: string } | null
```

3. Change the signature to destructure `board = null` and replace the existing `<ul aria-label="Legend entries" …>…</ul>` with:

```tsx
      {board ? (
        <>
          <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {board.rows.map((r, i) => (
              <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(r.style) }} />
                <span style={{ flex: 1 }}>
                  {r.label}
                  {r.m2 !== null && <span style={{ color: 'var(--c-text-dim)' }}> · {r.m2.toFixed(1)} m²</span>}
                </span>
                <span style={mono}>{r.count}</span>
                {showPlan && <span style={{ ...mono, color: 'var(--c-text-dim)' }} title="All sheets">{board.planRows?.[i]?.count ?? 0}</span>}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--c-text-dim)' }}>
            Coloured by the main board that feeds each shop, from cable schedule {board.revisionCode}.
          </p>
        </>
      ) : (
        <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {legend.map((e) => (
            <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
              <span style={{ flex: 1 }}>{e.label}</span>
              <span style={mono}>{summary.counts[e.key] ?? 0}</span>
              {showPlan && <span style={{ ...mono, color: 'var(--c-text-dim)' }} title="All sheets">{planSummary!.counts[e.key] ?? 0}</span>}
            </li>
          ))}
        </ul>
      )}
```

- [ ] **Step 4: ShapePanel shows "Also fed from"**

In `ShapePanel.tsx`, directly after the closing `</div>` of the swatch + `view.statusLabel` row (inside the first `<div>` that holds the `<h2>`), add:

```tsx
        {view.feedAlso && view.feedAlso.length > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>Also fed from {view.feedAlso.join(', ')}</p>
        )}
```

- [ ] **Step 5: The workspace switch**

In `StatusPlanWorkspace.tsx`:

1. Add imports:

```ts
import { boardLegendRows, boardView } from '@/lib/status-plans/board-view'
```

and add `ColourBy` to the `@/lib/status-plans/types` type import.

2. After `const [requestedTool, setRequestedTool] = …` add:

```ts
  const [colourBy, setColourBy] = useState<ColourBy>(props.initialColourBy)
```

3. Replace the `?sheet=&shape=` effect with:

```ts
  // ?sheet=&shape=&colour= mirror the view without a navigation.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', tenantPlanHref(projectId, purpose, {
        sheet: sheet.id, shape: selectedId, colour: purpose === 'tenant_layout' ? colourBy : null,
      }))
    } catch {
      /* a sandboxed frame may refuse; the selection still works */
    }
  }, [projectId, purpose, sheet.id, selectedId, colourBy])
```

4. Replace the `views` memo with:

```ts
  // Board mode applies on top of the status view (spec 2026-10-13 §1). An unavailable feed keeps status colours.
  const okFeed = props.feed?.state === 'ok' ? props.feed : null
  const boardOn = purpose === 'tenant_layout' && colourBy === 'board' && okFeed !== null
  const views = useMemo(() => {
    const out: Record<string, ShapeView> = {}
    for (const s of shapes) {
      const base = resolveShapeView(s, {
        purpose, nodesById, shopLinks: props.shopLinks, dbOrders: props.dbOrders, today,
        pixelsPerMeter: scaleBySheet.get(s.sheetId) ?? null,
      })
      out[s.id] = boardOn && okFeed ? boardView(base, s.nodeId, okFeed) : base
    }
    return out
  }, [shapes, purpose, nodesById, props.shopLinks, props.dbOrders, today, scaleBySheet, boardOn, okFeed])
```

5. After the `attention` memo add:

```ts
  const boardLegend = useMemo(() => (boardOn && okFeed
    ? {
        rows: boardLegendRows(sheetShapes.map((s) => views[s.id]!), okFeed),
        planRows: boardLegendRows(shapes.map((s) => views[s.id]!), okFeed),
        revisionCode: okFeed.revisionCode,
      }
    : null), [boardOn, okFeed, sheetShapes, shapes, views])
```

6. Replace the title row (`<div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}> … </div>` holding the `<h1>`) with:

```tsx
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{PURPOSE_LABEL[purpose]}</h1>
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {sheet.label} · {sheet.fileName}{sheet.isPdf ? ` · page ${sheet.pageIndex}` : ''}
        </span>
        {purpose === 'tenant_layout' && (
          <span role="group" aria-label="Colour by" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--c-text-dim)' }}>Colour by</span>
            <button type="button" aria-label="Colour by status" aria-pressed={colourBy === 'status'} onClick={() => setColourBy('status')}>Status</button>
            <button type="button" aria-label="Colour by main board" aria-pressed={colourBy === 'board'} onClick={() => setColourBy('board')}>Main board</button>
          </span>
        )}
      </div>

      {purpose === 'tenant_layout' && colourBy === 'board' && props.feed?.state === 'unavailable' && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, borderColor: 'var(--c-amber)' }}>
          {props.feed.reason} Shops keep their status colours.
        </div>
      )}
```

7. In the `<PlanLegend … />` element add the prop `board={boardLegend}`.

- [ ] **Step 6: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans"
```

Expected: PASS (every file in `_plans`).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShapePanel.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShapePanel.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx"
git commit -m "feat(tenant-plans): Colour by Status | Main board on the floor plan, with a board legend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.8: Export sheet by main board

**Files:**
- Modify: `apps/web/src/lib/status-plans/plan-render-data.ts` (+ `plan-render-data.test.ts`)
- Modify: `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts` (+ `route.test.ts`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.tsx` (+ test)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram/page.tsx`

The button moves INTO the workspace, which knows the colour mode; the floor plan gets Export sheet too (today it renders only on the line diagram page, and the spec gives "the floor-plan Export sheet" the switch).

- [ ] **Step 1: Write the failing tests**

In `plan-render-data.test.ts`:

1. Add to the shared-package import: `FEED_UNKNOWN_STYLE, MAIN_BOARD_PALETTE, boardShapeStyle`.
2. Give `world()` extra tables. Change its parameter type to add `tables?: Record<string, any[]>`, and spread it last inside `tables: { … }`:

```ts
      'structure.node_orders': [{ id: 'o1', project_id: PROJ, node_id: 'mb', scope_item_type_id: 't-db', status: 'ordered' }],
      ...over.tables,
```

3. Append:

```ts
describe('colourBy board (floor plan by main board)', () => {
  const FEED_TABLES = {
    'cable_schedule.revisions': [{ id: 'rev-2', project_id: PROJ, code: 'Rev 2', status: 'ISSUED', issued_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' }],
    'cable_schedule.supplies': [{ id: 'sup-1', revision_id: 'rev-2', from_node_id: 'mb', to_node_id: 'n-done' }],
  }

  it('colours linked shops by feeding board, grey when unreached, and names the pages', async () => {
    const { clients } = world({
      tables: FEED_TABLES,
      shapes: [shapeRow('s1', 'a', 'a1', { node_id: 'n-done' }), shapeRow('s2', 'a', 'a1', { node_id: 'n-late' }), shapeRow('s3', 'a', 'a1', { area_type: 'common' })],
    })
    const { inputs, omitted } = await load(clients, { colourBy: 'board' })
    expect(omitted).toEqual([])
    const [s] = inputs
    expect(s!.planName).toBe('Plan a by main board (cable schedule Rev 2)')
    expect(s!.shapes[0]!.style).toEqual(boardShapeStyle(MAIN_BOARD_PALETTE[0]))
    expect(s!.shapes[1]!.style).toEqual(FEED_UNKNOWN_STYLE)
    expect(s!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    expect(s!.legend.map((e) => e.key)).toEqual(['board:mb', 'feed_unknown', 'unlinked', 'common', 'plant_room', 'services', 'vacant'])
    expect(s!.legend[0]!.label).toBe('MB-3.1 (50.0 m²)')
    expect(s!.counts).toMatchObject({ 'board:mb': 1, feed_unknown: 1, common: 1 })
  })

  it('no cable schedule: the floor plan sheet is "not included" with the reason, and no file is read', async () => {
    const { clients, st } = world({ shapes: [shapeRow('s1', 'a', 'a1', { node_id: 'n-done' })] })
    const { inputs, omitted } = await load(clients, { colourBy: 'board' })
    expect(inputs).toEqual([])
    expect(omitted).toEqual([{ title: 'Plan a by main board (Tenant floor plan, Sheet a1)', reason: 'the project has no cable schedule yet' }])
    expect(st.downloads).toEqual([])
  })

  it('status mode reads no cable schedule at all', async () => {
    const { clients, pg } = world({ tables: FEED_TABLES })
    await load(clients)
    expect(pg.calls.map((c) => c.table)).not.toContain('cable_schedule.revisions')
    expect(pg.calls.map((c) => c.table)).not.toContain('cable_schedule.supplies')
  })
})
```

(`fakeSupabase` returns `{ client, calls, rpcCalls }`; `calls[i].table` is `schema.table`.)

In `route.test.ts`, append inside the `describe`:

```ts
  it('?colour=board exports the floor plan by main board; default is status', async () => {
    await GET(new NextRequest(`http://localhost/api/projects/${PID}/status-plans/${PLAN}/sheet?sheet=${SHEET}&colour=board`), { params: Promise.resolve({ id: PID, planId: PLAN }) })
    expect(m.load.mock.calls[0]![1]).toMatchObject({ colourBy: 'board' })
    await call()
    expect(m.load.mock.calls[1]![1]).toMatchObject({ colourBy: 'status' })
  })
```

In `ExportSheetButton.test.tsx`, append inside the `describe`:

```tsx
  it('board mode asks the route for ?colour=board', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, json: () => Promise.resolve({ error: 'x' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ExportSheetButton projectId="p" planId="s" sheetId="sh1" colour="board" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p/status-plans/s/sheet?sheet=sh1&colour=board')
  })
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-render-data.test.ts "src/app/api/projects/[id]/status-plans/[planId]/sheet/route.test.ts" "src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.test.tsx"
```

Expected: FAIL — `planName` is `'Plan a'`; `colourBy` missing from the load args; the button fetches `…?sheet=sh1`.

- [ ] **Step 3: `plan-render-data.ts` learns `colourBy`**

1. Add imports:

```ts
import { loadProjectFeedGraph, planFeedFrom } from './feed-graph'
import { boardLegendEntries, boardLegendRows, boardView, type PlanFeedOk } from './board-view'
import type { CanvasShape, ColourBy, PlanNode } from './types'
```

(the last replaces the existing `import type { CanvasShape, PlanNode } from './types'`).

2. In `LoadPlanRenderArgs`, after `maxTotalBytes?: number`, add:

```ts
  /**
   * 'board' colours FLOOR PLAN sheets by the main board feeding each shop (spec 2026-10-13 §1);
   * line diagram sheets are unaffected. Default 'status'. The feed is read with clients.db (the
   * caller's session), never the service client.
   */
  colourBy?: ColourBy
```

3. After the `nodesFor` declaration, add:

```ts
  const byBoard = args.colourBy === 'board'
  let feed: PlanFeedOk | null = null
  let feedOmission = 'the cable schedule could not be read'
  if (byBoard && kept.some((r) => r.plan.purpose === 'tenant_layout')) {
    const pf = planFeedFrom(await loadProjectFeedGraph(clients.db, args.projectId), [...nodesFor.tenant_layout.keys()])
    if (pf.state === 'ok') feed = pf
    else feedOmission = pf.omission
  }
```

4. At the top of the `for (const { plan, row } of kept)` loop, replace

```ts
    const title = planTitle(plan.name, plan.purpose, row.label)
```

with

```ts
    const boardSheet = byBoard && plan.purpose === 'tenant_layout'
    const planName = !boardSheet ? plan.name
      : feed ? `${plan.name} by main board (cable schedule ${feed.revisionCode})` : `${plan.name} by main board`
    const title = planTitle(planName, plan.purpose, row.label)
    if (boardSheet && !feed) { omitted.push({ title, reason: feedOmission }); continue }
```

5. Replace

```ts
    const views = shapes.map((s) => resolveShapeView(s, ctx))
    const summary = legendSummary(views, plan.purpose)
```

with

```ts
    const base = shapes.map((s) => resolveShapeView(s, ctx))
    const f = boardSheet ? feed : null
    const views = f ? base.map((v, i) => boardView(v, shapes[i]!.nodeId, f)) : base
    const summary = legendSummary(views, plan.purpose)
    const board = f ? boardLegendEntries(boardLegendRows(views, f)) : null
```

6. In `inputs.push({ … })` change `planName: plan.name` to `planName`, and replace the `legend:` and `counts:` lines with:

```ts
      legend: board ? board.legend : plan.purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
      counts: board ? board.counts : summary.counts,
```

- [ ] **Step 4: The route reads `?colour=`**

In `route.ts`:

1. Add `import type { ColourBy } from '@/lib/status-plans/types'`.
2. After the `sheetId` check add:

```ts
  const colourBy: ColourBy = req.nextUrl.searchParams.get('colour') === 'board' ? 'board' : 'status'
```

3. Add `colourBy` to the loader args object (after `maxSourceBytes: MAX_STATUS_PLAN_SOURCE_BYTES`).
4. In the file's header comment, after the first paragraph, add the line `?colour=board exports a floor plan sheet coloured by feeding main board (the feed is read through the caller's session).`

- [ ] **Step 5: The button carries the mode and moves into the workspace**

In `ExportSheetButton.tsx`:

- add `import type { ColourBy } from '@/lib/status-plans/types'`;
- change the signature to `export function ExportSheetButton({ projectId, planId, sheetId, colour = 'status' }: { projectId: string; planId: string; sheetId: string; colour?: ColourBy })`;
- replace the `fetch(…)` line with:

```ts
      const colourParam = colour === 'board' ? '&colour=board' : ''
      const res = await fetch(`/api/projects/${projectId}/status-plans/${planId}/sheet?sheet=${encodeURIComponent(sheetId)}${colourParam}`)
```

- change the fallback file name `'line-diagram-sheet.pdf'` to `'tenant-plan-sheet.pdf'`.

In `StatusPlanWorkspace.tsx`:

- add `import { ExportSheetButton } from './ExportSheetButton'`;
- in the title row, render the button as the row's last child (after the colour group). The colour group has `marginLeft: 'auto'`; for the line diagram (no group) give the button its own wrapper:

```tsx
        <span style={purpose === 'tenant_layout' ? undefined : { marginLeft: 'auto' }}>
          <ExportSheetButton projectId={projectId} planId={plan.id} sheetId={sheet.id} colour={purpose === 'tenant_layout' ? colourBy : 'status'} />
        </span>
```

In `line-diagram/page.tsx`:

- delete `import { ExportSheetButton } from '../_plans/ExportSheetButton'`;
- replace the header `<div style={{ display: 'flex', … }}> … </div>` with just the `<Link …>← Tenant schedule</Link>` (as on the floor plan page);
- in the doc comment, replace `"Export sheet" downloads the sheet on screen at its own size.` with `"Export sheet" (in the workspace) downloads the sheet on screen at its own size.`

- [ ] **Step 6: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans "src/app/api/projects/[id]/status-plans" "src/app/(admin)/projects/[id]/tenant-schedule"
```

Expected: PASS, including `page-props.contract.test.ts` (both pages still render only `StatusPlanWorkspace` / `TenantPlanEmpty` with spread props).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-render-data.ts apps/web/src/lib/status-plans/plan-render-data.test.ts "apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts" "apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.test.ts" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram/page.tsx"
git commit -m "feat(tenant-plans): Export sheet on both tools, by main board with ?colour=board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.9: Report appendix — "Floor plan by main board"

**Files:**
- Modify: `apps/web/src/lib/status-plans/appendix-options.ts` (+ test)
- Modify: `apps/web/src/lib/status-plans/report-appendix.ts` (+ test)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx` (+ test)

- [ ] **Step 1: Write the failing tests**

In `appendix-options.test.ts`, replace the first case's four `toEqual(…)` objects with the three-key shape:

```ts
    expect(statusPlanAppendixOptions('http://x/r')).toEqual({ tenantLayout: false, schematic: false, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1')).toEqual({ tenantLayout: true, schematic: false, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1&schematicPlans=1')).toEqual({ tenantLayout: true, schematic: true, byBoard: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=true')).toEqual({ tenantLayout: false, schematic: false, byBoard: false })
```

in the second case change every literal option object to carry `byBoard: false`, and add:

```ts
  it('?boardPlans=1 adds the floor plan by main board; it round-trips', () => {
    expect(statusPlanAppendixOptions('http://x/r?boardPlans=1')).toEqual({ tenantLayout: false, schematic: false, byBoard: true })
    expect(appendixQuery({ tenantLayout: true, schematic: false, byBoard: true })).toBe('?tenantPlans=1&boardPlans=1')
    expect(appendixPurposes({ tenantLayout: false, schematic: false, byBoard: true })).toEqual([])
  })
```

In `report-appendix.test.ts`, append:

```ts
  it('?boardPlans=1 alone loads the floor plan coloured by board', async () => {
    m.load.mockResolvedValue({ inputs: [{ planId: 'b' }], omitted: [], organisationId: 'org-1' })
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?boardPlans=1' })
    expect(m.load).toHaveBeenCalledTimes(1)
    expect(m.load.mock.calls[0]![1]).toEqual({ projectId: 'p1', today: '2026-10-09', purposes: ['tenant_layout'], colourBy: 'board' })
    expect(r).toMatchObject({ ok: true, appendix: { load: { inputs: [{ planId: 'b' }] } } })
  })
  it('with the status plans too: status pages first, board pages after, omissions merged', async () => {
    m.load
      .mockResolvedValueOnce({ inputs: [{ planId: 's' }], omitted: [{ title: 'A', reason: 'x' }], organisationId: 'org-1' })
      .mockResolvedValueOnce({ inputs: [{ planId: 'b' }], omitted: [{ title: 'B', reason: 'y' }], organisationId: 'org-1' })
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?tenantPlans=1&boardPlans=1' })
    expect(m.load.mock.calls[0]![1]).toEqual({ projectId: 'p1', today: '2026-10-09', purposes: ['tenant_layout'] })
    expect(m.load.mock.calls[1]![1]).toMatchObject({ colourBy: 'board' })
    expect(r).toEqual({
      ok: true,
      appendix: {
        load: { inputs: [{ planId: 's' }, { planId: 'b' }], omitted: [{ title: 'A', reason: 'x' }, { title: 'B', reason: 'y' }], organisationId: 'org-1' },
        generatedOn: '2026-10-09',
      },
    })
  })
```

In `TenantScheduleReportButton.test.tsx`, append inside the `describe`:

```tsx
  it('"Floor plan by main board" is off by default; ticking it re-renders with ?boardPlans=1', async () => {
    const fetchMock = stubPdfFetch()
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const box = screen.getByRole('checkbox', { name: /floor plan by main board/i }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await waitFor(() => expect(box.disabled).toBe(false))
    await userEvent.click(box)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/report-preview?tenantPlans=1&boardPlans=1`)
  })
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/appendix-options.test.ts src/lib/status-plans/report-appendix.test.ts "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
```

Expected: FAIL — missing `byBoard`, `?boardPlans=1` returns `appendix: null`, no checkbox named "Floor plan by main board".

- [ ] **Step 3: The options**

Replace the body of `appendix-options.ts` after its header comment and import with:

```ts
export interface StatusPlanAppendixOptions {
  tenantLayout: boolean
  schematic: boolean
  /** "Floor plan by main board" (spec 2026-10-13 §1): extra floor plan pages, off by default. */
  byBoard: boolean
}

export function statusPlanAppendixOptions(url: string | URL): StatusPlanAppendixOptions {
  const p = new URL(url).searchParams
  return { tenantLayout: p.get('tenantPlans') === '1', schematic: p.get('schematicPlans') === '1', byBoard: p.get('boardPlans') === '1' }
}

/** The STATUS-coloured purposes. Board pages are requested separately (byBoard). */
export function appendixPurposes(o: StatusPlanAppendixOptions): StatusPlanPurpose[] {
  const out: StatusPlanPurpose[] = []
  if (o.tenantLayout) out.push('tenant_layout')
  if (o.schematic) out.push('distribution_schematic')
  return out
}

export function appendixQuery(o: StatusPlanAppendixOptions): string {
  const p = new URLSearchParams()
  if (o.tenantLayout) p.set('tenantPlans', '1')
  if (o.schematic) p.set('schematicPlans', '1')
  if (o.byBoard) p.set('boardPlans', '1')
  const s = p.toString()
  return s ? `?${s}` : ''
}
```

- [ ] **Step 4: Two loads, one appendix**

In `report-appendix.ts`, replace the body of `loadReportAppendix` with:

```ts
  const opts = statusPlanAppendixOptions(a.url)
  const purposes = appendixPurposes(opts)
  if (purposes.length === 0 && !opts.byBoard) return { ok: true, appendix: null }
  const access = await requireProjectAccess(a.sessionClient, a.projectId)
  if (!access.ok) return access
  try {
    const service = createServiceClient()
    const clients = { db: a.sessionClient, facts: service, storage: service.storage as unknown as StorageLike }
    const parts: PlanRenderLoadResult[] = []
    if (purposes.length > 0) {
      parts.push(await loadStatusPlanRenderInputs(clients, { projectId: a.projectId, today: a.today, purposes }))
    }
    // Board pages follow the status pages; same files, so they embed once in the output (keyed by path).
    if (opts.byBoard) {
      parts.push(await loadStatusPlanRenderInputs(clients, { projectId: a.projectId, today: a.today, purposes: ['tenant_layout'], colourBy: 'board' }))
    }
    const load: PlanRenderLoadResult = {
      inputs: parts.flatMap((p) => p.inputs),
      omitted: parts.flatMap((p) => p.omitted),
    }
    const organisationId = parts.find((p) => p.organisationId)?.organisationId
    if (organisationId) load.organisationId = organisationId
    return { ok: true, appendix: { load, generatedOn: a.today } }
  } catch (err) {
    console.error('[status-plans] report appendix could not be loaded', err)
    return {
      ok: true,
      appendix: {
        load: { inputs: [], omitted: [{ title: 'Tenant plans', reason: 'the plans could not be loaded — generate the report again' }] },
        generatedOn: a.today,
      },
    }
  }
```

- [ ] **Step 5: The dialog checkbox**

In `TenantScheduleReportButton.tsx`:

- change the initial state to `useState<StatusPlanAppendixOptions>({ tenantLayout: true, schematic: false, byBoard: false })` and extend its comment with `; "Floor plan by main board" OFF (spec 2026-10-13 §1).`;
- after the "Line diagram" `<label>…</label>` add:

```tsx
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--c-text-mid)' }}>
                <input type="checkbox" checked={plans.byBoard} onChange={() => togglePlans('byBoard')} disabled={loading || saving} />
                Floor plan by main board
              </label>
```

- [ ] **Step 6: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans "src/app/(admin)/projects/[id]/tenant-schedule/_components" "src/app/api/projects/[id]/tenant-schedule"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/status-plans/appendix-options.ts apps/web/src/lib/status-plans/appendix-options.test.ts apps/web/src/lib/status-plans/report-appendix.ts apps/web/src/lib/status-plans/report-appendix.test.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
git commit -m "feat(tenant-plans): report appendix option 'Floor plan by main board' (?boardPlans=1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1.10: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Edit the rows**

1. In the row starting `| \`GET /api/projects/[id]/tenant-schedule/report-preview\``, replace `(\`?tenantPlans=1\` / \`?schematicPlans=1\` append the status plans — spec 2026-10-09 §8)` with `(\`?tenantPlans=1\` / \`?schematicPlans=1\` append the status plans — spec 2026-10-09 §8; \`?boardPlans=1\` appends the floor plan coloured by feeding main board — spec 2026-10-13 §1)`.
2. In the row starting `| \`GET /api/projects/[id]/status-plans/[planId]/sheet?sheet=\``, replace `else 404)` with `else 404; \`?colour=board\` colours a floor plan sheet by feeding main board)`.
3. Replace the bullet `> - **Export sheet.** Gated by … The button renders on the line diagram only; the route serves floor plan sheets too.` with:

```markdown
> - **Export sheet.** Gated by `requireProjectAccess` alone (checked with `.ok`), the same set that can open the plan page. The button renders on both tools (inside the workspace, so it follows the floor plan's colour switch). **Main board mode** (`?colour=board` on the floor plan page, the Export sheet route and `?boardPlans=1` on the report routes) reads `cable_schedule.revisions` / `supplies` and the project's main boards through the **caller's session**, so RLS and `site_scope` on `cable_schedule` decide what a role sees; a role that cannot read the schedule gets "Main board view unavailable" on screen and a "not included" line in a PDF, never a plan of grey shops. No new route, action or table.
```

- [ ] **Step 2: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): main board mode on tenant plans reads the cable schedule as the caller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2 — Show on drawing

### Task 2.1: `fitToBox` in the viewport maths

**Files:**
- Modify: `apps/web/src/lib/sheet/viewport-math.ts`
- Modify: `apps/web/src/lib/sheet/viewport-math.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `viewport-math.test.ts`:

```ts
import { fitToBox, MIN_SCALE } from './viewport-math'

describe('fitToBox', () => {
  const vp = { w: 800, h: 600 }
  const centreOnScreen = (t: { scale: number; offset: { x: number; y: number } }, box: { minX: number; minY: number; maxX: number; maxY: number }) => ({
    x: t.offset.x + ((box.minX + box.maxX) / 2) * t.scale,
    y: t.offset.y + ((box.minY + box.maxY) / 2) * t.scale,
  })

  it('the box fills 60 % of the limiting side and sits in the middle of the view', () => {
    const box = { minX: 1000, minY: 2000, maxX: 1200, maxY: 2100 } // 200 × 100: width limits (800/200 < 600/100)
    const t = fitToBox(vp, box)!
    expect(t.scale).toBeCloseTo((800 / 200) * 0.6, 9)
    const c = centreOnScreen(t, box)
    expect(c.x).toBeCloseTo(400, 6)
    expect(c.y).toBeCloseTo(300, 6)
  })

  it('a box at the sheet\'s edge is still centred (the sheet may slide off-screen)', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const t = fitToBox(vp, box)!
    const c = centreOnScreen(t, box)
    expect(c.x).toBeCloseTo(400, 6)
    expect(c.y).toBeCloseTo(300, 6)
    expect(t.offset.x).toBeGreaterThan(0)
  })

  it('a tiny box is clamped to MAX_SCALE, a huge one to MIN_SCALE; fill is honoured', () => {
    expect(fitToBox(vp, { minX: 10, minY: 10, maxX: 10.5, maxY: 10.5 })!.scale).toBe(MAX_SCALE)
    expect(fitToBox(vp, { minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 })!.scale).toBe(MIN_SCALE)
    expect(fitToBox(vp, { minX: 0, minY: 0, maxX: 800, maxY: 600 }, 1)!.scale).toBeCloseTo(1, 9)
  })

  it('a zero-size box (a point) does not divide by zero', () => {
    expect(fitToBox(vp, { minX: 5, minY: 5, maxX: 5, maxY: 5 })!.scale).toBe(MAX_SCALE)
  })

  it('refuses an unlaid-out view and a box that is not finite', () => {
    expect(fitToBox({ w: 0, h: 0 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBeNull()
    expect(fitToBox(vp, { minX: Infinity, minY: 0, maxX: -Infinity, maxY: 1 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/sheet/viewport-math.test.ts
```

Expected: FAIL, `fitToBox is not a function`.

- [ ] **Step 3: Write `fitToBox`**

In `viewport-math.ts`, after `fitTransform`, add:

```ts
/** An axis-aligned box in image space (structurally the same as @esite/shared's status-plan Box). */
export interface ViewBox { minX: number; minY: number; maxX: number; maxY: number }

/**
 * "Show on drawing": zoom so `box` fills `fill` of the view's limiting side, centred.
 * Clamped to [MIN_SCALE, MAX_SCALE]; a box smaller than 1 px counts as 1 px. Null when
 * the view is not laid out or the box is not finite (e.g. boundingBox of no points).
 */
export function fitToBox(viewport: { w: number; h: number }, box: ViewBox, fill = 0.6): Transform | null {
  if (viewport.w < 50 || viewport.h < 50) return null
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return null
  const bw = Math.max(1, box.maxX - box.minX)
  const bh = Math.max(1, box.maxY - box.minY)
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(viewport.w / bw, viewport.h / bh) * fill))
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return { scale, offset: { x: viewport.w / 2 - cx * scale, y: viewport.h / 2 - cy * scale } }
}
```

- [ ] **Step 4: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/sheet/viewport-math.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sheet/viewport-math.ts apps/web/src/lib/sheet/viewport-math.test.ts
git commit -m "feat(sheet): fitToBox zooms a sheet canvas onto a box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Pulse timing

**Files:**
- Create: `apps/web/src/lib/status-plans/focus.ts`
- Create: `apps/web/src/lib/status-plans/focus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/status-plans/focus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FOCUS_BLINK_MS, FOCUS_FILL, FOCUS_PULSE_MS, pulseVisible } from './focus'

describe('pulseVisible', () => {
  it('blinks on/off every FOCUS_BLINK_MS for FOCUS_PULSE_MS, starting on', () => {
    expect(FOCUS_PULSE_MS).toBe(2000)
    expect(FOCUS_FILL).toBe(0.6)
    expect(pulseVisible(0)).toBe(true)
    expect(pulseVisible(FOCUS_BLINK_MS - 1)).toBe(true)
    expect(pulseVisible(FOCUS_BLINK_MS)).toBe(false)
    expect(pulseVisible(2 * FOCUS_BLINK_MS)).toBe(true)
  })
  it('is off after the pulse and for nonsense', () => {
    expect(pulseVisible(FOCUS_PULSE_MS)).toBe(false)
    expect(pulseVisible(-1)).toBe(false)
    expect(pulseVisible(Number.NaN)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/focus.test.ts
```

Expected: FAIL, `Failed to resolve import "./focus"`.

- [ ] **Step 3: Write it**

Create `apps/web/src/lib/status-plans/focus.ts`:

```ts
/**
 * "Show on drawing" (spec 2026-10-13 §2): the canvas zooms so a box fills ~60 % of the
 * view, then blinks an outline round it for 2 s. Pure timing, so the rule is testable
 * without Konva.
 */
export const FOCUS_FILL = 0.6
export const FOCUS_PULSE_MS = 2000
export const FOCUS_BLINK_MS = 250
/** How often the canvas re-renders while a pulse runs. */
export const FOCUS_TICK_MS = 125
/** The selection blue: a pulse reads as "this one". */
export const FOCUS_COLOUR = '#2563EB'

export function pulseVisible(elapsedMs: number): boolean {
  if (!(elapsedMs >= 0) || elapsedMs >= FOCUS_PULSE_MS) return false
  return Math.floor(elapsedMs / FOCUS_BLINK_MS) % 2 === 0
}
```

- [ ] **Step 4: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/focus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/focus.ts apps/web/src/lib/status-plans/focus.test.ts
git commit -m "feat(tenant-plans): pulse timing for Show on drawing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.3: The viewport hook and the canvas take a focus

**Files:**
- Modify: `apps/web/src/lib/sheet/use-sheet-viewport.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanCanvas.tsx`

Konva canvases have no component tests in this repo (stated gap since PR #190); the maths is covered by Tasks 2.1 and 2.2 and the wiring by Task 2.4's workspace test through the canvas stub. `tsc` and `next build` cover the rest.

- [ ] **Step 1: `useSheetViewport` exposes `fitToBox`**

In `use-sheet-viewport.ts`:

- change the import to `import { DEFAULT_FIT_KEYS, fitToBox, fitTransform, viewportKeyAction, zoomAbout, type ViewBox } from './viewport-math'`;
- after the `fitToView` callback add:

```ts
  /** "Show": zoom so `box` (image space) fills `fill` of the view, centred. A no-op until laid out. */
  const fitToBoxView = useCallback((box: ViewBox, fill?: number) => {
    const t = fitToBox(viewport, box, fill)
    if (!t) return
    scaleRef.current = t.scale
    offsetRef.current = t.offset
    setScale(t.scale)
    setOffset(t.offset)
  }, [viewport])
```

- add `fitToBox: fitToBoxView,` to the returned object after `fitToView,`.

- [ ] **Step 2: The canvas `focus` prop**

In `StatusPlanCanvas.tsx`:

1. Change the shared import to add the `Box` type: `import { hatchSegments, pointsError, rectToPoints, visualCentre, type Box, type StatusPlanPurpose } from '@esite/shared/status-plans'`.
2. Add `import { FOCUS_COLOUR, FOCUS_FILL, FOCUS_PULSE_MS, FOCUS_TICK_MS, pulseVisible } from '@/lib/status-plans/focus'`.
3. In `StatusPlanCanvasProps`, after `requestedTool`, add:

```ts
  /** "Show": zoom so this box fills ~60 % of the view and blink it for 2 s. A new nonce re-triggers the same box. */
  focus?: { box: Box; nonce: number } | null
```

4. After the `requestedTool` effect, add:

```ts
  // ── Show on drawing ─────────────────────────────────────────────────────────
  // Runs after the viewport hook's first-load auto-fit (declared earlier, so its effect
  // runs first in the same commit): a Show that arrives with the image wins.
  const [pulse, setPulse] = useState<{ box: Box; started: number } | null>(null)
  const [pulseNow, setPulseNow] = useState(0)
  useEffect(() => {
    const f = p.focus
    if (!f || !img) return
    vp.fitToBox(f.box, FOCUS_FILL)
    const t = Date.now()
    setPulse({ box: f.box, started: t })
    setPulseNow(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus?.nonce, img])
  useEffect(() => {
    if (!pulse) return
    const id = setInterval(() => {
      const t = Date.now()
      if (t - pulse.started >= FOCUS_PULSE_MS) { setPulse(null); return }
      setPulseNow(t)
    }, FOCUS_TICK_MS)
    return () => clearInterval(id)
  }, [pulse])
  const pulseShown = pulse !== null && pulseVisible(pulseNow - pulse.started)
```

5. In the non-listening overlay `<Layer listening={false}>` that draws labels, directly after the `{selected && (<Line … SELECT_COLOUR … />)}` element, add:

```tsx
              {pulseShown && pulse && (
                <Line
                  points={rectToPoints(pulse.box.minX, pulse.box.minY, pulse.box.maxX, pulse.box.maxY)}
                  closed
                  stroke={FOCUS_COLOUR}
                  strokeWidth={4 / scale}
                  dash={[10 / scale, 6 / scale]}
                />
              )}
```

- [ ] **Step 3: Type-check and lint**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
```

Expected: both exit 0. (The cable-route `RouteCanvas` also calls `useSheetViewport`; it gains an unused `fitToBox` and needs no change.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/sheet/use-sheet-viewport.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanCanvas.tsx"
git commit -m "feat(tenant-plans): the status plan canvas zooms to and blinks a focus box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2.4: Show buttons — Detect blocks review and Needs attention

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.tsx` (+ test)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx` (+ test)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/DetectBlocksPanel.test.tsx`

`DetectBlocksPanel` already renders a **Show** button on every Matched / Need you / Without a tag row when it is given `onFocus`; the workspace never passed it. This task wires it and adds Show to Needs attention.

- [ ] **Step 1: Write the failing tests**

Append to `DetectBlocksPanel.test.tsx` inside `describe('DetectBlocksPanel', …)`:

```tsx
  it('every reviewable row has Show, which hands the block\'s box to onFocus', async () => {
    const onFocus = vi.fn()
    render(<DetectBlocksPanel {...props({ onFocus })} />)
    await detect()
    for (const label of ['DB-71', 'DB-90/91', 'FOXTROT']) {
      expect(screen.getByRole('button', { name: `Show ${label} on the drawing` })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Show DB-71 on the drawing' }))
    const box = onFocus.mock.calls[0]![0] as { minX: number; minY: number; maxX: number; maxY: number }
    expect(box.minX).toBeLessThanOrEqual(100)
    expect(box.maxX).toBeGreaterThan(100)
    expect(box.minY).toBeLessThanOrEqual(100)
    expect(box.maxY).toBeGreaterThan(100)
  })

  it('without onFocus there is no Show button', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull()
  })
```

Append to `PlanLegend.test.tsx` inside `describe('PlanLegend', …)`:

```tsx
  it('needs-attention rows have Show, which zooms to the shape', () => {
    const onShowShape = vi.fn()
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[{ shapeId: 's9', label: 'ZZ09', reason: 'Area differs' }]} onSelectShape={vi.fn()} onShowShape={onShowShape} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show ZZ09 on the drawing' }))
    expect(onShowShape).toHaveBeenCalledWith('s9')
  })
```

In `StatusPlanWorkspace.test.tsx`:

1. Extend the `next/dynamic` stub's props type with `focus: { box: { minX: number; minY: number; maxX: number; maxY: number }; nonce: number } | null` and add to its rendered text, after `page:{props.pageIndex}`:

```tsx
      {' '}focus:{props.focus ? `${props.focus.box.minX},${props.focus.box.minY},${props.focus.box.maxX},${props.focus.box.maxY}#${props.focus.nonce}` : 'none'}
```

2. Append inside `describe('StatusPlanWorkspace', …)`:

```tsx
  it('Show on a needs-attention row selects the shape and focuses its box; Show again re-triggers', () => {
    // A link to a board that is not live: "needs attention".
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'gone' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned on the drawing' }))
    expect(canvasText()).toContain('selected:s1')
    expect(canvasText()).toContain('focus:100,100,300,260#1')
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned on the drawing' }))
    expect(canvasText()).toContain('focus:100,100,300,260#2')
  })
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans"
```

Expected: the DetectBlocksPanel cases PASS already (the panel had Show; these pin it); the PlanLegend and workspace cases FAIL (`Unable to find … "Show ZZ09 on the drawing"`, `focus:none`).

- [ ] **Step 3: PlanLegend gets Show**

In `PlanLegend.tsx`:

- add to `PlanLegendProps`: `/** "Show": zoom the canvas to the shape and select it. */ onShowShape?: (shapeId: string) => void`;
- destructure `onShowShape` in the signature;
- replace the attention `<li>` body with:

```tsx
              <li key={a.shapeId} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <button type="button" onClick={() => onSelectShape(a.shapeId)} style={{ flex: 1, textAlign: 'left', fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                  <strong>{a.label}</strong> — {a.reason}
                </button>
                {onShowShape && (
                  <button type="button" onClick={() => onShowShape(a.shapeId)} aria-label={`Show ${a.label} on the drawing`} style={{ fontSize: 11 }}>Show</button>
                )}
              </li>
```

- [ ] **Step 4: The workspace wires both**

In `StatusPlanWorkspace.tsx`:

1. Change the shared import to `import { PURPOSE_LABEL, boundingBox, type AreaType, type Box } from '@esite/shared/status-plans'`.
2. After the `onSelect` callback, add:

```ts
  // ── Show on drawing (spec 2026-10-13 §2) ─────────────────────────────────
  const focusSeq = useRef(0)
  const [focus, setFocus] = useState<{ box: Box; nonce: number } | null>(null)
  const showBox = useCallback((box: Box) => {
    focusSeq.current += 1
    setFocus({ box, nonce: focusSeq.current })
  }, [])
  const showShape = useCallback((shapeId: string) => {
    onSelect(shapeId)
    const s = shapesRef.current.find((x) => x.id === shapeId)
    if (s && s.points.length >= 6) showBox(boundingBox(s.points))
  }, [onSelect, showBox])
```

3. In `schematicSlot`'s `<DetectBlocksPanel … />` add `onFocus={showBox}`.
4. On `<StatusPlanCanvas … />` add `focus={focus}`.
5. On `<PlanLegend … />` add `onShowShape={showShape}`.

- [ ] **Step 5: Run the tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
```

Expected: PASS; exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/PlanLegend.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/DetectBlocksPanel.test.tsx"
git commit -m "feat(tenant-plans): Show on drawing from Detect blocks and Needs attention

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 3 — PDF annotations survive exports

**Why:** `use-sheet-image.ts` calls `page.render({ canvasContext, viewport, canvas })` with pdf.js 5.7.284's default `annotationMode = AnnotationMode.ENABLE`, which paints every viewable annotation's appearance stream onto the canvas (Bluebeam markups, stamps, clouds — and, with `renderForms` false, form-field widgets too). `render-plan-page.ts` embeds the page with pdf-lib's `embedPage`, which copies only the page's content and resources: every annotation is silently lost and the PDF disagrees with the screen.

**Design:** after the donor page is copied (`copier.copy(srcPage.node)` — this already copies `/Annots` and their appearance streams into the output document; `pruneUnreachableObjects` currently drops them), read its `/Annots`, keep each drawn annotation's chosen normal appearance stream, and paint it as a form XObject at the PDF 32000 §12.5.5 matrix, inside the same page placement matrix and clipped to the page box. Referencing the stream from the output page keeps it (and its own resources) through the prune; everything else stays unreachable and is pruned as before. The once-per-document embed cache keys on (file, page), so annotations are cached with their page.

### Task 3.1: Baseline — a page without annotations is byte-identical (BEFORE any renderer change)

**Files:**
- Create: `apps/web/src/lib/status-plans/render-plan-page.baseline.test.ts`

pdf-lib names resources from a per-document seeded RNG (`SimpleRNG.withSeed(1)`), so its output is deterministic except for the creation and modification dates; freezing `Date` makes `renderStatusPlanPdf` byte-stable.

- [ ] **Step 1: Write the test with placeholder hashes**

Create `apps/web/src/lib/status-plans/render-plan-page.baseline.test.ts`:

```ts
// @vitest-environment node
/**
 * REGRESSION: a drawing page with no /Annots must render byte-identically before and
 * after annotation flattening (spec 2026-10-13 §3). The hashes below were captured by
 * running this file on the renderer as it stood BEFORE Phase 3 (Task 3.1). pdf-lib's
 * resource names come from a per-document seeded RNG, so with Date frozen the output is
 * deterministic.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, type ShapeStyle } from '@esite/shared/status-plans'
import { renderStatusPlanPdf, type StatusPlanRenderInput } from './render-plan-page'

const BASELINE: Record<string, string> = {
  'source:0': 'fill-me', 'source:90': 'fill-me', 'source:180': 'fill-me', 'source:270': 'fill-me',
  'a3:0': 'fill-me', 'a3:90': 'fill-me', 'a3:180': 'fill-me', 'a3:270': 'fill-me',
}

const PLAIN: ShapeStyle = { fill: '#2E9E4F', fillOpacity: 0.45, stroke: '#2E9E4F', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }

async function plainSource(r: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([600, 400])
  p.setRotation(degrees(r))
  p.drawRectangle({ x: 500, y: 300, width: 10, height: 10, color: rgb(0, 0, 1) })
  return d.save()
}

function input(bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: 'p1', sheetId: 'sh1', planName: 'Baseline plan', sheetLabel: 'Sheet 1 of 1', purpose: 'tenant_layout',
    drawingName: 'baseline.pdf', pageIndex: 1, generatedOn: '2026-10-13', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [{ points: [100, 100, 300, 100, 300, 300, 100, 300], style: PLAIN, labelLines: ['L01', 'Shop'], invalid: false }],
    legend: TENANT_LEGEND, counts: { complete: 1 }, measured: { totalM2: 50, unmeasured: 0 }, warnings: [],
  }
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('a page with no annotations renders exactly as before', () => {
  it('source and A3 layouts, all four rotations', async () => {
    const actual: Record<string, string> = {}
    for (const layout of ['source', 'a3'] as const) {
      for (const r of [0, 90, 180, 270]) {
        actual[`${layout}:${r}`] = sha(await renderStatusPlanPdf(input(await plainSource(r)), layout))
      }
    }
    expect(actual).toEqual(BASELINE)
  })
})
```

- [ ] **Step 2: Capture the hashes on the UNCHANGED renderer**

```bash
git diff --quiet origin/main -- apps/web/src/lib/status-plans/render-plan-page.ts && echo "renderer unchanged"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.baseline.test.ts
```

Expected: `renderer unchanged`, then FAIL with a diff listing eight received sha-256 values. Copy each received value into `BASELINE` in place of `'fill-me'`.

- [ ] **Step 3: Prove the capture is stable**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.baseline.test.ts
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.baseline.test.ts
```

Expected: PASS twice. If the second run differs from the first, something else in the output is non-deterministic: STOP and find it (do not loosen the test into a normalised comparison without saying so in the PR).

- [ ] **Step 4: Commit (before touching the renderer)**

```bash
git add apps/web/src/lib/status-plans/render-plan-page.baseline.test.ts
git commit -m "test(tenant-plans): pin the plan PDF bytes for pages without annotations

Captured on the renderer before annotation flattening; must stay green after.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Pure helpers — which annotations draw, which appearance, which matrix

**Files:**
- Create: `apps/web/src/lib/status-plans/annotation-appearance.ts`
- Create: `apps/web/src/lib/status-plans/annotation-appearance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/status-plans/annotation-appearance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ANNOT_FLAG, annotationDrawn, appearanceMatrix, normaliseRect, pickAppearance, transformBox, type Mat,
} from './annotation-appearance'

const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

describe('annotationDrawn (mirrors pdf.js 5.7 default display)', () => {
  it('draws ordinary markups (Square, Ink, FreeText, Stamp…)', () => {
    for (const t of ['Square', 'Circle', 'Ink', 'FreeText', 'Stamp', 'Polygon', 'PolyLine', 'Line', null]) {
      expect(annotationDrawn(t, 4), String(t)).toBe(true)
    }
  })
  it('never draws Popup or Link', () => {
    expect(annotationDrawn('Popup', 4)).toBe(false)
    expect(annotationDrawn('Link', 0)).toBe(false)
  })
  it('skips Hidden (bit 2) and NoView (bit 6) for everything, Widgets included', () => {
    expect(annotationDrawn('Square', ANNOT_FLAG.hidden)).toBe(false)
    expect(annotationDrawn('Square', ANNOT_FLAG.noView | 4)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.hidden)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.noView)).toBe(false)
  })
  it('Invisible (bit 1) hides a markup but not a Widget, exactly as pdf.js does', () => {
    expect(annotationDrawn('Square', ANNOT_FLAG.invisible)).toBe(false)
    expect(annotationDrawn('Widget', ANNOT_FLAG.invisible)).toBe(true)
  })
})

describe('pickAppearance', () => {
  const states = new Map([['On', 'ON'], ['Off', 'OFF']])
  it('a single stream is used whatever /AS says', () => {
    expect(pickAppearance({ kind: 'stream', stream: 'S' }, null)).toBe('S')
    expect(pickAppearance({ kind: 'stream', stream: 'S' }, 'Off')).toBe('S')
  })
  it('a dictionary of states picks /AS; a missing or unknown /AS draws nothing', () => {
    expect(pickAppearance({ kind: 'states', states }, 'Off')).toBe('OFF')
    expect(pickAppearance({ kind: 'states', states }, null)).toBeNull()
    expect(pickAppearance({ kind: 'states', states }, 'Maybe')).toBeNull()
    expect(pickAppearance(null, 'On')).toBeNull()
  })
})

describe('transformBox and normaliseRect', () => {
  it('normalises a reversed rectangle', () => {
    expect(normaliseRect([200, 240, 100, 200])).toEqual([100, 200, 200, 240])
  })
  it('bounds the four transformed corners', () => {
    expect(transformBox([0, 0, 50, 20], [0, 1, -1, 0, 20, 0])).toEqual([0, 0, 20, 50])
  })
})

describe('appearanceMatrix (PDF 32000 §12.5.5)', () => {
  it('identity Matrix: scale the BBox onto the Rect', () => {
    expect(appearanceMatrix([100, 200, 200, 240], [0, 0, 50, 20], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 100, 200])
  })
  it('a BBox that does not start at the origin', () => {
    expect(appearanceMatrix([0, 0, 100, 40], [10, 10, 60, 30], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, -20, -20])
  })
  it('a rotated Matrix: the transformed BBox corners land on the Rect corners', () => {
    const M: Mat = [0, 1, -1, 0, 20, 0]
    const A = appearanceMatrix([100, 200, 140, 300], [0, 0, 50, 20], M)
    const [x0, y0] = apply(A, ...apply(M, 0, 20))
    const [x1, y1] = apply(A, ...apply(M, 50, 0))
    expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([100, 200, 140, 300])
  })
  it('a reversed Rect is normalised first', () => {
    expect(appearanceMatrix([200, 240, 100, 200], [0, 0, 50, 20], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 100, 200])
  })
  it('a degenerate BBox is placed at the Rect\'s corner unscaled (as pdf.js does)', () => {
    expect(appearanceMatrix([100, 200, 200, 240], [0, 0, 0, 20], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 100, 200])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/annotation-appearance.test.ts
```

Expected: FAIL, `Failed to resolve import "./annotation-appearance"`.

- [ ] **Step 3: Write the helpers**

Create `apps/web/src/lib/status-plans/annotation-appearance.ts`:

```ts
/**
 * Which PDF annotations a plan PDF flattens, which appearance it uses, and where it goes
 * (spec 2026-10-13 §3). Pure — no pdf-lib — so every rule is testable on numbers.
 *
 * The rules mirror what the canvas shows: pdf.js 5.7.284's page.render() with its default
 * annotationMode (ENABLE, renderForms false) paints an annotation's normal appearance
 * when it is viewable — not Hidden, not NoView, and (except form-field Widgets) not
 * Invisible. Popup and Link annotations are never painted.
 *
 * The matrix is PDF 32000-1:2008 §12.5.5, as pdf.js implements it (getTransformMatrix):
 * transform the appearance's BBox by its Matrix, take the bounds, and map them onto the
 * annotation's Rect with a scale + translate. Painting the form with `Do` applies its own
 * Matrix, so the caller concatenates only this result.
 */

/** PDF `cm` order: X = a·x + c·y + e, Y = b·x + d·y + f. */
export type Mat = readonly [number, number, number, number, number, number]
export type Quad = readonly [number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** Annotation flags (PDF 32000 Table 165): bit 1 Invisible, bit 2 Hidden, bit 6 NoView. */
export const ANNOT_FLAG = { invisible: 1, hidden: 2, noView: 32 } as const

export function annotationDrawn(subtype: string | null, flags: number): boolean {
  if (subtype === 'Popup' || subtype === 'Link') return false
  if (flags & (ANNOT_FLAG.hidden | ANNOT_FLAG.noView)) return false
  if (subtype !== 'Widget' && flags & ANNOT_FLAG.invisible) return false
  return true
}

export type ApNormal<T> =
  | { kind: 'stream'; stream: T }
  | { kind: 'states'; states: ReadonlyMap<string, T> }
  | null

/** /AP /N: a stream as-is; a dictionary of states → the /AS entry, or nothing (as pdf.js). */
export function pickAppearance<T>(n: ApNormal<T>, as: string | null): T | null {
  if (!n) return null
  if (n.kind === 'stream') return n.stream
  if (as === null) return null
  return n.states.get(as) ?? null
}

export function normaliseRect(r: Quad): [number, number, number, number] {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
}

/** Axis-aligned bounds of a box after a matrix. */
export function transformBox(box: Quad, m: Mat): [number, number, number, number] {
  const pts: Array<[number, number]> = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
  const xs = pts.map(([x, y]) => m[0] * x + m[2] * y + m[4])
  const ys = pts.map(([x, y]) => m[1] * x + m[3] * y + m[5])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** §12.5.5 matrix A: the appearance's transformed BBox → the annotation's Rect. */
export function appearanceMatrix(rect: Quad, bbox: Quad, matrix: Mat): Mat {
  const [rx0, ry0, rx1, ry1] = normaliseRect(rect)
  const [bx0, by0, bx1, by1] = transformBox(bbox, matrix)
  if (bx0 === bx1 || by0 === by1) return [1, 0, 0, 1, rx0, ry0]
  const sx = (rx1 - rx0) / (bx1 - bx0)
  const sy = (ry1 - ry0) / (by1 - by0)
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy]
}
```

- [ ] **Step 4: Run the test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/annotation-appearance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/annotation-appearance.ts apps/web/src/lib/status-plans/annotation-appearance.test.ts
git commit -m "feat(tenant-plans): pure annotation rules and the §12.5.5 appearance matrix

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3.3: Flatten annotations into the embedded page

**Files:**
- Create: `apps/web/src/lib/status-plans/annotation-flatten.ts`
- Create: `apps/web/src/lib/status-plans/annotation-flatten.test.ts`
- Modify: `apps/web/src/lib/status-plans/render-plan-page.ts`

- [ ] **Step 1: Write the failing byte tests**

Create `apps/web/src/lib/status-plans/annotation-flatten.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  PDFDocument, PDFName, degrees, fill, rectangle, rgb, setFillingRgbColor,
} from 'pdf-lib'
import { TENANT_LEGEND } from '@esite/shared/status-plans'
import { pdfStreams, pdfAllText, cmBeforeDo, near } from '@/test/pdf-ops'
import { renderStatusPlanPdf, type StatusPlanRenderInput } from './render-plan-page'

type RGB = [number, number, number]
interface AnnotSpec {
  subtype?: string
  flags?: number
  rect: [number, number, number, number]
  bbox?: [number, number, number, number]
  matrix?: [number, number, number, number, number, number]
  colour?: RGB
  states?: { as: string; on: RGB; off: RGB }
  noAp?: boolean
}

const MARK: RGB = [0.11, 0.22, 0.33]
const ON: RGB = [0.44, 0.55, 0.66]
const OFF: RGB = [0.77, 0.88, 0.99]
const op = (c: RGB) => `${c[0]} ${c[1]} ${c[2]} rg`

/** A 600×400 drawing at /Rotate r with annotations whose appearance fills its BBox in a marker colour. */
async function annotatedPdf(r: number, specs: AnnotSpec[]): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([600, 400])
  p.setRotation(degrees(r))
  p.drawRectangle({ x: 500, y: 300, width: 10, height: 10, color: rgb(0, 0, 1) })
  const ctx = d.context
  const ap = (c: RGB, bbox: number[], matrix: number[]) => ctx.register(ctx.formXObject(
    [setFillingRgbColor(c[0], c[1], c[2]), rectangle(bbox[0]!, bbox[1]!, bbox[2]! - bbox[0]!, bbox[3]! - bbox[1]!), fill()],
    { BBox: bbox, Matrix: matrix },
  ))
  const refs = specs.map((s) => {
    const bbox = s.bbox ?? [0, 0, 50, 20]
    const matrix = s.matrix ?? [1, 0, 0, 1, 0, 0]
    const dict: Record<string, unknown> = { Type: 'Annot', Subtype: s.subtype ?? 'Square', Rect: s.rect, F: s.flags ?? 4 }
    if (s.states) {
      dict.AP = { N: { On: ap(s.states.on, bbox, matrix), Off: ap(s.states.off, bbox, matrix) } }
      dict.AS = s.states.as
    } else if (!s.noAp) {
      dict.AP = { N: ap(s.colour ?? MARK, bbox, matrix) }
    }
    return ctx.register(ctx.obj(dict as never))
  })
  p.node.set(PDFName.of('Annots'), ctx.obj(refs))
  return d.save()
}

function input(bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: 'p1', sheetId: 'sh1', planName: 'Annotated', sheetLabel: 'Sheet 1', purpose: 'tenant_layout', drawingName: 'a.pdf',
    pageIndex: 1, generatedOn: '2026-10-13', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [], legend: TENANT_LEGEND, counts: {}, measured: null, warnings: [],
  }
}

function pageStream(bytes: Uint8Array): string {
  const s = pdfStreams(bytes).find((t) => /\/SP[^\s/]*\s+Do/.test(t))
  if (!s) throw new Error('no page content stream drawing the sheet')
  return s
}

/** The `cm` operands between the `q` that opens each annotation group and its `/SA… Do`, in order. */
function annotationGroups(stream: string): number[][][] {
  const lines = stream.split('\n').map((l) => l.trim())
  const out: number[][][] = []
  lines.forEach((l, i) => {
    if (!/^\/SA[^\s/]*\s+Do$/.test(l)) return
    let j = i
    while (j >= 0 && lines[j] !== 'q') j--
    out.push(lines.slice(j, i).filter((x) => /\scm$/.test(x)).map((x) => x.split(/\s+/).slice(0, 6).map(Number)))
  })
  return out
}

const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]
/** Innermost cm first (PDF: the last `cm` applies first), as Do would see it after the form's own Matrix. */
const through = (cms: number[][], x: number, y: number) => cms.slice().reverse().reduce<[number, number]>(([px, py], m) => apply(m, px, py), [x, y])
const has = (bytes: Uint8Array, c: RGB) => pdfStreams(bytes).some((s) => s.includes(op(c)))

describe('annotation appearances are flattened into the plan PDF', () => {
  it.each([0, 90, 180, 270])('/Rotate %i: an identity-Matrix appearance lands on its Rect, through the page placement', async (r) => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(r, [{ rect: [100, 200, 200, 240] }])), 'source')
    const stream = pageStream(out)
    const [page] = cmBeforeDo(stream, 'SP')
    const groups = annotationGroups(stream)
    expect(groups).toHaveLength(1)
    // Corners of the BBox (0,0)…(50,20) must land where the Rect corners (100,200)…(200,240) do on the page.
    const [a0, a1] = through(groups[0]!, 0, 0)
    const [b0, b1] = through(groups[0]!, 50, 20)
    const [e0, e1] = apply(page!, 100, 200)
    const [f0, f1] = apply(page!, 200, 240)
    expect([near(a0, e0), near(a1, e1), near(b0, f0), near(b1, f1)]).toEqual([true, true, true, true])
    expect(has(out, MARK)).toBe(true)
  })

  it.each([0, 90, 180, 270])('/Rotate %i: a rotated appearance Matrix is honoured', async (r) => {
    const M = [0, 1, -1, 0, 20, 0] as [number, number, number, number, number, number]
    const out = await renderStatusPlanPdf(input(await annotatedPdf(r, [{ rect: [100, 200, 140, 300], matrix: M }])), 'source')
    const stream = pageStream(out)
    const [page] = cmBeforeDo(stream, 'SP')
    const [g] = annotationGroups(stream)
    // BBox (0,20) → Matrix → (0,0) = transformed min → Rect min (100,200); BBox (50,0) → (20,50) → Rect max (140,300).
    const [a0, a1] = through(g!, ...apply(M, 0, 20))
    const [b0, b1] = through(g!, ...apply(M, 50, 0))
    const [e0, e1] = apply(page!, 100, 200)
    const [f0, f1] = apply(page!, 140, 300)
    expect([near(a0, e0), near(a1, e1), near(b0, f0), near(b1, f1)]).toEqual([true, true, true, true])
  })

  it('the appearance is clipped to the page box', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ rect: [100, 200, 200, 240] }])), 'source')
    expect(pageStream(out)).toMatch(/0 0 600 400 re\s+W\s+n/)
  })

  it('/AS picks the state; an unknown state draws nothing', async () => {
    const off = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', rect: [10, 10, 60, 30], states: { as: 'Off', on: ON, off: OFF } }])), 'source')
    expect(has(off, OFF)).toBe(true)
    expect(has(off, ON)).toBe(false)
    const unknown = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', rect: [10, 10, 60, 30], states: { as: 'Maybe', on: ON, off: OFF } }])), 'source')
    expect(annotationGroups(pageStream(unknown))).toHaveLength(0)
  })

  it('Hidden, NoView, Invisible markups, Popup, Link and annotations without an appearance are not drawn', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [
      { rect: [10, 10, 60, 30], flags: 2 },
      { rect: [10, 10, 60, 30], flags: 32 },
      { rect: [10, 10, 60, 30], flags: 1 },
      { rect: [10, 10, 60, 30], subtype: 'Popup' },
      { rect: [10, 10, 60, 30], subtype: 'Link' },
      { rect: [10, 10, 60, 30], noAp: true },
    ])), 'source')
    expect(annotationGroups(pageStream(out))).toHaveLength(0)
    expect(has(out, MARK)).toBe(false) // unreferenced, so pruned
  })

  it('a Widget is drawn (pdf.js paints form fields on the canvas in its default mode), even when Invisible', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', flags: 1, rect: [10, 10, 60, 30] }])), 'source')
    expect(annotationGroups(pageStream(out))).toHaveLength(1)
  })

  it('flattens, never copies: the output carries no interactive annotation', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ rect: [100, 200, 200, 240] }])), 'a3')
    expect(pdfAllText(out)).not.toMatch(/\/Type\s*\/Annot\b/)
    expect(pdfAllText(out)).not.toMatch(/\/Annots\b/)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/annotation-flatten.test.ts
```

Expected: FAIL — `expected [] to have a length of 1` for the placement cases (no `/SA` group yet), `has(out, MARK)` false. The "not drawn" and "never copies" cases already PASS (today nothing is drawn and the donor page is pruned); they pin behaviour.

- [ ] **Step 3: Write the pdf-lib adapter**

Create `apps/web/src/lib/status-plans/annotation-flatten.ts`:

```ts
/**
 * Reads a COPIED page's /Annots (already inside the output document, copied with the
 * donor page by render-plan-page.ts) into the appearance streams to paint and the §12.5.5
 * matrix for each. The rules are annotation-appearance.ts's; this file only reads pdf-lib
 * objects. A malformed annotation is skipped, never thrown on: a markup must not cost the
 * whole sheet.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, type PDFContext } from 'pdf-lib'
import {
  IDENTITY, annotationDrawn, appearanceMatrix, pickAppearance,
  type ApNormal, type Mat, type Quad,
} from './annotation-appearance'

export interface FlatAppearance {
  /** The appearance stream (a form XObject) in the output document. */
  ref: PDFRef
  /** §12.5.5 matrix A, in the source page's user space. */
  matrix: Mat
}

const N = (s: string) => PDFName.of(s)

function numbers(arr: PDFArray | undefined, len: number): number[] | null {
  if (!arr || arr.size() !== len) return null
  const out: number[] = []
  for (let i = 0; i < len; i++) {
    const v = arr.lookup(i)
    if (!(v instanceof PDFNumber)) return null
    out.push(v.asNumber())
  }
  return out.every(Number.isFinite) ? out : null
}

/** A stream, by reference; a direct stream object is registered so it can be named from a page. */
function streamRef(ctx: PDFContext, raw: unknown): PDFRef | null {
  if (raw instanceof PDFRef) return ctx.lookup(raw) instanceof PDFStream ? raw : null
  if (raw instanceof PDFStream) return ctx.register(raw)
  return null
}

function normalAppearance(ctx: PDFContext, ap: PDFDict | undefined): ApNormal<PDFRef> {
  if (!ap) return null
  const raw = ap.get(N('N'))
  if (!raw) return null
  const resolved = raw instanceof PDFRef ? ctx.lookup(raw) : raw
  if (resolved instanceof PDFStream) {
    const ref = streamRef(ctx, raw)
    return ref ? { kind: 'stream', stream: ref } : null
  }
  if (resolved instanceof PDFDict) {
    const states = new Map<string, PDFRef>()
    for (const [key, value] of resolved.entries()) {
      const ref = streamRef(ctx, value)
      if (ref) states.set(key.decodeText(), ref)
    }
    return { kind: 'states', states }
  }
  return null
}

export function collectAnnotationAppearances(ctx: PDFContext, page: PDFDict): FlatAppearance[] {
  let annots: PDFArray | undefined
  try {
    annots = page.lookupMaybe(N('Annots'), PDFArray)
  } catch {
    return []
  }
  if (!annots) return []
  const out: FlatAppearance[] = []
  for (let i = 0; i < annots.size(); i++) {
    try {
      const a = annots.lookup(i)
      if (!(a instanceof PDFDict)) continue
      const subtype = a.lookupMaybe(N('Subtype'), PDFName)?.decodeText() ?? null
      const flags = a.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0
      if (!annotationDrawn(subtype, flags)) continue
      const rect = numbers(a.lookupMaybe(N('Rect'), PDFArray), 4)
      if (!rect) continue
      const as = a.lookupMaybe(N('AS'), PDFName)?.decodeText() ?? null
      const ref = pickAppearance(normalAppearance(ctx, a.lookupMaybe(N('AP'), PDFDict)), as)
      if (!ref) continue
      const stream = ctx.lookup(ref)
      if (!(stream instanceof PDFStream)) continue
      const bbox = numbers(stream.dict.lookupMaybe(N('BBox'), PDFArray), 4)
      if (!bbox) continue
      const m = numbers(stream.dict.lookupMaybe(N('Matrix'), PDFArray), 6) ?? [...IDENTITY]
      // An appearance stream IS a form XObject (§12.5.5); some writers omit the names.
      if (!stream.dict.has(N('Subtype'))) stream.dict.set(N('Subtype'), N('Form'))
      if (!stream.dict.has(N('Type'))) stream.dict.set(N('Type'), N('XObject'))
      out.push({ ref, matrix: appearanceMatrix(rect as unknown as Quad, bbox as unknown as Quad, m as unknown as Mat) })
    } catch {
      continue
    }
  }
  return out
}
```

- [ ] **Step 4: Paint them in the renderer**

In `apps/web/src/lib/status-plans/render-plan-page.ts`:

1. Add `import { collectAnnotationAppearances, type FlatAppearance } from './annotation-flatten'`.
2. In `resolveSourceUncached`'s PDF branch, declare `let annots: FlatAppearance[] = []` next to `let embedded…`, and inside the `try`, after `await embedded.embed()`, add:

```ts
      // The copied page brought its /Annots and their appearance streams with it. Keep the ones
      // pdf.js paints on screen (spec 2026-10-13 §3); referencing them from the output page keeps
      // them through pruneUnreachableObjects, and everything else is still pruned.
      annots = collectAnnotationAppearances(doc.context, leaf)
```

3. Replace the PDF branch's `draw` with:

```ts
      draw: (page, p) => {
        const name = page.node.newXObject('SP', embedded.ref)
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...p.matrix), drawObject(name), popGraphicsState())
        // Each appearance in the source page's user space: the placement, then form space
        // (source − origin, as embedPage's form), clipped to the page box, then §12.5.5's A.
        // `Do` applies the appearance's own /Matrix.
        for (const a of annots) {
          const an = page.node.newXObject('SA', a.ref)
          page.pushOperators(
            pushGraphicsState(),
            concatTransformationMatrix(...p.matrix),
            concatTransformationMatrix(1, 0, 0, 1, -box.x, -box.y),
            rectangle(box.x, box.y, box.width, box.height), clip(), endPath(),
            concatTransformationMatrix(...a.matrix),
            drawObject(an),
            popGraphicsState(),
          )
        }
      },
```

4. In the file's header comment, after the "Size (2026-10-09)" paragraph, add:

```
 * Annotations (2026-10-13): the canvas shows annotation appearances (pdf.js default
 * annotationMode), so the PDF draws them too — each drawn annotation's normal appearance
 * stream is painted over the page at the §12.5.5 matrix (annotation-flatten.ts). They are
 * flattened, never copied: the output has no interactive annotations. A page without
 * /Annots produces exactly the bytes it did before (render-plan-page.baseline.test.ts).
```

- [ ] **Step 5: Run every renderer test, the baseline included**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/annotation-flatten.test.ts src/lib/status-plans/render-plan-page.baseline.test.ts src/lib/status-plans/render-plan-page.test.ts src/lib/status-plans/appendix.test.ts src/lib/pdf
```

Expected: PASS — including all eight baseline hashes unchanged and the output-size tests (`~1x its drawing`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/annotation-flatten.ts apps/web/src/lib/status-plans/annotation-flatten.test.ts apps/web/src/lib/status-plans/render-plan-page.ts
git commit -m "feat(tenant-plans): Bluebeam and other PDF markups survive Export sheet and the report appendix

Each drawn annotation's appearance stream is flattened over the embedded
page at the PDF 32000 §12.5.5 matrix; pages without /Annots are
byte-identical to before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 4 — Retire `tenants.floor_plan_zones`

Measured on production 2026-10-13: 0 rows; no view or function depends on it; no foreign key points at it. It is referenced by `isAnnotated()`, the annotated-predicate contract test, the site-scope manifest and its generated SQL, 00238's `@verify` block (line 124) and `packages/db/src/types.ts`.

### Task 4.1: `isAnnotated()` stops reading `floor_plan_zones`

**Why first:** once 00251 drops the table, the lookup errors; `isAnnotated()` treats an error as "annotated", and auto-adopt stops for every drawing in production. The function must be deployed without the lookup BEFORE the migration (runbook R2). Deploying early is safe: the table has 0 rows, so the lookup protects nothing.

**Files:**
- Modify: `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`

- [ ] **Step 1: Write the failing expectation**

In the contract test, inside `it('would report a table the predicate does not query', …)`, add after the `tenants.status_plans` line:

```ts
      expect(predicateQueries(body, 'tenants.floor_plan_zones')).toBe(false)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: FAIL, `would report a table the predicate does not query` — `expected true to be false`.

- [ ] **Step 3: Remove the lookup**

In `cloud-sync-project/index.ts`, delete exactly this block from `isAnnotated()`:

```ts
  // Zone polygons (00006). Stored as a percentage of the image, so they survive
  // a pure re-raster — but not a layout change, which is what an adopt usually is.
  const { data: zone, error: ze } = await supabase
    .schema('tenants')
    .from('floor_plan_zones')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (ze || zone) return true

```

and put in its place:

```ts
  // Zone polygons (00006) were retired unused by 00251: never written by any UI,
  // 0 rows in production. There is deliberately no lookup for them here.

```

- [ ] **Step 4: Exempt the table, with a reason**

Discovery reads `CREATE TABLE` bodies and 00006 still creates the table, so it is still discovered. In `DECLARED_EXEMPT`, add after the `tenants.status_plans` entry:

```ts
  'tenants.floor_plan_zones':
    'Retired unused: 00251 drops the table. Created in 00006 for spatial snag pinning, never written ' +
    'by any UI, 0 rows in production on 2026-10-13. 00006\'s CREATE TABLE still names floor_plan_id, ' +
    'which is the only reason discovery finds it.',
```

Also update the header bullet `` *   - `tenants.floor_plan_zones` (00006) — `polygon JSONB`, older than the`` / `` *     predicate itself.`` to:

```ts
 *   - `tenants.floor_plan_zones` (00006) — `polygon JSONB`, older than the
 *     predicate itself. Retired unused by 00251 (now DECLARED_EXEMPT).
```

- [ ] **Step 5: Run the contract test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: PASS. `fails closed on a query error` still holds: one lookup and its `return true` went together; there is still exactly one `return false`.

- [ ] **Step 6: Type-check the function the way CI does**

```bash
cd apps/edge-functions && deno check supabase/functions/cloud-sync-project/index.ts; cd -
```

Expected: no errors. If `deno` is not installed locally, skip; CI's edge-function job runs it.

- [ ] **Step 7: Commit**

```bash
git add apps/edge-functions/supabase/functions/cloud-sync-project/index.ts packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
git commit -m "fix(cloud-sync): isAnnotated() stops reading floor_plan_zones before 00251 drops it

Must be deployed before 00251 is applied: isAnnotated() fails closed, so
a query on a dropped table would stop auto-adopt for every drawing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.2: Site-scope manifest, regenerated SQL, and 00238's `@verify` block

**Files:**
- Modify: `packages/db/src/site-scope/manifest.ts`
- Modify (regenerated): `scripts/db/site-scope/site_scoped_access.sql`
- Modify: `apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql` (`@verify` block only)

- [ ] **Step 1: Drop the table from the manifest**

In `manifest.ts`, delete the line:

```ts
  child('tenants.floor_plan_zones', 'floor_plan', 'floor_plan_id'),
```

The `floor_plan` resolver (`public.site_project_of_floor_plan`) stays: `tenants.floor_plan_page_scales` still uses it.

- [ ] **Step 2: Regenerate the reviewed artefact**

```bash
npx tsx scripts/db/site-scope/emit.ts
git diff --stat scripts/db/site-scope/site_scoped_access.sql
git diff scripts/db/site-scope/site_scoped_access.sql | grep '^[-+]' | grep -v '^[-+][-+]'
grep -c floor_plan_zones scripts/db/site-scope/site_scoped_access.sql || true
```

Expected: `wrote scripts/db/site-scope/site_scoped_access.sql`; the diff removes exactly the `-- policy: site_scope ON tenants.floor_plan_zones RESTRICTIVE` verify line and the 4-line `DROP POLICY … / CREATE POLICY site_scope ON tenants.floor_plan_zones …` statement; nothing is added; the final grep prints `0`.

- [ ] **Step 3: Generator tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/site-scope src/__tests__/security
```

Expected: PASS.

- [ ] **Step 4: Edit 00238's `@verify` block (block only)**

In `apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql`, delete exactly this line inside the `-- @verify:begin … -- @verify:end` block (line 124):

```sql
-- policy: site_scope ON tenants.floor_plan_zones RESTRICTIVE
```

Leave the migration body (the `DROP POLICY IF EXISTS site_scope ON tenants.floor_plan_zones;` / `CREATE POLICY …` statements near line 558) untouched: 00238 is applied history. The post-push verifier re-checks every block ≥ `00185` on every deploy, and this directive would go red the moment 00251 drops the table (rule 2; proven in Task 5.1 Step 7).

```bash
grep -n floor_plan_zones apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```

Expected: the grep shows only the two body lines (`DROP POLICY …` and `CREATE POLICY …`), no `-- policy:` line; the contract test PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/site-scope/manifest.ts scripts/db/site-scope/site_scoped_access.sql apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql
git commit -m "chore(site-scope): floor_plan_zones leaves the manifest; 00238's @verify stops naming it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.3: Migration `00251_retire_floor_plan_zones.sql` and its assertions

**Files:**
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`
- Create: `apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql`
- Create: `scripts/db/assert-floor-plan-zones-retired.sql`

- [ ] **Step 1: Prove the exemption is true (failing first)**

In the contract test, after `it('the status_plans exemption is true: …')`, add:

```ts
  it('the floor_plan_zones exemption is true: a later migration drops the table', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    const drops = files.filter((f) => {
      const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
      return /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?tenants\.floor_plan_zones\b/i.test(sql)
    })
    expect(drops, 'no migration drops tenants.floor_plan_zones, so the exemption is false').toHaveLength(1)
    expect(drops[0]).toMatch(/^\d{5}_retire_floor_plan_zones\.sql$/)
  })
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: FAIL, `no migration drops tenants.floor_plan_zones, so the exemption is false: expected [] to have a length of 1`.

- [ ] **Step 2: Write the assertions**

Create `scripts/db/assert-floor-plan-zones-retired.sql`:

```sql
-- assert-floor-plan-zones-retired.sql — migration 00251 (retire tenants.floor_plan_zones).
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-floor-plan-zones-retired.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql scripts/db/assert-floor-plan-zones-retired.sql
-- Rolled back by the harness. The siblings below must SURVIVE: page scales still hang
-- off floor_plans through the same site-scope resolver.

SELECT * FROM (VALUES
  ('floor_plan_zones is gone',
     to_regclass('tenants.floor_plan_zones') IS NULL),
  ('no policy is left on floor_plan_zones',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenants' AND tablename = 'floor_plan_zones')),
  ('tenants.floor_plans survives',
     to_regclass('tenants.floor_plans') IS NOT NULL),
  ('floor_plan_page_scales keeps its site_scope policy',
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenants' AND tablename = 'floor_plan_page_scales'
              AND policyname = 'site_scope' AND permissive = 'RESTRICTIVE')),
  ('the floor_plan site-scope resolver survives',
     to_regprocedure('public.site_project_of_floor_plan(uuid)') IS NOT NULL)
) AS t("check", ok);
```

- [ ] **Step 3: Write the migration**

Create `apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Migration 00251: retire tenants.floor_plan_zones
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-13-tenant-plans-followups-design.md (section 4)
--
-- WHAT. tenants.floor_plan_zones was created in 00006 for "spatial snag
-- pinning". No UI ever wrote it. On 2026-10-13 production held 0 rows, and no
-- view, function or foreign key depended on it. Its 00009 SELECT policy and its
-- 00238 site_scope policy are dropped with the table.
--
-- DEPLOY ORDER. cloud-sync-project's isAnnotated() queried this table and
-- FAILS CLOSED on a query error. The function must be deployed WITHOUT that
-- lookup before this migration is applied, or every drawing reads as annotated
-- and auto-adopt stops for the whole platform (the same rule as 00249).
--
-- EARLIER @verify. 00238's block named "policy: site_scope ON
-- tenants.floor_plan_zones". That directive was removed in the same change;
-- the verify sweep proves every earlier block still holds after this drop.
--
-- STEP 0 refuses to run if the table holds any row: this retires an unused
-- table and must never drop data. DROP TABLE has no CASCADE, so an unexpected
-- dependent object also stops it.
-- ---------------------------------------------------------------------------
-- @verify:begin
-- sql: (SELECT to_regclass('tenants.floor_plan_zones') IS NULL)
-- sql: (SELECT to_regclass('tenants.floor_plan_page_scales') IS NOT NULL)
-- @verify:end

-- Step 0: refuse to drop data.
DO $$
BEGIN
  IF to_regclass('tenants.floor_plan_zones') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM tenants.floor_plan_zones) THEN
      RAISE EXCEPTION '00251: tenants.floor_plan_zones holds rows; refusing to drop data';
    END IF;
  END IF;
END
$$;

-- Step 1: drop the table (its policies go with it).
DROP TABLE IF EXISTS tenants.floor_plan_zones;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Run the repo contract tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```

Expected: PASS (the exemption is proven; 00251's block parses: two `sql:` directives, no em dash in a payload).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql scripts/db/assert-floor-plan-zones-retired.sql
git commit -m "feat(db): 00251 retires tenants.floor_plan_zones (refuses if it holds rows)

Deploy cloud-sync-project without the zones lookup first (runbook R2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4.4: Generated types

**Files:**
- Modify: `packages/db/src/types.ts`

- [ ] **Step 1: Remove the table's types**

In `packages/db/src/types.ts`, under `tenants: { Tables: { … } }`, delete the whole `floor_plan_zones: { Row: {…} Insert: {…} Update: {…} Relationships: [ { foreignKeyName: "floor_plan_zones_floor_plan_id_fkey" … } ] }` block (it starts at `      floor_plan_zones: {` and ends with the `      }` before `      floor_plans: {`). Do not regenerate the whole file (`gen types` would drop the hand patches `slug?` / `code?` — see CLAUDE.md).

- [ ] **Step 2: Nothing else uses it**

```bash
grep -rn "floor_plan_zones" apps/web/src apps/mobile packages --include=*.ts --include=*.tsx | grep -v "__tests__/security/floor-plan-annotated-predicate"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
```

Expected: the grep prints nothing; both type-checks exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): drop floor_plan_zones from the generated types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 5 — Verification

### Task 5.1: Verify everything verifiable before a deploy

**Files:** none committed (scratch files live in `$TMPDIR` only).

- [ ] **Step 1: Re-check the migration number (the claim is made now)**

Run each as its own command, never in the same command as a merge:

```bash
git fetch origin main
ls apps/edge-functions/supabase/migrations | tail -4
git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -4
gh pr list --state open --json number,files --jq '.[] | {n: .number, m: [.files[].path | select(test("supabase/migrations/"))]} | select(.m | length > 0)'
source scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head FROM supabase_migrations.schema_migrations"
```

Expected: highest on `origin/main` is `00249_…` (or `00250_…` if #281 merged), ledger head ≤ `00250`, no open PR other than #281 claims `00250`, none claims `00251`. If `00251` is taken anywhere: `git mv` the file to the next free number, change its header line `-- Migration 00251:` and the `00251` mentions in `index.ts`'s comment, the contract-test reason and `cloud-sync-project`'s comment, re-run Step 2 for db and web (tests find the file by pattern), commit, and use the new path below.

- [ ] **Step 2: Three suites**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test
```

Expected: all PASS (db's live-database suites skip without credentials). Any FAIL stops here.

- [ ] **Step 3: Types, lint, build**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web build
```

Expected: all exit 0. `next build` lists `/projects/[id]/tenant-schedule/floor-plan` and `/line-diagram` as dynamic routes.

- [ ] **Step 4: RED, then GREEN — the assertions against production (rolled back)**

```bash
M=apps/edge-functions/supabase/migrations/00251_retire_floor_plan_zones.sql
A=scripts/db/assert-floor-plan-zones-retired.sql
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql "$A"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh "$M" "$A"
```

Expected: the first run exits 1 with exactly two `✗` (`floor_plan_zones is gone`, `no policy is left on floor_plan_zones`) and three `✓`. The second prints five `✓` and `✓ 5 assertion(s) green across 1 file(s) — transactions rolled back, nothing persisted`.

- [ ] **Step 5: The step-0 guard refuses to drop data — and is what refuses**

```bash
D="/Volumes/Extreme SSD/tmp"
cat > "$D/seed-zone.sql" <<'EOF'
INSERT INTO tenants.floor_plan_zones (floor_plan_id, organisation_id, name)
SELECT id, organisation_id, 'dry-run guard probe (rolled back)' FROM tenants.floor_plans ORDER BY created_at LIMIT 1;
EOF
cat "$D/seed-zone.sql" "$M" > "$D/seeded.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/seeded.sql" "$A"
sed "s/RAISE EXCEPTION '00251: tenants.floor_plan_zones holds rows; refusing to drop data';/NULL;/" "$M" > "$D/mut-noguard.sql"
diff "$M" "$D/mut-noguard.sql" | head
cat "$D/seed-zone.sql" "$D/mut-noguard.sql" > "$D/seeded-noguard.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/seeded-noguard.sql" "$A"
```

Expected: the seeded run reports the file `aborted` with `00251: tenants.floor_plan_zones holds rows; refusing to drop data` (exit 1). The `diff` shows the one changed line. The guard-less seeded run is all `✓` — the probe row is dropped with the table — which proves the guard, not anything else, is what refused. (Everything is rolled back; the probe row never persists.) If the seeded run aborts with a different message (e.g. the INSERT itself was refused), fix the seed, not the migration.

- [ ] **Step 6: Site-scope coverage stays green**

```bash
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" scripts/db/assert-site-scope-coverage.sql
```

Expected: all `✓`, including `storage site_scope_objects present`, and no line names `floor_plan_zones` (the catalog no longer has it).

- [ ] **Step 7: Sweep every earlier `@verify` directive under the new state — and prove the 00238 edit**

```bash
node --experimental-strip-types scripts/db/emit-verify-sweep.ts "$D/verify-sweep.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" "$D/verify-sweep.sql"
```

Expected: every line `✓`, including all of `00238_site_scoped_access.sql #…` (the edited block) and `00251_retire_floor_plan_zones.sql #…` (00251's own block parses and holds before it is ever applied).

Now prove the edit was needed (rule 2): sweep 00238's ORIGINAL block under the new state.

```bash
git show origin/main:apps/edge-functions/supabase/migrations/00238_site_scoped_access.sql > "$D/00238-original.sql"
cat > "$D/sweep-one.mts" <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildVerifySweepSql } from '/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans/packages/shared/src/lib/migrations/verify-header.ts'
const [out, file] = process.argv.slice(2)
writeFileSync(out!, buildVerifySweepSql([{ file: '00238_site_scoped_access.sql', sql: readFileSync(file!, 'utf8') }]))
EOF
node --experimental-strip-types "$D/sweep-one.mts" "$D/sweep-00238-original.sql" "$D/00238-original.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" "$D/sweep-00238-original.sql"
```

Expected: exit 1 with exactly one `✗` — the `policy: site_scope ON tenants.floor_plan_zones RESTRICTIVE` directive. That is the deploy that would have gone red without Task 4.2 Step 4.

If the full sweep aborts instead of reporting, regenerate it with a later `since` (`00230`, then `00238`) to find the directive that raised; a `✗` in any other block means it names or counts something 00251 changed — fix it forward in this branch by editing that block, and re-run this step.

- [ ] **Step 8: Contract checks that need nothing but the repo**

```bash
TMPDIR="$D" pnpm --filter @esite/db exec vitest run src/__tests__/security src/site-scope
TMPDIR="$D" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts src/lib/auth src/lib/status-plans/page-props.contract.test.ts src/lib/status-plans/render-plan-page.baseline.test.ts
```

Expected: PASS (annotated predicate without zones, exemption proven true, generator consistent, every block parses, role gates read `.ok`, page props JSON only, no-annotation PDFs byte-identical).

- [ ] **Step 9: Stop here**

The branch is green on the three suites, types, lint and `next build`; the migration has been dry-run against production red first and green after, the guard refused seeded data and the guard-less mutation did not, coverage is green, and the full `@verify` sweep is green (plus proof that 00238's original block would have turned the deploy red). Do not deploy, apply or merge as part of this plan. Push the branch and open the PR (ready, not draft) with the red/green sets above and a link to the runbook below.

---

## Deploy runbook (owner / release session only — NOT executed by implementers)

Order matters: **function first, then merge, then verify, then confirm cloud sync.** The live `cloud-sync-project` queries `tenants.floor_plan_zones`; once 00251 drops it, the query errors, `isAnnotated()` treats the error as "annotated", and auto-adopt silently stops for every drawing in production.

**R1. Round-trip and what it buys.** One edge-function deploy (≈1 min) and one merge that runs `Deploy DB Migrations` (≈3–5 min), plus Vercel's production build (≈5 min). Together they ship the board view, Show, annotation flattening and the table retirement; verification below takes ≈15 min more. The table holds 0 rows, so nothing is lost between R2 and R4.

**R2. Deploy `cloud-sync-project` from the branch, before merging.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
git checkout feat/tenant-plans-followups && git pull --ff-only
export TMPDIR="/Volumes/Extreme SSD/tmp"
export SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s 'Supabase CLI' -w | sed 's/^go-keyring-base64://' | base64 -d)"
apps/edge-functions/deploy.sh cloud-sync-project
```

Then read the deployed artefact back, not the repo:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/functions/cloud-sync-project | jq '{version, verify_jwt, updated_at}'
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/functions/cloud-sync-project/body -o "$TMPDIR/csp.eszip"
strings "$TMPDIR/csp.eszip" | grep -c "floor_plan_zones"
strings "$TMPDIR/csp.eszip" | grep -c "floor_plan_page_scales"
```

Expected: `version` one higher than before, `verify_jwt: true`; the `floor_plan_zones` count is `0` and the `floor_plan_page_scales` count is ≥ 1 (the bundle is real and still holds the other lookups). If `strings` finds neither, the ESZIP is compressed: extract it as in the memory note "Reading deployed edge-function source" before concluding anything. Wait for the next `cloud-sync-poll` tick (every 15 min) and check it ran clean:

```bash
source scripts/db/mgmt-api.sh && mgmt_query "SELECT status, count(*) FROM tenants.cloud_sync_runs WHERE started_at > now() - interval '20 minutes' GROUP BY status"
```

Expected: only `done` rows.

**R3. Re-check the number and the data, each as its own command.**

```bash
source scripts/db/mgmt-api.sh
mgmt_query "SELECT max(version) AS head FROM supabase_migrations.schema_migrations"
mgmt_query "SELECT count(*) AS rows FROM tenants.floor_plan_zones"
mgmt_query "SELECT count(*) AS dependent_views FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid WHERE d.refobjid = 'tenants.floor_plan_zones'::regclass"
mgmt_query "SELECT count(*) AS inbound_fks FROM pg_constraint WHERE confrelid = 'tenants.floor_plan_zones'::regclass"
```

Expected: head `00249` or `00250`; `rows = 0`, `dependent_views = 0`, `inbound_fks = 0`. Renumber per Task 5.1 Step 1 if `00251` is taken. If `rows > 0`, STOP: someone wrote zones since 2026-10-13, and the migration will refuse — find out who before going further.

**R4. Merge** with a merge commit (not squash), after CI is green on the PR:

```bash
gh pr merge <PR> --merge
```

Watch `Deploy DB Migrations` on the merge commit to the end (`gh run watch`). It applies `00250` first if #281 has merged and it is not yet applied, then `00251`, then the post-push verifier re-checks every migration ≥ `00185`. **A green run is not evidence the migration ran** — R5 reads it back.

**R5. Verify on production.**

```bash
source scripts/db/mgmt-api.sh
mgmt_query "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3"
mgmt_query "SELECT to_regclass('tenants.floor_plan_zones') IS NULL AS retired"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-floor-plan-zones-retired.sql scripts/db/assert-site-scope-coverage.sql
```

Expected: `00251` in the ledger; `retired = true`; 5 + coverage all `✓` against the LIVE state (noop migration, rolled back).

Then the web:

```bash
for p in "tenant-schedule/floor-plan?colour=board" tenant-schedule/line-diagram; do curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://www.e-site.live/projects/00000000-0000-4000-8000-000000000000/$p"; done
curl -s -o /dev/null -w "%{http_code}\n" "https://www.e-site.live/api/projects/00000000-0000-4000-8000-000000000000/status-plans/00000000-0000-4000-8000-000000000000/sheet?sheet=00000000-0000-4000-8000-000000000000&colour=board"
```

Expected: the pages redirect a signed-out visitor to `/login?next=…` (the gate), the route answers 401; never a 500. Confirm the Vercel production deployment is the merge commit (GitHub deployments API), not inferred from a 200.

**R6. Cloud sync after the migration.** Wait for the next `cloud-sync-poll` tick and repeat the R2 run query. Expected: only `done` rows, and the adopted / flagged counts in line with the previous day (no sudden "every drawing annotated").

**R7. Not verifiable by the agent: the signed-in walk.** Owner, on KINGSWALK:
- Tenant schedule → Floor plan → **Colour by: Main board** → shops take their board colours; the legend lists the main boards (KINGSWALK has 9) with counts and measured GLA; the measured 95 of 108 reached shops are coloured and the rest grey as "Feed not in the cable schedule"; reload keeps `?colour=board`.
- Select a shop fed from two boards at the same distance → the panel says "Also fed from …".
- **Export sheet** in board mode → the PDF matches the screen's colours and legend.
- Generate the tenant report with **Floor plan by main board** ticked → extra pages after the status pages.
- Needs attention → **Show** → the canvas zooms to the shape and selects it; Line diagram → Detect blocks → **Show** on a row → zoom + blinking outline for 2 s.
- Upload a Bluebeam-marked PDF as a sheet → **Export sheet** → the markups, stamps and clouds appear in the PDF where they are on screen.

---

## Decisions made in this plan

1. **Widgets are drawn.** The spec skips `Widget` because "pdf.js also omits [them] in its default mode". It does not: pdf.js 5.7.284's `page.render()` defaults to `annotationMode = AnnotationMode.ENABLE`, where `renderForms` is false and `WidgetAnnotation.mustBeViewed` returns true unless Hidden/NoView — form fields ARE painted on the canvas. The spec's goal is that the PDF agrees with the screen, so Widgets are flattened. Flipping this is one line in `annotationDrawn` plus its two tests. Likewise the Invisible flag (bit 1) is honoured exactly as pdf.js does (hides markups, not Widgets).
2. **Known gaps in flattening, stated:** annotations with no `/AP` are skipped (pdf.js synthesises appearances for a few types such as Square/Ink without one); `NoRotate` and optional content (`/OC`) are not special-cased. Bluebeam always writes appearance streams.
3. **The feed is loaded on every floor plan request** (not only with `?colour=board`), so the switch is instant and needs no navigation (which would re-mint the signed URL and re-rasterise the sheet). The mode is mirrored to `?colour=board` with `history.replaceState`, like `?sheet=` / `?shape=`.
4. **"Unavailable" has three reasons**, each a sentence: the schedule could not be read (any read error, including a throw), the project has no revision, or the revision has no main boards. In every case the floor plan keeps status colours and says why; it never shows every shop grey. Zero rows from RLS reads as "no cable schedule yet".
5. **Revision rule:** latest `ISSUED` by `issued_at` (a missing `issued_at` last), then `created_at`; with no `ISSUED`, the newest by `created_at` whatever its status. Status values are upper case (00051 CHECK).
6. **Board name** = `code`, else `name`, else "Main board". Sort is numeric-aware and case-insensitive ("MB 2.1" before "MB 10.1"), id breaks ties. More than 12 boards wrap the palette.
7. **`feedingMainBoard(edges, boards, nodeId)`** takes the main boards (not every node) as its second argument; `feedsFor` builds the upstream index once for a whole plan. A node that is itself a main board answers itself at 0 hops.
8. **Legend in board mode:** one row per board (name, colour, count, measured GLA), then "Feed not in the cable schedule", then "Unassigned" (shapes with no shop keep the unlinked style) and the four area types. On screen the area is a dim suffix; in PDFs it rides in the label ("MB 1.1 (1 234.5 m²)").
9. **Overdue in board mode** is cleared on the view (no hatch, not counted), as the spec says. Decommissioned shops keep their struck-through label in their board colour.
10. **Export sheet moves into the workspace** and now appears on the floor plan too (it rendered only on the line diagram page). Inside the workspace it follows the colour switch; the page-props contract still holds (pages render only the workspace / empty state with spread props).
11. **Appendix board pages** come from a second loader call (`colourBy: 'board'`), are placed after the status pages, have their own 20-sheet cap, and are titled "… by main board (cable schedule Rev N)". The same files are embedded once per output PDF (keyed by storage path), so the byte cap is not doubled in practice.
12. **Byte-identity** is checked through the public `renderStatusPlanPdf` with `Date` frozen: pdf-lib's resource names come from a per-document seeded RNG (`SimpleRNG.withSeed(1)`), so no normalisation is needed. The eight hashes are captured before the renderer changes (Task 3.1), and the capture is run twice to prove it is stable.
13. **Show** blinks a dashed outline in the selection blue for 2 s (250 ms on/off) for both Detect-blocks rows and Needs-attention rows; the latter also selects the shape. Each press gets a new nonce from a counter (not `Date.now()`, which can repeat).
14. **`ViewBox`** is declared in `lib/sheet/viewport-math.ts` rather than importing the status-plans `Box`, so the shared sheet library keeps no dependency on status plans (the shapes are structurally identical).
15. **Migration file** `00251_retire_floor_plan_zones.sql`; tests find it by `^\d{5}_retire_floor_plan_zones\.sql$`. Its `@verify` block uses two `sql:` predicates (the table is gone; its sibling `floor_plan_page_scales` survives). The guard checks rows; `DROP TABLE` without `CASCADE` also stops on any unexpected dependent object.
