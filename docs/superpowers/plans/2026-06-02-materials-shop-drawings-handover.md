# Materials Shop Drawings → One-Step Handover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a material order carry many shop drawings, each with a progressing status (awaiting → received → approved); on approval, auto-file the drawing into the matching Handover category folder as a `tenants.documents` row — all from the Materials tab.

**Architecture:** A new `structure.node_order_shop_drawings` table (one row per drawing) replaces the single `shop_drawing` slot of `node_order_documents`. Writes to `structure.*` use the raw-PostgREST + service-role pattern (the schema is not PostgREST-exposed); the handover document write uses the cookie client against `tenants.documents`. On approval the file is copied from the `node-order-documents` bucket to the `project-documents` bucket at the handover path. Category routing is a pure resolver (code defaults + per-type/per-node override columns) unit-tested with Vitest.

**Tech Stack:** Next.js App Router (RSC + `'use client'`), TypeScript, Supabase (Postgres + Storage), Zod, Vitest, pnpm + Turbo.

**Spec:** `docs/superpowers/specs/2026-06-02-materials-shop-drawings-handover-design.md`

---

## Conventions captured from the codebase (read before starting)

- **`structure.*` writes:** raw `fetch` to `${SUPABASE_URL}/rest/v1/<table>` with headers `apikey`, `Authorization: Bearer <service key>`, `Content-Type: application/json`, `Content-Profile: structure`, `Prefer`. There is **no shared helper module** — each action file declares its own `structureInsert`/`structurePatch`/`structureDelete`. Reads use the cookie client cast `(supabase as never as { schema: (s: string) => { from: (t: string) => any } }).schema('structure').from(...)`.
- **`tenants.*` writes:** cookie client `(supabase as any).schema('tenants').from(...).insert(...)`.
- **Buckets:** drawings → `node-order-documents`; handover docs → `project-documents`.
- **Auth guard:** each action file declares a local `guardProjectAccess(projectId)`; manage-vs-view is enforced in Postgres (`public.user_can_manage_project` for write policies, `public.user_has_project_access` for read).
- **Mutations from the client:** file upload → `fetch('/api/node-order-documents', { method:'POST', body: FormData })`; data mutations → call the `'use server'` action directly; both finalised with `startTransition(() => router.refresh())`. Result shape is a discriminated union `{ ok: true } | { error: string }`, checked with `'error' in result`.
- **Styling:** inline `style={{…}}` with `var(--c-*)` tokens; status pills use the shared `Badge` component (`variant`: `warning`=amber, `info`=blue, `success`=green, `ghost`=muted).
- **Migrations:** `apps/edge-functions/supabase/migrations/NNNNN_snake_case.sql`, next number **`00115`**. Apply with `pnpm db:migrate` (`supabase db push`). The `structure` schema is **not** in PostgREST's exposed schemas, so `pnpm db:gen-types` will **not** include these tables — no type-gen step is needed (the code uses `(supabase as never as …)` casts).
- **Tests:** Vitest, `apps/web` (jsdom) and `packages/shared`. Only pure functions are unit-tested in this repo. Run a single file: `pnpm exec vitest run <path>` from inside the package. Lint/type gate: `pnpm lint && pnpm type-check` from repo root.

> ⚠️ **Shared-database caution.** `pnpm db:migrate` pushes to the linked Supabase project. Confirm with the user whether to apply against a local stack (`pnpm db:reset`) first or push directly, per their drive-to-production cadence, **before** running it. Do not push silently.

---

## File Structure

**Create:**
- `apps/edge-functions/supabase/migrations/00115_node_order_shop_drawings.sql` — new table, two override columns, data migration, CHECK tightening.
- `packages/shared/src/services/handover/category-map.ts` — pure category resolver + handover filename builder.
- `packages/shared/src/services/handover/category-map.test.ts` — Vitest unit tests.
- `packages/shared/src/structure/shop-drawing-status.ts` — pure status-transition helpers.
- `packages/shared/src/structure/shop-drawing-status.test.ts` — Vitest unit tests.
- `apps/web/src/actions/node-order-shop-drawing.actions.ts` — add / markReceived / approve(+auto-file) / revert / remove / signedUrl server actions.
- `apps/web/src/app/(admin)/projects/[id]/materials/_components/ShopDrawingList.tsx` — multi-drawing client UI (replaces the single shop-drawing slot).

**Modify:**
- `packages/shared/src/index.ts` — barrel-export the new pure modules.
- `apps/web/src/app/(admin)/projects/[id]/materials/_components/OrderRow.tsx` — render `ShopDrawingList` instead of the `shop_drawing` `OrderDocSlot`; change `documents.shop_drawing` → `shopDrawings: ShopDrawing[]`.
- `apps/web/src/app/(admin)/projects/[id]/materials/page.tsx` — fetch `node_order_shop_drawings`, stop mapping `shop_drawing` from `node_order_documents`, populate `shopDrawings`.

**Reused unchanged:** `apps/web/src/app/api/node-order-documents/route.ts` (the POST already accepts `docType='shop_drawing'` and writes a uniquely-timestamped path, so multiple uploads never collide).

---

## Task 1: Migration — new table, override columns, data migration

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00115_node_order_shop_drawings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00115 — structure.node_order_shop_drawings + handover routing
-- =============================================================================
-- Promotes the single shop-drawing slot of node_order_documents into a
-- first-class, multi-row table with a progressing status
-- (awaiting → received → approved) and a link to the handover document the
-- approval creates. Adds two nullable handover-routing override columns.
--
-- Mirrors the RLS + bucket conventions of 00086 (node_order_documents) and
-- reuses the existing structure.node_order_project_id() SECURITY DEFINER
-- helper and the 'node-order-documents' storage bucket.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS throughout.
-- =============================================================================

