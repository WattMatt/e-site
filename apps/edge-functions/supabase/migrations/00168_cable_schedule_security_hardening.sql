-- =============================================================================
-- Migration 00168 — cable_schedule: security hardening (2026-07 audit)
-- =============================================================================
-- Closes the DB-layer findings of the cable-schedule security audit
-- (verified findings S1 / S3 / S6), plus a SANS-reference default and a
-- data desync:
--
--   1. S1 (HIGH)  — the six MV FOR ALL policies (00128/00129/00130) omit the
--      client_viewer exclusion from USING. Postgres evaluates only USING for
--      DELETE, so a client_viewer could DELETE fault-study inputs, results,
--      discrimination checks and the Pr.Eng sign-off over raw REST.
--      Recreated with the exclusion in BOTH clauses, matching the core
--      cable policies in 00051 (rev_write_org_members et al.).
--   2. S6 (INFO)  — anon held table-level SELECT on every cable_schedule and
--      structure table (00052 / 00075). RLS already denies anon, but the
--      standing privilege is unnecessary surface. Revoked, incl. default
--      privileges. authenticated / service_role grants unchanged.
--   3. S3 (MED)   — ISSUED-revision immutability was app-side only
--      (assertDraft in the server actions); any non-viewer org member could
--      rewrite a frozen, legally load-bearing ISSUED snapshot over raw REST.
--      Enforced here with BEFORE triggers on revisions + its data tables.
--   4. cables.thermal_resistivity_kmw default 1.0 → 1.2 (the SANS 10142-1
--      reference soil resistivity — the old 1.0 default silently up-rated
--      every default-valued cable ~8 %), plus a data fix re-baselining the
--      legacy stored 1.0 (a UI-hardcoded default, never a measurement) to
--      1.2 on DRAFT revisions only.
--   5. Data fix — cables.standard rows desynced from insulation (the commit
--      importer stamped 'SANS 1507-4' regardless of insulation). Re-aligned
--      to the same mapping the app uses (cable-entities.actions.ts):
--      PVC → 'SANS 1507-3', XLPE → 'SANS 1507-4', PILC → 'SANS 97'.
--      Stored derate factors are deliberately NOT touched here — a
--      code-driven recompute handles those.
--
-- Idempotent: DROP POLICY/TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION;
-- REVOKE/ALTER DEFAULT PRIVILEGES and the data UPDATEs are re-runnable.
-- No schema CREATE/DROP → no PostgREST db_schema config PATCH needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. MV policies — client_viewer exclusion in USING as well as WITH CHECK
-- ---------------------------------------------------------------------------
-- Policy names / tables copied exactly from 00128 / 00129 / 00130.

DROP POLICY IF EXISTS "mv_study_settings_rw" ON cable_schedule.mv_study_settings;
CREATE POLICY "mv_study_settings_rw" ON cable_schedule.mv_study_settings FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "fault_sources_rw" ON cable_schedule.fault_sources;
CREATE POLICY "fault_sources_rw" ON cable_schedule.fault_sources FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "protection_devices_rw" ON cable_schedule.protection_devices;
CREATE POLICY "protection_devices_rw" ON cable_schedule.protection_devices FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "fault_results_rw" ON cable_schedule.fault_results;
CREATE POLICY "fault_results_rw" ON cable_schedule.fault_results FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "discrimination_checks_rw" ON cable_schedule.discrimination_checks;
CREATE POLICY "discrimination_checks_rw" ON cable_schedule.discrimination_checks FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "mv_study_signoff_rw" ON cable_schedule.mv_study_signoff;
CREATE POLICY "mv_study_signoff_rw" ON cable_schedule.mv_study_signoff FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- NOTE: these FOR ALL policies also serve SELECT, and the client_viewer
-- exclusion now applies to reads of the six MV tables. That matches the MV
-- module's access model (MV fault studies are engineer-facing; client_viewer
-- has no MV UI), and 00163's additive cross-org SELECT policies on the MV
-- tables (project-scoped) are unaffected.

-- ---------------------------------------------------------------------------
-- 2. Revoke anon table-level SELECT (cable_schedule + structure)
-- ---------------------------------------------------------------------------
-- Mirrors (reverses) the GRANT shape of 00052:14-17 / 00075:98 and their
-- ALTER DEFAULT PRIVILEGES. RLS already returns zero rows to anon
-- (get_user_org_ids() is empty without a session) — this removes the
-- standing privilege so a future RLS slip cannot leak to anonymous callers.
-- Includes sans_tables / sans_rows: their "world read" RLS policy still
-- serves every AUTHENTICATED user; the app has no signed-out reference
-- viewer. Schema USAGE for anon is left as-is (harmless without table
-- privileges). authenticated / service_role grants unchanged.

