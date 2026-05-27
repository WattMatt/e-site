-- =============================================================================
-- Migration: 00104_project_settings_audit_skip_delete.sql
-- Description: Fix project_settings_audit() so cascade-deletes from
--              projects.projects no longer hit a FK violation on the
--              history table.
--
-- Background: 00102 defined the trigger to write a history row on every
-- INSERT/UPDATE/DELETE of projects.project_settings. When a parent project
-- row is deleted, PG cascades to project_settings → trigger fires → tries
-- to INSERT a history row whose project_id FKs back to projects.projects.
-- The parent is already being purged in the same statement, so the FK
-- check fails with:
--
--   ERROR: insert or update on table "project_settings_history" violates
--          foreign key constraint "project_settings_history_project_id_fkey"
--
-- Fix: skip the history INSERT entirely when TG_OP = 'DELETE'. The
-- history.project_id FK is itself ON DELETE CASCADE (see 00102), so even
-- if the INSERT succeeded the whole history for this project would be
-- purged in the same transaction — capturing the DELETE event has zero
-- net value. The trade-off is no audit row for the project-purge event
-- itself, which is acceptable: project_settings is 1:1 with projects and
-- the only realistic DELETE path is the cascade.
-- =============================================================================

CREATE OR REPLACE FUNCTION projects.project_settings_audit() RETURNS trigger AS $$
DECLARE
    v_diff jsonb;
BEGIN
    -- Cascade-delete from projects.projects would otherwise fail the FK
    -- check on project_settings_history.project_id (parent already being
    -- purged in the same statement). History for this project will be
    -- CASCADE-purged anyway, so the DELETE event is not worth recording.
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

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
        NEW.project_id,
        NEW.organisation_id,
        TG_OP,
        to_jsonb(NEW),
        v_diff,
        NEW.updated_by
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = projects, public;

NOTIFY pgrst, 'reload schema';