-- ── 1. node_order_shop_drawings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS structure.node_order_shop_drawings (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_order_id         UUID        NOT NULL REFERENCES structure.node_orders(id) ON DELETE CASCADE,
    storage_path          TEXT        NOT NULL,
    file_name             TEXT        NOT NULL,
    title                 TEXT,
    status                TEXT        NOT NULL DEFAULT 'awaiting'
                                      CHECK (status IN ('awaiting', 'received', 'approved')),
    received_at           TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    approved_by           UUID,
    -- The tenants.documents row created on approval. Plain UUID (no cross-schema
    -- FK), matching node_order_documents.uploaded_by. NULL until approved;
    -- doubles as the idempotency guard (set → re-approve is a no-op).
    handover_document_id  UUID,
    -- Category the drawing was filed into — display mirror for the
    -- "Filed › <Category>" chip; set on approval, cleared on revert.
    handover_category     TEXT,
    uploaded_by           UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    -- No UNIQUE on node_order_id — many drawings per order.
);

CREATE INDEX IF NOT EXISTS idx_node_order_shop_drawings_order
    ON structure.node_order_shop_drawings (node_order_id);

DROP TRIGGER IF EXISTS node_order_shop_drawings_updated_at ON structure.node_order_shop_drawings;
CREATE TRIGGER node_order_shop_drawings_updated_at
    BEFORE UPDATE ON structure.node_order_shop_drawings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS — node_order_shop_drawings (reuses structure.node_order_project_id) ─
ALTER TABLE structure.node_order_shop_drawings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_order_shop_drawings_select ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_select ON structure.node_order_shop_drawings
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_insert ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_insert ON structure.node_order_shop_drawings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_update ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_update ON structure.node_order_shop_drawings
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

DROP POLICY IF EXISTS node_order_shop_drawings_delete ON structure.node_order_shop_drawings;
CREATE POLICY node_order_shop_drawings_delete ON structure.node_order_shop_drawings
  FOR DELETE TO authenticated
  USING (public.user_can_manage_project(structure.node_order_project_id(node_order_id)));

-- ── 3. Handover-routing override columns ─────────────────────────────────────
-- Equipment orders (one order per node) remember their category on the node;
-- tenant scope orders remember per scope-item-type (one node can host a DB and
-- a Lighting order, which must route differently). Built-in types resolve from
-- code defaults and never need these set.
ALTER TABLE structure.nodes
    ADD COLUMN IF NOT EXISTS handover_category TEXT;
ALTER TABLE structure.scope_item_types
    ADD COLUMN IF NOT EXISTS handover_category TEXT;

-- ── 4. Back-migrate existing single shop drawings ────────────────────────────
-- The file demonstrably exists, so seed status 'received' (never assume approval).
INSERT INTO structure.node_order_shop_drawings
    (node_order_id, storage_path, file_name, status, received_at, uploaded_by, created_at)
SELECT
    d.node_order_id, d.storage_path, d.file_name, 'received', d.created_at, d.uploaded_by, d.created_at
FROM structure.node_order_documents d
WHERE d.doc_type = 'shop_drawing';

DELETE FROM structure.node_order_documents WHERE doc_type = 'shop_drawing';

-- ── 5. Tighten node_order_documents to the two remaining single slots ─────────
-- Inline CHECK constraints are auto-named <table>_<col>_check. Drop + re-add.
ALTER TABLE structure.node_order_documents
    DROP CONSTRAINT IF EXISTS node_order_documents_doc_type_check;
ALTER TABLE structure.node_order_documents
    ADD CONSTRAINT node_order_documents_doc_type_check
    CHECK (doc_type IN ('quote', 'order_instruction'));
```

- [ ] **Step 2: Verify the constraint name before relying on the DROP**

The auto-generated CHECK name is conventionally `node_order_documents_doc_type_check`. Confirm against the live schema (psql or Supabase Studio):

Run: `cd apps/edge-functions && supabase db reset` (local stack) **or** ask the user to confirm the name in Studio if pushing to the shared DB.
Expected: reset applies all migrations 00001→00115 with no error. If the DROP/ADD fails with "constraint does not exist", the inline name differs — query `information_schema.table_constraints` for the real name and update the migration.

- [ ] **Step 3: Apply the migration** (after the shared-DB confirmation above)

Run: `pnpm db:migrate`
Expected: `supabase db push` reports migration 00115 applied. No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00115_node_order_shop_drawings.sql
git commit -m "feat(db): node_order_shop_drawings table + handover routing columns (00115)"
```

---

## Task 2: Pure category resolver + handover filename (TDD)

**Files:**
- Create: `packages/shared/src/services/handover/category-map.ts`
- Test: `packages/shared/src/services/handover/category-map.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveHandoverCategory, buildHandoverDrawingName } from './category-map'

describe('resolveHandoverCategory', () => {
  it('maps built-in equipment kinds', () => {
    expect(resolveHandoverCategory({ kind: 'main_board' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'common_area_board' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'tenant_db' })).toBe('main_boards')
    expect(resolveHandoverCategory({ kind: 'rmu' })).toBe('switchgear')
    expect(resolveHandoverCategory({ kind: 'mini_sub' })).toBe('transformers')
    expect(resolveHandoverCategory({ kind: 'generator' })).toBe('generators')
  })

  it('maps built-in scope keys', () => {
    expect(resolveHandoverCategory({ scopeKey: 'db' })).toBe('main_boards')
    expect(resolveHandoverCategory({ scopeKey: 'lighting' })).toBe('lighting')
  })

  it('returns null for unmapped types (caller must prompt)', () => {
    expect(resolveHandoverCategory({ kind: 'custom' })).toBeNull()
    expect(resolveHandoverCategory({ scopeKey: 'small_power' })).toBeNull()
    expect(resolveHandoverCategory({})).toBeNull()
  })

  it('scope override beats the scope default', () => {
    expect(
      resolveHandoverCategory({ scopeKey: 'db', scopeTypeOverride: 'metering' }),
    ).toBe('metering')
  })

  it('node override beats the equipment default', () => {
    expect(
      resolveHandoverCategory({ kind: 'generator', nodeOverride: 'commissioning_docs' }),
    ).toBe('commissioning_docs')
  })

  it('a scope order ignores the node override (avoids mis-routing mixed nodes)', () => {
    expect(
      resolveHandoverCategory({ scopeKey: 'db', nodeOverride: 'lighting' }),
    ).toBe('main_boards')
  })

  it('ignores invalid override strings', () => {
    expect(resolveHandoverCategory({ kind: 'generator', nodeOverride: 'not_a_category' })).toBe('generators')
    expect(resolveHandoverCategory({ kind: 'custom', nodeOverride: '' })).toBeNull()
  })
})

describe('buildHandoverDrawingName', () => {
  it('prefixes the item label', () => {
    expect(buildHandoverDrawingName('Main Board A', 'ga.pdf')).toBe('Main Board A — ga.pdf')
  })
  it('does not double-prefix', () => {
    expect(buildHandoverDrawingName('Main Board A', 'Main Board A — ga.pdf')).toBe('Main Board A — ga.pdf')
  })
  it('falls back to the file name when the label is blank', () => {
    expect(buildHandoverDrawingName('   ', 'ga.pdf')).toBe('ga.pdf')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/services/handover/category-map.test.ts`
