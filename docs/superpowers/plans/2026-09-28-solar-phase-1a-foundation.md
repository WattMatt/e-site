# Solar Phase 1A — Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the database foundation for the E-Site Solar add-on: the org-wide Solar subscription record, per-user project access (View / Edit / Edit + financials) with access requests, the `solar` schema with its first study table, the access helper functions, and the application helpers that read them — all proven by impersonation assertions.

**Architecture:** One migration creates a new exposed schema `solar` (no anon grants), `billing.org_addon_subscriptions`, `solar.project_access`, `solar.access_requests`, `solar.studies`, `solar.audit_events`, and SECURITY DEFINER helpers in `public` (`org_has_solar`, `solar_is_grantor`, `solar_access_level`, `solar_can_view/edit/see_money`). RLS follows the `00200`/`00206` per-verb shape. A pure TS module in `@esite/shared` defines the access levels; a web lib wraps the RPCs for pages and actions. Spec: `docs/solar/03-data-model-and-security.md §2–3`, decisions D-01, D-02, D-04 in `docs/solar/06-open-decisions.md`.

**Tech Stack:** Postgres (Supabase), SQL migrations with `@verify` blocks, `scripts/db/dry-run-migration.sh` impersonation assertions, TypeScript, Vitest, pnpm/Turborepo.

**Out of scope for 1A (later plans):** Paystack subscribe route + webhook (1B); sidebar, locked screen, access panel, gated layout, Overview, Site & Supply, org settings UI (1C).

---

## Ground rules (read once)

