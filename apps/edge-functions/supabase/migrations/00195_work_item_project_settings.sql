-- =============================================================================
-- Migration: 00195_work_item_project_settings.sql
-- Programme: V2 platform roadmap — Q1, A(f) ordinal 6 (item 2's slice)
-- Spec: docs/superpowers/specs/2026-09-09-v2-platform-roadmap/
--         16-appendix-registries.md A(b), A(f), A(h)
--         03-work-items.md §1.5, §1.6
--
-- Adds the work-item columns to the existing projects.project_settings row and
-- rewrites projects.ensure_project_settings_row() so a NEW project arrives with
-- a named triage owner. MUST precede the spine: work_items.assignee_id is
-- NOT NULL, and without a resolved owner the backfill aborts on exactly the
-- projects that most need triaging.
--
-- triage_owner_id is NULLABLE by decision (§03 §1.6). ensure_project_settings_row()
-- is an AFTER INSERT trigger inserting only (project_id, organisation_id)
-- (00103:19-30); a third MANDATORY column makes that insert raise and aborts the
-- transaction that created the project — project creation breaks platform-wide.
--
-- Restore:
--   ALTER TABLE projects.project_settings
--     DROP COLUMN work_item_defaults, DROP COLUMN triage_owner_id,
--     DROP COLUMN builders_shutdown_start_md, DROP COLUMN builders_shutdown_end_md;
--   DROP FUNCTION projects.resolve_triage_owner(uuid), projects.resolve_project_pm(uuid),
--                 projects.org_owner(uuid);
--   -- then restore ensure_project_settings_row() from 00103:19-26 verbatim.
-- =============================================================================

-- @verify:begin
-- column: projects.project_settings.work_item_defaults
-- column: projects.project_settings.triage_owner_id
-- column: projects.project_settings.builders_shutdown_start_md
-- column: projects.project_settings.builders_shutdown_end_md
-- function: projects.org_owner(uuid)
-- function: projects.resolve_project_pm(uuid)
-- function: projects.resolve_triage_owner(uuid)
-- function: projects.ensure_project_settings_row()
-- constraint: project_settings_shutdown_md_format ON projects.project_settings
-- grant_absent: anon EXECUTE ON projects.org_owner(uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_project_pm(uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_triage_owner(uuid)
-- sql: SELECT count(*) = 0 FROM projects.project_settings WHERE triage_owner_id IS NULL
-- @verify:end

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
-- The 00102 audit trigger snapshots with to_jsonb(NEW) and diffs generically
-- (00102:30-45), so adding columns needs no change there.
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS work_item_defaults        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS triage_owner_id           uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS builders_shutdown_start_md text NOT NULL DEFAULT '12-15',
  ADD COLUMN IF NOT EXISTS builders_shutdown_end_md   text NOT NULL DEFAULT '01-15';

COMMENT ON COLUMN projects.project_settings.work_item_defaults IS
  'Per-item_type defaults: { "<type>": { days_to_respond, triage_owner_id, gatekeeper_id } }. '
  'Keys validated against projects.work_item_types by trigger (a CHECK cannot reference another '
  'table). Typed columns were rejected: eight types in Q1, each new one forcing a migration on a '
  'hot 1:1 table carrying an audit trigger (00102:30,61-63). NOTE: the rfi key holds a NULL '
  'days_to_respond by design — the due-date trigger reads project_settings.default_rfi_due_days '
  'LIVE, so editing that setting moves the next RFI rather than drifting from a migration-time copy.';
COMMENT ON COLUMN projects.project_settings.triage_owner_id IS
  'Default assignee backstop. NULLABLE by decision (§03 §1.6) — a NOT NULL column with no default '
  'makes ensure_project_settings_row() raise and breaks project creation platform-wide. The DB-level '
  'guarantee is work_items.assignee_id NOT NULL, not this column.';
COMMENT ON COLUMN projects.project_settings.builders_shutdown_start_md IS
  'MM-DD. The SA construction year-end shutdown window, gated by the existing builders_holiday '
  'boolean. Default 12-15..01-15 matches crossesBuildersHoliday (lib/jbcc/working-days.ts:67-75). '
  'A due date landing inside it is pushed to the first SITE working day of the new year (A(h)).';

-- MM-DD, so the window recurs annually without a per-year row.
ALTER TABLE projects.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_shutdown_md_format;
ALTER TABLE projects.project_settings
  ADD CONSTRAINT project_settings_shutdown_md_format CHECK (
    builders_shutdown_start_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
AND builders_shutdown_end_md   ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

-- ─── 2. Resolvers ────────────────────────────────────────────────────────────
-- All three are STABLE SECURITY DEFINER with row_security off (§12 §(b) rule 6)
-- because they read user_organisations and project_members, which a caller's own
-- RLS would hide. None uses current_user: inside SECURITY DEFINER that resolves
-- to the function OWNER, which is what made the first site-form transition
-- trigger silently inert (00179:341-346).

CREATE OR REPLACE FUNCTION projects.org_owner(p_organisation_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT uo.user_id FROM public.user_organisations uo
   WHERE uo.organisation_id = p_organisation_id AND uo.is_active AND uo.role = 'owner'
   ORDER BY uo.created_at ASC LIMIT 1;
$fn$;

-- §03 §1.5's "project PM" chain, in 00107's order: oldest active project_members
-- PM row → oldest active org PM → org admin → org owner → the project's
-- created_by. Used as the GATEKEEPER default for every type whose
-- gatekeeper_rule is 'project_pm'.
--
-- The org-owner arm is NOT a guarantee. Measured on production 2026-09-12: the
-- demo org e51ede00-0000-0000-0000-000000000001 has no active owner, admin or
-- project_manager at all (one client_viewer, one contractor), so a chain that
-- ended at the owner returned NULL for its project. projects.projects.created_by
-- is NOT NULL on every row, so created_by is the TERMINAL arm: this function
-- cannot return NULL for a project that exists. Item 3's mirror triggers and
-- every later default must end the same way — COALESCE(…, org_owner, created_by).
CREATE OR REPLACE FUNCTION projects.resolve_project_pm(p_project_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  WITH proj AS (SELECT id, organisation_id, created_by FROM projects.projects WHERE id = p_project_id)
  SELECT COALESCE(
    (SELECT pm.user_id FROM projects.project_members pm
      WHERE pm.project_id = p_project_id AND pm.is_active AND pm.role = 'project_manager'
      ORDER BY pm.created_at ASC LIMIT 1),
    (SELECT uo.user_id FROM public.user_organisations uo JOIN proj ON TRUE
      WHERE uo.organisation_id = proj.organisation_id AND uo.is_active AND uo.role = 'project_manager'
      ORDER BY uo.created_at ASC LIMIT 1),
    (SELECT uo.user_id FROM public.user_organisations uo JOIN proj ON TRUE
      WHERE uo.organisation_id = proj.organisation_id AND uo.is_active AND uo.role = 'admin'
      ORDER BY uo.created_at ASC LIMIT 1),
    (SELECT projects.org_owner(proj.organisation_id) FROM proj),
    (SELECT proj.created_by FROM proj));
$fn$;

-- The TRIAGE-OWNER chain is deliberately different from the PM chain and shorter:
-- oldest active project_manager on the project → the project's created_by → the
-- org owner. created_by sits ABOVE the org owner here and BELOW it in the PM
-- chain (which also carries the org-PM and org-admin arms), which is why this
-- cannot reuse resolve_project_pm. It terminates at the project's creator:
-- created_by is NOT NULL on every projects.projects row, so this cannot return
-- NULL for a project that exists, and the org-owner arm is unreachable in
-- practice — kept as the plan wrote it, not as the guarantee.
CREATE OR REPLACE FUNCTION projects.resolve_triage_owner(p_project_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  WITH proj AS (SELECT id, organisation_id, created_by FROM projects.projects WHERE id = p_project_id)
  SELECT COALESCE(
    (SELECT pm.user_id FROM projects.project_members pm
      WHERE pm.project_id = p_project_id AND pm.is_active AND pm.role = 'project_manager'
      ORDER BY pm.created_at ASC LIMIT 1),
    (SELECT proj.created_by FROM proj),
    (SELECT projects.org_owner(proj.organisation_id) FROM proj));
$fn$;

REVOKE ALL ON FUNCTION projects.org_owner(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_project_pm(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_triage_owner(uuid) FROM PUBLIC;
-- FROM PUBLIC does NOT remove anon's grant: Supabase's ALTER DEFAULT PRIVILEGES
-- grants anon EXECUTE *directly* at creation, a separate grant (00113:15-24).
REVOKE EXECUTE ON FUNCTION projects.org_owner(uuid)            FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_project_pm(uuid)   FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_triage_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION projects.org_owner(uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_project_pm(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_triage_owner(uuid) TO authenticated, service_role;

-- ─── 3. ensure_project_settings_row() rewrite ────────────────────────────────
-- Was SECURITY INVOKER with no search_path (00103:19-26). It now reads
-- project_members and user_organisations through the resolvers, so it must be
-- DEFINER or a contractor creating a project would resolve NULL under their own
-- RLS. It stays an AFTER INSERT trigger, which is what makes NEW.id visible to
-- resolve_triage_owner's SELECT — a BEFORE INSERT trigger could not do this.
CREATE OR REPLACE FUNCTION projects.ensure_project_settings_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
    INSERT INTO projects.project_settings (project_id, organisation_id, triage_owner_id)
    VALUES (NEW.id, NEW.organisation_id, projects.resolve_triage_owner(NEW.id))
    ON CONFLICT (project_id) DO NOTHING;
    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION projects.ensure_project_settings_row() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.ensure_project_settings_row() FROM anon;

-- ─── 4. Backfill every live settings row ─────────────────────────────────────
-- Fires the 00102 audit trigger, writing one history row per project with
-- changed_by = updated_by (NULL for a migration). That is correct: the change
-- has no human author.
UPDATE projects.project_settings ps
   SET triage_owner_id = projects.resolve_triage_owner(ps.project_id)
 WHERE ps.triage_owner_id IS NULL;

NOTIFY pgrst, 'reload schema';
