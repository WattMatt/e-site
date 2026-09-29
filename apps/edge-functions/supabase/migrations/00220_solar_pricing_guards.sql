-- ---------------------------------------------------------------------------
-- Migration 00220: Solar pricing guards (I-2) + solar.layouts.module_id FK
-- ---------------------------------------------------------------------------
-- 00217 / 00218 are claimed by Solar phases 6 / 7 (in flight). Re-check the number against the
-- ledger, origin/main and every open PR's migration filenames AT APPLY TIME.
--
-- WHAT
--   (a) I-2. solar.save_export_rule refuses a manual export rule with no rate, but a money user
--       could PATCH solar.studies.export_rule = {"method":"manual"} straight over PostgREST (or
--       DELETE the rate rows) and leave a manual rule with nothing to price. Two DEFERRED
--       constraint triggers now tie the two tables together at COMMIT: a study's export rule is
--       'manual' if and only if it has at least one solar.study_export_rates row. Deferred, because
--       save_export_rule deletes and re-inserts the rates and writes the rule last in ONE
--       transaction; the check runs once, at commit, on the final state. SECURITY DEFINER so the
--       count is exact whatever the caller can read (the rate rows are money, 00214). The study row is
--       locked (FOR NO KEY UPDATE) so concurrent writers are checked in turn (this relies on READ
--       COMMITTED, PostgREST's level: the count after the lock takes a fresh snapshot). Existing mismatches are
--       backfilled first (manual without rates -> 'none'; stray rates removed): neither was priced.
--   (b) solar.layouts.module_id REFERENCES solar.equipment(id) ON DELETE RESTRICT (the FK 00212
--       deferred to the Financials phase). Existing ids that are not a module of the layout's org
--       or of the platform catalogue are set NULL first ("generic presets": nothing in apps/web
--       writes module_id today). layouts_module_bind refuses an unknown id, another org's row or a
--       non-module with ONE code (23514), so the error is not an existence oracle across orgs. module_spec stays the snapshot the design was made with and never follows the
--       catalogue: the FK only stops the referenced row disappearing under a layout.
-- RULES
--   * No transaction control here: the runner wraps the file.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- function: solar.export_rule_rates_check()
-- trigger: studies_export_rule_rates ON solar.studies
-- trigger: export_rates_rule_match ON solar.study_export_rates
-- sql: (SELECT bool_and(t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint <> 0) FROM pg_trigger t WHERE t.tgname IN ('studies_export_rule_rates', 'export_rates_rule_match') AND t.tgrelid IN ('solar.studies'::regclass, 'solar.study_export_rates'::regclass))
-- sql: (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'solar.export_rule_rates_check()'::regprocedure)
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM solar.studies s WHERE coalesce(s.export_rule->>'method' = 'manual', false) IS DISTINCT FROM EXISTS (SELECT 1 FROM solar.study_export_rates r WHERE r.study_id = s.id)))
-- grant_absent: anon EXECUTE ON solar.export_rule_rates_check()
-- constraint: layouts_module_fk ON solar.layouts
-- sql: (SELECT c.confdeltype = 'r' AND c.confrelid = 'solar.equipment'::regclass FROM pg_constraint c WHERE c.conname = 'layouts_module_fk' AND c.conrelid = 'solar.layouts'::regclass)
-- function: solar.layouts_module_bind()
-- trigger: layouts_module_bind ON solar.layouts
-- grant_absent: anon EXECUTE ON solar.layouts_module_bind()
-- index: layouts_module_idx ON solar.layouts
-- behaviour: scripts/db/assert-solar-pricing-guards.sql, every row ok
-- @verify:end

-- ── (a) a manual export rule has rates; rates exist only for a manual rule ──
CREATE OR REPLACE FUNCTION solar.export_rule_rates_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_ids    UUID[];
    v_id     UUID;
    v_found  BOOLEAN;
    v_method TEXT;
    v_rates  INT;
