# Solar Phase 3b-0 — Foundation for the Load tab and Schematics (migration 00215, isAnnotated, pure load library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay everything the Load tab (plan 3b-i) and the Schematics tab (plan 3b-ii) stand on: migration `00215_solar_schematics.sql` (schematics, cards, lines, check acknowledgements, three `solar.studies` columns, two bulk-read functions, the schematic save RPC, the `solar_schematic_sheet` report kind and three product events), `isAnnotated()` coverage for the three drawing-anchored tables, and the pure `@esite/shared` functions that build the site series, derive every chart, guard against double counting and propose meter↔tenant matches.

**Architecture:** One migration, written test-first: behavioural impersonation assertions in `scripts/db/assert-solar-schematics-roles.sql` are run RED (00208–00211 only) then GREEN (00208–00211 + 00215) through `scripts/db/dry-run-migration.sh`, then mutation-proven. The site-load builder is a pure composition of the 3a library (`@esite/shared/solar-load`) — the server reads rows and readings, calls `buildSiteLoad`, and stores the result; the browser never computes load (functional spec §2.4 rule, engine spec §2). Chart data (`siteProfileCharts`), meter-chart downsampling (`minMaxBuckets`, `gapRanges`, `dailyHeatmap`), the supply hierarchy (`doubleCountGuard`, `reconcileParents`) and auto-match (`autoMatchMeters`) are pure and unit-tested.

**Tech Stack:** Postgres (Supabase) with `@verify` blocks; `scripts/db/dry-run-migration.sh`; Deno edge function (`cloud-sync-project`); TypeScript in `@esite/shared` (Vitest); `@esite/db` contract tests.

**Sequence:** this plan (3b-0) → `2026-09-28-solar-phase-3b-i-load.md` → `2026-09-28-solar-phase-3b-ii-schematics.md` (which ends with the three suites, the build, two reviewers, push and the draft PR). All three run on ONE branch, `feat/solar-phase-3b`.

**Specs:** `docs/solar/01-functional-spec.md` §0.4, §2.3, §4, §13; `docs/solar/02-calculation-engine-spec.md` §2; `docs/solar/03-data-model-and-security.md` §3 (rows `schematics`, `schematic_cards`, `schematic_lines`), §3.1, §5; migrations `00208`, `00211` (every convention is copied from them).

---

## Ground rules (read once)

- **Worktree:** `~/.config/superpowers/worktrees/esite/solar-phase-3b`, branch `feat/solar-phase-3b`, created from `origin/feat/solar-integration` (Task 1). Never modify any other branch or worktree. The integration branch is being assembled from `feat/solar-phase-1c` + merges of `4a`, `2a`, `3a`; if `origin/feat/solar-integration` does not exist yet when you start, STOP and ask — do not branch from 1c or 3a.
- **Migration number:** the file is `00215_solar_schematics.sql`. Numbers are claimed **at apply time**, not now: before the owner applies it, re-check the production ledger `max(version)`, `origin/main`, and the migration filenames in every open PR (CLAUDE.md "Claiming a number is not holding it"). If `00215` is taken, rename the file; every test in these plans finds it by the suffix `_solar_schematics.sql`, not by number.
- **Do not apply to production.** The dry runs are rolled-back transactions. Applying is an owner step after merge; `solar` is already in PostgREST `db_schema` (00208), so no schema PATCH is needed. **Edge deploy of `cloud-sync-project` is an owner step AFTER the migration applies** — deployed first, the three new lookups would error, and `isAnnotated()` fails CLOSED, i.e. every drawing would read as annotated and auto-adopt would stop platform-wide.
- **Conventions (00208/00211, mandatory):** no `BEGIN`/`COMMIT` in the file; every SECURITY DEFINER function has `SET search_path = ''` and its own spelled-out `REVOKE … FROM PUBLIC` **and** `REVOKE … FROM anon`; `organisation_id` / `project_id` bound by BEFORE triggers; `ENABLE` + `FORCE ROW LEVEL SECURITY` on every table; exactly one PERMISSIVE policy per verb plus one RESTRICTIVE policy per write verb; **never** a RESTRICTIVE `FOR ALL` or `FOR SELECT` (00208 re-checks that on every deploy); `sql:` payloads contain no em dash.
- **Three suites before claiming any task done that touches SQL or shared code:** `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter @esite/db test:ci`; plus `pnpm --filter @esite/shared type-check` and `pnpm --filter web type-check`.
- Commit after every task, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scratch files go in `$SCRATCH` = the session scratchpad (never `/tmp`).

## Design decisions made in this plan (owner should see them)

