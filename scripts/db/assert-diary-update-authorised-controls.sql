-- assert-diary-update-authorised-controls.sql — subject C for migration 00200.
--
-- The other half of the pair. Subjects A and B prove the gate CLOSES; this
-- file proves it does not close on the people it is meant to admit, and that
-- the new WITH CHECK computes the project's organisation rather than simply
-- refusing every UPDATE. Without it a migration that denied ALL diary updates
-- would show green across A and B.
--
-- Subject: the OLDEST active owner/admin of the organisation that holds the
-- entries — derived, not named, so the file does not rot when staff change and
-- so no individual is hard-coded into the repo. Their authority comes from
-- 00107 clause 1 (an org owner/admin/PM wins on every project in the org), so
-- 1 and 2 hold whether or not they are a member of the project.
--
-- Run through scripts/db/dry-run-migration.sh (BEGIN; migration; this file;
-- ROLLBACK). Nothing persists.
--
-- Red/green against a no-op migration: 1, 2 and 4 pass (they are regression
-- guards, green on both sides); 3 fails — an org admin can currently point a
-- diary entry at a project in an organisation they have nothing to do with,
-- leaving a row whose organisation_id disagrees with its project's. Against
-- 00200 all four pass.

SELECT set_config('x.kingswalk', '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK
SELECT set_config('x.watermeyer','e2041c18-29b5-4039-8afc-659de267fa1d', true);  -- (650) WATERMEYER — same org
SELECT set_config('x.foreign_project', 'e51ede00-0000-0000-0002-000000000001', true); -- Sandton City (Demo) — ANOTHER org

SELECT set_config('x.org', (SELECT p.organisation_id::text FROM projects.projects p
                             WHERE p.id = current_setting('x.kingswalk')::uuid), true);
SELECT set_config('x.admin', (SELECT uo.user_id::text FROM public.user_organisations uo
                               WHERE uo.organisation_id = current_setting('x.org')::uuid
                                 AND uo.is_active AND uo.role IN ('owner', 'admin')
                               ORDER BY uo.created_at, uo.user_id LIMIT 1), true);

-- Targets are chosen AFTER the subject and EXCLUDE anything they authored:
-- 1 and 2 must exercise the write-role arm, and an entry the subject wrote
-- would pass through the author arm instead. (Measured 2026-09-15: the oldest
-- WM owner authored 9 of KINGSWALK's 20 entries, so this is not hypothetical —
-- the first draft of this file tripped its own guard here.)
SELECT set_config('x.e1', (SELECT e.id::text FROM projects.site_diary_entries e
                            WHERE e.project_id = current_setting('x.kingswalk')::uuid
                              AND e.created_by <> current_setting('x.admin')::uuid
                            ORDER BY e.created_at, e.id LIMIT 1 OFFSET 0), true);
SELECT set_config('x.e2', (SELECT e.id::text FROM projects.site_diary_entries e
                            WHERE e.project_id = current_setting('x.kingswalk')::uuid
                              AND e.created_by <> current_setting('x.admin')::uuid
                            ORDER BY e.created_at, e.id LIMIT 1 OFFSET 1), true);
SELECT set_config('x.e3', (SELECT e.id::text FROM projects.site_diary_entries e
                            WHERE e.project_id = current_setting('x.kingswalk')::uuid
                              AND e.created_by <> current_setting('x.admin')::uuid
                            ORDER BY e.created_at, e.id LIMIT 1 OFFSET 2), true);

DO $$
BEGIN
  IF current_setting('x.admin', true) IS NULL THEN
    RAISE EXCEPTION 'no active owner/admin in the entries'' organisation — every control below would be testing the wrong person';
  END IF;
  IF current_setting('x.e1', true) IS NULL OR current_setting('x.e2', true) IS NULL
     OR current_setting('x.e3', true) IS NULL THEN
    RAISE EXCEPTION 'KINGSWALK has fewer than three diary entries by authors other than the derived subject — the controls would be vacuous';
  END IF;
  IF public.user_effective_project_role(current_setting('x.kingswalk')::uuid,
                                        current_setting('x.admin')::uuid)
       NOT IN ('owner', 'admin', 'project_manager') THEN
    RAISE EXCEPTION 'the derived subject''s effective role on KINGSWALK is % — this file asserts the AUTHORISED case',
      public.user_effective_project_role(current_setting('x.kingswalk')::uuid, current_setting('x.admin')::uuid);
  END IF;
  -- 1 and 2 must exercise the ROLE arm, not the author arm, or they would pass
  -- for a reason this migration does not own.
  IF EXISTS (SELECT 1 FROM projects.site_diary_entries e
              WHERE e.id IN (current_setting('x.e1')::uuid, current_setting('x.e2')::uuid)
                AND e.created_by = current_setting('x.admin')::uuid) THEN
    RAISE EXCEPTION 'the derived subject authored one of the target entries — 1/2 would pass through the author arm instead of the write-role arm';
  END IF;
  IF public.user_effective_project_role(current_setting('x.foreign_project')::uuid,
                                        current_setting('x.admin')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'the derived subject has a role on the foreign project — probe 3 would not test the org binding';
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- 1. The everyday authorised edit: a PM/admin correcting a colleague's entry.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET quality_notes = 'reviewed by the project admin', workers_on_site = 11
     WHERE id = current_setting('x.e1')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_edit',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_edit', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 2. NAMED RESIDUAL, asserted so it is a decision and not a surprise: a write
--    role may still relocate an entry BETWEEN projects of the same
--    organisation. RLS cannot see the OLD row, so "project_id unchanged" is
--    not expressible in a policy; pinning it outright is a trigger-shaped
--    change that would also freeze the service path and the deliberate
--    `move` arm of item 3's site_diary_entries_mirror_work_item_upd trigger.
--    The org binding at 3 is what stops this leaving the organisation.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.watermeyer')::uuid
     WHERE id = current_setting('x.e2')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_move_same_org',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_move_same_org', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

-- 3. THE ORG BINDING. Even an org admin may not leave a row whose
--    organisation_id disagrees with its project's organisation.
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE projects.site_diary_entries
       SET project_id = current_setting('x.foreign_project')::uuid
     WHERE id = current_setting('x.e3')::uuid;
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('x.r_move_foreign',
      CASE WHEN n = 0 THEN 'BLOCKED (zero rows — USING)' ELSE 'ACCEPTED (' || n || ' row)' END, true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('x.r_move_foreign', 'BLOCKED (42501 — WITH CHECK)', true);
  END;
END $$;

SELECT * FROM (VALUES
  ('org admin: correct a colleague''s entry -> ' || current_setting('x.r_edit') || ' (must stay allowed)',
     current_setting('x.r_edit') LIKE 'ACCEPTED%'),
  ('org admin: move an entry between projects of the SAME org -> ' || current_setting('x.r_move_same_org')
     || ' (named residual: still allowed)',
     current_setting('x.r_move_same_org') LIKE 'ACCEPTED%'),
  ('org admin: point an entry at a FOREIGN-ORG project -> ' || current_setting('x.r_move_foreign'),
     current_setting('x.r_move_foreign') LIKE 'BLOCKED%'),
  ('org admin: still reads every KINGSWALK diary entry (SELECT untouched)',
     (SELECT count(*) FROM projects.site_diary_entries
       WHERE project_id = current_setting('x.kingswalk')::uuid) > 0)
) AS t("check", ok);
