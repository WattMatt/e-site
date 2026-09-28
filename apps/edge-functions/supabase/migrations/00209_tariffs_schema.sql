-- ---------------------------------------------------------------------------
-- Migration 00209: Tariff library schema (Solar Phase 2a)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §4; source reality in
-- docs/solar/as-is/09-nersa-tariff-source.md; decisions D-03 (E-Site runs the
-- library, a platform admin approves each year) and D-03b (read = orgs with an
-- active Solar subscription) in docs/solar/06-open-decisions.md.
--
-- WHAT. Platform reference data in a new exposed schema `tariffs`: licensee
-- (+ licensee_alias), source_document, tariff_year, tariff, charge,
-- tou_calendar, tou_window, holiday_rule, loss_factor, sseg_rule, ingest_run;
-- the private Storage bucket `tariff-sources`; the allow-list
-- public.platform_tariff_admins; two public helpers.
--
-- WHO.
--   PLATFORM TARIFF ADMIN: a row in public.platform_tariff_admins (owner
--     default 10, 2026-09-28: an explicit allow-list, NOT "every WM-Consulting
--     owner/admin"). The list is written by the service role only; a caller
--     may read their own row and nothing else. Seeded EMPTY.
--   READ: a platform tariff admin, or a caller active in ANY org with a live
--     Solar subscription. Subscribers see only published or superseded years
--     and the tariffs, charges, loss factors and SSEG rules under them (the
--     child policies go through the tariff_year policy). Drafts and ingest_run
--     are admin-only.
--   WRITE: platform tariff admins (per-verb PERMISSIVE policies) and the
--     service role (ingestion). Nobody else; no anon anywhere.
--
-- STATE MACHINE (tariffs.tariff_year_guard). INSERT lands in ingesting or
-- in_review. Legal moves: ingesting->in_review, in_review->ingesting,
-- in_review->published, published->superseded. Publishing needs >= 1 tariff,
-- a charge on every tariff and a review stamp on every inferred unit; it
-- stamps published_at/by (bound to the caller) and supersedes the licensee's
-- other published year. A back-filled OLDER year arrives as superseded.
-- IMMUTABILITY. A published/superseded year and every tariff, charge, loss
-- factor and SSEG rule under it cannot be inserted into, changed or deleted by
-- anyone, the service role included (triggers are not bypassed by BYPASSRLS).
-- Corrections are a new version through review.
--
-- DEPENDS ON 00207 (solar.org_subscription_active).
-- NEW SCHEMA CHECKLIST (00126): grants below (no anon), config.toml, AND the
-- production PostgREST db_schema PATCH at apply time (else PGRST002).
-- The "[mutation-probe Mn]" comments mark lines the red/green mutation runs
-- delete; they are inert.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: public.platform_tariff_admins
-- table: tariffs.licensee
-- table: tariffs.licensee_alias
-- table: tariffs.source_document
-- table: tariffs.tariff_year
-- table: tariffs.tariff
-- table: tariffs.charge
-- table: tariffs.tou_calendar
-- table: tariffs.tou_window
-- table: tariffs.holiday_rule
-- table: tariffs.loss_factor
-- table: tariffs.sseg_rule
-- table: tariffs.ingest_run
-- function: public.is_platform_tariff_admin()
-- function: public.caller_has_any_solar_org()
-- function: tariffs.tariff_year_guard()
-- function: tariffs.year_child_guard()
-- function: tariffs.charge_review_bind()
-- function: tariffs.source_document_guard()
-- trigger: tariff_year_guard ON tariffs.tariff_year
-- trigger: tariff_guard ON tariffs.tariff
-- trigger: charge_guard ON tariffs.charge
-- trigger: charge_review_bind ON tariffs.charge
-- trigger: loss_factor_guard ON tariffs.loss_factor
-- trigger: sseg_rule_guard ON tariffs.sseg_rule
-- trigger: source_document_guard ON tariffs.source_document
-- index: tariff_year_one_published ON tariffs.tariff_year
-- constraint: charge_unit_known ON tariffs.charge
-- constraint: charge_inference_explained ON tariffs.charge
-- constraint: licensee_alias_normalised ON tariffs.licensee_alias
-- constraint: tariff_year_financial_year_format ON tariffs.tariff_year
-- constraint: source_document_file_or_url ON tariffs.source_document
-- constraint: source_document_stored_file_hashed ON tariffs.source_document
-- policy: platform_tariff_admins_select_own ON public.platform_tariff_admins PERMISSIVE
-- policy: licensee_select ON tariffs.licensee PERMISSIVE
-- policy: licensee_alias_select ON tariffs.licensee_alias PERMISSIVE
-- policy: source_document_select ON tariffs.source_document PERMISSIVE
-- policy: tariff_year_select ON tariffs.tariff_year PERMISSIVE
-- policy: tariff_select ON tariffs.tariff PERMISSIVE
-- policy: charge_select ON tariffs.charge PERMISSIVE
-- policy: tou_calendar_select ON tariffs.tou_calendar PERMISSIVE
-- policy: tou_window_select ON tariffs.tou_window PERMISSIVE
-- policy: holiday_rule_select ON tariffs.holiday_rule PERMISSIVE
-- policy: loss_factor_select ON tariffs.loss_factor PERMISSIVE
-- policy: sseg_rule_select ON tariffs.sseg_rule PERMISSIVE
-- policy: ingest_run_select ON tariffs.ingest_run PERMISSIVE
-- policy: charge_insert ON tariffs.charge PERMISSIVE
-- policy: charge_update ON tariffs.charge PERMISSIVE
-- policy: charge_delete ON tariffs.charge PERMISSIVE
-- policy: tariff_year_update ON tariffs.tariff_year PERMISSIVE
-- grant_absent: anon SELECT ON public.platform_tariff_admins
-- grant_absent: authenticated INSERT ON public.platform_tariff_admins
-- grant_absent: authenticated UPDATE ON public.platform_tariff_admins
-- grant_absent: authenticated DELETE ON public.platform_tariff_admins
-- grant_absent: anon SELECT ON tariffs.licensee
-- grant_absent: anon SELECT ON tariffs.tariff_year
-- grant_absent: anon SELECT ON tariffs.charge
-- grant_absent: authenticated INSERT ON tariffs.ingest_run
-- grant_absent: anon EXECUTE ON public.is_platform_tariff_admin()
-- grant_absent: anon EXECUTE ON public.caller_has_any_solar_org()
-- anon_execute_absent: ALL prosecdef functions in tariffs
-- sql: (SELECT NOT has_schema_privilege('anon', 'tariffs', 'USAGE'))
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND c.relkind = 'r')
-- sql: (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'public.platform_tariff_admins'::regclass)
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'public.platform_tariff_admins'::regclass)
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND (p.polcmd = '*' OR NOT p.polpermissive))
-- sql: (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'tariff-sources' AND NOT public)
-- behaviour: scripts/db/assert-tariffs-schema-roles.sql — every row ok
-- @verify:end
--
-- The schema-wide sql: directives above are re-checked on EVERY later deploy:
--   * FORCE bool_and covers every table in schema tariffs, including any
--     future partition.
--   * no FOR ALL and no RESTRICTIVE policy anywhere in schema tariffs (a
--     RESTRICTIVE FOR ALL write gate narrows reads: the 00205 bug).
--   * public.platform_tariff_admins carries exactly ONE policy (select own
--     row): a second, client-write policy would let a caller self-promote.
-- A later migration must conform, or amend this block in the same PR and prove
-- the old directive under the new state (the 00204/00206 rule).