Expected: FAIL — `Failed to resolve import './category-map'`.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * category-map.ts — pure handover-routing logic for material-order shop
 * drawings. No DB, no I/O. Decides which of the 13 handover categories an
 * approved drawing files into, from the order's item type plus optional
 * per-type / per-node overrides.
 */

import { ALL_CATEGORIES, type HandoverCategory } from './folder-templates'

/** Built-in equipment node `kind` → handover category. */
const EQUIPMENT_KIND_CATEGORY: Record<string, HandoverCategory> = {
  main_board: 'main_boards',
  common_area_board: 'main_boards',
  tenant_db: 'main_boards',
  rmu: 'switchgear',
  mini_sub: 'transformers',
  generator: 'generators',
}

/** Built-in scope-item-type key → handover category. */
const SCOPE_KEY_CATEGORY: Record<string, HandoverCategory> = {
  db: 'main_boards',
  lighting: 'lighting',
}

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES)

function asCategory(value: string | null | undefined): HandoverCategory | null {
  return value && VALID_CATEGORIES.has(value) ? (value as HandoverCategory) : null
}

export interface CategoryResolutionInput {
  /** Scope-item-type key — present when the order is a tenant scope order. */
  scopeKey?: string | null
  /** structure.scope_item_types.handover_category — per-type override. */
  scopeTypeOverride?: string | null
  /** Equipment node kind — present when the order is an equipment order. */
  kind?: string | null
  /** structure.nodes.handover_category — per-node override (equipment only). */
  nodeOverride?: string | null
}

/**
 * Resolve the handover category for an order's shop drawing.
 *
 * Scope orders:     scopeTypeOverride → scope default → null.
 * Equipment orders: nodeOverride      → kind default  → null.
 *
 * A scope order never consults the node override — one tenant node can host
 * both a DB and a Lighting order, which must route to different categories.
 * Returns null when nothing maps; the caller then prompts the user.
 */
export function resolveHandoverCategory(input: CategoryResolutionInput): HandoverCategory | null {
  if (input.scopeKey) {
    return asCategory(input.scopeTypeOverride) ?? SCOPE_KEY_CATEGORY[input.scopeKey] ?? null
  }
  if (input.kind) {
    return asCategory(input.nodeOverride) ?? EQUIPMENT_KIND_CATEGORY[input.kind] ?? null
  }
  return null
}

