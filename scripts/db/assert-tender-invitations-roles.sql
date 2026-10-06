-- BEHAVIOURAL assertions for 00243 (tender invitations + the tenderer read path),
-- run as real production roles in a rolled-back transaction:
--
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00243_tender_invitations.sql scripts/db/assert-tender-invitations-roles.sql
--
-- What slice B must guarantee:
--   * a bidder has NO row policy on tenders or the BOQ tables; everything they
--     see comes through column-limited definer functions, for a tender they
--     accepted, once it is issued;
--   * an invitation can only be accepted by the signed-in user it was sent to
--     (whoever prepared it, and so holds the link, cannot become the bidder),
--     exactly once, while the tender is open.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin      uuid;
  v_contractor uuid;
  v_project    uuid;
  v_org        uuid;
  v_bidder     uuid := gen_random_uuid();
  v_bidder2    uuid := gen_random_uuid();
  v_t          uuid;
  v_t_other    uuid;
  v_t_draft    uuid;
  v_inv_draft  uuid;
  v_part       uuid;
  v_part2      uuid;
  v_seen       int;
  v_got        uuid;
  h1 text := repeat('a', 64);
  h2 text := repeat('b', 64);
  h3 text := repeat('c', 64);
BEGIN
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT organisation_id INTO v_org FROM projects.projects WHERE id = v_project;
  SELECT user_id INTO v_admin FROM public.user_organisations
   WHERE organisation_id = v_org AND role IN ('owner','admin') AND is_active LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_bidder,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-bidder-1@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
         (v_bidder2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'Probe-Bidder-2@Example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO projects.tenders (project_id, organisation_id, package, title, reconciliation, imported_at)
  VALUES (v_project, v_org, 'Electrical contract', 'Probe tender', '{"estimate":{"subtotal":{"computed":1234567}}}'::jsonb, now())
  RETURNING id INTO v_t;
  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Generator', 'Other tender', now()) RETURNING id INTO v_t_other;
  INSERT INTO projects.tenders (project_id, organisation_id, package, title)
  VALUES (v_project, v_org, 'Lighting', 'Draft tender') RETURNING id INTO v_t_draft;
  INSERT INTO projects.tender_boq_items (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit, quantity, rate_cell_type, rate_column, amount_column)
  VALUES (v_t, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Site establishment', 'sum', 1, 'priced', 'F', 'G'),
         (v_t_other, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Generator set', 'No', 1, 'priced', 'F', 'G'),
         (v_t_draft, 0, 'Bill No 1', 5, 'item', '1', '1.1', 'Luminaire', 'No', 1, 'priced', 'F', 'G');
  INSERT INTO projects.tender_estimate_lines (item_id, tender_id, rate, amount)
  SELECT id, v_t, 99999, 99999 FROM projects.tender_boq_items WHERE tender_id = v_t;
  INSERT INTO projects.tender_requirements (tender_id, kind, label) VALUES (v_t, 'document', 'CIDB certificate');

  -- ═══ WM admin prepares invitations ═══════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.tender_invitations (tender_id, company_name, email, token_hash) VALUES (v_t, 'Probe Electrical', 'probe-bidder-1@example.invalid', h1);
    INSERT INTO projects.tender_invitations (tender_id, company_name, email, token_hash) VALUES (v_t, 'Probe Two', 'probe-bidder-2@example.invalid', h2);
    INSERT INTO _r VALUES ('admin_prepares_invitations', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_prepares_invitations', false);
  END;
  BEGIN
    INSERT INTO projects.tender_invitations (tender_id, company_name, email) VALUES (v_t, 'Shouty', 'UPPER@Example.com');
    INSERT INTO _r VALUES ('uppercase_email_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('uppercase_email_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.tender_invitations (tender_id, company_name, email) VALUES (v_t, 'Again', 'probe-bidder-1@example.invalid');
    INSERT INTO _r VALUES ('duplicate_live_email_REFUSED', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _r VALUES ('duplicate_live_email_REFUSED', true);
  END;
  -- A withdrawn invitation can be replaced by a new one to the same address.
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, token_hash) VALUES (v_t, 'Three', 'probe-bidder-3@example.invalid', h3);
  UPDATE projects.tender_invitations SET status = 'revoked', token_hash = NULL WHERE tender_id = v_t AND email = 'probe-bidder-3@example.invalid';
  BEGIN
    INSERT INTO projects.tender_invitations (tender_id, company_name, email) VALUES (v_t, 'Three again', 'probe-bidder-3@example.invalid');
    INSERT INTO _r VALUES ('reinvite_after_revoke_allowed', true);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _r VALUES ('reinvite_after_revoke_allowed', false);
  END;
  RESET ROLE;

  -- ═══ Contractor on the same project sees no invitation ════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_invitations WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('contractor_sees_no_invitation', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_summary(v_t);
  INSERT INTO _r VALUES ('contractor_gets_no_portal_summary', v_seen = 0);
  RESET ROLE;

  -- ═══ Accepting while the tender is still a draft is refused ════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM projects.tender_accept(h1);
    INSERT INTO _r VALUES ('accept_before_issue_REFUSED', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('accept_before_issue_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '14 days' WHERE id IN (v_t, v_t_other);

  -- ═══ The link holder (WM admin) cannot accept as the bidder ═══════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM projects.tender_accept(h1);
    INSERT INTO _r VALUES ('link_holder_cannot_accept_as_bidder', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('link_holder_cannot_accept_as_bidder', true);
  END;
  RESET ROLE;

  -- A manager cannot re-point a bidder's invitation at their own address…
  BEGIN
    UPDATE projects.tender_invitations SET email = (SELECT lower(email) FROM auth.users WHERE id = v_admin)
     WHERE tender_id = v_t AND email = 'probe-bidder-1@example.invalid';
    INSERT INTO _r VALUES ('invitation_address_frozen', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('invitation_address_frozen', true);
  END;
  -- …and cannot bid even on an invitation genuinely addressed to them.
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, token_hash)
  VALUES (v_t, 'WM itself', (SELECT lower(email) FROM auth.users WHERE id = v_admin), repeat('d', 64));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  BEGIN
    PERFORM projects.tender_accept(repeat('d', 64));
    INSERT INTO _r VALUES ('manager_cannot_bid', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('manager_cannot_bid', true);
  END;
  RESET ROLE;

  -- ═══ A PASSWORD session on the invited address proves nothing ═════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','password','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM projects.tender_accept(h1);
    INSERT INTO _r VALUES ('password_session_cannot_accept', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('password_session_cannot_accept', true);
  END;
  RESET ROLE;

  -- ═══ The invited address accepts, once ════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  v_got := projects.tender_accept(h1);
  INSERT INTO _r VALUES ('invited_address_accepts', v_got = v_t);
  BEGIN
    PERFORM projects.tender_accept(h1);
    INSERT INTO _r VALUES ('accept_is_single_use', false);
  EXCEPTION WHEN no_data_found OR object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('accept_is_single_use', true);
  END;
  RESET ROLE;
  -- Case-insensitive address match (auth email has capitals).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder2::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  v_got := projects.tender_accept(h2);
  INSERT INTO _r VALUES ('accept_matches_email_case_insensitively', v_got = v_t);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT id INTO v_part FROM projects.tender_participants WHERE user_id = v_bidder;
  SELECT id INTO v_part2 FROM projects.tender_participants WHERE user_id = v_bidder2;
  INSERT INTO _r VALUES ('accept_closed_invitation',
    (SELECT status = 'accepted' AND token_hash IS NULL AND accepted_by = v_bidder FROM projects.tender_invitations WHERE tender_id = v_t AND email = 'probe-bidder-1@example.invalid'));

  -- A participant on a DRAFT tender (only possible on the service path) sees nothing.
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t_draft, 'Probe Electrical', 'probe-bidder-1@example.invalid', 'accepted', now(), v_bidder) RETURNING id INTO v_inv_draft;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name) VALUES (v_t_draft, v_inv_draft, v_bidder, 'Probe Electrical');

  -- ═══ Bidder reads ═════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_summary(v_t_draft);
  INSERT INTO _r VALUES ('draft_tender_invisible_to_bidder', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_items(v_t_draft);
  INSERT INTO _r VALUES ('draft_boq_invisible_to_bidder', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_summary(v_t);
  INSERT INTO _r VALUES ('bidder_sees_own_tender_summary', v_seen = 1);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_items(v_t);
  INSERT INTO _r VALUES ('bidder_sees_own_boq', v_seen = 1);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_requirements(v_t);
  INSERT INTO _r VALUES ('bidder_sees_requirements', v_seen = 1);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_my_tenders();
  INSERT INTO _r VALUES ('bidder_home_lists_only_issued_tender', v_seen = 1);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_summary(v_t_other);
  INSERT INTO _r VALUES ('bidder_cannot_see_other_tender', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_items(v_t_other);
  INSERT INTO _r VALUES ('bidder_cannot_see_other_boq', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tenders;
  INSERT INTO _r VALUES ('bidder_no_direct_tender_rows', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_boq_items;
  INSERT INTO _r VALUES ('bidder_no_direct_boq_rows', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_estimate_lines;
  INSERT INTO _r VALUES ('bidder_never_sees_estimate', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_invitations;
  INSERT INTO _r VALUES ('bidder_sees_no_invitations', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_participants WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('bidder_sees_only_own_participant_row', v_seen = 1);
  UPDATE projects.tender_participants SET cidb_grade = '7EP', bbbee_level = '2', registration_number = '2015/123456/07',
         contact_name = 'P', phone = '0820000000', profile_completed_at = now() WHERE id = v_part;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('bidder_completes_own_profile', v_seen = 1);
  BEGIN
    UPDATE projects.tender_participants SET registration_number = NULL WHERE id = v_part;
    INSERT INTO _r VALUES ('complete_profile_needs_fields', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('complete_profile_needs_fields', true);
  END;
  UPDATE projects.tender_participants SET company_name = 'Hijacked' WHERE id = v_part2;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('bidder_cannot_edit_other_bidder', v_seen = 0);
  BEGIN
    UPDATE projects.tender_participants SET tender_id = v_t_other WHERE id = v_part;
    INSERT INTO _r VALUES ('bidder_cannot_move_participation', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('bidder_cannot_move_participation', true);
  END;
  BEGIN
    INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name)
    VALUES (v_t_other, v_inv_draft, v_bidder, 'Self-invite');
    INSERT INTO _r VALUES ('bidder_cannot_self_enrol', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('bidder_cannot_self_enrol', true);
  END;
  BEGIN
    UPDATE projects.tender_participants SET cidb_grade = 'grade seven' WHERE id = v_part;
    INSERT INTO _r VALUES ('cidb_shape_enforced', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('cidb_shape_enforced', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ A password session on an accepted bidder's account sees nothing ══
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','password','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM projects.tender_portal_items(v_t);
  INSERT INTO _r VALUES ('password_session_sees_no_boq', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_participants WHERE user_id = v_bidder;
  INSERT INTO _r VALUES ('password_session_sees_no_participant_row', v_seen = 0);
  SELECT count(*) INTO v_seen FROM projects.tender_portal_my_tenders();
  INSERT INTO _r VALUES ('password_session_has_no_tenders', v_seen = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ After closing the profile is frozen ═══════════════════════════════
  SET LOCAL session_replication_role = replica;   -- bypass the extend-only guard for the probe
  UPDATE projects.tenders SET closing_at = now() - interval '1 minute' WHERE id = v_t;
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE projects.tender_participants SET bbbee_level = '1' WHERE id = v_part;
    INSERT INTO _r VALUES ('profile_frozen_after_closing', false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    INSERT INTO _r VALUES ('profile_frozen_after_closing', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ Anon: refused at the grant ═══════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM projects.tender_portal_items(v_t);
    INSERT INTO _r VALUES ('anon_portal_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_portal_REFUSED', true);
  END;
  BEGIN
    PERFORM projects.tender_accept(h2);
    INSERT INTO _r VALUES ('anon_accept_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_accept_REFUSED', true);
  END;
  RESET ROLE;
END $$;

-- Site scope (00238). The probe is the one person ONLY site_scope stops: an
-- active project_members PM whose organisation membership is INACTIVE.
-- user_effective_project_role (so user_can_manage_tender, and every permissive
-- policy) still admits them; user_has_project_access does not. A fixture row
-- proves the first half, so these checks cannot pass vacuously.
DO $$
DECLARE
  v_project uuid; v_org uuid; v_t uuid; v_pm uuid := gen_random_uuid(); v_bidder uuid := gen_random_uuid(); v_inv uuid; v_n int;
BEGIN
  SELECT pm.project_id INTO v_project FROM projects.project_members pm WHERE pm.role = 'contractor' AND pm.is_active LIMIT 1;
  SELECT organisation_id INTO v_org FROM projects.projects WHERE id = v_project;
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-site-pm@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_bidder, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-site-bidder@example.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_pm, v_org, 'contractor', FALSE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES (v_project, v_pm, v_org, 'project_manager', TRUE);
  INSERT INTO projects.tenders (project_id, organisation_id, package, title, imported_at)
  VALUES (v_project, v_org, 'Site scope', 'Probe', now()) RETURNING id INTO v_t;
  UPDATE projects.tenders SET status = 'issued', closing_at = now() + interval '7 days' WHERE id = v_t;
  INSERT INTO projects.tender_invitations (tender_id, company_name, email, status, accepted_at, accepted_by)
  VALUES (v_t, 'Site Bidder', 'probe-site-bidder@example.invalid', 'accepted', now(), v_bidder) RETURNING id INTO v_inv;
  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name) VALUES (v_t, v_inv, v_bidder, 'Site Bidder');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('site_scope_fixture_probe_passes_manage_but_not_site',
    projects.user_can_manage_tender(v_t) AND NOT public.user_has_project_access(v_project));
  SELECT count(*) INTO v_n FROM projects.tender_invitations WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('site_scope_org_pm_off_site_sees_no_invitations', v_n = 0);
  SELECT count(*) INTO v_n FROM projects.tender_participants WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('site_scope_org_pm_off_site_sees_no_participants', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bidder::text, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method','otp','timestamp',1)))::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.tender_participants WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('site_scope_bidder_still_reads_own_participant_row', v_n = 1);
  UPDATE projects.tender_participants SET contact_name = 'Site Bidder Contact' WHERE tender_id = v_t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('site_scope_bidder_still_updates_own_profile', v_n = 1);
  SELECT count(*) INTO v_n FROM projects.tender_invitations WHERE tender_id = v_t;
  INSERT INTO _r VALUES ('site_scope_bidder_reads_no_invitation_rows', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

SELECT * FROM (VALUES
  ('fixture: the probe passes user_can_manage_tender but not site access', (SELECT v FROM _r WHERE k='site_scope_fixture_probe_passes_manage_but_not_site')),
  ('site scope: a PM whose org membership lapsed sees no invitations', (SELECT v FROM _r WHERE k='site_scope_org_pm_off_site_sees_no_invitations')),
  ('site scope: a PM whose org membership lapsed sees no participants', (SELECT v FROM _r WHERE k='site_scope_org_pm_off_site_sees_no_participants')),
  ('site scope: a bidder still reads their own participant row',    (SELECT v FROM _r WHERE k='site_scope_bidder_still_reads_own_participant_row')),
  ('site scope: a bidder still updates their own profile',          (SELECT v FROM _r WHERE k='site_scope_bidder_still_updates_own_profile')),
  ('site scope: a bidder reads no invitation rows',                 (SELECT v FROM _r WHERE k='site_scope_bidder_reads_no_invitation_rows')),
  ('admin prepares invitations',                                    (SELECT v FROM _r WHERE k='admin_prepares_invitations')),
  ('an upper-case email is refused',                                (SELECT v FROM _r WHERE k='uppercase_email_REFUSED')),
  ('one live invitation per email per tender',                      (SELECT v FROM _r WHERE k='duplicate_live_email_REFUSED')),
  ('a withdrawn address can be invited again',                      (SELECT v FROM _r WHERE k='reinvite_after_revoke_allowed')),
  ('contractor on the project sees no invitation',                  (SELECT v FROM _r WHERE k='contractor_sees_no_invitation')),
  ('contractor gets nothing from the tenderer portal',              (SELECT v FROM _r WHERE k='contractor_gets_no_portal_summary')),
  ('accepting before the tender is issued is refused',              (SELECT v FROM _r WHERE k='accept_before_issue_REFUSED')),
  ('the link holder (WM admin) cannot accept as the bidder',        (SELECT v FROM _r WHERE k='link_holder_cannot_accept_as_bidder')),
  ('a manager cannot re-point an invitation''s address',           (SELECT v FROM _r WHERE k='invitation_address_frozen')),
  ('the people running a tender cannot bid on it',                   (SELECT v FROM _r WHERE k='manager_cannot_bid')),
  ('a password session on the invited address cannot accept',     (SELECT v FROM _r WHERE k='password_session_cannot_accept')),
  ('a password session on a bidder account sees no BOQ',          (SELECT v FROM _r WHERE k='password_session_sees_no_boq')),
  ('a password session sees no participant row',                  (SELECT v FROM _r WHERE k='password_session_sees_no_participant_row')),
  ('a password session lists no tenders',                         (SELECT v FROM _r WHERE k='password_session_has_no_tenders')),
  ('the invited address accepts',                                   (SELECT v FROM _r WHERE k='invited_address_accepts')),
  ('an invitation can be accepted only once',                       (SELECT v FROM _r WHERE k='accept_is_single_use')),
  ('the email match is case-insensitive',                           (SELECT v FROM _r WHERE k='accept_matches_email_case_insensitively')),
  ('accepting closes the invitation and clears its link',           (SELECT v FROM _r WHERE k='accept_closed_invitation')),
  ('a draft tender is invisible to its bidder',                     (SELECT v FROM _r WHERE k='draft_tender_invisible_to_bidder')),
  ('a draft BOQ is invisible to its bidder',                        (SELECT v FROM _r WHERE k='draft_boq_invisible_to_bidder')),
  ('bidder sees their issued tender summary',                       (SELECT v FROM _r WHERE k='bidder_sees_own_tender_summary')),
  ('bidder sees their BOQ',                                         (SELECT v FROM _r WHERE k='bidder_sees_own_boq')),
  ('bidder sees the requirements',                                  (SELECT v FROM _r WHERE k='bidder_sees_requirements')),
  ('bidder home lists only the issued tender',                      (SELECT v FROM _r WHERE k='bidder_home_lists_only_issued_tender')),
  ('bidder cannot see another tender on the same project',          (SELECT v FROM _r WHERE k='bidder_cannot_see_other_tender')),
  ('bidder cannot see another tender''s BOQ',                       (SELECT v FROM _r WHERE k='bidder_cannot_see_other_boq')),
  ('bidder has no direct row path to tenders',                      (SELECT v FROM _r WHERE k='bidder_no_direct_tender_rows')),
  ('bidder has no direct row path to BOQ rows',                     (SELECT v FROM _r WHERE k='bidder_no_direct_boq_rows')),
  ('bidder NEVER sees WM''s internal estimate',                     (SELECT v FROM _r WHERE k='bidder_never_sees_estimate')),
  ('bidder sees no invitations',                                    (SELECT v FROM _r WHERE k='bidder_sees_no_invitations')),
  ('bidder sees only their own participant row',                    (SELECT v FROM _r WHERE k='bidder_sees_only_own_participant_row')),
  ('bidder completes their own company profile',                    (SELECT v FROM _r WHERE k='bidder_completes_own_profile')),
  ('a complete profile keeps its scored fields',                    (SELECT v FROM _r WHERE k='complete_profile_needs_fields')),
  ('bidder cannot edit another bidder''s profile',                  (SELECT v FROM _r WHERE k='bidder_cannot_edit_other_bidder')),
  ('bidder cannot move their participation to another tender',      (SELECT v FROM _r WHERE k='bidder_cannot_move_participation')),
  ('bidder cannot enrol themselves in a tender',                    (SELECT v FROM _r WHERE k='bidder_cannot_self_enrol')),
  ('CIDB grade shape is enforced',                                  (SELECT v FROM _r WHERE k='cidb_shape_enforced')),
  ('the company profile is frozen once the tender closes',          (SELECT v FROM _r WHERE k='profile_frozen_after_closing')),
  ('anon cannot call the tenderer portal',                          (SELECT v FROM _r WHERE k='anon_portal_REFUSED')),
  ('anon cannot accept an invitation',                              (SELECT v FROM _r WHERE k='anon_accept_REFUSED')),
  ('portal summary returns no reconciliation or estimate column',
     (SELECT pg_get_function_result('projects.tender_portal_summary(uuid)'::regprocedure) NOT SIMILAR TO '%(reconciliation|estimate|subtotal|path)%'))
) AS t("check", ok);
