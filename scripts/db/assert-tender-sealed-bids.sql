-- BEHAVIOURAL assertions for 00233 (sealed submissions), as real production
-- roles in a rolled-back transaction. Until slice B (00230) is applied, run the
-- two together:
--
--   cat apps/edge-functions/supabase/migrations/00230_tender_invitations.sql \
--       apps/edge-functions/supabase/migrations/00233_tender_submissions.sql > /tmp/bc.sql
--   scripts/db/dry-run-migration.sh /tmp/bc.sql scripts/db/assert-tender-sealed-bids.sql
--
-- THE rule: no WM user (owner, admin, project manager) can read a bidder's
-- prices or documents before the closing time; after it, they read SUBMITTED
-- bids only, and never a cancelled tender's. A bidder sees only their own,
-- writes only through the definer functions while open, and cannot set an
-- amount or mark themselves submitted except through tender_submit, which
-- re-checks compliance. Only a REAL change withdraws a submitted bid.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin      uuid;
  v_contractor uuid;
  v_project    uuid;
  v_org        uuid;
  v_pm         uuid := gen_random_uuid();
  v_b1         uuid := gen_random_uuid();
  v_b2         uuid := gen_random_uuid();
  v_t          uuid;
  v_inv1       uuid;
  v_inv2       uuid;
  v_p1         uuid;
  v_p2         uuid;
  v_s1         uuid;
  v_s2         uuid;
  v_i_priced   uuid;
  v_i_rate     uuid;
  v_i_fixed    uuid;
  v_req_doc    uuid;
  v_req_decl   uuid;
  v_add        uuid;
  v_q          uuid;
  v_path       text;
  v_seen       int;
  v_num        numeric;
  v_total      numeric;
  c_b1_otp     text;
  c_b1_pwd     text;
  c_b2_otp     text;
  c_admin      text;
  c_pm         text;
  c_contractor text;
