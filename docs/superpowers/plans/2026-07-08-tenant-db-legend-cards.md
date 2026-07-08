# Tenant DB Legend Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-tenant capture of a distribution board's circuit breakers (SANS-style legend rows) in the tenant schedule, printable as an A4/A5 legend-card PDF.

**Architecture:** New `structure.node_circuits` table (+ header columns on `structure.tenant_details`) keyed to the existing `tenant_db` nodes; server actions following `tenant-scope.actions.ts` (guards + service-role PostgREST writes); an expandable "Legend" panel in `ScheduleTable` following `ScopeOfWorkPanel`; a `pdf-lib` renderer + API route following the cable-schedule tag exports.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase (PostgREST + RLS), zod, pdf-lib, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-08-tenant-db-legend-cards-design.md` (in this repo).

**Working directory:** the fresh clone (branch `feat/tenant-db-legend`). All `pnpm` commands run from the repo root with `--filter`.

**Repo conventions that bite (read before Task 1):**
- Writes to `structure.*` MUST use raw `fetch` to PostgREST with `Content-Profile: structure` + service-role key. supabase-js `.schema('structure')` writes silently strip auth. Reads via `.schema('structure')` are safe.
- Generated DB types lag migrations — cast structure reads at the query boundary (`as unknown as T`), as `tenant-schedule/page.tsx` does.
- Actions that write with the service role must gate `ORG_WRITE_ROLES` in app code (`requireEffectiveRole`) — RLS is bypassed.
- UI uses CSS vars (`var(--c-green)`, `var(--c-border)`, …), `Badge` variants, mono font via `var(--font-mono)`.

---

### Task 1: Shared quick-add helper + legend types (`@esite/shared`)

**Files:**
- Create: `packages/shared/src/structure/db-legend.ts`
- Create: `packages/shared/src/structure/db-legend.test.ts`
- Modify: `packages/shared/src/index.ts` (add one export line next to the existing `./structure/*` exports)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/structure/db-legend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planQuickAddWays, QUICK_ADD_MAX } from './db-legend'

describe('planQuickAddWays', () => {
  it('numbers from 1 on an empty board', () => {
    expect(planQuickAddWays([], 3)).toEqual(['1', '2', '3'])
  })

  it('continues from the highest existing integer circuit number', () => {
    expect(planQuickAddWays(['1', '2', '5'], 3)).toEqual(['6', '7', '8'])
  })

  it('ignores non-integer circuit numbers when computing the start', () => {
    expect(planQuickAddWays(['3+5+7', 'A1', '2'], 2)).toEqual(['3', '4'])
  })

  it('trims whitespace before parsing', () => {
    expect(planQuickAddWays([' 4 '], 1)).toEqual(['5'])
  })

  it('clamps count to QUICK_ADD_MAX', () => {
    expect(planQuickAddWays([], 999)).toHaveLength(QUICK_ADD_MAX)
  })

  it('clamps count to at least 1', () => {
    expect(planQuickAddWays([], 0)).toEqual(['1'])
    expect(planQuickAddWays([], -5)).toEqual(['1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared test -- db-legend`
Expected: FAIL — cannot resolve `./db-legend`

- [ ] **Step 3: Write the implementation**

`packages/shared/src/structure/db-legend.ts`:

```ts
/**
 * db-legend — types + pure helpers for tenant DB legend cards
 * (structure.node_circuits, migration 00169).
 */

export interface LegendCircuit {
  id: string
  node_id: string
  circuit_no: string
  description: string | null
  phase: 'L1' | 'L2' | 'L3' | '3P' | null
  breaker_rating_a: number | null
  poles: 1 | 2 | 3 | 4 | null
  curve: 'B' | 'C' | 'D' | null
  cable_size: string | null
  is_spare: boolean
  sort_order: number
}

/** Card-header fields stored on structure.tenant_details (00169). */
export interface LegendHeader {
  node_id: string
  db_location: string | null
  db_fed_from: string | null
  db_earth_leakage_ma: number | null
  legend_card_size: 'A4' | 'A5'
}

export const QUICK_ADD_MAX = 60

/**
 * Circuit numbers for a quick-add of `count` ways: sequential integers
 * continuing from the highest existing integer circuit_no (non-integer
 * numbers like "3+5+7" are ignored). count is clamped to [1, QUICK_ADD_MAX].
 */
export function planQuickAddWays(existingCircuitNos: string[], count: number): string[] {
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), QUICK_ADD_MAX)
  let max = 0
  for (const raw of existingCircuitNos) {
    const t = raw.trim()
    if (/^\d+$/.test(t)) max = Math.max(max, parseInt(t, 10))
  }
  return Array.from({ length: n }, (_, i) => String(max + 1 + i))
}
```

In `packages/shared/src/index.ts`, add next to the other `./structure/` exports:

```ts
export * from './structure/db-legend'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @esite/shared test -- db-legend`
Expected: 6 passing

- [ ] **Step 5: Run the full shared suite + type-check (regression)**

Run: `pnpm --filter @esite/shared test && pnpm --filter @esite/shared type-check`
Expected: all pass (baseline was green)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/structure/db-legend.ts packages/shared/src/structure/db-legend.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): legend-card types + quick-add way numbering helper"
```

---

### Task 2: Migration 00169 — `structure.node_circuits` + tenant_details header columns

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00169_db_legend.sql`

No runnable DB in this environment — verification is SQL review + the deploy task. Copy the RLS shape from `00083_node_orders.sql` exactly (it's the canonical per-node child-table pattern; DELETE policy REQUIRED — a missing DELETE policy silently no-ops).

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00169 — tenant DB legend cards
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-08-tenant-db-legend-cards-design.md
--
--   + structure.node_circuits — one row per way/circuit inside a tenant DB
--     (circuit number, description, phase, breaker rating/poles/curve, cable
--     size, spare flag). Feeds the printable legend card.
--   + structure.tenant_details: db_location, db_fed_from, db_earth_leakage_ma,
--     legend_card_size — the card header block. The main breaker is NOT stored
--     here: structure.nodes already carries breaker_rating_a / pole_config
--     (manual) and incomer_breaker_a / incomer_pole_config (derived).
--
-- RLS mirrors 00083 (structure.node_orders): access derived from the linked
-- node's project/org; client_viewer SELECT-only; owner/admin/project_manager
-- write; DELETE policy included.
--
-- Grants: none needed — 00075 ALTER DEFAULT PRIVILEGES covers new structure
-- tables. New table in an existing exposed schema → NOTIFY reload only, no
-- PostgREST db_schema PATCH.
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

CREATE TABLE structure.node_circuits (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    node_id           UUID        NOT NULL
                      REFERENCES structure.nodes(id) ON DELETE CASCADE,

    -- Free text ("1", "3+5+7"); unique per board. Blank forbidden.
    circuit_no        TEXT        NOT NULL CHECK (btrim(circuit_no) <> ''),

    -- "Lights shop 5". NULL/blank allowed (spare ways).
    description       TEXT,

    phase             TEXT        CHECK (phase IN ('L1', 'L2', 'L3', '3P')),
    breaker_rating_a  NUMERIC     CHECK (breaker_rating_a > 0),
    poles             SMALLINT    CHECK (poles IN (1, 2, 3, 4)),
    curve             TEXT        CHECK (curve IN ('B', 'C', 'D')),
    cable_size        TEXT,

    -- Spare ways print as "SPARE" on the card.
    is_spare          BOOLEAN     NOT NULL DEFAULT false,

    -- Display + print order (assigned max+1 by the application layer).
    sort_order        INTEGER     NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (node_id, circuit_no)
);

-- Composite index serves both real query paths — the per-node print route
-- and the tenant-schedule page batch load — which filter by node_id and
-- order by sort_order: an index-order scan, no separate sort step.
CREATE INDEX idx_node_circuits_node_sort ON structure.node_circuits (node_id, sort_order);

CREATE TRIGGER node_circuits_updated_at
    BEFORE UPDATE ON structure.node_circuits
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — node_circuits (mirrors 00083 node_orders)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.node_circuits ENABLE ROW LEVEL SECURITY;

CREATE POLICY node_circuits_select_members ON structure.node_circuits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

CREATE POLICY node_circuits_select_client_viewer ON structure.node_circuits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_insert ON structure.node_circuits
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_update ON structure.node_circuits
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_delete ON structure.node_circuits
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_details — legend-card header fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.tenant_details
    ADD COLUMN db_location         TEXT,
    ADD COLUMN db_fed_from         TEXT,
    ADD COLUMN db_earth_leakage_ma NUMERIC CHECK (db_earth_leakage_ma > 0),
    ADD COLUMN legend_card_size    TEXT NOT NULL DEFAULT 'A4'
               CHECK (legend_card_size IN ('A4', 'A5'));
```

