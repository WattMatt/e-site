-- ---------------------------------------------------------------------------
-- Migration 00217: Solar operations (Phase 7)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §10 and §2.3 (Operations readiness);
-- docs/solar/03-data-model-and-security.md §3 (installations, guarantees, downtime,
-- monthly_report_notes, handover_items, handover_templates), §3.1; as-is 06 Parts D and E.
-- Plan: docs/superpowers/plans/2026-09-29-solar-phase-7-1-schema.md
--
-- WHAT
--   * solar.installations         one per study; created only from an ACCEPTED proposal; the
--                                 modelled baseline (monthly P50, diurnal profile, TMY GHI,
--                                 design PR) is frozen in the row; as_built stays editable.
--   * solar.installation_meters   generation meters (kind solar) and consumption meters (council
--                                 or bulk); one role per meter, so a council meter can never be
--                                 counted as generation.
--   * solar.guarantees            the basis (p50 / manual / pct_of_modelled); expected kWh is
--                                 derived per month at read time, never typed per month.
--   * solar.ops_irradiation       measured monthly irradiation (POA or GHI) with a source note.
--   * solar.downtime              outages, no overlaps, never before commissioning;
--   * solar.downtime_history      the old row of every direct edit or delete (append-only).
--   * solar.monthly_report_notes  engineer commentary per report month and section (money).
--   * solar.monthly_reports       the frozen metric snapshot of every generated monthly report
--                                 version (money), service-written, immutable.
--   * solar.handover_templates    org checklist template (owner/admin).
--   * solar.handover_items        per-installation checklist; each item links one
--                                 tenants.documents row of the same project, or is N/A.
--   * public.solar_ops_monthly_kwh / public.solar_ops_series: SECURITY INVOKER aggregations
--     returning ONE jsonb document. A reading overlapped by a reading of a NEWER channel of the same
--     meter is dropped, so a re-import of overlapping data never doubles, at any interval. Month =
--     SAST month of the interval START (ts_end minus interval_min).
--   * solar.installations is written by the SERVICE role only (createInstallationAction after its
--     Edit gate); the bind trigger also pins the baseline to the accepted proposal's run.
--   * public.user_can_read_report_kind(): every Solar kind, solar_monthly on Edit + financials.
--   * projects.reports: a solar_monthly row is evidence of what the client received; no session
--     deletes it (the 00216 proposal rule, extended to the monthly report).
--   * product_events: five Phase 7 events.
-- RULES
--   * 00207's schema-wide directives hold: FORCE RLS on every solar table, no RESTRICTIVE read
--     policy in schema solar, every SECURITY DEFINER function revoked from anon.
--   * Per-verb write policies only (never RESTRICTIVE FOR ALL: it narrows reads too, the 00205 lesson).
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.installations
-- table: solar.installation_meters
-- table: solar.guarantees
-- table: solar.ops_irradiation
-- table: solar.downtime
-- table: solar.downtime_history
-- table: solar.monthly_report_notes
-- table: solar.monthly_reports
-- table: solar.handover_templates
-- table: solar.handover_items
-- constraint: installations_baseline_shape ON solar.installations
-- constraint: installations_one_per_study ON solar.installations
-- constraint: guarantees_basis_fields ON solar.guarantees
-- constraint: guarantees_manual_twelve ON solar.guarantees
-- constraint: ops_irradiation_first_of_month ON solar.ops_irradiation
-- constraint: downtime_window ON solar.downtime
-- constraint: monthly_reports_version_uniq ON solar.monthly_reports
-- constraint: handover_items_key_uniq ON solar.handover_items
-- constraint: handover_items_na_or_doc ON solar.handover_items
-- function: solar.installations_bind()
-- function: solar.installation_meters_bind()
-- function: solar.ops_bind_from_installation()
-- function: solar.downtime_bind()
-- function: solar.downtime_history_record()
-- function: solar.monthly_reports_guard()
-- function: solar.handover_templates_bind()
-- function: solar.handover_items_bind()
-- function: public.solar_ops_monthly_kwh(uuid, text)
-- function: public.solar_ops_series(uuid, text, date)
-- function: public.report_kind_is_sensitive(text)
-- function: public.user_can_read_report_kind(uuid, text)
-- trigger: installations_bind ON solar.installations
-- trigger: installation_meters_bind ON solar.installation_meters
-- trigger: guarantees_bind ON solar.guarantees
-- trigger: ops_irradiation_bind ON solar.ops_irradiation
-- trigger: monthly_report_notes_bind ON solar.monthly_report_notes
-- trigger: downtime_bind ON solar.downtime
-- trigger: downtime_history_record ON solar.downtime
-- trigger: monthly_reports_guard ON solar.monthly_reports
-- trigger: handover_templates_bind ON solar.handover_templates
-- trigger: handover_items_bind ON solar.handover_items
-- policy: installations_select ON solar.installations PERMISSIVE
-- policy: installations_insert_authz ON solar.installations RESTRICTIVE
-- policy: installations_update_authz ON solar.installations RESTRICTIVE
-- policy: installations_delete_authz ON solar.installations RESTRICTIVE
-- policy: installation_meters_select ON solar.installation_meters PERMISSIVE
-- policy: installation_meters_insert_authz ON solar.installation_meters RESTRICTIVE
-- policy: guarantees_select ON solar.guarantees PERMISSIVE
-- policy: guarantees_update_authz ON solar.guarantees RESTRICTIVE
-- policy: ops_irradiation_select ON solar.ops_irradiation PERMISSIVE
-- policy: downtime_select ON solar.downtime PERMISSIVE
-- policy: downtime_insert_authz ON solar.downtime RESTRICTIVE
-- policy: downtime_history_select ON solar.downtime_history PERMISSIVE
-- policy: monthly_report_notes_select ON solar.monthly_report_notes PERMISSIVE
-- policy: monthly_report_notes_insert_authz ON solar.monthly_report_notes RESTRICTIVE
-- policy: monthly_reports_select ON solar.monthly_reports PERMISSIVE
-- policy: handover_templates_select ON solar.handover_templates PERMISSIVE
-- policy: handover_templates_update_authz ON solar.handover_templates RESTRICTIVE
-- policy: handover_items_select ON solar.handover_items PERMISSIVE
-- policy: handover_items_update_authz ON solar.handover_items RESTRICTIVE
-- policy: reports_solar_monthly_delete_authz ON projects.reports RESTRICTIVE
-- grant_absent: anon SELECT ON solar.installations
-- grant_absent: anon SELECT ON solar.monthly_reports
-- grant_absent: anon SELECT ON solar.downtime
-- grant_absent: authenticated INSERT ON solar.monthly_reports
-- grant_absent: authenticated UPDATE ON solar.monthly_reports
-- grant_absent: authenticated DELETE ON solar.monthly_reports
-- grant_absent: service_role UPDATE ON solar.monthly_reports
-- grant_absent: service_role DELETE ON solar.monthly_reports
-- grant_absent: authenticated INSERT ON solar.downtime_history
-- grant_absent: authenticated UPDATE ON solar.downtime_history
-- grant_absent: authenticated DELETE ON solar.downtime_history
-- grant_absent: authenticated DELETE ON solar.handover_templates
-- grant_absent: anon EXECUTE ON public.solar_ops_monthly_kwh(uuid, text)
-- grant_absent: anon EXECUTE ON public.solar_ops_series(uuid, text, date)
-- grant_absent: anon EXECUTE ON public.user_can_read_report_kind(uuid, text)
-- grant_present: authenticated EXECUTE ON public.solar_ops_monthly_kwh(uuid, text)
-- grant_present: authenticated EXECUTE ON public.solar_ops_series(uuid, text, date)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('monthly_reports', 'monthly_report_notes') AND cmd = 'SELECT')
-- sql: (SELECT with_check = 'false' FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'installations' AND policyname = 'installations_insert_authz' AND permissive = 'RESTRICTIVE')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('installations', 'installation_meters', 'guarantees', 'ops_irradiation', 'downtime', 'downtime_history', 'monthly_report_notes', 'monthly_reports', 'handover_templates', 'handover_items') AND cmd = 'ALL')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('monthly_reports', 'downtime_history') AND cmd IN ('INSERT', 'UPDATE', 'DELETE'))
-- sql: (SELECT bool_and(c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND c.relname IN ('installations', 'installation_meters', 'guarantees', 'ops_irradiation', 'downtime', 'downtime_history', 'monthly_report_notes', 'monthly_reports', 'handover_templates', 'handover_items'))
-- sql: (SELECT NOT bool_or(p.prosecdef) FROM pg_proc p WHERE p.oid IN ('public.solar_ops_monthly_kwh(uuid, text)'::regprocedure, 'public.solar_ops_series(uuid, text, date)'::regprocedure))
-- sql: (SELECT prosrc LIKE '%solar_monthly%' AND prosrc LIKE '%solar_layout_sheet%' AND prosrc LIKE '%solar_technical%' AND prosrc LIKE '%solar_feasibility%' AND prosrc LIKE '%solar_proposal%' FROM pg_proc WHERE oid = 'public.user_can_read_report_kind(uuid, text)'::regprocedure)
-- sql: (SELECT public.report_kind_is_sensitive('solar_monthly') AND public.report_kind_is_sensitive('solar_proposal'))
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_monthly_report_generated%' AND pg_get_constraintdef(oid) LIKE '%solar_handover_updated%' AND pg_get_constraintdef(oid) LIKE '%solar_proposal_issued%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- behaviour: scripts/db/assert-solar-operations-roles.sql, every row ok
-- @verify:end

-- NO BEGIN/COMMIT: scripts/db/dry-run-migration.sh wraps this file in BEGIN … ROLLBACK.

-- ── 1. Installations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.installations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    proposal_id         UUID REFERENCES solar.proposals(id) ON DELETE SET NULL,
    commissioning_date  DATE CONSTRAINT installations_commissioning_sane
                          CHECK (commissioning_date IS NULL OR commissioning_date >= DATE '2000-01-01'),
    baseline            JSONB NOT NULL CONSTRAINT installations_baseline_shape CHECK (
                            jsonb_typeof(baseline) = 'object'
                            AND jsonb_typeof(baseline -> 'monthlyKwh') = 'array' AND jsonb_array_length(baseline -> 'monthlyKwh') = 12
                            AND jsonb_typeof(baseline -> 'diurnalKw') = 'array' AND jsonb_array_length(baseline -> 'diurnalKw') = 12
                            AND jsonb_typeof(baseline -> 'dcKwp') = 'number' AND jsonb_typeof(baseline -> 'acKw') = 'number'),
    as_built            JSONB NOT NULL CONSTRAINT installations_as_built_is_object CHECK (jsonb_typeof(as_built) = 'object'),
    notes               TEXT CHECK (notes IS NULL OR length(notes) <= 5000),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT installations_one_per_study UNIQUE (study_id)
);
CREATE INDEX IF NOT EXISTS installations_project_idx ON solar.installations (project_id);