1. **One migration also carries the Load tab's remaining storage.** Besides the three schematic tables it adds `solar.studies.load_growth_pct` (spec §4.5, missing from 00211), `solar.studies.monthly_bills` (basis S4 needs twelve bills and there was nowhere to keep them), `solar.studies.schematic_waived` (§13.1), and `solar.load_check_acks` (Checks sub-tab "Mark as acknowledged" records who accepted a warning). The file name stays `_solar_schematics.sql` as the owner specified; the header lists everything.
2. **Two SECURITY INVOKER read functions, because PostgREST caps a response at 1,000 rows** (`config.toml` `max_rows = 1000`) and a meter holds 17,520 readings a year. `solar.channel_readings(channel_ids[], from, to)` returns ONE row per channel with parallel arrays; `solar.channel_summaries(channel_ids[])` returns first/last/count/usable/max/sum per channel. INVOKER means `meter_readings_select` (00211, including the linked-meter arm for external View members) decides what comes back — nothing is widened.
3. **Cards and lines denormalise `floor_plan_id`** (bound from the schematic by trigger, never from the client) so `isAnnotated()` and the schema-derived contract test can see them by that column, exactly like `solar.layout_objects` (00212).
4. **The drawing FK is `NO ACTION`**, like `solar.roof_sources`: a drawing that anchors a schematic cannot be hard-deleted underneath it (drawings are normally retired by `is_active = false`, which the bind refuses for NEW anchors only). Project deletion still works: the project cascade removes the schematic in the same statement.
5. **Replace drawing re-anchors in place** (spec §13.1): updating `floor_plan_id`/`page_index` re-stamps `file_path`/`source_revision_id` and an AFTER trigger carries the new `floor_plan_id` onto every card and line; card positions are kept.
6. **The supply hierarchy is a DAG, never a loop.** A `supply` line that would close a cycle anywhere in the study (across all its schematics) is refused by the database. `check` lines (a check meter beside a supply meter) do not enter the hierarchy.
7. **Only study meters can be placed** (`study_meters` row required), so a card can never reference another study's or another org's meter.
8. **Save is one INVOKER RPC** `public.solar_save_schematic(id, expected_updated_at, cards, lines)` — replace-all inside one transaction, stale write refused with SQLSTATE `40001` (the 00212 layout pattern).
9. **`solar_schematic_sheet` reads at Solar View** (no rand values). `user_can_read_report_kind()` is redefined IN FULL keeping 00183's branches and ALSO the `solar_layout_sheet` branch Phase 5 (00212) adds, so whichever of 00212/00215 applies last, both kinds stay gated.
10. **SUPERSEDED (owner decision 2026-09-29): no new `product_events` verbs — audit only (`recordSolarAudit`). 00215 does not touch `product_events_event_check`; the text below is kept as the historical plan.** ~~**Product events** `solar_site_load_built`, `solar_schematic_saved`, `solar_schematic_sheet_exported` (spec §0.4 rule 8). The CHECK is re-declared in full (00209's list + these three).~~
11. **The builder's reading of "Sum of tenants":** the stored basis is `S2`; when no tenant ends up metered the result is recorded as effective `S3` (all synthesised), which is what enables the diversity factor (engine §2.5). Tenants with no `tenant_load_basis` row are synthesised from the tenant schedule and counted as **unassigned** (readiness stays amber until the user chooses).
13. **Beneficial occupation inside the reference year only.** The 3a `synthesiseTenant` zeroes dates before the BO date *of the reference year*; a BO date in a later calendar year (normal at design stage) would zero the whole year. The builder passes the BO date only when it falls inside the reference year; the year-1 ramp for a later BO belongs to the cashflow (which knows the commercial operation date). **Owner may prefer otherwise — open question.**
12. **Double-count guard (§13.3):** when a parent meter and any of its descendants are both assigned, the descendants are used and the parent is dropped from the series; a tenant whose only meters were dropped contributes nothing (`covered_by_children`) rather than being re-synthesised.

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00215_solar_schematics.sql` | The migration |
| `scripts/db/assert-solar-schematics-roles.sql` | Behavioural impersonation assertions (red → green, mutation-proven) |
| `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` | `isAnnotated()` gains three lookups |
| `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` | Known-table list gains the three tables |
| `apps/web/src/lib/reports/report-kind-access.ts` (+ contract test) | `SOLAR_READ_REPORT_KINDS` |
| `apps/web/src/actions/project-reports.actions.ts` (+ `project-reports.solar-gate.test.ts`) | Solar kinds read/delete on the Solar level |
| `packages/shared/src/lib/analytics/product-events.ts` | Three new verbs |
| `packages/shared/src/services/solar/load/hierarchy.ts` (+ test) | Supply children, cycle test, double-count guard, parent reconciliation |
| `packages/shared/src/services/solar/load/profile-stats.ts` (+ test) | Every site-profile chart and KPI from the 8760 series; full-resolution CSV rows |
| `packages/shared/src/services/solar/load/downsample.ts` (+ test) | Min/max buckets, gap ranges, daily heatmap for meter charts |
| `packages/shared/src/services/solar/load/auto-match.ts` (+ test) | Meter ↔ tenant proposals; LLM/UNMAPPED never pre-ticked |
| `packages/shared/src/services/solar/load/build-site-load.ts` (+ test) | The site-load builder (S1/S2/S3/S4, reconciliation, checks, tenant summaries) |
| `packages/shared/src/services/solar/load/index.ts` | Barrel exports |
| `packages/shared/src/solar/load-settings.ts` (+ test) | Load settings + monthly bills form ↔ row, validation |
| `packages/shared/src/solar/readiness.ts` (+ test) | `loadReadiness`, `schematicsReadiness`, `computeSolarReadiness(…, extra)` |
| `packages/shared/src/solar/index.ts` | Export `load-settings` |

---

### Task 1: Worktree, branch and baseline

**Files:** none.

- [ ] **Step 1: Create the worktree from the integration branch**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite"
git fetch origin
git rev-parse --verify origin/feat/solar-integration   # must print a sha; if not, STOP and ask
git worktree add ~/.config/superpowers/worktrees/esite/solar-phase-3b -b feat/solar-phase-3b origin/feat/solar-integration
cd ~/.config/superpowers/worktrees/esite/solar-phase-3b
pnpm install --frozen-lockfile
```

Expected: worktree created, install completes.

- [ ] **Step 2: Confirm the prerequisites are on the branch**

```bash
ls apps/edge-functions/supabase/migrations/ | grep -E '^002(0[7-9]|1[0-3])_'
ls packages/shared/src/services/solar/load/site-series.ts packages/shared/src/meter-data/parse-meter-file.ts
ls apps/web/src/lib/solar/api-gate.ts apps/web/src/lib/solar/meter-import/commit.ts
ls "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx" apps/web/src/lib/sheet/use-sheet-viewport.ts
grep -n "SOLAR_READ_REPORT_KINDS" apps/web/src/lib/reports/report-kind-access.ts || echo "phase 5 not merged (expected)"
```

Expected: `00208`, `00209`, `00210`, `00211` listed (no `00215`); every `ls` finds its file; the grep prints "phase 5 not merged (expected)". If `SOLAR_READ_REPORT_KINDS` IS present, Phase 5 has been merged into integration: in Task 6 add only the `solar_schematic_sheet` entry and the extra `WHEN` line, and skip the parts marked "(skip if Phase 5 is merged)".

- [ ] **Step 3: Record the baseline counts**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4 > "$SCRATCH/3b-baseline.txt"
pnpm --filter web test 2>&1 | tail -4 >> "$SCRATCH/3b-baseline.txt"
pnpm --filter @esite/db test:ci 2>&1 | tail -4 >> "$SCRATCH/3b-baseline.txt"
cat "$SCRATCH/3b-baseline.txt"
```

Expected: three green summaries. Write the three test counts into the PR body later. If anything is red on the base, STOP and report it — do not start on a red base.

---

### Task 2: Behavioural assertions first (they must fail before the migration exists)

**Files:**
- Create: `scripts/db/assert-solar-schematics-roles.sql`

- [ ] **Step 1: Write the assertions file**

```sql
-- BEHAVIOURAL assertions for 00215_solar_schematics (Solar Phase 3b), run as real roles.
--   cat 00208 00209 00210 00211            > $SCRATCH/3b-red.sql    ; dry-run-migration.sh $SCRATCH/3b-red.sql   <this file>  (expect RED)
--   cat 00208 00209 00210 00211 00215      > $SCRATCH/3b-green.sql  ; dry-run-migration.sh $SCRATCH/3b-green.sql <this file>  (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses the
-- paywall, so it has no negative case). All seeding happens as postgres BEFORE the first impersonation:
-- request.jwt.claims is transaction-local and outlives RESET ROLE; it is cleared before later postgres steps.
-- REFUSAL PATTERN (as 00208/00211): a "..._REFUSED" check catches ONLY the SQLSTATE the design promises;
-- if the statement is wrongly allowed the block raises P0001 itself so the write is rolled back; any
-- other error records false instead of aborting the file.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_fp1     UUID := gen_random_uuid();   -- active drawing on v_p
  v_fp2     UUID := gen_random_uuid();   -- drawing on v_p2
  v_fp3     UUID := gen_random_uuid();   -- inactive drawing on v_p
  v_fp4     UUID := gen_random_uuid();   -- second active drawing on v_p (replace target)
  v_study   UUID;
  v_study2  UUID;
  v_m1      UUID;
  v_m2      UUID;
  v_m3      UUID;   -- linked, never placed
  v_mx      UUID;   -- org meter NOT linked to the study
  v_mf      UUID;   -- org2 meter linked to study2
  v_ch      UUID;
  v_sch     UUID;
  v_sch2    UUID;
  v_blank   UUID;
  v_ack     UUID;
  v_ts      TIMESTAMPTZ;
  v_ts2     TIMESTAMPTZ;
  v_n       INT;
  v_t       TEXT;
  v_u       UUID;
  u         UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-3b-probe'), (v_org2, 'solar-3b-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-3b-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_view, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-3b-probe-p', v_admin), (v_p2, v_org2, 'solar-3b-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_view, v_org, 'contractor', TRUE),
    (v_p, v_nogrant, v_org, 'contractor', TRUE), (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p, v_edit, 'edit'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, source_revision_id) VALUES
    (v_fp1, v_org, v_p, 'SLD', 'probe/p/sld-v1.pdf', v_admin, 'rev-1'),
    (v_fp2, v_org2, v_p2, 'Other SLD', 'probe/p2/sld.pdf', v_foreign, NULL),
    (v_fp3, v_org, v_p, 'Retired SLD', 'probe/p/old.pdf', v_admin, NULL),
    (v_fp4, v_org, v_p, 'SLD rev B', 'probe/p/sld-v2.pdf', v_admin, 'rev-2');
  UPDATE tenants.floor_plans SET is_active = FALSE WHERE id = v_fp3;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Bulk', 'bulk') RETURNING id INTO v_m1;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 1', 'tenant') RETURNING id INTO v_m2;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 2', 'tenant') RETURNING id INTO v_m3;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Unlinked', 'tenant') RETURNING id INTO v_mx;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org2, 'Foreign', 'tenant') RETURNING id INTO v_mf;
  INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_m1), (v_study, v_m2), (v_study, v_m3), (v_study2, v_mf);
  INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit, interval_min, tz_convention, parser_version)
    VALUES (v_m2, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'end', 'probe') RETURNING id INTO v_ch;
  PERFORM solar.write_readings(v_ch, ARRAY['2025-03-10 00:30+02', '2025-03-10 01:00+02', '2025-03-10 01:30+02']::timestamptz[],
                               ARRAY[1.5, 2.5, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]);

  -- ── 1. Editor: schematics, anchors, cards, lines ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id, page_index, file_path, organisation_id)
    VALUES (v_study, 'Main SLD', 'drawing', v_fp1, 2, 'forged.pdf', v_org2)
    RETURNING id, file_path, organisation_id INTO v_sch, v_t, v_u;
    INSERT INTO _r VALUES ('editor_creates_schematic_anchor_stamped',
      v_t = 'probe/p/sld-v1.pdf' AND v_u = v_org
      AND (SELECT source_revision_id FROM solar.schematics WHERE id = v_sch) = 'rev-1');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_schematic_anchor_stamped', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id) VALUES (v_study, 'Foreign sheet', 'drawing', v_fp2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('schematic_foreign_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_foreign_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id) VALUES (v_study, 'Retired sheet', 'drawing', v_fp3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('schematic_inactive_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_inactive_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id, file_path) VALUES (v_study, 'Blank', 'blank', v_fp1, 'x.pdf')
    RETURNING id INTO v_blank;
    INSERT INTO _r VALUES ('blank_schematic_has_no_anchor',
      (SELECT floor_plan_id IS NULL AND file_path IS NULL AND page_index = 1 FROM solar.schematics WHERE id = v_blank));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('blank_schematic_has_no_anchor', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, '  main sld ', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('schematic_duplicate_name_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_duplicate_name_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h, floor_plan_id) VALUES (v_sch, v_m1, 10, 20, 160, 70, v_fp2);
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_m2, 300, 20, 160, 70);
    INSERT INTO _r VALUES ('editor_places_study_meters_anchor_bound',
      (SELECT bool_and(floor_plan_id = v_fp1 AND project_id = v_p) FROM solar.schematic_cards WHERE schematic_id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_places_study_meters_anchor_bound', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_mx, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('card_unlinked_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('card_unlinked_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_mf, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('card_foreign_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('card_foreign_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints) VALUES (v_sch, v_m1, v_m2, '[100, 50, 200, 50]');
    INSERT INTO _r VALUES ('editor_connects_placed_meters_anchor_bound',
      (SELECT floor_plan_id = v_fp1 FROM solar.schematic_lines WHERE schematic_id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_connects_placed_meters_anchor_bound', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch, v_m1, v_m3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_unplaced_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_unplaced_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints) VALUES (v_sch, v_m1, v_m2, '[1, 2, 3]');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_odd_waypoints_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_odd_waypoints_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch, v_m2, v_m1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_cycle_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_cycle_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Second', 'blank') RETURNING id INTO v_sch2;
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch2, v_m1, 0, 0, 100, 50), (v_sch2, v_m2, 0, 100, 100, 50);
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch2, v_m2, v_m1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_cycle_across_schematics_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_cycle_across_schematics_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, line_type) VALUES (v_sch, v_m2, v_m1, 'check');
    INSERT INTO _r VALUES ('check_line_is_outside_the_hierarchy', true);
    DELETE FROM solar.schematic_lines WHERE schematic_id = v_sch AND line_type = 'check';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('check_line_is_outside_the_hierarchy', false);
  END;
  BEGIN
    UPDATE solar.schematics SET floor_plan_id = v_fp4, page_index = 1 WHERE id = v_sch;
    INSERT INTO _r VALUES ('replace_drawing_restamps_and_propagates',
      (SELECT file_path = 'probe/p/sld-v2.pdf' AND source_revision_id = 'rev-2' FROM solar.schematics WHERE id = v_sch)
      AND (SELECT bool_and(floor_plan_id = v_fp4) FROM solar.schematic_cards WHERE schematic_id = v_sch)
      AND (SELECT bool_and(floor_plan_id = v_fp4) FROM solar.schematic_lines WHERE schematic_id = v_sch)
      AND (SELECT x = 10 FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m1));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('replace_drawing_restamps_and_propagates', false);
  END;
  BEGIN
    UPDATE solar.schematics SET name = 'Main SLD (renamed)' WHERE id = v_sch;
    INSERT INTO _r VALUES ('rename_keeps_anchor', (SELECT file_path = 'probe/p/sld-v2.pdf' FROM solar.schematics WHERE id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('rename_keeps_anchor', false);
  END;
  BEGIN
    DELETE FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m2;
    INSERT INTO _r VALUES ('delete_card_deletes_its_lines', (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('delete_card_deletes_its_lines', false);
  END;

  -- ── 2. The save RPC (replace-all, stale refused) ──────────────────────────
  BEGIN
    SELECT updated_at INTO v_ts FROM solar.schematics WHERE id = v_sch;
    SELECT public.solar_save_schematic(v_sch, v_ts,
      jsonb_build_array(
        jsonb_build_object('meterId', v_m1, 'x', 5, 'y', 5, 'w', 150, 'h', 60),
        jsonb_build_object('meterId', v_m2, 'x', 5, 'y', 200, 'w', 150, 'h', 60, 'colour', '#2563eb')),
      jsonb_build_array(jsonb_build_object('fromMeterId', v_m1, 'toMeterId', v_m2, 'waypoints', jsonb_build_array(80, 120))))
      INTO v_ts2;
    INSERT INTO _r VALUES ('save_rpc_roundtrip',
      v_ts2 > v_ts
      AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2
      AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 1
      AND (SELECT colour = '#2563eb' FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m2));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('save_rpc_roundtrip', false);
  END;
  BEGIN
    PERFORM public.solar_save_schematic(v_sch, v_ts, '[]'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('save_rpc_stale_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('save_rpc_stale_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('stale_save_changed_nothing', (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2);

  -- ── 3. Acknowledgements, studies columns, bulk reads ──────────────────────
  BEGIN
    INSERT INTO solar.load_check_acks (study_id, check_key, note, acknowledged_by, organisation_id)
    VALUES (v_study, ' recon_bulk:x:3 ', 'known: common area', v_admin, v_org2) RETURNING id INTO v_ack;
    INSERT INTO _r VALUES ('editor_acks_attributed_to_self',
      (SELECT acknowledged_by = v_edit AND organisation_id = v_org AND check_key = 'recon_bulk:x:3' FROM solar.load_check_acks WHERE id = v_ack));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_acks_attributed_to_self', false);
  END;
  BEGIN
    UPDATE solar.load_check_acks SET note = 'edited' WHERE id = v_ack;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ack_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ack_update_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET schematic_waived = TRUE, load_growth_pct = 2.5,
      monthly_bills = '{"archetype":"retail","powerFactor":0.95,"months":[]}'::jsonb WHERE id = v_study;
    INSERT INTO _r VALUES ('editor_sets_new_study_columns',
      (SELECT schematic_waived AND load_growth_pct = 2.5 FROM solar.studies WHERE id = v_study));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_sets_new_study_columns', false);
  END;
  BEGIN
    UPDATE solar.studies SET load_growth_pct = 99 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('load_growth_out_of_range_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('load_growth_out_of_range_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET monthly_bills = '[1,2]'::jsonb WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('monthly_bills_not_object_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('monthly_bills_not_object_REFUSED', false);
  END;
  BEGIN
    SELECT cardinality(ts_ends) INTO v_n FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11');
    INSERT INTO _r VALUES ('editor_bulk_reads_readings', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_bulk_reads_readings', false);
  END;
  BEGIN
    SELECT n_rows::int INTO v_n FROM solar.channel_summaries(ARRAY[v_ch]) WHERE n_usable = 2 AND max_value = 2.5 AND sum_value = 4;
    INSERT INTO _r VALUES ('editor_reads_channel_summary', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_reads_channel_summary', false);
  END;
  BEGIN
    PERFORM * FROM solar.channel_readings(ARRAY[v_ch], '2020-01-01', '2026-01-01');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN invalid_parameter_value THEN INSERT INTO _r VALUES ('bulk_read_window_too_long_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bulk_read_window_too_long_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 4. Viewer: reads, never writes ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('viewer_reads_schematics',
    (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) >= 2
    AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2
    AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 1
    AND (SELECT count(*) FROM solar.load_check_acks WHERE study_id = v_study) = 1);
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Viewer', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_insert_schematic_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_insert_schematic_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_blank, v_m3, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_insert_card_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_insert_card_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.schematic_cards SET x = 999 WHERE schematic_id = v_sch;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('viewer_update_card_no_effect', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('viewer_update_card_no_effect', false);
  END;
  BEGIN
    PERFORM public.solar_save_schematic(v_sch, v_ts2, '[]'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_save_rpc_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_save_rpc_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.load_check_acks (study_id, check_key) VALUES (v_study, 'viewer:ack');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_ack_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_ack_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('viewer_reads_readings_rpc',
    (SELECT cardinality(ts_ends) FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11')) = 3);
  INSERT INTO _r VALUES ('viewer_reads_schematic_sheet_kind', public.user_can_read_report_kind(v_p, 'solar_schematic_sheet'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. No grant, forged client grant, foreign admin: read nothing ─────────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('outsider_reads_nothing:' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) = 0
      AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 0
      AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 0
      AND (SELECT count(*) FROM solar.load_check_acks WHERE study_id = v_study) = 0
      AND (SELECT count(*) FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11')) = 0
      AND NOT COALESCE(public.user_can_read_report_kind(v_p, 'solar_schematic_sheet'), false));
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;

  -- ── 6. Lapse: nobody reads or writes, rows kept ───────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_admin_reads_nothing', (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) = 0);
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Lapsed', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_insert_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2);

  -- ── 7. Service role bypasses RLS ───────────────────────────────────────────
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_schematics', (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) >= 2);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it RED (the migration does not exist yet)**

```bash
M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql > "$SCRATCH/3b-red.sql"
scripts/db/dry-run-migration.sh "$SCRATCH/3b-red.sql" scripts/db/assert-solar-schematics-roles.sql | tee "$SCRATCH/3b-dry-red.txt"
```

Expected: the file ABORTS on `relation "solar.schematics" does not exist` and is reported as one failed assertion. That is the RED state. If 00208–00211 are ALREADY in the production ledger (check first: `scripts/db/mgmt-api.sh`'s `mgmt_query "select max(version) from supabase_migrations.schema_migrations"`), use only the missing ones in the concatenation.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-solar-schematics-roles.sql
git commit -m "test(solar): behavioural RLS assertions for the schematics migration (red first)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The migration

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00215_solar_schematics.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ---------------------------------------------------------------------------
-- Migration 00215: Solar schematics (Phase 3b) — and the Load tab's remaining storage
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §4.3-§4.6, §13; docs/solar/03-data-model-and-security.md §3, §3.1, §5.
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-3b-0-foundation.md
--
-- WHAT.
--   solar.schematics, solar.schematic_cards, solar.schematic_lines — meters placed on the site's
--     single-line diagrams and the supply hierarchy between them. A schematic is anchored to a
--     drawing page like tenants.floor_plan_markups (file_path + source_revision_id stamped by
--     trigger); cards and lines denormalise floor_plan_id so cloud-sync-project's isAnnotated()
--     sees them (registered there in the same PR; edge deploy AFTER this applies).
--   solar.load_check_acks — "Mark as acknowledged" on Load -> Checks (append/delete only).
--   solar.studies gains load_growth_pct, monthly_bills (basis S4 input), schematic_waived.
--   solar.channel_readings / solar.channel_summaries — SECURITY INVOKER bulk reads, because
--     PostgREST caps a response at 1,000 rows and a meter holds 17,520 readings a year.
--   public.solar_save_schematic — replace-all save in one transaction; stale write = 40001.
--   public.user_can_read_report_kind — redefined IN FULL: 00183's branches + solar_layout_sheet
--     (00212) + solar_schematic_sheet, both at Solar View.
--   [SUPERSEDED 2026-09-29: owner — no new product_events verbs; audit only. Not in 00215 as built.]
--   public.product_events CHECK — re-declared in full (00209's list + three Solar verbs).
--
-- ACCESS. Every table has the 00208 study shape: SELECT = solar_can_view(project_id); each write verb
--   = a PERMISSIVE policy on solar_can_view plus a RESTRICTIVE policy on solar_can_edit. Lapse =
--   hidden but kept. The supply hierarchy may never contain a loop (refused by the line bind).
--
-- 00208's schema-wide @verify directives re-run on every deploy and this migration conforms: every
-- table has FORCE RLS; no RESTRICTIVE policy covers SELECT; every SECURITY DEFINER function in solar
-- has anon EXECUTE revoked.
--
-- DRAWING FK = NO ACTION (as solar.roof_sources): a drawing that anchors a schematic cannot be hard-
-- deleted under it. Project deletion still works: the project cascade removes the study, and with
-- it the schematic, in the same statement.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.schematics
-- table: solar.schematic_cards
-- table: solar.schematic_lines
-- table: solar.load_check_acks
-- column: solar.studies.load_growth_pct
-- column: solar.studies.monthly_bills
-- column: solar.studies.schematic_waived
-- column: solar.schematic_cards.floor_plan_id
-- column: solar.schematic_lines.floor_plan_id
-- constraint: schematics_shape ON solar.schematics
-- constraint: schematic_cards_one_per_meter ON solar.schematic_cards
-- constraint: schematic_lines_not_self ON solar.schematic_lines
-- constraint: schematic_lines_waypoints ON solar.schematic_lines
-- constraint: load_check_acks_key ON solar.load_check_acks
-- function: solar.schematics_bind()
-- function: solar.schematics_propagate_anchor()
-- function: solar.schematic_cards_bind()
-- function: solar.schematic_cards_cascade_lines()
-- function: solar.schematic_lines_bind()
-- function: solar.load_check_acks_stamp()
-- function: solar.channel_readings(uuid[], timestamptz, timestamptz)
-- function: solar.channel_summaries(uuid[])
-- function: public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- trigger: schematics_bind ON solar.schematics
-- trigger: schematics_propagate_anchor ON solar.schematics
-- trigger: schematic_cards_bind ON solar.schematic_cards
-- trigger: schematic_cards_cascade_lines ON solar.schematic_cards
-- trigger: schematic_lines_bind ON solar.schematic_lines
-- trigger: load_check_acks_bind ON solar.load_check_acks
-- trigger: load_check_acks_stamp ON solar.load_check_acks
-- index: schematic_cards_floor_plan_idx ON solar.schematic_cards
-- index: schematic_lines_floor_plan_idx ON solar.schematic_lines
-- index: schematics_floor_plan_idx ON solar.schematics
-- policy: schematics_select ON solar.schematics PERMISSIVE
-- policy: schematics_insert ON solar.schematics PERMISSIVE
-- policy: schematics_update ON solar.schematics PERMISSIVE
-- policy: schematics_delete ON solar.schematics PERMISSIVE
-- policy: schematics_insert_authz ON solar.schematics RESTRICTIVE
-- policy: schematics_update_authz ON solar.schematics RESTRICTIVE
-- policy: schematics_delete_authz ON solar.schematics RESTRICTIVE
-- policy: schematic_cards_select ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_insert ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_update ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_delete ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_insert_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_cards_update_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_cards_delete_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_lines_select ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_insert ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_update ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_delete ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_insert_authz ON solar.schematic_lines RESTRICTIVE
-- policy: schematic_lines_update_authz ON solar.schematic_lines RESTRICTIVE
-- policy: schematic_lines_delete_authz ON solar.schematic_lines RESTRICTIVE
-- policy: load_check_acks_select ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_insert ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_delete ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_insert_authz ON solar.load_check_acks RESTRICTIVE
-- policy: load_check_acks_delete_authz ON solar.load_check_acks RESTRICTIVE
-- grant_absent: anon SELECT ON solar.schematics
-- grant_absent: anon SELECT ON solar.schematic_cards
-- grant_absent: anon SELECT ON solar.schematic_lines
-- grant_absent: anon SELECT ON solar.load_check_acks
-- grant_absent: authenticated UPDATE ON solar.load_check_acks
-- grant_absent: anon EXECUTE ON solar.channel_readings(uuid[], timestamptz, timestamptz)
-- grant_absent: anon EXECUTE ON solar.channel_summaries(uuid[])
-- grant_absent: anon EXECUTE ON public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- grant_present: authenticated EXECUTE ON solar.channel_readings(uuid[], timestamptz, timestamptz)
-- grant_present: authenticated EXECUTE ON public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.channel_readings(uuid[], timestamptz, timestamptz)'::regprocedure)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.channel_summaries(uuid[])'::regprocedure)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)'::regprocedure)
-- sql: (SELECT strpos(pg_get_functiondef('public.user_can_read_report_kind(uuid, text)'::regprocedure), 'solar_schematic_sheet') > 0 AND strpos(pg_get_functiondef('public.user_can_read_report_kind(uuid, text)'::regprocedure), 'solar_layout_sheet') > 0)
-- [SUPERSEDED 2026-09-29: the next sql: line is NOT in 00215 as built — no product_events change.]
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_site_load_built%' AND pg_get_constraintdef(oid) LIKE '%solar_schematic_saved%' AND pg_get_constraintdef(oid) LIKE '%solar_schematic_sheet_exported%' AND pg_get_constraintdef(oid) LIKE '%solar_settings_saved%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- behaviour: scripts/db/assert-solar-schematics-roles.sql - every row ok
-- @verify:end

-- NO BEGIN/COMMIT (scripts/db/dry-run-migration.sh wraps this file in BEGIN ... ROLLBACK).

-- ── 0. solar.studies: the rest of the Load settings, and the schematic waiver ──
ALTER TABLE solar.studies
    ADD COLUMN IF NOT EXISTS load_growth_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (load_growth_pct BETWEEN -20 AND 20),
    ADD COLUMN IF NOT EXISTS monthly_bills    JSONB CHECK (monthly_bills IS NULL OR jsonb_typeof(monthly_bills) = 'object'),
    ADD COLUMN IF NOT EXISTS schematic_waived BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. Schematics ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    name                TEXT NOT NULL,
    description         TEXT CHECK (description IS NULL OR length(description) <= 2000),
    kind                TEXT NOT NULL CHECK (kind IN ('drawing', 'blank')),
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),   -- NO ACTION, see header
    page_index          INTEGER NOT NULL DEFAULT 1 CHECK (page_index >= 1),
    /* The file the sheet was when it was chosen. Stamped from the drawing by the bind trigger and
       compared on open (00205 pattern): a difference raises "positions may need adjusting". */
    file_path           TEXT,
    source_revision_id  TEXT,
    canvas_w            INTEGER NOT NULL DEFAULT 2400 CHECK (canvas_w BETWEEN 200 AND 20000),
    canvas_h            INTEGER NOT NULL DEFAULT 1600 CHECK (canvas_h BETWEEN 200 AND 20000),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematics_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT schematics_shape CHECK (
        (kind = 'drawing' AND floor_plan_id IS NOT NULL AND file_path IS NOT NULL)
        OR (kind = 'blank' AND floor_plan_id IS NULL AND file_path IS NULL AND source_revision_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS schematics_study_name_key ON solar.schematics (study_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS schematics_floor_plan_idx ON solar.schematics (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematics_project_idx ON solar.schematics (project_id);

CREATE OR REPLACE FUNCTION solar.schematics_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_restamp    BOOLEAN;
    v_fp_project UUID;
    v_fp_path    TEXT;
    v_fp_rev     TEXT;
    v_fp_active  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
            RAISE EXCEPTION 'solar.schematics: a schematic cannot move to another study or change kind' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        v_restamp := NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id OR NEW.page_index IS DISTINCT FROM OLD.page_index;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.schematics: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
        v_restamp := TRUE;
    END IF;
    IF NEW.kind = 'drawing' THEN
        IF v_restamp THEN
            SELECT fp.project_id, fp.file_path, fp.source_revision_id, fp.is_active
              INTO v_fp_project, v_fp_path, v_fp_rev, v_fp_active
              FROM tenants.floor_plans fp WHERE fp.id = NEW.floor_plan_id;
            IF v_fp_project IS NULL OR v_fp_project <> NEW.project_id THEN
                RAISE EXCEPTION 'solar.schematics: the drawing belongs to another project' USING ERRCODE = '23514';
            END IF;
            IF NOT v_fp_active THEN
                RAISE EXCEPTION 'solar.schematics: the drawing is no longer active' USING ERRCODE = '23514';
            END IF;
            NEW.file_path := v_fp_path;
            NEW.source_revision_id := v_fp_rev;
        ELSE
            NEW.file_path := OLD.file_path;
            NEW.source_revision_id := OLD.source_revision_id;
        END IF;
    ELSE
        NEW.floor_plan_id := NULL;
        NEW.file_path := NULL;
        NEW.source_revision_id := NULL;
        NEW.page_index := 1;
    END IF;
    NEW.name := btrim(NEW.name);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematics_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematics_bind() FROM anon;
CREATE TRIGGER schematics_bind BEFORE INSERT OR UPDATE ON solar.schematics
    FOR EACH ROW EXECUTE FUNCTION solar.schematics_bind();

-- Replace drawing: every card and line follows the schematic to the new sheet (positions kept).
CREATE OR REPLACE FUNCTION solar.schematics_propagate_anchor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE solar.schematic_cards c SET floor_plan_id = NEW.floor_plan_id
     WHERE c.schematic_id = NEW.id AND c.floor_plan_id IS DISTINCT FROM NEW.floor_plan_id;
    UPDATE solar.schematic_lines l SET floor_plan_id = NEW.floor_plan_id
     WHERE l.schematic_id = NEW.id AND l.floor_plan_id IS DISTINCT FROM NEW.floor_plan_id;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.schematics_propagate_anchor() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematics_propagate_anchor() FROM anon;

-- ── 2. Meter cards ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematic_cards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schematic_id     UUID NOT NULL REFERENCES solar.schematics(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    /* Denormalised from the schematic by the bind trigger, never trusted from the caller:
       cloud-sync-project's isAnnotated() looks the drawing up here. */
    floor_plan_id    UUID REFERENCES tenants.floor_plans(id),        -- NO ACTION, see header
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    x                NUMERIC NOT NULL,
    y                NUMERIC NOT NULL,
    w                NUMERIC NOT NULL CHECK (w > 0 AND w <= 5000),
    h                NUMERIC NOT NULL CHECK (h > 0 AND h <= 5000),
    colour           TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematic_cards_one_per_meter UNIQUE (schematic_id, meter_id)
);
CREATE INDEX IF NOT EXISTS schematic_cards_floor_plan_idx ON solar.schematic_cards (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematic_cards_meter_idx ON solar.schematic_cards (meter_id);

CREATE OR REPLACE FUNCTION solar.schematic_cards_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_study UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.schematic_id IS DISTINCT FROM OLD.schematic_id OR NEW.meter_id IS DISTINCT FROM OLD.meter_id) THEN
        RAISE EXCEPTION 'solar.schematic_cards: a card stays on its schematic and its meter' USING ERRCODE = '42501';
    END IF;
    SELECT s.study_id, s.project_id, s.organisation_id, s.floor_plan_id
      INTO v_study, NEW.project_id, NEW.organisation_id, NEW.floor_plan_id
      FROM solar.schematics s WHERE s.id = NEW.schematic_id;
    IF v_study IS NULL THEN
        RAISE EXCEPTION 'solar.schematic_cards: schematic % not found', NEW.schematic_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.study_meters sm WHERE sm.study_id = v_study AND sm.meter_id = NEW.meter_id) THEN
        RAISE EXCEPTION 'solar.schematic_cards: only a meter of this study can be placed' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_cards_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_cards_bind() FROM anon;
CREATE TRIGGER schematic_cards_bind BEFORE INSERT OR UPDATE ON solar.schematic_cards
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_cards_bind();

-- ── 3. Supply lines (the meter hierarchy) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematic_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schematic_id     UUID NOT NULL REFERENCES solar.schematics(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    floor_plan_id    UUID REFERENCES tenants.floor_plans(id),        -- NO ACTION, see header
    from_meter_id    UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    to_meter_id      UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    /* Flat [x1, y1, x2, y2, ...] in drawing-image pixels; endpoints are the cards' live anchors. */
    waypoints        JSONB NOT NULL DEFAULT '[]'::jsonb,
    line_type        TEXT NOT NULL DEFAULT 'supply' CHECK (line_type IN ('supply', 'check')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematic_lines_not_self CHECK (from_meter_id <> to_meter_id),
    CONSTRAINT schematic_lines_waypoints CHECK (jsonb_typeof(waypoints) = 'array'
        AND jsonb_array_length(waypoints) <= 400 AND jsonb_array_length(waypoints) % 2 = 0),
    CONSTRAINT schematic_lines_pair_key UNIQUE (schematic_id, from_meter_id, to_meter_id, line_type)
);
CREATE INDEX IF NOT EXISTS schematic_lines_floor_plan_idx ON solar.schematic_lines (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematic_lines_project_idx ON solar.schematic_lines (project_id);

CREATE OR REPLACE FUNCTION solar.schematic_lines_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_study UUID;
    v_n     INTEGER;
    v_loop  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.schematic_id IS DISTINCT FROM OLD.schematic_id THEN
        RAISE EXCEPTION 'solar.schematic_lines: a line stays on its schematic' USING ERRCODE = '42501';
    END IF;
    SELECT s.study_id, s.project_id, s.organisation_id, s.floor_plan_id
      INTO v_study, NEW.project_id, NEW.organisation_id, NEW.floor_plan_id
      FROM solar.schematics s WHERE s.id = NEW.schematic_id;
    IF v_study IS NULL THEN
        RAISE EXCEPTION 'solar.schematic_lines: schematic % not found', NEW.schematic_id USING ERRCODE = '23503';
    END IF;
    SELECT count(*) INTO v_n FROM solar.schematic_cards c
     WHERE c.schematic_id = NEW.schematic_id AND c.meter_id IN (NEW.from_meter_id, NEW.to_meter_id);
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'solar.schematic_lines: both meters must be placed on this schematic' USING ERRCODE = '23514';
    END IF;
    IF NEW.line_type = 'supply' THEN
        -- A supply line may not close a loop anywhere in the study: the hierarchy must stay acyclic.
        WITH RECURSIVE down(m) AS (
            SELECT l.to_meter_id FROM solar.schematic_lines l JOIN solar.schematics s ON s.id = l.schematic_id
             WHERE s.study_id = v_study AND l.line_type = 'supply' AND l.from_meter_id = NEW.to_meter_id
               AND l.id IS DISTINCT FROM NEW.id
            UNION
            SELECT l.to_meter_id FROM solar.schematic_lines l JOIN solar.schematics s ON s.id = l.schematic_id
              JOIN down d ON l.from_meter_id = d.m
             WHERE s.study_id = v_study AND l.line_type = 'supply' AND l.id IS DISTINCT FROM NEW.id
        )
        SELECT EXISTS (SELECT 1 FROM down WHERE m = NEW.from_meter_id) INTO v_loop;
        IF v_loop THEN
            RAISE EXCEPTION 'solar.schematic_lines: this connection would make a loop in the supply hierarchy' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_lines_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_lines_bind() FROM anon;
CREATE TRIGGER schematic_lines_bind BEFORE INSERT OR UPDATE ON solar.schematic_lines
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_lines_bind();

-- Deleting a card deletes its lines (spec §13.2 "Deleting a card deletes its lines"; WM left them behind).
CREATE OR REPLACE FUNCTION solar.schematic_cards_cascade_lines()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM solar.schematic_lines l
     WHERE l.schematic_id = OLD.schematic_id AND (l.from_meter_id = OLD.meter_id OR l.to_meter_id = OLD.meter_id);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_cards_cascade_lines() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_cards_cascade_lines() FROM anon;
CREATE TRIGGER schematic_cards_cascade_lines AFTER DELETE ON solar.schematic_cards
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_cards_cascade_lines();

-- Created after both child tables exist (it updates them).
CREATE TRIGGER schematics_propagate_anchor AFTER UPDATE OF floor_plan_id ON solar.schematics
    FOR EACH ROW EXECUTE FUNCTION solar.schematics_propagate_anchor();

-- ── 4. Check acknowledgements (Load -> Checks) ────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.load_check_acks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    check_key        TEXT NOT NULL CHECK (length(btrim(check_key)) BETWEEN 1 AND 300),
    note             TEXT CHECK (note IS NULL OR length(note) <= 1000),
    acknowledged_by  UUID REFERENCES auth.users(id),
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT load_check_acks_key UNIQUE (study_id, check_key)
);
-- 00211's study_scoped_bind binds project + org from the study (and pins study_id on UPDATE).
CREATE TRIGGER load_check_acks_bind BEFORE INSERT ON solar.load_check_acks
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

CREATE OR REPLACE FUNCTION solar.load_check_acks_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    NEW.check_key := btrim(NEW.check_key);
    NEW.acknowledged_by := COALESCE(auth.uid(), NEW.acknowledged_by);
    NEW.acknowledged_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.load_check_acks_stamp() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.load_check_acks_stamp() FROM anon;
-- Named to sort after load_check_acks_bind.
CREATE TRIGGER load_check_acks_stamp BEFORE INSERT ON solar.load_check_acks
    FOR EACH ROW EXECUTE FUNCTION solar.load_check_acks_stamp();

-- ── 5. Bulk reads (SECURITY INVOKER: meter_readings_select decides) ──────────
-- One row per channel with parallel arrays, so a year of 30-min readings is one row, not 17,520
-- (PostgREST caps responses at max_rows = 1000). Window at most 1,500 days; at most 20 channels.
CREATE OR REPLACE FUNCTION solar.channel_readings(p_channel_ids UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (channel UUID, ts_ends TIMESTAMPTZ[], vals DOUBLE PRECISION[], quals SMALLINT[])
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_channel_ids IS NULL OR cardinality(p_channel_ids) = 0 OR cardinality(p_channel_ids) > 20 THEN
        RAISE EXCEPTION 'solar.channel_readings: between 1 and 20 channels per call' USING ERRCODE = '22023';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '1500 days' THEN
        RAISE EXCEPTION 'solar.channel_readings: the window must be positive and at most 1,500 days' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT r.channel_id,
           array_agg(r.ts_end ORDER BY r.ts_end),
           array_agg(r.value ORDER BY r.ts_end),
           array_agg(r.quality ORDER BY r.ts_end)
      FROM solar.meter_readings r
     WHERE r.channel_id = ANY (p_channel_ids) AND r.ts_end > p_from AND r.ts_end <= p_to
     GROUP BY r.channel_id;
END $$;
REVOKE ALL ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- Per-channel period and totals for the meters table and the load inputs hash. "Usable" is the
-- @esite/shared/meter-data isUsable rule: quality 0/2/7, or 3 with a non-negative value.
CREATE OR REPLACE FUNCTION solar.channel_summaries(p_channel_ids UUID[])
RETURNS TABLE (channel UUID, first_ts TIMESTAMPTZ, last_ts TIMESTAMPTZ, n_rows BIGINT, n_usable BIGINT,
               max_value DOUBLE PRECISION, sum_value DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_channel_ids IS NULL OR cardinality(p_channel_ids) > 500 THEN
        RAISE EXCEPTION 'solar.channel_summaries: at most 500 channels per call' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT r.channel_id, min(r.ts_end), max(r.ts_end), count(*),
           count(*) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0))),
           max(r.value) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0))),
           sum(r.value) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0)))
      FROM solar.meter_readings r
     WHERE r.channel_id = ANY (p_channel_ids)
     GROUP BY r.channel_id;
END $$;
REVOKE ALL ON FUNCTION solar.channel_summaries(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.channel_summaries(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION solar.channel_summaries(uuid[]) TO authenticated, service_role;

-- ── 6. Row level security ───────────────────────────────────────────────────
ALTER TABLE solar.schematics ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematics FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.load_check_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.load_check_acks FORCE ROW LEVEL SECURITY;

CREATE POLICY schematics_select ON solar.schematics FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematics_insert ON solar.schematics FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematics_update ON solar.schematics FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematics_delete ON solar.schematics FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematics_insert_authz ON solar.schematics AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematics_update_authz ON solar.schematics AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematics_delete_authz ON solar.schematics AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schematic_cards_select ON solar.schematic_cards FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_insert ON solar.schematic_cards FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_update ON solar.schematic_cards FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_delete ON solar.schematic_cards FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_insert_authz ON solar.schematic_cards AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_cards_update_authz ON solar.schematic_cards AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_cards_delete_authz ON solar.schematic_cards AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schematic_lines_select ON solar.schematic_lines FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_insert ON solar.schematic_lines FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_update ON solar.schematic_lines FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_delete ON solar.schematic_lines FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_insert_authz ON solar.schematic_lines AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_lines_update_authz ON solar.schematic_lines AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_lines_delete_authz ON solar.schematic_lines AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY load_check_acks_select ON solar.load_check_acks FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_insert ON solar.load_check_acks FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_delete ON solar.load_check_acks FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_insert_authz ON solar.load_check_acks AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY load_check_acks_delete_authz ON solar.load_check_acks AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.schematics, solar.schematic_cards, solar.schematic_lines TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.load_check_acks TO authenticated;
-- The schema's default privileges granted UPDATE at CREATE TABLE; an acknowledgement is not edited.
REVOKE UPDATE, TRUNCATE ON solar.load_check_acks FROM authenticated;
GRANT ALL ON solar.schematics, solar.schematic_cards, solar.schematic_lines, solar.load_check_acks TO service_role;
REVOKE ALL ON solar.schematics, solar.schematic_cards, solar.schematic_lines, solar.load_check_acks FROM anon;

-- ── 7. The save: one transaction, stale-refusing, RLS-decided ────────────────
CREATE OR REPLACE FUNCTION public.solar_save_schematic(
    p_schematic_id        UUID,
    p_expected_updated_at TIMESTAMPTZ,
    p_cards               JSONB,
    p_lines               JSONB
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_updated TIMESTAMPTZ;
    v_meters  UUID[];
    v_card    JSONB;
    v_line    JSONB;
BEGIN
    IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'solar_save_schematic: cards and lines must be arrays' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_cards) > 500 OR jsonb_array_length(p_lines) > 1000 THEN
        RAISE EXCEPTION 'solar_save_schematic: at most 500 cards and 1000 lines' USING ERRCODE = '54000';
    END IF;
    SELECT s.project_id INTO v_project FROM solar.schematics s WHERE s.id = p_schematic_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.schematics: schematic not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.solar_can_edit(v_project) THEN
        RAISE EXCEPTION 'solar.schematics: you cannot edit this schematic' USING ERRCODE = '42501';
    END IF;
    SELECT s.updated_at INTO v_updated FROM solar.schematics s WHERE s.id = p_schematic_id FOR UPDATE;
    IF v_updated IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.schematics: stale schematic' USING ERRCODE = '40001';
    END IF;
    SELECT COALESCE(array_agg((c ->> 'meterId')::uuid), '{}'::uuid[]) INTO v_meters FROM jsonb_array_elements(p_cards) c;
    DELETE FROM solar.schematic_lines l WHERE l.schematic_id = p_schematic_id;
    DELETE FROM solar.schematic_cards c WHERE c.schematic_id = p_schematic_id AND NOT (c.meter_id = ANY (v_meters));
    FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
        INSERT INTO solar.schematic_cards AS c (schematic_id, meter_id, x, y, w, h, colour)
        VALUES (p_schematic_id, (v_card ->> 'meterId')::uuid, (v_card ->> 'x')::numeric, (v_card ->> 'y')::numeric,
                (v_card ->> 'w')::numeric, (v_card ->> 'h')::numeric, NULLIF(v_card ->> 'colour', ''))
        ON CONFLICT (schematic_id, meter_id) DO UPDATE
           SET x = EXCLUDED.x, y = EXCLUDED.y, w = EXCLUDED.w, h = EXCLUDED.h, colour = EXCLUDED.colour;
    END LOOP;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints, line_type)
        VALUES (p_schematic_id, (v_line ->> 'fromMeterId')::uuid, (v_line ->> 'toMeterId')::uuid,
                COALESCE(v_line -> 'waypoints', '[]'::jsonb), COALESCE(NULLIF(v_line ->> 'lineType', ''), 'supply'));
    END LOOP;
    -- Touch the schematic: schematics_bind stamps updated_at / updated_by.
    UPDATE solar.schematics s SET name = s.name WHERE s.id = p_schematic_id RETURNING s.updated_at INTO v_updated;
    RETURN v_updated;
END $$;
REVOKE ALL ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) TO authenticated, service_role;

-- ── 8. Saved schematic sheets read like the Solar module ─────────────────────
-- Redefines 00183's function IN FULL (a CREATE OR REPLACE replaces the body). Every branch 00183 had
-- is kept byte-for-byte in meaning; solar_layout_sheet is Phase 5's (00212) and is kept here too so
-- the order in which 00212 and 00215 apply cannot drop either gate. A future Solar kind carrying
-- money must use solar_can_see_money, so this names each kind rather than matching solar_%.
CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_schematic_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

-- [SUPERSEDED 2026-09-29: owner — no new product_events verbs; audit only. Section 9 is NOT in 00215 as built.]
-- ── 9. Product events (re-declared in full: 00209's list + Solar Load/Schematics) ─
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved',
    'solar_site_load_built',
    'solar_schematic_saved',
    'solar_schematic_sheet_exported'
));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Re-check that no later migration already redefined the CHECK or the report-kind function**

```bash
M=apps/edge-functions/supabase/migrations
grep -ln "ADD CONSTRAINT product_events_event_check" $M/*.sql
grep -ln "CREATE OR REPLACE FUNCTION public.user_can_read_report_kind" $M/*.sql
```

Expected: the constraint's last definer before 00215 is `00209_solar_org_settings.sql`; the function's last definer before 00215 is `00183_…` (or `00212_solar_layouts.sql` if Phase 5 is merged). If any OTHER file between 00209 and 00215 re-declares the CHECK, copy its full list into section 9 and add the three Solar verbs; if another file redefines the function, copy its branches into section 8. Never drop a value or a branch.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00215_solar_schematics.sql
git commit -m "feat(solar): 00215 schematics, cards, lines, check acks, bulk reads, save RPC, report kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prove the migration red → green, with mutations, and verify the @verify block parses

**Files:** none committed except evidence notes in the PR body.

- [ ] **Step 1: GREEN run**

```bash
M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql $M/00215_solar_schematics.sql > "$SCRATCH/3b-green.sql"
scripts/db/dry-run-migration.sh "$SCRATCH/3b-green.sql" scripts/db/assert-solar-schematics-roles.sql | tee "$SCRATCH/3b-dry-green.txt"
grep -c "| t" "$SCRATCH/3b-dry-green.txt"; grep "| f" "$SCRATCH/3b-dry-green.txt" || echo "no failing rows"
```

Expected: every row `ok = t` (43 rows), "no failing rows". A red row means the migration or the assertion is wrong: fix the migration (never weaken an assertion to pass) and re-run.

- [ ] **Step 2: Mutation 1 — remove the RESTRICTIVE insert gate on cards (viewer must become able to write)**

```bash
sed '/CREATE POLICY schematic_cards_insert_authz/,+1d' "$SCRATCH/3b-green.sql" > "$SCRATCH/3b-mut1.sql"
scripts/db/dry-run-migration.sh "$SCRATCH/3b-mut1.sql" scripts/db/assert-solar-schematics-roles.sql | grep "| f"
```

Expected: `viewer_insert_card_REFUSED | f` (and nothing unrelated). (The mutated file also fails its own `@verify`, which is irrelevant here: the dry run does not run the verifier.)

- [ ] **Step 3: Mutation 2 — remove the study-meter check from the card bind**

```bash
python3 - "$SCRATCH/3b-green.sql" "$SCRATCH/3b-mut2.sql" <<'PY'
import sys
src = open(sys.argv[1]).read()
needle = "IF NOT EXISTS (SELECT 1 FROM solar.study_meters sm WHERE sm.study_id = v_study AND sm.meter_id = NEW.meter_id) THEN"
assert needle in src
out = src.replace(needle, "IF FALSE THEN")
open(sys.argv[2], "w").write(out)
PY
scripts/db/dry-run-migration.sh "$SCRATCH/3b-mut2.sql" scripts/db/assert-solar-schematics-roles.sql | grep "| f"
```

Expected: `card_unlinked_meter_REFUSED | f` and `card_foreign_meter_REFUSED | f`. (Python reads then writes two DIFFERENT paths — never `open(p,'w').write(open(p).read())`, which truncates first; CLAUDE.md gotcha.)

- [ ] **Step 4: Mutation 3 — remove the loop test**

```bash
python3 - "$SCRATCH/3b-green.sql" "$SCRATCH/3b-mut3.sql" <<'PY'
import sys
src = open(sys.argv[1]).read()
needle = "IF v_loop THEN"
assert src.count(needle) == 1
open(sys.argv[2], "w").write(src.replace(needle, "IF FALSE THEN"))
PY
scripts/db/dry-run-migration.sh "$SCRATCH/3b-mut3.sql" scripts/db/assert-solar-schematics-roles.sql | grep "| f"
```

Expected: `line_cycle_REFUSED | f` and `line_cycle_across_schematics_REFUSED | f`.

- [ ] **Step 5: Mutation 4 — open the schematic sheet kind to everyone**

```bash
python3 - "$SCRATCH/3b-green.sql" "$SCRATCH/3b-mut4.sql" <<'PY'
import sys
src = open(sys.argv[1]).read()
needle = "WHEN _kind = 'solar_schematic_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)"
assert src.count(needle) == 1
open(sys.argv[2], "w").write(src.replace(needle, "WHEN _kind = 'solar_schematic_sheet' THEN TRUE"))
PY
scripts/db/dry-run-migration.sh "$SCRATCH/3b-mut4.sql" scripts/db/assert-solar-schematics-roles.sql | grep "| f"
```

Expected: the three `outsider_reads_nothing:*` rows `f`.

- [ ] **Step 6: Mutation 5 — drop the stale check from the save RPC**

```bash
python3 - "$SCRATCH/3b-green.sql" "$SCRATCH/3b-mut5.sql" <<'PY'
import sys
src = open(sys.argv[1]).read()
needle = "IF v_updated IS DISTINCT FROM p_expected_updated_at THEN"
assert src.count(needle) == 1
open(sys.argv[2], "w").write(src.replace(needle, "IF FALSE THEN"))
PY
scripts/db/dry-run-migration.sh "$SCRATCH/3b-mut5.sql" scripts/db/assert-solar-schematics-roles.sql | grep "| f"
```

Expected: `save_rpc_stale_REFUSED | f` and `stale_save_changed_nothing | f`.

- [ ] **Step 7: Prove the `@verify` block PARSES (the dry run says nothing about it — #194)**

```bash
pnpm --filter @esite/db test:ci 2>&1 | tail -6
npx tsx scripts/verify-migration-applied.ts --parse-only apps/edge-functions/supabase/migrations/00215_solar_schematics.sql 2>&1 | tail -5 || true
```

Expected: `@esite/db` green (its guards read the migration TEXT: anon EXECUTE revokes spelled out, `@verify` grammar, no em dash in `sql:`). If `verify-migration-applied.ts` has no `--parse-only` flag, open it, find the exported parse function, and run it through `npx tsx -e "import('./scripts/verify-migration-applied.ts').then(m => console.log(m.parseVerifyBlock(require('fs').readFileSync(process.argv[1],'utf8'))))" <file>` using the function's real name. Every directive must parse; an unknown directive word is REFUSED by the parser.

- [ ] **Step 8: Record the evidence**

Append to `$SCRATCH/3b-evidence.md`: the green row count, and for each of the five mutations the exact rows that went red. This text goes in the PR body (Task 14 of plan 3b-ii).

---

### Task 5: `isAnnotated()` sees schematics, cards and lines; the contract test knows them

**Files:**
- Modify: `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` (inside `isAnnotated`, before the final `return false`)
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`

- [ ] **Step 1: Make the contract test demand the three tables (RED)**

In `floor-plan-annotated-predicate.contract.test.ts`, inside `it('discovers the tables we know are there', …)`, add three entries to the `for (const known of [...])` array, after `'tenants.floor_plan_versions',` (and after `'solar.layout_objects',` if Phase 5 is merged):

```ts
        'solar.schematics',
        'solar.schematic_cards',
        'solar.schematic_lines',
```

Run:

```bash
pnpm --filter @esite/db test:ci -- floor-plan-annotated-predicate 2>&1 | tail -20
```

Expected: FAIL — the first `it` lists `solar.schematics (defined in 00215_solar_schematics.sql)`, `solar.schematic_cards …`, `solar.schematic_lines …` as blind. (Discovery passes: 00215's CREATE TABLE bodies name `floor_plan_id`.)

- [ ] **Step 2: Add the three fail-closed lookups**

In `cloud-sync-project/index.ts`, in `isAnnotated()`, directly before its final `return false`, insert:

```ts
  // A Solar schematic (00215): a single-line diagram anchored to this drawing page.
  // Its own file_path records the revision it was placed on and the editor warns when
  // they diverge — but, as for markup layers, not adopting silently is the protection.
  const { data: schematic, error: sce } = await supabase
    .schema('solar')
    .from('schematics')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (sce || schematic) return true

  // Meter cards and supply lines (00215): x/y and waypoints in raw image pixels of THIS
  // file. Covered by the schematic above today (the FK chain), queried in their own right
  // so a future path that writes them cannot make the predicate blind.
  const { data: schematicCard, error: scc } = await supabase
    .schema('solar')
    .from('schematic_cards')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (scc || schematicCard) return true

  const { data: schematicLine, error: scl } = await supabase
    .schema('solar')
    .from('schematic_lines')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (scl || schematicLine) return true
```

Also extend the doc comment above the function: in the sentence listing what makes a drawing annotated, append ", a Solar schematic, meter card or supply line".

- [ ] **Step 3: Run it GREEN, and prove it can fail**

```bash
pnpm --filter @esite/db test:ci -- floor-plan-annotated-predicate 2>&1 | tail -8
```

Expected: PASS. Then mutation-prove: temporarily delete the `schematic_lines` block, re-run (expect FAIL naming `solar.schematic_lines`), restore it, re-run (PASS). Also check the fail-closed structure test still holds (`lookups ≤ return true` count, exactly one `return false`).

- [ ] **Step 4: Deno type-check the edge function**

```bash
cd apps/edge-functions/supabase/functions && deno check cloud-sync-project/index.ts && cd -
```

Expected: no errors. (If `deno` is not installed locally, record that in the PR body as "edge function not type-checked locally"; CI's edge job covers it.)

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/cloud-sync-project/index.ts packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
git commit -m "feat(solar): isAnnotated() sees schematics, meter cards and supply lines (fail-closed)

Edge deploy is an owner step AFTER 00215 applies: deployed first, the lookups
error and every drawing reads as annotated (auto-adopt stops platform-wide).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Solar report kinds read on the Solar level (`solar_schematic_sheet`)

**Files:**
- Modify: `apps/web/src/lib/reports/report-kind-access.ts`
- Modify: `apps/web/src/lib/reports/report-kind-access.contract.test.ts`
- Modify: `apps/web/src/actions/project-reports.actions.ts`
- Create: `apps/web/src/actions/project-reports.solar-gate.test.ts` (skip creating if Phase 5 is merged — then add the schematic cases to the existing file)

- [ ] **Step 1: Write the failing gate test**

```ts
// apps/web/src/actions/project-reports.solar-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getSolarAccessLevel: vi.fn(),
  requireEffectiveRole: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.getSolarAccessLevel }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole, requireRole: h.requireRole }))

import { listProjectReportsAction, getProjectReportUrlAction, deleteProjectReportAction } from './project-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '00000000-0000-0000-0000-000000000011'
const R = '00000000-0000-0000-0000-000000000055'
const ROW = {
  id: R, project_id: P, organisation_id: 'o', kind: 'solar_schematic_sheet', title: 'Schematic — Main SLD', storage_path: 'o/p/s.pdf',
  mime_type: 'application/pdf', size_bytes: 1, status: 'issued', version: 1, generated_by: null, generated_at: 't', created_at: 't',
}

beforeEach(() => {
  vi.clearAllMocks()
  const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW] } })
  h.createClient.mockResolvedValue(client)
  h.createServiceClient.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed' }, error: null })) }) },
  })
})

describe('Solar report kinds read on the Solar level', () => {
  it('lists solar_schematic_sheet for a caller with a View level (and never asks the role gate)', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    const res = await listProjectReportsAction(P, 'solar_schematic_sheet')
    expect(Array.isArray(res)).toBe(true)
    expect(h.requireEffectiveRole).not.toHaveBeenCalled()
  })
  it('refuses the list without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(listProjectReportsAction(P, 'solar_schematic_sheet')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('refuses the signed URL without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('mints the signed URL with a View level', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ url: 'https://signed' })
  })
  it('does not consult Solar for an ordinary kind', async () => {
    await listProjectReportsAction(P, 'tenant_schedule')
    expect(h.getSolarAccessLevel).not.toHaveBeenCalled()
  })
})

describe('deleteProjectReportAction — Solar kinds need Solar Edit', () => {
  it('an org writer with only Solar View cannot delete a schematic sheet', async () => {
    const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW], 'projects.projects': [{ id: P, organisation_id: 'o' }] } })
    h.createClient.mockResolvedValue(client)
    h.requireRole.mockResolvedValue({ ok: true })
    h.getSolarAccessLevel.mockResolvedValue('view')
    await expect(deleteProjectReportAction(P, R)).resolves.toEqual({ error: 'You do not have Solar edit access on this project.' })
  })
  it('Solar Edit may delete it', async () => {
    const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW], 'projects.projects': [{ id: P, organisation_id: 'o' }] } })
    h.createClient.mockResolvedValue(client)
    h.requireRole.mockResolvedValue({ ok: true })
    h.getSolarAccessLevel.mockResolvedValue('edit')
    h.createServiceClient.mockReturnValue({ storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })) }) } })
    await expect(deleteProjectReportAction(P, R)).resolves.toEqual({ ok: true })
  })
})
```

Run: `pnpm --filter web test -- project-reports.solar-gate` → Expected: FAIL (the list returns rows without a Solar check; `getSolarAccessLevel` is never called).

- [ ] **Step 2: Declare the Solar kinds** (skip the whole step except the one map entry if Phase 5 is merged)

In `report-kind-access.ts`, change the import line to:

```ts
import { ORG_WRITE_ROLES, COST_VIEW_ROLES, type OrgRole, type SolarAccessLevel } from '@esite/shared'
```

After `OPEN_READ_REPORT_KINDS`, add:

```ts
/**
 * Kinds whose read follows the Solar module's own gate: the caller's per-user
 * Solar level on the project (00208, decision D-04), not an E-Site role. A
 * contractor with a View grant reads a schematic sheet; a project manager with
 * no grant does not. Mirrored in public.user_can_read_report_kind() (00212 /
 * 00215) and pinned by report-kind-access.contract.test.ts against the FINAL
 * definition.
 */
