-- ---------------------------------------------------------------------------
-- Migration 00261: Programme (project programme) — schema, tables, bind triggers
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claimed at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR. If 00261 is taken,
-- renumber this file above the head. Claiming a number is not holding it: the
-- head moves when someone APPLIES.
--
-- Spec: docs/superpowers/specs/2026-11-16-project-programme-design.md
-- (§4.1 principles, §4.2 data model). Plan:
-- docs/superpowers/plans/2026-11-17-programme-p2-schema.md.
--
-- WHAT (this part: sections 0-3; later sections are appended by later tasks).
--   0. Schema `programme`.
--   1. Tables. The core tables P2 writes, plus the tables later phases fill, so
--      P3-P8 need no schema change for them. Rand figures live ONLY in the
--      four cost tables (resource_rates, assignment_costs, baseline_costs,
--      progress_period_costs) so a later SELECT policy can mask them by table.
--   2. Bind triggers. project_id / organisation_id / programme_id are DERIVED
--      from the parent and never trusted from the caller; they cannot change
--      on UPDATE; updated_at is clock_timestamp() (strictly increasing, it is
--      the optimistic-concurrency token). Links refuse another programme.
--   3. Row level security ENABLED and FORCED on every table, with no policy:
--      deny by default. Policies, grants and write functions are added by
--      later sections.
--
-- A new schema needs a PostgREST db_schema PATCH AFTER apply (never before:
-- PGRST002). That is a runbook step, not part of this file.
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: programme.programmes
-- table: programme.calendars
-- table: programme.calendar_exceptions
-- table: programme.activities
-- table: programme.dependencies
-- table: programme.code_types
-- table: programme.code_values
-- table: programme.activity_codes
-- table: programme.resources
-- table: programme.resource_rates
-- table: programme.resource_assignments
-- table: programme.assignment_costs
-- table: programme.baselines
-- table: programme.baseline_activities
-- table: programme.baseline_dependencies
-- table: programme.baseline_costs
-- table: programme.progress_periods
-- table: programme.progress_period_costs
-- table: programme.field_updates
-- table: programme.imports
-- table: programme.audit
-- constraint: programmes_module_key_iff_module ON programme.programmes
-- constraint: programmes_contractor_label_iff_contractor ON programme.programmes
-- constraint: programmes_default_calendar_fk ON programme.programmes
-- constraint: activities_milestone_zero_duration ON programme.activities
-- constraint: activities_actual_finish_after_start ON programme.activities
-- constraint: activities_constraint_needs_date ON programme.activities
-- constraint: activities_fixed_dates_module_summary ON programme.activities
-- constraint: activities_anchor_shape ON programme.activities
-- constraint: dependencies_not_self ON programme.dependencies
-- constraint: dependencies_pair_unique ON programme.dependencies
-- index: programmes_one_project_idx ON programme.programmes
-- index: programmes_one_module_idx ON programme.programmes
-- index: programmes_one_contractor_idx ON programme.programmes
-- index: activities_programme_sort_idx ON programme.activities
-- index: activities_external_uid_idx ON programme.activities
-- index: baselines_one_active_idx ON programme.baselines
-- function: programme.programmes_bind()
-- function: programme.child_bind()
-- function: programme.org_child_bind()
-- function: programme.touch()
-- function: programme.stamp()
-- function: programme.activities_refs()
-- function: programme.dependencies_refs()
-- function: programme.activity_codes_refs()
-- function: programme.resource_assignments_refs()
-- function: programme.field_updates_refs()
-- function: programme.audit_bind()
-- trigger: programmes_bind ON programme.programmes
-- trigger: programmes_stamp ON programme.programmes
-- trigger: calendars_bind ON programme.calendars
-- trigger: calendar_exceptions_bind ON programme.calendar_exceptions
-- trigger: activities_bind ON programme.activities
-- trigger: activities_refs ON programme.activities
-- trigger: activities_stamp ON programme.activities
-- trigger: dependencies_bind ON programme.dependencies
-- trigger: dependencies_refs ON programme.dependencies
-- trigger: code_types_bind ON programme.code_types
-- trigger: code_values_bind ON programme.code_values
-- trigger: activity_codes_bind ON programme.activity_codes
-- trigger: activity_codes_refs ON programme.activity_codes
-- trigger: resource_rates_bind ON programme.resource_rates
-- trigger: resource_assignments_bind ON programme.resource_assignments
-- trigger: resource_assignments_refs ON programme.resource_assignments
-- trigger: assignment_costs_bind ON programme.assignment_costs
-- trigger: baselines_bind ON programme.baselines
-- trigger: baseline_activities_bind ON programme.baseline_activities
-- trigger: baseline_dependencies_bind ON programme.baseline_dependencies
-- trigger: baseline_costs_bind ON programme.baseline_costs
-- trigger: progress_periods_bind ON programme.progress_periods
-- trigger: progress_period_costs_bind ON programme.progress_period_costs
-- trigger: field_updates_bind ON programme.field_updates
-- trigger: field_updates_refs ON programme.field_updates
-- trigger: imports_bind ON programme.imports
-- trigger: audit_bind ON programme.audit
-- function: programme.imports_refs()
-- function: programme.attrib()
-- trigger: imports_refs ON programme.imports
-- trigger: baselines_attrib ON programme.baselines
-- trigger: progress_periods_attrib ON programme.progress_periods
-- trigger: imports_attrib ON programme.imports
-- trigger: field_updates_attrib ON programme.field_updates
-- sql: (SELECT count(*) = 21 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'programme' AND c.relkind = 'r')
-- @verify:end

