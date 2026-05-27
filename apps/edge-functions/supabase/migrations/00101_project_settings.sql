-- =============================================================================
-- Migration: 00101_project_settings.sql
-- Description: projects.project_settings — 1:1 with projects.projects.
--              Holds new operational/contract/notification settings that don't
--              have a home in the existing projects.projects columns.
-- Spec: SPEC DOCS/2026-05-26-project-settings-design.md §5.1
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.project_settings
-- ---------------------------------------------------------------------------
CREATE TABLE projects.project_settings (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id                      uuid NOT NULL UNIQUE
                                      REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id                 uuid NOT NULL
                                      REFERENCES public.organisations(id),

    -- Operational defaults
    working_days                    int[]   NOT NULL DEFAULT ARRAY[1,2,3,4,5],
    holiday_calendar                text    NOT NULL DEFAULT 'ZA',
    extra_holidays                  date[]  NOT NULL DEFAULT ARRAY[]::date[],
    builders_holiday                boolean NOT NULL DEFAULT true,
    units                           text    NOT NULL DEFAULT 'metric'
                                      CHECK (units IN ('metric','imperial')),
    date_format                     text    NOT NULL DEFAULT 'YYYY-MM-DD',
    default_rfi_priority            text    NOT NULL DEFAULT 'medium'
                                      CHECK (default_rfi_priority IN ('low','medium','high','critical')),
    default_rfi_assignee_id         uuid    REFERENCES public.profiles(id),
    default_rfi_due_days            int     NOT NULL DEFAULT 7 CHECK (default_rfi_due_days > 0),
    default_inspection_template_id  uuid,   -- cross-schema FK to inspections.templates added in a later migration

    -- Contract
    contract_type                   text    NOT NULL DEFAULT 'jbcc_pba'
                                      CHECK (contract_type IN
                                        ('jbcc_pba','jbcc_mwa','nec3','nec4','fidic_red','custom','none')),
    contract_signed_date            date,
    practical_completion_date       date,
    retention_pct                   numeric(5,2) NOT NULL DEFAULT 5.0
                                      CHECK (retention_pct >= 0 AND retention_pct <= 100),

    -- Notifications
    notify_rfi_email                boolean NOT NULL DEFAULT true,
    notify_rfi_to                   text[]  NOT NULL DEFAULT ARRAY[]::text[],
    notify_inspection_email         boolean NOT NULL DEFAULT false,

    -- Audit cols
    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),
    updated_by                      uuid REFERENCES public.profiles(id)
);

CREATE INDEX project_settings_org_idx
    ON projects.project_settings (organisation_id);

CREATE TRIGGER project_settings_set_updated_at
    BEFORE UPDATE ON projects.project_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE projects.project_settings ENABLE ROW LEVEL SECURITY;

-- READ: any active member of the organisation
CREATE POLICY project_settings_select
    ON projects.project_settings
    FOR SELECT USING (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
        )
    );

-- WRITE: owner / admin / project_manager (route handlers narrow further per sub-page)
CREATE POLICY project_settings_write
    ON projects.project_settings
    FOR ALL USING (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
              AND role IN ('owner','admin','project_manager')
        )
    );

-- Refresh the PostgREST schema cache so the new table is queryable via REST.
NOTIFY pgrst, 'reload schema';