- [ ] **Step 2: Review against 00083** — confirm the five policies match the node_orders shape (member/viewer SELECT split, write-role INSERT/UPDATE/DELETE), the trigger uses `public.set_updated_at()`, and no GRANT statements are present.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00169_db_legend.sql
git commit -m "feat(db): 00169 node_circuits + tenant_details legend header columns"
```

---

### Task 3: Server actions — `db-legend.actions.ts` (TDD)

**Files:**
- Create: `apps/web/src/actions/db-legend.actions.ts`
- Create: `apps/web/src/actions/db-legend.actions.test.ts`

Pattern source: `apps/web/src/actions/tenant-scope.actions.ts` (guards, structureHeaders/Post/Patch/Delete helpers — duplicate them module-locally, that is the existing convention) and its `.test.ts` (vi.hoisted mocks).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/actions/db-legend.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getByIdMock, createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import {
  upsertCircuitAction,
  deleteCircuitAction,
  quickAddWaysAction,
  updateLegendHeaderAction,
} from './db-legend.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'
const CIRCUIT = '33333333-3333-3333-3333-333333333333'

/**
 * Supabase cookie-client mock. Covers:
 *  - auth.getUser
 *  - requireEffectiveRole's RPC
 *  - guardNodeBelongsToProject: .schema().from('nodes').select().eq().eq().maybeSingle()
 *  - quickAdd's existing-circuits read: .schema().from('node_circuits').select().eq() (thenable)
 */
function mockClient(opts: { role?: string | null; existingCircuits?: Array<{ circuit_no: string; sort_order: number }> } = {}) {
  const { role = 'owner', existingCircuits = [] } = opts
  const nodesQuery: any = {
    select: () => nodesQuery,
    eq: () => nodesQuery,
    maybeSingle: () => Promise.resolve({ data: { id: NODE } }),
  }
  const circuitsQuery: any = {
    select: () => circuitsQuery,
    eq: () => circuitsQuery,
    then: (resolve: (v: unknown) => void) => resolve({ data: existingCircuits, error: null }),
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: (table: string) => (table === 'node_circuits' ? circuitsQuery : nodesQuery),
    }),
  }
}

function okFetch(body: unknown = [{ id: CIRCUIT }]) {
  return vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
}

beforeEach(() => {
  createClientMock.mockReset(); revalidatePathMock.mockReset(); getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('role gate (service-role writes require ORG_WRITE_ROLES)', () => {
  it.each([
    ['upsertCircuitAction', () => upsertCircuitAction(PROJECT, NODE, { circuit_no: '1', is_spare: false })],
    ['deleteCircuitAction', () => deleteCircuitAction(PROJECT, NODE, CIRCUIT)],
    ['quickAddWaysAction', () => quickAddWaysAction(PROJECT, NODE, 3)],
    ['updateLegendHeaderAction', () => updateLegendHeaderAction(PROJECT, NODE, { db_location: 'Back room' })],
  ])('%s denies when the effective-role RPC returns null', async (_name, call) => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('upsertCircuitAction', () => {
  it('POSTs a new circuit and returns the inserted row', async () => {
    const fetchMock = okFetch([{ id: CIRCUIT, node_id: NODE, circuit_no: '4', sort_order: 1 }])
    vi.stubGlobal('fetch', fetchMock)
    const res = await upsertCircuitAction(PROJECT, NODE, {
      circuit_no: '4', description: 'Lights shop 5', phase: 'L1',
      breaker_rating_a: 20, poles: 1, curve: 'C', cable_size: '2.5mm²', is_spare: false,
    })
    expect(res).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/rest/v1/node_circuits')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Profile']).toBe('structure')
  })

  it('maps a 409 duplicate to a friendly error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409, text: () => Promise.resolve('duplicate key value violates unique constraint'),
    }))
    const res = await upsertCircuitAction(PROJECT, NODE, { circuit_no: '4', is_spare: false })
    expect('error' in res && /already exists/i.test((res as { error: string }).error)).toBe(true)
  })

  it('PATCHes when an id is supplied', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await upsertCircuitAction(PROJECT, NODE, { id: CIRCUIT, circuit_no: '4', is_spare: true })
    expect(res).toMatchObject({ ok: true })
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[0][0])).toContain(`id=eq.${CIRCUIT}`)
  })
})

describe('quickAddWaysAction', () => {
  it('numbers new ways after the highest existing integer and POSTs them as spares', async () => {
    createClientMock.mockResolvedValue(mockClient({
      existingCircuits: [{ circuit_no: '2', sort_order: 1 }, { circuit_no: 'A1', sort_order: 2 }],
    }))
    const fetchMock = okFetch([{ id: 'x1' }, { id: 'x2' }])
    vi.stubGlobal('fetch', fetchMock)
    const res = await quickAddWaysAction(PROJECT, NODE, 2)
    expect(res).toMatchObject({ ok: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.map((r: { circuit_no: string }) => r.circuit_no)).toEqual(['3', '4'])
    expect(body.every((r: { is_spare: boolean }) => r.is_spare === true)).toBe(true)
    expect(body.map((r: { sort_order: number }) => r.sort_order)).toEqual([3, 4])
  })
})

describe('updateLegendHeaderAction', () => {
  it('upserts tenant_details with only allowlisted keys', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateLegendHeaderAction(PROJECT, NODE, {
      db_location: 'Back of shop', legend_card_size: 'A5',
      // @ts-expect-error — unknown keys must be rejected by zod, not forwarded
      scope_status: 'received',
    })
    expect(res).toMatchObject({ ok: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ node_id: NODE, db_location: 'Back of shop', legend_card_size: 'A5' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('on_conflict=node_id')
  })
})

describe('deleteCircuitAction', () => {
  it('DELETEs scoped by id AND node_id', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await deleteCircuitAction(PROJECT, NODE, CIRCUIT)
    expect(res).toMatchObject({ ok: true })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain(`id=eq.${CIRCUIT}`)
    expect(url).toContain(`node_id=eq.${NODE}`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- db-legend.actions`
Expected: FAIL — module `./db-legend.actions` not found

- [ ] **Step 3: Write the implementation**

`apps/web/src/actions/db-legend.actions.ts`:

```ts
'use server'

/**
 * db-legend.actions.ts — server actions for tenant DB legend cards
 * (structure.node_circuits + tenant_details header columns, migration 00169).
 *
 *   - upsertCircuitAction       — insert (no id) or update (id) one circuit row
 *   - deleteCircuitAction       — remove a circuit row
 *   - quickAddWaysAction        — bulk-create N sequentially-numbered spare ways
 *   - updateLegendHeaderAction  — patch the card-header fields on tenant_details
 *
 * Cross-schema write pattern (CLAUDE.md gotcha): supabase-js .schema('structure')
 * writes silently strip the service-role auth header → raw fetch to PostgREST
 * with Content-Profile: structure. Reads via the cookie client are safe.
 * Writes bypass RLS (service role), so guardProjectAccess enforces the
 * ORG_WRITE_ROLES effective-role gate in app code.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, planQuickAddWays, QUICK_ADD_MAX, ORG_WRITE_ROLES } from '@esite/shared'
import type { LegendCircuit } from '@esite/shared'

// ---------------------------------------------------------------------------
// PostgREST helpers (module-local, mirroring tenant-scope.actions.ts)
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=representation',
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: unknown,
  queryString = '',
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  const url = `${supabaseUrl}/rest/v1/${table}${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, status: res.status, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: await res.json() }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, status: res.status, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
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
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Guards (module-local, mirroring tenant-scope.actions.ts)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined }
  | { error?: undefined; user: object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  // Writes use the service-role key (bypasses RLS) — enforce the write-role
  // gate in app code. requireEffectiveRole honours per-project promotion (00107).
  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: roleGate.error }

  return { user, orgId: project.organisation_id as string, supabase }
}

async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Node not found' }
  return null
}

// ---------------------------------------------------------------------------
// upsertCircuitAction
// ---------------------------------------------------------------------------

