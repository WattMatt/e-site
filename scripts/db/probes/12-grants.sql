-- 12-grants.sql — Task 13: section G of 00198 — every function this migration
-- creates is revoked from PUBLIC and from anon, and nothing is GRANTed (F5).
-- Asserted against production inside one rolled-back transaction.
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/12-grants.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section G existed this reported 4/8: anon_cannot_execute_any and
-- public_cannot_execute_any named all twenty-two functions, because a new
-- `projects` function inherits Postgres's built-in PUBLIC EXECUTE — pg_default_acl
-- carries NO function default for this schema (read live 2026-09-13: only
-- sequences and tables), so nothing had revoked it. The two snapshot_table_*
-- rows stay red until Task 14's section H creates the table (expected; not a
-- finding). The list of names below IS the twenty-two `function:` lines of the
-- @verify block minus the replaced guard, which section C' re-revokes.
--
-- ⚠ Never verify by reading proacl or relacl: a NULL proacl looks empty but IS
-- the PUBLIC grant. has_function_privilege / has_table_privilege only. The
-- `public` pseudo-role form is accepted on 17.6 (read live 2026-09-13:
-- has_function_privilege('public', 'projects.work_items_transition_guard()',
-- 'EXECUTE') = false), so public_cannot_execute_any measures PUBLIC's grant
-- directly rather than inferring it through anon.
--
-- The snapshot rows are written so an ABSENT table reads as a FAIL row, not as
-- an aborted probe: has_table_privilege(name, oid, priv) is strict, so a NULL
-- oid from to_regclass() yields a NULL ok (a FAIL in the harness), whereas the
-- text-name form raises 42P01 and would abort every other row with it.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation, no fixtures — this probe only reads the catalog.
--
-- Expected: 8 rows (6 green + the two snapshot rows until Task 14). If the
-- printed `assertions seen:` list is shorter than eight names, a UNION ALL arm
-- was dropped — read the list, not the total.
WITH fns AS (
  SELECT p.oid, p.prosrc, p.prosecdef,
         n.nspname || '.' || p.proname || '(' ||
         pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'projects'
     AND p.proname IN ('resolve_mirror_assignee',
                       'resolve_work_item_gatekeeper','work_item_person_eligible',
                       'map_source_status','work_item_status_for_mirror',
                       'work_item_mirror_due_date','diary_delay_text',
                       'project_rfi','project_snag','project_inspection',
                       'project_qc_entry','project_diary_action','project_form_action',
                       'mirror_rfi_work_item','mirror_snag_work_item',
                       'mirror_inspection_work_item','mirror_qc_defect_work_item',
                       'mirror_qc_report_defects','mirror_diary_action_work_item',
                       'mirror_form_action_work_item','work_item_assignment_writeback',
                       'void_work_item_on_source_delete')
)
SELECT 'all_functions_created' AS probe, count(*) = 22 AS ok,
       'found ' || count(*) || ' of 22 (resolve_project_pm / resolve_work_item_assignee are item 2''s and not counted; the replaced guard is asserted separately)' AS detail FROM fns
UNION ALL
-- The replaced guard: CREATE OR REPLACE keeps the ACL, and C' re-revokes anyway.
SELECT 'replaced_guard_still_revoked',
       NOT has_function_privilege('anon', 'projects.work_items_transition_guard()', 'EXECUTE')
   AND NOT has_function_privilege('public', 'projects.work_items_transition_guard()', 'EXECUTE'),
       'section C'' re-issues both revokes so the @verify grant_absent: line is provably true of this file'
UNION ALL
SELECT 'anon_cannot_execute_any',
       count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) = 0,
       'anon can execute: ' || COALESCE(string_agg(sig, ', ' ORDER BY sig)
         FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')), 'none') FROM fns
UNION ALL
SELECT 'public_cannot_execute_any',
       count(*) FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')) = 0,
       'PUBLIC can execute: ' || COALESCE(string_agg(sig, ', ' ORDER BY sig)
         FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')), 'none') FROM fns
UNION ALL
-- The four pure helpers (map_source_status IMMUTABLE, work_item_status_for_mirror
-- IMMUTABLE, work_item_mirror_due_date STABLE, diary_delay_text IMMUTABLE) read
-- no table and are SECURITY INVOKER by design; everything else touches
-- work_items or a source table and must be DEFINER. The replaced guard is
-- INVOKER (item 2's posture) and is not in the list.
SELECT 'every_stateful_function_is_security_definer',
       count(*) FILTER (WHERE NOT prosecdef) = 0,
       'SECURITY INVOKER: ' || COALESCE(string_agg(sig, ', ' ORDER BY sig) FILTER (WHERE NOT prosecdef), 'none')
  FROM fns
 WHERE sig NOT LIKE 'projects.map_source_status%'
   AND sig NOT LIKE 'projects.work_item_status_for_mirror%'
   AND sig NOT LIKE 'projects.work_item_mirror_due_date%'
   AND sig NOT LIKE 'projects.diary_delay_text%'
UNION ALL
-- Narrowed to the AUTHORISATION use, and comment-stripped: this migration is
-- full of prose explaining why current_user must not be used, and a bare token
-- match would fail the build on the explanation rather than on the defect.
SELECT 'no_current_user_authorisation',
       count(*) FILTER (
         WHERE regexp_replace(prosrc, '--[^\n]*', '', 'g')
               ~* '(IF|AND|OR|WHERE|WHEN)[^\n]*\mcurrent_user\M') = 0,
       'current_user resolves to the function OWNER inside SECURITY DEFINER (00179:341-346); offenders: '
         || COALESCE(string_agg(sig, ', ' ORDER BY sig) FILTER (
              WHERE regexp_replace(prosrc, '--[^\n]*', '', 'g')
                    ~* '(IF|AND|OR|WHERE|WHEN)[^\n]*\mcurrent_user\M'), 'none')
  FROM fns
UNION ALL
SELECT 'snapshot_table_not_anon_readable',
       NOT has_table_privilege('anon', to_regclass('projects.backup_00198_source_assignees')::oid, 'SELECT'),
       CASE WHEN to_regclass('projects.backup_00198_source_assignees') IS NULL
            THEN 'projects.backup_00198_source_assignees does not exist yet — Task 14 section H creates it (expected red until then)'
            ELSE 'holds every RFI and snag assignee; explicitly revoked (00196:1310 already made new projects tables non-anon-readable — belt and braces)' END
UNION ALL
SELECT 'snapshot_table_has_rls',
       (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'projects' AND c.relname = 'backup_00198_source_assignees'),
       CASE WHEN to_regclass('projects.backup_00198_source_assignees') IS NULL
            THEN 'projects.backup_00198_source_assignees does not exist yet — Task 14 section H creates it (expected red until then)'
            ELSE 'RLS on with no policy: service-role only' END;
