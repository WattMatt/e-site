-- ---------------------------------------------------------------------------
-- Migration 00213: Solar tariff selection + tariff-library operations (Phase 2b)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §5 (Tariff tab) and §12 (platform
-- tariff library); docs/solar/03-data-model-and-security.md §3 (studies
-- columns, tariff_overrides + tariff_override_charges, bill_checks; money
-- tables gated by solar_can_see_money) and §3.1 (RLS pattern); decisions D-03,
-- D-03b, D-07, D-10, D-29 in docs/solar/06-open-decisions.md. Plan:
-- docs/superpowers/plans/2026-09-28-solar-phase-2b-tariff-ui*.md.
--
-- WHAT.
--   solar.studies  + licensee_id, tariff_id, tariff_override_id, export_rule,
--                  escalation. Written only at Edit + financials
--                  (studies_tariff_guard); a pinned tariff must be published
--                  or superseded; licensee_id is derived from it.
--   solar.tariff_overrides, solar.tariff_override_charges — the project copy
--                  of the pinned tariff (D-10 landlord resale); a changed rate
--                  carries a reason.
--   solar.study_export_rates — municipal export rate entered by the user with
--                  a mandatory source note (the NERSA books publish none).
--   solar.bill_checks — one real bill against the engine's model.
--   tariffs.error_report — "Report a tariff error" queue for the platform
--                  tariff admins (a platform queue, NOT a project work item:
--                  the admins are not project members, see plan D2b-3).
--   tariffs.ingest_job — PDF ingests queued for the staff worker
--                  (scripts/tariffs/ingest-worker.ts: needs poppler).
--   tariffs.due_year_alert + tariffs.record_due_year_alerts(regime, on) —
--                  the due-year monitor.
--   tariffs.year_content_fingerprint / tariffs.record_year_validation —
--                  the 2b "Validate" action records a verdict only on the
--                  content it actually checked.
--   solar.create_tariff_override / solar.revert_tariff_override — atomic,
--                  stale-guarded, SECURITY INVOKER (RLS decides).
--   solar.save_export_rule — the export rule and its manual rates in one
--                  transaction, stale-guarded, SECURITY INVOKER.
--   tariffs.tou_calendar.updated_at, tariffs.sseg_rule.updated_at (bumped by
--                  tariffs.touch_updated_at) + tariffs.save_tou_calendar — the
--                  calendar, its windows and holiday rule in one transaction,
--                  stale-guarded, SECURITY INVOKER (00209's admin RLS decides).
--
-- WHO. Money rows (the four solar tables): read and written at Edit +
-- financials only (solar_can_see_money). Studies' tariff columns: written at
-- Edit + financials only; readable at View like the rest of the study (none of
-- them holds a rand value: the manual export RATE lives in
-- solar.study_export_rates). tariffs.error_report: inserted by an Edit +
-- financials user of the project, read by the reporter and platform tariff
-- admins, resolved by platform tariff admins. tariffs.ingest_job /
-- due_year_alert: platform tariff admins read; the service role writes.
--
-- OWNER STEP (NOT in this migration; pg_cron is scheduled through the
-- Management API, as every other cron job):
--   SELECT cron.schedule('tariffs-due-year-eskom', '0 5 1 4 *',
--          $c$SELECT tariffs.record_due_year_alerts('eskom')$c$);
--   SELECT cron.schedule('tariffs-due-year-municipal', '0 5 1 7 *',
--          $c$SELECT tariffs.record_due_year_alerts('municipal')$c$);
--   05:00 UTC = 07:00 SAST on 1 April (Eskom year) and 1 July (municipal year).
--
-- 00207's and 00209's schema-wide @verify directives are re-checked on every
-- deploy and this migration conforms to each: FORCE RLS on every new table in
-- solar and tariffs; exactly one SELECT policy on solar.studies (unchanged);
-- no RESTRICTIVE policy covering SELECT anywhere in solar; no FOR ALL and no
-- RESTRICTIVE policy anywhere in tariffs; every SECURITY DEFINER function
-- revokes EXECUTE from PUBLIC and anon.
--
-- DEPENDS ON 00207 (solar helpers, studies), 00209 (tariffs schema).
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- The "[mutation-probe Mn]" comments mark lines the red/green mutation runs
-- delete or rewrite; they are inert.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- column: solar.studies.licensee_id
-- column: solar.studies.tariff_id
-- column: solar.studies.tariff_override_id
-- column: solar.studies.export_rule
-- column: solar.studies.escalation
-- constraint: studies_export_rule_shape ON solar.studies
-- constraint: studies_escalation_shape ON solar.studies
-- table: solar.tariff_overrides
-- table: solar.tariff_override_charges
-- table: solar.study_export_rates
-- table: solar.bill_checks
-- table: tariffs.error_report
-- table: tariffs.ingest_job
-- table: tariffs.due_year_alert
-- constraint: override_charge_edit_has_reason ON solar.tariff_override_charges
-- constraint: bill_checks_first_of_month ON solar.bill_checks
-- constraint: study_export_rates_note_required ON solar.study_export_rates
-- function: solar.studies_tariff_guard()
-- function: solar.money_row_bind()
-- function: solar.tariff_override_charges_guard()
-- function: solar.create_tariff_override(uuid, timestamptz)
-- function: solar.revert_tariff_override(uuid, timestamptz)
-- function: tariffs.error_report_bind()
-- function: tariffs.ingest_job_bind()
-- function: tariffs.claim_ingest_job()
-- function: tariffs.year_content_fingerprint(uuid)
-- function: tariffs.record_year_validation(uuid, integer, text)
-- function: tariffs.record_due_year_alerts(text, date)
-- function: solar.tariff_override_charges_delete_guard()
-- function: solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)
-- function: tariffs.touch_updated_at()
-- function: tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text)
-- column: tariffs.tou_calendar.updated_at
-- column: tariffs.sseg_rule.updated_at
-- trigger: tariff_override_charges_delete_guard ON solar.tariff_override_charges
-- index: tariff_override_charges_one_copy_per_base ON solar.tariff_override_charges
-- trigger: tou_calendar_touch ON tariffs.tou_calendar
-- trigger: sseg_rule_touch ON tariffs.sseg_rule
-- grant_absent: anon EXECUTE ON solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)
-- grant_absent: anon EXECUTE ON tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text)
-- grant_present: authenticated EXECUTE ON solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)
-- grant_present: authenticated EXECUTE ON tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text)'::regprocedure)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)'::regprocedure)
-- trigger: studies_tariff_guard ON solar.studies
-- trigger: tariff_overrides_bind ON solar.tariff_overrides
-- trigger: tariff_override_charges_bind ON solar.tariff_override_charges
-- trigger: tariff_override_charges_guard ON solar.tariff_override_charges
-- trigger: study_export_rates_bind ON solar.study_export_rates
-- trigger: bill_checks_bind ON solar.bill_checks
-- trigger: error_report_bind ON tariffs.error_report
-- trigger: ingest_job_bind ON tariffs.ingest_job
-- policy: tariff_overrides_select ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_insert ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_update ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_delete ON solar.tariff_overrides PERMISSIVE
-- policy: tariff_overrides_insert_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: tariff_overrides_update_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: tariff_overrides_delete_authz ON solar.tariff_overrides RESTRICTIVE
-- policy: override_charges_select ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_insert ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_update ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_delete ON solar.tariff_override_charges PERMISSIVE
-- policy: override_charges_insert_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: override_charges_update_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: override_charges_delete_authz ON solar.tariff_override_charges RESTRICTIVE
-- policy: export_rates_select ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_insert ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_update ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_delete ON solar.study_export_rates PERMISSIVE
-- policy: export_rates_insert_authz ON solar.study_export_rates RESTRICTIVE
-- policy: export_rates_update_authz ON solar.study_export_rates RESTRICTIVE
-- policy: export_rates_delete_authz ON solar.study_export_rates RESTRICTIVE
-- policy: bill_checks_select ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_insert ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_delete ON solar.bill_checks PERMISSIVE
-- policy: bill_checks_insert_authz ON solar.bill_checks RESTRICTIVE
-- policy: bill_checks_delete_authz ON solar.bill_checks RESTRICTIVE
-- policy: error_report_select ON tariffs.error_report PERMISSIVE
-- policy: error_report_insert ON tariffs.error_report PERMISSIVE
-- policy: error_report_update ON tariffs.error_report PERMISSIVE
-- policy: ingest_job_select ON tariffs.ingest_job PERMISSIVE
-- policy: ingest_job_insert ON tariffs.ingest_job PERMISSIVE
-- policy: due_year_alert_select ON tariffs.due_year_alert PERMISSIVE
-- grant_absent: anon SELECT ON solar.tariff_overrides
-- grant_absent: anon SELECT ON solar.tariff_override_charges
-- grant_absent: anon SELECT ON solar.study_export_rates
-- grant_absent: anon SELECT ON solar.bill_checks
-- grant_absent: authenticated UPDATE ON solar.bill_checks
-- grant_absent: anon SELECT ON tariffs.error_report
-- grant_absent: authenticated DELETE ON tariffs.error_report
-- grant_absent: authenticated UPDATE ON tariffs.ingest_job
-- grant_absent: authenticated DELETE ON tariffs.ingest_job
-- grant_absent: authenticated INSERT ON tariffs.due_year_alert
-- grant_absent: anon EXECUTE ON solar.money_row_bind()
-- grant_absent: anon EXECUTE ON solar.create_tariff_override(uuid, timestamptz)
-- grant_absent: anon EXECUTE ON solar.revert_tariff_override(uuid, timestamptz)
-- grant_absent: authenticated EXECUTE ON tariffs.record_year_validation(uuid, integer, text)
-- grant_absent: authenticated EXECUTE ON tariffs.year_content_fingerprint(uuid)
-- grant_absent: authenticated EXECUTE ON tariffs.claim_ingest_job()
-- grant_absent: authenticated EXECUTE ON tariffs.record_due_year_alerts(text, date)
-- anon_execute_absent: ALL prosecdef functions in solar
-- anon_execute_absent: ALL prosecdef functions in tariffs
-- sql: (SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('tariff_overrides', 'tariff_override_charges', 'study_export_rates', 'bill_checks') AND cmd IN ('SELECT', 'ALL'))
-- sql: (SELECT bool_and(strpos(qual, 'solar_can_see_money') > 0) FROM pg_policies WHERE schemaname = 'solar' AND tablename IN ('tariff_overrides', 'tariff_override_charges', 'study_export_rates', 'bill_checks') AND cmd = 'SELECT')
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid IN ('solar.tariff_overrides'::regclass, 'solar.tariff_override_charges'::regclass, 'solar.study_export_rates'::regclass, 'solar.bill_checks'::regclass, 'tariffs.error_report'::regclass, 'tariffs.ingest_job'::regclass, 'tariffs.due_year_alert'::regclass))
-- sql: (SELECT strpos(pg_get_functiondef('solar.studies_tariff_guard()'::regprocedure), 'solar_can_see_money') > 0)
-- behaviour: scripts/db/assert-solar-tariff-selection-roles.sql — every row ok
-- @verify:end