export const SOLAR_READ_REPORT_KINDS: Readonly<Record<string, SolarAccessLevel>> = {
  // A drawing crop with arrays, strings, a legend and a title block — no rand values (Phase 5, 00212).
  solar_layout_sheet: 'view',
  // A single-line diagram with meter cards, supply lines and a legend — no rand values (00215).
  solar_schematic_sheet: 'view',
}

/** The Solar level required to read this kind, or null when it is not a Solar kind. */
export function solarLevelForKind(kind: string): SolarAccessLevel | null {
  return SOLAR_READ_REPORT_KINDS[kind] ?? null
}
```

and replace `hasDeclaredReadPolicy`'s body with:

```ts
  return kind in REPORT_KIND_READ_ROLES || OPEN_READ_REPORT_KINDS.includes(kind) || kind in SOLAR_READ_REPORT_KINDS
```

- [ ] **Step 3: Gate the three report actions on the Solar level** (skip if Phase 5 is merged — the hunk is identical)

In `project-reports.actions.ts`, replace the import of `readRolesForKind` with:

```ts
import { readRolesForKind, solarLevelForKind } from '@/lib/reports/report-kind-access'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { solarLevelAllows } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

const NO_SOLAR_ACCESS = 'You do not have Solar access on this project.'

/** Solar kinds read on the caller's Solar level (00212/00215 mirror this in SQL). Null when allowed or not a Solar kind. */
async function solarReadDenied(supabase: unknown, projectId: string, kind: string): Promise<string | null> {
  const need = solarLevelForKind(kind)
  if (!need) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
  return solarLevelAllows(level, need) ? null : NO_SOLAR_ACCESS
}
```

In `listProjectReportsAction`, directly after `const supabase = await createClient()`:

```ts
  const solarDenied = await solarReadDenied(supabase, projectId, kind)
  if (solarDenied) return { error: solarDenied }
