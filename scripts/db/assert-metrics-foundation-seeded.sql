-- SEEDED assertions for the Q1 metrics/presence/calendar migration.
--
-- ⚠ THIS FILE WRITES ROWS. It must ONLY ever be run inside a transaction that
-- rolls back — scripts/db/dry-run-migration.sh wraps it, and the smoke test
-- runs it inside its own BEGIN … ROLLBACK. Never run it read-only against
-- production.
--
-- Everything that reads only applied structure belongs in
-- assert-metrics-foundation-static.sql instead, so that file can run
-- read-only after the apply.
--
-- MUST end in exactly one statement returning (check text, ok boolean).

SELECT 'seeded assertions file is reachable' AS check, true AS ok
;
