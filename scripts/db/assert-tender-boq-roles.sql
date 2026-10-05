-- BEHAVIOURAL assertions for 00224 (tender BOQ), run as real production roles
-- inside a rolled-back transaction:
--
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00224_tender_boq.sql scripts/db/assert-tender-boq-roles.sql
--
-- Run it against a no-op migration first: every row must go red (the tables do
-- not exist, so the file aborts). Then against 00224: every row green.
--
-- What it proves (not just that policies exist, but who they let through):
--   * org admin and a project-promoted PM can read and write a tender
--   * a contractor and a client viewer ON THE SAME PROJECT see nothing and cannot write
--     (controls first prove they can see other data on that project)
--   * a user with no membership sees nothing; anon is refused at the grant
--   * organisation_id is derived from the project, never trusted from the caller
--   * an issued tender's BOQ is frozen; a draft one is not; a cascade delete still works
--   * the estimate line cannot point at another tender's item

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin       uuid;
  v_project     uuid;
  v_org         uuid;
  v_pm          uuid;
  v_pm_project  uuid;
  v_contractor  uuid;
  v_ctr_project uuid;
  v_client      uuid;
  v_cli_project uuid;
  v_nobody      uuid := gen_random_uuid();
  v_other_org   uuid;
  v_tender      uuid;
  v_tender2     uuid;
  v_item        uuid;
  v_item2       uuid;
  v_seen        int;
  v_bound_org   uuid;
