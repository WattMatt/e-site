-- BEHAVIOURAL assertions for the `reports` and `qc-reports` buckets and the report-row path
-- gate (migration 00207_reports_storage_hardening.sql), run as real
-- production roles inside a rolled-back transaction.
--
--   scripts/db/dry-run-migration.sh /tmp/noop.sql  scripts/db/assert-reports-storage-hardening.sql   # RED on today's production
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_reports_storage_hardening.sql \
--                                   scripts/db/assert-reports-storage-hardening.sql                    # GREEN
--
-- Every ok=true row is the SECURE answer. Against production before the
-- migration the refusal rows are false: that is the evidence of the gap.
-- The *_control rows are positive paths that must stay true on both runs;
-- a fix that refused everything would turn them red.
--
-- Mechanics (see scripts/db/assert-floor-plan-markups-roles.sql):
--   * request.jwt.claims is transaction-local and outlives RESET ROLE, so
--     all fixtures are seeded as postgres first and the claim is re-set per
--     identity.
--   * storage.protect_delete() refuses a direct DELETE unless
--     storage.allow_delete_query = 'true' — the Storage API sets it; the
--     probe sets it too so the RLS policy, not the guard, is what answers.
--   * Nothing here touches object BYTES: storage.objects rows are metadata,
--     and the transaction is rolled back.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_wm           CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  c_contractor   CONSTANT UUID := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test fixture
  v_cv           UUID;
  v_admin        UUID;
  v_ext_owner    UUID;
  v_ext_org      UUID;
  v_ext_proj     UUID;
  v_eq_path      TEXT;
  v_eq_proj      UUID;
  v_gcr_path     TEXT;
  v_qc_path      TEXT;
  v_qc_proj      UUID;
  v_open_row     UUID;
  v_open_path    TEXT;
  v_open_proj    UUID;
  v_n            INT;
  v_new          UUID;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  SELECT user_id INTO v_cv FROM public.user_organisations
   WHERE organisation_id = c_wm AND role = 'client_viewer' AND is_active LIMIT 1;
  SELECT user_id INTO v_admin FROM public.user_organisations
   WHERE organisation_id = c_wm AND role = 'admin' AND is_active LIMIT 1;
  SELECT user_id, organisation_id INTO v_ext_owner, v_ext_org FROM public.user_organisations
   WHERE organisation_id <> c_wm AND role = 'owner' AND is_active LIMIT 1;
  IF v_cv IS NULL OR v_admin IS NULL OR v_ext_owner IS NULL THEN
    RAISE EXCEPTION 'fixture missing: cv=% admin=% ext_owner=%', v_cv, v_admin, v_ext_owner;
  END IF;

  -- The sensitive target: an equipment_materials PDF (OWNER/ADMIN/PM only in the app).
  SELECT storage_path, project_id INTO v_eq_path, v_eq_proj FROM projects.reports
   WHERE kind = 'equipment_materials' ORDER BY created_at LIMIT 1;
  -- A generator-cost-recovery PDF (COST_VIEW_ROLES + a paid seat in the app).
  SELECT storage_path INTO v_gcr_path FROM gcr.report_revisions ORDER BY created_at LIMIT 1;
  -- A QC PDF (bucket qc-reports) in a project the contractor is NOT a member of.
  SELECT storage_path, project_id INTO v_qc_path, v_qc_proj FROM projects.reports r
   WHERE kind = 'qc' AND NOT EXISTS (SELECT 1 FROM projects.project_members pm
     WHERE pm.project_id = r.project_id AND pm.user_id = c_contractor AND pm.is_active)
   ORDER BY created_at LIMIT 1;
  IF v_qc_path IS NULL THEN RAISE EXCEPTION 'no qc report outside the contractor''s project'; END IF;
  INSERT INTO _r SELECT 'qc_fixture_object_exists_control',
    EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'qc-reports' AND name = v_qc_path);
  INSERT INTO _r SELECT 'existing_qc_rows_all_canonical_control',
    count(*) = count(*) FILTER (WHERE
      storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.pdf$'
      AND strpos(storage_path, '..') = 0
      AND starts_with(storage_path, organisation_id::text || '/' || project_id::text || '/'))
    FROM projects.reports WHERE kind = 'qc';

  -- An open-kind row the admin may legitimately manage.
  SELECT id, storage_path, project_id INTO v_open_row, v_open_path, v_open_proj FROM projects.reports
   WHERE kind = 'tenant_schedule' AND project_id <> v_eq_proj ORDER BY created_at LIMIT 1;
  IF v_eq_path IS NULL OR v_gcr_path IS NULL OR v_open_row IS NULL THEN
    RAISE EXCEPTION 'fixture rows missing';
  END IF;

  -- An external org's own project (the external owner has none in production;
  -- nothing stops them creating one, so the probe does, and rolls it back).
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_ext_org, 'reports-probe-ext', v_ext_owner) RETURNING id INTO v_ext_proj;

  -- Existing data must survive the new row gate unchanged.
  INSERT INTO _r SELECT 'existing_report_rows_all_canonical_control',
    count(*) = count(*) FILTER (WHERE
      storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.pdf$'
      AND strpos(storage_path, '..') = 0
      AND starts_with(storage_path, organisation_id::text || '/' || project_id::text || '/'))
    FROM projects.reports;
  INSERT INTO _r SELECT 'existing_gcr_rows_all_canonical_control',
    count(*) = count(*) FILTER (WHERE
      storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\.pdf$'
      AND strpos(storage_path, '..') = 0
      AND starts_with(storage_path, organisation_id::text || '/' || project_id::text || '/'))
    FROM gcr.report_revisions;

  PERFORM set_config('storage.allow_delete_query', 'true', true);

  -- ═══ 1. CONTRACTOR (rbac-test) — storage.objects, bucket `reports` ═══════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'reports' AND name = v_eq_path;
  INSERT INTO _r VALUES ('contractor_cannot_read_equipment_pdf', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'reports' AND name = v_gcr_path;
  INSERT INTO _r VALUES ('contractor_cannot_read_gcr_pdf', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'reports';
  INSERT INTO _r VALUES ('contractor_lists_no_report_objects', v_n = 0);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('reports', c_wm::text || '/' || v_eq_proj::text || '/equipment-materials-v99.pdf', c_contractor::text);
    INSERT INTO _r VALUES ('contractor_upload_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_upload_REFUSED', true);
  END;

  UPDATE storage.objects SET metadata = metadata WHERE bucket_id = 'reports' AND name = v_eq_path;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_overwrite_REFUSED', v_n = 0);

  -- Undone at once (savepoint) so later checks still find the object.
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'reports' AND name = v_eq_path;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
            WHEN insufficient_privilege THEN v_n := 0;
  END;
  INSERT INTO _r VALUES ('contractor_delete_REFUSED', v_n = 0);

  -- ── bucket qc-reports: another project's QC PDF, same org ──────────────
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'qc-reports' AND name = v_qc_path;
  INSERT INTO _r VALUES ('contractor_cannot_read_other_project_qc_pdf', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'qc-reports';
  INSERT INTO _r VALUES ('contractor_lists_no_qc_objects', v_n = 0);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('qc-reports', c_wm::text || '/' || v_qc_proj::text || '/qc-report-probe-v99.pdf', c_contractor::text);
    INSERT INTO _r VALUES ('contractor_qc_upload_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_qc_upload_REFUSED', true);
  END;
  UPDATE storage.objects SET metadata = metadata WHERE bucket_id = 'qc-reports' AND name = v_qc_path;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_qc_overwrite_REFUSED', v_n = 0);
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'qc-reports' AND name = v_qc_path;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
            WHEN insufficient_privilege THEN v_n := 0;
  END;
  INSERT INTO _r VALUES ('contractor_qc_delete_REFUSED', v_n = 0);
  RESET ROLE;

  -- ═══ 2. CLIENT VIEWER — read-only role, still reads by path today ═════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_cv::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'reports' AND name IN (v_eq_path, v_gcr_path);
  INSERT INTO _r VALUES ('client_viewer_cannot_read_sensitive_pdfs', v_n = 0);
  RESET ROLE;

  -- ═══ 3. ORG ADMIN — even an admin reads/writes the bucket only through
  --        the app (every writer and signer uses the service client) ════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'reports' AND name = v_open_path;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
            WHEN insufficient_privilege THEN v_n := 0;
  END;
  INSERT INTO _r VALUES ('admin_direct_object_delete_REFUSED', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'qc-reports';
  INSERT INTO _r VALUES ('admin_direct_qc_read_REFUSED', v_n = 0);

  -- projects.reports: a row pointing at ANOTHER project's sensitive PDF
  -- (getProjectReportUrlAction gates on the row's KIND, then service-signs its path).
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (c_wm, v_open_proj, 'tenant_schedule', 'probe', v_eq_path);
    INSERT INTO _r VALUES ('admin_row_pointing_at_other_project_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_row_pointing_at_other_project_REFUSED', true);
  END;

  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (c_wm, v_open_proj, 'tenant_schedule', 'probe',
            c_wm::text || '/' || v_open_proj::text || '/../../' || v_eq_path);
    INSERT INTO _r VALUES ('admin_row_dotdot_traversal_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_row_dotdot_traversal_REFUSED', true);
  END;

  -- Re-pointing an existing row: WITH CHECK refuses (42501) or USING hides it (0 rows).
  BEGIN
    UPDATE projects.reports SET storage_path = v_eq_path WHERE id = v_open_row;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_repoint_existing_row_REFUSED', v_n = 0);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_repoint_existing_row_REFUSED', true);
  END;

  -- gcr.report_revisions: getGcrReportUrlAction service-signs its storage_path too.
  BEGIN
    INSERT INTO gcr.report_revisions (project_id, organisation_id, revision_number, storage_path, file_name)
    VALUES (v_open_proj, c_wm, 9999, v_eq_path, 'probe.pdf');
    INSERT INTO _r VALUES ('admin_gcr_revision_pointing_elsewhere_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_gcr_revision_pointing_elsewhere_REFUSED', true);
  END;

  -- Positive controls: the canonical shape under the row's own org/project
  -- still inserts, updates and deletes through a session (reports_write).
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (c_wm, v_open_proj, 'tenant_schedule', 'probe',
            c_wm::text || '/' || v_open_proj::text || '/tenant-schedule-v999.pdf')
    RETURNING id INTO v_new;
    INSERT INTO _r VALUES ('admin_canonical_row_insert_control', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_canonical_row_insert_control', false);
  END;
  BEGIN
    UPDATE projects.reports SET status = 'superseded' WHERE id = v_open_row;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_canonical_row_update_control', v_n = 1);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_canonical_row_update_control', false);
  END;
  BEGIN
    DELETE FROM projects.reports WHERE id = v_open_row;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
            WHEN insufficient_privilege THEN v_n := 0;
  END;
  INSERT INTO _r VALUES ('admin_row_delete_control', v_n = 1);
  BEGIN
    INSERT INTO gcr.report_revisions (project_id, organisation_id, revision_number, storage_path, file_name)
    VALUES (v_open_proj, c_wm, 9998,
            c_wm::text || '/' || v_open_proj::text || '/generator-cost-recovery/probe-1.pdf', 'probe.pdf');
    INSERT INTO _r VALUES ('admin_gcr_canonical_insert_control', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_gcr_canonical_insert_control', false);
  END;
  RESET ROLE;

  -- ═══ 4. EXTERNAL ORG OWNER — cross-org ═══════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ext_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- (a) a row in their OWN project naming WM's equipment PDF → the URL,
  --     route-sheet and delete actions would service-sign/-download/-remove it.
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (v_ext_org, v_ext_proj, 'tenant_schedule', 'probe', v_eq_path);
    INSERT INTO _r VALUES ('ext_owner_row_naming_foreign_pdf_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('ext_owner_row_naming_foreign_pdf_REFUSED', true);
  END;

  -- (b) a row planted into WM's project (their own org id, their own folder):
  --     every WM member listing that project's saved reports would see it.
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (v_ext_org, v_open_proj, 'tenant_schedule', 'probe',
            v_ext_org::text || '/' || v_open_proj::text || '/tenant-schedule-v1.pdf');
    INSERT INTO _r VALUES ('ext_owner_row_planted_in_foreign_project_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('ext_owner_row_planted_in_foreign_project_REFUSED', true);
  END;

  -- (c) …with the PDF to go with it: an upload into <their org>/<WM project>/.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES ('reports', v_ext_org::text || '/' || v_open_proj::text || '/tenant-schedule-v1.pdf', v_ext_owner::text);
    INSERT INTO _r VALUES ('ext_owner_upload_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('ext_owner_upload_REFUSED', true);
  END;

  -- Control: their canonical row in their own project still works.
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path)
    VALUES (v_ext_org, v_ext_proj, 'tenant_schedule', 'probe',
            v_ext_org::text || '/' || v_ext_proj::text || '/tenant-schedule-v1.pdf');
    INSERT INTO _r VALUES ('ext_owner_own_canonical_row_control', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('ext_owner_own_canonical_row_control', false);
  END;
  RESET ROLE;

  -- ═══ 5. SERVICE ROLE — every app writer/signer; must be untouched ════════
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'reports';
  INSERT INTO _r VALUES ('service_role_reads_all_report_objects_control', v_n > 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'qc-reports' AND name = v_qc_path;
  INSERT INTO _r VALUES ('service_role_reads_qc_pdf_control', v_n = 1);
  RESET ROLE;
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