CREATE OR REPLACE FUNCTION solar.installations_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_run UUID;
BEGIN
    -- Depth > 1 is an FK action (proposal SET NULL, study cascade); it passes untouched.
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.installations: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        SELECT p.case_run_id INTO v_run FROM solar.proposals p
         WHERE p.id = NEW.proposal_id AND p.study_id = NEW.study_id AND p.status = 'accepted';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'solar.installations: an installation starts from an accepted proposal of this study' USING ERRCODE = '23514';
        END IF;
        -- Defence in depth behind the service-only insert: the baseline is the accepted run's, and
        -- is shaped the way the reader expects (a malformed baseline would break every read, forever).
        IF NEW.baseline ->> 'caseRunId' IS DISTINCT FROM v_run::text THEN
            RAISE EXCEPTION 'solar.installations: the baseline is not the accepted proposal''s run' USING ERRCODE = '23514';
        END IF;
        IF jsonb_typeof(NEW.baseline -> 'version') IS DISTINCT FROM 'number'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.baseline -> 'diurnalKw') AS d(row)
                       WHERE CASE WHEN jsonb_typeof(d.row) = 'array' THEN jsonb_array_length(d.row) <> 24 ELSE TRUE END) THEN
            RAISE EXCEPTION 'solar.installations: the baseline is not a versioned 12 x 24 profile' USING ERRCODE = '23514';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.created_at := NOW();
    ELSE
        IF (NEW.id, NEW.study_id, NEW.project_id, NEW.organisation_id, NEW.proposal_id, NEW.baseline, NEW.created_by, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.study_id, OLD.project_id, OLD.organisation_id, OLD.proposal_id, OLD.baseline, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'solar.installations: the installation identity and its modelled baseline are immutable' USING ERRCODE = '42501';
        END IF;
        -- downtime_bind refuses downtime before commissioning; moving the date later must not strand
        -- downtime that is already recorded (review A6/B10).
        IF NEW.commissioning_date IS NOT NULL AND NEW.commissioning_date IS DISTINCT FROM OLD.commissioning_date
           AND EXISTS (SELECT 1 FROM solar.downtime d
                        WHERE d.installation_id = NEW.id
                          AND d.starts_at < (NEW.commissioning_date::timestamp AT TIME ZONE 'Africa/Johannesburg')) THEN
            RAISE EXCEPTION 'solar.installations: downtime is recorded before that commissioning date; move or delete it first' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.installations_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.installations_bind() FROM anon;
CREATE TRIGGER installations_bind BEFORE INSERT OR UPDATE ON solar.installations
    FOR EACH ROW EXECUTE FUNCTION solar.installations_bind();

ALTER TABLE solar.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.installations FORCE ROW LEVEL SECURITY;
CREATE POLICY installations_select ON solar.installations FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY installations_insert ON solar.installations FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY installations_update ON solar.installations FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY installations_delete ON solar.installations FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
-- Service-only INSERT (review A1): the baseline is the guarantee's yardstick and immutable, so no
-- session may write it. createInstallationAction gates Edit, reads the accepted run itself and
-- inserts with the service role, supplying created_by/updated_by.
CREATE POLICY installations_insert_authz ON solar.installations AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (false);
CREATE POLICY installations_update_authz ON solar.installations AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
-- Deleting an installation removes its downtime, reports and checklist: owner/admin/Edit + financials only.
CREATE POLICY installations_delete_authz ON solar.installations AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));