BEGIN
    IF TG_TABLE_NAME = 'studies' THEN
        v_ids := ARRAY[NEW.id];
    ELSIF TG_OP = 'INSERT' THEN
        v_ids := ARRAY[NEW.study_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_ids := ARRAY[OLD.study_id];
    ELSE
        v_ids := ARRAY[NEW.study_id, OLD.study_id];
    END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
        v_found := NULL;
        -- Lock the study so two concurrent transactions (e.g. two DELETEs of different rate rows) are
        -- checked one after the other: the second one's count then sees the first one's commit.
        SELECT TRUE, s.export_rule->>'method' INTO v_found, v_method FROM solar.studies s WHERE s.id = v_id FOR NO KEY UPDATE;
        -- The study is gone (a study or project delete cascading through its rates): nothing to match.
        CONTINUE WHEN v_found IS NOT TRUE;
        SELECT count(*) INTO v_rates FROM solar.study_export_rates r WHERE r.study_id = v_id;
        IF v_method = 'manual' AND v_rates = 0 THEN
            RAISE EXCEPTION 'solar.studies: a manual export rule needs its export rates — save it on the Tariff tab'
                USING ERRCODE = '23514';
        END IF;
        IF v_method IS DISTINCT FROM 'manual' AND v_rates > 0 THEN
            RAISE EXCEPTION 'solar.study_export_rates: export rates are kept only for a manual export rule'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION solar.export_rule_rates_check() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.export_rule_rates_check() FROM anon;

-- Backfill BEFORE the triggers (a constraint trigger never re-checks existing rows, and the @verify
-- invariant above is re-evaluated on every later deploy). 00214's save_export_rule accepted a manual
-- rule with no rates, and I-2 could write one directly: such a rule priced nothing, so it becomes
-- 'none' (resolveStudyPricing already priced it so). Stray rates under a non-manual rule were never
-- priced either; they go.
UPDATE solar.studies s SET export_rule = jsonb_set(s.export_rule, '{method}', '"none"')
 WHERE s.export_rule->>'method' = 'manual'
   AND NOT EXISTS (SELECT 1 FROM solar.study_export_rates r WHERE r.study_id = s.id);
DELETE FROM solar.study_export_rates r USING solar.studies s
 WHERE r.study_id = s.id AND s.export_rule->>'method' IS DISTINCT FROM 'manual';

DROP TRIGGER IF EXISTS studies_export_rule_rates ON solar.studies;
CREATE CONSTRAINT TRIGGER studies_export_rule_rates
    AFTER INSERT OR UPDATE OF export_rule ON solar.studies
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION solar.export_rule_rates_check();

DROP TRIGGER IF EXISTS export_rates_rule_match ON solar.study_export_rates;
CREATE CONSTRAINT TRIGGER export_rates_rule_match
    AFTER INSERT OR UPDATE OR DELETE ON solar.study_export_rates
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION solar.export_rule_rates_check();

-- ── (b) layouts.module_id → solar.equipment ────────────────────────────────
-- Backfill first: an id that is not a module of the layout's org or of the platform is a generic
-- preset (or stale), so it becomes NULL; the design's module_spec snapshot is untouched.
UPDATE solar.layouts l SET module_id = NULL
 WHERE l.module_id IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM solar.equipment e
        WHERE e.id = l.module_id AND e.kind = 'module'
          AND (e.organisation_id IS NULL OR e.organisation_id = l.organisation_id));

ALTER TABLE solar.layouts DROP CONSTRAINT IF EXISTS layouts_module_fk;
ALTER TABLE solar.layouts ADD CONSTRAINT layouts_module_fk
    FOREIGN KEY (module_id) REFERENCES solar.equipment(id) ON DELETE RESTRICT;
-- ON DELETE RESTRICT looks the referencing row up by module_id.
CREATE INDEX IF NOT EXISTS layouts_module_idx ON solar.layouts (module_id) WHERE module_id IS NOT NULL;

CREATE OR REPLACE FUNCTION solar.layouts_module_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_found BOOLEAN;
    v_kind  TEXT;
    v_org   UUID;
BEGIN
    IF NEW.module_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.module_id IS NOT DISTINCT FROM OLD.module_id THEN RETURN NEW; END IF;
    SELECT TRUE, e.kind, e.organisation_id INTO v_found, v_kind, v_org FROM solar.equipment e WHERE e.id = NEW.module_id;
    -- One answer for "no such row", "another org's row" and "not a module", so the error code is not an
    -- oracle for which equipment ids exist in other organisations (the FK stays as the backstop).
    IF v_found IS NOT TRUE OR v_kind <> 'module' OR (v_org IS NOT NULL AND v_org IS DISTINCT FROM NEW.organisation_id) THEN
        RAISE EXCEPTION 'solar.layouts: the module must be a module from this organisation''s catalogue or the platform''s'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.layouts_module_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.layouts_module_bind() FROM anon;

-- Fires after layouts_bind (name order), so NEW.organisation_id is already the study's.
DROP TRIGGER IF EXISTS layouts_module_bind ON solar.layouts;
CREATE TRIGGER layouts_module_bind BEFORE INSERT OR UPDATE OF module_id ON solar.layouts
    FOR EACH ROW EXECUTE FUNCTION solar.layouts_module_bind();

NOTIFY pgrst, 'reload schema';