```

In `getProjectReportUrlAction`, directly after `if (!report) return { error: 'Not found' }`:

```ts
  const solarDenied = await solarReadDenied(supabase, projectId, report.kind)
  if (solarDenied) return { error: solarDenied }
```

In `deleteProjectReportAction`, directly after its `if (!report) return { error: 'Not found' }`:

```ts
  // A Solar kind is removed on the Solar EDIT level, not just an org write role
  // (an org admin with only Solar View must not delete exported sheets).
  if (solarLevelForKind(report.kind)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
    if (!solarLevelAllows(level, 'edit')) return { error: 'You do not have Solar edit access on this project.' }
  }
```

- [ ] **Step 4: Pin the SQL mirror in the contract test** (skip if Phase 5 is merged — its test already iterates every entry of the map)

In `report-kind-access.contract.test.ts`, add `SOLAR_READ_REPORT_KINDS,` to the import list, and append inside the top-level `describe`:

```ts
  it('a kind is in exactly one of the three sets', () => {
    const solar = Object.keys(SOLAR_READ_REPORT_KINDS)
    for (const k of solar) {
      expect(k in REPORT_KIND_READ_ROLES, `${k} is both Solar-gated and role-gated`).toBe(false)
      expect(OPEN_READ_REPORT_KINDS.includes(k), `${k} is both Solar-gated and open`).toBe(false)
    }
  })

  it('every Solar-gated kind is gated in the FINAL user_can_read_report_kind()', () => {
    const dir = path.resolve(SRC_ROOT, '../../edge-functions/supabase/migrations')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    let body: string | null = null
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(')
      if (i === -1) continue
      const start = sql.indexOf('$function$', i)
      const end = sql.indexOf('$function$', start + 10)
      if (start !== -1 && end !== -1) body = sql.slice(start + 10, end)
    }
    expect(body, 'user_can_read_report_kind() not found in any migration').toBeTruthy()
    for (const [kind, level] of Object.entries(SOLAR_READ_REPORT_KINDS)) {
      const helper = level === 'view' ? 'solar_can_view' : level === 'edit' ? 'solar_can_edit' : 'solar_can_see_money'
      expect(body!, `${kind} is not gated in the final user_can_read_report_kind()`).toMatch(
        new RegExp(`_kind = '${kind}' THEN COALESCE\\(public\\.${helper}\\(_project_id\\), FALSE\\)`),
      )
    }
  })