/** Prefix a drawing's file name with its order label for the handover pack. */
export function buildHandoverDrawingName(itemLabel: string, fileName: string): string {
  const label = itemLabel.trim()
  if (!label) return fileName
  const prefix = `${label} — `
  return fileName.startsWith(prefix) ? fileName : `${prefix}${fileName}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/services/handover/category-map.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/handover/category-map.ts packages/shared/src/services/handover/category-map.test.ts
git commit -m "feat(shared): pure handover category resolver + drawing name builder"
```

---

## Task 3: Pure status-transition helpers (TDD)

**Files:**
- Create: `packages/shared/src/structure/shop-drawing-status.ts`
- Test: `packages/shared/src/structure/shop-drawing-status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import {
  type ShopDrawingStatus,
  nextStatus,
  prevStatus,
  canAdvanceTo,
} from './shop-drawing-status'

describe('shop-drawing-status', () => {
  it('advances forward awaiting → received → approved', () => {
    expect(nextStatus('awaiting')).toBe('received')
    expect(nextStatus('received')).toBe('approved')
    expect(nextStatus('approved')).toBeNull()
  })

  it('steps backward approved → received → awaiting', () => {
    expect(prevStatus('approved')).toBe('received')
    expect(prevStatus('received')).toBe('awaiting')
    expect(prevStatus('awaiting')).toBeNull()
  })

  it('canAdvanceTo enforces single-step forward moves only', () => {
    expect(canAdvanceTo('awaiting', 'received')).toBe(true)
    expect(canAdvanceTo('received', 'approved')).toBe(true)
    expect(canAdvanceTo('awaiting', 'approved')).toBe(false) // can't skip
    expect(canAdvanceTo('received', 'received')).toBe(false) // no-op
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/structure/shop-drawing-status.test.ts`
Expected: FAIL — `Failed to resolve import './shop-drawing-status'`.

- [ ] **Step 3: Write the implementation**

```typescript
/** Pure status-lifecycle helpers for material-order shop drawings. */

export type ShopDrawingStatus = 'awaiting' | 'received' | 'approved'

const FORWARD: Record<ShopDrawingStatus, ShopDrawingStatus | null> = {
  awaiting: 'received',
  received: 'approved',
  approved: null,
}

const BACKWARD: Record<ShopDrawingStatus, ShopDrawingStatus | null> = {
  awaiting: null,
  received: 'awaiting',
  approved: 'received',
}

export function nextStatus(s: ShopDrawingStatus): ShopDrawingStatus | null {
  return FORWARD[s]
}

export function prevStatus(s: ShopDrawingStatus): ShopDrawingStatus | null {
  return BACKWARD[s]
}

/** True only for a single forward step (no skipping, no no-ops). */
export function canAdvanceTo(from: ShopDrawingStatus, to: ShopDrawingStatus): boolean {
  return FORWARD[from] === to
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/structure/shop-drawing-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/structure/shop-drawing-status.ts packages/shared/src/structure/shop-drawing-status.test.ts
git commit -m "feat(shared): pure shop-drawing status transition helpers"
```

---

## Task 4: Barrel-export the new shared modules

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the exports**

Open `packages/shared/src/index.ts` and add these lines alongside the existing `export … from './services/handover/…'` / `export … from './structure/…'` lines (match the file's existing export style — `export *` vs named):

```typescript
export * from './services/handover/category-map'
export * from './structure/shop-drawing-status'
```

If `folder-templates` is not already re-exported (the handover UI imports `CATEGORY_LABELS`/`HandoverCategory`, so it likely is), also add:

```typescript
export * from './services/handover/folder-templates'
```

- [ ] **Step 2: Verify the package type-checks and the symbols resolve**

Run: `cd packages/shared && pnpm exec vitest run src/services/handover/category-map.test.ts src/structure/shop-drawing-status.test.ts`
Expected: PASS (imports resolve through the package).

Run: `pnpm type-check` (from repo root)
Expected: PASS — no unresolved `@esite/shared` exports.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): export handover category-map + shop-drawing-status"
```

---

## Task 5: Server actions — add / status / approve(+auto-file) / revert / remove / signed URL

**Files:**
- Create: `apps/web/src/actions/node-order-shop-drawing.actions.ts`

This file mirrors `node-order-document.actions.ts` (structure raw-fetch helpers + `guardProjectAccess`) and the `tenants.documents` insert from `handover.actions.ts`. No unit test — verified by `pnpm type-check`/`pnpm lint` (Task 8) and the manual checklist (Task 9), matching the repo's posture for DB-touching actions.

- [ ] **Step 1: Write the full action file**

```typescript
'use server'

/**
 * node-order-shop-drawing.actions.ts — server actions for the multi shop-drawing
 * workflow on a material order.
 *
 *   - addShopDrawingAction          — record an uploaded drawing (status 'awaiting')
 *   - markShopDrawingReceivedAction — awaiting → received
 *   - approveShopDrawingAction      — received → approved + auto-file into handover
 *   - revertShopDrawingAction       — step status back one stage (un-files if leaving 'approved')
 *   - removeShopDrawingAction       — delete drawing (+ linked handover doc if approved)
 *   - getShopDrawingSignedUrlAction — short-lived signed URL for view/download
 *
 * structure.* writes use raw PostgREST + service-role (schema not PostgREST-
 * exposed). The handover document (tenants.documents) is written with the
 * cookie client. Approval copies the file from the node-order-documents bucket
 * to the project-documents bucket at the handover path.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  projectService,
  resolveHandoverCategory,
  buildHandoverDrawingName,
  ALL_CATEGORIES,
  type HandoverCategory,
} from '@esite/shared'

const DRAWINGS_BUCKET = 'node-order-documents'
const HANDOVER_BUCKET = 'project-documents'
const uuidSchema = z.string().uuid()
const categorySchema = z.enum(ALL_CATEGORIES as [HandoverCategory, ...HandoverCategory[]])

// ---------------------------------------------------------------------------
// structure.* raw-fetch helpers (local copy — no shared module exists)
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string, prefer = 'return=minimal'): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: prefer,
  }
}

async function structureInsertReturningId(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey, 'return=representation'),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  const rows = (await res.json()) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}

async function structureDelete(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: structureHeaders(serviceKey),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Guards + env
// ---------------------------------------------------------------------------

async function guardProjectAccess(projectId: string): Promise<
  | { error: string; user?: undefined; orgId?: undefined; supabase?: undefined }
  | { error?: undefined; user: { id: string }; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }
  return { user: { id: user.id }, orgId: (project as { organisation_id: string }).organisation_id, supabase }
}

function serviceEnv(): { url: string; key: string } | { error: string } {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return { error: 'Server misconfigured' }
  return { url, key }
}

type SchemaClient = { schema: (s: string) => { from: (t: string) => any } }

interface DrawingContext {
  drawing: { id: string; node_order_id: string; status: string; storage_path: string; file_name: string; handover_document_id: string | null }
  order: { id: string; node_id: string; scope_item_type_id: string | null; label: string }
  node: { kind: string | null; handover_category: string | null } | null
  scopeKey: string | null
  scopeTypeOverride: string | null
}

/** Load a drawing + its order/node/scope context, asserting project ownership. */
async function loadDrawingContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  drawingId: string,
  projectId: string,
): Promise<{ ctx: DrawingContext } | { error: string }> {
  const sc = supabase as never as SchemaClient
  const { data: drawing } = await sc
    .schema('structure')
    .from('node_order_shop_drawings')
    .select('id, node_order_id, status, storage_path, file_name, handover_document_id')
    .eq('id', drawingId)
    .maybeSingle()
  if (!drawing) return { error: 'Drawing not found' }

  const { data: order } = await sc
    .schema('structure')
    .from('node_orders')
    .select('id, node_id, scope_item_type_id, label, project_id')
    .eq('id', drawing.node_order_id)
    .maybeSingle()
  if (!order || order.project_id !== projectId) return { error: 'Drawing does not belong to this project' }

  const { data: node } = await sc
    .schema('structure')
    .from('nodes')
    .select('kind, handover_category')
    .eq('id', order.node_id)
    .maybeSingle()

  let scopeKey: string | null = null
  let scopeTypeOverride: string | null = null
  if (order.scope_item_type_id) {
    const { data: st } = await sc
      .schema('structure')
      .from('scope_item_types')
      .select('key, handover_category')
      .eq('id', order.scope_item_type_id)
      .maybeSingle()
    scopeKey = st?.key ?? null
    scopeTypeOverride = st?.handover_category ?? null
  }

  return {
    ctx: {
      drawing: drawing as DrawingContext['drawing'],
      order: order as DrawingContext['order'],
      node: (node as DrawingContext['node']) ?? null,
      scopeKey,
      scopeTypeOverride,
    },
  }
}

