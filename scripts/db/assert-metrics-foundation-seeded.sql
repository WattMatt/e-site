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

-- Exercise the writer against a real project and a real member, inside the
-- rolled-back transaction. Picks an ACTIVE member whose effective role
-- resolves, so the role stamp is a real role and not a null. 13 of the 14
-- live projects have at least one project_manager membership (measured
-- 2026-09-10); all 47 memberships resolve a role (measured 2026-09-11).
--
-- The row is TAGGED (properties.seeded_by) so the arm below counts only the
-- row this file wrote. After the real apply the live table holds genuine
-- rfi_created rows (15 RFIs exist today), and an untagged `event =
-- 'rfi_created'` count would drift away from 1 the first time the smoke test
-- runs against production.
SELECT public.emit_product_event(
         pm.user_id, pm.project_id, 'rfi_created',
         jsonb_build_object('assignee_source','none','seeded_by','assert-metrics-foundation-seeded'),
         NULL, NULL)
  FROM projects.project_members pm
 WHERE pm.is_active
   AND public.user_effective_project_role(pm.project_id, pm.user_id) IS NOT NULL
 ORDER BY pm.project_id, pm.user_id
 LIMIT 1;

SELECT 'seeded assertions file is reachable' AS check, true AS ok
UNION ALL
SELECT 'emit_product_event stamps effective_role at write time',
       (SELECT count(*) = 1 FROM public.product_events pe
         WHERE pe.properties->>'seeded_by' = 'assert-metrics-foundation-seeded'
           AND pe.effective_role IS NOT NULL
           AND pe.organisation_id IS NOT NULL)
;
