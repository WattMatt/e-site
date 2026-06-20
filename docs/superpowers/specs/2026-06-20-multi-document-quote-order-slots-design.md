# Multi-document Quote & Order Instruction slots

**Date:** 2026-06-20
**Status:** Approved (design) — pending implementation plan
**Area:** Equipment & Materials tab (board-centric procurement view)

## Problem

In the Equipment & Materials tab, each board (`structure.node_orders`) has three
document areas:

| Area | Behaviour today | Backed by |
|---|---|---|
| **Quote** | Single file — re-upload **replaces** it | `structure.node_order_documents` |
| **Order Instruction** | Single file — re-upload **replaces** it | `structure.node_order_documents` |
| **Shop Drawings** | Already **multi-file** (append + approval workflow) | `structure.node_order_shop_drawings` |

The single-file Quote and Order Instruction slots can't represent real
procurement situations:

- **More than one supplier** for an item (e.g. lighting) — several quotes need to
  sit side-by-side, told apart by supplier.
- **Updates / revisions** — a newer file currently silently overwrites the old
  one (`UNIQUE (node_order_id, doc_type)`), destroying the revision trail.
- **Variations on boards that isolate only the change** — a variation document
  needs to attach to an order without overwriting the original instruction.

## Goal

Make the **Quote** and **Order Instruction** slots hold **multiple labelled
documents**. Shop Drawings are already multi-file and are out of scope.

## Decisions (locked in during brainstorming)

1. **Scope:** Both Quote and Order Instruction become multi-document.
2. **Model:** A **labelled list** — each document carries an optional free-text
   label (supplier or note) and a **kind** tag: `original` / `revision` /
   `variation`. No auto-versioning.
3. **No "current/accepted" marker** — all documents in a slot are equal; the
   labels and kind tags carry the meaning. Newest on top.
4. **Same kind set for both slots** (`original` / `revision` / `variation`) —
   uniform and simpler, even though "variation" reads more naturally on orders.
5. **Inline label/kind editing** rather than a capture-at-upload modal — fewer
   clicks and lets a mistyped supplier name be fixed without delete-and-re-add.

Scenario mapping:
- Multiple lighting suppliers → several rows, `kind='original'`,
  `label='Supplier A' / 'Supplier B' / …`
- Update / revision → new row, `kind='revision'` (original is **not** wiped)
- Variation isolating only the change → new row, `kind='variation'`

## Design

### 1. Data model — one non-destructive migration

Current table (`apps/edge-functions/supabase/migrations/00086_node_order_documents.sql`):

```sql
CREATE TABLE structure.node_order_documents (
    id, node_order_id,
    doc_type TEXT CHECK (doc_type IN ('quote','order_instruction','shop_drawing')),
    storage_path, file_name, uploaded_by, created_at, updated_at,
    UNIQUE (node_order_id, doc_type)   -- the blocker
);
```

New migration `00141_node_order_documents_multi.sql` (00140 is the latest on
`origin/main`):

- **Drop** `UNIQUE (node_order_id, doc_type)` → many rows per slot allowed.
- **Add** `label TEXT` (nullable).
- **Add** `kind TEXT NOT NULL DEFAULT 'original'` + a CHECK constraint
  `kind IN ('original','revision','variation')`.
- `doc_type` is unchanged — still the slot discriminator (`quote` /
  `order_instruction`). (`shop_drawing` remains in the CHECK but is unused — shop
  drawings live in `node_order_shop_drawings`.)

Existing rows are preserved untouched: each becomes `kind='original'`,
`label=NULL`. No data is moved or deleted, so this is safe against the live
WM/prod data.

### 2. Server actions — `apps/web/src/actions/node-order-document.actions.ts`

Today a single action *replaces* the file (delete-then-insert, plus storage
cleanup). Replace that behaviour with append + edit + delete (all keyed by
document id):

- `addNodeOrderDocumentAction(projectId, nodeOrderId, docType, storagePath, fileName, label?, kind?)`
  — **inserts** a row (append, not replace). Defaults `kind='original'`,
  `label=null`.
- `updateNodeOrderDocumentMetaAction(projectId, documentId, { label, kind })`
  — edits an existing row's `label` + `kind` (new `structurePatch` PATCH helper).
- `deleteNodeOrderDocumentAction(projectId, documentId)` — looks up the row's
  `node_order_id` + `storage_path`, verifies the order belongs to the project,
  removes the DB row **and** the storage object.

The old `attachNodeOrderDocumentAction` (replace) and
`clearNodeOrderDocumentAction` (clear-by-slot) are removed. Their only caller is
`UnifiedDocSlot.tsx`. `getNodeOrderDocumentSignedUrlAction` is reused unchanged.

### 3. Data shaping — types + loaders

- `OrderDoc` (`_lib/order-types.ts`) gains `id`, `label: string | null`, and
  `kind: OrderDocKind` (`'original' | 'revision' | 'variation'`).
- `ProcLine.documents` (`_lib/gather-unified-boards.ts`) becomes
  `{ quote: OrderDoc[]; order_instruction: OrderDoc[] }` (arrays, not single).
- Both `EMPTY_DOCS` definitions (gather + `page.tsx`) return `{ quote: [],
  order_instruction: [] }`.
- The `page.tsx` loader selects `id, label, kind, created_at` as well, orders
  `created_at desc` (newest first), and **pushes** into the per-slot arrays.

### 4. UI — `_components/UnifiedDocSlot.tsx`

The slot becomes a small **list**, modelled on `UnifiedShopDrawingList.tsx`. Prop
changes from `doc: OrderDoc | null` to `docs: OrderDoc[]`. Per row:

- file name (opens the existing `DocumentPreviewModal`) + **download**
- inline **kind** `<select>` (Original / Revision / Variation) — shows and edits,
  saves via `updateNodeOrderDocumentMetaAction`
- inline **supplier/note** text input — saves on blur via the same action
- **delete** (`deleteNodeOrderDocumentAction`)

Newest on top. An **"+ Add document"** button uploads through the existing
`/api/node-order-documents` route as `kind='original'`, then the new row appears
for inline tagging.

`BoardDetail.tsx` passes `docs={line.documents.quote}` /
`docs={line.documents.order_instruction}`.

### 5. Deliberately unchanged

- **Storage:** same `node-order-documents` bucket, same path convention
  `{projectId}/{nodeOrderId}/{docType}/{ts}-{filename}` — the timestamp already
  prevents collisions between multiple files in a slot.
- **API upload route** (`/api/node-order-documents/route.ts`): unchanged.
- **RLS / storage policies:** untouched — the existing insert/update/delete
  policies already permit additional rows; the service-role actions self-guard.
- **Shop Drawings** (`node_order_shop_drawings` + `UnifiedShopDrawingList`):
  untouched.

## Testing / verification

- Migration applies cleanly; existing single documents survive as
  `kind='original'`, `label=NULL`, and remain downloadable.
- `gatherUnifiedBoards` carries multiple labelled docs per slot (unit test).
- Upload three quotes with different supplier labels → all three persist and
  list under the Quote slot.
- Add a `revision` to an Order Instruction → the original row stays.
- Add a `variation` → it lists alongside the original.
- Delete one document → its storage object is removed (no orphan) and the others
  remain.
- Edit a label/kind inline → change persists after reload.

## Out of scope

- Any change to Shop Drawings.
- A "current/accepted" document marker or auto-versioning.
- Feeding quotes/order-instructions into the handover system.
- Consolidating `UnifiedDocSlot` and `UnifiedShopDrawingList` into one shared
  component (note the similarity; do not refactor now).