-- ── 0. Schema ───────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS programme;
GRANT USAGE ON SCHEMA programme TO authenticated, service_role;

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE programme.programmes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    kind                TEXT NOT NULL CHECK (kind IN ('project','module','contractor')),
    module_key          TEXT CHECK (module_key IN ('solar')),
    contractor_label    TEXT CHECK (contractor_label IS NULL OR (char_length(btrim(contractor_label)) BETWEEN 1 AND 120)),
    scheduling_rules    TEXT NOT NULL DEFAULT 'msp' CHECK (scheduling_rules IN ('msp','p6')),
    name                TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    project_start       DATE NOT NULL,
    data_date           DATE,
    default_calendar_id UUID,                      -- FK added below, deferrable, set after seeding
    options             JSONB NOT NULL DEFAULT '{"progress":"retained_logic","critical":{"kind":"total_float","threshold":0},"floatOn":"finish"}'::jsonb,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    project_finish      DATE,                      -- computed cache
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT programmes_module_key_iff_module CHECK ((kind = 'module') = (module_key IS NOT NULL)),
    CONSTRAINT programmes_contractor_label_iff_contractor CHECK ((kind = 'contractor') = (contractor_label IS NOT NULL))
);
CREATE UNIQUE INDEX programmes_one_project_idx ON programme.programmes (project_id) WHERE kind = 'project';
CREATE UNIQUE INDEX programmes_one_module_idx ON programme.programmes (project_id, module_key) WHERE kind = 'module';
CREATE UNIQUE INDEX programmes_one_contractor_idx ON programme.programmes (project_id, lower(contractor_label)) WHERE kind = 'contractor';

CREATE TABLE programme.calendars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    variant         TEXT NOT NULL CHECK (variant IN ('site','office','custom')),
    work_weekdays   SMALLINT[] NOT NULL CHECK (cardinality(work_weekdays) BETWEEN 1 AND 7 AND work_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    hours_per_day   NUMERIC(4,2) NOT NULL CHECK (hours_per_day > 0 AND hours_per_day <= 24),
    coverage_from   DATE,
    coverage_to     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX calendars_programme_idx ON programme.calendars (programme_id);

ALTER TABLE programme.programmes
    ADD CONSTRAINT programmes_default_calendar_fk FOREIGN KEY (default_calendar_id)
    REFERENCES programme.calendars(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE programme.calendar_exceptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id     UUID NOT NULL REFERENCES programme.calendars(id) ON DELETE CASCADE,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    day             DATE NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('non_work','work')),
    label           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (calendar_id, day)
);
CREATE INDEX calendar_exceptions_programme_idx ON programme.calendar_exceptions (programme_id);

