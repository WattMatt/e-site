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
--      deny by default.
--   4. Read gates: programme.can_read / can_edit / cost_visible and the org
--      library pair can_read_org_library / org_cost_visible.
--   5. SELECT-only policies (cost tables also need cost_visible: the rand
--      mask), the generator's site_scope on every project_id table, and
--      grants: SELECT to authenticated, nothing to anon, no client writes.
--   6. Write functions (SECURITY DEFINER, EXECUTE to authenticated only):
--      create_programme (seeds Site + Office calendars), save_changes (ops +
--      computed cache + field-update decisions, optimistic version),
--      save_baseline / set_active_baseline / delete_baseline,
--      submit_field_update. Each locks the programme and writes audit; the
--      internals write_audit and resolve_ref are granted to nobody.
--   7. module_summary: the module bar's start / finish / duration-weighted %.
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
-- function: programme.can_read(uuid)
-- function: programme.can_edit(uuid)
-- function: programme.cost_visible(uuid)
-- function: programme.can_read_org_library(uuid)
-- function: programme.org_cost_visible(uuid)
-- policy: programmes_select ON programme.programmes PERMISSIVE
-- policy: calendars_select ON programme.calendars PERMISSIVE
-- policy: calendar_exceptions_select ON programme.calendar_exceptions PERMISSIVE
-- policy: activities_select ON programme.activities PERMISSIVE
-- policy: dependencies_select ON programme.dependencies PERMISSIVE
-- policy: code_types_select ON programme.code_types PERMISSIVE
-- policy: code_values_select ON programme.code_values PERMISSIVE
-- policy: activity_codes_select ON programme.activity_codes PERMISSIVE
-- policy: resources_select ON programme.resources PERMISSIVE
-- policy: resource_rates_select ON programme.resource_rates PERMISSIVE
-- policy: resource_assignments_select ON programme.resource_assignments PERMISSIVE
-- policy: assignment_costs_select ON programme.assignment_costs PERMISSIVE
-- policy: baselines_select ON programme.baselines PERMISSIVE
-- policy: baseline_activities_select ON programme.baseline_activities PERMISSIVE
-- policy: baseline_dependencies_select ON programme.baseline_dependencies PERMISSIVE
-- policy: baseline_costs_select ON programme.baseline_costs PERMISSIVE
-- policy: progress_periods_select ON programme.progress_periods PERMISSIVE
-- policy: progress_period_costs_select ON programme.progress_period_costs PERMISSIVE
-- policy: field_updates_select ON programme.field_updates PERMISSIVE
-- policy: imports_select ON programme.imports PERMISSIVE
-- policy: audit_select ON programme.audit PERMISSIVE
-- policy: site_scope ON programme.programmes RESTRICTIVE
-- policy: site_scope ON programme.calendars RESTRICTIVE
-- policy: site_scope ON programme.calendar_exceptions RESTRICTIVE
-- policy: site_scope ON programme.activities RESTRICTIVE
-- policy: site_scope ON programme.dependencies RESTRICTIVE
-- policy: site_scope ON programme.code_types RESTRICTIVE
-- policy: site_scope ON programme.code_values RESTRICTIVE
-- policy: site_scope ON programme.activity_codes RESTRICTIVE
-- policy: site_scope ON programme.resource_assignments RESTRICTIVE
-- policy: site_scope ON programme.assignment_costs RESTRICTIVE
-- policy: site_scope ON programme.baselines RESTRICTIVE
-- policy: site_scope ON programme.baseline_activities RESTRICTIVE
-- policy: site_scope ON programme.baseline_dependencies RESTRICTIVE
-- policy: site_scope ON programme.baseline_costs RESTRICTIVE
-- policy: site_scope ON programme.progress_periods RESTRICTIVE
-- policy: site_scope ON programme.progress_period_costs RESTRICTIVE
-- policy: site_scope ON programme.field_updates RESTRICTIVE
-- policy: site_scope ON programme.imports RESTRICTIVE
-- policy: site_scope ON programme.audit RESTRICTIVE
-- grant_absent: authenticated INSERT ON programme.programmes
-- grant_absent: authenticated UPDATE ON programme.programmes
-- grant_absent: authenticated DELETE ON programme.programmes
-- grant_absent: authenticated INSERT ON programme.calendars
-- grant_absent: authenticated UPDATE ON programme.calendars
-- grant_absent: authenticated DELETE ON programme.calendars
-- grant_absent: authenticated INSERT ON programme.calendar_exceptions
-- grant_absent: authenticated UPDATE ON programme.calendar_exceptions
-- grant_absent: authenticated DELETE ON programme.calendar_exceptions
-- grant_absent: authenticated INSERT ON programme.activities
-- grant_absent: authenticated UPDATE ON programme.activities
-- grant_absent: authenticated DELETE ON programme.activities
-- grant_absent: authenticated INSERT ON programme.dependencies
-- grant_absent: authenticated UPDATE ON programme.dependencies
-- grant_absent: authenticated DELETE ON programme.dependencies
-- grant_absent: authenticated INSERT ON programme.code_types
-- grant_absent: authenticated UPDATE ON programme.code_types
-- grant_absent: authenticated DELETE ON programme.code_types
-- grant_absent: authenticated INSERT ON programme.code_values
-- grant_absent: authenticated UPDATE ON programme.code_values
-- grant_absent: authenticated DELETE ON programme.code_values
-- grant_absent: authenticated INSERT ON programme.activity_codes
-- grant_absent: authenticated UPDATE ON programme.activity_codes
-- grant_absent: authenticated DELETE ON programme.activity_codes
-- grant_absent: authenticated INSERT ON programme.resources
-- grant_absent: authenticated UPDATE ON programme.resources
-- grant_absent: authenticated DELETE ON programme.resources
-- grant_absent: authenticated INSERT ON programme.resource_rates
-- grant_absent: authenticated UPDATE ON programme.resource_rates
-- grant_absent: authenticated DELETE ON programme.resource_rates
-- grant_absent: authenticated INSERT ON programme.resource_assignments
-- grant_absent: authenticated UPDATE ON programme.resource_assignments
-- grant_absent: authenticated DELETE ON programme.resource_assignments
-- grant_absent: authenticated INSERT ON programme.assignment_costs
-- grant_absent: authenticated UPDATE ON programme.assignment_costs
-- grant_absent: authenticated DELETE ON programme.assignment_costs
-- grant_absent: authenticated INSERT ON programme.baselines
-- grant_absent: authenticated UPDATE ON programme.baselines
-- grant_absent: authenticated DELETE ON programme.baselines
-- grant_absent: authenticated INSERT ON programme.baseline_activities
-- grant_absent: authenticated UPDATE ON programme.baseline_activities
-- grant_absent: authenticated DELETE ON programme.baseline_activities
-- grant_absent: authenticated INSERT ON programme.baseline_dependencies
-- grant_absent: authenticated UPDATE ON programme.baseline_dependencies
-- grant_absent: authenticated DELETE ON programme.baseline_dependencies
-- grant_absent: authenticated INSERT ON programme.baseline_costs
-- grant_absent: authenticated UPDATE ON programme.baseline_costs
-- grant_absent: authenticated DELETE ON programme.baseline_costs
-- grant_absent: authenticated INSERT ON programme.progress_periods
-- grant_absent: authenticated UPDATE ON programme.progress_periods
-- grant_absent: authenticated DELETE ON programme.progress_periods
-- grant_absent: authenticated INSERT ON programme.progress_period_costs
-- grant_absent: authenticated UPDATE ON programme.progress_period_costs
-- grant_absent: authenticated DELETE ON programme.progress_period_costs
-- grant_absent: authenticated INSERT ON programme.field_updates
-- grant_absent: authenticated UPDATE ON programme.field_updates
-- grant_absent: authenticated DELETE ON programme.field_updates
-- grant_absent: authenticated INSERT ON programme.imports
-- grant_absent: authenticated UPDATE ON programme.imports
-- grant_absent: authenticated DELETE ON programme.imports
-- grant_absent: authenticated INSERT ON programme.audit
-- grant_absent: authenticated UPDATE ON programme.audit
-- grant_absent: authenticated DELETE ON programme.audit
-- grant_present: authenticated SELECT ON programme.programmes
-- grant_present: authenticated SELECT ON programme.calendars
-- grant_present: authenticated SELECT ON programme.calendar_exceptions
-- grant_present: authenticated SELECT ON programme.activities
-- grant_present: authenticated SELECT ON programme.dependencies
-- grant_present: authenticated SELECT ON programme.code_types
-- grant_present: authenticated SELECT ON programme.code_values
-- grant_present: authenticated SELECT ON programme.activity_codes
-- grant_present: authenticated SELECT ON programme.resources
-- grant_present: authenticated SELECT ON programme.resource_rates
-- grant_present: authenticated SELECT ON programme.resource_assignments
-- grant_present: authenticated SELECT ON programme.assignment_costs
-- grant_present: authenticated SELECT ON programme.baselines
-- grant_present: authenticated SELECT ON programme.baseline_activities
-- grant_present: authenticated SELECT ON programme.baseline_dependencies
-- grant_present: authenticated SELECT ON programme.baseline_costs
-- grant_present: authenticated SELECT ON programme.progress_periods
-- grant_present: authenticated SELECT ON programme.progress_period_costs
-- grant_present: authenticated SELECT ON programme.field_updates
-- grant_present: authenticated SELECT ON programme.imports
-- grant_present: authenticated SELECT ON programme.audit
-- grant_absent: anon SELECT ON programme.activities
-- grant_absent: anon SELECT ON programme.assignment_costs
-- grant_absent: anon EXECUTE ON programme.can_read(uuid)
-- anon_execute_absent: ALL prosecdef functions in programme
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'programme' AND p.polcmd = '*' AND p.polname <> 'site_scope'))
-- sql: (SELECT count(*) = 19 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'programme' AND p.polname = 'site_scope' AND p.polcmd = '*' AND NOT p.polpermissive)
-- sql: (SELECT count(*) = 21 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'programme' AND p.polcmd = 'r' AND p.polpermissive)
-- sql: (SELECT count(*) = 3 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'programme' AND p.polcmd = 'r' AND pg_get_expr(p.polqual, p.polrelid) LIKE '%cost_visible(project_id)%')
-- function: programme.write_audit(uuid, text, jsonb)
-- function: programme.resolve_ref(text, jsonb, text, uuid, text)
-- function: programme.create_programme(uuid, text, text, date, text, text)
-- function: programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb)
-- function: programme.save_baseline(uuid, text, boolean)
-- function: programme.set_active_baseline(uuid)
-- function: programme.delete_baseline(uuid)
-- function: programme.submit_field_update(uuid, date, date, numeric, numeric, text)
-- function: programme.module_summary(uuid, text)
-- function: programme.weekdays_distinct(smallint[])
-- constraint: calendars_work_weekdays_distinct ON programme.calendars
-- constraint: calendars_coverage_order ON programme.calendars
-- grant_present: authenticated EXECUTE ON programme.create_programme(uuid, text, text, date, text, text)
-- grant_present: authenticated EXECUTE ON programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb)
-- grant_present: authenticated EXECUTE ON programme.save_baseline(uuid, text, boolean)
-- grant_present: authenticated EXECUTE ON programme.set_active_baseline(uuid)
-- grant_present: authenticated EXECUTE ON programme.delete_baseline(uuid)
-- grant_present: authenticated EXECUTE ON programme.submit_field_update(uuid, date, date, numeric, numeric, text)
-- grant_present: authenticated EXECUTE ON programme.module_summary(uuid, text)
-- grant_absent: authenticated EXECUTE ON programme.write_audit(uuid, text, jsonb)
-- grant_absent: authenticated EXECUTE ON programme.resolve_ref(text, jsonb, text, uuid, text)
-- grant_absent: anon EXECUTE ON programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb)
-- sql: (SELECT p.prosrc LIKE '%pg_advisory_xact_lock%' AND p.prosrc LIKE '%''40001''%' AND p.prosrc LIKE '%field_updates.decided%' FROM pg_proc p WHERE p.oid = 'programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb)'::regprocedure)
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'programme' AND (p.proname = 'decide_field_updates' OR (p.proname = 'save_changes' AND p.pronargs <> 5))))
-- grant_absent: anon EXECUTE ON programme.weekdays_distinct(smallint[])
-- sql: (SELECT count(*) = 9 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'programme' AND p.proname IN ('write_audit', 'resolve_ref', 'create_programme', 'save_changes', 'save_baseline', 'set_active_baseline', 'delete_baseline', 'submit_field_update', 'module_summary'))
-- behaviour: scripts/db/assert-programme-roles.sql — every row ok
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