const circuitInputSchema = z.object({
  id: uuidSchema.optional(),
  circuit_no: z.string().trim().min(1, 'Circuit number is required').max(20),
  description: z.string().trim().max(200).nullish(),
  phase: z.enum(['L1', 'L2', 'L3', '3P']).nullish(),
  breaker_rating_a: z.number().positive().max(6300).nullish(),
  poles: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullish(),
  curve: z.enum(['B', 'C', 'D']).nullish(),
  cable_size: z.string().trim().max(60).nullish(),
  is_spare: z.boolean(),
})

export type CircuitInput = z.input<typeof circuitInputSchema>
export type UpsertCircuitResult = { ok: true; circuit: LegendCircuit } | { error: string }

export async function upsertCircuitAction(
  projectId: string,
  nodeId: string,
  input: CircuitInput,
): Promise<UpsertCircuitResult> {
  const ids = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!ids.success) return { error: 'Invalid input' }
  const parsed = circuitInputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const { id, ...fields } = parsed.data
  const row = {
    circuit_no: fields.circuit_no,
    description: fields.description ?? null,
    phase: fields.phase ?? null,
    breaker_rating_a: fields.breaker_rating_a ?? null,
    poles: fields.poles ?? null,
    curve: fields.curve ?? null,
    cable_size: fields.cable_size ?? null,
    is_spare: fields.is_spare,
  }

  if (id) {
    // UPDATE — scoped by id AND node_id (defence in depth).
    const res = await structurePatch(
      supabaseUrl,
      serviceKey,
      'node_circuits',
      `id=eq.${id}&node_id=eq.${nodeId}`,
      row,
    )
    if (!res.ok) {
      if (res.status === 409) return { error: `Circuit ${row.circuit_no} already exists on this board` }
      return { error: res.error ?? 'Failed to update circuit' }
    }
    revalidatePath(`/projects/${projectId}/tenant-schedule`)
    return { ok: true, circuit: { id, node_id: nodeId, sort_order: 0, ...row } as LegendCircuit }
  }

  // INSERT — sort_order continues after the node's current maximum.
  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: Array<{ sort_order: number }> | null }> }
      }
    }
  })
    .schema('structure')
    .from('node_circuits')
    .select('sort_order')
    .eq('node_id', nodeId)
  const maxSort = (existing ?? []).reduce((m, r) => Math.max(m, r.sort_order), 0)

  const res = await structurePost(supabaseUrl, serviceKey, 'node_circuits', {
    node_id: nodeId,
    sort_order: maxSort + 1,
    ...row,
  })
  if (!res.ok) {
    if (res.status === 409) return { error: `Circuit ${row.circuit_no} already exists on this board` }
    return { error: res.error ?? 'Failed to add circuit' }
  }

  const rows = res.data as LegendCircuit[]
  const circuit = rows?.[0]
  if (!circuit) return { error: 'INSERT returned no row' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, circuit }
}

// ---------------------------------------------------------------------------
// deleteCircuitAction
// ---------------------------------------------------------------------------

export type DeleteCircuitResult = { ok: true } | { error: string }

export async function deleteCircuitAction(
  projectId: string,
  nodeId: string,
  circuitId: string,
): Promise<DeleteCircuitResult> {
  const ids = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, circuitId: uuidSchema })
    .safeParse({ projectId, nodeId, circuitId })
  if (!ids.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const res = await structureDelete(
    supabaseUrl,
    serviceKey,
    'node_circuits',
    `id=eq.${circuitId}&node_id=eq.${nodeId}`,
  )
  if (!res.ok) return { error: res.error ?? 'Failed to delete circuit' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// quickAddWaysAction
// ---------------------------------------------------------------------------

export type QuickAddWaysResult = { ok: true; circuits: LegendCircuit[] } | { error: string }

/**
 * Bulk-create `count` sequentially-numbered ways. New rows default to spare
 * (is_spare=true, blank description) so an untouched way still prints honestly
 * as SPARE on the card.
 */
export async function quickAddWaysAction(
  projectId: string,
  nodeId: string,
  count: number,
): Promise<QuickAddWaysResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, count: z.number().int().min(1).max(QUICK_ADD_MAX) })
    .safeParse({ projectId, nodeId, count })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Existing numbers + sort_order — cookie-client read (RLS-gated).
  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => PromiseLike<{ data: Array<{ circuit_no: string; sort_order: number }> | null }>
        }
      }
    }
  })
    .schema('structure')
    .from('node_circuits')
    .select('circuit_no, sort_order')
    .eq('node_id', nodeId)

  const rows = existing ?? []
  const numbers = planQuickAddWays(rows.map((r) => r.circuit_no), count)
  const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), 0)

  const payload = numbers.map((circuit_no, i) => ({
    node_id: nodeId,
    circuit_no,
    is_spare: true,
    sort_order: maxSort + 1 + i,
  }))

  const res = await structurePost(supabaseUrl, serviceKey, 'node_circuits', payload)
  if (!res.ok) {
    if (res.status === 409) return { error: 'Some of the generated circuit numbers already exist — renumber or delete the clashing ways first' }
    return { error: res.error ?? 'Failed to add ways' }
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, circuits: (res.data as LegendCircuit[]) ?? [] }
}

// ---------------------------------------------------------------------------
// updateLegendHeaderAction
// ---------------------------------------------------------------------------

const legendHeaderSchema = z
  .object({
    db_location: z.string().trim().max(120).nullish(),
    db_fed_from: z.string().trim().max(120).nullish(),
    db_earth_leakage_ma: z.number().positive().max(10000).nullish(),
    legend_card_size: z.enum(['A4', 'A5']).optional(),
  })
  .strip() // unknown keys silently dropped — never forwarded to the DB

export type LegendHeaderPatch = z.input<typeof legendHeaderSchema>
export type UpdateLegendHeaderResult = { ok: true } | { error: string }

/**
 * Upsert the card-header fields on tenant_details. on_conflict=node_id with a
 * partial payload preserves every other column (scope_status etc.) — same
 * pattern as setScopeNotRequiredAction.
 */
