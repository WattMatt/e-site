-- =============================================================================
-- Migration 00092 — Re-scope rate library from organisation to project
-- =============================================================================
-- Background:
--   00063 added cable_schedule.rate_library as a FIRM-WIDE (organisation-
--   scoped) default price list. In practice cable rates are negotiated per
--   project, so the library is re-scoped to the project level: each project
--   owns its rate sheet, which seeds that project's cable-schedule revisions.
--
--   The editor moves from /settings/cable-schedule/rates (global) to
--   /projects/<id>/cables/rates (per-project, admin-gated).
--
-- Scope change:
--   * Add project_id (NOT NULL, FK -> projects.projects, cascade delete)
--   * UNIQUE + lookup index move from (organisation_id, ...) to
--     (project_id, size_mm2, conductor)
--   * organisation_id is KEPT as a denormalised column so RLS stays
--     org-based (the same model as cost_lines) — project_id is the
--     functional scope, not a security boundary, so the four 00063 RLS
--     policies are left unchanged.
--
-- Data:
--   * rate_library is empty on production at migration time (0 rows) — a
--     clean re-scope. The DELETE below is a belt-and-braces no-op that also
--     keeps the migration safe on any environment that populated the table
--     before this ran (org-scoped rows cannot be mapped to a project).
-- =============================================================================

-- 1. Add project_id (nullable first — safe regardless of existing rows).
ALTER TABLE cable_schedule.rate_library
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES projects.projects(id) ON DELETE CASCADE;

-- 2. Pre-existing org-scoped rows cannot be mapped to a project. Clear them
--    so project_id can be made NOT NULL. No-op when the table is empty.
DELETE FROM cable_schedule.rate_library WHERE project_id IS NULL;

-- 3. Enforce NOT NULL.
ALTER TABLE cable_schedule.rate_library
    ALTER COLUMN project_id SET NOT NULL;

-- 4. Swap the UNIQUE constraint:
--    (organisation_id, size, conductor) -> (project_id, size, conductor).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'cable_schedule'
          AND t.relname = 'rate_library'
          AND c.conname = 'rate_library_org_size_conductor_key'
    ) THEN
        ALTER TABLE cable_schedule.rate_library
            DROP CONSTRAINT rate_library_org_size_conductor_key;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'cable_schedule'
          AND t.relname = 'rate_library'
          AND c.conname = 'rate_library_project_size_conductor_key'
    ) THEN
        ALTER TABLE cable_schedule.rate_library
            ADD CONSTRAINT rate_library_project_size_conductor_key
                UNIQUE (project_id, size_mm2, conductor);
    END IF;
END $$;

-- 5. Drop the old org-based lookup index. No replacement needed — the new
--    UNIQUE constraint's backing index on (project_id, size_mm2, conductor)
--    already serves the "all rates for a project, ordered by size" lookup.
DROP INDEX IF EXISTS cable_schedule.rate_library_org_size_idx;

-- =============================================================================
-- RLS — unchanged.
--   organisation_id is retained, so the four policies from 00063 (select:
--   org members; insert/update/delete: owner/admin/project_manager) remain
--   correct. project_id is the functional scope; the app filters on it.
-- =============================================================================

NOTIFY pgrst, 'reload schema';