-- ── 2. Shared bind for child rows keyed on an installation ──────────────────
CREATE OR REPLACE FUNCTION solar.ops_bind_from_installation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.installation_id <> OLD.installation_id THEN
            RAISE EXCEPTION '%: installation_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    ELSE
        NEW.created_at := NOW();
    END IF;
    SELECT i.project_id, i.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.installations i WHERE i.id = NEW.installation_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION '%: installation % not found', TG_TABLE_NAME, NEW.installation_id USING ERRCODE = '23503';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.ops_bind_from_installation() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.ops_bind_from_installation() FROM anon;

-- ── 3. Installation meters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.installation_meters (
    installation_id     UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    meter_id            UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    role                TEXT NOT NULL CHECK (role IN ('generation', 'consumption')),
    expected_share_pct  NUMERIC(5,2) CHECK (expected_share_pct IS NULL OR (expected_share_pct > 0 AND expected_share_pct <= 100)),
    added_by            UUID REFERENCES auth.users(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (installation_id, meter_id)
);
CREATE INDEX IF NOT EXISTS installation_meters_meter_idx ON solar.installation_meters (meter_id);

CREATE OR REPLACE FUNCTION solar.installation_meters_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_kind TEXT;
    v_org  UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.installation_id, NEW.meter_id, NEW.role, NEW.added_by, NEW.added_at)
           IS DISTINCT FROM (OLD.installation_id, OLD.meter_id, OLD.role, OLD.added_by, OLD.added_at) THEN
            RAISE EXCEPTION 'solar.installation_meters: only the expected share can change; unlink and link again' USING ERRCODE = '42501';
        END IF;
    END IF;
    SELECT i.project_id, i.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.installations i WHERE i.id = NEW.installation_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.installation_meters: installation % not found', NEW.installation_id USING ERRCODE = '23503';
    END IF;
    SELECT m.kind, m.organisation_id INTO v_kind, v_org FROM solar.meters m WHERE m.id = NEW.meter_id;
    IF v_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION 'solar.installation_meters: the meter belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF NEW.role = 'generation' AND v_kind <> 'solar' THEN
        RAISE EXCEPTION 'solar.installation_meters: a generation meter must be a solar meter' USING ERRCODE = '23514';
    END IF;
    IF NEW.role = 'consumption' AND v_kind NOT IN ('council', 'bulk') THEN
        RAISE EXCEPTION 'solar.installation_meters: a consumption meter must be a council or bulk meter' USING ERRCODE = '23514';
    END IF;
    IF NEW.role = 'consumption' AND NEW.expected_share_pct IS NOT NULL THEN
        RAISE EXCEPTION 'solar.installation_meters: only a generation meter carries an expected share' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.added_by := COALESCE(auth.uid(), NEW.added_by);
        NEW.added_at := NOW();
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.installation_meters_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.installation_meters_bind() FROM anon;
CREATE TRIGGER installation_meters_bind BEFORE INSERT OR UPDATE ON solar.installation_meters
    FOR EACH ROW EXECUTE FUNCTION solar.installation_meters_bind();

