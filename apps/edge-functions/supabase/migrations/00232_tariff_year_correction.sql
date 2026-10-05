-- ---------------------------------------------------------------------------
-- Migration 00232: a published tariff year can be corrected.
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time. Immediately before applying, re-check
-- THREE places: the ledger max(version), origin/main's migration filenames and
-- every OPEN PR's migration filenames (00233 and 00234 were claimed when this
-- was written). If 00232 is taken, renumber this file and its @verify block.
--
-- WHY. 00210 says "corrections are a new version through review", but its
-- UNIQUE (licensee_id, financial_year) refused a second row for the year, and
-- the guard moved a published year only to superseded, and only when ANOTHER
-- year of the licensee published. So a published year could not be corrected
-- at all. On 2026-10-05 ten published 2026/27 RfD years were found misread
-- (MIDVAAL published as one tariff named "Based on the available information
-- and the analysis performed, the REC decided:" holding 22 charges from 12
-- tariffs). Spec: docs/superpowers/specs/2026-10-05-rfd-city-power-reader-
-- misattribution.md.
--
-- WHAT.
--   tariff_year.replaces_year_id   a correction draft names the year it
--                                  corrects: same licensee, same financial
--                                  year, published or superseded. Written by
--                                  the service path only (no client grant),
--                                  fixed once inserted, at most one per year.
--   state 'replaced'               publishing the correction moves the named
--                                  year there, inside the guard, in the same
--                                  statement; nobody can do it by hand. A
--                                  replaced year is immutable like a published
--                                  one and readable by library readers (a study
--                                  pinned to it keeps loading), but every list
--                                  that filters state IN ('published',
--                                  'superseded') no longer shows it.
--   uniqueness                     UNIQUE (licensee_id, financial_year) becomes
--                                  one DRAFT per year and one LIVE (published or
--                                  superseded) row per year; a plain draft for a
--                                  year that is already live is refused (it
--                                  must be a correction).
--   Correcting a superseded year (history) publishes the correction straight
--   to superseded; tariff_year_one_published is untouched.
--
-- NO BEGIN/COMMIT: scripts/db/dry-run-migration.sh wraps this in BEGIN … ROLLBACK.
-- No new schema, so no PostgREST db_schema PATCH (playbook §7).
-- Behaviour: scripts/db/assert-tariff-year-correction.sql (red on a no-op, green here).
-- ---------------------------------------------------------------------------
-- @verify:begin
-- column: tariffs.tariff_year.replaces_year_id
-- index: tariff_year_one_draft_per_fy ON tariffs.tariff_year
-- index: tariff_year_one_live_per_fy ON tariffs.tariff_year
-- index: tariff_year_one_correction ON tariffs.tariff_year
-- index: tariff_year_one_published ON tariffs.tariff_year
-- constraint: tariff_year_state_check ON tariffs.tariff_year
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%replaced%' FROM pg_constraint WHERE conrelid = 'tariffs.tariff_year'::regclass AND conname = 'tariff_year_state_check')
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tariffs.tariff_year'::regclass AND conname = 'tariff_year_licensee_fy'))
-- function: tariffs.tariff_year_guard()
-- sql: (SELECT prosrc LIKE '%replaces_year_id%' FROM pg_proc WHERE oid = 'tariffs.tariff_year_guard()'::regprocedure)
-- function: tariffs.year_child_guard()
-- sql: (SELECT prosrc LIKE '%replaced%' FROM pg_proc WHERE oid = 'tariffs.year_child_guard()'::regprocedure)
-- policy: tariff_year_select ON tariffs.tariff_year PERMISSIVE
-- sql: (SELECT coalesce(qual, '') LIKE '%replaced%' FROM pg_policies WHERE schemaname = 'tariffs' AND tablename = 'tariff_year' AND policyname = 'tariff_year_select')
-- sql: (SELECT NOT has_column_privilege('authenticated', 'tariffs.tariff_year', 'replaces_year_id', 'INSERT') AND NOT has_column_privilege('authenticated', 'tariffs.tariff_year', 'replaces_year_id', 'UPDATE'))
-- @verify:end
-- ---------------------------------------------------------------------------

-- ── 1. Columns and states ───────────────────────────────────────────────────
ALTER TABLE tariffs.tariff_year ADD COLUMN IF NOT EXISTS replaces_year_id UUID REFERENCES tariffs.tariff_year(id);
COMMENT ON COLUMN tariffs.tariff_year.replaces_year_id IS
    'A correction draft names the published or superseded year (same licensee and financial year) it corrects; publishing it moves that year to replaced.';

ALTER TABLE tariffs.tariff_year DROP CONSTRAINT IF EXISTS tariff_year_state_check;
ALTER TABLE tariffs.tariff_year ADD CONSTRAINT tariff_year_state_check
    CHECK (state IN ('ingesting', 'in_review', 'published', 'superseded', 'replaced'));

-- ── 2. One draft and one live row per (licensee, financial year) ───────────
ALTER TABLE tariffs.tariff_year DROP CONSTRAINT IF EXISTS tariff_year_licensee_fy;
CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_draft_per_fy ON tariffs.tariff_year (licensee_id, financial_year)
    WHERE state IN ('ingesting', 'in_review');
CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_live_per_fy ON tariffs.tariff_year (licensee_id, financial_year)
    WHERE state IN ('published', 'superseded');
CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_correction ON tariffs.tariff_year (replaces_year_id)
    WHERE replaces_year_id IS NOT NULL;

