-- BEHAVIOURAL assertions for 00224_tariff_explorer, run as real roles against
-- the live library (no tariff fixtures: the point is what a caller can read).
--   RED first:  scripts/db/dry-run-migration.sh <noop.sql> scripts/db/assert-tariff-explorer.sql
--   GREEN:      scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00224_tariff_explorer.sql scripts/db/assert-tariff-explorer.sql
-- Fixtures (two throwaway users, one throwaway org) are minted inside the
-- transaction and rolled back.
--
-- The org is NOT subscribed to Solar: D1 (2026-10-05) opens the published
-- library to every signed-in organisation. A user whose only membership is
-- deactivated must still read nothing.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org    UUID := gen_random_uuid();   -- unsubscribed customer org
  v_member UUID := gen_random_uuid();   -- active contractor in that org
  v_dead   UUID := gen_random_uuid();   -- deactivated member, no other membership
  v_n      INT;
  v_n2     INT;
  u        UUID;
BEGIN
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tariff-explorer-probe-org');
  FOREACH u IN ARRAY ARRAY[v_member, v_dead] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tariff-explorer-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_member, v_org, 'contractor', TRUE), (v_dead, v_org, 'admin', FALSE);

  -- ── 1. Data seeded by the migration (as postgres) ─────────────────────────
  SELECT count(*) INTO v_n FROM tariffs.tou_calendar c JOIN tariffs.licensee l ON l.id = c.licensee_id
   WHERE l.kind = 'eskom' AND c.source = 'published' AND c.high_season_months = ARRAY[6,7,8]
     AND c.valid_from <= DATE '2026-10-05' AND (c.valid_to IS NULL OR c.valid_to > DATE '2026-10-05');
  INSERT INTO _r VALUES ('eskom_calendars_valid_today', v_n = 2);

  -- Every season x day type of every Eskom calendar covers exactly 24 h with no overlap.
  SELECT count(*) INTO v_n FROM (
    SELECT w.calendar_id, w.season, w.day_type, sum(w.end_minute - w.start_minute) AS covered
      FROM tariffs.tou_window w JOIN tariffs.tou_calendar c ON c.id = w.calendar_id
      JOIN tariffs.licensee l ON l.id = c.licensee_id WHERE l.kind = 'eskom'
     GROUP BY 1, 2, 3) s WHERE covered = 1440;
  INSERT INTO _r VALUES ('eskom_windows_tile_the_day', v_n = 12);
  SELECT count(*) INTO v_n FROM tariffs.tou_window a JOIN tariffs.tou_window b
    ON a.calendar_id = b.calendar_id AND a.season = b.season AND a.day_type = b.day_type AND a.id < b.id
   AND a.start_minute < b.end_minute AND b.start_minute < a.end_minute;
  INSERT INTO _r VALUES ('no_overlapping_windows', v_n = 0);

  -- Schedule of standard prices 2026/27 p56: high-season weekday evening peak 17:00-20:00.
  SELECT count(*) INTO v_n FROM tariffs.tou_window w JOIN tariffs.tou_calendar c ON c.id = w.calendar_id
    JOIN tariffs.licensee l ON l.id = c.licensee_id
   WHERE l.name = 'Eskom' AND w.season = 'high' AND w.day_type = 'weekday'
     AND w.start_minute = 1020 AND w.end_minute = 1200 AND w.period = 'peak';
  INSERT INTO _r VALUES ('eskom_high_weekday_evening_peak_17_20', v_n = 1);

  -- p12: Good Friday 2026 is billed as Sunday, Freedom Day 2026 as Saturday, for Megaflex.
  SELECT count(*) INTO v_n FROM tariffs.holiday_treatment h JOIN tariffs.tou_calendar c ON c.id = h.calendar_id
    JOIN tariffs.licensee l ON l.id = c.licensee_id
   WHERE l.name = 'Eskom' AND h.tariff_family = 'Megaflex'
     AND ((h.holiday_date = DATE '2026-04-03' AND h.treated_as = 'sunday')
       OR (h.holiday_date = DATE '2026-04-27' AND h.treated_as = 'saturday'));
  INSERT INTO _r VALUES ('megaflex_holiday_rows_cited', v_n = 2);
  -- Homeflex bills the actual weekday: no dated rows and no calendar-wide rule.
  SELECT count(*) INTO v_n FROM tariffs.holiday_treatment WHERE tariff_family = 'Homeflex';
  SELECT count(*) INTO v_n2 FROM tariffs.holiday_rule h JOIN tariffs.tou_calendar c ON c.id = h.calendar_id
    JOIN tariffs.licensee l ON l.id = c.licensee_id WHERE l.kind = 'eskom';
  INSERT INTO _r VALUES ('homeflex_holidays_follow_weekday', v_n = 0 AND v_n2 = 0);

  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE mdb_code IS NOT NULL;
  INSERT INTO _r VALUES ('mdb_codes_seeded', v_n >= 160);
  SELECT count(*) INTO v_n FROM tariffs.licensee
   WHERE (name = 'CITY POWER' AND mdb_code = 'JHB') OR (name = 'EMALAHLENI EC' AND mdb_code = 'EC136')
      OR (name = 'BUFFALO CITY' AND mdb_code = 'BUF');
  INSERT INTO _r VALUES ('mdb_code_spot_checks', v_n = 3);
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE kind NOT IN ('municipal', 'metro') AND mdb_code IS NOT NULL;
  INSERT INTO _r VALUES ('non_municipal_licensees_have_no_mdb_code', v_n = 0);

  -- ── 2. An active member of an UNSUBSCRIBED org reads the published library ─
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('member_can_read_library', public.caller_can_read_tariff_library());
  SELECT count(*) INTO v_n FROM tariffs.licensee;
  INSERT INTO _r VALUES ('member_reads_licensees', v_n >= 179);
  SELECT count(*) INTO v_n FROM tariffs.licensee_alias;
  INSERT INTO _r VALUES ('member_reads_aliases', v_n > 0);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE state = 'published';
  INSERT INTO _r VALUES ('member_reads_published_years', v_n > 0);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE state IN ('in_review', 'ingesting');
  INSERT INTO _r VALUES ('member_cannot_read_draft_years', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id
    JOIN tariffs.tariff_year y ON y.id = t.tariff_year_id JOIN tariffs.licensee l ON l.id = y.licensee_id
   WHERE l.name = 'Eskom' AND y.financial_year = '2026/27' AND t.family = 'Megaflex';
  INSERT INTO _r VALUES ('member_reads_published_charges', v_n > 0);
  SELECT count(*) INTO v_n FROM tariffs.tou_window;
  SELECT count(*) INTO v_n2 FROM tariffs.holiday_treatment;
  INSERT INTO _r VALUES ('member_reads_calendar_and_holidays', v_n > 0 AND v_n2 > 0);
  SELECT count(*) INTO v_n FROM tariffs.source_document;
  INSERT INTO _r VALUES ('member_reads_source_documents', v_n > 0);
  SELECT count(*) INTO v_n FROM tariffs.ingest_run;
  INSERT INTO _r VALUES ('member_cannot_read_ingest_runs', v_n = 0);
  BEGIN
    INSERT INTO tariffs.holiday_treatment (calendar_id, tariff_family, holiday_date, holiday_name, treated_as)
    SELECT id, 'Probe', DATE '2027-01-01', 'Probe', 'sunday' FROM tariffs.tou_calendar LIMIT 1;
    RAISE EXCEPTION 'member wrote a holiday row';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('member_holiday_write_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('member_holiday_write_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('member_holiday_write_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3. A deactivated-only user reads nothing ──────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dead::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('deactivated_cannot_read_library', NOT public.caller_can_read_tariff_library());
  SELECT count(*) INTO v_n FROM tariffs.licensee;
  SELECT count(*) INTO v_n2 FROM tariffs.tariff_year;
  INSERT INTO _r VALUES ('deactivated_reads_nothing', v_n = 0 AND v_n2 = 0);
  RESET ROLE;

  -- ── 4. anon ───────────────────────────────────────────────────────────────
  INSERT INTO _r VALUES ('anon_cannot_execute_helper',
    NOT has_function_privilege('anon', 'public.caller_can_read_tariff_library()', 'EXECUTE'));
  INSERT INTO _r VALUES ('anon_cannot_read_holiday_treatment',
    NOT has_table_privilege('anon', 'tariffs.holiday_treatment', 'SELECT'));
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