-- ── 1. Money tables (created before the studies columns that reference them)
CREATE TABLE IF NOT EXISTS solar.tariff_overrides (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL UNIQUE REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    base_tariff_id   UUID NOT NULL REFERENCES tariffs.tariff(id),
    note             TEXT,
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solar.tariff_override_charges (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    override_id      UUID NOT NULL REFERENCES solar.tariff_overrides(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    base_charge_id   UUID REFERENCES tariffs.charge(id) ON DELETE SET NULL,
    component        TEXT NOT NULL CHECK (component IN
                       ('energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
                        'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
                        'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other')),
    season           TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou              TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    day_type         TEXT NOT NULL DEFAULT 'all' CHECK (day_type IN ('all', 'weekday', 'saturday', 'sunday')),
    block_min_kwh    NUMERIC(14,3),
    block_max_kwh    NUMERIC(14,3),
    block_basis      TEXT CHECK (block_basis IN ('monthly', 'daily')),
    unit             TEXT NOT NULL CHECK (unit IN
                       ('c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
                        'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct')),
    demand_basis     TEXT CHECK (demand_basis IN ('nmd', 'actual_md', 'peak_window_md', 'utilised_capacity')),
    amount_excl_vat  NUMERIC(14,6) NOT NULL,
    vat_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
    vat_basis        TEXT NOT NULL DEFAULT 'stated_excl' CHECK (vat_basis IN ('stated_excl', 'assumed_excl', 'stated_incl')),
    source_locator   JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason           TEXT,
    edited_by        UUID REFERENCES auth.users(id),
    edited_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT override_charge_block_order CHECK (block_max_kwh IS NULL OR (block_min_kwh IS NOT NULL AND block_max_kwh > block_min_kwh))
);
ALTER TABLE solar.tariff_override_charges ADD CONSTRAINT override_charge_edit_has_reason CHECK (edited_at IS NULL OR length(btrim(coalesce(reason, ''))) > 0);  -- [mutation-probe M3]
CREATE INDEX IF NOT EXISTS tariff_override_charges_override_idx ON solar.tariff_override_charges (override_id);
-- One row per base charge per override (an added row, base_charge_id NULL, stays distinct).
CREATE UNIQUE INDEX IF NOT EXISTS tariff_override_charges_one_copy_per_base ON solar.tariff_override_charges (override_id, base_charge_id);

CREATE TABLE IF NOT EXISTS solar.study_export_rates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    season           TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou              TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    unit             TEXT NOT NULL CHECK (unit IN ('c_per_kWh', 'R_per_kWh')),
    amount_excl_vat  NUMERIC(14,6) NOT NULL CHECK (amount_excl_vat >= 0),
    source_note      TEXT NOT NULL CONSTRAINT study_export_rates_note_required CHECK (length(btrim(source_note)) > 0),
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT study_export_rates_one_per_period UNIQUE (study_id, season, tou)
);

CREATE TABLE IF NOT EXISTS solar.bill_checks (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id                  UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id                UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id           UUID NOT NULL REFERENCES public.organisations(id),
    billing_month             DATE NOT NULL CONSTRAINT bill_checks_first_of_month CHECK (extract(day FROM billing_month) = 1),
    tariff_id                 UUID REFERENCES tariffs.tariff(id),
    tariff_override_id        UUID REFERENCES solar.tariff_overrides(id) ON DELETE SET NULL,
    import_kwh_peak           NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_peak >= 0),
    import_kwh_standard       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_standard >= 0),
    import_kwh_off_peak       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (import_kwh_off_peak >= 0),
    max_demand_kva            NUMERIC(12,2) CHECK (max_demand_kva >= 0),
    actual_total_excl_vat     NUMERIC(14,2) NOT NULL CHECK (actual_total_excl_vat > 0),
    modelled_total_excl_vat   NUMERIC(14,2) NOT NULL,
    difference_pct            NUMERIC(9,3) NOT NULL,
    modelled                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    engine_version            TEXT NOT NULL,
    note                      TEXT,
    created_by                UUID REFERENCES auth.users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bill_checks_study_month_idx ON solar.bill_checks (study_id, billing_month DESC);