export async function updateLegendHeaderAction(
  projectId: string,
  nodeId: string,
  patch: LegendHeaderPatch,
): Promise<UpdateLegendHeaderResult> {
  const ids = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!ids.success) return { error: 'Invalid input' }
  const parsed = legendHeaderSchema.safeParse(patch)
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  // Drop undefined keys so the upsert only touches supplied fields.
  const fields = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
  if (Object.keys(fields).length === 0) return { error: 'Nothing to update' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const res = await structurePost(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    { node_id: nodeId, ...fields },
    'on_conflict=node_id',
  )
  if (!res.ok) return { error: res.error ?? 'Failed to update legend details' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- db-legend.actions`
Expected: all pass (4 gate tests + 6 behaviour tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/db-legend.actions.ts apps/web/src/actions/db-legend.actions.test.ts
git commit -m "feat(web): db-legend server actions (upsert/delete/quick-add/header) with ORG_WRITE_ROLES gate"
```

---

### Task 4: PDF renderer — `render-legend-card.ts` (TDD)

**Files:**
- Create: `apps/web/src/lib/db-legend/render-legend-card.ts`
- Create: `apps/web/src/lib/db-legend/render-legend-card.test.ts`

Pattern source: `apps/web/src/lib/cable-schedule/export-avery-labels.ts` (pdf-lib, absolute coordinates, `Uint8Array` out).

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/db-legend/render-legend-card.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderLegendCardPdf, type LegendCardPayload } from './render-legend-card'

function payload(circuitCount: number): LegendCardPayload {
  return {
    projectName: 'KINGSWALK',
    shopNumber: '12A',
    shopName: 'Test Tenant',
    dbCode: 'DB-12A',
    mainBreaker: '63 A TP',
    header: { location: 'Back of shop', fedFrom: 'MAIN BOARD 1.1', earthLeakageMa: 30 },
    circuits: Array.from({ length: circuitCount }, (_, i) => ({
      circuit_no: String(i + 1),
      description: i % 3 === 0 ? null : `Circuit ${i + 1}`,
      phase: 'L1' as const,
      breaker_rating_a: 20,
      poles: 1 as const,
      curve: 'C' as const,
      cable_size: '2.5mm²',
      is_spare: i % 3 === 0,
    })),
    generatedAt: '2026-07-08',
  }
}

describe('renderLegendCardPdf', () => {
  it('renders a single A4 portrait page for a small board', async () => {
    const bytes = await renderLegendCardPdf(payload(12), 'A4')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(595.28, 1)
    expect(height).toBeCloseTo(841.89, 1)
  })

  it('renders A5 portrait when size is A5', async () => {
    const bytes = await renderLegendCardPdf(payload(12), 'A5')
    const doc = await PDFDocument.load(bytes)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(419.53, 1)
    expect(height).toBeCloseTo(595.28, 1)
  })

  it('paginates when circuits exceed one page', async () => {
    const bytes = await renderLegendCardPdf(payload(120), 'A5')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('renders an empty board without throwing', async () => {
    const bytes = await renderLegendCardPdf(payload(0), 'A4')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- render-legend-card`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/db-legend/render-legend-card.ts`:

```ts
/**
 * Distribution-board legend-card PDF (the circuit chart fixed inside the DB
 * door). One parameterised layout for both paper sizes — A4 and A5 portrait —
 * following the cable-schedule pdf-lib exemplars (absolute coordinates,
 * embedded Helvetica). Overflow paginates with a repeated table header.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type LegendCardSize = 'A4' | 'A5'

export interface LegendCardCircuit {
  circuit_no: string
  description: string | null
  phase: 'L1' | 'L2' | 'L3' | '3P' | null
  breaker_rating_a: number | null
  poles: 1 | 2 | 3 | 4 | null
  curve: 'B' | 'C' | 'D' | null
  cable_size: string | null
  is_spare: boolean
}

export interface LegendCardPayload {
  projectName: string
  shopNumber: string | null
  shopName: string | null
  dbCode: string
  /** Pre-formatted, e.g. "63 A TP" — from the node's breaker fields. */
  mainBreaker: string | null
  header: {
    location: string | null
    fedFrom: string | null
    earthLeakageMa: number | null
  }
  circuits: LegendCardCircuit[]
  /** Pre-formatted date string (route supplies it — keeps the renderer pure). */
  generatedAt: string
}

interface Geometry {
  w: number
  h: number
  margin: number
  titleSize: number
  metaSize: number
  cellSize: number
  rowH: number
  headerRowH: number
}

const GEOMETRY: Record<LegendCardSize, Geometry> = {
  A4: { w: 595.28, h: 841.89, margin: 40, titleSize: 13, metaSize: 8.5, cellSize: 8.5, rowH: 17, headerRowH: 18 },
  A5: { w: 419.53, h: 595.28, margin: 26, titleSize: 11, metaSize: 7, cellSize: 7, rowH: 13.5, headerRowH: 15 },
}

// Column widths as fractions of the content width.
const COLS: Array<{ key: string; label: string; frac: number }> = [
  { key: 'cct', label: 'CCT', frac: 0.08 },
  { key: 'phase', label: 'PHASE', frac: 0.09 },
  { key: 'description', label: 'DESCRIPTION', frac: 0.38 },
  { key: 'cb', label: 'CB (A)', frac: 0.1 },
  { key: 'poles', label: 'POLES', frac: 0.09 },
  { key: 'curve', label: 'CURVE', frac: 0.09 },
  { key: 'cable', label: 'CABLE', frac: 0.17 },
]

const INK = rgb(0.11, 0.11, 0.11)
const MID = rgb(0.35, 0.35, 0.35)
const DIM = rgb(0.55, 0.55, 0.55)
const LINE = rgb(0.75, 0.75, 0.75)

export async function renderLegendCardPdf(
  payload: LegendCardPayload,
  size: LegendCardSize,
): Promise<Uint8Array> {
  const g = GEOMETRY[size]
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)

  const contentW = g.w - g.margin * 2
  const colX: number[] = []
  let acc = g.margin
  for (const c of COLS) {
    colX.push(acc)
    acc += c.frac * contentW
  }

  let page = pdf.addPage([g.w, g.h])
  let y = drawCardHeader(page, payload, g, helv, helvB)
  y = drawTableHeader(page, g, colX, helvB, y)

  if (payload.circuits.length === 0) {
    page.drawText('No circuits captured yet.', {
      x: g.margin,
      y: y - g.rowH,
      size: g.cellSize,
      font: helv,
      color: DIM,
    })
  }

  for (const circuit of payload.circuits) {
    if (y - g.rowH < g.margin + 18) {
      drawFooter(page, payload, g, helv)
      page = pdf.addPage([g.w, g.h])
      y = drawContinuationHeader(page, payload, g, helv, helvB)
      y = drawTableHeader(page, g, colX, helvB, y)
    }
    y = drawCircuitRow(page, circuit, g, colX, helv, helvB, y)
  }

  drawFooter(page, payload, g, helv)

  pdf.setTitle(`DB Legend Card — ${payload.dbCode} — ${payload.projectName}`)
  pdf.setProducer('E-Site v2')
  pdf.setCreationDate(new Date())
  return await pdf.save()
}

/** Full first-page header. Returns the y where the table starts. */
function drawCardHeader(
  page: PDFPage,
  p: LegendCardPayload,
  g: Geometry,
  helv: PDFFont,
  helvB: PDFFont,
): number {
  let y = g.h - g.margin

  page.drawText('DISTRIBUTION BOARD LEGEND', {
    x: g.margin, y: y - g.titleSize, size: g.titleSize, font: helvB, color: INK,
  })
  y -= g.titleSize + 6

  const shop = [p.shopNumber, p.shopName].filter(Boolean).join(' — ')
  page.drawText(`${p.projectName}${shop ? `  ·  ${shop}` : ''}`, {
    x: g.margin, y: y - g.metaSize, size: g.metaSize, font: helv, color: MID,
  })
  y -= g.metaSize + 10

  const meta: Array<[string, string]> = [
    ['BOARD', p.dbCode],
    ['LOCATION', p.header.location ?? '—'],
    ['FED FROM', p.header.fedFrom ?? '—'],
    ['MAIN BREAKER', p.mainBreaker ?? '—'],
    ['EARTH LEAKAGE', p.header.earthLeakageMa != null ? `${p.header.earthLeakageMa} mA` : '—'],
  ]
  const labelW = 0.28 * (g.w - g.margin * 2) * 0.5
  const half = Math.ceil(meta.length / 2)
  const colW = (g.w - g.margin * 2) / 2
  meta.forEach(([label, value], i) => {
    const cx = g.margin + (i < half ? 0 : colW)
    const cy = y - (i % half) * (g.metaSize + 6) - g.metaSize
    page.drawText(label, { x: cx, y: cy, size: g.metaSize - 1, font: helvB, color: DIM })
    page.drawText(value, { x: cx + labelW, y: cy, size: g.metaSize, font: helv, color: INK })
  })
  y -= half * (g.metaSize + 6) + 8

  page.drawLine({
    start: { x: g.margin, y }, end: { x: g.w - g.margin, y }, thickness: 0.8, color: INK,
  })
  return y - 4
}

/** Compact continuation header for pages 2+. */
function drawContinuationHeader(
  page: PDFPage,
  p: LegendCardPayload,
  g: Geometry,
  helv: PDFFont,
  helvB: PDFFont,
): number {
  let y = g.h - g.margin
  page.drawText(`DISTRIBUTION BOARD LEGEND — ${p.dbCode} (continued)`, {
    x: g.margin, y: y - g.metaSize - 2, size: g.metaSize + 1, font: helvB, color: INK,
  })
  y -= g.metaSize + 10
  page.drawLine({
    start: { x: g.margin, y }, end: { x: g.w - g.margin, y }, thickness: 0.8, color: INK,
  })
  return y - 4
}

function drawTableHeader(page: PDFPage, g: Geometry, colX: number[], helvB: PDFFont, y: number): number {
  const rowY = y - g.headerRowH
  COLS.forEach((c, i) => {
    page.drawText(c.label, { x: colX[i] + 2, y: rowY + 4, size: g.cellSize - 0.5, font: helvB, color: DIM })
  })
  page.drawLine({
    start: { x: g.margin, y: rowY }, end: { x: g.w - g.margin, y: rowY }, thickness: 0.5, color: LINE,
  })
  return rowY
}

function drawCircuitRow(
  page: PDFPage,
  c: LegendCardCircuit,
  g: Geometry,
  colX: number[],
  helv: PDFFont,
  helvB: PDFFont,
  y: number,
): number {
  const rowY = y - g.rowH
  const spare = c.is_spare
  const color = spare ? DIM : INK
  const description = spare ? 'SPARE' : (c.description ?? '—')
  const cells = [
    c.circuit_no,
    c.phase ?? '—',
    description,
    c.breaker_rating_a != null ? String(c.breaker_rating_a) : '—',
    c.poles != null ? String(c.poles) : '—',
    c.curve ?? '—',
    c.cable_size ?? '—',
  ]
  cells.forEach((text, i) => {
    // Clip long text to the column (rough clip: shave chars until it fits).
    const colW = COLS[i].frac * (g.w - g.margin * 2) - 4
    let t = text
    const font = spare && i === 2 ? helvB : helv
    while (t.length > 1 && font.widthOfTextAtSize(t, g.cellSize) > colW) t = t.slice(0, -2) + '…'
    page.drawText(t, { x: colX[i] + 2, y: rowY + 4, size: g.cellSize, font, color: i === 2 ? color : color })
  })
  page.drawLine({
    start: { x: g.margin, y: rowY }, end: { x: g.w - g.margin, y: rowY }, thickness: 0.4, color: LINE,
  })
  return rowY
}

function drawFooter(page: PDFPage, p: LegendCardPayload, g: Geometry, helv: PDFFont) {
  page.drawText(`${p.projectName} · Generated ${p.generatedAt} · E-Site`, {
    x: g.margin, y: g.margin - 12 < 6 ? 6 : g.margin - 12, size: g.metaSize - 1, font: helv, color: DIM,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- render-legend-card`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/db-legend/
git commit -m "feat(web): pdf-lib legend-card renderer (A4/A5, paginated, spare-aware)"
```

---

### Task 5: Print route — `/api/tenant-schedule/legend-card/pdf` (TDD)

**Files:**
- Create: `apps/web/src/app/api/tenant-schedule/legend-card/pdf/route.ts`
- Create: `apps/web/src/app/api/tenant-schedule/legend-card/pdf/route.test.ts`

Auth model: read-only route, cookie client under RLS — any project-visible role (incl. client_viewer) may print; the RLS node read itself is the visibility gate (invisible node → 404).

- [ ] **Step 1: Write the failing tests**

`route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { createClientMock, getByIdMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getByIdMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import { GET } from './route'

const NODE = '22222222-2222-2222-2222-222222222222'

function req(qs: string) {
  return new NextRequest(`https://app.test/api/tenant-schedule/legend-card/pdf?${qs}`)
}

/** node: row returned for structure.nodes; details/circuits for the other tables. */
function mockClient(opts: {
  user?: boolean
  node?: Record<string, unknown> | null
  details?: Record<string, unknown> | null
  circuits?: Array<Record<string, unknown>>
} = {}) {
  const { user = true, node = baseNode(), details = null, circuits = [] } = opts
  function thenable(data: unknown) {
    const q: any = {
      select: () => q, eq: () => q, order: () => q,
      maybeSingle: () => Promise.resolve({ data: table === 'nodes' ? node : details }),
      then: (resolve: (v: unknown) => void) => resolve({ data: circuits, error: null }),
    }
    return q
  }
  let table = ''
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: user ? { id: 'u-1' } : null } }) },
    schema: () => ({
      from: (t: string) => {
        table = t
        return thenable(t)
      },
    }),
  }
}

function baseNode() {
  return {
    id: NODE, project_id: '11111111-1111-1111-1111-111111111111', code: 'DB-12A', kind: 'tenant_db',
    shop_number: '12A', shop_name: 'Test Tenant',
    breaker_rating_a: 63, pole_config: 'TP', incomer_breaker_a: null, incomer_pole_config: null,
  }
}

beforeEach(() => {
  createClientMock.mockReset(); getByIdMock.mockReset()
  createClientMock.mockResolvedValue(mockClient())
  getByIdMock.mockResolvedValue({ id: 'p-1', name: 'KINGSWALK', organisation_id: 'org-1' })
})

describe('GET /api/tenant-schedule/legend-card/pdf', () => {
  it('401s when unauthenticated', async () => {
    createClientMock.mockResolvedValue(mockClient({ user: false }))
    const res = await GET(req(`nodeId=${NODE}`))
    expect(res.status).toBe(401)
  })

  it('400s on a malformed nodeId', async () => {
    const res = await GET(req('nodeId=not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('404s when the node is not visible (RLS) or not a tenant_db', async () => {
    createClientMock.mockResolvedValue(mockClient({ node: null }))
    const res = await GET(req(`nodeId=${NODE}`))
    expect(res.status).toBe(404)
  })

  it('returns a PDF attachment for a visible tenant node', async () => {
    const res = await GET(req(`nodeId=${NODE}&size=A5`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('legend-card-12A.pdf')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- legend-card/pdf`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`route.ts`:

```ts
/**
 * Legend-card PDF export — GET ?nodeId=<uuid>&size=A4|A5
 *
 * Read-only: cookie client under RLS. Any project-visible role (including
 * client_viewer) may print; the RLS-gated node read IS the visibility gate
 * (invisible or non-tenant node → 404). `size` overrides the tenant's
 * persisted legend_card_size (default A4).
 *
 * rbac-matrix.md: listed under tenant-schedule endpoints.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import {
  renderLegendCardPdf,
  type LegendCardCircuit,
  type LegendCardSize,
} from '@/lib/db-legend/render-legend-card'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const nodeId = req.nextUrl.searchParams.get('nodeId') ?? ''
  if (!z.string().uuid().safeParse(nodeId).success) {
    return NextResponse.json({ error: 'Invalid nodeId' }, { status: 400 })
  }

  // Node — RLS-gated read doubles as the access check.
  const { data: node } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select(
      'id, project_id, code, kind, shop_number, shop_name, breaker_rating_a, pole_config, incomer_breaker_a, incomer_pole_config',
    )
    .eq('id', nodeId)
    .eq('kind', 'tenant_db')
    .maybeSingle()
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const project = await projectService.getById(supabase as never, node.project_id).catch(() => null)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Header fields — best-effort (pre-00169 the columns don't exist).
  let details: {
    db_location: string | null
    db_fed_from: string | null
    db_earth_leakage_ma: number | null
    legend_card_size: 'A4' | 'A5'
  } | null = null
  try {
    const { data } = await (supabase as any)
      .schema('structure')
      .from('tenant_details')
      .select('db_location, db_fed_from, db_earth_leakage_ma, legend_card_size')
      .eq('node_id', nodeId)
      .maybeSingle()
    details = data ?? null
  } catch {
    // Non-fatal — header prints with em-dashes.
  }

  let circuits: LegendCardCircuit[] = []
  try {
    const { data } = await (supabase as any)
      .schema('structure')
      .from('node_circuits')
      .select('circuit_no, description, phase, breaker_rating_a, poles, curve, cable_size, is_spare, sort_order')
      .eq('node_id', nodeId)
      .order('sort_order', { ascending: true })
    circuits = (data ?? []) as LegendCardCircuit[]
  } catch {
    // Non-fatal — card prints "No circuits captured yet."
  }

  const sizeParam = req.nextUrl.searchParams.get('size')
  const size: LegendCardSize =
    sizeParam === 'A4' || sizeParam === 'A5'
      ? sizeParam
      : details?.legend_card_size === 'A5'
        ? 'A5'
        : 'A4'

  const breakerA = node.breaker_rating_a ?? node.incomer_breaker_a
  const poles = node.pole_config ?? node.incomer_pole_config
  const mainBreaker = breakerA != null ? (poles ? `${breakerA} A ${poles}` : `${breakerA} A`) : null

  const bytes = await renderLegendCardPdf(
    {
      projectName: project.name as string,
      shopNumber: node.shop_number ?? null,
      shopName: node.shop_name ?? null,
      dbCode: node.code as string,
      mainBreaker,
      header: {
        location: details?.db_location ?? null,
        fedFrom: details?.db_fed_from ?? null,
        earthLeakageMa: details?.db_earth_leakage_ma ?? null,
      },
      circuits,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    size,
  )

  const stem = String(node.shop_number ?? node.code).replace(/[^A-Za-z0-9._-]+/g, '-')
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="legend-card-${stem}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- legend-card/pdf`
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/tenant-schedule/legend-card/"
git commit -m "feat(web): legend-card PDF route (RLS-gated read, A4/A5 override)"
```

---

### Task 6: DbLegendPanel component (TDD)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/DbLegendPanel.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/DbLegendPanel.test.tsx`

Pattern source: `ScopeOfWorkPanel.tsx` (inline-expand panel, optimistic state, `useTransition`, error banner, × close). Sibling test files show the jsdom setup — check `ScopeOfWorkPanel.test.tsx` for the render helpers/imports used and mirror them.

- [ ] **Step 1: Write the failing tests**

`DbLegendPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { upsertMock, deleteMock, quickAddMock, headerMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  deleteMock: vi.fn(),
  quickAddMock: vi.fn(),
  headerMock: vi.fn(),
}))

vi.mock('@/actions/db-legend.actions', () => ({
  upsertCircuitAction: upsertMock,
  deleteCircuitAction: deleteMock,
  quickAddWaysAction: quickAddMock,
  updateLegendHeaderAction: headerMock,
}))

import { DbLegendPanel } from './DbLegendPanel'
import type { LegendCircuit } from '@esite/shared'

const circuits: LegendCircuit[] = [
  { id: 'c1', node_id: 'n1', circuit_no: '1', description: 'Lights shop 5', phase: 'L1', breaker_rating_a: 20, poles: 1, curve: 'C', cable_size: '2.5mm²', is_spare: false, sort_order: 1 },
  { id: 'c2', node_id: 'n1', circuit_no: '2', description: null, phase: null, breaker_rating_a: null, poles: null, curve: null, cable_size: null, is_spare: true, sort_order: 2 },
]

function renderPanel(overrides: Partial<Parameters<typeof DbLegendPanel>[0]> = {}) {
  return render(
    <DbLegendPanel
      projectId="11111111-1111-1111-1111-111111111111"
      nodeId="n1"
      shopName="Test Tenant"
      mainBreaker="63 A TP"
      header={null}
      circuits={circuits}
      readOnly={false}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  upsertMock.mockReset(); deleteMock.mockReset(); quickAddMock.mockReset(); headerMock.mockReset()
})

describe('DbLegendPanel', () => {
  it('renders existing circuits with spare marking', () => {
    renderPanel()
    expect(screen.getByDisplayValue('Lights shop 5')).toBeTruthy()
    expect(screen.getAllByDisplayValue('1').length).toBeGreaterThan(0)
    // spare row: its checkbox is checked
    const spares = screen.getAllByLabelText(/spare/i) as HTMLInputElement[]
    expect(spares.some((el) => el.checked)).toBe(true)
  })

  it('shows the node main breaker read-only', () => {
    renderPanel()
    expect(screen.getByText('63 A TP')).toBeTruthy()
  })

  it('quick-adds N ways via the action and appends returned rows', async () => {
    quickAddMock.mockResolvedValue({
      ok: true,
      circuits: [{ id: 'c3', node_id: 'n1', circuit_no: '3', description: null, phase: null, breaker_rating_a: null, poles: null, curve: null, cable_size: null, is_spare: true, sort_order: 3 }],
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /add ways/i }))
    await waitFor(() => expect(quickAddMock).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'n1', 6))
    await waitFor(() => expect(screen.getAllByDisplayValue('3').length).toBeGreaterThan(0))
  })

  it('hides all mutating controls when readOnly', () => {
    renderPanel({ readOnly: true })
    expect(screen.queryByRole('button', { name: /add ways/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add way$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    // print stays available
    expect(screen.getByRole('link', { name: /print legend card/i })).toBeTruthy()
  })

  it('surfaces action errors in the banner', async () => {
    quickAddMock.mockResolvedValue({ error: 'Circuit 3 already exists on this board' })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /add ways/i }))
    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- DbLegendPanel`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`DbLegendPanel.tsx`:

```tsx
'use client'

/**
 * DbLegendPanel — per-tenant DB legend editor (spec 2026-07-08).
 *
 *   1. Header strip: location / fed-from / earth-leakage / card size —
 *      auto-saves on blur via updateLegendHeaderAction. Main breaker is
 *      displayed read-only from the node's breaker fields.
 *   2. Circuit grid: inline-editable rows (save appears when dirty),
 *      spare toggle, delete, single "Add way", quick-add N ways.
 *   3. Print: anchor to /api/tenant-schedule/legend-card/pdf.
 *
 * Inline-expand panel — ScheduleTable renders it full-width below the tenant
 * row (same shape as ScopeOfWorkPanel).
 */

import { useState, useTransition } from 'react'
import type { LegendCircuit, LegendHeader } from '@esite/shared'
import {
  upsertCircuitAction,
  deleteCircuitAction,
  quickAddWaysAction,
  updateLegendHeaderAction,
  type CircuitInput,
} from '@/actions/db-legend.actions'

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  /** Pre-formatted node breaker, e.g. "63 A TP" (ScheduleTable's formatBreaker). */
  mainBreaker: string | null
  header: LegendHeader | null
  circuits: LegendCircuit[]
  readOnly?: boolean
  onClose: () => void
}

type DraftCircuit = Omit<LegendCircuit, 'id' | 'node_id' | 'sort_order'> & {
  id: string | null // null = unsaved new row
  localKey: string
}

function toDraft(c: LegendCircuit): DraftCircuit {
  return { ...c, id: c.id, localKey: c.id }
}

function emptyDraft(): DraftCircuit {
  return {
    id: null,
    localKey: crypto.randomUUID(),
    circuit_no: '',
    description: null,
    phase: null,
    breaker_rating_a: null,
    poles: null,
    curve: null,
    cable_size: null,
    is_spare: false,
  }
}

export function DbLegendPanel({
  projectId,
  nodeId,
  shopName,
  mainBreaker,
  header,
  circuits: initialCircuits,
  readOnly = false,
  onClose,
}: Props) {
  const [rows, setRows] = useState<DraftCircuit[]>(initialCircuits.map(toDraft))
  const [savedByKey, setSavedByKey] = useState<Record<string, DraftCircuit>>(
    Object.fromEntries(initialCircuits.map((c) => [c.id, toDraft(c)])),
  )
  const [headerDraft, setHeaderDraft] = useState({
    db_location: header?.db_location ?? '',
    db_fed_from: header?.db_fed_from ?? '',
    db_earth_leakage_ma: header?.db_earth_leakage_ma != null ? String(header.db_earth_leakage_ma) : '',
    legend_card_size: header?.legend_card_size ?? ('A4' as 'A4' | 'A5'),
  })
  const [quickCount, setQuickCount] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function isDirty(row: DraftCircuit): boolean {
    if (row.id === null) return true
    const saved = savedByKey[row.localKey]
    if (!saved) return true
    return (
      row.circuit_no !== saved.circuit_no ||
      row.description !== saved.description ||
      row.phase !== saved.phase ||
      row.breaker_rating_a !== saved.breaker_rating_a ||
      row.poles !== saved.poles ||
      row.curve !== saved.curve ||
      row.cable_size !== saved.cable_size ||
      row.is_spare !== saved.is_spare
    )
  }

  function patchRow(localKey: string, patch: Partial<DraftCircuit>) {
    setRows((prev) => prev.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r)))
  }

  function saveRow(row: DraftCircuit) {
    setError(null)
    const input: CircuitInput = {
      id: row.id ?? undefined,
      circuit_no: row.circuit_no,
      description: row.description || null,
      phase: row.phase,
      breaker_rating_a: row.breaker_rating_a,
      poles: row.poles,
      curve: row.curve,
      cable_size: row.cable_size || null,
      is_spare: row.is_spare,
    }
    startTransition(async () => {
      const res = await upsertCircuitAction(projectId, nodeId, input)
      if ('error' in res) {
        setError(res.error)
        return
      }
      const saved: DraftCircuit = { ...row, id: res.circuit.id }
      setRows((prev) => prev.map((r) => (r.localKey === row.localKey ? saved : r)))
      setSavedByKey((prev) => ({ ...prev, [row.localKey]: saved }))
    })
  }

  function removeRow(row: DraftCircuit) {
    setError(null)
    if (row.id === null) {
      setRows((prev) => prev.filter((r) => r.localKey !== row.localKey))
      return
    }
    const snapshot = rows
    setRows((prev) => prev.filter((r) => r.localKey !== row.localKey)) // optimistic
    startTransition(async () => {
      const res = await deleteCircuitAction(projectId, nodeId, row.id as string)
      if ('error' in res) {
        setError(res.error)
        setRows(snapshot)
      }
    })
  }

  function quickAdd() {
    setError(null)
    startTransition(async () => {
      const res = await quickAddWaysAction(projectId, nodeId, quickCount)
      if ('error' in res) {
        setError(res.error)
        return
      }
      const drafts = res.circuits.map(toDraft)
      setRows((prev) => [...prev, ...drafts])
      setSavedByKey((prev) => ({
        ...prev,
        ...Object.fromEntries(drafts.map((d) => [d.localKey, d])),
      }))
    })
  }

  function saveHeaderField(patch: Partial<typeof headerDraft>) {
    setError(null)
    const next = { ...headerDraft, ...patch }
    setHeaderDraft(next)
    startTransition(async () => {
      const res = await updateLegendHeaderAction(projectId, nodeId, {
        db_location: next.db_location.trim() || null,
        db_fed_from: next.db_fed_from.trim() || null,
        db_earth_leakage_ma: next.db_earth_leakage_ma.trim() === '' ? null : Number(next.db_earth_leakage_ma),
        legend_card_size: next.legend_card_size,
      })
      if ('error' in res) setError(res.error)
    })
  }

  const printHref = `/api/tenant-schedule/legend-card/pdf?nodeId=${nodeId}&size=${headerDraft.legend_card_size}`

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--c-bg)',
        borderTop: '1px solid var(--c-border)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--c-text-dim)', marginRight: 8,
            }}
          >
            DB Legend
          </span>
          {shopName && <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{shopName}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href={printHref}
            style={{
              fontSize: 11, fontWeight: 600, textDecoration: 'none', padding: '4px 10px',
              border: '1px solid var(--c-green)', borderRadius: 5, color: 'var(--c-green)', whiteSpace: 'nowrap',
            }}
          >
            Print legend card ({headerDraft.legend_card_size})
          </a>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
            aria-label="Close legend panel"
          >
            ×
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px', marginBottom: 12, background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* Board header fields */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <HeaderField label="Location">
          <input
            type="text"
            value={headerDraft.db_location}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_location: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(130)}
          />
        </HeaderField>
        <HeaderField label="Fed from">
          <input
            type="text"
            value={headerDraft.db_fed_from}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_fed_from: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(130)}
          />
        </HeaderField>
        <HeaderField label="Main breaker">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text)', padding: '5px 0', display: 'inline-block' }}>
            {mainBreaker ?? '—'}
          </span>
        </HeaderField>
        <HeaderField label="Earth leakage (mA)">
          <input
            type="number"
            min={1}
            value={headerDraft.db_earth_leakage_ma}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_earth_leakage_ma: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(70)}
          />
        </HeaderField>
        <HeaderField label="Card size">
          <select
            value={headerDraft.legend_card_size}
            disabled={readOnly}
            onChange={(e) => saveHeaderField({ legend_card_size: e.target.value as 'A4' | 'A5' })}
            style={inputStyle(64)}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </HeaderField>
      </div>

      {/* Circuit grid */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
            {['CCT', 'Phase', 'Description', 'CB (A)', 'Poles', 'Curve', 'Cable', 'Spare', ''].map((h) => (
              <th
                key={h}
                style={{
                  padding: '6px 8px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10,
                  fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-dim)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.localKey} style={{ borderBottom: '1px solid var(--c-border)', opacity: row.is_spare ? 0.65 : 1 }}>
              <td style={cellStyle}>
                <input type="text" value={row.circuit_no} disabled={readOnly} aria-label={`Circuit number`}
                  onChange={(e) => patchRow(row.localKey, { circuit_no: e.target.value })} style={inputStyle(44)} />
              </td>
              <td style={cellStyle}>
                <select value={row.phase ?? ''} disabled={readOnly} aria-label="Phase"
                  onChange={(e) => patchRow(row.localKey, { phase: (e.target.value || null) as DraftCircuit['phase'] })} style={inputStyle(56)}>
                  <option value="">—</option>
                  <option value="L1">L1</option>
                  <option value="L2">L2</option>
                  <option value="L3">L3</option>
                  <option value="3P">3Φ</option>
                </select>
              </td>
              <td style={cellStyle}>
                <input type="text" value={row.description ?? ''} disabled={readOnly} placeholder={row.is_spare ? 'SPARE' : ''}
                  aria-label="Description"
                  onChange={(e) => patchRow(row.localKey, { description: e.target.value || null })} style={inputStyle(200)} />
              </td>
              <td style={cellStyle}>
                <input type="number" min={0} value={row.breaker_rating_a ?? ''} disabled={readOnly} aria-label="Breaker rating (A)"
                  onChange={(e) => patchRow(row.localKey, { breaker_rating_a: e.target.value === '' ? null : Number(e.target.value) })}
                  style={inputStyle(60)} />
              </td>
              <td style={cellStyle}>
                <select value={row.poles ?? ''} disabled={readOnly} aria-label="Poles"
                  onChange={(e) => patchRow(row.localKey, { poles: (e.target.value === '' ? null : Number(e.target.value)) as DraftCircuit['poles'] })}
                  style={inputStyle(48)}>
                  <option value="">—</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </td>
              <td style={cellStyle}>
                <select value={row.curve ?? ''} disabled={readOnly} aria-label="Curve"
                  onChange={(e) => patchRow(row.localKey, { curve: (e.target.value || null) as DraftCircuit['curve'] })} style={inputStyle(48)}>
                  <option value="">—</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </td>
              <td style={cellStyle}>
                <input type="text" value={row.cable_size ?? ''} disabled={readOnly} aria-label="Cable size"
                  onChange={(e) => patchRow(row.localKey, { cable_size: e.target.value || null })} style={inputStyle(90)} />
              </td>
              <td style={cellStyle}>
                <input type="checkbox" checked={row.is_spare} disabled={readOnly} aria-label="Spare"
                  onChange={(e) => patchRow(row.localKey, { is_spare: e.target.checked })} />
              </td>
              <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                {!readOnly && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isDirty(row) && (
                      <button onClick={() => saveRow(row)} disabled={isPending || row.circuit_no.trim() === ''}
                        style={smallBtn('var(--c-green)')}>
                        Save
                      </button>
                    )}
                    <button onClick={() => removeRow(row)} disabled={isPending} aria-label={`Delete circuit ${row.circuit_no}`}
                      style={smallBtn('var(--c-red)')}>
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...cellStyle, color: 'var(--c-text-dim)', padding: '14px 8px' }}>
                No circuits captured yet{readOnly ? '.' : ' — add ways below.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Add controls */}
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button onClick={() => setRows((prev) => [...prev, emptyDraft()])} disabled={isPending} style={smallBtn('var(--c-text-mid)')}>
            + Add way
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={1} max={60} value={quickCount} aria-label="Number of ways to add"
              onChange={(e) => setQuickCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              style={inputStyle(52)}
            />
            <button onClick={quickAdd} disabled={isPending} style={smallBtn('var(--c-green)')}>
              + Add ways
            </button>
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>new ways start as SPARE</span>
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--c-text-dim)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const cellStyle: React.CSSProperties = { padding: '5px 8px' }

function inputStyle(width: number): React.CSSProperties {
  return {
    width, padding: '4px 6px', fontSize: 12, fontFamily: 'var(--font-mono)',
    background: 'var(--c-panel)', color: 'var(--c-text)',
    border: '1px solid var(--c-border)', borderRadius: 4,
  }
}

function smallBtn(color: string): React.CSSProperties {
  return {
    background: 'none', border: `1px solid ${color}`, borderRadius: 5, cursor: 'pointer',
    padding: '3px 9px', fontSize: 11, color, fontWeight: 600, whiteSpace: 'nowrap',
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test -- DbLegendPanel`
Expected: 5 passing. If jsdom/environment errors appear, copy the test-environment pragma or setup import used at the top of `ScopeOfWorkPanel.test.tsx` — mirror the sibling exactly.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/DbLegendPanel.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/DbLegendPanel.test.tsx"
git commit -m "feat(web): DbLegendPanel — editable circuit grid + header strip + print link"
```

---

### Task 7: Wire panel into ScheduleTable + page data loading

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`

- [ ] **Step 1: ScheduleTable — imports, props, state**

Add imports:

```tsx
import { DbLegendPanel } from './DbLegendPanel'
import type { LegendCircuit, LegendHeader } from '@esite/shared'
```

Add to `interface Props` (optional with defaults so existing tests/fixtures keep compiling):

```tsx
  /** node_id → legend circuits (structure.node_circuits, 00169). */
  legendCircuitsByNode?: Record<string, LegendCircuit[]>
  /** node_id → legend header fields (tenant_details, 00169). */
  legendHeaderByNode?: Record<string, LegendHeader>
```

Destructure with defaults in the component signature:

```tsx
  legendCircuitsByNode = {},
  legendHeaderByNode = {},
```

Add state + toggle beside the scope/layout ones, and extend the existing toggles so only one panel is open per node:

```tsx
  // node_id of the currently-expanded DB-legend panel (one at a time)
  const [expandedLegendNodeId, setExpandedLegendNodeId] = useState<string | null>(null)
```

```tsx
  function toggleLegend(nodeId: string) {
    setExpandedLegendNodeId((prev) => (prev === nodeId ? null : nodeId))
    if (expandedNodeId === nodeId) setExpandedNodeId(null)
    if (expandedLayoutNodeId === nodeId) setExpandedLayoutNodeId(null)
  }
```

In `toggleScope` add: `if (expandedLegendNodeId === nodeId) setExpandedLegendNodeId(null)`.
In `toggleLayout` add: `if (expandedLegendNodeId === nodeId) setExpandedLegendNodeId(null)`.

- [ ] **Step 2: ScheduleTable — row wiring**

Inside the row map, next to `const isLayoutExpanded = …`:

```tsx
const isLegendExpanded = expandedLegendNodeId === node.id
```

Include it in the row's border/background conditions (`isExpanded || isLayoutExpanded || isLegendExpanded`).

In the actions cell, after the Layout button (available to ALL roles — the panel itself handles readOnly, and printing is read-only):

```tsx
<button
  onClick={() => toggleLegend(node.id)}
  style={{
    background: isLegendExpanded ? 'var(--c-green-dim)' : 'none',
    border: '1px solid',
    borderColor: isLegendExpanded ? 'var(--c-green)' : 'var(--c-border)',
    borderRadius: 5,
    cursor: 'pointer',
    padding: '4px 10px',
    fontSize: 11,
    color: isLegendExpanded ? 'var(--c-green)' : 'var(--c-text-dim)',
    fontWeight: 600,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  }}
>
  {isLegendExpanded ? 'Close' : 'Legend ↓'}
</button>
```

After the layout expanded-row block, add:

```tsx
{/* Expanded DB-legend panel */}
{isLegendExpanded && (
  <tr>
    <td colSpan={11 + scopeItemTypes.length * 2} style={{ padding: 0 }}>
      <DbLegendPanel
        projectId={projectId}
        nodeId={node.id}
        shopName={node.shop_name ?? node.name}
        mainBreaker={formatBreaker(node) === '—' ? null : formatBreaker(node)}
        header={legendHeaderByNode[node.id] ?? null}
        circuits={legendCircuitsByNode[node.id] ?? []}
        readOnly={readOnly}
        onClose={() => setExpandedLegendNodeId(null)}
      />
    </td>
  </tr>
)}
```

- [ ] **Step 3: page.tsx — load legend data (separate best-effort queries, following the BO-cells precedent so a pre-migration failure only blanks the legend panel)**

Add to the `@esite/shared` import line: `LegendCircuit, LegendHeader` (as types — `import type` alongside, matching file style).

After the node_orders block, add:

```tsx
// ── Legend circuits + header (00169; best-effort — pre-apply the table/columns
// don't exist and the panel simply opens empty) ─────────────────────────────
const legendCircuitsByNode: Record<string, LegendCircuit[]> = {}
const legendHeaderByNode: Record<string, LegendHeader> = {}

if (nodeIds.length > 0) {
  try {
    const { data } = await supabase
      .schema('structure')
      .from('node_circuits')
      .select('id, node_id, circuit_no, description, phase, breaker_rating_a, poles, curve, cable_size, is_spare, sort_order')
      .in('node_id', nodeIds)
      .order('sort_order', { ascending: true })
    // Generated DB types lag migration 00169 — cast at the query boundary.
    for (const c of (data ?? []) as unknown as LegendCircuit[]) {
      if (!legendCircuitsByNode[c.node_id]) legendCircuitsByNode[c.node_id] = []
      legendCircuitsByNode[c.node_id].push(c)
    }
  } catch {
    // Non-fatal
  }

  try {
    const { data } = await supabase
      .schema('structure')
      .from('tenant_details')
      .select('node_id, db_location, db_fed_from, db_earth_leakage_ma, legend_card_size')
      .in('node_id', nodeIds)
    for (const h of (data ?? []) as unknown as LegendHeader[]) {
      legendHeaderByNode[h.node_id] = h
    }
  } catch {
    // Non-fatal: pre-migration-00169 the columns don't exist.
  }
}
```

Pass both to `<ScheduleTable … legendCircuitsByNode={legendCircuitsByNode} legendHeaderByNode={legendHeaderByNode} />`.

- [ ] **Step 4: Run the web test suite + type-check**

Run: `pnpm --filter web test && pnpm --filter web type-check`
Expected: all pass, including the pre-existing `ScheduleTable.test.tsx` (new props are optional). If ScheduleTable tests assert on button sets per row, update the fixtures/assertions there to include the new Legend button.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/"
git commit -m "feat(web): wire DB Legend panel into tenant schedule (toggle, data loading)"
```

---

### Task 8: rbac-matrix + lint + full suites

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Update the RBAC matrix**

Read `docs/rbac-matrix.md`, find the tenant-schedule endpoint rows (added by PR #135), and append in the same table format:

- `GET /api/tenant-schedule/legend-card/pdf` — any project-visible role (client_viewer included, read-only PDF); RLS node read is the gate.
- Server actions `upsertCircuitAction` / `deleteCircuitAction` / `quickAddWaysAction` / `updateLegendHeaderAction` (`db-legend.actions.ts`) — `ORG_WRITE_ROLES` via `requireEffectiveRole` (service-role writes).

Match the exact table/section formatting used by the neighbouring entries.

- [ ] **Step 2: Full verification battery**

```bash
pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter web type-check && pnpm --filter web lint
```

Expected: everything green. Fix anything that isn't before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs: rbac-matrix entries for DB legend endpoints/actions"
```

---

### Task 9: Push branch + PR (STOP — user-facing gates after this)

- [ ] **Step 1: Push**

```bash
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" feat/tenant-db-legend
```

- [ ] **Step 2: Open PR** (base `main`) titled "Tenant DB legend cards — circuit capture + printable A4/A5 legend card". Body: summary, spec/plan paths, test evidence, the rbac-matrix note, and the deploy checklist below. End the body with the standard attribution line.

- [ ] **Step 3: Deploy checklist (in PR body — do NOT execute without the user):**

1. Apply migration `00169_db_legend.sql` to the live DB via the Supabase Management API (`POST /v1/projects/cbskbnvvgcybmfikxgky/database/query`, PAT from macOS keychain: `security find-generic-password -s "Supabase CLI" -w`, strip `go-keyring-base64:` prefix + base64-decode).
2. Log it in `schema_migrations` (project convention) and run `NOTIFY pgrst, 'reload schema';` (no PostgREST db_schema PATCH needed — existing schema).
3. Merge PR after CI green → Vercel deploys.
4. Live verification: as an admin on a real project — open a tenant's Legend panel, quick-add 12 ways, describe a few, print A4 and A5; sign in as `rbac-test@e-site.live` (contractor fixture) and confirm the panel is read-only but Print works.

---

## Self-review notes (done at plan time)

- **Spec coverage:** table+RLS (Task 2), header columns (Task 2), quick-add + spare default (Tasks 1/3/6), SANS columns (Tasks 2/6), panel placement + read-only (Tasks 6/7), A4/A5 persisted + override (Tasks 3/5/6), pdf-lib single parameterised layout + pagination + empty state (Task 4), route gating + filename (Task 5), rbac-matrix (Task 8), deploy steps + live verification (Task 9). Out-of-scope items untouched. ✔
- **Types:** `LegendCircuit`/`LegendHeader` defined once in `@esite/shared` (Task 1) and imported everywhere else; action names identical across Tasks 3/6; `CircuitInput` exported from actions and imported by the panel. ✔
- **Known risk:** the panel/route tests' supabase mocks are hand-rolled — if the sibling tests use a shared helper, prefer mirroring it.