CREATE TABLE programme.activities (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id            UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    parent_id               UUID REFERENCES programme.activities(id) ON DELETE RESTRICT,
    wbs_code                TEXT,
    code                    TEXT CHECK (code IS NULL OR char_length(code) <= 40),
    name                    TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 300),
    type                    TEXT NOT NULL CHECK (type IN ('task','start_milestone','finish_milestone','summary','level_of_effort','module_summary')),
    original_duration       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (original_duration >= 0),
    remaining_duration      NUMERIC(10,2) CHECK (remaining_duration IS NULL OR remaining_duration >= 0),
    calendar_id             UUID REFERENCES programme.calendars(id) ON DELETE SET NULL,
    constraint_type         TEXT CHECK (constraint_type IN ('snet','snlt','fnet','fnlt','mso','mfo','alap')),
    constraint_date         DATE,
    deadline                DATE,
    actual_start            DATE,
    actual_finish           DATE,
    percent_complete        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
    percent_complete_type   TEXT NOT NULL DEFAULT 'duration' CHECK (percent_complete_type IN ('duration','physical','units')),
    fixed_start             DATE,
    fixed_finish            DATE,
    -- computed cache (written by the recalculation, never by hand)
    early_start             DATE,
    early_finish            DATE,
    late_start              DATE,
    late_finish             DATE,
    total_float             NUMERIC(10,2),
    free_float              NUMERIC(10,2),
    is_critical             BOOLEAN NOT NULL DEFAULT false,
    is_driving              BOOLEAN NOT NULL DEFAULT false,
    sort_order              INTEGER,
    external_uid            TEXT,
    anchor                  TEXT,
    work_item_id            UUID REFERENCES projects.work_items(id) ON DELETE SET NULL,
    is_tombstoned           BOOLEAN NOT NULL DEFAULT false,
    created_by              UUID REFERENCES auth.users(id),
    updated_by              UUID REFERENCES auth.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT activities_milestone_zero_duration CHECK (type NOT IN ('start_milestone','finish_milestone') OR original_duration = 0),
    CONSTRAINT activities_actual_finish_after_start CHECK (actual_finish IS NULL OR actual_start IS NULL OR actual_finish >= actual_start),
    CONSTRAINT activities_constraint_needs_date CHECK (constraint_type IS NULL OR constraint_type = 'alap' OR constraint_date IS NOT NULL),
    CONSTRAINT activities_fixed_dates_module_summary CHECK ((fixed_start IS NULL AND fixed_finish IS NULL) OR type = 'module_summary'),
    CONSTRAINT activities_anchor_shape CHECK (anchor IS NULL OR anchor ~ '^(opening_date|practical_completion|tenant_bo:[0-9a-f-]{36}|inspection:[0-9a-f-]{36})$')
);
CREATE INDEX activities_programme_sort_idx ON programme.activities (programme_id, sort_order);
CREATE UNIQUE INDEX activities_external_uid_idx ON programme.activities (programme_id, external_uid) WHERE external_uid IS NOT NULL;
CREATE INDEX activities_parent_idx ON programme.activities (parent_id);
CREATE INDEX activities_work_item_idx ON programme.activities (work_item_id) WHERE work_item_id IS NOT NULL;

CREATE TABLE programme.dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    pred_id         UUID NOT NULL REFERENCES programme.activities(id) ON DELETE CASCADE,
    succ_id         UUID NOT NULL REFERENCES programme.activities(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('FS','SS','FF','SF')),
    lag             NUMERIC(10,2) NOT NULL DEFAULT 0,
    lag_unit        TEXT NOT NULL DEFAULT 'working_days' CHECK (lag_unit IN ('working_days','elapsed_days','percent')),
    lag_calendar    TEXT NOT NULL DEFAULT 'pred' CHECK (lag_calendar IN ('pred','succ','project')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dependencies_not_self CHECK (pred_id <> succ_id),
    CONSTRAINT dependencies_pair_unique UNIQUE (pred_id, succ_id, type)
);
CREATE INDEX dependencies_programme_idx ON programme.dependencies (programme_id);
CREATE INDEX dependencies_succ_idx ON programme.dependencies (succ_id);

CREATE TABLE programme.code_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    sort_order      INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX code_types_name_idx ON programme.code_types (programme_id, lower(name));

CREATE TABLE programme.code_values (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_type_id     UUID NOT NULL REFERENCES programme.code_types(id) ON DELETE CASCADE,
    programme_id     UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    value            TEXT NOT NULL CHECK (char_length(btrim(value)) BETWEEN 1 AND 60),
    description      TEXT,
    colour           TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-f]{6}$'),
    organisation_tag UUID REFERENCES public.organisations(id),
    user_tag         UUID REFERENCES auth.users(id),     -- the field-update tag (spec 4.6)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX code_values_type_idx ON programme.code_values (code_type_id);
