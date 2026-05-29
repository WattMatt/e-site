# Membership System PR-A: Sub-Org Schema + Central Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `projects.contractor_companies` table (shipped in 343505b) with a proper sub-organisation entity model. Ship a working central pool UI where WM admins can create and manage external contracting parties (sub-orgs) with contact details. Roster + project attachment surfaces ship empty placeholders (filled in PR-B and PR-C).

**Architecture:** Extend `public.organisations` with `is_shadow` + `parent_organisation_id` flags and contact-detail columns. Sub-orgs are full Postgres organisations marked as shadows, owned-by-parent until claimed. Web layer adds `sub-organisations.actions.ts` and two pages under `/settings/sub-organizations`. Existing `projects.contractor_companies` table and `user_organisations.contractor_company_id` column are dropped entirely (both are empty on prod — zero data loss).

**Tech Stack:** Next.js 15 App Router (server components + 'use server' actions), Supabase Postgres with RLS, vitest + testing-library, Zod for input validation, `@esite/shared` workspace package for types.

**Reference spec:** [docs/superpowers/specs/2026-05-29-membership-system-design.md](../specs/2026-05-29-membership-system-design.md)

---

## File Structure

**Create:**
- `apps/edge-functions/supabase/migrations/00109_sub_organisations.sql` — schema + RLS + deprecation
- `apps/web/src/actions/sub-organisations.actions.ts` — list/create/update/deactivate
- `apps/web/src/actions/sub-organisations.actions.test.ts` — unit tests for the actions
- `apps/web/src/app/(admin)/settings/sub-organizations/page.tsx` — list page (server component)
- `apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.tsx` — client list + actions
- `apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.tsx` — client create modal
- `apps/web/src/app/(admin)/settings/sub-organizations/[id]/page.tsx` — detail page (server component)
- `apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.tsx` — client edit form

**Modify:**
- `packages/shared/src/types/index.ts` — add `SubOrganisation` interface
- `apps/web/src/app/(admin)/settings/users/page.tsx` — remove ContractorCompaniesPanel, UserCompanyDropdown rows, companies query
- `apps/web/src/app/(admin)/settings/users/AddUserForm.tsx` — remove company dropdown

**Delete:**
- `apps/web/src/actions/contractor-companies.actions.ts`
- `apps/web/src/app/(admin)/settings/users/ContractorCompaniesPanel.tsx`
- `apps/web/src/app/(admin)/settings/users/UserCompanyDropdown.tsx`