-- ── 2. Studies: the tariff selection ────────────────────────────────────────
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS licensee_id UUID REFERENCES tariffs.licensee(id);
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES tariffs.tariff(id);
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS tariff_override_id UUID REFERENCES solar.tariff_overrides(id) ON DELETE SET NULL;
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS export_rule JSONB;
ALTER TABLE solar.studies ADD COLUMN IF NOT EXISTS escalation JSONB;
-- export_rule = {version, method: linked_tariff|none|manual, sourceNote?}; manual needs a source note.
ALTER TABLE solar.studies ADD CONSTRAINT studies_export_rule_shape CHECK (
    export_rule IS NULL OR (
        jsonb_typeof(export_rule) = 'object'
        AND export_rule->>'method' IN ('linked_tariff', 'none', 'manual')
        AND (export_rule->>'method' <> 'manual' OR length(btrim(coalesce(export_rule->>'sourceNote', ''))) > 0)));
-- escalation = {version, overrides: {"<year n>": pct}}; NULL = the defaults (D-07).
ALTER TABLE solar.studies ADD CONSTRAINT studies_escalation_shape CHECK (
    escalation IS NULL OR (jsonb_typeof(escalation) = 'object' AND jsonb_typeof(escalation->'overrides') = 'object'));

-- INVOKER: every read below is one the caller may already make (published
-- tariffs via 00209's reader policy; the study's own override via the money
-- SELECT policy). A draft tariff or a foreign override is invisible and reads
-- as "not found", which refuses the same way.
CREATE OR REPLACE FUNCTION solar.studies_tariff_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_state  TEXT;
    v_lic    UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.licensee_id, NEW.tariff_id, NEW.tariff_override_id, NEW.export_rule, NEW.escalation)
           IS NOT DISTINCT FROM (OLD.licensee_id, OLD.tariff_id, OLD.tariff_override_id, OLD.export_rule, OLD.escalation) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.licensee_id IS NULL AND NEW.tariff_id IS NULL AND NEW.tariff_override_id IS NULL
       AND NEW.export_rule IS NULL AND NEW.escalation IS NULL THEN
        RETURN NEW;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT public.solar_can_see_money(NEW.project_id) THEN RAISE EXCEPTION 'solar.studies: the tariff, export rule and escalation need Edit + financials' USING ERRCODE = '42501'; END IF;  -- [mutation-probe M1]
    IF NEW.tariff_id IS NOT NULL THEN
        SELECT y.state, y.licensee_id INTO v_state, v_lic
          FROM tariffs.tariff t JOIN tariffs.tariff_year y ON y.id = t.tariff_year_id
         WHERE t.id = NEW.tariff_id;
        IF v_state IS NULL OR v_state NOT IN ('published', 'superseded') THEN RAISE EXCEPTION 'solar.studies: only a published tariff can be pinned' USING ERRCODE = '23514'; END IF;  -- [mutation-probe M4]
        NEW.licensee_id := v_lic;
    END IF;
    IF NEW.tariff_override_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.tariff_overrides o
         WHERE o.id = NEW.tariff_override_id AND o.study_id = NEW.id AND o.base_tariff_id IS NOT DISTINCT FROM NEW.tariff_id) THEN
        RAISE EXCEPTION 'solar.studies: the project override belongs to another study or tariff; revert it first'
            USING ERRCODE = '23514';
    END IF;
    -- A newly linked override must copy every charge of the tariff (create_tariff_override
    -- inserts them before linking); a partial copy would silently drop charges from the costing.
    IF NEW.tariff_override_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.tariff_override_id IS DISTINCT FROM OLD.tariff_override_id)
       AND EXISTS (SELECT 1 FROM tariffs.charge c
                    WHERE c.tariff_id = NEW.tariff_id
                      AND NOT EXISTS (SELECT 1 FROM solar.tariff_override_charges oc
                                       WHERE oc.override_id = NEW.tariff_override_id AND oc.base_charge_id = c.id)) THEN
        RAISE EXCEPTION 'solar.studies: the project override is missing some of the tariff''s charges; create it again'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.studies_tariff_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.studies_tariff_guard() FROM anon;