BEGIN
  -- ── Fixtures ───────────────────────────────────────────────────────────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_ctr_project
    FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = v_ctr_project;
  v_project := v_ctr_project;

  SELECT uo.user_id INTO v_admin FROM public.user_organisations uo
   WHERE uo.organisation_id = v_org AND uo.role IN ('owner','admin') AND uo.is_active LIMIT 1;

  -- No production member currently RESOLVES to project_manager (org roles
  -- dominate), so a probe PM is minted: org contractor, promoted on one project.
  v_pm := gen_random_uuid();
  v_pm_project := v_project;
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-tender-pm@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_pm, v_org, 'contractor', TRUE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_pm_project, v_pm, v_org, 'project_manager', TRUE);
  IF public.user_effective_project_role(v_pm_project, v_pm) IS DISTINCT FROM 'project_manager' THEN
    RAISE EXCEPTION 'probe PM resolves to %', public.user_effective_project_role(v_pm_project, v_pm);
  END IF;

  SELECT pm.user_id, pm.project_id INTO v_client, v_cli_project
    FROM projects.project_members pm WHERE pm.role = 'client_viewer' AND pm.is_active LIMIT 1;

  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  IF v_contractor IS NULL OR v_admin IS NULL OR v_pm IS NULL OR v_client IS NULL THEN
    RAISE EXCEPTION 'fixture missing: contractor % admin % pm % client %', v_contractor, v_admin, v_pm, v_client;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_nobody, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-tender-nobody@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  -- ── Service path: org binding ignores a forged organisation_id ──────────
  INSERT INTO projects.tenders (project_id, organisation_id, package, title)
  VALUES (v_project, v_other_org, 'Electrical', 'Probe tender') RETURNING id, organisation_id INTO v_tender, v_bound_org;
  INSERT INTO _r VALUES ('org_bound_from_project', v_bound_org = v_org);

  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, rate_column, amount_column)
  VALUES (v_tender, 1, 'Bill No 1', 5, 'item', '1', '1.1', 'Site establishment', 'sum', 1, 'priced', 'F', 'G')
  RETURNING id INTO v_item;
  INSERT INTO projects.tender_estimate_lines (item_id, tender_id, rate, amount) VALUES (v_item, v_tender, 1000, 1000);

  -- ═══ 1. ORG ADMIN — reads and writes ═══════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tenders WHERE id = v_tender;
  INSERT INTO _r VALUES ('admin_reads_tender', v_seen = 1);
  SELECT count(*) INTO v_seen FROM projects.tender_estimate_lines WHERE tender_id = v_tender;
  INSERT INTO _r VALUES ('admin_reads_estimate', v_seen = 1);
  BEGIN
    INSERT INTO projects.tenders (project_id, organisation_id, package, title)
    VALUES (v_project, v_org, 'Lighting', 'Admin tender') RETURNING id INTO v_tender2;
    INSERT INTO _r VALUES ('admin_creates_tender', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_creates_tender', false);
  END;
  UPDATE projects.tender_boq_items SET rate_cell_type = 'not_priced' WHERE id = v_item;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_edits_draft_item', v_seen = 1);
  RESET ROLE;

  -- ═══ 2. PROJECT MANAGER (project-promoted) — reads and writes ══════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.tenders (project_id, organisation_id, package, title)
    VALUES (v_pm_project, v_org, 'Generator', 'PM tender');
    INSERT INTO _r VALUES ('pm_creates_tender', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('pm_creates_tender', false);
  END;
  SELECT count(*) INTO v_seen FROM projects.tenders WHERE project_id = v_pm_project AND package = 'Generator';
  INSERT INTO _r VALUES ('pm_reads_own_tender', v_seen = 1);
  RESET ROLE;

  -- ═══ 3. CONTRACTOR on the SAME project — sees nothing, writes nothing ══
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('CONTROL_contractor_has_project_access', public.user_has_project_access(v_project));
  SELECT count(*) INTO v_seen FROM projects.tenders WHERE project_id = v_project;
  INSERT INTO _r VALUES ('contractor_sees_no_tender', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_boq_items WHERE tender_id = v_tender;
  INSERT INTO _r VALUES ('contractor_sees_no_boq', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_estimate_lines WHERE tender_id = v_tender;
  INSERT INTO _r VALUES ('contractor_sees_no_estimate', v_seen = 0);
  BEGIN
    INSERT INTO projects.tenders (project_id, organisation_id, package, title)
    VALUES (v_project, v_org, 'Sneaky', 'Contractor tender');
    INSERT INTO _r VALUES ('contractor_insert_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_insert_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, description)
    VALUES (v_tender, 9, 'Bill No 1', 99, 'note', '1', 'injected');
    INSERT INTO _r VALUES ('contractor_item_insert_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_item_insert_REFUSED', true);
  END;
  UPDATE projects.tender_boq_items SET description = 'tampered' WHERE id = v_item;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_update_affects_nothing', v_seen = 0);
  DELETE FROM projects.tenders WHERE id = v_tender;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_delete_affects_nothing', v_seen = 0);
  RESET ROLE;

  -- ═══ 4. CLIENT VIEWER — sees nothing ═══════════════════════════════════
  INSERT INTO projects.tenders (project_id, organisation_id, package, title)
  VALUES (v_cli_project, v_org, 'Electrical', 'Client probe');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('CONTROL_client_has_project_access', public.user_has_project_access(v_cli_project));
  SELECT count(*) INTO v_seen FROM projects.tenders WHERE project_id = v_cli_project;
  INSERT INTO _r VALUES ('client_viewer_sees_no_tender', v_seen = 0);
  RESET ROLE;

  -- ═══ 5. NON-MEMBER — sees nothing ══════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nobody::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tenders;
  INSERT INTO _r VALUES ('nonmember_sees_no_tender', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_boq_items;
  INSERT INTO _r VALUES ('nonmember_sees_no_boq', v_seen = 0);
  RESET ROLE;

  -- ═══ 6. ANON — refused at the grant ════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM projects.tenders LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 7. Issued tender: BOQ frozen; cascade delete still works ══════════
  BEGIN
    UPDATE projects.tenders SET status = 'issued' WHERE id = v_tender;
    INSERT INTO _r VALUES ('issue_without_closing_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('issue_without_closing_REFUSED', true);
  END;
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_tender;
  BEGIN
    UPDATE projects.tender_boq_items SET quantity = 2 WHERE id = v_item;
    INSERT INTO _r VALUES ('issued_item_update_REFUSED', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('issued_item_update_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, description)
    VALUES (v_tender, 2, 'Bill No 1', 6, 'note', '1', 'late note');
    INSERT INTO _r VALUES ('issued_item_insert_REFUSED', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('issued_item_insert_REFUSED', true);
  END;
  BEGIN
    UPDATE projects.tender_estimate_lines SET rate = 1 WHERE item_id = v_item;
    INSERT INTO _r VALUES ('issued_estimate_update_REFUSED', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('issued_estimate_update_REFUSED', true);
  END;

  -- Admin cannot delete an issued tender through RLS (policy keys on draft).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM projects.tenders WHERE id = v_tender;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_cannot_delete_issued', v_seen = 0);
  -- …but can delete a draft, and its items go with it.
  DELETE FROM projects.tenders WHERE id = v_tender2;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_deletes_draft', v_seen = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Service path deletes the issued tender: the lock must not block the cascade.
  BEGIN
    DELETE FROM projects.tenders WHERE id = v_tender;
    SELECT count(*) INTO v_seen FROM projects.tender_boq_items WHERE tender_id = v_tender;
    INSERT INTO _r VALUES ('cascade_delete_of_issued_tender_works', v_seen = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('cascade_delete_of_issued_tender_works', false);
  END;

  -- ═══ 8. Estimate line cannot cross tenders ═════════════════════════════
  INSERT INTO projects.tenders (project_id, organisation_id, package, title)
  VALUES (v_project, v_org, 'A', 'A') RETURNING id INTO v_tender;
  INSERT INTO projects.tenders (project_id, organisation_id, package, title)
  VALUES (v_project, v_org, 'B', 'B') RETURNING id INTO v_tender2;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, rate_cell_type)
  VALUES (v_tender, 1, 'S', 1, 'item', '1', '1.1', 'x', 'priced') RETURNING id INTO v_item2;
  BEGIN
    INSERT INTO projects.tender_estimate_lines (item_id, tender_id, rate, amount) VALUES (v_item2, v_tender2, 1, 1);
    INSERT INTO _r VALUES ('cross_tender_estimate_REFUSED', false);
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _r VALUES ('cross_tender_estimate_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, description, rate_cell_type)
    VALUES (v_tender, 2, 'S', 2, 'heading', '1', 'h', 'priced');
    INSERT INTO _r VALUES ('heading_with_cell_type_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('heading_with_cell_type_REFUSED', true);
  END;
END $$;

SELECT * FROM (VALUES
  ('organisation_id is bound from the project (forged value discarded)', (SELECT v FROM _r WHERE k='org_bound_from_project')),
  ('org admin reads a tender',                                        (SELECT v FROM _r WHERE k='admin_reads_tender')),
  ('org admin reads the internal estimate',                           (SELECT v FROM _r WHERE k='admin_reads_estimate')),
  ('org admin creates a tender',                                      (SELECT v FROM _r WHERE k='admin_creates_tender')),
  ('org admin edits a draft BOQ row',                                 (SELECT v FROM _r WHERE k='admin_edits_draft_item')),
  ('project-promoted PM creates a tender',                            (SELECT v FROM _r WHERE k='pm_creates_tender')),
  ('project-promoted PM reads it back',                               (SELECT v FROM _r WHERE k='pm_reads_own_tender')),
  ('CONTROL: contractor has access to the project',                   (SELECT v FROM _r WHERE k='CONTROL_contractor_has_project_access')),
  ('contractor on the same project sees no tender',                   (SELECT v FROM _r WHERE k='contractor_sees_no_tender')),
  ('contractor sees no BOQ rows',                                     (SELECT v FROM _r WHERE k='contractor_sees_no_boq')),
  ('contractor sees no internal estimate',                            (SELECT v FROM _r WHERE k='contractor_sees_no_estimate')),
  ('contractor cannot create a tender (42501)',                       (SELECT v FROM _r WHERE k='contractor_insert_REFUSED')),
  ('contractor cannot insert a BOQ row (42501)',                      (SELECT v FROM _r WHERE k='contractor_item_insert_REFUSED')),
  ('contractor update affects zero rows',                             (SELECT v FROM _r WHERE k='contractor_update_affects_nothing')),
  ('contractor delete affects zero rows',                             (SELECT v FROM _r WHERE k='contractor_delete_affects_nothing')),
  ('CONTROL: client viewer has access to the project',                (SELECT v FROM _r WHERE k='CONTROL_client_has_project_access')),
  ('client viewer sees no tender',                                    (SELECT v FROM _r WHERE k='client_viewer_sees_no_tender')),
  ('non-member sees no tender',                                       (SELECT v FROM _r WHERE k='nonmember_sees_no_tender')),
  ('non-member sees no BOQ rows',                                     (SELECT v FROM _r WHERE k='nonmember_sees_no_boq')),
  ('anon is refused at the grant',                                    (SELECT v FROM _r WHERE k='anon_REFUSED')),
  ('a tender cannot be issued without a closing time',                (SELECT v FROM _r WHERE k='issue_without_closing_REFUSED')),
  ('issued tender: BOQ row update refused',                           (SELECT v FROM _r WHERE k='issued_item_update_REFUSED')),
  ('issued tender: BOQ row insert refused',                           (SELECT v FROM _r WHERE k='issued_item_insert_REFUSED')),
  ('issued tender: estimate update refused',                          (SELECT v FROM _r WHERE k='issued_estimate_update_REFUSED')),
  ('admin cannot delete an issued tender',                            (SELECT v FROM _r WHERE k='admin_cannot_delete_issued')),
  ('admin can delete a draft tender',                                 (SELECT v FROM _r WHERE k='admin_deletes_draft')),
  ('cascade delete of an issued tender is not blocked by the lock',   (SELECT v FROM _r WHERE k='cascade_delete_of_issued_tender_works')),
  ('estimate line cannot point at another tender''s item',            (SELECT v FROM _r WHERE k='cross_tender_estimate_REFUSED')),
  ('a heading cannot carry a rate-cell type',                         (SELECT v FROM _r WHERE k='heading_with_cell_type_REFUSED'))
) AS t("check", ok);