CREATE INDEX code_values_programme_idx ON programme.code_values (programme_id);

CREATE TABLE programme.activity_codes (
    activity_id     UUID NOT NULL REFERENCES programme.activities(id) ON DELETE CASCADE,
    code_type_id    UUID NOT NULL REFERENCES programme.code_types(id) ON DELETE CASCADE,
    code_value_id   UUID NOT NULL REFERENCES programme.code_values(id) ON DELETE CASCADE,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, code_type_id)
);
CREATE INDEX activity_codes_programme_idx ON programme.activity_codes (programme_id);
CREATE INDEX activity_codes_value_idx ON programme.activity_codes (code_value_id);

-- Org-level resource library: organisation only, no project.
CREATE TABLE programme.resources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    kind            TEXT NOT NULL CHECK (kind IN ('labour','plant','material')),
    max_units       NUMERIC,
    unit            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resources_org_idx ON programme.resources (organisation_id);

-- COST TABLE: the resource's rate in rands.
CREATE TABLE programme.resource_rates (
    resource_id     UUID PRIMARY KEY REFERENCES programme.resources(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    rate            NUMERIC(14,2) NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'ZAR',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE programme.resource_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    activity_id     UUID NOT NULL REFERENCES programme.activities(id) ON DELETE CASCADE,
    resource_id     UUID NOT NULL REFERENCES programme.resources(id) ON DELETE RESTRICT,
    units_per_day   NUMERIC,
    budgeted_qty    NUMERIC,
    actual_qty      NUMERIC,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (activity_id, resource_id)
);
CREATE INDEX resource_assignments_programme_idx ON programme.resource_assignments (programme_id);

-- COST TABLE
CREATE TABLE programme.assignment_costs (
    assignment_id   UUID PRIMARY KEY REFERENCES programme.resource_assignments(id) ON DELETE CASCADE,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    budgeted_cost   NUMERIC(16,2),
    actual_cost     NUMERIC(16,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assignment_costs_programme_idx ON programme.assignment_costs (programme_id);

CREATE TABLE programme.baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    is_active       BOOLEAN NOT NULL DEFAULT false,
    source          TEXT NOT NULL CHECK (source IN ('manual','import')),
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX baselines_one_active_idx ON programme.baselines (programme_id) WHERE is_active;

CREATE TABLE programme.baseline_activities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_id         UUID NOT NULL REFERENCES programme.baselines(id) ON DELETE CASCADE,
    programme_id        UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    activity_id         UUID NOT NULL,                     -- no FK: the activity may be deleted later
    name                TEXT,
    type                TEXT,
    parent_id           UUID,
    wbs_code            TEXT,
    code                TEXT,
    original_duration   NUMERIC(10,2),
    remaining_duration  NUMERIC(10,2),
    early_start         DATE,
    early_finish        DATE,
    late_start          DATE,
    late_finish         DATE,
    total_float         NUMERIC(10,2),
    free_float          NUMERIC(10,2),
    percent_complete    NUMERIC(5,2),
    sort_order          INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (baseline_id, activity_id)
);
CREATE INDEX baseline_activities_programme_idx ON programme.baseline_activities (programme_id);

CREATE TABLE programme.baseline_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_id     UUID NOT NULL REFERENCES programme.baselines(id) ON DELETE CASCADE,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    pred_id         UUID NOT NULL,
    succ_id         UUID NOT NULL,
    type            TEXT,
    lag             NUMERIC(10,2),
    lag_unit        TEXT,
    lag_calendar    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX baseline_dependencies_baseline_idx ON programme.baseline_dependencies (baseline_id);
CREATE INDEX baseline_dependencies_programme_idx ON programme.baseline_dependencies (programme_id);

-- COST TABLE
CREATE TABLE programme.baseline_costs (
    baseline_id     UUID NOT NULL REFERENCES programme.baselines(id) ON DELETE CASCADE,
    activity_id     UUID NOT NULL,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    budgeted_cost   NUMERIC(16,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (baseline_id, activity_id)
);
CREATE INDEX baseline_costs_programme_idx ON programme.baseline_costs (programme_id);

CREATE TABLE programme.progress_periods (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id     UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    data_date        DATE NOT NULL,
    percent_complete NUMERIC(5,2),
    planned_percent  NUMERIC(5,2),
    spi              NUMERIC(8,4),
    per_activity     JSONB,                     -- non-rand values only
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (programme_id, data_date)
);

-- COST TABLE
CREATE TABLE programme.progress_period_costs (
    period_id       UUID PRIMARY KEY REFERENCES programme.progress_periods(id) ON DELETE CASCADE,
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    pv              NUMERIC(16,2),
    ev              NUMERIC(16,2),
    ac              NUMERIC(16,2),
    per_activity    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX progress_period_costs_programme_idx ON programme.progress_period_costs (programme_id);

CREATE TABLE programme.field_updates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id        UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    activity_id         UUID NOT NULL REFERENCES programme.activities(id) ON DELETE CASCADE,
    author_id           UUID NOT NULL REFERENCES auth.users(id),
    reported_start      DATE,
    reported_finish     DATE,
    reported_percent    NUMERIC(5,2),
    reported_remaining  NUMERIC(10,2),
    note                TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
    photo_path          TEXT,
    status              TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','applied','adjusted','rejected')),
    decided_by          UUID REFERENCES auth.users(id),
    decided_at          TIMESTAMPTZ,
    decision_note       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX field_updates_programme_idx ON programme.field_updates (programme_id, status);
CREATE INDEX field_updates_activity_idx ON programme.field_updates (activity_id);

CREATE TABLE programme.imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID NOT NULL REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    format          TEXT NOT NULL CHECK (format IN ('mspdi','xer','csv','xlsx')),
    file_path       TEXT,
    file_name       TEXT,
    mapping         JSONB,
    diff            JSONB,
    revision_label  TEXT,
    baseline_id     UUID REFERENCES programme.baselines(id) ON DELETE SET NULL,
    imported_by     UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX imports_programme_idx ON programme.imports (programme_id);

-- programme_id is NULL for org-level writes (the resource library); then
-- project_id is NULL too and organisation_id is set by the definer function.
CREATE TABLE programme.audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id    UUID REFERENCES programme.programmes(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    actor_id        UUID,
    verb            TEXT NOT NULL,
    object_ref      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_programme_idx ON programme.audit (programme_id, created_at);

-- ── 2. Bind triggers (SECURITY DEFINER, search_path '', 00213 pattern) ──────
-- BEFORE-row order is alphabetical by trigger name: <table>_bind (derive +
-- immutables) runs before <table>_refs (cross-row checks) before the
-- <table>_stamp / <table>_touch trigger.

-- A programme takes its organisation from its project; the caller's value is
-- ignored.
CREATE OR REPLACE FUNCTION programme.programmes_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id <> OLD.project_id THEN
            RAISE EXCEPTION 'programme.programmes: a programme cannot move to another project' USING ERRCODE = '42501';
        END IF;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = NEW.project_id;
        IF v_org IS NULL THEN
            RAISE EXCEPTION 'programme.programmes: project % not found', NEW.project_id USING ERRCODE = '23503';
        END IF;
        NEW.organisation_id := v_org;
    END IF;
    -- The default calendar must be one of THIS programme's own calendars (so on
    -- INSERT it must be NULL: it is set after the calendars are seeded).
    IF NEW.default_calendar_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM programme.calendars c WHERE c.id = NEW.default_calendar_id AND c.programme_id = NEW.id) THEN
        RAISE EXCEPTION 'The default calendar must be a calendar of this programme' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER programmes_bind BEFORE INSERT OR UPDATE ON programme.programmes
    FOR EACH ROW EXECUTE FUNCTION programme.programmes_bind();

-- Shared by every table that carries programme_id + project_id + organisation_id.
--   TG_ARGV[0] / TG_ARGV[1] (optional): the parent table and the column that
--   names it. When given, programme_id is DERIVED from that parent row and the
--   parent column is immutable. When absent, the supplied programme_id is
--   checked to exist. In both cases project_id and organisation_id come from
--   the programme, never from the caller.
CREATE OR REPLACE FUNCTION programme.child_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_prog UUID; v_project UUID; v_org UUID; v_parent_val UUID; v_new JSONB := to_jsonb(NEW);
BEGIN
    IF TG_NARGS = 2 THEN
        v_parent_val := (v_new ->> TG_ARGV[1])::uuid;
        EXECUTE format('SELECT programme_id FROM programme.%I WHERE id = $1', TG_ARGV[0]) INTO v_prog USING v_parent_val;
        IF v_prog IS NULL THEN
            RAISE EXCEPTION 'programme.%: parent % not found', TG_TABLE_NAME, v_parent_val USING ERRCODE = '23503';
        END IF;
        NEW.programme_id := v_prog;
    ELSE
        v_prog := NEW.programme_id;
    END IF;
    SELECT g.project_id, g.organisation_id INTO v_project, v_org FROM programme.programmes g WHERE g.id = v_prog;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'programme.%: programme % not found', TG_TABLE_NAME, v_prog USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.programme_id <> OLD.programme_id
           OR (TG_NARGS = 2 AND (to_jsonb(OLD) ->> TG_ARGV[1]) IS DISTINCT FROM (v_new ->> TG_ARGV[1])) THEN
            RAISE EXCEPTION 'programme.%: a row cannot move to another programme or parent', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.project_id := v_project;
    NEW.organisation_id := v_org;
    RETURN NEW;
END $$;

-- resource_rates: organisation comes from its resource.
CREATE OR REPLACE FUNCTION programme.org_child_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID;
BEGIN
    SELECT r.organisation_id INTO v_org FROM programme.resources r WHERE r.id = NEW.resource_id;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'programme.%: resource % not found', TG_TABLE_NAME, NEW.resource_id USING ERRCODE = '23503';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.resource_id <> OLD.resource_id THEN
            RAISE EXCEPTION 'programme.%: a rate cannot move to another resource', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.organisation_id := v_org;
    RETURN NEW;
END $$;

-- updated_at only: strictly increasing, it is the optimistic-concurrency token.
CREATE OR REPLACE FUNCTION programme.touch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;

-- updated_at plus attribution bound to auth.uid(); created_by is immutable.
CREATE OR REPLACE FUNCTION programme.stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.created_by := OLD.created_by;
    ELSE
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;

-- Cross-row checks. Each refuses another programme with 22023.
CREATE OR REPLACE FUNCTION programme.activities_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM programme.activities a WHERE a.id = NEW.parent_id AND a.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The parent activity belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    IF NEW.calendar_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM programme.calendars c WHERE c.id = NEW.calendar_id AND c.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The calendar belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    IF NEW.work_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM projects.work_items w WHERE w.id = NEW.work_item_id AND w.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'The work item belongs to a different project' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION programme.dependencies_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF (SELECT count(*) FROM programme.activities a
         WHERE a.id IN (NEW.pred_id, NEW.succ_id) AND a.programme_id = NEW.programme_id)
       <> (CASE WHEN NEW.pred_id = NEW.succ_id THEN 1 ELSE 2 END) THEN
        RAISE EXCEPTION 'A link can only join two activities of the same programme' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION programme.activity_codes_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM programme.activities a WHERE a.id = NEW.activity_id AND a.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The activity belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM programme.code_values v
                    WHERE v.id = NEW.code_value_id AND v.code_type_id = NEW.code_type_id AND v.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The code value does not belong to that code type in this programme' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION programme.resource_assignments_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM programme.activities a WHERE a.id = NEW.activity_id AND a.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The activity belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM programme.resources r WHERE r.id = NEW.resource_id AND r.organisation_id = NEW.organisation_id) THEN
        RAISE EXCEPTION 'The resource belongs to a different organisation' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION programme.field_updates_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM programme.activities a WHERE a.id = NEW.activity_id AND a.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The activity belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

-- imports_refs: a baseline link must name a baseline of the same programme.
CREATE OR REPLACE FUNCTION programme.imports_refs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.baseline_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM programme.baselines b WHERE b.id = NEW.baseline_id AND b.programme_id = NEW.programme_id) THEN
        RAISE EXCEPTION 'The baseline belongs to a different programme' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$;

-- attrib(column): a person column is stamped from auth.uid() on INSERT when
-- there is a session (the service path may supply it) and is immutable on UPDATE.
CREATE OR REPLACE FUNCTION programme.attrib()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_col TEXT := TG_ARGV[0]; v_val TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_val := to_jsonb(OLD) ->> v_col;
    ELSIF auth.uid() IS NOT NULL THEN
        v_val := auth.uid()::text;
    ELSE
        RETURN NEW;
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_val));
    RETURN NEW;
