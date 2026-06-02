# Materials shop drawings → one-step handover

**Date:** 2026-06-02
**Status:** Approved (design) — implementation plan to follow
**Branch:** `feat/materials-shop-drawings-handover`

## Problem

On the Materials tab, each order item has a single Shop Drawing slot (DB-enforced
`UNIQUE (node_order_id, doc_type)` on `structure.node_order_documents`; re-upload
*replaces*). Two needs:

1. An item must carry **more than one** shop drawing.
2. Approved drawings must be **reflected in the Handover pack** so that receipt,
   approval, and record-keeping happen in **one process**, without re-uploading or
   manually filing into the handover folder tree.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| What "multiple" means | **Several distinct drawings** per item (a list), not a revision stack. |
| Per-drawing tracking | **Single progressing status:** `awaiting → received → approved`. No reject/resubmit state. |
| Handover reflection | **Auto-file into the matching category folder** on approval; rides the existing handover cloud-mirror path. |
| Category routing | **Auto-map by item type** (code default map) **with override** (prompt-once-and-remember for unmapped types). |
| Foundation | **Dedicated table** for shop drawings (not extending `node_order_documents`). |

The whole flow lives on the **Materials tab**: add drawings → advance status →
on `approved`, the drawing auto-becomes a handover document. The user never opens
the Handover tab to file anything.

## Data model

### New table: `structure.node_order_shop_drawings`

One row per drawing.

| Column | Notes |
|---|---|
| `id` UUID PK | |
| `node_order_id` UUID NOT NULL → `structure.node_orders(id)` ON DELETE CASCADE | |
| `project_id` UUID NOT NULL | denormalised for RLS/queries (matches `node_orders`) |
| `organisation_id` UUID NOT NULL | |
| `storage_path` TEXT NOT NULL | reuses the existing `node-order-documents` bucket |
| `file_name` TEXT NOT NULL | |
| `title` TEXT | optional human title; defaults to `file_name` |
| `status` TEXT NOT NULL DEFAULT `'awaiting'` CHECK in (`awaiting`,`received`,`approved`) | |
| `received_at` TIMESTAMPTZ | |
| `approved_at` TIMESTAMPTZ | |
| `approved_by` UUID → `public.profiles(id)` | |
| `handover_document_id` UUID → `tenants.documents(id)` ON DELETE SET NULL | the auto-filed handover doc; NULL until approved; idempotency guard |
| `uploaded_by` UUID → `public.profiles(id)` | |
| `created_at`, `updated_at` TIMESTAMPTZ | `set_updated_at` trigger |

- **No unique constraint** on `node_order_id` → multiple drawings per item.
- RLS + storage conventions copied from `node_order_documents` (migration 00086):
  org members + project-scoped client viewers can read; `user_can_manage_project`
  can write.

### `structure.node_order_documents` — left for Quote + Order Instruction

- Untouched structurally except: tighten `doc_type` CHECK to (`quote`,`order_instruction`).
- **Data migration:** move existing `doc_type='shop_drawing'` rows into the new
  table, seeded `status='received'` (the file demonstrably exists; never assume
  `approved`). Carry over `storage_path`, `file_name`, `uploaded_by`, timestamps.

### Storage

Reuse the existing `node-order-documents` bucket and path convention
`{projectId}/{nodeOrderId}/shop_drawing/{timestamp}-{filename}`. No new bucket.

## Category map (auto + override)

Code-level default map covers every known type:

| Item type | → Handover category |
|---|---|
| `main_board`, `common_area_board`, `tenant_db`, scope `db` | `main_boards` |
| `rmu` | `switchgear` |
| `mini_sub` | `transformers` |
| `generator` | `generators` |
| scope `lighting` | `lighting` |
| `custom` / any org-added scope type | none → **prompt once, then remembered** |

Resolver order: **override table → code default → prompt the user**. When an
unmapped type is approved, the UI asks for the category once and stores it as an
override for that type (keyed by equipment `kind` or scope-type key at org level).
A settings editor for the map is an optional later follow-on, not core.

## Materials UI

- The single Shop Drawing slot becomes a **drawings list** on the order row:
  - per drawing: filename (click to view) · colour **status chip** · an action
    that advances status (`Mark received` → `Mark approved`).
  - a **"+ Add drawing"** button.
  - once approved: green chip + "Filed to Handover › *<Category>*" link.
  - remove action (confirm).
- Quote and Order Instruction slots are unchanged (single).

## Approval → handover bridge

On **Mark approved**, the server action atomically:

1. Set `status='approved'`, stamp `approved_at`/`approved_by`.
2. Resolve target category (override → default → prompt).
3. Ensure that category's handover folder exists (create from existing template if
   missing).
4. Create one `tenants.documents` row in that folder
   (`handover_folder_id`, `handover_category`), named with the item label
   (e.g. *"Main Board A — GA Layout.pdf"*); record its id on `handover_document_id`.
5. The document mirrors to the client's cloud via the **same handover path as every
   other handover doc** — no special-casing.

**Idempotent & reversible:**
- Re-approving is a no-op when `handover_document_id` is already set.
- Un-approving or deleting a drawing deletes the linked handover document (cloud
  removal best-effort) and clears the link, so handover never lies.

## Permissions

- Add / advance / approve / remove → `user_can_manage_project` (the gate the
  storage RLS already uses).
- Read-only and tenant viewers **see** drawings + statuses, cannot change them.

## Error handling

- Unmapped type → prompt; never silently misfile.
- If folder creation or the handover-doc insert fails → approval is **not**
  committed (status stays `received`, clear error). No half-applied state.
- Removal authoritative in-app/DB, best-effort in cloud (matches existing behaviour).

## Verification plan

- Migration applies; existing shop-drawing rows back-migrated as `received`;
  `node_order_documents` CHECK tightened.
- Resolver returns the correct category per known type and prompts on unknowns.
- Approve creates exactly one handover document, sets the link, is idempotent on
  re-approve.
- Un-approve / remove deletes the linked handover document and clears the link.
- RLS: managers can mutate; viewers read-only.
- End-to-end: approve a drawing in Materials → it appears in the Handover tab under
  the right category.

## Out of scope (deliberately)

- Revision history per drawing.
- Reject / "revise & resubmit" status.
- Manual drag-drop handover filing UI.
- Retroactively pushing previously-approved drawings to cloud.

## Open implementation detail (to confirm during planning)

Whether a `tenants.documents` handover row can **reference** the file already in the
`node-order-documents` bucket, or whether approval must **copy** it into the handover
documents bucket. Both yield identical UX; a copy is a cheap server-side operation if
required. Resolve before writing the migration/actions.
