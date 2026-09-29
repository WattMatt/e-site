# Solar Phase 3a-ii — Meter Data Storage and Import Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store meter files, meters, channels and readings in the `solar` schema behind Solar entitlements, prove the storage choice with a ≥ 2 M-row volume test (D-23), and give the server a register → parse → commit pipeline that turns a raw file in Storage into idempotent readings after the user accepts it.

**Architecture:** Migration `00211_solar_meter_data.sql` (number claimed at apply time) adds the org meter library (`meter_files`, `meters`, `meter_series_hashes`, `meter_register`, `meter_channels`, `meter_import_reports`, `meter_readings` hash-partitioned × 8), the study-scoped tables (`study_meters`, `tenant_load_basis`, `site_load`), platform `load_archetypes` (seeded from `LOAD_ARCHETYPES` in 3a-i, contract-tested), four `solar.studies` columns, and the private `solar-meter-raw` bucket. Library RLS uses one caller-scoped array helper `solar.library_orgs(level)` evaluated once per statement; readings are written only through `solar.write_readings(...)`. Three Next.js route handlers under `app/api/projects/[id]/solar/meter-files/` call the pure library from plan 3a-i through a small repository interface, so every route is unit-tested with an in-memory fake.

**Tech Stack:** Postgres (Supabase) with `@verify` blocks and `scripts/db/dry-run-migration.sh` impersonation assertions (red → green, mutation-proven), Next.js 15 route handlers (runtime `nodejs`), supabase-js, zod, Vitest.

**Prerequisite:** plan `2026-09-28-solar-phase-3a-i-meter-data-library.md` is complete on branch `feat/solar-phase-3a` (draft PR open against `feat/solar-phase-1a`).

**Specs:** `docs/solar/03-data-model-and-security.md` §1, §3, §3.1, §3.2, §5; `docs/solar/01-functional-spec.md` §4.3; `docs/solar/02-calculation-engine-spec.md` §2.1; decisions D-22, D-23 in `docs/solar/06-open-decisions.md`; `00208_solar_foundation.sql` for every convention.

---

## Ground rules (read once)

