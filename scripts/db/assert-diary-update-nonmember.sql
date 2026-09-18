-- assert-diary-update-nonmember.sql — subject A for migration 00203.
--
-- THE HEADLINE HOLE. `projects.site_diary_entries`' UPDATE policy
-- "Org members can update diary entries" (00145:39-50) qualifies on
-- ORG membership, not on the project and not on the author:
--
--     organisation_id = ANY(public.get_user_org_ids())
--     AND NOT public.user_is_client_viewer(organisation_id)
--     AND NOT EXISTS (… p.status = 'payment_paused')
--
-- so any active non-client-viewer member of the org may rewrite EVERY column
-- of EVERY diary entry in that org — including entries on projects they have
-- never been a member of. This file acts as the `rbac-test` contractor
-- fixture (018f2d31-…, contractor on WM-Consulting, project member of
-- KINGSWALK and NOTHING else) against (657) MAMAILA PHASE 2, where
-- public.user_effective_project_role() returns NULL for them.
--
-- Run through scripts/db/dry-run-migration.sh, which wraps this file as
--   BEGIN; <migration>; <this file>; ROLLBACK;
-- so nothing here persists: every write below lands on real production rows
-- inside a transaction that is rolled back whether the assertions pass or
-- fail, and the file is the only thing in that transaction.
--
-- Red/green: run it first against a no-op migration and watch rows 1-5 fail —
-- that is the leak. Against 00203 every row must be ok.
--
-- ⚠ Each probe targets a DIFFERENT entry (ordinals 0-3 of MAMAILA's 30). A
-- probe that SUCCEEDS mutates its target inside the transaction, so sharing
-- one row between probes would leave later probes reasoning about a row an
-- earlier probe had already moved.
--
-- ⚠ Only `insufficient_privilege` is caught. A WITH CHECK violation raises
-- 42501; a USING refusal is a silent zero-row UPDATE; anything else (an FK
-- violation, a trigger) is a different failure mode and is allowed to abort
-- the file, which dry-run-migration.sh reports as a failure rather than
-- quietly counting as "blocked".

SELECT set_config('x.fixture',  '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);  -- rbac-test@e-site.live
SELECT set_config('x.mamaila',  'dbcfb404-0753-4042-85a1-020cbfacafca', true);  -- (657) MAMAILA PHASE 2 — fixture is NOT a member
SELECT set_config('x.watermeyer','e2041c18-29b5-4039-8afc-659de267fa1d', true); -- (650) WATERMEYER — same org, move target
SELECT set_config('x.foreign_project', 'e51ede00-0000-0000-0002-000000000001', true); -- Sandton City (Demo) — ANOTHER org

-- Four distinct MAMAILA entries, captured as postgres before any
-- impersonation. Under the fixture's role these SELECTs would still succeed
-- (the org-wide SELECT policy is just as wide), but capturing as postgres
-- keeps the probe honest about what it is testing: the WRITE gate.
SELECT set_config('x.e_move',    (SELECT e.id::text FROM projects.site_diary_entries e
                                   WHERE e.project_id = current_setting('x.mamaila')::uuid
                                   ORDER BY e.created_at, e.id LIMIT 1 OFFSET 0), true);
SELECT set_config('x.e_org',     (SELECT e.id::text FROM projects.site_diary_entries e
                                   WHERE e.project_id = current_setting('x.mamaila')::uuid
                                   ORDER BY e.created_at, e.id LIMIT 1 OFFSET 1), true);
SELECT set_config('x.e_rewrite', (SELECT e.id::text FROM projects.site_diary_entries e
                                   WHERE e.project_id = current_setting('x.mamaila')::uuid
                                   ORDER BY e.created_at, e.id LIMIT 1 OFFSET 2), true);
SELECT set_config('x.e_author',  (SELECT e.id::text FROM projects.site_diary_entries e
                                   WHERE e.project_id = current_setting('x.mamaila')::uuid
                                   ORDER BY e.created_at, e.id LIMIT 1 OFFSET 3), true);

-- Preconditions. Each one is a way this file could pass for the wrong reason,
-- so each RAISEs rather than letting the run print green on nothing.
DO $$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['x.e_move','x.e_org','x.e_rewrite','x.e_author'] LOOP
    IF current_setting(k, true) IS NULL OR current_setting(k, true) = '' THEN
      RAISE EXCEPTION 'MAMAILA has fewer than four diary entries — % is NULL and its probe would be vacuous', k;
    END IF;
  END LOOP;

  IF public.user_effective_project_role(current_setting('x.mamaila')::uuid,
                                        current_setting('x.fixture')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'the fixture now has effective role % on MAMAILA — this file asserts the NON-member case and no longer does',
      public.user_effective_project_role(current_setting('x.mamaila')::uuid, current_setting('x.fixture')::uuid);
  END IF;

  IF EXISTS (SELECT 1 FROM projects.site_diary_entries e
              WHERE e.id IN (current_setting('x.e_move')::uuid, current_setting('x.e_org')::uuid,
                             current_setting('x.e_rewrite')::uuid, current_setting('x.e_author')::uuid)
                AND e.created_by = current_setting('x.fixture')::uuid) THEN
    RAISE EXCEPTION 'one of the four target entries is authored BY the fixture — the author arm would admit them and the probe would test nothing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = current_setting('x.fixture')::uuid
                    AND uo.organisation_id = (SELECT e.organisation_id FROM projects.site_diary_entries e
                                               WHERE e.id = current_setting('x.e_move')::uuid)
                    AND uo.is_active) THEN
    RAISE EXCEPTION 'the fixture is not an active member of the entries'' organisation — 00145''s permissive policy would deny every probe for the wrong reason';
  END IF;

  IF (SELECT p.organisation_id FROM projects.projects p WHERE p.id = current_setting('x.foreign_project')::uuid)
     = (SELECT e.organisation_id FROM projects.site_diary_entries e WHERE e.id = current_setting('x.e_org')::uuid) THEN
    RAISE EXCEPTION 'the "foreign" project is in the same organisation as the entry — probe 2 would not decouple anything';
  END IF;
END $$;

-- Impersonate exactly as PostgREST does.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.fixture'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 1. MOVE another author's entry to a different project (same org).
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.watermeyer')::uuid
     WHERE id = current_setting('x.e_move')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_move',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_move', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 2. DECOUPLE the entry from its organisation by pointing project_id at a
--    project in ANOTHER org while leaving organisation_id on WM-Consulting.
--    Setting organisation_id itself is already bounded by 00145's
--    `= ANY(get_user_org_ids())` and the fixture belongs to exactly one org,
--    so THIS is the form the org/project decoupling actually takes.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.foreign_project')::uuid
     WHERE id = current_setting('x.e_org')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_org',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_org', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 3. REWRITE the substance of a safety record on a project they are not on.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET progress_notes = 'PWNED', safety_notes = 'PWNED', delays = 'None',
           delay_notes = NULL, workers_on_site = 0, entry_date = DATE '2000-01-01'
     WHERE id = current_setting('x.e_rewrite')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_rewrite',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_rewrite', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 4. RE-ATTRIBUTE authorship, then 5. DELETE — the 00149 bypass.
--    00149 deliberately scoped DELETE to `created_by = auth.uid()` so that a
--    contractor could not delete a colleague's entry over PostgREST. With an
--    unrestricted UPDATE that gate costs one statement: claim the entry, then
--    delete it as its "author". 4 and 5 are the same chain, in order.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET created_by = current_setting('x.fixture')::uuid
     WHERE id = current_setting('x.e_author')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_author',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_author', 'BLOCKED (42501 — WITH CHECK)', true);
  END;

  BEGIN
    DELETE FROM projects.site_diary_entries WHERE id = current_setting('x.e_author')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_delete',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows)' ELSE 'DELETED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_delete', 'BLOCKED (42501)', true);
  END;