**Test files modified:**
- None in PR-A (the existing tests for SettingsTabs, ContractorForm, etc. don't reference the deleted components).

---

## Task 1: Write migration 00109

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00109_sub_organisations.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 00109_sub_organisations.sql
--
-- Promote sub-organisations from the flat `contractor_companies` label model
-- (introduced 00108, shipped in 343505b) to first-class rows in
-- public.organisations. A "sub-org" is just a `public.organisations` row
-- marked as a shadow whose contact details and people roster are managed by
-- a parent org (e.g., WM Consulting). When/if the sub-org's owner signs up,
-- the shadow flag clears and they take over.
--
-- This migration:
--   1. Adds is_shadow + parent_organisation_id + contact-detail columns to
--      public.organisations.
--   2. Grants owner/admin/PM of parent_organisation_id SELECT + UPDATE on
--      their shadow children via a new RLS policy.
--   3. Drops projects.contractor_companies (empty on prod) and
--      user_organisations.contractor_company_id (all NULLs on prod).
--
-- Reversible:
--   - To recreate contractor_companies: re-apply 00108.
--   - To remove sub-org columns: ALTER TABLE public.organisations DROP COLUMN <each>.

-- 1. New columns on public.organisations
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS is_shadow              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_organisation_id UUID NULL REFERENCES public.organisations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address                TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS registration_number    TEXT NULL,
  ADD COLUMN IF NOT EXISTS vat_number             TEXT NULL,
  ADD COLUMN IF NOT EXISTS signatory_name         TEXT NULL,
  ADD COLUMN IF NOT EXISTS signatory_title        TEXT NULL;

COMMENT ON COLUMN public.organisations.is_shadow IS
  'TRUE while this org was created by another org as a contracting party and '
  'has not yet been claimed by its own owner. Shadow orgs are managed by '
  'parent_organisation_id''s owner/admin/PM. See migration 00109.';
COMMENT ON COLUMN public.organisations.parent_organisation_id IS
  'For shadow orgs, the creating org. NULL once claimed (or for non-shadow orgs).';

CREATE INDEX idx_organisations_parent_shadow
  ON public.organisations (parent_organisation_id, is_shadow)
  WHERE is_shadow = TRUE;

-- 2. RLS: parent-managed shadow orgs
-- Existing policy on public.organisations (per current schema) gates by
-- user_organisations membership. We add a parallel policy that lets owners
-- of the parent org SELECT and UPDATE shadow children.

DROP POLICY IF EXISTS "Parent admins can view shadow children" ON public.organisations;
CREATE POLICY "Parent admins can view shadow children"
  ON public.organisations FOR SELECT
  USING (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organisation_id = public.organisations.parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );

DROP POLICY IF EXISTS "Parent admins can update shadow children" ON public.organisations;
CREATE POLICY "Parent admins can update shadow children"
  ON public.organisations FOR UPDATE
  USING (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organisation_id = public.organisations.parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );

DROP POLICY IF EXISTS "Parent admins can insert shadow children" ON public.organisations;
CREATE POLICY "Parent admins can insert shadow children"
  ON public.organisations FOR INSERT
  WITH CHECK (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organisation_id = parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );

-- 3. Deprecate contractor_companies (empty on prod)
ALTER TABLE public.user_organisations DROP COLUMN IF EXISTS contractor_company_id;
DROP TABLE IF EXISTS projects.contractor_companies CASCADE;
```

- [ ] **Step 2: Apply to prod Supabase**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && . scripts/db/mgmt-api.sh && mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00109_sub_organisations.sql
```

Expected output: `[]` (empty array — DDL statements return no rows).

- [ ] **Step 3: Verify columns + dropped table**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && . scripts/db/mgmt-api.sh && mgmt_query "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='organisations' AND column_name IN ('is_shadow','parent_organisation_id','address','phone','registration_number','vat_number','signatory_name','signatory_title') ORDER BY column_name;"
```

Expected: 8 rows, all 8 column names present.

```bash
cd /Users/spud/Developer/ESITE.V1/esite && . scripts/db/mgmt-api.sh && mgmt_query "SELECT to_regclass('projects.contractor_companies') AS still_exists, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_organisations' AND column_name='contractor_company_id') AS column_still_exists;"
```

Expected: `still_exists: null`, `column_still_exists: false`.

- [ ] **Step 4: Stage + commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add apps/edge-functions/supabase/migrations/00109_sub_organisations.sql && git commit -m "feat(db): migration 00109 — sub-org schema on public.organisations + drop contractor_companies"
```

---

## Task 2: Add `SubOrganisation` type to shared

**Files:**
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Add the interface**

Open `packages/shared/src/types/index.ts`. After the existing `ContractorCompany` interface (lines around 38–52), REPLACE the `ContractorCompany` interface with:

```typescript
/**
 * Sub-organisation entity. A `public.organisations` row marked as a shadow
 * (is_shadow=TRUE, parent_organisation_id=parent). Holds contact details
 * and acts as the identity boundary for external site agents (Bob's
 * Building's people log in as Bob's Building users, granted access to
 * specific projects via project_members).
 *
 * Replaces the ContractorCompany model from migration 00108 (dropped in 00109).
 *
 * See migration 00109_sub_organisations.sql for full semantics.
 */
export interface SubOrganisation {
  id: string
  name: string
  parent_organisation_id: string | null
  is_shadow: boolean
  address: string | null
  phone: string | null
  registration_number: string | null
  vat_number: string | null
  signatory_name: string | null
  signatory_title: string | null
  created_at: string
}
```

- [ ] **Step 2: Typecheck shared package**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter @esite/shared type-check
```

Expected: PASS — no output errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add packages/shared/src/types/index.ts && git commit -m "feat(shared): SubOrganisation type — replaces ContractorCompany"
```

---

## Task 3: Create `sub-organisations.actions.ts` skeleton + listSubOrganisations test

**Files:**
- Create: `apps/web/src/actions/sub-organisations.actions.ts`
- Create: `apps/web/src/actions/sub-organisations.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/actions/sub-organisations.actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOrgContextMock = vi.fn()
const createClientMock = vi.fn()
const requireRoleMock = vi.fn()

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

describe('listSubOrganisations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { listSubOrganisations } = await import('./sub-organisations.actions')
    const result = await listSubOrganisations()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not authenticated/i)
  })

  it('returns the org\'s shadow children with shadow filter', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'owner' })
    const order2 = vi.fn().mockResolvedValueOnce({ data: [{ id: 's1', name: 'Bobs', is_shadow: true }], error: null })
    const order1 = vi.fn().mockReturnValueOnce({ order: order2 })
    const eq = vi.fn().mockReturnValueOnce({ order: order1 })
    const select = vi.fn().mockReturnValueOnce({ eq })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { listSubOrganisations } = await import('./sub-organisations.actions')
    const result = await listSubOrganisations()
    expect(result.ok).toBe(true)
    expect(from).toHaveBeenCalledWith('organisations')
    expect(eq).toHaveBeenCalledWith('parent_organisation_id', orgId)
    if (result.ok) expect(result.subOrganisations).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: FAIL with "Cannot find module './sub-organisations.actions'" or similar.

- [ ] **Step 3: Implement the actions file with `listSubOrganisations` only**

Create `apps/web/src/actions/sub-organisations.actions.ts`:

```typescript
'use server'

/**
 * Sub-organisation CRUD (migration 00109). Sub-orgs are
 * public.organisations rows marked as shadows (is_shadow=TRUE,
 * parent_organisation_id=parent's id). The parent org's owner/admin/PM
 * manages them until the sub-org's owner claims it.
 *
 * See docs/superpowers/specs/2026-05-29-membership-system-design.md.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, type SubOrganisation } from '@esite/shared'

type ActionResult<T = Record<string, never>> =
  | (T extends Record<string, never> ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string }

const nameSchema = z.string().trim().min(1, 'Name required.').max(200)
const optionalText = z.string().trim().max(500).nullable().optional()
const uuidSchema = z.string().uuid()

function bust(): void {
  revalidatePath('/settings/sub-organizations')
}

/** List sub-orgs (shadow children) of the caller's primary org. */
export async function listSubOrganisations(): Promise<
  ActionResult<{ subOrganisations: SubOrganisation[] }>
> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .from('organisations')
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .eq('parent_organisation_id', ctx.organisationId)
    .order('is_shadow', { ascending: false })
    .order('name')
  if (error) return { ok: false, error: error.message }
  return { ok: true, subOrganisations: (data ?? []) as SubOrganisation[] }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add apps/web/src/actions/sub-organisations.actions.ts apps/web/src/actions/sub-organisations.actions.test.ts && git commit -m "feat(web): sub-organisations.actions — listSubOrganisations with test"
```

---

## Task 4: Add `createSubOrganisation` action + test

**Files:**
- Modify: `apps/web/src/actions/sub-organisations.actions.ts`
- Modify: `apps/web/src/actions/sub-organisations.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/actions/sub-organisations.actions.test.ts`:

```typescript
describe('createSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns ok:false when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: 'Bobs' })
    expect(result.ok).toBe(false)
  })

  it('rejects empty names', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: 'org', role: 'owner' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    createClientMock.mockResolvedValueOnce({})
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: '  ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/required/i)
  })

  it('creates a shadow org with the parent and contact details', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'owner' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'owner' })
    const inserted = {
      id: 'sub-1', name: "Bob's Building", is_shadow: true,
      parent_organisation_id: orgId, address: 'Cape Town', phone: null,
      registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const single = vi.fn().mockResolvedValueOnce({ data: inserted, error: null })
    const select = vi.fn().mockReturnValueOnce({ single })
    const insert = vi.fn().mockReturnValueOnce({ select })
    const from = vi.fn().mockReturnValueOnce({ insert })
    createClientMock.mockResolvedValueOnce({ from })
    const { createSubOrganisation } = await import('./sub-organisations.actions')
    const result = await createSubOrganisation({ name: "Bob's Building", address: 'Cape Town' })
    expect(result.ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: "Bob's Building",
      parent_organisation_id: orgId,
      is_shadow: true,
      address: 'Cape Town',
    }))
    if (result.ok) expect(result.subOrganisation.id).toBe('sub-1')
  })
})
```

- [ ] **Step 2: Run, expect failure on createSubOrganisation import**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: FAIL — `createSubOrganisation is not exported`.

- [ ] **Step 3: Implement `createSubOrganisation`**

Append to `apps/web/src/actions/sub-organisations.actions.ts`:

```typescript
const createSchema = z.object({
  name:                nameSchema,
  address:             optionalText,
  phone:               optionalText,
  registration_number: optionalText,
  vat_number:          optionalText,
  signatory_name:      optionalText,
  signatory_title:     optionalText,
})