-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.

-- ── 0. Schema and grants (no anon) ──────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS tariffs;
GRANT USAGE ON SCHEMA tariffs TO authenticated, service_role;
REVOKE ALL ON SCHEMA tariffs FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariffs GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariffs GRANT ALL ON SEQUENCES TO service_role;

-- ── 1. The platform tariff admin allow-list and the helpers ────────────────
-- Owner default 10 (2026-09-28): an explicit allow-list, service-role writes
-- only. Seeded EMPTY; the first admin is added with the service key.
CREATE TABLE IF NOT EXISTS public.platform_tariff_admins (
    user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.platform_tariff_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_tariff_admins FORCE ROW LEVEL SECURITY;
-- The only client policy: a caller may see whether THEY are on the list.
CREATE POLICY platform_tariff_admins_select_own ON public.platform_tariff_admins
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.platform_tariff_admins FROM PUBLIC;
REVOKE ALL ON public.platform_tariff_admins FROM anon;
REVOKE ALL ON public.platform_tariff_admins FROM authenticated;
GRANT SELECT ON public.platform_tariff_admins TO authenticated;
GRANT ALL ON public.platform_tariff_admins TO service_role;

-- D-03: E-Site staff who may write the library = the allow-list.
CREATE OR REPLACE FUNCTION public.is_platform_tariff_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.platform_tariff_admins a
         WHERE a.user_id = auth.uid());                        -- [mutation-probe M4]