```

(`SRC_ROOT`, `fs`, `path` already exist in that file; confirm with `grep -n "SRC_ROOT\|^import" apps/web/src/lib/reports/report-kind-access.contract.test.ts`.)

If Phase 5 is merged: add only `solar_schematic_sheet: 'view',` to its map (with the comment line above) and the new test file's cases.

- [ ] **Step 5: Run and prove the mirror can fail**

```bash
pnpm --filter web test -- project-reports.solar-gate report-kind-access 2>&1 | tail -8
```

Expected: PASS. Mutation: change the 00215 `WHEN _kind = 'solar_schematic_sheet' THEN COALESCE(public.solar_can_view…` line to `solar_can_edit`, re-run → the FINAL-definition test FAILS naming `solar_schematic_sheet`; restore → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/reports apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.solar-gate.test.ts
git commit -m "feat(solar): solar_schematic_sheet reads on the Solar level; SQL mirror pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Product-event registry gains the three verbs

> **SUPERSEDED (owner decision 2026-09-29): no new `product_events` verbs — audit only (`recordSolarAudit`). 00215 does not touch `product_events_event_check`; this task was SKIPPED; its text is kept as the historical plan.**

**Files:**
- Modify: `packages/shared/src/lib/analytics/product-events.ts`

- [ ] **Step 1: Run the contract test RED**

```bash
pnpm --filter @esite/shared test -- product-events.contract 2>&1 | tail -8
```

Expected: FAIL — the CHECK (now read from 00215, the last migration containing `ADD CONSTRAINT product_events_event_check`) has three values the registry lacks.

- [ ] **Step 2: Add the verbs**

In `PRODUCT_EVENTS`, after `'solar_settings_saved',` add:

```ts
  // Solar Load + Schematics (00215).
  'solar_site_load_built',
  'solar_schematic_saved',
  'solar_schematic_sheet_exported',
```

- [ ] **Step 3: Run GREEN and commit**

```bash
pnpm --filter @esite/shared test -- product-events.contract 2>&1 | tail -4
git add packages/shared/src/lib/analytics/product-events.ts
git commit -m "feat(solar): product events for site-load builds and schematic save/export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS.

---

### Task 8: Supply hierarchy — children, loops, double-count guard, parent reconciliation

**Files:**
- Create: `packages/shared/src/services/solar/load/hierarchy.ts`
- Test: `packages/shared/src/services/solar/load/hierarchy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { descendants, doubleCountGuard, reconcileParents, supplyChildren, wouldCreateCycle } from './hierarchy'

const L = (fromMeterId: string, toMeterId: string, lineType: 'supply' | 'check' = 'supply') => ({ fromMeterId, toMeterId, lineType })

describe('supply hierarchy', () => {
  it('maps parents to distinct children and ignores check lines', () => {
    const c = supplyChildren([L('P', 'A'), L('P', 'B'), L('P', 'A'), L('A', 'X', 'check')])
    expect(c.get('P')).toEqual(['A', 'B'])
    expect(c.has('A')).toBe(false)
  })

  it('finds transitive descendants and survives a stored loop', () => {
    const c = supplyChildren([L('P', 'A'), L('A', 'B'), L('B', 'P')])
    expect([...descendants('P', c)].sort()).toEqual(['A', 'B'])
  })

  it('refuses a line that would close a loop, and a self line; a check line never loops', () => {
    const lines = [L('P', 'A'), L('A', 'B')]
    expect(wouldCreateCycle(lines, L('B', 'P'))).toBe(true)
    expect(wouldCreateCycle(lines, L('A', 'A'))).toBe(true)
    expect(wouldCreateCycle(lines, L('P', 'B'))).toBe(false)
    expect(wouldCreateCycle(lines, L('B', 'P', 'check'))).toBe(false)
  })

  it('double-count guard: children win, the parent is dropped (transitively)', () => {
    const lines = [L('P', 'A'), L('A', 'B')]
    const r = doubleCountGuard(['P', 'B', 'Z'], lines)
    expect(r.kept.sort()).toEqual(['B', 'Z'])
    expect(r.droppedParents).toEqual([{ meterId: 'P', includedDescendants: ['B'] }])
  })

  it('double-count guard keeps a parent whose children are not included', () => {
    expect(doubleCountGuard(['P'], [L('P', 'A')])).toEqual({ kept: ['P'], droppedParents: [] })
  })

  it('reconciles each parent against the sum of its children, skipping months either side lacks', () => {
    const monthly = new Map<string, number[]>([
      ['P', Array.from({ length: 12 }, (_, i) => (i === 0 ? NaN : 100))],
      ['A', Array(12).fill(60)],
      ['B', Array.from({ length: 12 }, (_, i) => (i === 1 ? 20 : 45))],
    ])
    const [r] = reconcileParents([L('P', 'A'), L('P', 'B')], monthly)
    expect(r.parentMeterId).toBe('P')
    expect(r.childMeterIds).toEqual(['A', 'B'])
    expect(r.months).toHaveLength(11)
    const feb = r.months.find((m) => m.month === 2)!
    expect(feb).toMatchObject({ parentKwh: 100, childrenKwh: 80, flagged: true })
    expect(feb.ratio).toBeCloseTo(0.8)
    const mar = r.months.find((m) => m.month === 3)!
    expect(mar).toMatchObject({ childrenKwh: 105, flagged: false })
  })

  it('a parent with zero energy but children with energy is flagged', () => {
    const monthly = new Map<string, number[]>([['P', Array(12).fill(0)], ['A', Array(12).fill(5)]])
    const [r] = reconcileParents([L('P', 'A')], monthly)
    expect(r.months[0]).toMatchObject({ ratio: null, flagged: true })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @esite/shared test -- services/solar/load/hierarchy` → Expected: FAIL "Cannot find module './hierarchy'".

- [ ] **Step 3: Implement**

```ts
/**
 * The meter supply hierarchy drawn on schematics (functional spec §13.3). Supply lines only; a
 * `check` line (a check meter beside a supply meter) never enters it. The database refuses loops
 * (00215 schematic_lines_bind); these functions still survive one, so a legacy row cannot hang them.
 */
export interface MeterLine {
  fromMeterId: string
  toMeterId: string
  lineType?: 'supply' | 'check'
}

/** Monthly parent vs Σ children beyond this share is flagged (spec §13.3: ±10 %). */
export const RECONCILIATION_TOLERANCE = 0.1

const supplyOnly = (lines: MeterLine[]) => lines.filter((l) => (l.lineType ?? 'supply') === 'supply')

export function supplyChildren(lines: MeterLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of supplyOnly(lines)) {
    const c = out.get(l.fromMeterId) ?? []
    if (!c.includes(l.toMeterId)) c.push(l.toMeterId)
    out.set(l.fromMeterId, c)
  }
  return out
}

export function descendants(meterId: string, children: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(children.get(meterId) ?? [])]
  while (stack.length > 0) {
    const m = stack.pop() as string
    if (m === meterId || seen.has(m)) continue
    seen.add(m)
    stack.push(...(children.get(m) ?? []))
  }
  return seen
}

export function wouldCreateCycle(lines: MeterLine[], candidate: MeterLine): boolean {
  if ((candidate.lineType ?? 'supply') !== 'supply') return false
  if (candidate.fromMeterId === candidate.toMeterId) return true
  return descendants(candidate.toMeterId, supplyChildren(lines)).has(candidate.fromMeterId)
}

export interface DoubleCountResult {
  kept: string[]
  droppedParents: Array<{ meterId: string; includedDescendants: string[] }>
}

/** Children win (§13.3): an included meter with an included descendant is dropped from the series. */
export function doubleCountGuard(includedMeterIds: string[], lines: MeterLine[]): DoubleCountResult {
  const children = supplyChildren(lines)
  const included = new Set(includedMeterIds)
  const droppedParents: DoubleCountResult['droppedParents'] = []
  for (const id of included) {
    const d = [...descendants(id, children)].filter((x) => included.has(x)).sort()
    if (d.length > 0) droppedParents.push({ meterId: id, includedDescendants: d })
  }
  const dropped = new Set(droppedParents.map((d) => d.meterId))
  return { kept: [...included].filter((id) => !dropped.has(id)), droppedParents }
}

export interface ParentReconciliation {
  parentMeterId: string
  childMeterIds: string[]
  months: Array<{ month: number; parentKwh: number; childrenKwh: number; ratio: number | null; flagged: boolean }>
}

/** `monthlyKwh`: 12 values per meter, January first; NaN = no data that month (skipped). */
export function reconcileParents(lines: MeterLine[], monthlyKwh: Map<string, number[]>): ParentReconciliation[] {
  const out: ParentReconciliation[] = []
  for (const [parent, kids] of supplyChildren(lines)) {
    const pm = monthlyKwh.get(parent)
    const withData = kids.filter((k) => monthlyKwh.has(k))
    if (!pm || withData.length === 0) continue
    const months: ParentReconciliation['months'] = []
    for (let i = 0; i < 12; i++) {
      const p = pm[i]
      const cs = withData.map((k) => (monthlyKwh.get(k) as number[])[i])
      if (!Number.isFinite(p) || cs.some((c) => !Number.isFinite(c))) continue
      const c = cs.reduce((a, b) => a + b, 0)
      const ratio = p > 0 ? c / p : null
      months.push({ month: i + 1, parentKwh: p, childrenKwh: c, ratio, flagged: ratio === null ? c > 0 : Math.abs(ratio - 1) > RECONCILIATION_TOLERANCE })
    }
    out.push({ parentMeterId: parent, childMeterIds: withData, months })
  }
  return out
}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm --filter @esite/shared test -- services/solar/load/hierarchy` → Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/hierarchy.ts packages/shared/src/services/solar/load/hierarchy.test.ts
git commit -m "feat(solar): supply hierarchy — loop test, double-count guard, parent reconciliation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Site-profile charts and KPIs from the 8760 series

**Files:**
- Create: `packages/shared/src/services/solar/load/profile-stats.ts`
- Test: `packages/shared/src/services/solar/load/profile-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR } from './calendar'
import { seriesCsvRows, siteProfileCharts } from './profile-stats'

const flat = (kw: number) => new Float64Array(HOURS_PER_YEAR).fill(kw)

describe('siteProfileCharts', () => {
  it('a flat 10 kW year: energy, peak, load factor, 50/50 day-night, flat LDC', () => {
    const c = siteProfileCharts(flat(10), 2025)
    expect(c.kpis.annualKwh).toBeCloseTo(87_600)
    expect(c.kpis.peakKw).toBe(10)
    expect(c.kpis.loadFactor).toBeCloseTo(1)
    expect(c.kpis.dayPct).toBeCloseTo(50)
    expect(c.kpis.dayKwh + c.kpis.nightKwh).toBeCloseTo(87_600)
    expect(c.monthlyKwh[0]).toBeCloseTo(31 * 24 * 10)
    expect(c.monthlyKwh[1]).toBeCloseTo(28 * 24 * 10)
    expect(c.annual).toHaveLength(365)
    expect(c.annual[0]).toEqual({ day: '2025-01-01', min: 10, mean: 10, max: 10 })
    expect(c.avgDayByMonth).toHaveLength(12)
    expect(c.avgDayByMonth[5]).toHaveLength(24)
    expect(c.avgDayByMonth[5][13]).toBeCloseTo(10)
    expect(c.ldc).toHaveLength(101)
    expect(c.ldc.every((p) => p.kw === 10)).toBe(true)
  })

  it('finds the peak hour and pools public holidays with Sundays', () => {
    const s = flat(1)
    s[24 * 40 + 14] = 50 // 2025-02-10 14:00 (a Monday)
    const c = siteProfileCharts(s, 2025)
    expect(c.kpis.peakKw).toBe(50)
    expect(c.kpis.peakAt).toBe('2025-02-10 14:00')
    expect(c.ldc[0]).toEqual({ pct: 0, kw: 50 })
    expect(c.dayTypeProfiles.weekday[14]).toBeGreaterThan(1)
    expect(c.dayTypeProfiles.sunday[14]).toBeCloseTo(1)
  })

  it('refuses a series that is not 8760 hours', () => {
    expect(() => siteProfileCharts(new Float64Array(10), 2025)).toThrow(RangeError)
  })
})

describe('seriesCsvRows', () => {
  it('writes one row per hour with a header, local date and hour start', () => {
    const rows = seriesCsvRows(flat(2.5), 2025)
    expect(rows[0]).toEqual(['date', 'hour_start', 'kW'])
    expect(rows).toHaveLength(HOURS_PER_YEAR + 1)
    expect(rows[1]).toEqual(['2025-01-01', '00:00', '2.500'])
    expect(rows[HOURS_PER_YEAR]).toEqual(['2025-12-31', '23:00', '2.500'])
  })
})
```

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- profile-stats` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * Every Site-profile chart and KPI (functional spec §4.5) derived on the SERVER from the stored
 * 8760-hour site series. The browser receives these aggregates (≤ 365 daily bands, 12 × 24, 3 × 24,
 * 12, 101 points), never the raw series — and never recomputes them.
 */
import { dayTypeOf, HOURS_PER_YEAR, monthOf, referenceYearDates } from './calendar'

/** Day = 06:00–18:00 local (the split shown on the KPI strip). */
export const DAY_WINDOW = { startHour: 6, endHour: 18 } as const

export interface DayBand { day: string; min: number; mean: number; max: number }
export interface SiteProfileKpis {
  annualKwh: number
  peakKw: number
  peakAt: string
  loadFactor: number
  dayKwh: number
  nightKwh: number
  dayPct: number
}
export interface SiteProfileCharts {
  annual: DayBand[]
  avgDayByMonth: number[][]
  dayTypeProfiles: { weekday: number[]; saturday: number[]; sunday: number[] }
  monthlyKwh: number[]
  ldc: Array<{ pct: number; kw: number }>
  kpis: SiteProfileKpis
}

type Pool = 'weekday' | 'saturday' | 'sunday'
const zeros = (n: number) => Array(n).fill(0) as number[]

export function siteProfileCharts(series: ArrayLike<number>, referenceYear: number): SiteProfileCharts {
  if (series.length !== HOURS_PER_YEAR) throw new RangeError(`siteProfileCharts: expected ${HOURS_PER_YEAR} hours, got ${series.length}`)
  const dates = referenceYearDates(referenceYear)
  const annual: DayBand[] = []
  const monthSum = Array.from({ length: 12 }, () => zeros(24))
  const monthDays = zeros(12)
  const pools: Record<Pool, { sum: number[]; n: number }> = {
    weekday: { sum: zeros(24), n: 0 }, saturday: { sum: zeros(24), n: 0 }, sunday: { sum: zeros(24), n: 0 },
  }
  const monthlyKwh = zeros(12)
  let annualKwh = 0
  let dayKwh = 0
  let peak = -Infinity
  let peakIdx = 0
  dates.forEach((d, di) => {
    const m = monthOf(d) - 1
    const t = dayTypeOf(d)
    const pool: Pool = t === 'weekday' ? 'weekday' : t === 'saturday' ? 'saturday' : 'sunday'
    let mn = Infinity
    let mx = -Infinity
    let s = 0
    for (let h = 0; h < 24; h++) {
      const v = series[di * 24 + h]
      s += v
      if (v < mn) mn = v
      if (v > mx) mx = v
      monthSum[m][h] += v
      pools[pool].sum[h] += v
      if (h >= DAY_WINDOW.startHour && h < DAY_WINDOW.endHour) dayKwh += v
      if (v > peak) {
        peak = v
        peakIdx = di * 24 + h
      }
    }
    monthDays[m]++
    pools[pool].n++
    monthlyKwh[m] += s
    annualKwh += s
    annual.push({ day: d, min: mn, mean: s / 24, max: mx })
  })
  const avg = (p: { sum: number[]; n: number }) => p.sum.map((v) => (p.n > 0 ? v / p.n : 0))
  const sorted = Array.from(series).sort((a, b) => b - a)
  const ldc = Array.from({ length: 101 }, (_, pct) => ({ pct, kw: sorted[Math.min(HOURS_PER_YEAR - 1, Math.round((pct / 100) * (HOURS_PER_YEAR - 1)))] }))
  const peakDate = dates[Math.floor(peakIdx / 24)]
  return {
    annual,
    avgDayByMonth: monthSum.map((row, m) => row.map((v) => (monthDays[m] > 0 ? v / monthDays[m] : 0))),
    dayTypeProfiles: { weekday: avg(pools.weekday), saturday: avg(pools.saturday), sunday: avg(pools.sunday) },
    monthlyKwh,
    ldc,
    kpis: {
      annualKwh,
      peakKw: peak,
      peakAt: `${peakDate} ${String(peakIdx % 24).padStart(2, '0')}:00`,
      loadFactor: peak > 0 ? annualKwh / (peak * HOURS_PER_YEAR) : 0,
      dayKwh,
      nightKwh: annualKwh - dayKwh,
      dayPct: annualKwh > 0 ? (dayKwh / annualKwh) * 100 : 0,
    },
  }
}

/** Full-resolution CSV rows for "Download CSV" on the annual chart (hour starts, local SAST). */
export function seriesCsvRows(series: ArrayLike<number>, referenceYear: number): string[][] {
  const rows: string[][] = [['date', 'hour_start', 'kW']]
  referenceYearDates(referenceYear).forEach((d, di) => {
    for (let h = 0; h < 24; h++) rows.push([d, `${String(h).padStart(2, '0')}:00`, series[di * 24 + h].toFixed(3)])
  })
  return rows
}
```

- [ ] **Step 4: Run to see it pass** — `pnpm --filter @esite/shared test -- profile-stats` → PASS (4 tests). If the peak-hour test fails because 2025-02-10 is not index 40, compute `referenceYearDates(2025).indexOf('2025-02-10')` in a scratch REPL and fix the TEST's index (40 is correct: Jan has 31 days, so Feb 10 is day 31 + 9 = 40).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/profile-stats.ts packages/shared/src/services/solar/load/profile-stats.test.ts
git commit -m "feat(solar): site-profile charts and KPIs derived server-side from the 8760 series

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Meter-chart downsampling, gap ranges and the daily heatmap

**Files:**
- Create: `packages/shared/src/services/solar/load/downsample.ts`
- Test: `packages/shared/src/services/solar/load/downsample.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { dailyHeatmap, gapRanges, minMaxBuckets } from './downsample'
import type { Reading } from '../../../meter-data/types'

const S = 30 * 60_000

describe('minMaxBuckets', () => {
  it('passes small series through, one bucket per point', () => {
    expect(minMaxBuckets([0, S], [1, null], 10)).toEqual([
      { t0: 0, t1: 0, min: 1, max: 1, mean: 1 },
      { t0: S, t1: S, min: null, max: null, mean: null },
    ])
  })
  it('keeps the min and max of every bucket (spikes survive)', () => {
    const ts = Array.from({ length: 100 }, (_, i) => i * S)
    const v = ts.map((_, i) => (i === 57 ? 99 : 1))
    const b = minMaxBuckets(ts, v, 10)
    expect(b).toHaveLength(10)
    expect(Math.max(...b.map((x) => x.max ?? 0))).toBe(99)
    expect(b.every((x) => x.min === 1)).toBe(true)
  })
  it('refuses mismatched arrays', () => {
    expect(() => minMaxBuckets([0], [], 5)).toThrow(RangeError)
  })
})

describe('gapRanges', () => {
  it('reports time jumps and null runs, merged', () => {
    const ts = [1, 2, 3, 6, 7].map((k) => k * S)
    const v = [1, 1, 1, 1, null]
    expect(gapRanges(ts, v, 30)).toEqual([{ from: 3 * S, to: 5 * S }, { from: 6 * S, to: 7 * S }])
  })
})

describe('dailyHeatmap', () => {
  it('builds date × 24 cells with null for missing hours and missing days', () => {
    const t0 = Date.parse('2025-03-10T00:00:00+02:00')
    const r: Reading[] = []
    for (let i = 1; i <= 48; i++) r.push({ tsEnd: t0 + i * S, value: 4, quality: 0 })          // 2025-03-10 complete
    for (let i = 1; i <= 2; i++) r.push({ tsEnd: t0 + 2 * 86_400_000 + i * S, value: 8, quality: 0 }) // 2025-03-12 00:00 only
    const h = dailyHeatmap(r, 30)
    expect(h.dates).toEqual(['2025-03-10', '2025-03-11', '2025-03-12'])
    expect(h.cells[0].every((c) => c === 4)).toBe(true)
    expect(h.cells[1].every((c) => c === null)).toBe(true)
    expect(h.cells[2][0]).toBe(8)
    expect(h.cells[2][1]).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- downsample` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Meter-chart data prepared on the server (functional spec §4.3 detail drawer): a zoomed-out window is
 * sent as min/max/mean buckets so a spike is never averaged away; a zoomed-in window (≤ the bucket
 * count) is sent at full resolution. Gaps are shaded from explicit ranges. The heatmap is day ×
 * hour of local time.
 */
import type { Reading } from '../../../meter-data/types'
import { addDays } from './calendar'
import { readingsToDailyHours } from './hourly'

export interface Bucket { t0: number; t1: number; min: number | null; max: number | null; mean: number | null }

export function minMaxBuckets(ts: number[], values: Array<number | null>, count: number): Bucket[] {
  if (ts.length !== values.length) throw new RangeError('minMaxBuckets: ts and values differ in length')
  if (ts.length === 0) return []
  if (ts.length <= count) return ts.map((t, i) => ({ t0: t, t1: t, min: values[i], max: values[i], mean: values[i] }))
  const t0 = ts[0]
  const w = (ts[ts.length - 1] - t0) / count
  const out: Bucket[] = Array.from({ length: count }, (_, b) => ({ t0: t0 + b * w, t1: t0 + (b + 1) * w, min: null, max: null, mean: null }))
  const sums = new Float64Array(count)
  const ns = new Uint32Array(count)
  for (let i = 0; i < ts.length; i++) {
    const v = values[i]
    if (v === null || !Number.isFinite(v)) continue
    const b = Math.min(count - 1, Math.floor((ts[i] - t0) / w))
    const o = out[b]
    o.min = o.min === null ? v : Math.min(o.min, v)
    o.max = o.max === null ? v : Math.max(o.max, v)
    sums[b] += v
    ns[b]++
  }
  for (let b = 0; b < count; b++) out[b].mean = ns[b] > 0 ? sums[b] / ns[b] : null
  return out
}

/** Ranges (ms) with no usable value: missing slots between readings, and null values. */
export function gapRanges(ts: number[], values: Array<number | null>, intervalMin: number): Array<{ from: number; to: number }> {
  const step = intervalMin * 60_000
  const out: Array<{ from: number; to: number }> = []
  const push = (from: number, to: number) => {
    const last = out[out.length - 1]
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else out.push({ from, to })
  }
  for (let i = 0; i < ts.length; i++) {
    if (i > 0 && ts[i] - ts[i - 1] > step * 1.5) push(ts[i - 1], ts[i] - step)
    if (values[i] === null) push(ts[i] - step, ts[i])
  }
  return out
}

export interface DailyHeatmap { dates: string[]; cells: Array<Array<number | null>> }

/** Local date × hour average kW; every date between the first and last is present (null = no data). */
export function dailyHeatmap(readings: Reading[], intervalMin: number): DailyHeatmap {
  const d = readingsToDailyHours(readings, intervalMin)
  const known = [...d.keys()].sort()
  if (known.length === 0) return { dates: [], cells: [] }
  const dates: string[] = []
  for (let s = known[0]; s <= known[known.length - 1]; s = addDays(s, 1)) dates.push(s)
  return {
    dates,
    cells: dates.map((k) => {
      const v = d.get(k)
      return v ? Array.from(v, (x) => (Number.isNaN(x) ? null : x)) : Array(24).fill(null)
    }),
  }
}
```

- [ ] **Step 4: Run to see it pass** — `pnpm --filter @esite/shared test -- downsample` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/downsample.ts packages/shared/src/services/solar/load/downsample.test.ts
git commit -m "feat(solar): meter-chart min/max buckets, gap ranges and day x hour heatmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Auto-match meters to tenants (never pre-tick LLM or UNMAPPED)

**Files:**
- Create: `packages/shared/src/services/solar/load/auto-match.ts`
- Test: `packages/shared/src/services/solar/load/auto-match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { autoMatchMeters, normShop, type MatchMeter, type MatchTenant } from './auto-match'

const m = (meterId: string, over: Partial<MatchMeter> = {}): MatchMeter => ({ meterId, label: meterId, kind: 'tenant', serials: [], shopNo: null, ...over })
const tenants: MatchTenant[] = [
  { nodeId: 'n50', shopNumber: '050', name: 'Checkers' },
  { nodeId: 'n12', shopNumber: 'G12', name: 'Mugg & Bean' },
  { nodeId: 'n7', shopNumber: '7', name: 'Pep' },
]

describe('normShop', () => {
  it('normalises shop numbers', () => {
    expect(normShop('SHOP 050')).toBe('50')
    expect(normShop('050')).toBe('50')
    expect(normShop('Shop G-12')).toBe('G12')
    expect(normShop('0')).toBe('0')
    expect(normShop('  ')).toBeNull()
  })
})

describe('autoMatchMeters', () => {
  it('register rows first: exact is pre-ticked, llm and unmapped never are', () => {
    const p = autoMatchMeters({
      meters: [m('mA', { serials: ['S1'] }), m('mB', { label: 'TENANT-23' }), m('mC', { label: 'TENANT-24' })],
      tenants,
      register: [
        { fileName: null, shopNo: 'SHOP 050', tenantName: 'Checkers', serial: 'S1', matchMethod: 'exact', confirmed: false },
        { fileName: 'SITE YA, SHOP 012, TENANT-23, 3000.csv', shopNo: 'G12', tenantName: 'Mugg', serial: null, matchMethod: 'llm', confirmed: false },
        { fileName: 'TENANT-24.csv', shopNo: '7', tenantName: 'Pep', serial: null, matchMethod: 'unmapped', confirmed: false },
      ],
      assignedMeterIds: new Set(),
    })
    expect(p.find((x) => x.meterId === 'mA')).toMatchObject({ nodeId: 'n50', source: 'serial', confidence: 'high', preTicked: true })
    expect(p.find((x) => x.meterId === 'mB')).toMatchObject({ nodeId: 'n12', source: 'register', confidence: 'low', preTicked: false })
    expect(p.find((x) => x.meterId === 'mC')).toMatchObject({ nodeId: 'n7', preTicked: false })
  })

  it('a confirmed llm row is trusted', () => {
    const p = autoMatchMeters({
      meters: [m('mB', { label: 'TENANT-23' })], tenants,
      register: [{ fileName: 'TENANT-23.csv', shopNo: 'G12', tenantName: null, serial: null, matchMethod: 'llm', confirmed: true }],
      assignedMeterIds: new Set(),
    })
    expect(p[0]).toMatchObject({ preTicked: true, confidence: 'high' })
  })

  it('then file-name shop numbers, then labels (label matches are not pre-ticked)', () => {
    const p = autoMatchMeters({
      meters: [m('m1', { shopNo: 'SHOP 7' }), m('m2', { label: 'Mugg & Bean' })], tenants, register: [], assignedMeterIds: new Set(),
    })
    expect(p).toEqual([
      expect.objectContaining({ meterId: 'm1', nodeId: 'n7', source: 'shop_no', preTicked: true }),
      expect.objectContaining({ meterId: 'm2', nodeId: 'n12', source: 'label', confidence: 'medium', preTicked: false }),
    ])
  })

  it('skips meters already assigned and meters that are not tenant load', () => {
    const p = autoMatchMeters({
      meters: [m('m1', { shopNo: '7' }), m('m2', { shopNo: '050', kind: 'solar' }), m('m3', { shopNo: 'G12', kind: 'bulk' })],
      tenants, register: [], assignedMeterIds: new Set(['m1']),
    })
    expect(p).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- auto-match` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Auto-match meters to tenants (functional spec §4.4): the imported meter register and serials first,
 * then shop numbers from file names, then labels. It only PROPOSES; the user ticks and applies.
 * A register row matched by an LLM or marked UNMAPPED is never pre-ticked unless someone confirmed it.
 */
export interface MatchMeter { meterId: string; label: string; kind: string; serials: string[]; shopNo: string | null }
export interface MatchTenant { nodeId: string; shopNumber: string | null; name: string | null }
export interface MatchRegisterRow {
  fileName: string | null
  shopNo: string | null
  tenantName: string | null
  serial: string | null
  matchMethod: 'exact' | 'llm' | 'unmapped' | 'manual' | 'none'
  confirmed: boolean
}
export type MatchSource = 'register' | 'serial' | 'shop_no' | 'label'
export interface MatchProposal {
  nodeId: string
  meterId: string
  source: MatchSource
  confidence: 'high' | 'medium' | 'low'
  preTicked: boolean
  note: string
}

/** Meters that never carry a single tenant's load. */
const NOT_TENANT_KINDS = new Set(['bulk', 'council', 'generator', 'solar', 'check', 'water'])

export function normShop(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.toUpperCase().replace(/\b(SHOP|UNIT|NO\.?)\b/g, '').replace(/[\s#\-_.]/g, '').replace(/^0+(?=\w)/, '')
  return t.length > 0 ? t : null
}

export function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function autoMatchMeters(input: {
  meters: MatchMeter[]
  tenants: MatchTenant[]
  register: MatchRegisterRow[]
  assignedMeterIds: Set<string>
}): MatchProposal[] {
  const byShop = new Map<string, MatchTenant>()
  const byName = new Map<string, MatchTenant>()
  for (const t of input.tenants) {
    const k = normShop(t.shopNumber)
    if (k && !byShop.has(k)) byShop.set(k, t)
    const n = normName(t.name)
    if (n.length >= 3 && !byName.has(n)) byName.set(n, t)
  }
  const candidates = input.meters.filter((m) => !NOT_TENANT_KINDS.has(m.kind) && !input.assignedMeterIds.has(m.meterId))
  const taken = new Set<string>()
  const out: MatchProposal[] = []
  const propose = (m: MatchMeter, t: MatchTenant, p: Omit<MatchProposal, 'nodeId' | 'meterId'>) => {
    if (taken.has(m.meterId)) return
    taken.add(m.meterId)
    out.push({ nodeId: t.nodeId, meterId: m.meterId, ...p })
  }

  for (const r of input.register) {
    const t = byShop.get(normShop(r.shopNo) ?? '')
    if (!t) continue
    const bySerial = r.serial ? candidates.find((x) => x.serials.includes(r.serial as string)) : undefined
    const byFile = r.fileName
      ? candidates.find((x) => normName(x.label).length >= 3 && normName(r.fileName).includes(normName(x.label)))
      : undefined
    const m = bySerial ?? byFile
    if (!m) continue
    const trusted = r.confirmed || r.matchMethod === 'exact' || r.matchMethod === 'manual'
    propose(m, t, {
      source: bySerial ? 'serial' : 'register',
      confidence: trusted ? 'high' : 'low',
      preTicked: trusted,
      note: trusted
        ? `Meter register (${r.confirmed ? 'confirmed' : r.matchMethod})`
        : `Meter register row matched by ${r.matchMethod === 'llm' ? 'an LLM' : 'nobody (UNMAPPED)'} — check before applying`,
    })
  }
  for (const m of candidates) {
    const t = byShop.get(normShop(m.shopNo) ?? '')
    if (t) propose(m, t, { source: 'shop_no', confidence: 'high', preTicked: true, note: `Shop number ${m.shopNo} in the file name` })
  }
  for (const m of candidates) {
    const t = byName.get(normName(m.label))
    if (t) propose(m, t, { source: 'label', confidence: 'medium', preTicked: false, note: 'Meter label equals the tenant name' })
  }
  return out
}
```

- [ ] **Step 4: Run to see it pass** — `pnpm --filter @esite/shared test -- auto-match` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/load/auto-match.ts packages/shared/src/services/solar/load/auto-match.test.ts
git commit -m "feat(solar): auto-match meters to tenants; LLM and UNMAPPED rows never pre-ticked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The site-load builder

**Files:**
- Create: `packages/shared/src/services/solar/load/build-site-load.ts`
- Test: `packages/shared/src/services/solar/load/build-site-load.test.ts`
- Modify: `packages/shared/src/services/solar/load/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { Reading } from '../../../meter-data/types'
import { buildSiteLoad, type BuildMeter, type BuildSiteLoadInput, type BuildTenant } from './build-site-load'
import { monthlyEnergyKwh } from './site-series'

function readings(start: string, days: number, intervalMin: number, kw: number): Reading[] {
  const t0 = Date.parse(`${start}T00:00:00+02:00`)
  const n = (days * 24 * 60) / intervalMin
  const out: Reading[] = []
  for (let i = 1; i <= n; i++) out.push({ tsEnd: t0 + i * intervalMin * 60_000, value: kw, quality: 0 })
  return out
}
const meter = (meterId: string, kw: number, over: Partial<BuildMeter> = {}): BuildMeter => ({
  meterId, label: meterId, kind: 'tenant', supplyPointConfirmed: false, serials: [],
  primary: { readings: readings('2025-01-01', 365, 30, kw), intervalMin: 30 }, kva: null, existingPv: null, ...over,
})
const tenant = (nodeId: string, over: Partial<BuildTenant> = {}): BuildTenant => ({
  nodeId, label: nodeId, areaM2: 100, category: 'standard', source: 'metered', meters: [], archetype: null,
  densityOverrideWPerM2: null, boDate: null, ...over,
})
const base = (over: Partial<BuildSiteLoadInput> = {}): BuildSiteLoadInput => ({
  basis: 'S2', referenceYear: null, fallbackYear: 2025, commonAreaPct: 0, diversityFactor: 1,
  tenants: [], meters: [], lines: [], bills: null, ...over,
})
const total = (s: Float64Array) => s.reduce((a, b) => a + b, 0)

describe('buildSiteLoad — S2 (sum of tenants)', () => {
  it('one metered tenant, a flat 10 kW year: the series is that year', () => {
    const r = buildSiteLoad(base({ meters: [meter('m1', 10)], tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }] })] }))
    expect(r.basis).toBe('S2')
    expect(r.referenceYear).toBe(2025)
    expect(total(r.series)).toBeCloseTo(87_600, 0)
    expect(r.coverage).toMatchObject({ metered: 1, synthesised: 0, unassigned: 0, fullYearFromData: true, peakSource: 'hourly' })
    expect(r.tenants[0]).toMatchObject({ nodeId: 't1', source: 'metered' })
    expect(r.tenants[0].annualKwh).toBeCloseTo(87_600, 0)
  })

  it('applies the common-area allowance and explicit weights (sum, not average)', () => {
    const r = buildSiteLoad(base({
      commonAreaPct: 10,
      meters: [meter('m1', 10), meter('m2', 10)],
      tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }, { meterId: 'm2', weight: 0.5 }] })],
    }))
    expect(r.series[100]).toBeCloseTo(15 * 1.1)
  })

  it('double-count guard: the parent is dropped, its tenant is covered by the children', () => {
    const r = buildSiteLoad(base({
      meters: [meter('P', 30), meter('C', 10)],
      tenants: [tenant('tA', { meters: [{ meterId: 'P', weight: 1 }] }), tenant('tB', { meters: [{ meterId: 'C', weight: 1 }] })],
      lines: [{ fromMeterId: 'P', toMeterId: 'C' }],
    }))
    expect(r.series[500]).toBeCloseTo(10)
    expect(r.coverage.coveredByChildren).toBe(1)
    expect(r.tenants.find((t) => t.nodeId === 'tA')?.source).toBe('covered_by_children')
    expect(r.checks.some((c) => c.key === 'double_count:P')).toBe(true)
    expect(r.reconciliation.parents[0].months.every((m) => m.flagged)).toBe(true)
  })

  it('never counts a solar/generator/check/water meter as load', () => {
    const r = buildSiteLoad(base({
      meters: [meter('pv', 40, { kind: 'solar' })],
      tenants: [tenant('t1', { meters: [{ meterId: 'pv', weight: 1 }], areaM2: 0 })],
    }))
    expect(total(r.series)).toBe(0)
    expect(r.checks.some((c) => c.key === 'excluded_kind:pv')).toBe(true)
    expect(r.basis).toBe('S3')
  })

  it('synthesises unassigned tenants and counts them', () => {
    const r = buildSiteLoad(base({ tenants: [tenant('t1', { source: 'unassigned' })] }))
    expect(r.basis).toBe('S3')
    expect(r.coverage.unassigned).toBe(1)
    expect(total(r.series)).toBeGreaterThan(0)
    expect(r.checks.some((c) => c.key === 'unassigned_tenants')).toBe(true)
  })

  it('S3 design maximum demand applies the diversity factor to the peak only', () => {
    const a = buildSiteLoad(base({ diversityFactor: 1, tenants: [tenant('t1', { source: 'synthesised' }), tenant('t2', { source: 'synthesised' })] }))
    const b = buildSiteLoad(base({ diversityFactor: 0.8, tenants: [tenant('t1', { source: 'synthesised' }), tenant('t2', { source: 'synthesised' })] }))
    expect(b.designMdKw as number).toBeCloseTo((a.designMdKw as number) * 0.8)
    expect(total(b.series)).toBeCloseTo(total(a.series))
  })

  it('a meter with under 30 days is only a shape sample', () => {
    const short = meter('s', 5, { primary: { readings: readings('2025-06-01', 10, 30, 5), intervalMin: 30 } })
    const r = buildSiteLoad(base({ meters: [short], tenants: [tenant('t1', { meters: [{ meterId: 's', weight: 1 }] })] }))
    expect(r.coverage.shapeOnlyMeters).toEqual(['s'])
    expect(r.checks.some((c) => c.key === 'shape_only:s')).toBe(true)
    expect(r.basis).toBe('S3')
  })

  it('ramps a synthesised tenant in from its BO date only inside the reference year', () => {
    const inYear = buildSiteLoad(base({ referenceYear: 2025, tenants: [tenant('t1', { source: 'synthesised', boDate: '2025-07-01' })] }))
    const jan = monthlyEnergyKwh(inYear.series, 2025)
    expect(jan[0]).toBe(0)
    expect(jan[7]).toBeGreaterThan(0)
    const later = buildSiteLoad(base({ referenceYear: 2025, tenants: [tenant('t1', { source: 'synthesised', boDate: '2027-03-01' })] }))
    expect(monthlyEnergyKwh(later.series, 2025)[0]).toBeGreaterThan(0)
  })

  it('refuses an empty tenant schedule', () => {
    expect(() => buildSiteLoad(base())).toThrow(/no_tenants|tenant schedule/)
  })
})

describe('buildSiteLoad — S1 (bulk)', () => {
  it('needs a bulk meter confirmed as the point of supply', () => {
    expect(() => buildSiteLoad(base({ basis: 'S1', meters: [meter('b', 25, { kind: 'bulk' })] }))).toThrow(/point of supply/)
  })

  it('uses the confirmed bulk series and reconciles it with Σ metered tenants', () => {
    const r = buildSiteLoad(base({
      basis: 'S1',
      meters: [meter('b', 25, { kind: 'bulk', supplyPointConfirmed: true }), meter('m1', 10)],
      tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }] })],
    }))
    expect(r.basis).toBe('S1')
    expect(r.series[1000]).toBeCloseTo(25)
    expect(r.coverage.peakSource).toBe('interval')
    expect(r.coverage.peakKw).toBe(25)
    expect(r.mdMonthly[0]).toMatchObject({ source: 'kw_over_pf' })
    expect(r.reconciliation.bulk[0].months).toHaveLength(12)
    expect(r.reconciliation.bulk[0].months[0].ratio).toBeCloseTo(0.4)
    expect(r.checks.filter((c) => c.key.startsWith('recon_bulk:b:'))).toHaveLength(12)
  })
})

describe('buildSiteLoad — S4 (monthly bills)', () => {
  it('each month holds the billed energy', () => {
    const r = buildSiteLoad(base({
      basis: 'S4', referenceYear: 2025,
      bills: { archetype: 'retail', powerFactor: 0.95, months: Array.from({ length: 12 }, () => ({ kwh: 1000, kva: null })) },
    }))
    expect(r.basis).toBe('S4')
    for (const e of monthlyEnergyKwh(r.series, 2025)) expect(e).toBeCloseTo(1000, 3)
  })

  it('refuses missing bills', () => {
    expect(() => buildSiteLoad(base({ basis: 'S4' }))).toThrow(/bills/)
  })
})
```

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- build-site-load` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
/**
 * The site-load builder (engine spec §2.2–§2.6; functional spec §4.2, §4.5, §13.3). A pure composition
 * of the 3a library: per-meter reference series, tenant synthesis, the per-basis site series,
 * maximum demand, reconciliation and the double-count guard. The server gathers rows and readings,
 * calls this once, and stores the result in solar.site_load. The browser never runs it.
 */
import { isUsable, type Reading } from '../../../meter-data/types'
import type { ShopCategory } from '../../generator-cost-recovery/types'
import { latestWindow, type SourceWindow } from './align'
import { CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, expandArchetype, getArchetype, type ArchetypeCode, type ArchetypeShapeDef } from './archetypes'
import { HOURS_PER_YEAR } from './calendar'
import { chooseCommonWindow, DEFAULT_COMMON_WINDOW } from './common-window'
import { designMaxDemandSynth } from './diversity'
import { doubleCountGuard, reconcileParents, RECONCILIATION_TOLERANCE, type MeterLine, type ParentReconciliation } from './hierarchy'
import { completeDays, readingsToDailyHours } from './hourly'
import { monthlyMaxDemand, monthlyMaxDemandFromHourly } from './max-demand'
import { buildS1, buildS2, buildS4, LoadModelError, monthlyEnergyKwh, type LoadBasis, type S2Tenant } from './site-series'
import { shapeFromSample, synthesiseTenant } from './synthesis'
import { meterReferenceSeries } from './tenant-series'

export const SITE_LOAD_ENGINE_VERSION = '3b.1'
/** Never load (functional spec §4.3 "Meter kind"). */
export const LOAD_EXCLUDED_KINDS = ['solar', 'generator', 'check', 'water'] as const

export type BuildMeterKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'water' | 'unknown'
export interface ChannelData { readings: Reading[]; intervalMin: number }
export interface BuildMeter {
  meterId: string
  label: string
  kind: BuildMeterKind
  supplyPointConfirmed: boolean
  serials: string[]
  /** The primary active-power channel (kW), or null when none is imported. */
  primary: ChannelData | null
  /** A measured apparent-power channel (kVA) from the same export, for maximum demand. */
  kva: ChannelData | null
  /** meters.existing_pv_channel_id: generation to add back under S1 (engine §2.3). */
  existingPv: ChannelData | null
}
export type TenantSource = 'metered' | 'synthesised' | 'excluded' | 'unassigned'
export interface BuildTenant {
  nodeId: string
  label: string
  areaM2: number | null
  category: ShopCategory | null
  source: TenantSource
  meters: Array<{ meterId: string; weight: number }>
  archetype: ArchetypeCode | null
  densityOverrideWPerM2: number | null
  boDate: string | null
}
export interface MonthlyBills { archetype: ArchetypeCode; powerFactor: number; months: Array<{ kwh: number; kva: number | null }> }
export interface BuildSiteLoadInput {
  basis: LoadBasis
  referenceYear: number | null
  /** Used when neither the study nor the data names a year (pure synthesis). */
  fallbackYear: number
  commonAreaPct: number
  diversityFactor: number
  tenants: BuildTenant[]
  meters: BuildMeter[]
  lines: MeterLine[]
  bills: MonthlyBills | null
  densities?: Partial<Record<ShopCategory, number>>
}
export interface LoadCheck { key: string; severity: 'error' | 'warning' | 'info'; message: string; meterId?: string; nodeId?: string }
export interface TenantSummary {
  nodeId: string
  source: 'metered' | 'synthesised' | 'excluded' | 'covered_by_children'
  annualKwh: number
  peakKw: number
  wPerM2: number | null
}
export interface BulkReconciliation {
  meterId: string
  label: string
  months: Array<{ month: number; bulkKwh: number; tenantsKwh: number; ratio: number | null; flagged: boolean }>
}
export interface SiteLoadCoverage {
  window: SourceWindow | null
  commonShare: number | null
  meetsThreshold: boolean
  metered: number
  synthesised: number
  excluded: number
  unassigned: number
  coveredByChildren: number
  shapeOnlyMeters: string[]
  fullYearFromData: boolean
  peakKw: number
  peakSource: 'interval' | 'hourly'
  resolutionMin: number | null
}
export interface MdMonth { month: string; kva: number | null; source: string; powerFactor: number | null }
export interface BuildSiteLoadResult {
  basis: LoadBasis
  referenceYear: number
  series: Float64Array
  mdMonthly: MdMonth[]
  designMdKw: number | null
  coverage: SiteLoadCoverage
  reconciliation: { bulk: BulkReconciliation[]; parents: ParentReconciliation[] }
  tenants: TenantSummary[]
  checks: LoadCheck[]
}

const isExcludedKind = (k: BuildMeterKind) => (LOAD_EXCLUDED_KINDS as readonly string[]).includes(k)
const hourlyCapable = (c: ChannelData | null): c is ChannelData => c !== null && c.intervalMin <= 60 && 60 % c.intervalMin === 0
export const usableForLoad = (m: BuildMeter): boolean => !isExcludedKind(m.kind) && hourlyCapable(m.primary)

const archetypeOf = (t: BuildTenant): ArchetypeCode => t.archetype ?? (t.category ? CATEGORY_ARCHETYPE[t.category] : 'retail')
function densityOf(t: BuildTenant, densities?: Partial<Record<ShopCategory, number>>): number {
  if (t.densityOverrideWPerM2 !== null) return t.densityOverrideWPerM2
  const c: ShopCategory = t.category ?? 'standard'
  return densities?.[c] ?? DEFAULT_DENSITY_W_PER_M2[c]
}
/**
 * The BO ramp applies inside the reference year only (engine §2.4 "year 1"). A BO date in another
 * calendar year is not projected onto it: before the year = trading all year; after the year = the
 * tenant is modelled trading (the year-1 ramp belongs to the cashflow, which knows the COD).
 */
function boInYear(boDate: string | null, year: number): string | null {
  return boDate && boDate.startsWith(`${year}-`) ? boDate : null
}
function synthFor(t: BuildTenant, year: number, densities?: Partial<Record<ShopCategory, number>>, shape?: ArchetypeShapeDef): Float64Array {
  return synthesiseTenant({
    areaM2: t.areaM2 ?? 0,
    densityWPerM2: densityOf(t, densities),
    shape: expandArchetype(shape ?? getArchetype(archetypeOf(t)), year),
    boDate: boInYear(t.boDate, year),
  }, year)
}
const sumOf = (s: ArrayLike<number>) => { let a = 0; for (let i = 0; i < s.length; i++) a += s[i]; return a }
const maxOf = (s: ArrayLike<number>) => { let a = 0; for (let i = 0; i < s.length; i++) if (s[i] > a) a = s[i]; return a }
function intervalMax(c: ChannelData): number {
  let best = 0
  for (const r of c.readings) if (isUsable(r) && (r.value as number) > best) best = r.value as number
  return best
}
/** Monthly kWh with NaN for months the meter does not cover (so reconciliation skips them). */
function monthlyWithGaps(series: Float64Array, year: number, missingMonths: number[]): number[] {
  const m = monthlyEnergyKwh(series, year)
  for (const mm of missingMonths) m[mm - 1] = NaN
  return m
}

function meterChecks(meters: BuildMeter[], checks: LoadCheck[]): void {
  for (const m of meters) {
    if (isExcludedKind(m.kind)) {
      checks.push({ key: `excluded_kind:${m.meterId}`, severity: 'info', message: `${m.label} is a ${m.kind} meter and is never counted as load.`, meterId: m.meterId })
    } else if (m.primary && !hourlyCapable(m.primary)) {
      checks.push({ key: `daily_only:${m.meterId}`, severity: 'warning', message: `${m.label} has only ${m.primary.intervalMin}-minute data: it counts toward coverage and is not used as load.`, meterId: m.meterId })
    } else if (!m.primary) {
      checks.push({ key: `no_data:${m.meterId}`, severity: 'warning', message: `${m.label} has no imported active-power channel.`, meterId: m.meterId })
    }
  }
  const bySerial = new Map<string, string[]>()
  for (const m of meters) for (const s of m.serials) bySerial.set(s, [...(bySerial.get(s) ?? []), m.label])
  for (const [s, labels] of bySerial) {
    if (labels.length > 1) checks.push({ key: `duplicate_serial:${s}`, severity: 'warning', message: `Serial ${s} is on ${labels.length} meters in this study (${labels.join(', ')}).` })
  }
}

interface TenantEval {
  s2: S2Tenant[]
  synths: Float64Array[]
  meteredSum: Float64Array
  summaries: TenantSummary[]
  metered: number
  synthesised: number
  excluded: number
  unassigned: number
  coveredByChildren: number
  shapeOnly: string[]
  resolutionMin: number | null
}

function evaluateTenants(
  input: BuildSiteLoadInput, year: number, covered: Map<string, string[]>, window: SourceWindow | null,
  meterById: Map<string, BuildMeter>, checks: LoadCheck[],
): TenantEval {
  const included = [...new Set(input.tenants.filter((t) => t.source === 'metered').flatMap((t) => t.meters.map((r) => r.meterId)))]
    .filter((id) => (covered.get(id)?.length ?? 0) >= DEFAULT_COMMON_WINDOW.minDaysForMeter)
  const guard = doubleCountGuard(included, input.lines)
  const dropped = new Set(guard.droppedParents.map((d) => d.meterId))
  for (const d of guard.droppedParents) {
    const label = meterById.get(d.meterId)?.label ?? d.meterId
    const kids = d.includedDescendants.map((k) => meterById.get(k)?.label ?? k).join(', ')
    checks.push({ key: `double_count:${d.meterId}`, severity: 'info', message: `${label} feeds meters that are also counted (${kids}); they are used and ${label} is kept for reconciliation only.`, meterId: d.meterId })
  }
  const e: TenantEval = {
    s2: [], synths: [], meteredSum: new Float64Array(HOURS_PER_YEAR), summaries: [], metered: 0, synthesised: 0,
    excluded: 0, unassigned: 0, coveredByChildren: 0, shapeOnly: [], resolutionMin: null,
  }
  const summarise = (t: BuildTenant, source: TenantSummary['source'], s: Float64Array | null) => {
    const annualKwh = s ? sumOf(s) : 0
    e.summaries.push({ nodeId: t.nodeId, source, annualKwh, peakKw: s ? maxOf(s) : 0, wPerM2: s && t.areaM2 ? (annualKwh * 1000) / HOURS_PER_YEAR / t.areaM2 : null })
  }
  const useSynth = (t: BuildTenant, s: Float64Array) => {
    e.s2.push({ synth: s })
    e.synths.push(s)
    e.synthesised++
    summarise(t, 'synthesised', s)
    if (!t.areaM2) checks.push({ key: `tenant_no_area:${t.nodeId}`, severity: 'warning', message: `${t.label} has no shop area, so its synthesised load is zero.`, nodeId: t.nodeId })
  }
  for (const t of input.tenants) {
    if (t.source === 'excluded') {
      e.excluded++
      summarise(t, 'excluded', null)
      continue
    }
    const synth = synthFor(t, year, input.densities)
    if (t.source !== 'metered') {
      if (t.source === 'unassigned') e.unassigned++
      useSynth(t, synth)
      continue
    }
    const used: Array<{ series: Float64Array; weight: number }> = []
    let sample: ArchetypeShapeDef | null = null
    let coveredByChildren = false
    for (const ref of t.meters) {
      const m = meterById.get(ref.meterId)
      if (!m) {
        checks.push({ key: `missing_meter:${t.nodeId}:${ref.meterId}`, severity: 'warning', message: `${t.label} names a meter that is not in this study.`, nodeId: t.nodeId })
        continue
      }
      if (!usableForLoad(m)) continue
      if (dropped.has(m.meterId)) {
        coveredByChildren = true
        continue
      }
      const primary = m.primary as ChannelData
      if ((covered.get(m.meterId)?.length ?? 0) < DEFAULT_COMMON_WINDOW.minDaysForMeter) {
        sample = shapeFromSample(readingsToDailyHours(primary.readings, primary.intervalMin), getArchetype(archetypeOf(t)))
        if (!e.shapeOnly.includes(m.meterId)) e.shapeOnly.push(m.meterId)
        checks.push({ key: `shape_only:${m.meterId}`, severity: 'warning', message: `${m.label} has under ${DEFAULT_COMMON_WINDOW.minDaysForMeter} days of data; it shapes ${t.label}'s synthesis and is not used as its load.`, meterId: m.meterId })
        continue
      }
      const r = meterReferenceSeries({ readings: primary.readings, intervalMin: primary.intervalMin, referenceYear: year, window, fallbackSynth: synth })
      if (r.missingMonths.length > 0) {
        checks.push({ key: `filled:${m.meterId}`, severity: 'info', message: `${m.label}: ${r.missingMonths.length} month(s) without data were filled from ${t.label}'s synthesis scaled to the meter (×${r.synthesisScale.toFixed(2)}).`, meterId: m.meterId })
      }
      e.resolutionMin = e.resolutionMin === null ? primary.intervalMin : Math.min(e.resolutionMin, primary.intervalMin)
      used.push({ series: r.series, weight: ref.weight })
    }
    if (used.length > 0) {
      e.s2.push({ meters: used })
      e.metered++
      const s = new Float64Array(HOURS_PER_YEAR)
      for (const u of used) for (let h = 0; h < HOURS_PER_YEAR; h++) s[h] += u.weight * u.series[h]
      for (let h = 0; h < HOURS_PER_YEAR; h++) e.meteredSum[h] += s[h]
      summarise(t, 'metered', s)
    } else if (coveredByChildren) {
      e.coveredByChildren++
      summarise(t, 'covered_by_children', null)
    } else {
      useSynth(t, sample ? synthFor(t, year, input.densities, sample) : synth)
    }
  }
  if (e.unassigned > 0) {
    checks.push({ key: 'unassigned_tenants', severity: 'warning', message: `${e.unassigned} tenant(s) have no load basis yet; they are synthesised from the tenant schedule until you choose.` })
  }
  return e
}

export function buildSiteLoad(input: BuildSiteLoadInput): BuildSiteLoadResult {
  const checks: LoadCheck[] = []
  const meterById = new Map(input.meters.map((m) => [m.meterId, m]))
  meterChecks(input.meters, checks)

  const covered = new Map<string, string[]>()
  for (const m of input.meters) {
    if (usableForLoad(m)) {
      const p = m.primary as ChannelData
      covered.set(m.meterId, completeDays(readingsToDailyHours(p.readings, p.intervalMin)))
    }
  }
  const basis: LoadBasis = input.basis === 'S3' ? 'S2' : input.basis
  const tenantMeterIds = [...new Set(input.tenants.filter((t) => t.source === 'metered').flatMap((t) => t.meters.map((r) => r.meterId)))]
    .filter((id) => covered.has(id))
  const common = chooseCommonWindow(tenantMeterIds.map((meterId) => ({ meterId, coveredDates: covered.get(meterId) as string[] })))
  const confirmedBulk = input.meters.filter((m) => m.kind === 'bulk' && m.supplyPointConfirmed && usableForLoad(m))
  const dataWindow = basis === 'S1'
    ? (confirmedBulk[0] ? latestWindow(covered.get(confirmedBulk[0].meterId) as string[]) : null)
    : common.window
  const year = input.referenceYear ?? (dataWindow ? Number(dataWindow.end.slice(0, 4)) : input.fallbackYear)

  if (basis === 'S2' && input.tenants.length === 0) {
    throw new LoadModelError('no_tenants', 'The tenant schedule has no tenants — use Bulk meter or Monthly bills, or import a tenant schedule.')
  }
  const t = evaluateTenants(input, year, covered, common.window, meterById, checks)
  if (t.metered > 0 && !common.meetsThreshold) {
    checks.push({ key: 'common_window', severity: 'warning', message: `Only ${Math.round(common.share * 100)} % of metered tenants share 12 months of data (80 % needed); uncovered months are synthesised.` })
  }

  // Bulk vs Σ metered tenants (any basis; a bulk meter need not be confirmed to be reconciled).
  const retail = expandArchetype(getArchetype('retail'), year)
  const bulkRecon: BulkReconciliation[] = []
  if (t.metered > 0) {
    const tenantsKwh = monthlyEnergyKwh(t.meteredSum, year)
    for (const m of input.meters.filter((x) => x.kind === 'bulk' && usableForLoad(x))) {
      const p = m.primary as ChannelData
      const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
      const bulkKwh = monthlyWithGaps(r.series, year, r.missingMonths)
      const months: BulkReconciliation['months'] = []
      for (let i = 0; i < 12; i++) {
        if (!Number.isFinite(bulkKwh[i])) continue
        const ratio = bulkKwh[i] > 0 ? tenantsKwh[i] / bulkKwh[i] : null
        const flagged = ratio === null ? tenantsKwh[i] > 0 : Math.abs(ratio - 1) > RECONCILIATION_TOLERANCE
        months.push({ month: i + 1, bulkKwh: bulkKwh[i], tenantsKwh: tenantsKwh[i], ratio, flagged })
        if (flagged) {
          checks.push({ key: `recon_bulk:${m.meterId}:${i + 1}`, severity: 'warning', message: `Month ${i + 1}: Σ metered tenants is ${ratio === null ? 'non-zero while the bulk meter reads zero' : `${Math.round(ratio * 100)} % of ${m.label}`} (flag beyond ±10 %).`, meterId: m.meterId })
        }
      }
      bulkRecon.push({ meterId: m.meterId, label: m.label, months })
    }
  }

  // Parent vs Σ children for every hierarchy parent that has data.
  const inLines = new Set(input.lines.flatMap((l) => [l.fromMeterId, l.toMeterId]))
  const monthly = new Map<string, number[]>()
  for (const id of inLines) {
    const m = meterById.get(id)
    if (!m || !usableForLoad(m)) continue
    const p = m.primary as ChannelData
    const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
    monthly.set(id, monthlyWithGaps(r.series, year, r.missingMonths))
  }
  const parents = reconcileParents(input.lines, monthly)
  for (const pr of parents) {
    for (const mo of pr.months.filter((x) => x.flagged)) {
      const label = meterById.get(pr.parentMeterId)?.label ?? pr.parentMeterId
      checks.push({ key: `recon_parent:${pr.parentMeterId}:${mo.month}`, severity: 'warning', message: `Month ${mo.month}: Σ children is ${mo.ratio === null ? 'non-zero while the parent reads zero' : `${Math.round(mo.ratio * 100)} % of ${label}`} (flag beyond ±10 %).`, meterId: pr.parentMeterId })
    }
  }

  let series: Float64Array
  let effective: LoadBasis = basis
  let mdMonthly: MdMonth[]
  let designMdKw: number | null = null
  let fullYearFromData = false
  let peakKw: number
  let peakSource: 'interval' | 'hourly' = 'hourly'
  let resolutionMin = t.resolutionMin

  if (basis === 'S1') {
    if (confirmedBulk.length === 0) {
      throw new LoadModelError('no_confirmed_bulk', 'Basis "Bulk meter" needs a bulk meter confirmed as the point of supply (Meters → the meter → Confirm point of supply).')
    }
    series = new Float64Array(HOURS_PER_YEAR)
    fullYearFromData = true
    resolutionMin = null
    for (const m of confirmedBulk) {
      const p = m.primary as ChannelData
      const r = meterReferenceSeries({ readings: p.readings, intervalMin: p.intervalMin, referenceYear: year, window: null, fallbackSynth: retail })
      if (r.missingMonths.length > 0) fullYearFromData = false
      const pv = hourlyCapable(m.existingPv)
        ? meterReferenceSeries({ readings: m.existingPv.readings, intervalMin: m.existingPv.intervalMin, referenceYear: year, window: null, fallbackSynth: new Float64Array(HOURS_PER_YEAR) }).series
        : null
      if (pv) checks.push({ key: `existing_pv:${m.meterId}`, severity: 'info', message: `Existing PV generation is added back to ${m.label} (engine §2.3).`, meterId: m.meterId })
      const s1 = buildS1({ bulk: r.series, supplyPointConfirmed: true, existingPv: pv })
      for (let h = 0; h < HOURS_PER_YEAR; h++) series[h] += s1[h]
      resolutionMin = resolutionMin === null ? p.intervalMin : Math.min(resolutionMin, p.intervalMin)
    }
    if (confirmedBulk.length > 1) checks.push({ key: 'multiple_bulk', severity: 'info', message: `${confirmedBulk.length} bulk meters are confirmed points of supply; the site series is their sum.` })
    const single = confirmedBulk.length === 1 ? confirmedBulk[0] : null
    const md = single
      ? monthlyMaxDemand({
          kw: (single.primary as ChannelData).readings,
          kva: single.kva && single.kva.intervalMin === (single.primary as ChannelData).intervalMin ? single.kva.readings : null,
          intervalMin: (single.primary as ChannelData).intervalMin,
        })
      : null
    mdMonthly = md && 'months' in md ? md.months : monthlyMaxDemandFromHourly(series, year)
    peakKw = single ? intervalMax(single.primary as ChannelData) : maxOf(series)
    peakSource = single ? 'interval' : 'hourly'
  } else if (basis === 'S4') {
    const b = input.bills
    if (!b || b.months.length !== 12) throw new LoadModelError('no_bills', 'Enter twelve months of bills first (Site profile → Monthly bills).')
    const r = buildS4({
      shape: expandArchetype(getArchetype(b.archetype), year),
      monthlyKwh: b.months.map((m) => m.kwh),
      monthlyKva: b.months.map((m) => m.kva),
      powerFactor: b.powerFactor,
      referenceYear: year,
    })
    r.warnings.forEach((w, i) => checks.push({ key: `s4:${i}`, severity: 'warning', message: w }))
    series = r.series
    mdMonthly = monthlyMaxDemandFromHourly(series, year, b.powerFactor)
    peakKw = maxOf(series)
    resolutionMin = null
  } else {
    series = buildS2({ tenants: t.s2, commonAreaPct: input.commonAreaPct })
    effective = t.metered > 0 ? 'S2' : 'S3'
    fullYearFromData = t.metered > 0 && common.meetsThreshold
    if (effective === 'S3') designMdKw = designMaxDemandSynth(t.synths, input.diversityFactor)
    mdMonthly = monthlyMaxDemandFromHourly(series, year)
    peakKw = maxOf(series)
    if (t.s2.length === 0) checks.push({ key: 'all_excluded', severity: 'warning', message: 'Every tenant is excluded, so the site series is zero.' })
  }

  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    if (!Number.isFinite(series[h])) throw new LoadModelError('series_incomplete', 'The site series has hours that could not be filled.')
  }

  return {
    basis: effective,
    referenceYear: year,
    series,
    mdMonthly,
    designMdKw,
    coverage: {
      window: basis === 'S1' ? dataWindow : common.window,
      commonShare: t.metered > 0 ? common.share : null,
      meetsThreshold: common.meetsThreshold,
      metered: t.metered,
      synthesised: t.synthesised,
      excluded: t.excluded,
      unassigned: t.unassigned,
      coveredByChildren: t.coveredByChildren,
      shapeOnlyMeters: t.shapeOnly,
      fullYearFromData,
      peakKw,
      peakSource,
      resolutionMin,
    },
    reconciliation: { bulk: bulkRecon, parents },
    tenants: t.summaries,
    checks,
  }
}
```

- [ ] **Step 4: Export from the barrel**

Append to `packages/shared/src/services/solar/load/index.ts`:

```ts
export * from './hierarchy'
export * from './profile-stats'
export * from './downsample'
export * from './auto-match'
export * from './build-site-load'
```

- [ ] **Step 5: Run to see it pass**

Run: `pnpm --filter @esite/shared test -- build-site-load` → Expected: PASS (14 tests). If the S1 MD assertion fails because `monthlyMaxDemand` returns `measured_kva` (it will not: `kva` is null in the fixture), print `r.mdMonthly[0]` and correct the implementation, never the assertion. If the double-count test's parent reconciliation months are not all flagged (Σ children 10 vs parent 30 → ratio 0.33), check that `monthly` was filled for both `P` and `C`.

- [ ] **Step 6: Type-check and commit**

```bash
pnpm --filter @esite/shared type-check
git add packages/shared/src/services/solar/load
git commit -m "feat(solar): site-load builder — S1/S2/S3/S4, double-count guard, reconciliation, checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Load settings form ↔ row and validation

