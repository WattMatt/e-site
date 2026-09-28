-- ---------------------------------------------------------------------------
-- Migration 00214: Solar schematics (Phase 3b) — and the Load tab's remaining storage
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/01-functional-spec.md §4.3-§4.6, §13; docs/solar/03-data-model-and-security.md §3, §3.1, §5.
-- Plan: docs/superpowers/plans/2026-09-28-solar-phase-3b-0-foundation.md
--
-- WHAT.
--   solar.schematics, solar.schematic_cards, solar.schematic_lines — meters placed on the site's
--     single-line diagrams and the supply hierarchy between them. A schematic is anchored to a
--     drawing page like tenants.floor_plan_markups (file_path + source_revision_id stamped by
--     trigger); cards and lines denormalise floor_plan_id so cloud-sync-project's isAnnotated()
--     sees them (registered there in the same PR; edge deploy AFTER this applies).
--   solar.load_check_acks — "Mark as acknowledged" on Load -> Checks (append/delete only).
--   solar.studies gains load_growth_pct, monthly_bills (basis S4 input), schematic_waived.
--   solar.channel_readings / solar.channel_summaries — SECURITY INVOKER bulk reads, because
--     PostgREST caps a response at 1,000 rows and a meter holds 17,520 readings a year.
--   public.solar_save_schematic — replace-all save in one transaction; stale write = 40001.
--   public.user_can_read_report_kind — redefined IN FULL: 00183's branches + solar_layout_sheet
--     (00211) + solar_schematic_sheet, both at Solar View.
--   public.product_events CHECK — deliberately NOT touched. The Solar Load/Schematics
--     product-event verbs are NOT added here (owner decision 2026-09-29): another branch
--     re-declares the same CHECK in full, and two full re-declarations race on apply order.
--     Saves and exports are recorded as Solar audit events only.
--
-- ACCESS. Every table has the 00207 study shape: SELECT = solar_can_view(project_id); each write verb
--   = a PERMISSIVE policy on solar_can_view plus a RESTRICTIVE policy on solar_can_edit. Lapse =
--   hidden but kept. The supply hierarchy may never contain a loop (refused by the line bind).
--
-- 00207's schema-wide @verify directives re-run on every deploy and this migration conforms: every
-- table has FORCE RLS; no RESTRICTIVE policy covers SELECT; every SECURITY DEFINER function in solar
-- has anon EXECUTE revoked.
--
-- DRAWING FK = NO ACTION (as solar.roof_sources): a drawing that anchors a schematic cannot be hard-
-- deleted under it. Project deletion still works: the project cascade removes the study, and with
-- it the schematic, in the same statement.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.schematics
-- table: solar.schematic_cards
-- table: solar.schematic_lines
-- table: solar.load_check_acks
-- column: solar.studies.load_growth_pct
-- column: solar.studies.monthly_bills
-- column: solar.studies.schematic_waived
-- column: solar.schematic_cards.floor_plan_id
-- column: solar.schematic_lines.floor_plan_id
-- constraint: schematics_shape ON solar.schematics
-- constraint: schematic_cards_one_per_meter ON solar.schematic_cards
-- constraint: schematic_lines_not_self ON solar.schematic_lines
-- constraint: schematic_lines_waypoints ON solar.schematic_lines
-- constraint: load_check_acks_key ON solar.load_check_acks
-- function: solar.schematics_bind()
-- function: solar.schematics_propagate_anchor()
-- function: solar.schematic_cards_bind()
-- function: solar.schematic_cards_cascade_lines()
-- function: solar.schematic_lines_bind()
-- function: solar.load_check_acks_stamp()
-- function: solar.channel_readings(uuid[], timestamptz, timestamptz)
-- function: solar.channel_summaries(uuid[])
-- function: public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- trigger: schematics_bind ON solar.schematics
-- trigger: schematics_propagate_anchor ON solar.schematics
-- trigger: schematic_cards_bind ON solar.schematic_cards
-- trigger: schematic_cards_cascade_lines ON solar.schematic_cards
-- trigger: schematic_lines_bind ON solar.schematic_lines
-- trigger: load_check_acks_bind ON solar.load_check_acks
-- trigger: load_check_acks_stamp ON solar.load_check_acks
-- index: schematic_cards_floor_plan_idx ON solar.schematic_cards
-- index: schematic_lines_floor_plan_idx ON solar.schematic_lines
-- index: schematics_floor_plan_idx ON solar.schematics
-- policy: schematics_select ON solar.schematics PERMISSIVE
-- policy: schematics_insert ON solar.schematics PERMISSIVE
-- policy: schematics_update ON solar.schematics PERMISSIVE
-- policy: schematics_delete ON solar.schematics PERMISSIVE
-- policy: schematics_insert_authz ON solar.schematics RESTRICTIVE
-- policy: schematics_update_authz ON solar.schematics RESTRICTIVE
-- policy: schematics_delete_authz ON solar.schematics RESTRICTIVE
-- policy: schematic_cards_select ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_insert ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_update ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_delete ON solar.schematic_cards PERMISSIVE
-- policy: schematic_cards_insert_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_cards_update_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_cards_delete_authz ON solar.schematic_cards RESTRICTIVE
-- policy: schematic_lines_select ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_insert ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_update ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_delete ON solar.schematic_lines PERMISSIVE
-- policy: schematic_lines_insert_authz ON solar.schematic_lines RESTRICTIVE
-- policy: schematic_lines_update_authz ON solar.schematic_lines RESTRICTIVE
-- policy: schematic_lines_delete_authz ON solar.schematic_lines RESTRICTIVE
-- policy: load_check_acks_select ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_insert ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_delete ON solar.load_check_acks PERMISSIVE
-- policy: load_check_acks_insert_authz ON solar.load_check_acks RESTRICTIVE
-- policy: load_check_acks_delete_authz ON solar.load_check_acks RESTRICTIVE
-- grant_absent: anon SELECT ON solar.schematics
-- grant_absent: anon SELECT ON solar.schematic_cards
-- grant_absent: anon SELECT ON solar.schematic_lines
-- grant_absent: anon SELECT ON solar.load_check_acks
-- grant_absent: authenticated UPDATE ON solar.load_check_acks
-- grant_absent: anon EXECUTE ON solar.channel_readings(uuid[], timestamptz, timestamptz)
-- grant_absent: anon EXECUTE ON solar.channel_summaries(uuid[])
-- grant_absent: anon EXECUTE ON public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- grant_present: authenticated EXECUTE ON solar.channel_readings(uuid[], timestamptz, timestamptz)
-- grant_present: authenticated EXECUTE ON public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)
-- grant_absent: anon EXECUTE ON public.user_can_read_report_kind(uuid, text)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.channel_readings(uuid[], timestamptz, timestamptz)'::regprocedure)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.channel_summaries(uuid[])'::regprocedure)
-- sql: (SELECT NOT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.solar_save_schematic(uuid, timestamptz, jsonb, jsonb)'::regprocedure)
-- sql: (SELECT strpos(pg_get_functiondef('public.user_can_read_report_kind(uuid, text)'::regprocedure), 'solar_schematic_sheet') > 0 AND strpos(pg_get_functiondef('public.user_can_read_report_kind(uuid, text)'::regprocedure), 'solar_layout_sheet') > 0)
-- behaviour: scripts/db/assert-solar-schematics-roles.sql - every row ok
-- @verify:end

-- NO BEGIN/COMMIT (scripts/db/dry-run-migration.sh wraps this file in BEGIN ... ROLLBACK).

-- ── 0. solar.studies: the rest of the Load settings, and the schematic waiver ──
ALTER TABLE solar.studies
    ADD COLUMN IF NOT EXISTS load_growth_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (load_growth_pct BETWEEN -20 AND 20),
    ADD COLUMN IF NOT EXISTS monthly_bills    JSONB CHECK (monthly_bills IS NULL OR jsonb_typeof(monthly_bills) = 'object'),
    ADD COLUMN IF NOT EXISTS schematic_waived BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. Schematics ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    name                TEXT NOT NULL,
    description         TEXT CHECK (description IS NULL OR length(description) <= 2000),
    kind                TEXT NOT NULL CHECK (kind IN ('drawing', 'blank')),
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),   -- NO ACTION, see header
    page_index          INTEGER NOT NULL DEFAULT 1 CHECK (page_index >= 1),
    /* The file the sheet was when it was chosen. Stamped from the drawing by the bind trigger and
       compared on open (00205 pattern): a difference raises "positions may need adjusting". */
    file_path           TEXT,
    source_revision_id  TEXT,
    canvas_w            INTEGER NOT NULL DEFAULT 2400 CHECK (canvas_w BETWEEN 200 AND 20000),
    canvas_h            INTEGER NOT NULL DEFAULT 1600 CHECK (canvas_h BETWEEN 200 AND 20000),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematics_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT schematics_shape CHECK (
        (kind = 'drawing' AND floor_plan_id IS NOT NULL AND file_path IS NOT NULL)
        OR (kind = 'blank' AND floor_plan_id IS NULL AND file_path IS NULL AND source_revision_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS schematics_study_name_key ON solar.schematics (study_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS schematics_floor_plan_idx ON solar.schematics (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematics_project_idx ON solar.schematics (project_id);

CREATE OR REPLACE FUNCTION solar.schematics_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_restamp    BOOLEAN;
    v_fp_project UUID;
    v_fp_path    TEXT;
    v_fp_rev     TEXT;
    v_fp_active  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
            RAISE EXCEPTION 'solar.schematics: a schematic cannot move to another study or change kind' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
        v_restamp := NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id OR NEW.page_index IS DISTINCT FROM OLD.page_index;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.schematics: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
        v_restamp := TRUE;
    END IF;
    IF NEW.kind = 'drawing' THEN
        IF v_restamp THEN
            SELECT fp.project_id, fp.file_path, fp.source_revision_id, fp.is_active
              INTO v_fp_project, v_fp_path, v_fp_rev, v_fp_active
              FROM tenants.floor_plans fp WHERE fp.id = NEW.floor_plan_id;
            IF v_fp_project IS NULL OR v_fp_project <> NEW.project_id THEN
                RAISE EXCEPTION 'solar.schematics: the drawing belongs to another project' USING ERRCODE = '23514';
            END IF;
            IF NOT v_fp_active THEN
                RAISE EXCEPTION 'solar.schematics: the drawing is no longer active' USING ERRCODE = '23514';
            END IF;
            NEW.file_path := v_fp_path;
            NEW.source_revision_id := v_fp_rev;
        ELSE
            NEW.file_path := OLD.file_path;
            NEW.source_revision_id := OLD.source_revision_id;
        END IF;
    ELSE
        NEW.floor_plan_id := NULL;
        NEW.file_path := NULL;
        NEW.source_revision_id := NULL;
        NEW.page_index := 1;
    END IF;
    NEW.name := btrim(NEW.name);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematics_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematics_bind() FROM anon;
CREATE TRIGGER schematics_bind BEFORE INSERT OR UPDATE ON solar.schematics
    FOR EACH ROW EXECUTE FUNCTION solar.schematics_bind();

-- Replace drawing: every card and line follows the schematic to the new sheet (positions kept).
CREATE OR REPLACE FUNCTION solar.schematics_propagate_anchor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE solar.schematic_cards c SET floor_plan_id = NEW.floor_plan_id
     WHERE c.schematic_id = NEW.id AND c.floor_plan_id IS DISTINCT FROM NEW.floor_plan_id;
    UPDATE solar.schematic_lines l SET floor_plan_id = NEW.floor_plan_id
     WHERE l.schematic_id = NEW.id AND l.floor_plan_id IS DISTINCT FROM NEW.floor_plan_id;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.schematics_propagate_anchor() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematics_propagate_anchor() FROM anon;

-- ── 2. Meter cards ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematic_cards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schematic_id     UUID NOT NULL REFERENCES solar.schematics(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    /* Denormalised from the schematic by the bind trigger, never trusted from the caller:
       cloud-sync-project's isAnnotated() looks the drawing up here. */
    floor_plan_id    UUID REFERENCES tenants.floor_plans(id),        -- NO ACTION, see header
    meter_id         UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    x                NUMERIC NOT NULL,
    y                NUMERIC NOT NULL,
    w                NUMERIC NOT NULL CHECK (w > 0 AND w <= 5000),
    h                NUMERIC NOT NULL CHECK (h > 0 AND h <= 5000),
    colour           TEXT CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematic_cards_one_per_meter UNIQUE (schematic_id, meter_id)
);
CREATE INDEX IF NOT EXISTS schematic_cards_floor_plan_idx ON solar.schematic_cards (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematic_cards_meter_idx ON solar.schematic_cards (meter_id);

CREATE OR REPLACE FUNCTION solar.schematic_cards_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_study UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.schematic_id IS DISTINCT FROM OLD.schematic_id OR NEW.meter_id IS DISTINCT FROM OLD.meter_id) THEN
        RAISE EXCEPTION 'solar.schematic_cards: a card stays on its schematic and its meter' USING ERRCODE = '42501';
    END IF;
    SELECT s.study_id, s.project_id, s.organisation_id, s.floor_plan_id
      INTO v_study, NEW.project_id, NEW.organisation_id, NEW.floor_plan_id
      FROM solar.schematics s WHERE s.id = NEW.schematic_id;
    IF v_study IS NULL THEN
        RAISE EXCEPTION 'solar.schematic_cards: schematic % not found', NEW.schematic_id USING ERRCODE = '23503';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM solar.study_meters sm WHERE sm.study_id = v_study AND sm.meter_id = NEW.meter_id) THEN
        RAISE EXCEPTION 'solar.schematic_cards: only a meter of this study can be placed' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_cards_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_cards_bind() FROM anon;
CREATE TRIGGER schematic_cards_bind BEFORE INSERT OR UPDATE ON solar.schematic_cards
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_cards_bind();

-- ── 3. Supply lines (the meter hierarchy) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schematic_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schematic_id     UUID NOT NULL REFERENCES solar.schematics(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    floor_plan_id    UUID REFERENCES tenants.floor_plans(id),        -- NO ACTION, see header
    from_meter_id    UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    to_meter_id      UUID NOT NULL REFERENCES solar.meters(id) ON DELETE CASCADE,
    /* Flat [x1, y1, x2, y2, ...] in drawing-image pixels; endpoints are the cards' live anchors. */
    waypoints        JSONB NOT NULL DEFAULT '[]'::jsonb,
    line_type        TEXT NOT NULL DEFAULT 'supply' CHECK (line_type IN ('supply', 'check')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schematic_lines_not_self CHECK (from_meter_id <> to_meter_id),
    CONSTRAINT schematic_lines_waypoints CHECK (jsonb_typeof(waypoints) = 'array'
        AND jsonb_array_length(waypoints) <= 400 AND jsonb_array_length(waypoints) % 2 = 0),
    CONSTRAINT schematic_lines_pair_key UNIQUE (schematic_id, from_meter_id, to_meter_id, line_type)
);
CREATE INDEX IF NOT EXISTS schematic_lines_floor_plan_idx ON solar.schematic_lines (floor_plan_id);
CREATE INDEX IF NOT EXISTS schematic_lines_project_idx ON solar.schematic_lines (project_id);

CREATE OR REPLACE FUNCTION solar.schematic_lines_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_study UUID;
    v_n     INTEGER;
    v_loop  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.schematic_id IS DISTINCT FROM OLD.schematic_id THEN
        RAISE EXCEPTION 'solar.schematic_lines: a line stays on its schematic' USING ERRCODE = '42501';
    END IF;
    SELECT s.study_id, s.project_id, s.organisation_id, s.floor_plan_id
      INTO v_study, NEW.project_id, NEW.organisation_id, NEW.floor_plan_id
      FROM solar.schematics s WHERE s.id = NEW.schematic_id;
    IF v_study IS NULL THEN
        RAISE EXCEPTION 'solar.schematic_lines: schematic % not found', NEW.schematic_id USING ERRCODE = '23503';
    END IF;
    SELECT count(*) INTO v_n FROM solar.schematic_cards c
     WHERE c.schematic_id = NEW.schematic_id AND c.meter_id IN (NEW.from_meter_id, NEW.to_meter_id);
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'solar.schematic_lines: both meters must be placed on this schematic' USING ERRCODE = '23514';
    END IF;
    IF NEW.line_type = 'supply' THEN
        -- A supply line may not close a loop anywhere in the study: the hierarchy must stay acyclic.
        WITH RECURSIVE down(m) AS (
            SELECT l.to_meter_id FROM solar.schematic_lines l JOIN solar.schematics s ON s.id = l.schematic_id
             WHERE s.study_id = v_study AND l.line_type = 'supply' AND l.from_meter_id = NEW.to_meter_id
               AND l.id IS DISTINCT FROM NEW.id
            UNION
            SELECT l.to_meter_id FROM solar.schematic_lines l JOIN solar.schematics s ON s.id = l.schematic_id
              JOIN down d ON l.from_meter_id = d.m
             WHERE s.study_id = v_study AND l.line_type = 'supply' AND l.id IS DISTINCT FROM NEW.id
        )
        SELECT EXISTS (SELECT 1 FROM down WHERE m = NEW.from_meter_id) INTO v_loop;
        IF v_loop THEN
            RAISE EXCEPTION 'solar.schematic_lines: this connection would make a loop in the supply hierarchy' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_lines_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_lines_bind() FROM anon;
CREATE TRIGGER schematic_lines_bind BEFORE INSERT OR UPDATE ON solar.schematic_lines
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_lines_bind();

-- Deleting a card deletes its lines (spec §13.2 "Deleting a card deletes its lines"; WM left them behind).
CREATE OR REPLACE FUNCTION solar.schematic_cards_cascade_lines()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM solar.schematic_lines l
     WHERE l.schematic_id = OLD.schematic_id AND (l.from_meter_id = OLD.meter_id OR l.to_meter_id = OLD.meter_id);
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.schematic_cards_cascade_lines() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schematic_cards_cascade_lines() FROM anon;
CREATE TRIGGER schematic_cards_cascade_lines AFTER DELETE ON solar.schematic_cards
    FOR EACH ROW EXECUTE FUNCTION solar.schematic_cards_cascade_lines();

-- Created after both child tables exist (it updates them).
CREATE TRIGGER schematics_propagate_anchor AFTER UPDATE OF floor_plan_id ON solar.schematics
    FOR EACH ROW EXECUTE FUNCTION solar.schematics_propagate_anchor();

-- ── 4. Check acknowledgements (Load -> Checks) ────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.load_check_acks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id         UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    check_key        TEXT NOT NULL CHECK (length(btrim(check_key)) BETWEEN 1 AND 300),
    note             TEXT CHECK (note IS NULL OR length(note) <= 1000),
    acknowledged_by  UUID REFERENCES auth.users(id),
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT load_check_acks_key UNIQUE (study_id, check_key)
);
-- 00210's study_scoped_bind binds project + org from the study (and pins study_id on UPDATE).
CREATE TRIGGER load_check_acks_bind BEFORE INSERT ON solar.load_check_acks
    FOR EACH ROW EXECUTE FUNCTION solar.study_scoped_bind();

CREATE OR REPLACE FUNCTION solar.load_check_acks_stamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    NEW.check_key := btrim(NEW.check_key);
    NEW.acknowledged_by := COALESCE(auth.uid(), NEW.acknowledged_by);
    NEW.acknowledged_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.load_check_acks_stamp() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.load_check_acks_stamp() FROM anon;
-- Named to sort after load_check_acks_bind.
CREATE TRIGGER load_check_acks_stamp BEFORE INSERT ON solar.load_check_acks
    FOR EACH ROW EXECUTE FUNCTION solar.load_check_acks_stamp();

-- ── 5. Bulk reads (SECURITY INVOKER: meter_readings_select decides) ──────────
-- One row per channel with parallel arrays, so a year of 30-min readings is one row, not 17,520
-- (PostgREST caps responses at max_rows = 1000). Window at most 1,500 days; at most 20 channels.
CREATE OR REPLACE FUNCTION solar.channel_readings(p_channel_ids UUID[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (channel UUID, ts_ends TIMESTAMPTZ[], vals DOUBLE PRECISION[], quals SMALLINT[])
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_channel_ids IS NULL OR cardinality(p_channel_ids) = 0 OR cardinality(p_channel_ids) > 20 THEN
        RAISE EXCEPTION 'solar.channel_readings: between 1 and 20 channels per call' USING ERRCODE = '22023';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '1500 days' THEN
        RAISE EXCEPTION 'solar.channel_readings: the window must be positive and at most 1,500 days' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT r.channel_id,
           array_agg(r.ts_end ORDER BY r.ts_end),
           array_agg(r.value ORDER BY r.ts_end),
           array_agg(r.quality ORDER BY r.ts_end)
      FROM solar.meter_readings r
     WHERE r.channel_id = ANY (p_channel_ids) AND r.ts_end > p_from AND r.ts_end <= p_to
     GROUP BY r.channel_id;
END $$;
REVOKE ALL ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION solar.channel_readings(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- Per-channel period and totals for the meters table and the load inputs hash. "Usable" is the
-- @esite/shared/meter-data isUsable rule: quality 0/2/7, or 3 with a non-negative value.
CREATE OR REPLACE FUNCTION solar.channel_summaries(p_channel_ids UUID[])
RETURNS TABLE (channel UUID, first_ts TIMESTAMPTZ, last_ts TIMESTAMPTZ, n_rows BIGINT, n_usable BIGINT,
               max_value DOUBLE PRECISION, sum_value DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_channel_ids IS NULL OR cardinality(p_channel_ids) > 500 THEN
        RAISE EXCEPTION 'solar.channel_summaries: at most 500 channels per call' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT r.channel_id, min(r.ts_end), max(r.ts_end), count(*),
           count(*) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0))),
           max(r.value) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0))),
           sum(r.value) FILTER (WHERE r.value IS NOT NULL AND (r.quality IN (0, 2, 7) OR (r.quality = 3 AND r.value >= 0)))
      FROM solar.meter_readings r
     WHERE r.channel_id = ANY (p_channel_ids)
     GROUP BY r.channel_id;
END $$;
REVOKE ALL ON FUNCTION solar.channel_summaries(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.channel_summaries(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION solar.channel_summaries(uuid[]) TO authenticated, service_role;

-- ── 6. Row level security ───────────────────────────────────────────────────
ALTER TABLE solar.schematics ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematics FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schematic_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.load_check_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.load_check_acks FORCE ROW LEVEL SECURITY;

CREATE POLICY schematics_select ON solar.schematics FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematics_insert ON solar.schematics FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematics_update ON solar.schematics FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematics_delete ON solar.schematics FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematics_insert_authz ON solar.schematics AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematics_update_authz ON solar.schematics AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematics_delete_authz ON solar.schematics AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schematic_cards_select ON solar.schematic_cards FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_insert ON solar.schematic_cards FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_update ON solar.schematic_cards FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_delete ON solar.schematic_cards FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_cards_insert_authz ON solar.schematic_cards AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_cards_update_authz ON solar.schematic_cards AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_cards_delete_authz ON solar.schematic_cards AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schematic_lines_select ON solar.schematic_lines FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_insert ON solar.schematic_lines FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_update ON solar.schematic_lines FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_delete ON solar.schematic_lines FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schematic_lines_insert_authz ON solar.schematic_lines AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_lines_update_authz ON solar.schematic_lines AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schematic_lines_delete_authz ON solar.schematic_lines AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY load_check_acks_select ON solar.load_check_acks FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_insert ON solar.load_check_acks FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_delete ON solar.load_check_acks FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY load_check_acks_insert_authz ON solar.load_check_acks AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY load_check_acks_delete_authz ON solar.load_check_acks AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.schematics, solar.schematic_cards, solar.schematic_lines TO authenticated;
GRANT SELECT, INSERT, DELETE ON solar.load_check_acks TO authenticated;
-- The schema's default privileges granted UPDATE at CREATE TABLE; an acknowledgement is not edited.
REVOKE UPDATE, TRUNCATE ON solar.load_check_acks FROM authenticated;
GRANT ALL ON solar.schematics, solar.schematic_cards, solar.schematic_lines, solar.load_check_acks TO service_role;
REVOKE ALL ON solar.schematics, solar.schematic_cards, solar.schematic_lines, solar.load_check_acks FROM anon;

-- ── 7. The save: one transaction, stale-refusing, RLS-decided ────────────────
CREATE OR REPLACE FUNCTION public.solar_save_schematic(
    p_schematic_id        UUID,
    p_expected_updated_at TIMESTAMPTZ,
    p_cards               JSONB,
    p_lines               JSONB
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_updated TIMESTAMPTZ;
    v_meters  UUID[];
    v_card    JSONB;
    v_line    JSONB;
BEGIN
    IF p_cards IS NULL OR jsonb_typeof(p_cards) <> 'array' OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'solar_save_schematic: cards and lines must be arrays' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_cards) > 500 OR jsonb_array_length(p_lines) > 1000 THEN
        RAISE EXCEPTION 'solar_save_schematic: at most 500 cards and 1000 lines' USING ERRCODE = '54000';
    END IF;
    SELECT s.project_id INTO v_project FROM solar.schematics s WHERE s.id = p_schematic_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.schematics: schematic not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.solar_can_edit(v_project) THEN
        RAISE EXCEPTION 'solar.schematics: you cannot edit this schematic' USING ERRCODE = '42501';
    END IF;
    SELECT s.updated_at INTO v_updated FROM solar.schematics s WHERE s.id = p_schematic_id FOR UPDATE;
    IF v_updated IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.schematics: stale schematic' USING ERRCODE = '40001';
    END IF;
    SELECT COALESCE(array_agg((c ->> 'meterId')::uuid), '{}'::uuid[]) INTO v_meters FROM jsonb_array_elements(p_cards) c;
    DELETE FROM solar.schematic_lines l WHERE l.schematic_id = p_schematic_id;
    DELETE FROM solar.schematic_cards c WHERE c.schematic_id = p_schematic_id AND NOT (c.meter_id = ANY (v_meters));
    FOR v_card IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
        INSERT INTO solar.schematic_cards AS c (schematic_id, meter_id, x, y, w, h, colour)
        VALUES (p_schematic_id, (v_card ->> 'meterId')::uuid, (v_card ->> 'x')::numeric, (v_card ->> 'y')::numeric,
                (v_card ->> 'w')::numeric, (v_card ->> 'h')::numeric, NULLIF(v_card ->> 'colour', ''))
        ON CONFLICT (schematic_id, meter_id) DO UPDATE
           SET x = EXCLUDED.x, y = EXCLUDED.y, w = EXCLUDED.w, h = EXCLUDED.h, colour = EXCLUDED.colour;
    END LOOP;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints, line_type)
        VALUES (p_schematic_id, (v_line ->> 'fromMeterId')::uuid, (v_line ->> 'toMeterId')::uuid,
                COALESCE(v_line -> 'waypoints', '[]'::jsonb), COALESCE(NULLIF(v_line ->> 'lineType', ''), 'supply'));
    END LOOP;
    -- Touch the schematic: schematics_bind stamps updated_at / updated_by.
    UPDATE solar.schematics s SET name = s.name WHERE s.id = p_schematic_id RETURNING s.updated_at INTO v_updated;
    RETURN v_updated;
END $$;
REVOKE ALL ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_save_schematic(UUID, TIMESTAMPTZ, JSONB, JSONB) TO authenticated, service_role;

-- ── 8. Saved schematic sheets read like the Solar module ─────────────────────
-- Redefines 00183's function IN FULL (a CREATE OR REPLACE replaces the body). Every branch 00183 had
-- is kept byte-for-byte in meaning; solar_layout_sheet is Phase 5's (00211) and is kept here too so
-- the order in which 00211 and 00214 apply cannot drop either gate. A future Solar kind carrying
-- money must use solar_can_see_money, so this names each kind rather than matching solar_%.
CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN _kind = 'solar_schematic_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