- Work in `~/.config/superpowers/worktrees/esite/solar-phase-3a` on `feat/solar-phase-3a`.
- **Migration number:** the file is `00211_solar_meter_data.sql`. Numbers are claimed **at apply time**: before the owner applies it, re-check the ledger `max(version)`, `origin/main`, and migration filenames in every open PR. If `00211` is taken, rename the file and every reference (the contract test in Task 4 finds the file by suffix, not number).
- **Do not apply to production.** Tasks 5 and 6 run inside rolled-back transactions only. Applying is owner-approved after merge; `solar` is already in PostgREST `db_schema` from 00208, so no new schema PATCH is needed.
- **Conventions copied from 00208, all mandatory:** no `BEGIN`/`COMMIT` in the file (the dry run wraps it); every SECURITY DEFINER function has `SET search_path = ''` and its own spelled-out `REVOKE … FROM PUBLIC` **and** `REVOKE … FROM anon` (the repo guard reads the text); `organisation_id`/`project_id` are bound by BEFORE triggers, never trusted; `ENABLE` + `FORCE ROW LEVEL SECURITY` on every table **including each partition** (00208's `bool_and` directive re-checks relkind `r` in `solar` on every deploy); SELECT is one PERMISSIVE policy; writes are a PERMISSIVE policy per verb plus a RESTRICTIVE policy per verb — **never** a RESTRICTIVE `FOR ALL` or `FOR SELECT` (00208 re-checks that none exists in `solar`).
- `sql:` payloads contain no em dash outside a string literal (#194).
- Run all three suites and both type-checks before claiming done: `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter @esite/db test:ci`, `pnpm --filter @esite/shared type-check`, `pnpm --filter web type-check`.
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Design decisions made in this plan (owner should see them)

1. **Readings are `double precision`, not `numeric`.** 8 bytes fixed vs a variable-length numeric per row at ≥ 23 M rows/yr; PnP values already carry float artefacts. D-23's volume test measures it.
2. **`meter_readings` is partitioned by `HASH (channel_id)` × 8**, not by `organisation_id` (spec §1): the primary key `(channel_id, ts_end)` must contain the partition key, and every read is by channel. `organisation_id` is denormalised onto each row (set by `write_readings` from the channel) so RLS is one array comparison, not a per-row join.
3. **Readings are written only through `solar.write_readings(channel, ts[], value[], quality[])`** (SECURITY DEFINER, checks Edit on the channel's org library once, upserts on the PK). Authenticated has no INSERT/UPDATE/DELETE on the table or its partitions. This also sidesteps the PostgREST `Prefer: resolution=merge-duplicates` header trap (CLAUDE.md, PR #143).
4. **Library visibility = active member of the org with a live subscription and at least View on any of its projects (owners/admins always).** External project members (View grant, other org) see **no** library meter — spec §3.1 says "a member of that org". **Open question:** should an external View user see the meters linked to the one study they can view? (Needed by 3b's charts.)
5. **`meter_files.project_id`** records the project the file was uploaded through; the raw object lives at `<org>/<project>/<sha256>.<ext>` and Storage read/insert follow that project's Solar level. No UPDATE or DELETE policy on the bucket: raw files are kept unchanged.
6. **API routes gate with `requireSolarLevelAPI(…, 'edit')`**, a JSON 401/403 twin of `requireSolarLevel` (which calls `redirect()`, producing a 307 an API client cannot act on).
7. **A register file is imported once**; a series file may be re-committed (readings upsert on the PK, channels upsert on `(meter, file, column)`), which is what makes commit idempotent.
8. **"Link to existing meter" on an identical body writes no readings** (the data is already there under that meter); on a serial match it writes this file's channels under the existing meter.

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql` | The migration |
| `scripts/db/assert-solar-meter-data-roles.sql` | Behavioural impersonation assertions |
| `scripts/db/solar-readings-volume-test.sql` | D-23 volume test (rolled back) |
| `packages/shared/src/services/solar/load/archetype-seed.contract.test.ts` | Migration seed == `LOAD_ARCHETYPES` |
| `apps/web/src/lib/solar/api-gate.ts` (+ test) | `requireSolarLevelAPI` |
| `apps/web/src/lib/solar/meter-import/repo.ts` (+ test) | The only code that talks to Supabase for the pipeline |
| `apps/web/src/lib/solar/meter-import/review.ts` (+ test) | Identity lookup, file status/patch, review model |
| `apps/web/src/lib/solar/meter-import/commit.ts` (+ test) | Commit body schema, series/register/skip commit, read-back verification |
| `apps/web/src/lib/solar/meter-import/fake-repo.ts` | In-memory `MeterImportRepo` for tests |
| `apps/web/src/app/api/projects/[id]/solar/meter-files/route.ts` (+ test) | `POST` register an uploaded raw file |
| `apps/web/src/app/api/projects/[id]/solar/meter-files/parse/route.ts` (+ test) | `POST` parse → review models |
| `apps/web/src/app/api/projects/[id]/solar/meter-files/commit/route.ts` (+ test) | `POST` commit / register import / skip |
| `docs/rbac-matrix.md` | Three new API rows |
| `docs/solar/03-data-model-and-security.md`, `docs/solar/06-open-decisions.md` | Model deviations and the D-23 result |

---

### Task 1: Confirm the branch and the prerequisite

**Files:** none.

- [ ] **Step 1: Check state**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-3a
git status --short
git log --oneline -3
ls packages/shared/src/meter-data/parse-meter-file.ts packages/shared/src/services/solar/load/archetypes.ts
gh pr list --head feat/solar-phase-3a --state open
```
Expected: clean tree, the 3a-i commits on top, both files present, one draft PR.

- [ ] **Step 2: Record the current migration head (for the hand-off, not to claim a number)**

```bash
. scripts/db/mgmt-api.sh
mgmt_query "select max(version) as head, bool_or(version = '00208') as has_00208 from supabase_migrations.schema_migrations"
ls apps/edge-functions/supabase/migrations | tail -5
```
Note both values. If `has_00208` is false, the dry runs below apply 00208 and 00211 together (Task 5 shows how).

---

### Task 2: Behavioural assertions first (they must fail before the migration exists)

**Files:**
- Create: `scripts/db/assert-solar-meter-data-roles.sql`

- [ ] **Step 1: Write the assertions**

```sql
-- BEHAVIOURAL assertions for 00211_solar_meter_data (Solar Phase 3a), run as real roles.
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-meter-data-roles.sql        (expect RED)
--   scripts/db/dry-run-migration.sh <00211 or 00208+00211> scripts/db/assert-solar-meter-data-roles.sql (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses
-- the paywall, so it has no negative case). All seeding happens as postgres BEFORE the first
-- impersonation: request.jwt.claims is transaction-local and outlives RESET ROLE; it is cleared
-- explicitly before every later postgres step.
-- REFUSAL PATTERN (as 00208): a "…_REFUSED" check catches ONLY the SQLSTATE the design promises; if the
-- statement is wrongly allowed the block raises P0001 itself so the write is rolled back; any other
-- error records false instead of aborting the file.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();   -- project in v_org
  v_p2      UUID := gen_random_uuid();   -- project in v_org2
  v_node    UUID := gen_random_uuid();   -- board on v_p
  v_node2   UUID := gen_random_uuid();   -- board on v_p2
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_con     UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_ext     UUID := gen_random_uuid();   -- external: active in v_org2, member of v_p, VIEW grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_study   UUID;
  v_file    UUID;
  v_meter   UUID;
  v_meter2  UUID;   -- org2 meter
  v_meter3  UUID;   -- second v_org meter (for link/delete tests)
  v_ch      UUID;
  v_rep     UUID;
  v_org_out UUID;
  v_uuid    UUID;
  v_n       INT;
  v_x       DOUBLE PRECISION;
  v_b       BOOLEAN;
  u         UUID;
  v_sha  CONSTANT TEXT := repeat('a', 64);
  v_ts   CONSTANT TIMESTAMPTZ[] := ARRAY['2025-03-10 00:30+02', '2025-03-10 01:00+02', '2025-03-10 01:30+02']::timestamptz[];
  v_path TEXT;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-3a-probe'), (v_org2, 'solar-3a-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_con, v_view, v_nogrant, v_client, v_ext, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-3a-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_con, v_org, 'contractor', TRUE), (v_view, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_ext, v_org2, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-3a-probe-p', v_admin), (v_p2, v_org2, 'solar-3a-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_con, v_org, 'contractor', TRUE), (v_p, v_view, v_org, 'contractor', TRUE),
    (v_p, v_nogrant, v_org, 'contractor', TRUE), (v_p, v_client, v_org, 'client_viewer', TRUE),
    (v_p, v_ext, v_org2, 'contractor', TRUE);
  INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code) VALUES
    (v_node, v_p, v_org, 'main_board', 'SOLAR3A-MB1'), (v_node2, v_p2, v_org2, 'main_board', 'SOLAR3A-MB2');
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_con, 'edit'), (v_p, v_view, 'view'), (v_p, v_ext, 'view');
  -- A forged grant for a client viewer (the eligibility trigger would refuse it).
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2);
  INSERT INTO solar.meters (organisation_id, label) VALUES (v_org2, 'org2 meter') RETURNING id INTO v_meter2;
  INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'second meter') RETURNING id INTO v_meter3;

  -- ── 1. Files: organisation bound from the project; path must be <org>/<project>/<sha>.<ext> ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.meter_files (project_id, organisation_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, v_org2, v_sha, 100, v_org || '/' || v_p || '/' || v_sha || '.csv', 'a.csv')
    RETURNING id, organisation_id INTO v_file, v_org_out;
    INSERT INTO _r VALUES ('admin_registers_file_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_registers_file_org_bound', false);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('b', 64), 100, v_org2 || '/' || v_p || '/' || repeat('b', 64) || '.csv', 'b.csv');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('file_foreign_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('file_foreign_path_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('b', 64), 100, v_org || '/' || v_p || '/' || repeat('b', 64) || '.csv', 'b.csv');
    INSERT INTO _r VALUES ('editor_registers_file', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_registers_file', false);
  END;

  -- ── 2. Meters and channels (editor) ──
  BEGIN
    INSERT INTO solar.meters (organisation_id, label, serials) VALUES (v_org, 'M1', '{30000001}') RETURNING id INTO v_meter;
    INSERT INTO _r VALUES ('editor_creates_meter', v_meter IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_meter', false);
  END;
  BEGIN
    INSERT INTO solar.meter_channels (organisation_id, meter_id, file_id, source_column, quantity, direction,
                                      source_unit, unit, interval_min, tz_convention, is_primary, parser_version)
    VALUES (v_org2, v_meter, v_file, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'begin', TRUE, '3a.1')
    RETURNING id, organisation_id INTO v_ch, v_org_out;
    INSERT INTO _r VALUES ('editor_creates_channel_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_channel_org_bound', false);
  END;
  BEGIN
    INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                      interval_min, tz_convention, parser_version)
    VALUES (v_meter, v_file, 'x', 'unknown', 'none', 'kW', 'unknown', 30, 'end', '3a.1');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('channel_unknown_unit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('channel_unknown_unit_REFUSED', false);
  END;

  -- ── 3. Readings: only through solar.write_readings; upsert on the PK ──
  BEGIN
    SELECT solar.write_readings(v_ch, v_ts, ARRAY[1.5, 2.5, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]) INTO v_n;
    INSERT INTO _r VALUES ('editor_writes_readings', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_readings', false);
  END;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[9, 9, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]);
    SELECT count(*) INTO v_n FROM solar.meter_readings WHERE channel_id = v_ch;
    SELECT value INTO v_x FROM solar.meter_readings WHERE channel_id = v_ch AND ts_end = v_ts[1];
    INSERT INTO _r VALUES ('write_readings_idempotent_upsert', v_n = 3 AND v_x = 9);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('write_readings_idempotent_upsert', false);
  END;
  BEGIN
    INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES (v_ch, v_org, now(), 1, 0);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('direct_readings_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('direct_readings_insert_REFUSED', false);
  END;

  -- ── 4. Study-scoped tables (editor) ──
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter) RETURNING project_id INTO v_uuid;
    INSERT INTO _r VALUES ('editor_links_study_meter_project_bound', v_uuid = v_p);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_links_study_meter_project_bound', false);
  END;
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('study_meter_cross_org_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('study_meter_cross_org_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source) VALUES (v_study, v_node2, 'synthesised');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tlb_foreign_node_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tlb_foreign_node_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source, meters)
    VALUES (v_study, v_node, 'metered', jsonb_build_array(jsonb_build_object('meter_id', v_meter, 'weight', 0)));
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tlb_zero_weight_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tlb_zero_weight_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source, meters, archetype)
    VALUES (v_study, v_node, 'metered', jsonb_build_array(jsonb_build_object('meter_id', v_meter, 'weight', 1)), 'retail');
    INSERT INTO _r VALUES ('editor_writes_tenant_basis', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_tenant_basis', false);
  END;
  BEGIN
    INSERT INTO solar.site_load (study_id, basis, reference_year, series, inputs_hash, engine_version)
    VALUES (v_study, 'S2', 2027, array_fill(1::real, ARRAY[10]), repeat('d', 64), '3a');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('site_load_wrong_length_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('site_load_wrong_length_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.site_load (study_id, basis, reference_year, series, inputs_hash, engine_version)
    VALUES (v_study, 'S2', 2027, array_fill(1::real, ARRAY[8760]), repeat('d', 64), '3a');
    INSERT INTO _r VALUES ('editor_writes_site_load', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_site_load', false);
  END;

  -- ── 5. Register and import report (editor); accepted_by is bound ──
  BEGIN
    INSERT INTO solar.meter_register (organisation_id, kind, serial, mall_name) VALUES (v_org, 'download_log', '30000001', 'SITE PD');
    INSERT INTO _r VALUES ('editor_writes_register', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_register', false);
  END;
  BEGIN
    INSERT INTO solar.meter_import_reports (file_id, parser_version, report) VALUES (v_file, '3a.1', '{}'::jsonb) RETURNING id INTO v_rep;
    UPDATE solar.meter_import_reports SET accepted_at = now(), accepted_by = v_admin WHERE id = v_rep;
    SELECT accepted_by INTO v_uuid FROM solar.meter_import_reports WHERE id = v_rep;
    INSERT INTO _r VALUES ('report_accepted_by_bound', v_uuid = v_con);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('report_accepted_by_bound', false);
  END;

  -- ── 6. Library delete is owner/admin only ──
  BEGIN
    DELETE FROM solar.meters WHERE id = v_meter3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('editor_cannot_delete_meter', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_cannot_delete_meter', false);
  END;

  -- ── 7. Raw-file path helper (the storage policies call it) ──
  v_path := v_org || '/' || v_p || '/' || v_sha || '.csv';
  INSERT INTO _r VALUES ('raw_path_editor_can_upload', solar.raw_path_allowed(v_path, 'edit'));
  INSERT INTO _r VALUES ('raw_path_foreign_org_segment_refused', NOT solar.raw_path_allowed(v_org2 || '/' || v_p || '/' || v_sha || '.csv', 'edit'));
  INSERT INTO _r VALUES ('raw_path_bad_name_refused', NOT solar.raw_path_allowed(v_org || '/' || v_p || '/a.csv', 'edit'));
  INSERT INTO _r VALUES ('raw_path_wrong_extension_refused', NOT solar.raw_path_allowed(v_org || '/' || v_p || '/' || v_sha || '.exe', 'edit'));
  RESET ROLE;

  -- ── 8. View-only member: reads the library, writes nothing ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT (SELECT count(*) FROM solar.meters WHERE id = v_meter) = 1
     AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 3
     AND (SELECT count(*) FROM solar.meter_files WHERE organisation_id = v_org) = 2 INTO v_b;
  INSERT INTO _r VALUES ('viewer_reads_library', v_b);
  BEGIN
    INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'nope');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_create_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_create_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('c', 64), 100, v_org || '/' || v_p || '/' || repeat('c', 64) || '.csv', 'c.csv');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_register_file_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_register_file_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_write_readings_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_link_study_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_link_study_meter_REFUSED', false);
  END;
  BEGIN
    PERFORM count(*) FROM solar.meter_readings_p0;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('partition_direct_read_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('partition_direct_read_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('viewer_reads_eight_archetypes', (SELECT count(*) FROM solar.load_archetypes) = 8);
  INSERT INTO _r VALUES ('raw_path_viewer_can_read', solar.raw_path_allowed(v_path, 'view'));
  INSERT INTO _r VALUES ('raw_path_viewer_cannot_upload', NOT solar.raw_path_allowed(v_path, 'edit'));
  RESET ROLE;

  -- ── 9. Everyone else reads nothing from the library ──
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_ext, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_files WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 0
       AND NOT solar.raw_path_allowed(v_path, 'edit') INTO v_b;
    INSERT INTO _r VALUES (CASE u WHEN v_nogrant THEN 'no_grant_member_reads_nothing'
                                  WHEN v_client  THEN 'client_forged_grant_reads_nothing'
                                  WHEN v_ext     THEN 'external_view_reads_no_library'
                                  ELSE 'foreign_admin_reads_nothing' END, v_b);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('foreign_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_write_readings_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 10. Admin: deletes a library meter; cannot write platform archetypes ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM solar.meters WHERE id = v_meter3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_deletes_meter', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_deletes_meter', false);
  END;
  BEGIN
    INSERT INTO solar.load_archetypes (code, version, name, profiles, operating, seasonal)
    VALUES ('retail', 99, 'x', '{}'::jsonb, '{}'::jsonb, '[1,1,1,1,1,1,1,1,1,1,1,1]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('archetype_write_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('archetype_write_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 11. Storage policies are wired to the helper; bucket is private ──
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('storage_policies_call_helper', (
    SELECT count(*) = 2 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN ('solar_meter_raw_read', 'solar_meter_raw_insert')
       AND coalesce(qual, with_check) LIKE '%raw_path_allowed%'));
  INSERT INTO _r VALUES ('bucket_private', (SELECT NOT public FROM storage.buckets WHERE id = 'solar-meter-raw'));

  -- ── 12. Lapse = hidden but kept (D-02) ──
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_admin_reads_nothing', (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_write_readings_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 3);

  -- ── 13. Service role bypasses RLS ──
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_library', (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) >= 1);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it RED (no migration)**

```bash
printf -- '-- no-op\nSELECT 1;\n' > /tmp/noop.sql
scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-meter-data-roles.sql
```
Expected: the file ABORTS (`relation "solar.meter_files" does not exist`, or `schema "solar" does not exist` if 00208 is not applied), reported as one failed assertion. A check you have never seen fail is decorative.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-solar-meter-data-roles.sql
git commit -m "$(cat <<'EOF'
test(solar): behavioural RLS assertions for the meter data migration (red first)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The migration

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ---------------------------------------------------------------------------
-- Migration 00211: Solar meter data core (Phase 3a)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §1, §3, §3.1, §3.2; decision D-23.
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-3a-ii-meter-data-storage-pipeline.md
--
-- WHAT.
--   Org meter LIBRARY (shared by every study in the org):
--     meter_files, meters, meter_series_hashes, meter_register, meter_channels,
--     meter_import_reports, meter_readings (HASH(channel_id) x 8 partitions).
--   STUDY-scoped: study_meters, tenant_load_basis, site_load.
--   PLATFORM: load_archetypes (seeded; == LOAD_ARCHETYPES in @esite/shared, contract-tested).
--   solar.studies gains load_basis, reference_year, common_area_pct, diversity_factor.
--   Storage bucket solar-meter-raw (private), path <org>/<project>/<sha256>.<ext>.
--
-- ACCESS.
--   Library rows: visible to ACTIVE members of the row's org whose org subscription is live and who
--   hold at least View on any of the org's projects (owners/admins always); writes need Edit;
--   deletes need owner/admin. One helper, solar.library_orgs(level), returns the caller's orgs as an
--   array, so a policy is `organisation_id = ANY ((SELECT solar.library_orgs('view')))`: evaluated
--   once per statement (InitPlan), not once per row, which matters at millions of readings.
--   Study rows: exactly the solar.studies pattern (00208).
--   Readings: SELECT policy only; no INSERT/UPDATE/DELETE grant; written by solar.write_readings.
--   Lapse = hidden but kept (every helper goes through solar.org_subscription_active).
--
-- 00208's schema-wide directives re-run on every deploy and this migration conforms: every table
-- AND partition has FORCE RLS; no RESTRICTIVE policy covers SELECT; every SECURITY DEFINER function
-- in solar has its anon EXECUTE revoked.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.meter_files
-- table: solar.meters
-- table: solar.meter_series_hashes
-- table: solar.meter_register
-- table: solar.meter_channels
-- table: solar.meter_import_reports
-- table: solar.meter_readings
-- table: solar.study_meters
-- table: solar.tenant_load_basis
-- table: solar.load_archetypes
-- table: solar.site_load
-- column: solar.studies.load_basis
-- column: solar.studies.reference_year
-- column: solar.studies.common_area_pct
-- column: solar.studies.diversity_factor
-- constraint: meter_files_org_sha_key ON solar.meter_files
-- constraint: meter_channels_source_key ON solar.meter_channels
-- constraint: site_load_series_8760 ON solar.site_load
-- function: solar.try_uuid(text)
-- function: solar.library_orgs(text)
-- function: solar.raw_path_allowed(text, text)
-- function: solar.write_readings(uuid, timestamptz[], double precision[], smallint[])
-- function: solar.meter_files_bind()
-- function: solar.meters_bind()
-- function: solar.meter_series_hashes_bind()
-- function: solar.meter_register_bind()
-- function: solar.meter_channels_bind()
-- function: solar.meter_import_reports_bind()
-- function: solar.study_scoped_bind()
-- function: solar.tenant_load_basis_check()
-- trigger: meter_files_bind ON solar.meter_files
-- trigger: meters_bind ON solar.meters
-- trigger: meter_series_hashes_bind ON solar.meter_series_hashes
-- trigger: meter_register_bind ON solar.meter_register
-- trigger: meter_channels_bind ON solar.meter_channels
-- trigger: meter_import_reports_bind ON solar.meter_import_reports
-- trigger: study_meters_bind ON solar.study_meters
-- trigger: tenant_load_basis_bind ON solar.tenant_load_basis
-- trigger: tenant_load_basis_check ON solar.tenant_load_basis
-- trigger: site_load_bind ON solar.site_load
-- function: solar.study_meters_check()
-- trigger: study_meters_check ON solar.study_meters
-- policy: meter_files_select ON solar.meter_files PERMISSIVE
-- policy: meter_files_insert ON solar.meter_files PERMISSIVE
-- policy: meter_files_update ON solar.meter_files PERMISSIVE
-- policy: meter_files_delete ON solar.meter_files PERMISSIVE
-- policy: meter_files_insert_authz ON solar.meter_files RESTRICTIVE
-- policy: meter_files_update_authz ON solar.meter_files RESTRICTIVE
-- policy: meter_files_delete_authz ON solar.meter_files RESTRICTIVE
-- policy: meters_select ON solar.meters PERMISSIVE
-- policy: meters_insert ON solar.meters PERMISSIVE
-- policy: meters_update ON solar.meters PERMISSIVE
-- policy: meters_delete ON solar.meters PERMISSIVE
-- policy: meters_insert_authz ON solar.meters RESTRICTIVE
-- policy: meters_update_authz ON solar.meters RESTRICTIVE
-- policy: meters_delete_authz ON solar.meters RESTRICTIVE
-- policy: meter_series_hashes_select ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_insert ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_delete ON solar.meter_series_hashes PERMISSIVE
-- policy: meter_series_hashes_insert_authz ON solar.meter_series_hashes RESTRICTIVE
-- policy: meter_series_hashes_delete_authz ON solar.meter_series_hashes RESTRICTIVE
-- policy: meter_register_select ON solar.meter_register PERMISSIVE
-- policy: meter_register_insert ON solar.meter_register PERMISSIVE
-- policy: meter_register_update ON solar.meter_register PERMISSIVE
-- policy: meter_register_delete ON solar.meter_register PERMISSIVE
-- policy: meter_register_insert_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_register_update_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_register_delete_authz ON solar.meter_register RESTRICTIVE
-- policy: meter_channels_select ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_insert ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_update ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_delete ON solar.meter_channels PERMISSIVE
-- policy: meter_channels_insert_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_channels_update_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_channels_delete_authz ON solar.meter_channels RESTRICTIVE
-- policy: meter_import_reports_select ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_insert ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_update ON solar.meter_import_reports PERMISSIVE
-- policy: meter_import_reports_insert_authz ON solar.meter_import_reports RESTRICTIVE
-- policy: meter_import_reports_update_authz ON solar.meter_import_reports RESTRICTIVE
-- policy: meter_readings_select ON solar.meter_readings PERMISSIVE
-- policy: study_meters_select ON solar.study_meters PERMISSIVE
-- policy: study_meters_insert ON solar.study_meters PERMISSIVE
-- policy: study_meters_delete ON solar.study_meters PERMISSIVE
-- policy: study_meters_insert_authz ON solar.study_meters RESTRICTIVE
-- policy: study_meters_delete_authz ON solar.study_meters RESTRICTIVE
-- policy: tenant_load_basis_select ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_insert ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_update ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_delete ON solar.tenant_load_basis PERMISSIVE
-- policy: tenant_load_basis_insert_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: tenant_load_basis_update_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: tenant_load_basis_delete_authz ON solar.tenant_load_basis RESTRICTIVE
-- policy: site_load_select ON solar.site_load PERMISSIVE
-- policy: site_load_insert ON solar.site_load PERMISSIVE
-- policy: site_load_update ON solar.site_load PERMISSIVE
-- policy: site_load_delete ON solar.site_load PERMISSIVE
-- policy: site_load_insert_authz ON solar.site_load RESTRICTIVE
-- policy: site_load_update_authz ON solar.site_load RESTRICTIVE
-- policy: site_load_delete_authz ON solar.site_load RESTRICTIVE
-- policy: load_archetypes_select ON solar.load_archetypes PERMISSIVE
-- policy: solar_meter_raw_read ON storage.objects PERMISSIVE
-- policy: solar_meter_raw_insert ON storage.objects PERMISSIVE
-- grant_absent: anon SELECT ON solar.meter_readings
-- grant_absent: authenticated INSERT ON solar.meter_readings
-- grant_absent: authenticated UPDATE ON solar.meter_readings
-- grant_absent: authenticated DELETE ON solar.meter_readings
-- grant_absent: authenticated INSERT ON solar.load_archetypes
-- grant_absent: authenticated UPDATE ON solar.load_archetypes
-- grant_absent: authenticated DELETE ON solar.load_archetypes
-- grant_absent: authenticated UPDATE ON solar.meter_series_hashes
-- grant_absent: anon EXECUTE ON solar.library_orgs(text)
-- grant_absent: anon EXECUTE ON solar.raw_path_allowed(text, text)
-- grant_absent: anon EXECUTE ON solar.write_readings(uuid, timestamptz[], double precision[], smallint[])
-- grant_absent: anon EXECUTE ON solar.try_uuid(text)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT c.relkind = 'p' FROM pg_class c WHERE c.oid = 'solar.meter_readings'::regclass)
-- sql: (SELECT count(*) = 8 FROM pg_inherits WHERE inhparent = 'solar.meter_readings'::regclass)
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'solar.meter_readings'::regclass)
-- sql: (SELECT count(*) = 8 FROM solar.load_archetypes WHERE is_current)
-- sql: (SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-meter-raw' AND NOT public))
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'solar_meter_raw%' AND cmd IN ('UPDATE', 'DELETE', 'ALL')))
-- behaviour: scripts/db/assert-solar-meter-data-roles.sql - every row ok
-- @verify:end

-- NO BEGIN/COMMIT (scripts/db/dry-run-migration.sh wraps this file in BEGIN … ROLLBACK).

-- ── 0. solar.studies: load settings ──────────────────────────────────────────
ALTER TABLE solar.studies
    ADD COLUMN IF NOT EXISTS load_basis       TEXT CHECK (load_basis IN ('S1', 'S2', 'S3', 'S4')),
    ADD COLUMN IF NOT EXISTS reference_year   INTEGER CHECK (reference_year BETWEEN 2000 AND 2100),
    ADD COLUMN IF NOT EXISTS common_area_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (common_area_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS diversity_factor NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (diversity_factor > 0 AND diversity_factor <= 1);

-- ── 1. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION solar.try_uuid(p TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
    RETURN p::uuid;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- The caller's orgs whose meter library they may see ('view'), change ('edit') or prune ('admin').
-- Caller-scoped (auth.uid()), so it is not an oracle about anyone else. Empty for the service path.
CREATE OR REPLACE FUNCTION solar.library_orgs(p_min TEXT)
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_ranks CONSTANT TEXT[] := ARRAY['view', 'edit', 'edit_financials'];
    v_need  INT;
    v_out   UUID[];
BEGIN
    IF auth.uid() IS NULL THEN RETURN '{}'::uuid[]; END IF;
    IF p_min = 'admin' THEN
        SELECT COALESCE(array_agg(uo.organisation_id), '{}'::uuid[]) INTO v_out
          FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin')
           AND solar.org_subscription_active(uo.organisation_id);
        RETURN v_out;
    END IF;
    v_need := array_position(v_ranks, p_min);
    IF v_need IS NULL THEN
        RAISE EXCEPTION 'solar.library_orgs: unknown level %', p_min USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT uo.organisation_id), '{}'::uuid[]) INTO v_out
      FROM public.user_organisations uo
     WHERE uo.user_id = auth.uid() AND uo.is_active
       AND solar.org_subscription_active(uo.organisation_id)
       AND (uo.role IN ('owner', 'admin')
            OR EXISTS (SELECT 1 FROM solar.project_access pa
                         JOIN projects.projects p ON p.id = pa.project_id
                        WHERE pa.user_id = auth.uid() AND p.organisation_id = uo.organisation_id
                          AND array_position(v_ranks, public.solar_access_level(pa.project_id)) >= v_need));
    RETURN v_out;
END $$;

-- Storage path rule for solar-meter-raw: <org>/<project>/<sha256>.<ext>, the org segment must be the
-- project's org, and the caller needs View (read) or Edit (upload) on that project.
CREATE OR REPLACE FUNCTION solar.raw_path_allowed(p_name TEXT, p_need TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_parts   TEXT[] := string_to_array(p_name, '/');
    v_org     UUID;
    v_project UUID;
    v_owner   UUID;
BEGIN
    IF coalesce(array_length(v_parts, 1), 0) <> 3 THEN RETURN FALSE; END IF;
    IF v_parts[3] !~ '^[0-9a-f]{64}\.(csv|txt|xlsx|xls)$' THEN RETURN FALSE; END IF;
    v_org := solar.try_uuid(v_parts[1]);
    v_project := solar.try_uuid(v_parts[2]);
    IF v_org IS NULL OR v_project IS NULL THEN RETURN FALSE; END IF;
    SELECT organisation_id INTO v_owner FROM projects.projects WHERE id = v_project;
    IF v_owner IS DISTINCT FROM v_org THEN RETURN FALSE; END IF;
    IF p_need = 'view' THEN RETURN public.solar_can_view(v_project); END IF;
    IF p_need = 'edit' THEN RETURN public.solar_can_edit(v_project); END IF;
    RETURN FALSE;
END $$;

-- ── 2. Meter files (raw, kept once per org) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.meter_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes       BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
    storage_path     TEXT NOT NULL,
    original_name    TEXT NOT NULL CHECK (length(btrim(original_name)) > 0),
    parsed_filename  JSONB,
    detected_format  TEXT CHECK (detected_format IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'generic', 'empty')),
    delimiter        TEXT,
    decimal_sep      TEXT CHECK (decimal_sep IN ('.', ',')),
    header_row       INTEGER,
    encoding         TEXT,
    body_sha256      TEXT CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    source_serials   TEXT[] NOT NULL DEFAULT '{}',
    ts_convention    TEXT CHECK (ts_convention IN ('begin', 'end')),
    row_order        TEXT CHECK (row_order IN ('ascending', 'descending', 'unordered')),
    status           TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'accepted', 'skipped', 'failed')),
    skip_reason      TEXT,
    uploaded_by      UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_files_org_sha_key UNIQUE (organisation_id, sha256),
    CONSTRAINT meter_files_skip_reason CHECK (status <> 'skipped' OR length(btrim(coalesce(skip_reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS meter_files_org_body_idx ON solar.meter_files (organisation_id, body_sha256);
CREATE INDEX IF NOT EXISTS meter_files_project_idx ON solar.meter_files (project_id);

CREATE OR REPLACE FUNCTION solar.meter_files_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id <> OLD.project_id OR NEW.sha256 <> OLD.sha256 OR NEW.storage_path <> OLD.storage_path
           OR NEW.organisation_id <> OLD.organisation_id OR NEW.size_bytes <> OLD.size_bytes THEN
            RAISE EXCEPTION 'solar.meter_files: project, hash, size and path are immutable' USING ERRCODE = '42501';
        END IF;
        NEW.uploaded_by := OLD.uploaded_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        IF NEW.organisation_id IS NULL THEN
            RAISE EXCEPTION 'solar.meter_files: project % not found', NEW.project_id USING ERRCODE = '23503';
        END IF;
        IF NEW.storage_path !~ ('^' || NEW.organisation_id::text || '/' || NEW.project_id::text || '/' || NEW.sha256 || '\.(csv|txt|xlsx|xls)$') THEN
            RAISE EXCEPTION 'solar.meter_files: storage_path must be <org>/<project>/<sha256>.<ext>' USING ERRCODE = '23514';
        END IF;
        IF auth.uid() IS NOT NULL THEN
            NEW.uploaded_by := auth.uid();
            NEW.created_at := NOW();
        END IF;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_files_bind BEFORE INSERT OR UPDATE ON solar.meter_files
    FOR EACH ROW EXECUTE FUNCTION solar.meter_files_bind();

-- ── 3. Meters (org library) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.meters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    site_label              TEXT,
    label                   TEXT NOT NULL CHECK (length(btrim(label)) > 0),
    serials                 TEXT[] NOT NULL DEFAULT '{}',
    shop_no                 TEXT,
    area_m2                 NUMERIC(10,2) CHECK (area_m2 > 0),
    area_source             TEXT CHECK (area_source IN ('register_exact', 'register_llm', 'filename', 'manual')),
    kind                    TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (kind IN ('tenant', 'bulk', 'council', 'generator', 'solar', 'common', 'vacant', 'check', 'virtual', 'water', 'unknown')),
    supply_point_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
    node_id                 UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    parent_meter_id         UUID REFERENCES solar.meters(id) ON DELETE SET NULL,
    existing_pv_channel_id  UUID,
    created_by              UUID REFERENCES auth.users(id),
    updated_by              UUID REFERENCES auth.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meters_supply_point_bulk_only CHECK (NOT supply_point_confirmed OR kind = 'bulk'),
    CONSTRAINT meters_area_with_source CHECK ((area_m2 IS NULL) = (area_source IS NULL))
);
CREATE INDEX IF NOT EXISTS meters_org_idx ON solar.meters (organisation_id);
CREATE INDEX IF NOT EXISTS meters_serials_gin ON solar.meters USING gin (serials);

CREATE OR REPLACE FUNCTION solar.meters_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.meters: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSIF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
    END IF;
    IF NEW.node_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM structure.nodes n JOIN projects.projects p ON p.id = n.project_id
         WHERE n.id = NEW.node_id AND p.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: node belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_meter_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meters m WHERE m.id = NEW.parent_meter_id AND m.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: parent meter belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF NEW.existing_pv_channel_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_channels c WHERE c.id = NEW.existing_pv_channel_id AND c.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meters: PV channel belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meters_bind BEFORE INSERT OR UPDATE ON solar.meters
    FOR EACH ROW EXECUTE FUNCTION solar.meters_bind();

-- ── 4. Channels ──────────────────────────────────────────────────────────────
-- unit is the STORED unit (energy per interval is stored as average power). There is no 'unknown':
-- the database refuses a channel whose unit nobody chose (engine spec §2.1 step 3).
CREATE TABLE IF NOT EXISTS solar.meter_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    meter_id        UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    file_id         UUID REFERENCES solar.meter_files(id) ON DELETE SET NULL,
    source_column   TEXT NOT NULL CHECK (length(btrim(source_column)) > 0),
    quantity        TEXT NOT NULL CHECK (quantity IN ('active_power', 'reactive_power', 'apparent_power', 'active_energy',
                                                      'reactive_energy', 'apparent_energy', 'voltage', 'current', 'power_factor')),
    direction       TEXT NOT NULL CHECK (direction IN ('import', 'export', 'none')),
    phase           TEXT CHECK (phase IN ('l1', 'l2', 'l3')),
    source_unit     TEXT NOT NULL CHECK (source_unit IN ('kW', 'W', 'MW', 'kWh', 'Wh', 'MWh', 'kvar', 'kvarh', 'kVA', 'kVAh', 'V', 'A', 'PF')),
    unit            TEXT NOT NULL CHECK (unit IN ('kW', 'kvar', 'kVA', 'V', 'A', 'PF')),
    interval_min    INTEGER NOT NULL CHECK (interval_min > 0 AND interval_min <= 1440),
    is_cumulative   BOOLEAN NOT NULL DEFAULT FALSE,
    tz_convention   TEXT NOT NULL CHECK (tz_convention IN ('begin', 'end')),
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    coverage_only   BOOLEAN NOT NULL DEFAULT FALSE,
    parser_version  TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_channels_source_key UNIQUE NULLS NOT DISTINCT (meter_id, file_id, source_column)
);
CREATE UNIQUE INDEX IF NOT EXISTS meter_channels_one_primary_per_file ON solar.meter_channels (meter_id, file_id) WHERE is_primary;
ALTER TABLE solar.meters
    ADD CONSTRAINT meters_existing_pv_channel_fk FOREIGN KEY (existing_pv_channel_id) REFERENCES solar.meter_channels(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION solar.meter_channels_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.meter_id <> OLD.meter_id THEN
        RAISE EXCEPTION 'solar.meter_channels: meter_id is immutable' USING ERRCODE = '42501';
    END IF;
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meters WHERE id = NEW.meter_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_channels: meter % not found', NEW.meter_id USING ERRCODE = '23503';
    END IF;
    IF NEW.file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_channels: file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_channels_bind BEFORE INSERT OR UPDATE ON solar.meter_channels
    FOR EACH ROW EXECUTE FUNCTION solar.meter_channels_bind();

-- ── 5. Readings (D-23: partitioned Postgres table; see the volume test) ─────
CREATE TABLE IF NOT EXISTS solar.meter_readings (
    channel_id       UUID NOT NULL REFERENCES solar.meter_channels(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL,
    ts_end           TIMESTAMPTZ NOT NULL,
    value            DOUBLE PRECISION,
    quality          SMALLINT NOT NULL CHECK (quality BETWEEN 0 AND 7),
    CONSTRAINT meter_readings_value_or_missing CHECK (value IS NOT NULL OR quality IN (1, 4)),
    PRIMARY KEY (channel_id, ts_end)
) PARTITION BY HASH (channel_id);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p0 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 0);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p1 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 1);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p2 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 2);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p3 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 3);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p4 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 4);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p5 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 5);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p6 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 6);
CREATE TABLE IF NOT EXISTS solar.meter_readings_p7 PARTITION OF solar.meter_readings FOR VALUES WITH (MODULUS 8, REMAINDER 7);

-- The only write path for readings: Edit on the channel's org library, checked once per call.
CREATE OR REPLACE FUNCTION solar.write_readings(
    p_channel_id UUID, p_ts_end TIMESTAMPTZ[], p_value DOUBLE PRECISION[], p_quality SMALLINT[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_org UUID;
    v_n   INTEGER;
BEGIN
    SELECT organisation_id INTO v_org FROM solar.meter_channels WHERE id = p_channel_id;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'solar.write_readings: channel % not found', p_channel_id USING ERRCODE = '23503';
    END IF;
    IF auth.uid() IS NOT NULL AND NOT (v_org = ANY (solar.library_orgs('edit'))) THEN
        RAISE EXCEPTION 'solar.write_readings: no Edit access to this meter library' USING ERRCODE = '42501';
    END IF;
    IF cardinality(p_ts_end) <> cardinality(p_value) OR cardinality(p_ts_end) <> cardinality(p_quality) THEN
        RAISE EXCEPTION 'solar.write_readings: arrays differ in length' USING ERRCODE = '22023';
    END IF;
    IF cardinality(p_ts_end) > 20000 THEN
        RAISE EXCEPTION 'solar.write_readings: at most 20000 readings per call' USING ERRCODE = '54000';
    END IF;
    INSERT INTO solar.meter_readings AS r (channel_id, organisation_id, ts_end, value, quality)
    SELECT p_channel_id, v_org, u.t, u.v, u.q FROM unnest(p_ts_end, p_value, p_quality) AS u(t, v, q)
    ON CONFLICT (channel_id, ts_end) DO UPDATE SET value = EXCLUDED.value, quality = EXCLUDED.quality;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- ── 6. Identity hashes, registers, import reports ───────────────────────────
CREATE TABLE IF NOT EXISTS solar.meter_series_hashes (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    body_hash        TEXT NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    file_id          UUID NOT NULL REFERENCES solar.meter_files(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_series_hashes_key UNIQUE (organisation_id, body_hash, file_id)
);
CREATE INDEX IF NOT EXISTS meter_series_hashes_lookup ON solar.meter_series_hashes (organisation_id, body_hash);

CREATE OR REPLACE FUNCTION solar.meter_series_hashes_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meters WHERE id = NEW.meter_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_series_hashes: meter % not found', NEW.meter_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_series_hashes: file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER meter_series_hashes_bind BEFORE INSERT ON solar.meter_series_hashes
    FOR EACH ROW EXECUTE FUNCTION solar.meter_series_hashes_bind();

CREATE TABLE IF NOT EXISTS solar.meter_register (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    source_file_id   UUID REFERENCES solar.meter_files(id) ON DELETE SET NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('summary', 'download_log')),
    site_label       TEXT,
    file_name        TEXT,
    tenant_name      TEXT,
    shop_no          TEXT,
    area_m2          NUMERIC(10,2) CHECK (area_m2 > 0),
    match_method     TEXT NOT NULL DEFAULT 'none' CHECK (match_method IN ('exact', 'llm', 'unmapped', 'manual', 'none')),
    serial           TEXT,
    mall_name        TEXT,
    downloaded       BOOLEAN,
    qa               JSONB NOT NULL DEFAULT '{}'::jsonb,
    confirmed_by     UUID REFERENCES auth.users(id),
    confirmed_at     TIMESTAMPTZ,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meter_register_confirm_pair CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS meter_register_serial_idx ON solar.meter_register (organisation_id, serial);
CREATE INDEX IF NOT EXISTS meter_register_shop_idx ON solar.meter_register (organisation_id, shop_no);

CREATE OR REPLACE FUNCTION solar.meter_register_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.meter_register: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
            NEW.confirmed_by := COALESCE(auth.uid(), NEW.confirmed_by);
        END IF;
    ELSIF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
        NEW.confirmed_by := CASE WHEN NEW.confirmed_at IS NULL THEN NULL ELSE auth.uid() END;
    END IF;
    IF NEW.source_file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.meter_files f WHERE f.id = NEW.source_file_id AND f.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.meter_register: source file belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER meter_register_bind BEFORE INSERT OR UPDATE ON solar.meter_register
    FOR EACH ROW EXECUTE FUNCTION solar.meter_register_bind();

CREATE TABLE IF NOT EXISTS solar.meter_import_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    file_id          UUID NOT NULL REFERENCES solar.meter_files(id) ON DELETE CASCADE,
    parser_version   TEXT NOT NULL,
    options          JSONB NOT NULL DEFAULT '{}'::jsonb,
    report           JSONB NOT NULL,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_by      UUID REFERENCES auth.users(id),
    accepted_at      TIMESTAMPTZ,
    CONSTRAINT meter_import_reports_accept_pair CHECK ((accepted_by IS NULL) = (accepted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS meter_import_reports_file_idx ON solar.meter_import_reports (file_id, created_at DESC);

CREATE OR REPLACE FUNCTION solar.meter_import_reports_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.file_id <> OLD.file_id OR NEW.report <> OLD.report OR NEW.options <> OLD.options THEN
            RAISE EXCEPTION 'solar.meter_import_reports: a report is immutable; only acceptance may be recorded' USING ERRCODE = '42501';
        END IF;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
            NEW.accepted_by := COALESCE(auth.uid(), NEW.accepted_by);
            NEW.accepted_at := NOW();
        ELSE
            NEW.accepted_by := OLD.accepted_by;
            NEW.accepted_at := OLD.accepted_at;
        END IF;
        RETURN NEW;
    END IF;
    SELECT organisation_id INTO NEW.organisation_id FROM solar.meter_files WHERE id = NEW.file_id;
    IF NEW.organisation_id IS NULL THEN
        RAISE EXCEPTION 'solar.meter_import_reports: file % not found', NEW.file_id USING ERRCODE = '23503';
    END IF;
    IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
        NEW.created_at := NOW();
    END IF;
    NEW.accepted_by := NULL;
    NEW.accepted_at := NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER meter_import_reports_bind BEFORE INSERT OR UPDATE ON solar.meter_import_reports
    FOR EACH ROW EXECUTE FUNCTION solar.meter_import_reports_bind();

-- ── 7. Study-scoped tables ───────────────────────────────────────────────────
-- One bind for all three: project and org come from the study; the study is immutable.
CREATE OR REPLACE FUNCTION solar.study_scoped_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.study_id <> OLD.study_id THEN
        RAISE EXCEPTION '%: study_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id FROM solar.studies s WHERE s.id = NEW.study_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION '%: study % not found', TG_TABLE_NAME, NEW.study_id USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS solar.study_meters (
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    added_by         UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (study_id, meter_id)
);
CREATE TRIGGER study_meters_bind BEFORE INSERT ON solar.study_meters
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

CREATE TABLE IF NOT EXISTS solar.tenant_load_basis (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id               UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id             UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id        UUID NOT NULL REFERENCES public.organisations(id),
    node_id                UUID NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    source                 TEXT NOT NULL CHECK (source IN ('metered', 'synthesised', 'excluded')),
    meters                 JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(meters) = 'array'),
    archetype              TEXT CHECK (archetype IN ('retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant')),
    density_override_w_m2  NUMERIC(8,2) CHECK (density_override_w_m2 > 0),
    updated_by             UUID REFERENCES auth.users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tenant_load_basis_node_key UNIQUE (study_id, node_id),
    CONSTRAINT tenant_load_basis_metered_has_meters CHECK (source <> 'metered' OR jsonb_array_length(meters) > 0)
);
CREATE TRIGGER tenant_load_basis_bind BEFORE INSERT OR UPDATE ON solar.tenant_load_basis
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

-- Runs after the bind (trigger names sort: _bind < _check). The node is on the study's project;
-- every meters[] element is {meter_id: <a meter of the same org>, weight: > 0}.
CREATE OR REPLACE FUNCTION solar.tenant_load_basis_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_el    JSONB;
    v_meter UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = NEW.node_id AND n.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'solar.tenant_load_basis: node belongs to another project' USING ERRCODE = '23514';
    END IF;
    FOR v_el IN SELECT value FROM jsonb_array_elements(NEW.meters) LOOP
        v_meter := solar.try_uuid(v_el ->> 'meter_id');
        IF v_meter IS NULL OR NOT EXISTS (SELECT 1 FROM solar.meters m WHERE m.id = v_meter AND m.organisation_id = NEW.organisation_id) THEN
            RAISE EXCEPTION 'solar.tenant_load_basis: meter % is not in this organisation', v_el ->> 'meter_id' USING ERRCODE = '23514';
        END IF;
        IF jsonb_typeof(v_el -> 'weight') IS DISTINCT FROM 'number' OR (v_el ->> 'weight')::numeric <= 0 THEN
            RAISE EXCEPTION 'solar.tenant_load_basis: every meter weight must be a number > 0' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER tenant_load_basis_check BEFORE INSERT OR UPDATE ON solar.tenant_load_basis
    FOR EACH ROW EXECUTE FUNCTION solar.tenant_load_basis_check();

CREATE TABLE IF NOT EXISTS solar.site_load (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    basis            TEXT NOT NULL CHECK (basis IN ('S1', 'S2', 'S3', 'S4')),
    reference_year   INTEGER NOT NULL CHECK (reference_year BETWEEN 2000 AND 2100),
    series           REAL[] NOT NULL,
    md_monthly       JSONB NOT NULL DEFAULT '[]'::jsonb,
    coverage         JSONB NOT NULL DEFAULT '{}'::jsonb,
    inputs_hash      TEXT NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
    engine_version   TEXT NOT NULL,
    built_by         UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    built_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT site_load_series_8760 CHECK (cardinality(series) = 8760),
    CONSTRAINT site_load_key UNIQUE (study_id, basis, reference_year)
);
CREATE TRIGGER site_load_bind BEFORE INSERT OR UPDATE ON solar.site_load
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

-- study_meters: the meter must be in the study's organisation. A trigger (not a CHECK) because it
-- reads another table; named to run after study_meters_bind.
CREATE OR REPLACE FUNCTION solar.study_meters_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM solar.meters m WHERE m.id = NEW.meter_id AND m.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.study_meters: the meter belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    NEW.added_by := COALESCE(auth.uid(), NEW.added_by);
    NEW.added_at := NOW();
    RETURN NEW;
END $$;
CREATE TRIGGER study_meters_check BEFORE INSERT ON solar.study_meters
    FOR EACH ROW EXECUTE FUNCTION solar.study_meters_check();

-- ── 8. Load archetypes (platform data; == LOAD_ARCHETYPES in @esite/shared) ─
CREATE TABLE IF NOT EXISTS solar.load_archetypes (
    code        TEXT NOT NULL CHECK (code IN ('retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant')),
    version     INTEGER NOT NULL CHECK (version > 0),
    name        TEXT NOT NULL,
    profiles    JSONB NOT NULL,
    operating   JSONB NOT NULL,
    seasonal    JSONB NOT NULL CHECK (jsonb_array_length(seasonal) = 12),
    is_current  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS load_archetypes_one_current ON solar.load_archetypes (code) WHERE is_current;

INSERT INTO solar.load_archetypes (code, version, name, profiles, operating, seasonal) VALUES
    ('retail', 1, 'Retail (09:00-18:00 Mon-Sat)',
     '{"weekday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.5,1,1,1,1,1,1,1,1,1,0.5,0.15,0.15,0.15,0.15,0.15],"saturday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.5,1,1,1,1,1,1,1,1,1,0.5,0.15,0.15,0.15,0.15,0.15],"sunday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15],"holiday":[0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15,0.15]}'::jsonb,
     '{"weekday":[9,18],"saturday":[9,18],"sunday":null,"holiday":null}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('fast_food', 1, 'Fast food (07:00-22:00 daily)',
     '{"weekday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"saturday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"sunday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"holiday":[0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2]}'::jsonb,
     '{"weekday":[7,22],"saturday":[7,22],"sunday":[7,22],"holiday":[7,22]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('restaurant', 1, 'Restaurant (11:00-22:00 daily)',
     '{"weekday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"saturday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"sunday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2],"holiday":[0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.2]}'::jsonb,
     '{"weekday":[11,22],"saturday":[11,22],"sunday":[11,22],"holiday":[11,22]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('supermarket', 1, 'Supermarket (refrigeration base 35 %)',
     '{"weekday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35],"saturday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35],"sunday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35,0.35,0.35,0.35],"holiday":[0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.5,1,1,1,1,1,1,1,1,1,0.5,0.35,0.35,0.35,0.35,0.35,0.35]}'::jsonb,
     '{"weekday":[8,20],"saturday":[8,20],"sunday":[8,17],"holiday":[8,17]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('office_bank', 1, 'Office / bank (07:00-18:00 Mon-Fri)',
     '{"weekday":[0.1,0.1,0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1,0.1,0.1,0.1],"saturday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1],"sunday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1],"holiday":[0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1]}'::jsonb,
     '{"weekday":[7,18],"saturday":null,"sunday":null,"holiday":null}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('gym', 1, 'Gym (05:00-21:00 daily)',
     '{"weekday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"saturday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"sunday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1],"holiday":[0.1,0.1,0.1,0.1,0.5,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0.5,0.1,0.1]}'::jsonb,
     '{"weekday":[5,21],"saturday":[5,21],"sunday":[5,21],"holiday":[5,21]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('anchor_24h', 1, 'Anchor (24 h base 60 %, trading 08:00-21:00)',
     '{"weekday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"saturday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"sunday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6],"holiday":[0.6,0.6,0.6,0.6,0.6,0.6,0.6,0.8,1,1,1,1,1,1,1,1,1,1,1,1,1,0.8,0.6,0.6]}'::jsonb,
     '{"weekday":[8,21],"saturday":[8,21],"sunday":[8,21],"holiday":[8,21]}'::jsonb,
     '[1.1,1.1,1.05,1,0.95,0.95,0.95,0.95,1,1,1.05,1.1]'::jsonb),
    ('vacant', 1, 'Vacant (no load)',
     '{"weekday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"saturday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"sunday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"holiday":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb,
     '{"weekday":null,"saturday":null,"sunday":null,"holiday":null}'::jsonb,
     '[1,1,1,1,1,1,1,1,1,1,1,1]'::jsonb)
ON CONFLICT (code, version) DO NOTHING;

-- ── 9. Function privileges (spelled out: the anon-EXECUTE guard reads this text) ─
REVOKE ALL ON FUNCTION solar.try_uuid(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.try_uuid(text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.try_uuid(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.library_orgs(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.library_orgs(text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.library_orgs(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.raw_path_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.raw_path_allowed(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION solar.raw_path_allowed(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) FROM anon;
GRANT EXECUTE ON FUNCTION solar.write_readings(uuid, timestamptz[], double precision[], smallint[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.meter_files_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_files_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meters_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meters_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_channels_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_channels_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_series_hashes_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_series_hashes_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_register_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_register_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.meter_import_reports_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.meter_import_reports_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.study_scoped_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.study_scoped_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.tenant_load_basis_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.tenant_load_basis_check() FROM anon;
REVOKE ALL ON FUNCTION solar.study_meters_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.study_meters_check() FROM anon;

-- ── 10. Row level security ───────────────────────────────────────────────────
ALTER TABLE solar.meter_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_files FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meters FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_series_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_series_hashes FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_register FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_import_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_import_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p0 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p0 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p1 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p2 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p3 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p4 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p5 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p5 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p6 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p6 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p7 ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.meter_readings_p7 FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.study_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.study_meters FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.tenant_load_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tenant_load_basis FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.site_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.site_load FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.load_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.load_archetypes FORCE ROW LEVEL SECURITY;

-- Library tables. V = view set, E = edit set, A = owner/admin set; each (SELECT …) is an InitPlan.
CREATE POLICY meter_files_select ON solar.meter_files FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_files_insert ON solar.meter_files FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_files_update ON solar.meter_files FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_files_delete ON solar.meter_files FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_files_insert_authz ON solar.meter_files AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))) AND public.solar_can_edit(project_id));
CREATE POLICY meter_files_update_authz ON solar.meter_files AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_files_delete_authz ON solar.meter_files AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))));

CREATE POLICY meters_select ON solar.meters FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meters_insert ON solar.meters FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meters_update ON solar.meters FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meters_delete ON solar.meters FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meters_insert_authz ON solar.meters AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meters_update_authz ON solar.meters AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meters_delete_authz ON solar.meters AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))));

CREATE POLICY meter_series_hashes_select ON solar.meter_series_hashes FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_series_hashes_insert ON solar.meter_series_hashes FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_series_hashes_delete ON solar.meter_series_hashes FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_series_hashes_insert_authz ON solar.meter_series_hashes AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_series_hashes_delete_authz ON solar.meter_series_hashes AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));

CREATE POLICY meter_register_select ON solar.meter_register FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_register_insert ON solar.meter_register FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_register_update ON solar.meter_register FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_register_delete ON solar.meter_register FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_register_insert_authz ON solar.meter_register AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_register_update_authz ON solar.meter_register AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_register_delete_authz ON solar.meter_register AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))));

CREATE POLICY meter_channels_select ON solar.meter_channels FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_channels_insert ON solar.meter_channels FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_channels_update ON solar.meter_channels FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_channels_delete ON solar.meter_channels FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_channels_insert_authz ON solar.meter_channels AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_channels_update_authz ON solar.meter_channels AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_channels_delete_authz ON solar.meter_channels AS RESTRICTIVE FOR DELETE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));

CREATE POLICY meter_import_reports_select ON solar.meter_import_reports FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_import_reports_insert ON solar.meter_import_reports FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_import_reports_update ON solar.meter_import_reports FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))));
CREATE POLICY meter_import_reports_insert_authz ON solar.meter_import_reports AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));
CREATE POLICY meter_import_reports_update_authz ON solar.meter_import_reports AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('edit'))))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('edit'))));

-- Readings: read-only for users; writes go through solar.write_readings.
CREATE POLICY meter_readings_select ON solar.meter_readings FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))));

-- Study-scoped tables: the solar.studies (00208) shape.
CREATE POLICY study_meters_select ON solar.study_meters FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY study_meters_insert ON solar.study_meters FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY study_meters_delete ON solar.study_meters FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY study_meters_insert_authz ON solar.study_meters AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY study_meters_delete_authz ON solar.study_meters AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY tenant_load_basis_select ON solar.tenant_load_basis FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY tenant_load_basis_insert ON solar.tenant_load_basis FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_update ON solar.tenant_load_basis FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_delete ON solar.tenant_load_basis FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY tenant_load_basis_insert_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY tenant_load_basis_update_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY tenant_load_basis_delete_authz ON solar.tenant_load_basis AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY site_load_select ON solar.site_load FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY site_load_insert ON solar.site_load FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY site_load_update ON solar.site_load FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY site_load_delete ON solar.site_load FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY site_load_insert_authz ON solar.site_load AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY site_load_update_authz ON solar.site_load AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY site_load_delete_authz ON solar.site_load AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- Platform shapes: generic, not customer data; readable by any signed-in user, written by migrations.
CREATE POLICY load_archetypes_select ON solar.load_archetypes FOR SELECT TO authenticated USING (true);

-- ── 11. Storage: private raw-file bucket; read + insert only (raw files are never changed) ─
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('solar-meter-raw', 'solar-meter-raw', false, 52428800,
        ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY solar_meter_raw_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'solar-meter-raw' AND solar.raw_path_allowed(name, 'view'));
CREATE POLICY solar_meter_raw_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'solar-meter-raw' AND solar.raw_path_allowed(name, 'edit'));

-- ── 12. Table privileges (default privileges from 00208 granted too much to new tables) ─
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.meter_files, solar.meters, solar.meter_register, solar.meter_channels,
    solar.tenant_load_basis, solar.site_load TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.meter_series_hashes, solar.study_meters TO authenticated;
REVOKE UPDATE, TRUNCATE ON solar.meter_series_hashes, solar.study_meters FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.meter_import_reports TO authenticated;
REVOKE DELETE, TRUNCATE ON solar.meter_import_reports FROM authenticated;
GRANT SELECT ON solar.meter_readings, solar.load_archetypes TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON solar.meter_readings, solar.load_archetypes FROM authenticated;
REVOKE ALL ON solar.meter_readings_p0, solar.meter_readings_p1, solar.meter_readings_p2, solar.meter_readings_p3,
    solar.meter_readings_p4, solar.meter_readings_p5, solar.meter_readings_p6, solar.meter_readings_p7 FROM authenticated, anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA solar TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA solar TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA solar TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA solar FROM anon;

NOTIFY pgrst, 'reload schema';
```

Two things in this file are there because of a trap, not taste:
- Trigger order on `tenant_load_basis` and `study_meters`: Postgres fires BEFORE triggers of the same event in **name order**, so `…_bind` (sets `project_id`/`organisation_id`) runs before `…_check` (reads them). Renaming either breaks the check silently (it would see NULLs and reject every row).
- `UNIQUE NULLS NOT DISTINCT` on `meter_channels` (Postgres 15+): a channel whose file row was deleted (`file_id` set NULL) must still collide with a re-import of the same column.

- [ ] **Step 2: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql
git commit -m "$(cat <<'EOF'
feat(solar): 00211 meter data — library tables, partitioned readings, study load tables, archetypes, raw bucket

Number claimed at apply time. Not applied.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Archetype seed contract test

**Files:**
- Create: `packages/shared/src/services/solar/load/archetype-seed.contract.test.ts`

The migration seed and `LOAD_ARCHETYPES` must never drift; the migration is text, so the test reads the text (the file is found by suffix, so a renumber does not break it).

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOAD_ARCHETYPES } from './archetypes'

const DIR = join(__dirname, '../../../../../../apps/edge-functions/supabase/migrations')

function seedRows(): Array<{ code: string; version: number; name: string; profiles: unknown; operating: unknown; seasonal: unknown }> {
  const file = readdirSync(DIR).find((f) => f.endsWith('_solar_meter_data.sql'))
  if (!file) throw new Error('solar meter data migration not found')
  const sql = readFileSync(join(DIR, file), 'utf8')
  const re = /\('([a-z_0-9]+)', (\d+), '([^']*)',\s*'([^']*)'::jsonb,\s*'([^']*)'::jsonb,\s*'([^']*)'::jsonb\)/g
  const out = []
  for (const m of sql.matchAll(re)) {
    out.push({ code: m[1], version: Number(m[2]), name: m[3], profiles: JSON.parse(m[4]), operating: JSON.parse(m[5]), seasonal: JSON.parse(m[6]) })
  }
  return out
}

describe('solar.load_archetypes seed == LOAD_ARCHETYPES', () => {
  it('same codes, versions, names, profiles, operating hours and seasonal multipliers', () => {
    const rows = seedRows()
    expect(rows).toHaveLength(LOAD_ARCHETYPES.length)
    for (const a of LOAD_ARCHETYPES) {
      const r = rows.find((x) => x.code === a.code)
      expect(r, a.code).toBeDefined()
      expect(r).toEqual({
        code: a.code, version: a.version, name: a.name,
        profiles: { weekday: [...a.profiles.weekday], saturday: [...a.profiles.saturday], sunday: [...a.profiles.sunday], holiday: [...a.profiles.holiday] },
        operating: {
          weekday: a.operating.weekday ? [...a.operating.weekday] : null, saturday: a.operating.saturday ? [...a.operating.saturday] : null,
          sunday: a.operating.sunday ? [...a.operating.sunday] : null, holiday: a.operating.holiday ? [...a.operating.holiday] : null,
        },
        seasonal: [...a.seasonal],
      })
    }
  })
})
```

- [ ] **Step 2: Run it, then prove it can fail**

Run: `pnpm --filter @esite/shared test -- archetype-seed`
Expected: PASS. Then change one `0.35` to `0.36` in the supermarket seed row of the migration, rerun: FAIL naming `supermarket`. Revert, rerun: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/services/solar/load/archetype-seed.contract.test.ts
git commit -m "$(cat <<'EOF'
test(solar): contract — load_archetypes seed equals LOAD_ARCHETYPES

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Prove the migration red → green, with mutations

**Files:** none (temporary copies under `/tmp`).

- [ ] **Step 1: Build the file to dry-run**

If Task 1 showed `00208` in the ledger:
```bash
cp apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql /tmp/mig-3a.sql
```
Otherwise (00208 not applied yet):
```bash
cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql > /tmp/mig-3a.sql
```

- [ ] **Step 2: GREEN**

Run: `scripts/db/dry-run-migration.sh /tmp/mig-3a.sql scripts/db/assert-solar-meter-data-roles.sql`
Expected: every row `✓` (45 checks), zero failures. If one fails, fix the migration, not the assertion, unless the assertion is provably wrong (then say why in the commit).

- [ ] **Step 3: Mutation 1 — a missing restrictive gate lets a viewer write**

```bash
sed 's/^CREATE POLICY meters_insert_authz .*$/-- mutated/;/-- mutated/{n;d;}' /tmp/mig-3a.sql > /tmp/mut1.sql
scripts/db/dry-run-migration.sh /tmp/mut1.sql scripts/db/assert-solar-meter-data-roles.sql
```
Expected: `viewer_create_meter_REFUSED` ✗ (and nothing else newly red).

- [ ] **Step 4: Mutation 2 — partitions keep their default grants**

```bash
grep -v '^REVOKE ALL ON solar.meter_readings_p0' /tmp/mig-3a.sql | grep -v '^    solar.meter_readings_p4, solar.meter_readings_p5' > /tmp/mut2.sql
scripts/db/dry-run-migration.sh /tmp/mut2.sql scripts/db/assert-solar-meter-data-roles.sql
```
Expected: the file aborts or `partition_direct_read_REFUSED` ✗. (Either proves the check watches the grant.)

- [ ] **Step 5: Mutation 3 — library helper ignores the subscription**

```bash
sed 's/       AND solar.org_subscription_active(uo.organisation_id)$/       AND true/' /tmp/mig-3a.sql > /tmp/mut3.sql
scripts/db/dry-run-migration.sh /tmp/mut3.sql scripts/db/assert-solar-meter-data-roles.sql
```
Expected: `lapsed_admin_reads_nothing` ✗. (`lapsed_write_readings_REFUSED` stays ✓: the contractor reaches the library through the grant arm, which `public.solar_access_level` still guards with the subscription. That the two arms are guarded independently is what this mutation shows.)

- [ ] **Step 6: Record the evidence**

Keep the three mutation outputs; they go in the PR body (Task 13). No commit.

---

### Task 6: D-23 volume test (≥ 2 M readings, rolled back) and the storage decision

**Files:**
- Create: `scripts/db/solar-readings-volume-test.sql`
- Modify: `docs/solar/06-open-decisions.md` (the D-23 row)
- Modify: `docs/solar/03-data-model-and-security.md` (§1 readings paragraph, §3 rows)

- [ ] **Step 1: Write the volume test (harness-compatible: ends in a `(check, ok)` SELECT)**

```sql
-- D-23 volume test for solar.meter_readings: 120 channels x 17,520 half-hours = 2,102,400 rows
-- (a 40-tenant mall with three channels each, one year), inserted and measured INSIDE the dry-run
-- transaction, then rolled back. The check text carries the measurement; ok = within the D-23 limit.
--   scripts/db/dry-run-migration.sh /tmp/mig-3a.sql scripts/db/solar-readings-volume-test.sql
-- Switch criterion (docs/solar/06 D-23): move readings to compressed files in Storage + hourly
-- aggregates in Postgres if ANY of: one channel-year read under RLS > 500 ms; write_readings < 10,000
-- rows/s; or the projected table size for the expected corpus exceeds 25 % of the database plan.
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated;

DO $$
DECLARE
  v_org   UUID := gen_random_uuid();
  v_p     UUID := gen_random_uuid();
  v_admin UUID := gen_random_uuid();
  v_meter UUID;
  v_ch    UUID;
  v_chs   UUID[] := '{}';
  v_w     UUID;
  t0      TIMESTAMPTZ;
  v_ms    NUMERIC;
  v_n     BIGINT;
  v_bytes BIGINT;
  i       INT;
  k       INT;
BEGIN
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-volume-probe');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'solar-volume-' || v_admin || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_admin, v_org, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_p, v_org, 'solar-volume-probe', v_admin);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '30 days');

  FOR i IN 1..121 LOOP
    INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'volume-' || i) RETURNING id INTO v_meter;
    INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit, interval_min, tz_convention, parser_version)
    VALUES (v_meter, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'begin', 'volume-test') RETURNING id INTO v_ch;
    IF i <= 120 THEN v_chs := v_chs || v_ch; ELSE v_w := v_ch; END IF;
  END LOOP;

  -- 1. Bulk insert (the floor: the fastest path Postgres has)
  t0 := clock_timestamp();
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT c, v_org, timestamptz '2025-01-01 00:30+02' + s * interval '30 minutes', 100 + (s % 48), 0
    FROM unnest(v_chs) AS c, generate_series(0, 17519) AS s;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  SELECT count(*) INTO v_n FROM solar.meter_readings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES (format('bulk_insert_%s_rows_ms=%s', v_n, round(v_ms)), v_n >= 2000000);

  -- 2. The commit route's path: write_readings as the org admin, 4 calls of <= 5,000
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  t0 := clock_timestamp();
  FOR k IN 0..3 LOOP
    PERFORM solar.write_readings(v_w,
      ARRAY(SELECT timestamptz '2025-01-01 00:30+02' + s * interval '30 minutes' FROM generate_series(k * 5000, least(k * 5000 + 4999, 17519)) s),
      ARRAY(SELECT (100 + s % 48)::float8 FROM generate_series(k * 5000, least(k * 5000 + 4999, 17519)) s),
      ARRAY(SELECT 0::smallint FROM generate_series(k * 5000, least(k * 5000 + 4999, 17519)) s));
  END LOOP;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('write_readings_17520_rows_ms=%s_rows_per_s=%s', round(v_ms), round(17520 / greatest(v_ms, 1) * 1000)), 17520 / greatest(v_ms, 1) * 1000 >= 10000);

  -- 3. Read one channel-year under RLS (what a chart or the load builder does)
  t0 := clock_timestamp();
  SELECT count(*) INTO v_n FROM (SELECT ts_end, value FROM solar.meter_readings WHERE channel_id = v_chs[1] ORDER BY ts_end) x;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_read_one_channel_year_%s_rows_ms=%s', v_n, round(v_ms, 1)), v_n = 17520 AND v_ms < 500);

  -- 4. Hourly aggregate of one channel under RLS
  t0 := clock_timestamp();
  PERFORM count(*) FROM (SELECT date_trunc('hour', ts_end - interval '30 minutes'), avg(value) FROM solar.meter_readings WHERE channel_id = v_chs[1] GROUP BY 1) h;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_hourly_aggregate_one_channel_ms=%s', round(v_ms, 1)), v_ms < 1000);

  -- 5. Whole-site monthly energy across all 120 channels under RLS
  t0 := clock_timestamp();
  PERFORM count(*) FROM (SELECT date_trunc('month', ts_end AT TIME ZONE 'Africa/Johannesburg'), sum(value) * 0.5 FROM solar.meter_readings WHERE organisation_id = v_org GROUP BY 1) m;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_site_monthly_energy_120_channels_ms=%s', round(v_ms)), v_ms < 10000);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- 6. Size on disk (heap + indexes + TOAST of all partitions) and bytes per reading
  SELECT sum(pg_total_relation_size(i.inhrelid)) INTO v_bytes FROM pg_inherits i WHERE i.inhparent = 'solar.meter_readings'::regclass;
  INSERT INTO _r VALUES (format('partitions_total_bytes=%s_bytes_per_row=%s', v_bytes, round(v_bytes::numeric / 2120000, 1)), true);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it (owner OK first if against production)**