END $$;

-- audit: append-only; programme_id optional (org-level writes). With a
-- programme, project and organisation are derived from it; without one the
-- definer function that writes it supplies the organisation.
CREATE OR REPLACE FUNCTION programme.audit_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_project UUID; v_org UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'programme.audit is append-only' USING ERRCODE = '42501';
    END IF;
    IF NEW.programme_id IS NOT NULL THEN
        SELECT g.project_id, g.organisation_id INTO v_project, v_org FROM programme.programmes g WHERE g.id = NEW.programme_id;
        IF v_project IS NULL THEN
            RAISE EXCEPTION 'programme.audit: programme % not found', NEW.programme_id USING ERRCODE = '23503';
        END IF;
        NEW.project_id := v_project;
        NEW.organisation_id := v_org;
    ELSE
        NEW.project_id := NULL;
    END IF;
    RETURN NEW;
END $$;

-- Triggers.
CREATE TRIGGER programmes_stamp BEFORE INSERT OR UPDATE ON programme.programmes
    FOR EACH ROW EXECUTE FUNCTION programme.stamp();

CREATE TRIGGER calendars_bind BEFORE INSERT OR UPDATE ON programme.calendars
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER calendars_touch BEFORE INSERT OR UPDATE ON programme.calendars
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER calendar_exceptions_bind BEFORE INSERT OR UPDATE ON programme.calendar_exceptions
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('calendars', 'calendar_id');
CREATE TRIGGER calendar_exceptions_touch BEFORE INSERT OR UPDATE ON programme.calendar_exceptions
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER activities_bind BEFORE INSERT OR UPDATE ON programme.activities
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER activities_refs BEFORE INSERT OR UPDATE ON programme.activities
    FOR EACH ROW EXECUTE FUNCTION programme.activities_refs();
