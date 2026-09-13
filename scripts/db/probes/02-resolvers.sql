-- 02-resolvers.sql — Task 3: the mirror's resolver (F3, improvement 7).
-- Asserts projects.work_item_person_eligible, projects.resolve_mirror_assignee
-- and projects.resolve_work_item_gatekeeper (00198 section B) against production
-- inside one rolled-back transaction. 00195's resolve_project_pm is READ here,
-- never redefined; its own contract is item 2's (work-item-settings.sql).
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/02-resolvers.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section B existed this failed at the orphan fixture's PERFORM with
-- 42883 "function projects.resolve_mirror_assignee(uuid, unknown, unknown) does
-- not exist" — the DO block is reached before the assertion SELECT.
--
-- Fixtures (all rolled back; every one RAISES rather than skips):
--   v_cv / v_proj  a live WM-Consulting client_viewer and a project on which
--                  their effective role is client_viewer (3 such accounts on
--                  2026-09-13, each holding exactly one such project).
--   the orphan     a throwaway org with no members and a project created by
--                  v_cv, who holds no role there — 00195's chain returns NULL.
--   X              the WM project with the most eligible members. Four
--                  distinct eligible non-PM, non-client-viewer members A B C D:
--                  per-type snag/rfi default = A, triage_owner_id = B,
--                  default_rfi_assignee_id = C, D is passed explicitly. Each
--                  arm therefore answers a DIFFERENT person, so deleting any
--                  one arm changes an answer and a positive-path mutation can
--                  be seen to fail (rfi_default_assignee_honoured,
--                  per_type_default_honoured, triage_owner_honoured,
--                  explicit_member_honoured).
--   Y              another WM project with every override cleared, so the
--                  chain has to reach 00195's PM arm (pm_chain_honoured).
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation here — every call runs as postgres (F9), which is what a
-- trigger-driven resolver sees on the service path; the resolver takes no
-- caller identity by design.
DO $probe$
DECLARE
  v_cv    uuid;   -- a live client_viewer in WM-Consulting
  v_proj  uuid;   -- a project on which their effective role is client_viewer
  v_x     uuid;   -- live WM project carrying in-transaction overrides
  v_y     uuid;   -- live WM project with every override cleared
  v_pm_x  uuid;
  v_pm_y  uuid;
  v_cands uuid[];
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_kept  uuid;
BEGIN
  SELECT u.user_id INTO v_cv
    FROM public.user_organisations u
   WHERE u.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
     AND u.role = 'client_viewer' AND u.is_active
   ORDER BY u.created_at, u.user_id
   LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13), so improvement 7 cannot be proved';
  END IF;

  SELECT p.id INTO v_proj FROM projects.projects p
   WHERE p.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
     AND public.user_effective_project_role(p.id, v_cv) = 'client_viewer'
   ORDER BY p.created_at, p.id
   LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'fixture: client viewer % holds no WM project on which user_effective_project_role() = client_viewer (each of the 3 held exactly one on 2026-09-13) — a project_members row must have overridden their org role', v_cv;
  END IF;

  -- An ORPHANED project: a throwaway org with no members at all, whose creator
  -- (v_cv, a WM client viewer) holds no role there. 00195's chain returns NULL
  -- for it; the mirror resolver must RAISE item 2's sentence, not return NULL
  -- (which would fail assignee_id NOT NULL with a generic message on the
  -- source insert). public.organisations needs only name (slug is trigger-
  -- filled, type/subscription_tier default); projects.projects needs
  -- organisation_id, name, created_by (code is trigger-filled; status 'active'
  -- is in projects_status_check; currency has no CHECK) — measured 2026-09-13.
  DECLARE v_orphan_org uuid; v_orphan uuid; v_err text;
  BEGIN
    INSERT INTO public.organisations (name) VALUES ('_probe_orphan_org') RETURNING id INTO v_orphan_org;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_orphan_org, '_probe_orphan', 'active', 'ZAR', v_cv) RETURNING id INTO v_orphan;
    IF projects.resolve_project_pm(v_orphan) IS NOT NULL THEN
      RAISE EXCEPTION 'fixture: the orphan project resolved a PM (%) — it is not orphaned', projects.resolve_project_pm(v_orphan);
    END IF;
    BEGIN
      PERFORM projects.resolve_mirror_assignee(v_orphan, 'snag', NULL);
      v_err := '<no error>';
    EXCEPTION WHEN raise_exception THEN
      v_err := SQLERRM;
    END;
    CREATE TEMP TABLE res_orphan(proj uuid, err text) ON COMMIT DROP;
    INSERT INTO res_orphan VALUES (v_orphan, v_err);
  END;

  -- X: the WM project with the most eligible members, so four distinct
  -- candidates exist. "Eligible" is spelled out inline rather than through
  -- work_item_person_eligible so the fixture itself never depends on the
  -- function under test.
  SELECT p.id, projects.resolve_project_pm(p.id) INTO v_x, v_pm_x
    FROM projects.projects p
   WHERE p.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
     AND projects.resolve_project_pm(p.id) IS NOT NULL
   ORDER BY (SELECT count(*) FROM public.user_organisations u
              WHERE u.organisation_id = p.organisation_id AND u.is_active
                AND u.user_id <> projects.resolve_project_pm(p.id)
                AND COALESCE(public.user_effective_project_role(p.id, u.user_id), 'none')
                      NOT IN ('none', 'client_viewer')) DESC,
            p.created_at, p.id
   LIMIT 1;
  IF v_x IS NULL THEN
    RAISE EXCEPTION 'fixture: no WM project resolves a PM through 00195''s chain';
  END IF;

  SELECT array_agg(s.user_id ORDER BY s.user_id) INTO v_cands
    FROM (SELECT u.user_id FROM public.user_organisations u
           WHERE u.organisation_id = 'dddddddd-0000-0000-0000-000000000001' AND u.is_active
             AND u.user_id <> v_pm_x
             AND COALESCE(public.user_effective_project_role(v_x, u.user_id), 'none')
                   NOT IN ('none', 'client_viewer')
           ORDER BY u.user_id LIMIT 4) s;
  IF COALESCE(array_length(v_cands, 1), 0) < 4 THEN
    RAISE EXCEPTION 'fixture: project % has only % eligible non-PM members; four are needed so every arm answers a different person (KINGSWALK had 18 on 2026-09-13)',
      v_x, COALESCE(array_length(v_cands, 1), 0);
  END IF;
  v_a := v_cands[1]; v_b := v_cands[2]; v_c := v_cands[3]; v_d := v_cands[4];

  -- Arms 1b, 2 and 3 each get a different person. §13's validator (00196)
  -- NULLs a per-type id with no effective role, so the value is read back.
  UPDATE projects.project_settings
     SET triage_owner_id         = v_b,
         default_rfi_assignee_id = v_c,
         work_item_defaults      = jsonb_build_object(
           'snag', jsonb_build_object('triage_owner_id', v_a::text),
           'rfi',  jsonb_build_object('triage_owner_id', v_a::text))
   WHERE project_id = v_x;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: project % has no project_settings row', v_x;
  END IF;
  SELECT (s.work_item_defaults #>> '{snag,triage_owner_id}')::uuid INTO v_kept
    FROM projects.project_settings s WHERE s.project_id = v_x;
  IF v_kept IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'fixture: 00196 §13 nulled the per-type default % on project % (read back %)', v_a, v_x, v_kept;
  END IF;

  -- Y: every override cleared, so only 00195's PM arm can answer.
  SELECT p.id, projects.resolve_project_pm(p.id) INTO v_y, v_pm_y
    FROM projects.projects p
   WHERE p.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
     AND p.id <> v_x
     AND projects.resolve_project_pm(p.id) IS NOT NULL
   ORDER BY p.created_at, p.id
   LIMIT 1;
  IF v_y IS NULL THEN
    RAISE EXCEPTION 'fixture: no second WM project resolves a PM';
  END IF;
  UPDATE projects.project_settings
     SET triage_owner_id = NULL, default_rfi_assignee_id = NULL, work_item_defaults = '{}'::jsonb
   WHERE project_id = v_y;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: project % has no project_settings row', v_y;
  END IF;

  CREATE TEMP TABLE res_ctx(cv uuid, proj uuid) ON COMMIT DROP;
  INSERT INTO res_ctx VALUES (v_cv, v_proj);
  CREATE TEMP TABLE res_fix(x uuid, y uuid, pm_x uuid, pm_y uuid, a uuid, b uuid, c uuid, d uuid) ON COMMIT DROP;
  INSERT INTO res_fix VALUES (v_x, v_y, v_pm_x, v_pm_y, v_a, v_b, v_c, v_d);
END $probe$;

-- Live projects only: the orphan fixture is asserted on separately.
WITH live AS (SELECT p.* FROM projects.projects p WHERE p.name NOT LIKE '\_probe\_%')
SELECT 'pm_resolves_everywhere' AS probe,
       count(*) FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL) = 0 AS ok,
       '00195''s chain (item 2''s, read not redefined) — unresolved: ' || COALESCE(string_agg(p.name, '; ')
           FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL), 'none') AS detail