ALTER TABLE solar.installation_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.installation_meters FORCE ROW LEVEL SECURITY;
CREATE POLICY installation_meters_select ON solar.installation_meters FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY installation_meters_insert ON solar.installation_meters FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY installation_meters_update ON solar.installation_meters FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY installation_meters_delete ON solar.installation_meters FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY installation_meters_insert_authz ON solar.installation_meters AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY installation_meters_update_authz ON solar.installation_meters AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY installation_meters_delete_authz ON solar.installation_meters AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 4. Guarantee basis ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.guarantees (
    installation_id           UUID PRIMARY KEY REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id                UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id           UUID NOT NULL REFERENCES public.organisations(id),
    basis                     TEXT NOT NULL CHECK (basis IN ('p50', 'manual', 'pct_of_modelled')),
    pct                       NUMERIC(6,2) CHECK (pct IS NULL OR (pct > 0 AND pct <= 200)),
    manual_monthly_kwh        NUMERIC(14,2)[],
    degradation_pct_per_year  NUMERIC(5,3) NOT NULL DEFAULT 0 CHECK (degradation_pct_per_year BETWEEN 0 AND 5),
    updated_by                UUID REFERENCES auth.users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guarantees_basis_fields CHECK (
        (basis = 'pct_of_modelled') = (pct IS NOT NULL)
        AND (basis = 'manual') = (manual_monthly_kwh IS NOT NULL)),
    CONSTRAINT guarantees_manual_twelve CHECK (
        manual_monthly_kwh IS NULL OR (
            array_length(manual_monthly_kwh, 1) = 12
            AND array_position(manual_monthly_kwh, NULL) IS NULL
            AND 0 <= ALL (manual_monthly_kwh)))
);
CREATE TRIGGER guarantees_bind BEFORE INSERT OR UPDATE ON solar.guarantees
    FOR EACH ROW EXECUTE FUNCTION solar.ops_bind_from_installation();

ALTER TABLE solar.guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.guarantees FORCE ROW LEVEL SECURITY;
CREATE POLICY guarantees_select ON solar.guarantees FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY guarantees_insert ON solar.guarantees FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY guarantees_update ON solar.guarantees FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY guarantees_delete ON solar.guarantees FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY guarantees_insert_authz ON solar.guarantees AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY guarantees_update_authz ON solar.guarantees AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY guarantees_delete_authz ON solar.guarantees AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 5. Measured irradiation (monthly) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.ops_irradiation (
    installation_id  UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    month            DATE NOT NULL CONSTRAINT ops_irradiation_first_of_month CHECK (extract(day FROM month) = 1),
    plane            TEXT NOT NULL CHECK (plane IN ('ghi', 'poa')),
    kwh_per_m2       NUMERIC(7,2) NOT NULL CHECK (kwh_per_m2 > 0 AND kwh_per_m2 <= 400),
    source_note      TEXT NOT NULL CHECK (length(btrim(source_note)) BETWEEN 3 AND 300),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (installation_id, month)
);
CREATE TRIGGER ops_irradiation_bind BEFORE INSERT OR UPDATE ON solar.ops_irradiation
    FOR EACH ROW EXECUTE FUNCTION solar.ops_bind_from_installation();

ALTER TABLE solar.ops_irradiation ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.ops_irradiation FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_irradiation_select ON solar.ops_irradiation FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY ops_irradiation_insert ON solar.ops_irradiation FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY ops_irradiation_update ON solar.ops_irradiation FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY ops_irradiation_delete ON solar.ops_irradiation FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY ops_irradiation_insert_authz ON solar.ops_irradiation AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY ops_irradiation_update_authz ON solar.ops_irradiation AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY ops_irradiation_delete_authz ON solar.ops_irradiation AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 6. Downtime + append-only history ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.downtime (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id          UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id               UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id          UUID NOT NULL REFERENCES public.organisations(id),
    starts_at                TIMESTAMPTZ NOT NULL,
    ends_at                  TIMESTAMPTZ NOT NULL,
    cause                    TEXT NOT NULL CHECK (cause IN ('grid_outage', 'inverter_fault', 'planned_maintenance',
                               'unplanned_maintenance', 'curtailment', 'communications', 'weather_damage', 'other')),
    description              TEXT CHECK (description IS NULL OR length(description) <= 2000),
    excluded_from_guarantee  BOOLEAN NOT NULL DEFAULT FALSE,
    source                   TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'detected')),
    created_by               UUID REFERENCES auth.users(id),
    updated_by               UUID REFERENCES auth.users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT downtime_window CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '31 days')
);
CREATE INDEX IF NOT EXISTS downtime_installation_idx ON solar.downtime (installation_id, starts_at);