**Files:**
- Create: `packages/shared/src/solar/load-settings.ts`
- Test: `packages/shared/src/solar/load-settings.test.ts`
- Modify: `packages/shared/src/solar/index.ts` (add `export * from './load-settings'`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { EMPTY_BILLS_FORM, loadSettingsFormFromRow, validateLoadSettings, type LoadSettingsForm } from './load-settings'

const form = (over: Partial<LoadSettingsForm> = {}): LoadSettingsForm => ({
  loadBasis: 'S2', referenceYear: '', loadGrowthPct: '', diversityFactor: '', commonAreaPct: '', ...over,
})

describe('load settings', () => {
  it('defaults blanks and maps to columns', () => {
    const r = validateLoadSettings(form(), EMPTY_BILLS_FORM)
    expect(r.errors).toEqual({})
    expect(r.values).toEqual({ load_basis: 'S2', reference_year: null, load_growth_pct: 0, diversity_factor: 1, common_area_pct: 0, monthly_bills: null })
  })

  it('validates ranges', () => {
    const r = validateLoadSettings(form({ referenceYear: '1999', loadGrowthPct: '25', diversityFactor: '0.4', commonAreaPct: '101' }), EMPTY_BILLS_FORM)
    expect(Object.keys(r.errors).sort()).toEqual(['commonAreaPct', 'diversityFactor', 'loadGrowthPct', 'referenceYear'])
  })

  it('S4 needs twelve positive monthly kWh; kVA optional but positive', () => {
    const bills = { ...EMPTY_BILLS_FORM, months: EMPTY_BILLS_FORM.months.map((_, i) => ({ kwh: i === 3 ? '' : '1000', kva: i === 0 ? '-1' : '' })) }
    const r = validateLoadSettings(form({ loadBasis: 'S4' }), bills)
    expect(r.errors.bills).toMatch(/April/)
    const ok = { ...EMPTY_BILLS_FORM, months: EMPTY_BILLS_FORM.months.map(() => ({ kwh: '1200', kva: '' })) }
    const r2 = validateLoadSettings(form({ loadBasis: 'S4' }), ok)
    expect(r2.errors).toEqual({})
    expect(r2.values.monthly_bills).toEqual({ archetype: 'retail', powerFactor: 0.95, months: Array.from({ length: 12 }, () => ({ kwh: 1200, kva: null })) })
  })

  it('reads a stored row, showing a stored S3 as "Sum of tenants"', () => {
    const { form: f, bills } = loadSettingsFormFromRow({
      load_basis: 'S3', reference_year: 2024, load_growth_pct: '1.50', diversity_factor: '0.850', common_area_pct: '12.00',
      monthly_bills: { archetype: 'supermarket', powerFactor: 0.9, months: Array.from({ length: 12 }, () => ({ kwh: 10, kva: 5 })) },
    })
    expect(f).toEqual({ loadBasis: 'S2', referenceYear: '2024', loadGrowthPct: '1.5', diversityFactor: '0.85', commonAreaPct: '12' })
    expect(bills.archetype).toBe('supermarket')
    expect(bills.months[0]).toEqual({ kwh: '10', kva: '5' })
  })
})
```

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- solar/load-settings` → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * Load tab settings (functional spec §4.2, §4.5): the basis select, reference year, load growth,
 * diversity, common-area allowance, and the twelve monthly bills that basis S4 is built from.
 * Shared by the form (client) and the action (server) so both give the same sentences.
 */
import { ARCHETYPE_CODES, type ArchetypeCode } from '../services/solar/load/archetypes'

export type LoadBasisChoice = 'S1' | 'S2' | 'S4'
export const LOAD_BASIS_OPTIONS: ReadonlyArray<{ value: LoadBasisChoice; label: string }> = [
  { value: 'S1', label: 'Bulk meter (S1)' },
  { value: 'S2', label: 'Sum of tenants (S2 + S3 for unmetered tenants)' },
  { value: 'S4', label: 'Monthly bills (S4)' },
]
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export interface LoadSettingsForm {
  loadBasis: LoadBasisChoice | ''
  referenceYear: string
  loadGrowthPct: string
  diversityFactor: string
  commonAreaPct: string
}
export interface BillsForm { archetype: ArchetypeCode; powerFactor: string; months: Array<{ kwh: string; kva: string }> }
export const EMPTY_BILLS_FORM: BillsForm = {
  archetype: 'retail',
  powerFactor: '0.95',
  months: Array.from({ length: 12 }, () => ({ kwh: '', kva: '' })),
}
export type LoadSettingsField = keyof LoadSettingsForm | 'bills'
export interface StoredBills { archetype: ArchetypeCode; powerFactor: number; months: Array<{ kwh: number; kva: number | null }> }
export interface LoadSettingsValues {
  load_basis: LoadBasisChoice | null
  reference_year: number | null
  load_growth_pct: number
  diversity_factor: number
  common_area_pct: number
  monthly_bills: StoredBills | null
}

const num = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(Number(v)))

