# Solar Phase 7 — Part 1: Schema (`00218_solar_operations.sql`) and behavioural assertions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-29-solar-phase-7-0-index.md` first (decisions, conventions, `$W`, `$S`).

---

### Task 1: Write migration `00218_solar_operations.sql`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00218_solar_operations.sql`

- [ ] **Step 1: Re-check the number immediately before writing.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 && git fetch origin && \
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -F '00218_' | sed "s|^|$r: |"; done
```
Expected: no output. Any output → STOP and ask for a number.

- [ ] **Step 2: Capture the product-events list you are about to re-declare.** The list in Step 3 is `00217`'s (28 values) plus five. If Task 0 Step 4(a) named a LATER migration, add every value it has that Step 3's list lacks (never drop one).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
M=apps/edge-functions/supabase/migrations; S=/private/tmp/claude-501/solar-7; mkdir -p $S
awk '/product_events_event_check CHECK/,/\)\);/' $M/00217_solar_proposals.sql | grep -o "'[a-z_]*'" | tr -d "'" | sort > $S/events-base.txt
wc -l < $S/events-base.txt
```
Expected: `28`.

- [ ] **Step 3: Write the migration.** No `BEGIN`/`COMMIT`. No em dash anywhere inside a `-- sql:` payload.

```sql
-- ---------------------------------------------------------------------------
-- Migration 00218: Solar operations (Phase 7)
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
--     returning ONE jsonb document. One reading per (meter, ts_end): the most recently created
--     channel wins, so a re-import of overlapping data never doubles. Month = SAST month of the
--     interval START (ts_end minus interval_min).
--   * public.user_can_read_report_kind(): every Solar kind, solar_monthly on Edit + financials.
--   * product_events: five Phase 7 events.
-- RULES
--   * 00208's schema-wide directives hold: FORCE RLS on every solar table, no RESTRICTIVE read
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
BEGIN
    -- Depth > 1 is an FK action (proposal SET NULL, study cascade); it passes untouched.
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.installations: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        IF NEW.proposal_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM solar.proposals p
             WHERE p.id = NEW.proposal_id AND p.study_id = NEW.study_id AND p.status = 'accepted') THEN
            RAISE EXCEPTION 'solar.installations: an installation starts from an accepted proposal of this study' USING ERRCODE = '23514';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.created_at := NOW();
    ELSE
        IF (NEW.id, NEW.study_id, NEW.project_id, NEW.organisation_id, NEW.proposal_id, NEW.baseline, NEW.created_by, NEW.created_at)
           IS DISTINCT FROM
           (OLD.id, OLD.study_id, OLD.project_id, OLD.organisation_id, OLD.proposal_id, OLD.baseline, OLD.created_by, OLD.created_at) THEN
            RAISE EXCEPTION 'solar.installations: the installation identity and its modelled baseline are immutable' USING ERRCODE = '42501';
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
CREATE POLICY installations_insert_authz ON solar.installations AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
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
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
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
-- One reading per (meter, ts_end): the most recently created channel wins, so a second file
-- covering the same dates REPLACES rather than adds. Month = SAST month of the interval START.
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
         ORDER BY ch.meter_id, r.ts_end, ch.created_at DESC, ch.id DESC
    ), bucketed AS (
        SELECT meter_id,
               to_char((ts_end - make_interval(mins => interval_min)) AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM') AS month,
               sum(value * interval_min / 60.0) AS kwh,
               count(*) AS n,
               min(interval_min) AS interval_min
          FROM one
         GROUP BY 1, 2
    ), per_meter AS (
        SELECT meter_id,
               jsonb_object_agg(month, jsonb_build_object('kwh', round(kwh::numeric, 3), 'n', n, 'intervalMin', interval_min)) AS months
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
         ORDER BY ch.meter_id, r.ts_end, ch.created_at DESC, ch.id DESC
    ), summed AS (
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
-- Redefines 00217's functions IN FULL with EVERY Solar kind, so the final definition is right
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

-- ── 13. Product events (re-declared in full: 00217's list + Phase 7) ───────
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
    -- 00218: operations
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
```