-- A CHECK cannot hold a subquery, so "no weekday twice" is this IMMUTABLE
-- helper. {1,1,1} would otherwise be a calendar with three Mondays: a silent
-- wrong schedule rather than a refusal.
CREATE OR REPLACE FUNCTION programme.weekdays_distinct(p_days smallint[])
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
    SELECT pg_catalog.cardinality(p_days) = (SELECT pg_catalog.count(DISTINCT d) FROM pg_catalog.unnest(p_days) AS d)
$$;
REVOKE ALL ON FUNCTION programme.weekdays_distinct(smallint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION programme.weekdays_distinct(smallint[]) TO authenticated, service_role;

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
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT calendars_work_weekdays_distinct CHECK (programme.weekdays_distinct(work_weekdays)),
    CONSTRAINT calendars_coverage_order CHECK (coverage_from IS NULL OR coverage_to IS NULL OR coverage_from <= coverage_to)
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

-- ── 4. Read gates (SECURITY DEFINER, search_path '', row_security off) ──────
-- Policies call these as `authenticated`. Identity is auth.uid() (inside the
-- role helpers), never current_user. Each returns false, never NULL.
--   can_read     every effective project role except client_viewer; a module
--                programme (kind = 'module', solar) also needs solar_can_view.
--   can_edit     can_read AND (module: solar_can_edit; otherwise the effective
--                role is owner/admin/project_manager = ORG_WRITE_ROLES).
--   cost_visible effective project role owner/admin/project_manager
--                (= COST_VIEW_ROLES). Rands only; nothing else is masked.
--   can_read_org_library / org_cost_visible: the same two rules for the org
--                resource library, from the caller's ACTIVE org membership.

CREATE OR REPLACE FUNCTION programme.can_read(p_programme_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM programme.programmes p
     WHERE p.id = p_programme_id
       AND public.user_has_project_access(p.project_id)
       AND coalesce(public.user_effective_project_role(p.project_id), 'client_viewer') <> 'client_viewer'
       AND (p.kind <> 'module' OR coalesce(public.solar_can_view(p.project_id), false))
  )
$f$;

CREATE OR REPLACE FUNCTION programme.can_edit(p_programme_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$
  SELECT programme.can_read(p_programme_id) AND EXISTS (
    SELECT 1 FROM programme.programmes p
     WHERE p.id = p_programme_id
       AND CASE WHEN p.kind = 'module'
                THEN coalesce(public.solar_can_edit(p.project_id), false)
                ELSE coalesce(public.user_effective_project_role(p.project_id), '') IN ('owner', 'admin', 'project_manager')
           END
  )
$f$;

CREATE OR REPLACE FUNCTION programme.cost_visible(p_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$
  SELECT coalesce(public.user_effective_project_role(p_project_id), '') IN ('owner', 'admin', 'project_manager')
$f$;

CREATE OR REPLACE FUNCTION programme.can_read_org_library(p_org uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organisations uo
     WHERE uo.organisation_id = p_org
       AND uo.user_id = auth.uid()
       AND uo.is_active
       AND uo.role <> 'client_viewer'
  )
$f$;

CREATE OR REPLACE FUNCTION programme.org_cost_visible(p_org uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM public.user_organisations uo
     WHERE uo.organisation_id = p_org
       AND uo.user_id = auth.uid()
       AND uo.is_active
       AND uo.role IN ('owner', 'admin', 'project_manager')
  )
$f$;

-- PUBLIC holds EXECUTE by default and Supabase's default privileges grant anon
-- directly, so both are named.
REVOKE ALL ON FUNCTION programme.can_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.can_edit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.cost_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.can_read_org_library(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.org_cost_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION programme.can_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION programme.can_edit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION programme.cost_visible(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION programme.can_read_org_library(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION programme.org_cost_visible(uuid) TO authenticated, service_role;

-- ── 5. Policies, grants, site scope ─────────────────────────────────────────
-- Clients READ only. Every write is a SECURITY DEFINER function (later
-- sections), so there is no INSERT/UPDATE/DELETE policy and no such grant.
-- Read policies are PERMISSIVE FOR SELECT, one per table. The only FOR ALL
-- policy is site_scope (RESTRICTIVE), whose text is the generator's, byte for
-- byte (packages/db/src/site-scope/manifest.ts; held by
-- packages/db/src/__tests__/security/programme-site-scope.contract.test.ts).
-- The cost tables add the rand mask: cost_visible on top of can_read.

CREATE POLICY programmes_select ON programme.programmes FOR SELECT TO authenticated
  USING (programme.can_read(id));
CREATE POLICY calendars_select ON programme.calendars FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY calendar_exceptions_select ON programme.calendar_exceptions FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY activities_select ON programme.activities FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY dependencies_select ON programme.dependencies FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY code_types_select ON programme.code_types FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY code_values_select ON programme.code_values FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY activity_codes_select ON programme.activity_codes FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY resources_select ON programme.resources FOR SELECT TO authenticated
  USING (programme.can_read_org_library(organisation_id));
CREATE POLICY resource_rates_select ON programme.resource_rates FOR SELECT TO authenticated
  USING (programme.can_read_org_library(organisation_id) AND programme.org_cost_visible(organisation_id));
CREATE POLICY resource_assignments_select ON programme.resource_assignments FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY assignment_costs_select ON programme.assignment_costs FOR SELECT TO authenticated
  USING (programme.can_read(programme_id) AND programme.cost_visible(project_id));
CREATE POLICY baselines_select ON programme.baselines FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY baseline_activities_select ON programme.baseline_activities FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY baseline_dependencies_select ON programme.baseline_dependencies FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY baseline_costs_select ON programme.baseline_costs FOR SELECT TO authenticated
  USING (programme.can_read(programme_id) AND programme.cost_visible(project_id));
CREATE POLICY progress_periods_select ON programme.progress_periods FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY progress_period_costs_select ON programme.progress_period_costs FOR SELECT TO authenticated
  USING (programme.can_read(programme_id) AND programme.cost_visible(project_id));
CREATE POLICY field_updates_select ON programme.field_updates FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY imports_select ON programme.imports FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));
CREATE POLICY audit_select ON programme.audit FOR SELECT TO authenticated
  USING (programme.can_read(programme_id));

-- site_scope: GENERATED text (scripts/db/site-scope/emit.ts). Do not edit by hand.
DROP POLICY IF EXISTS site_scope ON programme.programmes;
CREATE POLICY site_scope ON programme.programmes AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.calendars;
CREATE POLICY site_scope ON programme.calendars AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.calendar_exceptions;
CREATE POLICY site_scope ON programme.calendar_exceptions AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.activities;
CREATE POLICY site_scope ON programme.activities AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.dependencies;
CREATE POLICY site_scope ON programme.dependencies AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.code_types;
CREATE POLICY site_scope ON programme.code_types AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.code_values;
CREATE POLICY site_scope ON programme.code_values AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.activity_codes;
CREATE POLICY site_scope ON programme.activity_codes AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.resource_assignments;
CREATE POLICY site_scope ON programme.resource_assignments AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.assignment_costs;
CREATE POLICY site_scope ON programme.assignment_costs AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.baselines;
CREATE POLICY site_scope ON programme.baselines AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.baseline_activities;
CREATE POLICY site_scope ON programme.baseline_activities AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.baseline_dependencies;
CREATE POLICY site_scope ON programme.baseline_dependencies AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.baseline_costs;
CREATE POLICY site_scope ON programme.baseline_costs AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.progress_periods;
CREATE POLICY site_scope ON programme.progress_periods AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.progress_period_costs;
CREATE POLICY site_scope ON programme.progress_period_costs AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.field_updates;
CREATE POLICY site_scope ON programme.field_updates AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.imports;
CREATE POLICY site_scope ON programme.imports AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS site_scope ON programme.audit;
CREATE POLICY site_scope ON programme.audit AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));

-- Grants. Clear whatever the default privileges handed out, then give SELECT
-- to authenticated only. anon gets nothing; writes go through definer functions.
REVOKE ALL ON ALL TABLES IN SCHEMA programme FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA programme TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA programme TO service_role;

-- ── 6. Write functions ──────────────────────────────────────────────────────
-- Every client write lands here. Each function:
--   • is SECURITY DEFINER, search_path '', row_security off (the definer is
--     postgres, which owns the tables and carries BYPASSRLS; row_security off
--     is the fail-loud guard for the day that stops holding);
--   • takes pg_advisory_xact_lock(hashtextextended('programme:' || id, 0))
--     BEFORE it reads the programme, so two saves of one programme serialise;
--   • decides the caller from auth.uid() (inside can_read / can_edit and the
--     role helpers), never current_user;
--   • writes at least one programme.audit row in the same transaction. The
--     audit object_ref holds ids, counts and verbs only, never a rand figure
--     (every reader of the programme can read it);
--   • leaves derivation of programme/project/organisation, attribution
--     (created_by / updated_by / author_id) and the cross-programme refusals
--     to the section 2 triggers, which run inside these calls too.
-- module_summary (section 7) is a read: it takes no lock and writes no audit.
--
-- SQLSTATEs: 42501 refused, 40001 stale, 22023 bad input, P0002 gone,
-- 23505 duplicate.

-- Internal: append one audit row. Callable only by its owner (the definer
-- functions below run as that owner); no grant to any client role.
CREATE OR REPLACE FUNCTION programme.write_audit(p_programme_id uuid, p_verb text, p_ref jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
BEGIN
    INSERT INTO programme.audit (programme_id, organisation_id, actor_id, verb, object_ref)
    SELECT g.id, g.organisation_id, auth.uid(), p_verb, p_ref
      FROM programme.programmes g WHERE g.id = p_programme_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'programme.write_audit: programme % not found', p_programme_id USING ERRCODE = 'P0002';
    END IF;
END $$;

-- Internal: resolve a reference inside save_changes. p_ref is either a key
-- created earlier in the same call (looked up in p_keys first) or an existing
-- uuid. The row must exist (else P0002) and belong to p_programme (else 22023).
-- p_table is one of this file's table names, never caller text.
CREATE OR REPLACE FUNCTION programme.resolve_ref(p_ref text, p_keys jsonb, p_table text, p_programme uuid, p_what text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_id uuid; v_prog uuid;
BEGIN
    IF p_ref IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_keys ? p_ref THEN
        v_id := (p_keys ->> p_ref)::uuid;
    ELSIF p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_id := p_ref::uuid;
    ELSE
        RAISE EXCEPTION 'That % no longer exists. Reload to see the current programme.', p_what USING ERRCODE = 'P0002';
    END IF;
    IF p_table NOT IN ('activities', 'dependencies', 'calendars', 'code_types', 'code_values') THEN
        RAISE EXCEPTION 'programme.resolve_ref: unsupported table %', p_table USING ERRCODE = '22023';
    END IF;
    EXECUTE format('SELECT programme_id FROM programme.%I WHERE id = $1', p_table) INTO v_prog USING v_id;
    IF v_prog IS NULL THEN
        RAISE EXCEPTION 'That % no longer exists. Reload to see the current programme.', p_what USING ERRCODE = 'P0002';
    END IF;
    IF v_prog <> p_programme THEN
        RAISE EXCEPTION 'That % belongs to a different programme.', p_what USING ERRCODE = '22023';
    END IF;
    RETURN v_id;
END $$;

-- 1. create_programme.
-- The row does not exist yet, so can_edit cannot be asked; the same rule is
-- evaluated on the project directly: project access, not client_viewer, and
-- (module: solar_can_view AND solar_can_edit; otherwise the effective role is
-- owner/admin/project_manager).
--
-- Calendar seeding. Columns read from the migrations, not assumed:
--   projects.project_settings (00101 + 00195), one row per project:
--     working_days int[] NOT NULL DEFAULT {1,2,3,4,5}, ISO day of week
--       (Mon=1 .. Sun=7; 00196's add_working_days reads it the same way);
--     extra_holidays date[] NOT NULL DEFAULT {};
--     builders_holiday boolean NOT NULL DEFAULT true (the shutdown switch);
--     builders_shutdown_start_md / builders_shutdown_end_md text NOT NULL,
--       'MM-DD', defaults '12-15' / '01-15'; a window whose end sorts before
--       its start wraps the year end (00196 push_past_builders_shutdown).
--     (holiday_calendar text 'ZA' exists; public_holidays is ZA only.)
--   projects.public_holidays (00194): d date PRIMARY KEY, name text NOT NULL;
--     seeded years are listed in projects.calendar_years(year int).
-- With no settings row the column defaults above are used.
-- The two calendars follow A(h) (00196): Office = working_days; Site =
-- working_days plus Saturday. Both carry the public holidays and the
-- project's extra_holidays as non_work exceptions. The builders' shutdown is
-- a SITE closure ("nobody is on site", 00196) and is put on Site only.
-- Window: p_project_start - 1 year .. p_project_start + 5 years.
-- coverage_from / coverage_to state where the holiday list is KNOWN: the
-- window clipped to the seeded calendar_years (NULL when none overlaps), so
-- the engine can tell an unseeded year from a year without holidays.
CREATE OR REPLACE FUNCTION programme.create_programme(
    p_project_id uuid, p_kind text, p_name text, p_project_start date,
    p_module_key text DEFAULT NULL, p_contractor_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
    v_role text; v_ok boolean; v_prog uuid; v_site uuid; v_office uuid;
    v_days int[]; v_extra date[]; v_bh boolean; v_sd_start text; v_sd_end text;
    v_office_days smallint[]; v_site_days smallint[];
    v_from date; v_to date; v_seed_from date; v_seed_to date; v_cov_from date; v_cov_to date;
    v_n_site int; v_n_office int;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('project', 'module', 'contractor') THEN
        RAISE EXCEPTION 'A programme is a project, module or contractor programme.' USING ERRCODE = '22023';
    END IF;

    -- Serialise creation per project (the programme id does not exist yet).
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:create:' || p_project_id::text, 0));

    v_role := public.user_effective_project_role(p_project_id);
    v_ok := coalesce(public.user_has_project_access(p_project_id), false)
            AND coalesce(v_role, 'client_viewer') <> 'client_viewer'
            AND CASE WHEN p_kind = 'module'
                     THEN coalesce(public.solar_can_view(p_project_id), false)
                          AND coalesce(public.solar_can_edit(p_project_id), false)
                     ELSE v_role IN ('owner', 'admin', 'project_manager')
                END;
    IF NOT coalesce(v_ok, false) THEN
        RAISE EXCEPTION 'You do not have permission to create a programme on this project.' USING ERRCODE = '42501';
    END IF;

    IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Give the programme a name of up to 200 characters.' USING ERRCODE = '22023';
    END IF;
    IF p_project_start IS NULL THEN
        RAISE EXCEPTION 'Set the programme start date.' USING ERRCODE = '22023';
    END IF;
    IF (p_kind = 'module') <> (p_module_key IS NOT NULL) OR (p_module_key IS NOT NULL AND p_module_key <> 'solar') THEN
        RAISE EXCEPTION 'Only a module programme names a module, and the module must be solar.' USING ERRCODE = '22023';
    END IF;
    IF (p_kind = 'contractor') <> (p_contractor_label IS NOT NULL)
       OR (p_contractor_label IS NOT NULL AND char_length(btrim(p_contractor_label)) NOT BETWEEN 1 AND 120) THEN
        RAISE EXCEPTION 'Only a contractor programme carries a contractor name, of up to 120 characters.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (SELECT 1 FROM programme.programmes g
                WHERE g.project_id = p_project_id AND g.kind = p_kind
                  AND (p_kind <> 'module' OR g.module_key = p_module_key)
                  AND (p_kind <> 'contractor' OR lower(g.contractor_label) = lower(btrim(p_contractor_label)))) THEN
        RAISE EXCEPTION 'This project already has a programme of that kind.' USING ERRCODE = '23505';
    END IF;

    BEGIN
        INSERT INTO programme.programmes (project_id, organisation_id, kind, module_key, contractor_label, scheduling_rules, name, project_start)
        SELECT p.id, p.organisation_id, p_kind, p_module_key, btrim(p_contractor_label), 'msp', btrim(p_name), p_project_start
          FROM projects.projects p WHERE p.id = p_project_id
        RETURNING id INTO v_prog;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'This project already has a programme of that kind.' USING ERRCODE = '23505';
    END;
    IF v_prog IS NULL THEN
        RAISE EXCEPTION 'That project no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    SELECT ps.working_days, ps.extra_holidays, ps.builders_holiday, ps.builders_shutdown_start_md, ps.builders_shutdown_end_md
      INTO v_days, v_extra, v_bh, v_sd_start, v_sd_end
      FROM projects.project_settings ps WHERE ps.project_id = p_project_id;
    IF NOT FOUND THEN
        v_days := ARRAY[1,2,3,4,5]; v_extra := ARRAY[]::date[]; v_bh := true; v_sd_start := '12-15'; v_sd_end := '01-15';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_office_days
      FROM unnest(v_days) d WHERE d BETWEEN 1 AND 7;
    IF v_office_days IS NULL THEN
        RAISE EXCEPTION 'The project has no working days set. Set them in the project settings first.' USING ERRCODE = '22023';
    END IF;
    v_site_days := CASE WHEN 6 = ANY (v_office_days) THEN v_office_days
                        ELSE (SELECT array_agg(d ORDER BY d) FROM unnest(v_office_days || 6::smallint) d) END;

    v_from := (p_project_start - interval '1 year')::date;
    v_to   := (p_project_start + interval '5 years')::date;
    SELECT make_date(min(cy.year), 1, 1), make_date(max(cy.year), 12, 31) INTO v_seed_from, v_seed_to FROM projects.calendar_years cy;
    IF v_seed_from IS NOT NULL AND v_seed_from <= v_to AND v_seed_to >= v_from THEN
        v_cov_from := greatest(v_from, v_seed_from);
        v_cov_to := least(v_to, v_seed_to);
    END IF;

    INSERT INTO programme.calendars (programme_id, name, variant, work_weekdays, hours_per_day, coverage_from, coverage_to)
        VALUES (v_prog, 'Site', 'site', v_site_days, 8, v_cov_from, v_cov_to) RETURNING id INTO v_site;
    INSERT INTO programme.calendars (programme_id, name, variant, work_weekdays, hours_per_day, coverage_from, coverage_to)
        VALUES (v_prog, 'Office', 'office', v_office_days, 8, v_cov_from, v_cov_to) RETURNING id INTO v_office;

    -- One row per (calendar, day); a public holiday's name wins over the
    -- other labels.
    INSERT INTO programme.calendar_exceptions (calendar_id, programme_id, day, kind, label)
    SELECT DISTINCT ON (c.id, x.day) c.id, v_prog, x.day, 'non_work', x.label
      FROM (VALUES (v_site, true), (v_office, false)) AS c(id, is_site)
      CROSS JOIN LATERAL (
            SELECT ph.d AS day, ph.name AS label, 1 AS pri FROM projects.public_holidays ph WHERE ph.d BETWEEN v_from AND v_to
            UNION ALL
            SELECT e, 'Project holiday', 2 FROM unnest(v_extra) e WHERE e BETWEEN v_from AND v_to
            UNION ALL
            SELECT g::date, 'Builders'' shutdown', 3
              FROM generate_series(extract(year FROM v_from)::int - 1, extract(year FROM v_to)::int) AS y(yr)
              CROSS JOIN LATERAL generate_series(
                    to_date(y.yr::text || '-' || v_sd_start, 'YYYY-MM-DD'),
                    to_date((y.yr + CASE WHEN v_sd_end < v_sd_start THEN 1 ELSE 0 END)::text || '-' || v_sd_end, 'YYYY-MM-DD'),
                    interval '1 day') AS g
             WHERE c.is_site AND v_bh AND g::date BETWEEN v_from AND v_to
      ) x
     ORDER BY c.id, x.day, x.pri;

    UPDATE programme.programmes SET default_calendar_id = v_site WHERE id = v_prog;

    SELECT count(*) FILTER (WHERE calendar_id = v_site), count(*) FILTER (WHERE calendar_id = v_office)
      INTO v_n_site, v_n_office FROM programme.calendar_exceptions WHERE programme_id = v_prog;
    PERFORM programme.write_audit(v_prog, 'programme.created', jsonb_build_object(
        'kind', p_kind, 'calendars', jsonb_build_array(v_site, v_office),
        'site_exceptions', v_n_site, 'office_exceptions', v_n_office));
    RETURN v_prog;
END $$;

-- 2. save_changes: the one write path for programme content.
-- p_ops is applied in order (shapes mirror the TS ProgrammeOp of Task 5):
--   {op:'upsert_activity', key, id?, fields:{...}}     {op:'delete_activity', id}
--   {op:'upsert_dependency', key, id?, pred, succ, type, lag, lag_unit, lag_calendar}
--   {op:'delete_dependency', id}                       {op:'upsert_calendar', key, id?, fields}
--   {op:'set_calendar_exceptions', calendar, exceptions:[{day, kind, label}]}
--   {op:'upsert_code_type', key, id?, name}
--   {op:'upsert_code_value', key, id?, code_type, value, colour?, organisation_tag?, user_tag?}
--   {op:'set_activity_code', activity, code_type, code_value|null}
--   {op:'set_programme', fields:{name?, data_date?, project_start?, options?, default_calendar_id?}}
-- A reference (id, pred, succ, activity, calendar, code_type, code_value,
-- parent_id, calendar_id, default_calendar_id) is an existing uuid OR a key
-- created earlier in this call. In a `fields` object, a cache name
-- (early_*, late_*, total_float, free_float, is_critical, is_driving,
-- work_item_id; project_finish on set_programme) is silently IGNORED; any
-- other name outside the writable list (is_tombstoned, ids, typos) is refused
-- with 22023 "That change names a field the programme does not have: <name>".
-- p_computed = {project_finish, activities:[{id|key, early_start, early_finish,
-- late_start, late_finish, total_float, free_float, is_critical, is_driving}]}
-- writes the cache columns only; activities not listed keep their cache.
-- delete_activity TOMBSTONES an activity that carries history (see the op)
-- and hard-deletes a bare one; the result and the audit list both:
-- {version, ids, deleted:[...], tombstoned:[...]}. A tombstoned activity
-- cannot be upserted, linked or deleted again ("Restore it first"; P2 has
-- no restore op).
-- RULING (the cache): the caller's server action writes the cache after an
-- engine run in the same request. An editor calling this RPC directly can only
-- falsify a cache that the next recalculation overwrites, and every read path
-- treats these columns as a cache, never as a source of truth.
-- p_decisions = [{id, status:'applied'|'adjusted'|'rejected', note?}] decides
-- reported field updates of THIS programme. They are decided after the lock
-- and the version check, in the same transaction as the ops, so a decision
-- and the activity actuals it agrees to commit together or not at all (a
-- stale version refuses both). Deciding does not itself change an activity:
-- the agreed values travel as upsert_activity ops in p_ops, so activity
-- fields keep exactly one write path. The result adds `decided` (a count).
CREATE OR REPLACE FUNCTION programme.save_changes(
    p_programme_id uuid, p_expected_version timestamptz, p_ops jsonb, p_computed jsonb,
    p_decisions jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
    c_act_fields CONSTANT text[] := ARRAY['parent_id','wbs_code','code','name','type','original_duration',
        'remaining_duration','calendar_id','constraint_type','constraint_date','deadline','actual_start',
        'actual_finish','percent_complete','percent_complete_type','fixed_start','fixed_finish','sort_order',
        'external_uid','anchor'];
    c_cal_fields CONSTANT text[] := ARRAY['name','variant','work_weekdays','hours_per_day','coverage_from','coverage_to'];
    c_prog_fields CONSTANT text[] := ARRAY['name','data_date','project_start','options','default_calendar_id'];
    -- Known but never written from ops (silently ignored): the computed cache.
    c_act_cache CONSTANT text[] := ARRAY['early_start','early_finish','late_start','late_finish','total_float',
        'free_float','is_critical','is_driving','work_item_id'];
    c_prog_cache CONSTANT text[] := ARRAY['project_finish'];
    v_bad text;
    v_version timestamptz; v_keys jsonb := '{}'::jsonb; v_op jsonb; v_kind text; v_key text; v_f jsonb;
    v_id uuid; v_pred uuid; v_succ uuid; v_type uuid; v_val uuid; v_cur uuid; v_hops int;
    v_act programme.activities; v_cal programme.calendars; v_prog programme.programmes;
    v_dep programme.dependencies; v_cv programme.code_values;
    v_counts jsonb := '{}'::jsonb; v_created jsonb := '[]'::jsonb; v_deleted jsonb := '[]'::jsonb;
    v_tombstoned jsonb := '[]'::jsonb;
    v_c jsonb; v_n_computed int := 0;
    v_d jsonb; v_status text; v_note text; v_fu_prog uuid; v_fu_status text;
    v_n_decided int := 0; v_decided_ids jsonb := '[]'::jsonb; v_by jsonb := '{}'::jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || p_programme_id::text, 0));
    IF NOT coalesce(programme.can_edit(p_programme_id), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    SELECT g.updated_at INTO v_version FROM programme.programmes g WHERE g.id = p_programme_id FOR UPDATE;
    IF p_expected_version IS NULL OR p_expected_version <> v_version THEN
        RAISE EXCEPTION 'Someone else changed this programme. Reload to see their version.' USING ERRCODE = '40001';
    END IF;
    p_ops := coalesce(p_ops, '[]'::jsonb);
    IF jsonb_typeof(p_ops) <> 'array' THEN
        RAISE EXCEPTION 'The changes must be sent as a list.' USING ERRCODE = '22023';
    END IF;
    IF p_computed IS NOT NULL AND jsonb_typeof(p_computed) <> 'object' THEN
        RAISE EXCEPTION 'The computed schedule must be sent as an object.' USING ERRCODE = '22023';
    END IF;
    p_decisions := coalesce(p_decisions, '[]'::jsonb);
    IF jsonb_typeof(p_decisions) <> 'array' THEN
        RAISE EXCEPTION 'The field update decisions must be sent as a list.' USING ERRCODE = '22023';
    END IF;

    -- Field-update decisions: under the lock and the version check above, in
    -- this transaction. Any refusal here (or in the ops below) undoes them all.
    FOR v_d IN SELECT e.value FROM jsonb_array_elements(p_decisions) AS e(value) LOOP
        IF coalesce(v_d ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'That field update no longer exists.' USING ERRCODE = 'P0002';
        END IF;
        v_id := (v_d ->> 'id')::uuid;
        v_status := v_d ->> 'status';
        v_note := nullif(btrim(v_d ->> 'note'), '');
        v_fu_prog := NULL; v_fu_status := NULL;
        SELECT f.programme_id, f.status INTO v_fu_prog, v_fu_status FROM programme.field_updates f WHERE f.id = v_id FOR UPDATE;
        IF v_fu_prog IS NULL THEN
            RAISE EXCEPTION 'That field update no longer exists.' USING ERRCODE = 'P0002';
        END IF;
        IF v_fu_prog <> p_programme_id THEN
            RAISE EXCEPTION 'That field update belongs to a different programme.' USING ERRCODE = '22023';
        END IF;
        IF v_status IS NULL OR v_status NOT IN ('applied', 'adjusted', 'rejected') THEN
            RAISE EXCEPTION 'A field update is applied, adjusted or rejected.' USING ERRCODE = '22023';
        END IF;
        IF v_fu_status <> 'reported' THEN
            RAISE EXCEPTION 'That field update has already been decided.' USING ERRCODE = '22023';
        END IF;
        IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
            RAISE EXCEPTION 'Keep the note to 2000 characters.' USING ERRCODE = '22023';
        END IF;
        UPDATE programme.field_updates SET status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
         WHERE id = v_id;
        v_n_decided := v_n_decided + 1;
        v_decided_ids := v_decided_ids || to_jsonb(v_id);
        v_by := jsonb_set(v_by, ARRAY[v_status], to_jsonb(coalesce((v_by ->> v_status)::int, 0) + 1));
    END LOOP;
    v_id := NULL;

    BEGIN
    FOR v_op IN SELECT e.value FROM jsonb_array_elements(p_ops) AS e(value) LOOP
        v_kind := v_op ->> 'op';
        v_key := v_op ->> 'key';
        IF v_key IS NOT NULL AND v_keys ? v_key THEN
            RAISE EXCEPTION 'Each new row in one save needs its own key.' USING ERRCODE = '22023';
        END IF;
        v_counts := jsonb_set(v_counts, ARRAY[coalesce(v_kind, 'unknown')],
                              to_jsonb(coalesce((v_counts ->> coalesce(v_kind, 'unknown'))::int, 0) + 1));

        -- A field name the op does not know is refused (a typo must not be a
        -- silent no-op); the computed-cache names are known and ignored.
        IF jsonb_typeof(v_op -> 'fields') = 'object' THEN
            v_bad := NULL;
            SELECT e.k INTO v_bad FROM jsonb_object_keys(v_op -> 'fields') AS e(k)
             WHERE NOT (e.k = ANY (CASE v_kind
                    WHEN 'upsert_activity' THEN c_act_fields || c_act_cache
                    WHEN 'upsert_calendar' THEN c_cal_fields
                    WHEN 'set_programme' THEN c_prog_fields || c_prog_cache
                    ELSE ARRAY[]::text[] END))
             ORDER BY e.k LIMIT 1;
            IF v_bad IS NOT NULL THEN
                RAISE EXCEPTION 'That change names a field the programme does not have: %', v_bad USING ERRCODE = '22023';
            END IF;
        END IF;

        IF v_kind = 'upsert_activity' THEN
            SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) INTO v_f
              FROM jsonb_each(CASE WHEN jsonb_typeof(v_op -> 'fields') = 'object' THEN v_op -> 'fields' ELSE '{}'::jsonb END) AS e(k, v)
             WHERE e.k = ANY (c_act_fields);
            IF jsonb_typeof(v_f -> 'parent_id') = 'string' THEN
                v_f := jsonb_set(v_f, '{parent_id}', to_jsonb(programme.resolve_ref(v_f ->> 'parent_id', v_keys, 'activities', p_programme_id, 'parent activity')));
                -- A removed (tombstoned) activity is out of the schedule: nothing may be placed under it.
                IF EXISTS (SELECT 1 FROM programme.activities a WHERE a.id = (v_f ->> 'parent_id')::uuid AND a.is_tombstoned) THEN
                    RAISE EXCEPTION 'That activity was removed. Restore it first.' USING ERRCODE = '22023';
                END IF;
            END IF;
            IF jsonb_typeof(v_f -> 'calendar_id') = 'string' THEN
                v_f := jsonb_set(v_f, '{calendar_id}', to_jsonb(programme.resolve_ref(v_f ->> 'calendar_id', v_keys, 'calendars', p_programme_id, 'calendar')));
            END IF;
            IF v_op ->> 'id' IS NOT NULL THEN
                v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'activities', p_programme_id, 'activity');
                SELECT * INTO v_act FROM programme.activities a WHERE a.id = v_id FOR UPDATE;
                IF v_act.is_tombstoned THEN
                    RAISE EXCEPTION 'That activity was removed. Restore it first.' USING ERRCODE = '22023';
                END IF;
                v_act := jsonb_populate_record(v_act, v_f);
                UPDATE programme.activities SET
                    parent_id = v_act.parent_id, wbs_code = v_act.wbs_code, code = v_act.code, name = v_act.name,
                    type = v_act.type, original_duration = v_act.original_duration,
                    remaining_duration = v_act.remaining_duration, calendar_id = v_act.calendar_id,
                    constraint_type = v_act.constraint_type, constraint_date = v_act.constraint_date,
                    deadline = v_act.deadline, actual_start = v_act.actual_start, actual_finish = v_act.actual_finish,
                    percent_complete = v_act.percent_complete, percent_complete_type = v_act.percent_complete_type,
                    fixed_start = v_act.fixed_start, fixed_finish = v_act.fixed_finish, sort_order = v_act.sort_order,
                    external_uid = v_act.external_uid, anchor = v_act.anchor
                 WHERE id = v_id;
            ELSE
                v_act := jsonb_populate_record(NULL::programme.activities, v_f);
                INSERT INTO programme.activities (programme_id, parent_id, wbs_code, code, name, type, original_duration,
                    remaining_duration, calendar_id, constraint_type, constraint_date, deadline, actual_start, actual_finish,
                    percent_complete, percent_complete_type, fixed_start, fixed_finish, sort_order, external_uid, anchor)
                VALUES (p_programme_id, v_act.parent_id, v_act.wbs_code, v_act.code, v_act.name, v_act.type,
                    coalesce(v_act.original_duration, 0), v_act.remaining_duration, v_act.calendar_id, v_act.constraint_type,
                    v_act.constraint_date, v_act.deadline, v_act.actual_start, v_act.actual_finish,
                    coalesce(v_act.percent_complete, 0), coalesce(v_act.percent_complete_type, 'duration'),
                    v_act.fixed_start, v_act.fixed_finish, v_act.sort_order, v_act.external_uid, v_act.anchor)
                RETURNING id INTO v_id;
                v_created := v_created || to_jsonb(v_id);
            END IF;
            -- The WBS tree must stay a tree.
            v_cur := v_act.parent_id; v_hops := 0;
            WHILE v_cur IS NOT NULL LOOP
                IF v_cur = v_id OR v_hops > 10000 THEN
                    RAISE EXCEPTION 'An activity cannot sit under one of its own sub-activities.' USING ERRCODE = '22023';
                END IF;
                SELECT a.parent_id INTO v_cur FROM programme.activities a WHERE a.id = v_cur;
                v_hops := v_hops + 1;
            END LOOP;

        ELSIF v_kind = 'delete_activity' THEN
            v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'activities', p_programme_id, 'activity');
            IF v_id IS NULL THEN
                RAISE EXCEPTION 'Say which activity to delete.' USING ERRCODE = '22023';
            END IF;
            SELECT * INTO v_act FROM programme.activities a WHERE a.id = v_id FOR UPDATE;
            IF v_act.is_tombstoned THEN
                RAISE EXCEPTION 'That activity was removed. Restore it first.' USING ERRCODE = '22023';
            END IF;
            IF EXISTS (SELECT 1 FROM programme.activities a WHERE a.parent_id = v_id AND NOT a.is_tombstoned) THEN
                RAISE EXCEPTION 'Delete or move its sub-activities first.' USING ERRCODE = '22023';
            END IF;
            -- Spec 4.2 / 4.7: history on an activity is never deleted silently.
            -- An activity carrying a field update, a resource assignment (and its
            -- rand cost), a code, a work item, an import identity, a baseline
            -- snapshot or a (tombstoned) sub-activity is TOMBSTONED: the row and
            -- every child row stay. Only its links go, because a tombstoned
            -- activity is out of the schedule and the links would dangle. This
            -- also means an editor who cannot see costs (a Solar-edit contractor)
            -- can never destroy cost rows through a delete.
            IF v_act.work_item_id IS NOT NULL OR v_act.external_uid IS NOT NULL
               OR EXISTS (SELECT 1 FROM programme.activities a WHERE a.parent_id = v_id)
               OR EXISTS (SELECT 1 FROM programme.field_updates f WHERE f.activity_id = v_id)
               OR EXISTS (SELECT 1 FROM programme.resource_assignments r WHERE r.activity_id = v_id)
               OR EXISTS (SELECT 1 FROM programme.activity_codes c WHERE c.activity_id = v_id)
               OR EXISTS (SELECT 1 FROM programme.baseline_activities b
                           WHERE b.programme_id = p_programme_id AND b.activity_id = v_id) THEN
                DELETE FROM programme.dependencies WHERE v_id IN (pred_id, succ_id);
                UPDATE programme.activities SET is_tombstoned = true WHERE id = v_id;
                v_tombstoned := v_tombstoned || to_jsonb(v_id);
            ELSE
                DELETE FROM programme.activities WHERE id = v_id;
                v_deleted := v_deleted || to_jsonb(v_id);
            END IF;

        ELSIF v_kind = 'upsert_dependency' THEN
            v_pred := programme.resolve_ref(v_op ->> 'pred', v_keys, 'activities', p_programme_id, 'activity');
            v_succ := programme.resolve_ref(v_op ->> 'succ', v_keys, 'activities', p_programme_id, 'activity');
            IF v_op ->> 'id' IS NOT NULL THEN
                v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'dependencies', p_programme_id, 'link');
                SELECT * INTO v_dep FROM programme.dependencies d WHERE d.id = v_id FOR UPDATE;
                v_pred := coalesce(v_pred, v_dep.pred_id);
                v_succ := coalesce(v_succ, v_dep.succ_id);
            ELSIF v_pred IS NULL OR v_succ IS NULL THEN
                RAISE EXCEPTION 'A link needs a predecessor and a successor.' USING ERRCODE = '22023';
            END IF;
            IF v_pred = v_succ THEN
                RAISE EXCEPTION 'An activity cannot be linked to itself.' USING ERRCODE = '22023';
            END IF;
            IF EXISTS (SELECT 1 FROM programme.activities a WHERE a.id IN (v_pred, v_succ) AND a.is_tombstoned) THEN
                RAISE EXCEPTION 'That activity was removed. Restore it first.' USING ERRCODE = '22023';
            END IF;
            IF v_op ->> 'id' IS NOT NULL THEN
                UPDATE programme.dependencies SET
                    pred_id = v_pred, succ_id = v_succ,
                    type = coalesce(v_op ->> 'type', v_dep.type),
                    lag = coalesce((v_op ->> 'lag')::numeric, v_dep.lag),
                    lag_unit = coalesce(v_op ->> 'lag_unit', v_dep.lag_unit),
                    lag_calendar = coalesce(v_op ->> 'lag_calendar', v_dep.lag_calendar)
                 WHERE id = v_id;
            ELSE
                INSERT INTO programme.dependencies (programme_id, pred_id, succ_id, type, lag, lag_unit, lag_calendar)
                VALUES (p_programme_id, v_pred, v_succ, coalesce(v_op ->> 'type', 'FS'), coalesce((v_op ->> 'lag')::numeric, 0),
                        coalesce(v_op ->> 'lag_unit', 'working_days'), coalesce(v_op ->> 'lag_calendar', 'pred'))
                RETURNING id INTO v_id;
                v_created := v_created || to_jsonb(v_id);
            END IF;

        ELSIF v_kind = 'delete_dependency' THEN
            v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'dependencies', p_programme_id, 'link');
            IF v_id IS NULL THEN
                RAISE EXCEPTION 'Say which link to delete.' USING ERRCODE = '22023';
            END IF;
            DELETE FROM programme.dependencies WHERE id = v_id;
            v_deleted := v_deleted || to_jsonb(v_id);

        ELSIF v_kind = 'upsert_calendar' THEN
            SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) INTO v_f
              FROM jsonb_each(CASE WHEN jsonb_typeof(v_op -> 'fields') = 'object' THEN v_op -> 'fields' ELSE '{}'::jsonb END) AS e(k, v)
             WHERE e.k = ANY (c_cal_fields);
            IF v_op ->> 'id' IS NOT NULL THEN
                v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'calendars', p_programme_id, 'calendar');
                SELECT * INTO v_cal FROM programme.calendars c WHERE c.id = v_id FOR UPDATE;
                v_cal := jsonb_populate_record(v_cal, v_f);
                UPDATE programme.calendars SET name = v_cal.name, variant = v_cal.variant, work_weekdays = v_cal.work_weekdays,
                    hours_per_day = v_cal.hours_per_day, coverage_from = v_cal.coverage_from, coverage_to = v_cal.coverage_to
                 WHERE id = v_id;
            ELSE
                v_cal := jsonb_populate_record(NULL::programme.calendars, v_f);
                INSERT INTO programme.calendars (programme_id, name, variant, work_weekdays, hours_per_day, coverage_from, coverage_to)
                VALUES (p_programme_id, v_cal.name, coalesce(v_cal.variant, 'custom'),
                        coalesce(v_cal.work_weekdays, ARRAY[1,2,3,4,5]::smallint[]), coalesce(v_cal.hours_per_day, 8),
                        v_cal.coverage_from, v_cal.coverage_to)
                RETURNING id INTO v_id;
                v_created := v_created || to_jsonb(v_id);
            END IF;

        ELSIF v_kind = 'set_calendar_exceptions' THEN
            v_id := programme.resolve_ref(v_op ->> 'calendar', v_keys, 'calendars', p_programme_id, 'calendar');
            IF v_id IS NULL THEN
                RAISE EXCEPTION 'Say which calendar the exceptions belong to.' USING ERRCODE = '22023';
            END IF;
            IF jsonb_typeof(coalesce(v_op -> 'exceptions', '[]'::jsonb)) <> 'array' THEN
                RAISE EXCEPTION 'The calendar exceptions must be sent as a list.' USING ERRCODE = '22023';
            END IF;
            DELETE FROM programme.calendar_exceptions WHERE calendar_id = v_id;
            INSERT INTO programme.calendar_exceptions (calendar_id, programme_id, day, kind, label)
            SELECT v_id, p_programme_id, (x.value ->> 'day')::date, coalesce(x.value ->> 'kind', 'non_work'), x.value ->> 'label'
              FROM jsonb_array_elements(coalesce(v_op -> 'exceptions', '[]'::jsonb)) AS x(value);
            v_id := NULL;

        ELSIF v_kind = 'upsert_code_type' THEN
            IF v_op ->> 'id' IS NOT NULL THEN
                v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'code_types', p_programme_id, 'code type');
                UPDATE programme.code_types SET name = coalesce(v_op ->> 'name', name) WHERE id = v_id;
            ELSE
                INSERT INTO programme.code_types (programme_id, name) VALUES (p_programme_id, v_op ->> 'name')
                RETURNING id INTO v_id;
                v_created := v_created || to_jsonb(v_id);
            END IF;

        ELSIF v_kind = 'upsert_code_value' THEN
            v_type := programme.resolve_ref(v_op ->> 'code_type', v_keys, 'code_types', p_programme_id, 'code type');
            IF v_op ->> 'id' IS NOT NULL THEN
                v_id := programme.resolve_ref(v_op ->> 'id', v_keys, 'code_values', p_programme_id, 'code value');
                SELECT * INTO v_cv FROM programme.code_values v WHERE v.id = v_id FOR UPDATE;
                IF v_type IS NOT NULL AND v_type <> v_cv.code_type_id THEN
                    RAISE EXCEPTION 'A code value cannot move to another code type.' USING ERRCODE = '22023';
                END IF;
                UPDATE programme.code_values SET
                    value = coalesce(v_op ->> 'value', v_cv.value),
                    colour = CASE WHEN v_op ? 'colour' THEN v_op ->> 'colour' ELSE v_cv.colour END,
                    organisation_tag = CASE WHEN v_op ? 'organisation_tag' THEN (v_op ->> 'organisation_tag')::uuid ELSE v_cv.organisation_tag END,
                    user_tag = CASE WHEN v_op ? 'user_tag' THEN (v_op ->> 'user_tag')::uuid ELSE v_cv.user_tag END
                 WHERE id = v_id;
            ELSE
                IF v_type IS NULL THEN
                    RAISE EXCEPTION 'A code value needs a code type.' USING ERRCODE = '22023';
                END IF;
                INSERT INTO programme.code_values (code_type_id, programme_id, value, colour, organisation_tag, user_tag)
                VALUES (v_type, p_programme_id, v_op ->> 'value', v_op ->> 'colour',
                        (v_op ->> 'organisation_tag')::uuid, (v_op ->> 'user_tag')::uuid)
                RETURNING id INTO v_id;
                v_created := v_created || to_jsonb(v_id);
            END IF;

        ELSIF v_kind = 'set_activity_code' THEN
            v_id := programme.resolve_ref(v_op ->> 'activity', v_keys, 'activities', p_programme_id, 'activity');
            v_type := programme.resolve_ref(v_op ->> 'code_type', v_keys, 'code_types', p_programme_id, 'code type');
            IF v_id IS NULL OR v_type IS NULL THEN
                RAISE EXCEPTION 'Say which activity and which code type.' USING ERRCODE = '22023';
            END IF;
            IF v_op ->> 'code_value' IS NULL THEN
                DELETE FROM programme.activity_codes WHERE activity_id = v_id AND code_type_id = v_type;
            ELSE
                v_val := programme.resolve_ref(v_op ->> 'code_value', v_keys, 'code_values', p_programme_id, 'code value');
                INSERT INTO programme.activity_codes (activity_id, code_type_id, code_value_id, programme_id)
                VALUES (v_id, v_type, v_val, p_programme_id)
                ON CONFLICT (activity_id, code_type_id) DO UPDATE SET code_value_id = EXCLUDED.code_value_id;
            END IF;
            v_id := NULL;

        ELSIF v_kind = 'set_programme' THEN
            SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) INTO v_f
              FROM jsonb_each(CASE WHEN jsonb_typeof(v_op -> 'fields') = 'object' THEN v_op -> 'fields' ELSE '{}'::jsonb END) AS e(k, v)
             WHERE e.k = ANY (c_prog_fields);
            IF jsonb_typeof(v_f -> 'default_calendar_id') = 'string' THEN
                v_f := jsonb_set(v_f, '{default_calendar_id}', to_jsonb(programme.resolve_ref(v_f ->> 'default_calendar_id', v_keys, 'calendars', p_programme_id, 'calendar')));
            END IF;
            IF v_f ? 'options' AND jsonb_typeof(v_f -> 'options') <> 'object' THEN
                RAISE EXCEPTION 'The programme options must be an object.' USING ERRCODE = '22023';
            END IF;
            SELECT * INTO v_prog FROM programme.programmes g WHERE g.id = p_programme_id;
            v_prog := jsonb_populate_record(v_prog, v_f);
            UPDATE programme.programmes SET name = v_prog.name, data_date = v_prog.data_date, project_start = v_prog.project_start,
                options = v_prog.options, default_calendar_id = v_prog.default_calendar_id
             WHERE id = p_programme_id;
            v_id := NULL;

        ELSE
            RAISE EXCEPTION 'Unknown change "%".', coalesce(v_kind, '(none)') USING ERRCODE = '22023';
        END IF;

        IF v_key IS NOT NULL AND v_id IS NOT NULL THEN
            v_keys := v_keys || jsonb_build_object(v_key, v_id);
        END IF;
        v_id := NULL;
    END LOOP;

    -- The computed cache (activities of this programme only).
    v_kind := 'computed';
    IF p_computed IS NOT NULL THEN
        IF p_computed ? 'project_finish' THEN
            UPDATE programme.programmes SET project_finish = (p_computed ->> 'project_finish')::date WHERE id = p_programme_id;
        END IF;
        IF jsonb_typeof(coalesce(p_computed -> 'activities', '[]'::jsonb)) <> 'array' THEN
            RAISE EXCEPTION 'The computed activities must be sent as a list.' USING ERRCODE = '22023';
        END IF;
        FOR v_c IN SELECT e.value FROM jsonb_array_elements(coalesce(p_computed -> 'activities', '[]'::jsonb)) AS e(value) LOOP
            v_id := programme.resolve_ref(coalesce(v_c ->> 'id', v_c ->> 'key'), v_keys, 'activities', p_programme_id, 'activity');
            IF v_id IS NULL THEN
                RAISE EXCEPTION 'Each computed activity needs an id or a key.' USING ERRCODE = '22023';
            END IF;
            UPDATE programme.activities SET
                early_start = (v_c ->> 'early_start')::date, early_finish = (v_c ->> 'early_finish')::date,
                late_start = (v_c ->> 'late_start')::date, late_finish = (v_c ->> 'late_finish')::date,
                total_float = (v_c ->> 'total_float')::numeric, free_float = (v_c ->> 'free_float')::numeric,
                is_critical = coalesce((v_c ->> 'is_critical')::boolean, false),
                is_driving = coalesce((v_c ->> 'is_driving')::boolean, false)
             WHERE id = v_id;
            v_n_computed := v_n_computed + 1;
        END LOOP;
    END IF;
    -- Database refusals become plain sentences; the constraint stays in DETAIL.
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION '%', CASE v_kind
                WHEN 'upsert_dependency' THEN 'Those two activities are already linked that way.'
                WHEN 'upsert_code_type' THEN 'A code type with that name already exists.'
                WHEN 'upsert_activity' THEN 'Another activity already has that external id.'
                WHEN 'set_calendar_exceptions' THEN 'The same day appears twice in the calendar exceptions.'
                ELSE 'That would duplicate an existing row.' END
                USING ERRCODE = '23505', DETAIL = SQLERRM;
        WHEN check_violation OR not_null_violation THEN
            RAISE EXCEPTION 'One of the values in this change is missing or not allowed.' USING ERRCODE = '22023', DETAIL = SQLERRM;
        WHEN foreign_key_violation THEN
            RAISE EXCEPTION 'Something this change refers to no longer exists. Reload to see the current programme.'
                USING ERRCODE = 'P0002', DETAIL = SQLERRM;
        -- (not invalid_parameter_value: that is 22023, the SQLSTATE of this
        -- function's own sentences, which must pass through unchanged)
        WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format
             OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'One of the values in this change is not in the expected form.' USING ERRCODE = '22023', DETAIL = SQLERRM;
    END;

    UPDATE programme.programmes SET updated_at = clock_timestamp() WHERE id = p_programme_id
    RETURNING updated_at INTO v_version;
    PERFORM programme.write_audit(p_programme_id, 'programme.saved', jsonb_build_object(
        'ops', v_counts, 'created', v_created, 'deleted', v_deleted, 'tombstoned', v_tombstoned,
        'computed', v_n_computed, 'decided', v_n_decided));
    IF v_n_decided > 0 THEN
        PERFORM programme.write_audit(p_programme_id, 'field_updates.decided', jsonb_build_object(
            'field_update_ids', v_decided_ids, 'by_status', v_by));
    END IF;
    RETURN jsonb_build_object('version', v_version, 'ids', v_keys, 'deleted', v_deleted, 'tombstoned', v_tombstoned,
        'decided', v_n_decided);
END $$;

-- 3. save_baseline: a full snapshot of the live (non-tombstoned) activities,
-- the links between them, and per-activity budgeted cost summed from
-- assignment_costs into the masked baseline_costs table. The audit row carries
-- counts only, never the sums.
CREATE OR REPLACE FUNCTION programme.save_baseline(p_programme_id uuid, p_name text, p_set_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_id uuid; v_n_act int; v_n_dep int; v_n_cost int;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || p_programme_id::text, 0));
    IF NOT coalesce(programme.can_edit(p_programme_id), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'Give the baseline a name of up to 120 characters.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_set_active, false) THEN
        UPDATE programme.baselines SET is_active = false WHERE programme_id = p_programme_id AND is_active;
    END IF;
    INSERT INTO programme.baselines (programme_id, name, is_active, source)
        VALUES (p_programme_id, btrim(p_name), coalesce(p_set_active, false), 'manual') RETURNING id INTO v_id;

    INSERT INTO programme.baseline_activities (baseline_id, programme_id, activity_id, name, type, parent_id, wbs_code, code,
        original_duration, remaining_duration, early_start, early_finish, late_start, late_finish, total_float, free_float,
        percent_complete, sort_order)
    SELECT v_id, p_programme_id, a.id, a.name, a.type, a.parent_id, a.wbs_code, a.code, a.original_duration, a.remaining_duration,
           a.early_start, a.early_finish, a.late_start, a.late_finish, a.total_float, a.free_float, a.percent_complete, a.sort_order
      FROM programme.activities a WHERE a.programme_id = p_programme_id AND NOT a.is_tombstoned;
    GET DIAGNOSTICS v_n_act = ROW_COUNT;

    INSERT INTO programme.baseline_dependencies (baseline_id, programme_id, pred_id, succ_id, type, lag, lag_unit, lag_calendar)
    SELECT v_id, p_programme_id, d.pred_id, d.succ_id, d.type, d.lag, d.lag_unit, d.lag_calendar
      FROM programme.dependencies d
      JOIN programme.activities p ON p.id = d.pred_id AND NOT p.is_tombstoned
      JOIN programme.activities s ON s.id = d.succ_id AND NOT s.is_tombstoned
     WHERE d.programme_id = p_programme_id;
    GET DIAGNOSTICS v_n_dep = ROW_COUNT;

    INSERT INTO programme.baseline_costs (baseline_id, activity_id, programme_id, budgeted_cost)
    SELECT v_id, ra.activity_id, p_programme_id, sum(ac.budgeted_cost)
      FROM programme.resource_assignments ra
      JOIN programme.assignment_costs ac ON ac.assignment_id = ra.id
      JOIN programme.activities a ON a.id = ra.activity_id AND NOT a.is_tombstoned
     WHERE ra.programme_id = p_programme_id
     GROUP BY ra.activity_id;
    GET DIAGNOSTICS v_n_cost = ROW_COUNT;

    PERFORM programme.write_audit(p_programme_id, 'baseline.saved', jsonb_build_object(
        'baseline_id', v_id, 'active', coalesce(p_set_active, false),
        'activities', v_n_act, 'dependencies', v_n_dep, 'cost_rows', v_n_cost));
    RETURN v_id;
END $$;

-- 4. set_active_baseline / delete_baseline (editor only).
CREATE OR REPLACE FUNCTION programme.set_active_baseline(p_baseline_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_prog uuid;
BEGIN
    SELECT b.programme_id INTO v_prog FROM programme.baselines b WHERE b.id = p_baseline_id;
    IF v_prog IS NULL THEN
        RAISE EXCEPTION 'That baseline no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || v_prog::text, 0));
    IF NOT coalesce(programme.can_edit(v_prog), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    UPDATE programme.baselines SET is_active = false WHERE programme_id = v_prog AND is_active AND id <> p_baseline_id;
    UPDATE programme.baselines SET is_active = true WHERE id = p_baseline_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That baseline no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM programme.write_audit(v_prog, 'baseline.activated', jsonb_build_object('baseline_id', p_baseline_id));
END $$;

CREATE OR REPLACE FUNCTION programme.delete_baseline(p_baseline_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_prog uuid;
BEGIN
    SELECT b.programme_id INTO v_prog FROM programme.baselines b WHERE b.id = p_baseline_id;
    IF v_prog IS NULL THEN
        RAISE EXCEPTION 'That baseline no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || v_prog::text, 0));
    IF NOT coalesce(programme.can_edit(v_prog), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    DELETE FROM programme.baselines WHERE id = p_baseline_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That baseline no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM programme.write_audit(v_prog, 'baseline.deleted', jsonb_build_object('baseline_id', p_baseline_id));
END $$;

-- 5. submit_field_update: progress reported from site. Recorded as
-- 'reported'; it moves no date. The caller must read the programme AND be
-- either (a) an editor (can_edit), or (b) a SITE role (effective project role
-- contractor or inspector, spec 4.6) on an activity carrying a code value
-- tagged to the caller (user_tag) or to an organisation the caller is an
-- active member of. A tagged supplier, a PM without edit, anyone else: 42501.
CREATE OR REPLACE FUNCTION programme.submit_field_update(
    p_activity_id uuid, p_start date, p_finish date, p_percent numeric, p_remaining numeric, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_prog uuid; v_project uuid; v_tomb boolean; v_id uuid; v_note text := nullif(btrim(p_note), '');
BEGIN
    SELECT a.programme_id, a.project_id, a.is_tombstoned INTO v_prog, v_project, v_tomb
      FROM programme.activities a WHERE a.id = p_activity_id;
    IF v_prog IS NULL THEN
        RAISE EXCEPTION 'That activity no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || v_prog::text, 0));
    IF NOT (coalesce(programme.can_read(v_prog), false) AND (
            coalesce(programme.can_edit(v_prog), false)
            OR coalesce(public.user_effective_project_role(v_project), '') IN ('contractor', 'inspector') AND EXISTS (
                SELECT 1 FROM programme.activity_codes ac
                  JOIN programme.code_values v ON v.id = ac.code_value_id
                 WHERE ac.activity_id = p_activity_id
                   AND (v.user_tag = auth.uid()
                        OR v.organisation_tag IN (SELECT uo.organisation_id FROM public.user_organisations uo
                                                   WHERE uo.user_id = auth.uid() AND uo.is_active))))) THEN
        RAISE EXCEPTION 'You can only report progress on activities assigned to your company or crew.' USING ERRCODE = '42501';
    END IF;
    IF v_tomb THEN
        RAISE EXCEPTION 'That activity was removed from the programme.' USING ERRCODE = '22023';
    END IF;
    IF p_start IS NULL AND p_finish IS NULL AND p_percent IS NULL AND p_remaining IS NULL AND v_note IS NULL THEN
        RAISE EXCEPTION 'Report a date, a percentage, the remaining duration or a note.' USING ERRCODE = '22023';
    END IF;
    IF p_percent IS NOT NULL AND (p_percent < 0 OR p_percent > 100) THEN
        RAISE EXCEPTION 'Percent complete must be between 0 and 100.' USING ERRCODE = '22023';
    END IF;
    IF p_remaining IS NOT NULL AND p_remaining < 0 THEN
        RAISE EXCEPTION 'The remaining duration cannot be negative.' USING ERRCODE = '22023';
    END IF;
    IF p_start IS NOT NULL AND p_finish IS NOT NULL AND p_finish < p_start THEN
        RAISE EXCEPTION 'The finish cannot be before the start.' USING ERRCODE = '22023';
    END IF;
    IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
        RAISE EXCEPTION 'Keep the note to 2000 characters.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO programme.field_updates (programme_id, activity_id, author_id, reported_start, reported_finish,
                                         reported_percent, reported_remaining, note, status)
    VALUES (v_prog, p_activity_id, auth.uid(), p_start, p_finish, p_percent, p_remaining, v_note, 'reported')
    RETURNING id INTO v_id;
    PERFORM programme.write_audit(v_prog, 'field_update.submitted', jsonb_build_object(
        'field_update_id', v_id, 'activity_id', p_activity_id));
    RETURN v_id;
END $$;

-- 6. Deciding field updates (editor only) is NOT a separate function: it is
-- save_changes' p_decisions, so a decision and the activity actuals it agrees
-- to are one transaction under one version check.

-- ── 7. Module rollup ────────────────────────────────────────────────────────
-- The project programme's module_summary bar. Any project reader (project
-- access, not client_viewer) may call it; the MODULE gate is deliberately NOT
-- required, so a person without solar access sees the bar and nothing else:
-- three numbers over the module programme's live, non-summary activities.
-- Percent complete is weighted by duration, never by cost.
CREATE OR REPLACE FUNCTION programme.module_summary(p_project_id uuid, p_module_key text)
RETURNS TABLE (start date, finish date, percent_complete numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
#variable_conflict use_column
BEGIN
    IF NOT (coalesce(public.user_has_project_access(p_project_id), false)
            AND coalesce(public.user_effective_project_role(p_project_id), 'client_viewer') <> 'client_viewer') THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT min(coalesce(a.actual_start, a.early_start)),
           max(coalesce(a.actual_finish, a.early_finish)),
           sum(a.percent_complete * a.original_duration) / nullif(sum(a.original_duration), 0)
      FROM programme.programmes g
      JOIN programme.activities a ON a.programme_id = g.id
     WHERE g.project_id = p_project_id AND g.kind = 'module' AND g.module_key = p_module_key
       AND NOT a.is_tombstoned AND a.type NOT IN ('summary', 'module_summary');
END $$;

-- Grants. PUBLIC holds EXECUTE by default and Supabase's default privileges
-- grant anon directly, so both are named. Functions 1-7 go to authenticated
-- only; the two internals go to nobody (their owner still runs them).
REVOKE ALL ON FUNCTION programme.write_audit(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.resolve_ref(text, jsonb, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.create_programme(uuid, text, text, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.save_baseline(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.set_active_baseline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.delete_baseline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.submit_field_update(uuid, date, date, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION programme.module_summary(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION programme.create_programme(uuid, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.save_changes(uuid, timestamptz, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.save_baseline(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.set_active_baseline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.delete_baseline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.submit_field_update(uuid, date, date, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION programme.module_summary(uuid, text) TO authenticated;