This writes ~2.1 M rows inside a transaction that is rolled back: no residue, but real WAL and I/O on the production database for the duration. Ask the owner before running it there. Preferred when Docker is available: a local stack (`cd apps/edge-functions && supabase start && supabase db reset`, then run the same SQL with `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f scripts/db/solar-readings-volume-test.sql` after `BEGIN;` and followed by `ROLLBACK;`). Production (with the owner's yes):

```bash
scripts/db/dry-run-migration.sh /tmp/mig-3a.sql scripts/db/solar-readings-volume-test.sql
```
Expected: six rows; the check texts carry the measurements. If the Management API times out, the run did not finish: use the local stack.

- [ ] **Step 3: Record the result and the decision**

In `docs/solar/06-open-decisions.md`, replace the D-23 row's last cell (`Default partitioned Postgres table; switch to compressed files + aggregates only if it underperforms at ≥ 2 M rows`) with the measured outcome, for example (use the real numbers from Step 2 and the real environment):

```
Measured <YYYY-MM-DD> on <production dry run | local>: 2,102,400 rows bulk-inserted in <n> ms; write_readings <n> rows/s; one channel-year read under RLS <n> ms; hourly aggregate <n> ms; site monthly energy (120 channels) <n> ms; <n> bytes/row. **Decision: keep the partitioned table** (all under the limits) / **switch** (name the limit that failed). Switch criterion: RLS channel-year read > 500 ms, or write_readings < 10,000 rows/s, or projected size > 25 % of the DB plan.
```

In `docs/solar/03-data-model-and-security.md` §1, replace the sentence that begins `Large meter readings volume` with:

```
Meter readings live in `solar.meter_readings` (double precision, quality smallint), hash-partitioned by
`channel_id` into 8 partitions, `organisation_id` denormalised on each row for one-comparison RLS, written
only through `solar.write_readings` (upsert on the PK). D-23 volume test result: see `06-open-decisions.md`.
```

and in §3's table replace the `meter_readings` row's notes with `Hash-partitioned × 8 on channel_id; written only via solar.write_readings; upsert on PK ⇒ re-import is idempotent`, the `load_archetypes` row's key columns with `code, version, name, profiles jsonb (24 h × weekday/saturday/sunday/holiday), operating jsonb, seasonal jsonb (12), is_current` and its notes with `Platform data; expanded to 8,760 per reference year (a fixed 8,760 cannot follow a year's weekdays and holidays)`, and add `project_id (upload route), body_sha256, source_serials, ts_convention, row_order, skip_reason` to the `meter_files` row.

- [ ] **Step 4: Commit**

```bash
git add scripts/db/solar-readings-volume-test.sql docs/solar/06-open-decisions.md docs/solar/03-data-model-and-security.md
git commit -m "$(cat <<'EOF'
test(solar): D-23 volume test (2.1 M readings, rolled back) and the recorded storage decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `requireSolarLevelAPI`