export function loadSettingsFormFromRow(row: Record<string, unknown> | null | undefined): { form: LoadSettingsForm; bills: BillsForm } {
  const r = row ?? {}
  const b = r.monthly_bills as StoredBills | null | undefined
  const basis = r.load_basis === 'S3' ? 'S2' : (r.load_basis as LoadBasisChoice | null | undefined)
  return {
    form: {
      loadBasis: basis ?? '',
      referenceYear: r.reference_year == null ? '' : String(r.reference_year),
      loadGrowthPct: r.load_growth_pct == null ? '' : str(r.load_growth_pct),
      diversityFactor: r.diversity_factor == null ? '' : str(r.diversity_factor),
      commonAreaPct: r.common_area_pct == null ? '' : str(r.common_area_pct),
    },
    bills: b && Array.isArray(b.months) && b.months.length === 12
      ? {
          archetype: (ARCHETYPE_CODES as readonly string[]).includes(b.archetype) ? b.archetype : 'retail',
          powerFactor: String(b.powerFactor ?? 0.95),
          months: b.months.map((m) => ({ kwh: m.kwh == null ? '' : String(m.kwh), kva: m.kva == null ? '' : String(m.kva) })),
        }
      : EMPTY_BILLS_FORM,
  }
}

export function validateLoadSettings(form: LoadSettingsForm, bills: BillsForm): { values: LoadSettingsValues; errors: Partial<Record<LoadSettingsField, string>> } {
  const errors: Partial<Record<LoadSettingsField, string>> = {}
  const year = num(form.referenceYear)
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) errors.referenceYear = 'Reference year must be between 2000 and 2100'
  const growth = num(form.loadGrowthPct) ?? 0
  if (!(growth >= -20 && growth <= 20)) errors.loadGrowthPct = 'Load growth must be between -20 and 20 %/yr'
  const div = num(form.diversityFactor) ?? 1
  if (!(div >= 0.5 && div <= 1)) errors.diversityFactor = 'Diversity factor must be between 0.5 and 1.0'
  const common = num(form.commonAreaPct) ?? 0
  if (!(common >= 0 && common <= 100)) errors.commonAreaPct = 'Common-area allowance must be between 0 and 100 %'

  let monthly: StoredBills | null = null
  const anyBill = bills.months.some((m) => m.kwh.trim() !== '' || m.kva.trim() !== '')
  if (form.loadBasis === 'S4' || anyBill) {
    const bad: string[] = []
    const months = bills.months.map((m, i) => {
      const kwh = num(m.kwh)
      const kva = num(m.kva)
      if (kwh === null || !(kwh > 0)) bad.push(MONTH_NAMES[i])
      else if (kva !== null && !(kva > 0)) bad.push(`${MONTH_NAMES[i]} (kVA)`)
      return { kwh: kwh ?? 0, kva: kva === null || Number.isNaN(kva) ? null : kva }
    })
    const pf = num(bills.powerFactor) ?? 0.95
    if (bad.length > 0) errors.bills = `Enter a positive kWh for every month (and a positive kVA or leave it blank): ${bad.join(', ')}`
    else if (!(pf >= 0.5 && pf <= 1)) errors.bills = 'Power factor must be between 0.5 and 1.0'
    else if (!(ARCHETYPE_CODES as readonly string[]).includes(bills.archetype)) errors.bills = 'Choose a daily shape for the bills'
    else monthly = { archetype: bills.archetype, powerFactor: pf, months }
  }
  return {
    values: {
      load_basis: form.loadBasis === '' ? null : form.loadBasis,
      reference_year: year === null || Number.isNaN(year) ? null : year,
      load_growth_pct: growth,
      diversity_factor: div,
      common_area_pct: common,
      monthly_bills: monthly,
    },
    errors,
  }
}
```

- [ ] **Step 4: Export, run, commit**

Add `export * from './load-settings'` to `packages/shared/src/solar/index.ts`. Then:

```bash
pnpm --filter @esite/shared test -- solar/load-settings 2>&1 | tail -4
pnpm --filter @esite/shared type-check
git add packages/shared/src/solar/load-settings.ts packages/shared/src/solar/load-settings.test.ts packages/shared/src/solar/index.ts
git commit -m "feat(solar): load settings and monthly bills — form, row mapping, validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (4 tests), type-check clean.