-- ── 3. The guard ────────────────────────────────────────────────────────────
-- 00210's guard, plus: the correction rules on INSERT, replaces_year_id fixed,
-- published/superseded -> replaced only from inside the publish of the
-- correction that names it (pg_trigger_depth() > 1 and that correction is the
-- row being published), and the publish branch that performs the replacement.
CREATE OR REPLACE FUNCTION tariffs.tariff_year_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_n             INT;
    v_target_state  TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.state IN ('published', 'superseded', 'replaced') THEN
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
        IF NEW.replaces_year_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM tariffs.tariff_year y
                            WHERE y.id = NEW.replaces_year_id AND y.licensee_id = NEW.licensee_id
                              AND y.financial_year = NEW.financial_year AND y.state IN ('published', 'superseded')) THEN
                RAISE EXCEPTION 'tariffs.tariff_year: a correction names a published or superseded year of the same licensee and financial year'
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF EXISTS (SELECT 1 FROM tariffs.tariff_year y
                       WHERE y.licensee_id = NEW.licensee_id AND y.financial_year = NEW.financial_year
                         AND y.state IN ('published', 'superseded')) THEN
            RAISE EXCEPTION 'tariffs.tariff_year: % is already published for this licensee; load a correction that names it (replaces_year_id)', NEW.financial_year
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := NULL;
        NEW.published_by := NULL;
        NEW.superseded_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.replaces_year_id IS DISTINCT FROM OLD.replaces_year_id THEN
        RAISE EXCEPTION 'tariffs.tariff_year %: the year a correction replaces is fixed when it is created', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    -- UPDATE of a published, superseded or replaced year: only published -> superseded,
    -- or published/superseded -> replaced by the publish of its correction, with every
    -- other fact unchanged.
    IF OLD.state IN ('published', 'superseded', 'replaced') THEN
        IF NOT (((OLD.state = 'published' AND NEW.state = 'superseded')
                 OR (OLD.state IN ('published', 'superseded') AND NEW.state = 'replaced'
                     AND pg_trigger_depth() > 1
                     AND EXISTS (SELECT 1 FROM tariffs.tariff_year c
                                  WHERE c.replaces_year_id = OLD.id AND c.state = 'in_review')))
                AND NEW.licensee_id = OLD.licensee_id
                AND NEW.financial_year = OLD.financial_year
                AND NEW.effective_from = OLD.effective_from
                AND NEW.effective_to = OLD.effective_to
                AND NEW.approved_increase_pct IS NOT DISTINCT FROM OLD.approved_increase_pct
                AND NEW.source_document_id IS NOT DISTINCT FROM OLD.source_document_id
                AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
                AND NEW.published_by IS NOT DISTINCT FROM OLD.published_by
                AND NEW.validation_blocking IS NOT DISTINCT FROM OLD.validation_blocking
                AND NEW.validated_at IS NOT DISTINCT FROM OLD.validated_at) THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: a % year is immutable; correct it through a new version', OLD.id, OLD.state
                USING ERRCODE = 'check_violation';
        END IF;
        IF NOT (OLD.state = 'superseded' AND NEW.state = 'replaced') THEN
            NEW.superseded_at := now();
        END IF;
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
        -- Stage D: the validators must have run on this content and found nothing blocking.
        IF NEW.validated_at IS NULL OR NEW.validation_blocking IS DISTINCT FROM 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: not validated, or % blocking issue(s); validate again after any change', NEW.id, coalesce(NEW.validation_blocking::text, 'unknown')
                USING ERRCODE = 'check_violation';
        END IF;
        -- D-03: a platform admin approves each year; a service call cannot publish.
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: publishing needs a signed-in platform tariff admin', NEW.id USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := now();
        NEW.published_by := auth.uid();
        -- A correction takes the place of the year it names. Correcting history (a superseded
        -- year) yields history: the correction arrives superseded.
        IF NEW.replaces_year_id IS NOT NULL THEN
            SELECT y.state INTO v_target_state FROM tariffs.tariff_year y WHERE y.id = NEW.replaces_year_id;
            IF v_target_state IS NULL OR v_target_state NOT IN ('published', 'superseded') THEN
                RAISE EXCEPTION 'tariffs.tariff_year %: the year this corrects is % and cannot be replaced', NEW.id, coalesce(v_target_state, 'missing')
                    USING ERRCODE = 'check_violation';
            END IF;
            UPDATE tariffs.tariff_year SET state = 'replaced' WHERE id = NEW.replaces_year_id;
            IF v_target_state = 'superseded' THEN
                NEW.state := 'superseded';
                NEW.superseded_at := now();
                RETURN NEW;
            END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM tariffs.tariff_year y
                    WHERE y.licensee_id = NEW.licensee_id AND y.id <> NEW.id
                      AND y.state = 'published' AND y.financial_year > NEW.financial_year) THEN
            -- A back-filled older year is history on arrival.
            NEW.state := 'superseded';
            NEW.superseded_at := now();
        ELSE
            UPDATE tariffs.tariff_year SET state = 'superseded'
             WHERE licensee_id = NEW.licensee_id AND id <> NEW.id AND state = 'published';
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- ── 4. Children of a replaced year are immutable too ───────────────────────
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
        IF v_state IN ('published', 'superseded', 'replaced') THEN
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

-- ── 5. Library readers still read a replaced year ──────────────────────────
-- 00228's policy with 'replaced' added. Lists filter state themselves, so a
-- replaced year drops out of them; a study pinned to one keeps loading by id.
DROP POLICY IF EXISTS tariff_year_select ON tariffs.tariff_year;
CREATE POLICY tariff_year_select ON tariffs.tariff_year FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())
           OR ((SELECT public.caller_can_read_tariff_library()) AND state IN ('published', 'superseded', 'replaced')));

NOTIFY pgrst, 'reload schema';