**Files:**
- Create: `apps/web/src/lib/solar/api-gate.ts`
- Test: `apps/web/src/lib/solar/api-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { levelMock } = vi.hoisted(() => ({ levelMock: vi.fn() }))
vi.mock('./access', () => ({ getSolarAccessLevel: (...a: unknown[]) => levelMock(...a) }))

import { requireSolarLevelAPI } from './api-gate'

const client = (user: { id: string } | null) => ({ auth: { getUser: async () => ({ data: { user } }) } }) as never
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'

beforeEach(() => levelMock.mockReset())

describe('requireSolarLevelAPI', () => {
  it('401 without a user (and never asks for the level)', async () => {
    const g = await requireSolarLevelAPI(client(null), P, 'edit')
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(401)
    expect(levelMock).not.toHaveBeenCalled()
  })
  it('403 when the level is below the need', async () => {
    levelMock.mockResolvedValue('view')
    const g = await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.response.status).toBe(403)
      expect(await g.response.json()).toEqual({ error: 'Solar access required', need: 'edit' })
    }
  })
  it('403 when there is no access at all', async () => {
    levelMock.mockResolvedValue(null)
    expect((await requireSolarLevelAPI(client({ id: 'u1' }), P, 'view')).ok).toBe(false)
  })
  it('passes edit and edit_financials for an edit need', async () => {
    levelMock.mockResolvedValue('edit')
    expect(await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')).toEqual({ ok: true, level: 'edit', userId: 'u1' })
    levelMock.mockResolvedValue('edit_financials')
    expect((await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- lib/solar/api-gate`
Expected: FAIL — cannot resolve `./api-gate`.

- [ ] **Step 3: Implement**