- Repo root: the worktree created in Task 1. All paths below are relative to it.
- **Migration number:** the file is named `00207_solar_foundation.sql`. Numbers are claimed **at apply time**, not now: before the owner applies it, re-check the ledger `max(version)`, `origin/main`, and migration filenames in open PRs (#191 `00201` and #193 `00202` are stranded below the head). If `00207` is taken, rename the file and every reference to it in this plan's files.
- **Do not apply this migration to production.** Task 5 runs it inside a rolled-back transaction only. Applying (plus the PostgREST `db_schema` PATCH for the new `solar` schema) is an owner-approved step after merge.
- Run all three suites before claiming done: `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`.
- `requireEffectiveRole` returns an object — always check `.ok`.
- Never `REVOKE … FROM PUBLIC` alone on a new function: also `REVOKE … FROM anon` (Supabase grants anon directly).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/solar/access.ts` | Access level type, ordering, `solarLevelAllows()` |
| `packages/shared/src/solar/access.test.ts` | Unit tests for the above |
| `packages/shared/src/solar/index.ts` | Barrel |
| `packages/shared/src/index.ts` | Re-export `./solar` |
| `apps/edge-functions/supabase/migrations/00207_solar_foundation.sql` | The migration |
| `apps/edge-functions/supabase/config.toml` | Expose `solar` schema locally |
| `scripts/db/assert-solar-foundation-roles.sql` | Behavioural impersonation assertions |
| `apps/web/src/lib/solar/access.ts` | `getSolarAccessLevel`, `requireSolarLevel`, `orgHasSolar` |
| `apps/web/src/lib/solar/access.test.ts` | Unit tests with stub clients |

---

### Task 1: Worktree and branch

**Files:** none

- [ ] **Step 1: Create the worktree from the spec branch**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite"
git fetch origin -q
git worktree add -b feat/solar-phase-1a ~/.config/superpowers/worktrees/esite/solar-phase-1a origin/docs/solar-module-spec
cd ~/.config/superpowers/worktrees/esite/solar-phase-1a
pnpm install --frozen-lockfile
```
Expected: worktree created, install completes.

- [ ] **Step 2: Baseline the three suites**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -3
```
Expected: all pass. Record the counts in the PR body later. If any fails on the untouched branch, stop and report — do not start on a red baseline.

---

### Task 2: Shared access-level module

**Files:**
- Create: `packages/shared/src/solar/access.ts`
- Create: `packages/shared/src/solar/access.test.ts`
- Create: `packages/shared/src/solar/index.ts`
- Modify: `packages/shared/src/index.ts` (append one export line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/access.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SOLAR_ACCESS_LEVELS, isSolarAccessLevel, solarLevelAllows } from './access'

describe('solar access levels', () => {
  it('orders view < edit < edit_financials', () => {
    expect(SOLAR_ACCESS_LEVELS).toEqual(['view', 'edit', 'edit_financials'])
  })

  it('recognises only the three level strings', () => {
    expect(isSolarAccessLevel('view')).toBe(true)
    expect(isSolarAccessLevel('edit')).toBe(true)
    expect(isSolarAccessLevel('edit_financials')).toBe(true)
    expect(isSolarAccessLevel('admin')).toBe(false)
    expect(isSolarAccessLevel(null)).toBe(false)
    expect(isSolarAccessLevel(undefined)).toBe(false)
  })

  it('a higher level satisfies a lower requirement, never the reverse', () => {
    expect(solarLevelAllows('edit_financials', 'view')).toBe(true)
    expect(solarLevelAllows('edit_financials', 'edit')).toBe(true)
    expect(solarLevelAllows('edit', 'view')).toBe(true)
    expect(solarLevelAllows('view', 'view')).toBe(true)
    expect(solarLevelAllows('view', 'edit')).toBe(false)
    expect(solarLevelAllows('edit', 'edit_financials')).toBe(false)
  })

  it('no level (null) satisfies nothing', () => {
    expect(solarLevelAllows(null, 'view')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/access.test.ts`
Expected: FAIL — cannot resolve `./access`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/access.ts`:
```ts
/**
 * Solar per-user project access levels (decision D-04, 2026-09-28).
 *
 * Mirrors the database helper public.solar_access_level(project_id), which
 * returns one of these strings or NULL. Order matters: each level includes
 * everything the levels before it allow.
 *   view            read technical tabs, no rand values
 *   edit            view + change inputs, import data, run cases
 *   edit_financials edit + tariff, financials, proposals, every rand value
 * Org owners/admins of the project's organisation always resolve to
 * edit_financials; that rule lives in SQL, not here.
 */
export const SOLAR_ACCESS_LEVELS = ['view', 'edit', 'edit_financials'] as const

export type SolarAccessLevel = (typeof SOLAR_ACCESS_LEVELS)[number]

export function isSolarAccessLevel(v: unknown): v is SolarAccessLevel {
  return typeof v === 'string' && (SOLAR_ACCESS_LEVELS as readonly string[]).includes(v)
}

/** True when `have` is at least `need`. A null `have` (no access) allows nothing. */
export function solarLevelAllows(have: SolarAccessLevel | null, need: SolarAccessLevel): boolean {
  if (have === null) return false
  return SOLAR_ACCESS_LEVELS.indexOf(have) >= SOLAR_ACCESS_LEVELS.indexOf(need)
}
```

`packages/shared/src/solar/index.ts`:
```ts
export * from './access'
```

Append to `packages/shared/src/index.ts`:
```ts
export * from './solar'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/access.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar packages/shared/src/index.ts
git commit -m "feat(solar): shared access-level module (view/edit/edit_financials)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Behavioural assertions first (they must fail before the migration exists)

**Files:**
- Create: `scripts/db/assert-solar-foundation-roles.sql`

The fixture builds its own organisation, project and users inside the transaction (the WM-Consulting org bypasses every paywall, so it cannot be used for negative cases). Everything rolls back.

- [ ] **Step 1: Write the assertion file**

`scripts/db/assert-solar-foundation-roles.sql`:
```sql
-- BEHAVIOURAL assertions for 00207_solar_foundation, run as real roles.
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-foundation-roles.sql   (expect RED)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_solar_foundation.sql scripts/db/assert-solar-foundation-roles.sql  (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. The WM-Consulting
-- org is deliberately NOT used: it bypasses the paywall, so it has no negative case.
-- Mechanics (paid for before): request.jwt.claims is transaction-local and
-- outlives RESET ROLE, so all seeding happens as postgres before impersonating.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_project  UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- org admin (grantor)
  v_pm       UUID := gen_random_uuid();   -- project_manager, will get VIEW
  v_con      UUID := gen_random_uuid();   -- contractor, will get EDIT
  v_nogrant  UUID := gen_random_uuid();   -- contractor, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer
  v_foreign  UUID := gen_random_uuid();   -- admin of ANOTHER org
  v_level    TEXT;
  v_n        INT;
  v_req      UUID;
  u          UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-probe-org'), (v_org2, 'solar-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_pm, v_con, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_pm, v_org, 'project_manager', TRUE),
    (v_con, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name) VALUES (v_project, v_org, 'solar-probe-project');
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_pm, v_org, 'project_manager', TRUE), (v_project, v_con, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE);

  -- ── 1. Not subscribed: nobody has Solar, not even the org admin ───────────
  INSERT INTO _r VALUES ('unsubscribed_org_has_no_solar', NOT public.org_has_solar(v_org));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('unsubscribed_admin_level_null', public.solar_access_level(v_project) IS NULL);
  RESET ROLE;

  -- ── Subscribe the org (service path, like the webhook) ────────────────────
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO _r VALUES ('subscribed_org_has_solar', public.org_has_solar(v_org));

  -- ── 2. Org admin: implicit edit_financials, and is a grantor ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('admin_is_edit_financials', public.solar_access_level(v_project) = 'edit_financials');
  INSERT INTO _r VALUES ('admin_is_grantor', public.solar_is_grantor(v_project));
  -- grant VIEW to the PM and EDIT to the contractor (granted_by forced to the caller)
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_pm, 'view');
  INSERT INTO solar.project_access (project_id, user_id, level, granted_by) VALUES (v_project, v_con, 'edit', v_pm);
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND granted_by = v_admin;
  INSERT INTO _r VALUES ('granted_by_bound_to_caller', v_n = 2);
  -- a client viewer can never be granted
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_client, 'view');
    INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', true);
  END;
  -- the admin creates the study
  INSERT INTO solar.studies (project_id, nmd_kva) VALUES (v_project, 500);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('admin_creates_study', v_n = 1);
  RESET ROLE;

  -- ── 3. VIEW user: reads, cannot write, is not a grantor ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('pm_level_is_view', public.solar_access_level(v_project) = 'view');
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('view_user_reads_study', v_n = 1);
  UPDATE solar.studies SET nmd_kva = 1 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_update_affects_nothing', v_n = 0);
  INSERT INTO _r VALUES ('view_user_not_grantor', NOT public.solar_is_grantor(v_project));
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_nogrant, 'edit');
    INSERT INTO _r VALUES ('view_user_grant_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('view_user_grant_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 4. EDIT user: writes inputs, sees no money ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('con_level_is_edit', public.solar_access_level(v_project) = 'edit');
  UPDATE solar.studies SET nmd_kva = 630 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_user_updates_study', v_n = 1);
  INSERT INTO _r VALUES ('edit_user_cannot_see_money', NOT public.solar_can_see_money(v_project));
  RESET ROLE;

  -- ── 5. Member without a grant: nothing; can request access ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_level_null', public.solar_access_level(v_project) IS NULL);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('nogrant_sees_no_study', v_n = 0);
  INSERT INTO solar.access_requests (project_id, kind, requested_level, note)
  VALUES (v_project, 'access', 'edit', 'please') RETURNING id INTO v_req;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req AND requester_id = v_nogrant AND status = 'pending';
  INSERT INTO _r VALUES ('request_bound_to_requester_pending', v_n = 1);
  -- requester may not approve their own request
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit_financials' WHERE id = v_req;
    INSERT INTO _r VALUES ('self_approve_REFUSED', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('self_approve_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 6. Admin approves the request → grant row appears ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.access_requests SET status = 'approved', approved_level = 'view' WHERE id = v_req;
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_nogrant AND level = 'view';
  INSERT INTO _r VALUES ('approval_creates_grant', v_n = 1);
  RESET ROLE;

  -- ── 7. Client viewer and foreign admin see nothing ────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('client_viewer_sees_no_study', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('foreign_admin_sees_no_study', v_n = 0);
  INSERT INTO _r VALUES ('foreign_admin_not_grantor', NOT public.solar_is_grantor(v_project));
  RESET ROLE;

  -- ── 8. Lapse: hidden but kept ─────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_admin_sees_nothing', v_n = 0);
  UPDATE solar.studies SET nmd_kva = 2 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_admin_update_affects_nothing', v_n = 0);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project AND nmd_kva = 630;
  INSERT INTO _r VALUES ('lapsed_rows_kept_unchanged', v_n = 1);

  -- ── 9. Service role bypasses; anon refused ────────────────────────────────
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('service_role_sees_study', v_n = 1);
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.studies LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it against the current schema to prove it can fail**

```bash
echo "SELECT 1;" > /tmp/noop.sql
scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-foundation-roles.sql
```
Expected: FAIL (error such as `function public.org_has_solar(uuid) does not exist` or `relation "billing.org_addon_subscriptions" does not exist`). A red run here is the point — it proves the file tests something that does not yet exist.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-solar-foundation-roles.sql
git commit -m "test(solar): behavioural RLS assertions for the solar foundation (red)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The migration

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00207_solar_foundation.sql`
- Modify: `apps/edge-functions/supabase/config.toml:9`

- [ ] **Step 1: Expose the schema locally**

In `apps/edge-functions/supabase/config.toml` line 9 add `"solar"` to the list:
```toml
schemas = ["public", "projects", "field", "tenants", "suppliers", "billing", "marketplace", "gcr", "structure", "cable_schedule", "inspections", "solar"]
```

- [ ] **Step 2: Write the migration**

`apps/edge-functions/supabase/migrations/00207_solar_foundation.sql`:
```sql
-- ---------------------------------------------------------------------------
-- Migration 00207: Solar add-on foundation
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §2–3; decisions D-01, D-02,
-- D-04 in docs/solar/06-open-decisions.md (owner, 2026-09-28).
--
-- WHAT. The access model for the paid Solar module, and its first table:
--   * billing.org_addon_subscriptions — an ORG-wide annual subscription
--     (R1,999/yr). Written only by the Paystack webhook (service role).
--   * solar.project_access — per-user level on a project: view / edit /
--     edit_financials, granted by the project org's owners/admins.
--   * solar.access_requests — "request access" / "ask an admin to subscribe".
--   * solar.studies — one per project; Site & Supply fields for Phase 1.
--   * solar.audit_events — append-only activity for the Overview tab.
--
-- ACCESS RULE (public.solar_access_level):
--   NULL unless the project's org has an active, in-date subscription;
--   'edit_financials' for owners/admins of the project's org;
--   NULL for non-members, client viewers and suppliers;
--   otherwise the caller's granted level (NULL when none).
-- LAPSE = HIDDEN BUT KEPT (D-02): every policy goes through the helper, so a
-- lapsed org reads and writes nothing while its rows stay untouched.
--
-- NEW SCHEMA CHECKLIST (00126): grants below (no anon), config.toml, AND the
-- production PostgREST db_schema PATCH at apply time — without the PATCH,
-- REST returns PGRST002 indefinitely.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: billing.org_addon_subscriptions
-- table: solar.project_access
-- table: solar.access_requests
-- table: solar.studies
-- table: solar.audit_events
-- function: public.org_has_solar(uuid)
-- function: public.solar_is_grantor(uuid)
-- function: public.solar_access_level(uuid)
-- function: public.solar_can_view(uuid)
-- function: public.solar_can_edit(uuid)
-- function: public.solar_can_see_money(uuid)
-- trigger: project_access_bind ON solar.project_access
-- trigger: access_requests_guard ON solar.access_requests
-- trigger: studies_bind ON solar.studies
-- trigger: audit_events_bind ON solar.audit_events
-- policy: studies_select ON solar.studies PERMISSIVE
-- policy: studies_insert_authz ON solar.studies RESTRICTIVE
-- policy: studies_update_authz ON solar.studies RESTRICTIVE
-- policy: studies_delete_authz ON solar.studies RESTRICTIVE
-- grant_absent: anon SELECT ON solar.studies
-- grant_absent: anon SELECT ON solar.project_access
-- grant_absent: anon EXECUTE ON public.solar_access_level(uuid)
-- grant_absent: anon EXECUTE ON public.org_has_solar(uuid)
-- grant_absent: anon EXECUTE ON public.solar_is_grantor(uuid)
-- sql: (SELECT NOT has_schema_privilege('anon', 'solar', 'USAGE'))
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND p.polpermissive = false AND p.polcmd IN ('r', '*'))
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND c.relkind = 'r')
-- behaviour: scripts/db/assert-solar-foundation-roles.sql — every row ok
-- @verify:end

-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that "rolled-back" production
-- dry run permanent. (00205/00206 follow the same rule.)

-- ── 0. Schema and grants (no anon) ──────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS solar;
GRANT USAGE ON SCHEMA solar TO authenticated, service_role;
REVOKE ALL ON SCHEMA solar FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solar GRANT USAGE ON SEQUENCES TO authenticated;

-- ── 1. The org subscription ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing.org_addon_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id             UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    feature_key                 TEXT NOT NULL CHECK (feature_key IN ('solar')),
    status                      TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','non_renewing','past_due','cancelled','refunded')),
    amount_kobo                 BIGINT NOT NULL,
    current_period_end          TIMESTAMPTZ,
    paystack_customer_code      TEXT,
    paystack_subscription_code  TEXT UNIQUE,
    last_event_id               TEXT,
    started_at                  TIMESTAMPTZ,
    cancelled_at                TIMESTAMPTZ,
    refunded_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT org_addon_subscriptions_org_feature_key UNIQUE (organisation_id, feature_key)
);
CREATE TRIGGER org_addon_subscriptions_updated_at
    BEFORE UPDATE ON billing.org_addon_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE billing.org_addon_subscriptions ENABLE ROW LEVEL SECURITY;
-- Owners/admins of the org can see its subscription (00187 billing read gate).
-- No write policy: the webhook writes through the service role.
CREATE POLICY org_addon_subscriptions_select_owner_admin ON billing.org_addon_subscriptions
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_addon_subscriptions.organisation_id
           AND uo.is_active AND uo.role IN ('owner', 'admin')));
GRANT SELECT ON billing.org_addon_subscriptions TO authenticated;
GRANT ALL ON billing.org_addon_subscriptions TO service_role;
REVOKE ALL ON billing.org_addon_subscriptions FROM anon;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_has_solar(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid   -- WM-Consulting bypass, as has_feature
        OR EXISTS (
            SELECT 1 FROM billing.org_addon_subscriptions s
             WHERE s.organisation_id = p_org_id AND s.feature_key = 'solar'
               AND s.status IN ('active', 'non_renewing')
               AND s.current_period_end > NOW());
$$;

CREATE OR REPLACE FUNCTION public.solar_is_grantor(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.projects p
          JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
         WHERE p.id = p_project_id AND uo.user_id = auth.uid()
           AND uo.is_active AND uo.role IN ('owner', 'admin'));
$$;

CREATE OR REPLACE FUNCTION public.solar_access_level(p_project_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_org  UUID;
    v_role TEXT;
BEGIN
    SELECT organisation_id INTO v_org FROM projects.projects WHERE id = p_project_id;
    IF v_org IS NULL OR NOT public.org_has_solar(v_org) THEN RETURN NULL; END IF;
    IF public.solar_is_grantor(p_project_id) THEN RETURN 'edit_financials'; END IF;
    v_role := COALESCE(public.user_effective_project_role(p_project_id), '');
    IF v_role IN ('', 'client_viewer', 'supplier') THEN RETURN NULL; END IF;
    RETURN (SELECT pa.level FROM solar.project_access pa
             WHERE pa.project_id = p_project_id AND pa.user_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.solar_can_view(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.solar_access_level(p_project_id) IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION public.solar_can_edit(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(public.solar_access_level(p_project_id) IN ('edit', 'edit_financials'), false);
$$;
CREATE OR REPLACE FUNCTION public.solar_can_see_money(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(public.solar_access_level(p_project_id) = 'edit_financials', false);
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.org_has_solar(uuid)', 'public.solar_is_grantor(uuid)',
                           'public.solar_access_level(uuid)', 'public.solar_can_view(uuid)',
                           'public.solar_can_edit(uuid)', 'public.solar_can_see_money(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ── 3. Per-user project access ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.project_access (
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    level            TEXT NOT NULL CHECK (level IN ('view', 'edit', 'edit_financials')),
    granted_by       UUID REFERENCES auth.users(id),
    granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- Binds organisation_id and granted_by; refuses grants to non-members,
-- client viewers and suppliers (a client never sees internal Solar data).
CREATE OR REPLACE FUNCTION solar.project_access_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.project_access: project % not found', NEW.project_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.project_members pm
                    WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.user_id
                      AND pm.is_active AND pm.role NOT IN ('client_viewer', 'supplier')) THEN
        RAISE EXCEPTION 'solar.project_access: user is not an eligible member of this project' USING ERRCODE = '23514';
    END IF;
    IF auth.uid() IS NOT NULL THEN NEW.granted_by := auth.uid(); END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.project_access_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.project_access_bind() FROM anon;
CREATE TRIGGER project_access_bind BEFORE INSERT OR UPDATE ON solar.project_access
    FOR EACH ROW EXECUTE FUNCTION solar.project_access_bind();

ALTER TABLE solar.project_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.project_access FORCE ROW LEVEL SECURITY;
-- Grantors see every grant on the project; a user sees their own.
CREATE POLICY project_access_select ON solar.project_access FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.solar_is_grantor(project_id));
CREATE POLICY project_access_insert ON solar.project_access FOR INSERT TO authenticated
    WITH CHECK (public.solar_is_grantor(project_id));
CREATE POLICY project_access_update ON solar.project_access FOR UPDATE TO authenticated
    USING (public.solar_is_grantor(project_id)) WITH CHECK (public.solar_is_grantor(project_id));
CREATE POLICY project_access_delete ON solar.project_access FOR DELETE TO authenticated
    USING (public.solar_is_grantor(project_id));

-- ── 4. Access requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.access_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    requester_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('access', 'subscribe')),
    requested_level  TEXT CHECK (requested_level IN ('view', 'edit', 'edit_financials')),
    approved_level   TEXT CHECK (approved_level IN ('view', 'edit', 'edit_financials')),
    note             TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
    decided_by       UUID REFERENCES auth.users(id),
    decided_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending
    ON solar.access_requests (project_id, requester_id, kind) WHERE status = 'pending';

-- INSERT: requester, org and status are bound, never trusted.
-- UPDATE: a requester may only withdraw their own pending request; a grantor
-- may approve (with approved_level) or decline. Approval writes the grant.
CREATE OR REPLACE FUNCTION solar.access_requests_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF auth.uid() IS NOT NULL THEN NEW.requester_id := auth.uid(); END IF;
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        NEW.status := 'pending'; NEW.approved_level := NULL; NEW.decided_by := NULL; NEW.decided_at := NULL;
        RETURN NEW;
    END IF;
    IF NEW.project_id <> OLD.project_id OR NEW.requester_id <> OLD.requester_id OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'access_requests: identity columns are immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'access_requests: request already %', OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'withdrawn' THEN
        IF auth.uid() IS DISTINCT FROM OLD.requester_id THEN
            RAISE EXCEPTION 'access_requests: only the requester may withdraw' USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.status IN ('approved', 'declined') THEN
        IF auth.uid() IS NOT NULL AND NOT public.solar_is_grantor(NEW.project_id) THEN
            RAISE EXCEPTION 'access_requests: only an org owner/admin may decide' USING ERRCODE = '42501';
        END IF;
        NEW.decided_by := auth.uid(); NEW.decided_at := NOW();
        IF NEW.status = 'approved' AND NEW.kind = 'access' THEN
            IF NEW.approved_level IS NULL THEN
                RAISE EXCEPTION 'access_requests: approved_level is required' USING ERRCODE = '23514';
            END IF;
            INSERT INTO solar.project_access (project_id, user_id, level)
            VALUES (NEW.project_id, NEW.requester_id, NEW.approved_level)
            ON CONFLICT (project_id, user_id) DO UPDATE SET level = EXCLUDED.level;
        END IF;
    ELSIF NEW.status <> 'pending' THEN
        RAISE EXCEPTION 'access_requests: invalid status %', NEW.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.access_requests_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.access_requests_guard() FROM anon;
CREATE TRIGGER access_requests_guard BEFORE INSERT OR UPDATE ON solar.access_requests
    FOR EACH ROW EXECUTE FUNCTION solar.access_requests_guard();

ALTER TABLE solar.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY access_requests_select ON solar.access_requests FOR SELECT TO authenticated
    USING (requester_id = auth.uid() OR public.solar_is_grantor(project_id));
CREATE POLICY access_requests_insert ON solar.access_requests FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id)
                AND COALESCE(public.user_effective_project_role(project_id), '') NOT IN ('', 'client_viewer', 'supplier'));
CREATE POLICY access_requests_update ON solar.access_requests FOR UPDATE TO authenticated
    USING (requester_id = auth.uid() OR public.solar_is_grantor(project_id))
    WITH CHECK (requester_id = auth.uid() OR public.solar_is_grantor(project_id));

-- ── 5. Studies (Phase 1 columns: Site & Supply) ─────────────────────────────
CREATE TABLE IF NOT EXISTS solar.studies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL UNIQUE REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    latitude            NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
    longitude           NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
    elevation_m         NUMERIC(7,1),
    licensee_name       TEXT,           -- becomes licensee_id → tariffs.licensee in Phase 2
    supply_type         TEXT CHECK (supply_type IN ('eskom_direct', 'municipal', 'private_resale')),
    nmd_kva             NUMERIC(10,2) CHECK (nmd_kva > 0),
    supply_voltage_v    INTEGER CHECK (supply_voltage_v > 0),
    poc_node_id         UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    export_mode         TEXT CHECK (export_mode IN ('net_billing', 'no_credit', 'zero_export')),
    export_limit_kw     NUMERIC(10,2) CHECK (export_limit_kw >= 0),
    constraints_note    TEXT,
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION solar.studies_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.studies: project % not found', NEW.project_id USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'INSERT' THEN NEW.created_by := COALESCE(auth.uid(), NEW.created_by); END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.studies_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_bind() FROM anon;
CREATE TRIGGER studies_bind BEFORE INSERT OR UPDATE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_bind();

ALTER TABLE solar.studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.studies FORCE ROW LEVEL SECURITY;
-- Exactly one policy covers SELECT. Writes: permissive membership + RESTRICTIVE
-- level gate, one per verb (never RESTRICTIVE FOR ALL — it narrows reads, 00205).
CREATE POLICY studies_select ON solar.studies FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY studies_insert ON solar.studies FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY studies_update ON solar.studies FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY studies_delete ON solar.studies FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY studies_insert_authz ON solar.studies AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY studies_update_authz ON solar.studies AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY studies_delete_authz ON solar.studies AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));   -- deleting a whole study: owner/admin/edit_financials only

-- ── 6. Audit events (append-only) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.audit_events (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    verb             TEXT NOT NULL CHECK (length(btrim(verb)) > 0),
    object_ref       JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id         UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_project_created_idx ON solar.audit_events (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION solar.audit_events_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
    IF auth.uid() IS NOT NULL THEN NEW.actor_id := auth.uid(); END IF;
    NEW.created_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.audit_events_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.audit_events_bind() FROM anon;
CREATE TRIGGER audit_events_bind BEFORE INSERT ON solar.audit_events
    FOR EACH ROW EXECUTE FUNCTION solar.audit_events_bind();

ALTER TABLE solar.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_select ON solar.audit_events FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY audit_events_insert ON solar.audit_events FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
-- No UPDATE / DELETE policy: append-only.

-- ── 7. Table grants (explicit; the default privileges only cover future tables)
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.project_access, solar.access_requests, solar.studies TO authenticated;
GRANT SELECT, INSERT ON solar.audit_events TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA solar TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA solar TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA solar FROM anon;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00207_solar_foundation.sql apps/edge-functions/supabase/config.toml
git commit -m "feat(solar): 00207 solar foundation — org subscription, per-user access, studies, audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Prove it in a rolled-back transaction (red → green)

**Files:** none (evidence only)

- [ ] **Step 1: Green run with the migration**

```bash
scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_solar_foundation.sql scripts/db/assert-solar-foundation-roles.sql
```
Expected: every row `ok = t` (29 checks). Before running, `grep -n "COMMIT" apps/edge-functions/supabase/migrations/00207_solar_foundation.sql` must print nothing. Nothing persists — the script rolls back.
If a check is `f`: fix the **migration**, never the assertion, unless the assertion contradicts the spec (then stop and report which).

- [ ] **Step 2: Mutation check — prove the level gate bites**

Temporarily edit the migration: change `studies_update_authz` to `USING (true) WITH CHECK (true)`. Re-run Step 1.
Expected: `view_user_update_affects_nothing` and `lapsed_admin_update_affects_nothing` go `f`. Revert the edit (`git checkout -- apps/edge-functions/supabase/migrations/00207_solar_foundation.sql`) and re-run Step 1 → all `t`.

- [ ] **Step 3: Mutation check — prove the grant trigger bites**

Temporarily delete the `IF NOT EXISTS (SELECT 1 FROM projects.project_members …)` block from `solar.project_access_bind`. Re-run Step 1.
Expected: `client_viewer_grant_REFUSED` goes `f`. Revert and re-run → all `t`.

- [ ] **Step 4: Record the evidence**

Save the three outputs to `/tmp/solar-1a-dryrun.txt` for the PR body. No commit.

---

### Task 6: Web access helpers

**Files:**
- Create: `apps/web/src/lib/solar/access.ts`
- Create: `apps/web/src/lib/solar/access.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/access.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) })
vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { getSolarAccessLevel, requireSolarLevel, orgHasSolar } from './access'

