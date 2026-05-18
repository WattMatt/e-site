-- =============================================================================
-- Migration 00063 — Firm-wide rate library (B5 from cable-schedule audit)
-- =============================================================================
-- Background:
--   cost_lines stores rates per (revision, size, conductor). Engineers
--   currently re-type rates on every new revision (or rely on the seed-
--   from-previous-revision logic added in 6715a58). No firm-wide source
--   of truth exists, so:
--     * A new project starts with zero rates (engineer types them)
--     * Rate changes (e.g. supplier price hike) require touching every
--       active project's latest revision
--     * Two engineers on the same firm may use different rates for the
--       same cable size
--
--   This adds cable_schedule.rate_library — one row per (org, size,
--   conductor). New revisions seed their cost_lines from the library
--   on revision create (handled in T4 of this build). Per-revision
--   cost_lines remain editable so projects with negotiated supplier
--   pricing can override without disturbing the firm baseline.
--
-- RLS:
--   * SELECT: org members can read their org's rates
--   * INSERT/UPDATE/DELETE: owner/admin/project_manager only
--   * client_viewer / field_worker: no write access
--
-- Compatibility:
--   * Zero impact on existing data — pure additive
--   * cost_lines unchanged; the seeding integration in T4 will fall back
--     to copy-from-previous-revision when the library is empty
-- =============================================================================

CREATE TABLE IF NOT EXISTS cable_schedule.rate_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    size_mm2 NUMERIC NOT NULL CHECK (size_mm2 > 0),
    conductor TEXT NOT NULL CHECK (conductor IN ('CU', 'AL')),
    supply_rate_per_m NUMERIC NOT NULL DEFAULT 0 CHECK (supply_rate_per_m >= 0),
    install_rate_per_m NUMERIC NOT NULL DEFAULT 0 CHECK (install_rate_per_m >= 0),
    termination_rate_each NUMERIC NOT NULL DEFAULT 0 CHECK (termination_rate_each >= 0),
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One rate per (org, size, conductor)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'cable_schedule'
          AND t.relname = 'rate_library'
          AND c.conname = 'rate_library_org_size_conductor_key'
    ) THEN
        ALTER TABLE cable_schedule.rate_library
            ADD CONSTRAINT rate_library_org_size_conductor_key
                UNIQUE (organisation_id, size_mm2, conductor);
    END IF;
END $$;

-- Index for the common lookup: get all rates for an org, ordered by size
CREATE INDEX IF NOT EXISTS rate_library_org_size_idx
    ON cable_schedule.rate_library (organisation_id, size_mm2, conductor);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE cable_schedule.rate_library ENABLE ROW LEVEL SECURITY;

-- SELECT: any org member
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'cable_schedule'
          AND tablename = 'rate_library'
          AND policyname = 'rate_library_select_org_members'
    ) THEN
        CREATE POLICY rate_library_select_org_members ON cable_schedule.rate_library
            FOR SELECT
            USING (
                organisation_id IN (
                    SELECT organisation_id FROM public.user_organisations
                    WHERE user_id = auth.uid() AND is_active = true
                )
            );
    END IF;
END $$;

-- INSERT/UPDATE/DELETE: owner/admin/project_manager only
-- (one combined permissive policy per command; client_viewer + field_worker
-- excluded by the role check)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'cable_schedule'
          AND tablename = 'rate_library'
          AND policyname = 'rate_library_insert_admin'
    ) THEN
        CREATE POLICY rate_library_insert_admin ON cable_schedule.rate_library
            FOR INSERT
            WITH CHECK (
                organisation_id IN (
                    SELECT organisation_id FROM public.user_organisations
                    WHERE user_id = auth.uid()
                      AND is_active = true
                      AND role IN ('owner', 'admin', 'project_manager')
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'cable_schedule'
          AND tablename = 'rate_library'
          AND policyname = 'rate_library_update_admin'
    ) THEN
        CREATE POLICY rate_library_update_admin ON cable_schedule.rate_library
            FOR UPDATE
            USING (
                organisation_id IN (
                    SELECT organisation_id FROM public.user_organisations
                    WHERE user_id = auth.uid()
                      AND is_active = true
                      AND role IN ('owner', 'admin', 'project_manager')
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'cable_schedule'
          AND tablename = 'rate_library'
          AND policyname = 'rate_library_delete_admin'
    ) THEN
        CREATE POLICY rate_library_delete_admin ON cable_schedule.rate_library
            FOR DELETE
            USING (
                organisation_id IN (
                    SELECT organisation_id FROM public.user_organisations
                    WHERE user_id = auth.uid()
                      AND is_active = true
                      AND role IN ('owner', 'admin', 'project_manager')
                )
            );
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cable_schedule.rate_library TO authenticated;

NOTIFY pgrst, 'reload schema';