```ts
/**
 * Route-handler twin of requireSolarLevel (access.ts). A redirect() from an API route becomes a
 * 307 the browser's fetch cannot act on, so API routes get JSON 401/403 instead. The level comes
 * from the same SQL helper the RLS policies use (public.solar_access_level).
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { solarLevelAllows, type SolarAccessLevel } from '@esite/shared'
import { getSolarAccessLevel } from './access'

type AnyClient = SupabaseClient<any, any, any>

export type SolarApiGate =
  | { ok: true; level: SolarAccessLevel; userId: string }
  | { ok: false; response: NextResponse }

export async function requireSolarLevelAPI(supabase: AnyClient, projectId: string, need: SolarAccessLevel): Promise<SolarApiGate> {
  const { data } = await supabase.auth.getUser()
  const user = data?.user ?? null
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, need)) {
    return { ok: false, response: NextResponse.json({ error: 'Solar access required', need }, { status: 403 }) }
  }
  return { ok: true, level: level as SolarAccessLevel, userId: user.id }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- lib/solar/api-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/api-gate.ts apps/web/src/lib/solar/api-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): requireSolarLevelAPI — JSON 401/403 gate for Solar API routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Repository (the only Supabase code in the pipeline) and its fake

**Files:**
- Create: `apps/web/src/lib/solar/meter-import/repo.ts`
- Create: `apps/web/src/lib/solar/meter-import/fake-repo.ts`
- Test: `apps/web/src/lib/solar/meter-import/repo.test.ts`

- [ ] **Step 1: Write the failing test (the parts with logic: chunk RPC shape, count, storage download cap)**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createMeterImportRepo, MAX_METER_FILE_BYTES } from './repo'

function client(overrides: Record<string, unknown> = {}) {
  const rpc = vi.fn(async () => ({ data: 3, error: null }))
  const head = { count: 17520, error: null }
  const from = vi.fn(() => ({
    select: () => ({ eq: () => Promise.resolve(head) }),
  }))
  const download = vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }))
  return {
    schema: vi.fn(() => ({ rpc, from })),
    storage: { from: vi.fn(() => ({ download })) },
    rpc, from, download,
    ...overrides,
  }
}

describe('createMeterImportRepo', () => {
  it('writeReadings calls solar.write_readings with parallel arrays', async () => {
    const c = client()
    const repo = createMeterImportRepo(c as never)
    const n = await repo.writeReadings('ch1', { ts: ['2025-03-09T22:30:00.000Z'], value: [1.5], quality: [0] })
    expect(n).toBe(3)
    expect(c.schema).toHaveBeenCalledWith('solar')
    expect(c.rpc).toHaveBeenCalledWith('write_readings', { p_channel_id: 'ch1', p_ts_end: ['2025-03-09T22:30:00.000Z'], p_value: [1.5], p_quality: [0] })
  })
  it('countReadings uses an exact head count', async () => {
    expect(await createMeterImportRepo(client() as never).countReadings('ch1')).toBe(17520)
  })
  it('downloadRaw returns bytes and refuses anything over 50 MB', async () => {
    const c = client()
    expect([...(await createMeterImportRepo(c as never).downloadRaw('o/p/x.csv'))!]).toEqual([1, 2, 3])
    const big = client()
    big.download.mockResolvedValue({ data: { size: MAX_METER_FILE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob, error: null })
    await expect(createMeterImportRepo(big as never).downloadRaw('o/p/x.csv')).rejects.toThrow(/50 MB/)
  })
  it('downloadRaw returns null when the object is missing', async () => {
    const c = client()
    c.download.mockResolvedValue({ data: null, error: { message: 'Object not found' } } as never)
    expect(await createMeterImportRepo(c as never).downloadRaw('o/p/x.csv')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- meter-import/repo`
Expected: FAIL — cannot resolve `./repo`.

- [ ] **Step 3: Implement `repo.ts`**

```ts
/**
 * The meter-import pipeline's only Supabase code. It uses the CALLER's client, so every read and
 * write goes through RLS (the service key is never used here). Everything else in the pipeline is
 * pure and is tested against the in-memory fake (fake-repo.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

export const METER_RAW_BUCKET = 'solar-meter-raw'
export const MAX_METER_FILE_BYTES = 50 * 1024 * 1024

export type MeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export type AreaSource = 'register_exact' | 'register_llm' | 'filename' | 'manual'

export interface MeterFileRow {
  id: string
  organisation_id: string
  project_id: string
  sha256: string
  size_bytes: number
  storage_path: string
  original_name: string
  status: 'uploaded' | 'parsed' | 'accepted' | 'skipped' | 'failed'
}
export interface MeterRow {
  id: string
  organisation_id: string
  label: string
  site_label: string | null
  serials: string[]
  kind: MeterKind
}
export interface NewMeter {
  organisation_id: string
  label: string
  site_label: string | null
  serials: string[]
  shop_no: string | null
  area_m2: number | null
  area_source: AreaSource | null
  kind: MeterKind
  node_id: string | null
}
export interface ChannelRow {
  meter_id: string
  file_id: string
  source_column: string
  quantity: string
  direction: string
  phase: string | null
  source_unit: string
  unit: string
  interval_min: number
  is_cumulative: boolean
  tz_convention: 'begin' | 'end'
  is_primary: boolean
  coverage_only: boolean
  parser_version: string
}
export interface RegisterHint {
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: string
  fileName: string | null
}

export interface MeterImportRepo {
  projectOrg(projectId: string): Promise<string | null>
  studyId(projectId: string): Promise<string | null>
  downloadRaw(storagePath: string): Promise<Uint8Array | null>
  fileBySha(orgId: string, sha256: string): Promise<MeterFileRow | null>
  insertFile(row: { project_id: string; organisation_id: string; sha256: string; size_bytes: number; storage_path: string; original_name: string }): Promise<MeterFileRow>
  getFile(fileId: string): Promise<MeterFileRow | null>
  updateFile(fileId: string, patch: Record<string, unknown>): Promise<void>
  seriesByBodyHash(orgId: string, bodyHash: string): Promise<Array<{ meterId: string; fileId: string; label: string; siteLabel: string | null }>>
  metersBySerials(orgId: string, serials: string[]): Promise<MeterRow[]>
  registerBySerials(orgId: string, serials: string[]): Promise<Array<{ serial: string; mallName: string | null; tenantName: string | null }>>
  registerForFile(orgId: string, hints: { label: string | null; shopNo: string | null }): Promise<RegisterHint[]>
  insertReport(row: { file_id: string; parser_version: string; options: unknown; report: unknown }): Promise<string>
  acceptReport(reportId: string): Promise<void>
  getMeter(meterId: string): Promise<MeterRow | null>
  insertMeter(row: NewMeter): Promise<MeterRow>
  upsertChannel(row: ChannelRow): Promise<string>
  writeReadings(channelId: string, chunk: { ts: string[]; value: Array<number | null>; quality: number[] }): Promise<number>
  countReadings(channelId: string): Promise<number>
  insertSeriesHash(row: { organisation_id: string; body_hash: string; meter_id: string; file_id: string }): Promise<void>
  linkStudyMeter(studyId: string, meterId: string): Promise<void>
  insertRegisterRows(rows: Array<Record<string, unknown>>): Promise<number>
  audit(projectId: string, verb: string, objectRef: Record<string, unknown>): Promise<void>
}

const FILE_COLS = 'id, organisation_id, project_id, sha256, size_bytes, storage_path, original_name, status'
const METER_COLS = 'id, organisation_id, label, site_label, serials, kind'

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  if (r.data === null) throw new Error(`${what}: no row returned`)
  return r.data
}
const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function createMeterImportRepo(supabase: AnyClient): MeterImportRepo {
  const solar = () => supabase.schema('solar')
  return {
    async projectOrg(projectId) {
      const r = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', projectId).maybeSingle()
      return (r.data as { organisation_id: string } | null)?.organisation_id ?? null
    },
    async studyId(projectId) {
      const r = await solar().from('studies').select('id').eq('project_id', projectId).maybeSingle()
      return (r.data as { id: string } | null)?.id ?? null
    },
    async downloadRaw(storagePath) {
      const r = await supabase.storage.from(METER_RAW_BUCKET).download(storagePath)
      if (r.error || !r.data) return null
      if (r.data.size > MAX_METER_FILE_BYTES) throw new Error('meter file is larger than 50 MB')
      return new Uint8Array(await r.data.arrayBuffer())
    },
    async fileBySha(orgId, sha256) {
      const r = await solar().from('meter_files').select(FILE_COLS).eq('organisation_id', orgId).eq('sha256', sha256).maybeSingle()
      return (r.data as MeterFileRow | null) ?? null
    },
    async insertFile(row) {
      return must(await solar().from('meter_files').insert(row).select(FILE_COLS).single(), 'insert meter file') as MeterFileRow
    },
    async getFile(fileId) {
      const r = await solar().from('meter_files').select(FILE_COLS).eq('id', fileId).maybeSingle()
      return (r.data as MeterFileRow | null) ?? null
    },
    async updateFile(fileId, patch) {
      const r = await solar().from('meter_files').update(patch).eq('id', fileId)
      if (r.error) throw new Error(`update meter file: ${r.error.message}`)
    },
    async seriesByBodyHash(orgId, bodyHash) {
      const r = await solar().from('meter_series_hashes').select('meter_id, file_id, meters(label, site_label)').eq('organisation_id', orgId).eq('body_hash', bodyHash)
      if (r.error) throw new Error(`series hashes: ${r.error.message}`)
      return ((r.data ?? []) as Array<{ meter_id: string; file_id: string; meters: { label: string; site_label: string | null } | null }>).map((x) => ({
        meterId: x.meter_id, fileId: x.file_id, label: x.meters?.label ?? '(unknown meter)', siteLabel: x.meters?.site_label ?? null,
      }))
    },
    async metersBySerials(orgId, serials) {
      if (serials.length === 0) return []
      const r = await solar().from('meters').select(METER_COLS).eq('organisation_id', orgId).overlaps('serials', serials)
      if (r.error) throw new Error(`meters by serial: ${r.error.message}`)
      return (r.data ?? []) as MeterRow[]
    },
    async registerBySerials(orgId, serials) {
      if (serials.length === 0) return []
      const r = await solar().from('meter_register').select('serial, mall_name, tenant_name').eq('organisation_id', orgId).eq('kind', 'download_log').in('serial', serials)
      if (r.error) throw new Error(`register by serial: ${r.error.message}`)
      return ((r.data ?? []) as Array<{ serial: string; mall_name: string | null; tenant_name: string | null }>).map((x) => ({ serial: x.serial, mallName: x.mall_name, tenantName: x.tenant_name }))
    },
    async registerForFile(orgId, hints) {
      let q = solar().from('meter_register').select('tenant_name, shop_no, area_m2, match_method, file_name').eq('organisation_id', orgId).eq('kind', 'summary')
      if (hints.shopNo) q = q.eq('shop_no', hints.shopNo)
      else if (hints.label) q = q.ilike('tenant_name', like(hints.label))
      else return []
      const r = await q.limit(10)
      if (r.error) throw new Error(`register for file: ${r.error.message}`)
      return ((r.data ?? []) as Array<{ tenant_name: string | null; shop_no: string | null; area_m2: number | null; match_method: string; file_name: string | null }>).map((x) => ({
        tenantName: x.tenant_name, shopNo: x.shop_no, areaM2: x.area_m2 === null ? null : Number(x.area_m2), matchMethod: x.match_method, fileName: x.file_name,
      }))
    },
    async insertReport(row) {
      return (must(await solar().from('meter_import_reports').insert(row).select('id').single(), 'insert import report') as { id: string }).id
    },
    async acceptReport(reportId) {
      const r = await solar().from('meter_import_reports').update({ accepted_at: new Date().toISOString() }).eq('id', reportId)
      if (r.error) throw new Error(`accept report: ${r.error.message}`)
    },
    async getMeter(meterId) {
      const r = await solar().from('meters').select(METER_COLS).eq('id', meterId).maybeSingle()
      return (r.data as MeterRow | null) ?? null
    },
    async insertMeter(row) {
      return must(await solar().from('meters').insert(row).select(METER_COLS).single(), 'insert meter') as MeterRow
    },
    async upsertChannel(row) {
      const r = await solar().from('meter_channels').upsert(row, { onConflict: 'meter_id,file_id,source_column' }).select('id').single()
      return (must(r, 'upsert channel') as { id: string }).id
    },
    async writeReadings(channelId, chunk) {
      const r = await solar().rpc('write_readings', { p_channel_id: channelId, p_ts_end: chunk.ts, p_value: chunk.value, p_quality: chunk.quality })
      if (r.error) throw new Error(`write readings: ${r.error.message}`)
      return Number(r.data)
    },
    async countReadings(channelId) {
      const r = await solar().from('meter_readings').select('channel_id', { count: 'exact', head: true }).eq('channel_id', channelId)
      if (r.error) throw new Error(`count readings: ${r.error.message}`)
      return r.count ?? 0
    },
    async insertSeriesHash(row) {
      const r = await solar().from('meter_series_hashes').upsert(row, { onConflict: 'organisation_id,body_hash,file_id', ignoreDuplicates: true })
      if (r.error) throw new Error(`series hash: ${r.error.message}`)
    },
    async linkStudyMeter(studyId, meterId) {
      const r = await solar().from('study_meters').upsert({ study_id: studyId, meter_id: meterId }, { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
      if (r.error) throw new Error(`link study meter: ${r.error.message}`)
    },
    async insertRegisterRows(rows) {
      const r = await solar().from('meter_register').insert(rows).select('id')
      if (r.error) throw new Error(`register rows: ${r.error.message}`)
      return (r.data ?? []).length
    },
    async audit(projectId, verb, objectRef) {
      const r = await solar().from('audit_events').insert({ project_id: projectId, verb, object_ref: objectRef })
      if (r.error) throw new Error(`audit: ${r.error.message}`)
    },
  }
}
```

The `countReadings` test stub resolves `select(...).eq(...)` directly; the real builder is awaited the same way.

- [ ] **Step 4: Implement `fake-repo.ts` (test support, kept beside the code it fakes)**

```ts
/** In-memory MeterImportRepo for unit tests of review/commit/routes. Not imported by runtime code. */
import type { ChannelRow, MeterFileRow, MeterImportRepo, MeterRow, NewMeter, RegisterHint } from './repo'

export interface FakeState {
  orgByProject: Record<string, string>
  studyByProject: Record<string, string>
  raw: Record<string, Uint8Array>
  files: MeterFileRow[]
  filePatches: Array<{ fileId: string; patch: Record<string, unknown> }>
  meters: MeterRow[]
  channels: Array<ChannelRow & { id: string }>
  readings: Map<string, Map<string, { value: number | null; quality: number }>>
  writeCalls: Array<{ channelId: string; n: number }>
  hashes: Array<{ organisation_id: string; body_hash: string; meter_id: string; file_id: string; label?: string; siteLabel?: string | null }>
  register: Array<Record<string, unknown>>
  reports: Array<{ id: string; accepted: boolean; row: unknown }>
  studyLinks: Array<{ studyId: string; meterId: string }>
  audits: Array<{ projectId: string; verb: string; objectRef: Record<string, unknown> }>
  /** Test hook: make countReadings lie, to prove the read-back check. */
  countOffset: number
}

export function createFakeRepo(seed: Partial<FakeState> = {}): { repo: MeterImportRepo; state: FakeState } {
  const state: FakeState = {
    orgByProject: {}, studyByProject: {}, raw: {}, files: [], filePatches: [], meters: [], channels: [],
    readings: new Map(), writeCalls: [], hashes: [], register: [], reports: [], studyLinks: [], audits: [], countOffset: 0,
    ...seed,
  }
  let seq = 0
  const id = (p: string) => `${p}-${++seq}`
  const repo: MeterImportRepo = {
    async projectOrg(p) { return state.orgByProject[p] ?? null },
    async studyId(p) { return state.studyByProject[p] ?? null },
    async downloadRaw(path) { return state.raw[path] ?? null },
    async fileBySha(org, sha) { return state.files.find((f) => f.organisation_id === org && f.sha256 === sha) ?? null },
    async insertFile(row) {
      const f: MeterFileRow = { id: id('file'), status: 'uploaded', ...row }
      state.files.push(f)
      return f
    },
    async getFile(fileId) { return state.files.find((f) => f.id === fileId) ?? null },
    async updateFile(fileId, patch) {
      state.filePatches.push({ fileId, patch })
      const f = state.files.find((x) => x.id === fileId)
      if (f && typeof patch.status === 'string') f.status = patch.status as MeterFileRow['status']
    },
    async seriesByBodyHash(org, h) {
      return state.hashes.filter((x) => x.organisation_id === org && x.body_hash === h).map((x) => ({ meterId: x.meter_id, fileId: x.file_id, label: x.label ?? 'meter', siteLabel: x.siteLabel ?? null }))
    },
    async metersBySerials(org, serials) { return state.meters.filter((m) => m.organisation_id === org && m.serials.some((s) => serials.includes(s))) },
    async registerBySerials(org, serials) {
      return state.register
        .filter((r) => r.organisation_id === org && r.kind === 'download_log' && serials.includes(r.serial as string))
        .map((r) => ({ serial: r.serial as string, mallName: (r.mall_name as string) ?? null, tenantName: (r.tenant_name as string) ?? null }))
    },
    async registerForFile(org, hints): Promise<RegisterHint[]> {
      return state.register
        .filter((r) => r.organisation_id === org && r.kind === 'summary' && (hints.shopNo ? r.shop_no === hints.shopNo : r.tenant_name === hints.label))
        .map((r) => ({ tenantName: (r.tenant_name as string) ?? null, shopNo: (r.shop_no as string) ?? null, areaM2: (r.area_m2 as number) ?? null, matchMethod: r.match_method as string, fileName: (r.file_name as string) ?? null }))
    },
    async insertReport(row) {
      const rid = id('report')
      state.reports.push({ id: rid, accepted: false, row })
      return rid
    },
    async acceptReport(rid) {
      const r = state.reports.find((x) => x.id === rid)
      if (r) r.accepted = true
    },
    async getMeter(mid) { return state.meters.find((m) => m.id === mid) ?? null },
    async insertMeter(row: NewMeter) {
      const m: MeterRow = { id: id('meter'), organisation_id: row.organisation_id, label: row.label, site_label: row.site_label, serials: row.serials, kind: row.kind }
      state.meters.push(m)
      return m
    },
    async upsertChannel(row) {
      const existing = state.channels.find((c) => c.meter_id === row.meter_id && c.file_id === row.file_id && c.source_column === row.source_column)
      if (existing) {
        Object.assign(existing, row)
        return existing.id
      }
      const c = { ...row, id: id('channel') }
      state.channels.push(c)
      return c.id
    },
    async writeReadings(channelId, chunk) {
      const m = state.readings.get(channelId) ?? new Map()
      chunk.ts.forEach((t, i) => m.set(t, { value: chunk.value[i], quality: chunk.quality[i] }))
      state.readings.set(channelId, m)
      state.writeCalls.push({ channelId, n: chunk.ts.length })
      return chunk.ts.length
    },
    async countReadings(channelId) { return (state.readings.get(channelId)?.size ?? 0) + state.countOffset },
    async insertSeriesHash(row) {
      if (!state.hashes.some((h) => h.organisation_id === row.organisation_id && h.body_hash === row.body_hash && h.file_id === row.file_id)) state.hashes.push(row)
    },
    async linkStudyMeter(studyId, meterId) {
      if (!state.studyLinks.some((l) => l.studyId === studyId && l.meterId === meterId)) state.studyLinks.push({ studyId, meterId })
    },
    async insertRegisterRows(rows) {
      state.register.push(...rows)
      return rows.length
    },
    async audit(projectId, verb, objectRef) { state.audits.push({ projectId, verb, objectRef }) },
  }
  return { repo, state }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter web test -- meter-import/repo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/meter-import/repo.ts apps/web/src/lib/solar/meter-import/fake-repo.ts apps/web/src/lib/solar/meter-import/repo.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter-import repository over the caller's client, plus an in-memory fake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Identity panel, file status and the review model

**Files:**
- Create: `apps/web/src/lib/solar/meter-import/review.ts`
- Test: `apps/web/src/lib/solar/meter-import/review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseMeterFile, type SeriesOutcome } from '@esite/shared/meter-data'
import { createFakeRepo } from './fake-repo'
import { buildReviewModel, fileParsePatch, fileStatusFor, lookupIdentity } from './review'

