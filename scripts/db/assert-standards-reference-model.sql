-- Assertions for the standards reference model (editions, citations,
-- visibility on cable_schedule.sans_tables / sans_rows, the ref_standards
-- registry). Run against production in a rolled-back transaction:
--
--   scripts/db/dry-run-migration.sh <migration.sql> scripts/db/assert-standards-reference-model.sql
--
-- Every guard is ATTEMPTED, not read out of pg_constraint: a check that
-- exists but lets the write through is the 00051 family of gaps. Visibility
-- is asserted by impersonating a real member of the WM org and a real user
-- outside it.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_wm_org   CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_wm_user  UUID;
  v_outsider UUID;
  v_std      UUID;
  v_std_old  UUID;
  v_tbl      UUID;
  v_legacy   UUID;
  v_seen     INT;
BEGIN
  SELECT uo.user_id INTO v_wm_user FROM public.user_organisations uo
   WHERE uo.organisation_id = c_wm_org AND uo.is_active LIMIT 1;
  SELECT uo.user_id INTO v_outsider FROM public.user_organisations uo
   WHERE uo.is_active AND uo.organisation_id <> c_wm_org
     AND NOT EXISTS (SELECT 1 FROM public.user_organisations w
                      WHERE w.user_id = uo.user_id AND w.organisation_id = c_wm_org AND w.is_active)
   LIMIT 1;
  IF v_wm_user IS NULL OR v_outsider IS NULL THEN RAISE EXCEPTION 'fixture users not found'; END IF;

  -- ── Registry: editions and supersession ──────────────────────────────────
  SELECT id INTO v_std FROM cable_schedule.ref_standards WHERE code = 'SANS 10142-1' AND edition = '3.1';
  SELECT id INTO v_std_old FROM cable_schedule.ref_standards WHERE code = 'SANS 10142-1' AND edition = '2';
  INSERT INTO _r VALUES ('registry_current',
    (SELECT status = 'current' FROM cable_schedule.ref_standards WHERE id = v_std));
  INSERT INTO _r VALUES ('registry_superseded_points_forward',
    (SELECT status = 'superseded' AND superseded_by = v_std FROM cable_schedule.ref_standards WHERE id = v_std_old));

  -- ── Legacy tables are linked to their real source, still open to all ─────
  INSERT INTO _r VALUES ('legacy_all_linked',
    NOT EXISTS (SELECT 1 FROM cable_schedule.sans_tables
                 WHERE provenance = 'transcribed' AND (standard_id IS NULL OR clause IS NULL OR visibility_org_id IS NOT NULL)));

  -- ── An extracted table needs a standard and a clause ─────────────────────
  BEGIN
    INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance)
    VALUES ('ZZ_PROBE_NOSTD', 'probe', 'probe', '[]'::jsonb, 'extracted');
    INSERT INTO _r VALUES ('extracted_without_standard_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('extracted_without_standard_REFUSED', true);
  END;

  -- topic + conditions: required of extracted tables since 00232 (this file needs 00232 applied).
  INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance, standard_id, clause, visibility_org_id, topic, conditions)
  VALUES ('ZZ_PROBE_T', 'probe', 'SANS 10142-1:2021', '[]'::jsonb, 'extracted', v_std, 'Table 6.13', c_wm_org, 'derating', '[]'::jsonb)
  RETURNING id INTO v_tbl;

  -- ── A row of an extracted table cannot exist without a citation ──────────
  BEGIN
    INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data) VALUES (v_tbl, 1, '{"a":1}');
    INSERT INTO _r VALUES ('uncited_row_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('uncited_row_REFUSED', true);
  END;
  BEGIN
    INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data, citation)
    VALUES (v_tbl, 2, '{"a":1}', '{"clause":"Table 6.13","page_pdf":124}');
    INSERT INTO _r VALUES ('citation_without_printed_page_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('citation_without_printed_page_REFUSED', true);
  END;
  BEGIN
    INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data, citation)
    VALUES (v_tbl, 3, '{"a":1}', '{"clause":" ","page_pdf":124,"page_printed":120}');
    INSERT INTO _r VALUES ('citation_blank_clause_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('citation_blank_clause_REFUSED', true);
  END;
  INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data, citation)
  VALUES (v_tbl, 4, '{"a":1}', '{"clause":"Table 6.13","page_pdf":124,"page_printed":120}');
  INSERT INTO _r VALUES ('cited_row_accepted', true);

  -- ── Removing a citation later is refused too ─────────────────────────────
  BEGIN
    UPDATE cable_schedule.sans_rows SET citation = NULL WHERE table_id = v_tbl;
    INSERT INTO _r VALUES ('citation_removal_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('citation_removal_REFUSED', true);
  END;

  -- ── Promoting a table with uncited rows to 'extracted' is refused ────────
  INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, standard_id, clause, topic, conditions)
  VALUES ('ZZ_PROBE_LEGACY', 'probe', 'probe', '[]'::jsonb, v_std, 'Table 9.9', 'derating', '[]'::jsonb) RETURNING id INTO v_legacy;
  INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data) VALUES (v_legacy, 1, '{"a":1}');
  BEGIN
    UPDATE cable_schedule.sans_tables SET provenance = 'extracted' WHERE id = v_legacy;
    INSERT INTO _r VALUES ('promotion_with_uncited_rows_REFUSED', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('promotion_with_uncited_rows_REFUSED', true);
  END;

  -- ── Visibility: a WM member sees the WM-only table and its rows ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM cable_schedule.sans_tables WHERE id = v_tbl;
  INSERT INTO _r VALUES ('wm_member_sees_table', v_seen = 1);
  SELECT count(*) INTO v_seen FROM cable_schedule.sans_rows WHERE table_id = v_tbl;
  INSERT INTO _r VALUES ('wm_member_sees_rows', v_seen = 1);
  SELECT count(*) INTO v_seen FROM cable_schedule.ref_standards;
  INSERT INTO _r VALUES ('wm_member_reads_registry', v_seen >= 1);
  BEGIN
    INSERT INTO cable_schedule.ref_standards (code, edition, title, publisher, kind, status)
    VALUES ('ZZ', '1', 'probe', 'probe', 'standard', 'current');
    INSERT INTO _r VALUES ('member_registry_write_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('member_registry_write_REFUSED', true);
  END;
  RESET ROLE;

  -- ── …a user outside the WM org sees neither, but still sees legacy data ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM cable_schedule.sans_tables WHERE id = v_tbl;
  INSERT INTO _r VALUES ('outsider_table_HIDDEN', v_seen = 0);
  SELECT count(*) INTO v_seen FROM cable_schedule.sans_rows WHERE table_id = v_tbl;
  INSERT INTO _r VALUES ('outsider_rows_HIDDEN', v_seen = 0);
  SELECT count(*) INTO v_seen FROM cable_schedule.sans_rows r
    JOIN cable_schedule.sans_tables t ON t.id = r.table_id WHERE t.code = 'TABLE_6_3_3';
  INSERT INTO _r VALUES ('outsider_still_reads_legacy_rows', v_seen = 11);
  RESET ROLE;

  -- ── anon is refused at the grant ─────────────────────────────────────────
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM cable_schedule.ref_standards;
    INSERT INTO _r VALUES ('anon_registry_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_registry_REFUSED', true);
  END;
  RESET ROLE;
END $$;

SELECT * FROM (VALUES
  ('registry: SANS 10142-1 Ed 3.1 is current',                          (SELECT v FROM _r WHERE k='registry_current')),
  ('registry: Ed 2 is superseded by Ed 3.1',                            (SELECT v FROM _r WHERE k='registry_superseded_points_forward')),
  ('every legacy table is linked to a source + clause, visible to all', (SELECT v FROM _r WHERE k='legacy_all_linked')),
  ('an extracted table without a standard is refused',                  (SELECT v FROM _r WHERE k='extracted_without_standard_REFUSED')),
  ('an uncited row of an extracted table is refused',                   (SELECT v FROM _r WHERE k='uncited_row_REFUSED')),
  ('a citation without the printed page is refused',                    (SELECT v FROM _r WHERE k='citation_without_printed_page_REFUSED')),
  ('a citation with a blank clause is refused',                         (SELECT v FROM _r WHERE k='citation_blank_clause_REFUSED')),
  ('CONTROL: a fully cited row is accepted',                            (SELECT v FROM _r WHERE k='cited_row_accepted')),
  ('removing a citation is refused',                                    (SELECT v FROM _r WHERE k='citation_removal_REFUSED')),
  ('promoting a table with uncited rows to extracted is refused',       (SELECT v FROM _r WHERE k='promotion_with_uncited_rows_REFUSED')),
  ('a WM member sees the WM-only table',                                (SELECT v FROM _r WHERE k='wm_member_sees_table')),
  ('a WM member sees its rows',                                         (SELECT v FROM _r WHERE k='wm_member_sees_rows')),
  ('a signed-in member reads the registry',                             (SELECT v FROM _r WHERE k='wm_member_reads_registry')),
  ('a signed-in member cannot write the registry',                      (SELECT v FROM _r WHERE k='member_registry_write_REFUSED')),
  ('a user outside the WM org does not see the table',                  (SELECT v FROM _r WHERE k='outsider_table_HIDDEN')),
  ('a user outside the WM org does not see its rows',                   (SELECT v FROM _r WHERE k='outsider_rows_HIDDEN')),
  ('CONTROL: that user still reads the legacy cable tables',            (SELECT v FROM _r WHERE k='outsider_still_reads_legacy_rows')),
  ('anon cannot read the registry',                                     (SELECT v FROM _r WHERE k='anon_registry_REFUSED'))
) AS t("check", ok);
