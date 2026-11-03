-- BEHAVIOURAL assertions for 00252 (the tender issue pack), as real production
-- roles in a rolled-back transaction:
--
--   scripts/db/dry-run-migration.sh \
--     apps/edge-functions/supabase/migrations/00252_tender_issue_pack.sql \
--     scripts/db/assert-tender-documents.sql
--
-- THE rules: a pack document exists only while the tender is a draft; after
-- issue a document rides an addendum, and a published addendum's documents are
-- final. Bidders never read the table: the portal function shows the pack plus
-- published-addendum documents only, and every bidder download is receipted.
-- The particulars a bidder read at issue are frozen.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin      uuid;
  v_contractor uuid;
  v_project    uuid;
  v_org        uuid;
  v_b1         uuid := gen_random_uuid();
  v_b2         uuid := gen_random_uuid();
  v_t          uuid;
  v_t2         uuid;
  v_inv1       uuid;
  v_inv2       uuid;
  v_p1         uuid;
  v_p2         uuid;
  v_doc_pack   uuid;
  v_doc_add    uuid;
  v_add        uuid;
  v_add2       uuid;
  v_seen       int;
  v_cnt        int;
  c_b1         text;
  c_b2         text;
  c_admin      text;
  c_contractor text;
BEGIN
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT organisation_id INTO v_org FROM projects.projects WHERE id = v_project;
  SELECT user_id INTO v_admin FROM public.user_organisations
   WHERE organisation_id = v_org AND role IN ('owner','admin') AND is_active LIMIT 1;
  IF v_contractor IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'fixture missing: contractor % admin %', v_contractor, v_admin;
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-docs-1@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-docs-2@example.invalid', '', now(), now(), now(), '{}', '{}');

  c_b1 := json_build_object('sub', v_b1::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text;
  c_b2 := json_build_object('sub', v_b2::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text;
  c_admin := json_build_object('sub', v_admin::text, 'role', 'authenticated')::text;
  c_contractor := json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text;

  -- Two tenders: the probe tender, and a second whose participant must never
  -- touch the first's documents or receipts.
  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Electrical contract', 'Issue-pack probe', now()) RETURNING id INTO v_t;
  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Electrical contract', 'Issue-pack probe 2', now()) RETURNING id INTO v_t2;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, rate_column, amount_column)
  VALUES (v_t, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Cable', 'm', 10, 'priced', 'F', 'G'),
         (v_t2, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Cable', 'm', 10, 'priced', 'F', 'G');

  -- ═══ Particulars while draft (as the admin, through RLS) ═══
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  UPDATE projects.tenders SET reference = 'WM-T-0001', description = 'Probe scope',
         site_inspection = 'By arrangement', queries_close_at = now() + interval '3 days',
         validity_days = 90, contact_name = 'Probe Person', contact_email = 'probe@example.invalid'
   WHERE id = v_t;
  INSERT INTO _r VALUES ('admin_sets_particulars_while_draft',
    (SELECT reference = 'WM-T-0001' AND validity_days = 90 FROM projects.tenders WHERE id = v_t));
  BEGIN
    UPDATE projects.tenders SET validity_days = 400 WHERE id = v_t;
    INSERT INTO _r VALUES ('validity_days_range_enforced', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('validity_days_range_enforced', true);
  END;
  BEGIN
    UPDATE projects.tenders SET contact_email = 'not-an-address' WHERE id = v_t;
    INSERT INTO _r VALUES ('contact_email_shape_enforced', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('contact_email_shape_enforced', true);
  END;

  -- ═══ Pack documents while draft ═══
  INSERT INTO projects.tender_documents (tender_id, category, label, file_name, file_path, file_size, content_type)
  VALUES (v_t, 'specification', 'Standard spec', 'spec.pdf', v_org || '/' || v_project || '/' || v_t || '/documents/spec.pdf', 1000, 'application/pdf')
  RETURNING id INTO v_doc_pack;
  INSERT INTO _r VALUES ('admin_adds_pack_doc_while_draft', v_doc_pack IS NOT NULL);
  INSERT INTO _r VALUES ('uploaded_by_is_stamped',
    (SELECT uploaded_by = v_admin FROM projects.tender_documents WHERE id = v_doc_pack));
  UPDATE projects.tender_documents SET label = 'Standard specification', sort_order = 2 WHERE id = v_doc_pack;
  INSERT INTO _r VALUES ('admin_edits_label_while_draft',
    (SELECT label = 'Standard specification' FROM projects.tender_documents WHERE id = v_doc_pack));
  BEGIN
    UPDATE projects.tender_documents SET file_path = 'elsewhere' WHERE id = v_doc_pack;
    INSERT INTO _r VALUES ('file_columns_immutable', false);
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('file_columns_immutable', true);
  END;
  BEGIN
    INSERT INTO projects.tender_documents (tender_id, clarification_id, category, label, file_name, file_path, file_size)
    VALUES (v_t, gen_random_uuid(), 'other', 'Bad attach', 'x.pdf', v_t || '/documents/x.pdf', 10);
    INSERT INTO _r VALUES ('attach_to_unknown_clarification_refused', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('attach_to_unknown_clarification_refused', true);
  END;

  -- The contractor (a project member without a write role) neither reads nor writes.
  PERFORM set_config('request.jwt.claims', c_contractor, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_documents WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_reads_no_documents', v_seen = 0);
  BEGIN
    INSERT INTO projects.tender_documents (tender_id, category, label, file_name, file_path, file_size)
    VALUES (v_t, 'other', 'Rogue', 'r.pdf', v_t || '/documents/r.pdf', 10);
    INSERT INTO _r VALUES ('contractor_cannot_add_documents', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_cannot_add_documents', true);
  END;

  -- ═══ Issue, with participants ═══
  RESET ROLE;
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_t;
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_t2;
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t, 'Bidder One', 'probe-docs-1@example.invalid', 'accepted', now(), v_b1) RETURNING id INTO v_inv1;
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t2, 'Bidder Two', 'probe-docs-2@example.invalid', 'accepted', now(), v_b2) RETURNING id INTO v_inv2;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name)
  VALUES (v_t, v_inv1, v_b1, 'Bidder One') RETURNING id INTO v_p1;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name)
  VALUES (v_t2, v_inv2, v_b2, 'Bidder Two') RETURNING id INTO v_p2;

  -- ═══ After issue: the pack and the particulars are frozen ═══
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.tender_documents (tender_id, category, label, file_name, file_path, file_size)
    VALUES (v_t, 'drawing', 'Late drawing', 'late.pdf', v_t || '/documents/late.pdf', 10);
    INSERT INTO _r VALUES ('pack_frozen_after_issue', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('pack_frozen_after_issue', true);
  END;
  BEGIN
    UPDATE projects.tender_documents SET sort_order = 9 WHERE id = v_doc_pack;
    INSERT INTO _r VALUES ('pack_doc_not_editable_after_issue', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('pack_doc_not_editable_after_issue', true);
  END;
  BEGIN
    DELETE FROM projects.tender_documents WHERE id = v_doc_pack;
    INSERT INTO _r VALUES ('pack_doc_not_removable_after_issue', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('pack_doc_not_removable_after_issue', true);
  END;
  BEGIN
    UPDATE projects.tenders SET description = 'Changed scope' WHERE id = v_t;
    INSERT INTO _r VALUES ('particulars_frozen_after_issue', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('particulars_frozen_after_issue', true);
  END;

  -- ═══ An addendum carries the late document ═══
  INSERT INTO projects.tender_clarifications (tender_id, kind, title, body)
  VALUES (v_t, 'addendum', 'Addendum 1', 'Revised drawing attached') RETURNING id INTO v_add;
  INSERT INTO projects.tender_documents (tender_id, clarification_id, category, label, file_name, file_path, file_size)
  VALUES (v_t, v_add, 'addendum', 'Revised drawing', 'rev.pdf', v_org || '/' || v_project || '/' || v_t || '/documents/rev.pdf', 2000)
  RETURNING id INTO v_doc_add;
  INSERT INTO _r VALUES ('document_attaches_to_unpublished_addendum', v_doc_add IS NOT NULL);
  BEGIN
    INSERT INTO projects.tender_documents (tender_id, clarification_id, category, label, file_name, file_path, file_size)
    VALUES (v_t2, v_add, 'addendum', 'Cross-tender attach', 'c.pdf', v_t2 || '/documents/c.pdf', 10);
    INSERT INTO _r VALUES ('cross_tender_attach_refused', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('cross_tender_attach_refused', true);
  END;

  -- ═══ The bidder's view before the addendum publishes ═══
  PERFORM set_config('request.jwt.claims', c_b1, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_documents WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('bidder_reads_table_directly_never', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_documents(v_t);
  INSERT INTO _r VALUES ('portal_hides_unpublished_addendum_doc', v_seen = 1);
  INSERT INTO _r VALUES ('pack_doc_visible_to_participant', projects.tender_document_visible(v_doc_pack));
  INSERT INTO _r VALUES ('unpublished_addendum_doc_not_visible', NOT projects.tender_document_visible(v_doc_add));
  PERFORM projects.tender_log_document_download(v_doc_pack);
  PERFORM projects.tender_log_document_download(v_doc_pack);
  BEGIN
    PERFORM projects.tender_log_document_download(v_doc_add);
    INSERT INTO _r VALUES ('download_of_hidden_doc_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('download_of_hidden_doc_refused', true);
  END;

  -- A participant of ANOTHER tender sees and logs nothing here.
  PERFORM set_config('request.jwt.claims', c_b2, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_documents(v_t);
  INSERT INTO _r VALUES ('other_tenders_participant_sees_nothing', v_seen = 0);
  BEGIN
    PERFORM projects.tender_log_document_download(v_doc_pack);
    INSERT INTO _r VALUES ('other_tenders_participant_cannot_log', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('other_tenders_participant_cannot_log', true);
  END;

  -- ═══ Publish the addendum ═══
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  UPDATE projects.tender_clarifications SET published_at = now() WHERE id = v_add;
  BEGIN
    INSERT INTO projects.tender_documents (tender_id, clarification_id, category, label, file_name, file_path, file_size)
    VALUES (v_t, v_add, 'addendum', 'Afterthought', 'a.pdf', v_t || '/documents/a.pdf', 10);
    INSERT INTO _r VALUES ('published_addendum_docs_final_add', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('published_addendum_docs_final_add', true);
  END;
  BEGIN
    DELETE FROM projects.tender_documents WHERE id = v_doc_add;
    INSERT INTO _r VALUES ('published_addendum_docs_final_delete', false);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO _r VALUES ('published_addendum_docs_final_delete', true);
  END;

  -- A second DRAFT addendum is discarded whole: its document goes with it; a
  -- published addendum and a bidder's question cannot be deleted.
  INSERT INTO projects.tender_clarifications (tender_id, kind, title, body)
  VALUES (v_t, 'addendum', 'Abandoned draft', 'Never published') RETURNING id INTO v_add2;
  INSERT INTO projects.tender_documents (tender_id, clarification_id, category, label, file_name, file_path, file_size)
  VALUES (v_t, v_add2, 'addendum', 'Draft attachment', 'd.pdf', v_org || '/' || v_project || '/' || v_t || '/documents/d.pdf', 10);
  DELETE FROM projects.tender_clarifications WHERE id = v_add2;
  INSERT INTO _r VALUES ('wm_discards_draft_addendum_with_documents',
    NOT EXISTS (SELECT 1 FROM projects.tender_clarifications WHERE id = v_add2)
    AND NOT EXISTS (SELECT 1 FROM projects.tender_documents WHERE clarification_id = v_add2));
  DELETE FROM projects.tender_clarifications WHERE id = v_add;
  INSERT INTO _r VALUES ('published_addendum_not_deletable',
    EXISTS (SELECT 1 FROM projects.tender_clarifications WHERE id = v_add));

  -- The bidder now sees both documents, and the summary carries the particulars.
  PERFORM set_config('request.jwt.claims', c_b1, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_documents(v_t);
  INSERT INTO _r VALUES ('published_addendum_doc_visible', v_seen = 2);
  PERFORM projects.tender_log_document_download(v_doc_add);
  INSERT INTO _r VALUES ('portal_summary_carries_particulars',
    (SELECT reference = 'WM-T-0001' AND validity_days = 90 AND contact_name = 'Probe Person'
       FROM projects.tender_portal_summary(v_t)));

  -- ═══ Receipts ═══
  PERFORM set_config('request.jwt.claims', c_admin, true);
  SET LOCAL ROLE authenticated;
  SELECT download_count INTO v_cnt FROM projects.tender_document_downloads
   WHERE document_id = v_doc_pack AND participant_id = v_p1;
  INSERT INTO _r VALUES ('wm_reads_receipt_with_count', v_cnt = 2);
  SELECT count(*) INTO v_seen FROM projects.tender_document_downloads WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('wm_reads_both_receipts', v_seen = 2);
  BEGIN
    INSERT INTO projects.tender_document_downloads (document_id, participant_id) VALUES (v_doc_pack, v_p1);
    INSERT INTO _r VALUES ('wm_cannot_forge_receipts', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('wm_cannot_forge_receipts', true);
  END;
  PERFORM set_config('request.jwt.claims', c_contractor, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_document_downloads WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_reads_no_receipts', v_seen = 0);

  -- The bind trigger derives tender_id and refuses a cross-tender participant
  -- (service path, which is how nothing but the definer function ever writes).
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    INSERT INTO projects.tender_document_downloads (document_id, participant_id, tender_id)
    VALUES (v_doc_pack, v_p2, v_t2);
    INSERT INTO _r VALUES ('bind_refuses_cross_tender_participant', false);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO _r VALUES ('bind_refuses_cross_tender_participant', true);
  END;
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