CREATE OR REPLACE FUNCTION solar.downtime_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_comm DATE;
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.installation_id, NEW.source, NEW.created_by, NEW.created_at)
           IS DISTINCT FROM (OLD.id, OLD.installation_id, OLD.source, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'solar.downtime: identity, source and author are immutable' USING ERRCODE = '42501';
        END IF;
    ELSE
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.created_at := NOW();
    END IF;
    -- Serialise writers per installation so two overlapping inserts cannot both pass the check.
    SELECT i.project_id, i.organisation_id, i.commissioning_date INTO NEW.project_id, NEW.organisation_id, v_comm
      FROM solar.installations i WHERE i.id = NEW.installation_id FOR UPDATE;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.downtime: installation % not found', NEW.installation_id USING ERRCODE = '23503';
    END IF;
    IF v_comm IS NOT NULL AND NEW.starts_at < (v_comm::timestamp AT TIME ZONE 'Africa/Johannesburg') THEN
        RAISE EXCEPTION 'solar.downtime: downtime cannot start before the commissioning date' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM solar.downtime d
                WHERE d.installation_id = NEW.installation_id AND d.id <> NEW.id
                  AND tstzrange(d.starts_at, d.ends_at) && tstzrange(NEW.starts_at, NEW.ends_at)) THEN
        RAISE EXCEPTION 'solar.downtime: this window overlaps recorded downtime' USING ERRCODE = '23P01';
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.downtime_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.downtime_bind() FROM anon;
CREATE TRIGGER downtime_bind BEFORE INSERT OR UPDATE ON solar.downtime
    FOR EACH ROW EXECUTE FUNCTION solar.downtime_bind();

CREATE TABLE IF NOT EXISTS solar.downtime_history (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    downtime_id      UUID NOT NULL,
    installation_id  UUID NOT NULL,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    op               TEXT NOT NULL CHECK (op IN ('update', 'delete')),
    old_row          JSONB NOT NULL,
    actor_id         UUID REFERENCES auth.users(id),
    at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS downtime_history_downtime_idx ON solar.downtime_history (downtime_id, at);

CREATE OR REPLACE FUNCTION solar.downtime_history_record()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- A cascade (installation, study or project delete) removes the whole record set; no history.
    -- NOT a pg_trigger_depth() test: an FK cascade queues the cascaded rows' AFTER triggers to the
    -- end of the OUTER statement, so this fires at depth 1 with the parent rows already gone (and a
    -- history row would then violate its project FK). The installation being gone IS the cascade.
    IF NOT EXISTS (SELECT 1 FROM solar.installations i WHERE i.id = OLD.installation_id) THEN
        RETURN NULL;
    END IF;
    INSERT INTO solar.downtime_history (downtime_id, installation_id, project_id, organisation_id, op, old_row, actor_id)
    VALUES (OLD.id, OLD.installation_id, OLD.project_id, OLD.organisation_id, lower(TG_OP), to_jsonb(OLD), auth.uid());
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.downtime_history_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.downtime_history_record() FROM anon;
CREATE TRIGGER downtime_history_record AFTER UPDATE OR DELETE ON solar.downtime
    FOR EACH ROW EXECUTE FUNCTION solar.downtime_history_record();

ALTER TABLE solar.downtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.downtime FORCE ROW LEVEL SECURITY;
CREATE POLICY downtime_select ON solar.downtime FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY downtime_insert ON solar.downtime FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY downtime_update ON solar.downtime FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY downtime_delete ON solar.downtime FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY downtime_insert_authz ON solar.downtime AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY downtime_update_authz ON solar.downtime AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY downtime_delete_authz ON solar.downtime AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

ALTER TABLE solar.downtime_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.downtime_history FORCE ROW LEVEL SECURITY;
CREATE POLICY downtime_history_select ON solar.downtime_history FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
-- No INSERT/UPDATE/DELETE policy and no grant: written only by solar.downtime_history_record().

-- ── 7. Monthly report commentary (money) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.monthly_report_notes (
    installation_id  UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    period_month     DATE NOT NULL CONSTRAINT monthly_report_notes_first_of_month CHECK (extract(day FROM period_month) = 1),
    section          TEXT NOT NULL CHECK (section IN ('summary', 'performance', 'downtime', 'financial', 'actions')),
    body             TEXT NOT NULL CHECK (length(body) <= 5000),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (installation_id, period_month, section)
);
CREATE TRIGGER monthly_report_notes_bind BEFORE INSERT OR UPDATE ON solar.monthly_report_notes
    FOR EACH ROW EXECUTE FUNCTION solar.ops_bind_from_installation();

ALTER TABLE solar.monthly_report_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.monthly_report_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY monthly_report_notes_select ON solar.monthly_report_notes FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
CREATE POLICY monthly_report_notes_insert ON solar.monthly_report_notes FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY monthly_report_notes_update ON solar.monthly_report_notes FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY monthly_report_notes_delete ON solar.monthly_report_notes FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY monthly_report_notes_insert_authz ON solar.monthly_report_notes AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY monthly_report_notes_update_authz ON solar.monthly_report_notes AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY monthly_report_notes_delete_authz ON solar.monthly_report_notes AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_see_money(project_id));