-- Fires after 00207's studies_bind (triggers fire in name order).
CREATE TRIGGER studies_tariff_guard BEFORE INSERT OR UPDATE ON solar.studies
    FOR EACH ROW EXECUTE FUNCTION solar.studies_tariff_guard();

-- ── 3. Binding for the money tables ─────────────────────────────────────────
-- project_id and organisation_id come from the parent row, never the client
-- (RLS keys on project_id). The parent is immutable. Attribution is bound.
-- SECURITY DEFINER like 00207's studies_bind: the parent lookup must not
-- depend on what the caller can see (a hidden parent would otherwise surface
-- as a NOT NULL error instead of the named refusal).
CREATE OR REPLACE FUNCTION solar.money_row_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_project  UUID;
    v_org      UUID;
    v_tariff   UUID;
    v_override UUID;
BEGIN
    IF TG_TABLE_NAME = 'tariff_override_charges' THEN
        IF TG_OP = 'UPDATE' AND (NEW.override_id <> OLD.override_id OR NEW.base_charge_id IS DISTINCT FROM OLD.base_charge_id) THEN
            RAISE EXCEPTION 'solar.tariff_override_charges: override_id and base_charge_id are immutable' USING ERRCODE = '42501';
        END IF;
        SELECT o.project_id, o.organisation_id INTO v_project, v_org FROM solar.tariff_overrides o WHERE o.id = NEW.override_id;
    ELSE
        IF TG_OP = 'UPDATE' AND NEW.study_id <> OLD.study_id THEN
            RAISE EXCEPTION 'solar.%: study_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        SELECT s.project_id, s.organisation_id, s.tariff_id, s.tariff_override_id INTO v_project, v_org, v_tariff, v_override
          FROM solar.studies s WHERE s.id = NEW.study_id;
    END IF;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.%: parent row not found', TG_TABLE_NAME USING ERRCODE = '23503';
    END IF;
    NEW.project_id := v_project;
    NEW.organisation_id := v_org;
    -- A bill check records the tariff the study costs with, never a client's claim
    -- (a forged tariff_override_id could otherwise point at another project's override).
    -- A supplied id that is not the study's is refused (the action supplies the ids it costed
    -- on, so a tariff or override change mid-check is a refusal, not a mislabelled record).
    IF TG_TABLE_NAME = 'bill_checks' THEN
        IF (NEW.tariff_id IS NOT NULL AND NEW.tariff_id IS DISTINCT FROM v_tariff)
           OR (NEW.tariff_override_id IS NOT NULL AND NEW.tariff_override_id IS DISTINCT FROM v_override) THEN
            RAISE EXCEPTION 'solar.bill_checks: the study''s tariff changed while the bill was being checked' USING ERRCODE = '23514';
        END IF;
        NEW.tariff_id := v_tariff;
        NEW.tariff_override_id := v_override;
    END IF;

    IF TG_TABLE_NAME = 'tariff_overrides' THEN
        IF TG_OP = 'UPDATE' AND NEW.base_tariff_id <> OLD.base_tariff_id THEN
            RAISE EXCEPTION 'solar.tariff_overrides: base_tariff_id is immutable' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'INSERT' AND NEW.base_tariff_id IS DISTINCT FROM v_tariff THEN
            RAISE EXCEPTION 'solar.tariff_overrides: an override copies the study''s pinned tariff' USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME IN ('tariff_overrides', 'study_export_rates', 'bill_checks') THEN
            NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        END IF;
        NEW.created_at := NOW();
    ELSE
        NEW.created_at := OLD.created_at;
        IF TG_TABLE_NAME IN ('tariff_overrides', 'study_export_rates') THEN NEW.created_by := OLD.created_by; END IF;
    END IF;
    IF TG_TABLE_NAME <> 'bill_checks' THEN NEW.updated_at := NOW(); END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.money_row_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.money_row_bind() FROM anon;

CREATE TRIGGER tariff_overrides_bind BEFORE INSERT OR UPDATE ON solar.tariff_overrides
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER tariff_override_charges_bind BEFORE INSERT OR UPDATE ON solar.tariff_override_charges
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER study_export_rates_bind BEFORE INSERT OR UPDATE ON solar.study_export_rates
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();
CREATE TRIGGER bill_checks_bind BEFORE INSERT ON solar.bill_checks
    FOR EACH ROW EXECUTE FUNCTION solar.money_row_bind();

-- A changed rate (or an added row) carries a reason; the stamp is the caller.
-- base_charge_id, when given, must be a charge of the override's base tariff.
-- An INSERT is an unedited copy only when every rate column equals that charge
-- (no reason kept). Every row's source is the base charge's locator ('{}' for
-- an added row), never the client's. On UPDATE the reason and the source
-- change only together with the rate: alone they are refused, not ignored.
CREATE OR REPLACE FUNCTION solar.tariff_override_charges_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_changed  BOOLEAN;
    v_same     BOOLEAN := false;
    v_locator  JSONB := '{}'::jsonb;
BEGIN
    -- The base charge, read only within the override's base tariff; its locator is the row's source.
    IF NEW.base_charge_id IS NOT NULL THEN
        SELECT c.source_locator || jsonb_build_object('source_document_id', c.source_document_id),
               (c.component, c.season, c.tou, c.day_type, c.block_min_kwh, c.block_max_kwh, c.block_basis,
                c.unit, c.demand_basis, c.amount_excl_vat, c.vat_rate, c.vat_basis)
               IS NOT DISTINCT FROM
               (NEW.component, NEW.season, NEW.tou, NEW.day_type, NEW.block_min_kwh, NEW.block_max_kwh, NEW.block_basis,
                NEW.unit, NEW.demand_basis, NEW.amount_excl_vat, NEW.vat_rate, NEW.vat_basis)
          INTO v_locator, v_same
          FROM tariffs.charge c JOIN solar.tariff_overrides o ON o.base_tariff_id = c.tariff_id
         WHERE c.id = NEW.base_charge_id AND o.id = NEW.override_id;
        IF NOT FOUND THEN
            IF TG_OP = 'INSERT' THEN
                RAISE EXCEPTION 'solar.tariff_override_charges: the base charge is not a charge of the override''s tariff' USING ERRCODE = '23514';
            END IF;
            v_locator := '{}'::jsonb;
            v_same := false;
        END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        v_changed := NOT v_same;
    ELSE
        v_changed :=
           (NEW.component, NEW.season, NEW.tou, NEW.day_type, NEW.block_min_kwh, NEW.block_max_kwh, NEW.block_basis,
            NEW.unit, NEW.demand_basis, NEW.amount_excl_vat, NEW.vat_rate, NEW.vat_basis)
           IS DISTINCT FROM
           (OLD.component, OLD.season, OLD.tou, OLD.day_type, OLD.block_min_kwh, OLD.block_max_kwh, OLD.block_basis,
            OLD.unit, OLD.demand_basis, OLD.amount_excl_vat, OLD.vat_rate, OLD.vat_basis);
    END IF;
    IF v_changed THEN
        IF length(btrim(coalesce(NEW.reason, ''))) = 0 THEN RAISE EXCEPTION 'solar.tariff_override_charges: a changed rate needs a reason' USING ERRCODE = '23514'; END IF;  -- [mutation-probe M3]
        NEW.edited_at := NOW();
        NEW.edited_by := COALESCE(auth.uid(), NEW.edited_by);
        NEW.source_locator := v_locator;
    ELSIF TG_OP = 'UPDATE' THEN
        IF (NEW.reason, NEW.source_locator) IS DISTINCT FROM (OLD.reason, OLD.source_locator) THEN
            RAISE EXCEPTION 'solar.tariff_override_charges: the reason and source change only with the rate' USING ERRCODE = '23514';
        END IF;
        NEW.edited_at := OLD.edited_at;
        NEW.edited_by := OLD.edited_by;
    ELSE
        NEW.edited_at := NULL;
        NEW.edited_by := NULL;
        NEW.reason := NULL;
        NEW.source_locator := v_locator;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_guard() FROM anon;
