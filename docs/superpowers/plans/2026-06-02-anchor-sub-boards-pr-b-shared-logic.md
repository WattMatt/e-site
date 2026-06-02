# Anchor Sub-Boards — PR-B (Shared Logic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, tested shared-logic layer for anchor sub-boards — the `parent_node_id` / `sub_board` types plus `resolveOwningLease`, `buildAnchorGroups`, and `computeNodeOrderRequiredBy` — that PR-C/PR-D will consume.

**Architecture:** Everything lives in `packages/shared/src/structure/` as pure functions over an in-memory node list (no DB). A node's *owning lease* is its nearest `tenant_db` ancestor via `parent_node_id`; scope/BO inherit within a lease and stop at every `tenant_db` boundary (spec §4.1). All three functions are unit-tested with `vitest`.

**Tech Stack:** TypeScript, `@esite/shared` workspace package, `vitest`.

---

## Context the implementer needs

- **Spec:** `docs/superpowers/specs/2026-06-02-anchor-tenant-sub-boards-design.md` (§4.1 = the owning-lease rule; §4.3 = rollup + required-by). PR-A (migration `00116`) is already live in prod.
- **Branch:** `feat/anchor-sub-boards-pr-b` (already checked out). Repo root: `/Users/spud/Developer/ESITE.V1/esite`.
- **Scope decisions — verified against the code, refining the spec's rough PR-B cut:**
  1. **`suggest-equipment-code.ts` is NOT touched, and `sub_board` is NOT added to `EQUIPMENT_KINDS`.** `EQUIPMENT_KINDS` drives the Equipment Schedule's create form/table (`equipment-schedule/_components/EquipmentForm.tsx`, `EquipmentTable.tsx`) and the `equipment.actions.ts` `z.enum(EQUIPMENT_KINDS)` validator — adding `sub_board` there would wrongly surface it as a standalone-creatable equipment kind. Sub-boards are created under an anchor via the tenant schedule (PR-C).
  2. **`node-order.service.ts` is NOT changed.** `deriveEquipmentNodeOrder(nodeId, projectId, orgId, code)` is already kind-agnostic (it takes a code string, not a kind), so a `sub_board` order is produced by PR-C calling it at sub-board creation — no shared change needed.
  3. **Generated DB types (`packages/db/src/types.ts`) are deferred to PR-C** (the first code that queries `parent_node_id` / `tenant_units`). PR-B only updates the **hand-written** `structure/types.ts`, which is all the pure helpers need.
- **Test commands:**
  - Single file (TDD loop): `pnpm --filter @esite/shared exec vitest run owning-lease`
  - Full package suite: `pnpm --filter @esite/shared test`
  - Type-check: `pnpm --filter @esite/shared type-check`

## File structure

- **Modify** `packages/shared/src/structure/types.ts` — add `'sub_board'` to `NodeKind`; add `parent_node_id` to `Node`.
- **Create** `packages/shared/src/structure/owning-lease.ts` — `resolveOwningLease`, `buildAnchorGroups`, `computeNodeOrderRequiredBy` (+ `AnchorGroup`, `LeaseBoInputs`).
- **Create** `packages/shared/src/structure/owning-lease.test.ts` — unit tests + a `mkNode` fixture factory.
- **Modify** `packages/shared/src/structure/index.ts` — barrel-export the new symbols.

---

## Task 1: Types — `sub_board` kind + `parent_node_id` column

**Files:**
- Modify: `packages/shared/src/structure/types.ts`

- [ ] **Step 1: Add `'sub_board'` to `NodeKind`.** Replace the `NodeKind` union (lines 1–9) with:

```ts
export type NodeKind =
  | 'tenant_db'
  | 'main_board'
  | 'common_area_board'
  | 'common_area_lighting'
  | 'rmu'
  | 'mini_sub'
  | 'generator'
  | 'custom'
  | 'sub_board';
```

- [ ] **Step 2: Add `parent_node_id` to the `Node` interface.** In `packages/shared/src/structure/types.ts`, change this (the Core block):

```ts
  code: string;
  name: string | null;
  coc_required: boolean;
  status: NodeStatus;
```

to:

```ts
  code: string;
  name: string | null;
  coc_required: boolean;
  status: NodeStatus;
  /** Containment parent — the board this node sits under; null for a root/lease (migration 00116). */
  parent_node_id: string | null;
```