CREATE TRIGGER activities_stamp BEFORE INSERT OR UPDATE ON programme.activities
    FOR EACH ROW EXECUTE FUNCTION programme.stamp();

CREATE TRIGGER dependencies_bind BEFORE INSERT OR UPDATE ON programme.dependencies
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER dependencies_refs BEFORE INSERT OR UPDATE ON programme.dependencies
    FOR EACH ROW EXECUTE FUNCTION programme.dependencies_refs();
CREATE TRIGGER dependencies_touch BEFORE INSERT OR UPDATE ON programme.dependencies
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER code_types_bind BEFORE INSERT OR UPDATE ON programme.code_types
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER code_types_touch BEFORE INSERT OR UPDATE ON programme.code_types
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER code_values_bind BEFORE INSERT OR UPDATE ON programme.code_values
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('code_types', 'code_type_id');
CREATE TRIGGER code_values_touch BEFORE INSERT OR UPDATE ON programme.code_values
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER activity_codes_bind BEFORE INSERT OR UPDATE ON programme.activity_codes
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER activity_codes_refs BEFORE INSERT OR UPDATE ON programme.activity_codes
    FOR EACH ROW EXECUTE FUNCTION programme.activity_codes_refs();

CREATE TRIGGER resources_touch BEFORE INSERT OR UPDATE ON programme.resources
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER resource_rates_bind BEFORE INSERT OR UPDATE ON programme.resource_rates
    FOR EACH ROW EXECUTE FUNCTION programme.org_child_bind();