$$;

-- D-03b: the caller is active in at least one org with a live Solar
-- subscription (WM-Consulting counts, through the 00207 bypass).
CREATE OR REPLACE FUNCTION public.caller_has_any_solar_org()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.is_active
           AND solar.org_subscription_active(uo.organisation_id));
$$;

-- Spelled out per function: the repo-wide anon-EXECUTE guard reads this TEXT.
REVOKE ALL ON FUNCTION public.is_platform_tariff_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_tariff_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_tariff_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.caller_has_any_solar_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_has_any_solar_org() FROM anon;
GRANT EXECUTE ON FUNCTION public.caller_has_any_solar_org() TO authenticated, service_role;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariffs.licensee (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                TEXT NOT NULL CHECK (kind IN ('eskom', 'municipal', 'metro', 'private', 'development_agency', 'industrial_private')),
    name                TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
    mdb_code            TEXT UNIQUE,
    -- From the curated registry, NEVER from the source file (Sasol is filed under KZN).
    province            TEXT CHECK (province IN ('EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NW', 'NC', 'WC', 'national')),
    nersa_licence_no    TEXT,
    parent_licensee_id  UUID REFERENCES tariffs.licensee(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Misspelt / variant sheet names ("MODALE CITY", "CITY OF CAPE "), stored normalised.
CREATE TABLE IF NOT EXISTS tariffs.licensee_alias (
    alias        TEXT PRIMARY KEY
                   CONSTRAINT licensee_alias_normalised
                   CHECK (alias <> '' AND alias = upper(regexp_replace(btrim(alias), '\s+', ' ', 'g'))),
    licensee_id  UUID NOT NULL REFERENCES tariffs.licensee(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS licensee_alias_licensee_idx ON tariffs.licensee_alias (licensee_id);

CREATE TABLE IF NOT EXISTS tariffs.source_document (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL for a book covering many licensees (a NERSA province compendium).
    licensee_id     UUID REFERENCES tariffs.licensee(id),
    kind            TEXT NOT NULL CHECK (kind IN ('tariff_book', 'nersa_decision', 'eskom_schedule', 'rules', 'by_law')),
    title           TEXT NOT NULL,
    financial_year  TEXT CHECK (financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    status          TEXT NOT NULL CHECK (status IN ('draft', 'final', 'nersa_approved')),
    published_on    DATE,
    storage_path    TEXT UNIQUE,
    -- NULL only for a URL-only reference (owner default 8: the Eskom 2026/27
    -- increase page); a stored file always carries its hash.
    sha256          TEXT UNIQUE CONSTRAINT source_document_sha256_hex CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    page_count      INT CHECK (page_count > 0),
    url             TEXT,
    retrieved_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT source_document_file_or_url CHECK (sha256 IS NOT NULL OR url IS NOT NULL),
    CONSTRAINT source_document_stored_file_hashed CHECK (storage_path IS NULL OR sha256 IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS tariffs.tariff_year (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id            UUID NOT NULL REFERENCES tariffs.licensee(id),
    financial_year         TEXT NOT NULL CONSTRAINT tariff_year_financial_year_format CHECK (
                               CASE WHEN financial_year ~ '^[0-9]{4}/[0-9]{2}$'
                                    THEN right(financial_year, 2)::int = (left(financial_year, 4)::int + 1) % 100
                                    ELSE false END),
    effective_from         DATE NOT NULL,
    effective_to           DATE NOT NULL,
    approved_increase_pct  NUMERIC(6,3),
    source_document_id     UUID REFERENCES tariffs.source_document(id),
    state                  TEXT NOT NULL DEFAULT 'ingesting'
                             CHECK (state IN ('ingesting', 'in_review', 'published', 'superseded')),
    published_at           TIMESTAMPTZ,
    published_by           UUID REFERENCES auth.users(id),
    superseded_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tariff_year_licensee_fy UNIQUE (licensee_id, financial_year),
    CONSTRAINT tariff_year_effective_order CHECK (effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_published ON tariffs.tariff_year (licensee_id) WHERE state = 'published';  -- [mutation-probe M3]

CREATE TABLE IF NOT EXISTS tariffs.tariff (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_year_id         UUID NOT NULL REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    code                   TEXT,
    name                   TEXT NOT NULL CHECK (btrim(name) <> ''),
    family                 TEXT,
    category               TEXT NOT NULL DEFAULT 'other' CHECK (category IN
                             ('domestic', 'commercial', 'industrial', 'agricultural', 'bulk', 'public_lighting', 'sseg', 'wheeling', 'other')),
    metering               TEXT NOT NULL DEFAULT 'both' CHECK (metering IN ('prepaid', 'conventional', 'both', 'unmetered')),
    structure              TEXT NOT NULL CHECK (structure IN ('flat', 'ibt', 'seasonal', 'seasonal_ibt', 'tou', 'tou_ibt')),
    voltage_band           TEXT,
    phase                  TEXT CHECK (phase IN ('single', 'three')),
    transmission_zone      SMALLINT CHECK (transmission_zone BETWEEN 0 AND 3),
    local_authority        BOOLEAN NOT NULL DEFAULT false,
    min_amps               NUMERIC(10,2),
    max_amps               NUMERIC(10,2),
    min_kva                NUMERIC(12,2),
    max_kva                NUMERIC(12,2),
    eligibility            JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Eskom's export credit is a separate tariff (Homeflex -> Gen-Offset Homeflex).
    export_tariff_id       UUID REFERENCES tariffs.tariff(id) ON DELETE SET NULL,
    predecessor_tariff_id  UUID REFERENCES tariffs.tariff(id) ON DELETE SET NULL,
    is_legacy              BOOLEAN NOT NULL DEFAULT false,
    notes                  TEXT,
    source_locator         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tariff_year_name UNIQUE (tariff_year_id, name)
);

CREATE TABLE IF NOT EXISTS tariffs.charge (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id           UUID NOT NULL REFERENCES tariffs.tariff(id) ON DELETE CASCADE,
    component           TEXT NOT NULL CHECK (component IN
                          ('energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
                           'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
                           'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other')),
    season              TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou                 TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    day_type            TEXT NOT NULL DEFAULT 'all' CHECK (day_type IN ('all', 'weekday', 'saturday', 'sunday')),
    block_min_kwh       NUMERIC(14,3),
    block_max_kwh       NUMERIC(14,3),
    block_basis         TEXT CHECK (block_basis IN ('monthly', 'daily')),
    unit                TEXT NOT NULL CONSTRAINT charge_unit_known CHECK (unit IN
                          ('c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
                           'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct')),
    demand_basis        TEXT CHECK (demand_basis IN ('nmd', 'actual_md', 'peak_window_md', 'utilised_capacity')),
    amount_excl_vat     NUMERIC(14,6) NOT NULL,
    vat_rate            NUMERIC(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
    vat_basis           TEXT NOT NULL CHECK (vat_basis IN ('stated_excl', 'assumed_excl', 'stated_incl')),
    -- Source units are wrong or absent often (Buffalo City, Gamagara, Ekurhuleni):
    -- an inferred unit is never silent.
    unit_inferred       BOOLEAN NOT NULL DEFAULT false,
    inference_reason    TEXT,
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    source_locator      JSONB NOT NULL DEFAULT '{}'::jsonb,
    extraction_method   TEXT NOT NULL CHECK (extraction_method IN ('parser', 'ai', 'manual')),
    reviewed_by         UUID REFERENCES auth.users(id),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT charge_inference_explained CHECK (unit_inferred = (inference_reason IS NOT NULL)),
    CONSTRAINT charge_block_order CHECK (block_max_kwh IS NULL OR (block_min_kwh IS NOT NULL AND block_max_kwh > block_min_kwh)),
    CONSTRAINT charge_block_basis_with_block CHECK ((block_min_kwh IS NULL) = (block_basis IS NULL))
);
CREATE INDEX IF NOT EXISTS charge_tariff_idx ON tariffs.charge (tariff_id);

CREATE TABLE IF NOT EXISTS tariffs.tou_calendar (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id         UUID NOT NULL REFERENCES tariffs.licensee(id),
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    high_season_months  INT[] NOT NULL CHECK (high_season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]),
    -- Municipal books state seasons, never hours: their calendars are assumed_eskom.
    source              TEXT NOT NULL CHECK (source IN ('published', 'assumed_eskom')),
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tou_calendar_valid_order CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS tariffs.tou_window (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id   UUID NOT NULL REFERENCES tariffs.tou_calendar(id) ON DELETE CASCADE,
    season        TEXT NOT NULL CHECK (season IN ('high', 'low')),
    day_type      TEXT NOT NULL CHECK (day_type IN ('weekday', 'saturday', 'sunday')),
    start_minute  INT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute    INT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    period        TEXT NOT NULL CHECK (period IN ('peak', 'standard', 'off_peak')),
    CONSTRAINT tou_window_order CHECK (end_minute > start_minute)
);

-- Holiday DATES come from projects.public_holidays (00194); this says how one is treated.
CREATE TABLE IF NOT EXISTS tariffs.holiday_rule (
    calendar_id  UUID PRIMARY KEY REFERENCES tariffs.tou_calendar(id) ON DELETE CASCADE,
    treated_as   TEXT NOT NULL CHECK (treated_as IN ('saturday', 'sunday'))
);

-- Eskom publishes these as a table per tariff year, not as a charge.
CREATE TABLE IF NOT EXISTS tariffs.loss_factor (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id        UUID NOT NULL REFERENCES tariffs.licensee(id),
    tariff_year_id     UUID NOT NULL REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    kind               TEXT NOT NULL CHECK (kind IN ('dx_urban', 'dx_rural', 'tx')),
    voltage_band       TEXT,
    transmission_zone  SMALLINT CHECK (transmission_zone BETWEEN 0 AND 3),
    factor             NUMERIC(8,5) NOT NULL CHECK (factor >= 1 AND factor < 2),
    source_locator     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT loss_factor_zone_for_tx CHECK ((kind = 'tx') = (transmission_zone IS NOT NULL))
);

-- NERSA Net-Billing Rules (17 Dec 2024) pp7-12, per licensee year.
CREATE TABLE IF NOT EXISTS tariffs.sseg_rule (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id                   UUID NOT NULL REFERENCES tariffs.licensee(id),
    tariff_year_id                UUID NOT NULL UNIQUE REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    crediting                     TEXT NOT NULL CHECK (crediting IN ('net_billing_tou', 'net_billing_flat', 'none')),
    settlement_period             TEXT NOT NULL DEFAULT 'monthly' CHECK (settlement_period = 'monthly'),
    carry_forward                 TEXT NOT NULL CHECK (carry_forward IN ('none', 'within_financial_year')),
    fy_end_month                  SMALLINT NOT NULL CHECK (fy_end_month BETWEEN 1 AND 12),
    cap_rule                      TEXT NOT NULL CHECK (cap_rule IN ('kwh_per_tou_period', 'value_per_tou_period', 'energy_charges')),
    offsets                       TEXT NOT NULL DEFAULT 'energy_only' CHECK (offsets = 'energy_only'),
    forfeit_on_ownership_change   BOOLEAN NOT NULL DEFAULT true,
    max_kva                       NUMERIC(10,2) NOT NULL DEFAULT 1000 CHECK (max_kva > 0),
    requires_tou                  BOOLEAN NOT NULL DEFAULT true,
    requires_bidirectional_meter  BOOLEAN NOT NULL DEFAULT true,
    source_document_id            UUID REFERENCES tariffs.source_document(id),
    locator                       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tariffs.ingest_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    parser              TEXT NOT NULL CHECK (parser IN ('province_xlsx', 'eskom_xlsm', 'rfd_pdf')),
    status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    stats               JSONB NOT NULL DEFAULT '{}'::jsonb,
    diff                JSONB NOT NULL DEFAULT '{}'::jsonb,
    error               TEXT,
    started_by          UUID REFERENCES auth.users(id),
    at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ
);

-- ── 3. Triggers ─────────────────────────────────────────────────────────────
-- All INVOKER (none is SECURITY DEFINER): they read only rows the caller may
-- already read, and a parent a caller cannot see is left to RLS to refuse.
CREATE OR REPLACE FUNCTION tariffs.tariff_year_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_n INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.state IN ('published', 'superseded') THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: a % year cannot be deleted', OLD.id, OLD.state
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.state NOT IN ('ingesting', 'in_review') THEN
            RAISE EXCEPTION 'tariffs.tariff_year: a new year starts in ingesting or in_review, not %', NEW.state
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := NULL;
        NEW.published_by := NULL;
        NEW.superseded_at := NULL;
        RETURN NEW;
    END IF;

    -- UPDATE of a published or superseded year: only published -> superseded,
    -- with every other fact unchanged.
    IF OLD.state IN ('published', 'superseded') THEN
        IF NOT (OLD.state = 'published' AND NEW.state = 'superseded'
                AND NEW.licensee_id = OLD.licensee_id
                AND NEW.financial_year = OLD.financial_year
                AND NEW.effective_from = OLD.effective_from
                AND NEW.effective_to = OLD.effective_to
                AND NEW.approved_increase_pct IS NOT DISTINCT FROM OLD.approved_increase_pct
                AND NEW.source_document_id IS NOT DISTINCT FROM OLD.source_document_id
                AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
                AND NEW.published_by IS NOT DISTINCT FROM OLD.published_by) THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: a % year is immutable; correct it through a new version', OLD.id, OLD.state
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.superseded_at := now();
        RETURN NEW;
    END IF;

    IF NEW.state = OLD.state THEN
        NEW.published_at := NULL;
        NEW.published_by := NULL;
        RETURN NEW;
    END IF;

    IF NOT ((OLD.state = 'ingesting' AND NEW.state = 'in_review')
            OR (OLD.state = 'in_review' AND NEW.state = 'ingesting')
            OR (OLD.state = 'in_review' AND NEW.state = 'published')) THEN
        RAISE EXCEPTION 'tariffs.tariff_year %: % -> % is not a legal transition', OLD.id, OLD.state, NEW.state
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state = 'published' THEN
        SELECT count(*) INTO v_n FROM tariffs.tariff t WHERE t.tariff_year_id = NEW.id;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: nothing to publish (no tariffs)', NEW.id USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_n FROM tariffs.tariff t
         WHERE t.tariff_year_id = NEW.id AND NOT EXISTS (SELECT 1 FROM tariffs.charge c WHERE c.tariff_id = t.id);
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % tariff(s) have no charges', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_n FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id
         WHERE t.tariff_year_id = NEW.id AND c.unit_inferred AND c.reviewed_at IS NULL;
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % inferred unit(s) not reviewed', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := now();
        NEW.published_by := auth.uid();
        IF EXISTS (SELECT 1 FROM tariffs.tariff_year y
                    WHERE y.licensee_id = NEW.licensee_id AND y.id <> NEW.id
                      AND y.state = 'published' AND y.financial_year > NEW.financial_year) THEN
            -- A back-filled older year is history on arrival.
            NEW.state := 'superseded';
            NEW.superseded_at := now();
        ELSE
            NULL;
            -- [mutation-probe M3:begin]
            UPDATE tariffs.tariff_year SET state = 'superseded'
             WHERE licensee_id = NEW.licensee_id AND id <> NEW.id AND state = 'published';
            -- [mutation-probe M3:end]
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tariffs.year_child_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_years  UUID[] := ARRAY[]::UUID[];
    v_year   UUID;
    v_state  TEXT;
    v_lic    UUID;
BEGIN
    IF TG_TABLE_NAME = 'charge' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_years := v_years || (SELECT t.tariff_year_id FROM tariffs.tariff t WHERE t.id = OLD.tariff_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_years := v_years || (SELECT t.tariff_year_id FROM tariffs.tariff t WHERE t.id = NEW.tariff_id);
        END IF;
    ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_years := v_years || OLD.tariff_year_id; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_years := v_years || NEW.tariff_year_id; END IF;
    END IF;

    FOREACH v_year IN ARRAY v_years LOOP
        CONTINUE WHEN v_year IS NULL;   -- parent invisible to this caller: RLS decides
        SELECT y.state, y.licensee_id INTO v_state, v_lic FROM tariffs.tariff_year y WHERE y.id = v_year;
        IF v_state IN ('published', 'superseded') THEN
            RAISE EXCEPTION 'tariffs.%: tariff year % is %; published tariff data is immutable (correct it through a new version)',
                TG_TABLE_NAME, v_year, v_state USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- Loss factors and SSEG rules belong to their year's licensee, whatever was sent.
    IF TG_TABLE_NAME IN ('loss_factor', 'sseg_rule') AND v_lic IS NOT NULL THEN
        NEW.licensee_id := v_lic;
    END IF;
    RETURN NEW;
END $$;

-- A review stamp is the caller and now; a reviewed fact that changes loses it.
CREATE OR REPLACE FUNCTION tariffs.charge_review_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.unit, NEW.amount_excl_vat, NEW.unit_inferred) IS DISTINCT FROM (OLD.unit, OLD.amount_excl_vat, OLD.unit_inferred) THEN
        NEW.reviewed_at := NULL;
        NEW.reviewed_by := NULL;
    ELSIF TG_OP = 'UPDATE' AND OLD.reviewed_at IS NOT NULL THEN
        NEW.reviewed_at := OLD.reviewed_at;
        NEW.reviewed_by := OLD.reviewed_by;
    ELSIF NEW.reviewed_at IS NOT NULL THEN
        NEW.reviewed_at := now();
        NEW.reviewed_by := auth.uid();
    ELSE
        NEW.reviewed_by := NULL;
    END IF;
    RETURN NEW;
END $$;

-- The file a row points at never changes under it.
CREATE OR REPLACE FUNCTION tariffs.source_document_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF (OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256)
       OR (OLD.storage_path IS NOT NULL AND NEW.storage_path IS DISTINCT FROM OLD.storage_path) THEN
        RAISE EXCEPTION 'tariffs.source_document %: sha256 and storage_path are fixed once set', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tariff_year_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.tariff_year
    FOR EACH ROW EXECUTE FUNCTION tariffs.tariff_year_guard();
CREATE TRIGGER tariff_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.tariff
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER charge_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.charge FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();  -- [mutation-probe M1]
CREATE TRIGGER charge_review_bind BEFORE INSERT OR UPDATE ON tariffs.charge
    FOR EACH ROW EXECUTE FUNCTION tariffs.charge_review_bind();
CREATE TRIGGER loss_factor_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.loss_factor
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER sseg_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.sseg_rule
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER source_document_guard BEFORE UPDATE ON tariffs.source_document
    FOR EACH ROW EXECUTE FUNCTION tariffs.source_document_guard();
CREATE TRIGGER licensee_updated_at BEFORE UPDATE ON tariffs.licensee
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tariff_year_updated_at BEFORE UPDATE ON tariffs.tariff_year
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tariff_updated_at BEFORE UPDATE ON tariffs.tariff
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. RLS: ENABLE + FORCE everywhere, per-verb PERMISSIVE policies ─────────
ALTER TABLE tariffs.licensee        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee        FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee_alias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee_alias  FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.source_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.source_document FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff_year     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff_year     FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff          FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.charge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.charge          FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_calendar    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_calendar    FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_window      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_window      FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.holiday_rule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.holiday_rule    FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.loss_factor     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.loss_factor     FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.sseg_rule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.sseg_rule       FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_run      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_run      FORCE ROW LEVEL SECURITY;

-- Reference tables: any reader (admin, or active in a subscribed org).
CREATE POLICY licensee_select ON tariffs.licensee FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY licensee_alias_select ON tariffs.licensee_alias FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY source_document_select ON tariffs.source_document FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY tou_calendar_select ON tariffs.tou_calendar FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY tou_window_select ON tariffs.tou_window FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY holiday_rule_select ON tariffs.holiday_rule FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));

-- Years: drafts are admin-only.
CREATE POLICY tariff_year_select ON tariffs.tariff_year FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())
           OR ((SELECT public.caller_has_any_solar_org()) AND state IN ('published', 'superseded')));  -- [mutation-probe M2]

-- Everything under a year inherits the year's visibility (the subquery is itself under RLS).
CREATE POLICY tariff_select ON tariffs.tariff FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = tariff.tariff_year_id));
CREATE POLICY charge_select ON tariffs.charge FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff t WHERE t.id = charge.tariff_id));
CREATE POLICY loss_factor_select ON tariffs.loss_factor FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = loss_factor.tariff_year_id));
CREATE POLICY sseg_rule_select ON tariffs.sseg_rule FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = sseg_rule.tariff_year_id));