const enc = (s: string) => new TextEncoder().encode(s)
const pad = (n: number) => String(n).padStart(2, '0')
function aFile(value = 50): string {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${value}`
  })
  return 'sep=,\r\n\r\ndate,p14\r\n' + rows.join('\r\n') + '\r\n'
}
function bFile(serials: string[]): string {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 30) + i * 1_800_000)
    return `10.0, 1.0, 10.05, 10.05, ${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00, Ok`
  })
  return [`"pnpscada.com", ${serials.map((s) => `"${s}"`).join(', ')}`, '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"', ...rows].join('\r\n')
}
async function series(text: string, name: string): Promise<SeriesOutcome> {
  const o = await parseMeterFile({ bytes: enc(text), fileName: name })
  if (o.kind !== 'series') throw new Error(o.kind)
  return o
}

describe('lookupIdentity', () => {
  it('no conflicts for a new file', async () => {
    const { repo } = createFakeRepo()
    const id = await lookupIdentity(repo, 'org1', await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv'))
    expect(id).toMatchObject({ conflicts: [], blocking: false })
  })
  it('same body elsewhere in the org blocks, naming the meter and site', async () => {
    const o = await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv')
    const { repo } = createFakeRepo({ hashes: [{ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant', siteLabel: 'SITE FV' }] })
    const id = await lookupIdentity(repo, 'org1', o)
    expect(id.blocking).toBe(true)
    expect(id.conflicts).toEqual([{ kind: 'same_body', meterId: 'm9', message: 'Same data as Vacant at SITE FV.' }])
    expect((await lookupIdentity(repo, 'org1', o, 'f9')).blocking).toBe(false)   // the file itself, re-parsed
  })
  it('PnP: serial already a meter; register says another mall; filename serial differs', async () => {
    const o = await series(bFile(['30000001']), 'SITE SG, , 30999999_DB-26, .csv')
    const { repo } = createFakeRepo({
      meters: [{ id: 'm1', organisation_id: 'org1', label: 'Local Main', site_label: 'SITE MR', serials: ['30000001'], kind: 'tenant' }],
      register: [{ organisation_id: 'org1', kind: 'download_log', serial: '30000001', mall_name: 'SITE PD', tenant_name: 'TENANT-E001' }],
    })
    const id = await lookupIdentity(repo, 'org1', o)
    expect(id.conflicts.map((c) => c.kind)).toEqual(['same_serial', 'serial_other_mall', 'filename_serial_mismatch'])
  })
})

describe('file status and patch', () => {
  it('series without errors → parsed; hard error → skipped with the code; choice errors stay parsed', async () => {
    expect(fileStatusFor(await series(aFile(), 'x.csv'))).toEqual({ status: 'parsed', skip_reason: null })
    const empty = await parseMeterFile({ bytes: enc('sep=,\r\n\r\n'), fileName: 'x.csv' })
    expect(fileStatusFor(empty)).toEqual({ status: 'skipped', skip_reason: 'empty_file' })
    const generic = await parseMeterFile({ bytes: enc('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n'), fileName: 'g.csv' })
    expect(fileStatusFor(generic)).toEqual({ status: 'parsed', skip_reason: null })
  })
  it('patch carries the detected facts', async () => {
    const p = fileParsePatch(await series(bFile(['30000001', '30000002']), 'x.csv'))
    expect(p).toMatchObject({ detected_format: 'B', ts_convention: 'end', row_order: 'ascending', source_serials: ['30000001', '30000002'], status: 'parsed' })
    expect(p.body_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildReviewModel', () => {
  it('series: channels, primary default, 48-row preview, identity, canAccept', async () => {
    const o = await series(aFile(), 'SITE A, 1, TENANT-1, 100.csv')
    const m = buildReviewModel({ fileId: 'f1', fileName: 'SITE A, 1, TENANT-1, 100.csv', sheetName: null, reportId: 'r1', outcome: o, identity: { sourceSerials: [], filenameSerial: null, conflicts: [], blocking: false }, registerHints: [] })
    expect(m).toMatchObject({ outcome: 'series', format: 'A', canAccept: true, choicesNeeded: [], blockingErrors: [] })
    expect(m.channels).toEqual([expect.objectContaining({ column: 'p14', isPrimaryDefault: true, storedUnit: 'kW', suggestedUnit: null })])
    expect(m.preview).toHaveLength(48)
    expect(m.preview[0]).toEqual({ tsEnd: '2025-03-09T22:30:00.000Z', value: 50, quality: 0 })
    expect(m.hints).toMatchObject({ site: 'SITE A', shopNo: '1', label: 'TENANT-1', areaM2: 100 })
  })
  it('generic without choices: not acceptable, lists the choices', async () => {
    const o = await parseMeterFile({ bytes: enc('Time,Import (kW)\n01/02/2025 00:30,1\n01/02/2025 01:00,2\n'), fileName: 'g.csv' })
    const m = buildReviewModel({ fileId: 'f1', fileName: 'g.csv', sheetName: null, reportId: 'r1', outcome: o, identity: null, registerHints: [] })
    expect(m.canAccept).toBe(false)
    expect(m.choicesNeeded.sort()).toEqual(['ambiguous_date_order', 'convention_required', 'unknown_unit'])
    expect(m.channels[0].suggestedUnit).toBe('kW')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- meter-import/review`
Expected: FAIL — cannot resolve `./review`.

- [ ] **Step 3: Implement**

```ts
/**
 * Review model for the import dialog (functional spec §4.3): what the parser found, what needs a
 * choice, and the identity panel. Pure except lookupIdentity, which reads through the repository.
 */
import { siteKey, suggestUnitFromHeader, type MeterParseOutcome, type SeriesOutcome, type ValidationReport } from '@esite/shared/meter-data'
import type { MeterImportRepo, RegisterHint } from './repo'

/** Errors the user resolves by choosing (they do not skip the file). */
export const CHOICE_ERRORS = new Set(['unknown_unit', 'ambiguous_date_order', 'convention_required'])

export type IdentityConflictKind = 'same_body' | 'same_serial' | 'serial_other_mall' | 'filename_serial_mismatch'
export interface IdentityConflict {
  kind: IdentityConflictKind
  message: string
  meterId?: string
}
export interface IdentityPanel {
  sourceSerials: string[]
  filenameSerial: string | null
  conflicts: IdentityConflict[]
  /** A conflict must be resolved (link / skip / override with a reason) before Accept. */
  blocking: boolean
}

export async function lookupIdentity(repo: MeterImportRepo, orgId: string, outcome: SeriesOutcome, selfFileId?: string): Promise<IdentityPanel> {
  const conflicts: IdentityConflict[] = []
  for (const d of await repo.seriesByBodyHash(orgId, outcome.bodySha256)) {
    if (d.fileId === selfFileId) continue
    conflicts.push({ kind: 'same_body', meterId: d.meterId, message: `Same data as ${d.label}${d.siteLabel ? ` at ${d.siteLabel}` : ''}.` })
  }
  if (outcome.sourceSerials.length > 0) {
    for (const m of await repo.metersBySerials(orgId, outcome.sourceSerials)) {
      const shared = m.serials.filter((s) => outcome.sourceSerials.includes(s)).join(', ')
      conflicts.push({ kind: 'same_serial', meterId: m.id, message: `Serial ${shared} is already meter ${m.label}${m.site_label ? ` at ${m.site_label}` : ''}.` })
    }
    const site = outcome.filename.siteHint
    for (const r of await repo.registerBySerials(orgId, outcome.sourceSerials)) {
      if (r.mallName && site && siteKey(r.mallName) !== siteKey(site)) {
        conflicts.push({ kind: 'serial_other_mall', message: `The downloader log files serial ${r.serial} under ${r.mallName}, not ${site}.` })
      }
    }
  }
  if (outcome.report.identity.serialMismatch) {
    conflicts.push({ kind: 'filename_serial_mismatch', message: `The file name says meter ${outcome.report.identity.filenameSerial}; the file holds ${outcome.sourceSerials.join(', ')}.` })
  }
  return { sourceSerials: outcome.sourceSerials, filenameSerial: outcome.report.identity.filenameSerial, conflicts, blocking: conflicts.length > 0 }
}

export function fileStatusFor(outcome: MeterParseOutcome): { status: 'parsed' | 'skipped'; skip_reason: string | null } {
  if (outcome.kind === 'register') return { status: 'parsed', skip_reason: null }
  if (outcome.kind === 'rejected') return { status: 'skipped', skip_reason: outcome.report.errors[0]?.code ?? 'rejected' }
  const hard = outcome.report.errors.filter((e) => !CHOICE_ERRORS.has(e.code))
  return hard.length > 0 ? { status: 'skipped', skip_reason: hard[0].code } : { status: 'parsed', skip_reason: null }
}

export function fileParsePatch(outcome: MeterParseOutcome): Record<string, unknown> {
  const r = outcome.report
  const s = fileStatusFor(outcome)
  return {
    detected_format: r.format,
    parsed_filename: outcome.filename,
    delimiter: r.delimiter,
    decimal_sep: r.decimalSeparator,
    header_row: r.headerRow,
    encoding: r.encoding,
    body_sha256: outcome.kind === 'register' ? null : outcome.bodySha256,
    source_serials: outcome.kind === 'series' ? outcome.sourceSerials : [],
    ts_convention: r.tsConvention,
    row_order: r.rowOrder,
    status: s.status,
    skip_reason: s.skip_reason,
  }
}

export interface ChannelReview {
  column: string
  quantity: string
  direction: string
  phase: string | null
  sourceUnit: string
  storedUnit: string
  unitFromTable: boolean
  suggestedUnit: string | null
  intervalMin: number
  coverageOnly: boolean
  isCumulative: boolean
  isPrimaryDefault: boolean
  completeness: number
  meanStored: number | null
  maxStored: number | null
  levelShiftSegments: number
}

export interface ReviewModel {
  fileId: string
  fileName: string
  sheetName: string | null
  reportId: string
  outcome: 'series' | 'register' | 'rejected'
  format: string
  report: ValidationReport
  hints: { site: string | null; shopNo: string | null; label: string | null; areaM2: number | null; serial: string | null; register: RegisterHint[] }
  channels: ChannelReview[]
  preview: Array<{ tsEnd: string; value: number | null; quality: number }>
  identity: IdentityPanel | null
  registerRows: number
  choicesNeeded: string[]
  blockingErrors: string[]
  canAccept: boolean
}

export function buildReviewModel(args: {
  fileId: string
  fileName: string
  sheetName: string | null
  reportId: string
  outcome: MeterParseOutcome
  identity: IdentityPanel | null
  registerHints: RegisterHint[]
}): ReviewModel {
  const { outcome } = args
  const f = outcome.filename
  const errors = outcome.report.errors.map((e) => e.code)
  const choicesNeeded = [...new Set(errors.filter((c) => CHOICE_ERRORS.has(c)))]
  const blockingErrors = [...new Set(errors.filter((c) => !CHOICE_ERRORS.has(c)))]
  const channels: ChannelReview[] =
    outcome.kind === 'series'
      ? outcome.channels.map((c) => ({
          column: c.spec.sourceColumn, quantity: c.spec.quantity, direction: c.spec.direction, phase: c.spec.phase,
          sourceUnit: c.spec.sourceUnit, storedUnit: c.storedUnit, unitFromTable: c.spec.unitFromTable,
          suggestedUnit: c.spec.sourceUnit === 'unknown' ? suggestUnitFromHeader(c.spec.sourceColumn) : null,
          intervalMin: c.intervalMin, coverageOnly: c.coverageOnly, isCumulative: c.isCumulative,
          isPrimaryDefault: c.spec.sourceColumn === outcome.primaryColumn,
          completeness: c.stats.completeness, meanStored: c.stats.meanUsable, maxStored: c.stats.maxUsable,
          levelShiftSegments: c.levelShifts.length,
        }))
      : []
  const primary = outcome.kind === 'series' ? outcome.channels.find((c) => c.spec.sourceColumn === outcome.primaryColumn) : undefined
  return {
    fileId: args.fileId,
    fileName: args.fileName,
    sheetName: args.sheetName,
    reportId: args.reportId,
    outcome: outcome.kind,
    format: outcome.format,
    report: outcome.report,
    hints: { site: f.siteHint, shopNo: f.shopNo, label: f.label, areaM2: f.areaM2Hint, serial: f.serialHint, register: args.registerHints },
    channels,
    preview: (primary?.readings ?? []).slice(0, 48).map((r) => ({ tsEnd: new Date(r.tsEnd).toISOString(), value: r.value, quality: r.quality })),
    identity: args.identity,
    registerRows: outcome.kind === 'register' ? outcome.rows.length : 0,
    choicesNeeded,
    blockingErrors,
    canAccept: outcome.kind === 'series' && errors.length === 0,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- meter-import/review`
Expected: PASS. (This is also the first import of `@esite/shared/meter-data` from `apps/web`: a resolution failure here means Task 1 of 3a-i's exports map is wrong.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/meter-import/review.ts apps/web/src/lib/solar/meter-import/review.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter import review model — identity panel, file status, choices vs blocking errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Commit logic (series / register / skip) with read-back verification

**Files:**
- Create: `apps/web/src/lib/solar/meter-import/commit.ts`
- Test: `apps/web/src/lib/solar/meter-import/commit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMeterFile } from '@esite/shared/meter-data'
import { CommitBodySchema, CommitError, commitMeterFile } from './commit'
import { createFakeRepo } from './fake-repo'
import type { MeterFileRow } from './repo'

const enc = (s: string) => new TextEncoder().encode(s)
const pad = (n: number) => String(n).padStart(2, '0')
const A_TEXT = (() => {
  const rows = [...Array(48).keys()].map((i) => {
    const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${40 + (i % 3)}`
  })
  return 'sep=,\r\n\r\ndate,p14\r\n' + rows.join('\r\n') + '\r\n'
})()
const B2_TEXT = [
  '"pnpscada.com", "30000001", "30000002"',
  '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"',
  '10.0, 1.0, 10.05, 10.05, 2025-03-10, 00:30:00, Ok',
  '11.0, 1.0, 11.05, 11.05, 2025-03-10, 01:00:00, Ok',
  '12.0, 1.0, 12.04, 12.04, 2025-03-10, 01:30:00, Ok',
].join('\r\n')
const REGISTER_9COL = readFileSync(join(__dirname, '../../../../../../packages/shared/src/meter-data/__fixtures__/register/SITE YA_Consolidation_Summary.9col.csv'))

function setup(text: string | Uint8Array, name = 'SITE A, 1, TENANT-1, 100.csv') {
  const bytes = typeof text === 'string' ? enc(text) : new Uint8Array(text)
  const file: MeterFileRow = { id: 'f1', organisation_id: 'org1', project_id: 'p1', sha256: 'x'.repeat(64), size_bytes: bytes.byteLength, storage_path: 'org1/p1/x.csv', original_name: name, status: 'parsed' }
  const fake = createFakeRepo({ files: [file], raw: { 'org1/p1/x.csv': bytes }, studyByProject: { p1: 's1' } })
  return { ...fake, ctx: { projectId: 'p1', orgId: 'org1', file } }
}
const NEW_TENANT = { new: { label: 'TENANT-1', kind: 'tenant' as const } }
const body = (extra: Record<string, unknown>) => CommitBodySchema.parse({ mode: 'series', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', meter: NEW_TENANT, identity: { resolution: 'none' }, ...extra })

describe('commitMeterFile: series', () => {
  it('creates the meter and channel, writes readings in chunks, verifies the count, links the study', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const out = await commitMeterFile(repo, ctx, body({}), { chunkSize: 20 })
    expect(state.meters).toEqual([expect.objectContaining({ label: 'TENANT-1', kind: 'tenant', serials: [] })])
    expect(state.channels).toEqual([expect.objectContaining({ source_column: 'p14', unit: 'kW', source_unit: 'kW', tz_convention: 'begin', is_primary: true, interval_min: 30, parser_version: '3a.1' })])
    expect(state.writeCalls.map((c) => c.n)).toEqual([20, 20, 8])
    expect(out).toMatchObject({ channels: [{ sourceColumn: 'p14', readings: 48 }] })
    expect(state.hashes).toHaveLength(1)
    expect(state.studyLinks).toEqual([{ studyId: 's1', meterId: state.meters[0].id }])
    expect(state.reports[0].accepted).toBe(true)
    expect(state.files[0].status).toBe('accepted')
    expect(state.audits.map((a) => a.verb)).toEqual(['meter_file_imported'])
  })

  it('is idempotent: committing twice leaves one channel with 48 readings', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const first = (await commitMeterFile(repo, ctx, body({}))) as { meterId: string }
    await commitMeterFile(repo, ctx, { mode: 'series', fileId: 'f1', meter: { existingMeterId: first.meterId }, identity: { resolution: 'none' } })
    expect(state.channels).toHaveLength(1)
    expect(state.readings.get(state.channels[0].id)?.size).toBe(48)
  })

  it('read-back mismatch is a 500 with the numbers', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    state.countOffset = -1
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 500, body: { error: 'readings_verification_failed', expected: 48, found: 47 } })
  })

  it('an identity conflict needs a resolution; override needs a reason', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const o = await parseMeterFile({ bytes: enc(A_TEXT), fileName: ctx.file.original_name })
    if (o.kind !== 'series') throw new Error('series expected')
    state.hashes.push({ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant' })
    await expect(commitMeterFile(repo, ctx, body({}))).rejects.toMatchObject({ status: 409, body: { error: 'identity_conflict' } })
    await expect(commitMeterFile(repo, ctx, body({ identity: { resolution: 'override' } }))).rejects.toMatchObject({ status: 422, body: { error: 'override_needs_reason' } })
    await expect(commitMeterFile(repo, ctx, body({ identity: { resolution: 'override', reason: 'Checked against the SLD' } }))).resolves.toBeTruthy()
  })

  it('link on an identical body records the link and writes no readings', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    const o = await parseMeterFile({ bytes: enc(A_TEXT), fileName: ctx.file.original_name })
    if (o.kind !== 'series') throw new Error('series expected')
    state.meters.push({ id: 'm9', organisation_id: 'org1', label: 'Vacant', site_label: null, serials: [], kind: 'vacant' })
    state.hashes.push({ organisation_id: 'org1', body_hash: o.bodySha256, meter_id: 'm9', file_id: 'f9', label: 'Vacant' })
    // commitMeterFile takes an already-validated body; the fake's ids are not UUIDs, so skip the schema here.
    const out = await commitMeterFile(repo, ctx, { mode: 'series', fileId: 'f1', meter: { existingMeterId: 'm9' }, identity: { resolution: 'link' } })
    expect(out).toMatchObject({ meterId: 'm9', channels: [] })
    expect(state.writeCalls).toEqual([])
    expect(state.hashes.some((h) => h.file_id === 'f1' && h.meter_id === 'm9')).toBe(true)
  })

  it('refuses unresolved parse errors, water meters, and a non-virtual multi-serial meter', async () => {
    const generic = setup('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n', 'g.csv')
    await expect(commitMeterFile(generic.repo, generic.ctx, body({}))).rejects.toMatchObject({ status: 422, body: { error: 'unresolved_errors' } })
    const a = setup(A_TEXT)
    await expect(commitMeterFile(a.repo, a.ctx, body({ meter: { new: { label: 'x', kind: 'water' } } }))).rejects.toMatchObject({ status: 422, body: { error: 'water_is_not_load' } })
    const b = setup(B2_TEXT, 'SITE RM, , E9001, .csv')
    await expect(commitMeterFile(b.repo, b.ctx, body({}))).rejects.toMatchObject({ status: 422, body: { error: 'multi_serial_meter_is_virtual' } })
    await expect(commitMeterFile(b.repo, b.ctx, body({ meter: { new: { label: 'E9001', kind: 'virtual' } } }))).resolves.toBeTruthy()
    expect(b.state.meters[0].serials).toEqual(['30000001', '30000002'])
  })

  it('generic file commits once the choices are supplied', async () => {
    const g = setup('Time,kW\n13/02/2025 00:00,1\n13/02/2025 00:30,2\n13/02/2025 01:00,3\n', 'g.csv')
    const out = await commitMeterFile(g.repo, g.ctx, body({ options: { tsConvention: 'end', units: { kW: 'kW' } } }))
    expect(out).toMatchObject({ channels: [{ sourceColumn: 'kW', readings: 3 }] })
  })
})