CREATE TRIGGER resource_rates_touch BEFORE INSERT OR UPDATE ON programme.resource_rates
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER resource_assignments_bind BEFORE INSERT OR UPDATE ON programme.resource_assignments
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER resource_assignments_refs BEFORE INSERT OR UPDATE ON programme.resource_assignments
    FOR EACH ROW EXECUTE FUNCTION programme.resource_assignments_refs();
CREATE TRIGGER resource_assignments_touch BEFORE INSERT OR UPDATE ON programme.resource_assignments
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER assignment_costs_bind BEFORE INSERT OR UPDATE ON programme.assignment_costs
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('resource_assignments', 'assignment_id');
CREATE TRIGGER assignment_costs_touch BEFORE INSERT OR UPDATE ON programme.assignment_costs
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER baselines_bind BEFORE INSERT OR UPDATE ON programme.baselines
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER baselines_touch BEFORE INSERT OR UPDATE ON programme.baselines
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER baseline_activities_bind BEFORE INSERT OR UPDATE ON programme.baseline_activities
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('baselines', 'baseline_id');
CREATE TRIGGER baseline_activities_touch BEFORE INSERT OR UPDATE ON programme.baseline_activities
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER baseline_dependencies_bind BEFORE INSERT OR UPDATE ON programme.baseline_dependencies
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('baselines', 'baseline_id');
CREATE TRIGGER baseline_dependencies_touch BEFORE INSERT OR UPDATE ON programme.baseline_dependencies
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER baseline_costs_bind BEFORE INSERT OR UPDATE ON programme.baseline_costs
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('baselines', 'baseline_id');
CREATE TRIGGER baseline_costs_touch BEFORE INSERT OR UPDATE ON programme.baseline_costs
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER progress_periods_bind BEFORE INSERT OR UPDATE ON programme.progress_periods
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER progress_periods_touch BEFORE INSERT OR UPDATE ON programme.progress_periods
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER progress_period_costs_bind BEFORE INSERT OR UPDATE ON programme.progress_period_costs
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind('progress_periods', 'period_id');
CREATE TRIGGER progress_period_costs_touch BEFORE INSERT OR UPDATE ON programme.progress_period_costs
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER field_updates_bind BEFORE INSERT OR UPDATE ON programme.field_updates
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER field_updates_refs BEFORE INSERT OR UPDATE ON programme.field_updates
    FOR EACH ROW EXECUTE FUNCTION programme.field_updates_refs();