-- ── 8. Monthly report snapshots (money, service-written, immutable) ────────
CREATE TABLE IF NOT EXISTS solar.monthly_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id  UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    period_month     DATE NOT NULL CONSTRAINT monthly_reports_first_of_month CHECK (extract(day FROM period_month) = 1),
    version          INTEGER NOT NULL CHECK (version >= 1),
    report_id        UUID REFERENCES projects.reports(id) ON DELETE SET NULL,
    snapshot         JSONB NOT NULL CONSTRAINT monthly_reports_snapshot_is_object CHECK (jsonb_typeof(snapshot) = 'object'),
    snapshot_sha256  TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    pdf_sha256       TEXT NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
    generated_by     UUID REFERENCES auth.users(id),
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT monthly_reports_version_uniq UNIQUE (installation_id, period_month, version)
);

CREATE OR REPLACE FUNCTION solar.monthly_reports_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_max INTEGER;
BEGIN
    -- Depth > 1: an FK action (report row deleted, installation/study/project cascade).
    IF pg_trigger_depth() > 1 THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'solar.monthly_reports: a generated monthly report is kept as evidence' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'solar.monthly_reports: a monthly report version is immutable; generate a new version' USING ERRCODE = '42501';
    END IF;
    SELECT i.project_id, i.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.installations i WHERE i.id = NEW.installation_id FOR UPDATE;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.monthly_reports: installation % not found', NEW.installation_id USING ERRCODE = '23503';
    END IF;
    IF NEW.snapshot ->> 'period' IS DISTINCT FROM to_char(NEW.period_month, 'YYYY-MM') THEN
        RAISE EXCEPTION 'solar.monthly_reports: the snapshot is for another period' USING ERRCODE = '23514';
    END IF;
    SELECT max(r.version) INTO v_max FROM solar.monthly_reports r
     WHERE r.installation_id = NEW.installation_id AND r.period_month = NEW.period_month;
    IF NEW.version <> COALESCE(v_max, 0) + 1 THEN
        RAISE EXCEPTION 'solar.monthly_reports: version % is not the next version of this month', NEW.version USING ERRCODE = '23505';
    END IF;
    NEW.generated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.monthly_reports_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.monthly_reports_guard() FROM anon;
CREATE TRIGGER monthly_reports_guard BEFORE INSERT OR UPDATE OR DELETE ON solar.monthly_reports
    FOR EACH ROW EXECUTE FUNCTION solar.monthly_reports_guard();

ALTER TABLE solar.monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.monthly_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY monthly_reports_select ON solar.monthly_reports FOR SELECT TO authenticated
    USING (public.solar_can_see_money(project_id));
-- No INSERT/UPDATE/DELETE policy: the generate action writes with the service role after its gate.

-- ── 9. Handover template (org) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.handover_templates (
    organisation_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL DEFAULT 'Solar PV Handover' CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    items            JSONB NOT NULL CONSTRAINT handover_templates_items_shape
                       CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 60),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION solar.handover_templates_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.handover_templates: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    ELSE
        NEW.created_at := NOW();
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.handover_templates_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.handover_templates_bind() FROM anon;
CREATE TRIGGER handover_templates_bind BEFORE INSERT OR UPDATE ON solar.handover_templates
    FOR EACH ROW EXECUTE FUNCTION solar.handover_templates_bind();

ALTER TABLE solar.handover_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.handover_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY handover_templates_select ON solar.handover_templates FOR SELECT TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY handover_templates_insert ON solar.handover_templates FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY handover_templates_update ON solar.handover_templates FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('view'))::uuid[]));
CREATE POLICY handover_templates_insert_authz ON solar.handover_templates AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]));
CREATE POLICY handover_templates_update_authz ON solar.handover_templates AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]))
    WITH CHECK (organisation_id = ANY ((SELECT solar.library_orgs('admin'))::uuid[]));

