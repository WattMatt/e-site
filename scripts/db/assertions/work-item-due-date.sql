-- Assertions for 00196 §5 (add_working_days, push_past_builders_shutdown, the
-- BEFORE INSERT due-date trigger). Run inside the rolled-back transaction opened
-- by try-work-item-spine.sh.
--
-- FIXED DATES, never now(): a test on today's date could pass in June and fail
-- in December. The only now()-relative arms are 9 and 10 (the trigger's
-- no-date path), and they compare two computed dates against each other with
-- builders_holiday OFF so the season cannot collapse them onto one January day.
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_id uuid; n int; d_a date; d_b date;
        v_d date;  -- NOT `d`: a PL/pgSQL variable named d makes the prelude's
                   -- `ON CONFLICT (d)` ambiguous (42702) against public_holidays.d
BEGIN
  -- 0. add_working_days must be OURS. If item 1's lane already shipped one,
  --    stop and reconcile rather than silently redefining it.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
   WHERE nsp.nspname='projects' AND p.proname='add_working_days';
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 projects.add_working_days, found %', n; END IF;

  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);

  -- Seed the years these assertions walk, so the test is about the ARITHMETIC
  -- and not about which years production happens to hold. Rolled back with
  -- everything else. 2026/2027 are the fixed-date assertions; the CURRENT year
  -- and the next are for the trigger assertions at the bottom.
  INSERT INTO projects.calendar_years (year) VALUES (2026),(2027) ON CONFLICT DO NOTHING;
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;
  INSERT INTO projects.public_holidays (d, name) VALUES
    (DATE '2026-12-16','Day of Reconciliation'), (DATE '2026-12-25','Christmas Day'),
    (DATE '2026-12-26','Day of Goodwill'),       (DATE '2027-01-01','New Year''s Day')
  ON CONFLICT (d) DO NOTHING;

  -- 1. OFFICE calendar skips the weekend. Fri 2026-06-05 + 3 wd = Wed 2026-06-10.
  v_d := projects.add_working_days(DATE '2026-06-05', 3, v_proj, 'office');
  IF v_d <> DATE '2026-06-10' THEN RAISE EXCEPTION 'office +3wd from Fri 5 Jun 2026 = %, expected 2026-06-10', v_d; END IF;

  -- 2. SITE calendar works Saturday, so the same walk lands a day earlier.
  v_d := projects.add_working_days(DATE '2026-06-05', 3, v_proj, 'site');
  IF v_d <> DATE '2026-06-09' THEN RAISE EXCEPTION 'site +3wd from Fri 5 Jun 2026 = %, expected 2026-06-09', v_d; END IF;

  -- 3. Sunday is never a working day on either calendar.
  IF EXTRACT(ISODOW FROM projects.add_working_days(DATE '2026-06-06', 1, v_proj, 'site')) = 7
  THEN RAISE EXCEPTION 'site calendar counted a Sunday'; END IF;

  -- 4. A seeded public holiday is skipped. Tue 2026-12-15 + 1 wd must clear
  --    Wed 16 Dec (Day of Reconciliation) and land Thu 17 Dec.
  v_d := projects.add_working_days(DATE '2026-12-15', 1, v_proj, 'office');
  IF v_d <> DATE '2026-12-17' THEN RAISE EXCEPTION 'holiday not skipped: got %', v_d; END IF;

  -- 5. AN UNSEEDED YEAR RAISES. A(h) forbids a calendar-day fallback outright,
  --    because a silent one-day drift changes whether an item escalates.
  DELETE FROM projects.calendar_years WHERE year = 2031;
  BEGIN
    PERFORM projects.add_working_days(DATE '2031-03-01', 5, v_proj, 'office');
    RAISE EXCEPTION 'add_working_days silently computed against an unseeded year';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- 6. p_days = 0 is REFUSED. Accepting it would return p_from unchanged even
  --    when p_from is a Sunday or a public holiday — a non-working day handed
  --    back with no error.
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-07', 0, v_proj, 'office');
    RAISE EXCEPTION 'add_working_days accepted p_days = 0 and returned a Sunday';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 7. An empty working_days array raises rather than looping forever — on BOTH
  --    calendars. The site arm appends Saturday, so a check placed after that
  --    append would silently turn an empty array into a Saturday-only calendar
  --    and this assertion is the only thing that catches it.
  UPDATE projects.project_settings SET working_days = ARRAY[]::int[] WHERE project_id = v_proj;
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-05', 1, v_proj, 'office');
    RAISE EXCEPTION 'an empty working_days array did not raise on the office calendar';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-05', 1, v_proj, 'site');
    RAISE EXCEPTION 'an empty working_days array did not raise on the SITE calendar';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE projects.project_settings SET working_days = ARRAY[1,2,3,4,5] WHERE project_id = v_proj;

  -- 8. THE DECEMBER SHUTDOWN. A due date inside 15 Dec - 15 Jan is pushed to the
  --    first SITE working day after the window. Fri 2027-01-15 + 1 site working
  --    day is SAT 2027-01-16 — the site calendar works Saturdays, which is the
  --    whole point of A(h)'s two calendars.
  UPDATE projects.project_settings
     SET builders_holiday = true, builders_shutdown_start_md='12-15', builders_shutdown_end_md='01-15'
   WHERE project_id = v_proj;
  v_d := projects.push_past_builders_shutdown(DATE '2026-12-20', v_proj);
  IF v_d <> DATE '2027-01-16' THEN RAISE EXCEPTION 'a 20 Dec due date was pushed to % — expected Sat 2027-01-16', v_d; END IF;
  -- A January date inside the window is pushed by the PREVIOUS year's band.
  IF projects.push_past_builders_shutdown(DATE '2027-01-05', v_proj) <> DATE '2027-01-16'
  THEN RAISE EXCEPTION '5 Jan was not recognised as inside the previous December''s band'; END IF;
  -- A date outside the window is untouched.
  IF projects.push_past_builders_shutdown(DATE '2026-06-10', v_proj) <> DATE '2026-06-10'
  THEN RAISE EXCEPTION 'a June date was pushed'; END IF;
  -- builders_holiday = false disables it entirely, and it STAYS false for the
  -- trigger assertions below. Leaving it on would make assertions 9 and 10
  -- season-dependent: run in December, a 5-working-day and a 1-working-day
  -- offset both land inside the shutdown and get pushed to the SAME January
  -- date, so `d_b < d_a` would fail in December and pass in June — the exact
  -- fixture failure this plan's rule is written against.
  UPDATE projects.project_settings SET builders_holiday = false WHERE project_id = v_proj;
  IF projects.push_past_builders_shutdown(DATE '2026-12-20', v_proj) <> DATE '2026-12-20'
  THEN RAISE EXCEPTION 'the push ran with builders_holiday = false'; END IF;

  -- 9. THE TRIGGER. An insert that passes NO date gets one — that is the §03 §1.5
  --    "path that passed no date at all" case, and due_date NOT NULL always holds.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'no date supplied', v_pm, v_pm, v_pm) RETURNING id INTO v_id;
  SELECT due_date INTO d_a FROM projects.work_items WHERE id = v_id;
  IF d_a IS NULL OR d_a <= CURRENT_DATE THEN RAISE EXCEPTION 'trigger did not compute a future due_date: %', d_a; END IF;

  -- 10. The per-project override in work_item_defaults beats the registry default.
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('task',
           jsonb_build_object('days_to_respond', 1, 'triage_owner_id', NULL, 'gatekeeper_id', NULL))
   WHERE project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'one day', v_pm, v_pm, v_pm) RETURNING id INTO v_id;
  SELECT due_date INTO d_b FROM projects.work_items WHERE id = v_id;
  IF d_b >= d_a THEN
    RAISE EXCEPTION 'work_item_defaults.days_to_respond did not override the registry default (% vs %)', d_b, d_a;
  END IF;

  -- 11. A SUPPLIED due date is respected...
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, due_date)
  VALUES (v_org, v_proj, 'task', 'supplied date', v_pm, v_pm, v_pm, DATE '2026-06-10')
  RETURNING id INTO v_id;
  IF (SELECT due_date FROM projects.work_items WHERE id=v_id) <> DATE '2026-06-10'
  THEN RAISE EXCEPTION 'a supplied due_date was overwritten'; END IF;

  -- 11b. ...and is STILL pushed past the shutdown. The point of the push is that
  --      nobody is on site to do the work, which is true however the date arrived.
  UPDATE projects.project_settings SET builders_holiday = true WHERE project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, due_date)
  VALUES (v_org, v_proj, 'task', 'supplied shutdown date', v_pm, v_pm, v_pm, DATE '2026-12-20')
  RETURNING id INTO v_id;
  IF (SELECT due_date FROM projects.work_items WHERE id=v_id) <> DATE '2027-01-16'
  THEN RAISE EXCEPTION 'a supplied 20 Dec due date was not pushed to Sat 2027-01-16, got %',
       (SELECT due_date FROM projects.work_items WHERE id=v_id); END IF;
  UPDATE projects.project_settings SET builders_holiday = false WHERE project_id = v_proj;

  -- 12. An unregistered item_type is refused before any row exists, with an
  --     error that NAMES the type. MEASURED (rolled-back probe, 2026-09-12): a
  --     BEFORE ROW trigger fires before referential integrity, so it is the
  --     due-date trigger's own P0001 ('There is no work-item type called
  --     "not_a_type". Pick one of the registered types.') that a client sees —
  --     the FK to work_item_types(key) never gets its turn. That copy is the
  --     point (improvement 11); a 23503 from the FK is accepted too, in case a
  --     later BEFORE trigger chooses to pass an unknown type through.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'not_a_type', 'bogus', v_pm, v_pm, v_pm);
    RAISE EXCEPTION 'an unregistered item_type was accepted';
  EXCEPTION WHEN raise_exception OR foreign_key_violation THEN
    IF SQLERRM = 'an unregistered item_type was accepted' THEN RAISE; END IF;
    IF position('not_a_type' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'an unregistered item_type was refused without naming it: %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'work-item-due-date: 14/14 assertions passed';
END $$;
