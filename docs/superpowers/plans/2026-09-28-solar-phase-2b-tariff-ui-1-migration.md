# Solar Phase 2b — Part 1 of 5: Worktree, migration `00214_solar_tariff_selection.sql`, behavioural assertions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index `2026-09-28-solar-phase-2b-tariff-ui.md` first (decisions D2b-1 … D2b-9 and the ground rules apply to every task here).

**Goal of this part:** one migration that (a) adds the tariff-selection columns to `solar.studies` with a money-level write guard, (b) adds the four money tables (`tariff_overrides`, `tariff_override_charges`, `study_export_rates`, `bill_checks`) with SELECT on `solar_can_see_money` and per-verb RESTRICTIVE write gates, (c) adds the library-operations tables the admin UI needs (`tariffs.error_report`, `tariffs.ingest_job`, `tariffs.due_year_alert`) and the service-only functions (validation fingerprint, job claim, due-year monitor) — proven red → green against production in rolled-back transactions, with seven mutations.

---

### Task 1: Worktree and baseline

**Files:** none (environment only)

- [ ] **Step 1: Create the worktree from the integration branch**

```bash
REPO=~/.config/superpowers/worktrees/esite/solar-phase-1a   # any checkout of WattMatt/e-site works for git worktree
git -C "$REPO" fetch origin
git -C "$REPO" rev-parse --verify origin/feat/solar-integration   # must print a sha; if it fails STOP and ask — the base does not exist yet
git -C "$REPO" worktree add -b feat/solar-phase-2b ~/.config/superpowers/worktrees/esite/solar-phase-2b origin/feat/solar-integration
cd ~/.config/superpowers/worktrees/esite/solar-phase-2b
pnpm install --frozen-lockfile
```
Expected: worktree created on `feat/solar-phase-2b`; install exits 0.