-- ── 10. Handover items (per installation) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.handover_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id  UUID NOT NULL REFERENCES solar.installations(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    item_key         TEXT NOT NULL CHECK (item_key ~ '^[a-z0-9_]{1,60}$'),
    label            TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
    required         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    document_id      UUID REFERENCES tenants.documents(id) ON DELETE SET NULL,
    not_applicable   BOOLEAN NOT NULL DEFAULT FALSE,
    note             TEXT CHECK (note IS NULL OR length(note) <= 1000),
    completed_by     UUID REFERENCES auth.users(id),
    completed_at     TIMESTAMPTZ,
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT handover_items_key_uniq UNIQUE (installation_id, item_key),
    CONSTRAINT handover_items_na_or_doc CHECK (NOT (not_applicable AND document_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS handover_items_document_idx ON solar.handover_items (document_id) WHERE document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION solar.handover_items_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_was_done BOOLEAN := FALSE;
    v_is_done  BOOLEAN;
BEGIN
    v_is_done := (NEW.document_id IS NOT NULL OR NEW.not_applicable);
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.installation_id, NEW.item_key) IS DISTINCT FROM (OLD.id, OLD.installation_id, OLD.item_key) THEN
            RAISE EXCEPTION 'solar.handover_items: identity is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
        v_was_done := (OLD.document_id IS NOT NULL OR OLD.not_applicable);
    ELSE
        NEW.created_at := NOW();
    END IF;
    SELECT i.project_id, i.organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.installations i WHERE i.id = NEW.installation_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.handover_items: installation % not found', NEW.installation_id USING ERRCODE = '23503';
    END IF;
    IF NEW.document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM tenants.documents d WHERE d.id = NEW.document_id AND d.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'solar.handover_items: the document belongs to another project' USING ERRCODE = '23514';
    END IF;
    IF v_is_done AND (NOT v_was_done OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
        NEW.completed_at := NOW();
        NEW.completed_by := COALESCE(auth.uid(), NEW.completed_by);
    ELSIF v_is_done THEN
        NEW.completed_at := OLD.completed_at;
        NEW.completed_by := OLD.completed_by;
    ELSE
        NEW.completed_at := NULL;
        NEW.completed_by := NULL;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.handover_items_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.handover_items_bind() FROM anon;
CREATE TRIGGER handover_items_bind BEFORE INSERT OR UPDATE ON solar.handover_items
    FOR EACH ROW EXECUTE FUNCTION solar.handover_items_bind();

ALTER TABLE solar.handover_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.handover_items FORCE ROW LEVEL SECURITY;
CREATE POLICY handover_items_select ON solar.handover_items FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY handover_items_insert ON solar.handover_items FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY handover_items_update ON solar.handover_items FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY handover_items_delete ON solar.handover_items FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY handover_items_insert_authz ON solar.handover_items AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY handover_items_update_authz ON solar.handover_items AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY handover_items_delete_authz ON solar.handover_items AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 11. Generation / consumption aggregation (SECURITY INVOKER: RLS decides) ─
-- A reading is kept only when no NEWER channel (created_at, id) of the same meter has a reading
-- overlapping its span [ts_end - interval, ts_end), and then one per (meter, ts_end): a second file
-- covering the same dates REPLACES rather than adds, at the same or a different interval (review
-- B1). Month = SAST month of the interval START.
-- One jsonb document per call, so no PostgREST row cap can truncate a month.
CREATE OR REPLACE FUNCTION public.solar_ops_monthly_kwh(p_installation_id UUID, p_role TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH ch AS (
        SELECT c.id, c.meter_id, c.interval_min, c.created_at
          FROM solar.installation_meters im
          JOIN solar.meters m ON m.id = im.meter_id
          JOIN solar.meter_channels c ON c.meter_id = im.meter_id
         WHERE im.installation_id = p_installation_id AND im.role = p_role
           AND ((p_role = 'generation' AND m.kind = 'solar') OR (p_role = 'consumption' AND m.kind IN ('council', 'bulk')))
           AND c.is_primary AND c.unit = 'kW' AND c.quantity IN ('active_power', 'active_energy')
    ), one AS (
        SELECT DISTINCT ON (ch.meter_id, r.ts_end)
               ch.meter_id, r.ts_end, r.value, ch.interval_min
          FROM ch JOIN solar.meter_readings r ON r.channel_id = ch.id
         WHERE r.value IS NOT NULL
           -- A reading survives only if no NEWER channel of the same meter has a reading whose span
           -- [ts_end - interval, ts_end) overlaps its own: a re-import at another interval replaces.
           AND NOT EXISTS (
               SELECT 1 FROM ch n JOIN solar.meter_readings nr ON nr.channel_id = n.id
                WHERE n.meter_id = ch.meter_id AND (n.created_at, n.id) > (ch.created_at, ch.id)
                  AND nr.value IS NOT NULL
                  AND nr.ts_end > r.ts_end - make_interval(mins => ch.interval_min)
                  AND nr.ts_end < r.ts_end + make_interval(mins => n.interval_min))
         ORDER BY ch.meter_id, r.ts_end, ch.created_at DESC, ch.id DESC
    ), bucketed AS (
        SELECT meter_id,
               to_char((ts_end - make_interval(mins => interval_min)) AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM') AS month,
               sum(value * interval_min / 60.0) AS kwh,
               count(*) AS n,
               -- Minutes the kept readings SPAN. A month re-imported at a second interval holds
               -- readings of both, so count x one interval misstates coverage (review round 2).
               sum(interval_min) AS minutes,
               min(interval_min) AS interval_min
          FROM one
         GROUP BY 1, 2
    ), per_meter AS (
        SELECT meter_id,
               jsonb_object_agg(month, jsonb_build_object('kwh', round(kwh::numeric, 3), 'n', n, 'minutes', minutes, 'intervalMin', interval_min)) AS months
          FROM bucketed
         GROUP BY meter_id
    )
    SELECT COALESCE(jsonb_object_agg(meter_id::text, months), '{}'::jsonb) FROM per_meter;
$$;
REVOKE ALL ON FUNCTION public.solar_ops_monthly_kwh(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_ops_monthly_kwh(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_ops_monthly_kwh(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.solar_ops_series(p_installation_id UUID, p_role TEXT, p_month DATE)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH bounds AS (
        SELECT date_trunc('month', p_month::timestamp) AT TIME ZONE 'Africa/Johannesburg' AS t0,
               (date_trunc('month', p_month::timestamp) + interval '1 month') AT TIME ZONE 'Africa/Johannesburg' AS t1
    ), ch AS (
        SELECT c.id, c.meter_id, c.interval_min, c.created_at
          FROM solar.installation_meters im
          JOIN solar.meters m ON m.id = im.meter_id
          JOIN solar.meter_channels c ON c.meter_id = im.meter_id
         WHERE im.installation_id = p_installation_id AND im.role = p_role
           AND ((p_role = 'generation' AND m.kind = 'solar') OR (p_role = 'consumption' AND m.kind IN ('council', 'bulk')))
           AND c.is_primary AND c.unit = 'kW' AND c.quantity IN ('active_power', 'active_energy')
    ), one AS (
        SELECT DISTINCT ON (ch.meter_id, r.ts_end)
               ch.meter_id, r.ts_end, r.value, ch.interval_min
          FROM ch
          JOIN solar.meter_readings r ON r.channel_id = ch.id
          CROSS JOIN bounds b
         WHERE r.value IS NOT NULL
           AND r.ts_end > b.t0 AND r.ts_end <= b.t1 + interval '1 day'
           AND r.ts_end - make_interval(mins => ch.interval_min) >= b.t0
           AND r.ts_end - make_interval(mins => ch.interval_min) < b.t1
           AND NOT EXISTS (
               SELECT 1 FROM ch n JOIN solar.meter_readings nr ON nr.channel_id = n.id
                WHERE n.meter_id = ch.meter_id AND (n.created_at, n.id) > (ch.created_at, ch.id)
                  AND nr.value IS NOT NULL
                  AND nr.ts_end > r.ts_end - make_interval(mins => ch.interval_min)
                  AND nr.ts_end < r.ts_end + make_interval(mins => n.interval_min))
         ORDER BY ch.meter_id, r.ts_end, ch.created_at DESC, ch.id DESC
    ), summed AS (
        -- One point per SPAN (end, interval): meters on the same interval are summed; meters on
        -- different intervals stay separate points with their own span, so a point never mixes
        -- spans. TS consumers weigh points by overlap (lost-energy.ts) or resample them onto one
        -- grid (plantSeries) before treating the series as the plant's output.
        SELECT ts_end, interval_min, sum(value) AS kw FROM one GROUP BY ts_end, interval_min
    )
    SELECT jsonb_build_object('points', COALESCE(jsonb_agg(jsonb_build_array(
               (extract(epoch FROM ts_end) * 1000)::bigint, round(kw::numeric, 4), interval_min) ORDER BY ts_end), '[]'::jsonb))
      FROM summed;
$$;
REVOKE ALL ON FUNCTION public.solar_ops_series(UUID, TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_ops_series(UUID, TEXT, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_ops_series(UUID, TEXT, DATE) TO authenticated, service_role;

-- ── 12. Saved Solar reports read on the Solar level ─────────────────────────
-- Redefines 00216's functions IN FULL with EVERY Solar kind, so the final definition is right
-- whichever Solar branch lands last.
CREATE OR REPLACE FUNCTION public.report_kind_is_sensitive(_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT _kind IN ('equipment_materials', 'valuation', 'solar_feasibility', 'solar_proposal', 'solar_monthly')
$function$;

CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_technical' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_feasibility' THEN COALESCE(public.solar_can_see_money(_project_id), FALSE)
    WHEN _kind = 'solar_proposal' THEN COALESCE(public.solar_can_see_money(_project_id), FALSE)
    WHEN _kind = 'solar_monthly' THEN COALESCE(public.solar_can_see_money(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.report_kind_is_sensitive(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_kind_is_sensitive(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

-- A solar_monthly row is evidence of what the client received (decision 13): no session deletes
-- it, mirroring 00216's reports_solar_proposal_delete_authz. RESTRICTIVE FOR DELETE only, so it
-- narrows nothing but DELETE (the 00205 lesson).
CREATE POLICY reports_solar_monthly_delete_authz ON projects.reports AS RESTRICTIVE FOR DELETE TO authenticated
    USING (kind IS DISTINCT FROM 'solar_monthly');

-- ── 13. Product events (re-declared in full: 00216's list + Phase 7) ───────
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved',
    'solar_case_created',
    'solar_case_run',
    'solar_weather_fetched',
    'solar_financials_run',
    'solar_equipment_saved',
    'solar_report_generated',
    'solar_proposal_created',
    'solar_proposal_issued',
    'solar_proposal_withdrawn',
    'solar_proposal_responded',
    'solar_narrative_drafted',
    -- 00217: operations
    'solar_installation_saved',
    'solar_guarantee_saved',
    'solar_downtime_saved',
    'solar_monthly_report_generated',
    'solar_handover_updated'
));

-- ── 14. Table privileges ────────────────────────────────────────────────────
REVOKE ALL ON solar.installations, solar.installation_meters, solar.guarantees, solar.ops_irradiation,
    solar.downtime, solar.downtime_history, solar.monthly_report_notes, solar.monthly_reports,
    solar.handover_templates, solar.handover_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.installations, solar.installation_meters, solar.guarantees,
    solar.ops_irradiation, solar.downtime, solar.monthly_report_notes, solar.handover_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.handover_templates TO authenticated;
GRANT SELECT ON solar.downtime_history, solar.monthly_reports TO authenticated;
GRANT ALL ON solar.installations, solar.installation_meters, solar.guarantees, solar.ops_irradiation,
    solar.downtime, solar.monthly_report_notes, solar.handover_templates, solar.handover_items TO service_role;
REVOKE ALL ON solar.downtime_history, solar.monthly_reports FROM service_role;
GRANT SELECT ON solar.downtime_history TO service_role;
GRANT SELECT, INSERT ON solar.monthly_reports TO service_role;

NOTIFY pgrst, 'reload schema';
