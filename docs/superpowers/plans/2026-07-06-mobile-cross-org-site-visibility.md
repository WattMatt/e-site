# Mobile Cross-Org Site Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a cross-org sub-org contractor see (and use offline) the sites they've been assigned to via `project_members` on the mobile app, matching the web behaviour migration 00155 restored.

**Architecture:** Mirror `public.user_has_project_access` clause (a) in the PowerSync stack. The Supabase JWT hook (`custom_jwt_claims`) computes a `project_ids` array claim (it can do the `project_members ⋈ user_organisations.is_active` join a sync rule can't); an additive PowerSync `project_access` bucket expands that claim via `json_each` and syncs the project + its field data; `useProjects` drops its single-org filter because the device DB now already holds exactly the allowed set. All three changes are additive — existing single-org users are unaffected.

**Tech Stack:** PowerSync classic Sync Rules (YAML), Supabase/Postgres plpgsql migration, React Native + `@tanstack/react-query`, Vitest (both `@esite/db` and `mobile` packages).

**Spec:** `docs/superpowers/specs/2026-07-06-mobile-cross-org-site-visibility-design.md`

**Dependency:** based on `feat/invite-and-site-clarity` (PR #119) — migration `00155_cross_org_project_visibility.sql` is present. Merges **after** #119.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql` | JWT hook adds the `project_ids` claim (clause-(a) mirror) | Create |
| `supabase/powersync/sync-rules.yaml` | Additive `project_access` bucket | Modify |
| `apps/mobile/src/hooks/projects.queries.ts` | RN-free, unit-testable local projects SQL constant | Create |
| `apps/mobile/src/hooks/useProjects.ts` | Drop the single-org filter; use the shared constant | Modify |
| `apps/mobile/app/(tabs)/projects.tsx` | Call `useProjects()` (no org arg) | Modify |
| `apps/mobile/app/(tabs)/snags.tsx` | Project picker calls `useProjects()` | Modify |
| `packages/db/src/__tests__/sync/sync-rules-structure.test.ts` | Pure structural test of the new bucket | Create |
| `packages/db/src/__tests__/sync/jwt-project-access-migration.test.ts` | Pure guard test of the 00156 SQL shape | Create |
| `packages/db/src/__tests__/sync/sync-rules.test.ts` | Cross-org RLS-parity + JWT-claim integration test | Modify |
| `apps/mobile/src/__tests__/useProjects.test.ts` | Unit test: local query has no org filter | Create |

Test commands used throughout:
- `@esite/db`: `pnpm --filter @esite/db vitest run <path>`
- `mobile`: `pnpm --filter mobile vitest run <path>`

---

## Task 1: Additive `project_access` sync bucket (structural TDD)

**Files:**
- Create: `packages/db/src/__tests__/sync/sync-rules-structure.test.ts`
- Modify: `supabase/powersync/sync-rules.yaml`

- [ ] **Step 1: Write the failing structural test**

Create `packages/db/src/__tests__/sync/sync-rules-structure.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest runs with cwd = packages/db; repo root is two levels up.
const RULES_PATH = resolve(process.cwd(), '..', '..', 'supabase', 'powersync', 'sync-rules.yaml')
const yaml = readFileSync(RULES_PATH, 'utf8')

/** Return the text of a top-level (2-space indented) bucket block, or '' if absent. */
function bucketBlock(name: string): string {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => l.replace(/\s+$/, '') === `  ${name}:`)
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

describe('sync-rules.yaml: project_access bucket', () => {
  const block = bucketBlock('project_access')

  it('defines a project_access bucket', () => {
    expect(block).not.toBe('')
  })

  it('parameterises project_id by expanding the JWT project_ids array', () => {
    expect(block).toContain("json_each(request.jwt() -> 'project_ids')")
    expect(block).toMatch(/SELECT\s+value\s+AS\s+project_id\s+FROM\s+json_each/i)
  })

  it('scopes every data query by bucket.project_id and never by org', () => {
    expect(block).toContain('bucket.project_id')
    expect(block).not.toContain('bucket.org_id')
    // one bucket.project_id reference per data query (>= number of "- SELECT" lines)
    const selects = (block.match(/^\s*- SELECT/gm) ?? []).length
    const refs = (block.match(/bucket\.project_id/g) ?? []).length
    expect(selects).toBeGreaterThanOrEqual(8)
    expect(refs).toBeGreaterThanOrEqual(selects)
  })

  it('syncs the project row with the same columns as org_projects', () => {
    expect(block).toContain('id, name, status, city, province, organisation_id')
    expect(block).toContain('FROM projects WHERE id = bucket.project_id')
  })

  it('leaves the existing org_projects bucket untouched', () => {
    expect(bucketBlock('org_projects')).toContain('WHERE organisation_id = bucket.org_id')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/db vitest run src/__tests__/sync/sync-rules-structure.test.ts`
Expected: FAIL — "defines a project_access bucket" (block is `''`).

- [ ] **Step 3: Add the bucket to `supabase/powersync/sync-rules.yaml`**

Append this bucket definition at the end of the file (after `org_inspection_photos_meta`, keeping the file's 2-space bucket indentation):

```yaml
  # project_access — cross-org shared sites. The user's `project_ids` JWT claim
  # (00156 hook) lists every project they reach via an ACTIVE explicit
  # project_members assignment whose identity org they're still active in —
  # the exact public.user_has_project_access clause (a) set. This bucket is
  # purely additive; own-org data continues to sync via the org_* buckets, and
  # rows dedupe by primary key across buckets.
  project_access:
    parameters: SELECT value AS project_id FROM json_each(request.jwt() -> 'project_ids')
    data:
      - SELECT id, name, status, city, province, organisation_id
        FROM projects
        WHERE id = bucket.project_id

      - SELECT id, title, description, status, priority,
               project_id, organisation_id, assigned_to,
               raised_by, created_at
        FROM snags
        WHERE project_id = bucket.project_id

      - SELECT sp.id, sp.snag_id, sp.file_path, sp.caption, sp.photo_type, sp.uploaded_by, sp.created_at
        FROM field.snag_photos sp
        JOIN snags s ON s.id = sp.snag_id
        WHERE s.project_id = bucket.project_id

      - SELECT id, project_id, organisation_id, name, level, file_path,
               file_size_bytes, width_px, height_px, scale, is_active,
               source_provider, source_file_id, source_revision_id,
               source_path, synced_at, uploaded_by, created_at, updated_at
        FROM tenants.floor_plans
        WHERE project_id = bucket.project_id

      - SELECT id, project_id, organisation_id, name, category,
               storage_path, mime_type, size_bytes,
               source_provider, source_file_id, source_revision_id,
               source_path, synced_at, uploaded_by, created_at, updated_at
        FROM tenants.documents
        WHERE project_id = bucket.project_id

      - SELECT *
        FROM inspections.inspections
        WHERE project_id = bucket.project_id
          AND status NOT IN ('certified','abandoned')

      - SELECT r.*
        FROM inspections.responses r
        JOIN inspections.inspections i ON i.id = r.inspection_id
        WHERE i.project_id = bucket.project_id
          AND i.status NOT IN ('certified','abandoned')

      - SELECT p.id, p.inspection_id, p.section_id, p.field_id,
               p.storage_path, p.caption, p.taken_at, p.gps_lat, p.gps_lng,
               p.uploaded_by, p.created_at
        FROM inspections.photos p
        JOIN inspections.inspections i ON i.id = p.inspection_id
        WHERE i.project_id = bucket.project_id
          AND i.status NOT IN ('certified','abandoned')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/db vitest run src/__tests__/sync/sync-rules-structure.test.ts`
Expected: PASS (all 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add supabase/powersync/sync-rules.yaml packages/db/src/__tests__/sync/sync-rules-structure.test.ts
git commit -m "feat(mobile-sync): additive project_access bucket for cross-org sites"
```

---

## Task 2: JWT hook migration 00156 (guard-test TDD)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql`
- Create: `packages/db/src/__tests__/sync/jwt-project-access-migration.test.ts`

- [ ] **Step 1: Write the failing guard test**

Create `packages/db/src/__tests__/sync/jwt-project-access-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION = resolve(
  process.cwd(), '..', '..',
  'apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql',
)
const sql = readFileSync(MIGRATION, 'utf8')

describe('00156: custom_jwt_claims adds a project_ids claim mirroring user_has_project_access clause (a)', () => {
  it('replaces the hook and preserves the org_id claim', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.custom_jwt_claims')
    expect(sql).toMatch(/jsonb_set\(_claims, '\{org_id\}'/)
  })

  it('computes project_ids from project_members joined to ACTIVE user_organisations', () => {
    expect(sql).toContain('projects.project_members')
    expect(sql).toMatch(/JOIN\s+public\.user_organisations\s+uo/i)
    expect(sql).toMatch(/uo\.user_id\s*=\s*pm\.user_id/i)
    expect(sql).toMatch(/uo\.organisation_id\s*=\s*pm\.organisation_id/i)
    expect(sql).toMatch(/uo\.is_active\s*=\s*TRUE/i)
    expect(sql).toMatch(/jsonb_agg\(DISTINCT pm\.project_id\)/i)
    expect(sql).toMatch(/jsonb_set\(_claims, '\{project_ids\}'/)
  })

  it('keeps the auth-admin grant and PUBLIC revoke intact', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin')
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.custom_jwt_claims\(JSONB\) FROM PUBLIC/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/db vitest run src/__tests__/sync/jwt-project-access-migration.test.ts`
Expected: FAIL — `readFileSync` throws `ENOENT` (migration file does not exist yet).

- [ ] **Step 3: Create the migration**

Create `apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql`:

```sql
-- apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql
-- Description: Extend the PowerSync JWT hook with a `project_ids` claim so the
-- mobile app can sync projects a user reaches via an explicit cross-org
-- project_members assignment (mirrors public.user_has_project_access clause (a)).
--
-- Why in the hook, not the sync rules: PowerSync classic Sync Rules parameter
-- queries are single-table (no JOINs). Revocation for cross-org contractors runs
-- through project_members JOIN user_organisations ON is_active — removeSubOrgMember
-- flips user_organisations.is_active=false and leaves project_members.is_active
-- untouched. The JWT hook runs real Postgres and can do that join; the sync rule
-- then expands the resulting array via json_each(request.jwt() -> 'project_ids').
--
-- Additive + backward compatible: org_id is unchanged; tokens issued before this
-- migration simply lack project_ids, and json_each(null) yields no rows.
-- Deploy: run migration; the hook is already enabled (Dashboard > Auth > Hooks).

CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id      UUID;
  _org_id       UUID;
  _project_ids  JSONB;
  _claims       JSONB;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  -- Unchanged: the user's first active organisation (drives the org_* buckets).
  SELECT organisation_id INTO _org_id
  FROM public.user_organisations
  WHERE user_id = _user_id
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  -- NEW: projects reachable via an ACTIVE explicit membership whose identity org
  -- the user is still ACTIVE in. Exact mirror of public.user_has_project_access
  -- clause (a), including the user_organisations.is_active join the sync rule
  -- cannot express. Deliberately does NOT filter pm.is_active (00106 clause (a)
  -- doesn't), keeping mobile == web.
  SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb)
  INTO   _project_ids
  FROM   projects.project_members pm
  JOIN   public.user_organisations uo
    ON   uo.user_id = pm.user_id
   AND   uo.organisation_id = pm.organisation_id
  WHERE  pm.user_id = _user_id
    AND  uo.is_active = TRUE;

  _claims := event -> 'claims';

  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::TEXT));
  END IF;

  -- Always set (defaults to '[]') so the sync rule's json_each degrades cleanly.
  _claims := jsonb_set(_claims, '{project_ids}', _project_ids);

  RETURN jsonb_set(event, '{claims}', _claims);
END;
$$;

-- Allow Supabase Auth to call this function (unchanged from 00014).
GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) FROM PUBLIC;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/db vitest run src/__tests__/sync/jwt-project-access-migration.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql \
        packages/db/src/__tests__/sync/jwt-project-access-migration.test.ts
git commit -m "feat(auth): JWT hook emits project_ids claim for cross-org site sync"
```

---

## Task 3: Cross-org RLS-parity + JWT-claim integration test

**Files:**
- Modify: `packages/db/src/__tests__/sync/sync-rules.test.ts`

This is an integration test (env-gated like the rest of the file — it `return`s early when Supabase env vars are absent). It runs against the `feat/invite-and-site-clarity` DB, so migration 00155 (and, once deployed, 00156 + the enabled hook) are present. It reuses the existing `clientB` (an Org B user) as the cross-org contractor.

- [ ] **Step 1: Add the failing test block**

Append to `packages/db/src/__tests__/sync/sync-rules.test.ts` (after the last `describe`, before EOF):

```ts
describe('T-052b: cross-org project_members visibility (00155 grant + 00156 claim)', () => {
  it('a shared site is visible only while an active membership exists, and the JWT lists it', async () => {
    if (skipIfNoEnv()) return

    const { data: { user: userB } } = await clientB.auth.getUser()
    if (!userB) return

    // Seed an Org A project — owning org = A, but the contractor is in Org B.
    const { data: proj } = await (serviceClient as any)
      .schema('projects')
      .from('projects')
      .insert({ name: '[sync-test] cross-org shared site', organisation_id: ORG_A_ID, status: 'active' })
      .select('id')
      .single()
    if (!proj?.id) return
    createdProjectIds.push(proj.id)

    const contractorSeesProject = async (): Promise<boolean> => {
      const { data } = await (clientB as any).schema('projects').from('projects').select('id')
      return (data ?? []).some((p: any) => p.id === proj.id)
    }

    // Baseline: no membership yet → cross-org contractor must NOT see it.
    expect(await contractorSeesProject()).toBe(false)

    // Assign via the sub-org path shape: project_members.organisation_id = the
    // contractor's OWN org (B), not the owning org (A).
    const { data: pm } = await (serviceClient as any)
      .schema('projects')
      .from('project_members')
      .insert({ project_id: proj.id, user_id: userB.id, organisation_id: ORG_B_ID, role: 'contractor', is_active: true })
      .select('id')
      .single()

    // 00155: now visible via user_has_project_access — the exact set the JWT
    // hook must emit for this contractor.
    expect(await contractorSeesProject()).toBe(true)

    // 00156: a freshly-issued token must carry the project in project_ids.
    // Skips gracefully if the Auth hook isn't enabled in this environment.
    const { data: refreshed } = await clientB.auth.refreshSession()
    const token = refreshed.session?.access_token
    if (token) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      if (Array.isArray(payload.project_ids)) {
        expect(payload.project_ids).toContain(proj.id)
      } else {
        console.warn('[sync-rules] project_ids claim absent — is the 00156 Auth hook enabled?')
      }
    }

    // Revoke by removing the membership → no longer visible.
    if (pm?.id) {
      await (serviceClient as any).schema('projects').from('project_members').delete().eq('id', pm.id)
    }
    expect(await contractorSeesProject()).toBe(false)

    // Restore clientB's token to a clean state for any later tests.
    await clientB.auth.refreshSession()
  }, 30_000)
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @esite/db vitest run src/__tests__/sync/sync-rules.test.ts -t "cross-org project_members"`
Expected (with live Supabase env + 00155 deployed): PASS. Without env vars: the test returns early (reported as passed/skipped) — this is the existing suite convention.

> If the "now visible" assertion fails, 00155 is not applied to the target DB — that is the documented merge-order dependency (#119 must land first), not a bug in this task.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/__tests__/sync/sync-rules.test.ts
git commit -m "test(sync): cross-org contractor sees assigned site + JWT project_ids claim"
```

---

## Task 4: Drop the single-org filter in `useProjects` + call sites

**Files:**
- Create: `apps/mobile/src/hooks/projects.queries.ts`
- Create: `apps/mobile/src/__tests__/useProjects.test.ts`
- Modify: `apps/mobile/src/hooks/useProjects.ts`
- Modify: `apps/mobile/app/(tabs)/projects.tsx`
- Modify: `apps/mobile/app/(tabs)/snags.tsx`

- [ ] **Step 1: Write the failing unit test**

Create `apps/mobile/src/__tests__/useProjects.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PROJECTS_LOCAL_QUERY } from '../hooks/projects.queries'

describe('useProjects local query', () => {
  it('selects all local projects with no organisation filter', () => {
    expect(PROJECTS_LOCAL_QUERY).toBe('SELECT * FROM projects ORDER BY name ASC')
  })

  it('never re-hides cross-org shared sites with an org predicate', () => {
    const q = PROJECTS_LOCAL_QUERY.toLowerCase()
    expect(q).not.toContain('organisation_id')
    expect(q).not.toContain('where')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter mobile vitest run src/__tests__/useProjects.test.ts`
Expected: FAIL — cannot resolve `../hooks/projects.queries` (module does not exist).

- [ ] **Step 3: Create the RN-free query module**

Create `apps/mobile/src/hooks/projects.queries.ts`:

```ts
// apps/mobile/src/hooks/projects.queries.ts
//
// Pure, React-Native-free so it is unit-testable under Vitest (Node).
//
// The device SQLite DB already holds exactly the projects the user may see:
// own-org projects via the `org_projects` PowerSync bucket + cross-org shared
// sites via the `project_access` bucket. An organisation filter here would
// re-hide the shared sites, which is the bug this change fixes.
export const PROJECTS_LOCAL_QUERY = 'SELECT * FROM projects ORDER BY name ASC'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter mobile vitest run src/__tests__/useProjects.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Rewrite `useProjects.ts` to use it and drop the org filter**

Replace the entire contents of `apps/mobile/src/hooks/useProjects.ts` with:

```ts
// apps/mobile/src/hooks/useProjects.ts
import { useQuery } from '@tanstack/react-query'
import { useDb } from './useDb'
import type { LocalDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'
import { PROJECTS_LOCAL_QUERY } from './projects.queries'

type Project = {
  id: string
  name: string
  status: string
  city: string | null
  province: string | null
  organisation_id: string
  client_name: string | null
  contract_value: number | null
  start_date: string | null
  end_date: string | null
}

// Returns every project the current user may see. No org filter: the local
// PowerSync DB (and, on the remote fallback, RLS) already scope the result to
// own-org projects + cross-org sites shared via project_members (00155/00156).
export function useProjects() {
  const { type, db } = useDb('projects')
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['projects', type],
    queryFn: async (): Promise<Project[]> => {
      if (type === 'local') {
        return (db as LocalDb).getAll<Project>(PROJECTS_LOCAL_QUERY)
      }
      const { data, error } = await (db as typeof supabase)
        .schema('projects')
        .from('projects')
        .select('*')
      if (error) throw error
      return data as unknown as Project[]
    },
  })
}
```

- [ ] **Step 6: Update `apps/mobile/app/(tabs)/projects.tsx`**

Remove the now-unused auth/org lines and call `useProjects()` with no argument.

Delete line 4:
```ts
import { useAuth } from '../../src/providers/AuthProvider'
```
Replace lines 19–21:
```ts
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''
  const { data: projects, isLoading, refetch, isRefetching } = useProjects(orgId)
```
with:
```ts
  const { data: projects, isLoading, refetch, isRefetching } = useProjects()
```

- [ ] **Step 7: Update `apps/mobile/app/(tabs)/snags.tsx`**

Here `orgId` is still needed for the org-scoped snag list (lines 18–20) — leave it. Only change the project-picker call. Replace line 23:
```ts
  const { data: projects } = useProjects(orgId)
```
with:
```ts
  const { data: projects } = useProjects()
```

- [ ] **Step 8: Type-check the mobile app**

Run: `pnpm --filter mobile exec tsc --noEmit`
Expected: PASS — no "declared but never used" errors for `useAuth`/`profile`/`orgId` in `projects.tsx`, and no "Expected 0 arguments, but got 1" errors at the `useProjects` call sites.

- [ ] **Step 9: Run the mobile unit tests**

Run: `pnpm --filter mobile vitest run`
Expected: PASS (existing `useDb` tests + new `useProjects` test).

- [ ] **Step 10: Commit**

```bash
git add "apps/mobile/src/hooks/projects.queries.ts" \
        "apps/mobile/src/hooks/useProjects.ts" \
        "apps/mobile/src/__tests__/useProjects.test.ts" \
        "apps/mobile/app/(tabs)/projects.tsx" \
        "apps/mobile/app/(tabs)/snags.tsx"
git commit -m "fix(mobile): show cross-org shared sites in projects list + snag picker"
```

---

## Task 5: Full verification, deploy checklist, manual on-device test

**Files:** none (verification only)

- [ ] **Step 1: Run both test suites green**

Run:
```bash
pnpm --filter @esite/db vitest run src/__tests__/sync
pnpm --filter mobile vitest run
```
Expected: all PASS (integration tests skip cleanly if no live-Supabase env).

- [ ] **Step 2: Type-check both packages**

Run:
```bash
pnpm --filter mobile exec tsc --noEmit
pnpm --filter @esite/db type-check
```
Expected: PASS.

- [ ] **Step 3: Record the deploy runbook (nothing is auto-deployed)**

The change ships in three independent pieces; deploy in this order **after PR #119 (00155) is live**:

1. **Migration 00156** — apply via the normal migration workflow. Safe to run any time (the extra claim is inert until a sync rule reads it). The `custom_jwt_claims` Auth hook is already enabled (Dashboard → Auth → Hooks) — no re-enable needed.
2. **`sync-rules.yaml`** — paste the full file into PowerSync Dashboard → Sync Rules → Deploy. Additive `project_access` bucket; existing buckets unchanged.
3. **Mobile JS** — ships in the app bundle / OTA update.

Backward-compatible throughout: tokens minted before 00156 lack `project_ids`; `json_each(null)` yields no rows, so those sessions get no extra buckets until their next token refresh.

- [ ] **Step 4: Manual on-device verification (gated by the user, project protocol §7)**

Test plan (state upfront; failure returns to spec §1):
1. As a WM admin, assign a sub-org contractor (Org B) to a WM project (KINGSWALK) via the sub-org path.
2. Contractor signs into mobile → **KINGSWALK appears** in the projects list and in the Snags tab project-picker.
3. Open KINGSWALK → its snags and floor plans are viewable offline; create a snag on it → it saves and syncs.
4. WM admin removes the contractor from the sub-org (soft-deactivate). After the contractor's token refreshes (≤ access-token TTL, ~1h; or force by re-launching / re-auth), **KINGSWALK drops off** the device.
5. A different Org B user who was **not** assigned never sees KINGSWALK.

- [ ] **Step 5: Update memory**

Add a memory pointer noting: mobile cross-org site visibility shipped via 00156 `project_ids` JWT claim + `project_access` PowerSync bucket + `useProjects` de-org-filtering; documented follow-ups = org-level `inspections.templates` for cross-org inspections, and multi-org **own** membership (JWT `org_id` = first org only). Link `[[esite-invite-and-site-clarity]]`.

---

## Known follow-ups (documented, out of scope)

- **Inspection templates on cross-org sites** — `inspections.templates` is org-level (no `project_id`); a cross-org contractor can't reach the owning org's templates by project scope, so rendering an inspection form on a shared site needs connectivity until a future template-by-project-access rule.
- **Multi-org own membership** — a user active in two orgs still only syncs their *first* org via `org_projects` (JWT `org_id` = first active org). Predates this bug; unrelated to the cross-org `project_members` path.
- **Cross-org snags list** — the Snags tab's org-scoped list (`snagService.listByOrg`) still shows only own-org snags; the *picker* now includes shared sites, so new snags can be created there.