CREATE TRIGGER tariff_override_charges_guard BEFORE INSERT OR UPDATE ON solar.tariff_override_charges
    FOR EACH ROW EXECUTE FUNCTION solar.tariff_override_charges_guard();

-- A row leaves only with its override (revert, or deleting the override: the
-- FK cascade runs inside the RI trigger, so pg_trigger_depth() > 1). A signed-in
-- caller deleting one row directly would drop a published charge from the
-- project copy with no reason recorded. The service path (auth.uid() NULL) may.
CREATE OR REPLACE FUNCTION solar.tariff_override_charges_delete_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'solar.tariff_override_charges: a rate leaves the project copy only when the override is reverted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_delete_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.tariff_override_charges_delete_guard() FROM anon;
CREATE TRIGGER tariff_override_charges_delete_guard BEFORE DELETE ON solar.tariff_override_charges
    FOR EACH ROW EXECUTE FUNCTION solar.tariff_override_charges_delete_guard();

-- ── 4. RLS on the money tables (the 00200 shape, SELECT on see_money) ───────
ALTER TABLE solar.tariff_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_override_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.tariff_override_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.study_export_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.study_export_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.bill_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.bill_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY tariff_overrides_select ON solar.tariff_overrides FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));  -- [mutation-probe M2]
CREATE POLICY tariff_overrides_insert ON solar.tariff_overrides FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_update ON solar.tariff_overrides FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_delete ON solar.tariff_overrides FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY tariff_overrides_insert_authz ON solar.tariff_overrides AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY tariff_overrides_update_authz ON solar.tariff_overrides AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY tariff_overrides_delete_authz ON solar.tariff_overrides AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

CREATE POLICY override_charges_select ON solar.tariff_override_charges FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_insert ON solar.tariff_override_charges FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY override_charges_update ON solar.tariff_override_charges FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY override_charges_delete ON solar.tariff_override_charges FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY override_charges_insert_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_update_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY override_charges_delete_authz ON solar.tariff_override_charges AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

CREATE POLICY export_rates_select ON solar.study_export_rates FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_insert ON solar.study_export_rates FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY export_rates_update ON solar.study_export_rates FOR UPDATE TO authenticated USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY export_rates_delete ON solar.study_export_rates FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY export_rates_insert_authz ON solar.study_export_rates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_update_authz ON solar.study_export_rates AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.solar_can_see_money(project_id)) WITH CHECK (public.solar_can_see_money(project_id));
CREATE POLICY export_rates_delete_authz ON solar.study_export_rates AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

