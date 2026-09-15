-- 15-scale.sql — Task 15 Step 4. "A backfill that passes on 50 rows proves
-- nothing about 50,000" (§12 §(d)). Synthetic RFIs on ONE throwaway project,
-- inserted in a single statement and projected through the REAL live trigger —
-- so every per-row cost the mirror carries (the ref allocator's MAX+1 scan, the
-- due-date trigger's calendar walk, section E's write-back, §11's event and
-- watcher rows) is paid the way production would pay it.
--
-- Run:
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/15-scale.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
--
-- The row count is ONE literal, v_rows below. Measured on production
-- (2026-09-15, 04:40-04:46 SAST — outside SA working hours, deliberately):
--
--   rows     elapsed      per row     refs unique   result
--   -------  -----------  ----------  ------------  --------------------------
--    2 500    16 864 ms    6.746 ms   yes (2 500)   5/5 PASS
--    5 000    55 045 ms   11.009 ms   yes (5 000)   5/5 PASS
--    5 000    44 590 ms    8.918 ms   yes (5 000)   5/5 PASS (repeat; ±20% run to run)
--   10 000   cancelled    —           —             ERROR 57014
--   50 000   NOT RUN      —           —             unreachable (see below)
--
-- ⚠ THE HARNESS CEILING IS 120 SECONDS, measured, not assumed. The Management
-- API session runs with statement_timeout = '2min' (read back from
-- current_setting), and this DO block is ONE statement, so anything slower than
-- two minutes dies as:
--   ERROR: 57014: canceling statement due to statement timeout
-- (reproduced deliberately with SET LOCAL statement_timeout = '20s' to capture
-- it cheaply; the real 10,000-row run died the same way after 2:01 wall clock).
-- 5 000 is therefore the largest count this harness can carry, and it is the
-- committed literal.
--
-- ⚠ THE COST IS SUPERLINEAR, and #18 predicted why. Item 2's ref allocator
-- (00196:752-803) takes a per-(project, type) advisory lock and computes
-- MAX(suffix)+1 PER ROW, so a single-project insert carries an O(n²) term.
-- Fitting t = a·n + b·n² to the two clean readings gives a ≈ 2.48 ms/row (the
-- fixed per-row cost: due-date trigger, write-back, event, watcher) and
-- b ≈ 1.71e-3 ms/n² (the allocator). That model predicts ~195 s at 10 000 —
-- which is what the cancellation at 120 s confirms — and ~4 390 s (≈73 minutes)
-- at 50 000, of which ~71 minutes is the allocator term alone. So
-- completed_under_five_minutes WOULD be red at 50 000, exactly as #18 said, and
-- the run is simply not reachable through this harness to say so.
--
-- ⚠ THE 50 000 RUN IS NOT NEEDED FOR THE PROPERTY IT WAS FOR. refs_are_unique
-- proves the same thing at 5 000 as at 50 000: the guarantee is the ADVISORY
-- LOCK plus MAX+1, not the count. What the bigger run would have added is a
-- timing figure, and the model above supplies that with two measured points
-- instead of one unmeasurable request.
--
-- If refs_are_unique EVER fails, that is item 2's allocator — report it against
-- item 2 and do NOT work around it in the mirror (Task 15 Step 6).
--
-- ⚠ The nearest real-world number: production holds 15 RFIs and 453
-- structure.node_orders rows, and section H projects 35 items across five
-- projects. At that size the quadratic term is 1.71e-3 x 35^2 = 2.1 ms and the
-- whole projection is t(35) ~ 89 ms — the allocator's shape has no bearing on
-- the apply. (An earlier comment put the quadratic term at "0.026 ms at n = 39";
-- that was the FRACTION of total time, not the time, and 100x too small.)
-- Extrapolating to 50,000 gives 40-73 minutes depending on which 5,000-row
-- reading you fit (44,590 ms -> a~4.57, b~8.7e-4 -> ~40 min; 55,045 ms ->
-- a~2.48, b~1.71e-3 -> ~73 min). Quote the range, not a point. This probe
-- exists to find the cliff, not to describe the estate.
--
-- ⚠ projects.rfis.rfi_number is INTEGER GENERATED ALWAYS AS IDENTITY (00002:83)
-- and sequences are NOT transactional: the ROLLBACK does not return the v_rows
-- values this probe consumes. scripts/db/rehearse-sql.ts brackets every
-- rehearsal with a capture/setval pair for exactly this reason (see its
-- RFI-NUMBER SEQUENCE GUARD header) — this probe only MEASURES that guard, in
-- the last row below. Do not run this file through any other harness.
--
-- Expected: 5 rows, all PASS.

