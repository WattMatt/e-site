# Auto-advance order status from the order-instruction document

**Date:** 2026-06-20
**Status:** Approved (design) — pending implementation plan
**Area:** Equipment & Materials documents → `node_orders` status → Tenant Schedule + report

## Problem

The Tenant Schedule report (and the schedule grid) read `node_orders.status`. Nothing
links document upload to that status: uploading a quote / order-instruction in the
Equipment & Materials tab inserts a `node_order_documents` row, but the order's
`status` only advances via the manual **"Mark ordered"** button
(`markOrderedAction`: `required → ordered`, sets `ordered_at`). The only trigger on
`node_order_documents` is `updated_at`. So an order whose paperwork has been issued
still reads `required`, and the report misleadingly reports `Required` as if no work
has happened.

## Goal

When an **order-instruction** document is uploaded for an order that is still
`required`, automatically advance it to `ordered` and record `ordered_at` (the upload
date). The tenant schedule grid then shows **Ordered** + the ordered date, and the
report's DB/Lights column shows **Ordered** instead of **Required**.

## Decisions (locked in during brainstorming)

1. **Trigger:** `≥1 order_instruction` doc present advances the order. A **quote**
   alone does NOT (it's supplier pricing, pre-order).
2. **One-way:** no revert. If the order-instruction doc is later deleted, the order
   stays `ordered` (only a manual action would change it). No delete-side logic.
3. **Only from `required`.** `ordered`, `received`, and `by_tenant` orders are never
   touched (mirrors the manual button's guard). This also makes the advance idempotent
   — a second order-instruction upload on an already-`ordered` order is a no-op.
4. **`ordered_at` = today** (the upload date), same as the manual button. Day-level
   `DATE`, matching the column.
5. **Applies to all `node_orders`** — tenant *and* equipment orders use the same
   order-instruction slot, so the equipment schedule benefits identically.
6. **Report shows the status pill only.** `ordered_at` is recorded and shown in the
   tenant-schedule grid (existing per-line "Ordered: <date>"); the report's shop table
   keeps its 7 columns and shows the **Ordered** pill, not a separate date column.

## Design — app-level hook (Approach A)

The document action is the only code path that inserts an order doc, so the hook lives
there rather than in a DB trigger (which would make the DB a second writer to
`node_orders.status` alongside the app actions, and needs a migration the no-revert
rule doesn't justify).

**Pure decision (testable):**
```
shouldAdvanceToOrdered(docType, currentStatus) =
  docType === 'order_instruction' && currentStatus === 'required'
```

**Wiring:** in `addNodeOrderDocumentAction` (`apps/web/src/actions/node-order-document.actions.ts`),
after the `node_order_documents` row is successfully inserted:
1. Read the parent order's current `status` (the action already verifies the order
   belongs to the project; extend that read to return `status`, or do a small read).
2. If `shouldAdvanceToOrdered(docType, status)`, `structurePatch` `structure.node_orders`
   `id=eq.<nodeOrderId>` with `{ status: 'ordered', ordered_at: <today ISO> }`
   (the `structurePatch` helper already exists in this file from the multi-doc feature).
3. Revalidate the status-bearing paths: `/projects/<id>/tenant-schedule`,
   `/projects/<id>/equipment-schedule`, `/projects/<id>/materials` (same set as
   `node-order.actions.ts`).

The advance is best-effort relative to the upload: the document insert is the source of
truth and must succeed first; if the status PATCH fails, the document is still recorded
and the error is logged/returned without rolling back the upload (the manual button
remains a fallback).

## What stays the same

- The manual **"Mark ordered"** button (`markOrderedAction`) — for orders placed
  without uploading an order instruction.
- Quote uploads, `updateNodeOrderDocumentMetaAction`, `deleteNodeOrderDocumentAction`
  — unchanged (delete does NOT revert, per decision 2).
- The report renderer and shop-table columns — unchanged; only the underlying
  `node_orders.status` value changes, which the report already reflects.
- No schema/migration change.

## Testing

- Pure unit tests for `shouldAdvanceToOrdered`: `order_instruction`+`required` → true;
  `quote`+`required` → false; `order_instruction`+`ordered`/`received`/`by_tenant` →
  false.
- The existing `node-order-document.actions` and report tests stay green.
- Manual: upload an order-instruction on a `required` tenant order → the schedule grid
  shows Ordered + today's date; regenerate the report → DB/Lights shows **Ordered**.
  Upload a quote only → stays Required. Delete the order-instruction → stays Ordered.

## Out of scope

- Reverting `ordered → required` on document deletion (decision 2).
- A DB trigger (Approach B).
- An Ordered-date column in the report (decision 6 — recorded + shown in the grid only).
- Any change to `received` / `by_tenant` handling.