BEGIN
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT organisation_id INTO v_org FROM projects.projects WHERE id = v_project;
  SELECT user_id INTO v_admin FROM public.user_organisations
   WHERE organisation_id = v_org AND role IN ('owner','admin') AND is_active LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sealed-1@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sealed-2@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sealed-pm@example.invalid', '', now(), now(), now(), '{}', '{}');
  -- No production member RESOLVES to project_manager (org roles dominate), so a
  -- probe PM is minted: org contractor, promoted on this project.
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_pm, v_org, 'contractor', TRUE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_pm, v_org, 'project_manager', TRUE);
  IF v_contractor IS NULL OR v_admin IS NULL
     OR public.user_effective_project_role(v_project, v_pm) IS DISTINCT FROM 'project_manager' THEN
    RAISE EXCEPTION 'fixture missing: contractor % admin % pm role %', v_contractor, v_admin,
      public.user_effective_project_role(v_project, v_pm);
  END IF;

  c_b1_otp := json_build_object('sub', v_b1::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text;
  c_b1_pwd := json_build_object('sub', v_b1::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','password','timestamp',1)))::text;
  c_b2_otp := json_build_object('sub', v_b2::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text;
  c_admin := json_build_object('sub', v_admin::text, 'role', 'authenticated')::text;
  c_pm := json_build_object('sub', v_pm::text, 'role', 'authenticated')::text;
  c_contractor := json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text;

  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Electrical contract', 'Sealed probe', now()) RETURNING id INTO v_t;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount, rate_column, amount_column)
  VALUES (v_t, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Cable', 'm', 10, 'priced', NULL, 'F', 'G') RETURNING id INTO v_i_priced;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount, rate_column, amount_column)
  VALUES (v_t, 1, 'Bill No 1', 6, 'item', '1', '1.2', 'Dayworks', 'hr', NULL, 'rate_only', NULL, 'F', 'G') RETURNING id INTO v_i_rate;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount, rate_column, amount_column)
  VALUES (v_t, 2, 'Bill No 1', 7, 'item', '1', '1.3', 'PS connection', 'Sum', 1, 'fixed', 5000, 'F', 'G') RETURNING id INTO v_i_fixed;
  INSERT INTO projects.tender_requirements (tender_id, kind, label, mandatory) VALUES (v_t, 'document', 'CIDB certificate', true) RETURNING id INTO v_req_doc;
  INSERT INTO projects.tender_requirements (tender_id, kind, label, mandatory) VALUES (v_t, 'declaration', 'Conditions of tender accepted', true) RETURNING id INTO v_req_decl;
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_t;

  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t, 'Bidder One', 'probe-sealed-1@example.invalid', 'accepted', now(), v_b1) RETURNING id INTO v_inv1;
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t, 'Bidder Two', 'probe-sealed-2@example.invalid', 'accepted', now(), v_b2) RETURNING id INTO v_inv2;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name, registration_number, cidb_grade, bbbee_level, contact_name, phone, profile_completed_at)
  VALUES (v_t, v_inv1, v_b1, 'Bidder One', '2015/123456/07', '7EP', '2', 'A', '0820000000', now()) RETURNING id INTO v_p1;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name)
  VALUES (v_t, v_inv2, v_b2, 'Bidder Two') RETURNING id INTO v_p2;
  -- Bidder Two prices but never submits (service path): a DRAFT that must stay sealed for ever.
  INSERT INTO projects.tender_submissions (tender_id, participant_id) VALUES (v_t, v_p2) RETURNING id INTO v_s2;
  INSERT INTO projects.tender_submission_lines (submission_id, tender_id, item_id, rate) VALUES (v_s2, v_t, v_i_priced, 77);

  -- ═══ Bidder One prices ════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', c_b1_otp, true);
  SET LOCAL ROLE authenticated;
  v_s1 := projects.tender_lock_my_submission(v_t);
  INSERT INTO _r VALUES ('bidder_creates_own_submission',
    (SELECT participant_id = v_p1 FROM projects.tender_submissions WHERE id = v_s1));
  BEGIN
    INSERT INTO projects.tender_submissions (tender_id, participant_id) VALUES (v_t, v_p2);
    INSERT INTO _r VALUES ('bidder_cannot_insert_submissions_directly', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_insert_submissions_directly', true);
  END;
  v_seen := projects.tender_save_rates(v_t, jsonb_build_array(
    jsonb_build_object('item_id', v_i_priced, 'rate', 12.345),
    jsonb_build_object('item_id', v_i_rate, 'rate', 450)));
  INSERT INTO _r VALUES ('save_rates_writes_two_lines', v_seen = 2);
  v_seen := projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_priced, 'rate', 12.345)));
  INSERT INTO _r VALUES ('save_rates_skips_unchanged', v_seen = 0);
  v_seen := projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_rate, 'rate', 475)));
  INSERT INTO _r VALUES ('save_rates_updates_changed', v_seen = 1
    AND (SELECT rate FROM projects.tender_submission_lines WHERE submission_id = v_s1 AND item_id = v_i_rate) = 475);
  SELECT amount INTO v_num FROM projects.tender_submission_lines WHERE submission_id = v_s1 AND item_id = v_i_priced;
  INSERT INTO _r VALUES ('amount_is_qty_times_rate_by_trigger', v_num = 123.45);
  BEGIN
    UPDATE projects.tender_submission_lines SET amount = 1 WHERE submission_id = v_s1 AND item_id = v_i_priced;
    INSERT INTO _r VALUES ('bidder_cannot_write_amount', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_write_amount', true);
  END;
  BEGIN
    INSERT INTO projects.tender_submission_lines (submission_id, tender_id, item_id, rate) VALUES (v_s1, v_t, v_i_fixed, NULL);
    INSERT INTO _r VALUES ('bidder_cannot_insert_lines_directly', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_insert_lines_directly', true);
  END;
  BEGIN
    UPDATE projects.tender_submissions SET status = 'submitted', submitted_at = now() WHERE id = v_s1;
    INSERT INTO _r VALUES ('bidder_cannot_self_mark_submitted', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_self_mark_submitted', true);
  END;
  BEGIN
    PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_fixed, 'rate', 1)));
    INSERT INTO _r VALUES ('fixed_sum_cannot_be_priced', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('fixed_sum_cannot_be_priced', true);
  END;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE submission_id = v_s2;
  INSERT INTO _r VALUES ('bidder_cannot_read_other_bidder_prices', v_seen = 0);
  BEGIN
    UPDATE projects.tender_submission_lines SET rate = 1 WHERE submission_id = v_s2;
    INSERT INTO _r VALUES ('bidder_cannot_change_other_bidder_prices', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_change_other_bidder_prices', true);
  END;
  BEGIN
    UPDATE projects.tender_submissions SET declarations = ARRAY[v_req_doc] WHERE id = v_s1;
    INSERT INTO _r VALUES ('declaration_must_be_this_tenders', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('declaration_must_be_this_tenders', true);
  END;
  -- Submit is refused until the document and the declaration are in.
  BEGIN
    PERFORM * FROM projects.tender_submit(v_t);
    INSERT INTO _r VALUES ('submit_blocked_without_documents', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('submit_blocked_without_documents', true);
  END;
  BEGIN
    INSERT INTO projects.tender_submission_documents (submission_id, tender_id, requirement_id, storage_path, file_name, size_bytes)
    VALUES (v_s1, v_t, v_req_doc, v_t || '/' || v_s1 || '/' || v_req_doc || '-1-cidb.pdf', 'cidb.pdf', 1000);
    INSERT INTO _r VALUES ('bidder_cannot_insert_documents_directly', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_insert_documents_directly', true);
  END;
  v_path := v_t || '/' || v_s1 || '/' || v_req_doc || '-1-cidb.pdf';
  BEGIN
    PERFORM projects.tender_record_document(v_t, v_req_doc, v_path, 'cidb.pdf');
    INSERT INTO _r VALUES ('document_refused_when_upload_missing', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('document_refused_when_upload_missing', true);
  END;
  RESET ROLE;
  -- The upload "arrives" (as storage would record it).
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('tender-submissions', v_path, jsonb_build_object('size', 4321));
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('tender-submissions', v_t || '/' || v_s2 || '/' || v_req_doc || '-1-x.pdf', jsonb_build_object('size', 10));
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM projects.tender_record_document(v_t, v_req_doc, v_t || '/' || v_s2 || '/' || v_req_doc || '-1-x.pdf', 'x.pdf');
    INSERT INTO _r VALUES ('document_refused_on_rival_path', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('document_refused_on_rival_path', true);
  END;
  BEGIN
    PERFORM projects.tender_record_document(v_t, v_req_decl, v_t || '/' || v_s1 || '/' || v_req_decl || '-1-x.pdf', 'x.pdf');
    INSERT INTO _r VALUES ('document_refused_for_declaration_requirement', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('document_refused_for_declaration_requirement', true);
  END;
  PERFORM projects.tender_record_document(v_t, v_req_doc, v_path, 'cidb.pdf');
  INSERT INTO _r VALUES ('document_size_read_from_storage',
    (SELECT size_bytes = 4321 FROM projects.tender_submission_documents WHERE storage_path = v_path));
  BEGIN
    PERFORM * FROM projects.tender_submit(v_t);
    INSERT INTO _r VALUES ('submit_blocked_without_declaration', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('submit_blocked_without_declaration', true);
  END;
  UPDATE projects.tender_submissions SET declarations = ARRAY[v_req_decl] WHERE id = v_s1;
  SELECT total INTO v_total FROM projects.tender_submit(v_t);
  INSERT INTO _r VALUES ('submit_returns_sealed_total', v_total = 123.45 + 5000);
  INSERT INTO _r VALUES ('submission_timestamped',
    (SELECT status = 'submitted' AND submitted_at IS NOT NULL AND submission_count = 1 FROM projects.tender_submissions WHERE id = v_s1));
  -- An unchanged re-save (the grid's Save pressed again) must NOT withdraw the bid.
  v_seen := projects.tender_save_rates(v_t, jsonb_build_array(
    jsonb_build_object('item_id', v_i_priced, 'rate', 12.345),
    jsonb_build_object('item_id', v_i_rate, 'rate', 475)));
  UPDATE projects.tender_submissions SET declarations = ARRAY[v_req_decl] WHERE id = v_s1;
  INSERT INTO _r VALUES ('unchanged_save_keeps_bid_submitted', v_seen = 0
    AND (SELECT status = 'submitted' FROM projects.tender_submissions WHERE id = v_s1));
  -- Ticking and unticking "not priced" on a row that had no line writes an empty line: not a change.
  PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_fixed, 'rate', NULL, 'not_priced', false)));
  INSERT INTO _r VALUES ('empty_line_keeps_bid_submitted',
    (SELECT status = 'submitted' FROM projects.tender_submissions WHERE id = v_s1));
  PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_priced, 'rate', 13)));
  INSERT INTO _r VALUES ('edit_after_submit_returns_to_draft',
    (SELECT status = 'draft' AND submitted_at IS NULL FROM projects.tender_submissions WHERE id = v_s1));
  PERFORM * FROM projects.tender_submit(v_t);
  RESET ROLE;

  -- ═══ A password session on Bidder One's address sees and does nothing ═
  PERFORM set_config('request.jwt.claims', c_b1_pwd, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE submission_id = v_s1;
  INSERT INTO _r VALUES ('password_session_sees_no_own_prices', v_seen = 0);
  BEGIN
    PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_priced, 'rate', 1)));
    INSERT INTO _r VALUES ('password_session_cannot_change_prices', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('password_session_cannot_change_prices', true);
  END;
  RESET ROLE;

  -- ═══ WM before closing: knows WHO submitted, never the prices ═════════
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submissions WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('wm_sees_who_submitted_before_closing', v_seen = 2);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('SEALED_wm_sees_no_prices_before_closing', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_documents WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('SEALED_wm_sees_no_documents_before_closing', v_seen = 0);
  BEGIN
    UPDATE projects.tender_submission_lines SET rate = 1 WHERE tender_id = v_t;
    INSERT INTO _r VALUES ('wm_cannot_change_prices', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('wm_cannot_change_prices', true);
  END;
  BEGIN
    PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_priced, 'rate', 1)));
    INSERT INTO _r VALUES ('wm_cannot_save_rates', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('wm_cannot_save_rates', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', c_pm, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submissions WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('pm_sees_who_submitted_before_closing', v_seen = 2);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('SEALED_pm_sees_no_prices_before_closing', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_documents WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('SEALED_pm_sees_no_documents_before_closing', v_seen = 0);
  RESET ROLE;

  -- ═══ Contractor on the project: nothing at all ════════════════════════
  PERFORM set_config('request.jwt.claims', c_contractor, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submissions WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_sees_no_submissions', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_sees_no_prices', v_seen = 0);
  RESET ROLE;

  -- ═══ Clarifications and addenda ═══════════════════════════════════════
  PERFORM set_config('request.jwt.claims', c_b2_otp, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO projects.tender_clarifications (tender_id, kind, participant_id, title, body)
  VALUES (v_t, 'question', v_p2, 'Cable route', 'Is the trench depth 800 mm?');
  RESET ROLE;
  SELECT id INTO v_q FROM projects.tender_clarifications WHERE tender_id = v_t AND kind = 'question';
  INSERT INTO _r VALUES ('question_author_stamped_by_database',
    (SELECT created_by = v_b2 FROM projects.tender_clarifications WHERE id = v_q));
  PERFORM set_config('request.jwt.claims', c_b1_otp, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_clarifications(v_t) c WHERE c.id = v_q;
  INSERT INTO _r VALUES ('other_bidders_question_private_until_published', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_clarifications WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('bidder_reads_no_clarification_rows_directly', v_seen = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  UPDATE projects.tender_clarifications SET answer = 'Yes, 800 mm.', published_at = now() WHERE id = v_q;
  INSERT INTO projects.tender_clarifications (tender_id, kind, title, body, published_at)
  VALUES (v_t, 'addendum', 'Addendum 1', 'Item 1.1 is now XLPE.', '2000-01-01') RETURNING id INTO v_add;
  INSERT INTO _r VALUES ('publish_time_stamped_by_database',
    (SELECT published_at > now() - interval '1 minute' FROM projects.tender_clarifications WHERE id = v_add));
  BEGIN
    UPDATE projects.tender_clarifications SET answer = 'No, 600 mm.' WHERE id = v_q;
    INSERT INTO _r VALUES ('published_answer_is_final', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('published_answer_is_final', true);
  END;
  BEGIN
    UPDATE projects.tender_clarifications SET published_at = NULL WHERE id = v_q;
    INSERT INTO _r VALUES ('published_answer_cannot_be_withdrawn', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('published_answer_cannot_be_withdrawn', true);
  END;
  BEGIN
    UPDATE projects.tender_clarifications SET body = 'Item 1.1 is now PVC.' WHERE id = v_add;
    INSERT INTO _r VALUES ('published_addendum_is_final', false);
  EXCEPTION WHEN object_not_in_prerequisite_state OR insufficient_privilege THEN
    INSERT INTO _r VALUES ('published_addendum_is_final', true);
  END;
  BEGIN
    UPDATE projects.tender_clarifications SET published_at = NULL WHERE id = v_add;
    INSERT INTO _r VALUES ('published_addendum_cannot_be_withdrawn', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('published_addendum_cannot_be_withdrawn', true);
  END;
  RESET ROLE;
  INSERT INTO _r VALUES ('addendum_returns_submitted_bids_to_draft',
    (SELECT status = 'draft' AND submitted_at IS NULL FROM projects.tender_submissions WHERE id = v_s1));
  PERFORM set_config('request.jwt.claims', c_b1_otp, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_clarifications(v_t) c WHERE c.id IN (v_q, v_add) AND NOT c.mine;
  INSERT INTO _r VALUES ('published_answer_and_addendum_visible_to_all', v_seen = 2);
  BEGIN
    PERFORM * FROM projects.tender_submit(v_t);
    INSERT INTO _r VALUES ('submit_blocked_until_addendum_acknowledged', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('submit_blocked_until_addendum_acknowledged', true);
  END;
  BEGIN
    INSERT INTO projects.tender_addendum_acks (clarification_id, participant_id) VALUES (v_add, v_p2);
    INSERT INTO _r VALUES ('bidder_cannot_ack_for_another', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_ack_for_another', true);
  END;
  BEGIN
    PERFORM projects.tender_acknowledge_addendum(v_t, v_q);
    INSERT INTO _r VALUES ('only_published_addenda_acknowledged', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('only_published_addenda_acknowledged', true);
  END;
  PERFORM projects.tender_acknowledge_addendum(v_t, v_add);
  INSERT INTO _r VALUES ('portal_shows_acknowledged',
    (SELECT acknowledged FROM projects.tender_portal_clarifications(v_t) c WHERE c.id = v_add));
  PERFORM * FROM projects.tender_submit(v_t);
  INSERT INTO _r VALUES ('submit_after_acknowledging',
    (SELECT status = 'submitted' AND submission_count = 3 FROM projects.tender_submissions WHERE id = v_s1));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    UPDATE projects.tenders SET status = 'closed' WHERE id = v_t;
    INSERT INTO _r VALUES ('cannot_close_early', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('cannot_close_early', true);
  END;

  -- ═══ The closing time passes ══════════════════════════════════════════
  SET LOCAL session_replication_role = replica;
  UPDATE projects.tenders SET closing_at = now() - interval '1 second' WHERE id = v_t;
  SET LOCAL session_replication_role = origin;

  -- Past the closing time but not yet marked closed: the dangerous window.
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.tender_clarifications (tender_id, kind, title, body, published_at)
    VALUES (v_t, 'addendum', 'Late addendum', 'Too late.', now());
    INSERT INTO _r VALUES ('no_addendum_after_closing_time', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('no_addendum_after_closing_time', true);
  END;
  BEGIN
    UPDATE projects.tenders SET closing_at = now() + interval '1 day' WHERE id = v_t;
    INSERT INTO _r VALUES ('closing_time_frozen_once_passed', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('closing_time_frozen_once_passed', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('late_addendum_left_bids_submitted',
    (SELECT status = 'submitted' FROM projects.tender_submissions WHERE id = v_s1));

  UPDATE projects.tenders SET status = 'closed' WHERE id = v_t;
  INSERT INTO _r VALUES ('closes_after_closing_time', (SELECT status = 'closed' FROM projects.tenders WHERE id = v_t));
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t AND submission_id = v_s1;
  -- priced + rate-only + the empty fixed-sum line the "not priced" toggle wrote
  INSERT INTO _r VALUES ('wm_sees_submitted_prices_after_closing', v_seen = 3);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t AND submission_id = v_s2;
  INSERT INTO _r VALUES ('SEALED_unsubmitted_draft_never_opens', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_documents WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('wm_sees_documents_after_closing', v_seen = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', c_pm, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('pm_sees_submitted_prices_after_closing', v_seen = 3);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', c_b1_otp, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM projects.tender_save_rates(v_t, jsonb_build_array(jsonb_build_object('item_id', v_i_priced, 'rate', 1)));
    INSERT INTO _r VALUES ('save_rates_refused_after_closing', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('save_rates_refused_after_closing', true);
  END;
  BEGIN
    PERFORM * FROM projects.tender_submit(v_t);
    INSERT INTO _r VALUES ('submit_refused_after_closing', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('submit_refused_after_closing', true);
  END;
  DELETE FROM projects.tender_submission_documents WHERE submission_id = v_s1;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('documents_cannot_be_removed_after_closing', v_seen = 0);
  UPDATE projects.tender_submissions SET declarations = '{}' WHERE id = v_s1;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('declarations_frozen_after_closing', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE submission_id = v_s2;
  INSERT INTO _r VALUES ('bidder_still_cannot_read_rival_after_closing', v_seen = 0);
  RESET ROLE;

  -- ═══ Contractor still sees nothing after closing ══════════════════════
  PERFORM set_config('request.jwt.claims', c_contractor, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_sees_no_prices_after_closing', v_seen = 0);
  RESET ROLE;

  -- ═══ A cancelled tender is never opened ═══════════════════════════════
  UPDATE projects.tenders SET status = 'cancelled' WHERE id = v_t;
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_submission_lines WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('SEALED_cancelled_tender_never_opens', v_seen = 0);
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM projects.tender_submission_lines LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
END $$;

-- A tender that received no submitted bid may still be extended after its closing time.
DO $$
DECLARE
  v_project uuid; v_org uuid; v_admin uuid; v_t uuid; v_ok boolean;
BEGIN
  SELECT pm.project_id INTO v_project FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT organisation_id INTO v_org FROM projects.projects WHERE id = v_project;
  SELECT user_id INTO v_admin FROM public.user_organisations WHERE organisation_id = v_org AND role IN ('owner','admin') AND is_active LIMIT 1;
  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Generator', 'No bids probe', now()) RETURNING id INTO v_t;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, fixed_amount, rate_column, amount_column)
  VALUES (v_t, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Genset', 'No', 1, 'priced', NULL, 'F', 'G');
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_t;
  SET LOCAL session_replication_role = replica;
  UPDATE projects.tenders SET closing_at = now() - interval '1 second' WHERE id = v_t;
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE projects.tenders SET closing_at = now() + interval '7 days' WHERE id = v_t;
    v_ok := true;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_ok := false;
  END;
  RESET ROLE;
  INSERT INTO _r VALUES ('no_bids_tender_can_be_extended', v_ok AND (SELECT closing_at > now() FROM projects.tenders WHERE id = v_t));
END $$;

SELECT * FROM (VALUES
  ('bidder creates their own submission (through the lock function)', (SELECT v FROM _r WHERE k='bidder_creates_own_submission')),
  ('bidder cannot insert a submission row directly',              (SELECT v FROM _r WHERE k='bidder_cannot_insert_submissions_directly')),
  ('tender_save_rates writes the bidder''s lines',               (SELECT v FROM _r WHERE k='save_rates_writes_two_lines')),
  ('re-saving unchanged rates rewrites nothing',                   (SELECT v FROM _r WHERE k='save_rates_skips_unchanged')),
  ('a changed rate is saved',                                     (SELECT v FROM _r WHERE k='save_rates_updates_changed')),
  ('WM cannot save rates for a bidder',                            (SELECT v FROM _r WHERE k='wm_cannot_save_rates')),
  ('after closing tender_save_rates is refused',                   (SELECT v FROM _r WHERE k='save_rates_refused_after_closing')),
  ('amount = quantity × rate, computed by the database',           (SELECT v FROM _r WHERE k='amount_is_qty_times_rate_by_trigger')),
  ('bidder cannot write an amount',                                (SELECT v FROM _r WHERE k='bidder_cannot_write_amount')),
  ('bidder cannot insert price lines directly',                    (SELECT v FROM _r WHERE k='bidder_cannot_insert_lines_directly')),
  ('bidder cannot mark themselves submitted directly',             (SELECT v FROM _r WHERE k='bidder_cannot_self_mark_submitted')),
  ('a fixed sum cannot be priced',                                 (SELECT v FROM _r WHERE k='fixed_sum_cannot_be_priced')),
  ('bidder cannot read another bidder''s prices',                  (SELECT v FROM _r WHERE k='bidder_cannot_read_other_bidder_prices')),
  ('bidder cannot change another bidder''s prices',                (SELECT v FROM _r WHERE k='bidder_cannot_change_other_bidder_prices')),
  ('declarations must be this tender''s declaration requirements', (SELECT v FROM _r WHERE k='declaration_must_be_this_tenders')),
  ('submit is blocked without the required document',              (SELECT v FROM _r WHERE k='submit_blocked_without_documents')),
  ('bidder cannot insert a document row directly',                (SELECT v FROM _r WHERE k='bidder_cannot_insert_documents_directly')),
  ('a document is refused when the upload never arrived',          (SELECT v FROM _r WHERE k='document_refused_when_upload_missing')),
  ('a document is refused on a rival''s storage path',             (SELECT v FROM _r WHERE k='document_refused_on_rival_path')),
  ('a document is refused against a declaration requirement',      (SELECT v FROM _r WHERE k='document_refused_for_declaration_requirement')),
  ('a document''s size is read from storage, not the caller',      (SELECT v FROM _r WHERE k='document_size_read_from_storage')),
  ('submit is blocked without the required declaration',           (SELECT v FROM _r WHERE k='submit_blocked_without_declaration')),
  ('submit returns the sealed total (priced + fixed sums)',        (SELECT v FROM _r WHERE k='submit_returns_sealed_total')),
  ('submission is timestamped by the database',                    (SELECT v FROM _r WHERE k='submission_timestamped')),
  ('an unchanged re-save leaves a submitted bid submitted',        (SELECT v FROM _r WHERE k='unchanged_save_keeps_bid_submitted')),
  ('an empty line (no rate, not "not priced") leaves a bid submitted', (SELECT v FROM _r WHERE k='empty_line_keeps_bid_submitted')),
  ('a real edit after submit returns it to draft',                 (SELECT v FROM _r WHERE k='edit_after_submit_returns_to_draft')),
  ('a password session on a bidder address sees no prices',     (SELECT v FROM _r WHERE k='password_session_sees_no_own_prices')),
  ('a password session cannot change a bidder''s prices',        (SELECT v FROM _r WHERE k='password_session_cannot_change_prices')),
  ('WM (admin) sees who has submitted before closing',             (SELECT v FROM _r WHERE k='wm_sees_who_submitted_before_closing')),
  ('SEALED: WM (admin) sees no prices before closing',             (SELECT v FROM _r WHERE k='SEALED_wm_sees_no_prices_before_closing')),
  ('SEALED: WM (admin) sees no submitted documents before closing', (SELECT v FROM _r WHERE k='SEALED_wm_sees_no_documents_before_closing')),
  ('project manager sees who has submitted before closing',       (SELECT v FROM _r WHERE k='pm_sees_who_submitted_before_closing')),
  ('SEALED: project manager sees no prices before closing',       (SELECT v FROM _r WHERE k='SEALED_pm_sees_no_prices_before_closing')),
  ('SEALED: project manager sees no documents before closing',    (SELECT v FROM _r WHERE k='SEALED_pm_sees_no_documents_before_closing')),
  ('WM cannot change any bidder''s prices',                        (SELECT v FROM _r WHERE k='wm_cannot_change_prices')),
  ('contractor on the project sees no submissions',                (SELECT v FROM _r WHERE k='contractor_sees_no_submissions')),
  ('contractor on the project sees no prices',                     (SELECT v FROM _r WHERE k='contractor_sees_no_prices')),
  ('a question''s author is stamped by the database',              (SELECT v FROM _r WHERE k='question_author_stamped_by_database')),
  ('a bidder''s question is private until WM publishes it',        (SELECT v FROM _r WHERE k='other_bidders_question_private_until_published')),
  ('a bidder reads no clarification rows directly (asker hidden)', (SELECT v FROM _r WHERE k='bidder_reads_no_clarification_rows_directly')),
  ('the publish time is stamped by the database',                 (SELECT v FROM _r WHERE k='publish_time_stamped_by_database')),
  ('a published answer cannot be rewritten',                       (SELECT v FROM _r WHERE k='published_answer_is_final')),
  ('a published answer cannot be withdrawn',                       (SELECT v FROM _r WHERE k='published_answer_cannot_be_withdrawn')),
  ('a published addendum cannot be edited',                        (SELECT v FROM _r WHERE k='published_addendum_is_final')),
  ('a published addendum cannot be withdrawn',                     (SELECT v FROM _r WHERE k='published_addendum_cannot_be_withdrawn')),
  ('publishing an addendum returns submitted bids to draft',       (SELECT v FROM _r WHERE k='addendum_returns_submitted_bids_to_draft')),
  ('published answers and addenda reach every bidder',             (SELECT v FROM _r WHERE k='published_answer_and_addendum_visible_to_all')),
  ('submit is blocked until each addendum is acknowledged',        (SELECT v FROM _r WHERE k='submit_blocked_until_addendum_acknowledged')),
  ('a bidder cannot acknowledge for another company',             (SELECT v FROM _r WHERE k='bidder_cannot_ack_for_another')),
  ('only a published addendum can be acknowledged',                (SELECT v FROM _r WHERE k='only_published_addenda_acknowledged')),
  ('the portal shows the acknowledgement',                         (SELECT v FROM _r WHERE k='portal_shows_acknowledged')),
  ('submit succeeds after acknowledging',                          (SELECT v FROM _r WHERE k='submit_after_acknowledging')),
  ('a tender cannot be closed before its closing time',         (SELECT v FROM _r WHERE k='cannot_close_early')),
  ('no addendum once the closing time has passed (still issued)',  (SELECT v FROM _r WHERE k='no_addendum_after_closing_time')),
  ('a tender with no submitted bid can still be extended after closing', (SELECT v FROM _r WHERE k='no_bids_tender_can_be_extended')),
  ('the closing time cannot be moved once passed with a submitted bid',          (SELECT v FROM _r WHERE k='closing_time_frozen_once_passed')),
  ('so a late publish attempt leaves submitted bids submitted',    (SELECT v FROM _r WHERE k='late_addendum_left_bids_submitted')),
  ('a tender closes once its closing time has passed',           (SELECT v FROM _r WHERE k='closes_after_closing_time')),
  ('after closing WM sees the SUBMITTED prices',                   (SELECT v FROM _r WHERE k='wm_sees_submitted_prices_after_closing')),
  ('SEALED: a never-submitted draft is never opened',              (SELECT v FROM _r WHERE k='SEALED_unsubmitted_draft_never_opens')),
  ('after closing WM sees the documents',                          (SELECT v FROM _r WHERE k='wm_sees_documents_after_closing')),
  ('after closing the project manager sees the submitted prices',  (SELECT v FROM _r WHERE k='pm_sees_submitted_prices_after_closing')),
  ('after closing submit is refused',                              (SELECT v FROM _r WHERE k='submit_refused_after_closing')),
  ('after closing documents cannot be removed',                    (SELECT v FROM _r WHERE k='documents_cannot_be_removed_after_closing')),
  ('after closing declarations are frozen',                        (SELECT v FROM _r WHERE k='declarations_frozen_after_closing')),
  ('after closing a bidder still cannot read a rival',             (SELECT v FROM _r WHERE k='bidder_still_cannot_read_rival_after_closing')),
  ('after closing a contractor still sees no prices',              (SELECT v FROM _r WHERE k='contractor_sees_no_prices_after_closing')),
  ('SEALED: a cancelled tender is never opened',                   (SELECT v FROM _r WHERE k='SEALED_cancelled_tender_never_opens')),
  ('anon is refused at the grant',                                 (SELECT v FROM _r WHERE k='anon_REFUSED'))
) AS t("check", ok);
