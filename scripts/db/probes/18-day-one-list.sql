-- 18-day-one-list.sql — Task 17 Step 6, improvement 3. A count is not a
-- distribution, and the only property an inbox has is WHOSE it is. This prints
-- every backfilled item as one line a human can read, ordered by holder, so the
-- owner can see the day-one estate before any of it is irreversible.
--
-- It is not an assertion file in the usual sense: the artefact is the `detail`
-- column, and it goes in the PR body and in front of the owner in Task 19. It
-- still ends in the (probe, ok, detail) shape rehearse-sql.ts requires, so it
-- runs on the same harness as every other probe — and `ok` is not a constant:
-- it is FALSE for any item whose holder is a client viewer, is deactivated, or
-- has no effective role on the item's project. All three should be impossible
-- (improvement 7 gates the chain on work_item_person_eligible), so if one of
-- these rows ever reds, the row itself names the person and the project.
--
-- Run:
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/18-day-one-list.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
--
-- The fixture file is stacked for consistency with probes 13/14/17 — its two
-- '_probe_%' projects are excluded below, so it changes nothing here; stacking
-- it keeps ONE --with line for every rehearsal in this task.
--
-- ⚠ Read every line, not the tally. Measured 2026-09-15, the live RFI subjects
-- include `Cable Schedule ` twice and `Inquiry for Mains 2.1 and Mains 3.1`
-- twice, plus a bare `Inquiry` and a bare `Drawings`: four of the eight open
-- RFIs are indistinguishable by title alone. That is why this listing carries
-- `ref` and the project name, and it is a FINDING FOR ITEM 4 — the Inbox row
-- and the 07:00 recap line must render ref + project (+ raiser) beside the
-- title, or a person cannot tell two of their own items apart.
--
-- Expected: 35 `item` rows + one `holder` row per distinct holder + `no_holder`
-- + `total`, all PASS. The 35 are 15 rfi + 19 inspection + 1 form_action; the
-- 6 closed RFIs arrive closed and hold no ball, so 29 of the 35 land in an
-- inbox on day one.

WITH item AS (
  SELECT w.id,
         w.ref,
         w.item_type,
         w.status,
         w.due_date,
         p.name                                                      AS project,
         w.title,
         w.ball_in_court_id                                          AS holder_id,
         COALESCE(holder.full_name, holder.email, w.ball_in_court_id::text) AS holder,
         public.user_effective_project_role(w.project_id, w.ball_in_court_id) AS holder_role,
         COALESCE(gate.full_name, gate.email, '—')                   AS gatekeeper
    FROM projects.work_items w
    JOIN projects.projects p           ON p.id = w.project_id
    LEFT JOIN public.profiles holder   ON holder.id = w.ball_in_court_id
    LEFT JOIN public.profiles gate     ON gate.id = w.gatekeeper_id
   WHERE w.origin = 'mirror'
     AND p.name NOT LIKE '\_probe\_%'
), flagged AS (
  SELECT i.*,
         CASE
           WHEN i.holder_id IS NULL             THEN NULL
           WHEN i.holder_role IS NULL           THEN '⚠ NO ROLE ON PROJECT (departed or deactivated)'
           WHEN i.holder_role = 'client_viewer' THEN '⚠ CLIENT VIEWER'
         END AS flag
    FROM item i
), tally AS (
  SELECT COALESCE(holder, '(no holder)') AS holder, count(*) AS n,
         count(*) FILTER (WHERE holder_id IS NULL) AS unheld
    FROM flagged GROUP BY 1
)
SELECT probe, ok, detail FROM (
  -- ── one line per backfilled item, ordered by holder ──────────────────────
  SELECT 0 AS grp,
         COALESCE(f.holder, 'zzz') AS s1, f.due_date AS s2, f.ref AS s3,
         'item' AS probe,
         f.flag IS NULL AS ok,
         rpad(f.ref, 13)                                      || ' ' ||
         rpad(f.item_type, 11)                                || ' ' ||
         rpad(left(f.project, 26), 27)                        || ' ' ||
         rpad(f.status, 9)                                    || ' ' ||
         rpad(COALESCE(to_char(f.due_date, 'YYYY-MM-DD'), '—'), 11) || ' ' ||
         rpad(COALESCE(left(f.holder, 18), '—'), 19)          || ' ' ||
         rpad(left(f.gatekeeper, 18), 19)                     || ' ' ||
         left(f.title, 58)
         || COALESCE('   ' || f.flag, '')                     AS detail
    FROM flagged f
  UNION ALL
  -- ── the holder → count table, computed here rather than tallied by hand ──
  SELECT 1, t.holder, NULL, NULL,
         CASE WHEN t.unheld > 0 THEN 'no_holder' ELSE 'holder' END,
         true,
         rpad(t.holder, 24) || lpad(t.n::text, 3) || ' item' || CASE WHEN t.n = 1 THEN '' ELSE 's' END
           || CASE WHEN t.unheld > 0 THEN ' — closed on arrival, in nobody''s inbox' ELSE '' END
    FROM tally t
  UNION ALL
  SELECT 2, NULL, NULL, NULL, 'total', true,
         (SELECT count(*)::text FROM flagged) || ' backfilled items, '
         || (SELECT count(*)::text FROM flagged WHERE holder_id IS NOT NULL) || ' of them carrying a ball on day one, across '
         || (SELECT count(DISTINCT holder)::text FROM flagged WHERE holder_id IS NOT NULL) || ' holders and '
         || (SELECT count(DISTINCT project)::text FROM flagged) || ' projects'
) x
ORDER BY grp, s1 NULLS LAST, s2 NULLS LAST, s3 NULLS LAST;