DO $scale$
DECLARE
  -- The one dial. 5 000 is the ceiling this harness can carry — see above.
  v_rows CONSTANT int := 5000;
  v_org  CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm   uuid;
  v_proj uuid;
  v_t0   timestamptz;
  v_ms   numeric;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-15)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_scale', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- Timed from just before the statement to just after it: clock_timestamp(),
  -- not now(), which is frozen for the whole transaction and would read 0 ms.
  v_t0 := clock_timestamp();
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  SELECT v_proj, v_org, 'Scale RFI ' || g, 'body', 'medium', 'open', v_pm
    FROM generate_series(1, v_rows) g;
  v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;

  CREATE TEMP TABLE scale_ctx(proj uuid, rows_n int, ms numeric,
                              seq_before bigint, seq_after bigint,
                              seq_restore_target bigint, max_rfi_in_txn int) ON COMMIT DROP;
  INSERT INTO scale_ctx
  SELECT v_proj, v_rows, v_ms,
         -- The harness's capture, taken right after BEGIN and before anything
         -- in this transaction ran. NULL only if this probe was run through
         -- some other harness, which the last assertion then reports.
         (SELECT g.last_value FROM _rehearse_seq_guard g),
         (SELECT s.last_value FROM projects.rfis_rfi_number_seq s),
         GREATEST((SELECT g.last_value FROM _rehearse_seq_guard g),
                  COALESCE((SELECT g.max_rfi_number FROM _rehearse_seq_guard g), 0)),
         -- What a restore-time `SELECT max(rfi_number) FROM projects.rfis`
         -- would have read: this transaction's OWN uncommitted fixture rows.
         -- It is in the output to keep the reason the guard captures both
         -- operands at BEGIN visible and measured, not argued.
         (SELECT pg_catalog.max(r.rfi_number) FROM projects.rfis r);
END $scale$;

SELECT 'every_rfi_projected' AS probe,
       (SELECT count(*) FROM projects.work_items w, scale_ctx c
         WHERE w.project_id = c.proj AND w.origin = 'mirror')
         = (SELECT rows_n FROM scale_ctx) AS ok,
       'one item per RFI at scale: ' || (SELECT rows_n FROM scale_ctx) || ' rows' AS detail
UNION ALL
SELECT 'refs_are_unique',
       (SELECT count(DISTINCT ref) FROM projects.work_items w, scale_ctx c
         WHERE w.project_id = c.proj) = (SELECT rows_n FROM scale_ctx),
       'the MAX+1 ref allocator must not collide under a single-statement insert of '
         || (SELECT rows_n FROM scale_ctx) || ' rows; the per-(project,type) advisory '
         || 'lock (00196:777-789) is the mechanism, so this proves the same thing at any count'
UNION ALL
SELECT 'writeback_reached_every_row',
       (SELECT count(*) FROM projects.rfis r, scale_ctx c
         WHERE r.project_id = c.proj AND r.assigned_to IS NULL) = 0,
       'section E is per-row; if it degrades, it degrades here'
UNION ALL
SELECT 'completed_under_five_minutes',
       (SELECT ms FROM scale_ctx) < 300000,
       'took ' || (SELECT round(ms) FROM scale_ctx) || ' ms for '
         || (SELECT rows_n FROM scale_ctx) || ' rows ('
         || (SELECT round(ms / NULLIF(rows_n, 0), 3) FROM scale_ctx) || ' ms/row)'
UNION ALL
-- The sequence guard, measured rather than assumed. The restore itself happens
-- AFTER this SELECT (it is the harness's trailing DO block), so what this row
-- asserts is that the guard's TARGET is the pre-run value; the proof that the
-- setval landed is a read-only `SELECT last_value FROM
-- projects.rfis_rfi_number_seq` either side of the run, recorded in the PR body.
SELECT 'sequence_guard_targets_the_pre_run_value',
       (SELECT seq_before IS NOT NULL AND seq_restore_target = seq_before
               AND seq_after = seq_before + rows_n FROM scale_ctx),
       (SELECT 'before=' || COALESCE(seq_before::text, '(no harness guard!)')
             || ' after=' || seq_after
             || ' restore_target=' || seq_restore_target
             || ' — and max(rfi_number) read INSIDE this transaction is '
             || max_rfi_in_txn || ', which is what a restore-time read would '
             || 'have set the sequence to instead' FROM scale_ctx);