-- bill_checks: a record, not a draft: no UPDATE policy and no UPDATE grant.
CREATE POLICY bill_checks_select ON solar.bill_checks FOR SELECT TO authenticated USING (public.solar_can_see_money(project_id));
CREATE POLICY bill_checks_insert ON solar.bill_checks FOR INSERT TO authenticated WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY bill_checks_delete ON solar.bill_checks FOR DELETE TO authenticated USING (public.user_has_project_access(project_id));
CREATE POLICY bill_checks_insert_authz ON solar.bill_checks AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.solar_can_see_money(project_id));  -- [mutation-probe M6]
CREATE POLICY bill_checks_delete_authz ON solar.bill_checks AS RESTRICTIVE FOR DELETE TO authenticated USING (public.solar_can_see_money(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.bill_checks TO authenticated;
REVOKE UPDATE, TRUNCATE ON solar.bill_checks FROM authenticated;   -- the schema default granted it at CREATE TABLE
GRANT ALL ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates, solar.bill_checks TO service_role;
REVOKE ALL ON solar.tariff_overrides, solar.tariff_override_charges, solar.study_export_rates, solar.bill_checks FROM anon;

-- ── 5. Override lifecycle (atomic, stale-guarded, RLS decides) ──────────────
CREATE OR REPLACE FUNCTION solar.create_tariff_override(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
    v_id     UUID;
BEGIN
    SELECT id, tariff_id, tariff_override_id, updated_at INTO v_study
      FROM solar.studies WHERE project_id = p_project_id FOR UPDATE;
    IF v_study.id IS NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: no study for this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_study.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.create_tariff_override: stale' USING ERRCODE = '40001';
    END IF;
    IF v_study.tariff_id IS NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: pin a published tariff first' USING ERRCODE = '23514';
    END IF;
    IF v_study.tariff_override_id IS NOT NULL THEN
        RAISE EXCEPTION 'solar.create_tariff_override: the study already has an override' USING ERRCODE = '23505';
    END IF;
    -- An unlinked override for this study (a direct insert that was never
    -- attached) would block UNIQUE (study_id) forever: it is nobody's copy.
    DELETE FROM solar.tariff_overrides WHERE study_id = v_study.id;
    INSERT INTO solar.tariff_overrides (study_id, project_id, organisation_id, base_tariff_id)
    VALUES (v_study.id, p_project_id, '00000000-0000-0000-0000-000000000000', v_study.tariff_id)
    RETURNING id INTO v_id;
    INSERT INTO solar.tariff_override_charges
        (override_id, project_id, organisation_id, base_charge_id, component, season, tou, day_type,
         block_min_kwh, block_max_kwh, block_basis, unit, demand_basis, amount_excl_vat, vat_rate, vat_basis, source_locator)
    SELECT v_id, p_project_id, '00000000-0000-0000-0000-000000000000', c.id, c.component, c.season, c.tou, c.day_type,
           c.block_min_kwh, c.block_max_kwh, c.block_basis, c.unit, c.demand_basis, c.amount_excl_vat, c.vat_rate, c.vat_basis,
           c.source_locator || jsonb_build_object('source_document_id', c.source_document_id)
      FROM tariffs.charge c WHERE c.tariff_id = v_study.tariff_id;
    UPDATE solar.studies SET tariff_override_id = v_id WHERE id = v_study.id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION solar.revert_tariff_override(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
BEGIN
    SELECT id, tariff_override_id, updated_at INTO v_study
      FROM solar.studies WHERE project_id = p_project_id FOR UPDATE;
    IF v_study.id IS NULL THEN
        RAISE EXCEPTION 'solar.revert_tariff_override: no study for this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_study.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.revert_tariff_override: stale' USING ERRCODE = '40001';
    END IF;
    IF v_study.tariff_override_id IS NULL THEN RETURN; END IF;
    UPDATE solar.studies SET tariff_override_id = NULL WHERE id = v_study.id;
    DELETE FROM solar.tariff_overrides WHERE id = v_study.tariff_override_id;
END $$;

-- The export rule and its manual rates in ONE transaction: the study row is
-- locked, the expected timestamp checked, the rates replaced and the rule set.
-- INVOKER: the money gates and studies_tariff_guard decide (an Edit user's
-- rate insert and rule write are refused 42501). Returns the new updated_at.
CREATE OR REPLACE FUNCTION solar.save_export_rule(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ, p_rule JSONB, p_rates JSONB)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
    v_upd    TIMESTAMPTZ;
BEGIN
    SELECT id, updated_at INTO v_study FROM solar.studies WHERE project_id = p_project_id FOR UPDATE;
    IF v_study.id IS NULL THEN
        RAISE EXCEPTION 'solar.save_export_rule: no study for this project' USING ERRCODE = 'P0002';
    END IF;
    IF v_study.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.save_export_rule: stale' USING ERRCODE = '40001';
    END IF;
    IF p_rule->>'method' IS DISTINCT FROM 'manual' AND jsonb_array_length(coalesce(p_rates, '[]'::jsonb)) > 0 THEN
        RAISE EXCEPTION 'solar.save_export_rule: rates are entered only for a manual export rule' USING ERRCODE = '23514';
    END IF;
    DELETE FROM solar.study_export_rates WHERE study_id = v_study.id;
    INSERT INTO solar.study_export_rates (study_id, project_id, organisation_id, season, tou, unit, amount_excl_vat, source_note)
    SELECT v_study.id, p_project_id, '00000000-0000-0000-0000-000000000000', r.season, r.tou, r.unit, r.amount_excl_vat, p_rule->>'sourceNote'
      FROM jsonb_to_recordset(coalesce(p_rates, '[]'::jsonb)) AS r(season TEXT, tou TEXT, unit TEXT, amount_excl_vat NUMERIC);
    UPDATE solar.studies SET export_rule = p_rule WHERE id = v_study.id RETURNING updated_at INTO v_upd;
    RETURN v_upd;
END $$;
REVOKE ALL ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION solar.create_tariff_override(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.create_tariff_override(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.create_tariff_override(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.revert_tariff_override(uuid, timestamptz) TO authenticated, service_role;

-- ── 6. tariffs.error_report ("Report a tariff error") ───────────────────────
CREATE TABLE IF NOT EXISTS tariffs.error_report (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id        UUID NOT NULL REFERENCES tariffs.tariff(id),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    reporter_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    note             TEXT NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
    resolution_note  TEXT,
    resolved_by      UUID REFERENCES auth.users(id),
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS error_report_status_idx ON tariffs.error_report (status, created_at DESC);

CREATE OR REPLACE FUNCTION tariffs.error_report_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.reporter_id := COALESCE(auth.uid(), NEW.reporter_id);
        NEW.status := 'open';
        NEW.resolution_note := NULL;
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
        NEW.created_at := NOW();
        RETURN NEW;
    END IF;
    -- reporter_id may only go to NULL: that is the FK's ON DELETE SET NULL when
    -- the reporter's auth user is deleted (clients hold no UPDATE on the column).
    IF (NEW.tariff_id, NEW.project_id, NEW.note, NEW.created_at)
       IS DISTINCT FROM (OLD.tariff_id, OLD.project_id, OLD.note, OLD.created_at)
       OR (NEW.reporter_id IS DISTINCT FROM OLD.reporter_id AND NEW.reporter_id IS NOT NULL) THEN
        RAISE EXCEPTION 'tariffs.error_report: only the status and resolution note change' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'open' THEN
        NEW.resolved_by := NULL;
        NEW.resolved_at := NULL;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.resolved_by := COALESCE(auth.uid(), NEW.resolved_by);
        NEW.resolved_at := NOW();
    ELSE
        NEW.resolved_by := OLD.resolved_by;
        NEW.resolved_at := OLD.resolved_at;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.error_report_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.error_report_bind() FROM anon;
CREATE TRIGGER error_report_bind BEFORE INSERT OR UPDATE ON tariffs.error_report
    FOR EACH ROW EXECUTE FUNCTION tariffs.error_report_bind();

ALTER TABLE tariffs.error_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.error_report FORCE ROW LEVEL SECURITY;
CREATE POLICY error_report_select ON tariffs.error_report FOR SELECT TO authenticated
    USING (reporter_id = (SELECT auth.uid()) OR (SELECT public.is_platform_tariff_admin()));
-- The tariff must be one the reporter can read (the subquery is under 00209's RLS).
CREATE POLICY error_report_insert ON tariffs.error_report FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_see_money(project_id) AND EXISTS (SELECT 1 FROM tariffs.tariff t WHERE t.id = error_report.tariff_id));  -- [mutation-probe M7]
CREATE POLICY error_report_update ON tariffs.error_report FOR UPDATE TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.error_report FROM authenticated;
GRANT SELECT, INSERT ON tariffs.error_report TO authenticated;
GRANT UPDATE (status, resolution_note, resolved_by, resolved_at) ON tariffs.error_report TO authenticated;

-- ── 7. tariffs.ingest_job (PDF ingests for the staff worker) ────────────────
CREATE TABLE IF NOT EXISTS tariffs.ingest_job (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id  UUID NOT NULL REFERENCES tariffs.source_document(id),
    parser              TEXT NOT NULL CHECK (parser IN ('province_xlsx', 'eskom_xlsm', 'rfd_pdf')),
    financial_year      TEXT NOT NULL CHECK (financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    licensee_name       TEXT,
    create_licensees    BOOLEAN NOT NULL DEFAULT false,
    status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    requested_by        UUID REFERENCES auth.users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    ingest_run_id       UUID REFERENCES tariffs.ingest_run(id),
    report              JSONB,
    error               TEXT,
    CONSTRAINT ingest_job_rfd_names_licensee CHECK (parser <> 'rfd_pdf' OR length(btrim(coalesce(licensee_name, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS ingest_job_queue_idx ON tariffs.ingest_job (status, requested_at);

CREATE OR REPLACE FUNCTION tariffs.ingest_job_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.requested_by := auth.uid();
        NEW.status := 'queued';
        NEW.requested_at := NOW();
        NEW.claimed_at := NULL;
        NEW.finished_at := NULL;
        NEW.ingest_run_id := NULL;
        NEW.report := NULL;
        NEW.error := NULL;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.ingest_job_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.ingest_job_bind() FROM anon;
CREATE TRIGGER ingest_job_bind BEFORE INSERT ON tariffs.ingest_job
    FOR EACH ROW EXECUTE FUNCTION tariffs.ingest_job_bind();

ALTER TABLE tariffs.ingest_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_job FORCE ROW LEVEL SECURITY;
CREATE POLICY ingest_job_select ON tariffs.ingest_job FOR SELECT TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY ingest_job_insert ON tariffs.ingest_job FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.ingest_job FROM authenticated;
GRANT SELECT ON tariffs.ingest_job TO authenticated;
GRANT INSERT (source_document_id, parser, financial_year, licensee_name, create_licensees, status, requested_by) ON tariffs.ingest_job TO authenticated;

-- The worker claims the oldest queued job; SKIP LOCKED makes two workers safe.
CREATE OR REPLACE FUNCTION tariffs.claim_ingest_job()
RETURNS SETOF tariffs.ingest_job LANGUAGE sql SET search_path = '' AS $$
    UPDATE tariffs.ingest_job j SET status = 'running', claimed_at = NOW()
     WHERE j.id = (SELECT q.id FROM tariffs.ingest_job q WHERE q.status = 'queued'
                    ORDER BY q.requested_at, q.id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING j.*;
$$;

-- ── 8. Validation fingerprint (the 2b Validate action) ──────────────────────
-- The year's content as the validators see it. Review stamps are not content
-- (the same rule as 00209's invalidate_year_validation).
CREATE OR REPLACE FUNCTION tariffs.year_content_fingerprint(p_year_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT md5(
        coalesce((SELECT string_agg((to_jsonb(t) - 'updated_at' - 'created_at')::text, '|' ORDER BY t.id)
                    FROM tariffs.tariff t WHERE t.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(c) - 'reviewed_at' - 'reviewed_by' - 'created_at')::text, '|' ORDER BY c.id)
                    FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id WHERE t.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(l) - 'created_at')::text, '|' ORDER BY l.id)
                    FROM tariffs.loss_factor l WHERE l.tariff_year_id = p_year_id), '')
        || '#' || coalesce((SELECT string_agg((to_jsonb(s) - 'created_at' - 'updated_at')::text, '|' ORDER BY s.id)
                    FROM tariffs.sseg_rule s WHERE s.tariff_year_id = p_year_id), ''));
$$;

-- Records the verdict only if the content is still what was checked. The year
-- row is locked first, so a content write racing this call either changed the
-- fingerprint already (refused here) or waits for this commit and then clears
-- the record through 00209's invalidate_year_validation trigger.
CREATE OR REPLACE FUNCTION tariffs.record_year_validation(p_year_id UUID, p_blocking INTEGER, p_fingerprint TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_n INT;
BEGIN
    IF p_blocking IS NULL OR p_blocking < 0 THEN
        RAISE EXCEPTION 'tariffs.record_year_validation: blocking must be >= 0' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM tariffs.tariff_year WHERE id = p_year_id FOR UPDATE;
    IF tariffs.year_content_fingerprint(p_year_id) IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'tariffs.record_year_validation: the year changed while it was being checked' USING ERRCODE = '40001'; END IF;  -- [mutation-probe M5]
    UPDATE tariffs.tariff_year SET validated_at = NOW(), validation_blocking = p_blocking
     WHERE id = p_year_id AND state IN ('ingesting', 'in_review');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'tariffs.record_year_validation: % is not a draft year', p_year_id USING ERRCODE = '23514';
    END IF;
END $$;

-- ── 8b. Stale guards for the admin calendar and SSEG saves ──────────────────
-- Additive columns; a row's updated_at moves on every UPDATE (clock_timestamp,
-- so two saves inside one transaction still differ).
ALTER TABLE tariffs.tou_calendar ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tariffs.sseg_rule ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION tariffs.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.touch_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.touch_updated_at() FROM anon;
CREATE TRIGGER tou_calendar_touch BEFORE UPDATE ON tariffs.tou_calendar
    FOR EACH ROW EXECUTE FUNCTION tariffs.touch_updated_at();
CREATE TRIGGER sseg_rule_touch BEFORE UPDATE ON tariffs.sseg_rule
    FOR EACH ROW EXECUTE FUNCTION tariffs.touch_updated_at();

-- A TOU calendar, its windows and its holiday rule in ONE transaction. NULL id
-- creates; otherwise the calendar is locked and the expected timestamp checked
-- (40001 when it moved). INVOKER: 00209's admin-only write policies decide; the
-- explicit check gives a non-admin the named refusal instead of a silent no-op.
-- Returns {id, updated_at}.
CREATE OR REPLACE FUNCTION tariffs.save_tou_calendar(p_calendar_id UUID, p_expected_updated_at TIMESTAMPTZ,
                                                     p_calendar JSONB, p_windows JSONB, p_holiday TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_id      UUID;
    v_upd     TIMESTAMPTZ;
    v_months  INT[];
BEGIN
    IF NOT public.is_platform_tariff_admin() THEN
        RAISE EXCEPTION 'tariffs.save_tou_calendar: only platform tariff admins edit calendars' USING ERRCODE = '42501';
    END IF;
    v_months := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_calendar->'high_season_months', '[]'::jsonb))::int);
    IF p_calendar_id IS NULL THEN
        INSERT INTO tariffs.tou_calendar (licensee_id, valid_from, valid_to, high_season_months, source)
        VALUES ((p_calendar->>'licensee_id')::uuid, (p_calendar->>'valid_from')::date, nullif(p_calendar->>'valid_to', '')::date,
                v_months, p_calendar->>'source')
        RETURNING id INTO v_id;
    ELSE
        SELECT c.updated_at INTO v_upd FROM tariffs.tou_calendar c WHERE c.id = p_calendar_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'tariffs.save_tou_calendar: that calendar no longer exists' USING ERRCODE = 'P0002';
        END IF;
        IF v_upd IS DISTINCT FROM p_expected_updated_at THEN
            RAISE EXCEPTION 'tariffs.save_tou_calendar: stale' USING ERRCODE = '40001';
        END IF;
        UPDATE tariffs.tou_calendar
           SET licensee_id = (p_calendar->>'licensee_id')::uuid, valid_from = (p_calendar->>'valid_from')::date,
               valid_to = nullif(p_calendar->>'valid_to', '')::date, high_season_months = v_months, source = p_calendar->>'source'
         WHERE id = p_calendar_id;
        v_id := p_calendar_id;
        DELETE FROM tariffs.tou_window WHERE calendar_id = v_id;
    END IF;
    INSERT INTO tariffs.tou_window (calendar_id, season, day_type, start_minute, end_minute, period)
    SELECT v_id, w.season, w.day_type, w.start_minute, w.end_minute, w.period
      FROM jsonb_to_recordset(coalesce(p_windows, '[]'::jsonb)) AS w(season TEXT, day_type TEXT, start_minute INT, end_minute INT, period TEXT);
    DELETE FROM tariffs.holiday_rule WHERE calendar_id = v_id;
    IF p_holiday IS NOT NULL THEN
        INSERT INTO tariffs.holiday_rule (calendar_id, treated_as) VALUES (v_id, p_holiday);
    END IF;
    SELECT c.updated_at INTO v_upd FROM tariffs.tou_calendar c WHERE c.id = v_id;
    RETURN jsonb_build_object('id', v_id, 'updated_at', v_upd);
END $$;
REVOKE ALL ON FUNCTION tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION tariffs.save_tou_calendar(uuid, timestamptz, jsonb, jsonb, text) TO authenticated, service_role;

-- ── 9. Due-year monitor ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariffs.due_year_alert (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id             UUID NOT NULL REFERENCES tariffs.licensee(id) ON DELETE CASCADE,
    regime                  TEXT NOT NULL CHECK (regime IN ('eskom', 'municipal')),
    missing_financial_year  TEXT NOT NULL CHECK (missing_financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    latest_published_fy     TEXT,
    checked_on              DATE NOT NULL,
    resolved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT due_year_alert_once UNIQUE (licensee_id, missing_financial_year)
);
ALTER TABLE tariffs.due_year_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.due_year_alert FORCE ROW LEVEL SECURITY;
CREATE POLICY due_year_alert_select ON tariffs.due_year_alert FOR SELECT TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
REVOKE ALL ON tariffs.due_year_alert FROM authenticated;
GRANT SELECT ON tariffs.due_year_alert TO authenticated;

-- Eskom years start 1 April, municipal 1 July. Only licensees the library has
-- ever published are watched (a never-ingested licensee is a backlog item, not
-- an alert). Resolves alerts whose licensee is now covered. Idempotent.
CREATE OR REPLACE FUNCTION tariffs.record_due_year_alerts(p_regime TEXT, p_on DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_start  INT;
    v_fy     TEXT;
    v_n      INT;
BEGIN
    IF p_regime IS NULL OR p_regime NOT IN ('eskom', 'municipal') THEN
        RAISE EXCEPTION 'tariffs.record_due_year_alerts: regime must be eskom or municipal' USING ERRCODE = '22023';
    END IF;
    v_start := extract(year FROM p_on)::int
             - CASE WHEN extract(month FROM p_on)::int < CASE WHEN p_regime = 'eskom' THEN 4 ELSE 7 END THEN 1 ELSE 0 END;
    v_fy := v_start::text || '/' || lpad(((v_start + 1) % 100)::text, 2, '0');

    UPDATE tariffs.due_year_alert a SET resolved_at = NOW()
     WHERE a.resolved_at IS NULL AND a.regime = p_regime
       AND EXISTS (SELECT 1 FROM tariffs.tariff_year y
                    WHERE y.licensee_id = a.licensee_id AND y.state = 'published'
                      AND y.effective_from <= p_on AND y.effective_to >= p_on);

    INSERT INTO tariffs.due_year_alert (licensee_id, regime, missing_financial_year, latest_published_fy, checked_on)
    SELECT l.id, p_regime, v_fy,
           (SELECT max(y.financial_year) FROM tariffs.tariff_year y
             WHERE y.licensee_id = l.id AND y.state IN ('published', 'superseded')),
           p_on
      FROM tariffs.licensee l
     WHERE (CASE WHEN p_regime = 'eskom' THEN l.kind = 'eskom' ELSE l.kind IN ('municipal', 'metro') END)
       AND EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.licensee_id = l.id AND y.state IN ('published', 'superseded'))
       AND NOT EXISTS (SELECT 1 FROM tariffs.tariff_year y
                        WHERE y.licensee_id = l.id AND y.state = 'published'
                          AND y.effective_from <= p_on AND y.effective_to >= p_on)
    ON CONFLICT (licensee_id, missing_financial_year) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- Service-only functions, spelled out per function (the repo-wide
-- anon-EXECUTE guard reads this TEXT and cannot see a dynamic REVOKE).
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM anon;
REVOKE ALL ON FUNCTION tariffs.claim_ingest_job() FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.claim_ingest_job() TO service_role;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM anon;
REVOKE ALL ON FUNCTION tariffs.year_content_fingerprint(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.year_content_fingerprint(uuid) TO service_role;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION tariffs.record_year_validation(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.record_year_validation(uuid, integer, text) TO service_role;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM anon;
REVOKE ALL ON FUNCTION tariffs.record_due_year_alerts(text, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION tariffs.record_due_year_alerts(text, date) TO service_role;

GRANT ALL ON tariffs.error_report, tariffs.ingest_job, tariffs.due_year_alert TO service_role;
REVOKE ALL ON tariffs.error_report, tariffs.ingest_job, tariffs.due_year_alert FROM anon;

NOTIFY pgrst, 'reload schema';
