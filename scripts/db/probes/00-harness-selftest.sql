-- Self-test for scripts/db/rehearse-sql.ts — the smallest probe that obeys the
-- contract every file in this directory is held to:
--
--   1. zero or more DO $…$ … END $…$; blocks that build fixtures, mutate, and
--      record observations into TEMP TABLE … ON COMMIT DROP; then
--   2. EXACTLY ONE row-producing statement — a SELECT … UNION ALL … with the
--      columns (probe text, ok boolean, detail text) — and it is the LAST
--      statement in the file (the Management API returns rows from the last
--      row-producing statement only);
--   3. a probe that impersonates ends its impersonating block with
--      EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true);
--      and asserts auth.uid() IS NULL afterwards.
--
-- Run:  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/00-harness-selftest.sql
-- Expected: PASS  harness  expected true  /  1/1 assertions passed  (exit 0).
-- It was first run with (1 = 2) and watched to fail — FAIL / 0/1 / exit 1 —
-- before this predicate was flipped, so the harness has been seen to fail.
SELECT 'harness'         AS probe,
       (1 = 1)           AS ok,
       'expected true'   AS detail;