FROM live p
UNION ALL
SELECT 'assignee_resolves_everywhere',
       count(*) FILTER (WHERE projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NULL) = 0,
       'unresolved: ' || COALESCE(string_agg(p.name, '; ')
           FILTER (WHERE projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NULL), 'none')
FROM live p
UNION ALL
SELECT 'demo_project_resolves',
       bool_and(projects.resolve_project_pm(p.id) IS NOT NULL
            AND projects.resolve_mirror_assignee(p.id, 'snag', NULL) IS NOT NULL),
       'E-Site DEMO has no owner/admin/PM; 00195''s validated created_by arm resolves it (the creator holds an effective role)'
FROM live p WHERE p.name LIKE 'Sandton%'
UNION ALL
-- F3's accepted consequence, on the record rather than discovered later.
SELECT 'demo_gatekeeper_is_the_creator_and_a_contractor',
       bool_and(projects.resolve_project_pm(p.id) = p.created_by
            AND public.user_effective_project_role(p.id, p.created_by) = 'contractor'),
       'accepted: on the demo project the gatekeeper is a contractor, so improvement 2 keeps it out of the backfill'
FROM live p WHERE p.name LIKE 'Sandton%'
UNION ALL
-- F3: an orphaned project raises item 2's sentence, never NULL.
SELECT 'orphan_raises_one_sentence',
       (SELECT err LIKE 'This project has nobody who can own work%' FROM res_orphan),
       'got: ' || (SELECT err FROM res_orphan)