- [ ] **Step 3: Type-check the package — expect PASS (no exhaustive consumers break)**

Run: `pnpm --filter @esite/shared type-check`
Expected: exits 0. (`NodeKind` has no `Record<NodeKind, …>` map or `never`-exhaustiveness guard, and no code constructs a full `Node` literal that would now be missing `parent_node_id`, so the new members ripple nowhere.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/structure/types.ts
git commit -m "feat(shared): add sub_board kind + parent_node_id to Node types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `resolveOwningLease`

**Files:**
- Create: `packages/shared/src/structure/owning-lease.test.ts`
- Create: `packages/shared/src/structure/owning-lease.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/shared/src/structure/owning-lease.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import type { Node, NodeKind } from './types';
import { resolveOwningLease } from './owning-lease';

/** Build a full Node from id + kind, overriding only what a test cares about. */
function mkNode(id: string, kind: NodeKind, over: Partial<Node> = {}): Node {
  return {
    id,
    kind,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    project_id: 'p1',
    organisation_id: 'o1',
    custom_kind_label: null,
    code: id,
    name: null,
    coc_required: false,
    status: 'active',
    shop_number: null,
    shop_name: null,
    shop_area_m2: null,
    breaker_rating_a: null,
    pole_config: null,
    section: null,
    rating_kva: null,
    voltage_v: null,
    notes: null,
    decommission_reason: null,
    created_by: null,
    parent_node_id: null,
    ...over,
  };
}

/** Shoprite scenario: anchor → departments (one nested), a concession with its own
 *  board, a common-area subtree, and a standalone generator. */
function scenario() {
  const anchor = mkNode('anchor', 'tenant_db');
  const butchery = mkNode('butchery', 'sub_board', { parent_node_id: 'anchor' });
  const coldroom = mkNode('coldroom', 'sub_board', { parent_node_id: 'butchery' });
  const kiosk = mkNode('kiosk', 'tenant_db', { parent_node_id: 'anchor' });
  const kioskDb = mkNode('kioskDb', 'sub_board', { parent_node_id: 'kiosk' });
  const caBoard = mkNode('caBoard', 'common_area_board');
  const caSub = mkNode('caSub', 'sub_board', { parent_node_id: 'caBoard' });
  const gen = mkNode('gen', 'generator');
  const nodes = [anchor, butchery, coldroom, kiosk, kioskDb, caBoard, caSub, gen];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return { anchor, butchery, coldroom, kiosk, kioskDb, caBoard, caSub, gen, nodes, byId };
}

describe('resolveOwningLease', () => {
  it('a tenant_db is its own owning lease', () => {
    const s = scenario();
    expect(resolveOwningLease(s.anchor, s.byId)?.id).toBe('anchor');
  });

  it('a direct sub_board resolves to its anchor tenant_db', () => {
    const s = scenario();
    expect(resolveOwningLease(s.butchery, s.byId)?.id).toBe('anchor');
  });

  it('a nested sub_board resolves to the nearest tenant_db ancestor (the anchor)', () => {
    const s = scenario();
    expect(resolveOwningLease(s.coldroom, s.byId)?.id).toBe('anchor');
  });

  it('a concession (tenant_db under an anchor) is its own lease, not the anchor', () => {
    const s = scenario();
    expect(resolveOwningLease(s.kiosk, s.byId)?.id).toBe('kiosk');
  });

  it("a board under a concession resolves to the concession, NOT the anchor (lease boundary)", () => {
    const s = scenario();
    expect(resolveOwningLease(s.kioskDb, s.byId)?.id).toBe('kiosk');
  });

  it('a common-area sub_board has no owning lease (no tenant_db ancestor)', () => {
    const s = scenario();
    expect(resolveOwningLease(s.caSub, s.byId)).toBeNull();
  });

  it('a standalone equipment node has no owning lease', () => {
    const s = scenario();
    expect(resolveOwningLease(s.gen, s.byId)).toBeNull();
  });

  it('a dangling parent_node_id terminates the walk and yields null (no throw)', () => {
    const orphan = mkNode('orphan', 'sub_board', { parent_node_id: 'missing' });
    const byId = new Map([[orphan.id, orphan] as const]);
    expect(resolveOwningLease(orphan, byId)).toBeNull();
  });

  it('a malformed cyclic chain terminates instead of hanging', () => {
    // a → b → a (the DB forbids this; the helper must still not loop forever)
    const a = mkNode('a', 'sub_board', { parent_node_id: 'b' });
    const b = mkNode('b', 'sub_board', { parent_node_id: 'a' });
    const byId = new Map([[a.id, a], [b.id, b]] as const);
    expect(resolveOwningLease(a, byId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (module missing)**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: FAIL — `Failed to resolve import "./owning-lease"` (the implementation file does not exist yet).

- [ ] **Step 3: Write the minimal implementation.** Create `packages/shared/src/structure/owning-lease.ts` with:

```ts
/**
 * owning-lease.ts — pure helpers for the anchor-tenant containment tree (migration 00116).
 *
 * Design spec: docs/superpowers/specs/2026-06-02-anchor-tenant-sub-boards-design.md §4.1, §4.3.
 *
 * A node's "owning lease" is its nearest `tenant_db` at-or-above it in the
 * parent_node_id containment tree. Scope/party/BO date live on that tenant_db and
 * flow down to its descendants, stopping at every nested tenant_db (a concession
 * is its own lease). The board *feed* (cable_schedule supplies) is a separate
 * relationship and is NOT consulted here.
 *
 * Pure + in-memory over a node list the caller has already fetched — no DB access.
 */

import type { Node } from './types';
import { computeOrderRequiredBy } from './bo.service';

/**
 * The nearest `tenant_db` at-or-above `node` (inclusive) via parent_node_id.
 * Returns null when there is no tenant_db ancestor (a common-area subtree, or a
 * standalone equipment node). `nodesById` must map id → Node for every node
 * referenced by a parent_node_id; a dangling id ends the walk (null). A `seen`
 * set guards against a malformed cyclic chain so the helper never hangs.
 */
export function resolveOwningLease(
  node: Node,
  nodesById: Map<string, Node>,
): Node | null {
  let cur: Node | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'tenant_db') return cur;
    if (cur.parent_node_id === null) return null;
    seen.add(cur.id);
    cur = nodesById.get(cur.parent_node_id);
  }
  return null;
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: PASS — all 9 `resolveOwningLease` tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/structure/owning-lease.ts packages/shared/src/structure/owning-lease.test.ts
git commit -m "feat(shared): resolveOwningLease — nearest tenant_db ancestor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `buildAnchorGroups`