CREATE TRIGGER field_updates_touch BEFORE INSERT OR UPDATE ON programme.field_updates
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER imports_bind BEFORE INSERT OR UPDATE ON programme.imports
    FOR EACH ROW EXECUTE FUNCTION programme.child_bind();
CREATE TRIGGER imports_touch BEFORE INSERT OR UPDATE ON programme.imports
    FOR EACH ROW EXECUTE FUNCTION programme.touch();

CREATE TRIGGER imports_refs BEFORE INSERT OR UPDATE ON programme.imports
    FOR EACH ROW EXECUTE FUNCTION programme.imports_refs();
CREATE TRIGGER baselines_attrib BEFORE INSERT OR UPDATE ON programme.baselines
    FOR EACH ROW EXECUTE FUNCTION programme.attrib('created_by');
CREATE TRIGGER progress_periods_attrib BEFORE INSERT OR UPDATE ON programme.progress_periods
    FOR EACH ROW EXECUTE FUNCTION programme.attrib('created_by');
CREATE TRIGGER imports_attrib BEFORE INSERT OR UPDATE ON programme.imports
    FOR EACH ROW EXECUTE FUNCTION programme.attrib('imported_by');
CREATE TRIGGER field_updates_attrib BEFORE INSERT OR UPDATE ON programme.field_updates
    FOR EACH ROW EXECUTE FUNCTION programme.attrib('author_id');

CREATE TRIGGER audit_bind BEFORE INSERT OR UPDATE ON programme.audit
    FOR EACH ROW EXECUTE FUNCTION programme.audit_bind();

-- ── 3. Row level security: enabled and FORCED, no policy yet (deny) ─────────
ALTER TABLE programme.programmes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.programmes             FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.calendars              ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.calendars              FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.calendar_exceptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.calendar_exceptions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.activities             ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.activities             FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.dependencies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.dependencies           FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.code_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.code_types             FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.code_values            ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.code_values            FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.activity_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.activity_codes         FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.resources              ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.resources              FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.resource_rates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.resource_rates         FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.resource_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.resource_assignments   FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.assignment_costs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.assignment_costs       FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.baselines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.baselines              FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_activities    FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_dependencies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_dependencies  FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_costs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.baseline_costs         FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.progress_periods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.progress_periods       FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.progress_period_costs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.progress_period_costs  FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.field_updates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.field_updates          FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.imports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.imports                FORCE  ROW LEVEL SECURITY;
ALTER TABLE programme.audit                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE programme.audit                  FORCE  ROW LEVEL SECURITY;

-- Trigger functions are never called directly: no caller needs EXECUTE.
REVOKE ALL ON FUNCTION programme.programmes_bind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.child_bind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.org_child_bind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.activities_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.dependencies_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.activity_codes_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.resource_assignments_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.field_updates_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.imports_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.attrib() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.audit_bind() FROM PUBLIC, anon, authenticated;