UNION ALL
-- The gatekeeper does not raise a second sentence: the assignee call already
-- did, and it runs first in every mirror body.
SELECT 'orphan_gatekeeper_is_null',
       projects.resolve_work_item_gatekeeper((SELECT proj FROM res_orphan), NULL) IS NULL,
       'no second sentence — the assignee resolver raises first on an orphaned project'
UNION ALL
SELECT 'resolved_people_are_members',
       count(*) FILTER (WHERE public.user_effective_project_role(
           p.id, projects.resolve_mirror_assignee(p.id, 'snag', NULL)) IS NULL) = 0,
       'assignee must pass user_effective_project_role or item 2''s membership trigger raises'
FROM live p
UNION ALL
-- Improvement 7.
SELECT 'client_viewer_is_never_eligible',
       NOT projects.work_item_person_eligible((SELECT proj FROM res_ctx), (SELECT cv FROM res_ctx)),
       'a client viewer cannot clear an item until Q3, and work_items_bic_present pins it to them forever'
UNION ALL
SELECT 'client_viewer_explicit_is_overridden',
       projects.resolve_mirror_assignee((SELECT proj FROM res_ctx), 'rfi', (SELECT cv FROM res_ctx))
         IS DISTINCT FROM (SELECT cv FROM res_ctx),
       'an explicit rfis.assigned_to naming a client viewer falls through to the chain (item 2''s picker resolver would have kept them — deliberate divergence)'