REVOKE SELECT ON ALL TABLES IN SCHEMA cable_schedule FROM anon;
REVOKE SELECT ON ALL TABLES IN SCHEMA structure     FROM anon;

-- Original default privileges were installed by the migration/admin role, so
-- the same role's defaults are the ones to strip.
ALTER DEFAULT PRIVILEGES IN SCHEMA cable_schedule REVOKE SELECT ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA structure      REVOKE SELECT ON TABLES FROM anon;

-- ---------------------------------------------------------------------------
-- 3. ISSUED-revision immutability — enforced at the DB layer
-- ---------------------------------------------------------------------------
-- Threat model: a non-client_viewer org member bypassing the app's
-- assertDraft guard with a raw PostgREST call (role `authenticated`).
-- Enforcement therefore applies ONLY to the PostgREST end-user roles
-- (`authenticated`, `anon`); `service_role`, `postgres` / `supabase_admin`
-- (migrations, admin repair, trusted server keys) bypass — which also lets
-- §5's data fix below run in this same file.
--
-- Legitimate transitions confirmed against apps/web/src/actions/*.ts:
--   * cable-revision.actions.ts — all revision edits + DRAFT→ISSUED happen
--     while status = 'DRAFT' (issue UPDATE carries .eq('status','DRAFT'));
--     deleteDraftRevisionAction deletes DRAFT only. Nothing writes
--     SUPERSEDED today; the ISSUED→SUPERSEDED (status-only) transition is
--     allowed for the future lifecycle.
--   * deleteProjectAction — a whole-project delete cascades into revisions
--     of ANY status (still role 'authenticated'). Exempted in the DELETE
--     branch via the parent-gone check (project row is removed before RI
--     fires this trigger on its revisions).
--   * Every data-table write path (cable-entities / cable-length /
--     cable-cost / cable-discrepancy / cable-tag regenerate, and the
--     /api/cable-schedule/commit importer) is DRAFT-gated app-side.
--   * ONE flow legally mutates ISSUED data: markTagsPrintedAction
--     (cable-tag.actions.ts) flips cable_tags.printed/printed_at/printed_by
--     with no status gate — tags are physically printed AFTER a revision is
--     issued. Exempted precisely: printed-bookkeeping-only UPDATEs on tags
--     of an ISSUED (not SUPERSEDED) revision.
--   * change_log is deliberately NOT gated — audit writes must keep flowing
--     (the issue action itself logs against the now-ISSUED revision).
--   * MV tables (00128–00130) are not gated here: their server actions are
--     DRAFT-gated (mv-protection.actions.ts) and the sign-off row is written
--     while DRAFT as a precondition of issue; gating them is a candidate
--     follow-up once the MV issue lifecycle (Phase 6) lands.
--
-- Gated data tables (all revision children in 00051; 00054/00055/00064 add
-- columns/indexes only, no new tables):
--   direct revision_id ....... sources, boards, supplies, cables, cost_lines
--   via cable_id ............. terminations, cable_tags
--
-- SECURITY DEFINER so the status lookup is deterministic regardless of the
-- caller's RLS visibility. If the parent row is already gone (statement is
-- part of an authorised ON DELETE CASCADE — parent rows are removed before
-- the child triggers fire), the write is allowed; a bogus-FK INSERT that
-- slips through on the same NULL path still fails its FK constraint.
--
-- Role detection: inside a SECURITY DEFINER function `current_user` reports
-- the function OWNER, so it cannot identify the caller. The `role` GUC can:
-- PostgREST always issues SET ROLE authenticated / anon / service_role per
-- request, and entering a definer function does not alter the GUC. Direct
-- connections that never SET ROLE (migrations, psql as postgres) read
-- 'none' and bypass.

-- ── 3a. revisions lifecycle ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cable_schedule.enforce_revision_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Enforce only for PostgREST end-user roles (see header: `role` GUC,
    -- because current_user reports the definer inside this function).
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cable_schedule: revisions must be created as DRAFT (got %)', NEW.status
                USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            -- Authorised-cascade exemption: deleting a project cascades into
            -- its revisions (revisions.project_id ON DELETE CASCADE) while the
            -- role GUC still reads 'authenticated'. Parent rows are removed
            -- before RI fires the child triggers, so "project row already
            -- gone" identifies the cascade — allow it, or deleteProjectAction
            -- would wedge on any project with an ISSUED schedule. A direct
            -- REST delete of a non-DRAFT revision still sees the project row
            -- and is rejected. (The 3b/3c child guards already have this
            -- exemption via their v_status IS NULL path.)
            PERFORM 1 FROM projects.projects WHERE id = OLD.project_id;
            IF FOUND THEN
                RAISE EXCEPTION 'cable_schedule: % revision "%" cannot be deleted — only DRAFT revisions can be discarded', OLD.status, OLD.code
                    USING ERRCODE = 'raise_exception';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE
    IF OLD.status = 'DRAFT' THEN
        -- Any change while DRAFT, including the DRAFT → ISSUED issue flip
        -- (status / issued_at / issued_by / change_notes).
        RETURN NEW;
    ELSIF OLD.status = 'ISSUED' THEN
        -- Only the ISSUED → SUPERSEDED lifecycle step, changing nothing but
        -- status (+ updated_at, stamped by the earlier BEFORE trigger).
        IF NEW.status = 'SUPERSEDED'
           AND (to_jsonb(NEW) - 'status' - 'updated_at')
             = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'cable_schedule: revision "%" is ISSUED — the snapshot is frozen (only the status-only ISSUED → SUPERSEDED transition is allowed)', OLD.code
            USING ERRCODE = 'raise_exception';
    ELSE
        RAISE EXCEPTION 'cable_schedule: revision "%" is SUPERSEDED and immutable', OLD.code
            USING ERRCODE = 'raise_exception';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS revisions_lifecycle_guard ON cable_schedule.revisions;
CREATE TRIGGER revisions_lifecycle_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.revisions
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_lifecycle();

-- ── 3b. tables with a direct revision_id column ─────────────────────────
CREATE OR REPLACE FUNCTION cable_schedule.enforce_revision_data_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rev_id  UUID;
    v_status  TEXT;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    v_rev_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.revision_id ELSE OLD.revision_id END;

    SELECT status INTO v_status
    FROM cable_schedule.revisions
    WHERE id = v_rev_id;

    -- Parent already gone → this row change is part of an authorised
    -- ON DELETE CASCADE (the revision delete itself was DRAFT-gated in 3a).
    IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'cable_schedule.%: revision is % — the issued snapshot is frozen; start a new revision to make changes', TG_TABLE_NAME, v_status
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Re-pointing a row at another revision must also target a DRAFT.
    IF TG_OP = 'UPDATE' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
        SELECT status INTO v_status
        FROM cable_schedule.revisions
        WHERE id = NEW.revision_id;
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cable_schedule.%: target revision is % — cannot move rows into a frozen revision', TG_TABLE_NAME, v_status
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS sources_frozen_guard ON cable_schedule.sources;
CREATE TRIGGER sources_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.sources
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

DROP TRIGGER IF EXISTS boards_frozen_guard ON cable_schedule.boards;
CREATE TRIGGER boards_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.boards
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

DROP TRIGGER IF EXISTS supplies_frozen_guard ON cable_schedule.supplies;
CREATE TRIGGER supplies_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.supplies
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

DROP TRIGGER IF EXISTS cables_frozen_guard ON cable_schedule.cables;
CREATE TRIGGER cables_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.cables
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

DROP TRIGGER IF EXISTS cost_lines_frozen_guard ON cable_schedule.cost_lines;
CREATE TRIGGER cost_lines_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.cost_lines
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

-- ── 3c. cable children (terminations, cable_tags — via cable_id) ────────
CREATE OR REPLACE FUNCTION cable_schedule.enforce_cable_child_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cable_id UUID;
    v_status   TEXT;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    v_cable_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.cable_id ELSE OLD.cable_id END;

    SELECT r.status INTO v_status
    FROM cable_schedule.cables c
    JOIN cable_schedule.revisions r ON r.id = c.revision_id
    WHERE c.id = v_cable_id;

    -- Parent cable already gone → part of an authorised ON DELETE CASCADE.
    IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
        -- Exemption (the ONE legitimate post-issue mutation, see header):
        -- markTagsPrintedAction print bookkeeping — an UPDATE on cable_tags
        -- of an ISSUED revision that changes nothing but printed /
        -- printed_at / printed_by.
        IF TG_TABLE_NAME = 'cable_tags'
           AND TG_OP = 'UPDATE'
           AND v_status = 'ISSUED'
           AND (to_jsonb(NEW) - 'printed' - 'printed_at' - 'printed_by')
             = (to_jsonb(OLD) - 'printed' - 'printed_at' - 'printed_by') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'cable_schedule.%: revision is % — the issued snapshot is frozen; start a new revision to make changes', TG_TABLE_NAME, v_status
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Re-pointing at another cable must also target a DRAFT-revision cable.
    IF TG_OP = 'UPDATE' AND NEW.cable_id IS DISTINCT FROM OLD.cable_id THEN
        SELECT r.status INTO v_status
        FROM cable_schedule.cables c
        JOIN cable_schedule.revisions r ON r.id = c.revision_id
        WHERE c.id = NEW.cable_id;
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cable_schedule.%: target cable belongs to a % revision — cannot move rows into a frozen revision', TG_TABLE_NAME, v_status
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS terminations_frozen_guard ON cable_schedule.terminations;
CREATE TRIGGER terminations_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.terminations
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_cable_child_frozen();

DROP TRIGGER IF EXISTS cable_tags_frozen_guard ON cable_schedule.cable_tags;
CREATE TRIGGER cable_tags_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.cable_tags
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_cable_child_frozen();

-- ---------------------------------------------------------------------------
-- 4. cables.thermal_resistivity_kmw — SANS reference default
-- ---------------------------------------------------------------------------
-- SANS 10142-1:2017 rates buried cables at 1.2 K·m/W soil thermal
-- resistivity (Table 6.12 reference row). The old default of 1.0 made every
-- cable created without an explicit value pick up an ~8 % soil UP-rating
-- (T6.12: ρ=1.0 → 1.06 direct / 1.02 duct) instead of factor 1.00.
-- ISSUED / SUPERSEDED rows keep their stored value (frozen designed
-- records); DRAFT rows storing the old 1.0 default are re-baselined below.
-- The code-driven recompute (separate PR) re-derives the derate columns.
ALTER TABLE cable_schedule.cables
    ALTER COLUMN thermal_resistivity_kmw SET DEFAULT 1.2;

-- Data fix — legacy stored 1.0 on DRAFT revisions. A stored 1.0 is provably
-- the old default, never a user measurement: every pre-audit UI create
-- payload hardcoded thermalResistivityKmw = 1.0 (AddEntityPanel; the commit
-- importer likewise), and the edit path never exposed the field at all
-- (C12 spec §6.1 — updateCableAction reads it from the existing row), so no
-- write path could ever have stored a user-entered 1.0. Re-baselined to the
-- SANS reference 1.2. DRAFT only — ISSUED / SUPERSEDED snapshots keep 1.0
-- as part of the frozen designed record. The stored derate_* columns are
-- deliberately NOT touched here; the code-driven recompute sweep re-derives
-- them (and substitutes 1.2 itself for any straggler DRAFT rows). Runs as
-- the migration role, so the §3 triggers do not apply. Idempotent: matches
-- nothing on re-run.
UPDATE cable_schedule.cables c
SET    thermal_resistivity_kmw = 1.2
FROM   cable_schedule.revisions r
WHERE  r.id = c.revision_id
  AND  r.status = 'DRAFT'
  AND  c.thermal_resistivity_kmw = 1.0;

-- ---------------------------------------------------------------------------
-- 5. Data fix — re-align cables.standard with insulation
-- ---------------------------------------------------------------------------
-- The /api/cable-schedule/commit importer stamped 'SANS 1507-4' on every
-- cable regardless of insulation; the entity actions use the correct
-- mapping (cable-entities.actions.ts:801-803):
--   XLPE → 'SANS 1507-4', PVC → 'SANS 1507-3', PILC → 'SANS 97'.
-- Runs as the migration role, so the §3 triggers (authenticated/anon only)
-- do not block the rows that belong to ISSUED revisions. Idempotent.
UPDATE cable_schedule.cables
SET standard = 'SANS 1507-3'
WHERE insulation = 'PVC'  AND standard IS DISTINCT FROM 'SANS 1507-3';

UPDATE cable_schedule.cables
SET standard = 'SANS 1507-4'
WHERE insulation = 'XLPE' AND standard IS DISTINCT FROM 'SANS 1507-4';

UPDATE cable_schedule.cables
SET standard = 'SANS 97'
WHERE insulation = 'PILC' AND standard IS DISTINCT FROM 'SANS 97';

NOTIFY pgrst, 'reload schema';