const PROJECT = '00000000-0000-0000-0000-0000000000aa'
const ORG = '00000000-0000-0000-0000-0000000000bb'

function client(result: { data: unknown; error: null | { message: string } }) {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

beforeEach(() => redirect.mockClear())

describe('getSolarAccessLevel', () => {
  it('returns the level from public.solar_access_level', async () => {
    const c = client({ data: 'edit', error: null })
    await expect(getSolarAccessLevel(PROJECT, c as never)).resolves.toBe('edit')
    expect(c.rpc).toHaveBeenCalledWith('solar_access_level', { p_project_id: PROJECT })
  })

  it('returns null for NULL, unknown strings and RPC errors (fail closed)', async () => {
    await expect(getSolarAccessLevel(PROJECT, client({ data: null, error: null }) as never)).resolves.toBeNull()
    await expect(getSolarAccessLevel(PROJECT, client({ data: 'owner', error: null }) as never)).resolves.toBeNull()
    await expect(getSolarAccessLevel(PROJECT, client({ data: 'edit', error: { message: 'x' } }) as never)).resolves.toBeNull()
  })
})

describe('requireSolarLevel', () => {
  it('returns the level when it satisfies the requirement', async () => {
    const c = client({ data: 'edit_financials', error: null })
    await expect(requireSolarLevel(PROJECT, 'edit', c as never)).resolves.toBe('edit_financials')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to the project locked screen when the level is too low', async () => {
    const c = client({ data: 'view', error: null })
    await expect(requireSolarLevel(PROJECT, 'edit', c as never)).rejects.toThrow(`REDIRECT:/projects/${PROJECT}/solar/locked`)
  })

  it('redirects when there is no access at all', async () => {
    const c = client({ data: null, error: null })
    await expect(requireSolarLevel(PROJECT, 'view', c as never)).rejects.toThrow(`REDIRECT:/projects/${PROJECT}/solar/locked`)
  })
})

describe('orgHasSolar', () => {
  it('is true only for data === true, false on error', async () => {
    await expect(orgHasSolar(ORG, client({ data: true, error: null }) as never)).resolves.toBe(true)
    await expect(orgHasSolar(ORG, client({ data: false, error: null }) as never)).resolves.toBe(false)
    await expect(orgHasSolar(ORG, client({ data: true, error: { message: 'x' } }) as never)).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/solar/access.test.ts`
Expected: FAIL — cannot resolve `./access`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/access.ts`:
```ts
/**
 * Solar access gates (Phase 1A). Thin wrappers over the SQL helpers in
 * migration 00207 so every page, action and API route asks the database the
 * same question the RLS policies ask. All fail CLOSED.
 *
 *   public.solar_access_level(project) → 'view' | 'edit' | 'edit_financials' | NULL
 *   public.org_has_solar(org)          → boolean (active, in-date org subscription)
 *
 * app/api/* routes sit outside (admin)/layout.tsx, so each must call
 * requireSolarLevel (or getSolarAccessLevel) itself.
 */
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, solarLevelAllows, type SolarAccessLevel } from '@esite/shared'

type AnyClient = SupabaseClient<any, any, any>

export async function getSolarAccessLevel(
  projectId: string,
  supabase?: AnyClient,
): Promise<SolarAccessLevel | null> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('solar_access_level', { p_project_id: projectId })
  if (error) return null
  return isSolarAccessLevel(data) ? data : null
}

/** For pages and server actions: returns the caller's level or redirects to the locked screen. */
export async function requireSolarLevel(
  projectId: string,
  need: SolarAccessLevel,
  supabase?: AnyClient,
): Promise<SolarAccessLevel> {
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, need)) redirect(`/projects/${projectId}/solar/locked`)
  return level as SolarAccessLevel
}

export async function orgHasSolar(organisationId: string, supabase?: AnyClient): Promise<boolean> {
  const client = (supabase ?? (await createClient())) as AnyClient
  const { data, error } = await client.rpc('org_has_solar', { p_org_id: organisationId })
  if (error) return false
  return data === true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/solar/access.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar
git commit -m "feat(solar): web access helpers over solar_access_level / org_has_solar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Full suites and repo-wide guards

**Files:** whichever a guard names (only if it fails)

- [ ] **Step 1: Run all three suites and type-check**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test 2>&1 | tail -3
pnpm --filter web type-check 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -15
```
Expected: all green. Pay particular attention to:
- `apps/web/src/lib/migration-verify-block.contract.test.ts` — parses the `@verify` block; an unknown directive word or an em dash inside a `sql:` payload outside a string fails it.
- `packages/db` migration-text guards (write-role RLS shapes, anon grants). A guard failure means the migration shape is wrong — fix the migration, do not weaken the guard. If a guard is genuinely inapplicable (it predates per-level Solar gates), stop and report the guard name and message instead of editing it.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix(solar): satisfy repo migration guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Skip if nothing changed.)

---

### Task 8: Hand-off (no apply)

**Files:** none

- [ ] **Step 1: Push the branch and open a draft PR** (owner has authorised pushes for this work)

```bash
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-1a
gh pr create --repo WattMatt/e-site --draft --base main --head feat/solar-phase-1a \
  --title "feat(solar): Phase 1A — database foundation (subscription, per-user access, studies)" \
  --body-file /tmp/solar-1a-pr.md
```
`/tmp/solar-1a-pr.md` must contain: what the migration creates; the three dry-run outputs from Task 5; suite counts before/after; and this **apply checklist** for the owner:
1. Re-check ledger `max(version)`, `origin/main`, open-PR migration filenames; renumber if `00207` is taken.
2. PATCH production PostgREST `db_schema` to add `solar` **before** merging (otherwise `PGRST002`).
3. Merge → deploy workflow applies → `scripts/verify-migration-applied.ts` checks the `@verify` block.
4. Re-run `scripts/db/assert-solar-foundation-roles.sql` against production with the no-op file → all `t`.
End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 2: Report** the PR URL, the suite counts and the dry-run result. Do not merge; do not apply.