END $$;

SELECT * FROM (VALUES
  ('non-member contractor: MOVE another author''s entry to another project -> ' || current_setting('x.r_move'),
     current_setting('x.r_move') LIKE 'BLOCKED%'),
  ('non-member contractor: POINT project_id at a FOREIGN-ORG project -> ' || current_setting('x.r_org'),
     current_setting('x.r_org') LIKE 'BLOCKED%'),
  ('non-member contractor: REWRITE notes/date/workers of another author''s entry -> ' || current_setting('x.r_rewrite'),
     current_setting('x.r_rewrite') LIKE 'BLOCKED%'),
  ('non-member contractor: RE-ATTRIBUTE created_by to self -> ' || current_setting('x.r_author'),
     current_setting('x.r_author') LIKE 'BLOCKED%'),
  ('non-member contractor: then DELETE it as its "author" (the 00149 bypass) -> ' || current_setting('x.r_delete'),
     current_setting('x.r_delete') LIKE 'BLOCKED%'),
  ('ground truth: the fixture has NO effective role on MAMAILA (probe is not vacuous)',
     public.user_effective_project_role(current_setting('x.mamaila')::uuid) IS NULL),
  ('ground truth: the fixture can still READ MAMAILA diary entries (SELECT untouched)',
     (SELECT count(*) FROM projects.site_diary_entries
       WHERE project_id = current_setting('x.mamaila')::uuid) > 0)
) AS t("check", ok);