**Files:**
- Modify: `packages/shared/src/structure/owning-lease.test.ts`
- Modify: `packages/shared/src/structure/owning-lease.ts`

- [ ] **Step 1: Write the failing test.** In `packages/shared/src/structure/owning-lease.test.ts`, update the import line and append a new `describe` block.

Change the import:

```ts
import { resolveOwningLease } from './owning-lease';
```

to:

```ts
import { resolveOwningLease, buildAnchorGroups } from './owning-lease';
```

Append at the end of the file:

```ts
describe('buildAnchorGroups', () => {
  it('groups each lease with its descendants and keeps concessions separate', () => {
    const s = scenario();
    const { groups, ungrouped } = buildAnchorGroups(s.nodes);

    const anchorGroup = groups.find((g) => g.lease.id === 'anchor')!;
    const kioskGroup = groups.find((g) => g.lease.id === 'kiosk')!;

    // Anchor group = the anchor + its two departments (NOT the concession's board).
    expect(anchorGroup.members.map((n) => n.id).sort()).toEqual(
      ['anchor', 'butchery', 'coldroom'].sort(),
    );
    // Concession group = the concession + its own board only (lease boundary).
    expect(kioskGroup.members.map((n) => n.id).sort()).toEqual(
      ['kiosk', 'kioskDb'].sort(),
    );
    // Common-area + equipment have no owning lease.
    expect(ungrouped.map((n) => n.id).sort()).toEqual(['caBoard', 'caSub', 'gen'].sort());
  });

  it('produces exactly one group per tenant_db', () => {
    const s = scenario();
    const { groups } = buildAnchorGroups(s.nodes);
    expect(groups.map((g) => g.lease.id).sort()).toEqual(['anchor', 'kiosk'].sort());
  });

  it('an empty anchor (no children) still appears, with itself as the only member', () => {
    const lone = mkNode('lone', 'tenant_db');
    const { groups, ungrouped } = buildAnchorGroups([lone]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((n) => n.id)).toEqual(['lone']);
    expect(ungrouped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: FAIL — `buildAnchorGroups is not a function` / no matching export.

- [ ] **Step 3: Write the minimal implementation.** Append to `packages/shared/src/structure/owning-lease.ts`:

```ts
/** One anchor/lease grouping: a tenant_db and the nodes that resolve to it. */
export interface AnchorGroup {
  /** The owning tenant_db lease. */
  lease: Node;
  /**
   * Nodes whose owning lease is `lease` — the lease node itself plus its
   * descendant boards, but NOT nodes inside a nested tenant_db (a concession),
   * which form their own group. Order follows the input `nodes` order.
   */
  members: Node[];
}

