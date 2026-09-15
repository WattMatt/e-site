-- assert-diary-update-member-contractor.sql — subject B for migration 00200.
--
-- The same `rbac-test` contractor fixture, now on (643) KINGSWALK, where it
-- DOES hold an active project membership with effective role `contractor`.
-- Two questions this file answers that subject A cannot:
--
--   * being a project member must not admit them to a COLLEAGUE's entry
--     (1-2) — membership is not authorship and is not a write role;
--   * the author arm must stay OPEN (3-4). This is not a nicety: of the 57
--     diary entries on production, 43 were authored by someone holding NO
--     write role on the project (measured 2026-09-15). A gate of
--     ORG_WRITE_ROLES alone would take their own contemporaneous record away
--     from three quarters of the people who wrote one, so 3 and 4 must be
--     green BEFORE the migration as well as after — they are the regression
--     half of the pair, not the fix half.
--
-- Run through scripts/db/dry-run-migration.sh (BEGIN; migration; this file;
-- ROLLBACK). Nothing persists — including the entry seeded at 3.
--
-- Red/green against a no-op migration: 1, 2 and 5 fail; 3 and 4 pass.
-- Against 00200 all five pass.
--
-- ⚠ The fixture's own entry is seeded as postgres BEFORE the first
-- impersonation. set_config('request.jwt.claims', …, true) is
-- TRANSACTION-local and outlives RESET ROLE, so a row seeded afterwards would
-- carry a claim this file never intended to set.

SELECT set_config('x.fixture',   '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);  -- rbac-test@e-site.live
SELECT set_config('x.kingswalk', '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK — fixture IS a member
SELECT set_config('x.mamaila',   'dbcfb404-0753-4042-85a1-020cbfacafca', true);  -- (657) MAMAILA PHASE 2 — fixture is NOT

-- Two KINGSWALK entries by OTHER authors, plus one seeded entry the fixture
-- itself authors.
SELECT set_config('x.e_other1', (SELECT e.id::text FROM projects.site_diary_entries e
                                  WHERE e.project_id = current_setting('x.kingswalk')::uuid
                                    AND e.created_by <> current_setting('x.fixture')::uuid
                                  ORDER BY e.created_at, e.id LIMIT 1 OFFSET 0), true);
SELECT set_config('x.e_other2', (SELECT e.id::text FROM projects.site_diary_entries e
                                  WHERE e.project_id = current_setting('x.kingswalk')::uuid
                                    AND e.created_by <> current_setting('x.fixture')::uuid
                                  ORDER BY e.created_at, e.id LIMIT 1 OFFSET 1), true);

INSERT INTO projects.site_diary_entries
  (project_id, organisation_id, entry_date, entry_type, progress_notes, created_by)
SELECT p.id, p.organisation_id, CURRENT_DATE, 'progress',
       'seeded by assert-diary-update-member-contractor.sql — rolled back',
       current_setting('x.fixture')::uuid
  FROM projects.projects p WHERE p.id = current_setting('x.kingswalk')::uuid
RETURNING set_config('x.e_own', id::text, true);

DO $$
BEGIN
  IF current_setting('x.e_other1', true) IS NULL OR current_setting('x.e_other2', true) IS NULL THEN
    RAISE EXCEPTION 'KINGSWALK has fewer than two diary entries by authors other than the fixture — 1 and 2 would be vacuous';
  END IF;
  IF current_setting('x.e_own', true) IS NULL THEN
    RAISE EXCEPTION 'the fixture''s own entry was not seeded — 3 and 4 would be vacuous';
  END IF;
  IF public.user_effective_project_role(current_setting('x.kingswalk')::uuid,
                                        current_setting('x.fixture')::uuid) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'the fixture''s effective role on KINGSWALK is % rather than contractor — this file assumes a member WITHOUT a write role',
      public.user_effective_project_role(current_setting('x.kingswalk')::uuid, current_setting('x.fixture')::uuid);
  END IF;
  IF public.user_effective_project_role(current_setting('x.mamaila')::uuid,
                                        current_setting('x.fixture')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'the fixture now has a role on MAMAILA — probe 5 (moving their OWN entry to a project they are not on) would be testing nothing';
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.fixture'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 1. A colleague's entry, on a project the fixture IS a member of.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET progress_notes = 'PWNED', safety_notes = 'PWNED'
     WHERE id = current_setting('x.e_other1')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_other_rewrite',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_other_rewrite', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 2. …and moving it off the project entirely.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.mamaila')::uuid
     WHERE id = current_setting('x.e_other2')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_other_move',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_other_move', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 3. THE AUTHOR ARM. Correcting your own entry must keep working for a
--    contractor. Green before AND after.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET progress_notes = 'corrected by the author', workers_on_site = 7
     WHERE id = current_setting('x.e_own')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_own',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_own', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 4. …and so must deleting it (00149's author arm, untouched by 00200).
DO $$
DECLARE n int;
BEGIN
  BEGIN
    DELETE FROM projects.site_diary_entries WHERE id = current_setting('x.e_own')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_own_delete',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows)' ELSE 'DELETED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_own_delete', 'BLOCKED (42501)', true);
  END;
END $$;

-- 5. The residual the author arm could otherwise carry: relocating YOUR OWN
--    entry onto a project you are not on. Closed because 00200's predicate
--    requires an effective role on the project named by the NEW row, not just
--    authorship of it. Seeded fresh — 4 deleted the first one.
INSERT INTO projects.site_diary_entries
  (project_id, organisation_id, entry_date, entry_type, progress_notes, created_by)
SELECT current_setting('x.kingswalk')::uuid,
       (SELECT p.organisation_id FROM projects.projects p WHERE p.id = current_setting('x.kingswalk')::uuid),
       CURRENT_DATE, 'progress', 'seeded for probe 5 — rolled back', auth.uid()
RETURNING set_config('x.e_own2', id::text, true);

DO $$
DECLARE n int;
BEGIN
  IF current_setting('x.e_own2', true) IS NULL THEN
    RAISE EXCEPTION 'probe 5''s entry was not seeded — the fixture could not INSERT its own diary entry, which 00200 does not touch';
  END IF;
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.mamaila')::uuid
     WHERE id = current_setting('x.e_own2')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_own_move',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_own_move', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

SELECT * FROM (VALUES
  ('member contractor: REWRITE a colleague''s KINGSWALK entry -> ' || current_setting('x.r_other_rewrite'),
     current_setting('x.r_other_rewrite') LIKE 'BLOCKED%'),
  ('member contractor: MOVE a colleague''s KINGSWALK entry to another project -> ' || current_setting('x.r_other_move'),
     current_setting('x.r_other_move') LIKE 'BLOCKED%'),
  ('member contractor: correct THEIR OWN entry -> ' || current_setting('x.r_own') || ' (must stay allowed)',
     current_setting('x.r_own') LIKE 'ACCEPTED%'),
  ('member contractor: delete THEIR OWN entry (00149, untouched) -> ' || current_setting('x.r_own_delete') || ' (must stay allowed)',
     current_setting('x.r_own_delete') LIKE 'DELETED%'),
  ('member contractor: move THEIR OWN entry onto a project they are not on -> ' || current_setting('x.r_own_move'),
     current_setting('x.r_own_move') LIKE 'BLOCKED%')
) AS t("check", ok);
