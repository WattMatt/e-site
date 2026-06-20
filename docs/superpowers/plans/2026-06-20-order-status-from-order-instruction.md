# Auto-advance order status from the order-instruction document — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an order-instruction document is uploaded for a `required` order, auto-advance it to `ordered` with today's date, so the Tenant Schedule (and its report) stop showing a misleading `Required`.

**Architecture:** A pure decision function (`shouldAdvanceToOrdered`) plus a small hook inside `addNodeOrderDocumentAction`: after the document row is inserted, if it's an `order_instruction` on a `required` order, `structurePatch` `node_orders` to `status='ordered', ordered_at=today` and revalidate the schedule pages. One-way (no revert), only from `required`. No migration.

**Tech Stack:** Next.js server actions, Supabase (raw PostgREST + service-role for `structure.*` writes), Vitest.

**Working tree:** worktree `~/dev/e-site-orderstatus`, branch `feat/order-status-from-docs` (based on `origin/main`). Run commands from `~/dev/e-site-orderstatus/apps/web`. Install first: `cd ~/dev/e-site-orderstatus && pnpm install --prefer-offline`.

**Reference:** `apps/web/src/actions/node-order.actions.ts` (`markOrderedAction` — the manual `required → ordered` + `ordered_at` pattern); `apps/web/src/actions/node-order-document.actions.ts` (`addNodeOrderDocumentAction` + the existing `structurePatch` helper).

---

### Task 1: Pure decision function (TDD)

**Files:**
- Create: `apps/web/src/lib/orders/order-status-advance.ts`
- Test: `apps/web/src/lib/orders/order-status-advance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/orders/order-status-advance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldAdvanceToOrdered } from './order-status-advance'

describe('shouldAdvanceToOrdered', () => {
  it('advances a required order when an order-instruction is uploaded', () => {
    expect(shouldAdvanceToOrdered('order_instruction', 'required')).toBe(true)
  })

  it('does NOT advance for a quote (pricing only)', () => {
    expect(shouldAdvanceToOrdered('quote', 'required')).toBe(false)
  })

  it('does NOT touch orders past required, or tenant-supplied orders', () => {
    expect(shouldAdvanceToOrdered('order_instruction', 'ordered')).toBe(false)
    expect(shouldAdvanceToOrdered('order_instruction', 'received')).toBe(false)
    expect(shouldAdvanceToOrdered('order_instruction', 'by_tenant')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd ~/dev/e-site-orderstatus/apps/web && npx vitest run src/lib/orders/order-status-advance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/orders/order-status-advance.ts`:

```ts
/**
 * Pure rule for auto-advancing a node order's status when a document is uploaded.
 * An order-instruction document on a still-`required` order means the order has
 * been placed → advance to `ordered`. Quotes never advance; orders past `required`
 * (`ordered`/`received`) and tenant-supplied (`by_tenant`) orders are never touched.
 * One-way — deleting the document does not revert (see spec).
 */
export type NodeOrderDocType = 'quote' | 'order_instruction'
export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

export function shouldAdvanceToOrdered(
  docType: NodeOrderDocType,
  currentStatus: NodeOrderStatus,
): boolean {
  return docType === 'order_instruction' && currentStatus === 'required'
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd ~/dev/e-site-orderstatus/apps/web && npx vitest run src/lib/orders/order-status-advance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-orderstatus
git add apps/web/src/lib/orders/order-status-advance.ts apps/web/src/lib/orders/order-status-advance.test.ts
git commit -m "feat(materials): pure rule — order-instruction upload advances a required order"
```

---

### Task 2: Hook the advance into the document-add action

**Files:**
- Modify: `apps/web/src/actions/node-order-document.actions.ts`

- [ ] **Step 1: Add the import**

At the top of `node-order-document.actions.ts`, after the existing imports (e.g. after the `projectService` import), add:

```ts
import { shouldAdvanceToOrdered, type NodeOrderStatus } from '@/lib/orders/order-status-advance'
```

- [ ] **Step 2: Advance the order after a successful order-instruction insert**

In `addNodeOrderDocumentAction`, the body currently ends:

```ts
  if (!ins.ok) return { error: ins.error ?? 'Failed to record document' }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}
```

Replace that tail with:

```ts
  if (!ins.ok) return { error: ins.error ?? 'Failed to record document' }

  // An order-instruction upload on a still-`required` order means the order was
  // placed → advance it to `ordered` with today's date (one-way; quotes and
  // orders past `required` are untouched). Best-effort: the document is already
  // recorded (source of truth); a failed status patch must not fail the upload.
  if (parsed.data.docType === 'order_instruction') {
    const { data: orderRow } = await (guard.supabase as never as {
      schema: (s: string) => { from: (t: string) => any }
    })
      .schema('structure')
      .from('node_orders')
      .select('status')
      .eq('id', nodeOrderId)
      .maybeSingle()
    const status = (orderRow as { status: NodeOrderStatus } | null)?.status
    if (status && shouldAdvanceToOrdered('order_instruction', status)) {
      await structurePatch(supabaseUrl, serviceKey, 'node_orders', `id=eq.${nodeOrderId}`, {
        status: 'ordered',
        ordered_at: new Date().toISOString().slice(0, 10),
      })
      revalidatePath(`/projects/${projectId}/tenant-schedule`)
      revalidatePath(`/projects/${projectId}/equipment-schedule`)
    }
  }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}
```

Notes for the implementer:
- `structurePatch(supabaseUrl, serviceKey, table, filterQuery, body)` already exists in this file (added for `updateNodeOrderDocumentMetaAction`) — reuse it; do not redefine it.
- `serviceKey` / `supabaseUrl` are already in scope (declared earlier in the function for the insert).
- Do NOT add any revert logic to `deleteNodeOrderDocumentAction` — one-way by design.

- [ ] **Step 3: Confirm `structurePatch` exists and is reused (not duplicated)**

Run: `grep -n "async function structurePatch\|structurePatch(" ~/dev/e-site-orderstatus/apps/web/src/actions/node-order-document.actions.ts`
Expected: exactly one `async function structurePatch` definition, now referenced from both `updateNodeOrderDocumentMetaAction` and the new `addNodeOrderDocumentAction` branch. If the definition is missing, STOP and report (the multi-doc feature should have added it).

- [ ] **Step 4: Type-check + run the orders test + the existing doc-action tests**

Run:
```bash
cd ~/dev/e-site-orderstatus/apps/web
pnpm type-check
npx vitest run src/lib/orders src/actions/tenant-delete.actions.test.ts
```
Expected: type-check clean; the orders test passes; the tenant-delete action test (which exercises `node_order_documents`) still passes. If `NodeOrderStatus` clashes with another exported type, keep the import as written (it's namespaced to the new module).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-orderstatus
git add apps/web/src/actions/node-order-document.actions.ts
git commit -m "feat(materials): order-instruction upload auto-marks the order ordered (required→ordered)"
```

---

### Task 3: Full verification

**Files:** none.

- [ ] **Step 1: Full static checks + tests**

Run:
```bash
cd ~/dev/e-site-orderstatus/apps/web
pnpm type-check && pnpm lint && pnpm test
```
Expected: type-check clean; lint no new errors in the touched files; vitest all pass (including the new `order-status-advance.test.ts`).

- [ ] **Step 2: Manual smoke (after deploy, or locally)**

On a project's Equipment & Materials tab, find a tenant order line that is `Required`:
- Upload an **order-instruction** document → the order flips to **Ordered**; open the Tenant Schedule → that line shows **Ordered** with today's date; regenerate the Tenant Schedule report → the shop's DB/Lights column shows **Ordered**.
- Upload only a **quote** on another `Required` line → it stays **Required**.
- Delete the order-instruction document → the order stays **Ordered** (one-way).
- An order already **Received** → uploading another order-instruction leaves it **Received**.

- [ ] **Step 3: Finish the branch**

Invoke the **superpowers:finishing-a-development-branch** skill to integrate `feat/order-status-from-docs`.

---

## Self-Review (completed while writing this plan)

**Spec coverage:** Trigger = order_instruction present (decision 1) → Task 1 rule + Task 2 branch guarded on `docType === 'order_instruction'`. One-way / no revert (decision 2) → no delete-side change (Task 2 Step 2 note). Only from `required` (decision 3) → `shouldAdvanceToOrdered` + the read of current status. `ordered_at = today` (decision 4) → `new Date().toISOString().slice(0,10)`, matching `markOrderedAction`. All orders (decision 5) → the hook is in the shared doc-add action, not tenant-specific. Report shows pill only (decision 6) → no renderer change. No migration → confirmed (only an app-layer hook).

**Placeholder scan:** none — complete code in every step; the only runtime dependency (`structurePatch`) is verified present in Task 2 Step 3.

**Type consistency:** `NodeOrderDocType` / `NodeOrderStatus` / `shouldAdvanceToOrdered` defined in Task 1 and imported unchanged in Task 2. The patch fields (`status`, `ordered_at`) match the `node_orders` columns used by `markOrderedAction`.