- [ ] **Step 2: Confirm the base carries what this plan builds on**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-2b
ls apps/edge-functions/supabase/migrations | grep -E '^002(0[7-9]|1[0-3])'
test -f packages/shared/src/tariffs/ingest/ingest-core.ts && echo ingest-core-ok
test -f packages/shared/src/services/solar/finance/factors.ts && echo engine-ok
test -f "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx" && echo gated-layout-ok
test -f apps/web/src/lib/solar/api-gate.ts && echo api-gate-ok
```
Expected: `00208_solar_foundation.sql`, `00209_solar_org_settings.sql`, `00210_tariffs_schema.sql`, `00211_solar_meter_data.sql` listed and **no** `00214_*`; the four `…-ok` lines. If `00214` already exists on the base, STOP: another branch claimed the number — re-check the ledger, `origin/main` and open-PR filenames (index, ground rule G3) and pick the next free number everywhere this plan says `00214`.

- [ ] **Step 3: Record the baseline of the three suites + type-check + lint**

```bash
S=/private/tmp/claude-501/solar-2b; mkdir -p "$S"
pnpm --filter @esite/shared test > "$S/base-shared.txt" 2>&1; tail -4 "$S/base-shared.txt"
pnpm --filter web test > "$S/base-web.txt" 2>&1; tail -4 "$S/base-web.txt"
pnpm --filter @esite/db test:ci > "$S/base-db.txt" 2>&1; tail -4 "$S/base-db.txt"
pnpm --filter web type-check > "$S/base-tc.txt" 2>&1; tail -2 "$S/base-tc.txt"
pnpm --filter @esite/shared type-check 2>&1 | tail -2
```
Expected: all green. Write the pass counts into the task log; every later "no regressions" claim is measured against these numbers. If anything is red on the base, STOP and report it — do not start on a red base.

---

### Task 2: Behavioural assertions (RED first)

**Files:**
- Create: `scripts/db/assert-solar-tariff-selection-roles.sql`

The file follows `scripts/db/assert-solar-foundation-roles.sql` exactly: one `DO` block, fixtures minted as `postgres`, then each actor impersonated with `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE`. ⚠ The claim is transaction-local and **outlives `RESET ROLE`**: after the library fixture is published as the platform admin, the claim is **cleared** (`set_config('request.jwt.claims', '', true)`) before any further postgres seeding — otherwise `auth.uid()` still names the admin and the new studies guard would refuse the postgres fixture writes.

- [ ] **Step 1: Write the assertions file**

```sql
-- BEHAVIOURAL assertions for 00214_solar_tariff_selection, run as real roles.
--   00208…00211 are not in the production ledger yet, so dry-run the chain:
--     S=/private/tmp/claude-501/solar-2b; M=apps/edge-functions/supabase/migrations
--     cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql \
--         $M/00211_solar_meter_data.sql > "$S/chain-without-00214.sql"
--     scripts/db/dry-run-migration.sh "$S/chain-without-00214.sql" scripts/db/assert-solar-tariff-selection-roles.sql   (RED: aborts)
--     cat "$S/chain-without-00214.sql" $M/00214_solar_tariff_selection.sql > "$S/chain.sql"
--     scripts/db/dry-run-migration.sh "$S/chain.sql" scripts/db/assert-solar-tariff-selection-roles.sql               (GREEN)
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is
-- deliberately NOT used (it bypasses the paywall, so it has no negative case).
--
-- REFUSAL PATTERN (as the 00208/00210 assertion files): a "…_REFUSED" check
-- catches ONLY the SQLSTATE the design promises. When the statement is
-- (wrongly) allowed, the block raises P0001 itself so the subtransaction rolls
-- the write back and a mutation run cannot corrupt later checks. Any other
-- error is recorded as false.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();   -- subscribed customer org
  v_org2     UUID := gen_random_uuid();   -- a second subscribed org (foreign)
  v_project  UUID := gen_random_uuid();
  v_project2 UUID := gen_random_uuid();   -- same org, second study (override-of-another-study probe)
  v_admin    UUID := gen_random_uuid();   -- org admin: implicit edit_financials
  v_fin      UUID := gen_random_uuid();   -- contractor granted edit_financials
  v_edit     UUID := gen_random_uuid();   -- contractor granted edit
  v_view     UUID := gen_random_uuid();   -- project_manager granted view
  v_client   UUID := gen_random_uuid();   -- client_viewer (never eligible)
  v_sup      UUID := gen_random_uuid();   -- supplier (never eligible)
  v_foreign  UUID := gen_random_uuid();   -- admin of the other subscribed org
  v_tadmin   UUID := gen_random_uuid();   -- platform tariff admin (allow-list row, no org)
  v_lic      UUID;
  v_lic2     UUID;
  v_src      UUID;
  v_y25      UUID;
  v_y26      UUID;
  v_t25      UUID;                        -- published tariff
  v_t25b     UUID;                        -- second published tariff, same year
  v_t26      UUID;                        -- DRAFT tariff
  v_study    UUID;
  v_study2   UUID;
  v_ov       UUID;
  v_ov2      UUID;
  v_oc       UUID;
  v_upd      TIMESTAMPTZ;
  v_rep      UUID;
  v_job      UUID;
  v_fp       TEXT;
  v_n        INT;
  v_txt      TEXT;
  u          UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tsel-probe-org'), (v_org2, 'tsel-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_fin, v_edit, v_view, v_client, v_sup, v_foreign, v_tadmin] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tsel-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_fin, v_org, 'contractor', TRUE), (v_edit, v_org, 'contractor', TRUE),
    (v_view, v_org, 'project_manager', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_sup, v_org, 'supplier', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'tsel-probe-project', v_admin), (v_project2, v_org, 'tsel-probe-project-2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_fin, v_org, 'contractor', TRUE), (v_project, v_edit, v_org, 'contractor', TRUE),
    (v_project, v_view, v_org, 'project_manager', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project, v_sup, v_org, 'supplier', TRUE), (v_project2, v_fin, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '1 year'),
    (v_org2, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES
    (v_project, v_fin, v_org, 'edit_financials'), (v_project, v_edit, v_org, 'edit'),
    (v_project, v_view, v_org, 'view'), (v_project2, v_fin, v_org, 'edit_financials');
  INSERT INTO public.platform_tariff_admins (user_id) VALUES (v_tadmin);

  -- Library: licensee, a published 2025/26 year with two tariffs, a DRAFT 2026/27 year.
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TSEL PROBE MUNICIPALITY', 'GP') RETURNING id INTO v_lic;
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TSEL PROBE OTHER MUNICIPALITY', 'GP') RETURNING id INTO v_lic2;
  INSERT INTO tariffs.source_document (licensee_id, kind, title, financial_year, status, url)
  VALUES (v_lic, 'nersa_decision', 'tsel probe source', '2025/26', 'nersa_approved', 'https://example.invalid/tsel') RETURNING id INTO v_src;
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, approved_increase_pct, state)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 12.72, 'in_review') RETURNING id INTO v_y25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure, min_kva, max_kva)
  VALUES (v_y25, 'TSEL Commercial Flat', 'commercial', 'conventional', 'flat', 0, 1000) RETURNING id INTO v_t25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y25, 'TSEL Commercial Two', 'commercial', 'conventional', 'flat') RETURNING id INTO v_t25b;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, source_document_id, source_locator)
  VALUES (v_t25, 'energy', 'c_per_kWh', 250, 'stated_excl', 'parser', v_src, '{"page": 3, "raw_text": "Energy 250.00 c/kWh"}'),
         (v_t25, 'basic', 'R_per_month', 400, 'stated_excl', 'parser', v_src, '{"page": 3}'),
         (v_t25b, 'energy', 'c_per_kWh', 260, 'stated_excl', 'parser', v_src, '{}');
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y25;
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'in_review') RETURNING id INTO v_y26;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y26, 'TSEL Commercial Flat', 'commercial', 'conventional', 'flat') RETURNING id INTO v_t26;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t26, 'energy', 'c_per_kWh', 280, 'stated_excl', 'parser');

  -- Publish 2025/26 as the platform admin (the guard needs a signed-in admin) …
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tadmin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
  RESET ROLE;
  -- … then CLEAR the claim: it outlives RESET ROLE and would make the postgres
  -- seeding below run "as" the admin.
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y25 AND state = 'published';
  INSERT INTO _r VALUES ('fixture_year_published', v_n = 1);

  INSERT INTO solar.studies (project_id, licensee_name, nmd_kva) VALUES (v_project, 'TSEL PROBE MUNICIPALITY', 500) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id, licensee_name) VALUES (v_project2, 'TSEL PROBE MUNICIPALITY') RETURNING id INTO v_study2;
  -- The service path (auth.uid() NULL) may pin anything published: the guard only checks callers.
  UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study2;

  -- ── 1. View level: reads the study, never money, never pins ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study;
  INSERT INTO _r VALUES ('view_reads_study', v_n = 1);
  UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_pin_tariff_filtered', v_n = 0);
  RESET ROLE;

  -- ── 2. Edit level: passes the row gate, refused by the money guard ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET escalation = '{"version": 1, "overrides": {"2": 20}}' WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', false);
  END;
  -- …but Site & Supply edits (other columns) still work for Edit (00208 unchanged).
  UPDATE solar.studies SET nmd_kva = 600 WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_still_saves_site_columns', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.tariff_overrides;
  INSERT INTO _r VALUES ('edit_sees_no_overrides', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.bill_checks;
  INSERT INTO _r VALUES ('edit_sees_no_bill_checks', v_n = 0);
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version)
    VALUES (v_study, '2026-03-01', 1000, 3000, 2900, -3.333, 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.error_report (tariff_id, project_id, note) VALUES (v_t25, v_project, 'edit-level report');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3. Edit + financials: pins, overrides, bill checks, export rates ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t26 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', false);
  END;
  UPDATE solar.studies SET tariff_id = v_t25, licensee_id = v_lic2 WHERE id = v_study;
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_id = v_t25 AND licensee_id = v_lic;
  INSERT INTO _r VALUES ('fin_pins_published_tariff_licensee_rebound', v_n = 1);
  BEGIN
    UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual"}' WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', false);
  END;
  UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule 2026/27 p4"}',
                           escalation = '{"version": 1, "overrides": {"2": 12.5}}' WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('fin_saves_export_rule_and_escalation', v_n = 1);
  INSERT INTO solar.study_export_rates (study_id, project_id, season, tou, unit, amount_excl_vat, source_note)
  VALUES (v_study, v_project2, 'all', 'all', 'c_per_kWh', 95, 'City SSEG schedule 2026/27 p4');
  SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study AND project_id = v_project AND organisation_id = v_org;
  INSERT INTO _r VALUES ('export_rate_project_bound_from_study', v_n = 1);

  -- Override: stale expected timestamp refused, then created with every charge copied.
  BEGIN
    PERFORM solar.create_tariff_override(v_project, '2000-01-01'::timestamptz);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', false);
  END;
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  v_ov := solar.create_tariff_override(v_project, v_upd);
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE override_id = v_ov AND project_id = v_project;
  INSERT INTO _r VALUES ('override_copies_every_charge', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_override_id = v_ov;
  INSERT INTO _r VALUES ('override_linked_on_study', v_n = 1);
  SELECT id INTO v_oc FROM solar.tariff_override_charges WHERE override_id = v_ov AND component = 'energy';
  BEGIN
    UPDATE solar.tariff_override_charges SET amount_excl_vat = 199 WHERE id = v_oc;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', false);
  END;
  UPDATE solar.tariff_override_charges SET amount_excl_vat = 199, reason = 'Landlord resale rate per lease cl. 14', edited_by = v_admin
   WHERE id = v_oc;
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE id = v_oc AND edited_by = v_fin AND edited_at IS NOT NULL;
  INSERT INTO _r VALUES ('override_edit_stamped_to_caller', v_n = 1);
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t25b WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', false);
  END;
  -- An override belonging to ANOTHER study cannot be attached here.
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study2;
  v_ov2 := solar.create_tariff_override(v_project2, v_upd);
  BEGIN
    UPDATE solar.studies SET tariff_override_id = v_ov2 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', false);
  END;

  INSERT INTO solar.bill_checks (study_id, project_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                 modelled_total_excl_vat, difference_pct, engine_version, tariff_id)
  VALUES (v_study, v_project2, '2026-03-01', 1000, 3000, 2900, -3.333, 'probe', v_t25);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study AND project_id = v_project AND created_by = v_fin;
  INSERT INTO _r VALUES ('fin_bill_check_bound_and_stamped', v_n = 1);
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version)
    VALUES (v_study, '2026-03-15', 1000, 3000, 2900, -3.333, 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', false);
  END;

  INSERT INTO tariffs.error_report (tariff_id, project_id, note, reporter_id, status)
  VALUES (v_t25, v_project, 'Basic charge looks like last year''s', v_admin, 'resolved') RETURNING id INTO v_rep;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep AND reporter_id = v_fin AND status = 'open';
  INSERT INTO _r VALUES ('fin_report_bound_reporter_and_open', v_n = 1);
  UPDATE tariffs.error_report SET status = 'resolved' WHERE id = v_rep;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('reporter_cannot_resolve', v_n = 0);
  BEGIN
    INSERT INTO tariffs.ingest_job (source_document_id, parser, financial_year) VALUES (v_src, 'rfd_pdf', '2025/26');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. View / Edit / client / supplier / foreign never read money ─────────
  FOREACH u IN ARRAY ARRAY[v_view, v_edit, v_client, v_sup, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.tariff_overrides) + (SELECT count(*) FROM solar.tariff_override_charges)
         + (SELECT count(*) FROM solar.study_export_rates) + (SELECT count(*) FROM solar.bill_checks)
      INTO v_n;
    INSERT INTO _r VALUES ('no_money_rows_for_' || CASE u WHEN v_view THEN 'view' WHEN v_edit THEN 'edit'
                           WHEN v_client THEN 'client' WHEN v_sup THEN 'supplier' ELSE 'foreign' END, v_n = 0);
    SELECT count(*) INTO v_n FROM tariffs.error_report;
    INSERT INTO _r VALUES ('no_error_reports_for_' || CASE u WHEN v_view THEN 'view' WHEN v_edit THEN 'edit'
                           WHEN v_client THEN 'client' WHEN v_sup THEN 'supplier' ELSE 'foreign' END, v_n = 0);
    RESET ROLE;
  END LOOP;

  -- ── 5. Admin (implicit edit_financials) reads money ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE override_id = v_ov;
  INSERT INTO _r VALUES ('org_admin_reads_override_charges', v_n = 2);
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  PERFORM solar.revert_tariff_override(v_project, v_upd);
  SELECT count(*) INTO v_n FROM solar.tariff_overrides WHERE id = v_ov;
  INSERT INTO _r VALUES ('revert_deletes_override', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_override_id IS NULL AND tariff_id = v_t25;
  INSERT INTO _r VALUES ('revert_keeps_published_pin', v_n = 1);
  RESET ROLE;

  -- ── 6. Platform tariff admin: reads + resolves reports, queues jobs ───────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tadmin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep;
  INSERT INTO _r VALUES ('tariff_admin_reads_report', v_n = 1);
  UPDATE tariffs.error_report SET status = 'resolved', resolution_note = 'Corrected in 2026/27', resolved_by = v_fin WHERE id = v_rep;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep AND status = 'resolved' AND resolved_by = v_tadmin AND resolved_at IS NOT NULL;
  INSERT INTO _r VALUES ('tariff_admin_resolves_report_stamped', v_n = 1);
  BEGIN
    UPDATE tariffs.error_report SET note = 'rewritten' WHERE id = v_rep;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', false);
  END;
  INSERT INTO tariffs.ingest_job (source_document_id, parser, financial_year, licensee_name, status, requested_by)
  VALUES (v_src, 'rfd_pdf', '2025/26', 'TSEL PROBE MUNICIPALITY', 'succeeded', v_fin) RETURNING id INTO v_job;
  SELECT count(*) INTO v_n FROM tariffs.ingest_job WHERE id = v_job AND status = 'queued' AND requested_by = v_tadmin;
  INSERT INTO _r VALUES ('tariff_admin_queues_job_status_forced', v_n = 1);
  BEGIN
    UPDATE tariffs.ingest_job SET status = 'succeeded' WHERE id = v_job;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', false);
  END;
  BEGIN
    PERFORM tariffs.record_year_validation(v_y26, 0, 'x');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 7. Service role: validation fingerprint, job claim, bypass ────────────
  SET LOCAL ROLE service_role;
  v_fp := tariffs.year_content_fingerprint(v_y26);
  PERFORM tariffs.record_year_validation(v_y26, 0, v_fp);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y26 AND validated_at IS NOT NULL AND validation_blocking = 0;
  INSERT INTO _r VALUES ('service_records_validation_on_matching_fingerprint', v_n = 1);
  UPDATE tariffs.charge SET amount_excl_vat = 281 WHERE tariff_id = v_t26;
  BEGIN
    PERFORM tariffs.record_year_validation(v_y26, 0, v_fp);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM tariffs.claim_ingest_job() c WHERE c.id = v_job AND c.status = 'running';
  INSERT INTO _r VALUES ('service_claims_queued_job', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.claim_ingest_job() c WHERE c.id = v_job;
  INSERT INTO _r VALUES ('claimed_job_not_claimed_twice', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study;
  INSERT INTO _r VALUES ('service_role_reads_bill_checks', v_n = 1);
  RESET ROLE;

  -- ── 8. Due-year monitor (cron runs as postgres) ───────────────────────────
  v_n := tariffs.record_due_year_alerts('municipal', DATE '2026-07-02');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert
   WHERE licensee_id = v_lic AND missing_financial_year = '2026/27' AND latest_published_fy = '2025/26' AND resolved_at IS NULL;
  INSERT INTO _r VALUES ('monitor_alerts_licensee_without_current_year', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic2;
  INSERT INTO _r VALUES ('monitor_ignores_never_ingested_licensee', v_n = 0);
  PERFORM tariffs.record_due_year_alerts('municipal', DATE '2026-07-02');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('monitor_is_idempotent', v_n = 1);
  PERFORM tariffs.record_due_year_alerts('municipal', DATE '2026-01-15');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic AND resolved_at IS NOT NULL;
  INSERT INTO _r VALUES ('monitor_resolves_when_covered', v_n = 1);
  BEGIN
    PERFORM tariffs.record_due_year_alerts('weekly', DATE '2026-01-15');
    INSERT INTO _r VALUES ('monitor_unknown_regime_REFUSED', false);
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _r VALUES ('monitor_unknown_regime_REFUSED', true);
  END;

  -- ── 9. Lapse: hidden but kept ─────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.bill_checks;
  INSERT INTO _r VALUES ('lapsed_fin_reads_no_money', v_n = 0);
  UPDATE solar.studies SET tariff_id = v_t25b WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_fin_pin_filtered', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study;
  INSERT INTO _r VALUES ('lapsed_rows_kept', v_n = 1);

  -- ── 10. anon: nothing ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.bill_checks LIMIT 1;
    INSERT INTO _r VALUES ('anon_bill_checks_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_bill_checks_REFUSED', true);
  END;
  BEGIN
    PERFORM 1 FROM tariffs.error_report LIMIT 1;
    INSERT INTO _r VALUES ('anon_error_report_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_error_report_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it RED against the chain WITHOUT 00214**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-2b
S=/private/tmp/claude-501/solar-2b; M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql \
    $M/00211_solar_meter_data.sql > "$S/chain-without-00214.sql"
grep -n -i -E '^\s*(BEGIN|COMMIT)\s*;' "$S/chain-without-00214.sql" || echo "no-txn-control-ok"
scripts/db/dry-run-migration.sh "$S/chain-without-00214.sql" scripts/db/assert-solar-tariff-selection-roles.sql 2>&1 | tee "$S/dry-red.txt" | tail -8
```
Expected: `no-txn-control-ok`, then the file reported as ONE failed assertion (it aborts: `column "tariff_id" of relation "studies" does not exist` or `relation "solar.bill_checks" does not exist`). Keep `$S/dry-red.txt` for the PR body. If the chain itself fails to apply (e.g. a later apply put 00208…00211 into the ledger), drop the applied files from the `cat` and note which in the task log.

- [ ] **Step 3: Commit the assertions**

```bash
git add scripts/db/assert-solar-tariff-selection-roles.sql
git commit -m "test(solar-tariff): behavioural assertions for 00214 (red)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration `00214_solar_tariff_selection.sql` (GREEN)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00214_solar_tariff_selection.sql`

Design notes the implementer must keep (they are what the assertions pin):
- **Money write guard on `solar.studies` is a trigger, not a policy.** 00208 pins "exactly ONE policy covering SELECT on `solar.studies`" and "no RESTRICTIVE read policy in `solar`"; a column-level policy is not expressible anyway. `studies_tariff_guard` (INVOKER, BEFORE INSERT OR UPDATE) fires only when one of `licensee_id, tariff_id, tariff_override_id, export_rule, escalation` changes, and refuses a signed-in caller without `solar_can_see_money` with `42501`. The service path (`auth.uid()` NULL) is allowed, as every other Solar bind trigger.
- **Only a published or superseded tariff can be pinned; `licensee_id` is derived from it** (a forged licensee is overwritten). An override must belong to THIS study AND to the pinned tariff — so a tariff change under an override is refused (`23514`), and the UI says "Revert the project override first".
- **Money tables** keep `project_id` + `organisation_id` bound from the parent by `solar.money_row_bind()` (SECURITY DEFINER, as `studies_bind`), because RLS keys on `project_id` and a client-supplied one would be a cross-project write (the 00051 shape). SELECT: exactly one PERMISSIVE policy on `solar_can_see_money`. Writes: PERMISSIVE `user_has_project_access` + RESTRICTIVE `solar_can_see_money`, **one per verb** (never `FOR ALL`: it would narrow reads — the 00205 bug).
- **A changed override rate needs a reason** — trigger raises `23514` and a CHECK backs it; `edited_by/edited_at` bound to the caller.
- `tariffs.*` additions conform to 00210's schema-wide directives (FORCE RLS on every table; no `FOR ALL`, no RESTRICTIVE policy in `tariffs`).
- Service-only functions (`record_year_validation`, `year_content_fingerprint`, `claim_ingest_job`, `record_due_year_alerts`): `REVOKE ALL … FROM PUBLIC, anon, authenticated` spelled out per function (the repo-wide anon-EXECUTE guard reads the migration TEXT).
- The `[mutation-probe Mn]` comments mark the lines Task 4 mutates; they are inert.

- [ ] **Step 1: Write the migration**

```sql
-- ---------------------------------------------------------------------------
-- Migration 00214: Solar tariff selection + tariff-library operations (Phase 2b)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §5 (Tariff tab) and §12 (platform
-- tariff library); docs/solar/03-data-model-and-security.md §3 (studies
-- columns, tariff_overrides + tariff_override_charges, bill_checks; money
-- tables gated by solar_can_see_money) and §3.1 (RLS pattern); decisions D-03,
-- D-03b, D-07, D-10, D-29 in docs/solar/06-open-decisions.md. Plan:
-- docs/superpowers/plans/2026-09-28-solar-phase-2b-tariff-ui*.md.
--
-- WHAT.
--   solar.studies  + licensee_id, tariff_id, tariff_override_id, export_rule,
--                  escalation. Written only at Edit + financials
--                  (studies_tariff_guard); a pinned tariff must be published
--                  or superseded; licensee_id is derived from it.
--   solar.tariff_overrides, solar.tariff_override_charges — the project copy
--                  of the pinned tariff (D-10 landlord resale); a changed rate
--                  carries a reason.
--   solar.study_export_rates — municipal export rate entered by the user with
--                  a mandatory source note (the NERSA books publish none).
--   solar.bill_checks — one real bill against the engine's model.
--   tariffs.error_report — "Report a tariff error" queue for the platform
--                  tariff admins (a platform queue, NOT a project work item:
--                  the admins are not project members, see plan D2b-3).
--   tariffs.ingest_job — PDF ingests queued for the staff worker
--                  (scripts/tariffs/ingest-worker.ts: needs poppler).
--   tariffs.due_year_alert + tariffs.record_due_year_alerts(regime, on) —
--                  the due-year monitor.
--   tariffs.year_content_fingerprint / tariffs.record_year_validation —
--                  the 2b "Validate" action records a verdict only on the
--                  content it actually checked.
--   solar.create_tariff_override / solar.revert_tariff_override — atomic,
--                  stale-guarded, SECURITY INVOKER (RLS decides).
--
-- WHO. Money rows (the four solar tables): read and written at Edit +
-- financials only (solar_can_see_money). Studies' tariff columns: written at
-- Edit + financials only; readable at View like the rest of the study (none of
-- them holds a rand value: the manual export RATE lives in
-- solar.study_export_rates). tariffs.error_report: inserted by an Edit +
-- financials user of the project, read by the reporter and platform tariff
-- admins, resolved by platform tariff admins. tariffs.ingest_job /
-- due_year_alert: platform tariff admins read; the service role writes.
--
-- OWNER STEP (NOT in this migration; pg_cron is scheduled through the
-- Management API, as every other cron job):
--   SELECT cron.schedule('tariffs-due-year-eskom', '0 5 1 4 *',
--          $c$SELECT tariffs.record_due_year_alerts('eskom')$c$);
--   SELECT cron.schedule('tariffs-due-year-municipal', '0 5 1 7 *',
--          $c$SELECT tariffs.record_due_year_alerts('municipal')$c$);
--   05:00 UTC = 07:00 SAST on 1 April (Eskom year) and 1 July (municipal year).
--
-- 00208's and 00210's schema-wide @verify directives are re-checked on every
-- deploy and this migration conforms to each: FORCE RLS on every new table in
-- solar and tariffs; exactly one SELECT policy on solar.studies (unchanged);
-- no RESTRICTIVE policy covering SELECT anywhere in solar; no FOR ALL and no
-- RESTRICTIVE policy anywhere in tariffs; every SECURITY DEFINER function
-- revokes EXECUTE from PUBLIC and anon.
--
-- DEPENDS ON 00208 (solar helpers, studies), 00210 (tariffs schema).
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- The "[mutation-probe Mn]" comments mark lines the red/green mutation runs
-- delete or rewrite; they are inert.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- column: solar.studies.licensee_id
-- column: solar.studies.tariff_id
-- column: solar.studies.tariff_override_id
-- column: solar.studies.export_rule
-- column: solar.studies.escalation
-- constraint: studies_export_rule_shape ON solar.studies
-- constraint: studies_escalation_shape ON solar.studies
-- table: solar.tariff_overrides
-- table: solar.tariff_override_charges
-- table: solar.study_export_rates
-- table: solar.bill_checks
-- table: tariffs.error_report
-- table: tariffs.ingest_job
-- table: tariffs.due_year_alert
-- constraint: override_charge_edit_has_reason ON solar.tariff_override_charges
-- constraint: bill_checks_first_of_month ON solar.bill_checks
-- constraint: study_export_rates_note_required ON solar.study_export_rates
-- function: solar.studies_tariff_guard()
-- function: solar.money_row_bind()
-- function: solar.tariff_override_charges_guard()
-- function: solar.create_tariff_override(uuid, timestamptz)
-- function: solar.revert_tariff_override(uuid, timestamptz)
-- function: tariffs.error_report_bind()
-- function: tariffs.ingest_job_bind()
-- function: tariffs.claim_ingest_job()
-- function: tariffs.year_content_fingerprint(uuid)
-- function: tariffs.record_year_validation(uuid, integer, text)
-- function: tariffs.record_due_year_alerts(text, date)
-- trigger: studies_tariff_guard ON solar.studies
-- trigger: tariff_overrides_bind ON solar.tariff_overrides
-- trigger: tariff_override_charges_bind ON solar.tariff_override_charges
-- trigger: tariff_override_charges_guard ON solar.tariff_override_charges
-- trigger: study_export_rates_bind ON solar.study_export_rates
-- trigger: bill_checks_bind ON solar.bill_checks
-- trigger: error_report_bind ON tariffs.error_report
-- trigger: ingest_job_bind ON tariffs.ingest_job
-- policy: tariff_overrides_select ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_insert ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_update ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_delete ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_insert_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: tariff_overrides_update_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: tariff_overrides_delete_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: override_charges_select ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_insert ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_update ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_delete ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_insert_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: override_charges_update_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: override_charges_delete_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: export_rates_select ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_insert ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_update ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_delete ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_insert_authz ON solar.study_export_rates RESTRICTIVE
-- policy: export_rates_update_authz ON solar.study_export_rates RESTRICTIVE
-- policy: export_rates_delete_authz ON solar.study_export_rates RESTRICTIVE
-- policy: bill_checks_select ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_insert ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_delete ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_insert_authz ON solar.bill_checks RESTRICTIVE
-- policy: bill_checks_delete_authz ON solar.bill_checks RESTRICTIVE
-- policy: error_report_select ON tariffs.error_report PERMISSIVE
-- policy: error_report_insert ON tariffs.error_report PERMISSIVE
-- policy: error_report_update ON tariffs.error_report PERMISSIVE
-- policy: ingest_job_select ON tariffs.ingest_job PERMISSIVE
-- policy: ingest_job_insert ON tariffs.ingest_job PERMISSIVE
-- policy: due_year_alert_select ON tariffs.due_year_alert PERMISSIVE
-- grant_absent: anon SELECT ON solar.tariff_overrides
-- grant_absent: anon SELECT ON solar.tariff_override_charges
-- grant_absent: anon SELECT ON solar.study_export_rates
-- grant_absent: anon SELECT ON solar.bill_checks
-- grant_absent: authenticated UPDATE ON solar.bill_checks
-- grant_absent: anon SELECT ON tariffs.error_report
-- grant_absent: authenticated DELETE ON tariffs.error_report
-- grant_absent: authenticated UPDATE ON tariffs.ingest_job
-- grant_absent: authenticated DELETE ON tariffs.ingest_job
-- grant_absent: authenticated INSERT ON tariffs.due_year_alert
-- grant_absent: anon EXECUTE ON solar.money_row_bind()
-- grant_absent: anon EXECUTE ON solar.create_tariff_override(uuid, timestamptz)
-- grant_absent: anon EXECUTE ON solar.revert_tariff_override(uuid, timestamptz)
-- grant_absent: authenticated EXECUTE ON tariffs.record_year_validation(uuid, integer, text)
-- grant_absent: authenticated EXECUTE ON tariffs.year_content_fingerprint(uuid)
-- grant_absent: authenticated EXECUTE ON tariffs.claim_ingest_job()
-- grant_absent: authenticated EXECUTE ON tariffs.record_due_year_alerts(text, date)
-- anon_execute_absent: ALL prosecdef functions in solar
-- anon_execute_absent: ALL prosecdef functions in tariffs
-- sql: (SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('tariff_overrides', 'tariff_override_charges', 'study_export_rates', 'bill_checks') AND cmd IN ('SELECT', 'ALL'))
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('tariff_overrides', 'tariff_override_charges', 'study_export_rates', 'bill_checks') AND cmd = 'SELECT')
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid IN ('solar.tariff_overrides'::regclass, 'solar.tariff_override_charges'::regclass, 'solar.study_export_rates'::regclass, 'solar.bill_checks'::regclass, 'tariffs.error_report'::regclass, 'tariffs.ingest_job'::regclass, 'tariffs.due_year_alert'::regclass))
-- sql: (SELECT strpos(pg_get_functiondef('solar.studies_tariff_guard()'::regprocedure), 'solar_can_see_money') > 0)
-- behaviour: scripts/db/assert-solar-tariff-selection-roles.sql — every row ok
-- @verify:end

-- ── 1. Money tables (created before the studies columns that reference them)
CREATE TABLE IF NOT EXISTS solar.tariff_overrides (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL UNIQUE REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    base_tariff_id   UUID NOT NULL REFERENCES tariffs.tariff(id),
    note             TEXT,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solar.tariff_override_charges (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_id      UUID NOT NULL REFERENCES solar.tariff_overrides(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    base_charge_id   UUID REFERENCES tariffs.charge(id) ON DELETE SET NULL,
    component        TEXT NOT NULL CHECK (component IN
                       ('energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
                        'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
                        'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other')),
    season           TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou              TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    day_type         TEXT NOT NULL DEFAULT 'all' CHECK (day_type IN ('all', 'weekday', 'saturday', 'sunday')),
    block_min_kwh    NUMERIC(14,3),
    block_max_kwh    NUMERIC(14,3),
    block_basis      TEXT CHECK (block_basis IN ('monthly', 'daily')),
    unit             TEXT NOT NULL CHECK (unit IN
                       ('c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
                        'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct')),
    demand_basis     TEXT CHECK (demand_basis IN ('nmd', 'actual_md', 'peak_window_md', 'utilised_capacity')),
    amount_excl_vat  NUMERIC(14,6) NOT NULL,
    vat_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
    vat_basis        TEXT NOT NULL DEFAULT 'stated_excl' CHECK (vat_basis IN ('stated_excl', 'assumed_excl', 'stated_incl')),
    source_locator   JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason           TEXT,
    edited_by        UUID REFERENCES auth.users(id),
    edited_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT override_charge_block_order CHECK (block_max_kwh IS NULL OR (block_min_kwh IS NOT NULL AND block_max_kwh > block_min_kwh))
);
ALTER TABLE solar.tariff_override_charges ADD CONSTRAINT override_charge_edit_has_reason CHECK (edited_at IS NULL OR length(btrim(coalesce(reason, ''))) > 0);  -- [mutation-probe M3]
CREATE INDEX IF NOT EXISTS tariff_override_charges_override_idx ON solar.tariff_override_charges (override_id);

CREATE TABLE IF NOT EXISTS solar.study_export_rates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    season           TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou              TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    unit             TEXT NOT NULL CHECK (unit IN ('c_per_kWh', 'R_per_kWh')),
    amount_excl_vat  NUMERIC(14,6) NOT NULL CHECK (amount_excl_vat >= 0),
    source_note      TEXT NOT NULL CONSTRAINT study_export_rates_note_required CHECK (length(btrim(source_note)) > 0),
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT study_export_rates_one_per_period UNIQUE (study_id, season, tou)
);

CREATE TABLE IF NOT EXISTS solar.bill_checks (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id                  UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id                UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id           UUID NOT NULL REFERENCES public.organisations(id),
    billing_month             DATE NOT NULL CONSTRAINT bill_checks_first_of_month CHECK (extract(day FROM billing_month) = 1),
    tariff_id                 UUID REFERENCES tariffs.tariff(id),
    tariff_override_id        UUID REFERENCES solar.tariff_overrides(id) ON DELETE SET NULL,
    import_kwh_peak           NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_peak >= 0),
    import_kwh_standard       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_standard >= 0),
    import_kwh_off_peak       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_off_peak >= 0),
    max_demand_kva            NUMERIC(12,2) CHECK (max_demand_kva >= 0),
    actual_total_excl_vat     NUMERIC(14,2) NOT NULL CHECK (actual_total_excl_vat > 0),
    modelled_total_excl_vat   NUMERIC(14,2) NOT NULL,
    difference_pct            NUMERIC(9,3) NOT NULL,
    modelled                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    engine_version            TEXT NOT NULL,
    note                      TEXT,
    created_by                UUID REFERENCES auth.users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bill_checks_study_month_idx ON solar.bill_checks (study_id, billing_month DESC);

-- ── 2. Studies: the tariff selection ────────────────────────────────────────
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS licensee_id UUID REFERENCES tariffs.licensee(id);
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES tariffs.tariff(id);
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS tariff_override_id UUID REFERENCES solar.tariff_overrides(id) ON DELETE SET NULL;
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS export_rule JSONB;
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS escalation JSONB;
-- export_rule = {version, method: linked_tariff|none|manual, sourceNote?}; manual needs a source note.
ALTER TABLE solar.studies ADD CONSTRAINT studies_export_rule_shape CHECK (
    export_rule IS NULL OR (
        jsonb_typeof(export_rule) = 'object'
        AND export_rule->>'method' IN ('linked_tariff', 'none', 'manual')
        AND (export_rule->>'method' <> 'manual' OR length(btrim(coalesce(export_rule->>'sourceNote', ''))) > 0)));
-- escalation = {version, overrides: {"<year n>": pct}}; NULL = the defaults (D-07).
ALTER TABLE solar.studies ADD CONSTRAINT studies_escalation_shape CHECK (
    escalation IS NULL OR (jsonb_typeof(escalation) = 'object' AND jsonb_typeof(escalation->'overrides') = 'object'));

-- INVOKER: every read below is one the caller may already make (published
-- tariffs via 00210's reader policy; the study's own override via the money
-- SELECT policy). A draft tariff or a foreign override is invisible and reads
-- as "not found", which refuses the same way.
CREATE OR REPLACE FUNCTION solar.studies_tariff_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_state  TEXT;
    v_lic    UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.licensee_id, NEW.tariff_id, NEW.tariff_override_id, NEW.export_rule, NEW.escalation)
           IS NOT DISTINCT FROM (OLD.licensee_id, OLD.tariff_id, OLD.tariff_override_id, OLD.export_rule, OLD.escalation) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.licensee_id IS NULL AND NEW.tariff_id IS NULL AND NEW.tariff_override_id IS NULL
       AND NEW.export_rule IS NULL AND NEW.escalation IS NULL THEN
        RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.solar_can_see_money(NEW.project_id) THEN RAISE EXCEPTION 'solar.studies: the tariff, export rule and escalation need Edit + financials' USING ERRCODE = '42501'; END IF;  -- [mutation-probe M1]
    IF NEW.tariff_id IS NOT NULL THEN
        SELECT y.state, y.licensee_id INTO v_state, v_lic
          FROM tariffs.tariff t JOIN tariffs.tariff_year y ON y.id = t.tariff_year_id
         WHERE t.id = NEW.tariff_id;
        IF v_state IS NULL OR v_state NOT IN ('published', 'superseded') THEN RAISE EXCEPTION 'solar.studies: only a published tariff can be pinned' USING ERRCODE = '23514'; END IF;  -- [mutation-probe M4]
        NEW.licensee_id := v_lic;
    END IF;
    IF NEW.tariff_override_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.tariff_overrides o
         WHERE o.id = NEW.tariff_override_id AND o.study_id = NEW.id AND o.base_tariff_id IS NOT DISTINCT FROM NEW.tariff_id) THEN
        RAISE EXCEPTION 'solar.studies: the project override belongs to another study or tariff; revert it first'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.studies_tariff_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_tariff_guard() FROM anon;
-- Fires after 00208's studies_bind (triggers fire in name order).
CREATE TRIGGER studies_tariff_guard BEFORE INSERT OR UPDATE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_tariff_guard();

-- ── 3. Binding for the money tables ─────────────────────────────────────────
-- project_id and organisation_id come from the parent row, never the client
-- (RLS keys on project_id). The parent is immutable. Attribution is bound.
-- SECURITY DEFINER like 00208's studies_bind: the parent lookup must not
-- depend on what the caller can see (a hidden parent would otherwise surface
-- as a NOT NULL error instead of the named refusal).
CREATE OR REPLACE FUNCTION solar.money_row_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_project  UUID;
    v_org      UUID;
    v_tariff   UUID;
BEGIN
    IF TG_TABLE_NAME = 'tariff_override_charges' THEN
        IF TG_OP = 'UPDATE' AND (NEW.override_id <> OLD.override_id OR NEW.base_charge_id IS DISTINCT FROM OLD.base_charge_id) THEN
            RAISE EXCEPTION 'solar.tariff_override_charges: override_id and base_charge_id are immutable' USING ERRCODE = '42501';
        END IF;
        SELECT o.project_id, o.organisation_id INTO v_project, v_org FROM solar.tariff_overrides o WHERE o.id = NEW.override_id;
    ELSE
        IF TG_OP = 'UPDATE' AND NEW.study_id <> OLD.study_id THEN
            RAISE EXCEPTION 'solar.%: study_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        SELECT s.project_id, s.organisation_id, s.tariff_id INTO v_project, v_org, v_tariff FROM solar.studies s WHERE s.id = NEW.study_id;
    END IF;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.%: parent row not found', TG_TABLE_NAME USING ERRCODE = '23503';
    END IF;
    NEW.project_id := v_project;
    NEW.organisation_id := v_org;

    IF TG_TABLE_NAME = 'tariff_overrides' THEN
        IF TG_OP = 'UPDATE' AND NEW.base_tariff_id <> OLD.base_tariff_id THEN
            RAISE EXCEPTION 'solar.tariff_overrides: base_tariff_id is immutable' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'INSERT' AND NEW.base_tariff_id IS DISTINCT FROM v_tariff THEN
            RAISE EXCEPTION 'solar.tariff_overrides: an override copies the study''s pinned tariff' USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME IN ('tariff_overrides', 'study_export_rates', 'bill_checks') THEN
            NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        END IF;
        NEW.created_at := NOW();
    ELSE
        NEW.created_at := OLD.created_at;
        IF TG_TABLE_NAME IN ('tariff_overrides', 'study_export_rates') THEN NEW.created_by := OLD.created_by; END IF;
    END IF;
    IF TG_TABLE_NAME <> 'bill_checks' THEN NEW.updated_at := NOW(); END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.money_row_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.money_row_bind() FROM anon;

CREATE TRIGGER tariff_overrides_bind BEFORE INSERT OR UPDATE ON solar.tariff_overrides
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER tariff_override_charges_bind BEFORE INSERT OR UPDATE ON solar.tariff_override_charges
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER study_export_rates_bind BEFORE INSERT OR UPDATE ON solar.study_export_rates
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER bill_checks_bind BEFORE INSERT ON solar.bill_checks
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();

-- A changed rate (or an added row) carries a reason; the stamp is the caller.
CREATE OR REPLACE FUNCTION solar.tariff_override_charges_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_changed BOOLEAN;
BEGIN
    v_changed := TG_OP = 'INSERT' AND NEW.base_charge_id IS NULL
        OR TG_OP = 'UPDATE' AND
           (NEW.component, NEW.season, NEW.tou, NEW.day_type, NEW.block_min_kwh, NEW.block_max_kwh, NEW.block_basis,
            NEW.unit, NEW.demand_basis, NEW.amount_excl_vat, NEW.vat_rate, NEW.vat_basis)
           IS DISTINCT FROM
           (OLD.component, OLD.season, OLD.tou, OLD.day_type, OLD.block_min_kwh, OLD.block_max_kwh, OLD.block_basis,
            OLD.unit, OLD.demand_basis, OLD.amount_excl_vat, OLD.vat_rate, OLD.vat_basis);
    IF v_changed THEN
        IF length(btrim(coalesce(NEW.reason, ''))) = 0 THEN RAISE EXCEPTION 'solar.tariff_override_charges: a changed rate needs a reason' USING ERRCODE = '23514'; END IF;  -- [mutation-probe M3]
        NEW.edited_at := NOW();
        NEW.edited_by := COALESCE(auth.uid(), NEW.edited_by);
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.edited_at := OLD.edited_at;
        NEW.edited_by := OLD.edited_by;
    ELSE
        NEW.edited_at := NULL;
        NEW.edited_by := NULL;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_guard() FROM anon;
CREATE TRIGGER tariff_override_charges_guard BEFORE INSERT OR UPDATE ON solar.tariff_override_charges
    FOR EACH ROW EXECUTE FUNCTION solar.tariff_override_charges_guard();

-- ── 4. RLS on the money tables (the 00200 shape, SELECT on see_money) ───────
ALTER TABLE solar.tariff_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_override_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_override_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.study_export_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.study_export_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.bill_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.bill_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY tariff_overrides_select ON solar.tariff_overrides FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));  -- [mutation-probe M2]
CREATE POLICY tariff_overrides_insert ON solar.tariff_overrides FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_update ON solar.tariff_overrides FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_delete ON solar.tariff_overrides FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_insert_authz ON solar.tariff_overrides AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY tariff_overrides_update_authz ON solar.tariff_overrides AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY tariff_overrides_delete_authz ON solar.tariff_overrides AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

CREATE POLICY override_charges_select ON solar.tariff_override_charges FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_insert ON solar.tariff_override_charges FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY override_charges_update ON solar.tariff_override_charges FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY override_charges_delete ON solar.tariff_override_charges FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY override_charges_insert_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_update_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_delete_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

CREATE POLICY export_rates_select ON solar.study_export_rates FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_insert ON solar.study_export_rates FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY export_rates_update ON solar.study_export_rates FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY export_rates_delete ON solar.study_export_rates FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY export_rates_insert_authz ON solar.study_export_rates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_update_authz ON solar.study_export_rates AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_delete_authz ON solar.study_export_rates AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

-- bill_checks: a record, not a draft: no UPDATE policy and no UPDATE grant.
CREATE POLICY bill_checks_select ON solar.bill_checks FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY bill_checks_insert ON solar.bill_checks FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY bill_checks_delete ON solar.bill_checks FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY bill_checks_insert_authz ON solar.bill_checks AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));  -- [mutation-probe M6]
CREATE POLICY bill_checks_delete_authz ON solar.bill_checks AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.bill_checks TO authenticated;
REVOKE UPDATE, TRUNCATE ON solar.bill_checks FROM authenticated;   -- the schema default granted it at CREATE TABLE
GRANT ALL ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates, solar.bill_checks TO service_role;
REVOKE ALL ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates, solar.bill_checks FROM anon;

-- ── 5. Override lifecycle (atomic, stale-guarded, RLS decides) ──────────────
CREATE OR REPLACE FUNCTION solar.create_tariff_override(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
    v_id     UUID;
BEGIN
    SELECT id, tariff_id, tariff_override_id, updated_at INTO v_study
      FROM solar.studies WHERE project_id = p_project_id FOR UPDATE;
    IF v_study.id IS NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: no study for this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_study.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.create_tariff_override: stale' USING ERRCODE = '40001';
    END IF;
    IF v_study.tariff_id IS NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: pin a published tariff first' USING ERRCODE = '23514';
    END IF;
    IF v_study.tariff_override_id IS NOT NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: the study already has an override' USING ERRCODE = '23505';
    END IF;
    INSERT INTO solar.tariff_overrides (study_id, project_id, organisation_id, base_tariff_id)
    VALUES (v_study.id, p_project_id, '00000000-0000-0000-0000-000000000000', v_study.tariff_id)
    RETURNING id INTO v_id;
    INSERT INTO solar.tariff_override_charges
        (override_id, project_id, organisation_id, base_charge_id, component, season, tou, day_type,
         block_min_kwh, block_max_kwh, block_basis, unit, demand_basis, amount_excl_vat, vat_rate, vat_basis, source_locator)
    SELECT v_id, p_project_id, '00000000-0000-0000-0000-000000000000', c.id, c.component, c.season, c.tou, c.day_type,
           c.block_min_kwh, c.block_max_kwh, c.block_basis, c.unit, c.demand_basis, c.amount_excl_vat, c.vat_rate, c.vat_basis,
           c.source_locator || jsonb_build_object('source_document_id', c.source_document_id)
      FROM tariffs.charge c WHERE c.tariff_id = v_study.tariff_id;
    UPDATE solar.studies SET tariff_override_id = v_id WHERE id = v_study.id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION solar.revert_tariff_override(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
BEGIN
    SELECT id, tariff_override_id, updated_at INTO v_study
      FROM solar.studies WHERE project_id = p_project_id FOR UPDATE;
    IF v_study.id IS NULL THEN
        RAISE EXCEPTION 'solar.revert_tariff_override: no study for this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_study.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.revert_tariff_override: stale' USING ERRCODE = '40001';
    END IF;
    IF v_study.tariff_override_id IS NULL THEN RETURN; END IF;
    UPDATE solar.studies SET tariff_override_id = NULL WHERE id = v_study.id;
    DELETE FROM solar.tariff_overrides WHERE id = v_study.tariff_override_id;
END $$;

REVOKE ALL ON FUNCTION solar.create_tariff_override(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.create_tariff_override(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.create_tariff_override(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) TO authenticated, service_role;

-- ── 6. tariffs.error_report ("Report a tariff error") ───────────────────────
CREATE TABLE IF NOT EXISTS tariffs.error_report (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id        UUID NOT NULL REFERENCES tariffs.tariff(id),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    reporter_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note             TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
    resolution_note  TEXT,
    resolved_by      UUID REFERENCES auth.users(id),
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS error_report_status_idx ON tariffs.error_report (status, created_at DESC);

CREATE OR REPLACE FUNCTION tariffs.error_report_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.reporter_id := COALESCE(auth.uid(), NEW.reporter_id);
        NEW.status := 'open';
        NEW.resolution_note := NULL;
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
        NEW.created_at := NOW();
        RETURN NEW;
    END IF;
    IF (NEW.tariff_id, NEW.project_id, NEW.reporter_id, NEW.note, NEW.created_at)
       IS DISTINCT FROM (OLD.tariff_id, OLD.project_id, OLD.reporter_id, OLD.note, OLD.created_at) THEN
        RAISE EXCEPTION 'tariffs.error_report: only the status and resolution note change' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'open' THEN
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.resolved_by := COALESCE(auth.uid(), NEW.resolved_by);
        NEW.resolved_at := NOW();
    ELSE
        NEW.resolved_by := OLD.resolved_by;
        NEW.resolved_at := OLD.resolved_at;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.error_report_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.error_report_bind() FROM anon;
CREATE TRIGGER error_report_bind BEFORE INSERT OR UPDATE ON tariffs.error_report
    FOR EACH ROW EXECUTE FUNCTION tariffs.error_report_bind();

ALTER TABLE tariffs.error_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.error_report FORCE ROW LEVEL SECURITY;
CREATE POLICY error_report_select ON tariffs.error_report FOR SELECT TO authenticated
    USING (reporter_id = (SELECT auth.uid()) OR (SELECT public.is_platform_tariff_admin()));
-- The tariff must be one the reporter can read (the subquery is under 00210's RLS).
CREATE POLICY error_report_insert ON tariffs.error_report FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id) AND EXISTS (SELECT 1 FROM tariffs.tariff t WHERE t.id = error_report.tariff_id));  -- [mutation-probe M7]
CREATE POLICY error_report_update ON tariffs.error_report FOR UPDATE TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.error_report FROM authenticated;
GRANT SELECT, INSERT ON tariffs.error_report TO authenticated;
GRANT UPDATE (status, resolution_note, resolved_by, resolved_at) ON tariffs.error_report TO authenticated;

-- ── 7. tariffs.ingest_job (PDF ingests for the staff worker) ────────────────
CREATE TABLE IF NOT EXISTS tariffs.ingest_job (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id  UUID NOT NULL REFERENCES tariffs.source_document(id),
    parser              TEXT NOT NULL CHECK (parser IN ('province_xlsx', 'eskom_xlsm', 'rfd_pdf')),
    financial_year      TEXT NOT NULL CHECK (financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    licensee_name       TEXT,
    create_licensees    BOOLEAN NOT NULL DEFAULT false,
    status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    requested_by        UUID REFERENCES auth.users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    ingest_run_id       UUID REFERENCES tariffs.ingest_run(id),
    report              JSONB,
    error               TEXT,
    CONSTRAINT ingest_job_rfd_names_licensee CHECK (parser <> 'rfd_pdf' OR length(btrim(coalesce(licensee_name, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS ingest_job_queue_idx ON tariffs.ingest_job (status, requested_at);

CREATE OR REPLACE FUNCTION tariffs.ingest_job_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.requested_by := auth.uid();
        NEW.status := 'queued';
        NEW.requested_at := NOW();
        NEW.claimed_at := NULL;
        NEW.finished_at := NULL;
        NEW.ingest_run_id := NULL;
        NEW.report := NULL;
        NEW.error := NULL;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.ingest_job_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.ingest_job_bind() FROM anon;
CREATE TRIGGER ingest_job_bind BEFORE INSERT ON tariffs.ingest_job
    FOR EACH ROW EXECUTE FUNCTION tariffs.ingest_job_bind();

ALTER TABLE tariffs.ingest_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_job FORCE ROW LEVEL SECURITY;
CREATE POLICY ingest_job_select ON tariffs.ingest_job FOR SELECT TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY ingest_job_insert ON tariffs.ingest_job FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.ingest_job FROM authenticated;
GRANT SELECT ON tariffs.ingest_job TO authenticated;
GRANT INSERT (source_document_id, parser, financial_year, licensee_name, create_licensees, status, requested_by) ON tariffs.ingest_job TO authenticated;

-- The worker claims the oldest queued job; SKIP LOCKED makes two workers safe.
CREATE OR REPLACE FUNCTION tariffs.claim_ingest_job()
RETURNS SETOF tariffs.ingest_job LANGUAGE sql SET search_path = '' AS $$
    UPDATE tariffs.ingest_job j SET status = 'running', claimed_at = NOW()
     WHERE j.id = (SELECT q.id FROM tariffs.ingest_job q WHERE q.status = 'queued'
                    ORDER BY q.requested_at, q.id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j.*;
$$;

-- ── 8. Validation fingerprint (the 2b Validate action) ──────────────────────
-- The year's content as the validators see it. Review stamps are not content
-- (the same rule as 00210's invalidate_year_validation).
CREATE OR REPLACE FUNCTION tariffs.year_content_fingerprint(p_year_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT md5(
        coalesce((SELECT string_agg((to_jsonb(t) - 'updated_at' - 'created_at')::text, '|' ORDER BY t.id)
                    FROM tariffs.tariff t WHERE t.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(c) - 'reviewed_at' - 'reviewed_by' - 'created_at')::text, '|' ORDER BY c.id)
                    FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id WHERE t.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(l) - 'created_at')::text, '|' ORDER BY l.id)
                    FROM tariffs.loss_factor l WHERE l.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(s) - 'created_at')::text, '|' ORDER BY s.id)
                    FROM tariffs.sseg_rule s WHERE s.tariff_year_id = p_year_id), ''));
$$;

-- Records the verdict only if the content is still what was checked. The year
-- row is locked first, so a content write racing this call either changed the
-- fingerprint already (refused here) or waits for this commit and then clears
-- the record through 00210's invalidate_year_validation trigger.
CREATE OR REPLACE FUNCTION tariffs.record_year_validation(p_year_id UUID, p_blocking INTEGER, p_fingerprint TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_n INT;
BEGIN
    IF p_blocking IS NULL OR p_blocking < 0 THEN
        RAISE EXCEPTION 'tariffs.record_year_validation: blocking must be >= 0' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM tariffs.tariff_year WHERE id = p_year_id FOR UPDATE;
    IF tariffs.year_content_fingerprint(p_year_id) IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'tariffs.record_year_validation: the year changed while it was being checked' USING ERRCODE = '40001'; END IF;  -- [mutation-probe M5]
    UPDATE tariffs.tariff_year SET validated_at = NOW(), validation_blocking = p_blocking
     WHERE id = p_year_id AND state IN ('ingesting', 'in_review');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'tariffs.record_year_validation: % is not a draft year', p_year_id USING ERRCODE = '23514';
    END IF;
END $$;

-- ── 9. Due-year monitor ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariffs.due_year_alert (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id             UUID NOT NULL REFERENCES tariffs.licensee(id) ON DELETE CASCADE,
    regime                  TEXT NOT NULL CHECK (regime IN ('eskom', 'municipal')),
    missing_financial_year  TEXT NOT NULL CHECK (missing_financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    latest_published_fy     TEXT,
    checked_on              DATE NOT NULL,
    resolved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT due_year_alert_once UNIQUE (licensee_id, missing_financial_year)
);
ALTER TABLE tariffs.due_year_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.due_year_alert FORCE ROW LEVEL SECURITY;
CREATE POLICY due_year_alert_select ON tariffs.due_year_alert FOR SELECT TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.due_year_alert FROM authenticated;
GRANT SELECT ON tariffs.due_year_alert TO authenticated;

-- Eskom years start 1 April, municipal 1 July. Only licensees the library has
-- ever published are watched (a never-ingested licensee is a backlog item, not
-- an alert). Resolves alerts whose licensee is now covered. Idempotent.
CREATE OR REPLACE FUNCTION tariffs.record_due_year_alerts(p_regime TEXT, p_on DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_start  INT;
    v_fy     TEXT;
    v_n      INT;
BEGIN
    IF p_regime IS NULL OR p_regime NOT IN ('eskom', 'municipal') THEN
        RAISE EXCEPTION 'tariffs.record_due_year_alerts: regime must be eskom or municipal' USING ERRCODE = '22023';
    END IF;
    v_start := extract(year FROM p_on)::int
             - CASE WHEN extract(month FROM p_on)::int < CASE WHEN p_regime = 'eskom' THEN 4 ELSE 7 END THEN 1 ELSE 0 END;
    v_fy := v_start::text || '/' || lpad(((v_start + 1) % 100)::text, 2, '0');

    UPDATE tariffs.due_year_alert a SET resolved_at = NOW()
     WHERE a.resolved_at IS NULL AND a.regime = p_regime
       AND EXISTS (SELECT 1 FROM tariffs.tariff_year y
                    WHERE y.licensee_id = a.licensee_id AND y.state = 'published'
                      AND y.effective_from <= p_on AND y.effective_to >= p_on);

    INSERT INTO tariffs.due_year_alert (licensee_id, regime, missing_financial_year, latest_published_fy, checked_on)
    SELECT l.id, p_regime, v_fy,
           (SELECT max(y.financial_year) FROM tariffs.tariff_year y
             WHERE y.licensee_id = l.id AND y.state IN ('published', 'superseded')),
           p_on
      FROM tariffs.licensee l
     WHERE (CASE WHEN p_regime = 'eskom' THEN l.kind = 'eskom' ELSE l.kind IN ('municipal', 'metro') END)
       AND EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.licensee_id = l.id AND y.state IN ('published', 'superseded'))
       AND NOT EXISTS (SELECT 1 FROM tariffs.tariff_year y
                        WHERE y.licensee_id = l.id AND y.state = 'published'
                          AND y.effective_from <= p_on AND y.effective_to >= p_on)
    ON CONFLICT (licensee_id, missing_financial_year) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- Service-only functions, spelled out per function (the repo-wide
-- anon-EXECUTE guard reads this TEXT and cannot see a dynamic REVOKE).
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM anon;
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.claim_ingest_job() TO service_role;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM anon;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.year_content_fingerprint(uuid) TO service_role;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.record_year_validation(uuid, integer, text) TO service_role;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM anon;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.record_due_year_alerts(text, date) TO service_role;

GRANT ALL ON tariffs.error_report, tariffs.ingest_job, tariffs.due_year_alert TO service_role;
REVOKE ALL ON tariffs.error_report, tariffs.ingest_job, tariffs.due_year_alert FROM anon;

NOTIFY pgrst, 'reload schema';
```

⚠ `create_tariff_override` inserts a placeholder `organisation_id` (all zeros) that `money_row_bind` overwrites from the parent — the column is `NOT NULL` and the BEFORE trigger runs before the constraint check, so the placeholder never lands (proven by `override_copies_every_charge`, which counts rows bound to the real project). The `project_id` passed is also rebound.

- [ ] **Step 2: Run GREEN**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-2b
S=/private/tmp/claude-501/solar-2b; M=apps/edge-functions/supabase/migrations
cat "$S/chain-without-00214.sql" $M/00214_solar_tariff_selection.sql > "$S/chain.sql"
scripts/db/dry-run-migration.sh "$S/chain.sql" scripts/db/assert-solar-tariff-selection-roles.sql 2>&1 | tee "$S/dry-green.txt" | tail -60
```
Expected: every check `✓`, `0 failed`, **61** checks (51 literal `INSERT INTO _r` rows + 10 from the five-user loop in section 4). Any `✗` → fix the migration, never the assertion, unless the assertion contradicts this plan's design notes (then stop and ask).

- [ ] **Step 3: Prove 00214 changes nothing the earlier assertion files pin**

```bash
for f in scripts/db/assert-solar-foundation-roles.sql scripts/db/assert-solar-org-settings-roles.sql scripts/db/assert-tariffs-schema-roles.sql; do
  echo "== $f"; scripts/db/dry-run-migration.sh "$S/chain.sql" "$f" 2>&1 | tail -3
done
ls scripts/db/assert-solar-meter*.sql 2>/dev/null && for f in scripts/db/assert-solar-meter*.sql; do
  echo "== $f"; scripts/db/dry-run-migration.sh "$S/chain.sql" "$f" 2>&1 | tail -3; done
```
Expected: each `0 failed`.

- [ ] **Step 4: Evaluate every `@verify` block of the chain under the post-00214 state**

The post-push verifier re-runs every block ≥ `00185` on every deploy, so 00208's and 00210's schema-wide directives must hold AFTER 00214 (the 00204/00206 rule). Write this helper to the scratch dir (not committed):

```bash
cat > "$S/verify-chain.mts" <<'EOF'
// Evaluate the @verify blocks of several migrations with a whole chain applied inside BEGIN … ROLLBACK.
//   node --experimental-strip-types verify-chain.mts <repo root> <chain.sql> <migration.sql> [more …]
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const [ROOT, CHAIN, ...MIGS] = process.argv.slice(2)
const { parseVerifyBlock, runDirectives } = await import(`${ROOT}/packages/shared/src/lib/migrations/verify-header.ts`)
function pat(): string {
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  return raw.startsWith('go-keyring-base64:') ? Buffer.from(raw.slice(18), 'base64').toString('utf8').trim() : raw
}
const chain = readFileSync(CHAIN, 'utf8')
if (/^\s*COMMIT\s*;/im.test(chain)) throw new Error('chain contains COMMIT — refusing')
async function query(sql: string) {
  const res = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${pat()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `BEGIN;\n${chain}\n;\n${sql};\nROLLBACK;` }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}
let failed = 0
for (const m of MIGS) {
  const directives = parseVerifyBlock(readFileSync(m, 'utf8'))
  const { passed, failures, skipped } = await runDirectives(directives, query)
  for (const f of failures) console.log(`FAIL ${m} line ${f.directive.line}: ${f.directive.raw.trim()}\n   ${f.reason}`)
  console.log(`${m}: directives=${directives.length} passed=${passed} failed=${failures.length} skipped=${skipped.length}`)
  failed += failures.length
}
process.exit(failed ? 1 : 0)
EOF
test -f packages/shared/src/lib/migrations/verify-header.ts || { echo "verify-header.ts moved: find parseVerifyBlock with grep -rn 'export function parseVerifyBlock' packages scripts"; exit 1; }
node --experimental-strip-types "$S/verify-chain.mts" "$PWD" "$S/chain.sql" \
  $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql \
  $M/00211_solar_meter_data.sql $M/00214_solar_tariff_selection.sql
```
Expected: five lines, each `failed=0`, exit 0. A failure in 00208/00210/00211 means 00214 broke a schema-wide directive: fix 00214 (never weaken the earlier block).

- [ ] **Step 5: Parse the block with the repo's own contract test**

```bash
pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```
Expected: PASS (the parser rejects an unknown directive word, a prose-only line, or an em dash inside a `sql:` payload; the `behaviour:` line's em dash is legal).

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00214_solar_tariff_selection.sql
git commit -m "feat(solar-tariff): 00214 tariff selection, money tables, library operations

studies gains licensee_id/tariff_id/tariff_override_id/export_rule/escalation,
written at Edit + financials only (studies_tariff_guard). Money tables
(tariff_overrides, tariff_override_charges, study_export_rates, bill_checks)
read on solar_can_see_money with per-verb RESTRICTIVE write gates.
tariffs.error_report / ingest_job / due_year_alert and the service-only
validation fingerprint, job claim and due-year monitor functions.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mutations (each assertion that matters must be seen failing)

**Files:** none committed (mutated copies live in `$S`)

Each mutation rewrites ONE marked line of the migration, re-runs the dry run, and must turn exactly the named checks red. The harness output is kept for the PR body.

- [ ] **Step 1: Write the mutation runner**

```bash
cat > "$S/mutate.sh" <<'EOF'
#!/usr/bin/env bash
# usage: mutate.sh <id> <sed-expression>   (run from the worktree root)
set -euo pipefail
S=/private/tmp/claude-501/solar-2b; M=apps/edge-functions/supabase/migrations
sed "$2" $M/00214_solar_tariff_selection.sql > "$S/00214-$1.sql"
if cmp -s "$S/00214-$1.sql" $M/00214_solar_tariff_selection.sql; then echo "MUTATION $1 CHANGED NOTHING"; exit 1; fi
cat "$S/chain-without-00214.sql" "$S/00214-$1.sql" > "$S/chain-$1.sql"
scripts/db/dry-run-migration.sh "$S/chain-$1.sql" scripts/db/assert-solar-tariff-selection-roles.sql > "$S/mut-$1.txt" 2>&1 || true
grep -E '✗|failed' "$S/mut-$1.txt" | tail -20
EOF
chmod +x "$S/mutate.sh"
```

- [ ] **Step 2: Run the seven mutations**

```bash
"$S/mutate.sh" M1 '/mutation-probe M1/d'
"$S/mutate.sh" M2 '/mutation-probe M2/s/solar_can_see_money/solar_can_view/'
"$S/mutate.sh" M3 '/mutation-probe M3/d'
"$S/mutate.sh" M4 '/mutation-probe M4/d'
"$S/mutate.sh" M5 '/mutation-probe M5/d'
"$S/mutate.sh" M6 '/mutation-probe M6/d'
"$S/mutate.sh" M7 '/mutation-probe M7/s/public.solar_can_see_money(project_id) AND //'
```
Expected (each must include at least the listed `✗`; anything else red is recorded, not ignored):

| Mutation | What it removes | Must go red |
|---|---|---|
| M1 | money check in `studies_tariff_guard` | `edit_pin_tariff_REFUSED`, `edit_set_escalation_REFUSED` |
| M2 | `tariff_overrides_select` on see_money → view | `no_money_rows_for_view`, `no_money_rows_for_edit` |
| M3 | reason CHECK + trigger reason check (two lines) | `override_edit_without_reason_REFUSED` |
| M4 | published-year check | `fin_pin_draft_tariff_REFUSED` |
| M5 | fingerprint comparison | `stale_fingerprint_validation_REFUSED` |
| M6 | RESTRICTIVE insert on `bill_checks` | `edit_insert_bill_check_REFUSED` |
| M7 | money requirement on `error_report_insert` | `edit_report_error_REFUSED` |

M4 note: with the check deleted, `v_state` for a draft tariff is visible to `v_fin`? No — a draft year is invisible to a customer under 00210's reader policy, so `v_state` is NULL and the pin sets `licensee_id := NULL`… and **succeeds**, turning `fin_pin_draft_tariff_REFUSED` red. That is the point: the invisible-draft case is only refused by the deleted line.

If a mutation leaves its named check green, the assertion is decorative: STOP, fix the assertion so it can fail, re-run GREEN (Task 3 Step 2) and all seven mutations.

- [ ] **Step 3: Record the evidence**

```bash
{ echo "RED (no 00214):"; tail -3 "$S/dry-red.txt"; echo; echo "GREEN:"; tail -3 "$S/dry-green.txt";
  for m in M1 M2 M3 M4 M5 M6 M7; do echo; echo "$m:"; grep '✗' "$S/mut-$m.txt"; done; } > "$S/evidence-00214.md"
cat "$S/evidence-00214.md"
```
Expected: the file lists the red run, the green total, and ≥ 1 `✗` per mutation. No commit (evidence goes into the PR body in Part 5).