/** Find or create the category root handover folder; returns its id + path + org. */
async function ensureHandoverCategoryRoot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  projectId: string,
  category: HandoverCategory,
  userId: string,
): Promise<{ id: string; folder_path: string; organisation_id: string } | { error: string }> {
  const tc = supabase as never as { schema: (s: string) => { from: (t: string) => any } }
  const { data: existing } = await tc
    .schema('tenants')
    .from('handover_folders')
    .select('id, folder_path, organisation_id')
    .eq('project_id', projectId)
    .eq('category', category)
    .is('parent_folder_id', null)
    .maybeSingle()
  if (existing) return existing as { id: string; folder_path: string; organisation_id: string }

  const { data: inserted, error } = await tc
    .schema('tenants')
    .from('handover_folders')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      parent_folder_id: null,
      name: category, // root display name; subfolders not needed for filing
      category,
      cloud_provider: null,
      cloud_folder_id: null,
      cloud_folder_path: null,
      cloud_synced_at: null,
      created_by: userId,
    })
    .select('id, folder_path, organisation_id')
    .single()
  if (error || !inserted) return { error: `Failed to create handover folder: ${error?.message ?? 'unknown'}` }
  return inserted as { id: string; folder_path: string; organisation_id: string }
}

function revalidate(projectId: string): void {
  revalidatePath(`/projects/${projectId}/materials`)
  revalidatePath(`/projects/${projectId}/handover`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
}

// ---------------------------------------------------------------------------
// addShopDrawingAction
// ---------------------------------------------------------------------------

export type AddShopDrawingResult = { ok: true } | { error: string }

export async function addShopDrawingAction(
  projectId: string,
  nodeOrderId: string,
  storagePath: string,
  fileName: string,
): Promise<AddShopDrawingResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeOrderId: uuidSchema, storagePath: z.string().min(1), fileName: z.string().min(1).max(255) })
    .safeParse({ projectId, nodeOrderId, storagePath, fileName })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Confirm the order belongs to the project (RLS-gated cookie read).
  const { data: order } = await (guard.supabase as never as SchemaClient)
    .schema('structure')
    .from('node_orders')
    .select('id')
    .eq('id', nodeOrderId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!order) return { error: 'Node order not found' }

  const env = serviceEnv()
  if ('error' in env) return env

  const ins = await structureInsertReturningId(env.url, env.key, 'node_order_shop_drawings', {
    node_order_id: nodeOrderId,
    storage_path: parsed.data.storagePath,
    file_name: parsed.data.fileName,
    status: 'awaiting',
    uploaded_by: guard.user.id,
  })
  if (!ins.ok) return { error: ins.error ?? 'Failed to record drawing' }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// markShopDrawingReceivedAction
// ---------------------------------------------------------------------------

export type ShopDrawingStatusResult = { ok: true } | { error: string }

export async function markShopDrawingReceivedAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  if (loaded.ctx.drawing.status !== 'awaiting') {
    return { error: `Can only mark received from 'awaiting' (currently '${loaded.ctx.drawing.status}')` }
  }

  const env = serviceEnv()
  if ('error' in env) return env

  const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
    status: 'received',
    received_at: new Date().toISOString(),
  })
  if (!patch.ok) return { error: patch.error ?? 'Failed to mark received' }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// approveShopDrawingAction (+ auto-file into handover)
// ---------------------------------------------------------------------------

export type ApproveShopDrawingResult = { ok: true } | { needsCategory: true } | { error: string }

export async function approveShopDrawingAction(
  projectId: string,
  drawingId: string,
  categoryOverride?: string,
): Promise<ApproveShopDrawingResult> {
  const parsed = z
    .object({
      projectId: uuidSchema,
      drawingId: uuidSchema,
      categoryOverride: categorySchema.optional(),
    })
    .safeParse({ projectId, drawingId, categoryOverride })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  // Idempotent: already approved + filed → no-op success.
  if (ctx.drawing.status === 'approved' && ctx.drawing.handover_document_id) return { ok: true }
  if (ctx.drawing.status !== 'received') {
    return { error: `Can only approve from 'received' (currently '${ctx.drawing.status}')` }
  }

  const category =
    parsed.data.categoryOverride ??
    resolveHandoverCategory({
      scopeKey: ctx.scopeKey,
      scopeTypeOverride: ctx.scopeTypeOverride,
      kind: ctx.node?.kind,
      nodeOverride: ctx.node?.handover_category,
    })
  if (!category) return { needsCategory: true }

  const env = serviceEnv()
  if ('error' in env) return env

  // Remember an explicit choice for next time (per scope-type, else per node).
  if (parsed.data.categoryOverride) {
    if (ctx.scopeKey && ctx.order.scope_item_type_id) {
      await structurePatch(env.url, env.key, 'scope_item_types', `id=eq.${ctx.order.scope_item_type_id}`, { handover_category: category })
    } else {
      await structurePatch(env.url, env.key, 'nodes', `id=eq.${ctx.order.node_id}`, { handover_category: category })
    }
  }

  // Ensure the handover category folder exists.
  const folder = await ensureHandoverCategoryRoot(guard.supabase, guard.orgId, projectId, category, guard.user.id)
  if ('error' in folder) return folder

  // Copy the file: node-order-documents → project-documents (handover path).
  const cleanFolderPath = (folder.folder_path || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  const displayName = buildHandoverDrawingName(ctx.order.label, ctx.drawing.file_name)
  const safeName = displayName.replace(/[^a-zA-Z0-9._ -]/g, '_')
  const handoverPath = `${folder.organisation_id}/${projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}`

  const { data: blob, error: dlErr } = await guard.supabase.storage.from(DRAWINGS_BUCKET).download(ctx.drawing.storage_path)
  if (dlErr || !blob) return { error: `Could not read the drawing file: ${dlErr?.message ?? 'missing'}` }

  const { error: upErr } = await guard.supabase.storage
    .from(HANDOVER_BUCKET)
    .upload(handoverPath, blob, { contentType: blob.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `Could not copy the drawing into handover: ${upErr.message}` }

  // Insert the handover document row (cookie client, tenants schema).
  const { data: docRow, error: insErr } = await (guard.supabase as never as { schema: (s: string) => { from: (t: string) => any } })
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: projectId,
      name: safeName,
      category: 'handover',
      storage_path: handoverPath,
      mime_type: blob.type || null,
      size_bytes: blob.size,
      handover_folder_id: folder.id,
      handover_category: category,
      uploaded_by: guard.user.id,
    })
    .select('id')
    .single()
  if (insErr || !docRow) {
    await guard.supabase.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    return { error: `Handover document insert failed: ${insErr?.message ?? 'unknown'}` }
  }

  // Commit approval + link. Roll back the handover artefacts if this fails.
  const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: guard.user.id,
    handover_document_id: docRow.id,
    handover_category: category,
  })
  if (!patch.ok) {
    await (guard.supabase as never as { schema: (s: string) => { from: (t: string) => any } })
      .schema('tenants').from('documents').delete().eq('id', docRow.id)
    await guard.supabase.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    return { error: patch.error ?? 'Failed to commit approval' }
  }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// revertShopDrawingAction — step status back one stage
