-- ---------------------------------------------------------------------------
-- Migration 00218: Solar integration fixes (phases 1-5b merged on feat/solar-final)
-- ---------------------------------------------------------------------------
-- Cross-phase defects only visible once 00207..00215 sit on one branch. 00216 / 00217
-- are claimed by Solar phases 6 / 7 (in flight); re-check the number at apply time.
--
-- WHAT
--   (a) solar.audit_events: authenticated users can no longer INSERT. 00207 let any Edit
--       user post a row straight through PostgREST, so an editor could forge a
--       "Recent activity" line (any verb, any object_ref) on the Overview. Every writer is
--       now the service role, called by a server action AFTER its own Solar gate
--       (apps/web/src/lib/solar/audit.ts recordSolarAudit; the meter-import repo routes
--       through it too). The bind trigger still derives organisation_id.
--   (b) The manual export rule's source note left solar.studies.export_rule (readable at
--       View). It lives only on the money rows solar.study_export_rates.source_note
--       (every verb on solar_can_see_money, 00213). studies_export_rule_shape now REFUSES
--       a sourceNote key; save_export_rule takes the note from p_rule, writes it on every
--       rate row, stores the rule WITHOUT it, and refuses a manual rule with no rate
--       (the note would otherwise have nowhere to live). Existing rows are stripped
--       (production holds none; the rate rows already carry the note).
--   (c) Load double-count guard is app-only (packages/shared build-site-load): no SQL.
--   (d) solar.cases.layout_id REFERENCES solar.layouts(id) ON DELETE RESTRICT (4b Q5,
--       the FK 00215 deferred to this merge). Deleting a layout a case uses is refused
--       (23503, mapped by humanLayoutError to "Used by a case"). cases_layout_bind
--       refuses a layout from another project (23514).
-- RULES
--   * No transaction control here: the runner wraps the file.
--   * 00207's @verify block named audit_events_insert; that line is removed from 00207 in
--     the same PR, because the post-push verifier re-checks every migration >= 00185.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- grant_absent: authenticated INSERT ON solar.audit_events
-- grant_present: authenticated SELECT ON solar.audit_events
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'solar' AND tablename = 'audit_events' AND cmd IN ('INSERT', 'ALL')))
-- constraint: studies_export_rule_shape ON solar.studies
-- sql: (SELECT strpos(pg_get_constraintdef(c.oid), '? ''sourceNote''') > 0 FROM pg_constraint c WHERE c.conname = 'studies_export_rule_shape' AND c.conrelid = 'solar.studies'::regclass)
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM solar.studies WHERE export_rule ? 'sourceNote'))
-- function: solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)
-- sql: (SELECT NOT p.prosecdef AND strpos(p.prosrc, 'p_rule - ''sourceNote''') > 0 FROM pg_proc p WHERE p.oid = 'solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)'::regprocedure)
-- grant_absent: anon EXECUTE ON solar.save_export_rule(uuid, timestamptz, jsonb, jsonb)
-- constraint: cases_layout_fk ON solar.cases
-- sql: (SELECT c.confdeltype = 'r' AND c.confrelid = 'solar.layouts'::regclass FROM pg_constraint c WHERE c.conname = 'cases_layout_fk' AND c.conrelid = 'solar.cases'::regclass)
-- function: solar.cases_layout_bind()
-- trigger: cases_layout_bind ON solar.cases
-- grant_absent: anon EXECUTE ON solar.cases_layout_bind()
-- behaviour: scripts/db/assert-solar-integration-fixes.sql, every row ok
-- @verify:end

-- ── (a) audit_events: service-written only ─────────────────────────────────
DROP POLICY IF EXISTS audit_events_insert ON solar.audit_events;
REVOKE INSERT ON solar.audit_events FROM authenticated;

-- ── (b) the export source note is money ────────────────────────────────────
-- Strip first, then tighten: the new CHECK would refuse a row that still carries it.
UPDATE solar.studies SET export_rule = export_rule - 'sourceNote' WHERE export_rule ? 'sourceNote';

ALTER TABLE solar.studies DROP CONSTRAINT IF EXISTS studies_export_rule_shape;
ALTER TABLE solar.studies ADD CONSTRAINT studies_export_rule_shape CHECK (
    export_rule IS NULL OR (
        jsonb_typeof(export_rule) = 'object'
        AND export_rule->>'method' IN ('linked_tariff', 'none', 'manual')
        AND NOT (export_rule ? 'sourceNote')));

CREATE OR REPLACE FUNCTION solar.save_export_rule(p_project_id UUID, p_expected_updated_at TIMESTAMPTZ, p_rule JSONB, p_rates JSONB)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_study  RECORD;
    v_upd    TIMESTAMPTZ;
    v_note   TEXT := btrim(coalesce(p_rule->>'sourceNote', ''));
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
    -- The note lives only on the money rows, so a manual rule needs at least one rate AND a note.
    IF p_rule->>'method' = 'manual' AND (jsonb_array_length(coalesce(p_rates, '[]'::jsonb)) = 0 OR v_note = '') THEN
        RAISE EXCEPTION 'solar.save_export_rule: a manual export rule needs at least one rate and a source note' USING ERRCODE = '23514';
    END IF;
    DELETE FROM solar.study_export_rates WHERE study_id = v_study.id;
    INSERT INTO solar.study_export_rates (study_id, project_id, organisation_id, season, tou, unit, amount_excl_vat, source_note)
    SELECT v_study.id, p_project_id, '00000000-0000-0000-0000-000000000000', r.season, r.tou, r.unit, r.amount_excl_vat, v_note
      FROM jsonb_to_recordset(coalesce(p_rates, '[]'::jsonb)) AS r(season TEXT, tou TEXT, unit TEXT, amount_excl_vat NUMERIC);
    UPDATE solar.studies SET export_rule = p_rule - 'sourceNote' WHERE id = v_study.id RETURNING updated_at INTO v_upd;
    RETURN v_upd;
END $$;
REVOKE ALL ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION solar.save_export_rule(uuid, timestamptz, jsonb, jsonb) TO authenticated, service_role;

-- ── (d) cases.layout_id -> solar.layouts ───────────────────────────────────
ALTER TABLE solar.cases DROP CONSTRAINT IF EXISTS cases_layout_fk;
ALTER TABLE solar.cases ADD CONSTRAINT cases_layout_fk
    FOREIGN KEY (layout_id) REFERENCES solar.layouts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cases_layout_idx ON solar.cases (layout_id) WHERE layout_id IS NOT NULL;

-- Runs after cases_bind (trigger names fire in order), so NEW.project_id is already bound
-- from the study. DEFINER only to compare two ids: it reveals nothing and writes nothing.
CREATE OR REPLACE FUNCTION solar.cases_layout_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.layout_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM solar.layouts l WHERE l.id = NEW.layout_id AND l.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'solar.cases: the layout belongs to another project' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.cases_layout_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.cases_layout_bind() FROM anon;
DROP TRIGGER IF EXISTS cases_layout_bind ON solar.cases;
CREATE TRIGGER cases_layout_bind BEFORE INSERT OR UPDATE OF layout_id, study_id ON solar.cases
    FOR EACH ROW EXECUTE FUNCTION solar.cases_layout_bind();

NOTIFY pgrst, 'reload schema';