/** Create a new shadow sub-org under the caller's primary org. */
export async function createSubOrganisation(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ subOrganisation: SubOrganisation }>> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const row = {
    name:                   parsed.data.name,
    parent_organisation_id: ctx.organisationId,
    is_shadow:              true,
    address:                parsed.data.address ?? null,
    phone:                  parsed.data.phone ?? null,
    registration_number:    parsed.data.registration_number ?? null,
    vat_number:             parsed.data.vat_number ?? null,
    signatory_name:         parsed.data.signatory_name ?? null,
    signatory_title:        parsed.data.signatory_title ?? null,
  }

  const { data, error } = await (supabase as any)
    .from('organisations')
    .insert(row)
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .single()
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true, subOrganisation: data as SubOrganisation }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: 5 tests pass (2 from Task 3 + 3 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add apps/web/src/actions/sub-organisations.actions.ts apps/web/src/actions/sub-organisations.actions.test.ts && git commit -m "feat(web): createSubOrganisation action + tests"
```

---

## Task 5: Add `updateSubOrganisation` action + test

**Files:**
- Modify: `apps/web/src/actions/sub-organisations.actions.ts`
- Modify: `apps/web/src/actions/sub-organisations.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe('updateSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates only the provided fields and skips the rest', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'admin' })
    requireRoleMock.mockResolvedValueOnce({ ok: true, role: 'admin' })
    const updated = {
      id: 'sub-1', name: "Bob's Building", is_shadow: true, parent_organisation_id: orgId,
      address: 'New Address', phone: '+27 21 555 0100',
      registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const single = vi.fn().mockResolvedValueOnce({ data: updated, error: null })
    const select = vi.fn().mockReturnValueOnce({ single })
    const eqParent = vi.fn().mockReturnValueOnce({ select })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const update = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ update })
    createClientMock.mockResolvedValueOnce({ from })
    const { updateSubOrganisation } = await import('./sub-organisations.actions')
    const result = await updateSubOrganisation('sub-1', { address: 'New Address', phone: '+27 21 555 0100' })
    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      address: 'New Address',
      phone: '+27 21 555 0100',
    }))
    // name and other fields should NOT be in the update payload
    const patch = update.mock.calls[0][0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('name')
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: FAIL — `updateSubOrganisation is not exported`.

- [ ] **Step 3: Implement `updateSubOrganisation`**

Append:

```typescript
const updateSchema = z.object({
  name:                nameSchema.optional(),
  address:             optionalText,
  phone:               optionalText,
  registration_number: optionalText,
  vat_number:          optionalText,
  signatory_name:      optionalText,
  signatory_title:     optionalText,
})

/** Update contact / name fields on a sub-org. Owner of the parent org only. */
export async function updateSubOrganisation(
  id: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult<{ subOrganisation: SubOrganisation }>> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  if (!uuidSchema.safeParse(id).success) return { ok: false, error: 'Invalid id.' }
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) patch[key] = value
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update.' }
  }

  const { data, error } = await (supabase as any)
    .from('organisations')
    .update(patch)
    .eq('id', id)
    .eq('parent_organisation_id', ctx.organisationId)
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .single()
  if (error) return { ok: false, error: error.message }

  bust()
  return { ok: true, subOrganisation: data as SubOrganisation }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add apps/web/src/actions/sub-organisations.actions.ts apps/web/src/actions/sub-organisations.actions.test.ts && git commit -m "feat(web): updateSubOrganisation action + test"
```

---

## Task 6: Add `getSubOrganisation` action (for detail page)

**Files:**
- Modify: `apps/web/src/actions/sub-organisations.actions.ts`
- Modify: `apps/web/src/actions/sub-organisations.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe('getSubOrganisation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the sub-org by id when it belongs to the caller\'s org', async () => {
    const orgId = 'org-wm'
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: orgId, role: 'admin' })
    const found = {
      id: 'sub-1', name: "Bob's Building", is_shadow: true, parent_organisation_id: orgId,
      address: null, phone: null, registration_number: null, vat_number: null,
      signatory_name: null, signatory_title: null, created_at: '2026-05-29T00:00:00Z',
    }
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: found, error: null })
    const eqParent = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { getSubOrganisation } = await import('./sub-organisations.actions')
    const result = await getSubOrganisation('sub-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.subOrganisation.id).toBe('sub-1')
  })

  it('returns ok:false when sub-org not found', async () => {
    getOrgContextMock.mockResolvedValueOnce({ userId: 'u', organisationId: 'org-wm', role: 'owner' })
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    const eqParent = vi.fn().mockReturnValueOnce({ maybeSingle })
    const eqId = vi.fn().mockReturnValueOnce({ eq: eqParent })
    const select = vi.fn().mockReturnValueOnce({ eq: eqId })
    const from = vi.fn().mockReturnValueOnce({ select })
    createClientMock.mockResolvedValueOnce({ from })
    const { getSubOrganisation } = await import('./sub-organisations.actions')
    const result = await getSubOrganisation('sub-x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not found/i)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: FAIL — `getSubOrganisation is not exported`.

- [ ] **Step 3: Implement**

Append:

```typescript
/** Fetch a single sub-org by id, scoped to caller's primary org. */
export async function getSubOrganisation(
  id: string,
): Promise<ActionResult<{ subOrganisation: SubOrganisation }>> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  if (!uuidSchema.safeParse(id).success) return { ok: false, error: 'Invalid id.' }

  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .from('organisations')
    .select(
      'id, name, parent_organisation_id, is_shadow, address, phone, registration_number, vat_number, signatory_name, signatory_title, created_at',
    )
    .eq('id', id)
    .eq('parent_organisation_id', ctx.organisationId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Sub-organisation not found.' }
  return { ok: true, subOrganisation: data as SubOrganisation }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run sub-organisations.actions
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add apps/web/src/actions/sub-organisations.actions.ts apps/web/src/actions/sub-organisations.actions.test.ts && git commit -m "feat(web): getSubOrganisation action + tests"
```

---

## Task 7: Central pool page (server component)

**Files:**
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/page.tsx`

- [ ] **Step 1: Write the page**

Create `apps/web/src/app/(admin)/settings/sub-organizations/page.tsx`:

```typescript
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { listSubOrganisations } from '@/actions/sub-organisations.actions'

import { SubOrgsList } from './SubOrgsList'
import { AddSubOrgForm } from './AddSubOrgForm'

export const metadata: Metadata = { title: 'Sub-organisations' }
export const dynamic = 'force-dynamic'

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11,
  color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function SubOrganisationsPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login?next=/settings/sub-organizations')
  if (!(ORG_WRITE_ROLES as readonly string[]).includes(ctx.role)) {
    redirect('/dashboard')
  }

  const result = await listSubOrganisations()
  const subOrgs = result.ok ? result.subOrganisations : []
  const loadError = result.ok ? null : result.error
  const activeCount = subOrgs.filter((s) => s.is_shadow).length

  return (
    <div className="animate-fadeup" style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ ...monoDim, textDecoration: 'none' }}>← Settings</Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Sub-organisations</h1>
          <p className="page-subtitle">
            External contracting parties (contractors, suppliers, sub-contractors)
            with their own people rosters.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Add sub-organisation</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <AddSubOrgForm />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              All sub-organisations ({activeCount} active · {subOrgs.length} total)
            </span>
          </div>
          {loadError && (
            <div style={{ padding: '12px 18px', color: 'var(--c-danger)', fontSize: 13 }}>
              {loadError}
            </div>
          )}
          <SubOrgsList initialSubOrgs={subOrgs} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: No test yet — the page is a server component scaffold**

It just renders two client components. Tests come with those components below.

- [ ] **Step 3: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add 'apps/web/src/app/(admin)/settings/sub-organizations/page.tsx' && git commit -m "feat(web): /settings/sub-organizations page scaffold"
```

Note: typecheck will fail until Tasks 8 + 9 add `SubOrgsList` and `AddSubOrgForm`. That's expected — finish the next two tasks before running typecheck.

---

## Task 8: `SubOrgsList` client component

**Files:**
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.tsx`:

```typescript
'use client'

import Link from 'next/link'
import type { SubOrganisation } from '@esite/shared'

interface Props {
  initialSubOrgs: SubOrganisation[]
}

export function SubOrgsList({ initialSubOrgs }: Props) {
  if (initialSubOrgs.length === 0) {
    return (
      <div
        className="data-panel-empty"
        style={{ padding: '32px 24px', textAlign: 'center' }}
      >
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
          No sub-organisations yet.
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
          Create your first one above to start attaching contracting parties to projects.
        </p>
      </div>
    )
  }

  return (
    <div>
      {initialSubOrgs.map((s) => (
        <Link
          key={s.id}
          href={`/settings/sub-organizations/${s.id}`}
          className="data-panel-row"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
              {s.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              {s.signatory_name ?? '—'}{s.phone ? ` · ${s.phone}` : ''}
            </div>
          </div>
          {s.is_shadow ? (
            <span className="badge badge-amber">shadow</span>
          ) : (
            <span className="badge badge-green">claimed</span>
          )}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write a minimal smoke test**

Create `apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SubOrgsList } from './SubOrgsList'

describe('SubOrgsList', () => {
  it('renders empty state when list is empty', () => {
    render(<SubOrgsList initialSubOrgs={[]} />)
    expect(screen.getByText(/No sub-organisations yet/i)).toBeInTheDocument()
  })

  it('renders rows for each sub-org', () => {
    render(
      <SubOrgsList
        initialSubOrgs={[
          {
            id: 's1', name: "Bob's Building", parent_organisation_id: 'p',
            is_shadow: true, address: null, phone: '+27 21 555 0100',
            registration_number: null, vat_number: null,
            signatory_name: 'Bob', signatory_title: 'Owner',
            created_at: '2026-05-29',
          },
        ]}
      />,
    )
    expect(screen.getByText("Bob's Building")).toBeInTheDocument()
    expect(screen.getByText(/Bob/)).toBeInTheDocument()
    expect(screen.getByText('shadow')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run, expect pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run SubOrgsList
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add 'apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.tsx' 'apps/web/src/app/(admin)/settings/sub-organizations/SubOrgsList.test.tsx' && git commit -m "feat(web): SubOrgsList component + smoke tests"
```

---

## Task 9: `AddSubOrgForm` client component

**Files:**
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { createSubOrganisation } from '@/actions/sub-organisations.actions'

export function AddSubOrgForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', address: '', phone: '',
    registration_number: '', vat_number: '',
    signatory_name: '', signatory_title: '',
  })

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
      disabled: isPending,
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
      ) as Record<string, string | null>
      const result = await createSubOrganisation({
        name: form.name.trim(),
        address: payload.address,
        phone: payload.phone,
        registration_number: payload.registration_number,
        vat_number: payload.vat_number,
        signatory_name: payload.signatory_name,
        signatory_title: payload.signatory_title,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(result.subOrganisation.name)
      setForm({
        name: '', address: '', phone: '',
        registration_number: '', vat_number: '',
        signatory_name: '', signatory_title: '',
      })
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px',
    fontSize: 13, fontFamily: 'var(--font-sans)',
    border: '1px solid var(--c-border)', borderRadius: 4,
    background: 'var(--c-input-bg)', color: 'var(--c-text)',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
    color: 'var(--c-text-dim)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 4,
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Name *</label>
          <input type="text" placeholder="e.g. Bob's Building" {...field('name')} style={inputStyle} required />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Address</label>
          <textarea placeholder="Postal address" {...field('address')} style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>Phone</label>
          <input type="text" placeholder="+27 21 555 0100" {...field('phone')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Registration #</label>
          <input type="text" placeholder="2024/123456/07" {...field('registration_number')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>VAT #</label>
          <input type="text" placeholder="4123456789" {...field('vat_number')} style={inputStyle} />
        </div>
        <div />
        <div>
          <label style={labelStyle}>Signatory name</label>
          <input type="text" placeholder="Bob Smith" {...field('signatory_name')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Signatory title</label>
          <input type="text" placeholder="Managing Director" {...field('signatory_title')} style={inputStyle} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)', background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-green)', background: 'var(--c-green-dim)', border: '1px solid var(--c-green)', borderRadius: 4 }}>
          Created {success}.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" isLoading={isPending} disabled={isPending || !form.name.trim()} size="sm">
          + Create sub-organisation
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Write a smoke test**

Create `apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/sub-organisations.actions', () => ({
  createSubOrganisation: vi.fn(),
}))

describe('AddSubOrgForm', () => {
  it('renders the name field and create button', async () => {
    const { AddSubOrgForm } = await import('./AddSubOrgForm')
    render(<AddSubOrgForm />)
    expect(screen.getByText(/Name \*/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create sub-organisation/i })).toBeInTheDocument()
  })

  it('disables the create button when name is empty', async () => {
    const { AddSubOrgForm } = await import('./AddSubOrgForm')
    render(<AddSubOrgForm />)
    const btn = screen.getByRole('button', { name: /Create sub-organisation/i })
    expect(btn).toBeDisabled()
  })
})
```

- [ ] **Step 3: Run, expect pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run AddSubOrgForm
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add 'apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.tsx' 'apps/web/src/app/(admin)/settings/sub-organizations/AddSubOrgForm.test.tsx' && git commit -m "feat(web): AddSubOrgForm component + smoke tests"
```

---

## Task 10: Detail page (server component)

**Files:**
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/[id]/page.tsx`

- [ ] **Step 1: Write the page**

Create `apps/web/src/app/(admin)/settings/sub-organizations/[id]/page.tsx`:

```typescript
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { getSubOrganisation } from '@/actions/sub-organisations.actions'

import { ContactDetailsPanel } from './ContactDetailsPanel'

export const metadata: Metadata = { title: 'Sub-organisation' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11,
  color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function SubOrgDetailPage({ params }: Props) {
  const { id } = await params
  const ctx = await getOrgContext()
  if (!ctx) redirect(`/login?next=/settings/sub-organizations/${id}`)
  if (!(ORG_WRITE_ROLES as readonly string[]).includes(ctx.role)) redirect('/dashboard')

  const result = await getSubOrganisation(id)
  if (!result.ok) notFound()
  const subOrg = result.subOrganisation

  return (
    <div className="animate-fadeup" style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings/sub-organizations" style={{ ...monoDim, textDecoration: 'none' }}>
          ← Sub-organisations
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{subOrg.name}</h1>
          <p className="page-subtitle">
            {subOrg.is_shadow ? 'Shadow (managed by you until claimed)' : 'Claimed organisation'}
          </p>
        </div>
        {subOrg.is_shadow
          ? <span className="badge badge-amber">shadow</span>
          : <span className="badge badge-green">claimed</span>
        }
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Contact details</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <ContactDetailsPanel subOrg={subOrg} />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Roster</span>
          </div>
          <div className="data-panel-empty" style={{ padding: '24px 18px' }}>
            Roster management ships in PR-B.
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Attached projects</span>
          </div>
          <div className="data-panel-empty" style={{ padding: '24px 18px' }}>
            Project attachment ships in PR-C.
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: No test yet — the page is a server scaffold**

ContactDetailsPanel is tested separately in Task 11.

- [ ] **Step 3: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add 'apps/web/src/app/(admin)/settings/sub-organizations/[id]/page.tsx' && git commit -m "feat(web): /settings/sub-organizations/[id] detail page scaffold"
```

---

## Task 11: `ContactDetailsPanel` client component + test

**Files:**
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.tsx`
- Create: `apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.test.tsx`

- [ ] **Step 1: Write the test (failing first)**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/sub-organisations.actions', () => ({
  updateSubOrganisation: vi.fn(),
}))

const fixture = {
  id: 's1', name: "Bob's Building", parent_organisation_id: 'p',
  is_shadow: true, address: 'Cape Town', phone: '+27 21 555 0100',
  registration_number: '2024/123456/07', vat_number: '4123456789',
  signatory_name: 'Bob Smith', signatory_title: 'Owner',
  created_at: '2026-05-29',
}

describe('ContactDetailsPanel', () => {
  it('renders all current values', async () => {
    const { ContactDetailsPanel } = await import('./ContactDetailsPanel')
    render(<ContactDetailsPanel subOrg={fixture} />)
    expect(screen.getByDisplayValue("Bob's Building")).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cape Town')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+27 21 555 0100')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2024/123456/07')).toBeInTheDocument()
    expect(screen.getByDisplayValue('4123456789')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bob Smith')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Owner')).toBeInTheDocument()
  })

  it('save button is disabled until a field changes', async () => {
    const { ContactDetailsPanel } = await import('./ContactDetailsPanel')
    render(<ContactDetailsPanel subOrg={fixture} />)
    expect(screen.getByRole('button', { name: /Save/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run, expect failure (missing component)**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run ContactDetailsPanel
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SubOrganisation } from '@esite/shared'

import { Button } from '@/components/ui/Button'
import { updateSubOrganisation } from '@/actions/sub-organisations.actions'

interface Props { subOrg: SubOrganisation }

const FIELDS = [
  ['name', 'Name *'],
  ['address', 'Address'],
  ['phone', 'Phone'],
  ['registration_number', 'Registration #'],
  ['vat_number', 'VAT #'],
  ['signatory_name', 'Signatory name'],
  ['signatory_title', 'Signatory title'],
] as const

export function ContactDetailsPanel({ subOrg }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const initial = {
    name: subOrg.name ?? '',
    address: subOrg.address ?? '',
    phone: subOrg.phone ?? '',
    registration_number: subOrg.registration_number ?? '',
    vat_number: subOrg.vat_number ?? '',
    signatory_name: subOrg.signatory_name ?? '',
    signatory_title: subOrg.signatory_title ?? '',
  }
  const [form, setForm] = useState(initial)

  const dirty = (Object.keys(initial) as Array<keyof typeof initial>)
    .some((k) => form[k] !== initial[k])

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
      disabled: isPending,
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const patch = (Object.keys(initial) as Array<keyof typeof initial>).reduce(
      (acc, key) => {
        if (form[key] !== initial[key]) {
          (acc as Record<string, string | null>)[key] = form[key].trim() === '' ? null : form[key].trim()
        }
        return acc
      },
      {} as Partial<Record<keyof typeof initial, string | null>>,
    )
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const result = await updateSubOrganisation(subOrg.id, patch as Record<string, never>)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13,
    border: '1px solid var(--c-border)', borderRadius: 4,
    background: 'var(--c-input-bg)', color: 'var(--c-text)',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
    color: 'var(--c-text-dim)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 4,
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {FIELDS.map(([key, label]) => (
          <div key={key} style={key === 'address' ? { gridColumn: 'span 2' } : undefined}>
            <label style={labelStyle}>{label}</label>
            {key === 'address' ? (
              <textarea {...field(key)} style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} />
            ) : (
              <input type="text" {...field(key)} style={inputStyle} required={key === 'name'} />
            )}
          </div>
        ))}
      </div>
      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)', background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-green)', background: 'var(--c-green-dim)', border: '1px solid var(--c-green)', borderRadius: 4 }}>
          Saved.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" isLoading={isPending} disabled={isPending || !dirty} size="sm">
          Save
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test -- --run ContactDetailsPanel
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add 'apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.tsx' 'apps/web/src/app/(admin)/settings/sub-organizations/[id]/ContactDetailsPanel.test.tsx' && git commit -m "feat(web): ContactDetailsPanel + tests"
```

---

## Task 12: Remove deprecated contractor-company UI from `/settings/users`

**Files:**
- Modify: `apps/web/src/app/(admin)/settings/users/page.tsx`
- Modify: `apps/web/src/app/(admin)/settings/users/AddUserForm.tsx`
- Delete: `apps/web/src/app/(admin)/settings/users/ContractorCompaniesPanel.tsx`
- Delete: `apps/web/src/app/(admin)/settings/users/UserCompanyDropdown.tsx`

- [ ] **Step 1: Update `apps/web/src/app/(admin)/settings/users/page.tsx`**

Replace the file's contents with:

```typescript
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN, formatDate } from '@esite/shared'
import { AddUserForm } from './AddUserForm'
import { UserRowActions } from './UserRowActions'

export const dynamic = 'force-dynamic'

const ROLE_BADGE: Record<string, string> = {
  owner:           'badge badge-amber',
  admin:           'badge badge-amber',
  project_manager: 'badge badge-blue',
  contractor:      'badge badge-muted',
  inspector:       'badge badge-muted',
  supplier:        'badge badge-muted',
  client_viewer:   'badge badge-muted',
}

interface MemberRow {
  id:         string
  user_id:    string
  role:       string
  is_active:  boolean
  created_at: string
  profile:    { full_name: string | null; email: string | null } | null
}

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function UsersPage() {
  const ctx = await getOrgContext()
  if (!ctx) {
    return (
      <div className="animate-fadeup">
        <div className="page-header"><h1 className="page-title">Users</h1></div>
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <p style={monoDim}>No organisation found. Complete onboarding first.</p>
            <Link href="/onboarding" className="btn-primary-amber" style={{ padding: '9px 16px', textDecoration: 'none' }}>
              Go to Onboarding
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!OWNER_ADMIN.includes(ctx.role)) redirect('/dashboard')

  const service = createServiceClient()

  const [{ data: membersRaw }, { data: org }, usersList] = await Promise.all([
    service
      .from('user_organisations')
      .select('id, user_id, role, is_active, created_at, profile:profiles!user_organisations_user_id_fkey(full_name, email)')
      .eq('organisation_id', ctx.organisationId)
      .order('created_at'),
    service
      .from('organisations')
      .select('name')
      .eq('id', ctx.organisationId)
      .maybeSingle(),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  const members = (membersRaw ?? []) as unknown as MemberRow[]
  const activeCount = members.filter((m) => m.is_active).length

  const lastSeen = new Map<string, string>()
  for (const u of usersList.data?.users ?? []) {
    if (u.last_sign_in_at) lastSeen.set(u.id, u.last_sign_in_at)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ ...monoDim, textDecoration: 'none' }}>← Settings</Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{org?.name ?? 'Your organisation'}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Add user</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <AddUserForm />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              Members ({activeCount} active · {members.length} total)
            </span>
          </div>
          {members.length === 0 ? (
            <div className="data-panel-empty" style={{ padding: '24px 18px' }}>No users yet.</div>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', borderTop: '1px solid var(--c-border)',
                  flexWrap: 'wrap', opacity: m.is_active ? 1 : 0.55,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)',
                  flexShrink: 0,
                }}>
                  {m.profile?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                    {m.profile?.full_name ?? '—'}
                    {m.user_id === ctx.userId && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginLeft: 8 }}>you</span>
                    )}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {m.profile?.email ?? '—'}
                  </p>
                </div>
                <span className={ROLE_BADGE[m.role] ?? 'badge badge-muted'}>{m.role.replace(/_/g, ' ')}</span>
                {!m.is_active && <span className="badge badge-muted">inactive</span>}
                <div style={{ textAlign: 'right', minWidth: 96 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {lastSeen.has(m.user_id)
                      ? `seen ${formatDate(lastSeen.get(m.user_id)!)}`
                      : 'never signed in'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', opacity: 0.6 }}>
                    joined {formatDate(m.created_at)}
                  </p>
                </div>
                <UserRowActions
                  userId={m.user_id}
                  role={m.role}
                  isActive={m.is_active}
                  isSelf={m.user_id === ctx.userId}
                  callerRole={ctx.role}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `apps/web/src/app/(admin)/settings/users/AddUserForm.tsx`**

Replace the file's contents with:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Select } from '@/components/ui/FormField'
import { ORG_ROLES, ORG_ROLE_LABELS } from '@esite/shared'
import { createUserAction } from '@/actions/users.actions'

const ASSIGNABLE_ROLES = ORG_ROLES.filter((r) => r !== 'owner')

const schema = z.object({
  email:    z.string().email('Valid email required'),
  fullName: z.string().min(2, 'Full name required'),
  role:     z.string().min(1, 'Role required'),
})
type FormValues = z.infer<typeof schema>

export function AddUserForm() {
  const router = useRouter()
  const [success, setSuccess] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'contractor' },
  })

  function onSubmit(values: FormValues) {
    setError(null)
    setSuccess(null)
    setWarning(null)
    startTransition(async () => {
      const result = await createUserAction({
        email: values.email,
        fullName: values.fullName,
        role: values.role,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(values.email)
      if (result.warning) setWarning(result.warning)
      reset({ email: '', fullName: '', role: 'contractor' })
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <FormField label="Full name" error={errors.fullName?.message} htmlFor="user-name">
            <TextInput id="user-name" {...register('fullName')} placeholder="Thandi Mokoena" invalid={Boolean(errors.fullName)} style={{ width: '100%' }} />
          </FormField>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <FormField label="Email" error={errors.email?.message} htmlFor="user-email">
            <TextInput id="user-email" {...register('email')} type="email" placeholder="colleague@company.co.za" invalid={Boolean(errors.email)} style={{ width: '100%' }} />
          </FormField>
        </div>
        <div style={{ width: 180 }}>
          <FormField label="Role" htmlFor="user-role">
            <Select id="user-role" {...register('role')} style={{ width: '100%' }}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <Button type="submit" isLoading={isPending} size="sm">Add user</Button>
      </form>

      {error && (
        <div role="alert" style={{ background: 'var(--c-red-dim)', color: 'var(--c-red)', border: '1px solid rgba(232,85,85,0.3)', borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {success && (
        <div role="status" style={{ background: 'var(--c-green-dim)', color: 'var(--c-green)', border: '1px solid rgba(61,184,130,0.3)', borderRadius: 6, padding: '14px 16px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>User created — {success}</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 4, marginBottom: 0 }}>
            {warning ?? 'They’ve been emailed a link to set their password and sign in.'}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Delete the deprecated files**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && rm 'apps/web/src/app/(admin)/settings/users/ContractorCompaniesPanel.tsx' 'apps/web/src/app/(admin)/settings/users/UserCompanyDropdown.tsx' 'apps/web/src/actions/contractor-companies.actions.ts'
```

- [ ] **Step 4: Run full typecheck to catch any dangling references**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web type-check
```

Expected: PASS — no output errors. If there are errors, search the codebase for `ContractorCompany`, `contractor_company_id`, or `contractor-companies.actions` and remove or update them.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/spud/Developer/ESITE.V1/esite/apps/web && pnpm test
```

Expected: all tests pass. The previously-shipped tests for SettingsTabs, ContractForm, etc. should be unaffected. New tests from this PR (sub-organisations.actions, SubOrgsList, AddSubOrgForm, ContactDetailsPanel) pass too.

- [ ] **Step 6: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add -A apps/web/src/app/\(admin\)/settings/users/ apps/web/src/actions/contractor-companies.actions.ts && git commit -m "refactor(web): remove deprecated contractor_companies UI + actions"
```

---

## Task 13: Remove `ContractorCompany` from shared types

**Files:**
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Delete the old interface**

Open `packages/shared/src/types/index.ts`. The old `ContractorCompany` interface should already be gone (Task 2 replaced it with `SubOrganisation`). Double-check by searching the file for `ContractorCompany`. If any reference remains, delete it.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter @esite/shared type-check && pnpm --filter web type-check
```

Expected: PASS for both.

- [ ] **Step 3: Commit only if there's a change**

If Task 2 already cleaned this up, skip the commit. Otherwise:

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git add packages/shared/src/types/index.ts && git commit -m "chore(shared): remove ContractorCompany — replaced by SubOrganisation"
```

---

## Task 14: Push + verify on prod

- [ ] **Step 1: Push to main**

```bash
cd /Users/spud/Developer/ESITE.V1/esite && git push origin main
```

- [ ] **Step 2: Wait for Vercel deploy + verify alias**

Wait ~3 minutes. Then check the prod alias still points to the latest commit (per the gotcha discovered in this session — see [esite-project-context](../../.claude/projects/-Users-spud-Documents-DEVELOPER/memory/esite-project-context.md)):

```bash
curl -s https://esite-lilac.vercel.app/ | grep -oE 'dpl=dpl_[a-zA-Z0-9_-]+' | head -1
```

Map the dpl_ to the latest commit via:

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('/Users/spud/Library/Application Support/com.vercel.cli/auth.json'))['token'])") && curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v13/deployments/<dpl_id>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['meta'].get('githubCommitSha'))"
```

The returned SHA must match `git rev-parse HEAD`. If not, promote the right deployment:

```bash
vercel promote https://esite-<correct-slug>-arno-mattheus-projects.vercel.app
```

- [ ] **Step 3: Manual smoke test on prod**

In a browser, signed in as Arno (or any owner/admin):

1. Navigate to `https://esite-lilac.vercel.app/settings/sub-organizations`. Should see the empty-state CTA "No sub-organisations yet."
2. Fill in the Add form with name "Bob's Building" + a few contact details. Submit. Should appear in the list with a "shadow" badge.
3. Click the row → detail page. Should see the contact-details panel with the values you entered. Roster + Attached projects panels show placeholder copy.
4. Change the address, click Save. Refresh — value persists.
5. Navigate to `/settings/users`. Verify the "Contractor companies" panel is GONE. Verify no per-user "Internal" dropdown next to contractor users. Verify the Add user form has no "Belongs to contractor company" dropdown.

- [ ] **Step 4: PR-A verification complete**

If all 5 smoke tests pass, PR-A is complete. Mark this in the session memory, then write the plan for PR-B.

---

## Self-Review

Spec coverage:
- §1 Purpose + locked decisions → reflected in the plan header
- §2 Data model → Task 1 (migration) + Task 2 (type)
- §3 Auth flow + org switcher → **NOT in PR-A** — that's PR-C
- §4 UI surfaces → Tasks 7-11 (central pool + detail). Roster/attached-projects placeholders only — full implementations in PR-B/C
- §5 PR phasing → this plan IS PR-A
- §6 Migration + edge cases → Task 1 drops old contractor_companies; other edge cases are PR-B+
- §7 Testing → unit tests on actions + smoke tests on UI
- §8 Open items → deferred items left as-is

Placeholder scan: no TBD / TODO. All code blocks contain complete content.

Type consistency: `SubOrganisation` interface used identically in actions and UI.

Verification on-prod is specific (5 explicit steps, listed criteria).

Plan complete and saved to `docs/superpowers/plans/2026-05-29-membership-pr-a-central-pool.md`.
