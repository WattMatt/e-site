-- D-23 volume test for solar.meter_readings, inserted and measured INSIDE the dry-run transaction,
-- then rolled back. The check text carries the measurement; ok = within the D-23 limit.
--   scripts/db/dry-run-migration.sh <scratchpad>/mig-3a.sql scripts/db/solar-readings-volume-test.sql
--   (mig-3a.sql = 00207_solar_foundation.sql + 00210_solar_meter_data.sql while 00207 is unapplied)
--
-- SCALE (owner decision 2026-09-28): the full D-23 corpus is 120 bulk channels + 1 write_readings
-- channel x 17,520 half-hours (a 40-tenant mall, three channels each, one year) = 2,119,920 rows.
-- Against PRODUCTION this file runs SCALED: v_bulk_channels = 27, so 27 x 17,520 = 473,040 bulk rows
-- + 17,520 through write_readings = 490,560 rows, under the 500,000-row production cap. It refuses a
-- larger run unless the session sets `solar.volume_allow_full = on` (a local stack only; never on
-- production). Size- and volume-dependent measures (bulk insert ms, site monthly energy ms, total
-- bytes) are ALSO reported extrapolated linearly to the full corpus (x 120/27 for the bulk insert,
-- x 121/28 for the site aggregate and the bytes). The per-channel read and hourly aggregate are per
-- channel (PK index scan in one partition) and do not scale with table size except via index depth.
--
-- Switch criterion (docs/solar/06 D-23): move readings to compressed files in Storage + hourly
-- aggregates in Postgres if ANY of: one channel-year read under RLS > 500 ms; write_readings < 10,000
-- rows/s; or the projected table size for the expected corpus exceeds 25 % of the database plan.
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated;

DO $$
DECLARE
  v_bulk_channels CONSTANT INT := 27;     -- 120 = the full corpus (local stack only)
  v_full_bulk     CONSTANT INT := 120;
  v_rows_per_ch   CONSTANT INT := 17520;
  v_total_rows    BIGINT := (v_bulk_channels + 1)::bigint * v_rows_per_ch;
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
  IF v_total_rows > 500000 AND current_setting('solar.volume_allow_full', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'volume test: % rows exceeds the 500,000-row production cap', v_total_rows;
  END IF;

  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-volume-probe');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'solar-volume-' || v_admin || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_admin, v_org, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_p, v_org, 'solar-volume-probe', v_admin);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '30 days');

  FOR i IN 1..(v_bulk_channels + 1) LOOP
    INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'volume-' || i) RETURNING id INTO v_meter;
    INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit, interval_min, tz_convention, parser_version)
    VALUES (v_meter, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'begin', 'volume-test') RETURNING id INTO v_ch;
    IF i <= v_bulk_channels THEN v_chs := v_chs || v_ch; ELSE v_w := v_ch; END IF;
  END LOOP;

  -- 1. Bulk insert (the floor: the fastest path Postgres has)
  t0 := clock_timestamp();
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT c, v_org, timestamptz '2025-01-01 00:30+02' + s * interval '30 minutes', 100 + (s % 48), 0
    FROM unnest(v_chs) AS c, generate_series(0, v_rows_per_ch - 1) AS s;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  SELECT count(*) INTO v_n FROM solar.meter_readings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES (format('bulk_insert_%s_rows_ms=%s_extrapolated_%s_rows_ms=%s', v_n, round(v_ms),
                                v_full_bulk * v_rows_per_ch, round(v_ms * v_full_bulk / v_bulk_channels)),
                         v_n = v_bulk_channels::bigint * v_rows_per_ch);
  -- Production tables are analysed by autovacuum; a fresh in-transaction table is not.
  ANALYZE solar.meter_readings;

  -- 2. The commit route's path: write_readings as the org admin, 4 calls of <= 5,000
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  t0 := clock_timestamp();
  FOR k IN 0..3 LOOP
    PERFORM solar.write_readings(v_w,
      ARRAY(SELECT timestamptz '2025-01-01 00:30+02' + s * interval '30 minutes' FROM generate_series(k * 5000, least(k * 5000 + 4999, v_rows_per_ch - 1)) s),
      ARRAY(SELECT (100 + s % 48)::float8 FROM generate_series(k * 5000, least(k * 5000 + 4999, v_rows_per_ch - 1)) s),
      ARRAY(SELECT 0::smallint FROM generate_series(k * 5000, least(k * 5000 + 4999, v_rows_per_ch - 1)) s));
  END LOOP;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('write_readings_%s_rows_ms=%s_rows_per_s=%s', v_rows_per_ch, round(v_ms), round(v_rows_per_ch / greatest(v_ms, 1) * 1000)),
                         v_rows_per_ch / greatest(v_ms, 1) * 1000 >= 10000);

  -- 3. Read one channel-year under RLS (what a chart or the load builder does)
  t0 := clock_timestamp();
  SELECT count(*) INTO v_n FROM (SELECT ts_end, value FROM solar.meter_readings WHERE channel_id = v_chs[1] ORDER BY ts_end) x;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_read_one_channel_year_%s_rows_ms=%s', v_n, round(v_ms, 1)), v_n = v_rows_per_ch AND v_ms < 500);

  -- 4. Hourly aggregate of one channel under RLS
  t0 := clock_timestamp();
  PERFORM count(*) FROM (SELECT date_trunc('hour', ts_end - interval '30 minutes'), avg(value) FROM solar.meter_readings WHERE channel_id = v_chs[1] GROUP BY 1) h;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_hourly_aggregate_one_channel_ms=%s', round(v_ms, 1)), v_ms < 1000);

  -- 5. Whole-site monthly energy across every channel of the org under RLS
  t0 := clock_timestamp();
  PERFORM count(*) FROM (SELECT date_trunc('month', ts_end AT TIME ZONE 'Africa/Johannesburg'), sum(value) * 0.5 FROM solar.meter_readings WHERE organisation_id = v_org GROUP BY 1) m;
  v_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  INSERT INTO _r VALUES (format('rls_site_monthly_energy_%s_channels_ms=%s_extrapolated_%s_channels_ms=%s', v_bulk_channels + 1, round(v_ms),
                                v_full_bulk + 1, round(v_ms * (v_full_bulk + 1) / (v_bulk_channels + 1))),
                         v_ms * (v_full_bulk + 1) / (v_bulk_channels + 1) < 10000);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- 6. Size on disk (heap + indexes + TOAST of all partitions) and bytes per reading (the real count)
  SELECT count(*) INTO v_n FROM solar.meter_readings WHERE organisation_id = v_org;
  SELECT sum(pg_total_relation_size(i.inhrelid)) INTO v_bytes FROM pg_inherits i WHERE i.inhparent = 'solar.meter_readings'::regclass;
  INSERT INTO _r VALUES (format('partitions_total_bytes=%s_rows=%s_bytes_per_row=%s_extrapolated_%s_rows_bytes=%s', v_bytes, v_n,
                                round(v_bytes::numeric / v_n, 1), (v_full_bulk + 1) * v_rows_per_ch,
                                round(v_bytes::numeric / v_n * (v_full_bulk + 1) * v_rows_per_ch)),
                         v_n = v_total_rows);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