/**
 * Group `nodes` by owning lease. Every tenant_db becomes a group (even childless —
 * its `members` is then just `[itself]`). Nodes with no owning lease (equipment,
 * common-area subtrees) are returned in `ungrouped`. Spec §4.3. Group order and
 * member order follow the input order.
 */
export function buildAnchorGroups(nodes: Node[]): {
  groups: AnchorGroup[];
  ungrouped: Node[];
} {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const groupByLeaseId = new Map<string, AnchorGroup>();
  const ungrouped: Node[] = [];

  // Seed a group per tenant_db first, so empty anchors appear in input order.
  for (const n of nodes) {
    if (n.kind === 'tenant_db') {
      groupByLeaseId.set(n.id, { lease: n, members: [] });
    }
  }
  for (const n of nodes) {
    const lease = resolveOwningLease(n, nodesById);
    if (lease) {
      groupByLeaseId.get(lease.id)!.members.push(n);
    } else {
      ungrouped.push(n);
    }
  }
  return { groups: [...groupByLeaseId.values()], ungrouped };
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: PASS — `resolveOwningLease` + `buildAnchorGroups` blocks all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/structure/owning-lease.ts packages/shared/src/structure/owning-lease.test.ts
git commit -m "feat(shared): buildAnchorGroups — group nodes by owning lease

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `computeNodeOrderRequiredBy`

**Files:**
- Modify: `packages/shared/src/structure/owning-lease.test.ts`
- Modify: `packages/shared/src/structure/owning-lease.ts`

- [ ] **Step 1: Write the failing test.** In `packages/shared/src/structure/owning-lease.test.ts`, update the import and append a new `describe` block.

Change the import:

```ts
import { resolveOwningLease, buildAnchorGroups } from './owning-lease';
```

to:

```ts
import {
  resolveOwningLease,
  buildAnchorGroups,
  computeNodeOrderRequiredBy,
  type LeaseBoInputs,
} from './owning-lease';
```

Append at the end of the file:

```ts
describe('computeNodeOrderRequiredBy', () => {
  /** Build a boInputsFor lookup from a plain id → inputs map. */
  const lookup = (m: Record<string, LeaseBoInputs>) => (id: string) => m[id] ?? null;

  it("a sub_board inherits its owning lease's BO override", () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(
      s.butchery,
      s.byId,
      '2026-12-01',
      lookup({ anchor: { boPeriodDays: null, boDateOverride: '2026-05-15' } }),
    );
    expect(got).toBe('2026-05-15');
  });

  it("a nested sub_board inherits the anchor's BO period (opening - periodDays)", () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(
      s.coldroom,
      s.byId,
      '2026-03-01',
      lookup({ anchor: { boPeriodDays: 30, boDateOverride: null } }),
    );
    expect(got).toBe('2026-01-30');
  });

  it('a node with no owning lease falls back to the project opening date', () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(s.gen, s.byId, '2026-12-01', lookup({}));
    expect(got).toBe('2026-12-01');
  });

  it('a lease with no BO inputs falls back to the project opening date', () => {
    const s = scenario();
    // node is the anchor itself; its lease is itself, but no BO inputs are known.
    const got = computeNodeOrderRequiredBy(s.anchor, s.byId, '2026-12-01', lookup({}));
    expect(got).toBe('2026-12-01');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: FAIL — `computeNodeOrderRequiredBy is not a function` / no matching export.

- [ ] **Step 3: Write the minimal implementation.** Append to `packages/shared/src/structure/owning-lease.ts`:

```ts
/** BO inputs for a tenant lease, supplied by the caller (wired in PR-D). */
export interface LeaseBoInputs {
  boPeriodDays: number | null;
  boDateOverride: string | null;
}

/**
 * The required-by date for a node's material order, honouring lease inheritance
 * (spec §4.3):
 *   - a node under a tenant_db lease → that lease's effective BO date;
 *   - a node with no owning lease (equipment / common-area) → the project opening date.
 *
 * `boInputsFor(leaseId)` resolves the BO inputs for a tenant_db lease id — the
 * caller owns where those live. Returns null when the underlying date is unset
 * (delegates to computeOrderRequiredBy / computeBoDate).
 */
export function computeNodeOrderRequiredBy(
  node: Node,
  nodesById: Map<string, Node>,
  openingDate: string | null,
  boInputsFor: (leaseId: string) => LeaseBoInputs | null,
): string | null {
  const lease = resolveOwningLease(node, nodesById);
  const tenant = lease ? boInputsFor(lease.id) : null;
  return computeOrderRequiredBy({ openingDate, tenant });
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run owning-lease`
Expected: PASS — all three `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/structure/owning-lease.ts packages/shared/src/structure/owning-lease.test.ts
git commit -m "feat(shared): computeNodeOrderRequiredBy — required-by inherits owning lease BO

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Barrel export + full verification

**Files:**
- Modify: `packages/shared/src/structure/index.ts`

- [ ] **Step 1: Export the new symbols.** In `packages/shared/src/structure/index.ts`, immediately after the `bo.service` export block (the line `export type { RagStatus, OrderRequiredByArgs } from './bo.service';`), add:

```ts
export {
  resolveOwningLease,
  buildAnchorGroups,
  computeNodeOrderRequiredBy,
} from './owning-lease';
export type { AnchorGroup, LeaseBoInputs } from './owning-lease';
```

- [ ] **Step 2: Type-check the package — expect PASS**

Run: `pnpm --filter @esite/shared type-check`
Expected: exits 0.

- [ ] **Step 3: Run the FULL shared test suite — expect PASS**

Run: `pnpm --filter @esite/shared test`
Expected: all suites pass, including the new `owning-lease.test.ts` (16 tests) and every pre-existing structure test. No regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/structure/index.ts
git commit -m "feat(shared): export owning-lease helpers from the structure barrel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (§4.1, §4.3, §7 PR-B):**
- Owning-lease rule (§4.1) → `resolveOwningLease`, Task 2. ✓
- Rollup grouping (§4.3) → `buildAnchorGroups`, Task 3. ✓
- Required-by inheritance (§4.3) → `computeNodeOrderRequiredBy`, Task 4. ✓
- `sub_board` + `parent_node_id` types → Task 1. ✓
- **`sub_board` in equipment-order derivation** (§7) → no shared change needed; `deriveEquipmentNodeOrder` is already kind-agnostic, wired in PR-C (documented in Context). ✓ (explicitly de-scoped, not dropped)
- **TS types regen** (§7) → hand-written `structure/types.ts` done here; generated `packages/db/src/types.ts` deferred to PR-C, its first DB consumer (documented). ✓
- Unit tests → Tasks 2–4 (16 tests). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an exact command + expected result. ✓

**3. Type/name consistency:** `resolveOwningLease`, `buildAnchorGroups`, `computeNodeOrderRequiredBy`, `AnchorGroup`, `LeaseBoInputs` are spelled identically in the implementation, tests, and barrel export. `LeaseBoInputs` (`{ boPeriodDays, boDateOverride }`) is structurally assignable to `OrderRequiredByArgs.tenant`, so `computeOrderRequiredBy({ openingDate, tenant })` type-checks. `mkNode` includes `parent_node_id` (added in Task 1), so fixtures compile. ✓

---

## Next PRs

- **PR-C** — tenant-schedule UI (add sub-board / add concession / units editor); wires `deriveEquipmentNodeOrder` at sub-board creation; regenerates the generated `packages/db/src/types.ts`.
- **PR-D** — Materials page rollup using `buildAnchorGroups` + `computeNodeOrderRequiredBy` (nested anchor grouping, lease-boundary divider, RAG).
- **PR-E** — cable-schedule node pickers/labels for `sub_board`.