// ---------------------------------------------------------------------------

export async function revertShopDrawingAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  const env = serviceEnv()
  if ('error' in env) return env

  if (ctx.drawing.status === 'approved') {
    // Un-file: remove the handover document + its storage object, then step back.
    if (ctx.drawing.handover_document_id) {
      const { data: doc } = await (guard.supabase as never as SchemaClient)
        .schema('tenants').from('documents').select('storage_path').eq('id', ctx.drawing.handover_document_id).maybeSingle()
      await (guard.supabase as never as { schema: (s: string) => { from: (t: string) => any } })
        .schema('tenants').from('documents').delete().eq('id', ctx.drawing.handover_document_id)
      const path = (doc as { storage_path: string } | null)?.storage_path
      if (path) await guard.supabase.storage.from(HANDOVER_BUCKET).remove([path]).catch(() => undefined)
    }
    const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
      status: 'received', approved_at: null, approved_by: null, handover_document_id: null, handover_category: null,
    })
    if (!patch.ok) return { error: patch.error ?? 'Failed to revert approval' }
  } else if (ctx.drawing.status === 'received') {
    const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
      status: 'awaiting', received_at: null,
    })
    if (!patch.ok) return { error: patch.error ?? 'Failed to revert' }
  } else {
    return { error: "Drawing is already 'awaiting'" }
  }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// removeShopDrawingAction
// ---------------------------------------------------------------------------