- [ ] **Step 4: Static sanity checks.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
M=apps/edge-functions/supabase/migrations/00218_solar_operations.sql
grep -nE '^\s*(BEGIN|COMMIT)\s*;' $M ; echo "begin/commit lines: $?"
grep -n '^-- sql:' $M | grep -n '—' ; echo "em dash in sql payload: $?"
grep -c 'SECURITY DEFINER' $M
grep -c 'FROM anon;' $M
grep -n 'FOR ALL' $M ; echo "for-all policies: $?"
comm -13 <(sort /private/tmp/claude-501/solar-7/events-base.txt) <(awk '/product_events_event_check CHECK/,/\)\);/' $M | grep -o "'[a-z_]*'" | tr -d "'" | sort)
comm -23 <(sort /private/tmp/claude-501/solar-7/events-base.txt) <(awk '/product_events_event_check CHECK/,/\)\);/' $M | grep -o "'[a-z_]*'" | tr -d "'" | sort)
```
Expected: `begin/commit lines: 1`; `em dash in sql payload: 1`; `10` SECURITY DEFINER lines (eight trigger functions, `user_can_read_report_kind`, and the header RULES line); at least `10` `FROM anon;`; `for-all policies: 1`; the first `comm` prints exactly the five new events; the second `comm` prints nothing (no base event dropped).

- [ ] **Step 5: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git add apps/edge-functions/supabase/migrations/00218_solar_operations.sql
git commit -m "feat(solar): 00218 operations: installations, guarantees, downtime, monthly reports, handover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Behavioural assertions (write, then prove RED)

**Files:**
- Create: `scripts/db/assert-solar-operations-roles.sql`

- [ ] **Step 1: Write the assertion file.** Same refusal pattern as 00217's file: a `…_REFUSED` check records `true` only on the promised SQLSTATE; a wrongly-allowed statement raises `P0001` so its write rolls back. All seeding as postgres before the first impersonation; `request.jwt.claims` is cleared before every later postgres step (it outlives `RESET ROLE`).

```sql
-- BEHAVIOURAL assertions for 00218_solar_operations (Solar Phase 7), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00208..00217 chain> scripts/db/assert-solar-operations-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00208..00217 chain + 00218> scripts/db/assert-solar-operations-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it
-- bypasses the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_p        UUID := gen_random_uuid();
  v_p2       UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- admin of v_org
  v_edit     UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money    UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_view     UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant  UUID := gen_random_uuid();   -- contractor member, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer on v_p (FORGED edit_financials grant)
  v_foreign  UUID := gen_random_uuid();   -- admin of v_org2
  v_study    UUID;
  v_study2   UUID;
  v_w        UUID;
  v_case     UUID;
  v_run      UUID;
  v_prop_acc UUID := gen_random_uuid();
  v_prop_dr  UUID := gen_random_uuid();
  v_inst     UUID;
  v_msolar   UUID;
  v_mbig     UUID;
  v_mcouncil UUID;
  v_mtenant  UUID;
  v_mforeign UUID;
  v_f1       UUID;
  v_f2       UUID;
  v_f3       UUID;
  v_c1       UUID;
  v_c2       UUID;
  v_c4       UUID;
  v_d1       UUID;
  v_doc1     UUID := gen_random_uuid();
  v_doc2     UUID := gen_random_uuid();
  v_item     UUID;
  v_rep1     UUID;
  v_rep2     UUID;
  v_m1       UUID;
  v_m2       UUID;
  v_j        JSONB;
  v_n        INT;
  u          UUID;
  v_hash     CONSTANT TEXT := repeat('c', 64);
  v_sha1     CONSTANT TEXT := repeat('1', 64);
  v_sha2     CONSTANT TEXT := repeat('2', 64);
  v_sha3     CONSTANT TEXT := repeat('3', 64);
  v_baseline CONSTANT JSONB := '{"version":1,"caseRunId":"r","inputsHash":"h","dcKwp":100,"acKw":80,"performanceRatio":0.8,"monthlyKwh":[15000,14000,14500,13000,12000,11000,11500,13000,14000,15000,15500,16000],"diurnalKw":[[0],[0],[0],[0],[0],[0],[0],[0],[0],[0],[0],[0]],"ghiKwhM2":null}';
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-7-probe'), (v_org2, 'solar-7-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-7-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-7-probe-p', v_admin), (v_p2, v_org2, 'solar-7-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE),
    (v_p, v_view, v_org, 'contractor', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit_financials');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id, latitude, longitude) VALUES (v_p, -25.75, 28.19) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -25.75, 28.19, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Base', '{"version":1}') RETURNING id INTO v_case;
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run;
  UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{"dcKwp":100}}', hourly_path = 'h.csv.gz' WHERE id = v_run;
  -- Proposals straight to their end states (the 00217 guard is exercised by its own file).
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.proposals (id, study_id, project_id, organisation_id, family_id, version, case_id, case_run_id, status,
                               snapshot, pdf_path, pdf_sha256, share_token_hash, expires_at, issued_at, responded_at)
  VALUES (v_prop_acc, v_study, v_p, v_org, v_prop_acc, 1, v_case, v_run, 'accepted',
          '{"version":1}', 'o/p/a.pdf', v_hash, v_hash, now() + interval '30 days', now(), now());
  INSERT INTO solar.proposals (id, study_id, project_id, organisation_id, family_id, version, case_id, status)
  VALUES (v_prop_dr, v_study, v_p, v_org, v_prop_dr, 1, v_case, 'draft');
  SET LOCAL session_replication_role = origin;
  -- Meter library
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV main', 'solar') RETURNING id INTO v_msolar;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV roof B', 'solar') RETURNING id INTO v_mbig;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Council', 'council') RETURNING id INTO v_mcouncil;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 1', 'tenant') RETURNING id INTO v_mtenant;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org2, 'Other PV', 'solar') RETURNING id INTO v_mforeign;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha1, 10, v_org || '/' || v_p || '/' || v_sha1 || '.csv', 'march-a.csv', 'accepted') RETURNING id INTO v_f1;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha2, 10, v_org || '/' || v_p || '/' || v_sha2 || '.csv', 'march-b.csv', 'accepted') RETURNING id INTO v_f2;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha3, 10, v_org || '/' || v_p || '/' || v_sha3 || '.csv', 'may.csv', 'accepted') RETURNING id INTO v_f3;
  -- c1 (older file) and c2 (newer file) both feed PV main with the SAME timestamp.
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_msolar, v_f1, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe', now() - interval '1 day')
  RETURNING id INTO v_c1;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_msolar, v_f2, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe', now())
  RETURNING id INTO v_c2;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_mbig, v_f3, 'kW', 'active_power', 'export', 'kW', 'kW', 15, 'end', TRUE, 'probe')
  RETURNING id INTO v_c4;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_mcouncil, v_f1, 'import kW', 'active_power', 'import', 'kW', 'kW', 30, 'end', TRUE, 'probe');
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES
    (v_c1, v_org, '2026-03-10 12:00+02', 5, 0),
    (v_c2, v_org, '2026-03-10 12:00+02', 7, 0),
    -- ends at midnight on 1 January: the interval STARTED on 31 December.
    (v_c2, v_org, '2026-01-01 00:00+02', 4, 0);
  -- 31 days x 96 fifteen-minute intervals of May 2026 (more than PostgREST's 1,000-row cap).
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c4, v_org, t, 1, 0
    FROM generate_series(timestamptz '2026-05-01 00:15+02', timestamptz '2026-06-01 00:00+02', interval '15 minutes') AS t;
  INSERT INTO tenants.documents (id, organisation_id, project_id, name, storage_path) VALUES
    (v_doc1, v_org, v_p, 'CoC.pdf', v_org || '/' || v_p || '/coc.pdf'),
    (v_doc2, v_org2, v_p2, 'Other.pdf', v_org2 || '/' || v_p2 || '/other.pdf');

  -- ── 1. Installation ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built) VALUES (v_study, v_prop_acc, v_baseline, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_creates_installation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_creates_installation_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built) VALUES (v_study, v_prop_dr, v_baseline, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('installation_from_draft_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('installation_from_draft_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installations (study_id, project_id, organisation_id, proposal_id, baseline, as_built)
    VALUES (v_study, v_p2, v_org2, v_prop_acc, v_baseline, '{"dcKwp":100}') RETURNING id INTO v_inst;
    INSERT INTO _r VALUES ('installation_bound_to_study', (SELECT project_id = v_p AND organisation_id = v_org AND created_by = v_edit
      FROM solar.installations WHERE id = v_inst));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('installation_bound_to_study', false);
  END;
  UPDATE solar.installations SET commissioning_date = '2026-02-15', as_built = '{"dcKwp":101}' WHERE id = v_inst;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_updates_as_built', v_n = 1);
  BEGIN
    UPDATE solar.installations SET baseline = v_baseline || '{"dcKwp":999}' WHERE id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('baseline_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('baseline_immutable_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_installation', (SELECT count(*) FROM solar.installations WHERE id = v_inst) = 1);
  UPDATE solar.installations SET notes = 'forged' WHERE id = v_inst;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_update_noop', v_n = 0);
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('reads_no_installation_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 2. Meter roles ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mcouncil, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('council_as_generation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('council_as_generation_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mtenant, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tenant_as_generation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tenant_as_generation_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mforeign, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES
      (v_inst, v_msolar, 'generation'), (v_inst, v_mbig, 'generation'), (v_inst, v_mcouncil, 'consumption');
    INSERT INTO _r VALUES ('editor_links_meters', (SELECT count(*) FROM solar.installation_meters WHERE installation_id = v_inst) = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_links_meters', false);
  END;
  BEGIN
    -- A meter is linked once per installation (PK), so it can never be counted in two roles.
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mcouncil, 'consumption');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('meter_linked_twice_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('meter_linked_twice_REFUSED', false);
  END;

  -- ── 3. Generation aggregation ─────────────────────────────────────────────
  v_j := public.solar_ops_monthly_kwh(v_inst, 'generation');
  -- 7 kW x 0.5 h from the NEWER file only; 5 + 7 would be 6.0 kWh.
  INSERT INTO _r VALUES ('reimport_does_not_double', (v_j -> v_msolar::text -> '2026-03' ->> 'kwh')::numeric = 3.5
    AND (v_j -> v_msolar::text -> '2026-03' ->> 'n')::int = 1);
  INSERT INTO _r VALUES ('month_from_interval_start', (v_j -> v_msolar::text -> '2025-12' ->> 'kwh')::numeric = 2.0
    AND v_j -> v_msolar::text -> '2026-01' IS NULL);
  INSERT INTO _r VALUES ('council_never_in_generation', v_j -> v_mcouncil::text IS NULL);
  v_j := public.solar_ops_series(v_inst, 'generation', DATE '2026-05-01');
  INSERT INTO _r VALUES ('series_not_capped_at_1000', jsonb_array_length(v_j -> 'points') = 2976);
  v_j := public.solar_ops_series(v_inst, 'generation', DATE '2026-03-01');
  INSERT INTO _r VALUES ('series_one_value_per_interval', jsonb_array_length(v_j -> 'points') = 1
    AND (v_j -> 'points' -> 0 ->> 1)::numeric = 7);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_generation', public.solar_ops_monthly_kwh(v_inst, 'generation') -> v_msolar::text IS NOT NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_generation', public.solar_ops_monthly_kwh(v_inst, 'generation') = '{}'::jsonb
    AND jsonb_array_length(public.solar_ops_series(v_inst, 'generation', DATE '2026-05-01') -> 'points') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 4. Guarantee and irradiation ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.guarantees (installation_id, basis, degradation_pct_per_year) VALUES (v_inst, 'p50', 0.5);
    INSERT INTO _r VALUES ('editor_saves_guarantee', (SELECT project_id = v_p FROM solar.guarantees WHERE installation_id = v_inst));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_guarantee', false);
  END;
  BEGIN
    UPDATE solar.guarantees SET basis = 'pct_of_modelled' WHERE installation_id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pct_basis_needs_pct_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pct_basis_needs_pct_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.guarantees SET basis = 'manual', manual_monthly_kwh = ARRAY[1,2,3,4,5,6,7,8,9,10,11]::numeric[] WHERE installation_id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('manual_needs_twelve_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('manual_needs_twelve_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.ops_irradiation (installation_id, month, plane, kwh_per_m2, source_note) VALUES (v_inst, '2026-03-15', 'poa', 180, 'Station X');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('irradiation_mid_month_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('irradiation_mid_month_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.ops_irradiation (installation_id, month, plane, kwh_per_m2, source_note) VALUES (v_inst, '2026-03-01', 'poa', 180, 'Station X');
    INSERT INTO _r VALUES ('editor_saves_irradiation', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_irradiation', false);
  END;

  -- ── 5. Downtime ───────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-10 10:00+02', '2026-03-10 12:00+02', 'inverter_fault')
    RETURNING id INTO v_d1;
    INSERT INTO _r VALUES ('editor_adds_downtime', (SELECT created_by = v_edit AND source = 'manual' FROM solar.downtime WHERE id = v_d1));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_adds_downtime', false);
  END;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-10 11:00+02', '2026-03-10 13:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN exclusion_violation THEN INSERT INTO _r VALUES ('downtime_overlap_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('downtime_overlap_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-02-01 10:00+02', '2026-02-01 11:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('downtime_before_commissioning_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('downtime_before_commissioning_REFUSED', false);
  END;
  UPDATE solar.downtime SET excluded_from_guarantee = TRUE WHERE id = v_d1;
  INSERT INTO _r VALUES ('downtime_edit_recorded', (SELECT count(*) FROM solar.downtime_history
    WHERE downtime_id = v_d1 AND op = 'update' AND actor_id = v_edit AND (old_row ->> 'excluded_from_guarantee')::boolean = FALSE) = 1);
  DELETE FROM solar.downtime WHERE id = v_d1;
  INSERT INTO _r VALUES ('downtime_delete_recorded', (SELECT count(*) FROM solar.downtime_history WHERE downtime_id = v_d1 AND op = 'delete') = 1);
  BEGIN
    INSERT INTO solar.downtime_history (downtime_id, installation_id, project_id, organisation_id, op, old_row) VALUES (v_d1, v_inst, v_p, v_org, 'update', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('history_forge_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('history_forge_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-11 10:00+02', '2026-03-11 12:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_adds_downtime_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_adds_downtime_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('view_user_reads_history', (SELECT count(*) FROM solar.downtime_history WHERE downtime_id = v_d1) = 2);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 6. Commentary (money) ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.monthly_report_notes (installation_id, period_month, section, body) VALUES (v_inst, '2026-03-01', 'summary', 'Good month');
    INSERT INTO _r VALUES ('money_user_writes_note', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_writes_note', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('editor_reads_no_notes', (SELECT count(*) FROM solar.monthly_report_notes WHERE installation_id = v_inst) = 0);
  BEGIN
    INSERT INTO solar.monthly_report_notes (installation_id, period_month, section, body) VALUES (v_inst, '2026-03-01', 'actions', 'x');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_note_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_note_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 7. Monthly report versions (service path) ─────────────────────────────
  INSERT INTO projects.reports (organisation_id, project_id, kind, source_table, source_id, title, storage_path, status, version)
  VALUES (v_org, v_p, 'solar_monthly', 'solar.installations', v_inst, 'March', 'o/p/m1.pdf', 'issued', 1) RETURNING id INTO v_rep1;
  INSERT INTO projects.reports (organisation_id, project_id, kind, source_table, source_id, title, storage_path, status, version)
  VALUES (v_org, v_p, 'solar_monthly', 'solar.installations', v_inst, 'March', 'o/p/m2.pdf', 'issued', 2) RETURNING id INTO v_rep2;
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, report_id, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 1, v_rep1, '{"period":"2026-03","actualKwh":1}', v_sha1, v_sha1) RETURNING id INTO v_m1;
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, report_id, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 2, v_rep2, '{"period":"2026-03","actualKwh":2}', v_sha2, v_sha2) RETURNING id INTO v_m2;
    INSERT INTO _r VALUES ('service_writes_two_versions', (SELECT array_agg(version ORDER BY version) = ARRAY[1, 2]
      FROM solar.monthly_reports WHERE installation_id = v_inst AND period_month = '2026-03-01'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_writes_two_versions', false);
  END;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 5, '{"period":"2026-03"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('skipped_version_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('skipped_version_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-04-01', 1, '{"period":"2026-03"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('snapshot_period_mismatch_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('snapshot_period_mismatch_REFUSED', false);
  END;
  -- These two attempts are NOT rolled back when wrongly allowed: an edited v1 must also turn
  -- report_v2_leaves_v1_unchanged red below (the "edit v1 instead of issuing v2" defect, WM M1/M2).
  BEGIN
    UPDATE solar.monthly_reports SET snapshot = '{"period":"2026-03","actualKwh":99}' WHERE id = v_m1;
    INSERT INTO _r VALUES ('service_update_v1_REFUSED', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('service_update_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_update_v1_REFUSED', false);
  END;
  RESET ROLE;
  BEGIN
    UPDATE solar.monthly_reports SET snapshot = '{"period":"2026-03","actualKwh":98}' WHERE id = v_m1;
    INSERT INTO _r VALUES ('owner_update_v1_REFUSED', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_update_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_update_v1_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('report_v2_leaves_v1_unchanged', (SELECT snapshot = '{"period":"2026-03","actualKwh":1}'::jsonb
    AND snapshot_sha256 = v_sha1 AND pdf_sha256 = v_sha1 AND report_id = v_rep1 FROM solar.monthly_reports WHERE id = v_m1));
  BEGIN
    DELETE FROM solar.monthly_reports WHERE id = v_m1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_delete_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_delete_v1_REFUSED', false);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-04-01', 1, '{"period":"2026-04"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_writes_monthly_report_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_writes_monthly_report_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_monthly_reports', (SELECT count(*) FROM solar.monthly_reports WHERE installation_id = v_inst) = 2);
  INSERT INTO _r VALUES ('money_user_reads_monthly_kind', public.user_can_read_report_kind(v_p, 'solar_monthly'));
  INSERT INTO _r VALUES ('money_user_lists_monthly_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_monthly') = 2);
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_edit, v_view, v_client, v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('no_money_reads_no_monthly_reports_' || CASE u WHEN v_edit THEN 'editor' WHEN v_view THEN 'view'
      WHEN v_client THEN 'client' WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_monthly') = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('earlier_kinds_still_gated', NOT public.user_can_read_report_kind(v_p, 'solar_feasibility')
    AND public.user_can_read_report_kind(v_p, 'solar_technical') AND NOT public.user_can_read_report_kind(v_p, 'solar_monthly'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 8. Handover ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.handover_templates (organisation_id, items) VALUES (v_org, '[{"key":"coc","label":"CoC","required":true}]');
    INSERT INTO _r VALUES ('admin_writes_template', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_writes_template', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.handover_templates SET name = 'Forged' WHERE organisation_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('non_admin_template_noop', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_template', (SELECT count(*) FROM solar.handover_templates WHERE organisation_id = v_org) = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.handover_items (installation_id, item_key, label, document_id) VALUES (v_inst, 'coc', 'CoC', v_doc1) RETURNING id INTO v_item;
    INSERT INTO _r VALUES ('handover_link_completes', (SELECT completed_at IS NOT NULL AND completed_by = v_edit FROM solar.handover_items WHERE id = v_item));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('handover_link_completes', false);
  END;
  BEGIN
    UPDATE solar.handover_items SET document_id = v_doc2 WHERE id = v_item;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_document_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_document_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.handover_items SET not_applicable = TRUE WHERE id = v_item;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('na_with_document_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('na_with_document_REFUSED', false);
  END;
  UPDATE solar.handover_items SET document_id = NULL WHERE id = v_item;
  INSERT INTO _r VALUES ('handover_unlink_clears', (SELECT completed_at IS NULL AND completed_by IS NULL FROM solar.handover_items WHERE id = v_item));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 9. anon ───────────────────────────────────────────────────────────────
  INSERT INTO _r VALUES ('anon_no_table_privilege', NOT has_table_privilege('anon', 'solar.installations', 'SELECT')
    AND NOT has_table_privilege('anon', 'solar.monthly_reports', 'SELECT') AND NOT has_table_privilege('anon', 'solar.downtime', 'SELECT'));
  INSERT INTO _r VALUES ('read_functions_not_anon',
    NOT has_function_privilege('anon', 'public.solar_ops_monthly_kwh(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.solar_ops_series(uuid, text, date)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.solar_ops_series(uuid, text, date)', 'EXECUTE'));

  -- ── 10. Lapsed subscription: staff read nothing, rows kept ────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_money_user_reads_nothing', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0
    AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
    AND public.solar_ops_monthly_kwh(v_inst, 'generation') = '{}'::jsonb);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 2);

  -- ── 11. A study delete cascades every operations row (no history FK trap) ─
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-12 10:00+02', '2026-03-12 12:00+02', 'other');
    DELETE FROM solar.studies WHERE id = v_study;
    INSERT INTO _r VALUES ('study_delete_cascades_operations', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.downtime WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.handover_items WHERE project_id = v_p) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('study_delete_cascades_operations', false);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Build the RED bundle (the base chain, no 00218) and run it.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7; M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql \
    $(ls $M/00212_*.sql $M/00213_*.sql $M/00214_*.sql $M/00215_*.sql 2>/dev/null) \
    $M/00216_solar_cases.sql $M/00217_solar_proposals.sql > $S/base.sql
grep -nE '^\s*(BEGIN|COMMIT)\s*;' $S/base.sql || echo "no-txn-control-ok"
scripts/db/dry-run-migration.sh $S/base.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | tail -20
```
Expected: `no-txn-control-ok`, then RED — the file aborts at the first `solar.installations` statement (`relation "solar.installations" does not exist`), reported as one failed assertion.

- [ ] **Step 3: Commit the assertions.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git add scripts/db/assert-solar-operations-roles.sql
git commit -m "test(solar): 00218 behavioural assertions (red without 00218)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prove GREEN, then prove the assertions can fail (mutations)

**Files:** none committed (scratch bundles only).

- [ ] **Step 1: GREEN run, plus every earlier Solar assertion file on top of 00218.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7; M=apps/edge-functions/supabase/migrations
cat $S/base.sql $M/00218_solar_operations.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | tail -70
scripts/db/dry-run-migration.sh $S/green.sql $(ls scripts/db/assert-solar-*-roles.sql | grep -v operations) 2>&1 | grep -iE 'false|error' || echo "earlier Solar assertions still green"
```
Expected: 67 rows, every `ok` = `true`; then `earlier Solar assertions still green` (00218 re-declares the product-events CHECK and both report-kind functions; 00208–00217 behaviour must not change). If the row count is not 67, an assertion block aborted — read the error. Any `false`: fix the MIGRATION unless the assertion is demonstrably wrong, then re-run both.

- [ ] **Step 2: Mutation 1 — no dedupe ⇒ a re-import doubles.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe 's/SELECT DISTINCT ON \(ch\.meter_id, r\.ts_end\)/SELECT/g' $S/green.sql > $S/m1.sql
diff -q $S/green.sql $S/m1.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m1.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `reimport_does_not_double` and `series_one_value_per_interval` are `false`.

- [ ] **Step 3: Mutation 2 — month booked by the interval END (the WM "month from the UI" family).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe 's/to_char\(\(ts_end - make_interval\(mins => interval_min\)\) AT TIME ZONE/to_char(ts_end AT TIME ZONE/' $S/green.sql > $S/m2.sql
diff -q $S/green.sql $S/m2.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m2.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `month_from_interval_start` is `false`.

- [ ] **Step 4: Mutation 3 — monthly report versions made editable.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe "s/RAISE EXCEPTION 'solar\.monthly_reports: a monthly report version is immutable; generate a new version' USING ERRCODE = '42501';/RETURN NEW;/" $S/green.sql > $S/m3.sql
diff -q $S/green.sql $S/m3.sql && echo "MUTATION DID NOT APPLY"
echo "GRANT UPDATE ON solar.monthly_reports TO service_role;" >> $S/m3.sql
scripts/db/dry-run-migration.sh $S/m3.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `service_update_v1_REFUSED`, `owner_update_v1_REFUSED` AND `report_v2_leaves_v1_unchanged` are `false` (those two attempts keep their write when wrongly allowed, so the edited v1 is visible to the unchanged-check that follows them).

- [ ] **Step 5: Mutation 4 — the generation kind check removed (the WM council double-count).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe "s/IF NEW\.role = 'generation' AND v_kind <> 'solar' THEN/IF false THEN/" $S/green.sql > $S/m4.sql
diff -q $S/green.sql $S/m4.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m4.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `council_as_generation_REFUSED` and `tenant_as_generation_REFUSED` are `false`.

- [ ] **Step 6: Mutation 5 — commentary read on `solar_can_view`.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe 's/(CREATE POLICY monthly_report_notes_select ON solar\.monthly_report_notes FOR SELECT TO authenticated\n    USING \(public\.)solar_can_see_money/${1}solar_can_view/' $S/green.sql > $S/m5.sql
diff -q $S/green.sql $S/m5.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m5.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `editor_reads_no_notes` is `false`.

- [ ] **Step 7: Mutation 6 — report snapshots read on `solar_can_view`.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe 's/(CREATE POLICY monthly_reports_select ON solar\.monthly_reports FOR SELECT TO authenticated\n    USING \(public\.)solar_can_see_money/${1}solar_can_view/' $S/green.sql > $S/m6.sql
diff -q $S/green.sql $S/m6.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m6.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `no_money_reads_no_monthly_reports_editor` and `no_money_reads_no_monthly_reports_view` are `false` (the client and nogrant rows stay `true`: their forged or absent grant yields no View either).

- [ ] **Step 8: Mutation 7 — `solar_monthly` dropped from the report-kind gate.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe "s/    WHEN _kind = 'solar_monthly' THEN COALESCE\(public\.solar_can_see_money\(_project_id\), FALSE\)\n//" $S/green.sql > $S/m7.sql
diff -q $S/green.sql $S/m7.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m7.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `money_user_reads_monthly_kind` and `money_user_lists_monthly_report` are `false` (the kind falls to the sensitive-role branch, which refuses a contractor holding Edit + financials).

- [ ] **Step 9: Mutation 8 — the downtime overlap check removed.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7
perl -0pe "s/RAISE EXCEPTION 'solar\.downtime: this window overlaps recorded downtime' USING ERRCODE = '23P01';/NULL;/" $S/green.sql > $S/m8.sql
diff -q $S/green.sql $S/m8.sql && echo "MUTATION DID NOT APPLY"
scripts/db/dry-run-migration.sh $S/m8.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -E 'false'
```
Expected: `downtime_overlap_REFUSED` is `false`.

- [ ] **Step 10: Record the mutation ledger** (eight mutations, each with the rows that went red) for the PR body. No commit.

---

### Task 4: Product-events registry + `@esite/db` guards

**Files:**
- Modify: `packages/shared/src/lib/analytics/product-events.ts` (the `PRODUCT_EVENTS` array)

- [ ] **Step 1: Run the product-events contract test — expect RED.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -12
```
Expected: FAIL — the final CHECK (now `00218`) contains `solar_installation_saved` … which `PRODUCT_EVENTS` lacks.

- [ ] **Step 2: Append to `PRODUCT_EVENTS`** (after `'solar_narrative_drafted',`):

```ts
  'solar_installation_saved',
  'solar_guarantee_saved',
  'solar_downtime_saved',
  'solar_monthly_report_generated',
  'solar_handover_updated',
```

- [ ] **Step 3: Run the registry and the repo-wide migration guards.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/lib/analytics/product-events.contract.test.ts 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -15
pnpm --filter web test -- src/lib/migration-verify-block.contract.test.ts 2>&1 | tail -6
```
Expected: all PASS. `@esite/db` checks that every SECURITY DEFINER function is revoked from anon in the TEXT (each is spelled out) and that no RESTRICTIVE `FOR ALL` exists; the verify-block contract parses `00218`'s block. If `@esite/db` flags `solar.ops_bind_from_installation()` as used by a trigger without a matching `trigger:` line, the three `guarantees_bind` / `ops_irradiation_bind` / `monthly_report_notes_bind` directives are already present — read the message and add only what it names.

- [ ] **Step 4: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git add packages/shared/src/lib/analytics/product-events.ts
git commit -m "feat(solar): register Phase 7 product events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