---

### Task 14: Readiness rules for Load and Schematics

**Files:**
- Modify: `packages/shared/src/solar/readiness.ts`
- Test: `packages/shared/src/solar/readiness.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
import { computeSolarReadiness, loadReadiness, schematicsReadiness } from './readiness'

describe('loadReadiness (spec §2.3)', () => {
  const ok = { hasSiteLoad: true, stale: false, basis: 'S2' as const, fullYearFromData: true, unassignedTenants: 0, totalTenants: 14, failingAcceptedImports: 0 }
  it('grey before anything exists', () => expect(loadReadiness(null)).toEqual({ status: 'grey', reason: 'Not started' }))
  it('red when an accepted import carries an error', () => expect(loadReadiness({ ...ok, failingAcceptedImports: 1 }).status).toBe('red'))
  it('amber with the exact unassigned sentence', () => expect(loadReadiness({ ...ok, unassignedTenants: 2 })).toEqual({ status: 'amber', reason: 'Load: 2 of 14 tenants unassigned' }))
  it('amber when measured data covers less than 12 months', () => expect(loadReadiness({ ...ok, fullYearFromData: false }).status).toBe('amber'))
  it('green for an accepted synthesised profile', () => expect(loadReadiness({ ...ok, basis: 'S3', fullYearFromData: false }).status).toBe('green'))
  it('amber when inputs changed since the build', () => expect(loadReadiness({ ...ok, stale: true }).status).toBe('amber'))
  it('amber when nothing is built yet', () => expect(loadReadiness({ ...ok, hasSiteLoad: false }).reason).toBe('No site profile built yet'))
  it('green otherwise', () => expect(loadReadiness(ok).status).toBe('green'))
})

describe('schematicsReadiness (spec §2.3)', () => {
  it('green when waived', () => expect(schematicsReadiness({ waived: true, schematics: 0, studyMeters: 5, placedMeters: 0 })).toEqual({ status: 'green', reason: 'No schematic required' }))
  it('grey with none', () => expect(schematicsReadiness({ waived: false, schematics: 0, studyMeters: 5, placedMeters: 0 }).status).toBe('grey'))
  it('amber with unplaced meters', () => expect(schematicsReadiness({ waived: false, schematics: 1, studyMeters: 5, placedMeters: 3 })).toEqual({ status: 'amber', reason: '2 of 5 meters not placed' }))
  it('green when every study meter is placed', () => expect(schematicsReadiness({ waived: false, schematics: 2, studyMeters: 5, placedMeters: 5 }).status).toBe('green'))
})

describe('computeSolarReadiness with Load and Schematics', () => {
  it('computes the two steps only when the caller passes them', () => {
    const without = computeSolarReadiness(null, 'edit')
    expect(without.find((s) => s.slug === 'load')?.status).toBe('grey')
    const withBoth = computeSolarReadiness(null, 'edit', {
      load: { hasSiteLoad: true, stale: false, basis: 'S2', fullYearFromData: true, unassignedTenants: 0, totalTenants: 1, failingAcceptedImports: 0 },
      schematics: { waived: true, schematics: 0, studyMeters: 0, placedMeters: 0 },
    })
    expect(withBoth.find((s) => s.slug === 'load')).toMatchObject({ status: 'green', live: true })
    expect(withBoth.find((s) => s.slug === 'schematics')).toMatchObject({ status: 'green', live: true })
  })
})
```

(`describe/it/expect` are already imported at the top of the existing test file; add only the new names to its import from `./readiness`.)

- [ ] **Step 2: Run to see it fail** — `pnpm --filter @esite/shared test -- solar/readiness` → FAIL (`loadReadiness` is not exported).

- [ ] **Step 3: Implement**

In `readiness.ts`, add below `siteReadiness`:

```ts
export interface LoadReadinessInput {
  hasSiteLoad: boolean
  /** The stored inputs hash differs from the current one. */
  stale: boolean
  basis: 'S1' | 'S2' | 'S3' | 'S4' | null
  fullYearFromData: boolean
  unassignedTenants: number
  totalTenants: number
  failingAcceptedImports: number
}

export function loadReadiness(i: LoadReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i) return { status: 'grey', reason: 'Not started' }
  if (i.failingAcceptedImports > 0) return { status: 'red', reason: `${i.failingAcceptedImports} accepted import(s) carry a validation error` }
  if (!i.hasSiteLoad) return { status: 'amber', reason: 'No site profile built yet' }
  if (i.unassignedTenants > 0) return { status: 'amber', reason: `Load: ${i.unassignedTenants} of ${i.totalTenants} tenants unassigned` }
  const synthesised = i.basis === 'S3' || i.basis === 'S4'
  if (!synthesised && !i.fullYearFromData) return { status: 'amber', reason: 'Meter data covers less than 12 months' }
  if (i.stale) return { status: 'amber', reason: 'Inputs changed since the profile was built — rebuild it' }
  return { status: 'green', reason: synthesised ? 'Synthesised site profile accepted' : 'Site profile built from 12 months of meter data' }
}

export interface SchematicsReadinessInput { waived: boolean; schematics: number; studyMeters: number; placedMeters: number }

export function schematicsReadiness(i: SchematicsReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i) return { status: 'grey', reason: 'Not started' }
  if (i.waived) return { status: 'green', reason: 'No schematic required' }
  if (i.schematics === 0) return { status: 'grey', reason: 'Not started' }
  const unplaced = Math.max(0, i.studyMeters - i.placedMeters)
  if (unplaced > 0) return { status: 'amber', reason: `${unplaced} of ${i.studyMeters} meters not placed` }
  return { status: 'green', reason: 'Every study meter is placed' }
}

export interface ReadinessExtra {
  load?: LoadReadinessInput | null
  schematics?: SchematicsReadinessInput | null
}
```

Replace `computeSolarReadiness` with (if Phase 5 is merged, its `layout?` parameter stays third and `extra` becomes FOURTH — keep its `layout` branch):

```ts
export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extra?: ReadinessExtra): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      // Load / Schematics are live once their tabs are built (3b-i / 3b-ii flip SOLAR_TABS);
      // their status is computed only when the caller passes the aggregate.
      if (t.slug === 'load' && extra && extra.load !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...loadReadiness(extra.load) }
      if (t.slug === 'schematics' && extra && extra.schematics !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...schematicsReadiness(extra.schematics) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
```

The `computeSolarReadiness` test above expects `live: true` for both steps: flip `built` to `true` for `load` and `schematics` in `SOLAR_TABS` now **only in the test's expectations' support** — i.e. change the two rows of `SOLAR_TABS`:

```ts
  { slug: 'load',       label: 'Load',               built: true,  financial: false, hidden: false },
  { slug: 'schematics', label: 'Schematics',         built: true,  financial: false, hidden: false },
```

These routes are created in plans 3b-i and 3b-ii on this same branch before it is pushed; nothing is pushed in between.

The existing test `readiness.test.ts` › "only Overview and Site & Supply are built in Phase 1" now fails by design. Rename it and update its expectation:

```ts
  it('built tabs: Overview, Site & Supply, Load and Schematics', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'load', 'schematics'])
  })
```

(If Phase 5 is merged, the list also contains `'layout'` in its `SOLAR_TABS` position: `['overview', 'site', 'load', 'schematics', 'layout']`.)

- [ ] **Step 4: Run the whole shared suite, type-check, commit**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter @esite/shared type-check
git add packages/shared/src/solar/readiness.ts packages/shared/src/solar/readiness.test.ts
git commit -m "feat(solar): Load and Schematics readiness rules; tabs marked built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: shared suite green (baseline + the new tests), type-check clean. Any existing test that asserted `load`/`schematics` are unbuilt (e.g. a `SolarTabBar` test expecting "Coming in a later phase" for Load) will fail in the WEB suite; fix those expectations in plan 3b-i Task 11, where the tab bar is exercised.

---

## Self-review (done)

- Spec coverage for this plan's slice: 03 §3 schematics rows (Task 3), `isAnnotated()` + schema-derived contract (Task 5), per-verb RLS on `solar_can_view/edit` with FORCE RLS and bind triggers (Task 3), anchor fields like `floor_plan_markups` (Task 3 `file_path` + `source_revision_id`), `@verify` block (Task 3/4), behavioural assertions red → green with mutations (Tasks 2 and 4), rbac rows are in 3b-i/3b-ii (routes live there), 02 §2 is called not recomputed (Task 12 composes only library functions), §13.3 hierarchy used for reconciliation and the double-count guard (Tasks 8, 12).
- Placeholders: none; every code step is complete.
- Types used later: `BuildSiteLoadInput`, `BuildMeter`, `BuildTenant`, `MonthlyBills`, `LoadCheck`, `BuildSiteLoadResult`, `SITE_LOAD_ENGINE_VERSION`, `usableForLoad`, `siteProfileCharts`, `SiteProfileCharts`, `seriesCsvRows`, `minMaxBuckets`, `gapRanges`, `dailyHeatmap`, `autoMatchMeters`, `MatchProposal`, `wouldCreateCycle`, `MeterLine`, `LoadSettingsForm`, `BillsForm`, `validateLoadSettings`, `loadSettingsFormFromRow`, `LOAD_BASIS_OPTIONS`, `MONTH_NAMES`, `LoadReadinessInput`, `SchematicsReadinessInput`, `ReadinessExtra` — names match their use in 3b-i and 3b-ii.