export async function removeShopDrawingAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  const env = serviceEnv()
  if ('error' in env) return env

  // Remove the linked handover document first (DB row + storage object).
  if (ctx.drawing.handover_document_id) {
    const { data: doc } = await (guard.supabase as never as SchemaClient)
      .schema('tenants').from('documents').select('storage_path').eq('id', ctx.drawing.handover_document_id).maybeSingle()
    await (guard.supabase as never as { schema: (s: string) => { from: (t: string) => any } })
      .schema('tenants').from('documents').delete().eq('id', ctx.drawing.handover_document_id)
    const hPath = (doc as { storage_path: string } | null)?.storage_path
    if (hPath) await guard.supabase.storage.from(HANDOVER_BUCKET).remove([hPath]).catch(() => undefined)
  }

  // Delete the drawing row (source of truth), then the drawing storage object.
  const del = await structureDelete(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`)
  if (!del.ok) return { error: del.error ?? 'Failed to remove drawing' }
  await guard.supabase.storage.from(DRAWINGS_BUCKET).remove([ctx.drawing.storage_path]).catch(() => undefined)

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getShopDrawingSignedUrlAction
// ---------------------------------------------------------------------------

export type SignedUrlResult = { url: string } | { error: string }

export async function getShopDrawingSignedUrlAction(
  projectId: string,
  storagePath: string,
): Promise<SignedUrlResult> {
  const parsed = z.object({ projectId: uuidSchema, storagePath: z.string().min(1) }).safeParse({ projectId, storagePath })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const { data, error } = await guard.supabase.storage.from(DRAWINGS_BUCKET).createSignedUrl(storagePath, 300)
  if (error || !data?.signedUrl) return { error: error?.message ?? 'Could not generate signed URL' }
  return { url: data.signedUrl }
}
```

- [ ] **Step 2: Type-check the new file**

Run: `pnpm type-check` (repo root)
Expected: PASS. If `projectService.getById`'s return type doesn't expose `organisation_id`, keep the `(project as { organisation_id: string })` cast already in `guardProjectAccess` (mirrors `tenant-scope.actions.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/actions/node-order-shop-drawing.actions.ts
git commit -m "feat(materials): shop-drawing actions with handover auto-filing"
```

---

## Task 6: Client component — ShopDrawingList

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/materials/_components/ShopDrawingList.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

/**
 * ShopDrawingList — the multi shop-drawing control on a material-order row.
 *
 * Lists each drawing with a status chip (Awaiting/Received/Approved), advances
 * status, and uploads new drawings. Upload reuses the /api/node-order-documents
 * POST (docType='shop_drawing'); the DB row is then recorded via
 * addShopDrawingAction. Approving an unmapped item type prompts for a handover
 * category inline.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { CATEGORY_LABELS, ALL_CATEGORIES, type HandoverCategory } from '@esite/shared'
import {
  addShopDrawingAction,
  markShopDrawingReceivedAction,
  approveShopDrawingAction,
  revertShopDrawingAction,
  removeShopDrawingAction,
  getShopDrawingSignedUrlAction,
} from '@/actions/node-order-shop-drawing.actions'

export type ShopDrawingStatus = 'awaiting' | 'received' | 'approved'

export interface ShopDrawing {
  id: string
  file_name: string
  storage_path: string
  status: ShopDrawingStatus
  handover_category: HandoverCategory | null
}

const STATUS_VARIANT: Record<ShopDrawingStatus, 'warning' | 'info' | 'success'> = {
  awaiting: 'warning',
  received: 'info',
  approved: 'success',
}
const STATUS_LABEL: Record<ShopDrawingStatus, string> = {
  awaiting: 'Awaiting',
  received: 'Received',
  approved: 'Approved',
}

export function ShopDrawingList({
  projectId,
  nodeOrderId,
  drawings,
}: {
  projectId: string
  nodeOrderId: string
  drawings: ShopDrawing[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // drawingId currently awaiting a category choice (approve returned needsCategory)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeOrderId', nodeOrderId)
      fd.append('docType', 'shop_drawing')
      fd.append('file', file)
      const res = await fetch('/api/node-order-documents', { method: 'POST', body: fd })
      const json = (await res.json()) as { storagePath?: string; fileName?: string; error?: string }
      if (!res.ok || !json.storagePath) throw new Error(json.error ?? `Upload failed (HTTP ${res.status})`)

      const add = await addShopDrawingAction(projectId, nodeOrderId, json.storagePath, json.fileName ?? file.name)
      if ('error' in add) {
        await fetch('/api/node-order-documents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: json.storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(add.error)
      }
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runAction<T extends { ok: true } | { error: string } | { needsCategory: true }>(
    fn: () => Promise<T>,
  ): Promise<T | null> {
    setError(null)
    setBusy(true)
    try {
      const res = await fn()
      if ('error' in res) {
        setError(res.error)
        return null
      }
      return res
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleView(d: ShopDrawing) {
    setError(null)
    const res = await getShopDrawingSignedUrlAction(projectId, d.storage_path)
    if ('error' in res) setError(res.error)
    else window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  async function handleAdvance(d: ShopDrawing) {
    if (d.status === 'awaiting') {
      await runAction(() => markShopDrawingReceivedAction(projectId, d.id))
      refresh()
    } else if (d.status === 'received') {
      const res = await runAction(() => approveShopDrawingAction(projectId, d.id))
      if (res && 'needsCategory' in res) {
        setPickFor(d.id)
      } else if (res) {
        refresh()
      }
    }
  }

  async function handlePickCategory(drawingId: string, category: HandoverCategory) {
    const res = await runAction(() => approveShopDrawingAction(projectId, drawingId, category))
    if (res && 'ok' in res) {
      setPickFor(null)
      refresh()
    }
  }

  async function handleRevert(d: ShopDrawing) {
    await runAction(() => revertShopDrawingAction(projectId, d.id))
    refresh()
  }

  async function handleRemove(d: ShopDrawing) {
    await runAction(() => removeShopDrawingAction(projectId, d.id))
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, minWidth: 230 }}>
      <span style={{ color: 'var(--c-text-dim)' }}>Shop drawings</span>

      {drawings.length === 0 && <span style={{ color: 'var(--c-text-dim)' }}>—</span>}

      {drawings.map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleView(d)}
            title={d.file_name}
            style={{
              maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)', color: 'var(--c-text)',
              background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
              padding: '1px 6px', cursor: 'pointer',
            }}
          >
            {d.file_name}
          </button>
          <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABEL[d.status]}</Badge>

          {d.status !== 'approved' && (
            <button
              type="button"
              onClick={() => handleAdvance(d)}
              disabled={busy}
              style={advanceBtn}
            >
              {d.status === 'awaiting' ? 'Mark received' : 'Mark approved'}
            </button>
          )}
          {d.status === 'approved' && d.handover_category && (
            <span style={{ color: 'var(--c-green)' }}>
              Filed › {CATEGORY_LABELS[d.handover_category]}
            </span>
          )}
          {d.status !== 'awaiting' && (
            <button type="button" onClick={() => handleRevert(d)} disabled={busy} title="Step status back" style={linkBtn}>
              ↩
            </button>
          )}
          <button type="button" onClick={() => handleRemove(d)} disabled={busy} title="Remove" style={removeBtn}>
            ×
          </button>

          {pickFor === d.id && (
            <select
              autoFocus
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value
                if (v) handlePickCategory(d.id, v as HandoverCategory)
              }}
              style={{ fontSize: 11, padding: '1px 4px' }}
            >
              <option value="" disabled>
                Pick handover category…
              </option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}

      <label style={{ cursor: busy ? 'default' : 'pointer', color: 'var(--c-amber)', border: '1px dashed var(--c-border)', borderRadius: 4, padding: '1px 6px', alignSelf: 'flex-start' }}>
        {busy ? 'Working…' : '+ Add drawing'}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={busy} />
      </label>

      {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}

const advanceBtn: React.CSSProperties = {
  background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
  padding: '1px 6px', cursor: 'pointer', color: 'var(--c-text)', fontSize: 11,
}
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: 0,
}
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 13, lineHeight: 1, padding: 0,
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(admin)/projects/[id]/materials/_components/ShopDrawingList.tsx
git commit -m "feat(materials): ShopDrawingList multi-drawing client component"
```

---

## Task 7: Wire ShopDrawingList into OrderRow + change the row's document shape

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/materials/_components/OrderRow.tsx`

- [ ] **Step 1: Update the `OrderRowData` interface**

Replace the `documents` shape so `shop_drawing` becomes a list. Change (lines ~30–34):

```tsx
  documents: {
    quote: OrderDoc | null
    order_instruction: OrderDoc | null
    shop_drawing: OrderDoc | null
  }
```
to:
```tsx
  documents: {
    quote: OrderDoc | null
    order_instruction: OrderDoc | null
  }
  shopDrawings: ShopDrawing[]
```

- [ ] **Step 2: Update the imports**

Change the existing import line:
```tsx
import { OrderDocSlot, type OrderDoc } from './OrderDocSlot'
```
to:
```tsx
import { OrderDocSlot, type OrderDoc } from './OrderDocSlot'
import { ShopDrawingList, type ShopDrawing } from './ShopDrawingList'
```

- [ ] **Step 3: Replace the shop-drawing slot in the Documents `<td>`**

In the Documents cell, change:
```tsx
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="quote" label="Quote" doc={order.documents.quote} />
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="order_instruction" label="Order instr." doc={order.documents.order_instruction} />
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="shop_drawing" label="Shop drawing" doc={order.documents.shop_drawing} />
```
to:
```tsx
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="quote" label="Quote" doc={order.documents.quote} />
            <OrderDocSlot projectId={projectId} nodeOrderId={order.id} docType="order_instruction" label="Order instr." doc={order.documents.order_instruction} />
            <ShopDrawingList projectId={projectId} nodeOrderId={order.id} drawings={order.shopDrawings} />
```

- [ ] **Step 4: Type-check**

Run: `pnpm type-check`
Expected: FAIL pointing only at `materials/page.tsx` (it still builds the old `shop_drawing` shape). That's fixed in Task 8. The `OrderRow.tsx`/`ShopDrawingList.tsx` errors must be gone.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(admin)/projects/[id]/materials/_components/OrderRow.tsx
git commit -m "feat(materials): render ShopDrawingList; shopDrawings on OrderRowData"
```

---

## Task 8: Wire the page — fetch drawings, populate the new shape

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/materials/page.tsx`

- [ ] **Step 1: Update `EMPTY_DOCS` and add a drawings map type**

Change `EMPTY_DOCS` (lines ~89–93) to drop `shop_drawing`:
```tsx
const EMPTY_DOCS = (): OrderRowData['documents'] => ({
  quote: null,
  order_instruction: null,
})
```

- [ ] **Step 2: Stop mapping `shop_drawing` from node_order_documents**

In the `node_order_documents` loop (lines ~190–221), remove the shop-drawing branch. The select can stay; just delete the line:
```tsx
        else if (d.doc_type === 'shop_drawing') entry.shop_drawing = ref
```
(After migration 00115 tightens the CHECK, no `shop_drawing` rows exist there anyway — but removing the branch keeps the types correct.)

- [ ] **Step 3: Fetch shop drawings into a per-order map**

Immediately after the `node_order_documents` block, add (uses the same `(supabase as never as {...})` cast idiom and `orderIds`):
```tsx
  // ── node_order_shop_drawings — the multi-drawing list per order ──────────
  const drawingsByOrder = new Map<string, OrderRowData['shopDrawings']>()
  if (orderIds.length > 0) {
    try {
      const { data: rows } = await (supabase as never as {
        schema: (s: string) => { from: (t: string) => any }
      })
        .schema('structure')
        .from('node_order_shop_drawings')
        .select('id, node_order_id, file_name, storage_path, status, handover_category')
        .in('node_order_id', orderIds)
        .order('created_at', { ascending: true })
      for (const r of (rows ?? []) as Array<{
        id: string
        node_order_id: string
        file_name: string
        storage_path: string
        status: 'awaiting' | 'received' | 'approved'
        handover_category: string | null
      }>) {
        const list = drawingsByOrder.get(r.node_order_id) ?? []
        list.push({
          id: r.id,
          file_name: r.file_name,
          storage_path: r.storage_path,
          status: r.status,
          handover_category: (r.handover_category ?? null) as OrderRowData['shopDrawings'][number]['handover_category'],
        })
        drawingsByOrder.set(r.node_order_id, list)
      }
    } catch {
      // Non-fatal — orders still render with no drawings.
    }
  }
```

> **`handover_category` source:** the chip's category is stored directly on the drawing row (the `handover_category TEXT` column in Task 1, set by the approve PATCH and cleared on revert in Task 5). The select above reads it — no extra query against `tenants.documents`.

- [ ] **Step 4: Populate `shopDrawings` when assembling each row**

In the row-assembly loop (lines ~244–288), add `shopDrawings` to the `row` object next to `documents`:
```tsx
      documents: docsByOrder.get(o.id) ?? EMPTY_DOCS(),
      shopDrawings: drawingsByOrder.get(o.id) ?? [],
```

- [ ] **Step 5: Type-check + lint**

Run: `pnpm type-check`
Expected: PASS (no errors anywhere).

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(admin\)/projects/\[id\]/materials/page.tsx
git commit -m "feat(materials): load node_order_shop_drawings into the order rows"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite for shared**

Run: `cd packages/shared && pnpm exec vitest run src/services/handover/category-map.test.ts src/structure/shop-drawing-status.test.ts`
Expected: PASS — all pure-logic tests green.

- [ ] **Step 2: Run the gate**

Run: `pnpm lint && pnpm type-check` (repo root)
Expected: both PASS.

- [ ] **Step 3: Manual end-to-end checklist** (against a running app with the migration applied)

Run the app: `pnpm dev:web`. As an owner/admin/project_manager on a project that has material orders:

1. Open Materials → expand a group with a `main_board` or `generator` order.
2. Under **Shop drawings**, click **+ Add drawing**, upload a PDF → it appears with an **Awaiting** chip.
3. Add a second drawing to the same item → both list independently.
4. Click **Mark received** on one → chip turns **Received** (blue).
5. Click **Mark approved** → chip turns **Approved** (green) and shows **Filed › Main Boards** (or Generators).
6. Open the **Handover** tab → Documents → the drawing is present under that category folder, named `"<item label> — <file>.pdf"`.
7. Back in Materials, click **↩** on the approved drawing → it reverts to Received; confirm the handover document is gone from the Handover tab.
8. Click **×** to remove a drawing → it disappears; if it had been approved, its handover document is also gone.
9. On a `custom`-kind equipment order (or an org-added scope type), click **Mark approved** → the **category picker** appears; choose one → it files there. Approve a *second* drawing on the **same item** → it files without prompting (the choice was remembered).
10. Log in as a read-only/tenant viewer → drawings + statuses are visible but the action buttons either error (RLS) or should be hidden — confirm no mutation succeeds.

- [ ] **Step 4: Confirm the back-migration** (if the project had a pre-existing shop drawing)

Any order that previously had a single shop drawing now shows exactly one drawing with a **Received** chip (seeded by migration 00115). Confirm the file still opens via view.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(materials): verification fixes for shop-drawing handover flow"
```

---

## Self-review notes (addressed)

- **Spec coverage:** multiple drawings (Tasks 1,6–8) · awaiting/received/approved status (Tasks 3,5,6) · auto-file on approval (Task 5) · category auto-map + override + remember (Tasks 2,5) · dedicated table (Task 1) · permissions via existing RLS (Task 1) · idempotent re-approve + reversible un-approve/remove (Task 5) · back-migration + CHECK tightening (Task 1) · verification incl. end-to-end (Task 9). All covered.
- **Type consistency:** `ShopDrawing` shape (id, file_name, storage_path, status, handover_category) is defined in `ShopDrawingList.tsx`, imported by `OrderRow.tsx`, and built in `page.tsx`. `ShopDrawingStatus` union matches the DB CHECK and the pure helper. The approve action returns `{ ok } | { needsCategory } | { error }` and the component branches on all three.
- **Cross-cutting edit flagged inline:** the `handover_category` column on `node_order_shop_drawings` is introduced in Task 8's note and must be folded back into Task 1's CREATE TABLE and Task 5's PATCHes before implementing — do that edit first if executing top-to-bottom.
```