describe('commitMeterFile: register and skip', () => {
  it('imports a consolidation summary once', async () => {
    const { repo, state, ctx } = setup(REGISTER_9COL, 'SITE YA_Consolidation_Summary.9col.csv')
    const out = await commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'register', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', siteLabel: 'SITE YA' }))
    expect(out).toEqual({ registerRows: 26 })
    expect(state.register.filter((r) => r.match_method === 'llm')).toHaveLength(4)
    expect(state.register.every((r) => r.site_label === 'SITE YA' && r.source_file_id === 'f1' && r.organisation_id === 'org1')).toBe(true)
    await expect(commitMeterFile(repo, { ...ctx, file: { ...ctx.file, status: 'accepted' } }, CommitBodySchema.parse({ mode: 'register', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465' }))).rejects.toMatchObject({ status: 409 })
  })
  it('skip records the reason and keeps the raw file', async () => {
    const { repo, state, ctx } = setup(A_TEXT)
    expect(await commitMeterFile(repo, ctx, CommitBodySchema.parse({ mode: 'skip', fileId: '9c1a98b5-6ef3-4388-865f-417d3f5d7465', reason: 'Duplicate of the bulk meter' }))).toEqual({ skipped: true })
    expect(state.filePatches.at(-1)?.patch).toEqual({ status: 'skipped', skip_reason: 'Duplicate of the bulk meter' })
    expect(state.raw['org1/p1/x.csv']).toBeDefined()
  })
})
```


- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- meter-import/commit`
Expected: FAIL — cannot resolve `./commit`.

- [ ] **Step 3: Implement**

```ts
/**
 * Commit a reviewed meter file. The server RE-PARSES the stored raw file with the user's confirmed
 * options (it never trusts a client-side parse), refuses unresolved errors and unresolved identity
 * conflicts, then writes channels and readings through RLS and READS THE COUNT BACK: a write that
 * reports success but lands nothing is a 500 with the numbers, not a green import.
 * Idempotent: channels upsert on (meter, file, column), readings upsert on (channel, ts_end).
 */
import { z } from 'zod'
import {
  applyScaleCorrection, METER_PARSER_VERSION, parseMeterFile, parseMeterWorkbook, SOURCE_UNITS,
  type MeterParseOutcome, type NormalisedChannel, type ParseOptions, type SeriesOutcome,
} from '@esite/shared/meter-data'
import type { MeterFileRow, MeterImportRepo, MeterRow } from './repo'
import { fileParsePatch, lookupIdentity } from './review'

export class CommitError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error))
    this.status = status
    this.body = body
  }
}

export const READING_CHUNK = 5000

const METER_KINDS = ['tenant', 'bulk', 'council', 'generator', 'solar', 'common', 'vacant', 'check', 'virtual', 'water', 'unknown'] as const
const KNOWN_UNITS = SOURCE_UNITS.filter((u) => u !== 'unknown') as [string, ...string[]]

const OptionsSchema = z.object({
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  tsConvention: z.enum(['begin', 'end']).optional(),
  units: z.record(z.enum(KNOWN_UNITS)).optional(),
  areaM2: z.number().positive().nullable().optional(),
}).strict()

const NewMeterSchema = z.object({
  label: z.string().trim().min(1).max(200),
  kind: z.enum(METER_KINDS),
  siteLabel: z.string().trim().max(200).nullable().optional(),
  shopNo: z.string().trim().max(100).nullable().optional(),
  areaM2: z.number().positive().nullable().optional(),
  areaSource: z.enum(['register_exact', 'register_llm', 'filename', 'manual']).nullable().optional(),
  nodeId: z.string().uuid().nullable().optional(),
}).strict()

const FileId = z.string().uuid()

export const CommitBodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('series'),
    fileId: FileId,
    sheet: z.string().max(200).optional(),
    meter: z.union([z.object({ existingMeterId: z.string().uuid() }).strict(), z.object({ new: NewMeterSchema }).strict()]),
    identity: z.object({ resolution: z.enum(['none', 'link', 'override']), reason: z.string().trim().min(5).max(500).optional() }).strict(),
    channels: z.array(z.object({ sourceColumn: z.string().min(1), include: z.boolean(), isPrimary: z.boolean().optional() }).strict()).optional(),
    scaleCorrections: z.array(z.object({ sourceColumn: z.string().min(1), segmentIndex: z.number().int().min(0) }).strict()).optional(),
    options: OptionsSchema.optional(),
  }).strict(),
  z.object({ mode: z.literal('register'), fileId: FileId, siteLabel: z.string().trim().max(200).nullable().optional() }).strict(),
  z.object({ mode: z.literal('skip'), fileId: FileId, reason: z.string().trim().min(3).max(500) }).strict(),
])
export type CommitBody = z.infer<typeof CommitBodySchema>
type SeriesBody = Extract<CommitBody, { mode: 'series' }>

export interface CommitContext {
  projectId: string
  orgId: string
  file: MeterFileRow
}

/** Parse the stored raw file. Workbooks: the named sheet, else the first series sheet. */
export async function parseStoredFile(repo: MeterImportRepo, file: MeterFileRow, options: ParseOptions, sheet?: string): Promise<{ outcome: MeterParseOutcome; sheetName: string | null }> {
  const bytes = await repo.downloadRaw(file.storage_path)
  if (!bytes) throw new CommitError(404, { error: 'raw_file_missing', storagePath: file.storage_path })
  if (/\.xlsx$/i.test(file.original_name)) {
    const sheets = await parseMeterWorkbook({ bytes, fileName: file.original_name, options })
    const chosen = sheet ? sheets.find((s) => s.sheetName === sheet) : (sheets.find((s) => s.outcome.kind === 'series') ?? sheets[0])
    if (!chosen) throw new CommitError(422, { error: 'sheet_not_found', sheet: sheet ?? null })
    return { outcome: chosen.outcome, sheetName: chosen.sheetName }
  }
  return { outcome: await parseMeterFile({ bytes, fileName: file.original_name, options }), sheetName: null }
}

async function resolveMeter(repo: MeterImportRepo, ctx: CommitContext, outcome: SeriesOutcome, body: SeriesBody): Promise<MeterRow> {
  if ('existingMeterId' in body.meter) {
    const m = await repo.getMeter(body.meter.existingMeterId)
    if (!m || m.organisation_id !== ctx.orgId) throw new CommitError(404, { error: 'meter_not_found' })
    return m
  }
  const n = body.meter.new
  if (n.kind === 'water') throw new CommitError(422, { error: 'water_is_not_load' })
  if (outcome.sourceSerials.length > 1 && n.kind !== 'virtual') {
    throw new CommitError(422, { error: 'multi_serial_meter_is_virtual', serials: outcome.sourceSerials })
  }
  const area = n.areaM2 ?? null
  return repo.insertMeter({
    organisation_id: ctx.orgId,
    label: n.label,
    site_label: n.siteLabel ?? outcome.filename.siteHint,
    serials: outcome.sourceSerials,
    shop_no: n.shopNo ?? outcome.filename.shopNo,
    area_m2: area,
    area_source: area === null ? null : (n.areaSource ?? 'manual'),
    kind: n.kind,
    node_id: n.nodeId ?? null,
  })
}

function selectChannels(outcome: SeriesOutcome, body: SeriesBody): Array<{ channel: NormalisedChannel; isPrimary: boolean }> {
  const choice = new Map((body.channels ?? []).map((c) => [c.sourceColumn, c]))
  const included = outcome.channels.filter((c) => choice.get(c.spec.sourceColumn)?.include ?? c.spec.sourceUnit !== 'unknown')
  const explicit = (body.channels ?? []).filter((c) => c.isPrimary).map((c) => c.sourceColumn)
  if (explicit.length > 1) throw new CommitError(422, { error: 'one_primary_channel', columns: explicit })
  const primary = explicit[0] ?? outcome.primaryColumn
  return included.map((channel) => ({ channel, isPrimary: channel.spec.sourceColumn === primary }))
}

export async function commitMeterFile(repo: MeterImportRepo, ctx: CommitContext, body: CommitBody, opts: { chunkSize?: number } = {}): Promise<Record<string, unknown>> {
  if (body.mode === 'skip') {
    await repo.updateFile(ctx.file.id, { status: 'skipped', skip_reason: body.reason })
    await repo.audit(ctx.projectId, 'meter_file_skipped', { file_id: ctx.file.id, reason: body.reason })
    return { skipped: true }
  }

  if (body.mode === 'register') {
    if (ctx.file.status === 'accepted') throw new CommitError(409, { error: 'already_imported' })
    const { outcome } = await parseStoredFile(repo, ctx.file, {})
    if (outcome.kind !== 'register') throw new CommitError(422, { error: 'not_a_register', format: outcome.format })
    const site = body.siteLabel ?? outcome.filename.siteHint ?? null
    const rows = outcome.rows.map((r) => ({
      organisation_id: ctx.orgId, source_file_id: ctx.file.id, kind: r.kind, site_label: site, file_name: r.fileName,
      tenant_name: r.tenantName, shop_no: r.shopNo, area_m2: r.areaM2 !== null && r.areaM2 > 0 ? r.areaM2 : null,
      match_method: r.matchMethod, serial: r.serial, mall_name: r.mallName, downloaded: r.downloaded, qa: r.qa,
    }))
    const inserted = rows.length > 0 ? await repo.insertRegisterRows(rows) : 0
    await repo.updateFile(ctx.file.id, { ...fileParsePatch(outcome), status: 'accepted', skip_reason: null })
    await repo.audit(ctx.projectId, 'meter_register_imported', { file_id: ctx.file.id, rows: inserted })
    return { registerRows: inserted }
  }

  // zod types units as Record<string, string>; the schema already restricted them to SourceUnit values.
  const options = (body.options ?? {}) as ParseOptions
  const { outcome } = await parseStoredFile(repo, ctx.file, options, body.sheet)
  if (outcome.kind !== 'series') throw new CommitError(422, { error: 'not_a_meter_series', format: outcome.format, errors: outcome.report.errors })
  if (outcome.report.errors.length > 0) throw new CommitError(422, { error: 'unresolved_errors', errors: outcome.report.errors })

  const identity = await lookupIdentity(repo, ctx.orgId, outcome, ctx.file.id)
  if (identity.blocking) {
    if (body.identity.resolution === 'none') throw new CommitError(409, { error: 'identity_conflict', identity })
    if (body.identity.resolution === 'override' && !body.identity.reason) throw new CommitError(422, { error: 'override_needs_reason' })
    if (body.identity.resolution === 'link' && !('existingMeterId' in body.meter)) throw new CommitError(422, { error: 'link_needs_existing_meter' })
  }

  const meter = await resolveMeter(repo, ctx, outcome, body)
  const sameBodyLink = body.identity.resolution === 'link' && identity.conflicts.some((c) => c.kind === 'same_body' && c.meterId === meter.id)

  const results: Array<{ channelId: string; sourceColumn: string; readings: number }> = []
  if (!sameBodyLink) {
    const chunk = opts.chunkSize ?? READING_CHUNK
    for (const { channel, isPrimary } of selectChannels(outcome, body)) {
      let readings = channel.readings
      for (const sc of (body.scaleCorrections ?? []).filter((s) => s.sourceColumn === channel.spec.sourceColumn)) {
        const seg = channel.levelShifts[sc.segmentIndex]
        if (!seg) throw new CommitError(422, { error: 'no_such_level_shift', column: sc.sourceColumn, segmentIndex: sc.segmentIndex })
        readings = applyScaleCorrection(readings, seg)
      }
      const channelId = await repo.upsertChannel({
        meter_id: meter.id, file_id: ctx.file.id, source_column: channel.spec.sourceColumn, quantity: channel.spec.quantity,
        direction: channel.spec.direction, phase: channel.spec.phase, source_unit: channel.spec.sourceUnit, unit: channel.storedUnit,
        interval_min: channel.intervalMin, is_cumulative: channel.isCumulative, tz_convention: outcome.report.tsConvention ?? 'end',
        is_primary: isPrimary, coverage_only: channel.coverageOnly, parser_version: METER_PARSER_VERSION,
      })
      let written = 0
      for (let i = 0; i < readings.length; i += chunk) {
        const part = readings.slice(i, i + chunk)
        written += await repo.writeReadings(channelId, {
          ts: part.map((r) => new Date(r.tsEnd).toISOString()),
          value: part.map((r) => r.value),
          quality: part.map((r) => r.quality),
        })
      }
      const found = await repo.countReadings(channelId)
      if (found !== readings.length) {
        throw new CommitError(500, { error: 'readings_verification_failed', channel: channel.spec.sourceColumn, expected: readings.length, written, found })
      }
      results.push({ channelId, sourceColumn: channel.spec.sourceColumn, readings: found })
    }
  }

  await repo.insertSeriesHash({ organisation_id: ctx.orgId, body_hash: outcome.bodySha256, meter_id: meter.id, file_id: ctx.file.id })
  const studyId = await repo.studyId(ctx.projectId)
  if (studyId) await repo.linkStudyMeter(studyId, meter.id)
  const reportId = await repo.insertReport({
    file_id: ctx.file.id, parser_version: METER_PARSER_VERSION, options,
    report: { ...outcome.report, identity: { ...outcome.report.identity, resolution: body.identity.resolution, reason: body.identity.reason ?? null, conflicts: identity.conflicts } },
  })
  await repo.acceptReport(reportId)
  await repo.updateFile(ctx.file.id, { ...fileParsePatch(outcome), status: 'accepted', skip_reason: null })
  await repo.audit(ctx.projectId, 'meter_file_imported', {
    file_id: ctx.file.id, meter_id: meter.id, channels: results.length, identity_resolution: body.identity.resolution,
  })
  return { meterId: meter.id, reportId, channels: results }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- meter-import/commit`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Delete the `if (found !== readings.length) { … }` block and rerun: the read-back test fails. Restore it and rerun: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/meter-import/commit.ts apps/web/src/lib/solar/meter-import/commit.test.ts
git commit -m "$(cat <<'EOF'
feat(solar): meter file commit — server re-parse, identity resolution, idempotent writes, read-back check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Route — `POST /api/projects/[id]/solar/meter-files` (register an uploaded raw file)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/meter-files/route.ts`
- Test: `apps/web/src/app/api/projects/[id]/solar/meter-files/route.test.ts`

The browser uploads straight to Storage (`solar-meter-raw/<org>/<project>/<sha256>.<ext>`, never through a Vercel function: 4.5 MB body cap) and then calls this route. The route recomputes the sha256 from the stored bytes: a path whose name is not the content hash is refused, so the path is the proof of content.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

const { gateMock, fake } = vi.hoisted(() => ({ gateMock: vi.fn(), fake: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (fake.current as { repo: unknown }).repo }
})

import { NextResponse } from 'next/server'
import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const bytes = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n')
const sha = createHash('sha256').update(bytes).digest('hex')
const path = `${ORG}/${P}/${sha}.csv`
const call = (b: unknown, id = P) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({ orgByProject: { [P]: ORG }, raw: { [path]: bytes } })
})

describe('POST /api/projects/[id]/solar/meter-files', () => {
  it('400 on a non-UUID project id', async () => {
    expect((await call({}, 'nope')).status).toBe(400)
  })
  it('passes the gate response through (403) and needs Edit', async () => {
    gateMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Solar access required' }, { status: 403 }) })
    expect((await call({ storagePath: path, originalName: 'a.csv' })).status).toBe(403)
    expect(gateMock).toHaveBeenCalledWith({}, P, 'edit')
  })
  it('400 when the path is not <org>/<project>/<sha>.<ext> of THIS project', async () => {
    expect((await call({ storagePath: `${ORG}/${ORG}/${sha}.csv`, originalName: 'a.csv' })).status).toBe(400)
    expect((await call({ storagePath: 'x.csv', originalName: 'a.csv' })).status).toBe(400)
  })
  it('404 when the object is not in Storage', async () => {
    const other = `${ORG}/${P}/${'0'.repeat(64)}.csv`
    expect((await call({ storagePath: other, originalName: 'a.csv' })).status).toBe(404)
  })
  it('400 when the bytes do not hash to the name', async () => {
    const lie = `${ORG}/${P}/${'1'.repeat(64)}.csv`
    ;(fake.current as ReturnType<typeof createFakeRepo>).state.raw[lie] = bytes
    const r = await call({ storagePath: lie, originalName: 'a.csv' })
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ error: 'sha256_mismatch' })
  })
  it('201 creates the file row; 200 for the same bytes again (duplicate)', async () => {
    const r1 = await call({ storagePath: path, originalName: 'SITE A, 1, T, 10.csv' })
    expect(r1.status).toBe(201)
    const { fileId } = await r1.json()
    const r2 = await call({ storagePath: path, originalName: 'copy.csv' })
    expect(r2.status).toBe(200)
    expect(await r2.json()).toEqual({ fileId, duplicate: true, status: 'uploaded' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- "solar/meter-files/route"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

```ts
/**
 * POST /api/projects/[id]/solar/meter-files
 * Registers a raw meter file the browser already uploaded to Storage (solar-meter-raw).
 * Gate: Solar Edit on the project (requireSolarLevelAPI). Reads Storage with the caller's client,
 * so the bucket's policy applies too. Recomputes the sha256 from the bytes; the file name must be it.
 * app/api/* is outside (admin)/layout.tsx, so this route gates itself.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { createMeterImportRepo, MAX_METER_FILE_BYTES } from '@/lib/solar/meter-import/repo'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Body = z.object({ storagePath: z.string().min(1).max(300), originalName: z.string().trim().min(1).max(255) }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const m = parsed.data.storagePath.match(/^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f]{64})\.(csv|txt|xlsx|xls)$/)
  if (!m || m[1] !== orgId || m[2] !== projectId) {
    return NextResponse.json({ error: 'storage path must be <org>/<project>/<sha256>.<ext> for this project' }, { status: 400 })
  }
  let bytes: Uint8Array | null
  try {
    bytes = await repo.downloadRaw(parsed.data.storagePath)
  } catch {
    return NextResponse.json({ error: 'file is larger than 50 MB' }, { status: 413 })
  }
  if (!bytes) return NextResponse.json({ error: 'uploaded file not found in storage' }, { status: 404 })
  if (bytes.byteLength > MAX_METER_FILE_BYTES) return NextResponse.json({ error: 'file is larger than 50 MB' }, { status: 413 })
  const sha = await sha256Hex(bytes)
  if (sha !== m[3]) return NextResponse.json({ error: 'sha256_mismatch', expected: m[3], actual: sha }, { status: 400 })

  const existing = await repo.fileBySha(orgId, sha)
  if (existing) return NextResponse.json({ fileId: existing.id, duplicate: true, status: existing.status }, { status: 200 })
  const row = await repo.insertFile({
    project_id: projectId, organisation_id: orgId, sha256: sha, size_bytes: bytes.byteLength,
    storage_path: parsed.data.storagePath, original_name: parsed.data.originalName,
  })
  return NextResponse.json({ fileId: row.id, duplicate: false }, { status: 201 })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- "solar/meter-files/route"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/projects/[id]/solar/meter-files/route.ts" "apps/web/src/app/api/projects/[id]/solar/meter-files/route.test.ts"
git commit -m "$(cat <<'EOF'
feat(solar): POST meter-files — register an uploaded raw file; path must be its sha256

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Routes — `…/meter-files/parse` and `…/meter-files/commit`

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/meter-files/parse/route.ts` (+ `route.test.ts`)
- Create: `apps/web/src/app/api/projects/[id]/solar/meter-files/commit/route.ts` (+ `route.test.ts`)

- [ ] **Step 1: Write the failing parse-route test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateMock, fake } = vi.hoisted(() => ({ gateMock: vi.fn(), fake: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (fake.current as { repo: unknown }).repo }
})

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const F1 = '3b241101-e2bb-4255-8caf-4136c566a962'
const F2 = '6fa459ea-ee8a-3ca4-894e-db77e160355e'
const enc = (s: string) => new TextEncoder().encode(s)
const A = enc('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\n10/03/2025 01:00:00,3\r\n')
const EMPTY = enc('sep=,\r\n\r\n')
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({
    orgByProject: { [P]: ORG },
    raw: { a: A, e: EMPTY },
    files: [
      { id: F1, organisation_id: ORG, project_id: P, sha256: 'a'.repeat(64), size_bytes: A.byteLength, storage_path: 'a', original_name: 'SITE A, 1, T, 10.csv', status: 'uploaded' },
      { id: F2, organisation_id: ORG, project_id: P, sha256: 'b'.repeat(64), size_bytes: EMPTY.byteLength, storage_path: 'e', original_name: 'e.csv', status: 'uploaded' },
    ],
  })
})

describe('POST …/meter-files/parse', () => {
  it('returns one review per file, stores a report and the detected facts', async () => {
    const r = await call({ fileIds: [F1, F2, '11111111-1111-4111-8111-111111111111'] })
    expect(r.status).toBe(200)
    const { results } = await r.json()
    expect(results[0]).toMatchObject({ fileId: F1, reviews: [{ outcome: 'series', format: 'A', canAccept: true }] })
    expect(results[1]).toMatchObject({ fileId: F2, reviews: [{ outcome: 'rejected', blockingErrors: ['empty_file'] }] })
    expect(results[2]).toEqual({ fileId: '11111111-1111-4111-8111-111111111111', error: 'not_found' })
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    expect(s.reports).toHaveLength(2)
    expect(s.filePatches.find((p) => p.fileId === F1)?.patch).toMatchObject({ detected_format: 'A', status: 'parsed' })
    expect(s.filePatches.find((p) => p.fileId === F2)?.patch).toMatchObject({ status: 'skipped', skip_reason: 'empty_file' })
  })
  it('400 for an empty or oversized list', async () => {
    expect((await call({ fileIds: [] })).status).toBe(400)
    expect((await call({ fileIds: Array(21).fill(F1) })).status).toBe(400)
  })
  it('applies per-file options (the dialog re-runs the preview with a user choice)', async () => {
    const r = await call({ fileIds: [F1], options: { [F1]: { units: { p14: 'kWh' } } } })
    const { results } = await r.json()
    expect(results[0].reviews[0].channels[0]).toMatchObject({ sourceUnit: 'kWh', unitFromTable: false })
  })
})
```

- [ ] **Step 2: Write the failing commit-route test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateMock, fake } = vi.hoisted(() => ({ gateMock: vi.fn(), fake: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (fake.current as { repo: unknown }).repo }
})

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const F1 = '3b241101-e2bb-4255-8caf-4136c566a962'
const A = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\n10/03/2025 01:00:00,3\r\n')
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({
    orgByProject: { [P]: ORG }, raw: { a: A },
    files: [{ id: F1, organisation_id: ORG, project_id: P, sha256: 'a'.repeat(64), size_bytes: A.byteLength, storage_path: 'a', original_name: 'SITE A, 1, T, 10.csv', status: 'parsed' }],
  })
})

describe('POST …/meter-files/commit', () => {
  it('400 for an invalid body', async () => {
    expect((await call({ mode: 'series', fileId: F1 })).status).toBe(400)
  })
  it('404 for a file of another project', async () => {
    ;(fake.current as ReturnType<typeof createFakeRepo>).state.files[0].project_id = '11111111-1111-4111-8111-111111111111'
    expect((await call({ mode: 'skip', fileId: F1, reason: 'not ours' })).status).toBe(404)
  })
  it('200 on a clean series commit', async () => {
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'tenant' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ channels: [{ sourceColumn: 'p14', readings: 3 }] })
  })
  it('maps CommitError to its status and body', async () => {
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'water' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'water_is_not_load' })
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter web test -- "solar/meter-files/parse" "solar/meter-files/commit"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 4: Implement the parse route**

```ts
/**
 * POST /api/projects/[id]/solar/meter-files/parse   { fileIds: uuid[1..20], options?: { [fileId]: ParseOptions } }
 * Parses each stored raw file server-side (the browser never parses what is stored), records an
 * import report and the detected facts on the file row, and returns the review model per file
 * (one per sheet for .xlsx). Gate: Solar Edit on the project.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseMeterFile, parseMeterWorkbook, METER_PARSER_VERSION, SOURCE_UNITS, type MeterParseOutcome, type ParseOptions } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { createMeterImportRepo } from '@/lib/solar/meter-import/repo'
import { buildReviewModel, fileParsePatch, lookupIdentity, type ReviewModel } from '@/lib/solar/meter-import/review'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KNOWN_UNITS = SOURCE_UNITS.filter((u) => u !== 'unknown') as [string, ...string[]]
const Options = z.object({
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  tsConvention: z.enum(['begin', 'end']).optional(),
  units: z.record(z.enum(KNOWN_UNITS)).optional(),
  areaM2: z.number().positive().nullable().optional(),
}).strict()
const Body = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(20), options: z.record(Options).optional() }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })

  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const results: Array<{ fileId: string; reviews: ReviewModel[] } | { fileId: string; error: string }> = []
  for (const fileId of parsed.data.fileIds) {
    const file = await repo.getFile(fileId)
    if (!file || file.project_id !== projectId) {
      results.push({ fileId, error: 'not_found' })
      continue
    }
    const bytes = await repo.downloadRaw(file.storage_path)
    if (!bytes) {
      results.push({ fileId, error: 'raw_file_missing' })
      continue
    }
    const options: ParseOptions = (parsed.data.options?.[fileId] ?? {}) as ParseOptions
    const outcomes: Array<{ sheetName: string | null; outcome: MeterParseOutcome }> = /\.xlsx$/i.test(file.original_name)
      ? (await parseMeterWorkbook({ bytes, fileName: file.original_name, options })).map((s) => ({ sheetName: s.sheetName, outcome: s.outcome }))
      : [{ sheetName: null, outcome: await parseMeterFile({ bytes, fileName: file.original_name, options }) }]

    const reviews: ReviewModel[] = []
    for (const { sheetName, outcome } of outcomes) {
      const identity = outcome.kind === 'series' ? await lookupIdentity(repo, orgId, outcome, file.id) : null
      const registerHints = outcome.kind === 'series' ? await repo.registerForFile(orgId, { label: outcome.filename.label, shopNo: outcome.filename.shopNo }) : []
      const reportId = await repo.insertReport({ file_id: file.id, parser_version: METER_PARSER_VERSION, options, report: { ...outcome.report, sheetName } })
      reviews.push(buildReviewModel({ fileId: file.id, fileName: file.original_name, sheetName, reportId, outcome, identity, registerHints }))
    }
    // The file row records the first sheet's facts (or the only outcome's).
    if (file.status !== 'accepted') await repo.updateFile(file.id, fileParsePatch(outcomes[0].outcome))
    results.push({ fileId, reviews })
  }
  return NextResponse.json({ results }, { status: 200 })
}
```

- [ ] **Step 5: Implement the commit route**

```ts
/**
 * POST /api/projects/[id]/solar/meter-files/commit
 * Body: CommitBody (series | register | skip). Gate: Solar Edit on the project. Everything is written
 * with the caller's client (RLS applies); readings go through solar.write_readings and are counted
 * back before the file is marked accepted.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { CommitBodySchema, CommitError, commitMeterFile } from '@/lib/solar/meter-import/commit'
import { createMeterImportRepo } from '@/lib/solar/meter-import/repo'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = CommitBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })

  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const file = await repo.getFile(parsed.data.fileId)
  if (!file || file.project_id !== projectId) return NextResponse.json({ error: 'file not found' }, { status: 404 })

  try {
    const out = await commitMeterFile(repo, { projectId, orgId, file }, parsed.data)
    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    if (e instanceof CommitError) return NextResponse.json(e.body, { status: e.status })
    console.error('[solar/meter-files/commit]', { projectId, fileId: file.id, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'commit_failed' }, { status: 500 })
  }
}
```

- [ ] **Step 6: Run to verify both pass**

Run: `pnpm --filter web test -- "solar/meter-files"`
Expected: PASS (register, parse, commit route tests).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/api/projects/[id]/solar/meter-files/parse" "apps/web/src/app/api/projects/[id]/solar/meter-files/commit"
git commit -m "$(cat <<'EOF'
feat(solar): meter-files parse (review models) and commit (series / register / skip) routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: RBAC matrix, repo-wide guards, suites, push, update the PR

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Add the API rows**

In `docs/rbac-matrix.md`, directly after the `## API routes (\`apps/web/src/app/api/*\`)` table (before `## Server actions`), add:

```markdown
### Solar meter data API (Phase 3a)

Gated by `requireSolarLevelAPI(…, 'edit')` (JSON 401/403): the caller needs **Solar Edit** on the project,
i.e. an org owner/admin of the project's org (always `edit_financials`) or a user holding an `edit` /
`edit_financials` grant in `solar.project_access`, with the org's Solar subscription live. Suppliers and
client viewers can never hold a grant (00208); external project members are capped at View and are refused.
Everything is written with the caller's client, so the `solar` RLS policies (00211) apply as well.

| Endpoint | Needs | Writes |
|---|---|---|
| `POST /api/projects/[id]/solar/meter-files` | Solar Edit | `solar.meter_files` (path must be `<org>/<project>/<sha256>.<ext>`; the sha is recomputed from the stored bytes) |
| `POST /api/projects/[id]/solar/meter-files/parse` | Solar Edit | `solar.meter_import_reports`, `solar.meter_files` (detected facts, status) |
| `POST /api/projects/[id]/solar/meter-files/commit` | Solar Edit | `solar.meters`, `meter_channels`, readings via `solar.write_readings`, `meter_series_hashes`, `study_meters`, `meter_register`, `audit_events` |

Storage bucket `solar-meter-raw` (private): read needs Solar View on the path's project, upload needs Solar Edit; no update or delete.
```

- [ ] **Step 2: Run everything**

```bash
pnpm --filter @esite/shared test
pnpm --filter web test
pnpm --filter @esite/db test:ci
pnpm --filter @esite/shared type-check
pnpm --filter web type-check
pnpm --filter web lint
```
Expected: all green. `@esite/db` includes `anon-execute-secdef.test.ts`, which replays this migration's text: it passes only because every SECURITY DEFINER function in `solar` has its own `REVOKE … FROM anon` line. If it fails, add the missing line to the migration; never loosen the guard.

- [ ] **Step 3: Re-run the migration proof after the last edit to the migration**

```bash
scripts/db/dry-run-migration.sh /tmp/mig-3a.sql scripts/db/assert-solar-meter-data-roles.sql
```
(Rebuild `/tmp/mig-3a.sql` as in Task 5 Step 1 first.) Expected: every row ✓.

- [ ] **Step 4: Commit and push**

```bash
git add docs/rbac-matrix.md
git commit -m "$(cat <<'EOF'
docs(solar): rbac-matrix rows for the meter data API and raw bucket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git push git@github.com:WattMatt/e-site.git feat/solar-phase-3a
```

- [ ] **Step 5: Update the draft PR body**

```bash
PR=$(gh pr list --head feat/solar-phase-3a --json number -q '.[0].number')
cat > /tmp/pr-3a.md <<'EOF'
## Solar Phase 3a: meter data core (library + storage + import pipeline)

### 3a-i (library, no DB)
`@esite/shared/meter-data` (formats A/B/C/D/E/F/G/generic, fixed unit tables, SAST ts_end, quality flags 0-7, artefacts, identity/body hashes, registers, validation report, .xlsx) and `@esite/shared/solar-load` (day types with SA holidays, gap filling, reference-year alignment, common window, archetypes from GCR densities, synthesis, S1-S4, diversity, MD). 31 anonymised golden fixtures from the office corpus.

### 3a-ii (this push)
- Migration `00211_solar_meter_data.sql` (**number claimed at apply time; NOT applied**): org meter library, readings hash-partitioned x 8 and written only through `solar.write_readings`, study load tables, 8 seeded archetypes (contract-tested against the TS), private `solar-meter-raw` bucket.
- Dry run: 45/45 behavioural assertions green; red first (file aborts without the migration); mutations: drop `meters_insert_authz` -> `viewer_create_meter_REFUSED` red; keep partition grants -> `partition_direct_read_REFUSED` red; ignore subscription in the owner/admin arm -> `lapsed_admin_reads_nothing` red.
- D-23 volume test (2.1 M readings, rolled back): <paste the six measurement rows>. Decision: <keep / switch>.
- Routes (Solar Edit, JSON 401/403): register raw file (sha recomputed), parse (review models), commit (series / register / skip; server re-parse; identity must be resolved; readings counted back).

### Owner decisions needed
1. `.xls` consolidation summaries: save as CSV (no new dependency) or add SheetJS CE 0.20.3 from cdn.sheetjs.com (npm `xlsx` 0.18.5 carries unfixed CVEs).
2. External View users and the org meter library (currently: no access).
3. Format-A `Solar Total Power` label convention; spike threshold P95; GCR densities as operating-hour averages.

### Verification
shared / web / db suites green; shared + web type-check clean; web lint clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr edit "$PR" --body-file /tmp/pr-3a.md
```
Replace the two `<…>` markers with the real Task 6 numbers before running `gh pr edit`. The PR stays a draft.

---

### Task 14 (owner-gated, optional): read `.xls` consolidation summaries

**Do this task only if the owner approves adding the dependency** (open question 1). Otherwise users save the workbook as CSV and the existing register path handles it (the 9-column export keeps `Meter Filename` and `Status`; plan 3a-i's fixture is exactly that).

Why not `exceljs`: it reads `.xlsx` only. Why not npm `xlsx`: the registry's last release (0.18.5) has unfixed prototype-pollution and ReDoS advisories; the fixed SheetJS Community Edition is published only on the SheetJS CDN.

**Files:**
- Modify: `apps/web/package.json` (dependency)
- Create: `apps/web/src/lib/solar/meter-import/xls.ts` (+ `xls.test.ts`)
- Modify: `apps/web/src/lib/solar/meter-import/commit.ts` (`parseStoredFile`), `apps/web/src/app/api/projects/[id]/solar/meter-files/parse/route.ts`

- [ ] **Step 1: Add the pinned tarball**

```bash
pnpm --filter web add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
git diff pnpm-lock.yaml | grep -n "xlsx-0.20.3" | head -3
```
Expected: the lockfile records the tarball URL with an integrity hash.

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { readXlsRegister } from './xls'

function xls(): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Meter Filename', 'Matched Layout Name', 'Shop Number', 'Area (sqm)', 'Status'],
    ['SA - TENANT-23.csv', 'TENANT-23', 'SHOP 050', 3000, 'Direct/Substring'],
    ['SA - TENANT-04.csv', 'TENANT-04', 'CAR PARK', 14, 'Gemini LLM'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { bookType: 'biff8', type: 'array' }) as ArrayBuffer)
}

describe('readXlsRegister', () => {
  it('reads a legacy .xls summary into register rows with match methods', async () => {
    const o = await readXlsRegister(xls(), 'SITE YA_Consolidation_Summary.xls')
    expect(o.kind).toBe('register')
    expect(o.rows.map((r) => [r.tenantName, r.areaM2, r.matchMethod])).toEqual([['TENANT-23', 3000, 'exact'], ['TENANT-04', 14, 'llm']])
  })
})
```

- [ ] **Step 3: Implement `xls.ts`**

```ts
import * as XLSX from 'xlsx'
import { baseReport, issue, parseMeterFilename, parseSummaryMatrix, sha256Hex, type RegisterOutcome } from '@esite/shared/meter-data'

/** Legacy .xls consolidation summary → register outcome (first sheet). Server-only. */
export async function readXlsRegister(bytes: Uint8Array, fileName: string): Promise<RegisterOutcome> {
  const wb = XLSX.read(bytes, { type: 'array', dense: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(ws, { header: 1, raw: true, defval: null })
  const { rows, warnings } = parseSummaryMatrix(matrix)
  return {
    kind: 'register', format: 'G', fileSha256: await sha256Hex(bytes), filename: parseMeterFilename(fileName), rows,
    report: baseReport({ format: 'G', headerRow: 1, warnings, errors: [issue('register_file', 'A consolidation summary: use Import meter register.')] }),
  }
}
```

- [ ] **Step 4: Route `.xls` through it**

In `commit.ts` `parseStoredFile`, before the `.xlsx` branch, add:

```ts
  if (/\.xls$/i.test(file.original_name)) {
    const { readXlsRegister } = await import('./xls')
    return { outcome: await readXlsRegister(bytes, file.original_name), sheetName: null }
  }
```

In the parse route, replace the `outcomes` computation with:

```ts
    const outcomes: Array<{ sheetName: string | null; outcome: MeterParseOutcome }> = /\.xlsx$/i.test(file.original_name)
      ? (await parseMeterWorkbook({ bytes, fileName: file.original_name, options })).map((s) => ({ sheetName: s.sheetName, outcome: s.outcome }))
      : /\.xls$/i.test(file.original_name)
        ? [{ sheetName: null, outcome: await (await import('@/lib/solar/meter-import/xls')).readXlsRegister(bytes, file.original_name) }]
        : [{ sheetName: null, outcome: await parseMeterFile({ bytes, fileName: file.original_name, options }) }]
```

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter web test -- meter-import/xls "solar/meter-files"
pnpm --filter web type-check
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/solar/meter-import/xls.ts apps/web/src/lib/solar/meter-import/xls.test.ts apps/web/src/lib/solar/meter-import/commit.ts "apps/web/src/app/api/projects/[id]/solar/meter-files/parse/route.ts"
git commit -m "$(cat <<'EOF'
feat(solar): read legacy .xls consolidation summaries (SheetJS CE 0.20.3, CDN-pinned)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git push git@github.com:WattMatt/e-site.git feat/solar-phase-3a
```

---

## Hand-off (no apply)

- Migration `00211` is **not applied**. At apply time: re-check the ledger head, `origin/main` and open-PR migration filenames; rename if the number is taken; apply 00208 first if it is not yet in the ledger; then `scripts/verify-migration-applied.ts` checks the `@verify` block. No PostgREST `db_schema` PATCH is needed (`solar` is exposed by 00208).
- **Not verified here (needs a signed-in human, and the 3b UI):** a real browser upload to `solar-meter-raw` with the Storage policy, and a parse → commit round trip against production data. The routes are proven with an in-memory repository and the SQL with impersonation; the join between them (real supabase-js calls against the real schema) is first exercised in 3b.