CREATE POLICY ingest_run_select ON tariffs.ingest_run FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()));

-- Writes: platform tariff admins only, one policy per verb.
CREATE POLICY licensee_insert ON tariffs.licensee FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_update ON tariffs.licensee FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_delete ON tariffs.licensee FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_insert ON tariffs.licensee_alias FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_update ON tariffs.licensee_alias FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_delete ON tariffs.licensee_alias FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_insert ON tariffs.source_document FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_update ON tariffs.source_document FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_delete ON tariffs.source_document FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_insert ON tariffs.tariff_year FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_update ON tariffs.tariff_year FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_delete ON tariffs.tariff_year FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_insert ON tariffs.tariff FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_update ON tariffs.tariff FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_delete ON tariffs.tariff FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_insert ON tariffs.charge FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_update ON tariffs.charge FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_delete ON tariffs.charge FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_insert ON tariffs.tou_calendar FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_update ON tariffs.tou_calendar FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_delete ON tariffs.tou_calendar FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_insert ON tariffs.tou_window FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_update ON tariffs.tou_window FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_delete ON tariffs.tou_window FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_insert ON tariffs.holiday_rule FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_update ON tariffs.holiday_rule FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_delete ON tariffs.holiday_rule FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_insert ON tariffs.loss_factor FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_update ON tariffs.loss_factor FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_delete ON tariffs.loss_factor FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_insert ON tariffs.sseg_rule FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_update ON tariffs.sseg_rule FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_delete ON tariffs.sseg_rule FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
-- ingest_run: no authenticated write policy; the ingestion script uses the service role.

GRANT SELECT, INSERT, UPDATE, DELETE ON
    tariffs.licensee, tariffs.licensee_alias, tariffs.source_document, tariffs.tariff_year, tariffs.tariff,
    tariffs.charge, tariffs.tou_calendar, tariffs.tou_window, tariffs.holiday_rule, tariffs.loss_factor, tariffs.sseg_rule
    TO authenticated;
GRANT SELECT ON tariffs.ingest_run TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA tariffs TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA tariffs FROM anon;

-- ── 5. Private source bucket (service role only; no storage.objects policy) ─
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tariff-sources', 'tariff-sources', false, 52428800,
        ARRAY['application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel.sheet.macroEnabled.12'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