UNION ALL
SELECT 'nobody_resolves_to_a_client_viewer',
       count(*) FILTER (WHERE public.user_effective_project_role(
           p.id, projects.resolve_mirror_assignee(p.id, 'rfi', NULL)) = 'client_viewer') = 0,
       'no project''s default assignee may be a client viewer'
FROM live p
UNION ALL
-- Eligibility is one helper: a NULL, an id with no profile, and a member.
SELECT 'eligibility_needs_a_profile_with_a_role',
       (SELECT NOT projects.work_item_person_eligible(f.x, NULL)
           AND NOT projects.work_item_person_eligible(f.x, gen_random_uuid())
           AND     projects.work_item_person_eligible(f.x, f.d)
          FROM res_fix f),
       'NULL and an unknown id are ineligible; an active non-client-viewer member is eligible'
UNION ALL
-- Positive paths, each answering a DIFFERENT person on X (fixture header).
SELECT 'explicit_member_honoured',
       (SELECT projects.resolve_mirror_assignee(f.x, 'snag', f.d) = f.d FROM res_fix f),
       'arm 1: an eligible explicit assignee wins over the per-type default (A), the triage owner (B) and the PM'
UNION ALL
SELECT 'explicit_unknown_id_is_discarded',
       (SELECT projects.resolve_mirror_assignee(f.x, 'snag', gen_random_uuid()) = f.a FROM res_fix f),
       'arm 1 validates: an id with no profile (§03 §1.5, no FK behind the jsonb) falls through to the chain rather than raising'
UNION ALL
SELECT 'rfi_default_assignee_honoured',
       (SELECT projects.resolve_mirror_assignee(f.x, 'rfi', NULL) = f.c FROM res_fix f),
       'arm 1b: project_settings.default_rfi_assignee_id (C) wins for rfi over the per-type rfi default (A) and the triage owner (B)'
UNION ALL
SELECT 'per_type_default_honoured',
       (SELECT projects.resolve_mirror_assignee(f.x, 'snag', NULL) = f.a FROM res_fix f),
       'arm 2: work_item_defaults.snag.triage_owner_id (A) wins over the triage owner (B) and the PM; default_rfi_assignee_id (C) is rfi-only'
UNION ALL
SELECT 'triage_owner_honoured',
       (SELECT projects.resolve_mirror_assignee(f.x, 'inspection', NULL) = f.b FROM res_fix f),
       'arm 3: with no per-type default for inspection, project_settings.triage_owner_id (B) wins over the PM'
UNION ALL
SELECT 'pm_chain_honoured',
       (SELECT projects.resolve_mirror_assignee(f.y, 'snag', NULL) = f.pm_y AND f.pm_y IS NOT NULL FROM res_fix f),
       'arms 4+5: with every override cleared on Y the answer is 00195''s resolve_project_pm'
UNION ALL
-- The gatekeeper: explicit else PM; never the triage owner, never a client viewer.
SELECT 'gatekeeper_defaults_to_pm',
       (SELECT projects.resolve_work_item_gatekeeper(f.x, NULL) = f.pm_x FROM res_fix f),
       'X''s triage overrides (A, B, C) do not reach the gatekeeper — NULL resolves to 00195''s PM'
UNION ALL
SELECT 'gatekeeper_explicit_member_honoured',
       (SELECT projects.resolve_work_item_gatekeeper(f.x, f.d) = f.d FROM res_fix f),
       'an eligible explicit gatekeeper (inspection''s verifier, rfi''s raiser) is kept'
UNION ALL
SELECT 'gatekeeper_client_viewer_overridden',
       projects.resolve_work_item_gatekeeper((SELECT proj FROM res_ctx), (SELECT cv FROM res_ctx))
         IS DISTINCT FROM (SELECT cv FROM res_ctx)
       AND projects.resolve_work_item_gatekeeper((SELECT proj FROM res_ctx), (SELECT cv FROM res_ctx))
         = projects.resolve_project_pm((SELECT proj FROM res_ctx)),
       'a client viewer named as gatekeeper falls through to the PM (improvement 7 applies to both people)';
