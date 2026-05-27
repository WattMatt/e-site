-- =============================================================================
-- Migration: 00102_project_settings_history.sql
-- Description: Append-only audit log for projects.project_settings.
--              Whole-row snapshot in `snapshot`, column-level diff in `diff`.
--              Trigger writes via SECURITY DEFINER, bypassing the no-direct-
--              write RLS policy.
-- Spec: SPEC DOCS/2026-05-26-project-settings-design.md §5.2
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.project_settings_history
-- ---------------------------------------------------------------------------
CREATE TABLE projects.project_settings_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id uuid NOT NULL REFERENCES public.organisations(id),
    operation       text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    snapshot        jsonb NOT NULL,
    diff            jsonb,
    changed_by      uuid REFERENCES public.profiles(id),
    changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_settings_history_project_at
    ON projects.project_settings_history (project_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Audit trigger function — captures snapshot + diff per change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.project_settings_audit() RETURNS trigger AS $$
DECLARE
    v_diff jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(key, jsonb_build_array(old_val, new_val))
          INTO v_diff
          FROM (
              SELECT key,
                     to_jsonb(OLD) -> key AS old_val,
                     to_jsonb(NEW) -> key AS new_val
              FROM jsonb_object_keys(to_jsonb(NEW)) AS key
          ) d
          WHERE old_val IS DISTINCT FROM new_val
            AND key NOT IN ('updated_at');
    END IF;

    INSERT INTO projects.project_settings_history
        (project_id, organisation_id, operation, snapshot, diff, changed_by)
    VALUES (
        COALESCE(NEW.project_id, OLD.project_id),
        COALESCE(NEW.organisation_id, OLD.organisation_id),
        TG_OP,
        to_jsonb(COALESCE(NEW, OLD)),
        v_diff,
        COALESCE(NEW.updated_by, OLD.updated_by)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = projects, public;

CREATE TRIGGER project_settings_audit_trg
    AFTER INSERT OR UPDATE OR DELETE ON projects.project_settings
    FOR EACH ROW EXECUTE FUNCTION projects.project_settings_audit();

-- ---------------------------------------------------------------------------
-- RLS — read-only for org members; trigger writes bypass via SECURITY DEFINER
-- ---------------------------------------------------------------------------
ALTER TABLE projects.project_settings_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_settings_history_select
    ON projects.project_settings_history
    FOR SELECT USING (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
        )
    );

-- Deliberately no INSERT/UPDATE/DELETE policies — trigger writes via SECURITY
-- DEFINER, users cannot write history rows directly.

NOTIFY pgrst, 'reload schema';
